import { Buffer } from 'node:buffer'

import {
  durationMs,
  providerFailure,
  wallClockTimestampMs,
  type AsrProvider,
  type AsrProviderEvent,
  type AsrRequest,
  type AsrTranscript,
  type ProviderCallContext,
  type ProviderCapabilityProbeRequest,
  type ProviderCapabilityProbeResult,
  type ProviderFailure,
  type ProviderHealthRequest,
  type ProviderHealthResult,
  type ProviderIdentity,
  type ProviderOutcome,
  type ProviderRoleModel
} from '../../application/ports'

export type StepFunAsrConfig = {
  readonly apiKey: string
  readonly provider: ProviderIdentity<'asr'>
  readonly roleModel: ProviderRoleModel<'asr'>
  readonly baseUrl?: string
  readonly language?: string
  readonly requestTimeoutMs?: number
  readonly maximumRetries?: number
  readonly retryBackoffMs?: number
}

export type StepFunAsrProviderDependencies = {
  readonly fetch?: StepFunFetch
  readonly sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>
  readonly monotonicNow?: () => number
  readonly wallClockNow?: () => number
}

export type StepFunFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>

type StepFunEvent = Record<string, unknown> & {
  readonly type: string
}

class StepFunAttemptError extends Error {
  constructor(readonly failure: ProviderFailure) {
    super(failure.messageCode)
  }
}

const DEFAULT_BASE_URL = 'https://api.stepfun.com/v1'
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_RETRY_BACKOFF_MS = 1_000

export class StepFunAsrProvider implements AsrProvider {
  readonly #apiKey: string
  readonly #provider: ProviderIdentity<'asr'>
  readonly #roleModel: ProviderRoleModel<'asr'>
  readonly #baseUrl: string
  readonly #language: string
  readonly #requestTimeoutMs: number
  readonly #maximumRetries: number
  readonly #retryBackoffMs: number
  readonly #fetch: StepFunFetch
  readonly #sleep: (delayMs: number, signal: AbortSignal) => Promise<void>
  readonly #monotonicNow: () => number
  readonly #wallClockNow: () => number

  constructor(
    config: StepFunAsrConfig,
    dependencies: StepFunAsrProviderDependencies = {}
  ) {
    if (config.apiKey.length === 0) throw new Error('StepFun API key is required')
    this.#apiKey = config.apiKey
    this.#provider = config.provider
    this.#roleModel = config.roleModel
    this.#baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.#language = config.language ?? 'zh'
    this.#requestTimeoutMs = positiveInteger(
      config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      'request timeout'
    )
    this.#maximumRetries = nonNegativeInteger(
      config.maximumRetries ?? 1,
      'maximum retries'
    )
    this.#retryBackoffMs = nonNegativeInteger(
      config.retryBackoffMs ?? DEFAULT_RETRY_BACKOFF_MS,
      'retry backoff'
    )
    this.#fetch = dependencies.fetch ?? globalThis.fetch
    this.#sleep = dependencies.sleep ?? abortableSleep
    this.#monotonicNow = dependencies.monotonicNow ?? (() => performance.now())
    this.#wallClockNow = dependencies.wallClockNow ?? (() => Date.now())
  }

  async health(
    request: ProviderHealthRequest,
    context: ProviderCallContext
  ): Promise<ProviderOutcome<ProviderHealthResult>> {
    const failure = this.#preflight(request.provider, undefined, context)
    if (failure) return { ok: false, error: failure }
    return {
      ok: true,
      value: {
        provider: this.#provider,
        status: 'healthy',
        checkedAt: wallClockTimestampMs(this.#wallClockNow()),
        latency: { totalMs: durationMs(0) }
      }
    }
  }

  async probeCapabilities(
    request: ProviderCapabilityProbeRequest,
    context: ProviderCallContext
  ): Promise<ProviderOutcome<ProviderCapabilityProbeResult>> {
    const failure = this.#preflight(request.provider, undefined, context)
    if (failure) return { ok: false, error: failure }
    const checks = request.capabilities.map((capability) => ({
      capability,
      status: capability === 'speech_recognition' ? 'passed' as const : 'failed' as const,
      roleModel: this.#roleModel,
      ...(capability === 'speech_recognition'
        ? {}
        : {
            failure: providerFailure({
              code: 'unsupported_capability',
              source: 'advx',
              retryable: false
            })
          })
    }))
    const passed = checks.every((check) => check.status === 'passed')
    return {
      ok: true,
      value: {
        provider: this.#provider,
        status: passed ? 'passed' : 'failed',
        checkedAt: wallClockTimestampMs(this.#wallClockNow()),
        latency: { totalMs: durationMs(0) },
        discoveredModelIds: [this.#roleModel.modelId],
        checks
      }
    }
  }

  async *transcribe(
    request: AsrRequest,
    context: ProviderCallContext
  ): AsyncIterable<AsrProviderEvent> {
    const preflight = this.#preflight(request.provider, request, context)
    if (preflight) {
      yield { type: 'failed', requestId: request.requestId, error: preflight }
      return
    }

    const seenEvents = new Map<string, string>()
    let lastSequence = -1
    let revision = 0
    let terminalFailure: ProviderFailure | undefined

    for (let attempt = 0; attempt <= this.#maximumRetries; attempt += 1) {
      try {
        for await (const event of this.#transcribeAttempt(request, context)) {
          const sequence = optionalNonNegativeInteger(event.sequence, 'SSE sequence')
          const identity = eventIdentity(event)
          const serialized = JSON.stringify(event)
          if (identity !== undefined) {
            const prior = seenEvents.get(identity)
            if (prior !== undefined) {
              if (prior !== serialized) throw protocolFailure('conflicting duplicate SSE event')
              continue
            }
            seenEvents.set(identity, serialized)
          }
          if (sequence !== undefined) {
            if (sequence <= lastSequence) throw protocolFailure('out-of-order SSE event')
            lastSequence = sequence
          }

          const providerRequestId = eventProviderRequestId(event)
          if (event.type === 'transcript.text.delta') {
            const text = event.delta
            if (typeof text !== 'string' || text.length === 0) continue
            revision += 1
            yield {
              type: 'transcript',
              transcript: transcriptFor(
                request,
                text,
                false,
                revision,
                providerRequestId,
                event
              )
            }
            continue
          }
          if (event.type === 'transcript.text.done') {
            if (typeof event.text !== 'string') {
              throw protocolFailure('final SSE event is missing transcript text')
            }
            revision += 1
            yield {
              type: 'transcript',
              transcript: transcriptFor(
                request,
                event.text,
                true,
                revision,
                providerRequestId,
                event
              )
            }
            return
          }
          if (event.type === 'error') {
            throw new StepFunAttemptError(
              providerFailure({
                code: 'provider_error',
                source: 'provider',
                retryable: false,
                providerRequestId
              })
            )
          }
        }
        throw new StepFunAttemptError(
          providerFailure({
            code: 'network_error',
            source: 'transport',
            retryable: true
          })
        )
      } catch (error) {
        terminalFailure = normalizeAttemptError(error, request, context)
        if (!terminalFailure.retryable || attempt >= this.#maximumRetries) break
        try {
          await this.#sleep(
            terminalFailure.retryAfterMs ?? this.#retryBackoffMs * (2 ** attempt),
            context.callerSignal
          )
        } catch {
          terminalFailure = cancellationFailure(context)
          break
        }
      }
    }

    yield {
      type: 'failed',
      requestId: request.requestId,
      error: terminalFailure ?? providerFailure({
        code: 'unknown',
        source: 'advx',
        retryable: false
      })
    }
  }

  async *#transcribeAttempt(
    request: AsrRequest,
    context: ProviderCallContext
  ): AsyncIterable<StepFunEvent> {
    const attempt = attemptSignal(
      context,
      this.#requestTimeoutMs,
      this.#monotonicNow()
    )
    try {
      const response = await this.#fetch(`${this.#baseUrl}/audio/asr/sse`, {
        method: 'POST',
        headers: {
          Accept: 'text/event-stream',
          Authorization: `Bearer ${this.#apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          audio: {
            data: Buffer.from(request.pcm).toString('base64'),
            input: {
              transcription: {
                model: request.roleModel.modelId,
                language: request.language ?? this.#language,
                enable_itn: true,
                enable_timestamp: true
              },
              format: {
                type: 'pcm',
                codec: 'pcm_s16le',
                rate: request.format.sampleRateHz,
                bits: request.format.sampleWidthBits,
                channel: request.format.channels
              }
            }
          }
        }),
        signal: attempt.signal
      })
      if (!response.ok) {
        throw new StepFunAttemptError(httpFailure(response))
      }
      if (!response.body) throw protocolFailure('SSE response has no body')
      for await (const event of parseSse(response.body)) yield event
    } catch (error) {
      if (error instanceof StepFunAttemptError) throw error
      if (attempt.timedOut()) {
        throw new StepFunAttemptError(providerFailure({
          code: 'timeout',
          source: 'advx',
          retryable: true
        }))
      }
      if (context.callerSignal.aborted) {
        throw new StepFunAttemptError(cancellationFailure(context))
      }
      throw new StepFunAttemptError(providerFailure({
        code: 'network_error',
        source: 'transport',
        retryable: true
      }))
    } finally {
      attempt.cleanup()
    }
  }

  #preflight(
    provider: ProviderIdentity,
    request: AsrRequest | undefined,
    context: ProviderCallContext
  ): ProviderFailure | undefined {
    if (context.callerSignal.aborted || context.cancellationReason() !== undefined) {
      return cancellationFailure(context)
    }
    if (
      provider.kind !== 'asr' ||
      provider.providerProfileId !== this.#provider.providerProfileId ||
      provider.providerRevision !== this.#provider.providerRevision ||
      (request !== undefined && (
        request.roleModel.role !== 'asr' ||
        request.roleModel.modelId !== this.#roleModel.modelId ||
        request.format.sampleRateHz !== 16_000 ||
        request.format.channels !== 1 ||
        request.format.sampleWidthBits !== 16 ||
        request.endedAt < request.startedAt
      ))
    ) {
      return providerFailure({
        code: 'invalid_request',
        source: 'advx',
        retryable: false
      })
    }
    return undefined
  }
}

async function* parseSse(
  stream: ReadableStream<Uint8Array>
): AsyncIterable<StepFunEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffered += decoder.decode(value, { stream: !done })
      const lines = buffered.split(/\r?\n/)
      buffered = lines.pop() ?? ''
      for (const line of lines) {
        const event = parseSseLine(line)
        if (event) yield event
      }
      if (done) break
    }
    const event = parseSseLine(buffered)
    if (event) yield event
  } finally {
    reader.releaseLock()
  }
}

function parseSseLine(line: string): StepFunEvent | undefined {
  if (!line.startsWith('data:')) return undefined
  const data = line.slice(5).trim()
  if (data.length === 0 || data === '[DONE]') return undefined
  let decoded: unknown
  try {
    decoded = JSON.parse(data)
  } catch {
    throw protocolFailure('invalid SSE JSON')
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
    throw protocolFailure('SSE event must be an object')
  }
  if (typeof (decoded as Record<string, unknown>).type !== 'string') {
    throw protocolFailure('SSE event is missing its type')
  }
  return decoded as StepFunEvent
}

function transcriptFor(
  request: AsrRequest,
  text: string,
  final: boolean,
  revision: number,
  providerRequestId: string | undefined,
  event: StepFunEvent
): AsrTranscript {
  const startedAt = eventTime(event.start_time, request.startedAt, request.startedAt)
  const endedAt = eventTime(event.end_time, request.startedAt, request.endedAt)
  if (endedAt < startedAt) throw protocolFailure('SSE transcript time range is reversed')
  return {
    requestId: request.requestId,
    responseId: `asr-response-${request.requestId}`,
    ...(providerRequestId === undefined ? {} : { providerRequestId }),
    sessionId: request.sessionId,
    source: request.source,
    text,
    startedAt,
    endedAt,
    final,
    utteranceId: `asr-${request.source}-${request.requestId}`,
    revision
  }
}

function eventTime(
  value: unknown,
  offset: AsrRequest['startedAt'],
  fallback: AsrRequest['startedAt']
): AsrRequest['startedAt'] {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    return fallback
  }
  return wallClockTimestampMs(offset + value)
}

function eventIdentity(event: StepFunEvent): string | undefined {
  const identity = event.event_id ?? event.id
  return typeof identity === 'string' && identity.length > 0 ? identity : undefined
}

function eventProviderRequestId(event: StepFunEvent): string | undefined {
  const identity = event.request_id
  return typeof identity === 'string' && identity.length > 0 ? identity : undefined
}

function optionalNonNegativeInteger(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw protocolFailure(`${name} must be a non-negative integer`)
  }
  return value as number
}

function protocolFailure(message: string): StepFunAttemptError {
  return new StepFunAttemptError(providerFailure({
    code: 'protocol_error',
    source: 'protocol',
    retryable: false
  }))
}

function httpFailure(response: Response): ProviderFailure {
  const retryAfter = retryAfterMs(response.headers.get('Retry-After'))
  const common = {
    httpStatus: response.status,
    ...(retryAfter === undefined ? {} : { retryAfterMs: durationMs(retryAfter) })
  }
  if (response.status === 401) {
    return providerFailure({
      code: 'authentication_failed', source: 'provider', retryable: false, ...common
    })
  }
  if (response.status === 403) {
    return providerFailure({
      code: 'permission_denied', source: 'provider', retryable: false, ...common
    })
  }
  if (response.status === 429) {
    return providerFailure({
      code: 'rate_limited', source: 'provider', retryable: true, ...common
    })
  }
  if (response.status >= 500) {
    return providerFailure({
      code: 'provider_unavailable', source: 'provider', retryable: true, ...common
    })
  }
  return providerFailure({
    code: 'invalid_request', source: 'provider', retryable: false, ...common
  })
}

function retryAfterMs(value: string | null): number | undefined {
  if (value === null) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000)
  const date = Date.parse(value)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, date - Date.now())
}

function normalizeAttemptError(
  error: unknown,
  request: AsrRequest,
  context: ProviderCallContext
): ProviderFailure {
  if (context.callerSignal.aborted || context.cancellationReason() !== undefined) {
    return cancellationFailure(context)
  }
  if (error instanceof StepFunAttemptError) return error.failure
  void request
  return providerFailure({ code: 'unknown', source: 'advx', retryable: false })
}

function cancellationFailure(context: ProviderCallContext): ProviderFailure {
  const timedOut = context.cancellationReason()?.code === 'deadline_exceeded'
  return providerFailure({
    code: timedOut ? 'timeout' : 'aborted',
    source: timedOut ? 'advx' : 'caller',
    retryable: timedOut
  })
}

function attemptSignal(
  context: ProviderCallContext,
  requestTimeoutMs: number,
  now: number
): {
  readonly signal: AbortSignal
  readonly timedOut: () => boolean
  readonly cleanup: () => void
} {
  const controller = new AbortController()
  let timeoutTriggered = false
  const remaining = Math.max(0, context.deadline.expiresAt - now)
  const timeoutMs = Math.min(requestTimeoutMs, remaining)
  const timeout = setTimeout(() => {
    timeoutTriggered = true
    controller.abort('timeout')
  }, timeoutMs)
  const onAbort = () => controller.abort(context.callerSignal.reason)
  context.callerSignal.addEventListener('abort', onAbort, { once: true })
  if (context.callerSignal.aborted) onAbort()
  return {
    signal: controller.signal,
    timedOut: () => timeoutTriggered,
    cleanup: () => {
      clearTimeout(timeout)
      context.callerSignal.removeEventListener('abort', onAbort)
    }
  }
}

function abortableSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, delayMs)
    const onAbort = () => {
      clearTimeout(timeout)
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`)
  }
  return value
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`)
  }
  return value
}
