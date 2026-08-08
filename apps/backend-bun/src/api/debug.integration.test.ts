import { describe, expect, test } from 'bun:test'

import { createApp } from '../app'
import { BoundedDebugEventStore } from './debug'
import { InMemoryBackendProfileReader } from '../providers'

const TOKEN = 'd'.repeat(43)

describe('authenticated Bun debug snapshot API', () => {
  test('returns bounded redacted state and rejects unauthenticated or oversized queries', async () => {
    const events = new BoundedDebugEventStore()
    events.append({
      timestamp: '2026-08-06T00:00:00.000Z',
      level: 'error',
      event: 'backend.failure.v1',
      reason: 'degraded_startup'
    })
    events.append({
      timestamp: '2026-08-06T00:00:01.000Z',
      level: 'info',
      event: 'backend.ready.v1'
    })
    const app = createApp(
      { profileReader: new InMemoryBackendProfileReader({ name: '@advx/backend-bun', runtime: 'bun' }) },
      {
        mode: 'production',
        system: {
          authorize: (authorization) => authorization === `Bearer ${TOKEN}`,
          readiness: () => ({ contract: true, database: true, runtime: true }),
          backendVersion: 'test-version',
          buildId: 'test-build'
        },
        debug: {
          events,
          providers: [{ id: 'test-provider', model: 'viewer-v1', baseUrl: 'https://provider.test/v1?token=secret' }],
          database: { health: () => ({ status: 'ready', ready: true, writableOwnerHeld: true, journalMode: 'wal', busyTimeoutMs: 5_000, foreignKeys: true, synchronous: 'normal', quickCheck: 'ok', failureCode: null }) },
          captureSources: () => [{ source: 'microphone', status: 'active' }]
        }
      }
    )

    const unauthorized = await app.api.handle(new Request('http://localhost/debug/snapshot', {
      headers: { 'x-advx-protocol-version': '3' }
    }))
    expect(unauthorized.status).toBe(401)

    const response = await request(app.api, '/debug/snapshot?limit=1')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      schema_version: 1,
      redacted: true,
      backend: { backend_version: 'test-version', build_id: 'test-build' },
      session: { session_id: null, audience_epoch: null },
      database: { schema_version: 1, status: 'ready' },
      capture_sources: { items: [{ source: 'microphone', status: 'active' }] },
      providers: { items: [{ id: 'test-provider', model: 'viewer-v1', base_url: 'https://provider.test/v1', circuit: 'unknown' }] },
      events: { items: [{ event: 'backend.failure.v1', reason: 'degraded_startup' }], next_cursor: '1', last_fatal_or_degraded_reason: 'degraded_startup' },
      last_fatal_or_degraded_reason: 'degraded_startup'
    })
    expect(body).not.toHaveProperty('providers.items[0].credentialRef')

    const next = await request(app.api, '/debug/snapshot?limit=1&cursor=1')
    expect((await next.json()).events.items).toEqual([{ timestamp: '2026-08-06T00:00:01.000Z', level: 'info', event: 'backend.ready.v1' }])

    const oversized = await request(app.api, '/debug/snapshot?limit=101')
    expect(oversized.status).toBe(422)

    const unsupported = await app.api.handle(new Request('http://localhost/debug/snapshot', {
      headers: { authorization: `Bearer ${TOKEN}` }
    }))
    expect(unsupported.status).toBe(422)
  })

  test('includes the active session epoch from the runtime control boundary', async () => {
    const session = {
      session_id: 'session-debug',
      state: 'running' as const,
      started_at_ms: 10,
      updated_at_ms: 11,
      revision: 2
    }
    const runtimeControl = {
      currentSession: () => session,
      currentRuntimeSession: async () => ({ audience_epoch: 7 }),
      pauseSession: async () => session,
      resumeSession: async () => session,
      stopSession: async () => session,
      startRuntimeSession: async () => ({ audience_epoch: 7 }),
      applyRuntimeSpec: async () => ({ audience_epoch: 7 }),
      rollbackRuntimeSpec: async () => ({ audience_epoch: 7 }),
      recoverRuntimeSession: async () => ({ audience_epoch: 7 })
    }
    const app = createApp(
      {
        profileReader: new InMemoryBackendProfileReader({ name: '@advx/backend-bun', runtime: 'bun' }),
        runtimeControl: runtimeControl as never
      },
      {
        mode: 'production',
        system: {
          authorize: (authorization) => authorization === `Bearer ${TOKEN}`,
          readiness: () => ({ contract: true, database: true, runtime: true }),
          backendVersion: 'test-version',
          buildId: 'test-build'
        }
      }
    )
    const response = await request(app.api, '/debug/snapshot')
    expect(response.status).toBe(200)
    expect((await response.json()).session).toMatchObject({
      session_id: 'session-debug',
      state: 'running',
      audience_epoch: 7
    })
  })
})

async function request(api: { handle(request: Request): Response | Promise<Response> }, path: string) {
  return api.handle(new Request(`http://localhost${path}`, {
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'x-advx-protocol-version': '3'
    }
  }))
}
