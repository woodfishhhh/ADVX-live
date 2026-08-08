import { schema, type InferSchema, type Schema } from '../schema'
import { defineRealtimeEnvelopeSchema, type RealtimeDirection, type RealtimeScopeRules } from './envelope'
import {
  backendPongPayloadSchema,
  backendReadyPayloadSchema,
  barrageEventPayloadSchema,
  clientAudioCommitPayloadSchema,
  clientHelloPayloadSchema,
  clientPingPayloadSchema,
  clientTextSubmitPayloadSchema,
  clientVoiceActivityPayloadSchema,
  ingestAckPayloadSchema,
  ingestRejectedPayloadSchema,
  observationStatePayloadSchema,
  pairedAudioTurnPayloadSchema,
  protocolErrorPayloadSchema,
  queuePressurePayloadSchema,
  roomEventPayloadSchema,
  runtimeStatusPayloadSchema,
  sessionStatusPayloadSchema,
  shutdownPayloadSchema,
  transcriptPayloadSchema,
  viewerPresencePayloadSchema
} from './payloads'

const forbiddenScopes = { room_id: 'forbidden', session_id: 'forbidden', audience_epoch: 'forbidden' } as const
const sessionScope = { room_id: 'forbidden', session_id: 'required', audience_epoch: 'forbidden' } as const
const optionalSessionScope = { room_id: 'forbidden', session_id: 'optional', audience_epoch: 'forbidden' } as const
const roomSessionScope = { room_id: 'required', session_id: 'required', audience_epoch: 'optional' } as const
const audienceScope = { room_id: 'optional', session_id: 'required', audience_epoch: 'required' } as const
const fullScope = { room_id: 'required', session_id: 'required', audience_epoch: 'required' } as const

export type RealtimeMessageRegistration = {
  readonly messageType: string
  readonly direction: RealtimeDirection
  readonly scopes: RealtimeScopeRules
  readonly legacyWire: boolean
  readonly schema: Schema<unknown>
}

function register<TType extends string, TPayload>(
  messageType: TType,
  direction: RealtimeDirection,
  scopes: RealtimeScopeRules,
  payload: Schema<TPayload>,
  legacyWire: boolean
) {
  return {
    messageType,
    direction,
    scopes,
    legacyWire,
    schema: defineRealtimeEnvelopeSchema(messageType, payload, scopes)
  } as const
}

export const realtimeMessageRegistrations = [
  register('client.hello', 'client-to-backend', forbiddenScopes, clientHelloPayloadSchema, true),
  register('client.ping', 'client-to-backend', forbiddenScopes, clientPingPayloadSchema, true),
  register('client.text.submit', 'client-to-backend', sessionScope, clientTextSubmitPayloadSchema, true),
  register('client.audio.commit', 'client-to-backend', sessionScope, clientAudioCommitPayloadSchema, true),
  register('client.voice.activity', 'client-to-backend', sessionScope, clientVoiceActivityPayloadSchema, true),
  register('backend.ready', 'backend-to-client', optionalSessionScope, backendReadyPayloadSchema, true),
  register('backend.pong', 'backend-to-client', forbiddenScopes, backendPongPayloadSchema, true),
  register('session.status', 'backend-to-client', optionalSessionScope, sessionStatusPayloadSchema, true),
  register('barrage.event', 'backend-to-client', fullScope, barrageEventPayloadSchema, true),
  register('protocol.error', 'backend-to-client', optionalSessionScope, protocolErrorPayloadSchema, true),
  register('ingest.ack', 'backend-to-client', sessionScope, ingestAckPayloadSchema, true),
  register('ingest.rejected', 'backend-to-client', optionalSessionScope, ingestRejectedPayloadSchema, true),
  register('asr.transcript', 'backend-to-client', sessionScope, transcriptPayloadSchema, true),
  register('viewer.joined', 'backend-to-client', audienceScope, viewerPresencePayloadSchema, true),
  register('viewer.left', 'backend-to-client', audienceScope, viewerPresencePayloadSchema, true),
  register('viewer.rejoined', 'backend-to-client', audienceScope, viewerPresencePayloadSchema, true),
  register('viewer.muted', 'backend-to-client', audienceScope, viewerPresencePayloadSchema, true),
  register('viewer.unmuted', 'backend-to-client', audienceScope, viewerPresencePayloadSchema, true),
  register('viewer.kicked', 'backend-to-client', audienceScope, viewerPresencePayloadSchema, true),
  register('observation.state', 'internal-publication', fullScope, observationStatePayloadSchema, false),
  register('room.event', 'internal-publication', roomSessionScope, roomEventPayloadSchema, false),
  register('runtime.status', 'backend-to-client', fullScope, runtimeStatusPayloadSchema, false),
  register('queue.pressure', 'backend-to-client', fullScope, queuePressurePayloadSchema, false),
  register('backend.shutdown', 'backend-to-client', forbiddenScopes, shutdownPayloadSchema, false),
  register('audio.turn.state', 'internal-publication', roomSessionScope, pairedAudioTurnPayloadSchema, false)
] as const

export const LEGACY_WIRE_MESSAGE_COUNT = 19 as const
export const realtimeEnvelopeSchema = schema.union(
  realtimeMessageRegistrations.map((entry) => entry.schema) as unknown as readonly [
    (typeof realtimeMessageRegistrations)[number]['schema'],
    ...(typeof realtimeMessageRegistrations)[number]['schema'][]
  ]
)

export const realtimeMessageRegistry = Object.freeze(
  Object.fromEntries(realtimeMessageRegistrations.map((entry) => [entry.messageType, entry]))
) as Readonly<Record<(typeof realtimeMessageRegistrations)[number]['messageType'], (typeof realtimeMessageRegistrations)[number]>>

export type RealtimeEnvelope = InferSchema<typeof realtimeEnvelopeSchema>
export type RealtimeMessageType = (typeof realtimeMessageRegistrations)[number]['messageType']
export type LegacyWireMessageType = Extract<
  (typeof realtimeMessageRegistrations)[number],
  { readonly legacyWire: true }
>['messageType']
