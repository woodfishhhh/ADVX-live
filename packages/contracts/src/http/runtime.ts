import {
  epochSchema,
  positiveRevisionSchema,
  revisionSchema,
  roomIdSchema,
  sessionIdSchema,
  timestampMsSchema,
  viewerIdSchema
} from '../scalars'
import { schema, type InferSchema } from '../schema'
import { httpProtocolVersionSchema } from '../versions'
import { sessionStateSchema, viewerLifecycleStateSchema } from '../enums'
import {
  boundedIdentifierSchema,
  optionalReasonSchema,
  safeJsonObjectSchema,
  sha256Schema
} from './common'
import { canonicalSha256 } from './canonical'

const unitIntervalSchema = schema.number({ minimum: 0, maximum: 1 })
const signedUnitIntervalSchema = schema.number({ minimum: -1, maximum: 1 })
const nullableTimestampSchema = schema.nullable(timestampMsSchema)

export const healthResponseSchema = schema.object({
  status: schema.enum(['ok', 'degraded']),
  protocol_version: httpProtocolVersionSchema,
  persistence_error: schema.optional(
    schema.nullable(
      schema.record(schema.string({ maxLength: 1_024 }), { maxProperties: 32 })
    )
  )
})

export const providerRuntimeSpecSchema = schema.object({
  provider_profile_id: boundedIdentifierSchema,
  viewer_model: schema.string({ minLength: 1, maxLength: 256 }),
  memory_model: schema.string({ minLength: 1, maxLength: 256 }),
  visual_summary_model: schema.string({ minLength: 1, maxLength: 256 })
})

export const frameBundleSettingsSchema = schema.object({
  frame_bundle_size: schema.optional(schema.integer({ minimum: 1, maximum: 15 })),
  frame_window_ms: schema.optional(schema.integer({ minimum: 1 })),
  frame_selection_strategy: schema.optional(
    schema.enum(['latest_n', 'evenly_spaced', 'change_peaks'])
  ),
  frame_max_dimension: schema.optional(
    schema.integer({ minimum: 64, maximum: 8_192 })
  ),
  frame_quality: schema.optional(schema.integer({ minimum: 1, maximum: 100 })),
  frame_similarity_threshold: schema.optional(unitIntervalSchema),
  frame_anchor_interval_ms: schema.optional(schema.integer({ minimum: 1 }))
})

export const runtimeSettingsSchema = schema.refine(
  schema.object({
    allow_viewer_silence: schema.optional(schema.boolean()),
    barrage_generation_mode: schema.optional(
      schema.enum(['per_viewer', 'window_batch'])
    ),
    frame_bundle: schema.optional(frameBundleSettingsSchema),
    viewer_visual_input_mode: schema.optional(
      schema.enum(['direct_frames', 'shared_summary', 'text_only'])
    ),
    max_in_flight_viewer_requests: schema.optional(
      schema.integer({ minimum: 1, maximum: 32 })
    ),
    viewer_request_start_interval_ms: schema.optional(
      schema.integer({ minimum: 0, maximum: 60_000 })
    ),
    viewer_request_ttl_ms: schema.optional(schema.integer({ minimum: 0 })),
    viewer_queue_capacity: schema.optional(
      schema.integer({ minimum: 1, maximum: 65_536 })
    ),
    observation_merge_window_ms: schema.optional(schema.integer({ minimum: 0 })),
    public_context_window_ms: schema.optional(schema.integer({ minimum: 1 })),
    public_context_max_events: schema.optional(
      schema.integer({ minimum: 1, maximum: 128 })
    ),
    replyable_event_window_ms: schema.optional(schema.integer({ minimum: 1 })),
    max_replyable_events: schema.optional(
      schema.integer({ minimum: 0, maximum: 32 })
    ),
    viewer_user_speaker_budget: schema.optional(
      schema.integer({ minimum: 0, maximum: 32 })
    ),
    viewer_screen_speaker_budget: schema.optional(
      schema.integer({ minimum: 0, maximum: 32 })
    ),
    viewer_ambient_speaker_budget: schema.optional(
      schema.integer({ minimum: 0, maximum: 32 })
    ),
    max_direct_frame_age_ms: schema.optional(schema.integer({ minimum: 1 })),
    screen_change_threshold: schema.optional(unitIntervalSchema),
    screen_change_cooldown_ms: schema.optional(schema.integer({ minimum: 0 })),
    ambient_tick_cooldown_ms: schema.optional(schema.integer({ minimum: 1 })),
    max_consecutive_ambient_waves: schema.optional(
      schema.integer({ minimum: 0, maximum: 32 })
    ),
    window_batch_interval_ms: schema.optional(schema.integer({ minimum: 1 })),
    window_batch_context_window_ms: schema.optional(schema.integer({ minimum: 1 })),
    window_batch_max_frames: schema.optional(
      schema.integer({ minimum: 1, maximum: 5 })
    )
  }),
  (value) =>
    value.barrage_generation_mode !== 'window_batch' ||
    ((value.window_batch_interval_ms ?? 5_000) === 5_000 &&
      (value.window_batch_context_window_ms ?? 30_000) === 30_000 &&
      [4, 5].includes(value.window_batch_max_frames ?? 5)),
  'window_batch requires 5000 ms interval, 30000 ms context, and 4 or 5 frames'
)

export const personaTemplateSchema = schema.object({
  persona_id: boundedIdentifierSchema,
  document_version: positiveRevisionSchema,
  revision: positiveRevisionSchema,
  content_hash: sha256Schema,
  display_name: schema.string({ minLength: 1, maxLength: 64 }),
  role: schema.string({ minLength: 1, maxLength: 256 }),
  traits: schema.optional(
    schema.array(schema.string({ maxLength: 256 }), { maxItems: 64 })
  ),
  speech_style: schema.optional(safeJsonObjectSchema),
  behavior: schema.optional(safeJsonObjectSchema),
  trigger_preferences: schema.optional(
    schema.array(schema.string({ maxLength: 256 }), { maxItems: 64 })
  ),
  avoid_patterns: schema.optional(
    schema.array(schema.string({ maxLength: 256 }), { maxItems: 64 })
  ),
  silence_bias: unitIntervalSchema,
  burst_bias: unitIntervalSchema,
  repetition_bias: unitIntervalSchema,
  cooldown_ms: schema.integer({ minimum: 0 }),
  content_flags: schema.optional(
    schema.array(schema.string({ maxLength: 128 }), { maxItems: 64 })
  ),
  enabled: schema.optional(schema.boolean())
})

export const personaOverrideSchema = schema.object({
  display_name: schema.optional(
    schema.nullable(schema.string({ minLength: 1, maxLength: 64 }))
  ),
  traits: schema.optional(
    schema.nullable(schema.array(schema.string({ maxLength: 256 }), { maxItems: 64 }))
  ),
  speech_style: schema.optional(schema.nullable(safeJsonObjectSchema)),
  behavior: schema.optional(schema.nullable(safeJsonObjectSchema)),
  trigger_preferences: schema.optional(
    schema.nullable(schema.array(schema.string({ maxLength: 256 }), { maxItems: 64 }))
  ),
  avoid_patterns: schema.optional(
    schema.nullable(schema.array(schema.string({ maxLength: 256 }), { maxItems: 64 }))
  ),
  silence_bias: schema.optional(schema.nullable(unitIntervalSchema)),
  burst_bias: schema.optional(schema.nullable(unitIntervalSchema)),
  repetition_bias: schema.optional(schema.nullable(unitIntervalSchema)),
  cooldown_ms: schema.optional(schema.nullable(schema.integer({ minimum: 0 }))),
  content_flags: schema.optional(
    schema.nullable(schema.array(schema.string({ maxLength: 128 }), { maxItems: 64 }))
  )
})

export const responseRangeSchema = schema.refine(
  schema.object({
    minimum: schema.integer({ minimum: 0, maximum: 32 }),
    maximum: schema.integer({ minimum: 0, maximum: 32 })
  }),
  (value) => value.minimum <= value.maximum,
  'response range minimum must not exceed maximum'
)

export const modeDefinitionSchema = schema.object({
  mode_id: boundedIdentifierSchema,
  namespace_id: boundedIdentifierSchema,
  revision: positiveRevisionSchema,
  persona_counts: schema.record(schema.integer({ minimum: 0, maximum: 32 }), {
    minProperties: 1,
    maxProperties: 32
  }),
  persona_overrides: schema.optional(
    schema.record(personaOverrideSchema, { maxProperties: 32 })
  ),
  normal_response_range: responseRangeSchema,
  highlight_response_range: responseRangeSchema,
  ambience: schema.optional(schema.enum(['natural', 'continuous']))
})

export const roomSchema = schema.refine(
  schema.object({
    room_id: roomIdSchema,
    display_name: schema.string({ minLength: 1, maxLength: 128 }),
    revision: schema.optional(positiveRevisionSchema),
    created_at_ms: timestampMsSchema,
    updated_at_ms: timestampMsSchema
  }),
  (value) => value.updated_at_ms >= value.created_at_ms,
  'updated_at_ms must not precede created_at_ms'
)

const canonicalRuntimeSpecBaseSchema = schema.object({
  protocol_version: httpProtocolVersionSchema,
  audience_contract_version: schema.enum([2, 3]),
  config_revision: positiveRevisionSchema,
  room: roomSchema,
  active_mode_id: boundedIdentifierSchema,
  personas: schema.array(personaTemplateSchema, { minItems: 1, maxItems: 32 }),
  modes: schema.array(modeDefinitionSchema, { minItems: 1, maxItems: 32 }),
  provider: providerRuntimeSpecSchema,
  settings: schema.optional(runtimeSettingsSchema)
})

export const canonicalRuntimeSpecSchema = schema.refine(
  canonicalRuntimeSpecBaseSchema,
  (value) => {
    const personaIds = value.personas.map((persona) => persona.persona_id)
    const modeIds = value.modes.map((mode) => mode.mode_id)
    if (new Set(personaIds).size !== personaIds.length) return false
    if (new Set(modeIds).size !== modeIds.length) return false
    if (!modeIds.includes(value.active_mode_id)) return false
    const personas = new Map(value.personas.map((persona) => [persona.persona_id, persona]))
    return value.modes.every((mode) =>
      Object.entries(mode.persona_counts).every(
        ([personaId, count]) =>
          personas.has(personaId) &&
          (count === 0 || personas.get(personaId)?.enabled !== false)
      )
    )
  },
  'runtime spec references, active mode, and persona IDs must be valid and unique'
)

export const viewerInstanceVariantSchema = schema.object({
  activity_baseline: schema.optional(unitIntervalSchema),
  attention_span: schema.optional(unitIntervalSchema),
  social_initiative: schema.optional(unitIntervalSchema),
  reply_affinity: schema.optional(unitIntervalSchema),
  expression_length: unitIntervalSchema,
  skepticism: unitIntervalSchema,
  encouragement: unitIntervalSchema,
  meme_affinity: unitIntervalSchema,
  focus: schema.string({ minLength: 1, maxLength: 128 }),
  silence_tendency: unitIntervalSchema,
  stay_duration_tendency: schema.optional(unitIntervalSchema),
  rejoin_tendency: schema.optional(unitIntervalSchema)
})

export const viewerPrivateStateSchema = schema.object({
  revision: schema.optional(positiveRevisionSchema),
  published_event_ids: schema.optional(
    schema.array(boundedIdentifierSchema, { maxItems: 64 })
  ),
  direct_interaction_event_ids: schema.optional(
    schema.array(boundedIdentifierSchema, { maxItems: 64 })
  ),
  attention: schema.optional(
    schema.array(schema.string({ maxLength: 256 }), { maxItems: 16 })
  ),
  mood: schema.optional(safeJsonObjectSchema),
  cooldown_until_ms: schema.optional(schema.nullable(timestampMsSchema)),
  attention_strength: schema.optional(unitIntervalSchema),
  arousal: schema.optional(unitIntervalSchema),
  fatigue: schema.optional(unitIntervalSchema),
  engagement: schema.optional(unitIntervalSchema),
  last_spoke_at_ms: schema.optional(nullableTimestampSchema),
  last_reacted_at_ms: schema.optional(nullableTimestampSchema),
  current_thread_id: schema.optional(schema.nullable(boundedIdentifierSchema)),
  current_target_viewer_id: schema.optional(schema.nullable(viewerIdSchema)),
  host_affinity: schema.optional(signedUnitIntervalSchema),
  peer_affinities: schema.optional(
    schema.record(signedUnitIntervalSchema, { maxProperties: 32 })
  ),
  silence_streak: schema.optional(schema.integer({ minimum: 0 })),
  speech_streak: schema.optional(schema.integer({ minimum: 0 }))
})

export const viewerInstanceSchema = schema.object({
  viewer_instance_id: viewerIdSchema,
  room_id: roomIdSchema,
  session_id: sessionIdSchema,
  audience_epoch: epochSchema,
  persona_id: boundedIdentifierSchema,
  persona_revision: positiveRevisionSchema,
  persona_content_hash: schema.optional(sha256Schema),
  ordinal: schema.integer({ minimum: 1, maximum: 128 }),
  username: schema.string({ minLength: 1, maxLength: 64 }),
  display_name: schema.string({ minLength: 1, maxLength: 64 }),
  avatar_seed: boundedIdentifierSchema,
  color_seed: boundedIdentifierSchema,
  locale: schema.optional(schema.string({ minLength: 2, maxLength: 32 })),
  variant: viewerInstanceVariantSchema,
  private_state: schema.optional(viewerPrivateStateSchema),
  viewer_sequence: schema.optional(schema.integer({ minimum: 0 })),
  lifecycle_state: schema.optional(viewerLifecycleStateSchema),
  presence_revision: schema.optional(positiveRevisionSchema),
  moderation_revision: schema.optional(positiveRevisionSchema),
  behavior_revision: schema.optional(positiveRevisionSchema),
  joined_at_ms: schema.optional(nullableTimestampSchema),
  last_left_at_ms: schema.optional(nullableTimestampSchema),
  join_count: schema.optional(schema.integer({ minimum: 0 })),
  muted_until_ms: schema.optional(nullableTimestampSchema),
  mute_reason: optionalReasonSchema,
  kicked_at_ms: schema.optional(nullableTimestampSchema),
  kick_reason: optionalReasonSchema,
  created_at_ms: timestampMsSchema,
  removed_at_ms: schema.optional(nullableTimestampSchema)
})

export const runtimeDiffSummarySchema = schema.object({
  changed_paths: schema.optional(
    schema.array(schema.string({ maxLength: 1_024 }), { maxItems: 1_024 })
  ),
  added_viewer_ids: schema.optional(schema.array(viewerIdSchema, { maxItems: 32 })),
  retained_viewer_ids: schema.optional(schema.array(viewerIdSchema, { maxItems: 32 })),
  reset_viewer_ids: schema.optional(schema.array(viewerIdSchema, { maxItems: 32 })),
  removed_viewer_ids: schema.optional(schema.array(viewerIdSchema, { maxItems: 32 }))
})

export const runtimeSessionStartRequestSchema = schema.refine(
  schema.object({
    client_request_id: boundedIdentifierSchema,
    canonical_runtime_spec: canonicalRuntimeSpecSchema,
    client_config_hash: sha256Schema
  }),
  (value) => value.client_config_hash === canonicalSha256(value.canonical_runtime_spec),
  'client_config_hash does not match canonical_runtime_spec'
)

export const runtimeSessionSnapshotSchema = schema.object({
  session_id: sessionIdSchema,
  room_id: roomIdSchema,
  audience_epoch: epochSchema,
  config_revision: positiveRevisionSchema,
  config_hash: sha256Schema,
  canonical_runtime_spec: canonicalRuntimeSpecSchema,
  viewers: schema.optional(schema.array(viewerInstanceSchema, { maxItems: 128 })),
  apply_id: schema.optional(schema.nullable(boundedIdentifierSchema)),
  diff: schema.optional(runtimeDiffSummarySchema),
  recovered: schema.optional(schema.boolean())
})

export const providerProfileReferenceSchema = schema.object({
  provider_profile_id: boundedIdentifierSchema
})

export const runtimeApplyRequestSchema = schema.refine(
  schema.object({
    apply_id: boundedIdentifierSchema,
    base_revision: revisionSchema,
    audience_contract_version: schema.literal(3),
    canonical_runtime_spec: canonicalRuntimeSpecSchema,
    client_config_hash: sha256Schema,
    provider_candidate: schema.optional(schema.nullable(providerProfileReferenceSchema))
  }),
  (value) =>
    value.canonical_runtime_spec.audience_contract_version === 3 &&
    value.client_config_hash === canonicalSha256(value.canonical_runtime_spec),
  'runtime apply requires the current audience contract and matching config hash'
)

export const runtimeApplyResponseSchema = schema.object({
  apply_id: boundedIdentifierSchema,
  room_id: roomIdSchema,
  session_id: sessionIdSchema,
  audience_epoch: epochSchema,
  config_revision: positiveRevisionSchema,
  config_hash: sha256Schema,
  applied_at_ms: timestampMsSchema,
  diff: runtimeDiffSummarySchema
})

export const runtimeRollbackRequestSchema = schema.refine(
  schema.object({
    apply_id: boundedIdentifierSchema,
    base_revision: positiveRevisionSchema,
    target_revision: positiveRevisionSchema,
    audience_contract_version: schema.literal(3),
    provider_candidate: schema.optional(schema.nullable(providerProfileReferenceSchema))
  }),
  (value) => value.target_revision < value.base_revision,
  'target_revision must precede base_revision'
)

export const viewerSnapshotSchema = schema.object({
  viewer_instance_id: viewerIdSchema,
  username: schema.string({ minLength: 1, maxLength: 64 }),
  display_name: schema.string({ minLength: 1, maxLength: 64 }),
  avatar_seed: boundedIdentifierSchema,
  color_seed: boundedIdentifierSchema,
  persona_id: boundedIdentifierSchema,
  persona_display_name: schema.string({ minLength: 1, maxLength: 64 }),
  presence_state: viewerLifecycleStateSchema,
  joined_at_ms: nullableTimestampSchema,
  last_left_at_ms: nullableTimestampSchema,
  join_count: schema.integer({ minimum: 0 }),
  muted_until_ms: nullableTimestampSchema,
  viewer_sequence: schema.integer({ minimum: 0 }),
  presence_revision: positiveRevisionSchema,
  moderation_revision: positiveRevisionSchema
})

export const sessionAudienceSnapshotSchema = schema.object({
  session_id: sessionIdSchema,
  room_id: roomIdSchema,
  audience_epoch: epochSchema,
  population_revision: positiveRevisionSchema,
  target_concurrent_viewers: schema.integer({ minimum: 1, maximum: 32 }),
  active_count: schema.integer({ minimum: 0 }),
  viewers: schema.optional(schema.array(viewerSnapshotSchema, { maxItems: 128 }))
})

export const muteViewerRequestSchema = schema.object({
  command_id: boundedIdentifierSchema,
  duration_ms: schema.integer({ minimum: 1_000, maximum: 3_600_000 }),
  reason: schema.optional(schema.nullable(schema.string({ maxLength: 256 })))
})

export const viewerCommandRequestSchema = schema.object({
  command_id: boundedIdentifierSchema,
  reason: schema.optional(schema.nullable(schema.string({ maxLength: 256 })))
})

export const legacySessionSnapshotSchema = schema.object({
  session_id: schema.nullable(sessionIdSchema),
  state: sessionStateSchema,
  started_at_ms: nullableTimestampSchema,
  updated_at_ms: timestampMsSchema,
  revision: revisionSchema
})

export type CanonicalRuntimeSpec = InferSchema<typeof canonicalRuntimeSpecSchema>
export type RuntimeSettings = InferSchema<typeof runtimeSettingsSchema>
export type PersonaTemplate = InferSchema<typeof personaTemplateSchema>
export type PersonaOverride = InferSchema<typeof personaOverrideSchema>
export type ModeDefinition = InferSchema<typeof modeDefinitionSchema>
export type RuntimeSessionSnapshot = InferSchema<typeof runtimeSessionSnapshotSchema>
export type RuntimeApplyRequest = InferSchema<typeof runtimeApplyRequestSchema>
export type RuntimeRollbackRequest = InferSchema<typeof runtimeRollbackRequestSchema>
export type SessionAudienceSnapshot = InferSchema<
  typeof sessionAudienceSnapshotSchema
>
export type SessionSnapshot = InferSchema<typeof legacySessionSnapshotSchema>
