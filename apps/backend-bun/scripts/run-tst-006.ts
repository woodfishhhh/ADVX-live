import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

type NegativeCorpus = Readonly<{
  schema_version: number
  task_id: string
  categories: readonly string[]
  control_cases: readonly Readonly<{ id: string }>[]
  sequence_cases: readonly Readonly<{ id: string }>[]
  realtime_cases: readonly Readonly<{ id: string }>[]
  binary_cases: readonly Readonly<{ id: string }>[]
  session_cases: readonly Readonly<{ id: string }>[]
  resource_limits: Readonly<{
    max_corpus_file_bytes: number
    max_generated_fixture_bytes: number
    oversized_binary_declared_body_bytes: number
  }>
  applicability: Readonly<{ decompression: boolean; reason: string }>
}>

const requiredCategories = [
  'json_field_shape',
  'protocol_version',
  'control_payload_size',
  'binary_header_and_length',
  'sequence_integrity',
  'session_fencing',
  'unknown_event_kind',
  'media_metadata_limit'
] as const

const packageRoot = resolve(import.meta.dir, '..')
const repositoryRoot = resolve(packageRoot, '..', '..')
const testFile = join(packageRoot, 'src', 'testing', 'tst-006-protocol-negative.test.ts')
const corpusPath = join(
  packageRoot,
  'src',
  'testing',
  'fixtures',
  'tst-006-negative-corpus.json'
)
const artifactRoot = process.env.ADVX_TST006_ARTIFACT_ROOT === undefined
  ? join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'tst-006')
  : resolve(process.env.ADVX_TST006_ARTIFACT_ROOT)
const manifestPath = join(artifactRoot, 'manifest.json')

const corpusBytes = await readFile(corpusPath)
const corpus = JSON.parse(corpusBytes.toString('utf8')) as NegativeCorpus
const cases = [
  ...corpus.control_cases,
  ...corpus.sequence_cases,
  ...corpus.realtime_cases,
  ...corpus.binary_cases,
  ...corpus.session_cases
]

if (corpus.schema_version !== 1 || corpus.task_id !== 'TST-006') {
  throw new Error('invalid TST-006 corpus identity')
}
if (
  corpus.categories.length !== requiredCategories.length ||
  requiredCategories.some((category, index) => corpus.categories[index] !== category)
) {
  throw new Error('TST-006 corpus categories do not match the task contract')
}
if (cases.length !== 18 || new Set(cases.map((entry) => entry.id)).size !== cases.length) {
  throw new Error('TST-006 requires exactly 18 unique bounded corpus cases')
}
if (corpusBytes.byteLength > corpus.resource_limits.max_corpus_file_bytes) {
  throw new Error('TST-006 corpus exceeds its declared source-size limit')
}
if (corpus.applicability.decompression !== false) {
  throw new Error('TST-006 must not claim an unsupported decompression boundary')
}

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

const manifest = {
  schema_version: 1,
  task_id: 'TST-006',
  status: 'passed',
  fixture_class: 'deterministic_protocol_negative_corpus',
  corpus: {
    path: 'apps/backend-bun/src/testing/fixtures/tst-006-negative-corpus.json',
    sha256: createHash('sha256').update(corpusBytes).digest('hex'),
    byte_length: corpusBytes.byteLength,
    case_count: cases.length,
    case_ids: cases.map((entry) => entry.id),
    categories: corpus.categories
  },
  source_boundaries: {
    control_http: 'real Elysia runtime control and debug replay routes',
    realtime_json: 'real RealtimeHub canonical envelope parser and size guard',
    binary_ingest: 'real RealtimeHub, ADVX-BIN decoder, and ingest dispatcher',
    session_fencing: 'real RealtimeHub and TextIngestDispatcher'
  },
  resource_bounds: {
    corpus_file_maximum_bytes: corpus.resource_limits.max_corpus_file_bytes,
    generated_fixture_maximum_bytes:
      corpus.resource_limits.max_generated_fixture_bytes,
    oversized_binary_body_is_declaration_only_bytes:
      corpus.resource_limits.oversized_binary_declared_body_bytes,
    decompression_applicable: corpus.applicability.decompression,
    decompression_reason: corpus.applicability.reason
  },
  assertions: [
    'normalized_rejection_or_protocol_close',
    'zero_downstream_dispatch_for_rejected_input',
    'zero_replay_execution_for_invalid_sequence',
    'nonfatal_rejections_preserve_followup_ping',
    'bounded_fixture_bytes_avoid_hostile_allocation'
  ],
  runtime: {
    bun: Bun.version,
    node: process.versions.node,
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
