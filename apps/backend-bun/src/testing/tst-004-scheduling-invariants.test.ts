import { describe, test } from 'bun:test'
import * as fc from 'fast-check'

import type {
  Epoch,
  ObservationTrigger,
  Revision,
  RoomId,
  SessionId,
  ViewerId
} from '@advx/contracts'

import {
  AMBIENT_CANDIDATE_BUDGET,
  USER_CANDIDATE_BUDGET,
  durationMs,
  providerFailure,
  wallClockTimestampMs,
  ViewerCandidateSelector,
  type ModelRequestScheduler,
  type ObservationWave,
  type ProviderOutcome,
  type ScheduledModelTask,
  type ViewerInstanceRecord,
  type ViewerPrivateState
} from '../application'
import { createModelRequestScheduler } from '../infrastructure'
import { assertSeededProperty } from './fast-check-evidence'

describe('TST-004 seeded scheduling properties', () => {
  test('[bounded-queue-concurrency] never exceeds configured admission bounds', async () => {
    await assertSeededProperty(
      'bounded-queue-concurrency',
      fc.asyncProperty(
        fc.record({
          maxInFlight: fc.integer({ min: 1, max: 4 }),
          queuedHeadroom: fc.integer({ min: 0, max: 8 }),
          overflow: fc.integer({ min: 0, max: 5 })
        }),
        async ({ maxInFlight, queuedHeadroom, overflow }) => {
          const maxQueued = maxInFlight + queuedHeadroom
          const scheduler = createModelRequestScheduler({
            maxInFlight,
            maxQueued,
            startIntervalMs: 0,
            candidateBudgets: {
              final_voice: 32
            }
          })
          const release = deferred<void>()
          let active = 0
          let maximumActive = 0
          const results: Array<Promise<unknown>> = []

          for (let index = 0; index < maxInFlight; index += 1) {
            results.push(scheduler.schedule(blockedTask(`running-${index}`, release, () => {
              active += 1
              maximumActive = Math.max(maximumActive, active)
              return () => {
                active -= 1
              }
            })))
            await waitUntil(() => scheduler.snapshot.running === index + 1)
          }

          for (let index = 0; index < maxQueued + overflow; index += 1) {
            results.push(scheduler.schedule(blockedTask(`queued-${index}`, release, () => {
              active += 1
              maximumActive = Math.max(maximumActive, active)
              return () => {
                active -= 1
              }
            })))
          }
          invariant(scheduler.snapshot.running <= maxInFlight)
          invariant(scheduler.snapshot.queued <= maxQueued)
          release.resolve()
          const settled = await Promise.all(results) as Array<{ status?: string }>
          await scheduler.drain()

          invariant(maximumActive <= maxInFlight, 'configured concurrency was exceeded')
          invariant(scheduler.snapshot.admitted === 0, 'scheduler leaked admitted work')
          invariant(
            settled.filter((result) => result.status === 'capacity_rejected').length === overflow,
            'capacity rejection count diverged from bounded queue model'
          )
        }
      ),
      { numRuns: 75 }
    )
  })

  test('[candidate-budget-rotation] preserves budget, replay, and rotation', async () => {
    await assertSeededProperty(
      'candidate-budget-rotation',
      fc.property(
        fc.record({
          population: fc.integer({ min: 1, max: 32 }),
          trigger: fc.constantFrom<ObservationTrigger>(
            'user_text',
            'screen_change',
            'ambient_tick'
          ),
          sessionSeed: fc.stringMatching(/^[a-z0-9]{1,24}$/u)
        }),
        ({ population, trigger, sessionSeed }) => {
          const selector = new ViewerCandidateSelector()
          const viewers = viewerPopulation(population)
          const firstInput = {
            wave: observation('rotation-0', [trigger]),
            sessionSeed,
            viewers
          }
          const first = selector.select(firstInput)
          const replay = selector.select(firstInput)
          const expectedBudget = trigger === 'ambient_tick'
            ? AMBIENT_CANDIDATE_BUDGET
            : trigger === 'screen_change'
              ? Math.ceil(population / 4)
              : USER_CANDIDATE_BUDGET
          const expectedCount = Math.min(population, expectedBudget)

          invariant(first.candidateBudget === expectedBudget)
          invariant(first.candidateViewerIds.length === expectedCount)
          invariant(new Set(first.candidateViewerIds).size === expectedCount)
          invariant(
            JSON.stringify(first.candidateViewerIds) ===
              JSON.stringify(replay.candidateViewerIds),
            'same seed and Observation did not replay exactly'
          )

          const rotated = new Set<ViewerId>()
          for (let index = 0; index < 64; index += 1) {
            const selection = selector.select({
              wave: observation(`rotation-${index}`, [trigger]),
              sessionSeed,
              viewers
            })
            invariant(selection.candidateViewerIds.length === expectedCount)
            for (const viewerId of selection.candidateViewerIds) rotated.add(viewerId)
          }
          if (population > expectedCount) {
            invariant(rotated.size > expectedCount, 'candidate order did not rotate')
          } else {
            invariant(rotated.size === population)
          }
        }
      ),
      { numRuns: 100 }
    )
  })

  test('[retry-backoff-caps] retries once and clamps every requested delay', async () => {
    await assertSeededProperty(
      'retry-backoff-caps',
      fc.asyncProperty(
        fc.record({
          retryBackoffMs: fc.integer({ min: 0, max: 60_000 }),
          extraCapMs: fc.integer({ min: 0, max: 60_000 }),
          requestedDelayMs: fc.option(
            fc.integer({ min: 0, max: 120_000 }),
            { nil: undefined }
          )
        }).filter(({ retryBackoffMs, extraCapMs }) =>
          retryBackoffMs + extraCapMs <= 60_000
        ),
        async ({ retryBackoffMs, extraCapMs, requestedDelayMs }) => {
          const maxRetryDelayMs = retryBackoffMs + extraCapMs
          const delays: number[] = []
          const scheduler = createModelRequestScheduler(
            {
              maxInFlight: 1,
              maxQueued: 1,
              startIntervalMs: 0,
              retryBackoffMs,
              maxRetryDelayMs,
              minimumAttemptRemainingMs: 0
            },
            {
              monotonicNow: () => 0,
              sleep: async (milliseconds) => {
                delays.push(milliseconds)
              }
            }
          )
          const failure = providerFailure({
            code: 'rate_limited',
            source: 'provider',
            retryable: true,
            ...(requestedDelayMs === undefined
              ? {}
              : { retryAfterMs: durationMs(requestedDelayMs) })
          })
          const result = await scheduler.schedule<string>({
            taskId: 'retry-property',
            triggerId: 'retry-property',
            trigger: 'final_voice',
            laneKey: 'retry-property',
            rateKey: 'retry-property',
            deadlineAt: 1_000_000,
            execute: async ({ attempt, requestBudget }) => {
              requestBudget.take()
              return attempt === 0
                ? { ok: false, error: failure }
                : { ok: true, value: 'completed' }
            }
          })
          await scheduler.drain()
          const requested = requestedDelayMs ?? retryBackoffMs

          invariant(result.status === 'completed')
          invariant(result.retries === 1)
          invariant(result.physicalRequests === 2)
          invariant(delays.length === 1)
          invariant(
            delays[0] === Math.min(requested, maxRetryDelayMs),
            'retry delay exceeded configured cap'
          )
        }
      ),
      { numRuns: 100 }
    )
  })
})

function blockedTask(
  taskId: string,
  release: { promise: Promise<void> },
  enter: () => () => void
): ScheduledModelTask<string> {
  return {
    taskId,
    triggerId: taskId,
    trigger: 'final_voice',
    laneKey: taskId,
    rateKey: 'bounded-property',
    deadlineAt: Number.MAX_SAFE_INTEGER,
    execute: async ({ requestBudget }) => {
      const leave = enter()
      requestBudget.take()
      try {
        await release.promise
        return success(taskId)
      } finally {
        leave()
      }
    }
  }
}

function success<TValue>(value: TValue): ProviderOutcome<TValue> {
  return { ok: true, value }
}

function viewerPopulation(size: number): ViewerInstanceRecord[] {
  return Array.from({ length: size }, (_, index) => viewer(index + 1))
}

function viewer(index: number): ViewerInstanceRecord {
  return {
    viewerInstanceId: `viewer-${index}` as ViewerId,
    roomId: 'room-tst-004' as RoomId,
    sessionId: 'session-tst-004' as SessionId,
    audienceEpoch: 1 as Epoch,
    personaId: index % 2 === 0 ? 'persona-a' : 'persona-b',
    personaRevision: 1,
    personaContentHash: 'a'.repeat(64),
    ordinal: index,
    username: `viewer_${index}`,
    displayName: `Viewer ${index}`,
    avatarSeed: `avatar-${index}`,
    colorSeed: `color-${index}`,
    locale: 'zh-CN',
    variant: {
      activity_baseline: 0.5,
      attention_span: 0.5,
      social_initiative: 0.5,
      reply_affinity: 0.5,
      expression_length: 0.5,
      skepticism: 0.5,
      encouragement: 0.5,
      meme_affinity: 0.5,
      focus: 'game',
      silence_tendency: 0.5,
      stay_duration_tendency: 0.5,
      rejoin_tendency: 0.5
    },
    privateState: privateState(),
    viewerSequence: 0,
    lifecycleState: 'active',
    presenceRevision: 1,
    moderationRevision: 1,
    behaviorRevision: 1,
    joinedAt: wallClockTimestampMs(1_000),
    lastLeftAt: null,
    joinCount: 1,
    mutedUntil: null,
    muteReason: null,
    kickedAt: null,
    kickReason: null,
    createdAt: wallClockTimestampMs(1_000),
    updatedAt: wallClockTimestampMs(9_000),
    createdEpoch: 1,
    removedEpoch: null,
    storageState: 'active'
  }
}

function privateState(): ViewerPrivateState {
  return {
    revision: 1,
    published_event_ids: [],
    direct_interaction_event_ids: [],
    attention: [],
    mood: {},
    cooldown_until_ms: null,
    attention_strength: 0.5,
    arousal: 0,
    fatigue: 0,
    engagement: 0.5,
    last_spoke_at_ms: null,
    last_reacted_at_ms: null,
    current_thread_id: null,
    current_target_viewer_id: null,
    host_affinity: 0,
    peer_affinities: {},
    silence_streak: 0,
    speech_streak: 0
  }
}

function observation(
  observationId: string,
  triggers: readonly ObservationTrigger[]
): ObservationWave {
  return {
    roomId: 'room-tst-004' as RoomId,
    sessionId: 'session-tst-004' as SessionId,
    audienceEpoch: 1 as Epoch,
    runtimeRevision: 1 as Revision,
    observationId,
    replayIdentity: hashFor(observationId),
    createdAt: wallClockTimestampMs(10_000),
    frozenAt: wallClockTimestampMs(10_000),
    deadlineAt: wallClockTimestampMs(40_000),
    mergeWindowEndsAt: wallClockTimestampMs(10_000),
    priority: 50,
    triggers,
    triggerEvents: [],
    inputEventIds: [],
    triggerFrameIds: [],
    context: {
      publicContext: [],
      replyContext: [],
      publicTriggerEventIds: []
    },
    roomMemory: {
      roomId: 'room-tst-004' as RoomId,
      memoryRevision: 1 as Revision,
      memoryIds: [],
      items: []
    },
    frameBundle: {
      timelineWindowMs: 120_000,
      similarityThreshold: 0.9,
      anchorIntervalMs: 5_000,
      maximumFrames: 15,
      frames: []
    }
  }
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
      throw new Error('TST-004 scheduler wait timed out')
    }
    await Bun.sleep(1)
  }
}

function invariant(condition: boolean, message = 'property invariant failed'): asserts condition {
  if (!condition) throw new Error(message)
}
