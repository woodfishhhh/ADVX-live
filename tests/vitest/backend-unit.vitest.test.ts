import { describe, expect, test } from 'vitest'
import { collectTestFiles, formatBunFailure, runBunTests } from './bun-suite'

describe('backend unit project', () => {
  test('runs Bun unit tests in the Bun runtime', async () => {
    const files = await collectTestFiles('apps/backend-bun/src', (path) => (
      path.endsWith('.test.ts')
      && !path.endsWith('.integration.test.ts')
      && !path.includes('/application/evaluation/')
    ))

    expect(files.length).toBeGreaterThan(0)
    const result = await runBunTests(files, { processTimeoutMs: 180_000 })
    expect(result.exitCode, formatBunFailure(result)).toBe(0)
  })
})
