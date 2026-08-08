import { VIEWER_GENERATION_SCHEMA_NAME, type SessionId } from '@advx/contracts'
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test
} from 'bun:test'
import { HttpResponse, delay, http, ws } from 'msw'
import { setupServer } from 'msw/node'

import {
  createModelRequestBudget,
  monotonicDeadline,
  protocolRepairAttempt,
  providerFailure,
  providerRevision,
  wallClockTimestampMs,
  type AsrProviderEvent,
  type AsrRequest,
  type ModelGenerationRequest,
  type ModelStreamEvent,
  type ProviderCallContext,
  type ProviderFailure,
  type ProviderIdentity,
  type ProviderRoleModel
} from '../application/ports'
import { ModelOutputValidationService } from '../application/services/model-output-validation'
import { StepFunAsrProvider } from '../providers/asr/stepfun-asr-provider'
import { AiSdkModelGateway } from '../providers/model/model-gateway'

const MODEL_SECRET = 'tst-005-model-secret'
const ASR_SECRET = 'tst-005-asr-secret'
const MODEL_BASE_URL = 'https://models.tst-005.invalid/v1'
const MODEL_ENDPOINT = `${MODEL_BASE_URL}/chat/completions`
const ASR_BASE_URL = 'https://asr.tst-005.invalid/v1'
const ASR_ENDPOINT = `${ASR_BASE_URL}/audio/asr/sse`
const WEBSOCKET_ENDPOINT = 'wss://provider.tst-005.invalid/events'

const modelIdentity: ProviderIdentity<'model'> = {
  kind: 'model',
  providerProfileId: 'tst-005-model',
  providerRevision: providerRevision('tst-005-model-revision')
}
const asrIdentity: ProviderIdentity<'asr'> = {
  kind: 'asr',
  providerProfileId: 'tst-005-asr',
  providerRevision: providerRevision('tst-005-asr-revision')
}
const modelRoles = {
  viewer: 'viewer-model-tst-005',
  memory: 'memory-model-tst-005',
  visual_summary: 'visual-model-tst-005'
} as const
const asrRole: ProviderRoleModel<'asr'> = {
  role: 'asr',
  modelId: 'stepaudio-tst-005'
}

const server = setupServer()

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

describe('TST-005 MSW Provider fault suite', () => {
  test('normalizes HTTP connection refusal for both active Provider adapters', async () => {
    server.use(
      http.post(MODEL_ENDPOINT, () => HttpResponse.error()),
      http.post(ASR_ENDPOINT, () => HttpResponse.error())
    )

    const model = await modelGateway().generate(
      generationRequest('connection-refused'),
      callContext(),
      createModelRequestBudget()
    )
    const asr = await collectAsr(
      asrProvider().transcribe(asrRequest('connection-refused'), callContext())
    )

    expect(model).toMatchObject({
      ok: false,
      error: { code: 'network_error', source: 'transport', retryable: true }
    })
    expect(asr.at(-1)).toMatchObject({
      type: 'failed',
      error: { code: 'network_error', source: 'transport', retryable: true }
    })
    assertNoSecrets(model, asr)
  })

  test('normalizes timeout and caller cancellation without retrying cancellation', async () => {
    let modelStartedResolve: (() => void) | undefined
    const modelStarted = new Promise<void>((resolve) => {
      modelStartedResolve = resolve
    })
    let asrStartedResolve: (() => void) | undefined
    const asrStarted = new Promise<void>((resolve) => {
      asrStartedResolve = resolve
    })
    server.use(
      http.post(MODEL_ENDPOINT, async () => {
        modelStartedResolve?.()
        await delay(150)
        return HttpResponse.json({ unreachable: true })
      }),
      http.post(ASR_ENDPOINT, async () => {
        asrStartedResolve?.()
        await delay(150)
        return new HttpResponse(null, {
          headers: { 'Content-Type': 'text/event-stream' }
        })
      })
    )

    const modelPending = modelGateway({ requestTimeoutMs: 25 }).generate(
      generationRequest('timeout'),
      callContext({ deadlineMs: 1_000 }),
      createModelRequestBudget()
    )
    await modelStarted
    const timedOut = await modelPending

    const controller = new AbortController()
    const asrPending = collectAsr(asrProvider({ requestTimeoutMs: 2_000 }).transcribe(
      asrRequest('cancelled'),
      callContext({ signal: controller.signal, deadlineMs: 5_000 })
    ))
    await asrStarted
    controller.abort('session-stopped')
    const cancelled = await asrPending

    expect(timedOut).toMatchObject({
      ok: false,
      error: { code: 'timeout', source: 'advx', retryable: true }
    })
    expect(cancelled.at(-1)).toMatchObject({
      type: 'failed',
      error: { code: 'aborted', source: 'caller', retryable: false }
    })
    assertNoSecrets(timedOut, cancelled)
  })

  test('normalizes 401, 403, 429, and 5xx with exact retry eligibility', async () => {
    let status = 401
    server.use(
      http.post(MODEL_ENDPOINT, () => upstreamError(status, MODEL_SECRET)),
      http.post(ASR_ENDPOINT, () => upstreamError(status, ASR_SECRET))
    )

    const cases = [
      { status: 401, code: 'authentication_failed', retryable: false },
      { status: 403, code: 'permission_denied', retryable: false },
      { status: 429, code: 'rate_limited', retryable: true },
      { status: 503, code: 'provider_unavailable', retryable: true }
    ] as const
    const results: unknown[] = []

    for (const expected of cases) {
      status = expected.status
      const model = await modelGateway().generate(
        generationRequest(`status-${status}`),
        callContext(),
        createModelRequestBudget()
      )
      const asr = await collectAsr(asrProvider().transcribe(
        asrRequest(`status-${status}`),
        callContext()
      ))
      expect(model).toMatchObject({
        ok: false,
        error: {
          code: expected.code,
          retryable: expected.retryable,
          httpStatus: status
        }
      })
      expect(asr.at(-1)).toMatchObject({
        type: 'failed',
        error: {
          code: expected.code,
          retryable: expected.retryable,
          httpStatus: status
        }
      })
      results.push(model, asr)
    }

    assertNoSecrets(results)
  })

  test('rejects malformed JSON at model and ASR protocol boundaries', async () => {
    server.use(
      http.post(MODEL_ENDPOINT, () => new HttpResponse('{broken-json', {
        headers: { 'Content-Type': 'application/json' }
      })),
      http.post(ASR_ENDPOINT, () => new HttpResponse('data: {broken-json\n\n', {
        headers: { 'Content-Type': 'text/event-stream' }
      }))
    )

    const model = await modelGateway().generate(
      generationRequest('malformed-json'),
      callContext(),
      createModelRequestBudget()
    )
    const asr = await collectAsr(asrProvider().transcribe(
      asrRequest('malformed-json'),
      callContext()
    ))

    expect(model).toMatchObject({
      ok: false,
      error: { code: 'invalid_response', source: 'protocol', retryable: false }
    })
    expect(asr.at(-1)).toMatchObject({
      type: 'failed',
      error: { code: 'protocol_error', source: 'protocol', retryable: false }
    })
    assertNoSecrets(model, asr)
  })

  test('parses chunk-split ASR SSE and rejects a stream truncated before final', async () => {
    let truncated = false
    server.use(http.post(ASR_ENDPOINT, () => {
      if (truncated) {
        return sseChunks([
          'data: {"type":"transcript.text.delta","event_id":"p1",',
          '"sequence":1,"delta":"partial-only"}\n\n'
        ])
      }
      return sseChunks([
        'da',
        'ta: {"type":"transcript.text.delta","event_id":"p1","sequence":1,',
        '"delta":"chunk"}\n\n',
        'data: {"type":"transcript.text.done","event_id":"f1",',
        '"sequence":2,"text":"chunk-split"}\n\n'
      ])
    }))

    const split = await collectAsr(asrProvider().transcribe(
      asrRequest('chunk-split'),
      callContext()
    ))
    truncated = true
    const cutOff = await collectAsr(asrProvider().transcribe(
      asrRequest('truncated'),
      callContext()
    ))

    expect(split.map((event) => event.type)).toEqual(['transcript', 'transcript'])
    expect(split.at(-1)).toMatchObject({
      type: 'transcript',
      transcript: { text: 'chunk-split', final: true }
    })
    expect(cutOff.at(-1)).toMatchObject({
      type: 'failed',
      error: { code: 'network_error', source: 'transport', retryable: true }
    })
    assertNoSecrets(split, cutOff)
  })

  test('accepts partial usage metadata without exposing wire metadata', async () => {
    server.use(http.post(MODEL_ENDPOINT, () => modelCompletion(
      '{"action":"silence"}',
      { prompt_tokens: 7 }
    )))

    const result = await modelGateway().generate(
      generationRequest('partial-usage'),
      callContext(),
      createModelRequestBudget()
    )

    expect(result).toMatchObject({
      ok: true,
      value: {
        usage: { inputTokens: 7, outputTokens: 0, totalTokens: 7 }
      }
    })
    if (result.ok) {
      expect(result.value).not.toHaveProperty('providerMetadata')
      expect(result.value).not.toHaveProperty('body')
      expect(result.value).not.toHaveProperty('headers')
    }
    assertNoSecrets(result)
  })

  test('cancels a slow model stream before any late completion can escape', async () => {
    server.use(http.post(MODEL_ENDPOINT, () => slowModelStream()))
    const controller = new AbortController()
    const events: ModelStreamEvent[] = []

    for await (const event of modelGateway().stream(
      generationRequest('slow-cancel', { stream: true, output: { type: 'text' } }),
      callContext({ signal: controller.signal }),
      createModelRequestBudget()
    )) {
      events.push(event)
      if (event.type === 'text_delta') controller.abort('session-stopped')
    }
    await Bun.sleep(70)

    expect(events.map((event) => event.type)).toEqual([
      'started',
      'text_delta',
      'failed'
    ])
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      error: { code: 'aborted', source: 'caller', retryable: false }
    })
    expect(events.filter((event) => event.type === 'text_delta')).toHaveLength(1)
    assertNoSecrets(events)
  })

  test('normalizes repeated typed-output contract violations after one repair', async () => {
    let requests = 0
    server.use(http.post(MODEL_ENDPOINT, () => {
      requests += 1
      return modelCompletion(
        `{"action":"barrage","texts":[123],"secret":"${MODEL_SECRET}"}`,
        { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
        `typed-output-${requests}`
      )
    }))
    const gateway = modelGateway()
    const validation = new ModelOutputValidationService(gateway)
    const budget = createModelRequestBudget()

    const result = await validation.generateViewer(
      generationRequest('typed-output'),
      callContext(),
      budget,
      {
        allowedEventIds: [],
        frameCount: 0,
        activeViewerIds: [],
        replyableEventIds: []
      }
    )

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'invalid_response',
        messageCode: 'provider.invalid_response',
        retryable: false,
        source: 'protocol',
        providerRequestId: 'typed-output-2'
      }
    })
    expect(requests).toBe(2)
    expect(budget.usedRequests).toBe(2)
    assertNoSecrets(result)
  })

  test('models WebSocket close, invalid frame, and one bounded reconnect', async () => {
    let connections = 0
    const remote = ws.link(WEBSOCKET_ENDPOINT)
    server.use(remote.addEventListener('connection', ({ client }) => {
      connections += 1
      if (connections === 1) {
        client.close(1012, 'provider-restart')
        return
      }
      client.send(`{"type":"event","secret":"${MODEL_SECRET}"`)
    }))

    const result = await probeWebSocketWithOneReconnect(WEBSOCKET_ENDPOINT)

    expect(result.attempts).toBe(2)
    expect(result.failures).toEqual([
      providerFailure({
        code: 'network_error',
        source: 'transport',
        retryable: true
      }),
      providerFailure({
        code: 'protocol_error',
        source: 'protocol',
        retryable: false
      })
    ])
    expect(connections).toBe(2)
    assertNoSecrets(result)
  })
})

function modelGateway(
  options: { readonly requestTimeoutMs?: number } = {}
): AiSdkModelGateway {
  return new AiSdkModelGateway(
    {
      apiKey: MODEL_SECRET,
      baseUrl: MODEL_BASE_URL,
      provider: modelIdentity,
      roleModels: modelRoles,
      requestTimeoutMs: options.requestTimeoutMs ?? 2_000
    },
    {
      monotonicNow: () => performance.now(),
      wallClockNow: () => 1_700_000_000_000,
      responseId: (requestId) => `response-${requestId}`
    }
  )
}

function asrProvider(
  options: { readonly requestTimeoutMs?: number } = {}
): StepFunAsrProvider {
  return new StepFunAsrProvider(
    {
      apiKey: ASR_SECRET,
      baseUrl: ASR_BASE_URL,
      provider: asrIdentity,
      roleModel: asrRole,
      requestTimeoutMs: options.requestTimeoutMs ?? 2_000,
      maximumRetries: 0,
      retryBackoffMs: 0
    },
    {
      sleep: async () => undefined,
      monotonicNow: () => performance.now(),
      wallClockNow: () => 1_700_000_000_000
    }
  )
}

function generationRequest(
  requestId: string,
  overrides: Partial<ModelGenerationRequest> = {}
): ModelGenerationRequest {
  return {
    requestId,
    provider: modelIdentity,
    roleModel: { role: 'viewer', modelId: modelRoles.viewer },
    purpose: 'viewer',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'decide' }] }],
    output: { type: 'structured', schemaName: VIEWER_GENERATION_SCHEMA_NAME },
    stream: false,
    protocolRepairAttempt: protocolRepairAttempt(0),
    maxOutputTokens: 128,
    ...overrides
  }
}

function asrRequest(requestId: string): AsrRequest {
  return {
    requestId,
    provider: asrIdentity,
    roleModel: asrRole,
    sessionId: 'tst-005-session' as SessionId,
    source: 'microphone',
    startedAt: wallClockTimestampMs(1_700_000_000_000),
    endedAt: wallClockTimestampMs(1_700_000_000_100),
    format: { sampleRateHz: 16_000, channels: 1, sampleWidthBits: 16 },
    pcm: new Uint8Array([1, 2, 3, 4])
  }
}

function callContext(
  options: {
    readonly signal?: AbortSignal
    readonly deadlineMs?: number
  } = {}
): ProviderCallContext {
  const signal = options.signal ?? new AbortController().signal
  return {
    callerSignal: signal,
    deadline: monotonicDeadline(performance.now() + (options.deadlineMs ?? 60_000)),
    cancellationReason: () => signal.aborted
      ? { code: 'caller_cancelled', messageCode: 'provider.aborted' }
      : undefined
  }
}

function upstreamError(status: number, secret: string): Response {
  return HttpResponse.json(
    { error: { message: `must-not-leak:${secret}`, code: `status_${status}` } },
    {
      status,
      headers: {
        'Retry-After': status === 429 ? '0.25' : '0',
        'X-Request-Id': `tst-005-status-${status}`
      }
    }
  )
}

function modelCompletion(
  text: string,
  usage: Readonly<Record<string, number>>,
  requestId = 'tst-005-upstream'
): Response {
  return HttpResponse.json(
    {
      id: requestId,
      object: 'chat.completion',
      created: 1_700_000_000,
      model: modelRoles.viewer,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: 'stop'
        }
      ],
      usage
    },
    { headers: { 'X-Request-Id': requestId } }
  )
}

function sseChunks(chunks: readonly string[]): Response {
  const encoder = new TextEncoder()
  return new HttpResponse(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    }
  }), {
    headers: { 'Content-Type': 'text/event-stream' }
  })
}

function slowModelStream(): Response {
  const encoder = new TextEncoder()
  let timer: ReturnType<typeof setTimeout> | undefined
  return new HttpResponse(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(modelStreamChunk('first')))
      timer = setTimeout(() => {
        controller.enqueue(encoder.encode(modelStreamChunk('late')))
        controller.enqueue(encoder.encode(modelStreamFinish()))
        controller.close()
      }, 50)
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer)
    }
  }), {
    headers: {
      'Content-Type': 'text/event-stream',
      'X-Request-Id': 'tst-005-slow-stream'
    }
  })
}

function modelStreamChunk(text: string): string {
  return `data: ${JSON.stringify({
    id: 'tst-005-stream',
    object: 'chat.completion.chunk',
    created: 1_700_000_000,
    model: modelRoles.viewer,
    choices: [{ index: 0, delta: { content: text }, finish_reason: null }]
  })}\n\n`
}

function modelStreamFinish(): string {
  const finish = `data: ${JSON.stringify({
    id: 'tst-005-stream',
    object: 'chat.completion.chunk',
    created: 1_700_000_000,
    model: modelRoles.viewer,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
  })}\n\n`
  return `${finish}data: [DONE]\n\n`
}

async function collectAsr(
  iterable: AsyncIterable<AsrProviderEvent>
): Promise<AsrProviderEvent[]> {
  const events: AsrProviderEvent[] = []
  for await (const event of iterable) events.push(event)
  return events
}

async function probeWebSocketWithOneReconnect(url: string): Promise<{
  readonly attempts: number
  readonly failures: readonly ProviderFailure[]
}> {
  const failures: ProviderFailure[] = []
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const outcome = await webSocketAttempt(url)
    if (outcome.type === 'close') {
      const failure = providerFailure({
        code: 'network_error',
        source: 'transport',
        retryable: outcome.code === 1012
      })
      failures.push(failure)
      if (failure.retryable && attempt === 1) continue
      return { attempts: attempt, failures }
    }
    failures.push(providerFailure({
      code: 'protocol_error',
      source: 'protocol',
      retryable: false
    }))
    return { attempts: attempt, failures }
  }
  return { attempts: 2, failures }
}

function webSocketAttempt(url: string): Promise<
  | { readonly type: 'close'; readonly code: number }
  | { readonly type: 'invalid_frame' }
> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    const timeout = setTimeout(() => {
      socket.close()
      reject(new Error('WebSocket fault probe timed out'))
    }, 2_000)
    socket.addEventListener('message', (event) => {
      let decoded: unknown
      try {
        decoded = JSON.parse(String(event.data))
      } catch {
        clearTimeout(timeout)
        socket.close()
        resolve({ type: 'invalid_frame' })
        return
      }
      if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) {
        clearTimeout(timeout)
        socket.close()
        resolve({ type: 'invalid_frame' })
        return
      }
      clearTimeout(timeout)
      socket.close()
      reject(new Error('WebSocket fault probe received an unexpectedly valid frame'))
    }, { once: true })
    socket.addEventListener('close', (event) => {
      clearTimeout(timeout)
      resolve({ type: 'close', code: event.code })
    }, { once: true })
    socket.addEventListener('error', () => {
      clearTimeout(timeout)
      reject(new Error('WebSocket fault probe connection failed'))
    }, { once: true })
  })
}

function assertNoSecrets(...values: readonly unknown[]): void {
  const serialized = JSON.stringify(values)
  expect(serialized).not.toContain(MODEL_SECRET)
  expect(serialized).not.toContain(ASR_SECRET)
  expect(serialized).not.toContain('must-not-leak')
}
