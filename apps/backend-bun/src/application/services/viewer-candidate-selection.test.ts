import { describe, expect, test } from 'bun:test'
import type {
  Epoch,
  ObservationTrigger,
  Revision,
  RoomId,
  SessionId,
  ViewerId
} from '@advx/contracts'

import type {
  ViewerInstanceRecord,
  ViewerPrivateState
} from '../ports/repositories'
import { wallClockTimestampMs } from '../ports/time'
import type { ObservationWave } from './observation-wave'
import {
  AMBIENT_CANDIDATE_BUDGET,
  DIRECT_MENTION_CANDIDATE_BUDGET,
  USER_CANDIDATE_BUDGET,
  ViewerCandidateSelectionError,
  ViewerCandidateSelector
} from './viewer-candidate-selection'

describe('AGT-009 deterministic Viewer candidate selection', () => {
  test('applies exact user, active-population screen, and ambient budgets before dispatch', () => {
    const selector = new ViewerCandidateSelector()
    const viewers = viewerPopulation(12)
    const user = selector.select({
      wave: observation('user-1', ['user_text']),
      sessionSeed: 'selection-seed',
      viewers
    })
    const screen = selector.select({
      wave: observation('screen-1', ['screen_change']),
      sessionSeed: 'selection-seed',
      viewers
    })
    const ambient = selector.select({
      wave: observation('ambient-1', ['ambient_tick']),
      sessionSeed: 'selection-seed',
      viewers
    })

    expect(user).toMatchObject({
      budgetKind: 'user',
      candidateBudget: USER_CANDIDATE_BUDGET,
      activePopulation: 12,
      eligiblePopulation: 12
    })
    expect(user.candidateViewerIds).toHaveLength(6)
    expect(screen).toMatchObject({
      budgetKind: 'screen',
      candidateBudget: 3,
      activePopulation: 12,
      eligiblePopulation: 12
    })
    expect(screen.candidateViewerIds).toHaveLength(3)
    expect(ambient).toMatchObject({
      budgetKind: 'ambient',
      candidateBudget: AMBIENT_CANDIDATE_BUDGET,
      activePopulation: 12,
      eligiblePopulation: 12
    })
    expect(ambient.candidateViewerIds).toHaveLength(2)
    expect(new Set(user.candidateViewerIds).size).toBe(user.candidateViewerIds.length)
    expect(new Set(screen.candidateViewerIds).size).toBe(screen.candidateViewerIds.length)
    expect(new Set(ambient.candidateViewerIds).size).toBe(
      ambient.candidateViewerIds.length
    )
    expect(screen.candidateViewerIds).toEqual([
      'viewer-3',
      'viewer-7',
      'viewer-11'
    ])
  })

  test('replays seeded order and rotates never-spoken Viewers across observations', () => {
    const selector = new ViewerCandidateSelector()
    const viewers = viewerPopulation(8)
    const first = selector.select({
      wave: observation('ambient-a', ['ambient_tick']),
      sessionSeed: 'rotation-seed',
      viewers
    })
    const replay = selector.select({
      wave: observation('ambient-a', ['ambient_tick']),
      sessionSeed: 'rotation-seed',
      viewers
    })
    const rounds = ['ambient-a', 'ambient-b', 'ambient-c', 'ambient-d'].map(
      (observationId) =>
        selector.select({
          wave: observation(observationId, ['ambient_tick']),
          sessionSeed: 'rotation-seed',
          viewers
        })
    )

    expect(replay).toEqual(first)
    expect(new Set(rounds.flatMap((round) => round.candidateViewerIds)).size).toBeGreaterThan(
      AMBIENT_CANDIDATE_BUDGET
    )
    expect(rounds.every((round) => round.candidateViewerIds.length === 2)).toBe(true)

    const recentlySpoke = viewerPopulation(7, {
      1: { lastSpokeAt: 9_500 }
    })
    const user = selector.select({
      wave: observation('user-fairness', ['final_voice']),
      sessionSeed: 'rotation-seed',
      viewers: recentlySpoke
    })
    expect(user.candidateViewerIds).not.toContain('viewer-1')
  })

  test('selects one accurate direct Viewer or deterministic Persona target without substitution', () => {
    const selector = new ViewerCandidateSelector()
    const viewers = viewerPopulation(6, {
      1: { cooldownUntil: 20_000 },
      2: { personaId: 'persona-special' },
      3: { personaId: 'persona-special' },
      4: { personaId: 'persona-special', mutedUntil: 20_000 }
    })
    const directViewer = selector.select({
      wave: observation('direct-viewer', ['user_text']),
      sessionSeed: 'mention-seed',
      viewers,
      targetViewerId: 'viewer-1' as ViewerId
    })
    const directPersona = selector.select({
      wave: observation('direct-persona', ['final_voice']),
      sessionSeed: 'mention-seed',
      viewers,
      targetPersonaId: 'persona-special'
    })
    const missingTarget = selector.select({
      wave: observation('direct-missing', ['user_text']),
      sessionSeed: 'mention-seed',
      viewers,
      targetViewerId: 'viewer-missing' as ViewerId
    })
    const mutedTarget = selector.select({
      wave: observation('direct-muted', ['user_text']),
      sessionSeed: 'mention-seed',
      viewers,
      targetViewerId: 'viewer-4' as ViewerId
    })

    expect(directViewer).toMatchObject({
      budgetKind: 'direct_viewer',
      candidateBudget: DIRECT_MENTION_CANDIDATE_BUDGET,
      candidateViewerIds: ['viewer-1']
    })
    expect(directPersona).toMatchObject({
      budgetKind: 'direct_persona',
      candidateBudget: DIRECT_MENTION_CANDIDATE_BUDGET
    })
    expect(directPersona.candidateViewerIds).toHaveLength(1)
    expect(['viewer-2', 'viewer-3']).toContain(directPersona.candidateViewerIds[0])
    expect(
      selector.select({
        wave: observation('direct-persona', ['final_voice']),
        sessionSeed: 'mention-seed',
        viewers,
        targetPersonaId: 'persona-special'
      })
    ).toEqual(directPersona)
    expect(missingTarget.candidateViewerIds).toEqual([])
    expect(mutedTarget.candidateViewerIds).toEqual([])
  })

  test('filters stale presence and moderation while deriving screen budget from active population', () => {
    const selector = new ViewerCandidateSelector()
    const viewers = viewerPopulation(9, {
      1: { mutedUntil: 20_000 },
      2: { mutedUntil: 20_000 }
    }).concat([
      viewer(10, { lifecycleState: 'left' }),
      viewer(11, { audienceEpoch: 2 }),
      viewer(12, { lifecycleState: 'removed', storageState: 'removed' })
    ])
    const result = selector.select({
      wave: observation('screen-eligibility', ['screen_change']),
      sessionSeed: 'eligibility-seed',
      viewers
    })

    expect(result).toMatchObject({
      candidateBudget: 3,
      activePopulation: 9,
      eligiblePopulation: 7
    })
    expect(result.candidateViewerIds).toHaveLength(3)
    expect(result.candidateViewerIds).not.toContain('viewer-1')
    expect(result.candidateViewerIds).not.toContain('viewer-2')
    expect(result.candidateViewerIds).not.toContain('viewer-10')
    expect(result.candidateViewerIds).not.toContain('viewer-11')
    expect(result.candidateViewerIds).not.toContain('viewer-12')
  })

  test('uses user priority for merged triggers and rejects conflicting accurate targets', () => {
    const selector = new ViewerCandidateSelector()
    const viewers = viewerPopulation(8)
    const merged = selector.select({
      wave: observation('merged', ['screen_change', 'system_audio', 'ambient_tick']),
      sessionSeed: 'merged-seed',
      viewers
    })
    const ambiguous = selector.select({
      wave: observation('ambiguous', ['user_text']),
      sessionSeed: 'merged-seed',
      viewers,
      targetViewerId: 'viewer-1' as ViewerId,
      targetAmbiguous: true
    })

    expect(merged.budgetKind).toBe('user')
    expect(merged.candidateViewerIds).toHaveLength(6)
    expect(ambiguous.budgetKind).toBe('user')
    expect(ambiguous.candidateViewerIds).toHaveLength(6)
    expect(() =>
      selector.select({
        wave: observation('conflict', ['user_text']),
        sessionSeed: 'merged-seed',
        viewers,
        targetViewerId: 'viewer-1' as ViewerId,
        targetPersonaId: 'persona-a'
      })
    ).toThrow(ViewerCandidateSelectionError)
  })
})

type ViewerOptions = Readonly<{
  personaId?: string
  audienceEpoch?: number
  lifecycleState?: ViewerInstanceRecord['lifecycleState']
  storageState?: ViewerInstanceRecord['storageState']
  mutedUntil?: number
  cooldownUntil?: number
  lastSpokeAt?: number
}>

function viewerPopulation(
  size: number,
  options: Readonly<Record<number, ViewerOptions>> = {}
): ViewerInstanceRecord[] {
  return Array.from({ length: size }, (_, index) => viewer(index + 1, options[index + 1]))
}

function viewer(index: number, options: ViewerOptions = {}): ViewerInstanceRecord {
  const lifecycleState = options.lifecycleState ?? 'active'
  const storageState = options.storageState ?? 'active'
  const removed = storageState === 'removed'
  return {
    viewerInstanceId: `viewer-${index}` as ViewerId,
    roomId: 'room-1' as RoomId,
    sessionId: 'session-1' as SessionId,
    audienceEpoch: (options.audienceEpoch ?? 1) as Epoch,
    personaId: options.personaId ?? (index % 2 === 0 ? 'persona-a' : 'persona-b'),
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
    privateState: privateState(options),
    viewerSequence: 0,
    lifecycleState,
    presenceRevision: 1,
    moderationRevision: 1,
    behaviorRevision: 1,
    joinedAt: wallClockTimestampMs(1_000),
    lastLeftAt: lifecycleState === 'left' ? wallClockTimestampMs(9_000) : null,
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
    createdEpoch: 1,
    removedEpoch: removed ? 1 : null,
    storageState
  }
}

function privateState(options: ViewerOptions): ViewerPrivateState {
  return {
    revision: 1,
    published_event_ids: [],
    direct_interaction_event_ids: [],
    attention: [],
    mood: {},
    cooldown_until_ms:
      options.cooldownUntil === undefined ? null : options.cooldownUntil,
    attention_strength: 0.5,
    arousal: 0,
    fatigue: 0,
    engagement: 0.5,
    last_spoke_at_ms: options.lastSpokeAt ?? null,
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
    roomId: 'room-1' as RoomId,
    sessionId: 'session-1' as SessionId,
    audienceEpoch: 1 as Epoch,
    runtimeRevision: 1 as Revision,
    observationId,
    replayIdentity: `replay-${observationId}`,
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
      roomId: 'room-1' as RoomId,
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
