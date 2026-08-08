import {
  type AsrProvider,
  type AsrProviderEvent,
  type AsrRequest,
  type ModelGenerationRequest,
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
  type ProviderFailureInput
} from '../../application/ports'
import {
  DeterministicAsrProvider,
  DeterministicModelProvider,
  type DeterministicAsrPlan,
  type DeterministicModelPlan
} from '../fake/deterministic-providers'
import {
  adapterControls,
  evidenceMetadata,
  type ProviderAdapterControls,
  type ProviderEvidenceMetadata
} from '../provider-adapter-support'

export type RecordedAsrEvent = DeterministicAsrPlan & {
  readonly requestId?: string
}

export type RecordedAsrFixture = {
  readonly recordingId: string
  readonly sanitized: true
  readonly events: readonly RecordedAsrEvent[]
}

export type RecordedModelResponse = DeterministicModelPlan & {
  readonly requestId?: string
}

export type RecordedModelFixture = {
  readonly recordingId: string
  readonly sanitized: true
  readonly responses: readonly RecordedModelResponse[]
}

export type RecordedAsrConfig = {
  readonly provider: ProviderIdentity<'asr'>
  readonly roleModel: ProviderRoleModel<'asr'>
  readonly fixture: RecordedAsrFixture
  readonly controls?: ProviderAdapterControls
}

export type RecordedModelConfig = {
  readonly provider: ProviderIdentity<'model'>
  readonly fixture: RecordedModelFixture
  readonly controls?: ProviderAdapterControls
}

export class RecordedAsrProvider implements AsrProvider {
  readonly evidence: ProviderEvidenceMetadata
  readonly #inner: DeterministicAsrProvider
  readonly #fixture: RecordedAsrFixture
  readonly #controls: ReturnType<typeof adapterControls>
  #cursor = 0

  constructor(config: RecordedAsrConfig) {
    validateRecording(config.fixture.recordingId, config.fixture.sanitized)
    this.#fixture = config.fixture
    this.#controls = adapterControls(config.controls)
    this.evidence = evidenceMetadata({
      evidenceClass: 'recorded',
      source: 'recorded_sse',
      adapterId: 'advx-recorded-asr-sse-v1',
      recordingId: config.fixture.recordingId,
      sanitized: true,
      liveFallback: false
    })
    this.#inner = new DeterministicAsrProvider({
      provider: config.provider,
      roleModel: config.roleModel,
      controls: this.#controls,
      plan: (request) => this.#nextAsrPlan(request)
    })
  }

  health(
    request: ProviderHealthRequest,
    context: ProviderCallContext
  ): Promise<ProviderOutcome<ProviderHealthResult>> {
    return this.#inner.health(request, context)
  }

  probeCapabilities(
    request: ProviderCapabilityProbeRequest,
    context: ProviderCallContext
  ): Promise<ProviderOutcome<ProviderCapabilityProbeResult>> {
    return this.#inner.probeCapabilities(request, context)
  }

  transcribe(
    request: AsrRequest,
    context: ProviderCallContext
  ): AsyncIterable<AsrProviderEvent> {
    return this.#inner.transcribe(request, context)
  }

  #nextAsrPlan(request: AsrRequest): DeterministicAsrPlan {
    const index = this.#findIndex(request.requestId)
    if (index === -1) return missingRecordingPlan()
    this.#cursor = Math.max(this.#cursor, index + 1)
    const { requestId: _requestId, ...plan } = this.#fixture.events[index]!
    return plan
  }

  #findIndex(requestId: string): number {
    const exact = this.#fixture.events.findIndex(
      (event) => event.requestId === requestId
    )
    if (exact >= 0) return exact
    return this.#cursor < this.#fixture.events.length ? this.#cursor : -1
  }
}

export class RecordedModelProvider implements ModelProvider {
  readonly evidence: ProviderEvidenceMetadata
  readonly #inner: DeterministicModelProvider
  readonly #fixture: RecordedModelFixture
  #cursor = 0

  constructor(config: RecordedModelConfig) {
    validateRecording(config.fixture.recordingId, config.fixture.sanitized)
    this.#fixture = config.fixture
    this.evidence = evidenceMetadata({
      evidenceClass: 'recorded',
      source: 'recorded_sse',
      adapterId: 'advx-recorded-model-sse-v1',
      recordingId: config.fixture.recordingId,
      sanitized: true,
      liveFallback: false
    })
    this.#inner = new DeterministicModelProvider({
      provider: config.provider,
      controls: config.controls,
      plan: (request) => this.#nextModelPlan(request)
    })
  }

  health(
    request: ProviderHealthRequest,
    context: ProviderCallContext
  ): Promise<ProviderOutcome<ProviderHealthResult>> {
    return this.#inner.health(request, context)
  }

  probeCapabilities(
    request: ProviderCapabilityProbeRequest,
    context: ProviderCallContext
  ): Promise<ProviderOutcome<ProviderCapabilityProbeResult>> {
    return this.#inner.probeCapabilities(request, context)
  }

  generate(
    request: ModelGenerationRequest,
    context: ProviderCallContext,
    requestBudget: ModelRequestBudget
  ) {
    return this.#inner.generate(request, context, requestBudget)
  }

  stream(
    request: ModelGenerationRequest,
    context: ProviderCallContext,
    requestBudget: ModelRequestBudget
  ): AsyncIterable<ModelStreamEvent> {
    return this.#inner.stream(request, context, requestBudget)
  }

  #nextModelPlan(request: ModelGenerationRequest): DeterministicModelPlan {
    const index = this.#findIndex(request.requestId)
    if (index === -1) return missingRecordingPlan()
    this.#cursor = Math.max(this.#cursor, index + 1)
    const { requestId: _requestId, ...plan } = this.#fixture.responses[index]!
    return plan
  }

  #findIndex(requestId: string): number {
    const exact = this.#fixture.responses.findIndex(
      (response) => response.requestId === requestId
    )
    if (exact >= 0) return exact
    return this.#cursor < this.#fixture.responses.length ? this.#cursor : -1
  }
}

function missingRecordingPlan(): {
  readonly failure: ProviderFailureInput
} {
  return {
    failure: {
      code: 'provider_error',
      source: 'advx',
      retryable: false
    }
  }
}

function validateRecording(recordingId: string, sanitized: true): void {
  if (recordingId.trim().length === 0 || recordingId.length > 128) {
    throw new RangeError('recording ID must contain 1 to 128 characters')
  }
  if (sanitized !== true) throw new RangeError('recording must be sanitized')
}
