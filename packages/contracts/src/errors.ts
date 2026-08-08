import { schema, type InferSchema } from './schema'

export const errorCodeSchema = schema.string({ minLength: 1, maxLength: 128 })
export const safeErrorDetailSchema = schema.string({ minLength: 1, maxLength: 256 })

export const normalizedErrorSchema = schema.object(
  {
    code: errorCodeSchema,
    retryable: schema.boolean(),
    safe_detail: schema.optional(safeErrorDetailSchema)
  },
  {
    description:
      'Sanitized error metadata; raw payloads, credentials, images, and audio are forbidden'
  }
)

export type ErrorCode = InferSchema<typeof errorCodeSchema>
export type SafeErrorDetail = InferSchema<typeof safeErrorDetailSchema>
export type NormalizedError = InferSchema<typeof normalizedErrorSchema>
