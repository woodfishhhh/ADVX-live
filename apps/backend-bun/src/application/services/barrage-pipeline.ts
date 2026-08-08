import {
  VIEWER_BARRAGE_TEXT_PRODUCT_LIMIT,
  barrageSnapshotSchema,
  truncateViewerBarrageText,
  viewerModelOutputSchema,
  type BarrageSnapshot,
  type Epoch,
  type Revision,
  type RoomId,
  type SessionId,
  type ViewerModelOutput,
  type ViewerId
} from '@advx/contracts'

import {
  wallClockTimestampMs,
  type WallClockTimestampMs
} from '../ports'
import type {
  PersistedViewerState,
  ViewerPrivateState
} from '../ports/repositories'
import type { ValidatedViewerGeneration } from './model-output-validation'
import type {
  ViewerDecisionContext,
  ViewerDecisionFence
} from './viewer-decision-context'
import type {
  AcceptedViewerBarragePublication,
  ViewerBarrageAcceptancePort,
  ViewerBarragePublicationCommit,
  ViewerBarragePublicationPort,
  ViewerGenerationAcceptanceInput
} from './viewer-generation'

export const BARRAGE_DUPLICATE_WINDOW_MS = 30_000
export const BARRAGE_DENSITY_WINDOW_MS = 10_000
export const BARRAGE_MAX_PUBLICATIONS_PER_DENSITY_WINDOW = 6
export const BARRAGE_MAX_DUPLICATE_ENTRIES = 256
export const BARRAGE_SEMANTIC_DUPLICATE_THRESHOLD = 0.85
export const BARRAGE_PERSONAL_COOLDOWN_FLOOR_MS = 15_000
export const BARRAGE_FATIGUE_INCREMENT = 0.08
export const BARRAGE_ENGAGEMENT_INCREMENT = 0.04
export const BARRAGE_PEER_AFFINITY_INCREMENT = 0.05

export type BarragePipelinePolicyInput = Readonly<{
  blockedWords?: readonly string[]
  duplicateWindowMs?: number
  densityWindowMs?: number
  maxPublicationsPerDensityWindow?: number
  maxDuplicateEntries?: number
  semanticDuplicateThreshold?: number
}>

export type BarragePipelinePolicy = Readonly<{
  blockedWords: readonly string[]
  duplicateWindowMs: number
  densityWindowMs: number
  maxPublicationsPerDensityWindow: number
  maxDuplicateEntries: number
  semanticDuplicateThreshold: number
  maxTextCodePoints: typeof VIEWER_BARRAGE_TEXT_PRODUCT_LIMIT
}>

export type BarragePipelineViewerSnapshot = Readonly<{
  viewerInstanceId: ViewerId
  personaId: string
  displayName: string
  viewerSequence: number
  privateStateRevision: number
  lifecycleState: 'not_joined' | 'active' | 'left' | 'kicked' | 'ended' | 'removed'
  storageState: PersistedViewerState
  mutedUntil: WallClockTimestampMs | null
  personaRevision: Revision
  presenceRevision: Revision
  moderationRevision: Revision
  behaviorRevision: Revision
}>

export type TrustedViewerBarrageEvent = Readonly<{
  type: 'barrage.event'
  publicationKey: string
  contextId: string
  selectionId: string
  batchId: string
  batchIndex: number
  batchSize: number
  sourceTextIndex: number
  parentEventId: string | null
  relatedInputEventIds: readonly string[]
  barrage: Readonly<BarrageSnapshot>
}>

export type RecentBarragePublication = Readonly<{
  publicationKey: string
  event: TrustedViewerBarrageEvent
  publishedAt: WallClockTimestampMs
}>

export type BarragePipelineSnapshot = Readonly<{
  acceptingPublications: boolean
  roomId: RoomId
  sessionId: SessionId
  audienceEpoch: Epoch
  observationId: string
  runtimeRevision: Revision
  activeViewerIds: readonly ViewerId[]
  viewer: BarragePipelineViewerSnapshot | null
  recentPublications: readonly RecentBarragePublication[]
}>

export type BarrageViewerStateEffect = Readonly<{
  publicationId: string
  expectedPrivateStateRevision: number
  expectedBehaviorRevision: number
  publishedAt: WallClockTimestampMs
  cooldownUntil: WallClockTimestampMs
  targetViewerId: ViewerId | null
  appendPublishedEventId: true
  fatigueIncrement: typeof BARRAGE_FATIGUE_INCREMENT
  engagementIncrement: typeof BARRAGE_ENGAGEMENT_INCREMENT
  peerAffinityIncrement: typeof BARRAGE_PEER_AFFINITY_INCREMENT
  resetSilenceStreak: true
  incrementSpeechStreak: true
}>

export type BarrageAtomicPublicationCommand = Readonly<{
  publication: AcceptedViewerBarragePublication
  publicationKey: string
  event: TrustedViewerBarrageEvent
  policy: BarragePipelinePolicy
  stateEffect: BarrageViewerStateEffect
}>

export type BarrageRejectionReason =
  | 'schema'
  | 'viewer_identity'
  | 'scope'
  | 'sequence'
  | 'expired'
  | 'viewer_unavailable'
  | 'revision'
  | 'evidence'
  | 'target'
  | 'content'
  | 'duplicate'
  | 'density'

export type BarrageAtomicPublicationResult =
  | Readonly<{
    status: 'rejected'
    reason: BarrageRejectionReason
  }>
  | Readonly<{
    status: 'committed'
    event: TrustedViewerBarrageEvent
    stateUpdateCount: 1
  }>
  | Readonly<{
    status: 'already_committed'
    event: TrustedViewerBarrageEvent
    stateUpdateCount: 0
  }>

export interface BarragePublicationStatePort {
  inspect(
    fence: ViewerDecisionFence,
    signal: AbortSignal
  ): Promise<BarragePipelineSnapshot | null>

  /**
   * Implementations must check idempotency first, reject an already-aborted
   * signal, then evaluate and persist the public event, duplicate/density
   * history, and Viewer state effect in one serialized transaction. Rejection
   * must also leave cooldown, relationship, room-event, and memory state intact.
   */
  commitIfCurrent(
    command: BarrageAtomicPublicationCommand,
    signal: AbortSignal
  ): Promise<BarrageAtomicPublicationResult>
}

export type AcceptedBarrageSideEffectSubmission = Readonly<{
  roomId: RoomId
  sessionId: SessionId
  audienceEpoch: Epoch
  observationId: string
  memoryRevision: Revision
  event: TrustedViewerBarrageEvent
}>

export interface AcceptedBarrageSideEffectPort {
  submitAcceptedPublication(submission: AcceptedBarrageSideEffectSubmission): boolean
}

export type BarragePipelineDependencies = Readonly<{
  state: BarragePublicationStatePort
  sideEffects?: AcceptedBarrageSideEffectPort
  policy?: BarragePipelinePolicyInput
  wallClockNow?: () => number
  nextPublicationId?: () => string
}>

export class BarragePipelineError extends Error {
  constructor(
    readonly code: 'invalid_policy' | 'invalid_state_effect' | 'invalid_state_result',
    message: string
  ) {
    super(message)
    this.name = 'BarragePipelineError'
  }
}

export class BarragePipeline implements
  ViewerBarrageAcceptancePort,
  ViewerBarragePublicationPort {
  readonly policy: BarragePipelinePolicy
  readonly #wallClockNow: () => number
  readonly #nextPublicationId: () => string

  constructor(private readonly dependencies: BarragePipelineDependencies) {
    this.policy = createBarragePipelinePolicy(dependencies.policy)
    this.#wallClockNow = dependencies.wallClockNow ?? (() => Date.now())
    this.#nextPublicationId = dependencies.nextPublicationId ?? (() => crypto.randomUUID())
  }

  async acceptedTextIndexes(
    input: ViewerGenerationAcceptanceInput
  ): Promise<readonly number[]> {
    if (input.signal.aborted) return Object.freeze([])
    const output = parsedBarrageOutput(input.generation)
    if (output === null) return Object.freeze([])
    const now = this.#wallClockNow()
    if (now >= input.context.fence.deadlineAt) return Object.freeze([])

    const snapshot = await this.dependencies.state.inspect(
      input.context.fence,
      input.signal
    )
    if (
      input.signal.aborted ||
      snapshot === null ||
      snapshotRejection(input.context, snapshot, now) !== null ||
      !evidenceAllowed(
        output.evidence_refs,
        allowedEvidenceEventIds(input.context),
        input.context.frames.frames.length
      ) ||
      !targetAllowed(
        output.target,
        input.context.activeViewerIds,
        snapshot.activeViewerIds,
        input.context.replyContext.map((event) => event.eventId)
      )
    ) {
      return Object.freeze([])
    }

    const accepted: number[] = []
    const recentTexts = activeRecentPublications(
      snapshot.recentPublications,
      now,
      this.policy.duplicateWindowMs,
      this.policy.maxDuplicateEntries
    ).map((item) => item.event.barrage.text)
    let density = activeDensityCount(
      snapshot.recentPublications,
      now,
      this.policy.densityWindowMs
    )
    for (let index = 0; index < input.generation.publicationTexts.length; index += 1) {
      const text = input.generation.publicationTexts[index]!.trim()
      if (contentRejection(text, this.policy) !== null) continue
      if (
        recentTexts.some((recentText) => isSemanticBarrageDuplicate(
          text,
          recentText,
          this.policy.semanticDuplicateThreshold
        ))
      ) {
        continue
      }
      if (density >= this.policy.maxPublicationsPerDensityWindow) continue
      accepted.push(index)
      recentTexts.push(text)
      density += 1
    }
    return Object.freeze(accepted)
  }

  async commitToSharedHistoryIfCurrent(
    publication: AcceptedViewerBarragePublication,
    signal: AbortSignal
  ): Promise<ViewerBarragePublicationCommit | null> {
    const now = this.#wallClockNow()
    if (signal.aborted || now >= publication.deadlineAt) return null
    const text = publication.text.trim()
    const publicationKey = `${publication.generationRequestId}:${publication.sourceTextIndex}`
    const publicationId = this.#nextPublicationId()
    const event = trustedEvent(publication, publicationKey, publicationId, text, now)
    const stateEffect = viewerStateEffect(publication, publicationId, now)
    const command: BarrageAtomicPublicationCommand = Object.freeze({
      publication,
      publicationKey,
      event,
      policy: this.policy,
      stateEffect
    })
    if (staticPublicationRejection(command, now) !== null) return null

    const snapshot = await this.dependencies.state.inspect(publication.fence, signal)
    if (signal.aborted || snapshot === null) return null
    const existing = snapshot.recentPublications.find((item) =>
      item.publicationKey === publicationKey
    )
    if (existing !== undefined) {
      const idempotent = {
        status: 'already_committed' as const,
        event: existing.event,
        stateUpdateCount: 0 as const
      }
      validateStateResult(idempotent, publication, publicationKey)
      return Object.freeze({
        publicationId: existing.event.barrage.barrage_id,
        publishedAt: existing.publishedAt
      })
    }
    if (barrageAtomicRejection(snapshot, command, now) !== null) return null

    const result = await this.dependencies.state.commitIfCurrent(command, signal)
    if (result.status === 'rejected') return null
    validateStateResult(result, publication, publicationKey)
    if (result.status === 'committed') {
      try {
        this.dependencies.sideEffects?.submitAcceptedPublication(Object.freeze({
          roomId: publication.fence.roomId,
          sessionId: publication.fence.sessionId,
          audienceEpoch: publication.fence.audienceEpoch,
          observationId: publication.fence.observationId,
          memoryRevision: publication.roomMemoryRevision,
          event: result.event
        }))
      } catch {
        // The accepted public event is authoritative; its side effects are best effort.
      }
    }
    return Object.freeze({
      publicationId: result.event.barrage.barrage_id,
      publishedAt: wallClockTimestampMs(result.event.barrage.created_at_ms)
    })
  }
}

export function createBarragePipelinePolicy(
  input: BarragePipelinePolicyInput = {}
): BarragePipelinePolicy {
  const duplicateWindowMs = input.duplicateWindowMs ?? BARRAGE_DUPLICATE_WINDOW_MS
  const densityWindowMs = input.densityWindowMs ?? BARRAGE_DENSITY_WINDOW_MS
  const maxPublicationsPerDensityWindow = input.maxPublicationsPerDensityWindow ??
    BARRAGE_MAX_PUBLICATIONS_PER_DENSITY_WINDOW
  const maxDuplicateEntries = input.maxDuplicateEntries ?? BARRAGE_MAX_DUPLICATE_ENTRIES
  const semanticDuplicateThreshold = input.semanticDuplicateThreshold ??
    BARRAGE_SEMANTIC_DUPLICATE_THRESHOLD
  if (
    !positiveInteger(duplicateWindowMs) ||
    !positiveInteger(densityWindowMs) ||
    !nonnegativeInteger(maxPublicationsPerDensityWindow) ||
    !positiveInteger(maxDuplicateEntries) ||
    !Number.isFinite(semanticDuplicateThreshold) ||
    semanticDuplicateThreshold <= 0 ||
    semanticDuplicateThreshold > 1
  ) {
    throw new BarragePipelineError('invalid_policy', 'barrage policy limits are invalid')
  }
  const blockedWords = [...new Set((input.blockedWords ?? []).map((word) =>
    normalizeBarrageSemanticText(word)
  ))]
  if (blockedWords.some((word) => word.length === 0)) {
    throw new BarragePipelineError('invalid_policy', 'blocked words must be non-empty')
  }
  return deepFreeze({
    blockedWords,
    duplicateWindowMs,
    densityWindowMs,
    maxPublicationsPerDensityWindow,
    maxDuplicateEntries,
    semanticDuplicateThreshold,
    maxTextCodePoints: VIEWER_BARRAGE_TEXT_PRODUCT_LIMIT
  })
}

export function barrageAtomicRejection(
  snapshot: BarragePipelineSnapshot,
  command: BarrageAtomicPublicationCommand,
  now: number
): BarrageRejectionReason | null {
  const staticReason = staticPublicationRejection(command, now)
  if (staticReason !== null) return staticReason
  const { publication, event, policy } = command
  const viewer = snapshot.viewer
  if (
    viewer === null ||
    publication.viewer.viewerInstanceId !== viewer.viewerInstanceId ||
    publication.viewer.personaId !== viewer.personaId ||
    publication.viewer.displayName !== viewer.displayName ||
    event.barrage.viewer_instance_id !== viewer.viewerInstanceId ||
    event.barrage.persona_id !== viewer.personaId ||
    event.barrage.display_name !== viewer.displayName
  ) {
    return 'viewer_identity'
  }
  if (
    !snapshot.acceptingPublications ||
    publication.fence.roomId !== snapshot.roomId ||
    publication.fence.sessionId !== snapshot.sessionId ||
    publication.fence.audienceEpoch !== snapshot.audienceEpoch ||
    publication.fence.observationId !== snapshot.observationId ||
    publication.fence.runtimeRevision !== snapshot.runtimeRevision
  ) {
    return 'scope'
  }
  if (
    publication.fence.viewerSequence !== viewer.viewerSequence ||
    event.barrage.viewer_sequence !== viewer.viewerSequence ||
    !batchPrefixCurrent(snapshot.recentPublications, publication)
  ) {
    return 'sequence'
  }
  if (now >= publication.deadlineAt || event.barrage.expires_at_ms <= now) {
    return 'expired'
  }
  if (
    viewer.storageState !== 'active' ||
    viewer.lifecycleState !== 'active' ||
    (viewer.mutedUntil !== null && viewer.mutedUntil > now)
  ) {
    return 'viewer_unavailable'
  }
  const expectedBehaviorRevision = Number(publication.fence.behaviorRevision) +
    publication.batchIndex
  const expectedPrivateStateRevision = publication.privateStateRevision +
    publication.batchIndex
  if (
    publication.fence.personaRevision !== viewer.personaRevision ||
    publication.fence.presenceRevision !== viewer.presenceRevision ||
    publication.fence.moderationRevision !== viewer.moderationRevision ||
    viewer.behaviorRevision !== expectedBehaviorRevision ||
    viewer.privateStateRevision !== expectedPrivateStateRevision ||
    command.stateEffect.expectedBehaviorRevision !== expectedBehaviorRevision ||
    command.stateEffect.expectedPrivateStateRevision !== expectedPrivateStateRevision
  ) {
    return 'revision'
  }
  if (
    !evidenceAllowed(
      publication.evidenceRefs,
      publication.allowedEvidenceEventIds,
      publication.frameCount
    )
  ) {
    return 'evidence'
  }
  if (
    !targetAllowed(
      publication.target,
      publication.activeViewerIds,
      snapshot.activeViewerIds,
      publication.replyableEventIds
    )
  ) {
    return 'target'
  }
  const contentReason = contentRejection(event.barrage.text, policy)
  if (contentReason !== null) return contentReason
  const recent = activeRecentPublications(
    snapshot.recentPublications,
    now,
    policy.duplicateWindowMs,
    policy.maxDuplicateEntries
  )
  if (
    recent.some((item) => isSemanticBarrageDuplicate(
      event.barrage.text,
      item.event.barrage.text,
      policy.semanticDuplicateThreshold
    ))
  ) {
    return 'duplicate'
  }
  if (
    activeDensityCount(snapshot.recentPublications, now, policy.densityWindowMs) >=
      policy.maxPublicationsPerDensityWindow
  ) {
    return 'density'
  }
  return null
}

export function applyBarrageViewerStateEffect(
  state: ViewerPrivateState,
  effect: BarrageViewerStateEffect
): ViewerPrivateState {
  if (state.revision !== effect.expectedPrivateStateRevision) {
    throw new BarragePipelineError(
      'invalid_state_effect',
      'Viewer private state no longer matches the atomic publication effect'
    )
  }
  const targetId = effect.targetViewerId
  const peerAffinities = { ...state.peer_affinities }
  if (targetId !== null) {
    peerAffinities[targetId] = Math.min(
      1,
      (peerAffinities[targetId] ?? 0) + effect.peerAffinityIncrement
    )
  }
  const boundedPeerAffinities = Object.fromEntries(
    Object.entries(peerAffinities).slice(-32)
  )
  return deepFreeze({
    ...state,
    revision: state.revision + 1,
    published_event_ids: [...new Set([
      ...state.published_event_ids,
      effect.publicationId
    ])].slice(-64),
    cooldown_until_ms: effect.cooldownUntil,
    last_spoke_at_ms: effect.publishedAt,
    last_reacted_at_ms: effect.publishedAt,
    fatigue: Math.min(1, state.fatigue + effect.fatigueIncrement),
    engagement: Math.min(1, state.engagement + effect.engagementIncrement),
    current_target_viewer_id: targetId,
    peer_affinities: boundedPeerAffinities,
    silence_streak: 0,
    speech_streak: state.speech_streak + 1
  })
}

export function normalizeBarrageSemanticText(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('und')
    .replace(/[\p{White_Space}\p{P}]+/gu, '')
}

export function isSemanticBarrageDuplicate(
  left: string,
  right: string,
  threshold = BARRAGE_SEMANTIC_DUPLICATE_THRESHOLD
): boolean {
  const normalizedLeft = normalizeBarrageSemanticText(left)
  const normalizedRight = normalizeBarrageSemanticText(right)
  if (normalizedLeft === normalizedRight) return normalizedLeft.length > 0
  const leftPoints = [...normalizedLeft]
  const rightPoints = [...normalizedRight]
  if (leftPoints.length < 4 || rightPoints.length < 4) return false
  return bigramDice(leftPoints, rightPoints) >= threshold
}

function parsedBarrageOutput(
  generation: ValidatedViewerGeneration
): (ViewerModelOutput & { action: 'barrage'; texts: readonly string[] }) | null {
  const parsed = viewerModelOutputSchema.safeParse(generation.output)
  if (!parsed.success || parsed.data.action !== 'barrage' || parsed.data.texts === null) {
    return null
  }
  if (
    parsed.data.texts.length !== generation.publicationTexts.length ||
    parsed.data.texts.some((text, index) =>
      truncateViewerBarrageText(text) !== generation.publicationTexts[index]
    )
  ) {
    return null
  }
  return parsed.data as ViewerModelOutput & {
    action: 'barrage'
    texts: readonly string[]
  }
}

function snapshotRejection(
  context: ViewerDecisionContext,
  snapshot: BarragePipelineSnapshot,
  now: number
): BarrageRejectionReason | null {
  const viewer = snapshot.viewer
  if (
    viewer === null ||
    context.fence.viewerInstanceId !== context.viewer.viewerInstanceId ||
    context.viewer.viewerInstanceId !== viewer.viewerInstanceId ||
    context.viewer.personaId !== viewer.personaId ||
    context.viewer.displayName !== viewer.displayName
  ) return 'viewer_identity'
  if (
    !snapshot.acceptingPublications ||
    context.fence.roomId !== snapshot.roomId ||
    context.fence.sessionId !== snapshot.sessionId ||
    context.fence.audienceEpoch !== snapshot.audienceEpoch ||
    context.fence.observationId !== snapshot.observationId ||
    context.fence.runtimeRevision !== snapshot.runtimeRevision
  ) return 'scope'
  if (context.fence.viewerSequence !== viewer.viewerSequence) return 'sequence'
  if (now >= context.fence.deadlineAt) return 'expired'
  if (
    viewer.storageState !== 'active' ||
    viewer.lifecycleState !== 'active' ||
    (viewer.mutedUntil !== null && viewer.mutedUntil > now)
  ) return 'viewer_unavailable'
  if (
    context.fence.personaRevision !== viewer.personaRevision ||
    context.fence.presenceRevision !== viewer.presenceRevision ||
    context.fence.moderationRevision !== viewer.moderationRevision ||
    context.fence.behaviorRevision !== viewer.behaviorRevision ||
    context.privateContext.state.revision !== viewer.privateStateRevision
  ) return 'revision'
  return null
}

function staticPublicationRejection(
  command: BarrageAtomicPublicationCommand,
  now: number
): BarrageRejectionReason | null {
  const { publication, publicationKey, event, stateEffect } = command
  if (
    publicationKey !== `${publication.generationRequestId}:${publication.sourceTextIndex}` ||
    !nonnegativeInteger(publication.batchIndex) ||
    !positiveInteger(publication.batchSize) ||
    publication.batchIndex >= publication.batchSize ||
    !nonnegativeInteger(publication.sourceTextIndex) ||
    !nonnegativeInteger(publication.frameCount) ||
    !nonnegativeInteger(Number(publication.roomMemoryRevision)) ||
    !positiveInteger(publication.privateStateRevision) ||
    !nonnegativeInteger(publication.personaCooldownMs) ||
    event.type !== 'barrage.event' ||
    event.publicationKey !== publicationKey ||
    event.contextId !== publication.contextId ||
    event.selectionId !== publication.selectionId ||
    event.batchId !== publication.batchId ||
    event.batchIndex !== publication.batchIndex ||
    event.batchSize !== publication.batchSize ||
    event.sourceTextIndex !== publication.sourceTextIndex ||
    event.parentEventId !== publication.parentEventId ||
    event.barrage.barrage_id !== stateEffect.publicationId ||
    event.barrage.room_id !== publication.fence.roomId ||
    event.barrage.session_id !== publication.fence.sessionId ||
    event.barrage.audience_epoch !== publication.fence.audienceEpoch ||
    event.barrage.observation_id !== publication.fence.observationId ||
    event.barrage.generation_request_id !== publication.generationRequestId ||
    event.barrage.viewer_instance_id !== publication.viewer.viewerInstanceId ||
    event.barrage.persona_id !== publication.viewer.personaId ||
    event.barrage.display_name !== publication.viewer.displayName ||
    event.barrage.viewer_sequence !== publication.fence.viewerSequence ||
    event.barrage.reaction_type !== publication.reactionType ||
    event.barrage.intent !== publication.intent ||
    !sameTarget(event.barrage.target ?? null, publication.target) ||
    !sameEvidence(event.barrage.evidence_refs, publication.evidenceRefs) ||
    event.barrage.text !== publication.text.trim() ||
    event.barrage.created_at_ms > now ||
    event.barrage.expires_at_ms !== publication.deadlineAt ||
    !sameStrings(event.relatedInputEventIds, publication.relatedInputEventIds) ||
    stateEffect.expectedPrivateStateRevision !==
      publication.privateStateRevision + publication.batchIndex ||
    stateEffect.expectedBehaviorRevision !==
      Number(publication.fence.behaviorRevision) + publication.batchIndex ||
    stateEffect.publishedAt !== event.barrage.created_at_ms ||
    stateEffect.cooldownUntil !== event.barrage.created_at_ms + Math.max(
      BARRAGE_PERSONAL_COOLDOWN_FLOOR_MS,
      publication.personaCooldownMs
    ) ||
    stateEffect.targetViewerId !== (
      publication.target?.kind === 'viewer'
        ? publication.target.viewer_instance_id ?? null
        : null
    ) ||
    stateEffect.appendPublishedEventId !== true ||
    stateEffect.fatigueIncrement !== BARRAGE_FATIGUE_INCREMENT ||
    stateEffect.engagementIncrement !== BARRAGE_ENGAGEMENT_INCREMENT ||
    stateEffect.peerAffinityIncrement !== BARRAGE_PEER_AFFINITY_INCREMENT ||
    stateEffect.resetSilenceStreak !== true ||
    stateEffect.incrementSpeechStreak !== true ||
    !barrageSnapshotSchema.safeParse(event.barrage).success
  ) return 'schema'
  return null
}

function trustedEvent(
  publication: AcceptedViewerBarragePublication,
  publicationKey: string,
  publicationId: string,
  text: string,
  now: number
): TrustedViewerBarrageEvent {
  return deepFreeze({
    type: 'barrage.event' as const,
    publicationKey,
    contextId: publication.contextId,
    selectionId: publication.selectionId,
    batchId: publication.batchId,
    batchIndex: publication.batchIndex,
    batchSize: publication.batchSize,
    sourceTextIndex: publication.sourceTextIndex,
    parentEventId: publication.parentEventId,
    relatedInputEventIds: publication.relatedInputEventIds,
    barrage: {
      barrage_id: publicationId,
      room_id: publication.fence.roomId,
      session_id: publication.fence.sessionId,
      audience_epoch: publication.fence.audienceEpoch,
      observation_id: publication.fence.observationId,
      generation_request_id: publication.generationRequestId,
      viewer_instance_id: publication.viewer.viewerInstanceId,
      persona_id: publication.viewer.personaId,
      display_name: publication.viewer.displayName,
      viewer_sequence: publication.fence.viewerSequence,
      reaction_type: publication.reactionType,
      intent: publication.intent,
      target: publication.target,
      evidence_refs: publication.evidenceRefs,
      text,
      created_at_ms: now,
      expires_at_ms: publication.deadlineAt
    }
  })
}

function viewerStateEffect(
  publication: AcceptedViewerBarragePublication,
  publicationId: string,
  now: number
): BarrageViewerStateEffect {
  const targetViewerId = publication.target?.kind === 'viewer'
    ? publication.target.viewer_instance_id ?? null
    : null
  return Object.freeze({
    publicationId,
    expectedPrivateStateRevision: publication.privateStateRevision +
      publication.batchIndex,
    expectedBehaviorRevision: Number(publication.fence.behaviorRevision) +
      publication.batchIndex,
    publishedAt: wallClockTimestampMs(now),
    cooldownUntil: wallClockTimestampMs(
      now + Math.max(BARRAGE_PERSONAL_COOLDOWN_FLOOR_MS, publication.personaCooldownMs)
    ),
    targetViewerId,
    appendPublishedEventId: true,
    fatigueIncrement: BARRAGE_FATIGUE_INCREMENT,
    engagementIncrement: BARRAGE_ENGAGEMENT_INCREMENT,
    peerAffinityIncrement: BARRAGE_PEER_AFFINITY_INCREMENT,
    resetSilenceStreak: true,
    incrementSpeechStreak: true
  })
}

function validateStateResult(
  result: Exclude<BarrageAtomicPublicationResult, { status: 'rejected' }>,
  publication: AcceptedViewerBarragePublication,
  publicationKey: string
): void {
  if (
    (result.status === 'committed' && result.stateUpdateCount !== 1) ||
    (result.status === 'already_committed' && result.stateUpdateCount !== 0) ||
    result.event.publicationKey !== publicationKey ||
    result.event.contextId !== publication.contextId ||
    result.event.batchId !== publication.batchId ||
    result.event.sourceTextIndex !== publication.sourceTextIndex ||
    result.event.barrage.generation_request_id !== publication.generationRequestId ||
    result.event.barrage.viewer_instance_id !== publication.viewer.viewerInstanceId ||
    result.event.barrage.text !== publication.text.trim() ||
    !barrageSnapshotSchema.safeParse(result.event.barrage).success
  ) {
    throw new BarragePipelineError(
      'invalid_state_result',
      'atomic publication state returned an invalid or unrelated commit'
    )
  }
}

function contentRejection(
  text: string,
  policy: BarragePipelinePolicy
): 'content' | null {
  const normalized = normalizeBarrageSemanticText(text)
  if (
    text.length === 0 ||
    [...text].length > policy.maxTextCodePoints ||
    normalized.length === 0 ||
    policy.blockedWords.some((word) => normalized.includes(word))
  ) return 'content'
  return null
}

function evidenceAllowed(
  evidenceRefs: AcceptedViewerBarragePublication['evidenceRefs'],
  allowedEventIds: readonly string[],
  frameCount: number
): boolean {
  const eventIds = new Set(allowedEventIds)
  return evidenceRefs.every((reference) => reference.source === 'event'
    ? reference.event_id != null && eventIds.has(reference.event_id)
    : reference.frame_index != null &&
      reference.frame_index >= 0 &&
      reference.frame_index < frameCount)
}

function targetAllowed(
  target: AcceptedViewerBarragePublication['target'],
  frozenActiveViewerIds: readonly string[],
  currentActiveViewerIds: readonly string[],
  replyableEventIds: readonly string[]
): boolean {
  if (target === null) return true
  if (target.kind === 'viewer') {
    const targetId = target.viewer_instance_id
    return targetId != null &&
      new Set(frozenActiveViewerIds).has(targetId) &&
      new Set(currentActiveViewerIds).has(targetId)
  }
  if (target.kind === 'event') {
    return target.event_id != null && new Set(replyableEventIds).has(target.event_id)
  }
  return true
}

function allowedEvidenceEventIds(context: ViewerDecisionContext): readonly string[] {
  return [...new Set([
    ...context.publicContext.map((event) => event.eventId),
    ...context.replyContext.map((event) => event.eventId)
  ])]
}

function activeRecentPublications(
  publications: readonly RecentBarragePublication[],
  now: number,
  windowMs: number,
  maximum: number
): RecentBarragePublication[] {
  return publications
    .filter((item) => item.publishedAt > now - windowMs && item.publishedAt <= now)
    .slice(-maximum)
}

function activeDensityCount(
  publications: readonly RecentBarragePublication[],
  now: number,
  windowMs: number
): number {
  return publications.filter((item) =>
    item.publishedAt > now - windowMs && item.publishedAt <= now
  ).length
}

function batchPrefixCurrent(
  publications: readonly RecentBarragePublication[],
  publication: AcceptedViewerBarragePublication
): boolean {
  if (publication.batchIndex === 0) return true
  const prefix = publications
    .filter((item) =>
      item.event.batchId === publication.batchId &&
      item.event.contextId === publication.contextId &&
      item.event.barrage.viewer_instance_id === publication.viewer.viewerInstanceId &&
      item.event.batchIndex < publication.batchIndex
    )
    .sort((left, right) => left.event.batchIndex - right.event.batchIndex)
  return prefix.length === publication.batchIndex && prefix.every((item, index) =>
    item.event.batchIndex === index && item.event.batchSize === publication.batchSize
  )
}

function bigramDice(left: readonly string[], right: readonly string[]): number {
  const counts = new Map<string, number>()
  for (let index = 0; index < left.length - 1; index += 1) {
    const key = left[index]! + left[index + 1]!
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let intersection = 0
  for (let index = 0; index < right.length - 1; index += 1) {
    const key = right[index]! + right[index + 1]!
    const count = counts.get(key) ?? 0
    if (count > 0) {
      intersection += 1
      counts.set(key, count - 1)
    }
  }
  return (2 * intersection) / (left.length + right.length - 2)
}

function sameTarget(
  left: AcceptedViewerBarragePublication['target'],
  right: AcceptedViewerBarragePublication['target']
): boolean {
  return left?.kind === right?.kind &&
    (left?.viewer_instance_id ?? null) === (right?.viewer_instance_id ?? null) &&
    (left?.event_id ?? null) === (right?.event_id ?? null)
}

function sameEvidence(
  left: AcceptedViewerBarragePublication['evidenceRefs'],
  right: AcceptedViewerBarragePublication['evidenceRefs']
): boolean {
  return left.length === right.length && left.every((item, index) => {
    const other = right[index]
    return other !== undefined &&
      item.source === other.source &&
      (item.event_id ?? null) === (other.event_id ?? null) &&
      (item.frame_index ?? null) === (other.frame_index ?? null)
  })
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index])
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function nonnegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value)) deepFreeze(child)
  }
  return value
}
