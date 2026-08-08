import { randomBytes } from 'node:crypto'
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, relative, resolve } from 'node:path'

import { SpawnedBackendProcess } from '../apps/desktop/src/main/backend/backend-process.ts'
import {
  createBunCompiledBackendProcessOptions,
  resolveCompiledBunExecutable
} from '../apps/desktop/src/main/backend/backend-process-bun-compiled.ts'
import type { BackendProcessLogger } from '../apps/desktop/src/main/backend/backend-supervisor.ts'
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
const executableName = process.platform === 'win32' ? 'advx-backend-bun.exe' : 'advx-backend-bun'

const args = parseNamedArguments(Bun.argv.slice(2), new Set(['--artifact-root']))
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ?? join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'pkg-004'),
  repositoryRoot
)
const builderOutput = join(artifactRoot, 'electron-unpacked')
const unpackedAppRoot = join(builderOutput, process.platform === 'win32' ? 'win-unpacked' : 'linux-unpacked')
const resourcesRoot = join(unpackedAppRoot, 'resources')
const resourcesBackendRoot = join(resourcesRoot, 'backend')
const packagedExecutable = join(resourcesBackendRoot, executableName)
const hostileCwd = join(artifactRoot, 'hostile-cwd')
const dataDirectory = join(artifactRoot, 'runtime-data')

type JsonRecord = Record<string, unknown>

const logger: BackendProcessLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
}

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
  return {
    exitCode,
    stdout: await stdoutPromise,
    stderr: await stderrPromise
  }
}

async function resourceSnapshot(root: string): Promise<readonly JsonRecord[]> {
  const entries: JsonRecord[] = []
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
      } else {
        entries.push(await fileIdentity(path, relative(root, path).replaceAll('\\', '/')))
      }
    }
  }
  await visit(root)
  return entries
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

async function authorizedFetch(
  port: number,
  token: string,
  path: string
): Promise<Readonly<{ status: number; body: JsonRecord }>> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-advx-protocol-version': '3'
    }
  })
  return {
    status: response.status,
    body: JSON.parse(await response.text()) as JsonRecord
  }
}

await rm(artifactRoot, { recursive: true, force: true })
await mkdir(hostileCwd, { recursive: true })
await writeFile(join(hostileCwd, '.env'), 'ADVX_DATA_DIR=C:/pkg-004-poisoned-data\nADVX_BACKEND_PORT=1\n')
await writeFile(join(hostileCwd, 'bunfig.toml'), 'preload = ["./poison-preload.ts"]\n')
await writeFile(join(hostileCwd, 'poison-preload.ts'), "await Bun.write('./BUNFIG_POISON_MARKER.txt', 'autoloaded')\n")
await writeFile(join(hostileCwd, 'package.json'), '{"name":"pkg-004-hostile-package"}\n')

const [builderConfigText, packageText, desktopPackageText] = await Promise.all([
  readFile(electronBuilderConfig, 'utf8'),
  readFile(join(repositoryRoot, 'package.json'), 'utf8'),
  readFile(join(desktopRoot, 'package.json'), 'utf8')
])
const rootPackage = JSON.parse(packageText) as JsonRecord
const desktopPackage = JSON.parse(desktopPackageText) as JsonRecord
const scripts = rootPackage.scripts as JsonRecord
const desktopScripts = desktopPackage.scripts as JsonRecord
assertCondition(builderConfigText.includes('from: ../backend-bun/dist'), 'electron-builder source does not point at Bun dist')
assertCondition(builderConfigText.includes('to: backend'), 'electron-builder destination is not resources/backend')
assertCondition(builderConfigText.includes('      - advx-backend-bun*'), 'electron-builder filter does not restrict backend executable')
assertCondition(scripts['package:desktop'] === 'pnpm build:bun-backend && pnpm --filter @advx/desktop build && pnpm --filter @advx/desktop exec electron-builder --win --x64 --dir', 'package:desktop sequence is missing')
assertCondition(desktopScripts.build === 'electron-vite build', 'desktop build entrypoint changed unexpectedly')

const backendBuild = await runCommand(process.execPath, [
  buildScript,
  '--output-root',
  backendDist,
  '--run-id',
  'pkg-004-backend-build'
], repositoryRoot)
assertCondition(backendBuild.exitCode === 0, `Bun backend compile failed: ${tail(backendBuild.stderr || backendBuild.stdout)}`)

const desktopBuild = await runCommand(process.env.npm_node_execpath ?? 'node', [electronViteCli, 'build'], desktopRoot)
assertCondition(desktopBuild.exitCode === 0, `Electron Vite build failed: ${tail(desktopBuild.stderr || desktopBuild.stdout)}`)

await rm(builderOutput, { recursive: true, force: true })
const builder = await runCommand(process.env.npm_node_execpath ?? 'node', [
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
assertCondition(builder.exitCode === 0, `electron-builder unpacked build failed: ${tail(builder.stderr || builder.stdout)}`)

const sourceExecutable = join(backendDist, executableName)
const sourceManifestPath = join(backendDist, 'backend-manifest.json')
const sourceManifest = JSON.parse(await readFile(sourceManifestPath, 'utf8')) as JsonRecord
const sourceOutput = sourceManifest.output as JsonRecord
const sourceIdentity = await fileIdentity(sourceExecutable, `apps/backend-bun/dist/${executableName}`)
assertCondition(sourceIdentity.bytes === sourceOutput.bytes && sourceIdentity.sha256 === sourceOutput.sha256, 'compile manifest does not match source executable')
const packagedIdentity = await fileIdentity(packagedExecutable, `resources/backend/${executableName}`)
assertCondition(packagedIdentity.bytes === sourceIdentity.bytes && packagedIdentity.sha256 === sourceIdentity.sha256, 'electron-builder changed backend executable bytes')

const backendEntries = (await readdir(resourcesBackendRoot, { withFileTypes: true })).map((entry) => entry.name).sort()
assertCondition(JSON.stringify(backendEntries) === JSON.stringify([executableName]), `unexpected resources/backend entries: ${backendEntries.join(', ')}`)
assertCondition(!(await Bun.file(join(resourcesBackendRoot, 'backend-manifest.json')).exists()), 'build manifest leaked into packaged resources')
assertCondition(!(await Bun.file(join(resourcesBackendRoot, 'main.js.map')).exists()), 'source map leaked into packaged resources')

let missingExecutableError = ''
try {
  resolveCompiledBunExecutable({
    packaged: true,
    resourcesPath: resourcesRoot,
    repositoryRoot,
    backendExecutable: join(resourcesBackendRoot, `missing-${executableName}`)
  })
} catch (error) {
  missingExecutableError = error instanceof Error ? error.message : String(error)
}
assertCondition(missingExecutableError.includes('compiled_backend_missing'), 'missing packaged executable did not fail explicitly')

const beforeResources = await resourceSnapshot(resourcesRoot)
const port = await availablePort()
const token = randomBytes(32).toString('base64url')
const options = createBunCompiledBackendProcessOptions({
  packaged: true,
  resourcesPath: resourcesRoot,
  repositoryRoot,
  workingDirectory: hostileCwd,
  backendPort: String(port),
  backendBaseUrl: `http://127.0.0.1:${port}`,
  dataDirectory,
  startupToken: token,
  parentEnvironment: {
    ...process.env,
    BUN_BE_BUN: '1',
    ADVX_DATA_DIR: 'C:/pkg-004-poisoned-data',
    OPENAI_API_KEY: 'pkg-004-poison-provider-secret'
  },
  identity: {
    version: 'pkg-004',
    port,
    token,
    dataDirectory,
    logLocation: join(dataDirectory, 'logs')
  },
  logger
})
assertCondition(options.command === packagedExecutable, 'packaged resolver did not select extraResources executable')
assertCondition(options.env.BUN_BE_BUN === undefined && options.env.OPENAI_API_KEY === undefined, 'supervisor environment scrub failed')

const controller = new SpawnedBackendProcess(options)
let health: Readonly<{ status: number; body: JsonRecord }>
let ready: Readonly<{ status: number; body: JsonRecord }>
let version: Readonly<{ status: number; body: JsonRecord }>
let debug: Readonly<{ status: number; body: JsonRecord }>
try {
  await controller.start()
  health = await authorizedFetch(port, token, '/health')
  ready = await authorizedFetch(port, token, '/ready')
  version = await authorizedFetch(port, token, '/version')
  debug = await authorizedFetch(port, token, '/debug/snapshot?limit=1')
  assertCondition(health.status === 200 && health.body.status === 'ok', 'unpacked packaged health failed')
  const readyChecks = ready.body.checks as JsonRecord
  assertCondition(ready.status === 200 && ready.body.status === 'ready' && readyChecks.database === true, 'unpacked packaged readiness failed')
  const backendPackage = JSON.parse(await readFile(join(repositoryRoot, 'apps/backend-bun/package.json'), 'utf8')) as Readonly<{ name: string; version: string }>
  assertCondition(version.status === 200 && version.body.backend_version === backendPackage.version, 'packaged version handshake failed')
  assertCondition(version.body.build_id === `${backendPackage.name}@${backendPackage.version}+source`, 'packaged build identity handshake failed')
  const database = debug.body.database as JsonRecord
  assertCondition(debug.status === 200 && database.schema_version === 6 && database.quickCheck === 'ok', `packaged debug contract failed: ${JSON.stringify(debug.body)}`)
} finally {
  await controller.dispose()
}

const afterResources = await resourceSnapshot(resourcesRoot)
const resourceTreeUnchanged = JSON.stringify(beforeResources) === JSON.stringify(afterResources)
const hostileFiles = (await readdir(hostileCwd)).sort()
const dataFiles = (await readdir(dataDirectory)).sort()
const cleanlyDisposed = controller.status().state === 'disposed'
assertCondition(resourceTreeUnchanged, 'packaged resource tree changed during supervised runtime')
assertCondition(cleanlyDisposed, 'packaged backend did not dispose cleanly')
assertCondition(!hostileFiles.includes('BUNFIG_POISON_MARKER.txt'), 'hostile working-directory preload executed')
assertCondition(dataFiles.includes('advx.sqlite3') && dataFiles.includes('logs'), 'runtime data did not leave resources')

const result = {
  schemaVersion: 1,
  taskId: 'PKG-004',
  status: 'passed',
  target: { platform: process.platform, arch: process.arch, electronBuilder: JSON.parse(await readFile(join(desktopRoot, 'node_modules/electron-builder/package.json'), 'utf8')).version },
  config: {
    source: 'apps/backend-bun/dist',
    destination: 'resources/backend',
    filter: `advx-backend-bun*`,
    output: builderOutput
  },
  backend: {
    source: sourceIdentity,
    packaged: packagedIdentity,
    resourceEntries: backendEntries,
    missingExecutableError,
    sourceManifest: sourceOutput
  },
  packagedSmoke: {
    resourcesRoot,
    healthStatus: health.status,
    readinessStatus: ready.status,
    versionStatus: version.status,
    debugStatus: debug.status,
    databaseSchemaVersion: (debug.body.database as JsonRecord).schema_version,
    resourceTreeUnchanged,
    hostileFiles,
    dataFiles,
    cleanlyDisposed
  },
  runtime: { bun: Bun.version, platform: process.platform, arch: process.arch }
} as const
await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
