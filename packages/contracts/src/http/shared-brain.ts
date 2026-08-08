import { epochSchema, roomIdSchema, sessionIdSchema, timestampMsSchema } from '../scalars'
import { schema, type InferSchema } from '../schema'
import { boundedIdentifierSchema } from './common'

const unitIntervalSchema = schema.number({ minimum: 0, maximum: 1 })
const evidenceEventIdsSchema = schema.array(boundedIdentifierSchema, {
  minItems: 1,
  maxItems: 128
})

export const roomMemoryTypeSchema = schema.enum([
  'user_preference',
  'real_world_fact',
  'room_lore',
  'shared_experience'
])
export const memeCandidateOutcomeSchema = schema.enum([
  'pending',
  'accepted',
  'rejected'
])
export const modeMemeStateSchema = schema.enum([
  'active',
  'disabled',
  'archived',
  'revoked'
])

export const expectedRevisionRequestSchema = schema.object({
  expected_revision: schema.integer({ minimum: 0 })
})
export const positiveExpectedRevisionQuerySchema = schema.object({
  expected_revision: schema.integer({ minimum: 1 })
})

export const roomLongTermMemorySchema = schema.refine(
  schema.object({
    memory_id: boundedIdentifierSchema,
    room_id: roomIdSchema,
    memory_type: roomMemoryTypeSchema,
    content: schema.string({ minLength: 1, maxLength: 4_000 }),
    evidence_event_ids: evidenceEventIdsSchema,
    confidence: unitIntervalSchema,
    revision: schema.integer({ minimum: 1 }),
    created_at_ms: timestampMsSchema,
    updated_at_ms: timestampMsSchema,
    revoked_at_ms: schema.optional(schema.nullable(timestampMsSchema))
  }),
  (value) =>
    value.updated_at_ms >= value.created_at_ms &&
    (value.revoked_at_ms === undefined ||
      value.revoked_at_ms === null ||
      value.revoked_at_ms >= value.created_at_ms),
  'memory timestamps must be monotonic'
)

export const memoryCandidateRequestSchema = schema.object({
  candidate_id: boundedIdentifierSchema,
  room_id: roomIdSchema,
  session_id: sessionIdSchema,
  audience_epoch: epochSchema,
  idempotency_key: boundedIdentifierSchema,
  base_revision: schema.integer({ minimum: 0 }),
  memory_id: boundedIdentifierSchema,
  memory_type: roomMemoryTypeSchema,
  content: schema.string({ minLength: 1, maxLength: 4_000 }),
  evidence_event_ids: evidenceEventIdsSchema,
  tags: schema.optional(
    schema.array(schema.string({ minLength: 1, maxLength: 128 }), { maxItems: 64 })
  ),
  origin: schema.optional(schema.string({ minLength: 1, maxLength: 64 })),
  importance: schema.optional(unitIntervalSchema),
  confidence: schema.optional(unitIntervalSchema)
})

export const candidateCommitResponseSchema = schema.object({
  accepted: schema.boolean(),
  pending: schema.optional(schema.boolean()),
  result_id: schema.optional(schema.nullable(boundedIdentifierSchema)),
  revision: schema.optional(schema.nullable(schema.integer({ minimum: 0 }))),
  head_revision: schema.optional(schema.nullable(schema.integer({ minimum: 0 }))),
  created: schema.optional(schema.boolean()),
  reason: schema.optional(schema.nullable(schema.string({ maxLength: 256 })))
})

export const memoryEditRequestSchema = schema.object({
  expected_revision: schema.integer({ minimum: 0 }),
  content: schema.string({ minLength: 1, maxLength: 4_000 }),
  confidence: schema.optional(unitIntervalSchema),
  evidence_event_ids: schema.optional(schema.nullable(evidenceEventIdsSchema))
})
export const memoryMergeRequestSchema = schema.object({
  expected_revision: schema.integer({ minimum: 0 }),
  source_memory_id: boundedIdentifierSchema,
  source_expected_revision: schema.integer({ minimum: 1 }),
  content: schema.string({ minLength: 1, maxLength: 4_000 })
})
export const memoryReplaceRequestSchema = schema.object({
  expected_revision: schema.integer({ minimum: 0 }),
  replacement_memory_id: boundedIdentifierSchema,
  content: schema.string({ minLength: 1, maxLength: 4_000 }),
  evidence_event_ids: evidenceEventIdsSchema
})
export const memoryHeadResponseSchema = schema.object({
  room_id: roomIdSchema,
  revision: schema.integer({ minimum: 0 })
})
export const memoryResetResponseSchema = schema.object({
  deleted_count: schema.integer({ minimum: 0 })
})
export const deleteMemoryResponseSchema = schema.object({ deleted: schema.literal(true) })

export const modeMemeSchema = schema.refine(
  schema.object({
    meme_id: boundedIdentifierSchema,
    room_id: roomIdSchema,
    namespace_id: boundedIdentifierSchema,
    text: schema.string({ minLength: 1, maxLength: 500 }),
    intensity: schema.optional(unitIntervalSchema),
    source_candidate_id: boundedIdentifierSchema,
    state: schema.optional(modeMemeStateSchema),
    pinned: schema.optional(schema.boolean()),
    use_count: schema.optional(schema.integer({ minimum: 0 })),
    revision: schema.integer({ minimum: 1 }),
    created_at_ms: timestampMsSchema,
    updated_at_ms: timestampMsSchema
  }),
  (value) => value.updated_at_ms >= value.created_at_ms,
  'meme updated_at_ms must not precede created_at_ms'
)

export const memeCandidateSchema = schema.object({
  candidate_id: boundedIdentifierSchema,
  room_id: roomIdSchema,
  session_id: sessionIdSchema,
  audience_epoch: epochSchema,
  observation_id: boundedIdentifierSchema,
  namespace_id: boundedIdentifierSchema,
  text: schema.string({ minLength: 1, maxLength: 500 }),
  idempotency_key: schema.optional(schema.nullable(boundedIdentifierSchema)),
  evidence_event_ids: evidenceEventIdsSchema,
  evidence_frame_indexes: schema.optional(
    schema.array(schema.integer({ minimum: 0 }), { maxItems: 60 })
  ),
  outcome: schema.optional(memeCandidateOutcomeSchema),
  created_at_ms: timestampMsSchema
})

export const memeEditRequestSchema = schema.object({
  expected_revision: schema.integer({ minimum: 0 }),
  text: schema.string({ minLength: 1, maxLength: 500 }),
  intensity: schema.optional(schema.nullable(unitIntervalSchema))
})
export const memeMaintenanceResponseSchema = schema.object({
  archived_meme_ids: schema.array(boundedIdentifierSchema, { maxItems: 100_000 })
})
export const autoIngestRequestSchema = schema.object({
  expected_revision: schema.integer({ minimum: 0 }),
  enabled: schema.boolean()
})
export const autoIngestResponseSchema = schema.object({
  namespace_id: boundedIdentifierSchema,
  enabled: schema.boolean(),
  revision: schema.integer({ minimum: 0 })
})
export const listMemesQuerySchema = schema.object({
  active_only: schema.optional(schema.boolean())
})
export const legacyMemeImportRequestSchema = schema.object({
  room_id: roomIdSchema,
  session_id: sessionIdSchema,
  audience_epoch: epochSchema,
  legacy_meme_id: boundedIdentifierSchema,
  text: schema.string({ minLength: 1, maxLength: 500 }),
  legacy_created_at_ms: schema.optional(schema.nullable(timestampMsSchema))
})
export const legacyMemeImportResponseSchema = schema.object({
  candidate_id: boundedIdentifierSchema,
  meme_id: boundedIdentifierSchema,
  provenance_event_id: boundedIdentifierSchema,
  created: schema.boolean()
})

export type RoomLongTermMemory = InferSchema<typeof roomLongTermMemorySchema>
export type RoomMemoryType = InferSchema<typeof roomMemoryTypeSchema>
export type MemoryCandidateRequest = InferSchema<typeof memoryCandidateRequestSchema>
export type CandidateCommitResponse = InferSchema<
  typeof candidateCommitResponseSchema
>
export type MemoryHeadResponse = InferSchema<typeof memoryHeadResponseSchema>
export type MemoryResetResponse = InferSchema<typeof memoryResetResponseSchema>
export type ModeMeme = InferSchema<typeof modeMemeSchema>
export type MemeCandidate = InferSchema<typeof memeCandidateSchema>
export type AutoIngestResponse = InferSchema<typeof autoIngestResponseSchema>
export type LegacyMemeImportRequest = InferSchema<
  typeof legacyMemeImportRequestSchema
>
export type LegacyMemeImportResponse = InferSchema<
  typeof legacyMemeImportResponseSchema
>
