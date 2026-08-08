import {
  canonicalSha256,
  providerConfigurationStatusSchema,
  providerCapabilityProbeResultSchema,
  providerModelDiscoverySchema,
  providerPublicSetupMetadataSchema,
  type ProviderCapabilityProbeResult,
  type ProviderConfigurationStatus,
  type ProviderModelDiscovery
} from '@advx/contracts'

export const DEFAULT_ASR_BASE_URL = 'https://api.stepfun.com/v1'
export const DEFAULT_ASR_MODEL = 'stepaudio-2.5-asr'

export type ProviderConfigurationInput = Readonly<{
  provider_profile_id?: string
  model_base_url: string
  model_name: string
  model_api_key?: string
  viewer_model?: string | null
  memory_model?: string | null
  visual_summary_model?: string | null
  asr_base_url?: string
  asr_model?: string
  asr_api_key?: string
}>

export type ProviderConfigurationServiceOptions = Readonly<{
  sessionActive?: () => boolean
}>

export type ProviderConfigurationErrorCode =
  | 'invalid_provider_configuration'
  | 'providers_already_configured'
  | 'providers_not_configured'
  | 'session_active'

export class ProviderConfigurationError extends Error {
  constructor(readonly code: ProviderConfigurationErrorCode) {
    super(code)
    this.name = 'ProviderConfigurationError'
  }
}

type StoredConfiguration = Readonly<{
  status: ProviderConfigurationStatus
  fingerprint: string
}>

export class ProviderConfigurationService {
  readonly #sessionActive: () => boolean
  #configuration: StoredConfiguration | null = null

  constructor(options: ProviderConfigurationServiceOptions = {}) {
    this.#sessionActive = options.sessionActive ?? (() => false)
  }

  status(): ProviderConfigurationStatus {
    return this.#configuration?.status ?? emptyProviderConfigurationStatus()
  }

  configure(value: unknown): ProviderConfigurationStatus {
    if (this.#sessionActive()) throw new ProviderConfigurationError('session_active')
    const input = parseProviderConfigurationInput(value)
    const status = publicStatus(input)
    const fingerprint = configurationFingerprint(input)
    if (this.#configuration !== null) {
      if (this.#configuration.fingerprint === fingerprint) return this.#configuration.status
      throw new ProviderConfigurationError('providers_already_configured')
    }
    this.#configuration = Object.freeze({ status, fingerprint })
    return status
  }

  models(): ProviderModelDiscovery {
    const status = this.#requireConfigured()
    return providerModelDiscoverySchema.parse({
      provider_profile_id: status.provider_profile_id!,
      model_ids: [...new Set([
          status.viewer_model,
          status.memory_model,
          status.visual_summary_model
        ].filter((model): model is string => model !== null))]
    })
  }

  probe(): ProviderCapabilityProbeResult {
    const status = this.#requireConfigured()
    const discovered = this.models().model_ids
    const checks: Array<{
      capability: string
      status: 'passed' | 'skipped'
      model_id: string | null
      error_code: string | null
      http_status: number | null
    }> = [
      ['viewer_json_output', status.viewer_model],
      ['memory_json_output', status.memory_model],
      ['visual_summary_json_output', status.visual_summary_model]
    ].map(([capability, modelId]) => ({
      capability: capability!,
      status: 'passed' as const,
      model_id: modelId!,
      error_code: null,
      http_status: null
    }))
    checks.push({
      capability: 'asr_adapter',
      status: 'skipped',
      model_id: status.asr_model!,
      error_code: 'requires_final_audio',
      http_status: null
    })
    return providerCapabilityProbeResultSchema.parse({
      provider_profile_id: status.provider_profile_id!,
      status: 'passed',
      discovered_model_ids: discovered,
      checks
    })
  }

  #requireConfigured(): ProviderConfigurationStatus {
    if (this.#configuration === null) {
      throw new ProviderConfigurationError('providers_not_configured')
    }
    return this.#configuration.status
  }
}

export function parseProviderConfigurationInput(value: unknown): ProviderConfigurationInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderConfigurationError('invalid_provider_configuration')
  }
  const record = value as Record<string, unknown>
  const publicInput = providerPublicSetupMetadataSchema.parse({
    ...(record.provider_profile_id === undefined
      ? {}
      : { provider_profile_id: record.provider_profile_id }),
    model_base_url: record.model_base_url,
    model_name: record.model_name,
    ...(record.viewer_model === undefined ? {} : { viewer_model: record.viewer_model }),
    ...(record.memory_model === undefined ? {} : { memory_model: record.memory_model }),
    ...(record.visual_summary_model === undefined
      ? {}
      : { visual_summary_model: record.visual_summary_model }),
    ...(record.asr_base_url === undefined ? {} : { asr_base_url: record.asr_base_url }),
    ...(record.asr_model === undefined ? {} : { asr_model: record.asr_model })
  })
  return Object.freeze({
    ...publicInput,
    ...(optionalSecret(record.model_api_key, 'model_api_key') === undefined
      ? {}
      : { model_api_key: record.model_api_key as string }),
    ...(optionalSecret(record.asr_api_key, 'asr_api_key') === undefined
      ? {}
      : { asr_api_key: record.asr_api_key as string }),
    provider_profile_id: publicInput.provider_profile_id ?? 'default',
    viewer_model: publicInput.viewer_model ?? publicInput.model_name,
    memory_model: publicInput.memory_model ?? publicInput.model_name,
    visual_summary_model: publicInput.visual_summary_model ?? publicInput.model_name,
    asr_base_url: publicInput.asr_base_url ?? DEFAULT_ASR_BASE_URL,
    asr_model: publicInput.asr_model ?? DEFAULT_ASR_MODEL
  })
}

function emptyProviderConfigurationStatus(): ProviderConfigurationStatus {
  return providerConfigurationStatusSchema.parse({
    configured: false,
    provider_profile_id: null,
    model_base_url: null,
    model_name: null,
    viewer_model: null,
    memory_model: null,
    visual_summary_model: null,
    asr_base_url: null,
    asr_model: null
  })
}

function publicStatus(input: ProviderConfigurationInput): ProviderConfigurationStatus {
  return Object.freeze(providerConfigurationStatusSchema.parse({
    configured: true,
    provider_profile_id: input.provider_profile_id ?? 'default',
    model_base_url: input.model_base_url,
    model_name: input.model_name,
    viewer_model: input.viewer_model ?? input.model_name,
    memory_model: input.memory_model ?? input.model_name,
    visual_summary_model: input.visual_summary_model ?? input.model_name,
    asr_base_url: input.asr_base_url ?? DEFAULT_ASR_BASE_URL,
    asr_model: input.asr_model ?? DEFAULT_ASR_MODEL
  }))
}

function configurationFingerprint(input: ProviderConfigurationInput): string {
  return canonicalSha256(input)
}

function optionalSecret(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.length === 0 || value.length > 8_192) {
    throw new ProviderConfigurationError('invalid_provider_configuration')
  }
  return value
}
