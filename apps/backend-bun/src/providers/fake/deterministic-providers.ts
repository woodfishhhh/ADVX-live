import {
  durationMs,
  modelUsage,
  providerFailure,
  type AsrProvider,
  type AsrProviderEvent,
  type AsrRequest,
  type ModelFinishReason,
  type ModelGenerationRequest,
  type ModelGenerationResult,
  type ModelProvider,
  type ModelRequestBudget,
  type ModelStreamEvent,
  type ProviderCallContext,
  type ProviderCapabilityProbeRequest,
  type ProviderCapabilityProbeResult,
  type ProviderHealthRequest,
  type ProviderHealthResult,
  type ProviderIdentity,
  type ProviderOutcome,
  type ProviderRoleModel,
  type ProviderFailureInput,
  type ModelUsage
} from '../../application/ports'
import {
  adapterControls,
  cancellationOrDeadline,
  configuredFailure,
  evidenceMetadata,
  healthResult,
  preflightProvider,
  waitForAdapterLatency,
  type ProviderAdapterControls,
  type ProviderEvidenceMetadata
} from '../provider-adapter-support'

export type DeterministicAsrPlan = {
  readonly text?: string
  readonly final?: boolean
  readonly utteranceId?: string
  readonly revision?: number
  readonly failure?: ProviderFailureInput
  readonly abort?: boolean
  readonly latencyMs?: number
}

export type DeterministicAsrConfig = {
  readonly provider: ProviderIdentity<'asr'>
  readonly roleModel: ProviderRoleModel<'asr'>
  readonly plan: DeterministicAsrPlan | ((request: AsrRequest) => DeterministicAsrPlan)
  readonly controls?: ProviderAdapterControls
}

export type DeterministicModelPlan = {
  readonly text?: string
  readonly deltas?: readonly string[]
  readonly responseId?: string
  readonly providerRequestId?: string
  readonly finishReason?: ModelFinishReason
  readonly usage?: ModelUsage
  readonly failure?: ProviderFailureInput
  readonly abort?: boolean
  readonly latencyMs?: number
}

export type DeterministicModelConfig = {
  readonly provider: ProviderIdentity<'model'>
  readonly plan:
    | DeterministicModelPlan
    | ((request: ModelGenerationRequest) => DeterministicModelPlan)
  readonly controls?: ProviderAdapterControls
}

const FAKE_ASR_EVIDENCE: ProviderEvidenceMetadata = evidenceMetadata({
  evidenceClass: 'fake',
  source: 'deterministic',
  adapterId: 'advx-deterministic-asr-v1',
  sanitized: true,
  liveFallback: false
})

const FAKE_MODEL_EVIDENCE: ProviderEvidenceMetadata = evidenceMetadata({
  evidenceClass: 'fake',
  source: 'deterministic',
  adapterId: 'advx-deterministic-model-v1',
  sanitized: true,
  liveFallback: false
})

export class DeterministicAsrProvider implements AsrProvider {
  readonly evidence = FAKE_ASR_EVIDENCE
  readonly #provider: ProviderIdentity<'asr'>
  readonly #roleModel: ProviderRoleModel<'asr'>
  readonly #plan: DeterministicAsrConfig['plan']
  readonly #controls: ReturnType<typeof adapterControls>

  constructor(config: DeterministicAsrConfig) {
    this.#provider = config.provider
    this.#roleModel = config.roleModel
    this.#plan = config.plan
    this.#controls = adapterControls(config.controls)
  }

  health(
    request: ProviderHealthRequest,
    context: ProviderCallContext
  ): Promise<ProviderOutcome<ProviderHealthResult>> {
    const failure = preflightProvider(
      this.#provider,
      request.provider,
      context,
      this.#controls.monotonicNow
    )
    return Promise.resolve(
      failure === undefined
        ? healthResult(this.#provider, this.#controls)
        : { ok: false, error: failure }
    )
  }

  probeCapabilities(
    request: ProviderCapabilityProbeRequest,
    context: ProviderCallContext
  ): Promise<ProviderOutcome<ProviderCapabilityProbeResult>> {
    const failure = preflightProvider(
      this.#provider,
      request.provider,
      context,
      this.#controls.monotonicNow
    )
    if (failure !== undefined) return Promise.resolve({ ok: false, error: failure })
    const checks = request.capabilities.map((capability) => ({
      capability,
      status: capability === 'speech_recognition' ? 'passed' as const : 'failed' as const,
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
    const value: ProviderCapabilityProbeResult = {
      provider: this.#provider,
      status: checks.every((check) => check.status === 'passed') ? 'passed' : 'failed',
      checkedAt: this.#controls.wallClockNow() as ProviderCapabilityProbeResult['checkedAt'],
      latency: { totalMs: durationMs(0) },
      discoveredModelIds: [this.#roleModel.modelId],
      checks
    }
    return Promise.resolve({ ok: true, value })
  }

  async *transcribe(
    request: AsrRequest,
    context: ProviderCallContext
  ): AsyncIterable<AsrProviderEvent> {
    const preflight = preflightProvider(
      this.#provider,
      request.provider,
      context,
      this.#controls.monotonicNow
    )
    if (preflight !== undefined) {
      yield { type: 'failed', requestId: request.requestId, error: preflight }
      return
    }
    const plan = typeof this.#plan === 'function' ? this.#plan(request) : this.#plan
    const latencyFailure = await waitForAdapterLatency(
      plan.latencyMs ?? this.#controls.latencyMs,
      this.#controls,
      context
    )
    if (latencyFailure !== undefined) {
      yield { type: 'failed', requestId: request.requestId, error: latencyFailure }
      return
    }
    const failure = configuredFailure(plan.failure, plan.abort)
    if (failure !== undefined) {
      yield { type: 'failed', requestId: request.requestId, error: failure }
      return
    }
    if (plan.text === undefined) {
      yield {
        type: 'failed',
        requestId: request.requestId,
        error: providerFailure({ code: 'invalid_response', source: 'protocol', retryable: false })
      }
      return
    }
    yield {
      type: 'transcript',
      transcript: {
        requestId: request.requestId,
        responseId: `deterministic-asr-${request.requestId}`,
        providerRequestId: `deterministic-asr-request-${request.requestId}`,
        sessionId: request.sessionId,
        source: request.source,
        text: plan.text,
        startedAt: request.startedAt,
        endedAt: request.endedAt,
        final: plan.final ?? true,
        ...(plan.utteranceId === undefined ? {} : { utteranceId: plan.utteranceId }),
        revision: plan.revision ?? 1
      }
    }
  }
}

export class DeterministicModelProvider implements ModelProvider {
  readonly evidence = FAKE_MODEL_EVIDENCE
  readonly #provider: ProviderIdentity<'model'>
  readonly #plan: DeterministicModelConfig['plan']
  readonly #controls: ReturnType<typeof adapterControls>

  constructor(config: DeterministicModelConfig) {
    this.#provider = config.provider
    this.#plan = config.plan
    this.#controls = adapterControls(config.controls)
  }

  health(
    request: ProviderHealthRequest,
    context: ProviderCallContext
  ): Promise<ProviderOutcome<ProviderHealthResult>> {
    const failure = preflightProvider(
      this.#provider,
      request.provider,
      context,
      this.#controls.monotonicNow
    )
    return Promise.resolve(
      failure === undefined
        ? healthResult(this.#provider, this.#controls)
        : { ok: false, error: failure }
    )
  }

  probeCapabilities(
    request: ProviderCapabilityProbeRequest,
    context: ProviderCallContext
  ): Promise<ProviderOutcome<ProviderCapabilityProbeResult>> {
    const failure = preflightProvider(
      this.#provider,
      request.provider,
      context,
      this.#controls.monotonicNow
    )
    if (failure !== undefined) return Promise.resolve({ ok: false, error: failure })
    const checks = request.capabilities.map((capability) => ({
      capability,
      status: capability === 'text_generation' || capability === 'streaming'
        ? 'passed' as const
        : 'failed' as const,
      ...(capability === 'text_generation' || capability === 'streaming'
        ? {}
        : {
            failure: providerFailure({
              code: 'unsupported_capability',
              source: 'advx',
              retryable: false
            })
          })
    }))
    const value: ProviderCapabilityProbeResult = {
      provider: this.#provider,
      status: checks.every((check) => check.status === 'passed') ? 'passed' : 'failed',
      checkedAt: this.#controls.wallClockNow() as ProviderCapabilityProbeResult['checkedAt'],
      latency: { totalMs: durationMs(0) },
      discoveredModelIds: [],
      checks
    }
    return Promise.resolve({ ok: true, value })
  }

  async generate(
    request: ModelGenerationRequest,
    context: ProviderCallContext,
    requestBudget: ModelRequestBudget
  ): Promise<ProviderOutcome<ModelGenerationResult>> {
    const preflight = preflightProvider(
      this.#provider,
      request.provider,
      context,
      this.#controls.monotonicNow
    )
    if (preflight !== undefined) return { ok: false, error: preflight }
    if (!requestBudget.take()) {
      return {
        ok: false,
        error: providerFailure({ code: 'invalid_request', source: 'advx', retryable: false })
      }
    }
    const plan = typeof this.#plan === 'function' ? this.#plan(request) : this.#plan
    const latencyFailure = await waitForAdapterLatency(
      plan.latencyMs ?? this.#controls.latencyMs,
      this.#controls,
      context
    )
    if (latencyFailure !== undefined) return { ok: false, error: latencyFailure }
    const failure = configuredFailure(plan.failure, plan.abort)
    if (failure !== undefined) return { ok: false, error: failure }
    if (plan.text === undefined) {
      return {
        ok: false,
        error: providerFailure({ code: 'invalid_response', source: 'protocol', retryable: false })
      }
    }
    return {
      ok: true,
      value: modelResult(
        request,
        plan,
        plan.text,
        plan.latencyMs ?? this.#controls.latencyMs
      )
    }
  }

  async *stream(
    request: ModelGenerationRequest,
    context: ProviderCallContext,
    requestBudget: ModelRequestBudget
  ): AsyncIterable<ModelStreamEvent> {
    const preflight = preflightProvider(
      this.#provider,
      request.provider,
      context,
      this.#controls.monotonicNow
    )
    if (preflight !== undefined) {
      yield { type: 'failed', requestId: request.requestId, error: preflight }
      return
    }
    if (!requestBudget.take()) {
      yield {
        type: 'failed',
        requestId: request.requestId,
        error: providerFailure({ code: 'invalid_request', source: 'advx', retryable: false })
      }
      return
    }
    const plan = typeof this.#plan === 'function' ? this.#plan(request) : this.#plan
    const responseId = plan.responseId ?? `deterministic-model-${request.requestId}`
    yield {
      type: 'started',
      requestId: request.requestId,
      responseId,
      providerRequestId: plan.providerRequestId
    }
    const latencyFailure = await waitForAdapterLatency(
      plan.latencyMs ?? this.#controls.latencyMs,
      this.#controls,
      context
    )
    if (latencyFailure !== undefined) {
      yield { type: 'failed', requestId: request.requestId, error: latencyFailure }
      return
    }
    const failure = configuredFailure(plan.failure, plan.abort)
    if (failure !== undefined) {
      yield { type: 'failed', requestId: request.requestId, error: failure }
      return
    }
    if (plan.text === undefined) {
      yield {
        type: 'failed',
        requestId: request.requestId,
        error: providerFailure({ code: 'invalid_response', source: 'protocol', retryable: false })
      }
      return
    }
    const deltas = plan.deltas ?? [plan.text]
    for (const textDelta of deltas) {
      const cancellation = cancellationOrDeadline(context, this.#controls.monotonicNow)
      if (cancellation !== undefined) {
        yield { type: 'failed', requestId: request.requestId, error: cancellation }
        return
      }
      yield { type: 'text_delta', requestId: request.requestId, responseId, textDelta }
    }
    yield {
      type: 'completed',
      result: modelResult(
        request,
        plan,
        plan.text,
        plan.latencyMs ?? this.#controls.latencyMs,
        responseId
      )
    }
  }
}

function modelResult(
  request: ModelGenerationRequest,
  plan: DeterministicModelPlan,
  text: string,
  latencyMs: number,
  responseId = plan.responseId ?? `deterministic-model-${request.requestId}`
): ModelGenerationResult {
  return {
    requestId: request.requestId,
    responseId,
    ...(plan.providerRequestId === undefined ? {} : { providerRequestId: plan.providerRequestId }),
    provider: request.provider,
    roleModel: request.roleModel,
    protocolRepairAttempt: request.protocolRepairAttempt,
    output: request.output.type === 'structured'
      ? { type: 'structured', schemaName: request.output.schemaName, text }
      : { type: 'text', text },
    finishReason: plan.finishReason ?? 'stop',
    usage: modelUsage(plan.usage ?? {}),
    latency: { totalMs: durationMs(latencyMs) }
  }
}
