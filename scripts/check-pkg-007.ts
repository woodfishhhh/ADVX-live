import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'

import {
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
const fuseCli = join(desktopRoot, 'node_modules', '@electron', 'fuses', 'dist', 'bin.js')
const electronExecutableName = process.platform === 'win32' ? 'ADVX Live.exe' : 'ADVX Live'
const args = parseNamedArguments(Bun.argv.slice(2), new Set(['--artifact-root']))
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ?? join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'pkg-007'),
  repositoryRoot
)
const builderOutput = join(artifactRoot, 'electron-package')
const packageRoot = join(builderOutput, process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked')
const packagedExecutable = join(packageRoot, electronExecutableName)
const resourcesRoot = join(packageRoot, 'resources')
const asarPath = join(resourcesRoot, 'app.asar')
const backendExecutable = join(resourcesRoot, 'backend', process.platform === 'win32' ? 'advx-backend-bun.exe' : 'advx-backend-bun')
const hostileCwd = join(artifactRoot, 'hostile-working-directory')

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

async function waitForExit(process: Bun.Subprocess, description: string, timeoutMs = 15_000): Promise<number> {
  const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${description} timed out`)), timeoutMs))
  return await Promise.race([process.exited, timeout])
}

async function taskkill(pid: number | null): Promise<void> {
  if (!pid) return
  await runCommand('taskkill.exe', ['/PID', String(pid), '/T', '/F'], repositoryRoot)
}

async function readLog(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return ''
  }
}

function fuseExpectation(output: string, name: string, state: 'Enabled' | 'Disabled'): boolean {
  return new RegExp(`${name} is ${state}`, 'i').test(output)
}

async function copyAndFlipLoadedAsarEntry(source: string, destination: string): Promise<void> {
  const bytes = new Uint8Array(await Bun.file(source).arrayBuffer())
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const headerSize = view.getUint32(4, true)
  const jsonSize = view.getUint32(12, true)
  const header = JSON.parse(new TextDecoder().decode(bytes.slice(16, 16 + jsonSize))) as {
    files: { out: { files: { main: { files: { 'index.js': { offset: string; size: number } } } } } }
  }
  const entry = header.files.out.files.main.files['index.js']
  const dataStart = 8 + headerSize
  const index = dataStart + Number(entry.offset) + Math.floor(entry.size / 2)
  assertCondition(index > 0 && index < bytes.length, 'main ASAR entry offset is outside the archive')
  bytes[index] ^= 0x01
  await Bun.write(destination, bytes)
}

async function launchProbe(
  executable: string,
  label: string,
  expectBackendReady: boolean
): Promise<Readonly<{ readonly process: Bun.Subprocess; readonly logPath: string; readonly port: number; readonly userData: string }>> {
  const userData = join(artifactRoot, `probe-${label}-user-data`)
  const logPath = join(userData, 'logs', 'advx.log')
  const port = await availablePort()
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...parentEnvironment } = process.env
  const environment: Record<string, string> = {
    ...Object.fromEntries(Object.entries(parentEnvironment).filter(([, value]) => value !== undefined)),
    ADVX_BACKEND_RUNTIME: 'bun-compiled',
    ADVX_BACKEND_EXTERNAL: '0',
    ADVX_BACKEND_URL: `http://127.0.0.1:${port}`,
    ADVX_RECORDED_PIPELINE: '1',
    ADVX_DATA_DIR: 'C:/pkg-007-poisoned-data',
    BUN_BE_BUN: '1',
    OPENAI_API_KEY: 'pkg-007-poison-provider-secret',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  }
  const child = Bun.spawn([executable, `--user-data-dir=${userData}`, '--disable-gpu'], {
    cwd: hostileCwd,
    env: environment,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
    windowsHide: true
  })
  if (expectBackendReady) {
    await waitFor('hardened packaged startup', async () => {
      const text = await readLog(logPath)
      return text.includes('backend.ready') ? true : null
    })
  }
  return { process: child, logPath, port, userData }
}

async function stopProbe(probe: Readonly<{ readonly process: Bun.Subprocess; readonly port: number }>): Promise<void> {
  await taskkill(probe.process.pid ?? null)
  await waitForExit(probe.process, 'probe process exit').catch(() => undefined)
  await waitFor('probe port release', async () => {
    const server = createServer()
    return await new Promise<boolean>((resolvePromise) => {
      server.once('error', () => resolvePromise(false))
      server.listen(probe.port, '127.0.0.1', () => server.close(() => resolvePromise(true)))
    })
  })
}

await rm(artifactRoot, { recursive: true, force: true })
await mkdir(hostileCwd, { recursive: true })
await writeFile(join(hostileCwd, '.env'), 'ADVX_DATA_DIR=C:/pkg-007-hostile-data\nADVX_BACKEND_PORT=1\n')
await writeFile(join(hostileCwd, 'bunfig.toml'), 'preload = ["./poison-preload.ts"]\n')
await writeFile(join(hostileCwd, 'poison-preload.ts'), "await Bun.write('./BUNFIG_POISON_MARKER.txt', 'autoloaded')\n")

assertCondition(process.platform === 'win32' && process.arch === 'x64', 'PKG-007 requires Windows x64 evidence')
assertCondition(await Bun.file(join(desktopRoot, 'node_modules', '@electron', 'fuses', 'dist', 'bin.js')).exists(), 'electron-fuses CLI is unavailable')

const [builderConfigText, controlWindowText, preloadText] = await Promise.all([
  readFile(electronBuilderConfig, 'utf8'),
  readFile(join(desktopRoot, 'src', 'main', 'windows', 'control.ts'), 'utf8'),
  readFile(join(desktopRoot, 'src', 'preload', 'control.ts'), 'utf8')
])
assertCondition(builderConfigText.includes('electronFuses:'), 'electron-builder fuses configuration is missing')
for (const token of ['runAsNode: false', 'enableNodeOptionsEnvironmentVariable: false', 'enableNodeCliInspectArguments: false', 'enableEmbeddedAsarIntegrityValidation: true', 'onlyLoadAppFromAsar: true']) {
  assertCondition(builderConfigText.includes(token), `missing fuse configuration: ${token}`)
}
for (const token of ['contextIsolation: true', 'sandbox: true', 'nodeIntegration: false']) {
  assertCondition(controlWindowText.includes(token), `control window security setting missing: ${token}`)
}
assertCondition(preloadText.includes('contextBridge') && preloadText.includes('ipcRenderer'), 'preload IPC bridge is missing')

const backendBuild = await runCommand(process.execPath, [buildScript, '--output-root', backendDist, '--run-id', 'pkg-007-backend-build'], repositoryRoot)
assertCondition(backendBuild.exitCode === 0, `Bun backend compile failed: ${tail(backendBuild.stderr || backendBuild.stdout)}`)
const desktopBuild = await runCommand(process.env.npm_node_execpath ?? 'node', [electronViteCli, 'build'], desktopRoot)
assertCondition(desktopBuild.exitCode === 0, `Electron Vite build failed: ${tail(desktopBuild.stderr || desktopBuild.stdout)}`)
const packageBuild = await runCommand(process.env.npm_node_execpath ?? 'node', [
  electronBuilderCli,
  '--win',
  '--x64',
  '--dir',
  '--projectDir',
  desktopRoot,
  '--config',
  electronBuilderConfig,
  `--config.directories.output=${builderOutput}`
], desktopRoot)
assertCondition(packageBuild.exitCode === 0, `hardened electron package failed: ${tail(packageBuild.stderr || packageBuild.stdout)}`)
assertCondition(await Bun.file(packagedExecutable).exists(), `packaged executable missing: ${packagedExecutable}`)
assertCondition(await Bun.file(asarPath).exists(), `app.asar missing: ${asarPath}`)
assertCondition(await Bun.file(backendExecutable).exists(), `packaged backend resource missing: ${backendExecutable}`)

const fuseRead = await runCommand(process.env.npm_node_execpath ?? 'node', [fuseCli, 'read', '--app', packagedExecutable], repositoryRoot)
assertCondition(fuseRead.exitCode === 0, `fuse read failed: ${tail(fuseRead.stderr || fuseRead.stdout)}`)
const fuseOutput = fuseRead.stdout
for (const [name, state] of [
  ['RunAsNode', 'Disabled'],
  ['EnableCookieEncryption', 'Enabled'],
  ['EnableNodeOptionsEnvironmentVariable', 'Disabled'],
  ['EnableNodeCliInspectArguments', 'Disabled'],
  ['EnableEmbeddedAsarIntegrityValidation', 'Enabled'],
  ['OnlyLoadAppFromAsar', 'Enabled']
] as const) {
  assertCondition(fuseExpectation(fuseOutput, name, state), `packaged fuse mismatch: ${name} ${state}`)
}

const cleanProbe = await launchProbe(packagedExecutable, 'clean', true)
const cleanLog = await readLog(cleanProbe.logPath)
assertCondition(cleanLog.includes('window.control.opened'), 'hardened package control window did not open')
assertCondition(cleanLog.includes('backend.ready'), 'hardened package backend did not become ready')
await stopProbe(cleanProbe)

const tamperedAsarRoot = join(artifactRoot, 'tampered-asar')
await cp(packageRoot, tamperedAsarRoot, { recursive: true, force: true })
await copyAndFlipLoadedAsarEntry(asarPath, join(tamperedAsarRoot, 'resources', 'app.asar'))
const tamperedAsar = await launchProbe(join(tamperedAsarRoot, electronExecutableName), 'tampered-asar', false)
const tamperedAsarExit = await Promise.race([
  tamperedAsar.process.exited,
  new Promise<number>((resolvePromise) => setTimeout(() => resolvePromise(999), 15_000))
])
assertCondition(tamperedAsarExit !== 999, 'tampered app.asar stayed alive instead of failing closed')
assertCondition(tamperedAsarExit !== 0, `tampered app.asar exited successfully: ${tamperedAsarExit}`)
const tamperedAsarLog = await readLog(tamperedAsar.logPath)
await stopProbe(tamperedAsar)

const tamperedBackendRoot = join(artifactRoot, 'tampered-backend')
await cp(packageRoot, tamperedBackendRoot, { recursive: true, force: true })
const tamperedBackendBytes = new Uint8Array(await Bun.file(backendExecutable).arrayBuffer())
tamperedBackendBytes[0] = tamperedBackendBytes[0] === 0x4d ? 0x00 : 0x4d
await Bun.write(join(tamperedBackendRoot, 'resources', 'backend', process.platform === 'win32' ? 'advx-backend-bun.exe' : 'advx-backend-bun'), tamperedBackendBytes)
const tamperedBackend = await launchProbe(join(tamperedBackendRoot, electronExecutableName), 'tampered-backend', false)
await waitFor('tampered backend failure', async () => {
  const text = await readLog(tamperedBackend.logPath)
  if (text.includes('backend.ready')) throw new Error('tampered backend artifact reached readiness')
  return text.includes('backend.spawn.failed') || text.includes('backend.start.failed') ||
    text.includes('backend.exit.unexpected') || text.includes('Failed to initialize ADVX Live') ||
    text.includes('compiled_backend_invalid_format') ? true : null
}, 15_000)
const tamperedBackendLog = await readLog(tamperedBackend.logPath)
assertCondition(!tamperedBackendLog.includes('backend.ready'), 'tampered backend artifact reached readiness')
await stopProbe(tamperedBackend)

const markerExists = await Bun.file(join(hostileCwd, 'BUNFIG_POISON_MARKER.txt')).exists()
assertCondition(!markerExists, 'hostile working-directory preload executed')
await stat(join(resourcesRoot, 'app.asar'))
await stat(join(resourcesRoot, 'backend'))

const result = {
  schemaVersion: 1,
  taskId: 'PKG-007',
  status: 'passed',
  target: { platform: process.platform, arch: process.arch },
  package: { packagedExecutable, asarPath, backendExecutable, fuseOutput: fuseOutput.trim() },
  fuses: {
    runAsNode: false,
    cookieEncryption: true,
    nodeOptions: false,
    nodeCliInspect: false,
    embeddedAsarIntegrity: true,
    onlyLoadAppFromAsar: true
  },
  runtime: {
    cleanLaunch: true,
    controlWindowOpened: true,
    backendReady: true,
    preloadIpcSourceReviewed: true,
    rendererNodeIsolationSourceReviewed: true,
    tamperedAsarRejected: !tamperedAsarLog.includes('backend.ready'),
    tamperedBackendRejected: !tamperedBackendLog.includes('backend.ready'),
    hostileCwdIgnored: !markerExists
  },
  runtimeVersion: { bun: Bun.version, platform: process.platform, arch: process.arch }
} as const
await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
