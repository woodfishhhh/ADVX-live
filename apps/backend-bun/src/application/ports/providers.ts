import type { SessionId } from '@advx/contracts'

import type { ProviderCallContext } from './tasks'
import type { TraceContext } from './observability'
import type {
  DurationMs,
  WallClockTimestampMs
} from './time'

declare const providerRevisionBrand: unique symbol

export type ProviderRevision = string & {
  readonly [providerRevisionBrand]: 'provider-revision'
}

export type ProviderKind = 'model' | 'asr'

export type ProviderIdentity<TKind extends ProviderKind = ProviderKind> = {
  readonly kind: TKind
  readonly providerProfileId: string
  readonly providerRevision: ProviderRevision
}

export type ProviderRole = 'viewer' | 'memory' | 'visual_summary' | 'asr'
export type ModelRole = Exclude<ProviderRole, 'asr'>

export type ProviderRoleModel<TRole extends ProviderRole = ProviderRole> = {
  readonly role: TRole
  readonly modelId: string
}

export type ProviderCapability =
  | 'text_generation'
  | 'image_input'
  | 'structured_output'
  | 'streaming'
  | 'speech_recognition'

export type ProviderProbeStatus = 'passed' | 'failed' | 'blocked' | 'skipped'
export type ProviderHealthStatus = 'healthy' | 'degraded' | 'unavailable'

export type ProviderErrorCode =
  | 'aborted'
  | 'timeout'
  | 'authentication_failed'
  | 'permission_denied'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'model_not_found'
  | 'unsupported_capability'
  | 'invalid_request'
  | 'network_error'
  | 'provider_unavailable'
  | 'provider_error'
  | 'invalid_response'
  | 'protocol_error'
  | 'content_filtered'
  | 'unknown'

export type ProviderErrorSource =
  | 'caller'
  | 'advx'
  | 'transport'
  | 'provider'
  | 'protocol'

export type ProviderFailure = {
  readonly code: ProviderErrorCode
  readonly messageCode: `provider.${ProviderErrorCode}`
  readonly retryable: boolean
  readonly source: ProviderErrorSource
  readonly httpStatus?: number
  readonly retryAfterMs?: DurationMs
  readonly providerRequestId?: string
}

export type ProviderFailureInput = Omit<ProviderFailure, 'messageCode'>

export type ProviderOutcome<TValue> =
  | { readonly ok: true; readonly value: TValue }
  | { readonly ok: false; readonly error: ProviderFailure }

export type ProviderHealthRequest = {
  readonly provider: ProviderIdentity
}

export type ProviderHealthResult = {
  readonly provider: ProviderIdentity
  readonly status: ProviderHealthStatus
  readonly checkedAt: WallClockTimestampMs
  readonly latency: ProviderLatency
}

export type ProviderCapabilityProbeRequest = {
  readonly provider: ProviderIdentity
  readonly capabilities: readonly ProviderCapability[]
  readonly roleModels: readonly ProviderRoleModel[]
}

export type ProviderCapabilityCheck = {
  readonly capability: ProviderCapability
  readonly status: ProviderProbeStatus
  readonly roleModel?: ProviderRoleModel
  readonly failure?: ProviderFailure
}

export type ProviderCapabilityProbeResult = {
  readonly provider: ProviderIdentity
  readonly status: ProviderProbeStatus
  readonly checkedAt: WallClockTimestampMs
  readonly latency: ProviderLatency
  readonly discoveredModelIds: readonly string[]
  readonly checks: readonly ProviderCapabilityCheck[]
}

export interface ProviderControlPort {
  health(
    request: ProviderHealthRequest,
    context: ProviderCallContext
  ): Promise<ProviderOutcome<ProviderHealthResult>>
  probeCapabilities(
    request: ProviderCapabilityProbeRequest,
    context: ProviderCallContext
  ): Promise<ProviderOutcome<ProviderCapabilityProbeResult>>
}

export type ProviderLatency = {
  readonly totalMs: DurationMs
  readonly timeToFirstTokenMs?: DurationMs
}

export function providerRevision(value: string): ProviderRevision {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 128) {
    throw new RangeError('provider revision must contain 1 to 128 characters')
  }
  return normalized as ProviderRevision
}

export function providerFailure(input: ProviderFailureInput): ProviderFailure {
  if (
    input.httpStatus !== undefined &&
    (!Number.isInteger(input.httpStatus) ||
      input.httpStatus < 100 ||
      input.httpStatus > 599)
  ) {
    throw new RangeError('provider HTTP status must be an integer from 100 to 599')
  }
  if (
    input.retryAfterMs !== undefined &&
    (!Number.isFinite(input.retryAfterMs) || input.retryAfterMs < 0)
  ) {
    throw new RangeError('provider retry-after must be a finite non-negative duration')
  }
  const failure: ProviderFailure = {
    code: input.code,
    messageCode: `provider.${input.code}`,
    retryable: input.retryable,
    source: input.source,
    ...(input.httpStatus === undefined ? {} : { httpStatus: input.httpStatus }),
    ...(input.retryAfterMs === undefined ? {} : { retryAfterMs: input.retryAfterMs }),
    ...(input.providerRequestId === undefined
      ? {}
      : { providerRequestId: boundedIdentifier(input.providerRequestId, 'provider request ID') })
  }
  return Object.freeze(failure)
}

export type AudioSource = 'microphone' | 'system_audio'

export type AudioFormat = {
  readonly sampleRateHz: number
  readonly channels: number
  readonly sampleWidthBits: number
}

export type AsrRequest = {
  readonly requestId: string
  readonly provider: ProviderIdentity<'asr'>
  readonly roleModel: ProviderRoleModel<'asr'>
  readonly sessionId: SessionId
  readonly source: AudioSource
  readonly startedAt: WallClockTimestampMs
  readonly endedAt: WallClockTimestampMs
  readonly format: AudioFormat
  readonly pcm: Readonly<Uint8Array>
  readonly language?: string
}

export type AsrTranscript = {
  readonly requestId: string
  readonly responseId: string
  readonly providerRequestId?: string
  readonly sessionId: SessionId
  readonly source: AudioSource
  readonly text: string
  readonly startedAt: WallClockTimestampMs
  readonly endedAt: WallClockTimestampMs
  readonly final: boolean
  readonly utteranceId?: string
  readonly revision: number
}

export type AsrProviderEvent =
  | { readonly type: 'transcript'; readonly transcript: AsrTranscript }
  | {
      readonly type: 'failed'
      readonly requestId: string
      readonly error: ProviderFailure
    }

export interface AsrProvider extends ProviderControlPort {
  transcribe(
    request: AsrRequest,
    context: ProviderCallContext
  ): AsyncIterable<AsrProviderEvent>
}

export type ModelMessageRole = 'system' | 'user' | 'assistant'

export type ModelInputPart =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'image'
      readonly mediaType: string
      readonly bytes: Readonly<Uint8Array>
    }

export type ModelMessage = {
  readonly role: ModelMessageRole
  readonly content: readonly ModelInputPart[]
}

export type ModelGenerationPurpose =
  | 'viewer'
  | 'memory'
  | 'visual_summary'
  | 'meme_validation'

export type ModelOutputRequest =
  | { readonly type: 'text' }
  | { readonly type: 'structured'; readonly schemaName: string }

export type ProtocolRepairAttempt = 0 | 1

export type ModelRequestBudget = {
  readonly maximumRequests: 2
  readonly usedRequests: number
  readonly remainingRequests: number
  take(): boolean
}

export function createModelRequestBudget(): ModelRequestBudget {
  let usedRequests = 0
  return Object.freeze({
    maximumRequests: 2 as const,
    get usedRequests() {
      return usedRequests
    },
    get remainingRequests() {
      return 2 - usedRequests
    },
    take() {
      if (usedRequests >= 2) return false
      usedRequests += 1
      return true
    }
  })
}

export function protocolRepairAttempt(value: number): ProtocolRepairAttempt {
  if (value !== 0 && value !== 1) {
    throw new RangeError('protocol repair attempt must be 0 or 1')
  }
  return value
}

export type ModelGenerationRequest = {
  readonly requestId: string
  readonly traceContext?: TraceContext
  readonly provider: ProviderIdentity<'model'>
  readonly roleModel: ProviderRoleModel<ModelRole>
  readonly purpose: ModelGenerationPurpose
  readonly messages: readonly ModelMessage[]
  readonly output: ModelOutputRequest
  readonly stream: boolean
  readonly protocolRepairAttempt: ProtocolRepairAttempt
  readonly maxOutputTokens?: number
}

export type ModelUsage = {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
}

export function modelUsage(usage: ModelUsage): ModelUsage {
  const normalized: ModelUsage = {
    ...(usage.inputTokens === undefined
      ? {}
      : { inputTokens: nonNegativeSafeInteger(usage.inputTokens, 'input tokens') }),
    ...(usage.outputTokens === undefined
      ? {}
      : { outputTokens: nonNegativeSafeInteger(usage.outputTokens, 'output tokens') }),
    ...(usage.totalTokens === undefined
      ? {}
      : { totalTokens: nonNegativeSafeInteger(usage.totalTokens, 'total tokens') })
  }
  return Object.freeze(normalized)
}

export type ModelFinishReason =
  | 'stop'
  | 'length'
  | 'content_filter'
  | 'tool_call'
  | 'unknown'

export type ModelGenerationOutput =
  | { readonly type: 'text'; readonly text: string }
  | {
      readonly type: 'structured'
      readonly schemaName: string
      readonly text: string
    }

export type ModelGenerationResult = {
  readonly requestId: string
  readonly responseId: string
  readonly providerRequestId?: string
  readonly provider: ProviderIdentity<'model'>
  readonly roleModel: ProviderRoleModel<ModelRole>
  readonly protocolRepairAttempt: ProtocolRepairAttempt
  readonly output: ModelGenerationOutput
  readonly finishReason: ModelFinishReason
  readonly usage: ModelUsage
  readonly latency: ProviderLatency
}

export type ModelStreamEvent =
  | {
      readonly type: 'started'
      readonly requestId: string
      readonly responseId: string
      readonly providerRequestId?: string
    }
  | {
      readonly type: 'text_delta'
      readonly requestId: string
      readonly responseId: string
      readonly textDelta: string
    }
  | { readonly type: 'completed'; readonly result: ModelGenerationResult }
  | {
      readonly type: 'failed'
      readonly requestId: string
      readonly error: ProviderFailure
    }

export interface ModelProvider extends ProviderControlPort {
  generate(
    request: ModelGenerationRequest,
    context: ProviderCallContext,
    requestBudget: ModelRequestBudget
  ): Promise<ProviderOutcome<ModelGenerationResult>>
  stream(
    request: ModelGenerationRequest,
    context: ProviderCallContext,
    requestBudget: ModelRequestBudget
  ): AsyncIterable<ModelStreamEvent>
}

function boundedIdentifier(value: string, name: string): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 512) {
    throw new RangeError(`${name} must contain 1 to 512 characters`)
  }
  return normalized
}

function nonNegativeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`)
  }
  return value
}
