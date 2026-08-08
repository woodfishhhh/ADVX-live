import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import {
  collectRuntimeProfile,
  createRuntimeProfileSample,
  RuntimeProfileError
} from './runtime-profile'

describe('bounded runtime profiling samples', () => {
  test('records memory, CPU, queue depth, and Provider latency correlation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'advx-runtime-profile-'))
    let monotonic = 0
    let wallClock = Date.parse('2026-08-06T00:00:00.000Z')
    let cpu = { user: 1_000, system: 2_000 }
    try {
      const result = await collectRuntimeProfile({
        outputPath: join(root, 'samples.json'),
        durationMs: 100,
        intervalMs: 50,
        now: () => new Date(wallClock),
        monotonicNow: () => monotonic,
        sleep: async (milliseconds) => {
          monotonic += milliseconds
          wallClock += milliseconds
        },
        cpuUsage: (previous) => {
          cpu = {
            user: (previous?.user ?? cpu.user) + 1_000,
            system: (previous?.system ?? cpu.system) + 500
          }
          return cpu
        },
        memoryUsage: () => ({ rss: 10_000, heapTotal: 8_000, heapUsed: 4_000, external: 500 }),
        readQueueDepth: () => 3,
        readProviderLatencyMs: () => 42.5,
        pid: 123
      })
      expect(result.sample_count).toBe(3)
      expect(result.samples.every((sample) => sample.queue_depth === 3)).toBe(true)
      expect(result.samples.every((sample) => sample.provider_latency_ms === 42.5)).toBe(true)
      expect(result.samples[1]?.cpu.user_us).toBe(1_000)
      expect(JSON.parse(await readFile(join(root, 'samples.json'), 'utf8')).sample_count).toBe(3)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects invalid and unbounded readings', () => {
    expect(() => createRuntimeProfileSample({
      now: new Date(),
      elapsedMs: 0,
      pid: 1,
      cpu: { user: 1, system: 1 },
      intervalMs: 100,
      memory: { rss: 1, heapTotal: 1, heapUsed: 1, external: 1 },
      queueDepth: -1
    })).toThrow(RuntimeProfileError)
  })
})
