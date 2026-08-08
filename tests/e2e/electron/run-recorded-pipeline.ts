import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import {
  runRecordedElectronScenario,
  type RecordedElectronScenarioOptions,
  type RecordedElectronScenarioResult
} from './recorded-electron.fixture.ts'

const artifactRootValue = process.env.ADVX_TST008_ARTIFACT_ROOT
const compiledExecutable = process.env.ADVX_TST008_COMPILED_EXECUTABLE
if (!artifactRootValue) throw new Error('ADVX_TST008_ARTIFACT_ROOT is required')
if (!compiledExecutable) throw new Error('ADVX_TST008_COMPILED_EXECUTABLE is required')

const artifactRoot = resolve(artifactRootValue)
const cases: readonly RecordedElectronScenarioOptions[] = [
  {
    artifactDirectory: join(artifactRoot, 'bun-source-full-pipeline'),
    backendRuntime: 'bun-source',
    scenario: 'full-pipeline'
  },
  {
    artifactDirectory: join(artifactRoot, 'bun-compiled-recorded-lifecycle'),
    backendRuntime: 'bun-compiled',
    compiledExecutable,
    scenario: 'recorded-lifecycle'
  }
]
const results: RecordedElectronScenarioResult[] = []
let failure: unknown

for (const scenario of cases) {
  try {
    results.push(await runRecordedElectronScenario(scenario))
  } catch (error) {
    failure = error
    const resultPath = join(scenario.artifactDirectory, 'result.json')
    try {
      results.push(JSON.parse(await readFile(resultPath, 'utf8')) as RecordedElectronScenarioResult)
    } catch {
      // The thrown error remains authoritative if no result could be written.
    }
    break
  }
}

const suite = {
  schema_version: 1,
  task_id: 'TST-008',
  status: failure === undefined && results.length === cases.length &&
    results.every((result) => result.status === 'passed')
    ? 'passed'
    : 'failed',
  normal_ci_scenario: 'bun-source/full-pipeline',
  explicit_jobs: [
    'credentialed-provider-matrix',
    'non-Windows-platform-matrix'
  ],
  artifact_policy: {
    on_failure: ['playwright-trace', 'window-screenshots', 'redacted-application-log'],
    always: ['structured-console-page-process-diagnostics'],
    video: 'disabled because the short deterministic scenario is better diagnosed by trace and screenshots'
  },
  results
} as const

await writeJsonAtomic(join(artifactRoot, 'suite.json'), suite)
process.stdout.write(`${JSON.stringify(suite, null, 2)}\n`)
if (failure !== undefined) throw failure

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}
