import type { BackendProfile } from '../../domain'
import type { BackendProfileReader } from '../ports/backend-profile-reader'
import type {
  RuntimeApplyRequest,
  RuntimeRollbackRequest,
  RuntimeSessionSnapshot,
  SessionId,
  SessionSnapshot
} from '@advx/contracts'
import type {
  RuntimeControlOperations,
  RuntimeSessionStartRequest
} from './runtime-control'
import type { TraceContext } from '../ports/observability'

export class BackendApplicationError extends Error {
  readonly name = 'BackendApplicationError'

  constructor(readonly code: 'runtime_control_unavailable') {
    super(code)
  }
}

export class BackendApplication {
  constructor(
    private readonly profileReader: BackendProfileReader,
    private readonly runtimeControl?: RuntimeControlOperations
  ) {}

  describeBackend(): BackendProfile {
    return this.profileReader.read()
  }

  currentSession(): SessionSnapshot {
    return this.#control().currentSession()
  }

  pauseSession(sessionId: SessionId, traceContext?: TraceContext): Promise<SessionSnapshot> {
    return this.#control().pauseSession(sessionId, traceContext)
  }

  resumeSession(sessionId: SessionId, traceContext?: TraceContext): Promise<SessionSnapshot> {
    return this.#control().resumeSession(sessionId, traceContext)
  }

  stopSession(sessionId: SessionId, traceContext?: TraceContext): Promise<SessionSnapshot> {
    return this.#control().stopSession(sessionId, traceContext)
  }

  startRuntimeSession(
    request: RuntimeSessionStartRequest,
    traceContext?: TraceContext
  ): Promise<RuntimeSessionSnapshot> {
    return this.#control().startRuntimeSession(request, traceContext)
  }

  currentRuntimeSession(sessionId: SessionId): Promise<RuntimeSessionSnapshot> {
    return this.#control().currentRuntimeSession(sessionId)
  }

  applyRuntimeSpec(
    sessionId: SessionId,
    request: RuntimeApplyRequest,
    traceContext?: TraceContext
  ): Promise<RuntimeSessionSnapshot> {
    return this.#control().applyRuntimeSpec(sessionId, request, traceContext)
  }

  rollbackRuntimeSpec(
    sessionId: SessionId,
    request: RuntimeRollbackRequest,
    traceContext?: TraceContext
  ): Promise<RuntimeSessionSnapshot> {
    return this.#control().rollbackRuntimeSpec(sessionId, request, traceContext)
  }

  recoverRuntimeSession(sessionId: SessionId, traceContext?: TraceContext): Promise<RuntimeSessionSnapshot> {
    return this.#control().recoverRuntimeSession(sessionId, traceContext)
  }

  #control(): RuntimeControlOperations {
    if (this.runtimeControl === undefined) {
      throw new BackendApplicationError('runtime_control_unavailable')
    }
    return this.runtimeControl
  }
}
