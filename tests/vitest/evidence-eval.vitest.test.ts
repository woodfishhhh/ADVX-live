import { describe, expect, test } from 'vitest'
import { formatBunFailure, runBunCommand, runBunTests } from './bun-suite'

const evidenceAndEvalTests = [
  'apps/backend-bun/src/application/evaluation/agent-evaluator.test.ts'
]

describe('evidence and evaluation project', () => {
  test('runs the live migration evidence checker in Bun', async () => {
    const result = await runBunCommand(
      ['scripts/migration-plan-check.ts'],
      30_000
    )
    expect(result.exitCode, formatBunFailure(result)).toBe(0)
  })

  test('runs deterministic evidence and evaluation suites in Bun', async () => {
    const result = await runBunTests(evidenceAndEvalTests, {
      processTimeoutMs: 105_000
    })
    expect(result.exitCode, formatBunFailure(result)).toBe(0)
  })
})
