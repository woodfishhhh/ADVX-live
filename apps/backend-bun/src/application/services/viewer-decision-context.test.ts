import { describe, expect, test } from 'bun:test'
import {
  viewerModelOutputSchema,
  type CanonicalRuntimeSpec,
  type Epoch,
  type Revision,
  type RoomId,
  type SessionId,
  type ViewerId
} from '@advx/contracts'

import {
  providerRevision,
  type ProviderIdentity,
  type ProviderRoleModel
} from '../ports/providers'
import type {
  RoomEventRecord,
  RoomMemoryRecord,
  ViewerInstanceRecord,
  ViewerPrivateState
} from '../ports/repositories'
import { wallClockTimestampMs } from '../ports/time'
import type { ObservationWave } from './observation-wave'
import {
  ViewerDecisionContextBuilder,
  ViewerDecisionContextError
} from './viewer-decision-context'

const ROOM_ID = 'room-1' as RoomId
const SESSION_ID = 'session-1' as SessionId
const EPOCH = 1 as Epoch
const REVISION = 1 as Revision
const CONTENT_HASH = 'a'.repeat(64)

const MODEL_PROVIDER: ProviderIdentity<'model'> = Object.freeze({
  kind: 'model',
  providerProfileId: 'profile-1',
  providerRevision: providerRevision('provider-revision-1')
})

const VIEWER_MODEL: ProviderRoleModel<'viewer'> = Object.freeze({
  role: 'viewer',
  modelId: 'viewer-model'
})

describe('AGT-008 independent Viewer context and decision contract', () => {
  test('builds one immutable full context and keeps silence legal for a direct mention', () => {
    const builder = new ViewerDecisionContextBuilder()
    const viewer = viewerRecord(1, {
      attention: ['own-private-signal'],
      cooldownUntil: 20_000
    })
    const context = builder.build({
      wave: observationWave(),
      viewer,
      spec: runtimeSpec(),
      viewerSequence: 1,
      provider: MODEL_PROVIDER,
      roleModel: VIEWER_MODEL,
      activeViewerIds: ['viewer-1', 'viewer-2'] as ViewerId[],
      mention: {
        targetViewerId: 'viewer-1' as ViewerId,
        targetPersonaId: null,
        targetAmbiguous: false
      },
      selectionId: 'selection-direct-1'
    })

    expect(context.fence).toMatchObject({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      audienceEpoch: EPOCH,
      observationId: 'observation-1',
      runtimeRevision: REVISION,
      viewerInstanceId: 'viewer-1',
      viewerSequence: 1,
      personaRevision: REVISION,
      presenceRevision: REVISION,
      moderationRevision: REVISION,
      behaviorRevision: REVISION,
      providerProfileId: 'profile-1',
      providerRevision: 'provider-revision-1',
      viewerModelId: 'viewer-model',
      deadlineAt: 40_000
    })
    expect(context.currentInput.map((event) => event.eventId)).toEqual([
      'event-user'
    ])
    expect(context.currentInput[0]?.text).toBe('完整的当前用户问题，不得截断。')
    expect(context.publicContext.map((event) => event.eventId)).toEqual([
      'event-screen',
      'event-system-audio',
      'event-user'
    ])
    expect(context.replyContext.map((event) => event.eventId)).toEqual([
      'event-reply'
    ])
    expect(context.frames.frames.map((frame) => frame.frameId)).toEqual([
      'frame-1'
    ])
    expect(context.roomMemory.memoryIds).toEqual(['memory-1'])
    expect(context.persona.modeOverride).toMatchObject({
      display_name: '模式内战术观众',
      silence_bias: 0.8
    })
    expect(context.persona.resolved).toMatchObject({
      display_name: '模式内战术观众',
      silence_bias: 0.8,
      role: '战术型真实观众'
    })
    expect(context.persona.instanceVariant.focus).toBe('game')
    expect(context.privateContext.state.attention).toEqual(['own-private-signal'])
    expect(context.privateContext).toMatchObject({
      cooldownUntil: 20_000,
      cooldownActiveAtWave: true,
      cooldownRemainingMs: 10_000
    })
    expect(context.mention).toEqual({
      targetViewerId: 'viewer-1',
      targetPersonaId: null,
      targetAmbiguous: false,
      viewerMentioned: true,
      personaMentioned: false
    })
    expect(context.decision).toEqual({
      generationMode: 'per_viewer',
      allowedActions: ['barrage', 'silence'],
      silenceAllowed: true,
      directMentionForcesSpeech: false,
      independentDecision: true,
      outputSchemaName: 'viewer_generation_v1',
      globalRankingAllowed: false
    })
    const personaMention = builder.build({
      ...builderInput(),
      mention: {
        targetViewerId: null,
        targetPersonaId: 'persona-a',
        targetAmbiguous: false
      },
      selectionId: 'selection-direct-persona'
    })
    expect(personaMention.mention).toMatchObject({
      targetPersonaId: 'persona-a',
      viewerMentioned: false,
      personaMentioned: true
    })
    expect(personaMention.decision.silenceAllowed).toBe(true)
    expect(personaMention.decision.directMentionForcesSpeech).toBe(false)
    expect(
      viewerModelOutputSchema.safeParse({
        action: 'silence',
        intent: 'silence',
        target: null,
        texts: null,
        reaction_type: 'silence',
        decision_reason: '被点名也可以自然保持沉默',
        evidence_refs: []
      }).success
    ).toBe(true)
    expect(Object.isFrozen(context)).toBe(true)
    expect(Object.isFrozen(context.publicContext)).toBe(true)
    expect(Object.isFrozen(context.privateContext.state.attention)).toBe(true)
    expect(() =>
      (context.publicContext as RoomEventRecord[]).push(roomEvent('late', 4))
    ).toThrow()
  })

  test('shares only the frozen wave while isolating each Viewer private state', () => {
    const builder = new ViewerDecisionContextBuilder()
    const wave = observationWave()
    const first = builder.build({
      wave,
      viewer: viewerRecord(1, { attention: ['first-private'] }),
      spec: runtimeSpec(),
      viewerSequence: 1,
      provider: MODEL_PROVIDER,
      roleModel: VIEWER_MODEL,
      activeViewerIds: ['viewer-1', 'viewer-2'] as ViewerId[],
      mention: emptyMention(),
      selectionId: 'selection-shared-wave'
    })
    const second = builder.build({
      wave,
      viewer: viewerRecord(2, { attention: ['second-private'] }),
      spec: runtimeSpec(),
      viewerSequence: 1,
      provider: MODEL_PROVIDER,
      roleModel: VIEWER_MODEL,
      activeViewerIds: ['viewer-1', 'viewer-2'] as ViewerId[],
      mention: emptyMention(),
      selectionId: 'selection-shared-wave'
    })
    const replay = builder.build({
      wave,
      viewer: viewerRecord(1, { attention: ['first-private'] }),
      spec: runtimeSpec(),
      viewerSequence: 1,
      provider: MODEL_PROVIDER,
      roleModel: VIEWER_MODEL,
      activeViewerIds: ['viewer-1', 'viewer-2'] as ViewerId[],
      mention: emptyMention(),
      selectionId: 'selection-shared-wave'
    })
    const unpublishedPeerResult = 'same-wave-unpublished-peer-result'

    expect(first.publicContext).toEqual(second.publicContext)
    expect(first.replyContext).toEqual(second.replyContext)
    expect(first.frames).toEqual(second.frames)
    expect(first.roomMemory).toEqual(second.roomMemory)
    expect(first.contextId).toBe(replay.contextId)
    expect(first.privateContext.state.attention).toEqual(['first-private'])
    expect(second.privateContext.state.attention).toEqual(['second-private'])
    expect(JSON.stringify(first)).not.toContain('second-private')
    expect(JSON.stringify(second)).not.toContain('first-private')
    expect(JSON.stringify(first)).not.toContain(unpublishedPeerResult)
    expect(JSON.stringify(second)).not.toContain(unpublishedPeerResult)
    expect('conversationHistorySummary' in first).toBe(false)
  })

  test('rejects public-source, reply, frame, and memory boundary expansion', () => {
    const builder = new ViewerDecisionContextBuilder()
    const base = builderInput()
    const tooManyUsers = Array.from({ length: 17 }, (_, index) =>
      roomEvent(`user-${index + 1}`, index + 1, {
        sourceType: 'user_text',
        occurredAt: 9_000 + index
      })
    )
    const tooManyReplies = Array.from({ length: 9 }, (_, index) =>
      roomEvent(`reply-${index + 1}`, index + 1, {
        sourceType: 'audience_barrage',
        occurredAt: 9_000 + index
      })
    )
    const tooManyFrames = Array.from({ length: 16 }, (_, index) => ({
      ...observationFrame(index),
      frameIndex: index
    }))
    const tooManyMemories = Array.from({ length: 17 }, (_, index) =>
      roomMemory(`memory-${index + 1}`)
    )
    const expiredReply = roomEvent('expired-reply', 1, {
      sourceType: 'audience_barrage',
      occurredAt: 0
    })
    const futurePeerReply = roomEvent('future-peer-reply', 1, {
      sourceType: 'audience_barrage',
      occurredAt: 10_001
    })

    expect(() =>
      builder.build({
        ...base,
        wave: observationWave({ publicContext: tooManyUsers })
      })
    ).toThrow(ViewerDecisionContextError)
    expect(() =>
      builder.build({
        ...base,
        wave: observationWave({ replyContext: tooManyReplies })
      })
    ).toThrow(ViewerDecisionContextError)
    expect(() =>
      builder.build({
        ...base,
        wave: observationWave({ frames: tooManyFrames })
      })
    ).toThrow(ViewerDecisionContextError)
    expect(() =>
      builder.build({
        ...base,
        wave: observationWave({ memories: tooManyMemories })
      })
    ).toThrow(ViewerDecisionContextError)
    expect(() =>
      builder.build({
        ...base,
        wave: observationWave({ replyContext: [expiredReply], frozenAt: 40_000 })
      })
    ).toThrow(ViewerDecisionContextError)
    expect(() =>
      builder.build({
        ...base,
        wave: observationWave({ replyContext: [futurePeerReply] })
      })
    ).toThrow(ViewerDecisionContextError)
  })

  test('rejects stale scope, sequence, Provider, mention, and moderation state', () => {
    const builder = new ViewerDecisionContextBuilder()
    const base = builderInput()

    expect(() =>
      builder.build({
        ...base,
        viewer: viewerRecord(1, { sessionId: 'session-other' as SessionId })
      })
    ).toThrow(ViewerDecisionContextError)
    expect(() => builder.build({ ...base, viewerSequence: 0 })).toThrow(
      ViewerDecisionContextError
    )
    expect(() =>
      builder.build({
        ...base,
        provider: {
          ...MODEL_PROVIDER,
          providerProfileId: 'profile-other'
        }
      })
    ).toThrow(ViewerDecisionContextError)
    expect(() =>
      builder.build({
        ...base,
        mention: {
          targetViewerId: 'viewer-2' as ViewerId,
          targetPersonaId: null,
          targetAmbiguous: false
        }
      })
    ).toThrow(ViewerDecisionContextError)
    expect(() =>
      builder.build({
        ...base,
        viewer: viewerRecord(1, { mutedUntil: 20_000 })
      })
    ).toThrow(ViewerDecisionContextError)

    const ambiguous = builder.build({
      ...base,
      mention: {
        targetViewerId: 'viewer-2' as ViewerId,
        targetPersonaId: 'persona-a',
        targetAmbiguous: true
      }
    })
    expect(ambiguous.mention).toEqual({
      targetViewerId: null,
      targetPersonaId: null,
      targetAmbiguous: true,
      viewerMentioned: false,
      personaMentioned: false
    })
  })
})

function builderInput() {
  return {
    wave: observationWave(),
    viewer: viewerRecord(1),
    spec: runtimeSpec(),
    viewerSequence: 1,
    provider: MODEL_PROVIDER,
    roleModel: VIEWER_MODEL,
    activeViewerIds: ['viewer-1', 'viewer-2'] as ViewerId[],
    mention: emptyMention(),
    selectionId: 'selection-1'
  } as const
}

function emptyMention() {
  return {
    targetViewerId: null,
    targetPersonaId: null,
    targetAmbiguous: false
  } as const
}

type ViewerOptions = Readonly<{
  sessionId?: SessionId
  attention?: readonly string[]
  cooldownUntil?: number
  mutedUntil?: number
}>

function viewerRecord(
  index: number,
  options: ViewerOptions = {}
): ViewerInstanceRecord {
  return {
    viewerInstanceId: `viewer-${index}` as ViewerId,
    roomId: ROOM_ID,
    sessionId: options.sessionId ?? SESSION_ID,
    audienceEpoch: EPOCH,
    personaId: 'persona-a',
    personaRevision: REVISION,
    personaContentHash: CONTENT_HASH,
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
    privateState: privateState(options),
    viewerSequence: 0,
    lifecycleState: 'active',
    presenceRevision: REVISION,
    moderationRevision: REVISION,
    behaviorRevision: REVISION,
    joinedAt: wallClockTimestampMs(1_000),
    lastLeftAt: null,
    joinCount: 1,
    mutedUntil:
      options.mutedUntil === undefined
        ? null
        : wallClockTimestampMs(options.mutedUntil),
    muteReason: options.mutedUntil === undefined ? null : 'moderation',
    kickedAt: null,
    kickReason: null,
    createdAt: wallClockTimestampMs(1_000),
    updatedAt: wallClockTimestampMs(9_000),
    createdEpoch: EPOCH,
    removedEpoch: null,
    storageState: 'active'
  }
}

function privateState(options: ViewerOptions): ViewerPrivateState {
  return {
    revision: REVISION,
    published_event_ids: [],
    direct_interaction_event_ids: [],
    attention: [...(options.attention ?? [])],
    mood: {},
    cooldown_until_ms:
      options.cooldownUntil === undefined ? null : options.cooldownUntil,
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

function runtimeSpec(): CanonicalRuntimeSpec {
  return {
    protocol_version: 3,
    audience_contract_version: 3,
    config_revision: REVISION,
    room: {
      room_id: ROOM_ID,
      display_name: 'Room',
      revision: REVISION,
      created_at_ms: 1,
      updated_at_ms: 1
    },
    active_mode_id: 'mode-a',
    personas: [
      {
        persona_id: 'persona-a',
        document_version: REVISION,
        revision: REVISION,
        content_hash: CONTENT_HASH,
        display_name: '战术观众',
        role: '战术型真实观众',
        traits: ['冷静'],
        speech_style: { length: 'short' },
        behavior: { initiative: 'situational' },
        trigger_preferences: ['question'],
        avoid_patterns: ['repeat'],
        silence_bias: 0.4,
        burst_bias: 0.5,
        repetition_bias: 0.2,
        cooldown_ms: 15_000,
        content_flags: [],
        enabled: true
      }
    ],
    modes: [
      {
        mode_id: 'mode-a',
        namespace_id: 'namespace-a',
        revision: REVISION,
        persona_counts: { 'persona-a': 2 },
        persona_overrides: {
          'persona-a': {
            display_name: '模式内战术观众',
            silence_bias: 0.8,
            traits: ['冷静', '谨慎']
          }
        },
        normal_response_range: { minimum: 0, maximum: 6 },
        highlight_response_range: { minimum: 0, maximum: 6 },
        ambience: 'natural'
      }
    ],
    provider: {
      provider_profile_id: 'profile-1',
      viewer_model: 'viewer-model',
      memory_model: 'memory-model',
      visual_summary_model: 'visual-model'
    },
    settings: {
      allow_viewer_silence: false,
      barrage_generation_mode: 'window_batch',
      window_batch_interval_ms: 5_000,
      window_batch_context_window_ms: 30_000,
      window_batch_max_frames: 5
    }
  }
}

type WaveOptions = Readonly<{
  publicContext?: readonly RoomEventRecord[]
  replyContext?: readonly RoomEventRecord[]
  frames?: readonly ReturnType<typeof observationFrame>[]
  memories?: readonly RoomMemoryRecord[]
  frozenAt?: number
}>

function observationWave(options: WaveOptions = {}): ObservationWave {
  const frozenAt = options.frozenAt ?? 10_000
  const publicContext = options.publicContext ?? [
    roomEvent('event-screen', 1, {
      sourceType: 'screen_observation',
      occurredAt: 8_000,
      text: '画面处于买枪阶段'
    }),
    roomEvent('event-system-audio', 2, {
      sourceType: 'system_event',
      occurredAt: 9_000,
      text: '队友正在讨论配装',
      payload: { event: 'system_audio_transcript' }
    }),
    roomEvent('event-user', 3, {
      sourceType: 'user_text',
      occurredAt: 10_000,
      text: '完整的当前用户问题，不得截断。'
    })
  ]
  const replyContext = options.replyContext ?? [
    roomEvent('event-reply', 4, {
      sourceType: 'audience_barrage',
      occurredAt: 9_500,
      text: '上一条已公开观众消息'
    })
  ]
  const frames = options.frames ?? [observationFrame(0)]
  const memories = options.memories ?? [roomMemory('memory-1')]
  return {
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    audienceEpoch: EPOCH,
    runtimeRevision: REVISION,
    observationId: 'observation-1',
    replayIdentity: 'b'.repeat(64),
    createdAt: wallClockTimestampMs(frozenAt),
    frozenAt: wallClockTimestampMs(frozenAt),
    deadlineAt: wallClockTimestampMs(frozenAt + 30_000),
    mergeWindowEndsAt: wallClockTimestampMs(frozenAt + 1_000),
    priority: 50,
    triggers: ['user_text'],
    triggerEvents: [
      {
        eventId: 'event-user',
        source: 'user_text',
        occurredAt: wallClockTimestampMs(10_000),
        frameId: null
      }
    ],
    inputEventIds: ['event-user'],
    triggerFrameIds: [],
    context: {
      publicContext,
      replyContext,
      publicTriggerEventIds: ['event-user']
    },
    roomMemory: {
      roomId: ROOM_ID,
      memoryRevision: REVISION,
      memoryIds: memories.map((memory) => memory.memoryId),
      items: memories
    },
    frameBundle: {
      timelineWindowMs: 120_000,
      similarityThreshold: 0.9,
      anchorIntervalMs: 5_000,
      maximumFrames: 15,
      frames
    }
  }
}

type RoomEventOptions = Readonly<{
  sourceType?: RoomEventRecord['sourceType']
  occurredAt?: number
  text?: string | null
  payload?: RoomEventRecord['payload']
}>

function roomEvent(
  eventId: string,
  sequence: number,
  options: RoomEventOptions = {}
): RoomEventRecord {
  const payload = options.payload ?? {}
  return {
    eventId,
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    sequence,
    sourceType: options.sourceType ?? 'user_text',
    sourceId: null,
    audienceEpoch: EPOCH,
    text: options.text ?? 'context text',
    payload,
    evidenceEventIds: [],
    contentJson: JSON.stringify({ payload }),
    contentHash: CONTENT_HASH,
    occurredAt: wallClockTimestampMs(options.occurredAt ?? 9_000)
  }
}

function observationFrame(index: number) {
  return {
    frameId: `frame-${index + 1}`,
    capturedAt: wallClockTimestampMs(9_000 + index),
    width: 1280,
    height: 720,
    encoding: 'image/jpeg',
    contentHash: `${index.toString(16)}`.repeat(64).slice(0, 64),
    dataRef: `frames/frame-${index + 1}.jpg`,
    changeScore: 0.5,
    frameIndex: index
  }
}

function roomMemory(memoryId: string): RoomMemoryRecord {
  return {
    memoryId,
    roomId: ROOM_ID,
    memoryType: 'shared_experience',
    content: '用户偏好先讨论烟雾配合',
    tags: ['cs2'],
    importance: 0.8,
    confidence: 0.9,
    origin: 'published_event',
    state: 'active',
    supersededBy: null,
    lastRecalledAt: null,
    expiresAt: null,
    revision: REVISION,
    createdAt: wallClockTimestampMs(1_000),
    updatedAt: wallClockTimestampMs(9_000),
    evidence: [
      {
        eventId: 'event-user',
        sourceType: 'user_text',
        occurredAt: wallClockTimestampMs(1_000),
        summary: '公开证据'
      }
    ]
  }
}
