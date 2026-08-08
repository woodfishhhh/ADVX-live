import { randomBytes } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'
import { Database } from 'bun:sqlite'

import {
  ADVX_HTTP_PROTOCOL_VERSION,
  ADVX_REALTIME_PROTOCOL_VERSION,
  ADVX_SCHEMA_PACKAGE_VERSION
} from '../packages/contracts/src/index.ts'
import { SpawnedBackendProcess } from '../apps/desktop/src/main/backend/backend-process.ts'
import {
  createBunCompiledBackendProcessOptions,
  resolveCompiledBunExecutable
} from '../apps/desktop/src/main/backend/backend-process-bun-compiled.ts'
import { createPythonBackendProcessOptions } from '../apps/desktop/src/main/backend/backend-process-python.ts'
import { resolveBackendRuntime } from '../apps/desktop/src/main/backend/backend-runtime.ts'
import type { BackendProcessLogger } from '../apps/desktop/src/main/backend/backend-supervisor.ts'
import {
  parseNamedArguments,
  requireSafeArtifactRoot,
  SCRIPT_EXIT,
  ScriptError,
  writeJsonAtomic
} from './evidence-script-runtime.ts'

type JsonRecord = Record<string, unknown>

const repositoryRoot = resolve(import.meta.dir, '..')
const args = parseNamedArguments(Bun.argv.slice(2), new Set(['--artifact-root']))
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ?? join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'cut-001'),
  repositoryRoot
)
const seedDirectory = join(artifactRoot, 'seed')
const bunDataDirectory = join(artifactRoot, 'isolated-bun-copy')
const pythonDataDirectory = join(artifactRoot, 'isolated-python-copy')
const markerName = 'cutover-seed.json'
const markerText = '{"fixture":"CUT-001","source":"synthetic-isolated-copy"}\n'
const compiledExecutable = join(
  repositoryRoot,
  'apps',
  'backend-bun',
  'dist',
  process.platform === 'win32' ? 'advx-backend-bun.exe' : 'advx-backend-bun'
)
const logger: BackendProcessLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScriptError(SCRIPT_EXIT.verificationFailed, message)
}

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveStart, rejectStart) => {
    server.once('error', rejectStart)
    server.listen(0, '127.0.0.1', resolveStart)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('port_probe_failed')
  const port = address.port
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  return port
}

async function portIsFree(port: number): Promise<boolean> {
  const server = createServer()
  return await new Promise<boolean>((resolveResult) => {
    server.once('error', () => resolveResult(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolveResult(true)))
  })
}

async function waitForPortRelease(port: number): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await portIsFree(port)) return
    await Bun.sleep(100)
  }
  throw new ScriptError(SCRIPT_EXIT.verificationFailed, `port ${port} was not released`)
}

async function fetchJson(
  baseUrl: string,
  token: string,
  path: string
): Promise<Readonly<{ status: number; body: JsonRecord }>> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-advx-protocol-version': String(ADVX_HTTP_PROTOCOL_VERSION)
    }
  })
  return { status: response.status, body: JSON.parse(await response.text()) as JsonRecord }
}

async function rendererContainsRuntimeSelector(directory: string): Promise<boolean> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      if (await rendererContainsRuntimeSelector(path)) return true
      continue
    }
    if (!entry.name.match(/\.(?:ts|tsx|html)$/)) continue
    const source = await readFile(path, 'utf8')
    if (source.includes('ADVX_BACKEND_RUNTIME') || source.includes('BACKEND_RUNTIMES')) return true
  }
  return false
}

if (process.platform !== 'win32') {
  throw new ScriptError(SCRIPT_EXIT.invalidInput, 'CUT-001 is authorized for Windows only')
}

await rm(artifactRoot, { recursive: true, force: true })
await mkdir(seedDirectory, { recursive: true })
await writeFile(join(seedDirectory, markerName), markerText, 'utf8')
await Promise.all([
  cp(seedDirectory, bunDataDirectory, { recursive: true }),
  cp(seedDirectory, pythonDataDirectory, { recursive: true })
])

const [backendPackage, runtimeSource, desktopMainSource, devSource] = await Promise.all([
  readFile(join(repositoryRoot, 'apps/backend-bun/package.json'), 'utf8').then(
    (text) => JSON.parse(text) as Readonly<{ version: string }>
  ),
  readFile(join(repositoryRoot, 'apps/desktop/src/main/backend/backend-runtime.ts'), 'utf8'),
  readFile(join(repositoryRoot, 'apps/desktop/src/main/index.ts'), 'utf8'),
  readFile(join(repositoryRoot, 'scripts/dev.mjs'), 'utf8')
])

assertCondition(resolveBackendRuntime(undefined) === 'bun-source', 'development default is not Bun source')
assertCondition(
  resolveBackendRuntime(undefined, { packaged: true }) === 'bun-compiled',
  'packaged default is not compiled Bun'
)
assertCondition(
  resolveBackendRuntime('python-oracle') === 'python-oracle',
  'explicit local Python rollback is unavailable'
)
assertCondition(
  resolveBackendRuntime('python-oracle', { packaged: true }) === 'bun-compiled',
  'packaged runtime selector exposed the local Python rollback'
)
assertCondition(
  runtimeSource.includes("if (options.packaged) return 'bun-compiled'"),
  'packaged Bun selection is not fail-closed'
)
assertCondition(
  desktopMainSource.includes('ADVX_BACKEND_DATA_DIR') &&
    desktopMainSource.includes('backend.mode.selected'),
  'runtime diagnostics or isolated smoke data override is missing'
)
assertCondition(
  !devSource.includes('advx_backend.main:app') &&
    devSource.includes('supervised Bun backend') &&
    devSource.includes('ADVX_BACKEND_EXTERNAL: configuredBackendUrl === undefined ? "0" : "1"'),
  'development launcher still owns a Python backend child'
)
assertCondition(
  !(await rendererContainsRuntimeSelector(join(repositoryRoot, 'apps/desktop/src/renderers'))),
  'runtime selector is exposed in the production renderer'
)

let missingExecutableError = ''
try {
  resolveCompiledBunExecutable({
    packaged: false,
    resourcesPath: repositoryRoot,
    repositoryRoot,
    backendExecutable: join(artifactRoot, 'missing-advx-backend-bun.exe')
  })
} catch (error) {
  missingExecutableError = error instanceof Error ? error.message : String(error)
}
assertCondition(
  missingExecutableError.includes('compiled_backend_missing'),
  'compiled Bun failure was not explicit'
)
assertCondition(
  await readFile(join(pythonDataDirectory, markerName), 'utf8') === markerText,
  'failed Bun selection mutated the isolated Python rollback copy'
)

const bunPort = await availablePort()
const bunToken = randomBytes(32).toString('base64url')
const bunBaseUrl = `http://127.0.0.1:${bunPort}`
const bunController = new SpawnedBackendProcess(
  createBunCompiledBackendProcessOptions({
    packaged: false,
    resourcesPath: repositoryRoot,
    repositoryRoot,
    backendExecutable: compiledExecutable,
    backendPort: String(bunPort),
    backendBaseUrl: bunBaseUrl,
    dataDirectory: bunDataDirectory,
    startupToken: bunToken,
    expectedBackendVersion: backendPackage.version,
    identity: {
      version: `bun-compiled@${backendPackage.version}`,
      port: bunPort,
      token: bunToken,
      dataDirectory: bunDataDirectory,
      logLocation: join(bunDataDirectory, 'logs')
    },
    logger
  })
)
let bunHealth: Readonly<{ status: number; body: JsonRecord }>
let bunVersion: Readonly<{ status: number; body: JsonRecord }>
let bunDebug: Readonly<{ status: number; body: JsonRecord }>
try {
  await bunController.start()
  ;[bunHealth, bunVersion, bunDebug] = await Promise.all([
    fetchJson(bunBaseUrl, bunToken, '/health'),
    fetchJson(bunBaseUrl, bunToken, '/version'),
    fetchJson(bunBaseUrl, bunToken, '/debug/snapshot?limit=1')
  ])
} finally {
  await bunController.dispose()
}
await waitForPortRelease(bunPort)

const bunDatabase = bunDebug.body.database as JsonRecord
assertCondition(bunHealth.status === 200 && bunHealth.body.status === 'ok', 'Bun default health failed')
assertCondition(
  bunVersion.status === 200 &&
    bunVersion.body.backend_version === backendPackage.version &&
    bunVersion.body.http_protocol_version === ADVX_HTTP_PROTOCOL_VERSION &&
    bunVersion.body.realtime_protocol_version === ADVX_REALTIME_PROTOCOL_VERSION &&
    bunVersion.body.schema_package_version === ADVX_SCHEMA_PACKAGE_VERSION,
  'Bun default version/schema handshake failed'
)
assertCondition(
  bunDebug.status === 200 && bunDatabase.schema_version === 6 && bunDatabase.quickCheck === 'ok',
  'Bun default database schema is not ready'
)
assertCondition(
  bunController.status().state === 'disposed' &&
    (await readFile(join(bunDataDirectory, markerName), 'utf8')) === markerText,
  'Bun default did not stop cleanly or changed the isolated seed marker'
)

const pythonPort = await availablePort()
const pythonToken = randomBytes(32).toString('base64url')
const pythonBaseUrl = `http://127.0.0.1:${pythonPort}`
const pythonController = new SpawnedBackendProcess(
  createPythonBackendProcessOptions({
    packaged: false,
    resourcesPath: repositoryRoot,
    repositoryRoot,
    backendPort: String(pythonPort),
    backendBaseUrl: pythonBaseUrl,
    environment: {
      ...process.env,
      ADVX_BACKEND_URL: pythonBaseUrl,
      ADVX_DATA_DIR: pythonDataDirectory,
      ADVX_LOCAL_TOKEN: pythonToken
    },
    identity: {
      version: 'python-oracle',
      port: pythonPort,
      token: pythonToken,
      dataDirectory: pythonDataDirectory,
      logLocation: join(pythonDataDirectory, 'logs')
    },
    logger
  })
)
let pythonHealth: Readonly<{ status: number; body: JsonRecord }>
let pythonConfiguration: Readonly<{ status: number; body: JsonRecord }>
let pythonOpenApi: Readonly<{ status: number; body: JsonRecord }>
try {
  await pythonController.start()
  ;[pythonHealth, pythonConfiguration, pythonOpenApi] = await Promise.all([
    fetchJson(pythonBaseUrl, pythonToken, '/health'),
    fetchJson(pythonBaseUrl, pythonToken, '/configuration/providers'),
    fetchJson(pythonBaseUrl, pythonToken, '/openapi.json')
  ])
} finally {
  await pythonController.dispose()
}
await waitForPortRelease(pythonPort)

const pythonDatabasePath = join(pythonDataDirectory, 'advx.sqlite3')
const pythonDatabase = new Database(pythonDatabasePath, { readonly: true })
const pythonRevision = pythonDatabase
  .query<{ version_num: string }, []>('SELECT version_num FROM alembic_version')
  .get()?.version_num
pythonDatabase.close()
const pythonInfo = pythonOpenApi.body.info as JsonRecord
assertCondition(
  pythonHealth.status === 200 && pythonHealth.body.status === 'ok',
  'Python rollback health failed'
)
assertCondition(
  pythonConfiguration.status === 200 && typeof pythonConfiguration.body.configured === 'boolean',
  'Python rollback authenticated control failed'
)
assertCondition(
  pythonOpenApi.status === 200 &&
    typeof pythonInfo.version === 'string' &&
    pythonInfo.version.length > 0 &&
    pythonRevision === '0006_viewer_lifecycle',
  'Python rollback version/schema check failed'
)
assertCondition(
  pythonController.status().state === 'disposed' &&
    (await readFile(join(pythonDataDirectory, markerName), 'utf8')) === markerText,
  'Python rollback did not stop cleanly or changed the isolated seed marker'
)

const result = {
  schemaVersion: 1,
  taskId: 'CUT-001',
  status: 'passed',
  platformClaim: 'windows-x64-only',
  selection: {
    developmentDefault: resolveBackendRuntime(undefined),
    packagedDefault: resolveBackendRuntime(undefined, { packaged: true }),
    localRollback: resolveBackendRuntime('python-oracle'),
    packagedPythonSelection: resolveBackendRuntime('python-oracle', { packaged: true }),
    rendererSelectorExposed: false
  },
  failureRollback: {
    missingExecutableError,
    pythonCopyUnchangedBeforeRollback: true
  },
  defaultSmoke: {
    runtime: 'bun-compiled',
    isolatedCopy: bunDataDirectory,
    healthStatus: bunHealth.status,
    backendVersion: bunVersion.body.backend_version,
    httpProtocolVersion: bunVersion.body.http_protocol_version,
    realtimeProtocolVersion: bunVersion.body.realtime_protocol_version,
    schemaPackageVersion: bunVersion.body.schema_package_version,
    databaseSchemaVersion: bunDatabase.schema_version,
    cleanStop: true,
    portReleased: true
  },
  rollbackSmoke: {
    runtime: 'python-oracle',
    isolatedCopy: pythonDataDirectory,
    healthStatus: pythonHealth.status,
    backendVersion: pythonInfo.version,
    databaseRevision: pythonRevision,
    authenticatedControlStatus: pythonConfiguration.status,
    cleanStop: true,
    portReleased: true
  },
  runtime: { bun: Bun.version, platform: process.platform, arch: process.arch }
} as const

await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
