import type { RoomId, SessionId } from '@advx/contracts'

import type { MonotonicTimestampMs, WallClockTimestampMs } from './time'

export type TraceStatus = 'started' | 'completed' | 'cancelled' | 'failed'

export type TraceCorrelation = {
  readonly requestId?: string
  readonly roomId?: RoomId
  readonly sessionId?: SessionId
  readonly backendStartId?: string
  readonly epoch?: number
  readonly sequence?: number
  readonly observationId?: string
  readonly generationId?: string
}

export type TraceContext = Readonly<{
  readonly traceId: string
  readonly correlation: TraceCorrelation
}>

export type TraceContextInput = Readonly<{
  readonly traceId?: string
  readonly correlation?: TraceCorrelation
}>

export function createTraceContext(input: TraceContextInput = {}): TraceContext {
  const traceId = boundedTraceId(input.traceId ?? `trace-${crypto.randomUUID()}`)
  return Object.freeze({
    traceId,
    correlation: Object.freeze({ ...(input.correlation ?? {}) })
  })
}

export function withTraceCorrelation(
  context: TraceContext,
  correlation: TraceCorrelation
): TraceContext {
  return Object.freeze({
    traceId: context.traceId,
    correlation: Object.freeze({ ...context.correlation, ...correlation })
  })
}

export function traceContextFromRequest(
  request: Request,
  backendStartId: string,
  correlation: TraceCorrelation = {}
): TraceContext {
  const requestId = request.headers.get('x-request-id')
  const traceId = request.headers.get('x-advx-trace-id')
  const candidate = traceId !== null && validTraceId(traceId)
    ? traceId
    : requestId !== null && validTraceId(requestId)
      ? `http-${requestId}`
      : undefined
  return createTraceContext({
    traceId: candidate,
    correlation: {
      ...correlation,
      backendStartId,
      ...(requestId === null ? {} : { requestId })
    }
  })
}

function validTraceId(value: string): boolean {
  const normalized = value.trim()
  return normalized.length > 0 && normalized.length <= 128 && !normalized.includes('\0')
}

function boundedTraceId(value: string): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 128 || normalized.includes('\0')) {
    throw new RangeError('trace ID must contain 1 to 128 characters')
  }
  return normalized
}

export type TraceEvent = {
  readonly traceId: string
  readonly operation: string
  readonly status: TraceStatus
  readonly occurredAt: WallClockTimestampMs
  readonly monotonicAt: MonotonicTimestampMs
  readonly correlation: TraceCorrelation
  readonly context?: TraceContext
  readonly durationMs?: number
  readonly errorCode?: string
}

export interface TraceSink {
  writeTrace(event: TraceEvent): Promise<void>
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type LogEvent = {
  readonly level: LogLevel
  readonly eventCode: string
  readonly occurredAt: WallClockTimestampMs
  readonly requestId?: string
  readonly roomId?: RoomId
  readonly sessionId?: SessionId
  readonly taskId?: string
  readonly errorCode?: string
  readonly durationMs?: number
  readonly itemCount?: number
}

export interface LogSink {
  writeLog(event: LogEvent): Promise<void>
}
