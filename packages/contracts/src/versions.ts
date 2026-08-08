import { schema, type InferSchema } from './schema'

export const ADVX_SCHEMA_PACKAGE_VERSION = 1 as const
export const ADVX_HTTP_PROTOCOL_VERSION = 3 as const
export const ADVX_REALTIME_PROTOCOL_VERSION = 4 as const
export const ADVX_SUPPORTED_REALTIME_PROTOCOL_VERSIONS = [3, 4] as const
export const ADVX_TRACE_SCHEMA_VERSION = 1 as const
export const ADVX_JSON_SCHEMA_DIALECT =
  'https://json-schema.org/draft/2020-12/schema' as const
export const ADVX_SCHEMA_ID_PREFIX = 'https://advx.local/schemas/' as const

export const schemaPackageVersionSchema = schema.literal(ADVX_SCHEMA_PACKAGE_VERSION)
export const httpProtocolVersionSchema = schema.literal(ADVX_HTTP_PROTOCOL_VERSION)
export const realtimeProtocolVersionSchema = schema.enum(
  ADVX_SUPPORTED_REALTIME_PROTOCOL_VERSIONS
)
export const currentRealtimeProtocolVersionSchema = schema.literal(
  ADVX_REALTIME_PROTOCOL_VERSION
)
export const traceSchemaVersionSchema = schema.literal(ADVX_TRACE_SCHEMA_VERSION)

export type SchemaPackageVersion = InferSchema<typeof schemaPackageVersionSchema>
export type HttpProtocolVersion = InferSchema<typeof httpProtocolVersionSchema>
export type RealtimeProtocolVersion = InferSchema<typeof realtimeProtocolVersionSchema>
export type CurrentRealtimeProtocolVersion = InferSchema<
  typeof currentRealtimeProtocolVersionSchema
>
export type TraceSchemaVersion = InferSchema<typeof traceSchemaVersionSchema>
