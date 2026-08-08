import {
  normalizedErrorSchema,
  paginationMetadataSchema,
  roomIdSchema,
  schema,
  providerConfigurationStatusSchema,
  runtimeRollbackRequestSchema,
  traceCorrelationMetadataSchema,
  type InferSchema,
  type NormalizedError,
  type PaginationMetadata,
  type ProviderConfigurationStatus,
  type RoomId,
  type RuntimeRollbackRequest,
  type TraceCorrelationMetadata
} from './index'

const declaration = schema.object({
  id: schema.string({ minLength: 1 }),
  revision: schema.integer({ minimum: 1 }),
  label: schema.optional(schema.string()),
  values: schema.array(schema.union([schema.string(), schema.number()]))
})

type Declaration = InferSchema<typeof declaration>

const valid: Declaration = {
  id: 'contract',
  revision: 1,
  values: ['one', 2]
}

declaration.check(valid)

// @ts-expect-error revision is inferred as a number from the runtime schema
const invalidRevision: Declaration = { id: 'contract', revision: '1', values: [] }

// @ts-expect-error id remains required while label is optional
const missingId: Declaration = { revision: 1, values: [] }

void invalidRevision
void missingId

const roomId: RoomId = roomIdSchema.parse('room-1')
const normalizedError: NormalizedError = normalizedErrorSchema.parse({
  code: 'timeout',
  retryable: true
})
const pagination: PaginationMetadata = paginationMetadataSchema.parse({ limit: 100 })
const trace: TraceCorrelationMetadata = traceCorrelationMetadataSchema.parse({
  trace_id: 'trace-1',
  correlation_id: 'correlation-1',
  started_at_ms: 0
})

// @ts-expect-error public RoomId is derived as a string from roomIdSchema
const invalidRoomId: RoomId = 1

const invalidError: NormalizedError = {
  code: 'unsafe',
  retryable: false,
  // @ts-expect-error normalized errors cannot expose arbitrary raw payloads
  raw_payload: 'secret'
}

void roomId
void normalizedError
void pagination
void trace
void invalidRoomId
void invalidError

const rollback: RuntimeRollbackRequest = runtimeRollbackRequestSchema.parse({
  apply_id: 'apply-1',
  base_revision: 2,
  target_revision: 1,
  audience_contract_version: 3
})
const providerStatus: ProviderConfigurationStatus =
  providerConfigurationStatusSchema.parse({
    configured: false,
    provider_profile_id: null,
    model_base_url: null,
    model_name: null,
    viewer_model: null,
    memory_model: null,
    visual_summary_model: null,
    asr_base_url: null,
    asr_model: null
  })

// @ts-expect-error canonical public Provider status cannot expose credentials
providerStatus.model_api_key = 'secret'

void rollback
void providerStatus

import type { RealtimeEnvelope } from './realtime/index'

type ClientHelloEnvelope = Extract<RealtimeEnvelope, { message_type: 'client.hello' }>
const clientHelloEnvelope: ClientHelloEnvelope = {
  protocol_version: 4,
  message_type: 'client.hello',
  message_id: 'message-1',
  created_at_ms: 1,
  payload: { supported_protocol_versions: [4, 3] }
}

const invalidClientHelloEnvelope: ClientHelloEnvelope = {
  ...clientHelloEnvelope,
  // @ts-expect-error canonical client hello payload never exposes the startup token
  payload: { token: 'secret' }
}

void clientHelloEnvelope
void invalidClientHelloEnvelope
