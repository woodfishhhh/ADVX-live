import { describe, test } from 'bun:test'
import * as fc from 'fast-check'

import type {
  CanonicalRuntimeSpec,
  Epoch,
  Revision,
  RoomId,
  SessionId,
  ViewerId
} from '@advx/contracts'

import {
  RoomSessionLifecycle,
  SessionAudienceService,
  transactionContext,
  wallClockTimestampMs,
  type ApplicationEvent,
  type EventPublisher,
  type SessionAudienceDependencies,
  type SessionResources,
  type TaskScope,
  type ViewerInstanceRecord,
  type ViewerInstanceRepository,
  type ViewerPoolUpdate,
  type ViewerRevisionFence
} from '../application'
import { createTransientTaskScope } from '../infrastructure'
import { assertSeededProperty } from './fast-check-evidence'

const ROOM_ID = 'room-tst-004' as RoomId
const SESSION_ID = 'session-tst-004' as SessionId

describe('TST-004 seeded runtime properties', () => {
  test('[monotonic-sequence-fences] handles only the next Viewer sequence', async () => {
    await assertSeededProperty(
      'monotonic-sequence-fences',
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 32 }), {
          minLength: 1,
          maxLength: 48
        }),
        async (proposals) => {
          const audience = await createAudience()
          const viewer = audience.activeViewers()[0]!
          let acceptedSequence = viewer.viewerSequence

          for (const proposal of proposals) {
            const accepted = audience.claimViewerSequence(
              viewer.viewerInstanceId,
              proposal,
              wallClockTimestampMs(2_000)
            )
            const expected = proposal === acceptedSequence + 1
            invariant(accepted === expected, 'sequence acceptance diverged from next-only model')
            if (accepted) acceptedSequence = proposal
            if (acceptedSequence > 0) {
              invariant(
                audience.fenceCurrent(sequenceFence(viewer, acceptedSequence)),
                'latest accepted sequence fence is not current'
              )
              if (acceptedSequence > 1) {
                invariant(
                  !audience.fenceCurrent(sequenceFence(viewer, acceptedSequence - 1)),
                  'older sequence fence remained current'
                )
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  test('[epoch-invalidation] advances epochs and rejects every old work fence', async () => {
    await assertSeededProperty(
      'epoch-invalidation',
      fc.asyncProperty(
        fc.array(fc.integer({ min: 1, max: 4 }), {
          minLength: 1,
          maxLength: 12
        }),
        async (advances) => {
          const harness = lifecycleHarness()
          let current = await harness.lifecycle.start(startCommand())

          for (const advance of advances) {
            const oldCommand = lifecycleCommand(current)
            for (let index = 0; index < advance; index += 1) {
              const previousEpoch = current.audienceEpoch
              const command = lifecycleCommand(current)
              current = await harness.lifecycle.withRuntimeReplacement(
                command,
                'runtime_spec_applied',
                async (commit) => commit.commit()
              )
              invariant(
                current.audienceEpoch === previousEpoch + 1,
                'runtime replacement did not advance epoch exactly once'
              )
            }
            invariant(
              !harness.lifecycle.acceptsWork(oldCommand),
              'work from an older epoch remained accepted'
            )
            invariant(
              harness.lifecycle.acceptsWork(lifecycleCommand(current)),
              'current epoch work was rejected'
            )
          }
        }
      ),
      { numRuns: 75 }
    )
  })

  test('[stop-dispose-idempotence] releases once under repeated concurrent stop', async () => {
    await assertSeededProperty(
      'stop-dispose-idempotence',
      fc.asyncProperty(fc.integer({ min: 2, max: 12 }), async (repeatCount) => {
        const harness = lifecycleHarness()
        const running = await harness.lifecycle.start(startCommand())
        const command = lifecycleCommand(running)
        const results = await Promise.all(
          Array.from({ length: repeatCount }, () => harness.lifecycle.stop(command))
        )

        invariant(results.every((snapshot) => snapshot.state === 'stopped'))
        invariant(
          results.every((snapshot) => snapshot.revision === results[0]!.revision),
          'idempotent stop returned divergent terminal revisions'
        )
        invariant(harness.releaseCalls === 1, 'resources were released more than once')
        invariant(
          harness.states.filter((state) => state === 'stopped').length === 1,
          'terminal state was published more than once'
        )
        await Promise.all(harness.scopes.flatMap((scope) => [scope.drain(), scope.drain()]))
      }),
      { numRuns: 75 }
    )
  })

  test('[cancellation-dominates-late-completion] cancelled tasks have zero effects', async () => {
    await assertSeededProperty(
      'cancellation-dominates-late-completion',
      fc.asyncProperty(
        fc.record({
          taskCount: fc.integer({ min: 1, max: 24 }),
          cancelCalls: fc.integer({ min: 1, max: 8 }),
          reason: fc.constantFrom(
            'session_stopped',
            'runtime_replaced',
            'process_shutdown'
          )
        }),
        async ({ taskCount, cancelCalls, reason }) => {
          const scope = createTransientTaskScope()
          const release = deferred<void>()
          let started = 0
          let effects = 0
          const tasks = Array.from({ length: taskCount }, (_, index) =>
            scope.spawn({
              name: `property-task-${index}`,
              run: async (context) => {
                started += 1
                await release.promise
                context.throwIfCancelled()
                effects += 1
              }
            })
          )
          await waitUntil(() => started === taskCount)
          for (let index = 0; index < cancelCalls; index += 1) {
            scope.cancelAll({ code: reason })
          }
          release.resolve()
          const outcomes = await Promise.allSettled(tasks.map((task) => task.result))
          await scope.drain()
          await scope.drain()

          invariant(effects === 0, 'late completion produced a side effect')
          invariant(
            outcomes.every((outcome) => outcome.status === 'rejected'),
            'cancelled task resolved successfully'
          )
        }
      ),
      { numRuns: 100 }
    )
  })
})

function lifecycleHarness(): {
  lifecycle: RoomSessionLifecycle
  scopes: TaskScope[]
  states: string[]
  readonly releaseCalls: number
} {
  let now = 1
  let releaseCalls = 0
  const scopes: TaskScope[] = []
  const states: string[] = []
  const events: EventPublisher = {
    async publish(event: ApplicationEvent): Promise<void> {
      const state = (event.payload as Record<string, unknown>).state
      if (typeof state === 'string') states.push(state)
    }
  }
  const resources: SessionResources = {
    async start(): Promise<void> {},
    async pause(): Promise<void> {},
    async resume(): Promise<void> {},
    async recover(): Promise<void> {},
    async release(): Promise<void> {
      releaseCalls += 1
    }
  }
  const lifecycle = new RoomSessionLifecycle({
    wallClock: { now: () => wallClockTimestampMs(now++) },
    roomIds: { nextId: () => ROOM_ID },
    sessionIds: { nextId: () => SESSION_ID },
    eventIds: { nextId: () => `property-event-${now++}` },
    createTaskScope: () => {
      const scope = createTransientTaskScope()
      scopes.push(scope)
      return scope
    },
    events,
    resources
  })
  return {
    lifecycle,
    scopes,
    states,
    get releaseCalls() {
      return releaseCalls
    }
  }
}

function startCommand() {
  return {
    roomId: ROOM_ID,
    clientStartId: 'tst-004-start',
    requestFingerprint: 'tst-004-fingerprint',
    expectedRevision: 0 as Revision
  }
}

function lifecycleCommand(snapshot: RoomSessionLifecycle['snapshot']) {
  return {
    roomId: snapshot.roomId,
    sessionId: snapshot.sessionId!,
    audienceEpoch: snapshot.audienceEpoch,
    expectedRevision: snapshot.revision
  }
}

async function createAudience(): Promise<SessionAudienceService> {
  return await SessionAudienceService.create(memoryAudienceStore(), {
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    audienceEpoch: 1 as Epoch,
    sessionSeed: 'tst-004-sequence-seed',
    spec: runtimeSpec(),
    createdAt: wallClockTimestampMs(1_000),
    expectedPopulationRevision: 1 as Revision
  })
}

function runtimeSpec(): CanonicalRuntimeSpec {
  return {
    protocol_version: 3,
    audience_contract_version: 3,
    config_revision: 1,
    room: {
      room_id: ROOM_ID,
      display_name: 'TST-004 Room',
      revision: 1,
      created_at_ms: 0,
      updated_at_ms: 1_000
    },
    active_mode_id: 'mode-tst-004',
    personas: [{
      persona_id: 'persona-tst-004',
      document_version: 1,
      revision: 1,
      content_hash: hashFor('persona-tst-004'),
      display_name: 'Property Viewer',
      role: 'Checks runtime invariants',
      traits: ['deterministic'],
      speech_style: {},
      behavior: {},
      trigger_preferences: [],
      avoid_patterns: [],
      silence_bias: 0.5,
      burst_bias: 0.5,
      repetition_bias: 0.5,
      cooldown_ms: 15_000,
      content_flags: [],
      enabled: true
    }],
    modes: [{
      mode_id: 'mode-tst-004',
      namespace_id: 'namespace-tst-004',
      revision: 1,
      persona_counts: { 'persona-tst-004': 1 },
      persona_overrides: {},
      normal_response_range: { minimum: 0, maximum: 1 },
      highlight_response_range: { minimum: 0, maximum: 1 },
      ambience: 'natural'
    }],
    provider: {} as CanonicalRuntimeSpec['provider'],
    settings: {}
  }
}

function memoryAudienceStore(): SessionAudienceDependencies {
  const records = new Map<ViewerId, ViewerInstanceRecord>()
  let pool: ViewerPoolUpdate = {
    sessionId: SESSION_ID,
    audienceEpoch: 1 as Epoch,
    sessionSeed: 'tst-004-sequence-seed',
    nextCreationOrdinal: 1,
    targetConcurrentViewers: 1,
    populationRevision: 1 as Revision
  }
  const transactions = {
    run: async <TResult>(work: (transaction: ReturnType<typeof transactionContext>) => Promise<TResult>) =>
      await work(transactionContext('tst-004-audience'))
  }
  const viewers: ViewerInstanceRepository = {
    get: async (_transaction, _sessionId, viewerId) => records.get(viewerId) ?? null,
    listActive: async () => [...records.values()].filter(
      (viewer) => viewer.storageState === 'active'
    ),
    restoreEligiblePool: async () => null,
    addAll: async (_transaction, additions) => {
      for (const viewer of additions) records.set(viewer.viewerInstanceId, viewer)
    },
    save: async (_transaction, viewer, expected) => {
      const current = records.get(viewer.viewerInstanceId)
      if (current === undefined || !matchesFence(current, expected)) {
        throw new Error('stale Viewer revision')
      }
      records.set(viewer.viewerInstanceId, viewer)
    },
    remove: async (
      _transaction,
      _sessionId,
      viewerId,
      removedEpoch,
      updatedAt
    ) => {
      const current = records.get(viewerId)
      if (current === undefined) throw new Error('Viewer is unavailable')
      records.set(viewerId, {
        ...current,
        lifecycleState: 'removed',
        storageState: 'removed',
        removedEpoch,
        updatedAt
      })
    },
    advancePool: async (_transaction, update, expectedRevision) => {
      if (pool.populationRevision !== expectedRevision) {
        throw new Error('stale population revision')
      }
      pool = update
    }
  }
  return { transactions, viewers }
}

function sequenceFence(viewer: ViewerInstanceRecord, viewerSequence: number) {
  return {
    viewerInstanceId: viewer.viewerInstanceId,
    viewerSequence,
    presenceRevision: viewer.presenceRevision,
    moderationRevision: viewer.moderationRevision,
    behaviorRevision: viewer.behaviorRevision
  }
}

function matchesFence(
  viewer: ViewerInstanceRecord,
  fence: ViewerRevisionFence
): boolean {
  return (
    viewer.presenceRevision === fence.presenceRevision &&
    viewer.moderationRevision === fence.moderationRevision &&
    viewer.behaviorRevision === fence.behaviorRevision
  )
}

function hashFor(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

function deferred<TResult>(): {
  promise: Promise<TResult>
  resolve: (value?: TResult) => void
} {
  let resolve!: (value?: TResult) => void
  const promise = new Promise<TResult>((settle) => {
    resolve = settle as (value?: TResult) => void
  })
  return { promise, resolve }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 1_000): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started >= timeoutMs) {
      throw new Error('TST-004 wait timed out')
    }
    await Bun.sleep(1)
  }
}

function invariant(condition: boolean, message = 'property invariant failed'): asserts condition {
  if (!condition) throw new Error(message)
}
