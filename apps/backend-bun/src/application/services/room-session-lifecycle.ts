import type { Epoch, Revision, RoomId, SessionId } from '@advx/contracts'

import {
  immutableRoomSessionSnapshot,
  type RoomSessionLifecycleReason,
  type RoomSessionLifecycleState,
  type RoomSessionSnapshot
} from '../../domain/room-session-lifecycle'
import type { EventPublisher } from '../ports/events'
import type { IdGenerator } from '../ports/ids'
import type {
  SessionResourceIdentity,
  SessionResources
} from '../ports/session-resources'
import type { TaskScope } from '../ports/tasks'
import type { TraceContext } from '../ports/observability'
import { wallClockTimestampMs, type WallClock } from '../ports/time'

export type LifecycleCommandIdentity = Readonly<{
  roomId: RoomId
  sessionId: SessionId
  audienceEpoch: Epoch
  expectedRevision: Revision
  traceContext?: TraceContext
}>

export type StartSessionCommand = Readonly<{
  roomId: RoomId
  clientStartId: string
  requestFingerprint: string
  expectedRevision: Revision
  traceContext?: TraceContext
}>

export type MarkFailedCommand = LifecycleCommandIdentity &
  Readonly<{ recoveryEligible: boolean }>

export type RuntimeReplacementReason =
  | 'runtime_spec_applied'
  | 'runtime_spec_rolled_back'

export type RuntimeReplacementCommit = Readonly<{
  nextAudienceEpoch: Epoch
  commit(): RoomSessionSnapshot
}>

export type RoomSessionLifecycleErrorCode =
  | 'wrong_room'
  | 'wrong_session'
  | 'stale_audience_epoch'
  | 'revision_conflict'
  | 'illegal_transition'
  | 'start_identity_conflict'
  | 'session_already_started'
  | 'recovery_not_allowed'
  | 'publication_failed'
  | 'resource_operation_failed'
  | 'task_scope_cleanup_failed'

export class RoomSessionLifecycleError extends Error {
  readonly name = 'RoomSessionLifecycleError'

  constructor(readonly code: RoomSessionLifecycleErrorCode) {
    super(code)
  }
}

export type RoomSessionLifecycleDependencies = Readonly<{
  wallClock: WallClock
  roomIds: IdGenerator<RoomId>
  sessionIds: IdGenerator<SessionId>
  eventIds: IdGenerator<string>
  createTaskScope: () => TaskScope
  events: EventPublisher
  resources: SessionResources
}>

type StartReceipt = Readonly<{
  clientStartId: string
  requestFingerprint: string
}>

const RECOVERABLE_STATES = new Set<RoomSessionLifecycleState>([
  'degraded',
  'failed'
])

export class RoomSessionLifecycle {
  readonly roomId: RoomId

  #snapshot: RoomSessionSnapshot
  #startReceipt: StartReceipt | null = null
  #taskScope: TaskScope | null = null
  #releasePromise: Promise<void> | null = null
  #commandTail: Promise<void> = Promise.resolve()

  constructor(
    private readonly dependencies: RoomSessionLifecycleDependencies,
    recoverySnapshot?: RoomSessionSnapshot
  ) {
    if (recoverySnapshot !== undefined) {
      if (
        !RECOVERABLE_STATES.has(recoverySnapshot.state) ||
        !recoverySnapshot.recoveryEligible ||
        recoverySnapshot.sessionId === null
      ) {
        throw new RoomSessionLifecycleError('recovery_not_allowed')
      }
      this.roomId = recoverySnapshot.roomId
      this.#snapshot = immutableRoomSessionSnapshot(recoverySnapshot)
      return
    }

    this.roomId = dependencies.roomIds.nextId()
    const now = dependencies.wallClock.now()
    this.#snapshot = immutableRoomSessionSnapshot({
      roomId: this.roomId,
      sessionId: null,
      audienceEpoch: 1,
      revision: 0,
      state: 'idle',
      recoveryEligible: false,
      reasonCode: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      endedAt: null
    })
  }

  get snapshot(): RoomSessionSnapshot {
    return this.#snapshot
  }

  start(command: StartSessionCommand): Promise<RoomSessionSnapshot> {
    return this.#exclusive(async () => {
      this.#requireRoom(command.roomId)
      if (this.#startReceipt?.clientStartId === command.clientStartId) {
        if (this.#startReceipt.requestFingerprint !== command.requestFingerprint) {
          throw new RoomSessionLifecycleError('start_identity_conflict')
        }
        return this.#snapshot
      }
      if (this.#startReceipt !== null || this.#snapshot.state !== 'idle') {
        throw new RoomSessionLifecycleError('session_already_started')
      }
      this.#requireRevision(command.expectedRevision)

      const sessionId = this.dependencies.sessionIds.nextId()
      this.#taskScope = this.dependencies.createTaskScope()
      const startedAt = this.dependencies.wallClock.now()
      const starting = this.#transition('starting', 'start_requested', {
        sessionId,
        recoveryEligible: true,
        startedAt
      })
      this.#startReceipt = {
        clientStartId: command.clientStartId,
        requestFingerprint: command.requestFingerprint
      }
      await this.#publish(starting, command.traceContext)

      try {
        await this.dependencies.resources.start(this.#resourceIdentity())
      } catch {
        const failed = this.#transition('failed', 'resource_operation_failed', {
          recoveryEligible: true
        })
        await this.#publish(failed, command.traceContext)
        throw new RoomSessionLifecycleError('resource_operation_failed')
      }

      const running = this.#transition('running', 'start_completed', {
        recoveryEligible: false
      })
      await this.#publish(running, command.traceContext)
      return running
    })
  }

  pause(command: LifecycleCommandIdentity): Promise<RoomSessionSnapshot> {
    return this.#exclusive(async () => {
      this.#requireCommand(command)
      this.#requireState('running')
      await this.#resourceCall('pause')
      const paused = this.#transition('paused', 'pause_requested')
      await this.#publish(paused, command.traceContext)
      return paused
    })
  }

  resume(command: LifecycleCommandIdentity): Promise<RoomSessionSnapshot> {
    return this.#exclusive(async () => {
      this.#requireCommand(command)
      this.#requireState('paused')
      await this.#resourceCall('resume')
      const running = this.#transition('running', 'resume_requested')
      await this.#publish(running, command.traceContext)
      return running
    })
  }

  degrade(command: LifecycleCommandIdentity): Promise<RoomSessionSnapshot> {
    return this.#exclusive(async () => {
      this.#requireCommand(command)
      if (this.#snapshot.state !== 'running' && this.#snapshot.state !== 'paused') {
        throw new RoomSessionLifecycleError('illegal_transition')
      }
      const degraded = this.#transition('degraded', 'runtime_degraded', {
        recoveryEligible: true
      })
      await this.#publish(degraded, command.traceContext)
      return degraded
    })
  }

  fail(command: MarkFailedCommand): Promise<RoomSessionSnapshot> {
    return this.#exclusive(async () => {
      this.#requireCommand(command)
      if (
        this.#snapshot.state !== 'starting' &&
        this.#snapshot.state !== 'running' &&
        this.#snapshot.state !== 'paused' &&
        this.#snapshot.state !== 'degraded'
      ) {
        throw new RoomSessionLifecycleError('illegal_transition')
      }
      const failed = this.#transition('failed', 'runtime_failed', {
        recoveryEligible: command.recoveryEligible
      })
      await this.#publish(failed, command.traceContext)
      return failed
    })
  }

  recover(command: LifecycleCommandIdentity): Promise<RoomSessionSnapshot> {
    return this.#exclusive(async () => {
      this.#requireCommand(command)
      if (
        !RECOVERABLE_STATES.has(this.#snapshot.state) ||
        !this.#snapshot.recoveryEligible
      ) {
        throw new RoomSessionLifecycleError('recovery_not_allowed')
      }

      const starting = this.#transition('starting', 'recovery_requested', {
        audienceEpoch: this.#snapshot.audienceEpoch + 1,
        recoveryEligible: true
      })
      await this.#publish(starting, command.traceContext)
      await this.#resetOwnedWork('runtime_replaced')

      try {
        await this.dependencies.resources.recover(this.#resourceIdentity())
      } catch {
        const failed = this.#transition('failed', 'resource_operation_failed', {
          recoveryEligible: true
        })
        await this.#publish(failed, command.traceContext)
        throw new RoomSessionLifecycleError('resource_operation_failed')
      }

      this.#taskScope = this.dependencies.createTaskScope()
      const running = this.#transition('running', 'recovery_completed', {
        recoveryEligible: false
      })
      await this.#publish(running, command.traceContext)
      return running
    })
  }

  stop(command: LifecycleCommandIdentity): Promise<RoomSessionSnapshot> {
    return this.#exclusive(async () => {
      this.#requireRoom(command.roomId)
      this.#requireSession(command.sessionId)
      this.#requireEpoch(command.audienceEpoch)
      if (this.#snapshot.state === 'stopped') return this.#snapshot
      this.#requireRevision(command.expectedRevision)
      if (
        this.#snapshot.state !== 'starting' &&
        this.#snapshot.state !== 'running' &&
        this.#snapshot.state !== 'paused' &&
        this.#snapshot.state !== 'degraded' &&
        this.#snapshot.state !== 'failed'
      ) {
        throw new RoomSessionLifecycleError('illegal_transition')
      }

      let failure: RoomSessionLifecycleError | null = null
      const stopping = this.#transition('stopping', 'stop_requested', {
        recoveryEligible: false
      })
      try {
        await this.#publish(stopping, command.traceContext)
      } catch (error) {
        failure = this.#safeError(error, 'publication_failed')
      }
      try {
        await this.#resetOwnedWork('session_stopped')
      } catch (error) {
        failure ??= this.#safeError(error, 'task_scope_cleanup_failed')
      }
      try {
        await this.#releaseResourcesOnce()
      } catch (error) {
        failure ??= this.#safeError(error, 'resource_operation_failed')
      }

      const stopped = this.#transition('stopped', 'stop_completed', {
        recoveryEligible: false,
        endedAt: this.dependencies.wallClock.now()
      })
      try {
        await this.#publish(stopped, command.traceContext)
      } catch (error) {
        failure ??= this.#safeError(error, 'publication_failed')
      }
      if (failure !== null) throw failure
      return stopped
    })
  }

  withRuntimeReplacement<TResult>(
    command: LifecycleCommandIdentity,
    reason: RuntimeReplacementReason,
    work: (commit: RuntimeReplacementCommit) => Promise<TResult>
  ): Promise<TResult> {
    return this.#exclusive(async () => {
      this.#requireCommand(command)
      if (
        this.#snapshot.state !== 'running' &&
        this.#snapshot.state !== 'paused' &&
        this.#snapshot.state !== 'degraded'
      ) {
        throw new RoomSessionLifecycleError('illegal_transition')
      }

      await this.#resetOwnedWork('runtime_replaced')
      const replacementScope = this.dependencies.createTaskScope()
      let committed = false
      const nextAudienceEpoch = this.#snapshot.audienceEpoch + 1
      const nextSnapshot = this.#buildTransition(this.#snapshot.state, reason, {
        audienceEpoch: nextAudienceEpoch
      })
      const token: RuntimeReplacementCommit = Object.freeze({
        nextAudienceEpoch,
        commit: () => {
          if (committed) return this.#snapshot
          committed = true
          this.#taskScope = replacementScope
          this.#snapshot = nextSnapshot
          return nextSnapshot
        }
      })

      try {
        return await work(token)
      } finally {
        if (!committed && this.#taskScope === null) {
          this.#taskScope = replacementScope
        }
      }
    })
  }

  acceptsWork(command: LifecycleCommandIdentity): boolean {
    return (
      command.roomId === this.#snapshot.roomId &&
      command.sessionId === this.#snapshot.sessionId &&
      command.audienceEpoch === this.#snapshot.audienceEpoch &&
      command.expectedRevision === this.#snapshot.revision &&
      (this.#snapshot.state === 'running' ||
        this.#snapshot.state === 'paused' ||
        this.#snapshot.state === 'degraded')
    )
  }

  #exclusive<TResult>(work: () => Promise<TResult>): Promise<TResult> {
    const result = this.#commandTail.then(work, work)
    this.#commandTail = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }

  #requireCommand(command: LifecycleCommandIdentity): void {
    this.#requireRoom(command.roomId)
    this.#requireSession(command.sessionId)
    this.#requireEpoch(command.audienceEpoch)
    this.#requireRevision(command.expectedRevision)
  }

  #requireRoom(roomId: RoomId): void {
    if (roomId !== this.#snapshot.roomId) {
      throw new RoomSessionLifecycleError('wrong_room')
    }
  }

  #requireSession(sessionId: SessionId): void {
    if (sessionId !== this.#snapshot.sessionId) {
      throw new RoomSessionLifecycleError('wrong_session')
    }
  }

  #requireEpoch(audienceEpoch: Epoch): void {
    if (audienceEpoch !== this.#snapshot.audienceEpoch) {
      throw new RoomSessionLifecycleError('stale_audience_epoch')
    }
  }

  #requireRevision(expectedRevision: Revision): void {
    if (expectedRevision !== this.#snapshot.revision) {
      throw new RoomSessionLifecycleError('revision_conflict')
    }
  }

  #requireState(state: RoomSessionLifecycleState): void {
    if (this.#snapshot.state !== state) {
      throw new RoomSessionLifecycleError('illegal_transition')
    }
  }

  #transition(
    state: RoomSessionLifecycleState,
    reasonCode: RoomSessionLifecycleReason,
    changes: Partial<RoomSessionSnapshot> = {}
  ): RoomSessionSnapshot {
    const next = this.#buildTransition(state, reasonCode, changes)
    this.#snapshot = next
    return next
  }

  #buildTransition(
    state: RoomSessionLifecycleState,
    reasonCode: RoomSessionLifecycleReason,
    changes: Partial<RoomSessionSnapshot> = {}
  ): RoomSessionSnapshot {
    return immutableRoomSessionSnapshot({
      ...this.#snapshot,
      ...changes,
      state,
      reasonCode,
      revision: this.#snapshot.revision + 1,
      updatedAt: this.dependencies.wallClock.now()
    })
  }

  async #publish(snapshot: RoomSessionSnapshot, traceContext?: TraceContext): Promise<void> {
    try {
      const payload = Object.freeze({
        room_id: snapshot.roomId,
        session_id: snapshot.sessionId,
        audience_epoch: snapshot.audienceEpoch,
        revision: snapshot.revision,
        state: snapshot.state,
        recovery_eligible: snapshot.recoveryEligible,
        reason_code: snapshot.reasonCode,
        created_at_ms: Number(snapshot.createdAt),
        updated_at_ms: Number(snapshot.updatedAt),
        started_at_ms:
          snapshot.startedAt === null ? null : Number(snapshot.startedAt),
        ended_at_ms: snapshot.endedAt === null ? null : Number(snapshot.endedAt)
      })
      await this.dependencies.events.publish(Object.freeze({
        eventId: this.dependencies.eventIds.nextId(),
        type: 'room.session.snapshot',
        occurredAt: wallClockTimestampMs(snapshot.updatedAt),
        roomId: snapshot.roomId,
        ...(snapshot.sessionId === null ? {} : { sessionId: snapshot.sessionId }),
        ...(traceContext === undefined ? {} : { traceContext }),
        payload
      }))
    } catch {
      throw new RoomSessionLifecycleError('publication_failed')
    }
  }

  #resourceIdentity(): SessionResourceIdentity {
    const sessionId = this.#snapshot.sessionId
    if (sessionId === null) throw new RoomSessionLifecycleError('wrong_session')
    return Object.freeze({
      roomId: this.#snapshot.roomId,
      sessionId,
      audienceEpoch: this.#snapshot.audienceEpoch
    })
  }

  async #resourceCall(operation: 'pause' | 'resume'): Promise<void> {
    try {
      await this.dependencies.resources[operation](this.#resourceIdentity())
    } catch {
      throw new RoomSessionLifecycleError('resource_operation_failed')
    }
  }

  async #resetOwnedWork(reason: 'runtime_replaced' | 'session_stopped'): Promise<void> {
    const scope = this.#taskScope
    if (scope === null) return
    let failed = false
    try {
      scope.cancelAll({ code: reason, messageCode: 'session.boundary' })
    } catch {
      failed = true
    }
    try {
      await scope.drain()
    } catch {
      failed = true
    }
    this.#taskScope = null
    if (failed) throw new RoomSessionLifecycleError('task_scope_cleanup_failed')
  }

  #releaseResourcesOnce(): Promise<void> {
    this.#releasePromise ??= this.dependencies.resources
      .release(this.#resourceIdentity())
      .catch(() => {
        throw new RoomSessionLifecycleError('resource_operation_failed')
      })
    return this.#releasePromise
  }

  #safeError(
    error: unknown,
    fallback: RoomSessionLifecycleErrorCode
  ): RoomSessionLifecycleError {
    return error instanceof RoomSessionLifecycleError
      ? error
      : new RoomSessionLifecycleError(fallback)
  }
}
