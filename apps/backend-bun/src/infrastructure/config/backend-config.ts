import { MAX_BINARY_ENVELOPE_BYTES } from '@advx/contracts/binary'

export const BACKEND_CONFIG_DEFAULTS = {
  mode: 'production',
  host: '127.0.0.1',
  port: 8765,
  dataDirectory: '.advx-data',
  startupTokenFileDescriptor: 0,
  queueCapacity: 64,
  viewerDeadlineMs: 30_000,
  providerDeadlineMs: 30_000,
  retryMaximum: 1,
  jsonPayloadMaximumBytes: 16_384,
  binaryPayloadMaximumBytes: MAX_BINARY_ENVELOPE_BYTES,
  logLevel: 'info',
  logJson: true,
  tracingEnabled: false,
  remoteTelemetry: false,
  documentationEnabled: false,
  debugToolsEnabled: false
} as const

export type BackendMode = 'development' | 'production'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export type ProviderProfile = {
  readonly id: string
  readonly baseUrl: string
  readonly model: string
  readonly credentialRef: string
}

export type BackendConfig = {
  readonly process: {
    readonly mode: BackendMode
    readonly host: '127.0.0.1' | '::1'
    readonly port: number
    readonly dataDirectory: string
  }
  readonly startupTokenChannel: {
    readonly kind: 'inherited-fd'
    readonly fileDescriptor: number
    readonly encoding: 'utf8'
    readonly oneTime: true
  }
  readonly limits: {
    readonly queueCapacity: number
    readonly viewerDeadlineMs: number
    readonly providerDeadlineMs: number
    readonly retryMaximum: number
    readonly jsonPayloadMaximumBytes: number
    readonly binaryPayloadMaximumBytes: number
  }
  readonly observability: {
    readonly logging: {
      readonly level: LogLevel
      readonly json: boolean
    }
    readonly tracing: {
      readonly enabled: boolean
      readonly remoteTelemetry: false
    }
  }
  readonly developmentTools: {
    readonly documentationEnabled: boolean
    readonly debugToolsEnabled: boolean
  }
  readonly providers: readonly ProviderProfile[]
}

export class BackendConfigError extends Error {
  readonly code: string
  readonly path: string

  constructor(code: string, path: string) {
    super(`Invalid backend configuration (${code}) at ${path}`)
    this.name = 'BackendConfigError'
    this.code = code
    this.path = path
  }

  toJSON() {
    return { name: this.name, code: this.code, path: this.path }
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `${this.name} ${JSON.stringify(this.toJSON())}`
  }
}

type Environment = Readonly<Record<string, string | undefined>>
type UnknownRecord = Record<string, unknown>

const environmentKeys = new Set([
  'ADVX_BACKEND_MODE',
  'ADVX_BACKEND_HOST',
  'ADVX_BACKEND_PORT',
  'ADVX_DATA_DIR',
  'ADVX_STARTUP_TOKEN_FD',
  'ADVX_QUEUE_CAPACITY',
  'ADVX_VIEWER_DEADLINE_MS',
  'ADVX_PROVIDER_DEADLINE_MS',
  'ADVX_RETRY_MAX',
  'ADVX_JSON_PAYLOAD_MAX_BYTES',
  'ADVX_BINARY_PAYLOAD_MAX_BYTES',
  'ADVX_LOG_LEVEL',
  'ADVX_LOG_JSON',
  'ADVX_TRACE_ENABLED',
  'ADVX_REMOTE_TELEMETRY',
  'ADVX_DOCS_ENABLED',
  'ADVX_DEBUG_TOOLS_ENABLED',
  'ADVX_PROVIDER_PROFILES_JSON'
])

const configEnvironmentPrefixes = [
  'ADVX_BACKEND_',
  'ADVX_STARTUP_',
  'ADVX_QUEUE_',
  'ADVX_VIEWER_',
  'ADVX_PROVIDER_',
  'ADVX_RETRY_',
  'ADVX_JSON_',
  'ADVX_BINARY_',
  'ADVX_LOG_',
  'ADVX_TRACE_',
  'ADVX_REMOTE_',
  'ADVX_DOCS_',
  'ADVX_DEBUG_'
]

const forbiddenEnvironmentKey = /(?:^ADVX_LOCAL_TOKEN$|_API_KEY$)/i
const forbiddenProviderField = /^(?:api_?key|token|secret|password)$/i
const credentialReference = /^[A-Za-z][A-Za-z0-9._-]{0,31}:[A-Za-z0-9][A-Za-z0-9._:/-]{0,223}$/

function configError(code: string, path: string): never {
  throw new BackendConfigError(code, path)
}

function record(value: unknown, path: string): UnknownRecord {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    configError('expected_object', path)
  }
  return value as UnknownRecord
}

function strictKeys(value: UnknownRecord, allowed: readonly string[], path: string) {
  const allowedKeys = new Set(allowed)
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) configError('unknown_field', `${path}.${key}`)
  }
}

function textValue(
  value: unknown,
  fallback: string,
  path: string,
  maximumLength = 2048
): string {
  if (value === undefined) return fallback
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > maximumLength ||
    value.includes('\0')
  ) {
    configError('invalid_string', path)
  }
  return value
}

function integerValue(
  value: unknown,
  fallback: number,
  path: string,
  minimum: number,
  maximum: number
): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    configError('out_of_range', path)
  }
  return value as number
}

function booleanValue(value: unknown, fallback: boolean, path: string): boolean {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') configError('invalid_boolean', path)
  return value
}

function enumValue<T extends string>(
  value: unknown,
  fallback: T,
  allowed: readonly T[],
  path: string
): T {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    configError('invalid_enum', path)
  }
  return value as T
}

function providerProfiles(value: unknown): readonly ProviderProfile[] {
  if (value === undefined) return Object.freeze([])
  if (!Array.isArray(value) || value.length > 32) {
    configError('invalid_provider_profiles', 'providers')
  }

  const ids = new Set<string>()
  return Object.freeze(
    value.map((item, index) => {
      const path = `providers[${index}]`
      const profile = record(item, path)
      for (const key of Object.keys(profile)) {
        if (forbiddenProviderField.test(key)) {
          configError('plaintext_credential_forbidden', `${path}.${key}`)
        }
      }
      strictKeys(profile, ['id', 'baseUrl', 'model', 'credentialRef'], path)

      const id = textValue(profile.id, '', `${path}.id`, 128)
      if (ids.has(id)) configError('duplicate_provider_profile', `${path}.id`)
      ids.add(id)

      const baseUrl = textValue(profile.baseUrl, '', `${path}.baseUrl`)
      let parsedUrl: URL
      try {
        parsedUrl = new URL(baseUrl)
      } catch {
        configError('invalid_provider_url', `${path}.baseUrl`)
      }
      if (
        !['http:', 'https:'].includes(parsedUrl.protocol) ||
        parsedUrl.username !== '' ||
        parsedUrl.password !== '' ||
        parsedUrl.search !== '' ||
        parsedUrl.hash !== ''
      ) {
        configError('invalid_provider_url', `${path}.baseUrl`)
      }

      const credentialRef = textValue(
        profile.credentialRef,
        '',
        `${path}.credentialRef`,
        256
      )
      if (!credentialReference.test(credentialRef)) {
        configError('invalid_credential_reference', `${path}.credentialRef`)
      }

      return Object.freeze({
        id,
        baseUrl: parsedUrl.toString(),
        model: textValue(profile.model, '', `${path}.model`, 256),
        credentialRef
      })
    })
  )
}

export function parseBackendConfig(input: unknown = {}): BackendConfig {
  const root = record(input, 'config')
  strictKeys(
    root,
    [
      'process',
      'startupTokenChannel',
      'limits',
      'observability',
      'developmentTools',
      'providers'
    ],
    'config'
  )

  const processInput = record(root.process, 'process')
  strictKeys(processInput, ['mode', 'host', 'port', 'dataDirectory'], 'process')
  const mode = enumValue<BackendMode>(
    processInput.mode,
    BACKEND_CONFIG_DEFAULTS.mode,
    ['development', 'production'],
    'process.mode'
  )
  const host = enumValue<'127.0.0.1' | '::1'>(
    processInput.host,
    BACKEND_CONFIG_DEFAULTS.host,
    ['127.0.0.1', '::1'],
    'process.host'
  )

  const tokenInput = record(root.startupTokenChannel, 'startupTokenChannel')
  strictKeys(tokenInput, ['kind', 'fileDescriptor'], 'startupTokenChannel')
  const tokenKind = enumValue(
    tokenInput.kind,
    'inherited-fd' as const,
    ['inherited-fd'] as const,
    'startupTokenChannel.kind'
  )

  const limitsInput = record(root.limits, 'limits')
  strictKeys(
    limitsInput,
    [
      'queueCapacity',
      'viewerDeadlineMs',
      'providerDeadlineMs',
      'retryMaximum',
      'jsonPayloadMaximumBytes',
      'binaryPayloadMaximumBytes'
    ],
    'limits'
  )

  const observabilityInput = record(root.observability, 'observability')
  strictKeys(observabilityInput, ['logging', 'tracing'], 'observability')
  const loggingInput = record(observabilityInput.logging, 'observability.logging')
  strictKeys(loggingInput, ['level', 'json'], 'observability.logging')
  const tracingInput = record(observabilityInput.tracing, 'observability.tracing')
  strictKeys(tracingInput, ['enabled', 'remoteTelemetry'], 'observability.tracing')
  const remoteTelemetry = booleanValue(
    tracingInput.remoteTelemetry,
    BACKEND_CONFIG_DEFAULTS.remoteTelemetry,
    'observability.tracing.remoteTelemetry'
  )
  if (remoteTelemetry) {
    configError('remote_telemetry_forbidden', 'observability.tracing.remoteTelemetry')
  }

  const toolsInput = record(root.developmentTools, 'developmentTools')
  strictKeys(
    toolsInput,
    ['documentationEnabled', 'debugToolsEnabled'],
    'developmentTools'
  )
  const documentationEnabled = booleanValue(
    toolsInput.documentationEnabled,
    BACKEND_CONFIG_DEFAULTS.documentationEnabled,
    'developmentTools.documentationEnabled'
  )
  const debugToolsEnabled = booleanValue(
    toolsInput.debugToolsEnabled,
    BACKEND_CONFIG_DEFAULTS.debugToolsEnabled,
    'developmentTools.debugToolsEnabled'
  )
  if (mode === 'production' && (documentationEnabled || debugToolsEnabled)) {
    configError('production_tool_exposure_forbidden', 'developmentTools')
  }

  return Object.freeze({
    process: Object.freeze({
      mode,
      host,
      port: integerValue(
        processInput.port,
        BACKEND_CONFIG_DEFAULTS.port,
        'process.port',
        1,
        65_535
      ),
      dataDirectory: textValue(
        processInput.dataDirectory,
        BACKEND_CONFIG_DEFAULTS.dataDirectory,
        'process.dataDirectory'
      )
    }),
    startupTokenChannel: Object.freeze({
      kind: tokenKind,
      fileDescriptor: integerValue(
        tokenInput.fileDescriptor,
        BACKEND_CONFIG_DEFAULTS.startupTokenFileDescriptor,
        'startupTokenChannel.fileDescriptor',
        0,
        255
      ),
      encoding: 'utf8' as const,
      oneTime: true as const
    }),
    limits: Object.freeze({
      queueCapacity: integerValue(
        limitsInput.queueCapacity,
        BACKEND_CONFIG_DEFAULTS.queueCapacity,
        'limits.queueCapacity',
        1,
        1024
      ),
      viewerDeadlineMs: integerValue(
        limitsInput.viewerDeadlineMs,
        BACKEND_CONFIG_DEFAULTS.viewerDeadlineMs,
        'limits.viewerDeadlineMs',
        1000,
        30_000
      ),
      providerDeadlineMs: integerValue(
        limitsInput.providerDeadlineMs,
        BACKEND_CONFIG_DEFAULTS.providerDeadlineMs,
        'limits.providerDeadlineMs',
        1000,
        30_000
      ),
      retryMaximum: integerValue(
        limitsInput.retryMaximum,
        BACKEND_CONFIG_DEFAULTS.retryMaximum,
        'limits.retryMaximum',
        0,
        1
      ),
      jsonPayloadMaximumBytes: integerValue(
        limitsInput.jsonPayloadMaximumBytes,
        BACKEND_CONFIG_DEFAULTS.jsonPayloadMaximumBytes,
        'limits.jsonPayloadMaximumBytes',
        1024,
        1_048_576
      ),
      binaryPayloadMaximumBytes: integerValue(
        limitsInput.binaryPayloadMaximumBytes,
        BACKEND_CONFIG_DEFAULTS.binaryPayloadMaximumBytes,
        'limits.binaryPayloadMaximumBytes',
        4096,
        MAX_BINARY_ENVELOPE_BYTES
      )
    }),
    observability: Object.freeze({
      logging: Object.freeze({
        level: enumValue<LogLevel>(
          loggingInput.level,
          BACKEND_CONFIG_DEFAULTS.logLevel,
          ['debug', 'info', 'warn', 'error'],
          'observability.logging.level'
        ),
        json: booleanValue(
          loggingInput.json,
          BACKEND_CONFIG_DEFAULTS.logJson,
          'observability.logging.json'
        )
      }),
      tracing: Object.freeze({
        enabled: booleanValue(
          tracingInput.enabled,
          BACKEND_CONFIG_DEFAULTS.tracingEnabled,
          'observability.tracing.enabled'
        ),
        remoteTelemetry: false as const
      })
    }),
    developmentTools: Object.freeze({ documentationEnabled, debugToolsEnabled }),
    providers: providerProfiles(root.providers)
  })
}

function environmentInteger(environment: Environment, key: string): number | undefined {
  const value = environment[key]
  if (value === undefined) return undefined
  if (!/^-?\d+$/.test(value)) configError('invalid_integer', `environment.${key}`)
  return Number(value)
}

function environmentBoolean(environment: Environment, key: string): boolean | undefined {
  const value = environment[key]
  if (value === undefined) return undefined
  if (value !== 'true' && value !== 'false') {
    configError('invalid_boolean', `environment.${key}`)
  }
  return value === 'true'
}

export function loadBackendConfigFromEnvironment(environment: Environment): BackendConfig {
  for (const key of Object.keys(environment)) {
    if (environment[key] === undefined) continue
    if (forbiddenEnvironmentKey.test(key)) {
      configError('plaintext_secret_environment_forbidden', `environment.${key}`)
    }
    if (
      !environmentKeys.has(key) &&
      (key === 'ADVX_DATA_DIR' ||
        configEnvironmentPrefixes.some((prefix) => key.startsWith(prefix)))
    ) {
      configError('unknown_environment_field', `environment.${key}`)
    }
  }

  let providers: unknown = undefined
  const providerJson = environment.ADVX_PROVIDER_PROFILES_JSON
  if (providerJson !== undefined) {
    try {
      providers = JSON.parse(providerJson)
    } catch {
      configError('invalid_json', 'environment.ADVX_PROVIDER_PROFILES_JSON')
    }
  }

  return parseBackendConfig({
    process: {
      mode: environment.ADVX_BACKEND_MODE,
      host: environment.ADVX_BACKEND_HOST,
      port: environmentInteger(environment, 'ADVX_BACKEND_PORT'),
      dataDirectory: environment.ADVX_DATA_DIR
    },
    startupTokenChannel: {
      fileDescriptor: environmentInteger(environment, 'ADVX_STARTUP_TOKEN_FD')
    },
    limits: {
      queueCapacity: environmentInteger(environment, 'ADVX_QUEUE_CAPACITY'),
      viewerDeadlineMs: environmentInteger(environment, 'ADVX_VIEWER_DEADLINE_MS'),
      providerDeadlineMs: environmentInteger(environment, 'ADVX_PROVIDER_DEADLINE_MS'),
      retryMaximum: environmentInteger(environment, 'ADVX_RETRY_MAX'),
      jsonPayloadMaximumBytes: environmentInteger(environment, 'ADVX_JSON_PAYLOAD_MAX_BYTES'),
      binaryPayloadMaximumBytes: environmentInteger(environment, 'ADVX_BINARY_PAYLOAD_MAX_BYTES')
    },
    observability: {
      logging: {
        level: environment.ADVX_LOG_LEVEL,
        json: environmentBoolean(environment, 'ADVX_LOG_JSON')
      },
      tracing: {
        enabled: environmentBoolean(environment, 'ADVX_TRACE_ENABLED'),
        remoteTelemetry: environmentBoolean(environment, 'ADVX_REMOTE_TELEMETRY')
      }
    },
    developmentTools: {
      documentationEnabled: environmentBoolean(environment, 'ADVX_DOCS_ENABLED'),
      debugToolsEnabled: environmentBoolean(environment, 'ADVX_DEBUG_TOOLS_ENABLED')
    },
    providers
  })
}
