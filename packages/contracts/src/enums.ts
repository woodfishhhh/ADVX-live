import { schema, type InferSchema } from './schema'

export const roomEventSourceSchema = schema.enum([
  'user_text',
  'user_voice',
  'audience_barrage',
  'screen_observation',
  'system_event'
])

export const barrageEvidenceSourceSchema = schema.enum(['event', 'frame'])

export const observationTriggerSchema = schema.enum([
  'user_text',
  'final_voice',
  'system_audio',
  'screen_change',
  'ambient_tick'
])
export const observationSourceSchema = observationTriggerSchema

export const sessionStateSchema = schema.enum([
  'idle',
  'starting',
  'running',
  'paused',
  'stopping',
  'error'
])

export const sessionOutcomeSchema = schema.enum([
  'completed',
  'error',
  'interrupted'
])

export const viewerLifecycleStateSchema = schema.enum([
  'not_joined',
  'active',
  'left',
  'kicked',
  'ended',
  'removed'
])

export const traceResponseStatusSchema = schema.enum([
  'queued',
  'dispatched',
  'completed',
  'silence',
  'published',
  'rejected',
  'expired',
  'cancelled',
  'stale',
  'failed'
])

export const observationWaveStatusSchema = schema.enum([
  'completed',
  'empty',
  'failed',
  'skipped'
])

export const realtimeProtocolErrorCodeSchema = schema.enum([
  'invalid_message',
  'authentication_failed',
  'version_mismatch',
  'handshake_timeout',
  'message_too_large',
  'unexpected_message'
])

export type RoomEventSource = InferSchema<typeof roomEventSourceSchema>
export type BarrageEvidenceSource = InferSchema<typeof barrageEvidenceSourceSchema>
export type ObservationTrigger = InferSchema<typeof observationTriggerSchema>
export type ObservationSource = InferSchema<typeof observationSourceSchema>
export type SessionState = InferSchema<typeof sessionStateSchema>
export type SessionOutcome = InferSchema<typeof sessionOutcomeSchema>
export type ViewerLifecycleState = InferSchema<typeof viewerLifecycleStateSchema>
export type TraceResponseStatus = InferSchema<typeof traceResponseStatusSchema>
export type ObservationWaveStatus = InferSchema<typeof observationWaveStatusSchema>
export type RealtimeProtocolErrorCode = InferSchema<
  typeof realtimeProtocolErrorCodeSchema
>
