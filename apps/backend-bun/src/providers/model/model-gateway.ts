import {
  createOpenAICompatible,
  type OpenAICompatibleProviderSettings
} from '@ai-sdk/openai-compatible'
import {
  APICallError,
  EmptyResponseBodyError,
  TypeValidationError,
  generateText,
  streamText,
  type FinishReason,
  type LanguageModel,
  type LanguageModelResponseMetadata,
  type LanguageModelUsage,
  type ModelMessage as AiSdkModelMessage
} from 'ai'

import {
  durationMs,
  modelUsage,
  providerFailure,
  wallClockTimestampMs,
  type ModelFinishReason,
  type ModelGenerationOutput,
  type ModelGenerationRequest,
  type ModelGenerationResult,
  type ModelProvider,
  type ModelRequestBudget,
  type ModelRole,
  type ModelStreamEvent,
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

export type ModelGatewayConfig = {
  readonly apiKey: string
  readonly baseUrl: string
  readonly provider: ProviderIdentity<'model'>
  readonly roleModels: Readonly<Record<ModelRole, string>>
  readonly headers?: Readonly<Record<string, string>>
  readonly providerName?: string
  readonly requestTimeoutMs?: number
}

export type ModelGatewayFetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>

export type ModelGatewayDependencies = {
  readonly fetch?: ModelGatewayFetch
  readonly monotonicNow?: () => number
  readonly wallClockNow?: () => number
  readonly responseId?: (requestId: string) => string
}

type AiSdkUserMessage = Extract<AiSdkModelMessage, { role: 'user' }>

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const SUPPORTED_CAPABILITIES = new Set([
  'text_generation',
  'image_input',
  'structured_output',
  'streaming'
])

class ModelGatewayRequestError extends Error {}

export class AiSdkModelGateway implements ModelProvider {
  readonly #provider: ProviderIdentity<'model'>
  readonly #roleModels: Readonly<Record<ModelRole, string>>
  readonly #modelFor: (modelId: string) => LanguageModel
  readonly #requestTimeoutMs: number
  readonly #monotonicNow: () => number
  readonly #wallClockNow: () => number
  readonly #responseId: (requestId: string) => string

  constructor(
    config: ModelGatewayConfig,
    dependencies: ModelGatewayDependencies = {}
  ) {
    if (config.apiKey.trim().length === 0) {
      throw new ModelGatewayRequestError('model gateway API key is required')
    }
    if (config.provider.kind !== 'model') {
      throw new ModelGatewayRequestError('model gateway provider kind must be model')
    }

    const providerName = boundedText(
      config.providerName ?? 'advx-openai-compatible',
      'provider name',
      128
    )
    const roleModels = normalizeRoleModels(config.roleModels)
    const sdkProvider = createOpenAICompatible({
      name: providerName,
      baseURL: normalizeBaseUrl(config.baseUrl),
      apiKey: config.apiKey,
      headers: normalizeHeaders(config.headers),
      includeUsage: true,
      supportsStructuredOutputs: true,
      ...(dependencies.fetch === undefined
        ? {}
        : {
            fetch: dependencies.fetch as NonNullable<
              OpenAICompatibleProviderSettings['fetch']
            >
          })
    })

    this.#provider = config.provider
    this.#roleModels = roleModels
    this.#modelFor = (modelId) => sdkProvider(modelId)
    this.#requestTimeoutMs = positiveInteger(
      config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      'request timeout'
    )
    this.#monotonicNow = dependencies.monotonicNow ?? (() => performance.now())
    this.#wallClockNow = dependencies.wallClockNow ?? (() => Date.now())
    this.#responseId = dependencies.responseId ??
      ((requestId) => `model-${requestId}-${crypto.randomUUID()}`)
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
    const failure = this.#preflight(request.provider, undefined, context) ??
      roleModelProbeFailure(request.roleModels, this.#roleModels)
    if (failure) return { ok: false, error: failure }

    const checks = request.capabilities.map((capability) => {
      const supported = SUPPORTED_CAPABILITIES.has(capability)
      return {
        capability,
        status: supported ? 'passed' as const : 'failed' as const,
        ...(request.roleModels[0] === undefined
          ? {}
          : { roleModel: request.roleModels[0] }),
        ...(supported
          ? {}
          : {
              failure: providerFailure({
                code: 'unsupported_capability',
                source: 'advx',
                retryable: false
              })
            })
      }
    })
    return {
      ok: true,
      value: {
        provider: this.#provider,
        status: checks.every((check) => check.status === 'passed')
          ? 'passed'
          : 'failed',
        checkedAt: wallClockTimestampMs(this.#wallClockNow()),
        latency: { totalMs: durationMs(0) },
        discoveredModelIds: [...new Set(Object.values(this.#roleModels))],
        checks
      }
    }
  }

  async generate(
    request: ModelGenerationRequest,
    context: ProviderCallContext,
    requestBudget: ModelRequestBudget
  ): Promise<ProviderOutcome<ModelGenerationResult>> {
    const preflight = this.#preflight(request.provider, request, context)
    if (preflight) return { ok: false, error: preflight }
    if (!requestBudget.take()) return { ok: false, error: budgetFailure() }

    const startedAt = this.#monotonicNow()
    try {
      const result = await generateText({
        model: this.#modelFor(request.roleModel.modelId),
        messages: toAiSdkMessages(request),
        allowSystemInMessages: true,
        maxRetries: 0,
        maxOutputTokens: request.maxOutputTokens,
        abortSignal: context.callerSignal,
        timeout: this.#timeoutMs(context)
      })
      return {
        ok: true,
        value: generationResult(
          request,
          this.#responseId(request.requestId),
          result.text,
          result.finishReason,
          result.usage,
          result.response,
          this.#monotonicNow() - startedAt
        )
      }
    } catch (error) {
      return { ok: false, error: normalizeError(error, context) }
    }
  }

  async *stream(
    request: ModelGenerationRequest,
    context: ProviderCallContext,
    requestBudget: ModelRequestBudget
  ): AsyncIterable<ModelStreamEvent> {
    const preflight = this.#preflight(request.provider, request, context)
    if (preflight) {
      yield { type: 'failed', requestId: request.requestId, error: preflight }
      return
    }
    if (!requestBudget.take()) {
      yield { type: 'failed', requestId: request.requestId, error: budgetFailure() }
      return
    }

    const startedAt = this.#monotonicNow()
    const responseId = this.#responseId(request.requestId)
    try {
      let streamError: unknown
      const result = streamText({
        model: this.#modelFor(request.roleModel.modelId),
        messages: toAiSdkMessages(request),
        allowSystemInMessages: true,
        maxRetries: 0,
        maxOutputTokens: request.maxOutputTokens,
        abortSignal: context.callerSignal,
        timeout: this.#timeoutMs(context),
        onError: ({ error }) => {
          streamError ??= error
        }
      })

      yield { type: 'started', requestId: request.requestId, responseId }
      let text = ''
      let timeToFirstTokenMs: number | undefined
      for await (const textDelta of result.textStream) {
        if (textDelta.length === 0) continue
        text += textDelta
        timeToFirstTokenMs ??= this.#monotonicNow() - startedAt
        yield {
          type: 'text_delta',
          requestId: request.requestId,
          responseId,
          textDelta
        }
      }

      if (streamError !== undefined) {
        yield {
          type: 'failed',
          requestId: request.requestId,
          error: normalizeError(streamError, context)
        }
        return
      }

      const [finishReason, usage, response] = await Promise.all([
        result.finishReason,
        result.usage,
        result.response
      ])
      yield {
        type: 'completed',
        result: generationResult(
          request,
          responseId,
          text,
          finishReason,
          usage,
          response,
          this.#monotonicNow() - startedAt,
          timeToFirstTokenMs
        )
      }
    } catch (error) {
      yield {
        type: 'failed',
        requestId: request.requestId,
        error: normalizeError(error, context)
      }
    }
  }

  #preflight(
    provider: ProviderIdentity,
    request: ModelGenerationRequest | undefined,
    context: ProviderCallContext
  ): ProviderFailure | undefined {
    if (context.callerSignal.aborted || context.cancellationReason() !== undefined) {
      return cancellationFailure(context)
    }
    if (context.deadline.expiresAt <= this.#monotonicNow()) {
      return providerFailure({
        code: 'timeout',
        source: 'advx',
        retryable: true
      })
    }
    if (!sameProvider(provider, this.#provider)) return invalidRequestFailure()
    if (request === undefined) return undefined

    try {
      boundedText(request.requestId, 'request ID', 512)
      const configuredModel = this.#roleModels[request.roleModel.role]
      if (request.roleModel.modelId !== configuredModel) {
        throw new ModelGatewayRequestError('request role model does not match configuration')
      }
      if (request.messages.length === 0) {
        throw new ModelGatewayRequestError('at least one model message is required')
      }
      if (request.maxOutputTokens !== undefined) {
        positiveInteger(request.maxOutputTokens, 'maximum output tokens')
      }
      if (request.output.type === 'structured') {
        boundedText(request.output.schemaName, 'schema name', 128)
      }
      toAiSdkMessages(request)
      return undefined
    } catch (error) {
      if (error instanceof ModelGatewayRequestError || error instanceof RangeError) {
        return invalidRequestFailure()
      }
      throw error
    }
  }

  #timeoutMs(context: ProviderCallContext): number {
    const remaining = Math.max(1, context.deadline.expiresAt - this.#monotonicNow())
    return Math.min(this.#requestTimeoutMs, remaining)
  }
}

function toAiSdkMessages(request: ModelGenerationRequest): AiSdkModelMessage[] {
  return request.messages.map((message) => {
    if (message.content.length === 0) {
      throw new ModelGatewayRequestError('model message content must not be empty')
    }
    if (message.role === 'user') {
      const content: Exclude<AiSdkUserMessage['content'], string> =
        message.content.map((part) => {
          if (part.type === 'text') {
            return { type: 'text' as const, text: part.text }
          }
          if (!part.mediaType.startsWith('image/') || part.bytes.byteLength === 0) {
            throw new ModelGatewayRequestError('invalid model image input')
          }
          return {
            type: 'file' as const,
            data: Uint8Array.from(part.bytes),
            mediaType: part.mediaType
          }
        })
      return { role: 'user', content }
    }

    if (message.content.some((part) => part.type !== 'text')) {
      throw new ModelGatewayRequestError('images are only supported in user messages')
    }
    const content = message.content
      .map((part) => part.type === 'text' ? part.text : '')
      .join('\n')
    return { role: message.role, content }
  })
}

function generationResult(
  request: ModelGenerationRequest,
  responseId: string,
  text: string,
  finishReason: FinishReason,
  usage: LanguageModelUsage,
  response: LanguageModelResponseMetadata,
  totalMs: number,
  timeToFirstTokenMs?: number
): ModelGenerationResult {
  const providerRequestId = providerRequestIdFrom(response)
  return {
    requestId: request.requestId,
    responseId,
    ...(providerRequestId === undefined ? {} : { providerRequestId }),
    provider: request.provider,
    roleModel: request.roleModel,
    protocolRepairAttempt: request.protocolRepairAttempt,
    output: generationOutput(request, text),
    finishReason: normalizeFinishReason(finishReason),
    usage: modelUsage({
      ...(safeTokenCount(usage.inputTokens) === undefined
        ? {}
        : { inputTokens: safeTokenCount(usage.inputTokens) }),
      ...(safeTokenCount(usage.outputTokens) === undefined
        ? {}
        : { outputTokens: safeTokenCount(usage.outputTokens) }),
      ...(safeTokenCount(usage.totalTokens) === undefined
        ? {}
        : { totalTokens: safeTokenCount(usage.totalTokens) })
    }),
    latency: {
      totalMs: durationMs(Math.max(0, totalMs)),
      ...(timeToFirstTokenMs === undefined
        ? {}
        : { timeToFirstTokenMs: durationMs(Math.max(0, timeToFirstTokenMs)) })
    }
  }
}

function generationOutput(
  request: ModelGenerationRequest,
  text: string
): ModelGenerationOutput {
  return request.output.type === 'structured'
    ? { type: 'structured', schemaName: request.output.schemaName, text }
    : { type: 'text', text }
}

function normalizeFinishReason(reason: FinishReason): ModelFinishReason {
  if (reason === 'stop' || reason === 'length') return reason
  if (reason === 'content-filter') return 'content_filter'
  if (reason === 'tool-calls') return 'tool_call'
  return 'unknown'
}

function normalizeError(error: unknown, context: ProviderCallContext): ProviderFailure {
  if (context.callerSignal.aborted || context.cancellationReason() !== undefined) {
    return cancellationFailure(context)
  }
  if (error instanceof ModelGatewayRequestError || error instanceof RangeError) {
    return invalidRequestFailure()
  }
  if (APICallError.isInstance(error)) return apiCallFailure(error)
  if (
    EmptyResponseBodyError.isInstance(error) ||
    TypeValidationError.isInstance(error)
  ) {
    return providerFailure({
      code: 'invalid_response',
      source: 'protocol',
      retryable: false
    })
  }
  if (error instanceof Error && error.name === 'TimeoutError') {
    return providerFailure({ code: 'timeout', source: 'advx', retryable: true })
  }
  if (error instanceof Error && error.name === 'AbortError') {
    return providerFailure({ code: 'timeout', source: 'advx', retryable: true })
  }
  if (error instanceof TypeError) {
    return providerFailure({
      code: 'network_error',
      source: 'transport',
      retryable: true
    })
  }
  return providerFailure({ code: 'unknown', source: 'advx', retryable: false })
}

function apiCallFailure(error: APICallError): ProviderFailure {
  const status = error.statusCode
  const providerRequestId = providerRequestIdFromHeaders(error.responseHeaders)
  const retryAfter = retryAfterMs(headerValue(error.responseHeaders, 'retry-after'))
  const common = {
    ...(status === undefined ? {} : { httpStatus: status }),
    ...(providerRequestId === undefined ? {} : { providerRequestId }),
    ...(retryAfter === undefined ? {} : { retryAfterMs: durationMs(retryAfter) })
  }
  if (status === undefined) {
    return providerFailure({
      code: 'network_error', source: 'transport', retryable: true, ...common
    })
  }
  if (status >= 200 && status < 300) {
    return providerFailure({
      code: 'invalid_response', source: 'protocol', retryable: false, ...common
    })
  }
  if (status === 401) {
    return providerFailure({
      code: 'authentication_failed', source: 'provider', retryable: false, ...common
    })
  }
  if (status === 402) {
    return providerFailure({
      code: 'quota_exceeded', source: 'provider', retryable: false, ...common
    })
  }
  if (status === 403) {
    return providerFailure({
      code: 'permission_denied', source: 'provider', retryable: false, ...common
    })
  }
  if (status === 404) {
    return providerFailure({
      code: 'model_not_found', source: 'provider', retryable: false, ...common
    })
  }
  if (status === 408) {
    return providerFailure({
      code: 'timeout', source: 'provider', retryable: true, ...common
    })
  }
  if (status === 429) {
    return providerFailure({
      code: 'rate_limited', source: 'provider', retryable: true, ...common
    })
  }
  if (status >= 500) {
    return providerFailure({
      code: 'provider_unavailable', source: 'provider', retryable: true, ...common
    })
  }
  return providerFailure({
    code: status === 400 || status === 422 ? 'invalid_request' : 'provider_error',
    source: 'provider',
    retryable: false,
    ...common
  })
}

function cancellationFailure(context: ProviderCallContext): ProviderFailure {
  const timedOut = context.cancellationReason()?.code === 'deadline_exceeded'
  return providerFailure({
    code: timedOut ? 'timeout' : 'aborted',
    source: timedOut ? 'advx' : 'caller',
    retryable: timedOut
  })
}

function invalidRequestFailure(): ProviderFailure {
  return providerFailure({
    code: 'invalid_request',
    source: 'advx',
    retryable: false
  })
}

function budgetFailure(): ProviderFailure {
  return invalidRequestFailure()
}

function providerRequestIdFrom(response: LanguageModelResponseMetadata): string | undefined {
  return providerRequestIdFromHeaders(response.headers) ?? safeIdentifier(response.id)
}

function providerRequestIdFromHeaders(
  headers: Record<string, string> | undefined
): string | undefined {
  return safeIdentifier(
    headerValue(headers, 'x-request-id') ??
    headerValue(headers, 'x-provider-request-id')
  )
}

function headerValue(
  headers: Record<string, string> | undefined,
  name: string
): string | undefined {
  if (headers === undefined) return undefined
  const entry = Object.entries(headers)
    .find(([key]) => key.toLowerCase() === name)
  return entry?.[1]
}

function safeIdentifier(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const normalized = value.trim()
  return normalized.length > 0 && normalized.length <= 512 ? normalized : undefined
}

function safeTokenCount(value: number | undefined): number | undefined {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined
}

function retryAfterMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1_000)
  const date = Date.parse(value)
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now())
}

function normalizeRoleModels(
  roleModels: Readonly<Record<ModelRole, string>>
): Readonly<Record<ModelRole, string>> {
  return Object.freeze({
    viewer: boundedText(roleModels.viewer, 'viewer model ID', 256),
    memory: boundedText(roleModels.memory, 'memory model ID', 256),
    visual_summary: boundedText(
      roleModels.visual_summary,
      'visual summary model ID',
      256
    )
  })
}

function normalizeHeaders(
  headers: Readonly<Record<string, string>> | undefined
): Record<string, string> | undefined {
  if (headers === undefined) return undefined
  const normalized: Record<string, string> = {}
  for (const [name, value] of Object.entries(headers)) {
    if (name.trim().length === 0 || /[\r\n]/.test(name) || /[\r\n]/.test(value)) {
      throw new ModelGatewayRequestError('invalid model gateway header')
    }
    if (name.toLowerCase() === 'authorization') {
      throw new ModelGatewayRequestError('authorization header is owned by the API key')
    }
    normalized[name] = value
  }
  return normalized
}

function normalizeBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ModelGatewayRequestError('model gateway base URL must be absolute')
  }
  if (
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new ModelGatewayRequestError('invalid model gateway base URL')
  }
  return url.toString().replace(/\/$/, '')
}

function roleModelProbeFailure(
  requested: readonly ProviderRoleModel[],
  configured: Readonly<Record<ModelRole, string>>
): ProviderFailure | undefined {
  for (const roleModel of requested) {
    if (roleModel.role === 'asr' || configured[roleModel.role] !== roleModel.modelId) {
      return invalidRequestFailure()
    }
  }
  return undefined
}

function sameProvider(left: ProviderIdentity, right: ProviderIdentity): boolean {
  return left.kind === right.kind &&
    left.providerProfileId === right.providerProfileId &&
    left.providerRevision === right.providerRevision
}

function boundedText(value: string, name: string, maximumLength: number): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > maximumLength) {
    throw new ModelGatewayRequestError(
      `${name} must contain 1 to ${maximumLength} characters`
    )
  }
  return normalized
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer`)
  }
  return value
}
