import {
  canonicalJson,
  canonicalRuntimeSpecSchema,
  canonicalSha256,
  type CanonicalRuntimeSpec,
  type Revision
} from '@advx/contracts'

import { summarizeRuntimeSpecDiff } from '../../domain/runtime-spec'
import type {
  ObservationWaveBoundary,
  RuntimeSpecApplyCommand,
  RuntimeSpecCapabilityGate,
  RuntimeSpecCommitToken,
  RuntimeSpecCoordinatorPort,
  RuntimeSpecRecord,
  RuntimeSpecRepository,
  RuntimeSpecRollbackCommand,
  RuntimeSpecWorkFence,
  TransactionBoundary
} from '../ports/repositories'
import type { WallClock } from '../ports/time'
import {
  RoomSessionLifecycle,
  type LifecycleCommandIdentity,
  type RuntimeReplacementReason
} from './room-session-lifecycle'

export type RuntimeSpecCoordinatorErrorCode =
  | 'invalid_runtime_spec'
  | 'invalid_runtime_reference'
  | 'wrong_room'
  | 'wrong_session'
  | 'stale_audience_epoch'
  | 'lifecycle_revision_conflict'
  | 'base_revision_conflict'
  | 'config_revision_must_advance'
  | 'apply_id_conflict'
  | 'apply_previously_rejected'
  | 'apply_already_pending'
  | 'rollback_target_not_committed'
  | 'capability_rejected'
  | 'pending_persistence_failed'
  | 'wave_boundary_failed'
  | 'old_work_cancellation_failed'
  | 'commit_failed'

export class RuntimeSpecCoordinatorError extends Error {
  readonly name = 'RuntimeSpecCoordinatorError'

  constructor(readonly code: RuntimeSpecCoordinatorErrorCode) {
    super(code)
  }
}

export type RuntimeSpecCoordinatorDependencies = Readonly<{
  wallClock: WallClock
  transactions: TransactionBoundary
  repository: RuntimeSpecRepository
  capabilityGate: RuntimeSpecCapabilityGate
  observationWaves: ObservationWaveBoundary
  lifecycle: RoomSessionLifecycle
  initial: RuntimeSpecRecord
}>

export class RuntimeSpecCoordinator implements RuntimeSpecCoordinatorPort {
  #active: RuntimeSpecRecord
  #commandTail: Promise<void> = Promise.resolve()

  constructor(private readonly dependencies: RuntimeSpecCoordinatorDependencies) {
    if (dependencies.initial.status !== 'committed') {
      throw new RuntimeSpecCoordinatorError('commit_failed')
    }
    this.#active = immutableRecord(dependencies.initial)
  }

  current(): RuntimeSpecRecord {
    return this.#active
  }

  apply(command: RuntimeSpecApplyCommand): Promise<RuntimeSpecRecord> {
    return this.#exclusive(async () => {
      const spec = validateCandidate(command.candidate)
      const canonicalSpecJson = canonicalJson(spec)
      const configHash = canonicalSha256(spec)
      const existing = await this.#byApplyId(command.applyId, command.traceContext)
      if (existing !== null) {
        this.#requireMatchingApplyIdentity(existing, command, 'apply', null)
        this.#requireMatchingApplyContent(existing, canonicalSpecJson)
        return this.#settleExisting(existing)
      }
      this.#requireIdentity(command)
      if (command.baseRevision !== this.#active.revision) {
        throw new RuntimeSpecCoordinatorError('base_revision_conflict')
      }
      if (spec.room.room_id !== command.roomId) {
        throw new RuntimeSpecCoordinatorError('wrong_room')
      }
      if (spec.config_revision <= this.#active.configRevision) {
        throw new RuntimeSpecCoordinatorError('config_revision_must_advance')
      }

      return await this.#stageAndCutover({
        command,
        operation: 'apply',
        rollbackTargetRevision: null,
        spec,
        canonicalSpecJson,
        configHash,
        reason: 'runtime_spec_applied'
      })
    })
  }

  rollback(command: RuntimeSpecRollbackCommand): Promise<RuntimeSpecRecord> {
    return this.#exclusive(async () => {
      const existing = await this.#byApplyId(command.applyId, command.traceContext)
      if (existing !== null) {
        this.#requireMatchingApplyIdentity(
          existing,
          command,
          'rollback',
          command.targetRevision
        )
      }

      const target = await this.dependencies.transactions.run(
        async (transaction) =>
          await this.dependencies.repository.getRevision(
            transaction,
            command.sessionId,
            command.targetRevision
          ),
        command.traceContext
      )
      if (
        target === null ||
        (target.status !== 'committed' && target.status !== 'rolled_back')
      ) {
        throw new RuntimeSpecCoordinatorError('rollback_target_not_committed')
      }
      if (existing !== null) {
        this.#requireMatchingApplyContent(existing, target.canonicalSpecJson)
        return this.#settleExisting(existing)
      }

      this.#requireIdentity(command)
      if (command.baseRevision !== this.#active.revision) {
        throw new RuntimeSpecCoordinatorError('base_revision_conflict')
      }

      return await this.#stageAndCutover({
        command,
        operation: 'rollback',
        rollbackTargetRevision: command.targetRevision,
        spec: target.spec,
        canonicalSpecJson: target.canonicalSpecJson,
        configHash: target.configHash,
        reason: 'runtime_spec_rolled_back',
        rolledBackRevision: this.#active.revision
      })
    })
  }

  acceptsWork(fence: RuntimeSpecWorkFence): boolean {
    const lifecycle = this.dependencies.lifecycle.snapshot
    if (lifecycle.sessionId === null) return false
    return (
      fence.roomId === this.#active.roomId &&
      fence.sessionId === this.#active.sessionId &&
      fence.audienceEpoch === this.#active.audienceEpoch &&
      fence.runtimeRevision === this.#active.revision &&
      this.dependencies.lifecycle.acceptsWork({
        roomId: fence.roomId,
        sessionId: fence.sessionId,
        audienceEpoch: fence.audienceEpoch,
        expectedRevision: lifecycle.revision
      })
    )
  }

  commitIfCurrent(fence: RuntimeSpecWorkFence, sideEffect: () => void): boolean {
    if (!this.acceptsWork(fence)) return false
    sideEffect()
    return true
  }

  async #stageAndCutover(input: {
    command: RuntimeSpecApplyCommand | RuntimeSpecRollbackCommand
    operation: 'apply' | 'rollback'
    rollbackTargetRevision: Revision | null
    spec: CanonicalRuntimeSpec
    canonicalSpecJson: string
    configHash: string
    reason: RuntimeReplacementReason
    rolledBackRevision?: Revision
  }): Promise<RuntimeSpecRecord> {
    let pending: RuntimeSpecRecord
    try {
      pending = await this.dependencies.transactions.run(async (transaction) => {
        const revision = await this.dependencies.repository.nextRevision(
          transaction,
          input.command.sessionId
        )
        const createdAt = this.dependencies.wallClock.now()
        const record = immutableRecord({
          sessionId: input.command.sessionId,
          roomId: input.command.roomId,
          revision,
          applyId: input.command.applyId,
          operation: input.operation,
          rollbackTargetRevision: input.rollbackTargetRevision,
          baseRevision: input.command.baseRevision,
          status: 'pending',
          configRevision: input.spec.config_revision,
          audienceEpoch: this.#active.audienceEpoch + 1,
          configHash: input.configHash,
          canonicalSpecJson: input.canonicalSpecJson,
          spec: input.spec,
          diffSummary: summarizeRuntimeSpecDiff(this.#active.spec, input.spec),
          createdAt,
          updatedAt: createdAt
        })
        await this.dependencies.repository.addPending(transaction, record)
        return record
      }, input.command.traceContext)
    } catch {
      throw new RuntimeSpecCoordinatorError('pending_persistence_failed')
    }

    try {
      await this.dependencies.capabilityGate.validate(input.spec)
    } catch {
      await this.#rejectBestEffort(pending)
      throw new RuntimeSpecCoordinatorError('capability_rejected')
    }

    try {
      return await this.dependencies.observationWaves.cutover(async () =>
        await this.dependencies.lifecycle.withRuntimeReplacement(
          this.#lifecycleIdentity(input.command),
          input.reason,
          async (lifecycleCommit) => {
            const committed = immutableRecord({
              ...pending,
              status: 'committed',
              audienceEpoch: lifecycleCommit.nextAudienceEpoch,
              updatedAt: this.dependencies.wallClock.now()
            })
            let repositoryCommit: RuntimeSpecCommitToken
            try {
              repositoryCommit = await this.dependencies.transactions.run(
                async (transaction) =>
                  await this.dependencies.repository.prepareCommit(
                    transaction,
                    committed,
                    this.#active.revision,
                    input.rolledBackRevision
                  ),
                input.command.traceContext
              )
            } catch {
              throw new RuntimeSpecCoordinatorError('commit_failed')
            }

            try {
              repositoryCommit.commit()
              lifecycleCommit.commit()
              this.#active = committed
            } catch {
              throw new RuntimeSpecCoordinatorError('commit_failed')
            }
            return committed
          }
        )
      )
    } catch (error) {
      await this.#rejectBestEffort(pending)
      if (error instanceof RuntimeSpecCoordinatorError) throw error
      if (isLifecycleCleanupFailure(error)) {
        throw new RuntimeSpecCoordinatorError('old_work_cancellation_failed')
      }
      throw new RuntimeSpecCoordinatorError('wave_boundary_failed')
    }
  }

  #requireIdentity(command: RuntimeSpecApplyCommand | RuntimeSpecRollbackCommand): void {
    const lifecycle = this.dependencies.lifecycle.snapshot
    if (command.roomId !== this.#active.roomId || command.roomId !== lifecycle.roomId) {
      throw new RuntimeSpecCoordinatorError('wrong_room')
    }
    if (
      command.sessionId !== this.#active.sessionId ||
      command.sessionId !== lifecycle.sessionId
    ) {
      throw new RuntimeSpecCoordinatorError('wrong_session')
    }
    if (
      command.audienceEpoch !== this.#active.audienceEpoch ||
      command.audienceEpoch !== lifecycle.audienceEpoch
    ) {
      throw new RuntimeSpecCoordinatorError('stale_audience_epoch')
    }
    if (command.lifecycleRevision !== lifecycle.revision) {
      throw new RuntimeSpecCoordinatorError('lifecycle_revision_conflict')
    }
  }

  #lifecycleIdentity(
    command: RuntimeSpecApplyCommand | RuntimeSpecRollbackCommand
  ): LifecycleCommandIdentity {
    return {
      roomId: command.roomId,
      sessionId: command.sessionId,
      audienceEpoch: command.audienceEpoch,
      expectedRevision: command.lifecycleRevision,
      ...(command.traceContext === undefined ? {} : { traceContext: command.traceContext })
    }
  }

  #byApplyId(applyId: string, traceContext?: import('../ports/observability').TraceContext): Promise<RuntimeSpecRecord | null> {
    return this.dependencies.transactions.run(
      async (transaction) =>
        await this.dependencies.repository.getByApplyId(
          transaction,
          this.#active.sessionId,
          applyId
        ),
      traceContext
    )
  }

  #requireMatchingApplyIdentity(
    existing: RuntimeSpecRecord,
    command: RuntimeSpecApplyCommand | RuntimeSpecRollbackCommand,
    operation: 'apply' | 'rollback',
    rollbackTargetRevision: Revision | null
  ): void {
    if (
      existing.roomId !== command.roomId ||
      existing.sessionId !== command.sessionId ||
      existing.operation !== operation ||
      existing.rollbackTargetRevision !== rollbackTargetRevision ||
      existing.baseRevision !== command.baseRevision
    ) {
      throw new RuntimeSpecCoordinatorError('apply_id_conflict')
    }
  }

  #requireMatchingApplyContent(
    existing: RuntimeSpecRecord,
    canonicalSpecJson: string
  ): void {
    if (existing.canonicalSpecJson !== canonicalSpecJson) {
      throw new RuntimeSpecCoordinatorError('apply_id_conflict')
    }
  }

  #settleExisting(existing: RuntimeSpecRecord): RuntimeSpecRecord {
    if (existing.status === 'rejected') {
      throw new RuntimeSpecCoordinatorError('apply_previously_rejected')
    }
    if (existing.status === 'pending') {
      throw new RuntimeSpecCoordinatorError('apply_already_pending')
    }
    return existing
  }

  async #rejectBestEffort(pending: RuntimeSpecRecord): Promise<void> {
    try {
      await this.dependencies.transactions.run(async (transaction) => {
        await this.dependencies.repository.rejectPending(
          transaction,
          pending.sessionId,
          pending.revision,
          this.dependencies.wallClock.now()
        )
      })
    } catch {
      // Rejection is recovery metadata; the unchanged active head stays authoritative.
    }
  }

  #exclusive<TResult>(work: () => Promise<TResult>): Promise<TResult> {
    const result = this.#commandTail.then(work, work)
    this.#commandTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

function validateCandidate(candidate: unknown): CanonicalRuntimeSpec {
  let spec: CanonicalRuntimeSpec
  try {
    spec = canonicalRuntimeSpecSchema.parse(candidate)
  } catch {
    throw new RuntimeSpecCoordinatorError('invalid_runtime_spec')
  }
  validateReferences(spec)
  return deepFreeze(spec)
}

function validateReferences(spec: CanonicalRuntimeSpec): void {
  const personaIds = new Set(spec.personas.map((persona) => persona.persona_id))
  const modeIds = new Set(spec.modes.map((mode) => mode.mode_id))
  if (!modeIds.has(spec.active_mode_id)) {
    throw new RuntimeSpecCoordinatorError('invalid_runtime_reference')
  }
  for (const mode of spec.modes) {
    for (const [personaId, count] of Object.entries(mode.persona_counts)) {
      const persona = spec.personas.find((item) => item.persona_id === personaId)
      if (!personaIds.has(personaId) || (count > 0 && persona?.enabled === false)) {
        throw new RuntimeSpecCoordinatorError('invalid_runtime_reference')
      }
    }
  }
}

function immutableRecord(record: RuntimeSpecRecord): RuntimeSpecRecord {
  return deepFreeze({ ...record })
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function isLifecycleCleanupFailure(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === 'task_scope_cleanup_failed'
  )
}
