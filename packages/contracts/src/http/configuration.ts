import { schema, type InferSchema } from '../schema'
import { boundedIdentifierSchema, httpStatusSchema } from './common'

const endpointSchema = schema.string({ minLength: 1, maxLength: 2_048 })
const modelIdSchema = schema.string({ minLength: 1, maxLength: 256 })

export const providerProbeStatusSchema = schema.enum([
  'passed',
  'failed',
  'blocked',
  'skipped'
])

export const providerProfileSchema = schema.object({
  provider_profile_id: boundedIdentifierSchema,
  model_base_url: endpointSchema,
  model_name: modelIdSchema,
  viewer_model: schema.nullable(modelIdSchema),
  memory_model: schema.nullable(modelIdSchema),
  visual_summary_model: schema.nullable(modelIdSchema),
  asr_base_url: schema.nullable(endpointSchema),
  asr_model: schema.nullable(modelIdSchema)
})

export const providerConfigurationStatusSchema = schema.object({
  configured: schema.boolean(),
  provider_profile_id: schema.nullable(boundedIdentifierSchema),
  model_base_url: schema.nullable(endpointSchema),
  model_name: schema.nullable(modelIdSchema),
  viewer_model: schema.nullable(modelIdSchema),
  memory_model: schema.nullable(modelIdSchema),
  visual_summary_model: schema.nullable(modelIdSchema),
  asr_base_url: schema.nullable(endpointSchema),
  asr_model: schema.nullable(modelIdSchema)
})

export const providerModelDiscoverySchema = schema.object({
  provider_profile_id: boundedIdentifierSchema,
  model_ids: schema.array(modelIdSchema, { maxItems: 4_096 })
})

export const providerCapabilityCheckSchema = schema.object({
  capability: schema.string({ minLength: 1, maxLength: 128 }),
  status: providerProbeStatusSchema,
  model_id: schema.nullable(modelIdSchema),
  error_code: schema.nullable(schema.string({ minLength: 1, maxLength: 128 })),
  http_status: schema.nullable(httpStatusSchema)
})

export const providerCapabilityProbeResultSchema = schema.object({
  provider_profile_id: boundedIdentifierSchema,
  status: providerProbeStatusSchema,
  discovered_model_ids: schema.array(modelIdSchema, { maxItems: 4_096 }),
  checks: schema.array(providerCapabilityCheckSchema, { maxItems: 64 })
})

export const providerCapabilityProbeRequestSchema = schema.object({
  provider_profile_id: schema.optional(boundedIdentifierSchema)
})

export const providerPublicSetupMetadataSchema = schema.object({
  provider_profile_id: schema.optional(boundedIdentifierSchema),
  model_base_url: endpointSchema,
  model_name: modelIdSchema,
  viewer_model: schema.optional(schema.nullable(modelIdSchema)),
  memory_model: schema.optional(schema.nullable(modelIdSchema)),
  visual_summary_model: schema.optional(schema.nullable(modelIdSchema)),
  asr_base_url: schema.optional(endpointSchema),
  asr_model: schema.optional(modelIdSchema)
})

export type ProviderProfile = InferSchema<typeof providerProfileSchema>
export type ProviderConfigurationStatus = InferSchema<
  typeof providerConfigurationStatusSchema
>
export type ProviderModelDiscovery = InferSchema<typeof providerModelDiscoverySchema>
export type ProviderCapabilityProbeResult = InferSchema<
  typeof providerCapabilityProbeResultSchema
>
