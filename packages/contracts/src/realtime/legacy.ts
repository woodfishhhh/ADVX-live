import { epochSchema, sessionIdSchema, timestampMsSchema } from '../scalars'
import { schema, type InferSchema } from '../schema'
import { realtimeProtocolVersionSchema } from '../versions'
import { legacySessionSnapshotSchema, viewerSnapshotSchema } from '../http/runtime'
import { boundedIdentifierSchema, boundedTextSchema } from '../http/common'
import {
  audioSourceSchema,
  barrageSnapshotSchema,
  ingestAckStageSchema,
  ingestInputKindSchema,
  ingestRejectionCodeSchema
} from './payloads'
import { realtimeEnvelopeSchema, realtimeMessageRegistry, type RealtimeEnvelope } from './registry'

const legacyBase = { protocol_version: realtimeProtocolVersionSchema } as const
const viewerTypes = ['viewer.joined', 'viewer.left', 'viewer.rejoined', 'viewer.muted', 'viewer.unmuted', 'viewer.kicked'] as const

const clientHelloSchema = schema.refine(schema.object({
  ...legacyBase,
  type: schema.literal('client.hello'),
  token: schema.string({ minLength: 1, maxLength: 256 }),
  supported_protocol_versions: schema.optional(schema.nullable(schema.array(schema.integer({ minimum: 1 }), { minItems: 1, maxItems: 8 })))
}), (value) => value.supported_protocol_versions == null || (new Set(value.supported_protocol_versions).size === value.supported_protocol_versions.length && value.supported_protocol_versions.includes(value.protocol_version)), 'supported versions must be unique and include protocol_version')
const clientPingSchema = schema.object({ ...legacyBase, type: schema.literal('client.ping'), request_id: boundedIdentifierSchema })
const clientTextSchema = schema.refine(schema.object({
  ...legacyBase, type: schema.literal('client.text.submit'), session_id: sessionIdSchema, input_id: boundedIdentifierSchema,
  created_at_ms: timestampMsSchema, text: boundedTextSchema,
  target_viewer_id: schema.optional(schema.nullable(boundedIdentifierSchema)), target_persona_id: schema.optional(schema.nullable(boundedIdentifierSchema))
}), (value) => value.target_viewer_id == null || value.target_persona_id == null, 'text input can target either a Viewer or a Persona')
const clientAudioSchema = schema.refine(schema.object({
  ...legacyBase, type: schema.literal('client.audio.commit'), session_id: sessionIdSchema, input_id: boundedIdentifierSchema,
  committed_at_ms: timestampMsSchema, source: audioSourceSchema, turn_id: schema.optional(schema.nullable(boundedIdentifierSchema)), system_audio_required: schema.boolean()
}), (value) => !value.system_audio_required || (value.source === 'microphone' && value.turn_id != null), 'system audio requirements require microphone source and turn_id')
const clientVoiceSchema = schema.object({ ...legacyBase, type: schema.literal('client.voice.activity'), session_id: sessionIdSchema, occurred_at_ms: timestampMsSchema, source: audioSourceSchema })
const backendReadySchema = schema.object({ ...legacyBase, type: schema.literal('backend.ready'), session: legacySessionSnapshotSchema })
const backendPongSchema = schema.object({ ...legacyBase, type: schema.literal('backend.pong'), request_id: boundedIdentifierSchema })
const sessionStatusSchema = schema.object({ ...legacyBase, type: schema.literal('session.status'), session: legacySessionSnapshotSchema })
const barrageEventSchema = schema.object({ ...legacyBase, type: schema.literal('barrage.event'), barrage: barrageSnapshotSchema })
const protocolErrorSchema = schema.object({ ...legacyBase, type: schema.literal('protocol.error'), code: schema.enum(['invalid_message','authentication_failed','version_mismatch','handshake_timeout','message_too_large','unexpected_message']), message: schema.string({ minLength: 1, maxLength: 256 }), supported_version: schema.optional(schema.nullable(schema.integer({ minimum: 1 }))) })
const ingestAckSchema = schema.object({ ...legacyBase, type: schema.literal('ingest.ack'), session_id: sessionIdSchema, input_id: boundedIdentifierSchema, input_kind: ingestInputKindSchema, stage: ingestAckStageSchema, accepted_at_ms: timestampMsSchema })
const ingestRejectedSchema = schema.object({ ...legacyBase, type: schema.literal('ingest.rejected'), code: ingestRejectionCodeSchema, message: schema.string({ minLength: 1, maxLength: 256 }), session_id: schema.optional(schema.nullable(sessionIdSchema)), input_id: schema.optional(schema.nullable(boundedIdentifierSchema)), input_kind: schema.optional(schema.nullable(ingestInputKindSchema)) })
const transcriptSchema = schema.object({ ...legacyBase, type: schema.literal('asr.transcript'), source: audioSourceSchema, text: boundedTextSchema, final: schema.boolean(), started_at_ms: timestampMsSchema, ended_at_ms: timestampMsSchema, utterance_id: schema.optional(schema.nullable(boundedIdentifierSchema)), revision: schema.integer({ minimum: 1 }) })
const viewerPresenceSchema = schema.object({ ...legacyBase, type: schema.enum(viewerTypes), session_id: sessionIdSchema, audience_epoch: epochSchema, population_revision: schema.integer({ minimum: 1 }), occurred_at_ms: timestampMsSchema, viewer: viewerSnapshotSchema })

export const legacyRealtimeMessageSchema = schema.union([
  clientHelloSchema, clientPingSchema, clientTextSchema, clientAudioSchema, clientVoiceSchema,
  backendReadySchema, backendPongSchema, sessionStatusSchema, barrageEventSchema, protocolErrorSchema,
  ingestAckSchema, ingestRejectedSchema, transcriptSchema, viewerPresenceSchema
])
export type LegacyRealtimeMessage = InferSchema<typeof legacyRealtimeMessageSchema>

export type LegacyNormalizationContext = {
  readonly message_id: string
  readonly created_at_ms?: number
  readonly room_id?: string
  readonly session_id?: string
  readonly audience_epoch?: number
  readonly trace_id?: string
}

export function normalizeLegacyRealtimeMessage(value: unknown, context: LegacyNormalizationContext): RealtimeEnvelope {
  const message = legacyRealtimeMessageSchema.parse(value)
  const common = {
    protocol_version: message.protocol_version,
    message_type: message.type,
    message_id: context.message_id,
    created_at_ms: legacyCreatedAt(message, context),
    ...(context.trace_id === undefined ? {} : { trace_id: context.trace_id })
  }
  let candidate: Record<string, unknown>
  switch (message.type) {
    case 'client.hello': candidate = { ...common, payload: { ...(message.supported_protocol_versions == null ? {} : { supported_protocol_versions: message.supported_protocol_versions }) } }; break
    case 'client.ping': case 'backend.pong': candidate = { ...common, payload: { request_id: message.request_id } }; break
    case 'client.text.submit': candidate = { ...common, session_id: message.session_id, payload: { input_id: message.input_id, text: message.text, target_viewer_id: message.target_viewer_id, target_persona_id: message.target_persona_id } }; break
    case 'client.audio.commit': candidate = { ...common, session_id: message.session_id, payload: { input_id: message.input_id, committed_at_ms: message.committed_at_ms, source: message.source, turn_id: message.turn_id, system_audio_required: message.system_audio_required } }; break
    case 'client.voice.activity': candidate = { ...common, session_id: message.session_id, payload: { occurred_at_ms: message.occurred_at_ms, source: message.source } }; break
    case 'backend.ready': case 'session.status': candidate = { ...common, ...(message.session.session_id == null ? {} : { session_id: message.session.session_id }), payload: { session: message.session } }; break
    case 'barrage.event': candidate = { ...common, room_id: message.barrage.room_id, session_id: message.barrage.session_id, audience_epoch: message.barrage.audience_epoch, payload: { barrage: message.barrage } }; break
    case 'protocol.error': candidate = { ...common, ...(context.session_id === undefined ? {} : { session_id: context.session_id }), payload: { code: message.code, message: message.message, supported_version: message.supported_version } }; break
    case 'ingest.ack': candidate = { ...common, session_id: message.session_id, payload: { input_id: message.input_id, input_kind: message.input_kind, stage: message.stage, accepted_at_ms: message.accepted_at_ms } }; break
    case 'ingest.rejected': candidate = { ...common, ...((message.session_id ?? context.session_id) == null ? {} : { session_id: message.session_id ?? context.session_id }), payload: { code: message.code, message: message.message, input_id: message.input_id, input_kind: message.input_kind } }; break
    case 'asr.transcript': candidate = { ...common, session_id: requireScope(context.session_id, 'session_id'), payload: { source: message.source, text: message.text, final: message.final, started_at_ms: message.started_at_ms, ended_at_ms: message.ended_at_ms, utterance_id: message.utterance_id, revision: message.revision } }; break
    default: candidate = { ...common, ...(context.room_id === undefined ? {} : { room_id: context.room_id }), session_id: message.session_id, audience_epoch: message.audience_epoch, payload: { population_revision: message.population_revision, occurred_at_ms: message.occurred_at_ms, viewer: message.viewer } }
  }
  return realtimeMessageRegistry[message.type].schema.parse(candidate) as RealtimeEnvelope
}

export function parseCanonicalRealtimeEnvelope(value: unknown): RealtimeEnvelope {
  return realtimeEnvelopeSchema.parse(value)
}

function legacyCreatedAt(message: LegacyRealtimeMessage, context: LegacyNormalizationContext): number {
  if (context.created_at_ms !== undefined) return context.created_at_ms
  if ('created_at_ms' in message) return message.created_at_ms
  if ('occurred_at_ms' in message) return message.occurred_at_ms
  if ('accepted_at_ms' in message) return message.accepted_at_ms
  if ('committed_at_ms' in message) return message.committed_at_ms
  if ('started_at_ms' in message) return message.started_at_ms
  if (message.type === 'barrage.event') return message.barrage.created_at_ms
  return 0
}

function requireScope(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`Legacy normalization requires ${name}`)
  return value
}
