import { describe, expect, test } from 'bun:test'

import {
  createTraceContext,
  providerFailure,
  type ModelRequestBudget,
  type ProviderFailure,
  type ProviderOutcome
} from '../ports'
import {
  createModelSchedulingPolicy,
  type ModelRequestScheduler,
  type ModelSchedulingResult,
  type ScheduledModelAttempt,
  type ScheduledModelTask
} from './model-request-scheduler'
import { createModelRequestScheduler } from '../../infrastructure/scheduling/model-request-scheduler'

const transientFailure = providerFailure({
  code: 'provider_unavailable',
  source: 'provider',
  retryable: true,
  httpStatus: 503
})
const invalidResponse = providerFailure({
  code: 'invalid_response',
  source: 'protocol',
  retryable: false
})

describe('AGT-005 model request scheduling policy', () => {
  test('uses product defaults for concurrency, pacing, and trigger budgets', () => {
    const policy = createModelSchedulingPolicy()

    expect(policy).toMatchObject({
      maxInFlight: 12,
      maxQueued: 64,
      startIntervalMs: 200,
      retryBackoffMs: 500,
      minimumAttemptRemainingMs: 50,
      candidateBudgets: {
        direct: 1,
        user_text: 6,
        final_voice: 6,
        system_audio: 6,
        screen_change: 4,
        ambient_tick: 2
      }
    })
  })

  test('prioritizes finite work and applies queued latest-wins without cancelling same-priority dispatched work', async () => {
    const scheduler = createModelRequestScheduler({
      maxInFlight: 1,
      maxQueued: 8,
      startIntervalMs: 0
    })
    const starts: string[] = []
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    let firstSignalAborted = false
    const first = schedule(scheduler, 'first', {
      trigger: 'final_voice',
      laneKey: 'viewer-shared',
      execute: async ({ context, requestBudget }) => {
        starts.push('first')
        context.callerSignal.addEventListener('abort', () => {
          firstSignalAborted = true
        })
        requestBudget.take()
        await firstGate
        return success('first')
      }
    })
    await waitUntil(() => scheduler.snapshot.running === 1)

    const replaced = schedule(scheduler, 'replaced', {
      trigger: 'final_voice',
      laneKey: 'viewer-shared',
      execute: physicalSuccess('replaced', starts)
    })
    const latest = schedule(scheduler, 'latest', {
      trigger: 'final_voice',
      laneKey: 'viewer-shared',
      execute: physicalSuccess('latest', starts)
    })
    const low = schedule(scheduler, 'low', {
      trigger: 'ambient_tick',
      laneKey: 'viewer-low',
      execute: physicalSuccess('low', starts)
    })
    const high = schedule(scheduler, 'high', {
      trigger: 'screen_change',
      laneKey: 'viewer-high',
      execute: physicalSuccess('high', starts)
    })

    expect((await replaced).status).toBe('superseded')
    expect(firstSignalAborted).toBe(false)
    releaseFirst()
    expect((await first).status).toBe('completed')
    expect((await high).status).toBe('completed')
    expect((await latest).status).toBe('completed')
    expect((await low).status).toBe('completed')
    expect(starts).toEqual(['first', 'high', 'latest', 'low'])

    let releaseSystem!: () => void
    const systemGate = new Promise<void>((resolve) => {
      releaseSystem = resolve
    })
    let systemSignalAborted = false
    const system = schedule(scheduler, 'system-running', {
      trigger: 'system_audio',
      laneKey: 'viewer-final-over-system',
      execute: async ({ context, requestBudget }) => {
        requestBudget.take()
        context.callerSignal.addEventListener('abort', () => {
          systemSignalAborted = true
        }, { once: true })
        return await new Promise<ProviderOutcome<string>>((resolve) => {
          void systemGate.then(() => resolve(success('system-running')))
        })
      }
    })
    await waitUntil(() => scheduler.snapshot.running === 1)
    const finalVoice = schedule(scheduler, 'final-over-system', {
      trigger: 'final_voice',
      laneKey: 'viewer-final-over-system',
      execute: physicalSuccess('final-over-system', starts)
    })
    try {
      await waitUntil(() => systemSignalAborted)
    } finally {
      releaseSystem()
    }
    expect((await system).status).toBe('superseded')
    expect(systemSignalAborted).toBe(true)
    expect((await finalVoice).status).toBe('completed')

    let releaseAmbient!: () => void
    const ambientGate = new Promise<void>((resolve) => {
      releaseAmbient = resolve
    })
    const ambient = schedule(scheduler, 'ambient-running', {
      trigger: 'ambient_tick',
      laneKey: 'viewer-priority-replace',
      execute: async ({ context, requestBudget }) => {
        requestBudget.take()
        return await new Promise<ProviderOutcome<string>>((resolve, reject) => {
          context.callerSignal.addEventListener('abort', () => {
            reject(context.callerSignal.reason)
          }, { once: true })
          void ambientGate.then(() => resolve(success('ambient-running')))
        })
      }
    })
    await waitUntil(() => scheduler.snapshot.running === 1)
    const user = schedule(scheduler, 'user-replacement', {
      trigger: 'user_text',
      laneKey: 'viewer-priority-replace',
      execute: physicalSuccess('user-replacement', starts)
    })

    expect((await ambient).status).toBe('superseded')
    releaseAmbient()
    expect((await user).status).toBe('completed')
    await scheduler.idle()
    expect(scheduler.snapshot).toMatchObject({ admitted: 0, queued: 0, running: 0 })
  })

  test('bounds queued admission and active candidates per trigger, then releases both', async () => {
    const scheduler = createModelRequestScheduler({
      maxInFlight: 1,
      maxQueued: 2,
      startIntervalMs: 0,
      candidateBudgets: { user_text: 2, direct: 0 }
    })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let active = 0
    let maximumActive = 0
    let heldAborted = false
    const held = schedule(scheduler, 'held', {
      triggerId: 'trigger-a',
      rateKey: 'session-a',
      laneKey: 'lane-held',
      execute: async ({ context, requestBudget }) => {
        requestBudget.take()
        context.callerSignal.addEventListener('abort', () => {
          heldAborted = true
        })
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await gate
        active -= 1
        return success('held')
      }
    })
    await waitUntil(() => scheduler.snapshot.running === 1)

    const sameTrigger = schedule(scheduler, 'same-trigger', {
      triggerId: 'trigger-a',
      rateKey: 'session-a',
      laneKey: 'lane-same-trigger'
    })
    const overBudget = await schedule(scheduler, 'over-budget', {
      triggerId: 'trigger-a',
      rateKey: 'session-a',
      laneKey: 'lane-over-budget'
    })
    const fillsQueue = schedule(scheduler, 'fills-queue', {
      triggerId: 'trigger-b',
      rateKey: 'session-a',
      laneKey: 'lane-fills-queue'
    })
    const rejectedQueuedReplacement = await schedule(
      scheduler,
      'rejected-queued-replacement',
      {
        trigger: 'direct',
        triggerId: 'trigger-direct',
        rateKey: 'session-a',
        laneKey: 'lane-same-trigger'
      }
    )
    const rejectedReplacement = await schedule(scheduler, 'rejected-replacement', {
      trigger: 'direct',
      triggerId: 'trigger-direct',
      rateKey: 'session-a',
      laneKey: 'lane-held'
    })
    const overCapacity = await schedule(scheduler, 'over-capacity', {
      triggerId: 'trigger-c',
      rateKey: 'session-a',
      laneKey: 'lane-over-capacity'
    })

    expect(overBudget.status).toBe('candidate_budget_rejected')
    expect(rejectedQueuedReplacement.status).toBe('candidate_budget_rejected')
    expect(rejectedReplacement.status).toBe('capacity_rejected')
    expect(heldAborted).toBe(false)
    expect(overCapacity.status).toBe('capacity_rejected')
    expect(scheduler.snapshot).toMatchObject({ admitted: 3, queued: 2, running: 1 })
    release()
    expect((await held).status).toBe('completed')
    expect((await sameTrigger).status).toBe('completed')
    expect((await fillsQueue).status).toBe('completed')
    await scheduler.idle()
    expect(maximumActive).toBe(1)

    const reopened = await schedule(scheduler, 'reopened', {
      triggerId: 'trigger-a',
      rateKey: 'session-a',
      laneKey: 'lane-reopened'
    })
    expect(reopened.status).toBe('completed')
    expect(scheduler.snapshot.admitted).toBe(0)
  })

  test('paces starts with a virtual clock and expires work before a forbidden start', async () => {
    const clock = new VirtualClock()
    const scheduler = createModelRequestScheduler(
      {
        maxInFlight: 2,
        maxQueued: 4,
        startIntervalMs: 200
      },
      { monotonicNow: clock.now, sleep: clock.sleep }
    )
    const starts: number[] = []
    const first = await schedule(scheduler, 'rate-first', {
      rateKey: 'session-rate',
      execute: async ({ requestBudget }) => {
        requestBudget.take()
        starts.push(clock.now())
        return success('rate-first')
      }
    })
    expect(first.status).toBe('completed')

    const second = schedule(scheduler, 'rate-second', {
      rateKey: 'session-rate',
      execute: async ({ requestBudget }) => {
        requestBudget.take()
        starts.push(clock.now())
        return success('rate-second')
      }
    })
    await waitUntil(() => clock.pendingSleeps === 1)
    clock.advance(199)
    await flushMicrotasks()
    expect(starts).toEqual([0])
    clock.advance(1)
    expect((await second).status).toBe('completed')
    expect(starts).toEqual([0, 200])

    const expires = await schedule(scheduler, 'rate-expired', {
      rateKey: 'session-rate',
      deadlineAt: 400,
      execute: () => {
        throw new Error('expired work must not dispatch')
      }
    })
    expect(expires).toEqual({
      status: 'expired',
      physicalRequests: 0,
      retries: 0
    })
  })

  test('shares one two-request budget across retry and protocol-repair paths', async () => {
    const clock = new VirtualClock()
    const scheduler = createModelRequestScheduler(
      {
        maxInFlight: 6,
        maxQueued: 12,
        startIntervalMs: 0,
        retryBackoffMs: 500,
        minimumAttemptRemainingMs: 50
      },
      { monotonicNow: clock.now, sleep: clock.sleep }
    )

    const initialSuccess = await schedule(scheduler, 'matrix-success')
    expect(summary(initialSuccess)).toEqual(['completed', 1, 0])

    const transientThenSuccess = schedule(scheduler, 'matrix-transient-success', {
      execute: scriptedAttempts([failure(transientFailure), success('retried')])
    })
    await advanceRetry(clock)
    expect(summary(await transientThenSuccess)).toEqual(['completed', 2, 1])

    const repairSuccess = await schedule(scheduler, 'matrix-repair-success', {
      execute: protocolRepair(success('repaired'))
    })
    expect(summary(repairSuccess)).toEqual(['completed', 2, 0])

    const transientThenInvalid = schedule(scheduler, 'matrix-transient-invalid', {
      execute: scriptedAttempts([failure(transientFailure), failure(invalidResponse)])
    })
    await advanceRetry(clock)
    expect(summary(await transientThenInvalid)).toEqual(['failed', 2, 1])

    const repairFailure = await schedule(scheduler, 'matrix-repair-failure', {
      execute: protocolRepair(failure(invalidResponse))
    })
    expect(summary(repairFailure)).toEqual(['failed', 2, 0])

    const abortController = new AbortController()
    const aborted = await schedule(scheduler, 'matrix-abort', {
      callerSignal: abortController.signal,
      execute: async ({ requestBudget }) => {
        requestBudget.take()
        abortController.abort()
        return failure(transientFailure)
      }
    })
    expect(summary(aborted)).toEqual(['cancelled', 1, 0])

    const noDeadlineForRetry = await schedule(scheduler, 'matrix-deadline', {
      deadlineAt: clock.now() + 549,
      execute: scriptedAttempts([failure(transientFailure), success('forbidden')])
    })
    expect(summary(noDeadlineForRetry)).toEqual(['failed', 1, 0])
    expect([
      initialSuccess,
      await transientThenSuccess,
      repairSuccess,
      await transientThenInvalid,
      repairFailure,
      aborted,
      noDeadlineForRetry
    ].every((result) => result.physicalRequests <= 2)).toBe(true)
  })

  test('drains gracefully or cancels queued and dispatched work without reopening', async () => {
    const cancelling = createModelRequestScheduler({
      maxInFlight: 1,
      maxQueued: 2,
      startIntervalMs: 0
    })
    const running = schedule(cancelling, 'cancel-running', {
      laneKey: 'cancel-running-lane',
      execute: abortableAttempt()
    })
    await waitUntil(() => cancelling.snapshot.running === 1)
    const queued = schedule(cancelling, 'cancel-queued', {
      laneKey: 'cancel-queued-lane'
    })
    const cancelled = cancelling.cancel()
    expect((await queued).status).toBe('cancelled')
    expect((await running).status).toBe('cancelled')
    await cancelled
    expect(cancelling.snapshot).toEqual({
      accepting: false,
      admitted: 0,
      queued: 0,
      running: 0
    })
    expect((await schedule(cancelling, 'cancel-closed')).status).toBe('closed')

    const draining = createModelRequestScheduler({
      maxInFlight: 1,
      maxQueued: 1,
      startIntervalMs: 0
    })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const admitted = schedule(draining, 'drain-running', {
      execute: async ({ requestBudget }) => {
        requestBudget.take()
        await gate
        return success('drain-running')
      }
    })
    await waitUntil(() => draining.snapshot.running === 1)
    const drain = draining.drain()
    expect((await schedule(draining, 'drain-closed')).status).toBe('closed')
    release()
    expect((await admitted).status).toBe('completed')
    await drain
    expect(draining.snapshot.admitted).toBe(0)
  })

  test('propagates trace context to Provider calls and emits terminal records', async () => {
    const terminal: Array<Record<string, unknown>> = []
    const scheduler = createModelRequestScheduler({
      maxInFlight: 1,
      startIntervalMs: 0
    }, {
      onTerminal: (event) => {
        terminal.push(event as Record<string, unknown>)
      }
    })
    const traceContext = createTraceContext({
      traceId: 'trace-scheduler',
      correlation: { requestId: 'request-scheduler', epoch: 7, sequence: 3 }
    })
    let observed: typeof traceContext | undefined
    const result = await scheduler.schedule({
      taskId: 'trace-task',
      triggerId: 'trace-trigger',
      trigger: 'direct',
      laneKey: 'trace-lane',
      rateKey: 'trace-rate',
      deadlineAt: 100_000,
      traceContext,
      execute: async ({ context, requestBudget }) => {
        observed = context.traceContext
        requestBudget.take()
        return success('trace-ok')
      }
    })
    expect(result.status).toBe('completed')
    expect(observed).toBe(traceContext)
    await Bun.sleep(0)
    expect(terminal).toEqual([
      expect.objectContaining({
        taskId: 'trace-task',
        status: 'completed',
        traceContext
      })
    ])

    const rejected = await scheduler.schedule({
      taskId: 'trace-expired',
      triggerId: 'trace-expired-trigger',
      trigger: 'direct',
      laneKey: 'trace-expired-lane',
      rateKey: 'trace-expired-rate',
      deadlineAt: 0,
      traceContext,
      execute: physicalSuccess('never')
    })
    expect(rejected.status).toBe('expired')
    await Bun.sleep(0)
    expect(terminal).toContainEqual(expect.objectContaining({
      taskId: 'trace-expired',
      status: 'expired',
      traceContext
    }))
  })
})

type ScheduleOptions = Partial<
  Pick<
    ScheduledModelTask<string>,
    | 'triggerId'
    | 'trigger'
    | 'laneKey'
    | 'rateKey'
    | 'deadlineAt'
    | 'callerSignal'
    | 'traceContext'
    | 'execute'
  >
>

function schedule(
  scheduler: ModelRequestScheduler,
  id: string,
  options: ScheduleOptions = {}
): Promise<ModelSchedulingResult<string>> {
  return scheduler.schedule({
    taskId: id,
    triggerId: options.triggerId ?? `trigger-${id}`,
    trigger: options.trigger ?? 'user_text',
    laneKey: options.laneKey ?? `lane-${id}`,
    rateKey: options.rateKey ?? `rate-${id}`,
    deadlineAt: options.deadlineAt ?? 100_000,
    ...(options.callerSignal === undefined
      ? {}
      : { callerSignal: options.callerSignal }),
    execute: options.execute ?? physicalSuccess(id)
  })
}

function physicalSuccess(
  value: string,
  starts?: string[]
): ScheduledModelTask<string>['execute'] {
  return async ({ requestBudget }) => {
    requestBudget.take()
    starts?.push(value)
    return success(value)
  }
}

function scriptedAttempts(
  outcomes: readonly ProviderOutcome<string>[]
): ScheduledModelTask<string>['execute'] {
  let index = 0
  return async ({ requestBudget }) => {
    requestBudget.take()
    const outcome = outcomes[index]
    index += 1
    if (outcome === undefined) throw new Error('missing scripted attempt')
    return outcome
  }
}

function protocolRepair(
  outcome: ProviderOutcome<string>
): ScheduledModelTask<string>['execute'] {
  return async ({ requestBudget }) => {
    requestBudget.take()
    requestBudget.take()
    return outcome
  }
}

function abortableAttempt(): ScheduledModelTask<string>['execute'] {
  return async ({ context, requestBudget }) => {
    requestBudget.take()
    return await new Promise<ProviderOutcome<string>>((resolve, reject) => {
      context.callerSignal.addEventListener(
        'abort',
        () => reject(context.callerSignal.reason),
        { once: true }
      )
      void resolve
    })
  }
}

function success<TValue>(value: TValue): ProviderOutcome<TValue> {
  return { ok: true, value }
}

function failure(error: ProviderFailure): ProviderOutcome<never> {
  return { ok: false, error }
}

function summary<TValue>(
  result: ModelSchedulingResult<TValue>
): [ModelSchedulingResult<TValue>['status'], number, number] {
  return [result.status, result.physicalRequests, result.retries]
}

async function advanceRetry(clock: VirtualClock): Promise<void> {
  await waitUntil(() => clock.pendingSleeps === 1)
  clock.advance(500)
  await flushMicrotasks()
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 1_000
): Promise<void> {
  const started = performance.now()
  while (!predicate()) {
    if (performance.now() - started >= timeoutMs) {
      throw new Error('AGT-005 wait timed out')
    }
    await Bun.sleep(1)
  }
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Bun.sleep(0)
}

type Sleeper = {
  readonly at: number
  readonly signal: AbortSignal
  readonly resolve: () => void
  readonly reject: (reason: unknown) => void
  readonly abort: () => void
}

class VirtualClock {
  readonly #sleepers = new Set<Sleeper>()
  #now = 0

  readonly now = (): number => this.#now

  readonly sleep = (
    milliseconds: number,
    signal: AbortSignal
  ): Promise<void> => {
    if (signal.aborted) return Promise.reject(signal.reason)
    if (milliseconds <= 0) return Promise.resolve()
    return new Promise<void>((resolve, reject) => {
      const sleeper: Sleeper = {
        at: this.#now + milliseconds,
        signal,
        resolve,
        reject,
        abort: () => {
          this.#sleepers.delete(sleeper)
          reject(signal.reason)
        }
      }
      this.#sleepers.add(sleeper)
      signal.addEventListener('abort', sleeper.abort, { once: true })
    })
  }

  get pendingSleeps(): number {
    return this.#sleepers.size
  }

  advance(milliseconds: number): void {
    this.#now += milliseconds
    const due = [...this.#sleepers].filter((sleeper) => sleeper.at <= this.#now)
    for (const sleeper of due) {
      this.#sleepers.delete(sleeper)
      sleeper.signal.removeEventListener('abort', sleeper.abort)
      sleeper.resolve()
    }
  }
}
