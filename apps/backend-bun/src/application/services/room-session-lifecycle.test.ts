import { describe, expect, test } from 'bun:test'

import type { ApplicationEvent, IdGenerator } from '../ports'
import { createTraceContext, wallClockTimestampMs } from '../ports'
import {
  RoomSessionLifecycle,
  RoomSessionLifecycleError,
  type LifecycleCommandIdentity,
  type RoomSessionLifecycleDependencies,
  type RoomSessionLifecycleErrorCode
} from './room-session-lifecycle'

class SequenceIds<TId extends string> implements IdGenerator<TId> {
  #index = 0

  constructor(private readonly values: readonly TId[]) {}

  nextId(): TId {
    const value = this.values[this.#index]
    if (value === undefined) throw new Error('test IDs exhausted')
    this.#index += 1
    return value
  }
}

class FakeTaskScope {
  cancelCount = 0
  drainCount = 0
  failDrain = false

  spawn(): never {
    throw new Error('not used by BCK-005')
  }

  cancelAll(): void {
    this.cancelCount += 1
  }

  async drain(): Promise<void> {
    this.drainCount += 1
    if (this.failDrain) throw new Error('RAW_TASK_CANARY')
  }
}

function harness() {
  let now = 100
  const events: ApplicationEvent[] = []
  const resourceCalls: string[] = []
  const scopes: FakeTaskScope[] = []
  let failPublishState: string | null = null
  let failRelease = false
  const dependencies = {
    wallClock: { now: () => wallClockTimestampMs(now++) },
    roomIds: new SequenceIds(['room-1']),
    sessionIds: new SequenceIds(['session-1']),
    eventIds: new SequenceIds(Array.from({ length: 30 }, (_, index) => `event-${index + 1}`)),
    createTaskScope: () => {
      const scope = new FakeTaskScope()
      scopes.push(scope)
      return scope
    },
    events: {
      async publish(event: ApplicationEvent) {
        const state = (event.payload as { state?: string }).state ?? null
        if (state === failPublishState) throw new Error('RAW_PUBLISH_CANARY')
        events.push(event)
      }
    },
    resources: {
      async start(identity) {
        resourceCalls.push(`start:${identity.audienceEpoch}`)
      },
      async pause(identity) {
        resourceCalls.push(`pause:${identity.audienceEpoch}`)
      },
      async resume(identity) {
        resourceCalls.push(`resume:${identity.audienceEpoch}`)
      },
      async recover(identity) {
        resourceCalls.push(`recover:${identity.audienceEpoch}`)
      },
      async release(identity) {
        resourceCalls.push(`release:${identity.audienceEpoch}`)
        if (failRelease) throw new Error('RAW_RELEASE_CANARY')
      }
    }
  } satisfies RoomSessionLifecycleDependencies
  const lifecycle = new RoomSessionLifecycle(dependencies)

  return {
    lifecycle,
    dependencies,
    events,
    resourceCalls,
    scopes,
    setFailPublishState(state: string | null) {
      failPublishState = state
    },
    setFailRelease(value: boolean) {
      failRelease = value
    }
  }
}

async function start(lifecycle: RoomSessionLifecycle) {
  return await lifecycle.start({
    roomId: lifecycle.roomId,
    clientStartId: 'client-start-1',
    requestFingerprint: 'request-v1',
    expectedRevision: 0,
    traceContext: createTraceContext({ traceId: 'trace-lifecycle' })
  })
}

function command(lifecycle: RoomSessionLifecycle): LifecycleCommandIdentity {
  const snapshot = lifecycle.snapshot
  if (snapshot.sessionId === null) throw new Error('session not started')
  return {
    roomId: snapshot.roomId,
    sessionId: snapshot.sessionId,
    audienceEpoch: snapshot.audienceEpoch,
    expectedRevision: snapshot.revision,
    traceContext: createTraceContext({ traceId: 'trace-lifecycle' })
  }
}

function states(events: readonly ApplicationEvent[]): string[] {
  return events.map((event) => (event.payload as { state: string }).state)
}

async function expectCode(
  promise: Promise<unknown>,
  code: RoomSessionLifecycleErrorCode
) {
  try {
    await promise
    throw new Error('expected lifecycle rejection')
  } catch (error) {
    expect(error).toBeInstanceOf(RoomSessionLifecycleError)
    expect((error as RoomSessionLifecycleError).code).toBe(code)
  }
}

describe('BCK-005 Room/Session lifecycle', () => {
  test('publishes the exact immutable happy transition order', async () => {
    const { lifecycle, events, resourceCalls, scopes } = harness()

    const running = await start(lifecycle)
    const paused = await lifecycle.pause(command(lifecycle))
    const resumed = await lifecycle.resume(command(lifecycle))
    const stopped = await lifecycle.stop(command(lifecycle))

    expect(states(events)).toEqual([
      'starting',
      'running',
      'paused',
      'running',
      'stopping',
      'stopped'
    ])
    expect(events.map((event) => (event.payload as { revision: number }).revision)).toEqual([
      1, 2, 3, 4, 5, 6
    ])
    expect(events.map((event) => Number(event.occurredAt))).toEqual([102, 103, 104, 105, 106, 108])
    expect(events.every((event) => Object.isFrozen(event) && Object.isFrozen(event.payload))).toBe(true)
    expect([running, paused, resumed, stopped].every(Object.isFrozen)).toBe(true)
    expect(stopped.sessionId).toBe(running.sessionId)
    expect(stopped.roomId).toBe('room-1')
    expect(stopped.audienceEpoch).toBe(1)
    expect(resourceCalls).toEqual(['start:1', 'pause:1', 'resume:1', 'release:1'])
    expect(events.every((event) => event.traceContext?.traceId === 'trace-lifecycle')).toBe(true)
    expect(scopes[0]?.cancelCount).toBe(1)
    expect(scopes[0]?.drainCount).toBe(1)
  })

  test('makes start identity idempotent and conflicting reuse fail closed', async () => {
    const { lifecycle, events, resourceCalls } = harness()
    const first = await start(lifecycle)
    const replay = await lifecycle.start({
      roomId: lifecycle.roomId,
      clientStartId: 'client-start-1',
      requestFingerprint: 'request-v1',
      expectedRevision: 0
    })

    expect(replay).toBe(first)
    await expectCode(
      lifecycle.start({
        roomId: lifecycle.roomId,
        clientStartId: 'client-start-1',
        requestFingerprint: 'conflicting-request',
        expectedRevision: first.revision
      }),
      'start_identity_conflict'
    )
    expect(states(events)).toEqual(['starting', 'running'])
    expect(resourceCalls).toEqual(['start:1'])
  })

  test('rejects illegal pause/resume and stale or wrong identity before side effects', async () => {
    const { lifecycle, events, resourceCalls } = harness()
    const running = await start(lifecycle)
    const baseline = [events.length, resourceCalls.length]

    await expectCode(lifecycle.resume(command(lifecycle)), 'illegal_transition')
    await expectCode(
      lifecycle.pause({ ...command(lifecycle), expectedRevision: running.revision - 1 }),
      'revision_conflict'
    )
    await expectCode(
      lifecycle.pause({ ...command(lifecycle), audienceEpoch: 99 }),
      'stale_audience_epoch'
    )
    await expectCode(
      lifecycle.pause({ ...command(lifecycle), sessionId: 'session-wrong' }),
      'wrong_session'
    )
    await expectCode(
      lifecycle.pause({ ...command(lifecycle), roomId: 'room-wrong' }),
      'wrong_room'
    )
    expect([events.length, resourceCalls.length]).toEqual(baseline)
  })

  test('recovers eligible degraded work with a stable Session ID and new epoch', async () => {
    const { lifecycle, dependencies, events, resourceCalls, scopes } = harness()
    const initial = await start(lifecycle)
    const degraded = await lifecycle.degrade(command(lifecycle))
    const recoveredLifecycle = new RoomSessionLifecycle(dependencies, degraded)
    const recovered = await recoveredLifecycle.recover(command(recoveredLifecycle))

    expect(degraded.recoveryEligible).toBe(true)
    expect(recovered.sessionId).toBe(initial.sessionId)
    expect(recovered.audienceEpoch).toBe(2)
    expect(states(events).slice(-3)).toEqual(['degraded', 'starting', 'running'])
    expect(resourceCalls).toContain('recover:2')
    expect(scopes[0]?.cancelCount).toBe(0)
    expect(scopes[0]?.drainCount).toBe(0)
    expect(scopes).toHaveLength(2)

    await expectCode(
      recoveredLifecycle.pause({ ...command(recoveredLifecycle), audienceEpoch: 1 }),
      'stale_audience_epoch'
    )
    const failed = await recoveredLifecycle.fail({
      ...command(recoveredLifecycle),
      recoveryEligible: false
    })
    expect(failed.state).toBe('failed')
    await expectCode(
      recoveredLifecycle.recover(command(recoveredLifecycle)),
      'recovery_not_allowed'
    )
    expect(
      () => new RoomSessionLifecycle(dependencies, { ...failed, state: 'stopped' })
    ).toThrow('recovery_not_allowed')
  })

  test('stops terminally and releases exactly once despite cleanup failures', async () => {
    const fixture = harness()
    const { lifecycle, events, resourceCalls, scopes } = fixture
    const running = await start(lifecycle)
    scopes[0]!.failDrain = true
    fixture.setFailPublishState('stopping')
    fixture.setFailRelease(true)

    await expectCode(lifecycle.stop(command(lifecycle)), 'publication_failed')
    expect(lifecycle.snapshot.state).toBe('stopped')
    expect(lifecycle.snapshot.recoveryEligible).toBe(false)
    expect(scopes[0]?.cancelCount).toBe(1)
    expect(scopes[0]?.drainCount).toBe(1)
    expect(resourceCalls.filter((call) => call.startsWith('release:'))).toHaveLength(1)
    expect(JSON.stringify(lifecycle.snapshot)).not.toContain('CANARY')

    const stopped = await lifecycle.stop(command(lifecycle))
    await expectCode(lifecycle.pause(command(lifecycle)), 'illegal_transition')
    await expectCode(lifecycle.recover(command(lifecycle)), 'recovery_not_allowed')
    const replay = await lifecycle.start({
      roomId: lifecycle.roomId,
      clientStartId: 'client-start-1',
      requestFingerprint: 'request-v1',
      expectedRevision: running.revision
    })
    expect(stopped).toBe(lifecycle.snapshot)
    expect(replay).toBe(lifecycle.snapshot)
    expect(resourceCalls.filter((call) => call.startsWith('release:'))).toHaveLength(1)
    expect(states(events).at(-1)).toBe('stopped')
  })
})
