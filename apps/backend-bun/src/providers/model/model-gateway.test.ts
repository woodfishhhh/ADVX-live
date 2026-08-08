import { describe, expect, spyOn, test } from 'bun:test'

import {
  createModelRequestBudget,
  monotonicDeadline,
  protocolRepairAttempt,
  providerRevision,
  type ModelGenerationRequest,
  type ModelStreamEvent,
  type ProviderCallContext,
  type ProviderIdentity,
  type ProviderRoleModel
} from '../../application/ports'
import {
  AiSdkModelGateway,
  type ModelGatewayFetch
} from './model-gateway'

const identity: ProviderIdentity<'model'> = {
  kind: 'model',
  providerProfileId: 'model-profile-1',
  providerRevision: providerRevision('model-revision-1')
}

const roleModels = {
  viewer: 'viewer-model-1',
  memory: 'memory-model-1',
  visual_summary: 'visual-model-1'
} as const

type RecordedRequest = {
  readonly url: string
  readonly headers: Headers
  readonly body: Record<string, unknown>
}

type PlannedResponse =
  | { readonly type: 'completion'; readonly text: string }
  | { readonly type: 'stream'; readonly deltas: readonly string[] }
  | { readonly type: 'error'; readonly status: number; readonly retryAfter?: string }
  | { readonly type: 'abort' }

class RecordedModelApi {
  readonly requests: RecordedRequest[] = []
  readonly #responses: PlannedResponse[]

  constructor(responses: readonly PlannedResponse[]) {
    this.#responses = [...responses]
  }

  readonly fetch: ModelGatewayFetch = async (input, init) => {
    const request = new Request(input, init)
    const body = await request.clone().json() as Record<string, unknown>
    this.requests.push({ url: request.url, headers: request.headers, body })
    const response = this.#responses.shift()
    if (response === undefined) throw new Error('missing recorded model response')

    if (response.type === 'abort') {
      return await new Promise<Response>((_resolve, reject) => {
        const rejectAbort = () => reject(new DOMException('aborted', 'AbortError'))
        if (request.signal.aborted) rejectAbort()
        else request.signal.addEventListener('abort', rejectAbort, { once: true })
      })
    }
    if (response.type === 'error') {
      return Response.json(
        {
          error: {
            message: 'credential-bearing recorded error',
            type: 'recorded_error',
            code: `status_${response.status}`
          }
        },
        {
          status: response.status,
          headers: {
            'X-Request-Id': `upstream-${this.requests.length}`,
            ...(response.retryAfter === undefined
              ? {}
              : { 'Retry-After': response.retryAfter })
          }
        }
      )
    }
    if (response.type === 'stream') return streamResponse(response.deltas)
    return completionResponse(response.text, String(body.model))
  }
}

describe('AGT-003 AI SDK ModelGateway', () => {
  test('uses the compatible endpoint, headers, role model, image input, and safe metadata', async () => {
    const api = new RecordedModelApi([
      { type: 'completion', text: '{"action":"silence"}' }
    ])
    const gateway = gatewayFor(api)

    const result = await gateway.generate(
      generationRequest(),
      callContext(),
      createModelRequestBudget()
    )

    expect(result).toMatchObject({
      ok: true,
      value: {
        requestId: 'generation-1',
        responseId: 'response-generation-1',
        providerRequestId: 'upstream-1',
        provider: identity,
        roleModel: { role: 'viewer', modelId: 'viewer-model-1' },
        output: {
          type: 'structured',
          schemaName: 'viewer_generation_v1',
          text: '{"action":"silence"}'
        },
        finishReason: 'stop',
        usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 }
      }
    })
    expect(api.requests).toHaveLength(1)
    expect(api.requests[0]?.url).toBe(
      'https://models.example.test/v1/chat/completions'
    )
    expect(api.requests[0]?.headers.get('authorization')).toBe('Bearer test-secret')
    expect(api.requests[0]?.headers.get('x-tenant')).toBe('advx-test')
    expect(api.requests[0]?.body.model).toBe('viewer-model-1')
    expect(api.requests[0]?.body.max_tokens).toBe(256)

    const messages = api.requests[0]?.body.messages as Array<Record<string, unknown>>
    const userContent = messages[0]?.content as Array<Record<string, unknown>>
    expect(userContent[0]).toEqual({ type: 'text', text: 'decide independently' })
    expect(userContent[1]).toMatchObject({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,AQID' }
    })
    for (const wireKey of ['headers', 'body', 'choices', 'providerMetadata']) {
      if (result.ok) expect(result.value).not.toHaveProperty(wireKey)
    }

    const mismatched = await gateway.generate(
      generationRequest({
        roleModel: { role: 'memory', modelId: 'wrong-model' }
      }),
      callContext(),
      createModelRequestBudget()
    )
    expect(mismatched).toEqual({
      ok: false,
      error: {
        code: 'invalid_request',
        messageCode: 'provider.invalid_request',
        retryable: false,
        source: 'advx'
      }
    })
    expect(api.requests).toHaveLength(1)
  })

  test('streams normalized deltas and propagates caller abort without another request', async () => {
    const streamApi = new RecordedModelApi([
      { type: 'stream', deltas: ['hello ', 'world'] }
    ])
    const streamGateway = gatewayFor(streamApi)
    const events: ModelStreamEvent[] = []
    for await (const event of streamGateway.stream(
      generationRequest({ stream: true, output: { type: 'text' } }),
      callContext(),
      createModelRequestBudget()
    )) {
      events.push(event)
    }

    expect(events.map((event) => event.type)).toEqual([
      'started',
      'text_delta',
      'text_delta',
      'completed'
    ])
    expect(events[1]).toMatchObject({ textDelta: 'hello ' })
    expect(events[2]).toMatchObject({ textDelta: 'world' })
    expect(events[3]).toMatchObject({
      type: 'completed',
      result: {
        output: { type: 'text', text: 'hello world' },
        usage: { inputTokens: 7, outputTokens: 3, totalTokens: 10 }
      }
    })
    expect(streamApi.requests).toHaveLength(1)

    const abortApi = new RecordedModelApi([{ type: 'abort' }])
    const abortGateway = gatewayFor(abortApi)
    const controller = new AbortController()
    const pending = abortGateway.generate(
      generationRequest(),
      callContext(controller.signal),
      createModelRequestBudget()
    )
    await Promise.resolve()
    controller.abort('session-stopped')
    expect(await pending).toEqual({
      ok: false,
      error: {
        code: 'aborted',
        messageCode: 'provider.aborted',
        retryable: false,
        source: 'caller'
      }
    })
    expect(abortApi.requests).toHaveLength(1)
  })

  test('normalizes streaming HTTP failures without logging raw SDK errors', async () => {
    const api = new RecordedModelApi([{ type: 'error', status: 503 }])
    const gateway = gatewayFor(api)
    const consoleError = spyOn(console, 'error').mockImplementation(() => {})
    try {
      const events: ModelStreamEvent[] = []
      for await (const event of gateway.stream(
        generationRequest({ stream: true }),
        callContext(),
        createModelRequestBudget()
      )) {
        events.push(event)
      }

      expect(events.map((event) => event.type)).toEqual(['started', 'failed'])
      expect(events[1]).toEqual({
        type: 'failed',
        requestId: 'generation-1',
        error: {
          code: 'provider_unavailable',
          messageCode: 'provider.provider_unavailable',
          retryable: true,
          source: 'provider',
          httpStatus: 503,
          providerRequestId: 'upstream-1'
        }
      })
      expect(api.requests).toHaveLength(1)
      expect(consoleError).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })

  test('disables SDK retries and enforces the shared two-request physical budget', async () => {
    const matrix: Array<{ case: string; physicalRequests: number }> = []

    const successApi = new RecordedModelApi([
      { type: 'completion', text: '{"action":"silence"}' }
    ])
    await gatewayFor(successApi).generate(
      generationRequest(), callContext(), createModelRequestBudget()
    )
    matrix.push({ case: 'success', physicalRequests: successApi.requests.length })

    const transientApi = new RecordedModelApi([
      { type: 'error', status: 503 },
      { type: 'completion', text: '{"action":"silence"}' }
    ])
    const transientGateway = gatewayFor(transientApi)
    const transientBudget = createModelRequestBudget()
    const firstTransient = await transientGateway.generate(
      generationRequest(), callContext(), transientBudget
    )
    expect(firstTransient).toMatchObject({
      ok: false,
      error: { code: 'provider_unavailable', retryable: true, httpStatus: 503 }
    })
    expect(transientApi.requests).toHaveLength(1)
    await transientGateway.generate(
      generationRequest(), callContext(), transientBudget
    )
    matrix.push({
      case: 'transient_then_success',
      physicalRequests: transientApi.requests.length
    })

    const repairApi = new RecordedModelApi([
      { type: 'completion', text: 'not-json' },
      { type: 'completion', text: '{"action":"silence"}' }
    ])
    const repairGateway = gatewayFor(repairApi)
    const repairBudget = createModelRequestBudget()
    const malformed = await repairGateway.generate(
      generationRequest(), callContext(), repairBudget
    )
    expect(malformed.ok && malformed.value.output.text).toBe('not-json')
    await repairGateway.generate(
      generationRequest({ protocolRepairAttempt: protocolRepairAttempt(1) }),
      callContext(),
      repairBudget
    )
    matrix.push({
      case: 'malformed_then_repair',
      physicalRequests: repairApi.requests.length
    })

    const cappedApi = new RecordedModelApi([
      { type: 'error', status: 503 },
      { type: 'completion', text: 'not-json' },
      { type: 'completion', text: '{"action":"must-not-run"}' }
    ])
    const cappedGateway = gatewayFor(cappedApi)
    const cappedBudget = createModelRequestBudget()
    await cappedGateway.generate(generationRequest(), callContext(), cappedBudget)
    await cappedGateway.generate(generationRequest(), callContext(), cappedBudget)
    const third = await cappedGateway.generate(
      generationRequest({ protocolRepairAttempt: protocolRepairAttempt(1) }),
      callContext(),
      cappedBudget
    )
    expect(third).toMatchObject({
      ok: false,
      error: { code: 'invalid_request', source: 'advx', retryable: false }
    })
    matrix.push({
      case: 'transient_then_malformed_no_third',
      physicalRequests: cappedApi.requests.length
    })

    expect(matrix).toEqual([
      { case: 'success', physicalRequests: 1 },
      { case: 'transient_then_success', physicalRequests: 2 },
      { case: 'malformed_then_repair', physicalRequests: 2 },
      { case: 'transient_then_malformed_no_third', physicalRequests: 2 }
    ])
  })

  test('normalizes auth, rate-limit, and expired-deadline failures', async () => {
    const api = new RecordedModelApi([
      { type: 'error', status: 401 },
      { type: 'error', status: 429, retryAfter: '1.5' }
    ])
    const gateway = gatewayFor(api)
    const auth = await gateway.generate(
      generationRequest(), callContext(), createModelRequestBudget()
    )
    const limited = await gateway.generate(
      generationRequest(), callContext(), createModelRequestBudget()
    )
    expect(auth).toMatchObject({
      ok: false,
      error: {
        code: 'authentication_failed',
        source: 'provider',
        retryable: false,
        providerRequestId: 'upstream-1'
      }
    })
    expect(limited).toMatchObject({
      ok: false,
      error: {
        code: 'rate_limited',
        source: 'provider',
        retryable: true,
        retryAfterMs: 1_500,
        providerRequestId: 'upstream-2'
      }
    })

    const expiredBudget = createModelRequestBudget()
    const expired = await gateway.generate(
      generationRequest(),
      {
        callerSignal: new AbortController().signal,
        deadline: monotonicDeadline(0),
        cancellationReason: () => undefined
      },
      expiredBudget
    )
    expect(expired).toMatchObject({
      ok: false,
      error: { code: 'timeout', source: 'advx', retryable: true }
    })
    expect(expiredBudget.usedRequests).toBe(0)
    expect(api.requests).toHaveLength(2)
  })
})

function gatewayFor(api: RecordedModelApi): AiSdkModelGateway {
  let monotonic = 1
  return new AiSdkModelGateway(
    {
      apiKey: 'test-secret',
      baseUrl: 'https://models.example.test/v1/',
      provider: identity,
      roleModels,
      headers: { 'X-Tenant': 'advx-test' },
      requestTimeoutMs: 5_000
    },
    {
      fetch: api.fetch,
      monotonicNow: () => monotonic++,
      wallClockNow: () => 1_700_000_000_000,
      responseId: (requestId) => `response-${requestId}`
    }
  )
}

function callContext(signal = new AbortController().signal): ProviderCallContext {
  return {
    callerSignal: signal,
    deadline: monotonicDeadline(100_000),
    cancellationReason: () => signal.aborted
      ? { code: 'caller_cancelled', messageCode: 'provider.aborted' }
      : undefined
  }
}

function generationRequest(
  overrides: Partial<ModelGenerationRequest> = {}
): ModelGenerationRequest {
  const roleModel: ProviderRoleModel<'viewer'> = {
    role: 'viewer',
    modelId: roleModels.viewer
  }
  return {
    requestId: 'generation-1',
    provider: identity,
    roleModel,
    purpose: 'viewer',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'decide independently' },
          {
            type: 'image',
            mediaType: 'image/png',
            bytes: new Uint8Array([1, 2, 3])
          }
        ]
      }
    ],
    output: { type: 'structured', schemaName: 'viewer_generation_v1' },
    stream: false,
    protocolRepairAttempt: protocolRepairAttempt(0),
    maxOutputTokens: 256,
    ...overrides
  }
}

function completionResponse(text: string, modelId: string): Response {
  return Response.json(
    {
      id: 'chatcmpl-recorded',
      object: 'chat.completion',
      created: 1_700_000_000,
      model: modelId,
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: 'stop'
        }
      ],
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 }
    },
    { headers: { 'X-Request-Id': 'upstream-1' } }
  )
}

function streamResponse(deltas: readonly string[]): Response {
  const chunks = [
    ...deltas.map((content) => ({
      id: 'chatcmpl-stream-recorded',
      object: 'chat.completion.chunk',
      created: 1_700_000_000,
      model: roleModels.viewer,
      choices: [{ index: 0, delta: { content }, finish_reason: null }]
    })),
    {
      id: 'chatcmpl-stream-recorded',
      object: 'chat.completion.chunk',
      created: 1_700_000_000,
      model: roleModels.viewer,
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
    },
    {
      id: 'chatcmpl-stream-recorded',
      object: 'chat.completion.chunk',
      created: 1_700_000_000,
      model: roleModels.viewer,
      choices: [],
      usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 }
    }
  ]
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join('')}data: [DONE]\n\n`
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'X-Request-Id': 'upstream-stream-1'
    }
  })
}
