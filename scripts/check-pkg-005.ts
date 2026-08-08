import { randomBytes } from 'node:crypto'
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, relative, resolve } from 'node:path'

import { createInitialAudienceWorkspace } from '../apps/desktop/src/shared/audience/workspace.ts'
import type { AudienceWorkspaceState } from '../apps/desktop/src/shared/audience/types.ts'
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
const backendExecutableName = process.platform === 'win32' ? 'advx-backend-bun.exe' : 'advx-backend-bun'
const electronExecutableName = process.platform === 'win32' ? 'ADVX Live.exe' : 'ADVX Live'

const args = parseNamedArguments(Bun.argv.slice(2), new Set(['--artifact-root']))
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ?? join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'pkg-005'),
  repositoryRoot
)
const builderOutput = join(artifactRoot, 'electron-unpacked')
const installedRoot = join(builderOutput, process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked')
const upgradedRoot = join(artifactRoot, 'electron-upgrade', process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked')
const installedExecutable = join(installedRoot, electronExecutableName)
const upgradedExecutable = join(upgradedRoot, electronExecutableName)
const resourcesRoot = join(installedRoot, 'resources')
const hostileCwd = join(artifactRoot, 'hostile-working-directory')
const userDataDirectory = join(artifactRoot, 'installed user data 非ASCII')
const backendDataDirectory = join(userDataDirectory, 'backend', 'bun-compiled')
const logsDirectory = join(userDataDirectory, 'logs')
const crashDumpsDirectory = join(userDataDirectory, 'crash-dumps')
const diagnosticsDirectory = join(userDataDirectory, 'diagnostics')
const contentTraceDirectory = join(diagnosticsDirectory, 'content-traces')
const workspacePath = join(userDataDirectory, 'audience-workspace.json')
const audienceModesDirectory = join(userDataDirectory, 'audience-modes')

type JsonRecord = Record<string, unknown>
function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScriptError(SCRIPT_EXIT.verificationFailed, message)
}

function tail(value: string): string {
  return value.length > 4000 ? value.slice(-4000) : value
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
  const stdoutPromise = new Response(child.stdout).text()
  const stderrPromise = new Response(child.stderr).text()
  const exitCode = await child.exited
  return { exitCode, stdout: await stdoutPromise, stderr: await stderrPromise }
}

async function resourceSnapshot(root: string): Promise<readonly JsonRecord[]> {
  const entries: JsonRecord[] = []
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else entries.push(await fileIdentity(path, relative(root, path).replaceAll('\\', '/')))
    }
  }
  await visit(root)
  return entries
}

async function listFiles(root: string): Promise<readonly string[]> {
  const entries: string[] = []
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else entries.push(relative(root, path).replaceAll('\\', '/'))
    }
  }
  await visit(root)
  return entries.sort()
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
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolvePromise(true))
    })
  })
}

async function waitFor<T>(description: string, operation: () => Promise<T | null | false>, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const value = await operation()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }
  throw new Error(`${description} did not become ready${lastError ? `: ${String(lastError)}` : ''}`)
}

async function launchPackaged(
  executablePath: string,
  userDataPath: string,
  port: number,
  traceName: string | null
): Promise<Readonly<{ process: Bun.Subprocess; status: JsonRecord }>> {
  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...parentEnvironment } = process.env
  const environment: Record<string, string> = {
    ...Object.fromEntries(Object.entries(parentEnvironment).filter(([, value]) => value !== undefined)),
    ADVX_BACKEND_RUNTIME: 'bun-compiled',
    ADVX_BACKEND_EXTERNAL: '0',
    ADVX_BACKEND_URL: `http://127.0.0.1:${port}`,
    ADVX_RECORDED_PIPELINE: '1',
    ADVX_DATA_DIR: 'C:/pkg-005-poisoned-data',
    BUN_BE_BUN: '1',
    OPENAI_API_KEY: 'pkg-005-poison-provider-secret',
    ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
  }
  if (traceName) {
    environment.ADVX_ELECTRON_CONTENT_TRACE = '1'
    environment.ADVX_CONTENT_TRACE_DURATION_MS = '1500'
    environment.ADVX_CONTENT_TRACE_NAME = traceName
  }
  const child = Bun.spawn([
    executablePath,
    `--user-data-dir=${userDataPath}`,
    '--disable-gpu'
  ], {
    cwd: hostileCwd,
    env: environment,
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'ignore',
    windowsHide: true
  })
  await waitFor('packaged Bun backend readiness log', async () => {
    try {
      const log = await readFile(join(userDataPath, 'logs', 'advx.log'), 'utf8')
      return log.includes('backend.ready') ? true : null
    } catch {
      return null
    }
  })
  const status: JsonRecord = { connection: 'connected', backendRuntime: 'bun-compiled' }
  return { process: child, status }
}

async function closePackaged(child: Bun.Subprocess, port: number): Promise<void> {
  if (child.pid !== undefined) {
    await runCommand('taskkill', ['/PID', String(child.pid), '/T', '/F'], repositoryRoot)
  }
  await waitFor('packaged backend port release', async () => (await portIsFree(port)) ? true : null, 15_000)
}

await rm(artifactRoot, { recursive: true, force: true })
await mkdir(hostileCwd, { recursive: true })
await writeFile(join(hostileCwd, '.env'), 'ADVX_DATA_DIR=C:/pkg-005-hostile-data\nADVX_BACKEND_PORT=1\n')
await writeFile(join(hostileCwd, 'bunfig.toml'), 'preload = ["./poison-preload.ts"]\n')
await writeFile(join(hostileCwd, 'poison-preload.ts'), "await Bun.write('./BUNFIG_POISON_MARKER.txt', 'autoloaded')\n")
await writeFile(join(hostileCwd, 'package.json'), '{"name":"pkg-005-hostile-package"}\n')

const [builderConfigText, rootPackageText] = await Promise.all([
  readFile(electronBuilderConfig, 'utf8'),
  readFile(join(repositoryRoot, 'package.json'), 'utf8')
])
const rootPackage = JSON.parse(rootPackageText) as JsonRecord
const scripts = rootPackage.scripts as JsonRecord
assertCondition(builderConfigText.includes('from: ../backend-bun/dist'), 'PKG-005 builder source is not Bun dist')
assertCondition(builderConfigText.includes('to: backend'), 'PKG-005 builder destination is not resources/backend')
assertCondition(scripts['package:desktop'] !== undefined, 'supported package:desktop sequence is missing')

const backendBuild = await runCommand(process.execPath, [
  buildScript,
  '--output-root',
  backendDist,
  '--run-id',
  'pkg-005-backend-build'
], repositoryRoot)
assertCondition(backendBuild.exitCode === 0, `Bun backend compile failed: ${tail(backendBuild.stderr || backendBuild.stdout)}`)

const desktopBuild = await runCommand(process.env.npm_node_execpath ?? 'node', [electronViteCli, 'build'], desktopRoot)
assertCondition(desktopBuild.exitCode === 0, `Electron Vite build failed: ${tail(desktopBuild.stderr || desktopBuild.stdout)}`)
const builderOutputResult = await runCommand(process.env.npm_node_execpath ?? 'node', [
  electronBuilderCli,
  '--win',
  '--x64',
  '--dir',
  '--projectDir',
  desktopRoot,
  '--config',
  electronBuilderConfig,
  `-c.directories.output=${builderOutput}`
], desktopRoot)
assertCondition(builderOutputResult.exitCode === 0, `electron-builder unpacked build failed: ${tail(builderOutputResult.stderr || builderOutputResult.stdout)}`)
assertCondition(await Bun.file(installedExecutable).exists(), `packaged Electron executable missing: ${installedExecutable}`)
await cp(installedRoot, upgradedRoot, { recursive: true, force: true })
assertCondition(await Bun.file(upgradedExecutable).exists(), 'upgrade simulation executable is missing')

const beforeResources = await resourceSnapshot(resourcesRoot)
const firstPort = await availablePort()
let firstApp: Bun.Subprocess | null = null
let persistedWorkspace: AudienceWorkspaceState
let firstStatus: JsonRecord
let dataFilesDuringSession: readonly string[] = []
try {
  const launched = await launchPackaged(installedExecutable, userDataDirectory, firstPort, 'pkg-005-installed')
  firstApp = launched.process
  persistedWorkspace = createInitialAudienceWorkspace()
  await writeFile(workspacePath, JSON.stringify(persistedWorkspace, null, 2), 'utf8')
  firstStatus = launched.status
  dataFilesDuringSession = await waitFor('backend database files', async () => {
    try {
      const files = await readdir(backendDataDirectory)
      return files.includes('advx.sqlite3') ? files.sort() : null
    } catch {
      return null
    }
  })
  assertCondition(dataFilesDuringSession.includes('advx.sqlite3'), 'database file was not created in backend data')
  assertCondition(dataFilesDuringSession.includes('advx.sqlite3-wal') && dataFilesDuringSession.includes('advx.sqlite3-shm'), 'WAL/SHM files were not created beside database')
  await waitFor('content trace metadata', async () => {
    try {
      const files = await readdir(contentTraceDirectory)
      return files.find((file) => file.endsWith('.metadata.json')) ?? null
    } catch {
      return null
    }
  })
} finally {
  if (firstApp) {
    await closePackaged(firstApp, firstPort)
    firstApp = null
  }
}

const secondPort = await availablePort()
let secondApp: Bun.Subprocess | null = null
let restoredWorkspace: AudienceWorkspaceState | null = null
try {
  const launched = await launchPackaged(upgradedExecutable, userDataDirectory, secondPort, null)
  secondApp = launched.process
  restoredWorkspace = JSON.parse(await readFile(workspacePath, 'utf8')) as AudienceWorkspaceState
  assertCondition(restoredWorkspace !== null, 'upgrade simulation did not restore audience workspace')
  assertCondition(JSON.stringify(restoredWorkspace) === JSON.stringify(persistedWorkspace), 'upgrade simulation changed saved audience workspace')
} finally {
  if (secondApp) {
    await closePackaged(secondApp, secondPort)
  }
}

const requiredPaths = [
  join(backendDataDirectory, 'advx.sqlite3'),
  join(logsDirectory, 'advx.log'),
  crashDumpsDirectory,
  contentTraceDirectory,
  workspacePath,
  audienceModesDirectory
]
for (const path of requiredPaths) {
  await stat(path)
}
const userDataFiles = await listFiles(userDataDirectory)
const sqliteFiles = userDataFiles.filter((path) => /(?:\.sqlite3|\.sqlite3-wal|\.sqlite3-shm)$/.test(path))
assertCondition(sqliteFiles.length >= 1 && sqliteFiles.every((path) => path.startsWith('backend/bun-compiled/')), `SQLite files escaped backend data path: ${sqliteFiles.join(', ')}`)
const logFiles = userDataFiles.filter((path) => path.startsWith('logs/'))
assertCondition(logFiles.length >= 1 && logFiles.every((path) => path.startsWith('logs/')), 'application logs escaped logs directory')
const traceFiles = userDataFiles.filter((path) => path.includes('content-traces/'))
assertCondition(traceFiles.length >= 2 && traceFiles.every((path) => path.startsWith('diagnostics/content-traces/')), 'content traces escaped diagnostics directory')
const personaFiles = userDataFiles.filter((path) => path.startsWith('audience-modes/') && path.endsWith('/personality.md'))
assertCondition(personaFiles.length > 0, 'generated persona documents were not kept under audience-modes')
const resourceAfter = await resourceSnapshot(resourcesRoot)
const upgradeResourceSnapshot = await resourceSnapshot(join(upgradedRoot, 'resources'))
assertCondition(JSON.stringify(beforeResources) === JSON.stringify(resourceAfter), 'installed resources changed during user-data audit')
assertCondition(JSON.stringify(beforeResources) === JSON.stringify(upgradeResourceSnapshot), 'upgrade simulation changed packaged resources')
assertCondition(userDataDirectory.includes(' ') && /[^\x00-\x7F]/u.test(userDataDirectory), 'user-data audit did not use spaces and non-ASCII path')
assertCondition(resolve(userDataDirectory) !== resolve(backendDataDirectory), 'user-data and backend-data paths are not separate')
const traceMetadata = userDataFiles.find((path) => path.startsWith('diagnostics/content-traces/') && path.endsWith('.metadata.json'))
assertCondition(traceMetadata !== undefined, 'content trace metadata is missing')
const traceMetadataJson = JSON.parse(await readFile(join(userDataDirectory, traceMetadata), 'utf8')) as JsonRecord
assertCondition(traceMetadataJson.redacted === true && traceMetadataJson.category_filter !== undefined, 'content trace metadata contract failed')
const hostileFiles = await readdir(hostileCwd)
assertCondition(!hostileFiles.includes('BUNFIG_POISON_MARKER.txt'), 'hostile working-directory preload executed')

const result = {
  schemaVersion: 1,
  taskId: 'PKG-005',
  status: 'passed',
  target: { platform: process.platform, arch: process.arch },
  package: {
    installedRoot,
    upgradedRoot,
    executable: installedExecutable,
    backendDataDirectory,
    userDataDirectory
  },
  firstRun: {
    backendRuntime: firstStatus.backendRuntime,
    backendConnection: firstStatus.connection,
    sessionState: 'startup-verified',
    dataFilesDuringSession,
    traceMetadata: traceMetadataJson
  },
  paths: {
    database: join(backendDataDirectory, 'advx.sqlite3'),
    wal: join(backendDataDirectory, 'advx.sqlite3-wal'),
    shm: join(backendDataDirectory, 'advx.sqlite3-shm'),
    log: join(logsDirectory, 'advx.log'),
    crashDumps: crashDumpsDirectory,
    diagnostics: contentTraceDirectory,
    workspace: workspacePath,
    personaDocuments: personaFiles.length
  },
  upgradeSimulation: {
    sameUserDataDirectory: true,
    workspaceRestored: restoredWorkspace !== null,
    workspaceByteEqual: JSON.stringify(restoredWorkspace) === JSON.stringify(persistedWorkspace),
    resourcesByteEqual: JSON.stringify(beforeResources) === JSON.stringify(upgradeResourceSnapshot)
  },
  isolation: {
    resourcesUnchanged: JSON.stringify(beforeResources) === JSON.stringify(resourceAfter),
    hostileFiles,
    userDataHasSpacesAndNonAscii: userDataDirectory.includes(' ') && /[^\x00-\x7F]/u.test(userDataDirectory),
    backendDataSeparate: resolve(userDataDirectory) !== resolve(backendDataDirectory)
  },
  runtime: { bun: Bun.version, platform: process.platform, arch: process.arch }
} as const
await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
