import { schema, type InferSchema } from './schema'

const identifier = (description: string) =>
  schema.string({ minLength: 1, maxLength: 128, description })

export const roomIdSchema = identifier('Stable room identifier')
export const sessionIdSchema = identifier('Stable session identifier')
export const viewerIdSchema = identifier('Stable viewer instance identifier')
export const personaIdSchema = identifier('Stable persona identifier')
export const observationIdSchema = identifier('Stable observation identifier')
export const generationIdSchema = identifier('Stable generation request identifier')
export const barrageIdSchema = identifier('Stable barrage identifier')
export const applyIdSchema = identifier('Idempotent runtime apply identifier')

export const timestampMsSchema = schema.integer({
  minimum: 0,
  description: 'Unix timestamp in milliseconds'
})
export const deadlineAtMsSchema = schema.integer({
  minimum: 1,
  description: 'Positive absolute deadline in milliseconds'
})
export const durationMsSchema = schema.integer({
  minimum: 0,
  description: 'Non-negative duration in milliseconds'
})
export const positiveDurationMsSchema = schema.integer({
  minimum: 1,
  description: 'Positive duration in milliseconds'
})
export const revisionSchema = schema.integer({
  minimum: 0,
  description: 'Non-negative revision number'
})
export const positiveRevisionSchema = schema.integer({
  minimum: 1,
  description: 'Positive revision number'
})
export const epochSchema = schema.integer({
  minimum: 1,
  description: 'Positive audience epoch'
})

export type RoomId = InferSchema<typeof roomIdSchema>
export type SessionId = InferSchema<typeof sessionIdSchema>
export type ViewerId = InferSchema<typeof viewerIdSchema>
export type PersonaId = InferSchema<typeof personaIdSchema>
export type ObservationId = InferSchema<typeof observationIdSchema>
export type GenerationId = InferSchema<typeof generationIdSchema>
export type BarrageId = InferSchema<typeof barrageIdSchema>
export type ApplyId = InferSchema<typeof applyIdSchema>
export type TimestampMs = InferSchema<typeof timestampMsSchema>
export type DeadlineAtMs = InferSchema<typeof deadlineAtMsSchema>
export type DurationMs = InferSchema<typeof durationMsSchema>
export type PositiveDurationMs = InferSchema<typeof positiveDurationMsSchema>
export type Revision = InferSchema<typeof revisionSchema>
export type PositiveRevision = InferSchema<typeof positiveRevisionSchema>
export type Epoch = InferSchema<typeof epochSchema>
