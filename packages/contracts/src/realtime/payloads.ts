import {
  barrageEvidenceSourceSchema,
  observationTriggerSchema,
  observationWaveStatusSchema,
  realtimeProtocolErrorCodeSchema,
  roomEventSourceSchema,
  sessionStateSchema
} from '../enums'
import {
  barrageIdSchema,
  epochSchema,
  generationIdSchema,
  observationIdSchema,
  positiveRevisionSchema,
  roomIdSchema,
  sessionIdSchema,
  timestampMsSchema,
  viewerIdSchema
} from '../scalars'
import { schema, type InferSchema } from '../schema'
import { legacySessionSnapshotSchema, viewerSnapshotSchema } from '../http/runtime'
import { boundedIdentifierSchema, boundedTextSchema } from '../http/common'

export const audioSourceSchema = schema.enum(['microphone', 'system_audio'])
export const ingestInputKindSchema = schema.enum(['text', 'audio', 'frame'])
export const ingestAckStageSchema = schema.enum(['received', 'committed'])
export const ingestRejectionCodeSchema = schema.enum([
  'invalid_input',
  'session_not_active',
  'duplicate_input',
  'unknown_input',
  'out_of_order',
  'payload_too_large',
  'unsupported_format',
  'unsupported_binary_version',
  'unsupported_media_type',
  'malformed_binary_envelope',
  'pipeline_unavailable'
])

export const clientHelloPayloadSchema = schema.object({
  supported_protocol_versions: schema.optional(
    schema.array(schema.integer({ minimum: 1 }), { minItems: 1, maxItems: 8 })
  )
})

export const clientPingPayloadSchema = schema.object({ request_id: boundedIdentifierSchema })

export const clientTextSubmitPayloadSchema = schema.refine(
  schema.object({
    input_id: boundedIdentifierSchema,
    text: boundedTextSchema,
    target_viewer_id: schema.optional(schema.nullable(viewerIdSchema)),
    target_persona_id: schema.optional(schema.nullable(boundedIdentifierSchema))
  }),
  (value) => value.target_viewer_id == null || value.target_persona_id == null,
  'text input can target either a Viewer or a Persona'
)

export const clientAudioCommitPayloadSchema = schema.refine(
  schema.object({
    input_id: boundedIdentifierSchema,
    committed_at_ms: timestampMsSchema,
    source: audioSourceSchema,
    turn_id: schema.optional(schema.nullable(boundedIdentifierSchema)),
    system_audio_required: schema.boolean()
  }),
  (value) =>
    (!value.system_audio_required ||
      (value.source === 'microphone' && value.turn_id != null)),
  'system audio requirements require microphone source and turn_id'
)

export const clientVoiceActivityPayloadSchema = schema.object({
  occurred_at_ms: timestampMsSchema,
  source: audioSourceSchema
})

export const backendReadyPayloadSchema = schema.object({
  session: legacySessionSnapshotSchema
})
export const backendPongPayloadSchema = schema.object({ request_id: boundedIdentifierSchema })
export const sessionStatusPayloadSchema = backendReadyPayloadSchema

export const evidenceRefSchema = schema.refine(
  schema.object({
    source: barrageEvidenceSourceSchema,
    event_id: schema.optional(schema.nullable(boundedIdentifierSchema)),
    frame_index: schema.optional(schema.nullable(schema.integer({ minimum: 0 })))
  }),
  (value) =>
    value.source === 'event'
      ? value.event_id != null && value.frame_index == null
      : value.frame_index != null && value.event_id == null,
  'evidence requires exactly the identifier for its source'
)

export const viewerReactionTargetSchema = schema.refine(
  schema.object({
    kind: schema.enum(['host', 'scene', 'room', 'viewer', 'event']),
    viewer_instance_id: schema.optional(schema.nullable(viewerIdSchema)),
    event_id: schema.optional(schema.nullable(boundedIdentifierSchema))
  }),
  (value) =>
    (value.kind === 'viewer') === (value.viewer_instance_id != null) &&
    (value.kind === 'event') === (value.event_id != null),
  'reaction target identifiers must match target kind'
)

export const viewerReactionIntentSchema = schema.enum([
  'react_to_host',
  'react_to_scene',
  'reply_to_viewer',
  'ask_question',
  'agree',
  'disagree',
  'encourage',
  'joke',
  'continue_thread',
  'room_meta',
  'silence'
])

export const barrageSnapshotSchema = schema.refine(
  schema.object({
    barrage_id: barrageIdSchema,
    room_id: roomIdSchema,
    session_id: sessionIdSchema,
    audience_epoch: epochSchema,
    observation_id: observationIdSchema,
    generation_request_id: generationIdSchema,
    viewer_instance_id: viewerIdSchema,
    persona_id: boundedIdentifierSchema,
    display_name: schema.string({ minLength: 1, maxLength: 64 }),
    viewer_sequence: positiveRevisionSchema,
    reaction_type: schema.string({ minLength: 1, maxLength: 64 }),
    intent: viewerReactionIntentSchema,
    target: schema.optional(schema.nullable(viewerReactionTargetSchema)),
    evidence_refs: schema.array(evidenceRefSchema, { maxItems: 128 }),
    text: schema.string({ minLength: 1, maxLength: 160 }),
    created_at_ms: timestampMsSchema,
    expires_at_ms: schema.integer({ minimum: 1 })
  }),
  (value) => value.expires_at_ms > value.created_at_ms,
  'barrage expiry must follow creation'
)

export const barrageEventPayloadSchema = schema.object({ barrage: barrageSnapshotSchema })
export const protocolErrorPayloadSchema = schema.object({
  code: realtimeProtocolErrorCodeSchema,
  message: schema.string({ minLength: 1, maxLength: 256 }),
  supported_version: schema.optional(schema.nullable(schema.integer({ minimum: 1 })))
})
export const ingestAckPayloadSchema = schema.object({
  input_id: boundedIdentifierSchema,
  input_kind: ingestInputKindSchema,
  stage: ingestAckStageSchema,
  accepted_at_ms: timestampMsSchema
})
export const ingestRejectedPayloadSchema = schema.object({
  code: ingestRejectionCodeSchema,
  message: schema.string({ minLength: 1, maxLength: 256 }),
  input_id: schema.optional(schema.nullable(boundedIdentifierSchema)),
  input_kind: schema.optional(schema.nullable(ingestInputKindSchema))
})
export const transcriptPayloadSchema = schema.refine(
  schema.object({
    source: audioSourceSchema,
    text: boundedTextSchema,
    final: schema.boolean(),
    started_at_ms: timestampMsSchema,
    ended_at_ms: timestampMsSchema,
    utterance_id: schema.optional(schema.nullable(boundedIdentifierSchema)),
    revision: positiveRevisionSchema,
    turn_id: schema.optional(schema.nullable(boundedIdentifierSchema)),
    system_audio_required: schema.optional(schema.boolean()),
    system_audio_degraded: schema.optional(schema.boolean())
  }),
  (value) =>
    value.ended_at_ms >= value.started_at_ms &&
    (value.system_audio_required !== true || value.turn_id != null) &&
    (value.system_audio_degraded !== true || value.system_audio_required === true),
  'transcript timing and paired-audio fields must be coherent'
)

export const viewerPresencePayloadSchema = schema.object({
  population_revision: positiveRevisionSchema,
  occurred_at_ms: timestampMsSchema,
  viewer: viewerSnapshotSchema
})

export const observationStatePayloadSchema = schema.object({
  observation_id: observationIdSchema,
  status: observationWaveStatusSchema,
  triggers: schema.array(observationTriggerSchema, { minItems: 1, maxItems: 5 }),
  input_event_ids: schema.array(boundedIdentifierSchema, { maxItems: 128 })
})

export const roomEventPayloadSchema = schema.object({
  event_id: boundedIdentifierSchema,
  source_type: roomEventSourceSchema,
  source_id: schema.optional(schema.nullable(boundedIdentifierSchema)),
  text: schema.optional(schema.nullable(boundedTextSchema))
})

export const runtimeStatusPayloadSchema = schema.object({
  state: sessionStateSchema,
  revision: positiveRevisionSchema,
  detail: schema.optional(schema.nullable(schema.string({ maxLength: 256 })))
})

export const queuePressurePayloadSchema = schema.refine(
  schema.object({
    queue_name: schema.string({ minLength: 1, maxLength: 64 }),
    queued: schema.integer({ minimum: 0, maximum: 65_536 }),
    capacity: schema.integer({ minimum: 1, maximum: 65_536 }),
    dropped: schema.integer({ minimum: 0 }),
    policy: schema.enum(['accepting', 'drop_oldest', 'reject_new', 'draining'])
  }),
  (value) => value.queued <= value.capacity,
  'queued work cannot exceed declared capacity'
)

export const shutdownPayloadSchema = schema.object({
  reason: schema.enum(['requested', 'restart', 'fatal_error']),
  deadline_at_ms: schema.optional(timestampMsSchema)
})

const observationTriggerIdentitySchema = schema.refine(
  schema.object({
    trigger_id: boundedIdentifierSchema,
    idempotency_key: boundedIdentifierSchema,
    observation_id: observationIdSchema,
    authorized_by: schema.enum(['microphone_final', 'paired_audio'])
  }),
  (value) => value.trigger_id === value.idempotency_key,
  'one ObservationWave trigger must use one stable identity/idempotency key'
)

const lateSystemAudioFinalSchema = schema.object({
  input_id: boundedIdentifierSchema,
  persisted_at_ms: timestampMsSchema,
  authorizes_observation_wave: schema.literal(false)
})

export const pairedAudioTurnPayloadSchema = schema.refine(
  schema.object({
    turn_id: boundedIdentifierSchema,
    microphone_final_id: boundedIdentifierSchema,
    system_audio_final_id: schema.optional(schema.nullable(boundedIdentifierSchema)),
    system_audio_required: schema.boolean(),
    system_audio_degraded: schema.boolean(),
    observation_trigger: schema.optional(schema.nullable(observationTriggerIdentitySchema)),
    late_system_audio_final: schema.optional(schema.nullable(lateSystemAudioFinalSchema))
  }),
  (value) => {
    if (
      value.observation_trigger != null &&
      (value.observation_trigger.trigger_id !== value.turn_id ||
        value.observation_trigger.idempotency_key !== value.turn_id)
    ) {
      return false
    }
    if (!value.system_audio_required) {
      return !value.system_audio_degraded && value.late_system_audio_final == null
    }
    if (value.system_audio_degraded) {
      if (value.observation_trigger?.authorized_by !== 'microphone_final') return false
      if (value.late_system_audio_final != null) {
        return value.system_audio_final_id === value.late_system_audio_final.input_id
      }
    }
    return true
  },
  'paired audio must share turn identity and late degraded finals cannot authorize another wave'
)

export type BarrageSnapshot = InferSchema<typeof barrageSnapshotSchema>
export type AudioSource = InferSchema<typeof audioSourceSchema>
export type PairedAudioTurnPayload = InferSchema<typeof pairedAudioTurnPayloadSchema>
