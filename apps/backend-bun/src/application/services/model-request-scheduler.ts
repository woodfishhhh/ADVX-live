import type { ObservationTrigger } from '@advx/contracts'

import {
  createModelRequestBudget,
  monotonicDeadline,
  providerFailure,
  type CancellationReason,
  type ModelRequestBudget,
  type ProviderCallContext,
  type ProviderFailure,
  type ProviderOutcome,
  type TraceContext
} from '../ports'

export type ModelSchedulingTrigger = ObservationTrigger | 'direct'

export type ModelSchedulingPolicy = {
  readonly maxInFlight: number
  readonly maxQueued: number
  readonly startIntervalMs: number
  readonly retryBackoffMs: number
  readonly maxRetryDelayMs: number
  readonly minimumAttemptRemainingMs: number
  readonly candidateBudgets: Readonly<Record<ModelSchedulingTrigger, number>>
}

export type ModelSchedulingPolicyInput = Partial<
  Omit<ModelSchedulingPolicy, 'candidateBudgets'>
> & {
  readonly candidateBudgets?: Partial<
    Readonly<Record<ModelSchedulingTrigger, number>>
  >
}

export type ScheduledModelAttempt = {
  readonly attempt: 0 | 1
  readonly context: ProviderCallContext
  readonly requestBudget: ModelRequestBudget
}

export type ScheduledModelTask<TValue> = {
  readonly taskId: string
  readonly triggerId: string
  readonly traceContext?: TraceContext
  readonly trigger: ModelSchedulingTrigger
  readonly laneKey: string
  readonly rateKey: string
  readonly deadlineAt: number
  readonly callerSignal?: AbortSignal
  execute(
    attempt: ScheduledModelAttempt
  ): Promise<ProviderOutcome<TValue>>
}

export type ModelSchedulingStatus =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'superseded'
  | 'expired'
  | 'capacity_rejected'
  | 'candidate_budget_rejected'
  | 'lower_priority_rejected'
  | 'closed'

type ModelSchedulingResultBase = {
  readonly status: ModelSchedulingStatus
  readonly physicalRequests: number
  readonly retries: 0 | 1
}

export type ModelSchedulingResult<TValue> =
  | (ModelSchedulingResultBase & {
      readonly status: 'completed'
      readonly value: TValue
    })
  | (ModelSchedulingResultBase & {
      readonly status: 'failed'
      readonly error: ProviderFailure
    })
  | (ModelSchedulingResultBase & {
      readonly status: Exclude<
        ModelSchedulingStatus,
        'completed' | 'failed'
      >
    })

export type ModelSchedulerSnapshot = {
  readonly accepting: boolean
  readonly admitted: number
  readonly queued: number
  readonly running: number
}

export type ModelSchedulerTerminalEvent = Readonly<{
  taskId: string
  status: ModelSchedulingStatus
  physicalRequests: number
  retries: 0 | 1
  traceContext?: TraceContext
}>

export type ModelRequestSchedulerDependencies = {
  readonly createQueue: ModelSchedulerQueueFactory
  readonly monotonicNow?: () => number
  readonly sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
  readonly onTerminal?: (event: ModelSchedulerTerminalEvent) => void | Promise<void>
}

export type ModelSchedulerQueueOptions = {
  readonly concurrency: number
}

export type ModelSchedulerQueueTaskOptions = {
  readonly id: string
  readonly priority: number
  readonly signal: AbortSignal
}

export type ModelSchedulerQueue = {
  readonly size: number
  readonly pending: number
  add<TValue>(
    task: () => Promise<TValue>,
    options: ModelSchedulerQueueTaskOptions
  ): Promise<TValue | void>
}

export type ModelSchedulerQueueFactory = (
  options: ModelSchedulerQueueOptions
) => ModelSchedulerQueue

type TaskState = 'queued' | 'running' | 'settled'

type TaskRecord = {
  readonly task: ScheduledModelTask<unknown>
  readonly priority: number
  readonly triggerKey: string
  readonly controller: AbortController
  readonly queueController: AbortController
  readonly promise: Promise<ModelSchedulingResult<unknown>>
  readonly resolve: (result: ModelSchedulingResult<unknown>) => void
  readonly callerAbort?: () => void
  state: TaskState
  requestBudget?: ModelRequestBudget
  retries: 0 | 1
  cancellationReason?: CancellationReason
  terminalOverride?: 'cancelled' | 'superseded'
}

const DEFAULT_CANDIDATE_BUDGETS: Readonly<
  Record<ModelSchedulingTrigger, number>
> = Object.freeze({
  direct: 1,
  user_text: 6,
  final_voice: 6,
  system_audio: 6,
  screen_change: 4,
  ambient_tick: 2
})

const TRIGGER_PRIORITIES: Readonly<Record<ModelSchedulingTrigger, number>> =
  Object.freeze({
    direct: 60,
    user_text: 50,
    final_voice: 50,
    system_audio: 40,
    screen_change: 30,
    ambient_tick: 10
  })

const RETRYABLE_CODES = new Set<ProviderFailure['code']>([
  'timeout',
  'rate_limited',
  'network_error',
  'provider_unavailable'
])

export const DEFAULT_MODEL_SCHEDULING_POLICY: ModelSchedulingPolicy =
  createModelSchedulingPolicy()

export function createModelSchedulingPolicy(
  input: ModelSchedulingPolicyInput = {}
): ModelSchedulingPolicy {
  const candidateBudgets = Object.freeze({
    ...DEFAULT_CANDIDATE_BUDGETS,
    ...input.candidateBudgets
  })
  const policy: ModelSchedulingPolicy = {
    maxInFlight: input.maxInFlight ?? 12,
    maxQueued: input.maxQueued ?? 64,
    startIntervalMs: input.startIntervalMs ?? 200,
    retryBackoffMs: input.retryBackoffMs ?? 500,
    maxRetryDelayMs: input.maxRetryDelayMs ?? 60_000,
    minimumAttemptRemainingMs: input.minimumAttemptRemainingMs ?? 50,
    candidateBudgets
  }
  positiveInteger(policy.maxInFlight, 'maximum in-flight requests', 32)
  positiveInteger(policy.maxQueued, 'maximum queued requests', 65_536)
  finiteNonNegative(policy.startIntervalMs, 'request start interval', 60_000)
  finiteNonNegative(policy.retryBackoffMs, 'retry backoff', 60_000)
  finiteNonNegative(policy.maxRetryDelayMs, 'maximum retry delay', 60_000)
  finiteNonNegative(
    policy.minimumAttemptRemainingMs,
    'minimum attempt remaining time',
    60_000
  )
  for (const [trigger, budget] of Object.entries(candidateBudgets)) {
    nonNegativeInteger(budget, `${trigger} candidate budget`, 32)
  }
  if (policy.maxRetryDelayMs < policy.retryBackoffMs) {
    throw new RangeError('maximum retry delay must not be less than retry backoff')
  }
  return Object.freeze(policy)
}

export class ModelRequestScheduler {
  readonly #policy: ModelSchedulingPolicy
  readonly #queue: ModelSchedulerQueue
  readonly #createQueue: ModelSchedulerQueueFactory
  readonly #monotonicNow: () => number
  readonly #sleep: (
    milliseconds: number,
    signal: AbortSignal
  ) => Promise<void>
  readonly #onTerminal?: (event: ModelSchedulerTerminalEvent) => void | Promise<void>
  readonly #laneQueues = new Map<string, ModelSchedulerQueue>()
  readonly #queuedByLane = new Map<string, TaskRecord>()
  readonly #runningByLane = new Map<string, TaskRecord>()
  readonly #records = new Set<TaskRecord>()
  readonly #triggerCounts = new Map<string, number>()
  readonly #nextStartByRateKey = new Map<string, number>()
  readonly #idleWaiters = new Set<() => void>()
  #queued = 0
  #running = 0
  #accepting = true

  constructor(
    policy: ModelSchedulingPolicyInput = {},
    dependencies: ModelRequestSchedulerDependencies
  ) {
    this.#policy = createModelSchedulingPolicy(policy)
    this.#createQueue = dependencies.createQueue
    this.#queue = this.#createQueue({ concurrency: this.#policy.maxInFlight })
    this.#monotonicNow = dependencies.monotonicNow ?? (() => performance.now())
    this.#sleep = dependencies.sleep ?? abortableSleep
    this.#onTerminal = dependencies.onTerminal
  }

  get policy(): ModelSchedulingPolicy {
    return this.#policy
  }

  get snapshot(): ModelSchedulerSnapshot {
    return Object.freeze({
      accepting: this.#accepting,
      admitted: this.#records.size,
      queued: this.#queued,
      running: this.#running
    })
  }

  schedule<TValue>(
    task: ScheduledModelTask<TValue>
  ): Promise<ModelSchedulingResult<TValue>> {
    validateTask(task)
    if (!this.#accepting) return this.#immediate(task, 'closed')
    if (task.callerSignal?.aborted === true) return this.#immediate(task, 'cancelled')
    if (this.#monotonicNow() >= task.deadlineAt) return this.#immediate(task, 'expired')

    const priority = TRIGGER_PRIORITIES[task.trigger]
    const queued = this.#queuedByLane.get(task.laneKey)
    if (queued !== undefined) {
      if (!mayReplace(priority, task.trigger, queued)) {
        return this.#immediate(task, 'lower_priority_rejected')
      }
    }

    const projectedQueued = this.#queued - (queued === undefined ? 0 : 1)
    if (projectedQueued >= this.#policy.maxQueued) {
      return this.#immediate(task, 'capacity_rejected')
    }
    const triggerKey = `${task.rateKey}\0${task.triggerId}`
    const triggerCount = this.#triggerCounts.get(triggerKey) ?? 0
    const projectedTriggerCount = triggerCount -
      (queued?.triggerKey === triggerKey ? 1 : 0)
    if (projectedTriggerCount >= this.#policy.candidateBudgets[task.trigger]) {
      return this.#immediate(task, 'candidate_budget_rejected')
    }

    if (queued !== undefined) {
      this.#cancelQueued(queued, 'superseded', {
        code: 'runtime_replaced',
        messageCode: 'scheduler.latest_wins'
      })
    }

    const running = this.#runningByLane.get(task.laneKey)
    if (running !== undefined && maySupersedeRunning(priority, task.trigger, running)) {
      this.#cancelRunning(running, 'superseded', {
        code: 'runtime_replaced',
        messageCode: 'scheduler.higher_priority'
      })
    }

    let resolve!: (result: ModelSchedulingResult<unknown>) => void
    const promise = new Promise<ModelSchedulingResult<unknown>>((settle) => {
      resolve = settle
    })
    const controller = new AbortController()
    const queueController = new AbortController()
    const record: TaskRecord = {
      task: task as ScheduledModelTask<unknown>,
      priority,
      triggerKey,
      controller,
      queueController,
      promise,
      resolve,
      state: 'queued',
      retries: 0
    }
    if (task.callerSignal !== undefined) {
      const callerAbort = () => {
        const reason: CancellationReason = { code: 'caller_cancelled' }
        if (record.state === 'queued') {
          this.#cancelQueued(record, 'cancelled', reason)
        } else if (record.state === 'running') {
          this.#cancelRunning(record, 'cancelled', reason)
        }
      }
      task.callerSignal.addEventListener('abort', callerAbort, { once: true })
      Object.assign(record, { callerAbort })
    }

    this.#records.add(record)
    this.#queued += 1
    this.#queuedByLane.set(task.laneKey, record)
    this.#triggerCounts.set(
      triggerKey,
      (this.#triggerCounts.get(triggerKey) ?? 0) + 1
    )
    const laneQueue = this.#laneQueue(task.laneKey)
    void laneQueue.add(
      () => this.#queue.add(
        () => this.#run(record),
        {
          id: task.taskId,
          priority,
          signal: queueController.signal
        }
      ),
      {
        id: task.taskId,
        priority,
        signal: queueController.signal
      }
    ).catch(() => {
      if (record.state !== 'settled') {
        this.#finish(
          record,
          terminalResult(record, record.terminalOverride ?? 'cancelled')
        )
      }
    }).finally(() => {
      queueMicrotask(() => this.#pruneLane(task.laneKey, laneQueue))
    })
    return promise as Promise<ModelSchedulingResult<TValue>>
  }

  async idle(): Promise<void> {
    if (this.#records.size === 0) return
    await new Promise<void>((resolve) => this.#idleWaiters.add(resolve))
  }

  async drain(): Promise<void> {
    this.#accepting = false
    await this.idle()
  }

  async cancel(
    reason: CancellationReason = { code: 'process_shutdown' }
  ): Promise<void> {
    this.#accepting = false
    for (const record of [...this.#records]) {
      if (record.state === 'queued') {
        this.#cancelQueued(record, 'cancelled', reason)
      } else if (record.state === 'running') {
        this.#cancelRunning(record, 'cancelled', reason)
      }
    }
    await this.idle()
  }

  async #run(record: TaskRecord): Promise<void> {
    if (isSettled(record)) return
    const initialTurn = await this.#waitForRateTurn(record)
    if (!initialTurn) {
      const status = record.controller.signal.aborted
        ? record.terminalOverride ?? 'cancelled'
        : 'expired'
      this.#finish(record, terminalResult(record, status))
      return
    }
    if (isSettled(record)) return

    this.#markRunning(record)
    const requestBudget = createModelRequestBudget()
    record.requestBudget = requestBudget
    const firstBefore = requestBudget.usedRequests
    let outcome = await this.#execute(record, 0, requestBudget)
    if (record.controller.signal.aborted) {
      this.#finish(
        record,
        terminalResult(record, record.terminalOverride ?? 'cancelled')
      )
      return
    }
    if (this.#monotonicNow() >= record.task.deadlineAt) {
      this.#finish(record, terminalResult(record, 'expired'))
      return
    }
    if (outcome.ok) {
      if (requestBudget.usedRequests === firstBefore) {
        outcome = { ok: false, error: physicalAccountingFailure() }
      } else {
        this.#finish(record, {
          status: 'completed',
          value: outcome.value,
          physicalRequests: requestBudget.usedRequests,
          retries: record.retries
        })
        return
      }
    }

    const firstUsed = requestBudget.usedRequests - firstBefore
    if (!this.#canRetry(record, outcome.error, firstUsed)) {
      this.#finish(record, failedResult(record, outcome.error))
      return
    }

    const retryDelay = retryDelayMs(outcome.error, this.#policy)
    try {
      await this.#sleep(retryDelay, record.controller.signal)
    } catch {
      this.#finish(
        record,
        terminalResult(record, record.terminalOverride ?? 'cancelled')
      )
      return
    }
    if (record.controller.signal.aborted) {
      this.#finish(
        record,
        terminalResult(record, record.terminalOverride ?? 'cancelled')
      )
      return
    }
    if (!await this.#waitForRateTurn(record)) {
      const status = record.controller.signal.aborted
        ? record.terminalOverride ?? 'cancelled'
        : 'expired'
      this.#finish(record, terminalResult(record, status))
      return
    }

    record.retries = 1
    const retryBefore = requestBudget.usedRequests
    outcome = await this.#execute(record, 1, requestBudget)
    if (record.controller.signal.aborted) {
      this.#finish(
        record,
        terminalResult(record, record.terminalOverride ?? 'cancelled')
      )
    } else if (this.#monotonicNow() >= record.task.deadlineAt) {
      this.#finish(record, terminalResult(record, 'expired'))
    } else if (outcome.ok && requestBudget.usedRequests > retryBefore) {
      this.#finish(record, {
        status: 'completed',
        value: outcome.value,
        physicalRequests: requestBudget.usedRequests,
        retries: 1
      })
    } else if (!outcome.ok) {
      this.#finish(record, failedResult(record, outcome.error))
    } else {
      this.#finish(record, failedResult(record, physicalAccountingFailure()))
    }
  }

  async #execute(
    record: TaskRecord,
    attempt: 0 | 1,
    requestBudget: ModelRequestBudget
  ): Promise<ProviderOutcome<unknown>> {
    const context: ProviderCallContext = {
      callerSignal: record.controller.signal,
      deadline: monotonicDeadline(record.task.deadlineAt),
      ...(record.task.traceContext === undefined
        ? {}
        : { traceContext: record.task.traceContext }),
      cancellationReason: () => cancellationReason(record, this.#monotonicNow())
    }
    try {
      return await record.task.execute({ attempt, context, requestBudget })
    } catch {
      return {
        ok: false,
        error: providerFailure({
          code: 'unknown',
          source: 'advx',
          retryable: false
        })
      }
    }
  }

  #canRetry(
    record: TaskRecord,
    failure: ProviderFailure,
    usedRequests: number
  ): boolean {
    if (
      record.controller.signal.aborted ||
      usedRequests < 1 ||
      record.requestBudget?.remainingRequests !== 1 ||
      !failure.retryable ||
      !RETRYABLE_CODES.has(failure.code) ||
      (failure.source !== 'provider' && failure.source !== 'transport')
    ) {
      return false
    }
    const now = this.#monotonicNow()
    const rateDelay = this.#rateDelay(record.task.rateKey, now)
    const requiredDelay = Math.max(
      rateDelay,
      retryDelayMs(failure, this.#policy)
    ) + this.#policy.minimumAttemptRemainingMs
    return record.task.deadlineAt - now >= requiredDelay
  }

  async #waitForRateTurn(record: TaskRecord): Promise<boolean> {
    const { rateKey, deadlineAt } = record.task
    while (!record.controller.signal.aborted) {
      const now = this.#monotonicNow()
      if (now >= deadlineAt) return false
      this.#pruneRateKeys(now)
      const delay = this.#rateDelay(rateKey, now)
      if (delay <= 0) {
        this.#nextStartByRateKey.set(
          rateKey,
          now + this.#policy.startIntervalMs
        )
        return true
      }
      if (now + delay >= deadlineAt) return false
      try {
        await this.#sleep(delay, record.controller.signal)
      } catch {
        return false
      }
    }
    return false
  }

  #rateDelay(rateKey: string, now: number): number {
    return Math.max(0, (this.#nextStartByRateKey.get(rateKey) ?? now) - now)
  }

  #pruneRateKeys(now: number): void {
    for (const [key, nextStart] of this.#nextStartByRateKey) {
      if (nextStart <= now) this.#nextStartByRateKey.delete(key)
    }
  }

  #markRunning(record: TaskRecord): void {
    if (record.state !== 'queued') return
    record.state = 'running'
    this.#queued -= 1
    this.#running += 1
    if (this.#queuedByLane.get(record.task.laneKey) === record) {
      this.#queuedByLane.delete(record.task.laneKey)
    }
    this.#runningByLane.set(record.task.laneKey, record)
  }

  #cancelQueued(
    record: TaskRecord,
    status: 'cancelled' | 'superseded',
    reason: CancellationReason
  ): void {
    if (record.state !== 'queued') return
    record.cancellationReason = reason
    record.terminalOverride = status
    record.queueController.abort(reason)
    record.controller.abort(reason)
    this.#finish(record, terminalResult(record, status))
  }

  #cancelRunning(
    record: TaskRecord,
    status: 'cancelled' | 'superseded',
    reason: CancellationReason
  ): void {
    if (record.state !== 'running') return
    record.cancellationReason = reason
    record.terminalOverride = status
    record.controller.abort(reason)
  }

  #finish(record: TaskRecord, result: ModelSchedulingResult<unknown>): void {
    if (record.state === 'settled') return
    const priorState = record.state
    record.state = 'settled'
    if (priorState === 'queued') this.#queued -= 1
    if (priorState === 'running') this.#running -= 1
    if (this.#queuedByLane.get(record.task.laneKey) === record) {
      this.#queuedByLane.delete(record.task.laneKey)
    }
    if (this.#runningByLane.get(record.task.laneKey) === record) {
      this.#runningByLane.delete(record.task.laneKey)
    }
    this.#records.delete(record)
    const triggerCount = this.#triggerCounts.get(record.triggerKey) ?? 0
    if (triggerCount <= 1) this.#triggerCounts.delete(record.triggerKey)
    else this.#triggerCounts.set(record.triggerKey, triggerCount - 1)
    if (record.task.callerSignal !== undefined && record.callerAbort !== undefined) {
      record.task.callerSignal.removeEventListener('abort', record.callerAbort)
    }
    record.resolve(result)
    if (this.#onTerminal !== undefined) {
      void Promise.resolve(this.#onTerminal({
        taskId: record.task.taskId,
        status: result.status,
        physicalRequests: result.physicalRequests,
        retries: result.retries,
        ...(record.task.traceContext === undefined
          ? {}
          : { traceContext: record.task.traceContext })
      })).catch(() => {})
    }
    if (this.#records.size === 0) {
      for (const resolve of this.#idleWaiters) resolve()
      this.#idleWaiters.clear()
    }
  }

  #immediate<TValue>(
    task: ScheduledModelTask<TValue>,
    status: Exclude<ModelSchedulingStatus, 'completed' | 'failed'>
  ): Promise<ModelSchedulingResult<TValue>> {
    const result = immediateResult<TValue>(status)
    if (this.#onTerminal !== undefined) {
      void Promise.resolve(this.#onTerminal({
        taskId: task.taskId,
        status,
        physicalRequests: 0,
        retries: 0,
        ...(task.traceContext === undefined ? {} : { traceContext: task.traceContext })
      })).catch(() => {})
    }
    return result
  }

  #laneQueue(laneKey: string): ModelSchedulerQueue {
    const existing = this.#laneQueues.get(laneKey)
    if (existing !== undefined) return existing
    const queue = this.#createQueue({ concurrency: 1 })
    this.#laneQueues.set(laneKey, queue)
    return queue
  }

  #pruneLane(laneKey: string, queue: ModelSchedulerQueue): void {
    if (
      this.#laneQueues.get(laneKey) === queue &&
      queue.size === 0 &&
      queue.pending === 0 &&
      !this.#queuedByLane.has(laneKey) &&
      !this.#runningByLane.has(laneKey)
    ) {
      this.#laneQueues.delete(laneKey)
    }
  }
}

function validateTask(task: ScheduledModelTask<unknown>): void {
  boundedIdentifier(task.taskId, 'scheduled task ID')
  boundedIdentifier(task.triggerId, 'trigger ID')
  boundedIdentifier(task.laneKey, 'scheduler lane key')
  boundedIdentifier(task.rateKey, 'scheduler rate key')
  if (!Object.hasOwn(TRIGGER_PRIORITIES, task.trigger)) {
    throw new RangeError('scheduler trigger is not supported')
  }
  if (!Number.isFinite(task.deadlineAt) || task.deadlineAt < 0) {
    throw new RangeError('scheduler deadline must be a finite non-negative number')
  }
}

function isSettled(record: TaskRecord): boolean {
  return record.state === 'settled'
}

function mayReplace(
  priority: number,
  trigger: ModelSchedulingTrigger,
  queued: TaskRecord
): boolean {
  return priority >= queued.priority || trigger === 'user_text'
}

function maySupersedeRunning(
  priority: number,
  trigger: ModelSchedulingTrigger,
  running: TaskRecord
): boolean {
  return priority > running.priority ||
    (trigger === 'user_text' && running.task.trigger !== 'direct')
}

function cancellationReason(
  record: TaskRecord,
  now: number
): CancellationReason | undefined {
  if (record.cancellationReason !== undefined) return record.cancellationReason
  if (now >= record.task.deadlineAt) return { code: 'deadline_exceeded' }
  return undefined
}

function failedResult(
  record: TaskRecord,
  error: ProviderFailure
): ModelSchedulingResult<never> {
  return {
    status: 'failed',
    error,
    physicalRequests: record.requestBudget?.usedRequests ?? 0,
    retries: record.retries
  }
}

function terminalResult(
  record: TaskRecord,
  status: Exclude<ModelSchedulingStatus, 'completed' | 'failed'>
): ModelSchedulingResult<never> {
  return {
    status,
    physicalRequests: record.requestBudget?.usedRequests ?? 0,
    retries: record.retries
  }
}

function immediateResult<TValue>(
  status: Exclude<ModelSchedulingStatus, 'completed' | 'failed'>
): Promise<ModelSchedulingResult<TValue>> {
  return Promise.resolve({ status, physicalRequests: 0, retries: 0 })
}

function physicalAccountingFailure(): ProviderFailure {
  return providerFailure({
    code: 'protocol_error',
    source: 'advx',
    retryable: false
  })
}

function retryDelayMs(
  failure: ProviderFailure,
  policy: ModelSchedulingPolicy
): number {
  const requested = failure.retryAfterMs ?? policy.retryBackoffMs
  return Math.min(requested, policy.maxRetryDelayMs)
}

function boundedIdentifier(value: string, name: string): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 512) {
    throw new RangeError(`${name} must contain 1 to 512 characters`)
  }
  return normalized
}

function positiveInteger(value: number, name: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 1 to ${maximum}`)
  }
}

function nonNegativeInteger(value: number, name: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer from 0 to ${maximum}`)
  }
}

function finiteNonNegative(value: number, name: string, maximum: number): void {
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    throw new RangeError(`${name} must be from 0 to ${maximum}`)
  }
}

function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve()
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, milliseconds)
    signal.addEventListener('abort', aborted, { once: true })

    function done(): void {
      signal.removeEventListener('abort', aborted)
      resolve()
    }

    function aborted(): void {
      clearTimeout(timer)
      reject(signal.reason)
    }
  })
}
