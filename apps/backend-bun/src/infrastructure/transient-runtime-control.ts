import {
  realtimeMessageRegistry,
  type Revision,
  type RoomId,
  type SessionId,
  type SessionSnapshot
} from '@advx/contracts'

import {
  RoomSessionLifecycle,
  RuntimeControlService,
  RuntimeSpecCoordinator,
  type RuntimeControlKernel,
  type RuntimeControlKernelFactory,
  type RuntimeControlRecoveryCommit
} from '../application'
import {
  transactionContext,
  wallClockTimestampMs,
  type ApplicationEvent,
  type EventPublisher,
  type RealtimePublisher,
  type RuntimeSpecCommitToken,
  type RuntimeSpecRecord,
  type RuntimeSpecRepository,
  type CancellationReason,
  type ScopedTask,
  type TaskExecutionContext,
  type TaskHandle,
  type TaskScope,
  type WallClock
} from '../application/ports'

/**
 * Process-local control composition used until Phase 03 supplies durable ports.
 * It deliberately owns no database or filesystem state.
 */
export function createTransientRuntimeControl(events: EventPublisher) {
  const wallClock: WallClock = {
    now: () => wallClockTimestampMs(Date.now())
  }
  return new RuntimeControlService({
    wallClock,
    kernels: new TransientRuntimeControlKernelFactory(wallClock, events)
  })
}

export class RealtimeSessionEventBridge implements EventPublisher {
  #publisher: RealtimePublisher | null = null
  readonly #sessionRevisions = new Map<string, number>()

  attach(publisher: RealtimePublisher): void {
    if (this.#publisher !== null && this.#publisher !== publisher) {
      throw new Error('Realtime Session event bridge is already attached')
    }
    this.#publisher = publisher
  }

  async publish(event: ApplicationEvent): Promise<void> {
    if (event.type !== 'room.session.snapshot') return
    if (this.#publisher === null) {
      throw new Error('Realtime Session event bridge is not attached')
    }

    const payload = event.payload as Record<string, unknown>
    const sessionId = String(payload.session_id)
    const revision = (this.#sessionRevisions.get(sessionId) ?? 0) + 1
    this.#sessionRevisions.set(sessionId, revision)
    const session = publicSessionSnapshot(payload, revision)
    const envelope = realtimeMessageRegistry['session.status'].schema.parse({
      protocol_version: 4,
      message_type: 'session.status',
      message_id: event.eventId,
      ...(session.session_id === null
        ? {}
        : { session_id: session.session_id }),
      created_at_ms: Number(event.occurredAt),
      ...(event.traceContext === undefined
        ? {}
        : { trace_id: event.traceContext.traceId }),
      payload: { session }
    })
    await this.#publisher.publish(envelope)
    if (session.state === 'idle') this.#sessionRevisions.delete(sessionId)
  }
}

class TransientRuntimeControlKernelFactory implements RuntimeControlKernelFactory {
  readonly #repositories = new Map<SessionId, TransientRuntimeSpecRepository>()
  #transactionSequence = 0

  constructor(
    private readonly wallClock: WallClock,
    private readonly events: EventPublisher
  ) {}

  createLifecycle(roomId: RoomId): RoomSessionLifecycle {
    return new RoomSessionLifecycle({
      wallClock: this.wallClock,
      roomIds: { nextId: () => roomId },
      sessionIds: { nextId: () => crypto.randomUUID() as SessionId },
      eventIds: { nextId: () => crypto.randomUUID() },
      createTaskScope: createTransientTaskScope,
      events: this.events,
      resources: {
        start: async () => {},
        pause: async () => {},
        resume: async () => {},
        recover: async () => {},
        release: async () => {}
      }
    })
  }

  async createKernel(input: {
    lifecycle: RoomSessionLifecycle
    initial: RuntimeSpecRecord
  }): Promise<RuntimeControlKernel> {
    const repository = new TransientRuntimeSpecRepository(input.initial)
    this.#repositories.set(input.initial.sessionId, repository)
    return this.#kernel(input.lifecycle, repository, input.initial)
  }

  async prepareRecovery(input: {
    previous: RuntimeControlKernel
    recovered: RuntimeSpecRecord
  }): Promise<RuntimeControlRecoveryCommit> {
    const repository = this.#repositories.get(input.recovered.sessionId)
    if (repository === undefined) {
      throw new Error('Transient runtime repository is unavailable')
    }
    return {
      commit: (lifecycle) => {
        repository.recover(input.recovered)
        return this.#kernel(lifecycle, repository, input.recovered)
      },
      rollback: async () => {}
    }
  }

  #kernel(
    lifecycle: RoomSessionLifecycle,
    repository: TransientRuntimeSpecRepository,
    initial: RuntimeSpecRecord
  ): RuntimeControlKernel {
    const coordinator = new RuntimeSpecCoordinator({
      wallClock: this.wallClock,
      lifecycle,
      repository,
      initial,
      transactions: {
        run: async (work, traceContext) =>
          await work(transactionContext(
            `transient-runtime-${++this.#transactionSequence}`,
            traceContext
          ))
      },
      capabilityGate: { validate: async () => {} },
      observationWaves: { cutover: async (work) => await work() }
    })
    return {
      lifecycle,
      coordinator,
      runtimeRevisionForConfigRevision: async (revision) =>
        repository.runtimeRevision(revision),
      rollbackTargetRuntimeRevision: async (applyId, revision) =>
        repository.rollbackTargetRevision(applyId, revision)
    }
  }
}

class TransientRuntimeSpecRepository implements RuntimeSpecRepository {
  readonly #records: RuntimeSpecRecord[]
  #active: RuntimeSpecRecord

  constructor(initial: RuntimeSpecRecord) {
    this.#records = [initial]
    this.#active = initial
  }

  async getActive(_transaction: unknown, _sessionId: SessionId) {
    return this.#active
  }

  async getRevision(
    _transaction: unknown,
    _sessionId: SessionId,
    revision: Revision
  ) {
    return this.#records.find((record) => record.revision === revision) ?? null
  }

  async getByApplyId(
    _transaction: unknown,
    _sessionId: SessionId,
    applyId: string
  ) {
    return this.#records.find((record) => record.applyId === applyId) ?? null
  }

  async nextRevision(_transaction: unknown, _sessionId: SessionId) {
    return Math.max(...this.#records.map((record) => record.revision)) + 1
  }

  async addPending(_transaction: unknown, record: RuntimeSpecRecord) {
    this.#records.push(record)
  }

  async rejectPending(
    _transaction: unknown,
    _sessionId: SessionId,
    revision: Revision,
    updatedAt: RuntimeSpecRecord['updatedAt']
  ) {
    const record = this.#records.find((candidate) => candidate.revision === revision)
    if (record?.status === 'pending') {
      this.#replace(record, { ...record, status: 'rejected', updatedAt })
    }
  }

  async prepareCommit(
    _transaction: unknown,
    record: RuntimeSpecRecord,
    expectedActiveRevision: Revision,
    rolledBackRevision?: Revision
  ): Promise<RuntimeSpecCommitToken> {
    if (this.#active.revision !== expectedActiveRevision) {
      throw new Error('Transient runtime head changed before commit')
    }
    return {
      record,
      commit: () => {
        const pending = this.#records.find(
          (candidate) => candidate.revision === record.revision
        )
        if (pending === undefined) {
          throw new Error('Transient pending runtime revision is unavailable')
        }
        this.#replace(pending, record)
        if (rolledBackRevision !== undefined) {
          const rolledBack = this.#records.find(
            (candidate) => candidate.revision === rolledBackRevision
          )
          if (rolledBack !== undefined) {
            this.#replace(rolledBack, { ...rolledBack, status: 'rolled_back' })
          }
        }
        this.#active = record
      }
    }
  }

  runtimeRevision(configRevision: Revision): Revision | null {
    if (this.#active.configRevision === configRevision) {
      return this.#active.revision
    }
    return this.#records
      .filter(
        (record) =>
          record.configRevision === configRevision &&
          (record.status === 'committed' || record.status === 'rolled_back')
      )
      .sort((left, right) => right.revision - left.revision)[0]?.revision ?? null
  }

  rollbackTargetRevision(
    applyId: string,
    configRevision: Revision
  ): Revision | null {
    const existing = this.#records.find((record) => record.applyId === applyId)
    if (
      existing?.operation === 'rollback' &&
      existing.rollbackTargetRevision !== null
    ) {
      const target = this.#records.find(
        (record) => record.revision === existing.rollbackTargetRevision
      )
      if (target?.configRevision === configRevision) {
        return existing.rollbackTargetRevision
      }
    }
    return this.runtimeRevision(configRevision)
  }

  recover(record: RuntimeSpecRecord): void {
    this.#replace(this.#active, record)
    this.#active = record
  }

  #replace(previous: RuntimeSpecRecord, next: RuntimeSpecRecord): void {
    const index = this.#records.indexOf(previous)
    if (index < 0) throw new Error('Transient runtime revision is unavailable')
    this.#records[index] = next
  }
}

export function createTransientTaskScope(): TaskScope {
  const tasks = new Map<string, ActiveTransientTask>()
  let nextTaskId = 0

  const scope: TaskScope = {
    spawn<TResult>(task: ScopedTask<TResult>): TaskHandle<TResult> {
      if (task.name.trim().length === 0) {
        throw new RangeError('transient task name must not be empty')
      }
      const taskId = `transient-task-${++nextTaskId}`
      const controller = new AbortController()
      let cancellationReason: CancellationReason | undefined
      let settled = false
      const context: TaskExecutionContext = {
        signal: controller.signal,
        ...(task.deadline === undefined ? {} : { deadline: task.deadline }),
        reason: () => cancellationReason,
        throwIfCancelled: () => {
          if (cancellationReason !== undefined) {
            throw new Error(cancellationReason.code)
          }
          if (controller.signal.aborted) {
            throw new Error('task_cancelled')
          }
        }
      }
      const active: ActiveTransientTask = {
        cancel(reason) {
          if (settled || controller.signal.aborted) return
          cancellationReason = reason
          controller.abort(reason)
        },
        result: Promise.resolve()
          .then(() => task.run(context))
          .finally(() => {
            settled = true
            tasks.delete(taskId)
          })
      }
      tasks.set(taskId, active)
      return Object.freeze({
        taskId,
        result: active.result as Promise<TResult>,
        cancel: active.cancel
      })
    },
    cancelAll(reason: CancellationReason): void {
      for (const task of tasks.values()) task.cancel(reason)
    },
    async drain(): Promise<void> {
      await Promise.allSettled([...tasks.values()].map((task) => task.result))
    }
  }
  return scope
}

type ActiveTransientTask = {
  readonly result: Promise<unknown>
  readonly cancel: (reason: CancellationReason) => void
}

function publicSessionSnapshot(
  payload: Record<string, unknown>,
  revision: number
): SessionSnapshot {
  const internalState = String(payload.state)
  const state = internalState === 'stopped'
    ? 'idle'
    : internalState === 'degraded' || internalState === 'failed'
      ? 'error'
      : internalState
  const idle = state === 'idle'
  return {
    session_id: idle ? null : String(payload.session_id),
    state: state as SessionSnapshot['state'],
    started_at_ms: idle || payload.started_at_ms === null
      ? null
      : Number(payload.started_at_ms),
    updated_at_ms: Number(payload.updated_at_ms),
    revision
  }
}
