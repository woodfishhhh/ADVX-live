import { describe, expect, test } from 'bun:test'

import type { RoomId, SessionId } from '@advx/contracts'

import {
  durationMs,
  modelUsage,
  monotonicDeadline,
  monotonicTimestampMs,
  protocolRepairAttempt,
  providerFailure,
  providerRevision,
  transactionContext,
  wallClockTimestampMs,
  type ApplicationEvent,
  type AsrProvider,
  type CancellationReason,
  type IdGenerator,
  type EventPublisher,
  type LogEvent,
  type LogSink,
  type ModelGenerationRequest,
  type ModelProvider,
  type MonotonicClock,
  type ProcessShutdownNotifier,
  type ProviderCallContext,
  type RoomRecord,
  type RoomRepository,
  type RuntimeSpecRepository,
  type ScopedTask,
  type ShutdownNotice,
  type ShutdownReceipt,
  type SessionRepository,
  type TaskExecutionContext,
  type TaskHandle,
  type TaskScope,
  type TraceEvent,
  type TraceSink,
  type TransactionBoundary,
  type WallClock
} from './index'

class DeterministicIdGenerator<TId extends string> implements IdGenerator<TId> {
  #index = 0

  constructor(private readonly values: readonly TId[]) {}

  nextId(): TId {
    const value = this.values[this.#index]
    if (value === undefined) throw new Error('deterministic IDs exhausted')
    this.#index += 1
    return value
  }
}

class FakeTaskScope implements TaskScope {
  readonly #tasks = new Set<{
    cancel(reason: CancellationReason): void
    result: Promise<unknown>
  }>()
  #sequence = 0

  spawn<TResult>(task: ScopedTask<TResult>): TaskHandle<TResult> {
    const controller = new AbortController()
    let cancellationReason: CancellationReason | undefined
    const context: TaskExecutionContext = {
      signal: controller.signal,
      deadline: task.deadline,
      reason: () => cancellationReason,
      throwIfCancelled: () => {
        if (cancellationReason !== undefined) {
          throw new Error(cancellationReason.code)
        }
      }
    }
    const entry = {
      cancel: (reason: CancellationReason) => {
        if (controller.signal.aborted) return
        cancellationReason = reason
        controller.abort(reason)
      },
      result: Promise.resolve().then(() => task.run(context))
    }
    this.#tasks.add(entry)
    void entry.result.finally(() => this.#tasks.delete(entry))
    this.#sequence += 1
    return {
      taskId: `task-${this.#sequence}`,
      result: entry.result,
      cancel: entry.cancel
    }
  }

  cancelAll(reason: CancellationReason): void {
    for (const task of this.#tasks) task.cancel(reason)
  }

  async drain(): Promise<void> {
    await Promise.allSettled([...this.#tasks].map((task) => task.result))
  }
}

describe('BCK-004 application ports', () => {
  test('injects wall time, monotonic time, and typed IDs independently', () => {
    const wallClock = {
      now: () => wallClockTimestampMs(1_725_000_000_000)
    } satisfies WallClock
    const monotonicClock = {
      now: () => monotonicTimestampMs(42)
    } satisfies MonotonicClock
    const roomIds = new DeterministicIdGenerator<RoomId>(['room-1'])
    const sessionIds = new DeterministicIdGenerator<SessionId>(['session-1'])

    expect(Number(wallClock.now())).toBe(1_725_000_000_000)
    expect(Number(monotonicClock.now())).toBe(42)
    expect(roomIds.nextId()).toBe('room-1')
    expect(sessionIds.nextId()).toBe('session-1')
  })

  test('gives scoped tasks owned cooperative cancellation with a reason', async () => {
    const scope = new FakeTaskScope()
    let observedSignal: AbortSignal | undefined
    const handle = scope.spawn({
      name: 'provider-call',
      deadline: monotonicDeadline(500),
      run: async (context) => {
        observedSignal = context.signal
        return await new Promise<string>((resolve) => {
          context.signal.addEventListener(
            'abort',
            () => resolve(context.reason()?.code ?? 'missing'),
            { once: true }
          )
        })
      }
    })

    await Promise.resolve()
    handle.cancel({ code: 'session_stopped', messageCode: 'session.stop' })

    expect(await handle.result).toBe('session_stopped')
    expect(observedSignal?.aborted).toBe(true)
    await scope.drain()
  })

  test('passes one explicit transaction context into repository work', async () => {
    const context = transactionContext('tx-1')
    const seen: unknown[] = []
    const roomRepository = {
      async get(transaction, roomId) {
        seen.push(transaction, roomId)
        return null
      },
      async clear(transaction, _roomId) {
        seen.push(transaction)
        return false
      },
      async save(transaction, room, expectedRevision) {
        seen.push(transaction, room, expectedRevision)
      }
    } satisfies RoomRepository
    const runtimeSpecRepository = {
      async getActive(transaction, _sessionId) {
        seen.push(transaction)
        return null
      },
      async getRevision(transaction, _sessionId, _revision) {
        seen.push(transaction)
        return null
      },
      async getByApplyId(transaction, _sessionId, _applyId) {
        seen.push(transaction)
        return null
      },
      async nextRevision(transaction, _sessionId) {
        seen.push(transaction)
        return 1
      },
      async addPending(transaction, _record) {
        seen.push(transaction)
      },
      async rejectPending(transaction, _sessionId, _revision, _updatedAt) {
        seen.push(transaction)
      },
      async prepareCommit(transaction, record, _expectedActiveRevision) {
        seen.push(transaction)
        return { record, commit() {} }
      }
    } satisfies RuntimeSpecRepository
    const sessionRepository = {
      async get(transaction, _sessionId) {
        seen.push(transaction)
        return null
      },
      async getIdempotentStart(transaction, _clientRequestId, _requestHash) {
        seen.push(transaction)
        return null
      },
      async save(transaction, _session, _expectedRevision) {
        seen.push(transaction)
      }
    } satisfies SessionRepository
    const transactionBoundary = {
      async run<TResult>(
        work: (transaction: typeof context) => Promise<TResult>
      ): Promise<TResult> {
        return await work(context)
      }
    } satisfies TransactionBoundary
    const room: RoomRecord = {
      roomId: 'room-1',
      displayName: 'Room',
      state: 'active',
      revision: 1,
      createdAt: wallClockTimestampMs(10),
      updatedAt: wallClockTimestampMs(10)
    }

    await transactionBoundary.run(async (transaction) => {
      await roomRepository.get(transaction, room.roomId)
      await roomRepository.save(transaction, room, null)
      await runtimeSpecRepository.getActive(transaction, room.roomId)
      await sessionRepository.get(transaction, 'session-1')
    })

    expect(seen[0]).toBe(context)
    expect(seen[2]).toBe(context)
    expect(seen[3]).toBe(room)
    expect(seen[4]).toBeNull()
    expect(seen[5]).toBe(context)
    expect(seen[6]).toBe(context)
  })

  test('makes Provider abort/deadline and safe telemetry/shutdown contracts callable', async () => {
    const controller = new AbortController()
    const deadline = monotonicDeadline(1_000)
    const providerContext = {
      callerSignal: controller.signal,
      deadline,
      cancellationReason: () => undefined
    } satisfies ProviderCallContext
    const seenContexts: ProviderCallContext[] = []
    const modelProviderIdentity = {
      kind: 'model' as const,
      providerProfileId: 'profile-1',
      providerRevision: providerRevision('provider-1')
    }
    const asrProviderIdentity = {
      kind: 'asr' as const,
      providerProfileId: 'stepfun-1',
      providerRevision: providerRevision('asr-1')
    }
    const asrProvider = {
      async health(request, context) {
        return {
          ok: true,
          value: {
            provider: request.provider,
            status: 'healthy',
            checkedAt: wallClockTimestampMs(1),
            latency: { totalMs: durationMs(1) }
          }
        } as const
      },
      async probeCapabilities(request, context) {
        return {
          ok: true,
          value: {
            provider: request.provider,
            status: 'passed',
            checkedAt: wallClockTimestampMs(1),
            latency: { totalMs: durationMs(1) },
            discoveredModelIds: [],
            checks: []
          }
        } as const
      },
      async *transcribe(request, context) {
        seenContexts.push(context)
        yield {
          type: 'transcript',
          transcript: {
            requestId: request.requestId,
            responseId: 'asr-response-1',
            sessionId: request.sessionId,
            source: request.source,
            text: 'final transcript',
            startedAt: request.startedAt,
            endedAt: request.endedAt,
            final: true,
            revision: 1
          }
        }
      }
    } satisfies AsrProvider
    const modelProvider = {
      async health(request, context) {
        return {
          ok: true,
          value: {
            provider: request.provider,
            status: 'healthy',
            checkedAt: wallClockTimestampMs(1),
            latency: { totalMs: durationMs(1) }
          }
        } as const
      },
      async probeCapabilities(request, context) {
        return {
          ok: true,
          value: {
            provider: request.provider,
            status: 'passed',
            checkedAt: wallClockTimestampMs(1),
            latency: { totalMs: durationMs(1) },
            discoveredModelIds: [],
            checks: []
          }
        } as const
      },
      async generate(request, context) {
        seenContexts.push(context)
        return {
          ok: true,
          value: {
            requestId: request.requestId,
            responseId: 'model-response-1',
            provider: request.provider,
            roleModel: request.roleModel,
            protocolRepairAttempt: request.protocolRepairAttempt,
            output: { type: 'text', text: '{}' },
            finishReason: 'stop',
            usage: modelUsage({ totalTokens: 4 }),
            latency: { totalMs: durationMs(1) }
          }
        } as const
      },
      async *stream(request, context) {
        seenContexts.push(context)
        yield {
          type: 'failed',
          requestId: request.requestId,
          error: providerFailure({
            code: 'unsupported_capability',
            source: 'advx',
            retryable: false
          })
        } as const
      }
    } satisfies ModelProvider
    const modelRequest: ModelGenerationRequest = {
      requestId: 'model-1',
      provider: modelProviderIdentity,
      roleModel: { role: 'viewer', modelId: 'model-public-name' },
      purpose: 'viewer',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
      output: { type: 'text' },
      stream: false,
      protocolRepairAttempt: protocolRepairAttempt(0)
    }

    const transcriptStream = asrProvider.transcribe(
      {
        requestId: 'asr-1',
        provider: asrProviderIdentity,
        roleModel: { role: 'asr', modelId: 'stepaudio-2.5-asr' },
        sessionId: 'session-1',
        source: 'microphone',
        startedAt: wallClockTimestampMs(10),
        endedAt: wallClockTimestampMs(20),
        format: { sampleRateHz: 16_000, channels: 1, sampleWidthBits: 16 },
        pcm: new Uint8Array([1, 2])
      },
      providerContext
    )
    const transcript = await transcriptStream[Symbol.asyncIterator]().next()
    const generation = await modelProvider.generate(modelRequest, providerContext)

    expect(transcript.value?.type).toBe('transcript')
    expect(transcript.value?.type === 'transcript' && transcript.value.transcript.final).toBe(true)
    expect(generation.ok && generation.value.requestId).toBe('model-1')
    expect(seenContexts).toEqual([providerContext, providerContext])
    expect(seenContexts[0]?.callerSignal).toBe(controller.signal)
    expect(seenContexts[0]?.deadline).toBe(deadline)

    const traces: TraceEvent[] = []
    const logs: LogEvent[] = []
    const events: ApplicationEvent[] = []
    const traceSink = {
      async writeTrace(event) {
        traces.push(event)
      }
    } satisfies TraceSink
    const logSink = {
      async writeLog(event) {
        logs.push(event)
      }
    } satisfies LogSink
    const eventPublisher = {
      async publish(event) {
        events.push(event)
      }
    } satisfies EventPublisher
    const trace: TraceEvent = {
      traceId: 'trace-1',
      operation: 'provider.generate',
      status: 'completed',
      occurredAt: wallClockTimestampMs(20),
      monotonicAt: monotonicTimestampMs(30),
      correlation: { requestId: 'model-1', sessionId: 'session-1' },
      durationMs: 10
    }
    const log: LogEvent = {
      level: 'info',
      eventCode: 'provider.completed',
      occurredAt: wallClockTimestampMs(20),
      requestId: 'model-1',
      durationMs: 10
    }
    await traceSink.writeTrace(trace)
    await logSink.writeLog(log)
    await eventPublisher.publish({
      eventId: 'event-1',
      type: 'session.started',
      occurredAt: wallClockTimestampMs(20),
      sessionId: 'session-1',
      payload: { state: 'running' }
    })

    let accepted: ShutdownNotice | undefined
    let resolveRequested: ((notice: ShutdownNotice) => void) | undefined
    const requested = new Promise<ShutdownNotice>((resolve) => {
      resolveRequested = resolve
    })
    const shutdown = {
      async requestOnce(notice): Promise<ShutdownReceipt> {
        const firstRequest = accepted === undefined
        if (firstRequest) {
          accepted = notice
          resolveRequested?.(notice)
        }
        return { notice: accepted ?? notice, firstRequest }
      },
      async whenRequested() {
        return await requested
      }
    } satisfies ProcessShutdownNotifier
    const notice: ShutdownNotice = {
      requestId: 'shutdown-1',
      reason: 'requested',
      requestedAt: wallClockTimestampMs(40),
      exitCode: 0
    }
    const first = await shutdown.requestOnce(notice)
    const second = await shutdown.requestOnce({ ...notice, requestId: 'shutdown-2' })

    expect(traces).toEqual([trace])
    expect(logs).toEqual([log])
    expect(events).toHaveLength(1)
    expect(first.firstRequest).toBe(true)
    expect(second).toEqual({ notice, firstRequest: false })
    expect(await shutdown.whenRequested()).toBe(notice)
  })
})
