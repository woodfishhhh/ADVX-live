import { describe, expect, test } from 'bun:test'
import {
  type Epoch,
  type Revision,
  type RoomId,
  type SessionId,
  type ViewerId
} from '@advx/contracts'

import {
  durationMs,
  modelUsage,
  providerFailure,
  providerRevision,
  type ModelGenerationRequest,
  type ModelGenerationResult,
  type ModelProvider,
  type ModelRequestBudget,
  type ModelStreamEvent,
  type ProviderCallContext,
  type ProviderOutcome,
  type WallClockTimestampMs
} from '../ports'
import { createModelRequestScheduler } from '../../infrastructure/scheduling/model-request-scheduler'
import { ModelOutputValidationService } from './model-output-validation'
import type { ViewerDecisionContext } from './viewer-decision-context'
import {
  VIEWER_BATCH_INTERVAL_MS,
  ViewerGenerationError,
  ViewerGenerationService,
  type AcceptedViewerBarragePublication,
  type ViewerBarrageAcceptancePort,
  type ViewerBarragePublicationCommit,
  type ViewerBarragePublicationPort,
  type ViewerFrameLoader,
  type ViewerGenerationDependencies
} from './viewer-generation'

const ROOM_ID = 'room-1' as RoomId
const SESSION_ID = 'session-1' as SessionId
const EPOCH = 1 as Epoch
const REVISION = 1 as Revision

describe('AGT-010 independent Viewer generation and paced batch', () => {
  test('runs one Provider request per Viewer and publishes every barrage without global arbitration', async () => {
    const time = new ManualTime()
    const provider = new ScriptedViewerProvider((request) => {
      if (request.requestId.includes('viewer-3')) return silence()
      return barrage({
        texts: [`text-${request.requestId.at(-1)}`],
        target: null,
        evidence_refs: [{ source: 'event', event_id: 'event-user', frame_index: null }]
      })
    })
    const publication = new PublicationHarness(time)
    const frames = new FrameHarness()
    const service = viewerGenerationService({ time, provider, publication, frames })
    const inputs = [
      generationInput(1),
      generationInput(2),
      generationInput(3)
    ]

    const outcomes = await service.runCandidates(inputs)

    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      'published',
      'published',
      'silence'
    ])
    expect(provider.requests).toHaveLength(3)
    expect(new Set(provider.requests.map((request) => request.requestId)).size).toBe(3)
    expect(provider.requests.every((request) => request.purpose === 'viewer')).toBe(true)
    expect(provider.requests.every((request) => request.stream === false)).toBe(true)
    expect(publication.sharedHistory.map((item) => item.viewer.viewerInstanceId)).toEqual([
      'viewer-1',
      'viewer-2'
    ])
    expect(publication.sharedHistory.every((item) =>
      item.roomMemoryRevision === REVISION
    )).toBeTrue()
    expect(outcomes[2]?.published).toEqual([])
    expect(frames.calls).toHaveLength(3)

    for (const [index, request] of provider.requests.entries()) {
      const prompt = request.messages[1]?.content[0]
      expect(prompt?.type).toBe('text')
      if (prompt?.type !== 'text') throw new Error('missing Viewer prompt')
      expect(prompt.text).toContain(`private-viewer-${index + 1}`)
      expect(prompt.text).not.toContain('frame://private-path')
      expect(request.messages[1]?.content[1]).toMatchObject({
        type: 'image',
        mediaType: 'image/jpeg'
      })
    }
    expect(() => service.runCandidates([inputs[0]!, inputs[0]!])).toThrow(
      ViewerGenerationError
    )
  })

  test('keeps silence legal for one accurately direct-mentioned Viewer', async () => {
    const time = new ManualTime()
    const provider = new ScriptedViewerProvider(() => silence())
    const publication = new PublicationHarness(time)
    const service = viewerGenerationService({ time, provider, publication })

    const outcome = await service.runCandidate(
      generationInput(1, { directMention: true })
    )

    expect(outcome.status).toBe('silence')
    expect(outcome.physicalRequests).toBe(1)
    expect(provider.requests).toHaveLength(1)
    expect(publication.sharedHistory).toHaveLength(0)
  })

  test('keeps the accepted per-Viewer silence policy independent of legacy prompt flags', async () => {
    const provider = new ScriptedViewerProvider(() => silence())
    const time = new ManualTime()
    const service = viewerGenerationService({
      time,
      provider,
      publication: new PublicationHarness(time)
    })

    await service.runCandidate(generationInput(1))

    const system = provider.requests[0]?.messages[0]?.content[0]
    const user = provider.requests[0]?.messages[1]?.content[0]
    expect(system).toMatchObject({ type: 'text' })
    expect(user).toMatchObject({ type: 'text' })
    if (system?.type !== 'text' || user?.type !== 'text') {
      throw new Error('missing Viewer prompts')
    }
    expect(system.text).toContain('action barrage or silence')
    expect(system.text).toContain('Silence is always legal')
    expect(system.text).not.toContain('max_candidates')
    expect(system.text).not.toContain('omit silent viewers')
    expect(JSON.parse(user.text)).toMatchObject({
      decision: {
        generationMode: 'per_viewer',
        allowedActions: ['barrage', 'silence'],
        silenceAllowed: true,
        independentDecision: true,
        globalRankingAllowed: false
      }
    })
  })

  test('publishes first immediately and remaining accepted texts every 500 ms', async () => {
    const time = new ManualTime()
    const provider = new ScriptedViewerProvider(() => barrage({
      intent: 'reply_to_viewer',
      target: {
        kind: 'event',
        viewer_instance_id: null,
        event_id: 'event-reply'
      },
      texts: ['first', 'second', 'third'],
      evidence_refs: [
        { source: 'event', event_id: 'event-user', frame_index: null },
        { source: 'frame', event_id: null, frame_index: 0 }
      ]
    }))
    const publication = new PublicationHarness(time)
    const service = viewerGenerationService({ time, provider, publication })

    const pending = service.runCandidate(generationInput(1))
    await waitUntil(() => publication.sharedHistory.length === 1)
    expect(publication.sharedHistory.map((item) => item.text)).toEqual(['first'])
    expect(publication.commits.map((item) => Number(item.publishedAt))).toEqual([10_000])

    await time.advance(499)
    expect(publication.sharedHistory).toHaveLength(1)
    await time.advance(1)
    await waitUntil(() => publication.sharedHistory.length === 2)
    expect(publication.commits.map((item) => Number(item.publishedAt))).toEqual([
      10_000,
      10_500
    ])
    await time.advance(VIEWER_BATCH_INTERVAL_MS)
    const outcome = await pending

    expect(outcome.status).toBe('published')
    expect(outcome.physicalRequests).toBe(1)
    expect(outcome.published.map((item) => item.text)).toEqual([
      'first',
      'second',
      'third'
    ])
    expect(publication.commits.map((item) => Number(item.publishedAt))).toEqual([
      10_000,
      10_500,
      11_000
    ])
    expect(publication.sharedHistory.every(
      (item) => item.parentEventId === 'event-reply'
    )).toBe(true)
    expect(publication.sharedHistory.every(
      (item) => item.intent === 'reply_to_viewer'
    )).toBe(true)
    expect(publication.sharedHistory.every(
      (item) => item.evidenceRefs.length === 2
    )).toBe(true)
    expect(publication.sharedHistory.map((item) => item.relatedInputEventIds)).toEqual([
      ['event-user'],
      ['event-user'],
      ['event-user']
    ])
  })

  test('rechecks final fences and drops every unpublicized stale remainder', async () => {
    const time = new ManualTime()
    const provider = new ScriptedViewerProvider(() => barrage({
      texts: ['first', 'second', 'third']
    }))
    const publication = new PublicationHarness(time)
    const service = viewerGenerationService({ time, provider, publication })

    const pending = service.runCandidate(generationInput(1))
    await waitUntil(() => publication.sharedHistory.length === 1)
    publication.current = false
    await time.advance(VIEWER_BATCH_INTERVAL_MS)
    const outcome = await pending

    expect(outcome.status).toBe('interrupted')
    expect(outcome.published.map((item) => item.text)).toEqual(['first'])
    expect(outcome.droppedTextCount).toBe(2)
    expect(publication.attempts).toBe(2)
    expect(publication.sharedHistory.map((item) => item.text)).toEqual(['first'])
  })

  test('aborts a delayed batch with no late publication side effect', async () => {
    const time = new ManualTime()
    const provider = new ScriptedViewerProvider(() => barrage({
      texts: ['first', 'second', 'third']
    }))
    const publication = new PublicationHarness(time)
    const service = viewerGenerationService({ time, provider, publication })
    const controller = new AbortController()

    const pending = service.runCandidate({
      ...generationInput(1),
      callerSignal: controller.signal
    })
    await waitUntil(() => publication.sharedHistory.length === 1)
    controller.abort(new Error('superseded'))
    const outcome = await pending

    expect(outcome.status).toBe('interrupted')
    expect(outcome.published).toHaveLength(1)
    expect(outcome.droppedTextCount).toBe(2)
    expect(publication.attempts).toBe(1)
    await time.advance(5_000)
    expect(publication.sharedHistory.map((item) => item.text)).toEqual(['first'])
  })
})

type GenerationInputOptions = Readonly<{
  directMention?: boolean
}>

function generationInput(index: number, options: GenerationInputOptions = {}) {
  return {
    context: viewerContext(index, options),
    trigger: options.directMention ? 'direct' as const : 'user_text' as const
  }
}

function viewerContext(
  index: number,
  options: GenerationInputOptions = {}
): ViewerDecisionContext {
  const viewerId = `viewer-${index}` as ViewerId
  const event = roomEvent('event-user', 'user_text', 10_000, '完整用户输入')
  const reply = roomEvent(
    'event-reply',
    'audience_barrage',
    9_500,
    '已公开父消息'
  )
  return Object.freeze({
    contextId: `context-viewer-${index}`,
    selectionId: 'selection-wave-1',
    fence: Object.freeze({
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
    }),
    viewer: Object.freeze({
      viewerInstanceId: viewerId,
      username: `viewer_${index}`,
      displayName: `Viewer ${index}`,
      locale: 'zh-CN',
      personaId: 'persona-a'
    }),
    activeViewerIds: Object.freeze([
      'viewer-1',
      'viewer-2',
      'viewer-3'
    ] as ViewerId[]),
    currentInput: Object.freeze([event]),
    publicContext: Object.freeze([event]),
    replyContext: Object.freeze([reply]),
    frames: Object.freeze({
      timelineWindowMs: 120_000,
      similarityThreshold: 0.9,
      anchorIntervalMs: 5_000,
      maximumFrames: 15,
      frames: Object.freeze([Object.freeze({
        frameId: 'frame-1',
        capturedAt: 9_000,
        width: 1280,
        height: 720,
        encoding: 'image/jpeg',
        contentHash: 'a'.repeat(64),
        dataRef: 'frame://private-path',
        changeScore: 0.5,
        frameIndex: 0
      })])
    }),
    mention: Object.freeze({
      targetViewerId: options.directMention ? viewerId : null,
      targetPersonaId: null,
      targetAmbiguous: false,
      viewerMentioned: options.directMention === true,
      personaMentioned: false
    }),
    roomMemory: Object.freeze({
      roomId: ROOM_ID,
      memoryRevision: REVISION,
      memoryIds: Object.freeze(['memory-1']),
      items: Object.freeze([Object.freeze({
        memoryId: 'memory-1',
        roomId: ROOM_ID,
        memoryType: 'shared_experience',
        content: '公开记忆',
        tags: Object.freeze(['cs2']),
        importance: 0.8,
        confidence: 0.9,
        origin: 'published_event',
        state: 'active',
        supersededBy: null,
        lastRecalledAt: null,
        expiresAt: null,
        revision: REVISION,
        createdAt: 1_000,
        updatedAt: 9_000,
        evidence: Object.freeze([])
      })])
    }),
    persona: Object.freeze({
      template: Object.freeze({
        persona_id: 'persona-a',
        document_version: REVISION,
        revision: REVISION,
        content_hash: 'a'.repeat(64),
        display_name: '战术观众',
        role: '战术型真实观众',
        traits: Object.freeze(['冷静']),
        speech_style: Object.freeze({ length: 'short' }),
        behavior: Object.freeze({ initiative: 'situational' }),
        trigger_preferences: Object.freeze(['question']),
        avoid_patterns: Object.freeze(['repeat']),
        silence_bias: 0.4,
        burst_bias: 0.5,
        repetition_bias: 0.2,
        cooldown_ms: 15_000,
        content_flags: Object.freeze([]),
        enabled: true
      }),
      activeMode: Object.freeze({
        mode_id: 'mode-a',
        namespace_id: 'namespace-a',
        revision: REVISION,
        persona_counts: Object.freeze({ 'persona-a': 3 }),
        normal_response_range: Object.freeze({ minimum: 0, maximum: 6 }),
        highlight_response_range: Object.freeze({ minimum: 0, maximum: 6 }),
        ambience: 'natural'
      }),
      modeOverride: null,
      resolved: Object.freeze({
        persona_id: 'persona-a',
        document_version: REVISION,
        revision: REVISION,
        content_hash: 'a'.repeat(64),
        display_name: '战术观众',
        role: '战术型真实观众',
        traits: Object.freeze(['冷静']),
        speech_style: Object.freeze({ length: 'short' }),
        behavior: Object.freeze({ initiative: 'situational' }),
        trigger_preferences: Object.freeze(['question']),
        avoid_patterns: Object.freeze(['repeat']),
        silence_bias: 0.4,
        burst_bias: 0.5,
        repetition_bias: 0.2,
        cooldown_ms: 15_000,
        content_flags: Object.freeze([]),
        enabled: true
      }),
      instanceVariant: Object.freeze({
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
      })
    }),
    privateContext: Object.freeze({
      state: Object.freeze({
        revision: REVISION,
        published_event_ids: Object.freeze([]),
        direct_interaction_event_ids: Object.freeze([]),
        attention: Object.freeze([`private-viewer-${index}`]),
        mood: Object.freeze({}),
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
        peer_affinities: Object.freeze({}),
        silence_streak: 0,
        speech_streak: 0
      }),
      cooldownUntil: null,
      cooldownActiveAtWave: false,
      cooldownRemainingMs: 0
    }),
    decision: Object.freeze({
      generationMode: 'per_viewer',
      allowedActions: Object.freeze(['barrage', 'silence']),
      silenceAllowed: true,
      directMentionForcesSpeech: false,
      independentDecision: true,
      outputSchemaName: 'viewer_generation_v1',
      globalRankingAllowed: false
    })
  }) as unknown as ViewerDecisionContext
}

function roomEvent(
  eventId: string,
  sourceType: 'user_text' | 'audience_barrage',
  occurredAt: number,
  text: string
) {
  return Object.freeze({
    eventId,
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    sequence: sourceType === 'user_text' ? 1 : 2,
    sourceType,
    sourceId: sourceType === 'audience_barrage' ? 'viewer-parent' : null,
    audienceEpoch: EPOCH,
    text,
    payload: Object.freeze({}),
    evidenceEventIds: Object.freeze([]),
    contentJson: '{}',
    contentHash: 'b'.repeat(64),
    occurredAt
  })
}

type ViewerOutputOverrides = Readonly<Record<string, unknown>>

function barrage(overrides: ViewerOutputOverrides = {}): string {
  return JSON.stringify({
    action: 'barrage',
    intent: 'react_to_scene',
    target: null,
    texts: ['first', 'second', 'third'],
    reaction_type: 'comment',
    decision_reason: 'current evidence supports a reaction',
    evidence_refs: [],
    ...overrides
  })
}

function silence(): string {
  return JSON.stringify({
    action: 'silence',
    intent: 'silence',
    target: null,
    texts: null,
    reaction_type: 'silence',
    decision_reason: 'direct mention does not force speech',
    evidence_refs: []
  })
}

class ScriptedViewerProvider implements ModelProvider {
  readonly requests: ModelGenerationRequest[] = []

  constructor(
    private readonly response: (request: ModelGenerationRequest) => string
  ) {}

  async health(): Promise<never> {
    throw new Error('health is outside AGT-010')
  }

  async probeCapabilities(): Promise<never> {
    throw new Error('capability probing is outside AGT-010')
  }

  async generate(
    request: ModelGenerationRequest,
    _context: ProviderCallContext,
    budget: ModelRequestBudget
  ): Promise<ProviderOutcome<ModelGenerationResult>> {
    this.requests.push(request)
    if (!budget.take()) {
      return {
        ok: false,
        error: providerFailure({
          code: 'invalid_request',
          source: 'advx',
          retryable: false
        })
      }
    }
    return {
      ok: true,
      value: {
        requestId: request.requestId,
        responseId: `response-${request.requestId}`,
        provider: request.provider,
        roleModel: request.roleModel,
        protocolRepairAttempt: request.protocolRepairAttempt,
        output: {
          type: 'structured',
          schemaName: request.output.type === 'structured'
            ? request.output.schemaName
            : 'text',
          text: this.response(request)
        },
        finishReason: 'stop',
        usage: modelUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
        latency: { totalMs: durationMs(10) }
      }
    }
  }

  async *stream(): AsyncIterable<ModelStreamEvent> {}
}

class FrameHarness implements ViewerFrameLoader {
  readonly calls: string[] = []

  async load(
    frame: ViewerDecisionContext['frames']['frames'][number]
  ): Promise<Readonly<Uint8Array>> {
    this.calls.push(frame.dataRef)
    return Uint8Array.of(1, 2, 3)
  }
}

class PublicationHarness implements ViewerBarragePublicationPort {
  readonly sharedHistory: AcceptedViewerBarragePublication[] = []
  readonly commits: ViewerBarragePublicationCommit[] = []
  current = true
  attempts = 0

  constructor(private readonly time: ManualTime) {}

  async commitToSharedHistoryIfCurrent(
    publication: AcceptedViewerBarragePublication,
    signal: AbortSignal
  ): Promise<ViewerBarragePublicationCommit | null> {
    this.attempts += 1
    if (
      !this.current ||
      signal.aborted ||
      this.time.now >= publication.deadlineAt
    ) {
      return null
    }
    const commit = Object.freeze({
      publicationId: `publication-${this.commits.length + 1}`,
      publishedAt: this.time.now as WallClockTimestampMs
    })
    this.sharedHistory.push(publication)
    this.commits.push(commit)
    return commit
  }
}

type ManualSleeper = {
  at: number
  signal: AbortSignal
  resolve: () => void
  reject: (reason: unknown) => void
  aborted: () => void
}

class ManualTime {
  now = 10_000
  readonly #sleepers: ManualSleeper[] = []

  sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
    if (milliseconds <= 0) return Promise.resolve()
    if (signal.aborted) return Promise.reject(signal.reason)
    return new Promise<void>((resolve, reject) => {
      const sleeper = {
        at: this.now + milliseconds,
        signal,
        resolve,
        reject,
        aborted: () => {
          this.#remove(sleeper)
          reject(signal.reason)
        }
      }
      this.#sleepers.push(sleeper)
      signal.addEventListener('abort', sleeper.aborted, { once: true })
    })
  }

  async advance(milliseconds: number): Promise<void> {
    this.now += milliseconds
    const ready = this.#sleepers.filter((sleeper) => sleeper.at <= this.now)
    for (const sleeper of ready) {
      this.#remove(sleeper)
      sleeper.resolve()
    }
    await flushTasks()
  }

  #remove(sleeper: ManualSleeper): void {
    const index = this.#sleepers.indexOf(sleeper)
    if (index >= 0) this.#sleepers.splice(index, 1)
    sleeper.signal.removeEventListener('abort', sleeper.aborted)
  }
}

function viewerGenerationService(input: Readonly<{
  time: ManualTime
  provider: ModelProvider
  publication: ViewerBarragePublicationPort
  frames?: ViewerFrameLoader
}>): ViewerGenerationService {
  const acceptance: ViewerBarrageAcceptancePort = {
    acceptedTextIndexes: async ({ generation }) =>
      generation.publicationTexts.map((_, index) => index)
  }
  const dependencies: ViewerGenerationDependencies = {
    scheduler: createModelRequestScheduler({
      maxInFlight: 6,
      maxQueued: 8,
      startIntervalMs: 0,
      candidateBudgets: {
        user_text: 6,
        direct: 1
      }
    }, {
      monotonicNow: () => input.time.now
    }),
    outputValidation: new ModelOutputValidationService(input.provider, {
      monotonicNow: () => input.time.now
    }),
    acceptance,
    publication: input.publication,
    frames: input.frames ?? new FrameHarness(),
    monotonicNow: () => input.time.now,
    wallClockNow: () => input.time.now,
    sleep: (milliseconds, signal) => input.time.sleep(milliseconds, signal)
  }
  return new ViewerGenerationService(dependencies)
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await Bun.sleep(0)
  }
  throw new Error('condition did not become true')
}

async function flushTasks(): Promise<void> {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve()
}
