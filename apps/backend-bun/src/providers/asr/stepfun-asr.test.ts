import { describe, expect, test } from 'bun:test'

import {
  durationMs,
  monotonicDeadline,
  providerFailure,
  providerRevision,
  wallClockTimestampMs,
  type AsrProvider,
  type AsrProviderEvent,
  type AsrRequest,
  type AsrTranscript,
  type AudioSource,
  type ProviderCallContext,
  type ProviderIdentity,
  type ProviderRoleModel
} from '../../application/ports'
import {
  AsrTurnCoordinator,
  type AsrObservation,
  type AsrRuntimeSink,
  type AsrScheduler,
  type CoordinatedAsrTranscript
} from '../../application/services/asr-turn-coordinator'
import { DualChannelAsr, type AsrAudioChunk } from './dual-channel-asr'
import { StepFunAsrProvider, type StepFunFetch } from './stepfun-asr-provider'

const identity: ProviderIdentity<'asr'> = {
  kind: 'asr',
  providerProfileId: 'stepfun-profile',
  providerRevision: providerRevision('revision-1')
}
const roleModel: ProviderRoleModel<'asr'> = {
  role: 'asr',
  modelId: 'stepaudio-2.5-asr'
}

describe('AGT-002 StepFun ASR provider', () => {
  test('maps a recorded SSE partial and final into the normalized contract', async () => {
    let captured: RequestInit | undefined
    const provider = stepFunProvider(async (_input, init) => {
      captured = init
      return sseResponse([
        { type: 'transcript.text.delta', event_id: 'p1', sequence: 1, delta: '你' },
        {
          type: 'transcript.text.done',
          event_id: 'f1',
          sequence: 2,
          request_id: 'upstream-1',
          text: '你好'
        }
      ])
    })

    const events = await collect(provider.transcribe(asrRequest('normal'), callContext()))

    expect(events.map((event) => event.type)).toEqual(['transcript', 'transcript'])
    expect(events[0]).toMatchObject({
      type: 'transcript',
      transcript: { text: '你', final: false, revision: 1, source: 'microphone' }
    })
    expect(events[1]).toMatchObject({
      type: 'transcript',
      transcript: {
        text: '你好',
        final: true,
        revision: 2,
        utteranceId: 'asr-microphone-normal',
        providerRequestId: 'upstream-1'
      }
    })
    expect(captured?.headers).toMatchObject({ Authorization: 'Bearer test-key' })
    const body = JSON.parse(String(captured?.body))
    expect(body.audio.input.transcription.model).toBe('stepaudio-2.5-asr')
    expect(body.audio.input.format).toEqual({
      type: 'pcm', codec: 'pcm_s16le', rate: 16_000, bits: 16, channel: 1
    })
  })

  test('rejects malformed and out-of-order SSE while deduplicating an exact replay', async () => {
    const malformed = stepFunProvider(async () => new Response('data: {bad}\n'))
    const malformedEvents = await collect(
      malformed.transcribe(asrRequest('malformed'), callContext())
    )
    expect(malformedEvents.at(-1)).toMatchObject({
      type: 'failed', error: { code: 'protocol_error', retryable: false }
    })

    const duplicate = stepFunProvider(async () => sseResponse([
      { type: 'transcript.text.delta', event_id: 'p1', sequence: 1, delta: '重' },
      { type: 'transcript.text.delta', event_id: 'p1', sequence: 1, delta: '重' },
      { type: 'transcript.text.done', event_id: 'f1', sequence: 2, text: '重复' }
    ]))
    const duplicateEvents = await collect(
      duplicate.transcribe(asrRequest('duplicate'), callContext())
    )
    expect(duplicateEvents.filter((event) => event.type === 'transcript')).toHaveLength(2)
    expect(duplicateEvents.at(-1)).toMatchObject({
      type: 'transcript', transcript: { text: '重复', final: true }
    })

    const outOfOrder = stepFunProvider(async () => sseResponse([
      { type: 'transcript.text.delta', event_id: 'p2', sequence: 2, delta: '先' },
      { type: 'transcript.text.done', event_id: 'f1', sequence: 1, text: '后' }
    ]))
    const outOfOrderEvents = await collect(
      outOfOrder.transcribe(asrRequest('out-of-order'), callContext())
    )
    expect(outOfOrderEvents.at(-1)).toMatchObject({
      type: 'failed', error: { code: 'protocol_error' }
    })
  })

  test('normalizes 401 and retries 429, 5xx, and a disconnected recorded stream', async () => {
    let unauthorizedCalls = 0
    const unauthorized = stepFunProvider(async () => {
      unauthorizedCalls += 1
      return new Response(null, { status: 401 })
    })
    expect((await collect(
      unauthorized.transcribe(asrRequest('401'), callContext())
    )).at(-1)).toMatchObject({
      type: 'failed', error: { code: 'authentication_failed', retryable: false }
    })
    expect(unauthorizedCalls).toBe(1)

    for (const status of [429, 503]) {
      let calls = 0
      const provider = stepFunProvider(async () => {
        calls += 1
        return calls === 1
          ? new Response(null, { status, headers: { 'Retry-After': '0' } })
          : sseResponse([
              { type: 'transcript.text.done', event_id: 'f1', sequence: 1, text: `ok-${status}` }
            ])
      })
      const events = await collect(provider.transcribe(asrRequest(String(status)), callContext()))
      expect(events.at(-1)).toMatchObject({
        type: 'transcript', transcript: { text: `ok-${status}`, final: true }
      })
      expect(calls).toBe(2)
    }

    let disconnectCalls = 0
    const disconnect = stepFunProvider(async () => {
      disconnectCalls += 1
      return disconnectCalls === 1
        ? disconnectingSseResponse({
            type: 'transcript.text.delta', event_id: 'p1', sequence: 1, delta: '断'
          })
        : sseResponse([
            { type: 'transcript.text.delta', event_id: 'p1', sequence: 1, delta: '断' },
            { type: 'transcript.text.done', event_id: 'f1', sequence: 2, text: '断线恢复' }
          ])
    })
    const recovered = await collect(
      disconnect.transcribe(asrRequest('disconnect'), callContext())
    )
    expect(recovered.filter((event) => event.type === 'transcript')).toHaveLength(2)
    expect(recovered.at(-1)).toMatchObject({
      type: 'transcript', transcript: { text: '断线恢复', final: true }
    })
    expect(disconnectCalls).toBe(2)
  })
})

describe('AGT-002 isolated channels and segmentation', () => {
  test('submits system audio at 0.8 seconds of silence and at the eight-second bound', async () => {
    const harness = runtimeHarness()
    await harness.runtime.push(chunk('system_audio', 0, 100, 3_200))
    await harness.scheduler.advanceTo(899)
    expect(harness.system.requests).toHaveLength(0)
    await harness.scheduler.advanceTo(900)
    expect(harness.system.requests).toHaveLength(1)
    expect(harness.system.requests[0]).toMatchObject({ startedAt: 0, endedAt: 100 })

    const long = runtimeHarness()
    await long.runtime.push(chunk('system_audio', 0, 9_000, 288_000))
    expect(long.system.requests).toHaveLength(1)
    expect(long.system.requests[0]).toMatchObject({ startedAt: 0, endedAt: 8_000 })
    await long.scheduler.advanceTo(9_800)
    expect(long.system.requests).toHaveLength(2)
    expect(long.system.requests[1]).toMatchObject({ startedAt: 8_000, endedAt: 9_000 })
  })

  test('keeps channel failures isolated and preserves independent status', async () => {
    const harness = runtimeHarness({ microphoneFailure: true })
    await harness.runtime.push(chunk('microphone', 0, 100, 3_200))
    await harness.runtime.push(chunk('system_audio', 0, 100, 3_200))
    await harness.runtime.flush('microphone')
    await harness.runtime.flush('system_audio')

    expect(harness.runtime.status('microphone')).toMatchObject({
      source: 'microphone', phase: 'error', lastFailure: { code: 'provider_unavailable' }
    })
    expect(harness.runtime.status('system_audio')).toMatchObject({
      source: 'system_audio', phase: 'idle', lastFinal: { final: true }
    })
    expect(harness.sink.finals).toHaveLength(1)
    expect(harness.sink.observations).toHaveLength(1)
  })

  test('cancels active work on stop and ignores a malicious late final', async () => {
    const scheduler = new ManualScheduler()
    const sink = new RecordingSink()
    const coordinator = new AsrTurnCoordinator(sink, scheduler)
    const late = new FakeAsrProvider(async function* (request, context) {
      await aborted(context.callerSignal)
      yield finalEvent(request, 'late')
    })
    const runtime = new DualChannelAsr(
      { provider: identity, roleModel },
      {
        providers: { microphone: late, system_audio: new FakeAsrProvider(echoFinal) },
        coordinator,
        scheduler,
        requestId: () => 'late-request',
        monotonicNow: () => scheduler.now()
      }
    )
    await runtime.push(chunk('microphone', 0, 100, 3_200))
    const flushing = runtime.flush('microphone')
    await Promise.resolve()
    await runtime.stop()
    await flushing

    expect(sink.finals).toHaveLength(0)
    expect(sink.observations).toHaveLength(0)
    expect(runtime.status('microphone').phase).toBe('stopped')
  })

  test('reconnects one coordinated channel without duplicating its final or wave', async () => {
    const scheduler = new ManualScheduler()
    const sink = new RecordingSink()
    const coordinator = new AsrTurnCoordinator(sink, scheduler)
    let microphoneCalls = 0
    const microphone = new FakeAsrProvider(async function* (request, context) {
      microphoneCalls += 1
      if (microphoneCalls === 1) await aborted(context.callerSignal)
      yield finalEvent(request, 'microphone-final')
    })
    const system = new FakeAsrProvider(echoFinal)
    let requestSequence = 0
    const runtime = new DualChannelAsr(
      { provider: identity, roleModel },
      {
        providers: { microphone, system_audio: system },
        coordinator,
        scheduler,
        requestId: (source) => `${source}-${++requestSequence}`,
        monotonicNow: () => scheduler.now()
      }
    )
    const paired = { turnId: 'turn-reconnect', systemAudioRequired: true }
    await runtime.push(chunk('microphone', 0, 100, 3_200, paired))
    const interrupted = runtime.flush('microphone')
    await Promise.resolve()
    await runtime.reconnect('microphone')
    await interrupted

    await runtime.push(chunk('microphone', 0, 100, 3_200, paired))
    await runtime.push(chunk('system_audio', 0, 100, 3_200, { turnId: paired.turnId }))
    await runtime.flush('microphone')
    await runtime.flush('system_audio')
    await scheduler.advanceTo(1_600)

    expect(sink.finals).toHaveLength(2)
    expect(sink.finals.every((final) => final.turnId === paired.turnId)).toBe(true)
    expect(sink.observations).toEqual([{
      sessionId: 'session-1',
      triggerEventIds: ['event-1', 'event-2'],
      turnId: paired.turnId
    }])
    expect(runtime.status('microphone').reconnectCount).toBe(1)
  })
})

describe('AGT-002 final-only turn coordination', () => {
  test('keeps partials UI-only and waits for the full 1.5-second microphone pause', async () => {
    const scheduler = new ManualScheduler(900)
    const sink = new RecordingSink()
    const coordinator = new AsrTurnCoordinator(sink, scheduler)
    await coordinator.accept({ transcript: transcript('microphone', false, 'partial', 100) })
    await coordinator.accept({ transcript: transcript('microphone', true, 'mic-1', 100) })
    expect(sink.partials).toHaveLength(1)
    expect(sink.finals).toHaveLength(1)
    expect(sink.observations).toHaveLength(0)

    await scheduler.advanceTo(1_000)
    coordinator.notifyVoiceActivity('session-1')
    await scheduler.advanceTo(1_600)
    expect(sink.observations).toHaveLength(0)
    await coordinator.accept({ transcript: transcript('microphone', true, 'mic-2', 1_000) })
    await scheduler.advanceTo(2_499)
    expect(sink.observations).toHaveLength(0)
    await scheduler.advanceTo(2_500)
    expect(sink.observations).toEqual([{
      sessionId: 'session-1', triggerEventIds: ['event-1', 'event-2']
    }])
  })

  test('pairs one turn into one wave and degrades once when required system audio is late', async () => {
    const scheduler = new ManualScheduler(100)
    const sink = new RecordingSink()
    const coordinator = new AsrTurnCoordinator(sink, scheduler)

    await coordinator.accept({
      transcript: transcript('system_audio', true, 'paired-system', 90),
      turnId: 'turn-paired'
    })
    await coordinator.accept({
      transcript: transcript('microphone', true, 'paired-mic', 100),
      turnId: 'turn-paired',
      systemAudioRequired: true
    })
    await scheduler.advanceTo(1_599)
    expect(sink.observations).toHaveLength(0)
    await scheduler.advanceTo(1_600)
    expect(sink.observations).toEqual([{
      sessionId: 'session-1',
      triggerEventIds: ['event-1', 'event-2'],
      turnId: 'turn-paired'
    }])

    await coordinator.accept({
      transcript: transcript('microphone', true, 'degraded-mic', 2_000),
      turnId: 'turn-degraded',
      systemAudioRequired: true
    })
    await scheduler.advanceTo(4_599)
    expect(sink.observations).toHaveLength(1)
    await scheduler.advanceTo(4_600)
    expect(sink.observations[1]).toEqual({
      sessionId: 'session-1',
      triggerEventIds: ['event-3'],
      turnId: 'turn-degraded',
      systemAudioDegraded: true
    })
    await coordinator.accept({
      transcript: transcript('system_audio', true, 'late-system-reconnect', 2_050),
      turnId: 'turn-degraded'
    })
    await coordinator.accept({
      transcript: transcript('system_audio', true, 'late-system', 2_050),
      turnId: 'turn-degraded'
    })
    await scheduler.advanceTo(10_000)
    expect(sink.finals).toHaveLength(4)
    expect(sink.finals[3]).toMatchObject({ turnId: 'turn-degraded' })
    expect(sink.observations).toHaveLength(2)
  })

  test('deduplicates a system final whose persistence spans turn degradation', async () => {
    const scheduler = new ManualScheduler()
    const sink = new DeferredSystemSink()
    const coordinator = new AsrTurnCoordinator(sink, scheduler)
    await coordinator.accept({
      transcript: transcript('microphone', true, 'degraded-mic', 100),
      turnId: 'turn-in-flight-degraded',
      systemAudioRequired: true
    })

    const systemPending = sink.deferOneSystemFinal()
    const pendingFinal = coordinator.accept({
      transcript: transcript('system_audio', true, 'system-pending', 150),
      turnId: 'turn-in-flight-degraded'
    })
    await systemPending
    await scheduler.advanceTo(3_000)
    sink.releaseSystemFinal()
    await pendingFinal

    await coordinator.accept({
      transcript: transcript('system_audio', true, 'system-reconnect', 150),
      turnId: 'turn-in-flight-degraded'
    })

    expect(sink.finals.filter((final) => final.transcript.source === 'system_audio')).toHaveLength(1)
    expect(sink.observations).toEqual([{
      sessionId: 'session-1',
      triggerEventIds: ['event-1'],
      turnId: 'turn-in-flight-degraded',
      systemAudioDegraded: true
    }])
  })

  test('drops cancelled finals and deduplicates a reconnected source before persistence', async () => {
    const scheduler = new ManualScheduler()
    const sink = new RecordingSink()
    const coordinator = new AsrTurnCoordinator(sink, scheduler)
    await coordinator.accept({ transcript: transcript('system_audio', true, 'standalone', 10) })
    expect(sink.observations).toHaveLength(1)

    const cancelled: CoordinatedAsrTranscript = {
      transcript: transcript('microphone', true, 'cancelled-late', 20),
      turnId: 'turn-cancelled',
      systemAudioRequired: true
    }
    coordinator.cancelTurn('session-1', 'turn-cancelled')
    await coordinator.accept(cancelled)
    await coordinator.accept({
      ...cancelled,
      transcript: transcript('microphone', true, 'cancelled-reconnect', 20)
    })

    const reconnected: CoordinatedAsrTranscript = {
      transcript: transcript('microphone', true, 'reconnect-first', 30),
      turnId: 'turn-reconnect',
      systemAudioRequired: false
    }
    await coordinator.accept(reconnected)
    await coordinator.accept({
      ...reconnected,
      transcript: transcript('microphone', true, 'reconnect-retry', 30)
    })
    await scheduler.advanceTo(10_000)
    expect(sink.finals).toHaveLength(2)
    expect(sink.finals[1]?.turnId).toBe('turn-reconnect')
    expect(sink.observations).toEqual([
      { sessionId: 'session-1', triggerEventIds: ['event-1'] },
      {
        sessionId: 'session-1',
        triggerEventIds: ['event-2'],
        turnId: 'turn-reconnect'
      }
    ])
  })
})

class FakeAsrProvider implements AsrProvider {
  readonly requests: AsrRequest[] = []

  constructor(
    readonly handler: (
      request: AsrRequest,
      context: ProviderCallContext
    ) => AsyncIterable<AsrProviderEvent>
  ) {}

  async health(): Promise<never> {
    throw new Error('not used by focused ASR tests')
  }

  async probeCapabilities(): Promise<never> {
    throw new Error('not used by focused ASR tests')
  }

  async *transcribe(
    request: AsrRequest,
    context: ProviderCallContext
  ): AsyncIterable<AsrProviderEvent> {
    this.requests.push(request)
    yield* this.handler(request, context)
  }
}

class RecordingSink implements AsrRuntimeSink {
  readonly partials: CoordinatedAsrTranscript[] = []
  readonly finals: (CoordinatedAsrTranscript & { eventId: string })[] = []
  readonly observations: AsrObservation[] = []

  async publishPartial(input: CoordinatedAsrTranscript): Promise<void> {
    this.partials.push(input)
  }

  async persistFinal(input: CoordinatedAsrTranscript): Promise<{ eventId: string }> {
    const eventId = `event-${this.finals.length + 1}`
    this.finals.push({ ...input, eventId })
    return { eventId }
  }

  async createObservation(input: AsrObservation): Promise<void> {
    this.observations.push(input)
  }
}

class DeferredSystemSink extends RecordingSink {
  #deferSystem = false
  #systemPending: (() => void) | undefined
  #releaseSystem: (() => void) | undefined

  override async persistFinal(
    input: CoordinatedAsrTranscript
  ): Promise<{ eventId: string }> {
    if (this.#deferSystem && input.transcript.source === 'system_audio') {
      this.#deferSystem = false
      this.#systemPending?.()
      await new Promise<void>((resolve) => { this.#releaseSystem = resolve })
    }
    return super.persistFinal(input)
  }

  deferOneSystemFinal(): Promise<void> {
    this.#deferSystem = true
    return new Promise((resolve) => { this.#systemPending = resolve })
  }

  releaseSystemFinal(): void {
    this.#releaseSystem?.()
  }
}

class ManualScheduler implements AsrScheduler {
  #now: number
  readonly #tasks: Array<{
    at: number
    cancelled: boolean
    callback: () => Promise<void>
  }> = []

  constructor(now = 0) {
    this.#now = now
  }

  now(): number {
    return this.#now
  }

  schedule(delayMs: number, callback: () => Promise<void>) {
    const task = { at: this.#now + delayMs, cancelled: false, callback }
    this.#tasks.push(task)
    return { cancel: () => { task.cancelled = true } }
  }

  async advanceTo(target: number): Promise<void> {
    while (true) {
      const next = this.#tasks
        .filter((task) => !task.cancelled && task.at <= target)
        .sort((left, right) => left.at - right.at)[0]
      if (!next) break
      next.cancelled = true
      this.#now = next.at
      await next.callback()
    }
    this.#now = target
  }
}

function runtimeHarness(options: { microphoneFailure?: boolean } = {}) {
  const scheduler = new ManualScheduler()
  const sink = new RecordingSink()
  const coordinator = new AsrTurnCoordinator(sink, scheduler)
  const microphone = new FakeAsrProvider(
    options.microphoneFailure
      ? async function* (request) {
          yield {
            type: 'failed',
            requestId: request.requestId,
            error: providerFailure({
              code: 'provider_unavailable', source: 'provider', retryable: true
            })
          }
        }
      : echoFinal
  )
  const system = new FakeAsrProvider(echoFinal)
  let requestSequence = 0
  const runtime = new DualChannelAsr(
    { provider: identity, roleModel },
    {
      providers: { microphone, system_audio: system },
      coordinator,
      scheduler,
      requestId: (source) => `${source}-${++requestSequence}`,
      monotonicNow: () => scheduler.now()
    }
  )
  return { runtime, scheduler, sink, microphone, system }
}

async function* echoFinal(request: AsrRequest): AsyncIterable<AsrProviderEvent> {
  yield finalEvent(request, `${request.source}-final`)
}

function finalEvent(request: AsrRequest, text: string): AsrProviderEvent {
  return {
    type: 'transcript',
    transcript: {
      requestId: request.requestId,
      responseId: `response-${request.requestId}`,
      sessionId: request.sessionId,
      source: request.source,
      text,
      startedAt: request.startedAt,
      endedAt: request.endedAt,
      final: true,
      utteranceId: `utterance-${request.requestId}`,
      revision: 1
    }
  }
}

function transcript(
  source: AudioSource,
  final: boolean,
  utteranceId: string,
  endedAt: number
): AsrTranscript {
  return {
    requestId: utteranceId,
    responseId: `response-${utteranceId}`,
    sessionId: 'session-1',
    source,
    text: utteranceId,
    startedAt: wallClockTimestampMs(0),
    endedAt: wallClockTimestampMs(endedAt),
    final,
    utteranceId,
    revision: 1
  }
}

function chunk(
  source: AudioSource,
  startedAt: number,
  endedAt: number,
  byteLength: number,
  coordination: { readonly turnId?: string; readonly systemAudioRequired?: boolean } = {}
): AsrAudioChunk {
  return {
    sessionId: 'session-1',
    source,
    startedAt: wallClockTimestampMs(startedAt),
    endedAt: wallClockTimestampMs(endedAt),
    format: { sampleRateHz: 16_000, channels: 1, sampleWidthBits: 16 },
    pcm: new Uint8Array(byteLength),
    ...coordination
  }
}

function asrRequest(requestId: string): AsrRequest {
  return {
    requestId,
    provider: identity,
    roleModel,
    sessionId: 'session-1',
    source: 'microphone',
    startedAt: wallClockTimestampMs(100),
    endedAt: wallClockTimestampMs(200),
    format: { sampleRateHz: 16_000, channels: 1, sampleWidthBits: 16 },
    pcm: new Uint8Array([1, 2, 3, 4])
  }
}

function callContext(signal = new AbortController().signal): ProviderCallContext {
  return {
    callerSignal: signal,
    deadline: monotonicDeadline(60_000),
    cancellationReason: () => signal.aborted ? { code: 'caller_cancelled' } : undefined
  }
}

function stepFunProvider(fetch: StepFunFetch): StepFunAsrProvider {
  return new StepFunAsrProvider(
    {
      apiKey: 'test-key',
      provider: identity,
      roleModel,
      maximumRetries: 1,
      retryBackoffMs: 0
    },
    {
      fetch,
      sleep: async () => undefined,
      monotonicNow: () => 0,
      wallClockNow: () => 1
    }
  )
}

function sseResponse(events: readonly Record<string, unknown>[]): Response {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n`).join(''), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' }
  })
}

function disconnectingSseResponse(event: Record<string, unknown>): Response {
  const bytes = new TextEncoder().encode(`data: ${JSON.stringify(event)}\n`)
  let read = false
  return new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!read) {
        read = true
        controller.enqueue(bytes)
      } else {
        controller.error(new Error('recorded disconnect'))
      }
    }
  }))
}

async function collect(iterable: AsyncIterable<AsrProviderEvent>): Promise<AsrProviderEvent[]> {
  const events: AsrProviderEvent[] = []
  for await (const event of iterable) events.push(event)
  return events
}

function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }))
}
