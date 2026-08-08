import {
  AdvxBinaryCodecError,
  AdvxBinaryPayloadTooLargeError,
  AdvxUnsupportedBinaryMediaTypeError,
  AdvxUnsupportedBinarySourceError,
  AdvxUnsupportedBinaryVersionError,
  ADVX_REALTIME_PROTOCOL_VERSION,
  decodeAdvxBinaryEnvelope,
  guardConnectionIdentity,
  guardPostHandshakeVersion,
  legacyRealtimeMessageSchema,
  negotiateRealtimeProtocol,
  normalizeLegacyRealtimeMessage,
  realtimeEnvelopeSchema,
  realtimeMessageRegistry,
  MAX_BINARY_ENVELOPE_BYTES,
  type LegacyRealtimeMessage,
  type ProtocolConnectionContext,
  type RealtimeEnvelope,
  type RealtimeProtocolVersion,
  type SessionSnapshot
} from '@advx/contracts'

import {
  createAudioIngestCommand,
  createFrameIngestCommand,
  type BinaryIngestPort,
  type IngestInputKind,
  type TextIngestPort,
  type VoiceActivityPort
} from '../ports/ingest'
import type {
  RealtimePublicationResult,
  RealtimePublisher,
  RealtimeSessionReader,
  RealtimeSocketPort,
  RealtimeWireFamily
} from '../ports/realtime'
import {
  createTraceContext,
  withTraceCorrelation,
  type TraceContext
} from '../ports/observability'
import { BinaryIngestDispatchError } from './binary-ingest-dispatcher'
import { TextIngestDispatchError } from './text-ingest-dispatcher'

export const REALTIME_CLOSE = Object.freeze({
  normal: 1000,
  goingAway: 1001,
  messageTooLarge: 1009,
  restart: 1012,
  overloaded: 1013,
  invalidMessage: 4400,
  authenticationFailed: 4401,
  versionMismatch: 4406,
  handshakeTimeout: 4408,
  internalError: 1011
})

export const DEFAULT_DESKTOP_CLIENT_ID = 'desktop-main'

type TimeoutHandle = ReturnType<typeof setTimeout>
type IntervalHandle = ReturnType<typeof setInterval>

type PendingInbound = {
  readonly value: unknown
  readonly resolve: () => void
}

type ConnectionPhase = 'awaiting-hello' | 'ready' | 'closed'

type OutboundEntry = Readonly<{
  serialized: string
  transcriptFinal: boolean | null
}>

type HubConnection = {
  readonly socket: RealtimeSocketPort
  readonly desktopClientId: string
  readonly connectionId: string
  pendingAuthorization: string | null
  authenticated: boolean
  phase: ConnectionPhase
  wireFamily: RealtimeWireFamily
  context: ProtocolConnectionContext | null
  traceContext: TraceContext | null
  lastSessionRevision: number
  lastSeenAt: number
  inboundProcessing: boolean
  inbound: PendingInbound[]
  outbound: OutboundEntry[]
  backpressured: boolean
  handshakeTimer: TimeoutHandle | null
  heartbeatTimer: IntervalHandle | null
}

export type RealtimeHubOptions = Readonly<{
  backendStartId: string
  authorize(authorization: string | null): boolean
  sessions: RealtimeSessionReader
  ingest?: BinaryIngestPort
  textIngest?: TextIngestPort
  voiceActivity?: VoiceActivityPort
  queueCapacity: number
  connectionCapacity?: number
  jsonPayloadMaximumBytes: number
  binaryPayloadMaximumBytes?: number
  handshakeTimeoutMs?: number
  heartbeatIntervalMs?: number
  connectionTimeoutMs?: number
  now?: () => number
  nextMessageId?: () => string
}>

export type RealtimeOpenInput = Readonly<{
  authorization: string | null
  desktopClientId?: string | null
}>

export type RealtimeHubSnapshot = Readonly<{
  backendStartId: string
  active: boolean
  connectionCount: number
  readyConnectionCount: number
  connectionIds: readonly string[]
}>

const protocolMessages = Object.freeze({
  authentication_failed: 'The local token is invalid.',
  handshake_timeout: 'client.hello was not received before the handshake timeout.',
  invalid_message: 'The realtime message does not match the protocol schema.',
  message_too_large: 'The realtime message exceeds the allowed size.',
  unexpected_message: 'The first realtime message must be client.hello.',
  version_mismatch: 'The requested protocol version is not supported.'
})

type IngestRejectionCode =
  | 'invalid_input'
  | 'session_not_active'
  | 'duplicate_input'
  | 'unknown_input'
  | 'out_of_order'
  | 'payload_too_large'
  | 'unsupported_format'
  | 'unsupported_binary_version'
  | 'unsupported_media_type'
  | 'malformed_binary_envelope'
  | 'pipeline_unavailable'

type IngestMetadata = Readonly<{
  sessionId?: string
  inputId?: string
  inputKind?: IngestInputKind
  traceContext?: TraceContext
}>

type IngestRejection = Readonly<{
  code: IngestRejectionCode
  message: string
}>

export class RealtimeHub implements RealtimePublisher {
  readonly #connections = new Map<string, HubConnection>()
  readonly #connectionsByIdentity = new Map<string, HubConnection>()
  readonly #handshakeTimeoutMs: number
  readonly #heartbeatIntervalMs: number
  readonly #connectionTimeoutMs: number
  readonly #connectionCapacity: number
  readonly #binaryPayloadMaximumBytes: number
  readonly #now: () => number
  readonly #nextMessageId: () => string
  #active = true

  constructor(private readonly options: RealtimeHubOptions) {
    requireBoundedIdentifier(options.backendStartId, 'backendStartId')
    requireInteger(options.queueCapacity, 1, 1_024, 'queueCapacity')
    this.#connectionCapacity = options.connectionCapacity ?? options.queueCapacity
    requireInteger(this.#connectionCapacity, 1, 1_024, 'connectionCapacity')
    requireInteger(
      options.jsonPayloadMaximumBytes,
      1_024,
      1_048_576,
      'jsonPayloadMaximumBytes'
    )
    this.#binaryPayloadMaximumBytes =
      options.binaryPayloadMaximumBytes ?? MAX_BINARY_ENVELOPE_BYTES
    requireInteger(
      this.#binaryPayloadMaximumBytes,
      1_024,
      MAX_BINARY_ENVELOPE_BYTES,
      'binaryPayloadMaximumBytes'
    )
    this.#handshakeTimeoutMs = positiveDuration(
      options.handshakeTimeoutMs ?? 5_000,
      'handshakeTimeoutMs'
    )
    this.#heartbeatIntervalMs = positiveDuration(
      options.heartbeatIntervalMs ?? 15_000,
      'heartbeatIntervalMs'
    )
    this.#connectionTimeoutMs = positiveDuration(
      options.connectionTimeoutMs ?? 30_000,
      'connectionTimeoutMs'
    )
    if (this.#connectionTimeoutMs <= this.#heartbeatIntervalMs) {
      throw new RangeError('connectionTimeoutMs must exceed heartbeatIntervalMs')
    }
    this.#now = options.now ?? Date.now
    this.#nextMessageId = options.nextMessageId ?? (() => crypto.randomUUID())
  }

  get backendStartId(): string {
    return this.options.backendStartId
  }

  open(socket: RealtimeSocketPort, input: RealtimeOpenInput): string {
    if (!this.#active) {
      try {
        socket.close(REALTIME_CLOSE.goingAway, 'backend shutting down')
      } catch {
        // The listener already owns final transport cleanup.
      }
      return `${this.options.backendStartId}:closed`
    }
    if (this.#connections.has(socket.transportId)) {
      try {
        socket.close(REALTIME_CLOSE.invalidMessage, 'duplicate transport')
      } catch {
        // The listener already owns final transport cleanup.
      }
      return `${this.options.backendStartId}:duplicate`
    }
    if (this.#connections.size >= this.#connectionCapacity) {
      try {
        socket.close(REALTIME_CLOSE.overloaded, 'connection capacity reached')
      } catch {
        // The listener already owns final transport cleanup.
      }
      return `${this.options.backendStartId}:capacity`
    }

    const desktopClientId = normalizedDesktopClientId(input.desktopClientId)
    const connectionId = `${this.options.backendStartId}:${desktopClientId}`
    const connection: HubConnection = {
      socket,
      desktopClientId,
      connectionId,
      pendingAuthorization: input.authorization,
      authenticated: false,
      phase: 'awaiting-hello',
      wireFamily: 'legacy-v3-v4',
      context: null,
      traceContext: null,
      lastSessionRevision: 0,
      lastSeenAt: this.#now(),
      inboundProcessing: false,
      inbound: [],
      outbound: [],
      backpressured: false,
      handshakeTimer: null,
      heartbeatTimer: null
    }
    this.#connections.set(socket.transportId, connection)
    connection.handshakeTimer = setTimeout(() => {
      if (connection.phase !== 'awaiting-hello') return
      this.#failProtocol(
        connection,
        'handshake_timeout',
        protocolMessages.handshake_timeout,
        REALTIME_CLOSE.handshakeTimeout
      )
    }, this.#handshakeTimeoutMs)
    return connectionId
  }

  receive(transportId: string, value: unknown): Promise<void> {
    const connection = this.#connections.get(transportId)
    if (connection === undefined || connection.phase === 'closed') {
      return Promise.resolve()
    }
    connection.lastSeenAt = this.#now()
    if (connection.inbound.length >= this.options.queueCapacity) {
      this.#close(connection, REALTIME_CLOSE.overloaded, 'inbound queue full')
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      connection.inbound.push({ value, resolve })
      if (!connection.inboundProcessing) void this.#drainInbound(connection)
    })
  }

  alive(transportId: string): void {
    const connection = this.#connections.get(transportId)
    if (connection !== undefined && connection.phase !== 'closed') {
      connection.lastSeenAt = this.#now()
    }
  }

  drain(transportId: string): void {
    const connection = this.#connections.get(transportId)
    if (connection === undefined || connection.phase === 'closed') return
    connection.backpressured = false
    this.#flushOutbound(connection)
  }

  disconnected(transportId: string): void {
    const connection = this.#connections.get(transportId)
    if (connection !== undefined) this.#cleanup(connection)
  }

  async publish(envelope: RealtimeEnvelope): Promise<RealtimePublicationResult> {
    const canonical = realtimeEnvelopeSchema.parse(envelope)
    const registration = realtimeMessageRegistry[canonical.message_type]
    if (registration.direction !== 'backend-to-client') {
      throw new TypeError('Only backend-to-client realtime envelopes can be published')
    }

    let acceptedConnections = 0
    let rejectedConnections = 0
    for (const connection of this.#connections.values()) {
      if (connection.phase !== 'ready' || connection.context === null) continue
      const adapted = realtimeEnvelopeSchema.parse({
        ...canonical,
        protocol_version: connection.context.realtimeVersion
      })
      if (this.#enqueueEnvelope(connection, adapted)) acceptedConnections += 1
      else rejectedConnections += 1
    }
    return { acceptedConnections, rejectedConnections }
  }

  async shutdown(
    reason: 'requested' | 'restart' | 'fatal_error' = 'requested',
    deadlineAtMs?: number
  ): Promise<void> {
    if (!this.#active) return
    this.#active = false
    const connections = [...this.#connections.values()]
    for (const connection of connections) {
      if (
        connection.phase === 'ready' &&
        connection.context !== null &&
        connection.wireFamily === 'canonical-envelope'
      ) {
        const envelope = this.#serverEnvelope(
          connection.context.realtimeVersion,
          'backend.shutdown',
          {},
          {
            reason,
            ...(deadlineAtMs === undefined ? {} : { deadline_at_ms: deadlineAtMs })
          }
        )
        this.#sendImmediate(connection, envelope)
      }
      this.#close(
        connection,
        reason === 'restart' ? REALTIME_CLOSE.restart : REALTIME_CLOSE.normal,
        reason === 'restart' ? 'backend restarting' : 'backend shutdown'
      )
    }
    await Promise.resolve()
  }

  snapshot(): RealtimeHubSnapshot {
    const connections = [...this.#connections.values()]
    return Object.freeze({
      backendStartId: this.options.backendStartId,
      active: this.#active,
      connectionCount: connections.length,
      readyConnectionCount: connections.filter(
        (connection) => connection.phase === 'ready'
      ).length,
      connectionIds: Object.freeze(connections.map((connection) => connection.connectionId))
    })
  }

  async #drainInbound(connection: HubConnection): Promise<void> {
    connection.inboundProcessing = true
    try {
      while (connection.phase !== 'closed') {
        const next = connection.inbound.shift()
        if (next === undefined) break
        try {
          await this.#handleIncoming(connection, next.value)
        } finally {
          next.resolve()
        }
      }
    } finally {
      connection.inboundProcessing = false
      if (connection.phase === 'closed') {
        for (const pending of connection.inbound.splice(0)) pending.resolve()
      }
    }
  }

  async #handleIncoming(connection: HubConnection, value: unknown): Promise<void> {
    if (isBinaryFrame(value)) {
      if (connection.phase !== 'ready') {
        this.#failProtocol(
          connection,
          'invalid_message',
          protocolMessages.invalid_message,
          REALTIME_CLOSE.invalidMessage
        )
        return
      }
      await this.#handleBinaryIngest(connection, binaryBytes(value))
      return
    }

    let decoded: unknown
    let encodedBytes: number
    try {
      if (typeof value === 'string') {
        encodedBytes = new TextEncoder().encode(value).byteLength
        decoded = JSON.parse(value)
      } else {
        const serialized = JSON.stringify(value)
        encodedBytes = new TextEncoder().encode(serialized).byteLength
        decoded = value
      }
    } catch {
      this.#failProtocol(
        connection,
        'invalid_message',
        protocolMessages.invalid_message,
        REALTIME_CLOSE.invalidMessage
      )
      return
    }
    if (encodedBytes > this.options.jsonPayloadMaximumBytes) {
      this.#failProtocol(
        connection,
        'message_too_large',
        protocolMessages.message_too_large,
        REALTIME_CLOSE.messageTooLarge
      )
      return
    }

    const wireHint = isRecord(decoded) && 'message_type' in decoded
      ? 'canonical-envelope'
      : 'legacy-v3-v4'
    if (connection.phase === 'awaiting-hello') {
      await this.#handleHello(connection, decoded, wireHint)
      return
    }
    await this.#handleReadyMessage(connection, decoded, wireHint)
  }

  async #handleHello(
    connection: HubConnection,
    decoded: unknown,
    wireFamily: RealtimeWireFamily
  ): Promise<void> {
    connection.wireFamily = wireFamily
    if (isUnsupportedHello(decoded, wireFamily, this.options.backendStartId)) {
      this.#failProtocol(
        connection,
        'version_mismatch',
        protocolMessages.version_mismatch,
        REALTIME_CLOSE.versionMismatch,
        ADVX_REALTIME_PROTOCOL_VERSION
      )
      return
    }
    let envelope: RealtimeEnvelope
    let legacy: LegacyRealtimeMessage | null = null
    try {
      if (wireFamily === 'canonical-envelope') {
        envelope = realtimeMessageRegistry['client.hello'].schema.parse(decoded) as RealtimeEnvelope
      } else {
        legacy = legacyRealtimeMessageSchema.parse(decoded)
        envelope = normalizeLegacyRealtimeMessage(legacy, {
          message_id: this.#nextMessageId(),
          created_at_ms: this.#now()
        })
      }
    } catch {
      this.#failProtocol(
        connection,
        'invalid_message',
        protocolMessages.invalid_message,
        REALTIME_CLOSE.invalidMessage
      )
      return
    }
    if (envelope.message_type !== 'client.hello') {
      this.#failProtocol(
        connection,
        'unexpected_message',
        protocolMessages.unexpected_message,
        REALTIME_CLOSE.invalidMessage
      )
      return
    }

    const legacyToken = legacy?.type === 'client.hello' ? legacy.token : null
    const authorization = legacyToken === null
      ? connection.pendingAuthorization
      : `Bearer ${legacyToken}`
    connection.pendingAuthorization = null
    if (!this.options.authorize(authorization)) {
      this.#failProtocol(
        connection,
        'authentication_failed',
        protocolMessages.authentication_failed,
        REALTIME_CLOSE.authenticationFailed
      )
      return
    }

    let session: SessionSnapshot
    try {
      session = await this.options.sessions.currentSession()
    } catch {
      this.#failProtocol(
        connection,
        'unexpected_message',
        'Realtime session state is unavailable.',
        REALTIME_CLOSE.internalError
      )
      return
    }
    if (connection.phase !== 'awaiting-hello') return
    const payload = envelope.payload as { readonly supported_protocol_versions?: readonly number[] }
    const negotiated = negotiateRealtimeProtocol({
      preferredVersion: envelope.protocol_version,
      supportedVersions: payload.supported_protocol_versions,
      backendStartId: this.options.backendStartId,
      sessionId: session.session_id,
      audienceEpoch: undefined
    })
    if (!negotiated.ok) {
      this.#failProtocol(
        connection,
        'version_mismatch',
        protocolMessages.version_mismatch,
        REALTIME_CLOSE.versionMismatch,
        ADVX_REALTIME_PROTOCOL_VERSION
      )
      return
    }

    const identity = guardConnectionIdentity(negotiated.context, {
      backendStartId: this.options.backendStartId,
      startupTokenMatches: true,
      sessionId: session.session_id,
      audienceEpoch: null
    })
    if (!identity.ok) {
      this.#failProtocol(
        connection,
        'authentication_failed',
        protocolMessages.authentication_failed,
        REALTIME_CLOSE.authenticationFailed
      )
      return
    }

    const previous = this.#connectionsByIdentity.get(connection.connectionId)
    if (previous !== undefined && previous !== connection) {
      this.#close(previous, REALTIME_CLOSE.normal, 'connection replaced')
    }
    this.#connectionsByIdentity.set(connection.connectionId, connection)
    connection.context = negotiated.context
    const helloTrace = createTraceContext({
      traceId: envelope.trace_id,
      correlation: {
        requestId: envelope.message_id,
        backendStartId: this.options.backendStartId,
        ...(envelope.session_id === undefined ? {} : { sessionId: envelope.session_id }),
        ...(envelope.audience_epoch === undefined ? {} : { epoch: envelope.audience_epoch })
      }
    })
    connection.traceContext = helloTrace
    connection.authenticated = true
    connection.lastSessionRevision = session.revision
    connection.phase = 'ready'
    clearTimer(connection.handshakeTimer)
    connection.handshakeTimer = null
    connection.lastSeenAt = this.#now()
    connection.heartbeatTimer = setInterval(
      () => this.#heartbeat(connection),
      this.#heartbeatIntervalMs
    )

    this.#enqueueEnvelope(
      connection,
      this.#serverEnvelope(
        negotiated.negotiatedVersion,
        'backend.ready',
        session.session_id === null ? {} : { session_id: session.session_id },
        { session },
        helloTrace
      )
    )
  }

  async #handleReadyMessage(
    connection: HubConnection,
    decoded: unknown,
    wireFamily: RealtimeWireFamily
  ): Promise<void> {
    if (connection.context === null || wireFamily !== connection.wireFamily) {
      this.#failProtocol(
        connection,
        'invalid_message',
        protocolMessages.invalid_message,
        REALTIME_CLOSE.invalidMessage
      )
      return
    }
    if (
      isRecord(decoded) &&
      Number.isSafeInteger(decoded.protocol_version) &&
      decoded.protocol_version !== connection.context.realtimeVersion
    ) {
      this.#failProtocol(
        connection,
        'version_mismatch',
        protocolMessages.version_mismatch,
        REALTIME_CLOSE.versionMismatch,
        connection.context.realtimeVersion
      )
      return
    }

    let envelope: RealtimeEnvelope
    try {
      envelope = wireFamily === 'canonical-envelope'
        ? realtimeEnvelopeSchema.parse(decoded)
        : normalizeLegacyRealtimeMessage(decoded, {
            message_id: this.#nextMessageId(),
            created_at_ms: this.#now(),
            session_id: connection.context.sessionId ?? undefined,
            audience_epoch: connection.context.audienceEpoch ?? undefined
          })
    } catch {
      this.#failProtocol(
        connection,
        'invalid_message',
        protocolMessages.invalid_message,
        REALTIME_CLOSE.invalidMessage
      )
      return
    }

    const version = guardPostHandshakeVersion(connection.context, envelope.protocol_version)
    if (!version.ok) {
      this.#failProtocol(
        connection,
        'version_mismatch',
        protocolMessages.version_mismatch,
        REALTIME_CLOSE.versionMismatch,
        connection.context.realtimeVersion
      )
      return
    }
    const identity = guardConnectionIdentity(
      { ...connection.context, sessionId: null, audienceEpoch: null },
      {
        backendStartId: this.options.backendStartId,
        startupTokenMatches: connection.authenticated,
        sessionId: null,
        audienceEpoch: null
      }
    )
    if (!identity.ok) {
      this.#close(connection, REALTIME_CLOSE.restart, 'stale backend connection')
      return
    }

    const traceContext = withTraceCorrelation(
      createTraceContext({ traceId: envelope.trace_id }),
      {
        requestId: envelope.message_id,
        backendStartId: this.options.backendStartId,
        ...(envelope.session_id === undefined
          ? {}
          : { sessionId: envelope.session_id }),
        ...(envelope.audience_epoch === undefined
          ? {}
          : { epoch: envelope.audience_epoch })
      }
    )
    connection.traceContext = traceContext

    const registration = realtimeMessageRegistry[envelope.message_type]
    if (registration.direction !== 'client-to-backend') {
      this.#failProtocol(
        connection,
        'unexpected_message',
        'Only client messages are accepted on this connection.',
        REALTIME_CLOSE.invalidMessage
      )
      return
    }
    if (envelope.message_type === 'client.hello') {
      this.#failProtocol(
        connection,
        'unexpected_message',
        'client.hello is only valid as the first message.',
        REALTIME_CLOSE.invalidMessage
      )
      return
    }
    if (envelope.message_type === 'client.ping') {
      const payload = envelope.payload as { readonly request_id: string }
      this.#enqueueEnvelope(
        connection,
        this.#serverEnvelope(
          connection.context.realtimeVersion,
          'backend.pong',
          {},
          { request_id: payload.request_id },
          traceContext
        )
      )
      return
    }
    if (envelope.session_id !== undefined) {
      let current: SessionSnapshot
      try {
        current = await this.options.sessions.currentSession()
      } catch {
        this.#failProtocol(
          connection,
          'unexpected_message',
          'Realtime session state is unavailable.',
          REALTIME_CLOSE.internalError
        )
        return
      }
      if (connection.phase !== 'ready') return
      const scopedIdentity = guardConnectionIdentity(
        {
          ...connection.context,
          sessionId: envelope.session_id,
          audienceEpoch: envelope.audience_epoch ?? null
        },
        {
          backendStartId: this.options.backendStartId,
          startupTokenMatches: connection.authenticated,
          sessionId: current.session_id,
          audienceEpoch: envelope.audience_epoch ?? null
        }
      )
      if (!scopedIdentity.ok) {
        this.#sendIngestRejected(
          connection,
          'session_not_active',
          'The realtime message targets a stale or inactive Session.',
          ingestMetadata(envelope, traceContext)
        )
        return
      }
    }

    if (envelope.message_type === 'client.voice.activity') {
      if (this.options.voiceActivity === undefined || envelope.session_id === undefined) return
      const payload = envelope.payload as {
        readonly occurred_at_ms: number
        readonly source: 'microphone' | 'system_audio'
      }
      try {
        await this.options.voiceActivity.notifyVoiceActivity({
          sessionId: envelope.session_id,
          occurredAtMs: payload.occurred_at_ms,
          source: payload.source,
          traceContext
        })
      } catch {
        // Voice activity is advisory and must not disrupt the realtime stream.
      }
      return
    }

    if (envelope.message_type === 'client.text.submit') {
      const metadata = ingestMetadata(envelope, traceContext)
      if (this.options.textIngest === undefined || envelope.session_id === undefined) {
        this.#sendIngestUnavailable(connection, metadata)
        return
      }
      const payload = envelope.payload as {
        readonly input_id: string
        readonly text: string
        readonly target_viewer_id?: string | null
        readonly target_persona_id?: string | null
      }
      try {
        const receipt = await this.options.textIngest.submitText({
          sessionId: envelope.session_id,
          inputId: payload.input_id,
          createdAtMs: envelope.created_at_ms,
          text: payload.text,
          ...(payload.target_viewer_id == null
            ? {}
            : { targetViewerId: payload.target_viewer_id }),
          ...(payload.target_persona_id == null
            ? {}
            : { targetPersonaId: payload.target_persona_id }),
          connectionId: connection.connectionId,
          traceContext
        })
        if (connection.phase === 'ready') this.#sendIngestAck(connection, receipt, traceContext)
      } catch (error) {
        if (connection.phase !== 'ready') return
        const rejection = textDispatchRejection(error)
        this.#sendIngestRejected(connection, rejection.code, rejection.message, metadata)
      }
      return
    }
    this.#sendIngestUnavailable(connection, ingestMetadata(envelope, traceContext))
  }

  async #handleBinaryIngest(
    connection: HubConnection,
    bytes: Uint8Array
  ): Promise<void> {
    if (connection.context === null) return
    const traceContext = connection.traceContext ?? createTraceContext({
      correlation: { backendStartId: this.options.backendStartId }
    })
    if (bytes.byteLength > this.#binaryPayloadMaximumBytes) {
      this.#sendIngestRejected(
        connection,
        'payload_too_large',
        'The binary ingest payload exceeds the allowed size.',
        { traceContext }
      )
      return
    }

    let envelope
    try {
      envelope = decodeAdvxBinaryEnvelope(bytes)
    } catch (error) {
      const rejection = binaryDecodeRejection(error)
      this.#sendIngestRejected(connection, rejection.code, rejection.message, { traceContext })
      return
    }

    const metadata: IngestMetadata = {
      sessionId: envelope.header.sessionId,
      inputId: envelope.header.inputId,
      inputKind: envelope.header.mediaType === 'audio' ? 'audio' : 'frame',
      traceContext
    }
    const compatible = connection.context.realtimeVersion === 4
      ? envelope.header.version === 3
      : envelope.header.version === 1 || envelope.header.version === 2
    if (!compatible) {
      this.#sendIngestRejected(
        connection,
        'invalid_input',
        'The binary envelope version does not match the negotiated realtime protocol.',
        metadata
      )
      return
    }
    if (this.options.ingest === undefined) {
      this.#sendIngestUnavailable(connection, metadata)
      return
    }

    const common = {
      sessionId: envelope.header.sessionId,
      inputId: envelope.header.inputId,
      capturedAtMs: envelope.header.capturedAtMs,
      format: envelope.header.format,
      binaryVersion: envelope.header.version,
      connectionId: connection.connectionId,
      traceContext,
      body: envelope.body
    } as const
    const command = envelope.header.mediaType === 'audio'
      ? createAudioIngestCommand({
          ...common,
          kind: 'audio',
          source: envelope.header.source!,
          ...(envelope.header.turnId === undefined
            ? {}
            : { turnId: envelope.header.turnId }),
          systemAudioRequired: envelope.header.systemAudioRequired
        })
      : createFrameIngestCommand({ ...common, kind: 'frame' })
    try {
      const receipt = await this.options.ingest.dispatch(command)
      if (connection.phase !== 'ready') return
      this.#sendIngestAck(connection, receipt, traceContext)
    } catch (error) {
      if (connection.phase !== 'ready') return
      const rejection = binaryDispatchRejection(error)
      this.#sendIngestRejected(connection, rejection.code, rejection.message, metadata)
    }
  }

  #sendIngestUnavailable(
    connection: HubConnection,
    metadata?: IngestMetadata
  ): void {
    this.#sendIngestRejected(
      connection,
      'pipeline_unavailable',
      'The ingest pipeline could not accept the input.',
      metadata
    )
  }

  #sendIngestAck(
    connection: HubConnection,
    receipt: Readonly<{
      sessionId: string
      inputId: string
      inputKind: IngestInputKind
      stage: 'received' | 'committed'
      acceptedAtMs: number
    }>,
    traceContext?: TraceContext
  ): void {
    if (connection.context === null) return
    this.#enqueueEnvelope(
      connection,
      this.#serverEnvelope(
        connection.context.realtimeVersion,
        'ingest.ack',
        { session_id: receipt.sessionId },
        {
          input_id: receipt.inputId,
          input_kind: receipt.inputKind,
          stage: receipt.stage,
          accepted_at_ms: receipt.acceptedAtMs
        },
        traceContext
      )
    )
  }

  #sendIngestRejected(
    connection: HubConnection,
    code: IngestRejectionCode,
    message: string,
    metadata?: IngestMetadata
  ): void {
    if (connection.context === null) return
    this.#enqueueEnvelope(
      connection,
      this.#serverEnvelope(
        connection.context.realtimeVersion,
        'ingest.rejected',
        metadata?.sessionId === undefined ? {} : { session_id: metadata.sessionId },
        {
          code,
          message,
          ...(metadata?.inputId === undefined ? {} : { input_id: metadata.inputId }),
          ...(metadata?.inputKind === undefined ? {} : { input_kind: metadata.inputKind })
        },
        metadata?.traceContext
      )
    )
  }

  #heartbeat(connection: HubConnection): void {
    if (connection.phase !== 'ready') return
    let result: number
    try {
      result = connection.socket.ping(connection.connectionId)
    } catch {
      this.#close(connection, REALTIME_CLOSE.goingAway, 'connection unavailable')
      return
    }
    if (result === 0) {
      this.#close(connection, REALTIME_CLOSE.goingAway, 'connection unavailable')
      return
    }
    if (result < 0) connection.backpressured = true
    if (this.#now() - connection.lastSeenAt >= this.#connectionTimeoutMs) {
      this.#close(connection, REALTIME_CLOSE.goingAway, 'connection timeout')
    }
  }

  #failProtocol(
    connection: HubConnection,
    code:
      | 'authentication_failed'
      | 'handshake_timeout'
      | 'invalid_message'
      | 'message_too_large'
      | 'unexpected_message'
      | 'version_mismatch',
    message: string,
    closeCode: number,
    supportedVersion?: number
  ): void {
    const version = connection.context?.realtimeVersion ?? ADVX_REALTIME_PROTOCOL_VERSION
    const envelope = this.#serverEnvelope(version, 'protocol.error', {}, {
      code,
      message,
      ...(supportedVersion === undefined
        ? {}
        : { supported_version: supportedVersion })
    })
    this.#sendImmediate(connection, envelope)
    this.#close(connection, closeCode, code)
  }

  #serverEnvelope(
    protocolVersion: RealtimeProtocolVersion,
    messageType: string,
    scopes: Record<string, unknown>,
    payload: Record<string, unknown>,
    traceContext?: TraceContext
  ): RealtimeEnvelope {
    const registration = realtimeMessageRegistry[
      messageType as keyof typeof realtimeMessageRegistry
    ]
    if (registration === undefined || registration.direction !== 'backend-to-client') {
      throw new TypeError(`Unknown backend realtime message: ${messageType}`)
    }
    return registration.schema.parse({
      protocol_version: protocolVersion,
      message_type: messageType,
      message_id: this.#nextMessageId(),
      created_at_ms: this.#now(),
      ...scopes,
      ...(traceContext === undefined ? {} : { trace_id: traceContext.traceId }),
      payload
    }) as RealtimeEnvelope
  }

  #enqueueEnvelope(connection: HubConnection, envelope: RealtimeEnvelope): boolean {
    if (connection.phase === 'closed') return false
    if (envelope.message_type === 'session.status') {
      const session = (envelope.payload as { readonly session: SessionSnapshot }).session
      if (session.revision <= connection.lastSessionRevision) return true
      connection.lastSessionRevision = session.revision
    }
    const serialized = serializeRealtimeWire(envelope, connection.wireFamily)
    const entry: OutboundEntry = {
      serialized,
      transcriptFinal:
        envelope.message_type === 'asr.transcript'
          ? (envelope.payload as { readonly final: boolean }).final
          : null
    }
    if (new TextEncoder().encode(serialized).byteLength > this.options.jsonPayloadMaximumBytes) {
      this.#close(connection, REALTIME_CLOSE.messageTooLarge, 'outbound message too large')
      return false
    }
    if (connection.backpressured) {
      if (connection.outbound.length >= this.options.queueCapacity) {
        if (entry.transcriptFinal === false) return true
        if (entry.transcriptFinal === true) {
          const partialIndex = connection.outbound.findIndex(
            (queued) => queued.transcriptFinal === false
          )
          if (partialIndex >= 0) {
            connection.outbound.splice(partialIndex, 1, entry)
            return true
          }
        }
        this.#close(connection, REALTIME_CLOSE.overloaded, 'slow consumer')
        return false
      }
      connection.outbound.push(entry)
      return true
    }
    return this.#sendSerialized(connection, serialized)
  }

  #sendImmediate(connection: HubConnection, envelope: RealtimeEnvelope): void {
    if (connection.phase === 'closed') return
    const serialized = serializeRealtimeWire(envelope, connection.wireFamily)
    try {
      connection.socket.sendText(serialized)
    } catch {
      this.#cleanup(connection)
    }
  }

  #sendSerialized(connection: HubConnection, serialized: string): boolean {
    let status: number
    try {
      status = connection.socket.sendText(serialized)
    } catch {
      this.#cleanup(connection)
      return false
    }
    if (status === 0) {
      this.#close(connection, REALTIME_CLOSE.overloaded, 'slow consumer')
      return false
    }
    if (status < 0) connection.backpressured = true
    return true
  }

  #flushOutbound(connection: HubConnection): void {
    while (!connection.backpressured && connection.outbound.length > 0) {
      const next = connection.outbound.shift()
      if (next === undefined || !this.#sendSerialized(connection, next.serialized)) return
    }
  }

  #close(connection: HubConnection, code: number, reason: string): void {
    if (connection.phase === 'closed') return
    connection.phase = 'closed'
    try {
      connection.socket.close(code, reason)
    } finally {
      this.#cleanup(connection)
    }
  }

  #cleanup(connection: HubConnection): void {
    if (connection.phase !== 'closed') connection.phase = 'closed'
    clearTimer(connection.handshakeTimer)
    if (connection.heartbeatTimer !== null) clearInterval(connection.heartbeatTimer)
    connection.handshakeTimer = null
    connection.heartbeatTimer = null
    connection.pendingAuthorization = null
    connection.outbound.length = 0
    for (const pending of connection.inbound.splice(0)) pending.resolve()
    this.#connections.delete(connection.socket.transportId)
    if (this.#connectionsByIdentity.get(connection.connectionId) === connection) {
      this.#connectionsByIdentity.delete(connection.connectionId)
    }
    void this.options.ingest?.clearConnection?.(connection.connectionId)
    void this.options.textIngest?.clearConnection?.(connection.connectionId)
  }
}

export function serializeRealtimeWire(
  envelope: RealtimeEnvelope,
  wireFamily: RealtimeWireFamily
): string {
  const canonical = realtimeEnvelopeSchema.parse(envelope)
  if (wireFamily === 'canonical-envelope') return JSON.stringify(canonical)
  const payload = canonical.payload as Record<string, unknown>
  const base = {
    protocol_version: canonical.protocol_version,
    type: canonical.message_type
  }
  let legacy: Record<string, unknown>
  switch (canonical.message_type) {
    case 'backend.ready':
    case 'session.status':
      legacy = { ...base, session: payload.session }
      break
    case 'backend.pong':
      legacy = { ...base, request_id: payload.request_id }
      break
    case 'barrage.event':
      legacy = { ...base, barrage: payload.barrage }
      break
    case 'protocol.error':
      legacy = {
        ...base,
        code: payload.code,
        message: payload.message,
        ...(payload.supported_version === undefined
          ? {}
          : { supported_version: payload.supported_version })
      }
      break
    case 'ingest.ack':
      legacy = { ...base, session_id: canonical.session_id, ...payload }
      break
    case 'ingest.rejected':
      legacy = {
        ...base,
        ...(canonical.session_id === undefined
          ? {}
          : { session_id: canonical.session_id }),
        ...payload
      }
      break
    case 'asr.transcript':
      legacy = { ...base, ...payload }
      break
    case 'viewer.joined':
    case 'viewer.left':
    case 'viewer.rejoined':
    case 'viewer.muted':
    case 'viewer.unmuted':
    case 'viewer.kicked':
      legacy = {
        ...base,
        session_id: canonical.session_id,
        audience_epoch: canonical.audience_epoch,
        ...payload
      }
      break
    default:
      legacy = {
        ...base,
        ...(canonical.room_id === undefined ? {} : { room_id: canonical.room_id }),
        ...(canonical.session_id === undefined
          ? {}
          : { session_id: canonical.session_id }),
        ...(canonical.audience_epoch === undefined
          ? {}
          : { audience_epoch: canonical.audience_epoch }),
        ...payload
      }
  }
  return JSON.stringify(legacy)
}

function isBinaryFrame(value: unknown): value is ArrayBuffer | ArrayBufferView {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value)
}

function binaryBytes(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  return value instanceof ArrayBuffer
    ? new Uint8Array(value)
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
}

function ingestMetadata(
  envelope: RealtimeEnvelope,
  traceContext?: TraceContext
): IngestMetadata {
  const payload = envelope.payload as Record<string, unknown>
  return {
    ...(envelope.session_id === undefined ? {} : { sessionId: envelope.session_id }),
    ...(typeof payload.input_id === 'string' ? { inputId: payload.input_id } : {}),
    ...(envelope.message_type === 'client.text.submit'
      ? { inputKind: 'text' as const }
      : envelope.message_type === 'client.audio.commit'
      ? { inputKind: 'audio' as const }
      : {}),
    ...(traceContext === undefined ? {} : { traceContext })
  }
}

function binaryDecodeRejection(error: unknown): IngestRejection {
  if (error instanceof AdvxBinaryPayloadTooLargeError) {
    return {
      code: 'payload_too_large',
      message: 'The binary ingest payload exceeds the allowed size.'
    }
  }
  if (error instanceof AdvxUnsupportedBinaryVersionError) {
    return {
      code: 'unsupported_binary_version',
      message: 'The binary envelope version is not supported.'
    }
  }
  if (error instanceof AdvxUnsupportedBinaryMediaTypeError) {
    return {
      code: 'unsupported_media_type',
      message: 'The binary envelope media type is not supported.'
    }
  }
  if (error instanceof AdvxUnsupportedBinarySourceError) {
    return {
      code: 'invalid_input',
      message: 'The binary envelope source is not supported.'
    }
  }
  if (error instanceof AdvxBinaryCodecError) {
    return {
      code: 'malformed_binary_envelope',
      message: 'The binary ingest envelope is malformed.'
    }
  }
  return {
    code: 'malformed_binary_envelope',
    message: 'The binary ingest envelope is malformed.'
  }
}

function binaryDispatchRejection(error: unknown): IngestRejection {
  if (!(error instanceof BinaryIngestDispatchError)) {
    return {
      code: 'pipeline_unavailable',
      message: 'The ingest pipeline could not accept the input.'
    }
  }
  switch (error.code) {
    case 'session_not_active':
      return {
        code: 'session_not_active',
        message: 'The target Session is not active.'
      }
    case 'audio_source_stopped':
      return {
        code: 'unknown_input',
        message: 'The audio source is stopped.'
      }
    case 'capture_source_ended':
      return {
        code: 'unknown_input',
        message: 'The capture source has ended.'
      }
    case 'capacity_exceeded':
      return {
        code: 'pipeline_unavailable',
        message: 'The ingest pipeline is busy.'
      }
    case 'pipeline_unavailable':
      return {
        code: 'pipeline_unavailable',
        message: 'The ingest pipeline could not accept the input.'
      }
  }
}

function textDispatchRejection(error: unknown): IngestRejection {
  if (!(error instanceof TextIngestDispatchError)) {
    return {
      code: 'pipeline_unavailable',
      message: 'The ingest pipeline could not accept the input.'
    }
  }
  switch (error.code) {
    case 'session_not_active':
      return {
        code: 'session_not_active',
        message: 'The target Session is not active.'
      }
    case 'capacity_exceeded':
      return {
        code: 'pipeline_unavailable',
        message: 'The ingest pipeline is busy.'
      }
    case 'pipeline_unavailable':
      return {
        code: 'pipeline_unavailable',
        message: 'The ingest pipeline could not accept the input.'
      }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isUnsupportedHello(
  value: unknown,
  wireFamily: RealtimeWireFamily,
  backendStartId: string
): boolean {
  if (!isRecord(value)) return false
  const messageType = wireFamily === 'canonical-envelope'
    ? value.message_type
    : value.type
  if (messageType !== 'client.hello') return false
  const payload = wireFamily === 'canonical-envelope' && isRecord(value.payload)
    ? value.payload
    : value
  const result = negotiateRealtimeProtocol({
    preferredVersion: value.protocol_version,
    supportedVersions: payload.supported_protocol_versions,
    backendStartId,
    sessionId: null,
    audienceEpoch: null
  })
  return !result.ok && result.code === 'unsupported-protocol-version'
}

function idleSession(now: number): SessionSnapshot {
  return {
    session_id: null,
    state: 'idle',
    started_at_ms: null,
    updated_at_ms: now,
    revision: 0
  }
}

function normalizedDesktopClientId(value: string | null | undefined): string {
  if (value == null || value === '') return DEFAULT_DESKTOP_CLIENT_ID
  try {
    requireBoundedIdentifier(value, 'desktopClientId')
    return value
  } catch {
    return DEFAULT_DESKTOP_CLIENT_ID
  }
}

function requireBoundedIdentifier(value: string, name: string): void {
  if (
    value.length === 0 ||
    value.trim() !== value ||
    new TextEncoder().encode(value).byteLength > 128
  ) {
    throw new RangeError(`${name} must be a bounded opaque identifier`)
  }
}

function requireInteger(
  value: number,
  minimum: number,
  maximum: number,
  name: string
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}`)
  }
}

function positiveDuration(value: number, name: string): number {
  requireInteger(value, 1, 3_600_000, name)
  return value
}

function clearTimer(timer: TimeoutHandle | null): void {
  if (timer !== null) clearTimeout(timer)
}
