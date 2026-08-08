import {
  HTTP_OPERATION_COUNT,
  httpOperations,
  normalizedErrorSchema,
  type HttpOperation,
  type JsonSchema
} from '@advx/contracts'

export const ADVX_OPENAPI_VERSION = '3.1.0' as const
export const ADVX_OPENAPI_SNAPSHOT_PATH =
  'openapi/advx-control-plane.openapi.json' as const

type OpenApiParameter = {
  readonly name: string
  readonly in: 'path' | 'query'
  readonly required: boolean
  readonly schema: JsonSchema
}

type OpenApiResponse = {
  readonly description: string
  readonly content: {
    readonly 'application/json': { readonly schema: JsonSchema }
  }
  readonly 'x-advx-error-codes'?: readonly string[]
  readonly 'x-advx-retryable'?: boolean
}

type OpenApiOperation = {
  readonly operationId: string
  readonly tags: readonly string[]
  readonly parameters?: readonly OpenApiParameter[]
  readonly requestBody?: {
    readonly required: true
    readonly content: {
      readonly 'application/json': { readonly schema: JsonSchema }
    }
    readonly 'x-advx-boundary'?: 'controlled-secret-boundary'
    readonly 'x-advx-internal-secret-fields'?: readonly string[]
    readonly 'x-advx-serializable-public-contract'?: false
  }
  readonly responses: Readonly<Record<string, OpenApiResponse>>
  readonly security?: readonly [{ readonly LocalBearerToken: readonly [] }]
}

export type AdvxOpenApiDocument = {
  readonly openapi: typeof ADVX_OPENAPI_VERSION
  readonly info: {
    readonly title: string
    readonly version: string
    readonly description: string
  }
  readonly servers: readonly [{ readonly url: string }]
  readonly paths: Readonly<
    Record<string, Readonly<Record<string, OpenApiOperation>>>
  >
  readonly components: {
    readonly securitySchemes: {
      readonly LocalBearerToken: {
        readonly type: 'http'
        readonly scheme: 'bearer'
        readonly bearerFormat: 'opaque-local-token'
      }
    }
  }
  readonly 'x-advx-operation-count': typeof HTTP_OPERATION_COUNT
}

export function createAdvxOpenApiDocument(): AdvxOpenApiDocument {
  const paths: Record<string, Record<string, OpenApiOperation>> = {}

  for (const operation of [...httpOperations].sort(compareOperations)) {
    const path = toOpenApiPath(operation.path)
    const pathItem = paths[path] ?? {}
    pathItem[operation.method.toLowerCase()] = toOpenApiOperation(operation)
    paths[path] = pathItem
  }

  return {
    openapi: ADVX_OPENAPI_VERSION,
    info: {
      title: 'ADVX Live local control plane',
      version: '0.1.0',
      description:
        'Development contract generated from the canonical TypeScript HTTP operation registry.'
    },
    servers: [{ url: 'http://127.0.0.1:8765' }],
    paths,
    components: {
      securitySchemes: {
        LocalBearerToken: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'opaque-local-token'
        }
      }
    },
    'x-advx-operation-count': HTTP_OPERATION_COUNT
  }
}

export function serializeAdvxOpenApiDocument(
  document: AdvxOpenApiDocument = createAdvxOpenApiDocument()
): string {
  return `${JSON.stringify(sortJson(document), null, 2)}\n`
}

function toOpenApiOperation(operation: HttpOperation): OpenApiOperation {
  const parameters = [
    ...schemaParameters(operation.pathParams.jsonSchema, 'path'),
    ...schemaParameters(operation.query.jsonSchema, 'query')
  ]

  return {
    operationId: operation.operationId,
    tags: [operation.operationId.split('.')[1] ?? 'control'],
    ...(parameters.length === 0 ? {} : { parameters }),
    ...(operation.body === undefined
      ? {}
      : { requestBody: toRequestBody(operation.body) }),
    responses: toResponses(operation),
    ...(operation.path === '/health'
      ? {}
      : { security: [{ LocalBearerToken: [] }] })
  }
}

function toRequestBody(body: NonNullable<HttpOperation['body']>) {
  if (body.kind === 'public') {
    return {
      required: true as const,
      content: { 'application/json': { schema: body.schema.jsonSchema } }
    }
  }

  return {
    required: true as const,
    content: {
      'application/json': { schema: body.publicMetadataSchema.jsonSchema }
    },
    'x-advx-boundary': body.kind,
    'x-advx-internal-secret-fields': [...body.internalSecretFields],
    'x-advx-serializable-public-contract': body.serializablePublicContract
  }
}

function toResponses(
  operation: HttpOperation
): Readonly<Record<string, OpenApiResponse>> {
  const responses: Record<string, OpenApiResponse> = {}
  const errorsByStatus = new Map<
    number,
    (HttpOperation['errors'][number])[]
  >()
  for (const error of operation.errors) {
    const errors = errorsByStatus.get(error.status) ?? []
    errors.push(error)
    errorsByStatus.set(error.status, errors)
  }

  for (const [status, responseSchema] of Object.entries(operation.responses)) {
    const errors = errorsByStatus.get(Number(status))
    responses[status] = errors
      ? errorResponse(errors)
      : jsonResponse('Successful response', responseSchema.jsonSchema)
  }

  for (const [status, errors] of errorsByStatus) {
    responses[String(status)] ??= errorResponse(errors)
  }

  return responses
}

function errorResponse(
  errors: readonly HttpOperation['errors'][number][]
): OpenApiResponse {
  const codes = [...new Set(errors.map((error) => error.code))].sort()
  return {
    ...jsonResponse(`Normalized error: ${codes.join(', ')}`, normalizedErrorSchema.jsonSchema),
    'x-advx-error-codes': codes,
    'x-advx-retryable': errors.some((error) => error.retryable)
  }
}

function jsonResponse(description: string, schema: JsonSchema): OpenApiResponse {
  return {
    description,
    content: { 'application/json': { schema } }
  }
}

function schemaParameters(
  jsonSchema: JsonSchema,
  location: 'path' | 'query'
): readonly OpenApiParameter[] {
  const properties = isRecord(jsonSchema.properties) ? jsonSchema.properties : {}
  const required = new Set(
    Array.isArray(jsonSchema.required)
      ? jsonSchema.required.filter((name): name is string => typeof name === 'string')
      : []
  )

  return Object.entries(properties)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, candidate]) => ({
      name,
      in: location,
      required: location === 'path' || required.has(name),
      schema: isRecord(candidate) ? candidate : {}
    }))
}

function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')
}

function compareOperations(left: HttpOperation, right: HttpOperation): number {
  return (
    left.path.localeCompare(right.path) || left.method.localeCompare(right.method)
  )
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, sortJson(child)])
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
