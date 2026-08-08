import { schema, type InferSchema } from './schema'
import { durationMsSchema, timestampMsSchema } from './scalars'

export const traceIdSchema = schema.string({ minLength: 1, maxLength: 128 })
export const correlationIdSchema = schema.string({ minLength: 1, maxLength: 128 })
export const paginationCursorSchema = schema.string({ minLength: 1, maxLength: 512 })

export const traceCorrelationMetadataSchema = schema.object({
  trace_id: traceIdSchema,
  correlation_id: correlationIdSchema,
  parent_trace_id: schema.optional(traceIdSchema),
  started_at_ms: timestampMsSchema,
  elapsed_ms: schema.optional(durationMsSchema)
})

export const paginationMetadataSchema = schema.object({
  cursor: schema.optional(schema.nullable(paginationCursorSchema)),
  next_cursor: schema.optional(schema.nullable(paginationCursorSchema)),
  limit: schema.integer({ minimum: 1, maximum: 1000 })
})

export const boundedListMetadataSchema = schema.object({
  count: schema.integer({ minimum: 0, maximum: 65_536 }),
  limit: schema.integer({ minimum: 1, maximum: 65_536 }),
  truncated: schema.boolean(),
  total: schema.optional(schema.integer({ minimum: 0, maximum: 65_536 }))
})

export type TraceId = InferSchema<typeof traceIdSchema>
export type CorrelationId = InferSchema<typeof correlationIdSchema>
export type PaginationCursor = InferSchema<typeof paginationCursorSchema>
export type TraceCorrelationMetadata = InferSchema<
  typeof traceCorrelationMetadataSchema
>
export type PaginationMetadata = InferSchema<typeof paginationMetadataSchema>
export type BoundedListMetadata = InferSchema<typeof boundedListMetadataSchema>
