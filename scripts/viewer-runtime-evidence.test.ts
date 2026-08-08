import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { SCRIPT_EXIT, ScriptError } from './evidence-script-runtime.ts'
import {
  assertRedactedValue,
  verifyViewerRuntimeEvidence
} from './viewer-runtime-evidence.ts'

const repositoryRoot = resolve(import.meta.dir, '..')
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ))
})

describe('viewer runtime TypeScript evidence', () => {
  test('projects the real recorded fixture to the current contract without mutating it', async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'advx-tst-009-test-'))
    temporaryRoots.push(temporaryRoot)
    const artifactRoot = join(temporaryRoot, 'artifacts')
    const fixturePath = join(
      repositoryRoot,
      'tests',
      'fixtures',
      'cs2',
      'viewer_runtime_recorded.json'
    )
    const before = await readFile(fixturePath)
    const result = await verifyViewerRuntimeEvidence({
      fixturePath,
      artifactRoot,
      repositoryRoot,
      timeoutMs: 15_000
    })
    const after = await readFile(fixturePath)

    expect(result.status).toBe('passed')
    expect(result.fixture.unchanged).toBe(true)
    expect(result.replay.event_count).toBe(6)
    expect(result.replay.consumed_provider_roles).toEqual([
      'viewer',
      'visual_summary',
      'memory',
      'asr'
    ])
    expect(result.artifact_hashes_verified).toBe(true)
    expect(after.equals(before)).toBe(true)
  })

  test('rejects a credential field with a stable verification exit code', () => {
    try {
      assertRedactedValue({ redacted: true, provider: { api_key: 'not-even-a-real-key' } })
      throw new Error('redaction validation unexpectedly passed')
    } catch (error) {
      expect(error).toBeInstanceOf(ScriptError)
      expect((error as ScriptError).exitCode).toBe(SCRIPT_EXIT.verificationFailed)
    }
  })
})
