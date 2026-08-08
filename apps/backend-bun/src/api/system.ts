import {
  ADVX_HTTP_PROTOCOL_VERSION,
  ADVX_REALTIME_PROTOCOL_VERSION,
  ADVX_SCHEMA_PACKAGE_VERSION,
  type NormalizedError
} from '@advx/contracts'
import { Elysia } from 'elysia'
import { traceContextFromRequest } from '../application/ports/observability'

export type ReadinessChecks = {
  readonly contract: boolean
  readonly database: boolean
  readonly runtime: boolean
}

export type HealthResponse = {
  readonly status: 'ok' | 'degraded'
  readonly protocol_version: typeof ADVX_HTTP_PROTOCOL_VERSION
  readonly persistence_error?: Readonly<Record<string, string>> | null
}

export type HealthProbeResult = Readonly<{
  readonly status: 'ok' | 'degraded'
  readonly persistenceError?: Readonly<Record<string, string>> | null
}>

export type ReadinessResponse = {
  readonly status: 'ready' | 'not_ready'
  readonly protocol_version: typeof ADVX_HTTP_PROTOCOL_VERSION
  readonly checks: ReadinessChecks
}

export type VersionResponse = {
  readonly backend_version: string
  readonly http_protocol_version: typeof ADVX_HTTP_PROTOCOL_VERSION
  readonly realtime_protocol_version: typeof ADVX_REALTIME_PROTOCOL_VERSION
  readonly schema_package_version: typeof ADVX_SCHEMA_PACKAGE_VERSION
  readonly build_id: string
}

export type SystemApiOptions = {
  readonly authorize: (authorization: string | null) => boolean
  readonly health?: () => HealthProbeResult | Promise<HealthProbeResult>
  readonly readiness: () => ReadinessChecks | Promise<ReadinessChecks>
  readonly backendVersion: string
  readonly buildId: string
  readonly backendStartId?: string
}

const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/

export function createSystemApi(options: SystemApiOptions) {
  return new Elysia({ name: 'advx-system-api' })
    .get('/health', async ({ request, set }) => {
      setTraceHeaders(request, set.headers, options.backendStartId)
      if (!options.authorize(request.headers.get('authorization'))) {
        set.status = 401
        set.headers['www-authenticate'] = 'Bearer'
        return invalidTokenError()
      }

      try {
        const probe = await options.health?.() ?? { status: 'ok' as const }
        return normalizeHealthResponse(probe)
      } catch {
        set.status = 503
        return {
          code: 'health_probe_unavailable',
          retryable: true,
          safe_detail: 'Backend health is temporarily unavailable.'
        } satisfies NormalizedError
      }
    })
    .get('/ready', async ({ request, set }) => {
      setTraceHeaders(request, set.headers, options.backendStartId)
      if (!options.authorize(request.headers.get('authorization'))) {
        set.status = 401
        set.headers['www-authenticate'] = 'Bearer'
        return invalidTokenError()
      }

      let checks: ReadinessChecks
      try {
        const result = await options.readiness()
        checks = {
          contract: result.contract === true,
          database: result.database === true,
          runtime: result.runtime === true
        }
      } catch {
        checks = { contract: false, database: false, runtime: false }
      }
      const ready = checks.contract && checks.database && checks.runtime
      if (!ready) set.status = 503
      return {
        status: ready ? 'ready' : 'not_ready',
        protocol_version: ADVX_HTTP_PROTOCOL_VERSION,
        checks
      } satisfies ReadinessResponse
    })
    .get('/version', ({ request, set }) => {
      setTraceHeaders(request, set.headers, options.backendStartId)
      if (!options.authorize(request.headers.get('authorization'))) {
        set.status = 401
        set.headers['www-authenticate'] = 'Bearer'
        return invalidTokenError()
      }

      return {
        backend_version: options.backendVersion,
        http_protocol_version: ADVX_HTTP_PROTOCOL_VERSION,
        realtime_protocol_version: ADVX_REALTIME_PROTOCOL_VERSION,
        schema_package_version: ADVX_SCHEMA_PACKAGE_VERSION,
        build_id: options.buildId
      } satisfies VersionResponse
    })
}

function normalizeHealthResponse(probe: HealthProbeResult): HealthResponse {
  if (probe.status === 'ok') {
    return {
      status: 'ok',
      protocol_version: ADVX_HTTP_PROTOCOL_VERSION
    }
  }
  const source = probe.persistenceError
  if (source === null || source === undefined || typeof source.code !== 'string') {
    throw new TypeError('degraded health requires a persistence error code')
  }
  const entries = Object.entries(source)
  if (entries.length === 0 || entries.length > 32) {
    throw new TypeError('persistence health detail is invalid')
  }
  const persistenceError: Record<string, string> = {}
  for (const [key, value] of entries) {
    if (
      key.length === 0 ||
      key.length > 128 ||
      typeof value !== 'string' ||
      value.length > 1_024
    ) {
      throw new TypeError('persistence health detail is invalid')
    }
    persistenceError[key] = value
  }
  return {
    status: 'degraded',
    protocol_version: ADVX_HTTP_PROTOCOL_VERSION,
    persistence_error: Object.freeze(persistenceError)
  }
}

function setTraceHeaders(
  request: Request,
  headers: Record<string, string | number>,
  backendStartId = 'http'
) {
  const trace = traceContextFromRequest(request, backendStartId)
  const requestId = trace.correlation.requestId
  headers['x-request-id'] =
    requestId !== undefined && requestIdPattern.test(requestId)
      ? requestId
      : crypto.randomUUID()
  headers['x-advx-trace-id'] = trace.traceId
  return trace
}

function invalidTokenError(): NormalizedError {
  return {
    code: 'invalid_local_token',
    retryable: false,
    safe_detail: 'A valid local bearer token is required.'
  }
}
