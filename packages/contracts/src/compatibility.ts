import {
  ADVX_HTTP_PROTOCOL_VERSION,
  ADVX_REALTIME_PROTOCOL_VERSION,
  ADVX_SUPPORTED_REALTIME_PROTOCOL_VERSIONS,
  type HttpProtocolVersion,
  type RealtimeProtocolVersion
} from './versions'
import {
  ADVX_BINARY_READABLE_VERSIONS,
  type AdvxBinaryVersion
} from './binary/codec'

export const MAX_BACKEND_START_ID_BYTES = 128 as const
export const MAX_PROTOCOL_SESSION_ID_BYTES = 128 as const

declare const backendStartIdBrand: unique symbol
export type BackendStartId = string & { readonly [backendStartIdBrand]: true }

export type ProtocolTransport = 'http' | 'realtime' | 'binary' | 'connection'
export type ProtocolCompatibilityStage =
  | 'request'
  | 'handshake'
  | 'post-handshake'
  | 'binary-ingest'
  | 'connection-identity'

export type ProtocolCompatibilityFailureCode =
  | 'missing-protocol-version'
  | 'invalid-protocol-version'
  | 'invalid-supported-versions'
  | 'unsupported-protocol-version'
  | 'post-handshake-version-mismatch'
  | 'unsupported-binary-version'
  | 'binary-version-mismatch'
  | 'invalid-backend-start-id'
  | 'invalid-session-id'
  | 'invalid-audience-epoch'
  | 'stale-backend-start'
  | 'stale-startup-token'
  | 'stale-session'
  | 'stale-audience-epoch'

export interface ProtocolCompatibilityFailure {
  readonly ok: false
  readonly code: ProtocolCompatibilityFailureCode
  readonly transport: ProtocolTransport
  readonly stage: ProtocolCompatibilityStage
  readonly retryable: boolean
  readonly rehandshakeRequired: boolean
  readonly supportedVersions?: readonly number[]
  readonly receivedVersion?: number
  readonly negotiatedVersion?: number
}

export interface ProtocolCompatibilitySuccess {
  readonly ok: true
  readonly transport: ProtocolTransport
  readonly stage: ProtocolCompatibilityStage
}

export type ProtocolCompatibilityResult<T extends ProtocolCompatibilitySuccess> =
  | T
  | ProtocolCompatibilityFailure

export interface ProtocolConnectionContext {
  readonly backendStartId: BackendStartId
  readonly realtimeVersion: RealtimeProtocolVersion
  readonly binaryVersions: readonly AdvxBinaryVersion[]
  readonly sessionId: string | null
  readonly audienceEpoch: number | null
}

export interface RealtimeNegotiationInput {
  readonly preferredVersion?: unknown
  readonly supportedVersions?: unknown
  readonly serverSupportedVersions?: readonly number[]
  readonly backendStartId: unknown
  readonly sessionId?: unknown
  readonly audienceEpoch?: unknown
}

export interface RealtimeNegotiationSuccess extends ProtocolCompatibilitySuccess {
  readonly ok: true
  readonly transport: 'realtime'
  readonly stage: 'handshake'
  readonly negotiatedVersion: RealtimeProtocolVersion
  readonly context: ProtocolConnectionContext
}

export interface ConnectionIdentityInput {
  readonly backendStartId: unknown
  readonly startupTokenMatches: boolean
  readonly sessionId?: unknown
  readonly audienceEpoch?: unknown
}

const binaryVersionsByRealtime = Object.freeze({
  3: Object.freeze([1, 2] as const),
  4: Object.freeze([3] as const)
}) satisfies Readonly<Record<RealtimeProtocolVersion, readonly AdvxBinaryVersion[]>>

export function validateHttpProtocolVersion(
  receivedVersion: unknown
): ProtocolCompatibilityResult<ProtocolCompatibilitySuccess & {
  readonly transport: 'http'
  readonly stage: 'request'
  readonly version: HttpProtocolVersion
}> {
  const invalid = validateReceivedVersion(receivedVersion, 'http', 'request', [ADVX_HTTP_PROTOCOL_VERSION])
  if (invalid) return invalid
  const version = receivedVersion as number
  if (version !== ADVX_HTTP_PROTOCOL_VERSION) {
    return failure('unsupported-protocol-version', 'http', 'request', false, false, {
      supportedVersions: [ADVX_HTTP_PROTOCOL_VERSION],
      receivedVersion: version
    })
  }
  return Object.freeze({
    ok: true,
    transport: 'http',
    stage: 'request',
    version: ADVX_HTTP_PROTOCOL_VERSION
  })
}

export function negotiateRealtimeProtocol(
  input: RealtimeNegotiationInput
): ProtocolCompatibilityResult<RealtimeNegotiationSuccess> {
  const startId = parseBackendStartId(input.backendStartId, 'handshake')
  if (!startId.ok) return startId
  const identity = parseSessionIdentity(input.sessionId, input.audienceEpoch, 'handshake')
  if (!identity.ok) return identity

  const offered = parseOfferedVersions(input.preferredVersion, input.supportedVersions)
  if (!offered.ok) return offered
  const serverVersions = input.serverSupportedVersions ?? ADVX_SUPPORTED_REALTIME_PROTOCOL_VERSIONS
  if (!isSupportedRealtimeSet(serverVersions)) {
    return failure('invalid-supported-versions', 'realtime', 'handshake', false, true, {
      supportedVersions: ADVX_SUPPORTED_REALTIME_PROTOCOL_VERSIONS
    })
  }

  const common = offered.versions.filter((version) => serverVersions.includes(version))
  if (common.length === 0) {
    return failure('unsupported-protocol-version', 'realtime', 'handshake', false, true, {
      supportedVersions: serverVersions,
      receivedVersion: offered.preferredVersion
    })
  }
  const negotiatedVersion = Math.max(...common) as RealtimeProtocolVersion
  const context = Object.freeze({
    backendStartId: startId.value,
    realtimeVersion: negotiatedVersion,
    binaryVersions: binaryVersionsByRealtime[negotiatedVersion],
    sessionId: identity.sessionId,
    audienceEpoch: identity.audienceEpoch
  })
  return Object.freeze({
    ok: true,
    transport: 'realtime',
    stage: 'handshake',
    negotiatedVersion,
    context
  })
}

export function guardPostHandshakeVersion(
  context: ProtocolConnectionContext,
  receivedVersion: unknown
): ProtocolCompatibilityResult<ProtocolCompatibilitySuccess & {
  readonly transport: 'realtime'
  readonly stage: 'post-handshake'
  readonly version: RealtimeProtocolVersion
}> {
  const invalid = validateReceivedVersion(
    receivedVersion,
    'realtime',
    'post-handshake',
    ADVX_SUPPORTED_REALTIME_PROTOCOL_VERSIONS,
    context.realtimeVersion
  )
  if (invalid) return invalid
  const version = receivedVersion as number
  if (version !== context.realtimeVersion) {
    return failure(
      'post-handshake-version-mismatch',
      'realtime',
      'post-handshake',
      false,
      true,
      {
        supportedVersions: [context.realtimeVersion],
        receivedVersion: version,
        negotiatedVersion: context.realtimeVersion
      }
    )
  }
  return Object.freeze({
    ok: true,
    transport: 'realtime',
    stage: 'post-handshake',
    version: context.realtimeVersion
  })
}

export function guardBinaryProtocolVersion(
  context: ProtocolConnectionContext,
  receivedVersion: unknown
): ProtocolCompatibilityResult<ProtocolCompatibilitySuccess & {
  readonly transport: 'binary'
  readonly stage: 'binary-ingest'
  readonly version: AdvxBinaryVersion
}> {
  const invalid = validateReceivedVersion(
    receivedVersion,
    'binary',
    'binary-ingest',
    context.binaryVersions,
    context.realtimeVersion,
    true,
    false
  )
  if (invalid) return invalid
  const version = receivedVersion as number
  if (!ADVX_BINARY_READABLE_VERSIONS.includes(version as AdvxBinaryVersion)) {
    return failure('unsupported-binary-version', 'binary', 'binary-ingest', true, false, {
      supportedVersions: ADVX_BINARY_READABLE_VERSIONS,
      receivedVersion: version,
      negotiatedVersion: context.realtimeVersion
    })
  }
  if (!context.binaryVersions.includes(version as AdvxBinaryVersion)) {
    return failure('binary-version-mismatch', 'binary', 'binary-ingest', true, false, {
      supportedVersions: context.binaryVersions,
      receivedVersion: version,
      negotiatedVersion: context.realtimeVersion
    })
  }
  return Object.freeze({
    ok: true,
    transport: 'binary',
    stage: 'binary-ingest',
    version: version as AdvxBinaryVersion
  })
}

export function guardConnectionIdentity(
  context: ProtocolConnectionContext,
  current: ConnectionIdentityInput
): ProtocolCompatibilityResult<ProtocolCompatibilitySuccess & {
  readonly transport: 'connection'
  readonly stage: 'connection-identity'
}> {
  const startId = parseBackendStartId(current.backendStartId, 'connection-identity')
  if (!startId.ok) return startId
  const identity = parseSessionIdentity(current.sessionId, current.audienceEpoch, 'connection-identity')
  if (!identity.ok) return identity
  if (startId.value !== context.backendStartId) {
    return failure('stale-backend-start', 'connection', 'connection-identity', true, true)
  }
  if (current.startupTokenMatches !== true) {
    return failure('stale-startup-token', 'connection', 'connection-identity', true, true)
  }
  if (identity.sessionId !== context.sessionId) {
    return failure('stale-session', 'connection', 'connection-identity', true, false)
  }
  if (identity.audienceEpoch !== context.audienceEpoch) {
    return failure('stale-audience-epoch', 'connection', 'connection-identity', true, false)
  }
  return Object.freeze({ ok: true, transport: 'connection', stage: 'connection-identity' })
}

function parseOfferedVersions(
  preferredVersion: unknown,
  supportedVersions: unknown
): { readonly ok: true; readonly preferredVersion: RealtimeProtocolVersion; readonly versions: readonly RealtimeProtocolVersion[] }
  | ProtocolCompatibilityFailure {
  const invalid = validateReceivedVersion(
    preferredVersion,
    'realtime',
    'handshake',
    ADVX_SUPPORTED_REALTIME_PROTOCOL_VERSIONS
  )
  if (invalid) return invalid
  const preferred = preferredVersion as number
  const versions = supportedVersions === undefined
    ? [preferred]
    : supportedVersions
  if (
    !Array.isArray(versions) ||
    versions.length < 1 ||
    versions.length > 8 ||
    versions.some((version) => !isPositiveVersion(version)) ||
    new Set(versions).size !== versions.length ||
    !versions.includes(preferred)
  ) {
    return failure('invalid-supported-versions', 'realtime', 'handshake', false, true, {
      supportedVersions: ADVX_SUPPORTED_REALTIME_PROTOCOL_VERSIONS,
      receivedVersion: preferred
    })
  }
  return Object.freeze({
    ok: true,
    preferredVersion: preferred as RealtimeProtocolVersion,
    versions: Object.freeze([...versions]) as readonly RealtimeProtocolVersion[]
  })
}

function parseBackendStartId(
  value: unknown,
  stage: 'handshake' | 'connection-identity'
): { readonly ok: true; readonly value: BackendStartId } | ProtocolCompatibilityFailure {
  if (!isBoundedOpaqueId(value, MAX_BACKEND_START_ID_BYTES)) {
    return failure('invalid-backend-start-id', 'connection', stage, false, true)
  }
  return Object.freeze({ ok: true, value: value as BackendStartId })
}

function parseSessionIdentity(
  sessionId: unknown,
  audienceEpoch: unknown,
  stage: 'handshake' | 'connection-identity'
): { readonly ok: true; readonly sessionId: string | null; readonly audienceEpoch: number | null }
  | ProtocolCompatibilityFailure {
  const normalizedSessionId = sessionId ?? null
  const normalizedEpoch = audienceEpoch ?? null
  if (normalizedSessionId !== null && !isBoundedOpaqueId(normalizedSessionId, MAX_PROTOCOL_SESSION_ID_BYTES)) {
    return failure('invalid-session-id', 'connection', stage, false, stage === 'handshake')
  }
  if (
    normalizedEpoch !== null &&
    (typeof normalizedEpoch !== 'number' || !Number.isSafeInteger(normalizedEpoch) || normalizedEpoch < 1)
  ) {
    return failure('invalid-audience-epoch', 'connection', stage, false, stage === 'handshake')
  }
  return Object.freeze({
    ok: true,
    sessionId: normalizedSessionId as string | null,
    audienceEpoch: normalizedEpoch as number | null
  })
}

function validateReceivedVersion(
  value: unknown,
  transport: ProtocolTransport,
  stage: ProtocolCompatibilityStage,
  supportedVersions: readonly number[],
  negotiatedVersion?: number,
  retryable = false,
  rehandshakeRequired = stage !== 'request'
): ProtocolCompatibilityFailure | null {
  if (value === undefined || value === null) {
    return failure('missing-protocol-version', transport, stage, retryable, rehandshakeRequired, {
      supportedVersions,
      negotiatedVersion
    })
  }
  if (!isPositiveVersion(value)) {
    return failure('invalid-protocol-version', transport, stage, retryable, rehandshakeRequired, {
      supportedVersions,
      negotiatedVersion
    })
  }
  return null
}

function isSupportedRealtimeSet(versions: readonly number[]): versions is readonly RealtimeProtocolVersion[] {
  return versions.length > 0 &&
    versions.length <= ADVX_SUPPORTED_REALTIME_PROTOCOL_VERSIONS.length &&
    versions.every((version) => ADVX_SUPPORTED_REALTIME_PROTOCOL_VERSIONS.includes(version as RealtimeProtocolVersion)) &&
    new Set(versions).size === versions.length
}

function isPositiveVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1
}

function isBoundedOpaqueId(value: unknown, maximumBytes: number): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.trim() === value &&
    new TextEncoder().encode(value).byteLength <= maximumBytes
}

function failure(
  code: ProtocolCompatibilityFailureCode,
  transport: ProtocolTransport,
  stage: ProtocolCompatibilityStage,
  retryable: boolean,
  rehandshakeRequired: boolean,
  versions: {
    readonly supportedVersions?: readonly number[]
    readonly receivedVersion?: number
    readonly negotiatedVersion?: number
  } = {}
): ProtocolCompatibilityFailure {
  return Object.freeze({
    ok: false,
    code,
    transport,
    stage,
    retryable,
    rehandshakeRequired,
    ...(versions.supportedVersions === undefined
      ? {}
      : { supportedVersions: Object.freeze([...versions.supportedVersions]) }),
    ...(versions.receivedVersion === undefined ? {} : { receivedVersion: versions.receivedVersion }),
    ...(versions.negotiatedVersion === undefined ? {} : { negotiatedVersion: versions.negotiatedVersion })
  })
}

export const ADVX_PROTOCOL_COMPATIBILITY = Object.freeze({
  http: Object.freeze({ current: ADVX_HTTP_PROTOCOL_VERSION }),
  realtime: Object.freeze({
    current: ADVX_REALTIME_PROTOCOL_VERSION,
    readable: Object.freeze([...ADVX_SUPPORTED_REALTIME_PROTOCOL_VERSIONS])
  }),
  binary: Object.freeze({
    current: 3 as const,
    readable: Object.freeze([...ADVX_BINARY_READABLE_VERSIONS]),
    byRealtime: binaryVersionsByRealtime
  })
})
