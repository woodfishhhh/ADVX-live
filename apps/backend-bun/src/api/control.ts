import {
  ADVX_HTTP_PROTOCOL_VERSION,
  legacySessionSnapshotSchema,
  normalizedErrorSchema,
  runtimeApplyRequestSchema,
  runtimeRollbackRequestSchema,
  runtimeSessionSnapshotSchema,
  runtimeSessionStartRequestSchema,
  sessionPathParamsSchema,
  type InferSchema,
  type NormalizedError,
  type Schema,
  type SessionId
} from '@advx/contracts'
import { Elysia } from 'elysia'

import {
  BackendApplicationError,
  RoomSessionLifecycleError,
  RuntimeControlError,
  RuntimeSpecCoordinatorError,
  type BackendApplication
} from '../application'
import { traceContextFromRequest, type TraceContext } from '../application/ports/observability'

export type ControlApiOptions = {
  readonly authorize: (authorization: string | null) => boolean
  readonly onSessionStarted?: (sessionId: SessionId) => void | Promise<void>
  readonly onSessionStopped?: (sessionId: SessionId) => void | Promise<void>
  readonly backendStartId?: string
}

type ControlOperation =
  | 'legacy_current'
  | 'legacy_start'
  | 'legacy_pause'
  | 'legacy_resume'
  | 'legacy_stop'
  | 'runtime_start'
  | 'runtime_current'
  | 'runtime_apply'
  | 'runtime_rollback'
  | 'runtime_recover'

type ResponseSet = {
  status?: number | string
  headers: Record<string, string | number>
}

class RequestContractError extends Error {
  readonly name = 'RequestContractError'
}

export function createControlApi(
  application: BackendApplication,
  options: ControlApiOptions
) {
  const legacy = new Elysia({ name: 'advx-legacy-control-api' })
    .get('/sessions/current', ({ set }) =>
      execute(set, 'legacy_current', async () =>
        legacySessionSnapshotSchema.parse(application.currentSession())
      )
    )
    .post('/sessions', ({ set }) => {
      set.status = 409
      return normalizedError(
        'runtime_snapshot_required',
        false,
        'Start protocol v3 Sessions through /runtime/sessions.'
      )
    })
    .post('/sessions/:session_id/pause', ({ request, params, set }) =>
      execute(set, 'legacy_pause', async () => {
        const { session_id } = parsePath(params)
        return legacySessionSnapshotSchema.parse(
          await application.pauseSession(session_id, requestTrace(request, options))
        )
      })
    )
    .post('/sessions/:session_id/resume', ({ request, params, set }) =>
      execute(set, 'legacy_resume', async () => {
        const { session_id } = parsePath(params)
        return legacySessionSnapshotSchema.parse(
          await application.resumeSession(session_id, requestTrace(request, options))
        )
      })
    )
    .post('/sessions/:session_id/stop', ({ request, params, set }) =>
      execute(set, 'legacy_stop', async () => {
        const { session_id } = parsePath(params)
        const snapshot = legacySessionSnapshotSchema.parse(
          await application.stopSession(session_id, requestTrace(request, options))
        )
        await options.onSessionStopped?.(session_id)
        return snapshot
      })
    )

  const runtime = new Elysia({ name: 'advx-runtime-control-api' })
    .post('/runtime/sessions', ({ body, request: httpRequest, set }) =>
      execute(set, 'runtime_start', async () => {
        const request = parseBody(runtimeSessionStartRequestSchema, body)
        const response = await application.startRuntimeSession(
          request,
          requestTrace(httpRequest, options)
        )
        await options.onSessionStarted?.(response.session_id)
        set.status = 201
        return runtimeSessionSnapshotSchema.parse(response)
      })
    )
    .get('/runtime/sessions/:session_id', ({ params, set }) =>
      execute(set, 'runtime_current', async () => {
        const { session_id } = parsePath(params)
        return runtimeSessionSnapshotSchema.parse(
          await application.currentRuntimeSession(session_id)
        )
      })
    )
    .post('/runtime/sessions/:session_id/apply', ({ body, request: httpRequest, params, set }) =>
      execute(set, 'runtime_apply', async () => {
        const { session_id } = parsePath(params)
        const request = parseBody(runtimeApplyRequestSchema, body)
        return runtimeSessionSnapshotSchema.parse(
          await application.applyRuntimeSpec(
            session_id,
            request,
            requestTrace(httpRequest, options)
          )
        )
      })
    )
    .post('/runtime/sessions/:session_id/rollback', ({ body, request: httpRequest, params, set }) =>
      execute(set, 'runtime_rollback', async () => {
        const { session_id } = parsePath(params)
        const request = parseBody(runtimeRollbackRequestSchema, body)
        return runtimeSessionSnapshotSchema.parse(
          await application.rollbackRuntimeSpec(
            session_id,
            request,
            requestTrace(httpRequest, options)
          )
        )
      })
    )
    .post('/runtime/sessions/:session_id/recover', ({ request, params, set }) =>
      execute(set, 'runtime_recover', async () => {
        const { session_id } = parsePath(params)
        return runtimeSessionSnapshotSchema.parse(
          await application.recoverRuntimeSession(session_id, requestTrace(request, options))
        )
      })
    )

  return new Elysia({ name: 'advx-control-api' })
    .onRequest(({ request, set }) => {
      const path = new URL(request.url).pathname
      if (path.startsWith('/runtime/')) {
        return guardRequest(request, set, options, 'runtime')
      }
      if (path === '/sessions' || path.startsWith('/sessions/')) {
        return guardRequest(request, set, options, 'legacy')
      }
    })
    .onError(({ code, request, set }) => {
      if (code !== 'PARSE') return
      const operation = operationForRequest(request)
      if (operation === null) return
      const mapped = mapControlError(operation, new RequestContractError())
      set.status = mapped.status
      return normalizedError(mapped.code, mapped.retryable, mapped.safeDetail)
    })
    .use(legacy)
    .use(runtime)
}

function operationForRequest(request: Request): ControlOperation | null {
  const path = new URL(request.url).pathname
  if (request.method === 'POST' && path === '/runtime/sessions') {
    return 'runtime_start'
  }
  if (request.method === 'POST' && path.endsWith('/apply')) {
    return 'runtime_apply'
  }
  if (request.method === 'POST' && path.endsWith('/rollback')) {
    return 'runtime_rollback'
  }
  return null
}

function guardRequest(
  request: Request,
  set: ResponseSet,
  options: ControlApiOptions,
  protocol: 'legacy' | 'runtime'
): NormalizedError | undefined {
  const trace = requestTrace(request, options)
  set.headers['x-request-id'] = trace.correlation.requestId ?? crypto.randomUUID()
  set.headers['x-advx-trace-id'] = trace.traceId
  if (!options.authorize(request.headers.get('authorization'))) {
    set.status = 401
    set.headers['www-authenticate'] = 'Bearer'
    return normalizedError(
      'invalid_local_token',
      false,
      'A valid local bearer token is required.'
    )
  }

  const version = request.headers.get('x-advx-protocol-version')
  if (version === String(ADVX_HTTP_PROTOCOL_VERSION)) return undefined
  set.headers['x-advx-protocol-version'] = ADVX_HTTP_PROTOCOL_VERSION
  if (protocol === 'legacy') {
    set.status = 426
    return normalizedError(
      'protocol_version_mismatch',
      false,
      'The requested protocol version is not supported.'
    )
  }
  if (version === '1') {
    set.status = 409
    return normalizedError(
      'protocol_version_conflict',
      false,
      'Protocol v1 cannot be used with the Viewer runtime.'
    )
  }
  set.status = 422
  return normalizedError(
    'unsupported_protocol_version',
    false,
    'The requested runtime protocol version is not supported.'
  )
}

function requestTrace(request: Request, options: ControlApiOptions): TraceContext {
  return traceContextFromRequest(request, options.backendStartId ?? 'http')
}

async function execute<TResult>(
  set: ResponseSet,
  operation: ControlOperation,
  work: () => Promise<TResult>
): Promise<TResult | NormalizedError> {
  try {
    return await work()
  } catch (error) {
    const mapped = mapControlError(operation, error)
    set.status = mapped.status
    return normalizedError(mapped.code, mapped.retryable, mapped.safeDetail)
  }
}

function mapControlError(
  operation: ControlOperation,
  error: unknown
): {
  status: number
  code: string
  retryable: boolean
  safeDetail: string
} {
  if (error instanceof RequestContractError) {
    if (operation === 'runtime_start') return rejected(422, 'runtime_start_rejected')
    if (operation === 'runtime_apply') return rejected(422, 'runtime_apply_rejected')
    if (operation === 'runtime_rollback') {
      return rejected(422, 'runtime_rollback_rejected')
    }
    return notFound(operation)
  }

  if (error instanceof BackendApplicationError) return unavailable(operation)
  if (error instanceof RuntimeControlError) {
    if (error.code === 'runtime_session_not_found') return notFound(operation)
    if (error.code === 'client_request_conflict') {
      return rejected(409, 'client_request_conflict')
    }
    if (error.code === 'runtime_persistence_unavailable') {
      return unavailable(operation)
    }
    return rejected(
      error.code === 'runtime_recovery_rejected' ? 409 : 422,
      error.code
    )
  }

  if (error instanceof RoomSessionLifecycleError) {
    if (error.code === 'wrong_session' || error.code === 'wrong_room') {
      return notFound(operation)
    }
    if (error.code === 'start_identity_conflict' || error.code === 'session_already_started') {
      return rejected(409, 'client_request_conflict')
    }
    if (error.code === 'recovery_not_allowed') {
      return rejected(409, 'runtime_recovery_rejected')
    }
    if (
      error.code === 'publication_failed' ||
      error.code === 'resource_operation_failed' ||
      error.code === 'task_scope_cleanup_failed'
    ) {
      return unavailable(operation)
    }
    if (operation.startsWith('legacy_')) {
      return rejected(409, 'invalid_session_state')
    }
    return rejected(422, rejectionCode(operation))
  }

  if (error instanceof RuntimeSpecCoordinatorError) {
    if (error.code === 'wrong_session') {
      return notFound(operation)
    }
    if (error.code === 'wrong_room') {
      return operation === 'runtime_apply'
        ? rejected(422, 'runtime_apply_rejected')
        : notFound(operation)
    }
    if (error.code === 'apply_id_conflict') {
      return rejected(409, 'client_request_conflict')
    }
    if (
      error.code === 'pending_persistence_failed' ||
      error.code === 'wave_boundary_failed' ||
      error.code === 'old_work_cancellation_failed' ||
      error.code === 'commit_failed'
    ) {
      return unavailable(operation)
    }
    return rejected(422, rejectionCode(operation))
  }

  return unavailable(operation)
}

function rejectionCode(operation: ControlOperation): string {
  if (operation === 'runtime_start') return 'runtime_start_rejected'
  if (operation === 'runtime_apply') return 'runtime_apply_rejected'
  if (operation === 'runtime_rollback') return 'runtime_rollback_rejected'
  if (operation === 'runtime_recover') return 'runtime_recovery_rejected'
  return 'invalid_session_state'
}

function notFound(operation: ControlOperation) {
  return rejected(
    404,
    operation.startsWith('legacy_')
      ? 'session_not_found'
      : 'runtime_session_not_found'
  )
}

function unavailable(operation: ControlOperation) {
  return {
    ...rejected(
      503,
      operation.startsWith('legacy_')
        ? 'persistence_unavailable'
        : 'runtime_persistence_unavailable'
    ),
    retryable: true
  }
}

function rejected(status: number, code: string) {
  return {
    status,
    code,
    retryable: false,
    safeDetail: 'The control request could not be completed.'
  }
}

function parsePath(value: unknown): { session_id: SessionId } {
  return parseBody(sessionPathParamsSchema, value)
}

function parseBody<T>(contract: Schema<T>, value: unknown): T {
  const result = contract.safeParse(value)
  if (!result.success) {
    throw new RequestContractError()
  }
  return result.data
}

function normalizedError(
  code: string,
  retryable: boolean,
  safeDetail: string
): NormalizedError {
  return normalizedErrorSchema.parse({
    code,
    retryable,
    safe_detail: safeDetail
  })
}
