import { describe, expect, test } from 'bun:test'
import type {
  Epoch,
  Revision,
  RoomId,
  SessionId,
  ViewerId,
  ViewerModelOutput
} from '@advx/contracts'

import {
  wallClockTimestampMs,
  type ViewerPrivateState
} from '../ports'
import {
  BarragePipeline,
  applyBarrageViewerStateEffect,
  barrageAtomicRejection,
  type BarrageAtomicPublicationCommand,
  type BarrageAtomicPublicationResult,
  type AcceptedBarrageSideEffectSubmission,
  type BarragePipelineSnapshot,
  type BarragePipelineViewerSnapshot,
  type BarragePublicationStatePort,
  type RecentBarragePublication,
  type TrustedViewerBarrageEvent
} from './barrage-pipeline'
import type { ValidatedViewerGeneration } from './model-output-validation'
import type {
  ViewerDecisionContext,
  ViewerDecisionFence
} from './viewer-decision-context'
import type { AcceptedViewerBarragePublication } from './viewer-generation'

const ROOM_ID = 'room-1' as RoomId
const SESSION_ID = 'session-1' as SessionId
const EPOCH = 1 as Epoch
const REVISION = 1 as Revision

describe('AGT-011 barrage pipeline', () => {
  test('publishes trusted events and applies each accepted state change exactly once', async () => {
    const time = { now: 10_000 }
    const context = viewerContext('viewer-1')
    const state = new AtomicStateHarness(time, [context, viewerContext('viewer-2')])
    const pipeline = barragePipeline(time, state)
    const output = viewerOutput({
      target: { kind: 'viewer', viewer_instance_id: 'viewer-2' },
      texts: ['第一条有效弹幕', '第二条有效弹幕']
    })
    const generation = validatedGeneration(output)

    expect(await pipeline.acceptedTextIndexes({
      context,
      generation,
      signal: new AbortController().signal
    })).toEqual([0, 1])
    expect(state.stateUpdates).toBe(0)

    const first = publication(context, output, 0, 0, 2)
    const second = publication(context, output, 1, 1, 2)
    const firstCommit = await pipeline.commitToSharedHistoryIfCurrent(
      first,
      new AbortController().signal
    )
    time.now += 500
    const secondCommit = await pipeline.commitToSharedHistoryIfCurrent(
      second,
      new AbortController().signal
    )
    const repeated = await pipeline.commitToSharedHistoryIfCurrent(
      second,
      new AbortController().signal
    )

    expect(firstCommit?.publicationId).toBe('barrage-1')
    expect(secondCommit?.publicationId).toBe('barrage-2')
    expect(repeated).toEqual(secondCommit)
    expect(state.events.map((item) => item.event.barrage.text)).toEqual([
      '第一条有效弹幕',
      '第二条有效弹幕'
    ])
    expect(state.stateUpdates).toBe(2)
    expect(state.privateState('viewer-1')).toMatchObject({
      revision: 3,
      published_event_ids: ['barrage-1', 'barrage-2'],
      cooldown_until_ms: 30_500,
      last_spoke_at_ms: 10_500,
      fatigue: 0.16,
      current_target_viewer_id: 'viewer-2',
      peer_affinities: { 'viewer-2': 0.1 },
      silence_streak: 0,
      speech_streak: 2
    })
    expect(state.privateState('viewer-1').engagement).toBeCloseTo(0.58)
    expect(state.events[0]?.event.barrage).toMatchObject({
      room_id: ROOM_ID,
      session_id: SESSION_ID,
      audience_epoch: EPOCH,
      observation_id: 'observation-1',
      viewer_instance_id: 'viewer-1',
      persona_id: 'persona-viewer-1',
      display_name: 'Viewer viewer-1',
      viewer_sequence: 1,
      target: { kind: 'viewer', viewer_instance_id: 'viewer-2' },
      evidence_refs: [{ source: 'event', event_id: 'event-1' }]
    })
  })

  test('publishes exactly 160 astral Unicode code points through the public event', async () => {
    const time = { now: 10_000 }
    const context = viewerContext('viewer-1')
    const state = new AtomicStateHarness(time, [context])
    const pipeline = barragePipeline(time, state)
    const text = '😀'.repeat(160)
    const output = viewerOutput({ texts: [text] })

    expect(Array.from(text)).toHaveLength(160)
    expect(await accept(pipeline, context, output)).toEqual([0])
    expect(await pipeline.commitToSharedHistoryIfCurrent(
      publication(context, output, 0, 0, 1),
      new AbortController().signal
    )).not.toBeNull()
    expect(state.events[0]?.event.barrage.text).toBe(text)
  })

  test('rejects stale, unauthorized, blocked, and cancelled candidates with zero effects', async () => {
    const time = { now: 10_000 }
    const context = viewerContext('viewer-1')
    const state = new AtomicStateHarness(time, [context])
    const pipeline = barragePipeline(time, state, ['forbidden'])

    const staleState = state.viewer('viewer-1')
    state.replaceViewer('viewer-1', {
      ...staleState,
      moderationRevision: 2 as Revision
    })
    expect(await accept(pipeline, context, viewerOutput())).toEqual([])
    state.replaceViewer('viewer-1', staleState)

    expect(await accept(pipeline, context, viewerOutput({
      evidence_refs: [{ source: 'event', event_id: 'not-in-request' }]
    }))).toEqual([])
    expect(await accept(pipeline, context, viewerOutput({
      target: { kind: 'viewer', viewer_instance_id: 'viewer-missing' }
    }))).toEqual([])
    expect(await accept(pipeline, context, viewerOutput({
      texts: ['FOR-BIDDEN']
    }))).toEqual([])

    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    expect(await pipeline.commitToSharedHistoryIfCurrent(
      publication(context, viewerOutput(), 0, 0, 1),
      controller.signal
    )).toBeNull()
    expect(state.events).toHaveLength(0)
    expect(state.stateUpdates).toBe(0)
  })

  test('keeps the earliest semantic duplicate under an atomic publication race', async () => {
    const time = { now: 10_000 }
    const firstContext = viewerContext('viewer-1')
    const secondContext = viewerContext('viewer-2')
    const state = new AtomicStateHarness(time, [firstContext, secondContext])
    const pipeline = barragePipeline(time, state)
    const firstOutput = viewerOutput({ texts: ['这个操作真的太强了！'] })
    const secondOutput = viewerOutput({ texts: ['这个操作真的太强了'] })

    expect(await accept(pipeline, firstContext, firstOutput)).toEqual([0])
    expect(await accept(pipeline, secondContext, secondOutput)).toEqual([0])
    expect(await pipeline.commitToSharedHistoryIfCurrent(
      publication(firstContext, firstOutput, 0, 0, 1),
      new AbortController().signal
    )).not.toBeNull()
    expect(await pipeline.commitToSharedHistoryIfCurrent(
      publication(secondContext, secondOutput, 0, 0, 1),
      new AbortController().signal
    )).toBeNull()

    expect(state.events).toHaveLength(1)
    expect(state.stateUpdates).toBe(1)
    expect(state.privateState('viewer-2').revision).toBe(1)
  })

  test('counts only committed events for density and reopens after the window', async () => {
    const time = { now: 10_000 }
    const contexts = ['viewer-1', 'viewer-2', 'viewer-3'].map(viewerContext)
    const state = new AtomicStateHarness(time, contexts)
    const pipeline = new BarragePipeline({
      state,
      policy: {
        densityWindowMs: 1_000,
        maxPublicationsPerDensityWindow: 2
      },
      wallClockNow: () => time.now,
      nextPublicationId: sequentialIds()
    })
    const outputs = contexts.map((_, index) => viewerOutput({
      texts: [`独立内容 ${index + 1}`]
    }))

    for (let index = 0; index < contexts.length; index += 1) {
      expect(await accept(pipeline, contexts[index]!, outputs[index]!)).toEqual([0])
    }
    for (let index = 0; index < 2; index += 1) {
      expect(await pipeline.commitToSharedHistoryIfCurrent(
        publication(contexts[index]!, outputs[index]!, 0, 0, 1),
        new AbortController().signal
      )).not.toBeNull()
    }
    expect(await pipeline.commitToSharedHistoryIfCurrent(
      publication(contexts[2]!, outputs[2]!, 0, 0, 1),
      new AbortController().signal
    )).toBeNull()
    expect(state.stateUpdates).toBe(2)

    time.now += 1_001
    expect(await pipeline.commitToSharedHistoryIfCurrent(
      publication(contexts[2]!, outputs[2]!, 0, 0, 1),
      new AbortController().signal
    )).not.toBeNull()
    expect(state.stateUpdates).toBe(3)
  })

  test('detaches side effects after a new accepted event and never repeats them', async () => {
    const time = { now: 10_000 }
    const context = viewerContext('viewer-1')
    const state = new AtomicStateHarness(time, [context])
    const submissions: AcceptedBarrageSideEffectSubmission[] = []
    const pipeline = new BarragePipeline({
      state,
      sideEffects: {
        submitAcceptedPublication(submission) {
          submissions.push(submission)
          throw new Error('detached side effect failed')
        }
      },
      wallClockNow: () => time.now,
      nextPublicationId: sequentialIds()
    })
    const output = viewerOutput()
    const candidate = publication(context, output, 0, 0, 1)

    const committed = await pipeline.commitToSharedHistoryIfCurrent(
      candidate,
      new AbortController().signal
    )
    const replayed = await pipeline.commitToSharedHistoryIfCurrent(
      candidate,
      new AbortController().signal
    )

    expect(committed).not.toBeNull()
    if (committed === null) throw new Error('expected committed publication')
    expect(replayed).toEqual(committed)
    expect(submissions).toHaveLength(1)
    expect(submissions[0]).toMatchObject({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      audienceEpoch: EPOCH,
      observationId: 'observation-1',
      memoryRevision: REVISION
    })
    expect(submissions[0]?.event.barrage.barrage_id).toBe(committed.publicationId)
    expect(state.stateUpdates).toBe(1)
  })
})

function barragePipeline(
  time: { now: number },
  state: AtomicStateHarness,
  blockedWords: readonly string[] = []
): BarragePipeline {
  return new BarragePipeline({
    state,
    policy: { blockedWords },
    wallClockNow: () => time.now,
    nextPublicationId: sequentialIds()
  })
}

function sequentialIds(): () => string {
  let value = 0
  return () => `barrage-${value += 1}`
}

async function accept(
  pipeline: BarragePipeline,
  context: ViewerDecisionContext,
  output: ViewerModelOutput
): Promise<readonly number[]> {
  return await pipeline.acceptedTextIndexes({
    context,
    generation: validatedGeneration(output),
    signal: new AbortController().signal
  })
}

function validatedGeneration(output: ViewerModelOutput): ValidatedViewerGeneration {
  return {
    result: {} as ValidatedViewerGeneration['result'],
    output,
    publicationTexts: output.texts ?? []
  }
}

function viewerOutput(
  overrides: Readonly<Record<string, unknown>> = {}
): ViewerModelOutput {
  return {
    action: 'barrage',
    intent: 'react_to_scene',
    target: null,
    texts: ['默认有效弹幕'],
    reaction_type: 'comment',
    decision_reason: 'current evidence supports publication',
    evidence_refs: [{ source: 'event', event_id: 'event-1' }],
    ...overrides
  } as ViewerModelOutput
}

function viewerContext(viewerIdValue: string): ViewerDecisionContext {
  const viewerId = viewerIdValue as ViewerId
  return {
    contextId: `context-${viewerId}`,
    selectionId: 'selection-1',
    fence: {
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      audienceEpoch: EPOCH,
      observationId: 'observation-1',
      runtimeRevision: REVISION,
      viewerInstanceId: viewerId,
      viewerSequence: 1,
      personaRevision: REVISION,
      presenceRevision: REVISION,
      moderationRevision: REVISION,
      behaviorRevision: REVISION,
      providerProfileId: 'profile-1',
      providerRevision: 'provider-revision-1',
      viewerModelId: 'viewer-model',
      deadlineAt: 40_000
    },
    viewer: {
      viewerInstanceId: viewerId,
      username: viewerId,
      displayName: `Viewer ${viewerId}`,
      locale: 'zh-CN',
      personaId: `persona-${viewerId}`
    },
    activeViewerIds: ['viewer-1', 'viewer-2', 'viewer-3'] as ViewerId[],
    currentInput: [{ eventId: 'event-1' }],
    publicContext: [{ eventId: 'event-1' }],
    replyContext: [{ eventId: 'reply-1' }],
    frames: { frames: [{ frameId: 'frame-1' }] },
    privateContext: {
      state: { revision: REVISION },
      cooldownUntil: null,
      cooldownActiveAtWave: false,
      cooldownRemainingMs: 0
    },
    persona: { resolved: { cooldown_ms: 20_000 } }
  } as unknown as ViewerDecisionContext
}

function publication(
  context: ViewerDecisionContext,
  output: ViewerModelOutput,
  sourceTextIndex: number,
  batchIndex: number,
  batchSize: number
): AcceptedViewerBarragePublication {
  const target = output.target
  return {
    contextId: context.contextId,
    selectionId: context.selectionId,
    batchId: `generation-${context.contextId}`,
    batchIndex,
    batchSize,
    sourceTextIndex,
    generationRequestId: `generation-${context.contextId}`,
    fence: context.fence,
    viewer: context.viewer,
    intent: output.intent,
    reactionType: output.reaction_type,
    target,
    parentEventId: target?.kind === 'event' ? target.event_id ?? null : null,
    evidenceRefs: output.evidence_refs,
    relatedInputEventIds: ['event-1'],
    allowedEvidenceEventIds: ['event-1', 'reply-1'],
    replyableEventIds: ['reply-1'],
    activeViewerIds: context.activeViewerIds,
    frameCount: 1,
    roomMemoryRevision: REVISION,
    privateStateRevision: 1,
    personaCooldownMs: 20_000,
    text: output.texts?.[sourceTextIndex] ?? '',
    deadlineAt: context.fence.deadlineAt
  }
}

class AtomicStateHarness implements BarragePublicationStatePort {
  readonly events: RecentBarragePublication[] = []
  readonly #commits = new Map<string, TrustedViewerBarrageEvent>()
  readonly #viewers = new Map<string, BarragePipelineViewerSnapshot>()
  readonly #privateStates = new Map<string, ViewerPrivateState>()
  stateUpdates = 0

  constructor(
    private readonly time: { now: number },
    contexts: readonly ViewerDecisionContext[]
  ) {
    for (const context of contexts) {
      const viewerId = context.viewer.viewerInstanceId
      this.#viewers.set(viewerId, viewerSnapshot(context))
      this.#privateStates.set(viewerId, {
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
        silence_streak: 2,
        speech_streak: 0
      })
    }
  }

  async inspect(
    fence: ViewerDecisionFence,
    _signal: AbortSignal
  ): Promise<BarragePipelineSnapshot | null> {
    return this.#snapshot(fence.viewerInstanceId)
  }

  async commitIfCurrent(
    command: BarrageAtomicPublicationCommand,
    signal: AbortSignal
  ): Promise<BarrageAtomicPublicationResult> {
    const prior = this.#commits.get(command.publicationKey)
    if (prior !== undefined) {
      return { status: 'already_committed', event: prior, stateUpdateCount: 0 }
    }
    if (signal.aborted) return { status: 'rejected', reason: 'expired' }
    const viewerId = command.publication.viewer.viewerInstanceId
    const snapshot = this.#snapshot(viewerId)
    const reason = barrageAtomicRejection(snapshot, command, this.time.now)
    if (reason !== null) return { status: 'rejected', reason }

    const event = command.event
    this.#commits.set(command.publicationKey, event)
    this.events.push({
      publicationKey: command.publicationKey,
      event,
      publishedAt: command.stateEffect.publishedAt
    })
    const viewer = this.#viewers.get(viewerId)!
    this.#viewers.set(viewerId, {
      ...viewer,
      privateStateRevision: viewer.privateStateRevision + 1,
      behaviorRevision: (Number(viewer.behaviorRevision) + 1) as Revision
    })
    const privateState = applyBarrageViewerStateEffect(
      this.#privateStates.get(viewerId)!,
      command.stateEffect
    )
    this.#privateStates.set(viewerId, privateState)
    this.stateUpdates += 1
    return { status: 'committed', event, stateUpdateCount: 1 }
  }

  viewer(viewerId: string): BarragePipelineViewerSnapshot {
    return this.#viewers.get(viewerId)!
  }

  replaceViewer(viewerId: string, viewer: BarragePipelineViewerSnapshot): void {
    this.#viewers.set(viewerId, viewer)
  }

  privateState(viewerId: string): ViewerPrivateState {
    return this.#privateStates.get(viewerId)!
  }

  #snapshot(viewerId: string): BarragePipelineSnapshot {
    return {
      acceptingPublications: true,
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      audienceEpoch: EPOCH,
      observationId: 'observation-1',
      runtimeRevision: REVISION,
      activeViewerIds: [...this.#viewers.keys()] as ViewerId[],
      viewer: this.#viewers.get(viewerId) ?? null,
      recentPublications: [...this.events]
    }
  }
}

function viewerSnapshot(context: ViewerDecisionContext): BarragePipelineViewerSnapshot {
  return {
    viewerInstanceId: context.viewer.viewerInstanceId,
    personaId: context.viewer.personaId,
    displayName: context.viewer.displayName,
    viewerSequence: context.fence.viewerSequence,
    privateStateRevision: context.privateContext.state.revision,
    lifecycleState: 'active',
    storageState: 'active',
    mutedUntil: null,
    personaRevision: context.fence.personaRevision,
    presenceRevision: context.fence.presenceRevision,
    moderationRevision: context.fence.moderationRevision,
    behaviorRevision: context.fence.behaviorRevision
  }
}
