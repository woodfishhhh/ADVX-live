import {
  observationIdSchema,
  roomIdSchema,
  sessionIdSchema,
  timestampMsSchema,
  viewerIdSchema
} from '../scalars'
import {
  observationTriggerSchema,
  observationWaveStatusSchema,
  traceResponseStatusSchema
} from '../enums'
import { schema, type InferSchema } from '../schema'
import { httpProtocolVersionSchema, traceSchemaVersionSchema } from '../versions'
import {
  boundedIdentifierSchema,
  httpStatusSchema,
  safeJsonObjectSchema,
  safeJsonValueSchema,
  sha256Schema
} from './common'
import {
  canonicalRuntimeSpecSchema,
  runtimeSettingsSchema,
  viewerInstanceSchema,
  viewerInstanceVariantSchema
} from './runtime'
import { canonicalSha256 } from './canonical'

const nullableIdentifierSchema = schema.nullable(boundedIdentifierSchema)

export const traceQuerySchema = schema.object({
  room_id: schema.optional(schema.nullable(roomIdSchema)),
  session_id: schema.optional(schema.nullable(sessionIdSchema)),
  observation_id: schema.optional(schema.nullable(observationIdSchema)),
  viewer_instance_id: schema.optional(schema.nullable(viewerIdSchema)),
  response_status: schema.optional(schema.nullable(traceResponseStatusSchema)),
  cursor: schema.optional(
    schema.nullable(schema.string({ minLength: 1, maxLength: 512 }))
  ),
  limit: schema.optional(schema.integer({ minimum: 1, maximum: 1_000 }))
})

export const memoryReferenceTraceSchema = schema.object({
  room_id: roomIdSchema,
  memory_revision: schema.integer({ minimum: 0 }),
  memory_ids: schema.optional(schema.array(boundedIdentifierSchema, { maxItems: 128 }))
})

export const promptManifestSchema = schema.object({
  template_id: boundedIdentifierSchema,
  template_revision: schema.integer({ minimum: 1 }),
  input_hash: sha256Schema,
  sections: schema.optional(
    schema.array(schema.string({ maxLength: 128 }), { maxItems: 64 })
  )
})

export const providerTraceSchema = schema.object({
  provider_role: schema.string({ minLength: 1, maxLength: 64 }),
  model_id: schema.string({ minLength: 1, maxLength: 256 }),
  queued_at_ms: timestampMsSchema,
  dispatched_at_ms: schema.nullable(timestampMsSchema),
  completed_at_ms: schema.nullable(timestampMsSchema)
})

export const validationTraceSchema = schema.object({
  accepted: schema.boolean(),
  codes: schema.optional(
    schema.array(schema.string({ minLength: 1, maxLength: 128 }), { maxItems: 64 })
  )
})

export const viewerOutputDeliverySchema = schema.object({
  ready_at_ms: timestampMsSchema,
  scheduled_at_ms: timestampMsSchema,
  published_at_ms: schema.optional(schema.nullable(timestampMsSchema)),
  queue_delay_ms: schema.optional(schema.nullable(schema.integer({ minimum: 0 }))),
  event_count: schema.integer({ minimum: 1, maximum: 32 }),
  published_event_count: schema.optional(
    schema.integer({ minimum: 0, maximum: 32 })
  ),
  interruption_reason: schema.optional(
    schema.nullable(schema.string({ maxLength: 256 }))
  )
})

export const sideEffectTraceSchema = schema.object({
  published_barrage_id: schema.optional(nullableIdentifierSchema),
  published_barrage_ids: schema.optional(
    schema.array(boundedIdentifierSchema, { maxItems: 3 })
  ),
  memory_candidate_ids: schema.optional(
    schema.array(boundedIdentifierSchema, { maxItems: 128 })
  ),
  meme_candidate: schema.optional(schema.nullable(safeJsonObjectSchema))
})

export const crowdDecisionSchema = schema.object({
  decision_id: boundedIdentifierSchema,
  room_id: roomIdSchema,
  session_id: sessionIdSchema,
  audience_epoch: schema.integer({ minimum: 1 }),
  observation_id: observationIdSchema,
  selected_viewer_ids: schema.optional(schema.array(viewerIdSchema, { maxItems: 32 })),
  reason_codes: schema.optional(
    schema.array(schema.string({ maxLength: 128 }), { maxItems: 32 })
  ),
  evidence_event_ids: schema.optional(
    schema.array(boundedIdentifierSchema, { maxItems: 128 })
  ),
  evidence_frame_indexes: schema.optional(
    schema.array(schema.integer({ minimum: 0 }), { maxItems: 60 })
  ),
  decision_source: schema.enum(['legacy_director', 'fallback', 'autonomous']),
  created_at_ms: timestampMsSchema,
  expires_at_ms: schema.integer({ minimum: 1 })
})

export const viewerRequestTraceSchema = schema.object({
  trace_kind: schema.literal('viewer_request'),
  trace_schema_version: traceSchemaVersionSchema,
  trace_id: boundedIdentifierSchema,
  room_id: roomIdSchema,
  session_id: sessionIdSchema,
  audience_epoch: schema.integer({ minimum: 1 }),
  config_hash: sha256Schema,
  observation_id: observationIdSchema,
  decision: crowdDecisionSchema,
  viewer_instance_id: viewerIdSchema,
  viewer_sequence: schema.integer({ minimum: 1 }),
  persona_revision: schema.integer({ minimum: 1 }),
  instance_variant: viewerInstanceVariantSchema,
  public_context_event_ids: schema.optional(
    schema.array(boundedIdentifierSchema, { maxItems: 512 })
  ),
  private_state_event_ids: schema.optional(
    schema.array(boundedIdentifierSchema, { maxItems: 128 })
  ),
  memory: memoryReferenceTraceSchema,
  frame_hashes: schema.optional(schema.array(sha256Schema, { maxItems: 60 })),
  prompt_manifest: promptManifestSchema,
  provider: providerTraceSchema,
  response_status: traceResponseStatusSchema,
  validation: validationTraceSchema,
  retry_count: schema.optional(schema.integer({ minimum: 0, maximum: 1 })),
  stale_or_cancel_reason: schema.optional(
    schema.nullable(schema.string({ maxLength: 256 }))
  ),
  side_effects: schema.optional(sideEffectTraceSchema),
  output_delivery: schema.optional(schema.nullable(viewerOutputDeliverySchema))
})

export const observationWaveTraceSchema = schema.object({
  trace_kind: schema.literal('observation_wave'),
  trace_schema_version: traceSchemaVersionSchema,
  trace_id: boundedIdentifierSchema,
  room_id: roomIdSchema,
  session_id: sessionIdSchema,
  audience_epoch: schema.integer({ minimum: 1 }),
  config_hash: sha256Schema,
  observation_id: observationIdSchema,
  created_at_ms: timestampMsSchema,
  deadline_at_ms: schema.integer({ minimum: 1 }),
  triggers: schema.array(observationTriggerSchema, { minItems: 1, maxItems: 5 }),
  event_ids: schema.optional(
    schema.array(boundedIdentifierSchema, { maxItems: 128 })
  ),
  trigger_event_ids: schema.optional(
    schema.array(boundedIdentifierSchema, { maxItems: 128 })
  ),
  frame_hashes: schema.optional(schema.array(sha256Schema, { maxItems: 60 })),
  memory: memoryReferenceTraceSchema,
  status: observationWaveStatusSchema,
  selected_viewer_ids: schema.optional(schema.array(viewerIdSchema, { maxItems: 32 })),
  decision_id: schema.optional(nullableIdentifierSchema),
  decision_source: schema.optional(
    schema.nullable(schema.enum(['legacy_director', 'fallback', 'autonomous']))
  ),
  reason_codes: schema.optional(
    schema.array(schema.string({ maxLength: 128 }), { maxItems: 32 })
  ),
  failure_reason: schema.optional(schema.nullable(schema.string({ maxLength: 256 })))
})

export const traceQueryResponseSchema = schema.object({
  items: schema.array(viewerRequestTraceSchema, { maxItems: 1_000 }),
  waves: schema.optional(schema.array(observationWaveTraceSchema, { maxItems: 1_000 })),
  next_cursor: schema.nullable(schema.string({ minLength: 1, maxLength: 512 })),
  metadata: schema.optional(safeJsonObjectSchema)
})

export const traceExportArtifactSchema = schema.object({
  trace_schema_version: traceSchemaVersionSchema,
  protocol_version: httpProtocolVersionSchema,
  redacted: schema.literal(true),
  query: traceQuerySchema,
  items: schema.array(viewerRequestTraceSchema, { maxItems: 10_000 }),
  waves: schema.array(observationWaveTraceSchema, { maxItems: 10_000 }),
  exported_at_ms: timestampMsSchema,
  digest: sha256Schema
})

export const aiCallRoleSchema = schema.enum([
  'viewer',
  'memory',
  'visual_summary',
  'history_summary',
  'asr'
])
export const aiCallStatusSchema = schema.enum([
  'preparing',
  'sent',
  'streaming',
  'received',
  'succeeded',
  'failed',
  'blocked',
  'cancelled',
  'interrupted'
])

export const aiCallQuerySchema = schema.object({
  session_id: schema.optional(schema.nullable(sessionIdSchema)),
  role: schema.optional(schema.nullable(aiCallRoleSchema)),
  status: schema.optional(schema.nullable(aiCallStatusSchema)),
  correlation_id: schema.optional(schema.nullable(boundedIdentifierSchema)),
  cursor: schema.optional(
    schema.nullable(schema.string({ minLength: 1, maxLength: 512 }))
  ),
  limit: schema.optional(schema.integer({ minimum: 1, maximum: 1_000 }))
})

export const aiCallTimelineEventSchema = schema.object({
  stage: schema.string({ minLength: 1, maxLength: 64 }),
  at_ms: timestampMsSchema,
  detail: safeJsonValueSchema
})
export const aiCallRequestSummarySchema = schema.object({
  wire_sha256: schema.optional(schema.nullable(sha256Schema)),
  wire_bytes: schema.optional(schema.nullable(schema.integer({ minimum: 0 }))),
  schema_name: schema.optional(schema.nullable(boundedIdentifierSchema)),
  max_output_tokens: schema.optional(schema.nullable(schema.integer({ minimum: 1 }))),
  input_preview: safeJsonValueSchema,
  redacted_fields: schema.optional(
    schema.array(schema.string({ maxLength: 128 }), { maxItems: 128 })
  )
})
export const aiCallResponseSummarySchema = schema.object({
  http_status: schema.optional(schema.nullable(httpStatusSchema)),
  provider_request_id: schema.optional(
    schema.nullable(schema.string({ minLength: 1, maxLength: 256 }))
  ),
  body_sha256: schema.optional(schema.nullable(sha256Schema)),
  body_bytes: schema.optional(schema.nullable(schema.integer({ minimum: 0 }))),
  finish_reason: schema.optional(
    schema.nullable(schema.string({ minLength: 1, maxLength: 128 }))
  ),
  input_tokens: schema.optional(schema.nullable(schema.integer({ minimum: 0 }))),
  output_tokens: schema.optional(schema.nullable(schema.integer({ minimum: 0 }))),
  total_tokens: schema.optional(schema.nullable(schema.integer({ minimum: 0 }))),
  model_output: schema.optional(schema.nullable(schema.string({ maxLength: 64_000 }))),
  parsed_output: safeJsonValueSchema
})
export const aiCallErrorSchema = schema.object({
  code: schema.string({ minLength: 1, maxLength: 128 }),
  message: schema.string({ minLength: 1, maxLength: 1_024 }),
  http_status: schema.optional(schema.nullable(httpStatusSchema)),
  retryable: schema.optional(schema.boolean())
})

export const aiCallTraceSchema = schema.object({
  call_id: boundedIdentifierSchema,
  correlation_id: boundedIdentifierSchema,
  role: aiCallRoleSchema,
  status: aiCallStatusSchema,
  provider: boundedIdentifierSchema,
  model_id: schema.string({ minLength: 1, maxLength: 256 }),
  endpoint: schema.string({ minLength: 1, maxLength: 2_048 }),
  room_id: schema.optional(schema.nullable(roomIdSchema)),
  session_id: schema.optional(schema.nullable(sessionIdSchema)),
  audience_epoch: schema.optional(
    schema.nullable(schema.integer({ minimum: 1 }))
  ),
  observation_id: schema.optional(schema.nullable(observationIdSchema)),
  generation_request_id: schema.optional(schema.nullable(boundedIdentifierSchema)),
  viewer_instance_id: schema.optional(schema.nullable(viewerIdSchema)),
  trigger_context: schema.optional(schema.nullable(safeJsonObjectSchema)),
  viewer_output_delivery: schema.optional(schema.nullable(viewerOutputDeliverySchema)),
  utterance_id: schema.optional(schema.nullable(boundedIdentifierSchema)),
  started_at_ms: timestampMsSchema,
  updated_at_ms: timestampMsSchema,
  completed_at_ms: schema.optional(schema.nullable(timestampMsSchema)),
  duration_ms: schema.optional(schema.nullable(schema.integer({ minimum: 0 }))),
  timeline: schema.optional(schema.array(aiCallTimelineEventSchema, { maxItems: 256 })),
  request: schema.optional(schema.nullable(aiCallRequestSummarySchema)),
  response: schema.optional(schema.nullable(aiCallResponseSummarySchema)),
  error: schema.optional(schema.nullable(aiCallErrorSchema)),
  redacted: schema.literal(true)
})

export const aiCallListItemSchema = schema.object({
  call_id: boundedIdentifierSchema,
  correlation_id: boundedIdentifierSchema,
  role: aiCallRoleSchema,
  status: aiCallStatusSchema,
  model_id: schema.string({ minLength: 1, maxLength: 256 }),
  trigger_context: schema.optional(schema.nullable(safeJsonObjectSchema)),
  started_at_ms: timestampMsSchema,
  updated_at_ms: timestampMsSchema,
  duration_ms: schema.optional(schema.nullable(schema.integer({ minimum: 0 })))
})
export const aiCallQueryResponseSchema = schema.object({
  items: schema.array(aiCallListItemSchema, { maxItems: 1_000 }),
  next_cursor: schema.nullable(schema.string({ minLength: 1, maxLength: 512 })),
  metadata: schema.optional(safeJsonObjectSchema)
})

export const aiCallImagePreviewMetadataSchema = schema.object({
  preview_id: boundedIdentifierSchema,
  mime_type: schema.enum(['image/jpeg', 'image/png', 'image/webp']),
  byte_length: schema.integer({ minimum: 0 }),
  content_sha256: sha256Schema,
  redacted: schema.literal(true)
})

export const debugQueueSnapshotSchema = schema.object({
  depth: schema.optional(schema.nullable(schema.integer({ minimum: 0 }))),
  capacity: schema.optional(schema.nullable(schema.integer({ minimum: 1 })))
})
export const debugContextReferencesSchema = schema.object({
  event_ids: schema.optional(schema.array(boundedIdentifierSchema, { maxItems: 1_024 })),
  frame_hashes: schema.optional(schema.array(sha256Schema, { maxItems: 128 })),
  memory_ids: schema.optional(schema.array(boundedIdentifierSchema, { maxItems: 512 }))
})
export const debugRuntimeSnapshotSchema = schema.object({
  protocol_version: httpProtocolVersionSchema,
  redacted: schema.literal(true),
  session_id: sessionIdSchema,
  room_id: roomIdSchema,
  audience_epoch: schema.integer({ minimum: 1 }),
  accepting_results: schema.boolean(),
  config: canonicalRuntimeSpecSchema,
  pool: schema.object({
    room_id: roomIdSchema,
    session_id: sessionIdSchema,
    audience_epoch: schema.integer({ minimum: 1 }),
    mode_id: boundedIdentifierSchema,
    session_seed: schema.string({ minLength: 1, maxLength: 256 }),
    viewers: schema.optional(schema.array(viewerInstanceSchema, { maxItems: 32 }))
  }),
  waves: schema.optional(schema.array(observationWaveTraceSchema, { maxItems: 1_024 })),
  queue: schema.optional(schema.nullable(debugQueueSnapshotSchema)),
  telemetry: schema.optional(
    schema.nullable(schema.record(schema.integer({ minimum: 0 }), { maxProperties: 32 }))
  ),
  context_refs: schema.optional(debugContextReferencesSchema),
  memory: schema.optional(
    schema.object({
      revision: schema.optional(schema.integer({ minimum: 0 })),
      ids: schema.optional(schema.array(boundedIdentifierSchema, { maxItems: 512 }))
    })
  ),
  memes: schema.optional(
    schema.object({
      ids: schema.optional(schema.array(boundedIdentifierSchema, { maxItems: 512 })),
      candidate_ids: schema.optional(
        schema.array(boundedIdentifierSchema, { maxItems: 512 })
      )
    })
  ),
  history: schema.optional(schema.array(safeJsonObjectSchema, { maxItems: 1_024 })),
  unavailable: schema.optional(
    schema.array(schema.string({ minLength: 1, maxLength: 128 }), { maxItems: 16 })
  )
})

export const replayModeSchema = schema.enum(['recorded', 'live'])
export const providerRoleSchema = aiCallRoleSchema

const viewerRecordedOutputSchema = schema.refine(
  schema.object({
    action: schema.optional(schema.string({ minLength: 1, maxLength: 64 })),
    text: schema.optional(schema.string({ maxLength: 4_000 })),
    reaction_type: schema.optional(schema.string({ minLength: 1, maxLength: 64 })),
    evidence_event_ids: schema.optional(
      schema.array(boundedIdentifierSchema, { maxItems: 128 })
    ),
    evidence_frame_indexes: schema.optional(
      schema.array(schema.integer({ minimum: 0 }), { maxItems: 60 })
    )
  }),
  (value) => Object.keys(value).length > 0,
  'recorded viewer output must contain a whitelisted field'
)
const memoryRecordedOutputSchema = schema.object({
  candidates: schema.array(safeJsonObjectSchema, { maxItems: 128 })
})
const summaryRecordedOutputSchema = schema.object({
  summary: schema.string({ maxLength: 16_000 })
})
const asrRecordedOutputSchema = schema.object({
  text: schema.string({ maxLength: 16_000 }),
  final: schema.boolean(),
  started_at_ms: timestampMsSchema,
  ended_at_ms: timestampMsSchema
})

export const recordedProviderOutputSchema = schema.union([
  schema.object({
    generation_request_id: boundedIdentifierSchema,
    provider_role: schema.literal('viewer'),
    output: viewerRecordedOutputSchema
  }),
  schema.object({
    generation_request_id: boundedIdentifierSchema,
    provider_role: schema.literal('memory'),
    output: memoryRecordedOutputSchema
  }),
  schema.object({
    generation_request_id: boundedIdentifierSchema,
    provider_role: schema.literal('visual_summary'),
    output: summaryRecordedOutputSchema
  }),
  schema.object({
    generation_request_id: boundedIdentifierSchema,
    provider_role: schema.literal('history_summary'),
    output: summaryRecordedOutputSchema
  }),
  schema.object({
    generation_request_id: boundedIdentifierSchema,
    provider_role: schema.literal('asr'),
    output: asrRecordedOutputSchema
  })
])

export const replayEventSchema = schema.object({
  sequence: schema.integer({ minimum: 1 }),
  event_type: schema.string({ minLength: 1, maxLength: 128 }),
  occurred_at_ms: timestampMsSchema,
  payload: safeJsonObjectSchema
})

const replayBundleBaseSchema = schema.object({
  replay_schema_version: schema.literal(1),
  protocol_version: httpProtocolVersionSchema,
  audience_contract_version: schema.enum([2, 3]),
  bundle_id: boundedIdentifierSchema,
  created_at_ms: timestampMsSchema,
  seed: schema.integer(),
  virtual_clock_start_ms: timestampMsSchema,
  config_hash: sha256Schema,
  canonical_runtime_spec: canonicalRuntimeSpecSchema,
  input_refs: schema.optional(
    schema.array(schema.string({ minLength: 1, maxLength: 2_048 }), { maxItems: 1_024 })
  ),
  events: schema.array(replayEventSchema, { minItems: 1, maxItems: 100_000 }),
  recorded_provider_outputs: schema.array(recordedProviderOutputSchema, {
    minItems: 1,
    maxItems: 100_000
  }),
  recorded_outputs_digest: schema.optional(schema.nullable(sha256Schema)),
  traces: schema.optional(schema.array(viewerRequestTraceSchema, { maxItems: 100_000 })),
  redacted: schema.literal(true)
})

export const replayBundleSchema = schema.refine(
  replayBundleBaseSchema,
  (value) => {
    if (
      value.audience_contract_version !==
      value.canonical_runtime_spec.audience_contract_version
    ) {
      return false
    }
    if (value.config_hash !== canonicalSha256(value.canonical_runtime_spec)) return false
    const sequences = value.events.map((event) => event.sequence)
    if (!sequences.every((sequence, index) => sequence === index + 1)) return false
    if (
      !value.events.every(
        (event, index) =>
          index === 0 || event.occurred_at_ms >= value.events[index - 1]!.occurred_at_ms
      )
    ) {
      return false
    }
    const keys = value.recorded_provider_outputs.map(
      (output) => `${output.provider_role}:${output.generation_request_id}`
    )
    if (new Set(keys).size !== keys.length) return false
    if (
      value.recorded_outputs_digest !== undefined &&
      value.recorded_outputs_digest !== null &&
      value.recorded_outputs_digest !== canonicalSha256(value.recorded_provider_outputs)
    ) {
      return false
    }
    const references: string[] = []
    for (const event of value.events) {
      const role = event.event_type.split('.', 1)[0]
      const rawId = event.payload.generation_request_id
      const rawIds = event.payload.generation_request_ids
      if (typeof rawId === 'string') references.push(`${role}:${rawId}`)
      if (Array.isArray(rawIds)) {
        for (const item of rawIds) {
          if (typeof item === 'string') references.push(`${role}:${item}`)
        }
      }
    }
    return (
      new Set(references).size === references.length &&
      references.length === keys.length &&
      references.every((reference) => keys.includes(reference))
    )
  },
  'replay bundle versions, sequences, timestamps, and Provider output identities must be valid'
)

export const replayRequestSchema = schema.refine(
  schema.object({
    mode: schema.optional(replayModeSchema),
    bundle: replayBundleSchema,
    allow_external_provider_calls: schema.optional(schema.boolean())
  }),
  (value) =>
    value.mode === 'live'
      ? value.allow_external_provider_calls === true
      : value.allow_external_provider_calls !== true,
  'live replay requires explicit external Provider opt-in; recorded replay forbids it'
)

export const recordedOutputConsumptionSchema = schema.object({
  provider_role: providerRoleSchema,
  generation_request_id: boundedIdentifierSchema,
  call_index: schema.integer({ minimum: 1 }),
  runtime_request_id: schema.optional(nullableIdentifierSchema)
})
export const recordedReplayEvidenceSchema = schema.object({
  decisions: schema.array(safeJsonObjectSchema, { maxItems: 100_000 }),
  selected_viewer_ids: schema.array(viewerIdSchema, { maxItems: 100_000 }),
  barrages: schema.array(safeJsonObjectSchema, { maxItems: 100_000 }),
  memories: schema.array(safeJsonObjectSchema, { maxItems: 100_000 }),
  traces: schema.array(safeJsonObjectSchema, { maxItems: 100_000 }),
  consumed_provider_roles: schema.array(providerRoleSchema, { maxItems: 100_000 }),
  consumed_provider_outputs: schema.array(recordedOutputConsumptionSchema, {
    maxItems: 100_000
  }),
  external_transport_call_count: schema.literal(0)
})
export const replayResultSchema = schema.object({
  bundle_id: boundedIdentifierSchema,
  mode: replayModeSchema,
  deterministic_proof: schema.boolean(),
  credentialed_provider_proof: schema.boolean(),
  event_count: schema.integer({ minimum: 0 }),
  trace_count: schema.integer({ minimum: 0 }),
  completed_at_ms: timestampMsSchema,
  replay_digest: schema.optional(schema.nullable(sha256Schema)),
  recorded_evidence: schema.optional(schema.nullable(recordedReplayEvidenceSchema)),
  provider_profile_id: schema.optional(nullableIdentifierSchema),
  external_transport_call_count: schema.optional(schema.integer({ minimum: 0 }))
})

export type TraceQuery = InferSchema<typeof traceQuerySchema>
export type TraceQueryResponse = InferSchema<typeof traceQueryResponseSchema>
export type ViewerRequestTrace = InferSchema<typeof viewerRequestTraceSchema>
export type AiCallRole = InferSchema<typeof aiCallRoleSchema>
export type AiCallStatus = InferSchema<typeof aiCallStatusSchema>
export type AiCallTrace = InferSchema<typeof aiCallTraceSchema>
export type AiCallListItem = InferSchema<typeof aiCallListItemSchema>
export type AiCallQueryResponse = InferSchema<typeof aiCallQueryResponseSchema>
export type AiCallImagePreview = InferSchema<
  typeof aiCallImagePreviewMetadataSchema
>
export type DebugRuntimeSnapshot = InferSchema<typeof debugRuntimeSnapshotSchema>
export type ReplayRequest = InferSchema<typeof replayRequestSchema>
export type ReplayResult = InferSchema<typeof replayResultSchema>
