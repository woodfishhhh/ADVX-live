import {
  canonicalJson,
  canonicalSha256,
  legacySessionSnapshotSchema,
  runtimeSessionSnapshotSchema,
  type CanonicalRuntimeSpec,
  type InferSchema,
  type Revision,
  type RoomId,
  type RuntimeApplyRequest,
  type RuntimeRollbackRequest,
  type RuntimeSessionSnapshot,
  type SessionId,
  type SessionSnapshot
} from '@advx/contracts'
import { runtimeSessionStartRequestSchema } from '@advx/contracts'

import type { RuntimeSpecDiffSummary } from '../../domain/runtime-spec'
import type { RuntimeSpecRecord } from '../ports/repositories'
import type { TraceContext } from '../ports/observability'
import type { WallClock } from '../ports/time'
import {
  RoomSessionLifecycle,
  type LifecycleCommandIdentity
} from './room-session-lifecycle'
import { RuntimeSpecCoordinator } from './runtime-spec-coordinator'

export type RuntimeSessionStartRequest = InferSchema<
  typeof runtimeSessionStartRequestSchema
>

export type RuntimeControlKernel = Readonly<{
  lifecycle: RoomSessionLifecycle
  coordinator: RuntimeSpecCoordinator
  runtimeRevisionForConfigRevision(
    configRevision: Revision
  ): Promise<Revision | null>
  rollbackTargetRuntimeRevision(
    applyId: string,
    configRevision: Revision
  ): Promise<Revision | null>
}>

export interface RuntimeControlKernelFactory {
  createLifecycle(roomId: RoomId): RoomSessionLifecycle
  createKernel(input: Readonly<{
    lifecycle: RoomSessionLifecycle
    initial: RuntimeSpecRecord
  }>): Promise<RuntimeControlKernel>
  prepareRecovery(input: Readonly<{
    previous: RuntimeControlKernel
    recovered: RuntimeSpecRecord
  }>): Promise<RuntimeControlRecoveryCommit>
}

export type RuntimeControlRecoveryCommit = Readonly<{
  // Preparation owns every fallible operation; commit is synchronous and no-fail.
  commit(lifecycle: RoomSessionLifecycle): RuntimeControlKernel
  rollback(): Promise<void>
}>

export interface RuntimeControlOperations {
  currentSession(): SessionSnapshot
  pauseSession(sessionId: SessionId, traceContext?: TraceContext): Promise<SessionSnapshot>
  resumeSession(sessionId: SessionId, traceContext?: TraceContext): Promise<SessionSnapshot>
  stopSession(sessionId: SessionId, traceContext?: TraceContext): Promise<SessionSnapshot>
  startRuntimeSession(
    request: RuntimeSessionStartRequest,
    traceContext?: TraceContext
  ): Promise<RuntimeSessionSnapshot>
  currentRuntimeSession(sessionId: SessionId): Promise<RuntimeSessionSnapshot>
  applyRuntimeSpec(
    sessionId: SessionId,
    request: RuntimeApplyRequest,
    traceContext?: TraceContext
  ): Promise<RuntimeSessionSnapshot>
  rollbackRuntimeSpec(
    sessionId: SessionId,
    request: RuntimeRollbackRequest,
    traceContext?: TraceContext
  ): Promise<RuntimeSessionSnapshot>
  recoverRuntimeSession(sessionId: SessionId, traceContext?: TraceContext): Promise<RuntimeSessionSnapshot>
}

export type RuntimeControlErrorCode =
  | 'client_request_conflict'
  | 'runtime_session_not_found'
  | 'runtime_start_rejected'
  | 'runtime_apply_rejected'
  | 'runtime_rollback_rejected'
  | 'runtime_recovery_rejected'
  | 'runtime_persistence_unavailable'

export class RuntimeControlError extends Error {
  readonly name = 'RuntimeControlError'

  constructor(readonly code: RuntimeControlErrorCode) {
    super(code)
  }
}

type ManagedRuntime = {
  kernel: RuntimeControlKernel
  recovered: boolean
  hiddenLifecycleRevisions: number
}

type StartReceipt = Readonly<{
  requestFingerprint: string
  sessionId: SessionId
}>

export class RuntimeControlService implements RuntimeControlOperations {
  readonly #sessions = new Map<SessionId, ManagedRuntime>()
  readonly #startReceipts = new Map<string, StartReceipt>()
  #activeSessionId: SessionId | null = null
  #idleSnapshot: SessionSnapshot
  #startTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly dependencies: Readonly<{
      wallClock: WallClock
      kernels: RuntimeControlKernelFactory
    }>
  ) {
    this.#idleSnapshot = legacySessionSnapshotSchema.parse({
      session_id: null,
      state: 'idle',
      started_at_ms: null,
      updated_at_ms: Number(dependencies.wallClock.now()),
      revision: 0
    })
  }

  currentSession(): SessionSnapshot {
    const runtime = this.#activeSessionId === null
      ? null
      : this.#sessions.get(this.#activeSessionId) ?? null
    if (runtime === null) return this.#idleSnapshot
    return publicSessionSnapshot(
      runtime.kernel.lifecycle,
      runtime.kernel.lifecycle.snapshot,
      runtime.hiddenLifecycleRevisions
    )
  }

  async pauseSession(sessionId: SessionId, traceContext?: TraceContext): Promise<SessionSnapshot> {
    const runtime = this.#requireActiveSession(sessionId)
    return publicSessionSnapshot(
      runtime.kernel.lifecycle,
      await runtime.kernel.lifecycle.pause(lifecycleIdentity(runtime.kernel, traceContext)),
      runtime.hiddenLifecycleRevisions
    )
  }

  async resumeSession(sessionId: SessionId, traceContext?: TraceContext): Promise<SessionSnapshot> {
    const runtime = this.#requireActiveSession(sessionId)
    return publicSessionSnapshot(
      runtime.kernel.lifecycle,
      await runtime.kernel.lifecycle.resume(lifecycleIdentity(runtime.kernel, traceContext)),
      runtime.hiddenLifecycleRevisions
    )
  }

  async stopSession(sessionId: SessionId, traceContext?: TraceContext): Promise<SessionSnapshot> {
    const runtime = this.#requireActiveSession(sessionId)
    const snapshot = await runtime.kernel.lifecycle.stop(
      lifecycleIdentity(runtime.kernel, traceContext)
    )
    const response = publicSessionSnapshot(
      runtime.kernel.lifecycle,
      snapshot,
      runtime.hiddenLifecycleRevisions
    )
    this.#idleSnapshot = response
    this.#activeSessionId = null
    return response
  }

  startRuntimeSession(
    request: RuntimeSessionStartRequest,
    traceContext?: TraceContext
  ): Promise<RuntimeSessionSnapshot> {
    return this.#exclusiveStart(async () => {
      const prior = this.#startReceipts.get(request.client_request_id)
      if (prior !== undefined) {
        if (prior.requestFingerprint !== request.client_config_hash) {
          throw new RuntimeControlError('client_request_conflict')
        }
        return runtimeSnapshot(this.#requireSession(prior.sessionId))
      }

      if (this.#activeSessionId !== null) {
        throw new RuntimeControlError('client_request_conflict')
      }

      const roomId = request.canonical_runtime_spec.room.room_id
      const lifecycle = this.dependencies.kernels.createLifecycle(roomId)
      if (lifecycle.roomId !== roomId || lifecycle.snapshot.revision !== 0) {
        throw new RuntimeControlError('runtime_start_rejected')
      }

      const started = await lifecycle.start({
        roomId,
        clientStartId: request.client_request_id,
        requestFingerprint: request.client_config_hash,
        expectedRevision: 0,
        ...(traceContext === undefined ? {} : { traceContext })
      })
      if (started.sessionId === null) {
        throw new RuntimeControlError('runtime_start_rejected')
      }

      const now = this.dependencies.wallClock.now()
      const initial = bootstrapRecord(
        started.sessionId,
        roomId,
        request.client_request_id,
        request.canonical_runtime_spec,
        request.client_config_hash,
        started.audienceEpoch,
        now
      )

      let kernel: RuntimeControlKernel
      try {
        kernel = await this.dependencies.kernels.createKernel({
          lifecycle,
          initial
        })
      } catch {
        await lifecycle.stop(lifecycleIdentity({ lifecycle }, traceContext))
        throw new RuntimeControlError('runtime_persistence_unavailable')
      }
      if (
        kernel.lifecycle !== lifecycle ||
        kernel.coordinator.current().sessionId !== started.sessionId
      ) {
        await lifecycle.stop(lifecycleIdentity({ lifecycle }, traceContext))
        throw new RuntimeControlError('runtime_start_rejected')
      }

      const managed = { kernel, recovered: false, hiddenLifecycleRevisions: 0 }
      this.#sessions.set(started.sessionId, managed)
      this.#startReceipts.set(request.client_request_id, {
        requestFingerprint: request.client_config_hash,
        sessionId: started.sessionId
      })
      this.#activeSessionId = started.sessionId
      return runtimeSnapshot(managed)
    })
  }

  async currentRuntimeSession(
    sessionId: SessionId
  ): Promise<RuntimeSessionSnapshot> {
    return runtimeSnapshot(this.#requireSession(sessionId))
  }

  async applyRuntimeSpec(
    sessionId: SessionId,
    request: RuntimeApplyRequest,
    traceContext?: TraceContext
  ): Promise<RuntimeSessionSnapshot> {
    const runtime = this.#requireSession(sessionId)
    const baseRevision = await runtime.kernel.runtimeRevisionForConfigRevision(
      request.base_revision
    )
    if (baseRevision === null) {
      throw new RuntimeControlError('runtime_apply_rejected')
    }
    const lifecycleRevision = runtime.kernel.lifecycle.snapshot.revision
    await runtime.kernel.coordinator.apply({
      ...coordinatorIdentity(runtime.kernel, request.apply_id),
      baseRevision,
      candidate: request.canonical_runtime_spec,
      ...(traceContext === undefined ? {} : { traceContext })
    })
    runtime.hiddenLifecycleRevisions +=
      runtime.kernel.lifecycle.snapshot.revision - lifecycleRevision
    runtime.recovered = false
    return runtimeSnapshot(runtime)
  }

  async rollbackRuntimeSpec(
    sessionId: SessionId,
    request: RuntimeRollbackRequest,
    traceContext?: TraceContext
  ): Promise<RuntimeSessionSnapshot> {
    const runtime = this.#requireSession(sessionId)
    const baseRevision = await runtime.kernel.runtimeRevisionForConfigRevision(
      request.base_revision
    )
    if (baseRevision === null) {
      throw new RuntimeControlError('runtime_rollback_rejected')
    }
    const targetRevision = await runtime.kernel.rollbackTargetRuntimeRevision(
      request.apply_id,
      request.target_revision
    )
    if (targetRevision === null) {
      throw new RuntimeControlError('runtime_rollback_rejected')
    }
    const lifecycleRevision = runtime.kernel.lifecycle.snapshot.revision
    await runtime.kernel.coordinator.rollback({
      ...coordinatorIdentity(runtime.kernel, request.apply_id),
      baseRevision,
      targetRevision,
      ...(traceContext === undefined ? {} : { traceContext })
    })
    runtime.hiddenLifecycleRevisions +=
      runtime.kernel.lifecycle.snapshot.revision - lifecycleRevision
    runtime.recovered = false
    return runtimeSnapshot(runtime)
  }

  async recoverRuntimeSession(
    sessionId: SessionId,
    traceContext?: TraceContext
  ): Promise<RuntimeSessionSnapshot> {
    const runtime = this.#requireSession(sessionId)
    if (
      this.#activeSessionId !== null &&
      this.#activeSessionId !== sessionId
    ) {
      throw new RuntimeControlError('client_request_conflict')
    }
    const lifecycle = runtime.kernel.lifecycle
    const current = runtime.kernel.coordinator.current()
    const recoveredRecord = Object.freeze({
      ...current,
      audienceEpoch: current.audienceEpoch + 1,
      updatedAt: this.dependencies.wallClock.now()
    })

    let prepared: RuntimeControlRecoveryCommit
    try {
      prepared = await this.dependencies.kernels.prepareRecovery({
        previous: runtime.kernel,
        recovered: recoveredRecord
      })
    } catch {
      throw new RuntimeControlError('runtime_persistence_unavailable')
    }
    let recoveredLifecycle
    try {
      recoveredLifecycle = await lifecycle.recover(
        lifecycleIdentity(runtime.kernel, traceContext)
      )
    } catch (error) {
      await prepared.rollback().catch(() => {})
      throw error
    }
    if (recoveredLifecycle.audienceEpoch !== recoveredRecord.audienceEpoch) {
      await prepared.rollback().catch(() => {})
      throw new RuntimeControlError('runtime_recovery_rejected')
    }
    runtime.kernel = prepared.commit(lifecycle)
    runtime.recovered = true
    this.#activeSessionId = sessionId
    return runtimeSnapshot(runtime)
  }

  #requireSession(sessionId: SessionId): ManagedRuntime {
    const runtime = this.#sessions.get(sessionId)
    if (runtime === undefined) {
      throw new RuntimeControlError('runtime_session_not_found')
    }
    return runtime
  }

  #requireActiveSession(sessionId: SessionId): ManagedRuntime {
    if (this.#activeSessionId !== sessionId) {
      throw new RuntimeControlError('runtime_session_not_found')
    }
    return this.#requireSession(sessionId)
  }

  #exclusiveStart<TResult>(work: () => Promise<TResult>): Promise<TResult> {
    const result = this.#startTail.then(work, work)
    this.#startTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

function bootstrapRecord(
  sessionId: SessionId,
  roomId: RoomId,
  clientRequestId: string,
  spec: CanonicalRuntimeSpec,
  configHash: string,
  audienceEpoch: number,
  now: RuntimeSpecRecord['createdAt']
): RuntimeSpecRecord {
  if (canonicalSha256(spec) !== configHash) {
    throw new RuntimeControlError('runtime_start_rejected')
  }
  return Object.freeze({
    sessionId,
    roomId,
    revision: 1,
    applyId: `start:${clientRequestId}`,
    operation: 'bootstrap',
    rollbackTargetRevision: null,
    baseRevision: 0,
    status: 'committed',
    configRevision: spec.config_revision,
    audienceEpoch,
    configHash,
    canonicalSpecJson: canonicalJson(spec),
    spec,
    diffSummary: emptyDiff(),
    createdAt: now,
    updatedAt: now
  })
}

function lifecycleIdentity(input: {
  readonly lifecycle: RoomSessionLifecycle
}, traceContext?: TraceContext): LifecycleCommandIdentity {
  const snapshot = input.lifecycle.snapshot
  if (snapshot.sessionId === null) {
    throw new RuntimeControlError('runtime_session_not_found')
  }
  return {
    roomId: snapshot.roomId,
    sessionId: snapshot.sessionId,
    audienceEpoch: snapshot.audienceEpoch,
    expectedRevision: snapshot.revision,
    ...(traceContext === undefined ? {} : { traceContext })
  }
}

function coordinatorIdentity(
  kernel: RuntimeControlKernel,
  applyId: string
) {
  const lifecycle = lifecycleIdentity(kernel)
  return {
    roomId: lifecycle.roomId,
    sessionId: lifecycle.sessionId,
    audienceEpoch: lifecycle.audienceEpoch,
    lifecycleRevision: lifecycle.expectedRevision,
    applyId
  }
}

function runtimeSnapshot(runtime: ManagedRuntime): RuntimeSessionSnapshot {
  const record = runtime.kernel.coordinator.current()
  return runtimeSessionSnapshotSchema.parse({
    session_id: record.sessionId,
    room_id: record.roomId,
    audience_epoch: record.audienceEpoch,
    config_revision: record.configRevision,
    config_hash: record.configHash,
    canonical_runtime_spec: record.spec,
    apply_id: record.applyId,
    diff: {
      // Viewer reconciliation owns public response diffs in recorded parity evidence.
      // Phase 02 has no Viewer pool yet, so the control shell reports no Viewer
      // changes instead of leaking its internal runtime-spec section summary.
      changed_paths: []
    },
    recovered: runtime.recovered
  })
}

function publicSessionSnapshot(
  lifecycle: RoomSessionLifecycle,
  snapshot = lifecycle.snapshot,
  hiddenLifecycleRevisions = 0
): SessionSnapshot {
  const state = snapshot.state === 'stopped'
    ? 'idle'
    : snapshot.state === 'degraded' || snapshot.state === 'failed'
      ? 'error'
      : snapshot.state
  const idle = state === 'idle'
  return legacySessionSnapshotSchema.parse({
    session_id: idle ? null : snapshot.sessionId,
    state,
    started_at_ms: idle || snapshot.startedAt === null
      ? null
      : Number(snapshot.startedAt),
    updated_at_ms: Number(snapshot.updatedAt),
    revision: snapshot.revision - hiddenLifecycleRevisions
  })
}

function emptyDiff(): RuntimeSpecDiffSummary {
  return Object.freeze({
    changedSections: Object.freeze([]),
    personas: emptyIdentityDiff(),
    modes: emptyIdentityDiff(),
    providerChanged: false,
    settingsChanged: false
  })
}

function emptyIdentityDiff() {
  return Object.freeze({
    addedIds: Object.freeze([]),
    removedIds: Object.freeze([]),
    changedIds: Object.freeze([]),
    previousCount: 0,
    nextCount: 0
  })
}
