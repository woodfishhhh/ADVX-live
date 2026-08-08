import { schema } from '../schema'

export const emptyObjectSchema = schema.object({})
export const boundedIdentifierSchema = schema.string({ minLength: 1, maxLength: 128 })
export const boundedTextSchema = schema.string({ minLength: 1, maxLength: 4_000 })
export const optionalReasonSchema = schema.optional(
  schema.nullable(schema.string({ maxLength: 256 }))
)
export const sha256Schema = schema.string({ pattern: '^[0-9a-f]{64}$' })
export const httpStatusSchema = schema.integer({ minimum: 100, maximum: 599 })
export const safeJsonValueSchema = schema.safeJson({
  maxDepth: 8,
  maxArrayItems: 1024,
  maxObjectKeys: 512,
  maxStringLength: 16_384
})
export const safeJsonObjectSchema = schema.record(safeJsonValueSchema, {
  maxProperties: 512,
  description: 'Bounded redacted metadata object'
})

export const sessionPathParamsSchema = schema.object({
  session_id: boundedIdentifierSchema
})
export const viewerPathParamsSchema = schema.object({
  session_id: boundedIdentifierSchema,
  viewer_id: boundedIdentifierSchema
})
export const roomPathParamsSchema = schema.object({
  room_id: boundedIdentifierSchema
})
export const memoryPathParamsSchema = schema.object({
  room_id: boundedIdentifierSchema,
  memory_id: boundedIdentifierSchema
})
export const namespacePathParamsSchema = schema.object({
  namespace_id: boundedIdentifierSchema
})
export const candidatePathParamsSchema = schema.object({
  namespace_id: boundedIdentifierSchema,
  candidate_id: boundedIdentifierSchema
})
export const memePathParamsSchema = schema.object({
  namespace_id: boundedIdentifierSchema,
  meme_id: boundedIdentifierSchema
})
