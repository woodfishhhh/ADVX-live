import {
  createModelRequestBudget,
  monotonicDeadline,
  providerRevision,
  wallClockTimestampMs,
  type AsrProviderEvent,
  type AudioSource,
  type ModelGenerationRequest,
  type ProviderCallContext,
  type ProviderIdentity,
  type ProviderOutcome,
  type ProviderRoleModel
} from '../src/application/ports'
import {
  StepFunAsrProvider,
  type StepFunAsrConfig
} from '../src/providers/asr/stepfun-asr-provider'
import {
  AiSdkModelGateway,
  type ModelGatewayConfig
} from '../src/providers/model/model-gateway'

const LIVE_CONSENT = '1'
const DEFAULT_BASE_URL = 'https://api.stepfun.com/v1'
const DEFAULT_ASR_MODEL = 'stepaudio-2.5-asr'
const DEFAULT_VIEWER_MODEL = 'step-3.7-flash'
const REQUEST_TIMEOUT_MS = 60_000

type LiveProofEnvironment = {
  readonly apiKey: string
  readonly asrBaseUrl: string
  readonly modelBaseUrl: string
  readonly asrModel: string
  readonly viewerModel: string
}

type SanitizedAsrResult = {
  readonly source: AudioSource
  readonly eventTypes: readonly string[]
  readonly transcriptEvents: number
  readonly finalTranscript: boolean
  readonly finalTextLength: number
  readonly providerRequestIdPresent: boolean
  readonly failureCodes: readonly string[]
}

type SanitizedModelResult = {
  readonly ok: boolean
  readonly outputType?: string
  readonly outputTextLength?: number
  readonly finishReason?: string
  readonly usage?: {
    readonly inputTokens?: number
    readonly outputTokens?: number
    readonly totalTokens?: number
  }
  readonly providerRequestIdPresent?: boolean
  readonly errorCode?: string
}

function environment(): LiveProofEnvironment {
  if (Bun.env.AGT015_LIVE_CONSENT !== LIVE_CONSENT) {
    throw new Error('AGT-015 requires AGT015_LIVE_CONSENT=1')
  }

  const apiKey = Bun.env.STEPFUN_API_KEY?.trim()
  if (!apiKey) throw new Error('AGT-015 requires STEPFUN_API_KEY')

  return {
    apiKey,
    asrBaseUrl: Bun.env.AGT015_ASR_BASE_URL?.trim() || DEFAULT_BASE_URL,
    modelBaseUrl: Bun.env.AGT015_MODEL_BASE_URL?.trim() || DEFAULT_BASE_URL,
    asrModel: Bun.env.AGT015_ASR_MODEL?.trim() || DEFAULT_ASR_MODEL,
    viewerModel: Bun.env.AGT015_VIEWER_MODEL?.trim() || DEFAULT_VIEWER_MODEL
  }
}

function providerContext(expiresInMs = REQUEST_TIMEOUT_MS): ProviderCallContext {
  return {
    callerSignal: new AbortController().signal,
    deadline: monotonicDeadline(performance.now() + expiresInMs),
    cancellationReason: () => undefined
  }
}

function cancelledContext(): ProviderCallContext {
  const controller = new AbortController()
  controller.abort('agt-015-cancelled')
  return {
    callerSignal: controller.signal,
    deadline: monotonicDeadline(performance.now() + REQUEST_TIMEOUT_MS),
    cancellationReason: () => ({ code: 'caller_cancelled' })
  }
}

function expiredContext(): ProviderCallContext {
  return {
    callerSignal: new AbortController().signal,
    deadline: monotonicDeadline(performance.now() - 1),
    cancellationReason: () => ({ code: 'deadline_exceeded' })
  }
}

function asrRequest(
  provider: ProviderIdentity<'asr'>,
  roleModel: ProviderRoleModel<'asr'>,
  source: AudioSource,
  pcm: Uint8Array
) {
  const now = Date.now()
  return {
    requestId: `agt-015-live-${source}`,
    provider,
    roleModel,
    sessionId: 'agt-015-live-session',
    source,
    startedAt: wallClockTimestampMs(now),
    endedAt: wallClockTimestampMs(now + 500),
    format: { sampleRateHz: 16_000, channels: 1, sampleWidthBits: 16 },
    pcm
  } as const
}

function syntheticPcm(): Uint8Array {
  const pcm = new Uint8Array(16_000)
  for (let sampleIndex = 0; sampleIndex < pcm.length / 2; sampleIndex += 1) {
    const sample = Math.round(Math.sin(sampleIndex / 8) * 3_000)
    pcm[sampleIndex * 2] = sample & 0xff
    pcm[sampleIndex * 2 + 1] = (sample >> 8) & 0xff
  }
  return pcm
}

async function collectAsr(
  provider: StepFunAsrProvider,
  request: ReturnType<typeof asrRequest>
): Promise<SanitizedAsrResult> {
  const events: AsrProviderEvent[] = []
  for await (const event of provider.transcribe(request, providerContext())) {
    events.push(event)
  }

  const transcripts = events.filter(
    (event): event is Extract<AsrProviderEvent, { type: 'transcript' }> =>
      event.type === 'transcript'
  )
  const final = [...transcripts].reverse().find((event) => event.transcript.final)
  return {
    source: request.source,
    eventTypes: events.map((event) => event.type),
    transcriptEvents: transcripts.length,
    finalTranscript: final !== undefined,
    finalTextLength: final?.transcript.text.length ?? 0,
    providerRequestIdPresent: final?.transcript.providerRequestId !== undefined,
    failureCodes: events
      .filter((event): event is Extract<AsrProviderEvent, { type: 'failed' }> =>
        event.type === 'failed'
      )
      .map((event) => event.error.code)
  }
}

function modelRequest(
  provider: ProviderIdentity<'model'>,
  modelId: string,
  image: Uint8Array
): ModelGenerationRequest {
  return {
    requestId: 'agt-015-live-viewer',
    provider,
    roleModel: { role: 'viewer', modelId },
    purpose: 'viewer',
    messages: [
      {
        role: 'system',
        content: [{ type: 'text', text: 'Answer concisely.' }]
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Describe this image in five words or fewer.' },
          { type: 'image', mediaType: 'image/png', bytes: image }
        ]
      }
    ],
    output: { type: 'text' },
    stream: false,
    protocolRepairAttempt: 0,
    maxOutputTokens: 512
  }
}

function tinyPng(): Uint8Array {
  return Uint8Array.from([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
    0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
    0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240,
    31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69,
    78, 68, 174, 66, 96, 130
  ])
}

function sanitizeModel(
  outcome: ProviderOutcome<Awaited<ReturnType<AiSdkModelGateway['generate']>> extends
    ProviderOutcome<infer TValue> ? TValue : never>
): SanitizedModelResult {
  if (!outcome.ok) return { ok: false, errorCode: outcome.error.code }
  return {
    ok: true,
    outputType: outcome.value.output.type,
    outputTextLength: outcome.value.output.text.length,
    finishReason: outcome.value.finishReason,
    usage: outcome.value.usage,
    providerRequestIdPresent: outcome.value.providerRequestId !== undefined
  }
}

async function main(): Promise<void> {
  const config = environment()
  const asrProvider: ProviderIdentity<'asr'> = {
    kind: 'asr',
    providerProfileId: 'stepfun-live-agt-015',
    providerRevision: providerRevision('agt-015-live-2026-08-04')
  }
  const asrRoleModel: ProviderRoleModel<'asr'> = {
    role: 'asr',
    modelId: config.asrModel
  }
  const asrConfig: StepFunAsrConfig = {
    apiKey: config.apiKey,
    provider: asrProvider,
    roleModel: asrRoleModel,
    baseUrl: config.asrBaseUrl,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    maximumRetries: 0
  }
  const asr = new StepFunAsrProvider(asrConfig)
  const asrProbe = await asr.probeCapabilities(
    {
      provider: asrProvider,
      capabilities: ['speech_recognition'],
      roleModels: [asrRoleModel]
    },
    providerContext()
  )
  const pcm = syntheticPcm()
  const microphone = await collectAsr(
    asr,
    asrRequest(asrProvider, asrRoleModel, 'microphone', pcm)
  )
  const systemAudio = await collectAsr(
    asr,
    asrRequest(asrProvider, asrRoleModel, 'system_audio', pcm)
  )
  const cancelledAsr = await collectAsrWithContext(
    asr,
    asrRequest(asrProvider, asrRoleModel, 'microphone', pcm),
    cancelledContext()
  )
  const expiredAsr = await collectAsrWithContext(
    asr,
    asrRequest(asrProvider, asrRoleModel, 'system_audio', pcm),
    expiredContext()
  )

  const modelProvider: ProviderIdentity<'model'> = {
    kind: 'model',
    providerProfileId: 'stepfun-live-agt-015-model',
    providerRevision: providerRevision('agt-015-live-2026-08-04')
  }
  const modelConfig: ModelGatewayConfig = {
    apiKey: config.apiKey,
    baseUrl: config.modelBaseUrl,
    provider: modelProvider,
    roleModels: {
      viewer: config.viewerModel,
      memory: config.viewerModel,
      visual_summary: config.viewerModel
    },
    requestTimeoutMs: REQUEST_TIMEOUT_MS
  }
  const model = new AiSdkModelGateway(modelConfig, {
    responseId: (requestId) => `agt-015-${requestId}`
  })
  const modelProbe = await model.probeCapabilities(
    {
      provider: modelProvider,
      capabilities: ['text_generation', 'image_input', 'streaming'],
      roleModels: [{ role: 'viewer', modelId: config.viewerModel }]
    },
    providerContext()
  )
  const viewer = await model.generate(
    modelRequest(modelProvider, config.viewerModel, tinyPng()),
    providerContext(),
    createModelRequestBudget()
  )
  const cancelledModel = await model.generate(
    modelRequest(modelProvider, config.viewerModel, tinyPng()),
    cancelledContext(),
    createModelRequestBudget()
  )
  const expiredModel = await model.generate(
    modelRequest(modelProvider, config.viewerModel, tinyPng()),
    expiredContext(),
    createModelRequestBudget()
  )

  console.log(JSON.stringify({
    schemaVersion: 1,
    taskId: 'AGT-015',
    evidenceClass: 'credentialed_live',
    consent: 'AGT015_LIVE_CONSENT=1',
    destination: {
      asrBaseUrl: config.asrBaseUrl,
      modelBaseUrl: config.modelBaseUrl
    },
    models: {
      asr: config.asrModel,
      viewer: config.viewerModel
    },
    asr: {
      capabilityProbe: sanitizeProbe(asrProbe),
      microphone,
      systemAudio,
      cancellation: sanitizeAsrFailure(cancelledAsr),
      deadline: sanitizeAsrFailure(expiredAsr)
    },
    model: {
      capabilityProbe: sanitizeProbe(modelProbe),
      viewer: sanitizeModel(viewer),
      cancellation: sanitizeModel(cancelledModel),
      deadline: sanitizeModel(expiredModel)
    },
    secretHandling: 'API key was read from the environment and never emitted.'
  }, null, 2))
}

async function collectAsrWithContext(
  provider: StepFunAsrProvider,
  request: ReturnType<typeof asrRequest>,
  context: ProviderCallContext
): Promise<AsrProviderEvent[]> {
  const events: AsrProviderEvent[] = []
  for await (const event of provider.transcribe(request, context)) events.push(event)
  return events
}

function sanitizeAsrFailure(events: readonly AsrProviderEvent[]) {
  return events
    .filter((event): event is Extract<AsrProviderEvent, { type: 'failed' }> =>
      event.type === 'failed'
    )
    .map((event) => event.error.code)
}

function sanitizeProbe(outcome: ProviderOutcome<unknown>) {
  if (!outcome.ok) return { ok: false, errorCode: outcome.error.code }
  const value = outcome.value as {
    readonly status: string
    readonly discoveredModelIds?: readonly string[]
    readonly checks?: readonly { readonly capability: string; readonly status: string }[]
  }
  return {
    ok: true,
    status: value.status,
    discoveredModelCount: value.discoveredModelIds?.length,
    checks: value.checks?.map(({ capability, status }) => ({ capability, status }))
  }
}

await main()
