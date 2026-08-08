import { afterEach, describe, expect, test } from 'bun:test'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  HEADLESS_EXIT_CODES,
  HeadlessHarness,
  type HeadlessRunner
} from './headless-harness'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Bun headless harness', () => {
  test('runs a deterministic fixture in an isolated directory and retains artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'advx-headless-test-'))
    roots.push(root)
    const artifactRoot = join(root, 'artifacts')
    const harness = new HeadlessHarness({ tempRoot: root })
    const result = await harness.execute({
      command: 'scenario',
      fixture: 'synthetic-smoke',
      provider_mode: 'fake',
      seed: 6657,
      virtual_clock_start_ms: 1_000,
      artifact_root: artifactRoot,
      deadline_ms: 1_000
    })

    expect(result).toMatchObject({
      ok: true,
      exit_code: HEADLESS_EXIT_CODES.ok,
      result: {
        deterministic_proof: true,
        seed: 6657,
        virtual_clock_start_ms: 1_000
      },
      metadata: {
        isolated_data_directory: true,
        temporary_directory_cleaned: true,
        cleanup: { attempted: true, failures: [], remaining: { backend: 0, socket: 0, task: 0, database: 0, capture_producer: 0 } }
      }
    })
    expect(JSON.parse(await readFile(join(artifactRoot, 'result.json'), 'utf8'))).toEqual(result)
    await access(join(artifactRoot, 'lifecycle.json'))
  })

  test('cleans registered backend and capture resources after a timed run', async () => {
    const root = await mkdtemp(join(tmpdir(), 'advx-headless-timeout-'))
    roots.push(root)
    let cleaned = 0
    const runner: HeadlessRunner = async (context) => {
      context.register({ kind: 'backend', label: 'fixture-backend', cleanup: () => { cleaned += 1 } })
      context.register({ kind: 'capture_producer', label: 'fixture-capture', cleanup: () => { cleaned += 1 } })
      await new Promise<void>((resolve) => context.signal.addEventListener('abort', () => resolve(), { once: true }))
      return { result: { aborted: context.signal.aborted } }
    }
    const result = await new HeadlessHarness({ runner, tempRoot: root, cleanupGraceMs: 20 }).execute({
      command: 'scenario',
      deadline_ms: 10,
      artifact_root: join(root, 'artifacts')
    })

    expect(result).toMatchObject({
      ok: false,
      exit_code: HEADLESS_EXIT_CODES.deadlineExceeded,
      error: { code: 'deadline_exceeded' },
      metadata: {
        forced_cleanup: true,
        timed_out: true,
        temporary_directory_cleaned: true,
        cleanup: { failures: [], remaining: { backend: 0, capture_producer: 0 } }
      }
    })
    expect(cleaned).toBe(2)
  })

  test('uses deterministic validation errors without creating run resources', async () => {
    const result = await new HeadlessHarness().execute({ command: 'unsupported' })
    expect(result).toMatchObject({
      ok: false,
      exit_code: HEADLESS_EXIT_CODES.invalidInput,
      error: { code: 'invalid_input' },
      metadata: { run_id: 'not-started', temporary_directory_cleaned: true }
    })
  })
})
