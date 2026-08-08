import {
  VIEWER_GENERATION_SCHEMA_NAME,
  type CanonicalRuntimeSpec,
  type Epoch,
  type ModeDefinition,
  type PersonaOverride,
  type PersonaTemplate,
  type Revision,
  type RoomId,
  type SessionId,
  type ViewerId
} from '@advx/contracts'

import type {
  ProviderIdentity,
  ProviderRoleModel
} from '../ports/providers'
import type {
  RoomEventRecord,
  RoomMemorySlice,
  ViewerInstanceRecord,
  ViewerInstanceVariant,
  ViewerPrivateState
} from '../ports/repositories'
import {
  FRAME_BUNDLE_LIMIT,
  OBSERVATION_PUBLIC_LIMIT,
  OBSERVATION_PUBLIC_WINDOW_MS,
  OBSERVATION_REPLY_LIMIT,
  OBSERVATION_REPLY_WINDOW_MS,
  type ObservationFrameBundle,
  type ObservationWave
} from './observation-wave'

export const VIEWER_PUBLIC_SOURCE_QUOTA = 16
export const VIEWER_MEMORY_SLICE_LIMIT = 16
export const VIEWER_ACTIVE_ID_LIMIT = 32

export type ViewerMentionMetadata = Readonly<{
  targetViewerId: ViewerId | null
  targetPersonaId: string | null
  targetAmbiguous: boolean
}>

export type ViewerDecisionContextInput = Readonly<{
  wave: ObservationWave
  viewer: ViewerInstanceRecord
  spec: CanonicalRuntimeSpec
  viewerSequence: number
  provider: ProviderIdentity<'model'>
  roleModel: ProviderRoleModel<'viewer'>
  activeViewerIds: readonly ViewerId[]
  mention: ViewerMentionMetadata
  selectionId: string
}>

export type ViewerDecisionFence = Readonly<{
  roomId: RoomId
  sessionId: SessionId
  audienceEpoch: Epoch
  observationId: string
  runtimeRevision: Revision
  viewerInstanceId: ViewerId
  viewerSequence: number
  personaRevision: Revision
  presenceRevision: Revision
  moderationRevision: Revision
  behaviorRevision: Revision
  providerProfileId: string
  providerRevision: string
  viewerModelId: string
  deadlineAt: number
}>

export type ViewerDecisionPolicy = Readonly<{
  generationMode: 'per_viewer'
  allowedActions: readonly ['barrage', 'silence']
  silenceAllowed: true
  directMentionForcesSpeech: false
  independentDecision: true
  outputSchemaName: typeof VIEWER_GENERATION_SCHEMA_NAME
  globalRankingAllowed: false
}>

export type ViewerPersonaContext = Readonly<{
  template: Readonly<PersonaTemplate>
  activeMode: Readonly<ModeDefinition>
  modeOverride: Readonly<PersonaOverride> | null
  resolved: Readonly<PersonaTemplate>
  instanceVariant: ViewerInstanceVariant
}>

export type ViewerPrivateContext = Readonly<{
  state: ViewerPrivateState
  cooldownUntil: number | null
  cooldownActiveAtWave: boolean
  cooldownRemainingMs: number
}>

export type NormalizedViewerMention = ViewerMentionMetadata & Readonly<{
  viewerMentioned: boolean
  personaMentioned: boolean
}>

export type ViewerDecisionContext = Readonly<{
  contextId: string
  selectionId: string
  fence: ViewerDecisionFence
  viewer: Readonly<{
    viewerInstanceId: ViewerId
    username: string
    displayName: string
    locale: string
    personaId: string
  }>
  activeViewerIds: readonly ViewerId[]
  currentInput: readonly RoomEventRecord[]
  publicContext: readonly RoomEventRecord[]
  replyContext: readonly RoomEventRecord[]
  frames: ObservationFrameBundle
  mention: NormalizedViewerMention
  roomMemory: RoomMemorySlice
  persona: ViewerPersonaContext
  privateContext: ViewerPrivateContext
  decision: ViewerDecisionPolicy
}>

export type ViewerDecisionContextErrorCode =
  | 'invalid_scope'
  | 'invalid_revision'
  | 'invalid_provider'
  | 'invalid_viewer'
  | 'invalid_mention'
  | 'invalid_context'

export class ViewerDecisionContextError extends Error {
  constructor(
    readonly code: ViewerDecisionContextErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ViewerDecisionContextError'
  }
}

const DECISION_POLICY: ViewerDecisionPolicy = deepFrozenClone({
  generationMode: 'per_viewer',
  allowedActions: ['barrage', 'silence'] as const,
  silenceAllowed: true as const,
  directMentionForcesSpeech: false as const,
  independentDecision: true as const,
  outputSchemaName: VIEWER_GENERATION_SCHEMA_NAME,
  globalRankingAllowed: false as const
})

export class ViewerDecisionContextBuilder {
  build(input: ViewerDecisionContextInput): ViewerDecisionContext {
    validateScope(input)
    validateViewer(input)
    validateProvider(input)
    validateContext(input.wave)

    const activeViewerIds = validateActiveViewerIds(
      input.activeViewerIds,
      input.viewer.viewerInstanceId
    )
    const mention = normalizeMention(input.mention, input.viewer)
    const persona = resolvePersona(input.spec, input.viewer)
    const currentInput = currentInputEvents(input.wave)
    const cooldownUntil = input.viewer.privateState.cooldown_until_ms
    const cooldownRemainingMs = Math.max(
      0,
      (cooldownUntil ?? input.wave.createdAt) - input.wave.createdAt
    )
    const fence: ViewerDecisionFence = {
      roomId: input.wave.roomId,
      sessionId: input.wave.sessionId,
      audienceEpoch: input.wave.audienceEpoch,
      observationId: input.wave.observationId,
      runtimeRevision: input.wave.runtimeRevision,
      viewerInstanceId: input.viewer.viewerInstanceId,
      viewerSequence: input.viewerSequence,
      personaRevision: input.viewer.personaRevision,
      presenceRevision: input.viewer.presenceRevision,
      moderationRevision: input.viewer.moderationRevision,
      behaviorRevision: input.viewer.behaviorRevision,
      providerProfileId: input.provider.providerProfileId,
      providerRevision: input.provider.providerRevision,
      viewerModelId: input.roleModel.modelId,
      deadlineAt: input.wave.deadlineAt
    }
    const contextId = decisionContextId(input, fence)

    return deepFrozenClone({
      contextId,
      selectionId: input.selectionId,
      fence,
      viewer: {
        viewerInstanceId: input.viewer.viewerInstanceId,
        username: input.viewer.username,
        displayName: input.viewer.displayName,
        locale: input.viewer.locale,
        personaId: input.viewer.personaId
      },
      activeViewerIds,
      currentInput,
      publicContext: input.wave.context.publicContext,
      replyContext: input.wave.context.replyContext,
      frames: input.wave.frameBundle,
      mention,
      roomMemory: input.wave.roomMemory,
      persona,
      privateContext: {
        state: input.viewer.privateState,
        cooldownUntil,
        cooldownActiveAtWave: cooldownRemainingMs > 0,
        cooldownRemainingMs
      },
      decision: DECISION_POLICY
    })
  }
}

function validateScope(input: ViewerDecisionContextInput): void {
  const { wave, viewer, spec } = input
  if (
    viewer.roomId !== wave.roomId ||
    viewer.sessionId !== wave.sessionId ||
    viewer.audienceEpoch !== wave.audienceEpoch ||
    spec.room.room_id !== wave.roomId
  ) {
    fail('invalid_scope', 'Viewer, runtime, and Observation scope must match')
  }
  if (spec.config_revision !== wave.runtimeRevision) {
    fail('invalid_revision', 'runtime revision must match the frozen Observation')
  }
  if (
    !Number.isSafeInteger(input.viewerSequence) ||
    input.viewerSequence <= viewer.viewerSequence
  ) {
    fail('invalid_revision', 'Viewer sequence must be a newly claimed sequence')
  }
  if (input.selectionId.trim().length === 0) {
    fail('invalid_context', 'selection identity must not be empty')
  }
}

function validateViewer(input: ViewerDecisionContextInput): void {
  const { viewer, wave } = input
  if (
    viewer.storageState !== 'active' ||
    viewer.lifecycleState !== 'active' ||
    (viewer.mutedUntil !== null && viewer.mutedUntil > wave.createdAt)
  ) {
    fail('invalid_viewer', 'Viewer must remain present and moderation-eligible')
  }
}

function validateProvider(input: ViewerDecisionContextInput): void {
  if (
    input.provider.providerProfileId !== input.spec.provider.provider_profile_id ||
    input.roleModel.role !== 'viewer' ||
    input.roleModel.modelId !== input.spec.provider.viewer_model
  ) {
    fail('invalid_provider', 'Viewer Provider identity must match the frozen runtime')
  }
}

function validateActiveViewerIds(
  values: readonly ViewerId[],
  candidateId: ViewerId
): readonly ViewerId[] {
  if (values.length === 0 || values.length > VIEWER_ACTIVE_ID_LIMIT) {
    fail('invalid_context', 'active Viewer identity list is outside its bound')
  }
  if (new Set(values).size !== values.length || !values.includes(candidateId)) {
    fail('invalid_context', 'active Viewer identities must be unique and include the candidate')
  }
  return values
}

function normalizeMention(
  mention: ViewerMentionMetadata,
  viewer: ViewerInstanceRecord
): NormalizedViewerMention {
  if (mention.targetAmbiguous) {
    return {
      targetViewerId: null,
      targetPersonaId: null,
      targetAmbiguous: true,
      viewerMentioned: false,
      personaMentioned: false
    }
  }
  if (mention.targetViewerId !== null && mention.targetPersonaId !== null) {
    fail('invalid_mention', 'an accurate mention can target one Viewer or one Persona')
  }
  if (
    mention.targetViewerId !== null &&
    mention.targetViewerId !== viewer.viewerInstanceId
  ) {
    fail('invalid_mention', 'direct Viewer context must belong to the named Viewer')
  }
  if (
    mention.targetPersonaId !== null &&
    mention.targetPersonaId !== viewer.personaId
  ) {
    fail('invalid_mention', 'direct Persona context must belong to the named Persona')
  }
  return {
    ...mention,
    viewerMentioned: mention.targetViewerId !== null,
    personaMentioned: mention.targetPersonaId !== null
  }
}

function validateContext(wave: ObservationWave): void {
  if (
    wave.context.publicContext.length > OBSERVATION_PUBLIC_LIMIT ||
    wave.context.replyContext.length > OBSERVATION_REPLY_LIMIT ||
    wave.frameBundle.frames.length > FRAME_BUNDLE_LIMIT ||
    wave.roomMemory.items.length > VIEWER_MEMORY_SLICE_LIMIT ||
    wave.roomMemory.memoryIds.length > VIEWER_MEMORY_SLICE_LIMIT ||
    wave.roomMemory.roomId !== wave.roomId
  ) {
    fail('invalid_context', 'frozen Viewer context exceeds a declared bound')
  }
  const memoryItemIds = wave.roomMemory.items.map((item) => item.memoryId)
  if (
    new Set(wave.roomMemory.memoryIds).size !== wave.roomMemory.memoryIds.length ||
    new Set(memoryItemIds).size !== memoryItemIds.length ||
    memoryItemIds.length !== wave.roomMemory.memoryIds.length ||
    memoryItemIds.some((id) => !wave.roomMemory.memoryIds.includes(id))
  ) {
    fail('invalid_context', 'Room memory identity slice is inconsistent')
  }

  const publicCutoff = wave.frozenAt - OBSERVATION_PUBLIC_WINDOW_MS
  const sourceCounts = new Map<PublicSourceCategory, number>()
  for (const event of wave.context.publicContext) {
    const category = publicSourceCategory(event)
    if (
      category === null ||
      event.roomId !== wave.roomId ||
      event.sessionId !== wave.sessionId ||
      event.occurredAt < publicCutoff ||
      event.occurredAt > wave.frozenAt
    ) {
      fail('invalid_context', 'public context is outside its frozen source boundary')
    }
    const count = (sourceCounts.get(category) ?? 0) + 1
    if (count > VIEWER_PUBLIC_SOURCE_QUOTA) {
      fail('invalid_context', 'public context exceeds a per-source quota')
    }
    sourceCounts.set(category, count)
  }

  const replyCutoff = wave.frozenAt - OBSERVATION_REPLY_WINDOW_MS
  for (const event of wave.context.replyContext) {
    if (
      event.sourceType !== 'audience_barrage' ||
      event.roomId !== wave.roomId ||
      event.sessionId !== wave.sessionId ||
      event.occurredAt < replyCutoff ||
      event.occurredAt > wave.frozenAt
    ) {
      fail('invalid_context', 'reply context is outside its frozen reply boundary')
    }
  }

  wave.frameBundle.frames.forEach((frame, index) => {
    if (frame.frameIndex !== index || frame.capturedAt > wave.frozenAt) {
      fail('invalid_context', 'frame bundle is not a frozen ordered selection')
    }
  })
}

function currentInputEvents(wave: ObservationWave): readonly RoomEventRecord[] {
  const required = new Set(
    wave.triggerEvents
      .filter((event) =>
        event.source === 'user_text' ||
        event.source === 'final_voice' ||
        event.source === 'system_audio'
      )
      .map((event) => event.eventId)
  )
  const current = wave.context.publicContext.filter((event) =>
    required.has(event.eventId)
  )
  const publicTriggerIds = new Set(wave.context.publicTriggerEventIds)
  if (
    current.length !== required.size ||
    current.some(
      (event) =>
        event.text === null ||
        event.audienceEpoch !== wave.audienceEpoch ||
        !publicTriggerIds.has(event.eventId)
    )
  ) {
    fail('invalid_context', 'full current input must be present in frozen public context')
  }
  return current
}

function resolvePersona(
  spec: CanonicalRuntimeSpec,
  viewer: ViewerInstanceRecord
): ViewerPersonaContext {
  const template = spec.personas.find(
    (persona) => persona.persona_id === viewer.personaId
  )
  const activeMode = spec.modes.find(
    (mode) => mode.mode_id === spec.active_mode_id
  )
  if (
    template === undefined ||
    activeMode === undefined ||
    template.revision !== viewer.personaRevision ||
    template.content_hash !== viewer.personaContentHash ||
    (activeMode.persona_counts[viewer.personaId] ?? 0) < 1
  ) {
    fail('invalid_viewer', 'Viewer Persona is unavailable in the frozen runtime')
  }
  const modeOverride = activeMode.persona_overrides?.[viewer.personaId] ?? null
  return {
    template,
    activeMode,
    modeOverride,
    resolved: applyPersonaOverride(template, modeOverride),
    instanceVariant: viewer.variant
  }
}

function applyPersonaOverride(
  persona: PersonaTemplate,
  override: PersonaOverride | null
): PersonaTemplate {
  if (override === null) return persona
  return {
    ...persona,
    ...(override.display_name == null ? {} : { display_name: override.display_name }),
    ...(override.traits == null ? {} : { traits: override.traits }),
    ...(override.speech_style == null ? {} : { speech_style: override.speech_style }),
    ...(override.behavior == null ? {} : { behavior: override.behavior }),
    ...(override.trigger_preferences == null
      ? {}
      : { trigger_preferences: override.trigger_preferences }),
    ...(override.avoid_patterns == null
      ? {}
      : { avoid_patterns: override.avoid_patterns }),
    ...(override.silence_bias == null ? {} : { silence_bias: override.silence_bias }),
    ...(override.burst_bias == null ? {} : { burst_bias: override.burst_bias }),
    ...(override.repetition_bias == null
      ? {}
      : { repetition_bias: override.repetition_bias }),
    ...(override.cooldown_ms == null ? {} : { cooldown_ms: override.cooldown_ms }),
    ...(override.content_flags == null ? {} : { content_flags: override.content_flags })
  }
}

type PublicSourceCategory = 'user' | 'system_audio' | 'screen'

function publicSourceCategory(
  event: RoomEventRecord
): PublicSourceCategory | null {
  if (event.sourceType === 'user_text' || event.sourceType === 'user_voice') {
    return 'user'
  }
  if (event.sourceType === 'screen_observation') return 'screen'
  if (
    event.sourceType === 'system_event' &&
    event.payload.event === 'system_audio_transcript'
  ) {
    return 'system_audio'
  }
  return null
}

function decisionContextId(
  input: ViewerDecisionContextInput,
  fence: ViewerDecisionFence
): string {
  const digest = new Bun.CryptoHasher('sha256')
    .update(
      `${input.wave.replayIdentity}\0${input.selectionId}\0` +
      `${fence.viewerInstanceId}\0${fence.viewerSequence}\0` +
      `${fence.providerProfileId}\0${fence.providerRevision}\0${fence.viewerModelId}`
    )
    .digest('hex')
  return `viewer-context-${digest.slice(0, 32)}`
}

function deepFrozenClone<T>(value: T): T {
  return deepFreeze(structuredClone(value))
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function fail(
  code: ViewerDecisionContextErrorCode,
  message: string
): never {
  throw new ViewerDecisionContextError(code, message)
}
