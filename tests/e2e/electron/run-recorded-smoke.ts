import { resolve } from 'node:path'

import { runRecordedElectronScenario } from './recorded-electron.fixture.ts'

const artifactRoot = process.env.ADVX_RECORDED_SMOKE_ARTIFACT_ROOT?.trim()
if (!artifactRoot) throw new Error('ADVX_RECORDED_SMOKE_ARTIFACT_ROOT is required')

const result = await runRecordedElectronScenario({
  artifactDirectory: resolve(artifactRoot),
  backendRuntime: 'bun-source',
  scenario: 'full-pipeline'
})

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
if (result.status !== 'passed') process.exitCode = 1
