import { describe, expect, test } from 'vitest'
import { formatBunFailure, runBunTests } from './bun-suite'

const contractTests = [
  'packages/contracts/test/schema.test.ts',
  'packages/contracts/test/binary.test.ts',
  'packages/contracts/test/protocol-compatibility.test.ts'
]

describe('repository contracts project', () => {
  test('runs contract suites in the Bun runtime', async () => {
    const result = await runBunTests(contractTests, { processTimeoutMs: 60_000 })
    expect(result.exitCode, formatBunFailure(result)).toBe(0)
  })
})
