import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

type VitestAssertion = Readonly<{
  fullName?: string
  title?: string
  status?: string
}>

type VitestReport = Readonly<{
  numTotalTests: number
  numPassedTests: number
  numFailedTests: number
  numPendingTests: number
  testResults: readonly Readonly<{
    assertionResults?: readonly VitestAssertion[]
  }>[]
}>

const expectedScenarios = [
  'updates LiveStage from the control store through pause, clear, resume, and stop',
  'renders overlay barrage order and clear events',
  'shows backend loss, failure, retry, and reconnect notices',
  'keeps microphone and system-audio identities distinct in permission states',
  'focuses the source dialog, reports permission errors, and closes on Escape'
] as const

const coverage = [
  'store_to_component_updates',
  'overlay_rendering_and_ordering',
  'pause_clear_stop_transitions',
  'backend_loss_and_reconnect_ui',
  'microphone_system_audio_identity',
  'permission_and_error_states',
  'accessibility_focus_and_keyboard'
] as const

const packageRoot = resolve(import.meta.dir, '..')
const repositoryRoot = resolve(packageRoot, '..', '..')
const artifactRoot = process.env.ADVX_TST007_ARTIFACT_ROOT === undefined
  ? join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'tst-007')
  : resolve(process.env.ADVX_TST007_ARTIFACT_ROOT)
const vitestArtifactRoot = join(artifactRoot, 'vitest')
const resultPath = join(vitestArtifactRoot, 'vitest-results.json')
const vitestCli = join(repositoryRoot, 'node_modules', 'vitest', 'vitest.mjs')
const nodeExecutable = process.env.ADVX_NODE_EXECUTABLE?.trim() || 'node'
const chromiumExecutable = process.env.ADVX_CHROMIUM_EXECUTABLE ?? (
  process.platform === 'win32'
    ? [
        'C:/Program Files/Google/Chrome/Application/chrome.exe',
        'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
        process.env.LOCALAPPDATA
          ? join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe')
          : '',
        'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
        'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
      ].find((candidate) => candidate !== '' && existsSync(candidate))
    : undefined
)

await mkdir(vitestArtifactRoot, { recursive: true })

const nodeVersionProbe = Bun.spawn([nodeExecutable, '--version'], {
  cwd: repositoryRoot,
  stdin: 'ignore',
  stdout: 'pipe',
  stderr: 'ignore'
})
const nodeVersion = (await new Response(nodeVersionProbe.stdout).text()).trim()
if (await nodeVersionProbe.exited !== 0 || nodeVersion === '') {
  throw new Error(`TST-007 could not identify Node executable: ${nodeExecutable}`)
}

const child = Bun.spawn([
  nodeExecutable,
  vitestCli,
  'run',
  '--config',
  join(repositoryRoot, 'vitest.config.ts'),
  '--project',
  'desktop-browser'
], {
  cwd: repositoryRoot,
  env: {
    ...process.env,
    ADVX_VITEST_ARTIFACT_ROOT: vitestArtifactRoot,
    ...(chromiumExecutable
      ? { ADVX_CHROMIUM_EXECUTABLE: chromiumExecutable }
      : {})
  },
  stdin: 'ignore',
  stdout: 'inherit',
  stderr: 'inherit'
})

const exitCode = await child.exited
if (exitCode !== 0) process.exit(exitCode)

const resultBytes = await readFile(resultPath)
const report = JSON.parse(resultBytes.toString('utf8')) as VitestReport
const assertionNames = report.testResults.flatMap((result) =>
  (result.assertionResults ?? []).map((assertion) =>
    assertion.fullName ?? assertion.title ?? ''
  )
)
const missingScenarios = expectedScenarios.filter((scenario) =>
  !assertionNames.some((name) => name.includes(scenario))
)

if (
  report.numTotalTests !== expectedScenarios.length ||
  report.numPassedTests !== expectedScenarios.length ||
  report.numFailedTests !== 0 ||
  report.numPendingTests !== 0 ||
  missingScenarios.length > 0
) {
  throw new Error(
    `TST-007 browser report is incomplete: ${JSON.stringify({
      total: report.numTotalTests,
      passed: report.numPassedTests,
      failed: report.numFailedTests,
      pending: report.numPendingTests,
      missingScenarios
    })}`
  )
}

const manifest = {
  schema_version: 1,
  task_id: 'TST-007',
  status: 'passed',
  fixture_class: 'deterministic_real_chromium_renderer',
  browser: {
    provider: 'playwright',
    engine: 'chromium',
    headless: true,
    executable: chromiumExecutable ?? 'playwright-managed'
  },
  source_boundaries: [
    'control Zustand store and LiveStage',
    'overlay App and overlay preload callback contract',
    'useBackendRuntime and AppShell notice UI',
    'LiveDeviceStrip microphone and system-audio controls',
    'SourcePickerDialog permission and keyboard behavior'
  ],
  scenarios: expectedScenarios,
  coverage,
  evidence_boundary: {
    proves: 'renderer behavior in a real Chromium page',
    does_not_replace: 'Electron preload, IPC, window, or OS-integration E2E'
  },
  result: {
    path: 'vitest/vitest-results.json',
    sha256: createHash('sha256').update(resultBytes).digest('hex'),
    total: report.numTotalTests,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    pending: report.numPendingTests
  },
  runtime: {
    bun: Bun.version,
    bun_node_api: process.versions.node,
    vitest_process: nodeExecutable,
    vitest_node: nodeVersion,
    platform: process.platform,
    arch: process.arch
  }
} as const

await writeJsonAtomic(join(artifactRoot, 'manifest.json'), manifest)
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}
