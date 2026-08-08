import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const scenarioIds = [
  'http_connection_refusal',
  'http_timeout_and_caller_cancellation',
  'http_status_normalization',
  'malformed_json',
  'sse_chunk_split_and_truncation',
  'partial_usage_metadata',
  'slow_stream_after_cancellation',
  'typed_output_contract_violation',
  'websocket_close_invalid_frame_reconnect'
] as const

const packageRoot = resolve(import.meta.dir, '..')
const repositoryRoot = resolve(packageRoot, '..', '..')
const testFile = join(packageRoot, 'src', 'testing', 'tst-005-provider-faults.test.ts')
const artifactRoot = process.env.ADVX_TST005_ARTIFACT_ROOT === undefined
  ? join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'tst-005')
  : resolve(process.env.ADVX_TST005_ARTIFACT_ROOT)
const manifestPath = join(artifactRoot, 'manifest.json')

const child = Bun.spawn([
  process.execPath,
  'test',
  '--timeout',
  '10000',
  testFile
], {
  cwd: packageRoot,
  env: process.env,
  stdin: 'ignore',
  stdout: 'inherit',
  stderr: 'inherit'
})

const exitCode = await child.exited
if (exitCode !== 0) process.exit(exitCode)

const mswPackage = JSON.parse(
  await readFile(join(packageRoot, 'node_modules', 'msw', 'package.json'), 'utf8')
) as { readonly version?: unknown }
if (mswPackage.version !== '2.15.0') {
  throw new Error(`TST-005 requires exact msw@2.15.0, received ${String(mswPackage.version)}`)
}

const manifest = {
  schema_version: 1,
  task_id: 'TST-005',
  status: 'passed',
  fixture_class: 'deterministic_msw_fault_injection',
  source_boundaries: {
    http: 'active AI SDK and StepFun ASR adapters',
    sse: 'active AI SDK and StepFun ASR adapters',
    websocket: 'reserved remote Provider transport; no active Provider runtime adapter uses WebSocket'
  },
  scenario_count: scenarioIds.length,
  scenarios: scenarioIds,
  assertions: [
    'normalized_provider_failures',
    'retry_eligibility',
    'cancellation_has_no_late_completion',
    'provider_secrets_are_absent_from_results'
  ],
  runtime: {
    bun: Bun.version,
    node: process.versions.node,
    msw: mswPackage.version,
    platform: process.platform,
    arch: process.arch
  }
} as const

await writeJsonAtomic(manifestPath, manifest)
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}
