import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

type CommandResult = Readonly<{
  command: readonly string[]
  exitCode: number
  status: 'passed' | 'failed'
  timedOut: boolean
}>

type RecordValue = Record<string, unknown>

const repositoryRoot = resolve(import.meta.dir, '..')
const artifactRoot = resolve(
  namedArgument('--artifact-root') ??
    join(repositoryRoot, '.omx', 'artifacts', 'typescript-bun', 'TST-013', `local-${process.pid}`)
)
const controlReportPath = join(artifactRoot, 'control-session-parity.json')
const healthReportPath = join(artifactRoot, 'health-parity.json')
const viewerArtifactRoot = join(artifactRoot, 'viewer-bun')
const viewerFixture = resolve(
  namedArgument('--fixture') ??
    join(repositoryRoot, 'tests', 'fixtures', 'cs2', 'viewer_runtime_recorded.json')
)
const pythonEvidencePath = resolve(
  join(repositoryRoot, 'tests', 'e2e', 'cs2_viewer_runtime_recorded_evidence.json')
)
const timeoutMs = Number(namedArgument('--timeout-ms') ?? '120000')

const commands: CommandResult[] = []
await mkdir(artifactRoot, { recursive: true })

commands.push(
  await runCommand(['bun', 'tests/parity/run-control-session-parity.ts'], {
    ADVX_CONTROL_SESSION_PARITY_REPORT: controlReportPath,
    ADVX_INCLUDE_DEBUG_SNAPSHOT: '1',
    ADVX_ALLOW_DEBUG_SNAPSHOT_UNAVAILABLE: '1'
  })
)
commands.push(
  await runCommand(['bun', 'tests/parity/run-health-parity.ts'], {
    ADVX_PARITY_REPORT: healthReportPath
  })
)
commands.push(
  await runCommand(
    [
      'uv',
      'run',
      '--project',
      'apps/backend',
      'pytest',
      'tests/e2e/test_viewer_runtime_recorded.py',
      '-q'
    ],
    {}
  )
)
commands.push(
  await runCommand(
    [
      'bun',
      'scripts/verify-viewer-runtime-evidence.ts',
      '--fixture',
      viewerFixture,
      '--artifact-root',
      viewerArtifactRoot
    ],
    {}
  )
)

const control = await readJson(controlReportPath)
const health = await readJson(healthReportPath)
const pythonEvidence = await readJson(pythonEvidencePath)
const viewerManifest = await readJson(join(viewerArtifactRoot, 'manifest.json'))
const viewerReplay = await readJson(join(viewerArtifactRoot, 'replay-evidence.json'))

const controlDiffs = arrayValue(control.diffs)
const classifiedDifferences = arrayValue(control.classifiedDifferences)
const controlProcess = recordValue(control.process)
const controlTemporary = recordValue(control.temporaryData)
const controlPassed = control.status === 'passed' && controlDiffs.length === 0
const healthPassed = health.status === 'passed' && arrayValue(health.diffs).length === 0
const pythonViewer = normalizePythonViewerEvidence(pythonEvidence)
const bunViewer = normalizeBunViewerEvidence(viewerManifest, viewerReplay)
const viewerPassed = pythonViewer.status === 'passed' && bunViewer.status === 'passed'

const categories = {
  http_status_body: category(
    'passed',
    controlPassed,
    'BCK-011 normalized HTTP status, error codes, and canonical response projections'
  ),
  websocket_event_kinds_identities: category(
    'passed',
    controlPassed &&
      equalJson(
        recordValue(recordValue(control.normalizedRuns).python).realtime,
        recordValue(recordValue(control.normalizedRuns).bun).realtime
      ),
    'BCK-011 normalized realtime event type, protocol, and session identity projection'
  ),
  barrage_silence: category(
    'passed',
    viewerPassed &&
      pythonViewer.published === 1 &&
      pythonViewer.silenced === 27 &&
      pythonViewer.requestCount === 28 &&
      bunViewer.hasBarrageAndSilence,
    'Recorded viewer fixture preserves one publication, 27 silences, and the Bun replay action invariants'
  ),
  persistence_effects: category(
    'passed',
    controlPassed && hasFinalIdleStage(control),
    'Control/session slice reaches the same final idle projection and removes both temporary data directories'
  ),
  debug_snapshot: {
    status: classifiedDifferences.length > 0 ? 'classified' : controlPassed ? 'passed' : 'failed',
    classification:
      classifiedDifferences.length > 0
        ? 'python-debug-snapshot-unavailable'
        : 'normalized-redacted-debug-snapshot',
    passed: controlPassed && hasBunRedactedDebugSnapshot(control),
    detail:
      classifiedDifferences.length > 0
        ? 'Python exposes the authenticated debug route as an internal 500 in the parity fixture; the difference is retained in classifiedDifferences and Bun redaction is still checked.'
        : 'Authenticated debug snapshots matched after normalization.'
  },
  shutdown_resource_state: category(
    'passed',
    controlPassed &&
      controlProcess.zeroOrphans === true &&
      recordValue(controlProcess.portsReleased).python === true &&
      recordValue(controlProcess.portsReleased).bun === true &&
      controlTemporary.pythonDataDirectoryRemoved === true &&
      controlTemporary.bunDataDirectoryRemoved === true,
    'BCK-011 proves clean stop, released ports, zero descendants, and removed temporary data'
  ),
  redacted_trace_invariants: category(
    'passed',
    viewerPassed && bunViewer.redactionVerified && hasNoCredentialLikeData(pythonEvidence),
    'Python recorded evidence and Bun replay manifest remain deterministic, redacted, and offline'
  )
} as const

const requiredCategories = Object.values(categories)
const passed =
  commands.every((item) => item.status === 'passed') &&
  requiredCategories.every((item) => item.passed) &&
  healthPassed
const report = {
  schema_version: 1,
  task_id: 'TST-013',
  status: passed ? 'passed' : 'failed',
  scenario: 'Python oracle and Bun privacy-safe control plus recorded viewer slice',
  until: 'CUT-008',
  commands,
  categories,
  health: { status: health.status, passed: healthPassed },
  viewer: { python: pythonViewer, bun: bunViewer },
  classified_differences: classifiedDifferences,
  source_reports: {
    control_session: 'control-session-parity.json',
    health: 'health-parity.json',
    viewer_manifest: 'viewer-bun/manifest.json',
    viewer_replay: 'viewer-bun/replay-evidence.json'
  }
}
await writeFile(
  join(artifactRoot, 'tst-013-report.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8'
)
console.log(
  JSON.stringify({ artifactRoot, status: report.status, categories: Object.keys(categories) })
)
if (!passed) process.exitCode = 1

function namedArgument(name: string): string | undefined {
  const index = Bun.argv.indexOf(name)
  return index === -1 ? undefined : Bun.argv[index + 1]
}

async function runCommand(
  command: readonly string[],
  environment: Record<string, string>
): Promise<CommandResult> {
  const child = Bun.spawn([...command], {
    cwd: repositoryRoot,
    env: { ...process.env, ...environment },
    stdout: 'pipe',
    stderr: 'pipe'
  })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill()
  }, timeoutMs)
  await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  const exitCode = await child.exited
  clearTimeout(timeout)
  return {
    command,
    exitCode,
    status: exitCode === 0 && !timedOut ? 'passed' : 'failed',
    timedOut
  }
}

async function readJson(path: string): Promise<RecordValue> {
  return recordValue(JSON.parse(await readFile(path, 'utf8')))
}

function recordValue(value: unknown): RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as RecordValue)
    : {}
}

function arrayValue(value: unknown): RecordValue[] {
  return Array.isArray(value) ? value.map(recordValue) : []
}

function category(classification: string, passed: boolean, detail: string) {
  return { status: passed ? 'passed' : 'failed', classification, passed, detail }
}

function normalizePythonViewerEvidence(value: RecordValue) {
  const callIdentity = recordValue(value.call_identity)
  const hotUpdate = recordValue(value.hot_update)
  const canonicalHash = recordValue(value.canonical_hash)
  const requestIdentity = Array.isArray(callIdentity.request_identity)
    ? callIdentity.request_identity
    : []
  return {
    status:
      value.proof_scope === 'deterministic_recorded_no_external_provider' &&
      canonicalHash.matches === true &&
      recordValue(value.claims).all_active_viewers_are_called === true
        ? 'passed'
        : 'failed',
    published: callIdentity.published,
    silenced: callIdentity.silenced,
    requestCount: requestIdentity.length,
    selectedCount: Array.isArray(callIdentity.selected_viewer_ids)
      ? callIdentity.selected_viewer_ids.length
      : 0,
    updatedCounts: hotUpdate.updated_counts,
    canonicalHashMatches: canonicalHash.matches === true
  }
}

function normalizeBunViewerEvidence(manifest: RecordValue, replay: RecordValue) {
  const evidence = recordValue(replay)
  const decisions = Array.isArray(evidence.decisions) ? evidence.decisions.map(recordValue) : []
  const actions = decisions.flatMap((decision) =>
    Array.isArray(decision.actions)
      ? decision.actions.filter((value): value is string => typeof value === 'string')
      : []
  )
  const recordedEvidence = recordValue(evidence.recorded_evidence)
  const externalCalls =
    evidence.external_transport_call_count ?? manifest.external_transport_call_count
  return {
    status:
      manifest.status === 'passed' && manifest.redaction_verified === true && externalCalls === 0
        ? 'passed'
        : 'failed',
    hasBarrageAndSilence: actions.includes('barrage') && actions.includes('silence'),
    actions,
    redactionVerified: manifest.redaction_verified === true,
    externalTransportCallCount: externalCalls,
    consumedProviderRoles:
      recordedEvidence.consumed_provider_roles ??
      recordValue(manifest.replay).consumed_provider_roles ??
      []
  }
}

function hasFinalIdleStage(control: RecordValue): boolean {
  const stages = arrayValue(recordValue(recordValue(control.rawRuns).python).stages)
  const final = stages.find((value) => value.stage === 'final_resource_state')
  const response = recordValue(final?.responseBody)
  return final?.status === 200 && (response.state === 'idle' || response.session_id === null)
}

function hasBunRedactedDebugSnapshot(control: RecordValue): boolean {
  const stages = arrayValue(recordValue(recordValue(control.rawRuns).bun).stages)
  const debug = stages.find((value) => value.stage === 'debug_snapshot')
  return debug?.status === 200 && recordValue(debug.responseBody).redacted === true
}

function hasNoCredentialLikeData(value: unknown): boolean {
  const text = JSON.stringify(value)
  return !/(api[_-]?key|authorization|password|secret|access[_-]?token|bearer\s+[a-z0-9._~+/=-]{8,}|sk-[a-z0-9_-]{8,})/i.test(
    text
  )
}

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
