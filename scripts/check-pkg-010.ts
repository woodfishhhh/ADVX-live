import { createHash } from 'node:crypto'
import { connect as connectSocket, createServer } from 'node:net'
import {
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { join, resolve } from 'node:path'

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
const runner = join(desktopRoot, 'scripts', 'pkg-010-installed-smoke.mjs')
const electronViteCli = join(desktopRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const electronBuilderCli = join(desktopRoot, 'node_modules', 'electron-builder', 'cli.js')
const electronBuilderConfig = join(desktopRoot, 'electron-builder.yml')
const diagnosticsCli = join(repositoryRoot, 'apps', 'backend-bun', 'src', 'diagnostics', 'cli.ts')
const electronExecutableName = 'ADVX Live.exe'
const args = parseNamedArguments(Bun.argv.slice(2), new Set(['--artifact-root']))
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ?? join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'pkg-010'),
  repositoryRoot
)
const builderOutput = join(artifactRoot, 'electron-package')
const unpackedRoot = join(builderOutput, 'win-unpacked')
const unpackedExecutable = join(unpackedRoot, electronExecutableName)
const installerPath = join(builderOutput, 'ADVX Live Setup 0.1.0.exe')
const installRoot = join(artifactRoot, 'installed-root')
const installedExecutable = join(installRoot, electronExecutableName)

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
  cwd: string,
  input?: string
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  const child = Bun.spawn([command, ...commandArgs], {
    cwd,
    stdin: input === undefined ? 'ignore' : 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true
  })
  if (input !== undefined) {
    child.stdin!.write(input)
    child.stdin!.end()
  }
  const stdoutPromise = new Response(child.stdout).text()
  const stderrPromise = new Response(child.stderr).text()
  return {
    exitCode: await child.exited,
    stdout: await stdoutPromise,
    stderr: await stderrPromise
  }
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
    await Bun.sleep(150)
  }
  throw new Error(`${description} did not become ready${lastError ? `: ${String(lastError)}` : ''}`)
}

async function port(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolvePromise())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('port_probe_failed')
  const value = address.port
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  return value
}

async function sendShutdown(socketPath: string): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const socket = connectSocket(socketPath)
    const finish = (error?: Error): void => {
      socket.destroy()
      if (error) reject(error)
      else resolvePromise()
    }
    socket.once('error', finish)
    socket.once('data', (data) => finish(data.toString('utf8').trim() === 'ok' ? undefined : new Error('shutdown rejected')))
    socket.once('connect', () => socket.write('quit\n'))
  })
}

async function taskkill(pid: number): Promise<void> {
  const killer = Bun.spawn(['taskkill.exe', '/pid', String(pid), '/t', '/f'], {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
    windowsHide: true
  })
  await killer.exited
}

async function restartInstalledApp(restartRoot: string): Promise<JsonRecord> {
  const userData = join(restartRoot, 'restart-user-data')
  const logPath = join(userData, 'logs', 'advx.log')
  const socketPath = `\\\\.\\pipe\\advx-pkg-010-restart-${crypto.randomUUID()}`
  const backendPort = await port()
  await mkdir(userData, { recursive: true })
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...parentEnvironment } = process.env
  const environment = {
    ...Object.fromEntries(Object.entries(parentEnvironment).filter(([, value]) => value !== undefined)),
    ADVX_BACKEND_RUNTIME: 'bun-compiled',
    ADVX_BACKEND_EXTERNAL: '0',
    ADVX_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
    ADVX_RECORDED_PIPELINE: '1',
    ADVX_DESKTOP_SHUTDOWN_SOCKET: socketPath,
    BUN_BE_BUN: '1',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  }
  const child = Bun.spawn([installedExecutable, `--user-data-dir=${userData}`, '--disable-gpu'], {
    cwd: installRoot,
    env: environment,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
    windowsHide: true
  })
  try {
    const readyLog = await waitFor('installed restart backend readiness', async () => {
      try {
        const text = await readFile(logPath, 'utf8')
        return text.includes('backend.ready') ? text : null
      } catch {
        return null
      }
    }, 45_000)
    assertCondition(readyLog.includes('backend.ready'), 'restart did not record backend.ready')
    await sendShutdown(socketPath)
    await waitFor('installed restart exit', async () => child.exitCode !== null ? true : null, 20_000)
    return { started: true, backendReady: true, gracefulExit: true, userData }
  } catch (error) {
    if (child.exitCode === null) await taskkill(child.pid)
    throw error
  }
}

await rm(artifactRoot, { recursive: true, force: true })
await mkdir(artifactRoot, { recursive: true })
assertCondition(process.platform === 'win32' && process.arch === 'x64', 'PKG-010 requires Windows x64')
const rootPackage = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')) as JsonRecord
const scripts = rootPackage.scripts as JsonRecord
assertCondition(typeof scripts['package:desktop'] === 'string', 'package:desktop script is missing')

const backendBuild = await runCommand(process.execPath, [buildScript, '--output-root', backendDist, '--run-id', 'pkg-010-backend-build'], repositoryRoot)
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
assertCondition(await Bun.file(unpackedExecutable).exists(), `unpacked executable missing: ${unpackedExecutable}`)
assertCondition(await Bun.file(installerPath).exists(), `NSIS installer missing: ${installerPath}`)

await mkdir(installRoot, { recursive: true })
const install = await runCommand(installerPath, ['/S', `/D=${installRoot}`], artifactRoot)
assertCondition(install.exitCode === 0, `NSIS install failed: ${tail(install.stderr || install.stdout)}`)
assertCondition(await Bun.file(installedExecutable).exists(), `installed executable missing: ${installedExecutable}`)

const runtimeRoot = join(artifactRoot, 'runtime-e2e')
const runtime = await runCommand(process.env.npm_node_execpath ?? 'node', [runner, installRoot, runtimeRoot], repositoryRoot)
assertCondition(runtime.exitCode === 0, `installed pipeline failed: ${tail(runtime.stderr || runtime.stdout)}`)
const pipeline = JSON.parse(await readFile(join(runtimeRoot, 'installed-pipeline.json'), 'utf8')) as JsonRecord
assertCondition(pipeline.status === 'passed', 'installed pipeline proof is not passed')
const diagnosticsInputPath = join(runtimeRoot, 'diagnostics-input.json')
const diagnosticsInput = await readFile(diagnosticsInputPath, 'utf8')
const diagnostics = await runCommand(process.execPath, [diagnosticsCli], repositoryRoot, diagnosticsInput)
assertCondition(diagnostics.exitCode === 0, `diagnostics bundle failed: ${tail(diagnostics.stderr || diagnostics.stdout)}`)
const diagnosticsResponse = JSON.parse(diagnostics.stdout) as JsonRecord
assertCondition(diagnosticsResponse.ok === true, 'diagnostics response was not ok')
const manifestPath = join(runtimeRoot, 'diagnostics-bundle', 'manifest.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as JsonRecord
assertCondition(manifest.redacted === true, 'diagnostics manifest must be redacted')
assertCondition(Array.isArray(manifest.files) && manifest.files.length >= 3, 'diagnostics bundle lacks recorded artifacts')

const restart = await restartInstalledApp(artifactRoot)
const userDataPath = String((pipeline.package as JsonRecord).userData)
const uninstallerPath = join(installRoot, 'Uninstall ADVX Live.exe')
assertCondition(await Bun.file(uninstallerPath).exists(), `uninstaller missing: ${uninstallerPath}`)
const uninstall = await runCommand(uninstallerPath, ['/S'], installRoot)
assertCondition(uninstall.exitCode === 0, `NSIS uninstall failed: ${tail(uninstall.stderr || uninstall.stdout)}`)
await waitFor('install root removal', async () => {
  try {
    await stat(installRoot)
    return null
  } catch {
    return true
  }
}, 30_000)
const tasklist = await runCommand('tasklist.exe', ['/fo', 'csv', '/nh'], repositoryRoot)
assertCondition(!tasklist.stdout.toLowerCase().includes('advx live.exe'), 'Electron orphan remains after uninstall')
assertCondition(!tasklist.stdout.toLowerCase().includes('advx-backend-bun.exe'), 'Bun backend orphan remains after uninstall')

const packageHash = await fileIdentity(installerPath, 'installer/ADVX Live Setup 0.1.0.exe')
const applicationHash = await fileIdentity(unpackedExecutable, 'package/win-unpacked/ADVX Live.exe')
const backendExecutable = join(unpackedRoot, 'resources', 'backend', 'advx-backend-bun.exe')
const backendHash = await fileIdentity(backendExecutable, 'package/resources/backend/advx-backend-bun.exe')
const result = {
  schemaVersion: 1,
  taskId: 'PKG-010',
  status: 'passed',
  target: { platform: process.platform, arch: process.arch, osBuild: process.env.OS ?? null },
  install: { installerPath, installRoot, installedExecutable, exitCode: install.exitCode, uninstalled: true, userDataRetainedOutsideInstallRoot: userDataPath.startsWith(artifactRoot) },
  hashes: { installer: packageHash, application: applicationHash, backend: backendHash },
  handshake: pipeline.handshake,
  session: pipeline.session,
  overlay: pipeline.overlay,
  diagnostics: { input: diagnosticsInputPath, manifest: manifestPath, manifestSha256: createHash('sha256').update(await readFile(manifestPath)).digest('hex') },
  restart,
  orphanAudit: { tasklistChecked: true, electronOrphan: false, backendOrphan: false },
  artifacts: { runtimeRoot, userData: userDataPath, appLog: join(runtimeRoot, 'app.log') }
}
await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
