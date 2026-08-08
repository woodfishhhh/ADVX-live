import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { RecordedElectronScenarioResult } from '../../../tests/e2e/electron/recorded-electron.fixture.ts'

type SuiteResult = Readonly<{
  schema_version: 1
  task_id: 'TST-008'
  status: 'passed' | 'failed'
  normal_ci_scenario: string
  explicit_jobs: readonly string[]
  artifact_policy: Readonly<{
    on_failure: readonly string[]
    always: readonly string[]
    video: string
  }>
  results: readonly RecordedElectronScenarioResult[]
}>

const packageRoot = resolve(import.meta.dir, '..')
const repositoryRoot = resolve(packageRoot, '..', '..')
const artifactRoot = process.env.ADVX_TST008_ARTIFACT_ROOT === undefined
  ? join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'tst-008')
  : resolve(process.env.ADVX_TST008_ARTIFACT_ROOT)
const buildRoot = await mkdtemp(join(tmpdir(), 'advx-tst-008-build-'))
const compiledExecutable = join(
  buildRoot,
  process.platform === 'win32' ? 'advx-backend-bun.exe' : 'advx-backend-bun'
)
const suitePath = join(artifactRoot, 'suite.json')
const nodeExecutable = process.env.ADVX_NODE_EXECUTABLE?.trim() || 'node'
const startedAt = Date.now()

await rm(artifactRoot, { recursive: true, force: true })
await mkdir(artifactRoot, { recursive: true })
const nodeVersion = await captureCommand([nodeExecutable, '--version'])

let compiledSha256 = ''
let compiledBytes = 0
try {
  await runCommand([process.execPath, 'run', '--filter', '@advx/desktop', 'ensure:electron'])
  await runCommand([process.execPath, 'run', '--filter', '@advx/desktop', 'build'])
  await runCommand([
    process.execPath,
    'build',
    join(repositoryRoot, 'apps', 'backend-bun', 'src', 'main.ts'),
    '--compile',
    '--no-compile-autoload-dotenv',
    '--no-compile-autoload-bunfig',
    '--no-compile-autoload-package-json',
    '--no-compile-autoload-tsconfig',
    '--outfile',
    compiledExecutable
  ])
  const compiledStats = await stat(compiledExecutable)
  compiledBytes = compiledStats.size
  compiledSha256 = await sha256File(compiledExecutable)

  await runCommand(
    [
      nodeExecutable,
      join(repositoryRoot, 'tests', 'e2e', 'electron', 'run-recorded-pipeline.ts')
    ],
    {
      ...process.env,
      ADVX_TST008_ARTIFACT_ROOT: artifactRoot,
      ADVX_TST008_COMPILED_EXECUTABLE: compiledExecutable
    }
  )
} finally {
  await rm(buildRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}

const suiteBytes = await readFile(suitePath)
const suite = JSON.parse(suiteBytes.toString('utf8')) as SuiteResult
assert.equal(suite.schema_version, 1)
assert.equal(suite.task_id, 'TST-008')
assert.equal(suite.status, 'passed')
assert.equal(suite.normal_ci_scenario, 'bun-source/full-pipeline')
assert.deepEqual(suite.explicit_jobs, [
  'credentialed-provider-matrix',
  'non-Windows-platform-matrix'
])
assert.equal(suite.results.length, 2)

const sourceResult = suite.results.find((result) => result.backend_runtime === 'bun-source')
const compiledResult = suite.results.find((result) => result.backend_runtime === 'bun-compiled')
assert.ok(sourceResult)
assert.ok(compiledResult)
assert.equal(sourceResult.scenario, 'full-pipeline')
assert.deepEqual(sourceResult.inputs, ['text', 'frame', 'microphone', 'system_audio'])
assert.equal(sourceResult.overlay.rendered, true)
assert.ok(sourceResult.traces.frame_hash_count > 0)
assert.equal(compiledResult.scenario, 'recorded-lifecycle')
assert.deepEqual(compiledResult.inputs, ['text'])

for (const result of suite.results) {
  assert.equal(result.status, 'passed')
  assert.equal(result.provider_mode, 'recorded')
  assert.equal(result.provider_model, 'recorded-viewer-v1')
  assert.equal(result.barrage.delivered, true)
  assert.equal(result.traces.provider, 'recorded-viewer-v1')
  assert.equal(result.isolation.backend_data_observed, true)
  assert.equal(result.diagnostics.fatal_error_count, 0)
  assert.deepEqual(result.cleanup, {
    session_stopped: true,
    electron_closed: true,
    backend_port_released: true,
    temporary_directory_removed: true
  })
  assert.equal(result.failure, null)
}

const manifest = {
  schema_version: 1,
  task_id: 'TST-008',
  status: 'passed',
  suite: {
    path: 'suite.json',
    sha256: createHash('sha256').update(suiteBytes).digest('hex'),
    scenarios: suite.results.length,
    normal_ci_scenario: suite.normal_ci_scenario
  },
  coverage: {
    runtimes: suite.results.map((result) => result.backend_runtime),
    deterministic_provider: true,
    isolated_user_and_backend_data: true,
    console_page_process_error_collection: true,
    collected_non_fatal_console_errors: suite.results.reduce(
      (count, result) => count + result.diagnostics.error_count,
      0
    ),
    failure_trace_and_screenshots: true,
    video_policy: suite.artifact_policy.video,
    bounded_startup_and_shutdown: true,
    finally_cleanup: true
  },
  compiled_backend: {
    sha256: compiledSha256,
    bytes: compiledBytes,
    retained: false
  },
  explicit_jobs: suite.explicit_jobs,
  runtime: {
    bun: Bun.version,
    package_manager: `bun@${Bun.version}`,
    bun_node_api: process.versions.node,
    node_process: nodeVersion,
    platform: process.platform,
    arch: process.arch
  },
  duration_ms: Date.now() - startedAt
} as const

await writeJsonAtomic(join(artifactRoot, 'manifest.json'), manifest)
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)

async function runCommand(
  command: readonly string[],
  environment: Record<string, string | undefined> = process.env
): Promise<void> {
  const child = Bun.spawn([...command], {
    cwd: repositoryRoot,
    env: environment,
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
    windowsHide: true
  })
  const exitCode = await child.exited
  if (exitCode !== 0) {
    throw new Error(`TST-008 command exited ${exitCode}: ${command.slice(0, 3).join(' ')}`)
  }
}

async function captureCommand(command: readonly string[]): Promise<string> {
  const child = Bun.spawn([...command], {
    cwd: repositoryRoot,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'inherit',
    windowsHide: true
  })
  const output = (await new Response(child.stdout).text()).trim()
  const exitCode = await child.exited
  if (exitCode !== 0 || output === '') {
    throw new Error(`TST-008 probe exited ${exitCode}: ${command.join(' ')}`)
  }
  return output
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}
