import type { MonotonicDeadline } from './time'
import type { TraceContext } from './observability'

export type CancellationReasonCode =
  | 'caller_cancelled'
  | 'deadline_exceeded'
  | 'session_stopped'
  | 'runtime_replaced'
  | 'process_shutdown'

export type CancellationReason = {
  readonly code: CancellationReasonCode
  readonly messageCode?: string
}

export interface TaskCancellation {
  readonly signal: AbortSignal
  reason(): CancellationReason | undefined
  throwIfCancelled(): void
}

export interface TaskExecutionContext extends TaskCancellation {
  readonly deadline?: MonotonicDeadline
}

export type ScopedTask<TResult> = {
  readonly name: string
  readonly deadline?: MonotonicDeadline
  run(context: TaskExecutionContext): Promise<TResult>
}

export interface TaskHandle<TResult> {
  readonly taskId: string
  readonly result: Promise<TResult>
  cancel(reason: CancellationReason): void
}

export interface TaskScope {
  spawn<TResult>(task: ScopedTask<TResult>): TaskHandle<TResult>
  cancelAll(reason: CancellationReason): void
  drain(): Promise<void>
}

export type ProviderCallContext = {
  readonly callerSignal: AbortSignal
  readonly deadline: MonotonicDeadline
  cancellationReason(): CancellationReason | undefined
  readonly traceContext?: TraceContext
}
