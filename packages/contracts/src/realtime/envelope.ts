import { epochSchema, roomIdSchema, sessionIdSchema, timestampMsSchema } from '../scalars'
import { schema, type InferSchema, type Schema } from '../schema'
import { realtimeProtocolVersionSchema } from '../versions'
import { boundedIdentifierSchema } from '../http/common'

export type RealtimeDirection = 'client-to-backend' | 'backend-to-client' | 'internal-publication'
export type ScopeRule = 'required' | 'optional' | 'forbidden'
export type RealtimeScopeRules = {
  readonly room_id: ScopeRule
  readonly session_id: ScopeRule
  readonly audience_epoch: ScopeRule
}

export type CanonicalRealtimeEnvelope<TType extends string, TPayload> = {
  readonly protocol_version: 3 | 4
  readonly message_type: TType
  readonly message_id: string
  readonly room_id?: string
  readonly session_id?: string
  readonly audience_epoch?: number
  readonly created_at_ms: number
  readonly trace_id?: string
  readonly payload: TPayload
}

export function defineRealtimeEnvelopeSchema<TType extends string, TPayload>(
  messageType: TType,
  payload: Schema<TPayload>,
  scopes: RealtimeScopeRules
): Schema<CanonicalRealtimeEnvelope<TType, TPayload>> {
  const base = schema.object({
    protocol_version: realtimeProtocolVersionSchema,
    message_type: schema.literal(messageType),
    message_id: boundedIdentifierSchema,
    room_id: schema.optional(roomIdSchema),
    session_id: schema.optional(sessionIdSchema),
    audience_epoch: schema.optional(epochSchema),
    created_at_ms: timestampMsSchema,
    trace_id: schema.optional(boundedIdentifierSchema),
    payload
  })
  return schema.refine(
    base,
    (value) =>
      scopeMatches(value.room_id, scopes.room_id) &&
      scopeMatches(value.session_id, scopes.session_id) &&
      scopeMatches(value.audience_epoch, scopes.audience_epoch),
    `scope IDs must follow ${JSON.stringify(scopes)}`,
    `Canonical ${messageType} realtime envelope`
  ) as Schema<CanonicalRealtimeEnvelope<TType, TPayload>>
}

function scopeMatches(value: unknown, rule: ScopeRule): boolean {
  if (rule === 'required') return value !== undefined
  if (rule === 'forbidden') return value === undefined
  return true
}

export type AnyCanonicalRealtimeEnvelope = InferSchema<Schema<CanonicalRealtimeEnvelope<string, unknown>>>
