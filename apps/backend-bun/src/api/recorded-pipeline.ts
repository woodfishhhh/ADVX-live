import {
  ADVX_HTTP_PROTOCOL_VERSION,
  aiCallQueryResponseSchema,
  providerCapabilityProbeRequestSchema,
  providerCapabilityProbeResultSchema,
  providerConfigurationStatusSchema,
  providerModelDiscoverySchema,
  traceQueryResponseSchema,
  traceQuerySchema,
  type NormalizedError,
  type SessionId
} from '@advx/contracts'
import { Elysia } from 'elysia'

import type { BackendApplication } from '../application'
import { ProviderConfigurationError } from '../application'

export type RecordedPipelineApiAdapter = Readonly<{
  providerStatus(): unknown
  saveProvider(input: unknown): unknown
  providerModels(): unknown
  providerProbe(): unknown
  traces(sessionId: SessionId | null): Promise<unknown>
  aiCalls(): Promise<unknown>
  markSessionStarted(sessionId: SessionId): void
  markSessionStopped(sessionId: SessionId): void
}>

type ResponseSet = {
  status?: number | string
  headers: Record<string, string | number>
}

export function createRecordedPipelineApi(
  application: BackendApplication,
  authorize: (authorization: string | null) => boolean,
  pipeline: RecordedPipelineApiAdapter
) {
  return new Elysia({ name: 'advx-recorded-pipeline-api' })
    .onRequest(({ request, set }) => {
      const path = new URL(request.url).pathname
      const protocol = path.startsWith('/debug/') ? 'runtime' : 'legacy'
      if (
        path === '/configuration/providers' ||
        path.startsWith('/configuration/providers/') ||
        path.startsWith('/debug/')
      ) {
        return guardRequest(request, set, authorize, protocol)
      }
    })
    .get('/configuration/providers', () =>
      providerConfigurationStatusSchema.parse(pipeline.providerStatus())
    )
    .put('/configuration/providers', async ({ body, set }) => {
      // The recorded fixture intentionally discards controlled secret fields.
      try {
        return providerConfigurationStatusSchema.parse(
          pipeline.saveProvider(body)
        )
      } catch (cause) {
        const failure = providerConfigurationFailure(cause)
        set.status = failure.status
        return error(failure.code)
      }
    })
    .get('/configuration/providers/models', ({ set }) => {
      try {
        return providerModelDiscoverySchema.parse(pipeline.providerModels())
      } catch (cause) {
        const failure = providerConfigurationFailure(cause)
        set.status = failure.status
        return error(failure.code)
      }
    })
    .post('/configuration/providers/probe', ({ body, set }) => {
      try {
        providerCapabilityProbeRequestSchema.parse(body)
        return providerCapabilityProbeResultSchema.parse(pipeline.providerProbe())
      } catch (cause) {
        const failure = providerConfigurationFailure(cause)
        set.status = failure.status
        return error(failure.code)
      }
    })
    .get('/debug/traces', async ({ query }) => {
      const parsed = traceQuerySchema.parse(query)
      return traceQueryResponseSchema.parse(
        await pipeline.traces((parsed.session_id ?? null) as SessionId | null)
      )
    })
    .get('/debug/ai-calls', async () =>
      aiCallQueryResponseSchema.parse(await pipeline.aiCalls())
    )
    .get('/debug/runtime/:session_id', async ({ params, set }) => {
      try {
        return await application.currentRuntimeSession(params.session_id as SessionId)
      } catch {
        set.status = 404
        return error('runtime_session_not_found')
      }
    })
}

function guardRequest(
  request: Request,
  set: ResponseSet,
  authorize: (authorization: string | null) => boolean,
  protocol: 'legacy' | 'runtime'
): NormalizedError | undefined {
  set.headers['x-request-id'] = request.headers.get('x-request-id') ?? crypto.randomUUID()
  if (!authorize(request.headers.get('authorization'))) {
    set.status = 401
    set.headers['www-authenticate'] = 'Bearer'
    return error('invalid_local_token')
  }
  const version = request.headers.get('x-advx-protocol-version')
  if (version === String(ADVX_HTTP_PROTOCOL_VERSION)) return undefined
  set.headers['x-advx-protocol-version'] = ADVX_HTTP_PROTOCOL_VERSION
  if (protocol === 'legacy') {
    set.status = 426
    return error('protocol_version_mismatch')
  }
  if (version === '1') {
    set.status = 409
    return error('protocol_version_conflict')
  }
  set.status = 422
  return error('unsupported_protocol_version')
}

function error(code: string): NormalizedError {
  return {
    code,
    retryable: false,
    safe_detail: 'The recorded pipeline fixture rejected this request.'
  }
}

function providerConfigurationFailure(cause: unknown): Readonly<{
  code: string
  status: 409 | 422
}> {
  if (cause instanceof ProviderConfigurationError) {
    return {
      code: cause.code,
      status:
        cause.code === 'providers_already_configured' ||
        cause.code === 'session_active' ||
        cause.code === 'providers_not_configured'
          ? 409
          : 422
    }
  }
  return { code: 'invalid_provider_configuration', status: 422 }
}
