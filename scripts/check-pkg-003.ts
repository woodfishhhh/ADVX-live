import { randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm
} from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import { SpawnedBackendProcess } from '../apps/desktop/src/main/backend/backend-process.ts'
import {
  createBunCompiledBackendProcessOptions,
  resolveCompiledBunExecutable
} from '../apps/desktop/src/main/backend/backend-process-bun-compiled.ts'
import type { BackendProcessLogger } from '../apps/desktop/src/main/backend/backend-supervisor.ts'
import { ADVX_SQLITE_MIGRATIONS } from '../apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/index.ts'
import {
  fileIdentity,
  parseNamedArguments,
  requireSafeArtifactRoot,
  SCRIPT_EXIT,
  ScriptError,
  writeJsonAtomic
} from './evidence-script-runtime.ts'

const repositoryRoot = resolve(import.meta.dir, '..')
const args = parseNamedArguments(Bun.argv.slice(2), new Set(['--artifact-root']))
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ?? join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'pkg-003'),
  repositoryRoot
)
const buildRoot = join(artifactRoot, 'build')
const resourcesRoot = join(artifactRoot, 'packaged-resources')
const resourcesBackendRoot = join(resourcesRoot, 'backend')
const hostileCwd = join(artifactRoot, 'hostile-cwd')
const dataDirectory = join(artifactRoot, 'runtime-data')
const buildScript = join(repositoryRoot, 'scripts', 'build-bun-backend.ts')
const executableName = process.platform === 'win32' ? 'advx-backend-bun.exe' : 'advx-backend-bun'

const embeddedAssetPaths = [
  'apps/backend-bun/package.json',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/0001_room_session_runtime.sql',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/0002_session_viewer_instances.sql',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/0003_room_events.sql',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/0004_room_long_term_memories.sql',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/0005_mode_memes.sql',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/0006_durable_outbox.sql'
] as const

const testOnlyAssetPaths = [
  'apps/backend-bun/src/application/evaluation/fixtures/agent-eval-smoke.json',
  'apps/backend-bun/src/testing/fixtures/tst-006-negative-corpus.json',
  'apps/backend-bun/openapi/advx-control-plane.openapi.json'
] as const

type JsonRecord = Record<string, unknown>

const logger: BackendProcessLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScriptError(SCRIPT_EXIT.verificationFailed, message)
}

async function runBuild(): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const child = Bun.spawn([
    process.execPath,
    buildScript,
    '--output-root',
    buildRoot,
    '--run-id',
    'pkg-003-asset-build'
  ], {
    cwd: repositoryRoot,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true
  })
  const stdoutPromise = new Response(child.stdout).text()
  const stderrPromise = new Response(child.stderr).text()
  const exitCode = await child.exited
  const stdout = await stdoutPromise
  const stderr = await stderrPromise
  assertCondition(exitCode === 0, `Bun asset build failed: ${stderr || stdout}`)
  return { stdout, stderr }
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

async function resourceSnapshot(root: string): Promise<readonly JsonRecord[]> {
  const entries: JsonRecord[] = []
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
        continue
      }
      const identity = await fileIdentity(path, relative(root, path).replaceAll('\\', '/'))
      entries.push(identity)
    }
  }
  await visit(root)
  return entries
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
  const body = JSON.parse(await response.text()) as JsonRecord
  return { status: response.status, body }
}

await rm(artifactRoot, { recursive: true, force: true })
await mkdir(hostileCwd, { recursive: true })
await writeHostileFiles()

const [buildScriptText, migrationSource, mainSource, decisionText] = await Promise.all([
  readFile(buildScript, 'utf8'),
  readFile(join(repositoryRoot, 'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/index.ts'), 'utf8'),
  readFile(join(repositoryRoot, 'apps/backend-bun/src/main.ts'), 'utf8'),
  readFile(join(repositoryRoot, 'docs/migrations/typescript-bun/PKG-003-ASSET-DECISION.md'), 'utf8')
])
const packageText = await readFile(join(repositoryRoot, 'apps/backend-bun/package.json'), 'utf8')
const backendPackage = JSON.parse(packageText) as Readonly<{ name: string; version: string }>

assertCondition(buildScriptText.includes("/\\.(?:ts|tsx|json|sql)$/"), 'build source aggregate excludes SQL assets')
assertCondition(buildScriptText.includes("assetStrategy: 'embedded'"), 'build manifest does not lock embedded assets')
assertCondition(mainSource.includes("import backendPackage from '../package.json' with { type: 'json' }"), 'backend package identity is not statically embedded')
assertCondition(migrationSource.match(/with \{ type: 'text' \}/g)?.length === ADVX_SQLITE_MIGRATIONS.length, 'not every SQL migration uses a text import')
assertCondition(decisionText.includes('extraResources') && decisionText.includes('resources/backend'), 'PKG-003 asset decision is incomplete')

const assetIdentities = await Promise.all(
  embeddedAssetPaths.map((path) => fileIdentity(join(repositoryRoot, path), path))
)
const migrationIdentityByPath = new Map(
  ADVX_SQLITE_MIGRATIONS.map((migration) => [
    `apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/${migration.name}.sql`,
    migration.checksum
  ])
)
for (const asset of assetIdentities) {
  if (asset.path.endsWith('.sql')) {
    assertCondition(migrationIdentityByPath.get(asset.path) === asset.sha256, `migration checksum mismatch: ${asset.path}`)
  }
}
for (const path of testOnlyAssetPaths) {
  await fileIdentity(join(repositoryRoot, path), path)
  assertCondition(decisionText.includes(path), `test-only asset is missing from the inventory: ${path}`)
}

await runBuild()
const manifest = JSON.parse(await readFile(join(buildRoot, 'backend-manifest.json'), 'utf8')) as JsonRecord
const compile = manifest.compile as JsonRecord
const runtimeAssets = manifest.runtimeAssets as JsonRecord
const manifestEmbedded = compile.embeddedAssets as string[]
const manifestRuntimeAssets = runtimeAssets.assets as readonly JsonRecord[]
assertCondition(JSON.stringify(manifestEmbedded) === JSON.stringify([...embeddedAssetPaths]), 'compile manifest embedded asset list differs from the decision')
assertCondition(Array.isArray(compile.copiedAssets) && (compile.copiedAssets as unknown[]).length === 0, 'compile manifest contains copied runtime assets')
assertCondition(runtimeAssets.strategy === 'embedded' && Array.isArray(manifestRuntimeAssets), 'runtime asset manifest does not declare embedding')
assertCondition(manifestRuntimeAssets.length === assetIdentities.length, 'runtime asset identity count differs from source inventory')
for (const [index, identity] of assetIdentities.entries()) {
  const recorded = manifestRuntimeAssets[index]
  assertCondition(recorded?.path === identity.path && recorded.sha256 === identity.sha256 && recorded.bytes === identity.bytes, `asset hash mismatch in compile manifest: ${identity.path}`)
}

await mkdir(resourcesBackendRoot, { recursive: true })
const builtExecutable = join(buildRoot, executableName)
const packagedExecutable = join(resourcesBackendRoot, executableName)
await copyFile(builtExecutable, packagedExecutable)
await chmod(packagedExecutable, 0o555)
await chmod(resourcesBackendRoot, 0o555)
const beforeResources = await resourceSnapshot(resourcesRoot)

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
assertCondition(missingExecutableError.includes('compiled_backend_missing'), 'missing packaged executable did not produce an explicit error')

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
    ADVX_DATA_DIR: 'C:/pkg-003-poisoned-data',
    OPENAI_API_KEY: 'pkg-003-poison-provider-secret'
  },
  identity: {
    version: 'pkg-003',
    port,
    token,
    dataDirectory,
    logLocation: join(dataDirectory, 'logs')
  },
  logger
})
assertCondition(options.command === packagedExecutable, 'packaged resolver did not choose resources/backend executable')
assertCondition(options.cwd === hostileCwd, 'packaged smoke did not use the explicit hostile working directory')
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
  assertCondition(health.status === 200 && health.body.status === 'ok', 'packaged health failed')
  const readyChecks = ready.body.checks as JsonRecord
  assertCondition(ready.status === 200 && ready.body.status === 'ready' && readyChecks.database === true, 'packaged readiness failed')
  assertCondition(version.status === 200 && version.body.backend_version === backendPackage.version, 'embedded package version is missing')
  assertCondition(version.body.build_id === `${backendPackage.name}@${backendPackage.version}+source`, 'embedded package name/version identity is missing')
  const database = debug.body.database as JsonRecord
  assertCondition(
    debug.status === 200 &&
      database.schema_version === ADVX_SQLITE_MIGRATIONS.length &&
      database.quickCheck === 'ok',
    `packaged database asset boundary failed: ${JSON.stringify(debug.body)}`
  )
} finally {
  await controller.dispose()
}

const afterResources = await resourceSnapshot(resourcesRoot)
const resourceTreeUnchanged = JSON.stringify(beforeResources) === JSON.stringify(afterResources)
const hostileFiles = (await readdir(hostileCwd)).sort()
const dataFiles = (await readdir(dataDirectory)).sort()
const cleanlyDisposed = controller.status().state === 'disposed'
assertCondition(resourceTreeUnchanged, 'packaged resource tree changed during runtime')
assertCondition(cleanlyDisposed, 'packaged backend did not dispose cleanly')
assertCondition(!hostileFiles.includes('BUNFIG_POISON_MARKER.txt'), 'hostile working directory preload executed')
assertCondition(dataFiles.includes('advx.sqlite3') && dataFiles.includes('logs'), 'runtime data was not redirected outside packaged resources')

const result = {
  schemaVersion: 1,
  taskId: 'PKG-003',
  status: 'passed',
  strategy: 'embedded',
  embeddedAssets: assetIdentities,
  testOnlyAssets: [...testOnlyAssetPaths],
  manifest: {
    embeddedCount: manifestEmbedded.length,
    copiedCount: (compile.copiedAssets as unknown[]).length,
    runtimeAssetCount: manifestRuntimeAssets.length
  },
  packagedSmoke: {
    resourcesRoot,
    packagedExecutable,
    resourceTreeUnchanged,
    missingExecutableError,
    healthStatus: health.status,
    readinessStatus: ready.status,
    versionStatus: version.status,
    debugStatus: debug.status,
    databaseSchemaVersion: (debug.body.database as JsonRecord).schema_version,
    cleanlyDisposed,
    hostileFiles,
    dataFiles
  },
  runtime: { bun: Bun.version, platform: process.platform, arch: process.arch }
} as const
await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)

async function writeHostileFiles(): Promise<void> {
  await Bun.write(join(hostileCwd, '.env'), 'ADVX_DATA_DIR=C:/pkg-003-poisoned-cwd\nADVX_BACKEND_PORT=1\n')
  await Bun.write(join(hostileCwd, 'bunfig.toml'), 'preload = ["./poison-preload.ts"]\n')
  await Bun.write(join(hostileCwd, 'poison-preload.ts'), "await Bun.write('./BUNFIG_POISON_MARKER.txt', 'autoloaded')\n")
  await Bun.write(join(hostileCwd, 'package.json'), '{"name":"pkg-003-hostile"}\n')
}
