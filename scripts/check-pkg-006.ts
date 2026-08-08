import { randomUUID } from 'node:crypto'
import { connect as connectSocket, createServer } from 'node:net'
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import {
  fileIdentity,
  parseNamedArguments,
  requireSafeArtifactRoot,
  SCRIPT_EXIT,
  ScriptError,
  writeJsonAtomic
} from './evidence-script-runtime.ts'

const repositoryRoot = resolve(import.meta.dir, '..')
const desktopRoot = join(repositoryRoot, 'apps', 'desktop')
const backendDist = join(repositoryRoot, 'apps', 'backend-bun', 'dist')
const buildScript = join(repositoryRoot, 'scripts', 'build-bun-backend.ts')
const electronViteCli = join(desktopRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const electronBuilderCli = join(desktopRoot, 'node_modules', 'electron-builder', 'cli.js')
const electronBuilderConfig = join(desktopRoot, 'electron-builder.yml')
const electronExecutableName = process.platform === 'win32' ? 'ADVX Live.exe' : 'ADVX Live'
const args = parseNamedArguments(Bun.argv.slice(2), new Set(['--artifact-root']))
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ?? join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'pkg-006'),
  repositoryRoot
)
const builderOutput = join(artifactRoot, 'electron-package')
const unpackedRoot = join(builderOutput, process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked')
const unpackedExecutable = join(unpackedRoot, electronExecutableName)
const installerPath = join(builderOutput, 'ADVX Live Setup 0.1.0.exe')
const hostileCwd = join(artifactRoot, 'hostile-working-directory')

type JsonRecord = Record<string, unknown>

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScriptError(SCRIPT_EXIT.verificationFailed, message)
}

function tail(value: string): string {
  return value.length > 4_000 ? value.slice(-4_000) : value
}

async function runCommand(
  command: string,
  commandArgs: readonly string[],
  cwd: string
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  const child = Bun.spawn([command, ...commandArgs], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true
  })
  const stdout = new Response(child.stdout).text()
  const stderr = new Response(child.stderr).text()
  return { exitCode: await child.exited, stdout: await stdout, stderr: await stderr }
}

async function waitFor<T>(
  description: string,
  operation: () => Promise<T | null | false>,
  timeoutMs = 30_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const value = await operation()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await Bun.sleep(100)
  }
  throw new Error(`${description} did not become ready${lastError ? `: ${String(lastError)}` : ''}`)
}

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolvePromise())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('port_probe_failed')
  const port = address.port
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  return port
}

async function portIsFree(port: number): Promise<boolean> {
  const server = createServer()
  return await new Promise<boolean>((resolvePromise) => {
    server.once('error', () => resolvePromise(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolvePromise(true)))
  })
}

async function sendShutdown(socketPath: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const socket = connectSocket(socketPath)
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      socket.destroy()
      if (error) reject(error)
      else resolvePromise()
    }
    socket.once('error', (error) => finish(error))
    socket.once('data', (data) => {
      if (data.toString('utf8').trim() === 'ok') finish()
      else finish(new Error(`unexpected_shutdown_response:${data.toString('utf8')}`))
    })
    socket.once('connect', () => socket.write('quit\n'))
  })
}

async function waitForExit(process: Bun.Subprocess, description: string): Promise<number> {
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`${description} timed out`)), 15_000)
  })
  return await Promise.race([process.exited, timeout])
}

async function taskkill(pid: number | null): Promise<void> {
  if (!pid) return
  await runCommand('taskkill.exe', ['/PID', String(pid), '/T', '/F'], repositoryRoot)
}

async function taskExists(pid: number | null): Promise<boolean> {
  if (!pid) return false
  const probe = await runCommand('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'], repositoryRoot)
  return probe.exitCode === 0 && probe.stdout.includes(`"${pid}"`)
}

async function logText(logPath: string): Promise<string> {
  try {
    return await readFile(logPath, 'utf8')
  } catch {
    return ''
  }
}

function backendPids(log: string): number[] {
  return [...log.matchAll(/backend\.spawned \{ pid: (\d+) \}/g)].map((match) => Number(match[1]))
}

async function resourceSnapshot(root: string): Promise<readonly JsonRecord[]> {
  const entries: JsonRecord[] = []
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else entries.push(await fileIdentity(path, relative(root, path).replaceAll('\\', '/')))
    }
  }
  await visit(root)
  return entries
}

type Launch = Readonly<{
  process: Bun.Subprocess
  userData: string
  logPath: string
  socketPath: string
  port: number
  initialBackendPid: number
}>

async function launchPackaged(label: string): Promise<Launch> {
  const userData = join(artifactRoot, `user-data-${label}-${randomUUID()}`)
  const socketPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\advx-pkg-006-${label}-${randomUUID()}`
    : join(artifactRoot, `shutdown-${label}-${randomUUID()}.sock`)
  const port = await availablePort()
  const logPath = join(userData, 'logs', 'advx.log')
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...parentEnvironment } = process.env
  const environment: Record<string, string> = {
    ...Object.fromEntries(Object.entries(parentEnvironment).filter(([, value]) => value !== undefined)),
    ADVX_BACKEND_RUNTIME: 'bun-compiled',
    ADVX_BACKEND_EXTERNAL: '0',
    ADVX_BACKEND_URL: `http://127.0.0.1:${port}`,
    ADVX_RECORDED_PIPELINE: '1',
    ADVX_DESKTOP_SHUTDOWN_SOCKET: socketPath,
    ADVX_DATA_DIR: 'C:/pkg-006-poisoned-data',
    BUN_BE_BUN: '1',
    OPENAI_API_KEY: 'pkg-006-poison-provider-secret',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  }
  const child = Bun.spawn([unpackedExecutable, `--user-data-dir=${userData}`, '--disable-gpu'], {
    cwd: hostileCwd,
    env: environment,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
    windowsHide: true
  })
  const readyLog = await waitFor('packaged backend readiness', async () => {
    const text = await logText(logPath)
    return text.includes('backend.ready') ? text : null
  })
  const pid = backendPids(readyLog).at(-1)
  assertCondition(pid !== undefined, `${label}: backend pid missing from supervisor log`)
  return { process: child, userData, logPath, socketPath, port, initialBackendPid: pid }
}

async function gracefulClose(launch: Launch): Promise<void> {
  await sendShutdown(launch.socketPath)
  await waitForExit(launch.process, 'Electron graceful exit')
  await waitFor('backend port release', async () => (await portIsFree(launch.port)) ? true : null)
  const text = await logText(launch.logPath)
  assertCondition(text.includes('app.shutdown.completed'), 'graceful shutdown did not complete in application log')
}

async function forcedClose(launch: Launch): Promise<void> {
  await taskkill(launch.process.pid ?? null)
  await waitForExit(launch.process, 'Electron forced exit')
  await waitFor('forced backend port release', async () => (await portIsFree(launch.port)) ? true : null)
  assertCondition(!(await taskExists(launch.initialBackendPid)), 'forced Electron termination left a Bun backend orphan')
}

await rm(artifactRoot, { recursive: true, force: true })
await mkdir(hostileCwd, { recursive: true })
await writeFile(join(hostileCwd, '.env'), 'ADVX_DATA_DIR=C:/pkg-006-hostile-data\nADVX_BACKEND_PORT=1\n')
await writeFile(join(hostileCwd, 'bunfig.toml'), 'preload = ["./poison-preload.ts"]\n')
await writeFile(join(hostileCwd, 'poison-preload.ts'), "await Bun.write('./BUNFIG_POISON_MARKER.txt', 'autoloaded')\n")

const [builderConfigText, rootPackageText] = await Promise.all([
  readFile(electronBuilderConfig, 'utf8'),
  readFile(join(repositoryRoot, 'package.json'), 'utf8')
])
const rootPackage = JSON.parse(rootPackageText) as JsonRecord
const scripts = rootPackage.scripts as JsonRecord
assertCondition(process.platform === 'win32' && process.arch === 'x64', 'PKG-006 requires Windows x64 lifecycle evidence')
assertCondition(builderConfigText.includes('target: nsis'), 'NSIS target is not enabled')
assertCondition(scripts['package:desktop'] !== undefined, 'supported package:desktop sequence is missing')

const backendBuild = await runCommand(process.execPath, [buildScript, '--output-root', backendDist, '--run-id', 'pkg-006-backend-build'], repositoryRoot)
assertCondition(backendBuild.exitCode === 0, `Bun backend compile failed: ${tail(backendBuild.stderr || backendBuild.stdout)}`)
const desktopBuild = await runCommand(process.env.npm_node_execpath ?? 'node', [electronViteCli, 'build'], desktopRoot)
assertCondition(desktopBuild.exitCode === 0, `Electron Vite build failed: ${tail(desktopBuild.stderr || desktopBuild.stdout)}`)
const packageBuild = await runCommand(process.env.npm_node_execpath ?? 'node', [
  electronBuilderCli,
  '--win',
  '--x64',
  '--projectDir',
  desktopRoot,
  '--config',
  electronBuilderConfig,
  `--config.directories.output=${builderOutput}`
], desktopRoot)
assertCondition(packageBuild.exitCode === 0, `NSIS package build failed: ${tail(packageBuild.stderr || packageBuild.stdout)}`)
assertCondition(await Bun.file(unpackedExecutable).exists(), `packaged Electron executable missing: ${unpackedExecutable}`)
assertCondition(await Bun.file(installerPath).exists(), `NSIS installer missing: ${installerPath}`)

const first = await launchPackaged('first-start')
const firstPid = first.initialBackendPid
await gracefulClose(first)

const restart = await launchPackaged('backend-restart')
let restartText = await logText(restart.logPath)
await taskkill(restart.initialBackendPid)
restartText = await waitFor('backend crash recovery', async () => {
  const text = await logText(restart.logPath)
  return backendPids(text).length >= 2 && text.includes('backend.recovery.scheduled') && text.includes('backend.ready') ? text : null
})
const recoveredPids = backendPids(restartText)
assertCondition(recoveredPids.at(-1) !== restart.initialBackendPid, 'backend recovery reused the crashed pid')
await gracefulClose(restart)
assertCondition(!(await taskExists(restart.initialBackendPid)), 'crashed backend remained after recovery shutdown')
if (recoveredPids.at(-1)) assertCondition(!(await taskExists(recoveredPids.at(-1)!)), 'recovered backend remained after graceful shutdown')

const forced = await launchPackaged('forced-termination')
await forcedClose(forced)

const rendererCrashContract = await logText(join(repositoryRoot, 'apps', 'desktop', 'src', 'main', 'index.ts'))
assertCondition(rendererCrashContract.includes('before-quit') && rendererCrashContract.includes('backendProcess?.dispose'), 'Electron shutdown contract is missing backend disposal')
const markerExists = await Bun.file(join(hostileCwd, 'BUNFIG_POISON_MARKER.txt')).exists()
assertCondition(!markerExists, 'hostile working-directory preload executed')

const packageFiles = await resourceSnapshot(unpackedRoot)
const result = {
  schemaVersion: 1,
  taskId: 'PKG-006',
  status: 'passed',
  target: { platform: process.platform, arch: process.arch },
  package: { unpackedExecutable, installerPath, nsisTarget: true, packageFileCount: packageFiles.length },
  lifecycle: {
    firstStart: { backendPid: firstPid, gracefulExit: true, portReleased: true },
    backendCrashRestart: { crashedPid: restart.initialBackendPid, recoveredPids, recoveryObserved: true, noOrphanAfterShutdown: true },
    forcedTermination: { electronTreeKilled: true, noBackendOrphan: true, portReleased: true },
    rendererCrashAndProviderQuit: { sourceShutdownContractChecked: true, runtimeScenario: 'deferred-to-installed-e2e-PKG-010' },
    uninstall: { nsisArtifactBuilt: true, retentionDecision: 'user-data-outside-install-root-is-retained' }
  },
  runtime: { bun: Bun.version, platform: process.platform, arch: process.arch }
} as const
await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
