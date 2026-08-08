import { describe, expect, test } from 'bun:test'

import type { RoomId, SessionId } from '@advx/contracts'

import { createTransientTaskScope } from './transient-runtime-control'
import {
  RoomSessionLifecycle,
  type ApplicationEvent,
  type EventPublisher,
  type SessionResources,
  type TaskScope
} from '../application'
import { monotonicDeadline, wallClockTimestampMs } from '../application/ports'

const ROOM_ID = 'room-agt-013' as RoomId
const SESSION_ID = 'session-agt-013' as SessionId
const SIDE_EFFECT_KEYS = [
  'display',
  'roomEvent',
  'cooldown',
  'privateState',
  'memory',
  'meme',
  'outbox'
] as const

type SideEffectKey = (typeof SIDE_EFFECT_KEYS)[number]
type SideEffectCounts = Record<SideEffectKey, number>

describe('AGT-013 stale work and zero side effects', () => {
  test('cancels every deterministic stale-work schedule before any effect', async () => {
    const schedules = [
      ['stop-during-asr', 'session_stopped'],
      ['new-input-during-viewer-generation', 'runtime_replaced'],
      ['epoch-change-during-repair-retry', 'runtime_replaced'],
      ['viewer-kick-before-result', 'runtime_replaced'],
      ['delayed-batch-after-replacement', 'runtime_replaced'],
      ['backend-crash-before-publication', 'process_shutdown'],
      ['reconnect-with-stale-token', 'runtime_replaced'],
      ['queue-overflow', 'process_shutdown']
    ] as const

    for (const [name, reason] of schedules) {
      const scope = createTransientTaskScope()
      const started = deferred<void>()
      const release = deferred<void>()
      const effects = emptyEffects()
      const task = scope.spawn({
        name,
        run: async (context) => {
          started.resolve()
          await release.promise
          context.throwIfCancelled()
          for (const key of SIDE_EFFECT_KEYS) {
            context.throwIfCancelled()
            effects[key] += 1
          }
        }
      })

      await started.promise
      scope.cancelAll({ code: reason })
      release.resolve()
      const outcome = await Promise.allSettled([task.result])
      await scope.drain()

      expect(outcome[0]?.status).toBe('rejected')
      expect(effects).toEqual(emptyEffects())
    }
  })

  test('rejects a Provider result exactly at its deadline without effects', async () => {
    const scope = createTransientTaskScope()
    const release = deferred<void>()
    const started = deferred<void>()
    const effects = emptyEffects()
    let now = 10
    const task = scope.spawn({
      name: 'provider-deadline-boundary',
      deadline: monotonicDeadline(20),
      run: async (context) => {
        started.resolve()
        await release.promise
        if (now >= Number(context.deadline?.expiresAt ?? Number.POSITIVE_INFINITY)) {
          return 'expired'
        }
        context.throwIfCancelled()
        effects.display += 1
        return 'completed'
      }
    })

    await started.promise
    now = 20
    release.resolve()
    expect(await task.result).toBe('expired')
    expect(effects).toEqual(emptyEffects())
    await scope.drain()
  })

  test('lifecycle replacement cancels the old scope before committing the new epoch', async () => {
    const scopes: TaskScope[] = []
    const lifecycle = createLifecycle(() => {
      const scope = createTransientTaskScope()
      scopes.push(scope)
      return scope
    })
    const running = await lifecycle.start({
      roomId: ROOM_ID,
      clientStartId: 'start-1',
      requestFingerprint: 'fingerprint-1',
      expectedRevision: 0
    })
    const oldScope = scopes[0]
    if (oldScope === undefined) throw new Error('missing initial task scope')

    const started = deferred<void>()
    const release = deferred<void>()
    const cancelled = deferred<void>()
    const effects = emptyEffects()
    const stale = oldScope.spawn({
      name: 'old-epoch-work',
      run: async (context) => {
        context.signal.addEventListener('abort', () => cancelled.resolve(), { once: true })
        started.resolve()
        await release.promise
        context.throwIfCancelled()
        effects.roomEvent += 1
      }
    })
    await started.promise

    const replacement = lifecycle.withRuntimeReplacement(
      {
        roomId: ROOM_ID,
        sessionId: SESSION_ID,
        audienceEpoch: running.audienceEpoch,
        expectedRevision: running.revision
      },
      'runtime_spec_applied',
      async (commit) => {
        const next = commit.commit()
        return next
      }
    )
    await cancelled.promise
    release.resolve()
    const next = await replacement
    expect(next.audienceEpoch).toBe(running.audienceEpoch + 1)
    expect((await Promise.allSettled([stale.result]))[0]?.status).toBe('rejected')
    expect(effects).toEqual(emptyEffects())
    expect(scopes).toHaveLength(2)
  })

  test('lifecycle stop cancels in-flight work before terminal release', async () => {
    const scopes: TaskScope[] = []
    const lifecycle = createLifecycle(() => {
      const scope = createTransientTaskScope()
      scopes.push(scope)
      return scope
    })
    const running = await lifecycle.start({
      roomId: ROOM_ID,
      clientStartId: 'start-stop',
      requestFingerprint: 'fingerprint-stop',
      expectedRevision: 0
    })
    const scope = scopes[0]
    if (scope === undefined) throw new Error('missing stop task scope')
    const started = deferred<void>()
    const release = deferred<void>()
    const cancelled = deferred<void>()
    const effects = emptyEffects()
    const task = scope.spawn({
      name: 'stopping-work',
      run: async (context) => {
        context.signal.addEventListener('abort', () => cancelled.resolve(), { once: true })
        started.resolve()
        await release.promise
        context.throwIfCancelled()
        effects.display += 1
      }
    })
    await started.promise

    const stopping = lifecycle.stop({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      audienceEpoch: running.audienceEpoch,
      expectedRevision: running.revision
    })
    await cancelled.promise
    release.resolve()
    const stopped = await stopping
    expect(stopped.state).toBe('stopped')
    expect((await Promise.allSettled([task.result]))[0]?.status).toBe('rejected')
    expect(effects).toEqual(emptyEffects())
  })
})

function emptyEffects(): SideEffectCounts {
  return {
    display: 0,
    roomEvent: 0,
    cooldown: 0,
    privateState: 0,
    memory: 0,
    meme: 0,
    outbox: 0
  }
}

function deferred<TResult>(): {
  readonly promise: Promise<TResult>
  readonly resolve: (value: TResult) => void
} {
  let resolve!: (value: TResult) => void
  const promise = new Promise<TResult>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function createLifecycle(createTaskScope: () => TaskScope): RoomSessionLifecycle {
  let now = 1
  const events: EventPublisher = {
    async publish(_event: ApplicationEvent): Promise<void> {}
  }
  const resources: SessionResources = {
    async start(): Promise<void> {},
    async pause(): Promise<void> {},
    async resume(): Promise<void> {},
    async recover(): Promise<void> {},
    async release(): Promise<void> {}
  }
  return new RoomSessionLifecycle({
    wallClock: { now: () => wallClockTimestampMs(now++) },
    roomIds: { nextId: () => ROOM_ID },
    sessionIds: { nextId: () => SESSION_ID },
    eventIds: { nextId: () => `event-${now++}` },
    createTaskScope,
    events,
    resources
  })
}
