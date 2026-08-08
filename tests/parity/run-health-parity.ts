import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { createHealthCandidate } from './health-candidate'
import { runParityCase, type ParityOutput } from './harness'

function decodeOracle(stdout: string): ParityOutput {
  const payload = JSON.parse(stdout) as {
    json: unknown
    binary_base64: string
  }
  return {
    json: payload.json,
    binary: Uint8Array.from(Buffer.from(payload.binary_base64, 'base64'))
  }
}

const reportPath = process.env.ADVX_PARITY_REPORT ??
  join(tmpdir(), `advx-health-parity-${process.pid}.json`)
const report = await runParityCase({
  caseId: 'python-health-vs-typescript-fixture',
  oracleCommand: [
    'uv',
    'run',
    '--project',
    'apps/backend',
    'python',
    'tests/parity/python_health_oracle.py'
  ],
  candidateCommand: 'typescript:createHealthCandidate',
  candidate: createHealthCandidate,
  decodeOracle,
  nondeterminism: [
    { path: 'metadata.observation_id', kind: 'volatile-id' },
    { path: 'metadata.observed_at_ms', kind: 'timestamp' }
  ],
  reportPath
})

console.log(JSON.stringify({ reportPath, report }, null, 2))
if (report.status !== 'passed') {
  process.exitCode = 1
}
