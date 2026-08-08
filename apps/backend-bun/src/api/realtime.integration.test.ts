import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  realtimeEnvelopeSchema,
  realtimeMessageRegistry,
  type RealtimeEnvelope,
  type SessionSnapshot
} from '@advx/contracts'

import {
  REALTIME_CLOSE,
  RealtimeHub,
  TextIngestDispatcher,
  VoiceActivityDispatcher,
  type RealtimeSocketPort
} from '../application'
import { startProcessApp, type RunningProcessApp } from '../main'

const TOKEN_A = 'A'.repeat(43)
const TOKEN_B = 'B'.repeat(43)
const liveApps = new Set<RunningProcessApp>()
const liveClients = new Set<WebSocketProbe>()
const temporaryDirectories = new Set<string>()

afterEach(async () => {
  for (const client of liveClients) client.close()
  liveClients.clear()
  for (const app of liveApps) await app.stop()
  liveApps.clear()
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true })
  }
  temporaryDirectories.clear()
})

describe('BCK-008 authenticated realtime hub', () => {
  test('serves the current Python v3/v4 wire on the real Bun listener and publishes canonical events', async () => {
    const port = availablePort()
    const app = await startApp(port, TOKEN_A, 'backend-start-live-1')
    const client = await connect(port)
    client.send(legacyHello(TOKEN_A))

    expect(await client.nextMessage()).toEqual({
      protocol_version: 4,
      type: 'backend.ready',
      session: {
        session_id: null,
        state: 'idle',
        started_at_ms: null,
        updated_at_ms: expect.any(Number),
        revision: 0
      }
    })
    expect(app.realtime?.snapshot()).toMatchObject({
      backendStartId: 'backend-start-live-1',
      connectionCount: 1,
      readyConnectionCount: 1,
      connectionIds: ['backend-start-live-1:desktop-main']
    })

    client.send({
      protocol_version: 4,
      type: 'client.ping',
      request_id: 'ping-live-1'
    })
    expect(await client.nextMessage()).toEqual({
      protocol_version: 4,
      type: 'backend.pong',
      request_id: 'ping-live-1'
    })

    const publication = sessionStatusEnvelope('publication-1', 10, 1)
    expect(await app.realtime?.publish(publication)).toEqual({
      acceptedConnections: 1,
      rejectedConnections: 0
    })
    expect(await client.nextMessage()).toEqual({
      protocol_version: 4,
      type: 'session.status',
      session: idleSession(10, 1)
    })

    client.sendBinary(new Uint8Array([0x41, 0x44, 0x56, 0x58]))
    expect(await client.nextMessage()).toEqual({
      protocol_version: 4,
      type: 'ingest.rejected',
      code: 'malformed_binary_envelope',
      message: 'The binary ingest envelope is malformed.'
    })
    client.send({
      protocol_version: 4,
      type: 'client.ping',
      request_id: 'ping-after-binary'
    })
    expect(await client.nextMessage()).toMatchObject({
      type: 'backend.pong',
      request_id: 'ping-after-binary'
    })

    const close = client.nextClose()
    await app.stop('requested')
    liveApps.delete(app)
    expect(await close).toMatchObject({ code: REALTIME_CLOSE.normal })
    expect(canBind(port)).toBe(true)
  }, 10_000)

  test('orders safe handshake failures before canonical close codes', async () => {
    const port = availablePort()
    await startApp(port, TOKEN_A, 'backend-start-auth')

    const invalidToken = await connect(port)
    invalidToken.send(legacyHello(TOKEN_B))
    expect(await invalidToken.nextMessage()).toMatchObject({
      type: 'protocol.error',
      code: 'authentication_failed'
    })
    expect(await invalidToken.nextClose()).toMatchObject({
      code: REALTIME_CLOSE.authenticationFailed
    })

    const invalidFirst = await connect(port)
    invalidFirst.send({
      protocol_version: 4,
      type: 'client.ping',
      request_id: 'too-early'
    })
    expect(await invalidFirst.nextMessage()).toMatchObject({
      type: 'protocol.error',
      code: 'unexpected_message'
    })
    expect(await invalidFirst.nextClose()).toMatchObject({
      code: REALTIME_CLOSE.invalidMessage
    })

    const unsupported = await connect(port)
    unsupported.send({
      protocol_version: 99,
      type: 'client.hello',
      token: TOKEN_A,
      supported_protocol_versions: [99]
    })
    expect(await unsupported.nextMessage()).toMatchObject({
      type: 'protocol.error',
      code: 'version_mismatch',
      supported_version: 4
    })
    expect(await unsupported.nextClose()).toMatchObject({
      code: REALTIME_CLOSE.versionMismatch
    })

    const postHandshakeMismatch = await connect(port)
    postHandshakeMismatch.send(legacyHello(TOKEN_A))
    expect(await postHandshakeMismatch.nextMessage()).toMatchObject({
      type: 'backend.ready',
      protocol_version: 4
    })
    postHandshakeMismatch.send({
      protocol_version: 3,
      type: 'client.ping',
      request_id: 'wrong-version'
    })
    expect(await postHandshakeMismatch.nextMessage()).toMatchObject({
      type: 'protocol.error',
      code: 'version_mismatch',
      supported_version: 4
    })
    expect(await postHandshakeMismatch.nextClose()).toMatchObject({
      code: REALTIME_CLOSE.versionMismatch
    })

    const timedOut = await connect(port)
    expect(await timedOut.nextMessage()).toMatchObject({
      type: 'protocol.error',
      code: 'handshake_timeout'
    })
    expect(await timedOut.nextClose()).toMatchObject({
      code: REALTIME_CLOSE.handshakeTimeout
    })
  }, 10_000)

  test('rejects both handshake credential forms before reading Session state', async () => {
    const cases = [
      {
        name: 'legacy-token',
        authorization: null,
        message: legacyHello(TOKEN_B),
        expectedAuthorization: `Bearer ${TOKEN_B}`,
        canonical: false
      },
      {
        name: 'canonical-header',
        authorization: `Bearer ${TOKEN_B}`,
        message: canonicalHello('hello-invalid-header', Date.now()),
        expectedAuthorization: `Bearer ${TOKEN_B}`,
        canonical: true
      }
    ] as const

    for (const input of cases) {
      let sessionReads = 0
      const authorizations: Array<string | null> = []
      const hub = new RealtimeHub({
        backendStartId: `backend-start-${input.name}`,
        authorize: (authorization) => {
          authorizations.push(authorization)
          return authorization === `Bearer ${TOKEN_A}`
        },
        sessions: {
          currentSession: () => {
            sessionReads += 1
            throw new Error('private-session-reader-canary')
          }
        },
        queueCapacity: 2,
        jsonPayloadMaximumBytes: 16_384,
        handshakeTimeoutMs: 1_000,
        heartbeatIntervalMs: 1_000,
        connectionTimeoutMs: 2_000
      })
      const socket = new FakeSocket(`transport-${input.name}`)

      hub.open(socket, { authorization: input.authorization })
      await hub.receive(socket.transportId, input.message)

      const error = JSON.parse(socket.sent[0]!) as unknown
      if (input.canonical) {
        expect(realtimeEnvelopeSchema.parse(error)).toMatchObject({
          message_type: 'protocol.error',
          payload: { code: 'authentication_failed' }
        })
      } else {
        expect(error).toMatchObject({
          type: 'protocol.error',
          code: 'authentication_failed'
        })
      }
      expect(authorizations).toEqual([input.expectedAuthorization])
      expect(sessionReads).toBe(0)
      expect(JSON.stringify(error)).not.toContain('private-session-reader-canary')
      expect(socket.closes).toEqual([
        {
          code: REALTIME_CLOSE.authenticationFailed,
          reason: 'authentication_failed'
        }
      ])
      await hub.shutdown()
    }
  })

  test('closes for restart, rejects the stale token, and reconnects with a new backend identity', async () => {
    const port = availablePort()
    const first = await startApp(port, TOKEN_A, 'backend-start-reconnect-1')
    const firstClient = await connect(port)
    firstClient.send(legacyHello(TOKEN_A))
    expect(await firstClient.nextMessage()).toMatchObject({ type: 'backend.ready' })

    const firstClose = firstClient.nextClose()
    await first.stop('restart')
    liveApps.delete(first)
    expect(await firstClose).toMatchObject({ code: REALTIME_CLOSE.restart })
    expect(canBind(port)).toBe(true)

    const second = await startApp(port, TOKEN_B, 'backend-start-reconnect-2')
    const stale = await connect(port)
    stale.send(legacyHello(TOKEN_A))
    expect(await stale.nextMessage()).toMatchObject({
      type: 'protocol.error',
      code: 'authentication_failed'
    })
    expect(await stale.nextClose()).toMatchObject({
      code: REALTIME_CLOSE.authenticationFailed
    })

    const current = await connect(port)
    current.send(legacyHello(TOKEN_B))
    expect(await current.nextMessage()).toMatchObject({ type: 'backend.ready' })
    expect(second.realtime?.snapshot()).toMatchObject({
      backendStartId: 'backend-start-reconnect-2',
      connectionIds: ['backend-start-reconnect-2:desktop-main']
    })

    await second.stop()
    liveApps.delete(second)
    expect(canBind(port)).toBe(true)
  }, 10_000)

  test('validates canonical envelopes and deterministically closes duplicate and slow connections', async () => {
    let now = 1_000
    let messageId = 0
    let currentSession = runningSession('session-1', now, 1)
    const hub = new RealtimeHub({
      backendStartId: 'backend-start-unit',
      authorize: (authorization) => authorization === `Bearer ${TOKEN_A}`,
      sessions: { currentSession: () => currentSession },
      queueCapacity: 2,
      jsonPayloadMaximumBytes: 16_384,
      handshakeTimeoutMs: 1_000,
      heartbeatIntervalMs: 1_000,
      connectionTimeoutMs: 2_000,
      now: () => now,
      nextMessageId: () => `server-message-${++messageId}`
    })
    const first = new FakeSocket('transport-1')
    const second = new FakeSocket('transport-2')
    hub.open(first, {
      authorization: `Bearer ${TOKEN_A}`,
      desktopClientId: 'desktop-main'
    })
    await hub.receive('transport-1', canonicalHello('hello-1', now))
    expect(realtimeEnvelopeSchema.parse(JSON.parse(first.sent[0]!))).toMatchObject({
      message_type: 'backend.ready',
      protocol_version: 4
    })

    hub.open(second, {
      authorization: `Bearer ${TOKEN_A}`,
      desktopClientId: 'desktop-main'
    })
    await hub.receive('transport-2', canonicalHello('hello-2', now))
    expect(first.closes).toEqual([{ code: REALTIME_CLOSE.normal, reason: 'connection replaced' }])
    expect(hub.snapshot()).toMatchObject({
      connectionCount: 1,
      readyConnectionCount: 1,
      connectionIds: ['backend-start-unit:desktop-main']
    })

    currentSession = runningSession('session-2', ++now, 2)
    await hub.receive(
      second.transportId,
      canonicalTextSubmit('text-stale', now, 'session-1')
    )
    expect(realtimeEnvelopeSchema.parse(JSON.parse(second.sent.at(-1)!))).toMatchObject({
      message_type: 'ingest.rejected',
      session_id: 'session-1',
      payload: {
        code: 'session_not_active',
        input_id: 'text-stale',
        input_kind: 'text'
      }
    })
    expect(second.closes).toEqual([])

    second.sendStatus = -1
    expect(await hub.publish(sessionStatusEnvelope('slow-1', ++now, 3))).toMatchObject({
      acceptedConnections: 1
    })
    await hub.publish(sessionStatusEnvelope('slow-2', ++now, 4))
    await hub.publish(sessionStatusEnvelope('slow-3', ++now, 5))
    expect(await hub.publish(sessionStatusEnvelope('slow-4', ++now, 6))).toEqual({
      acceptedConnections: 0,
      rejectedConnections: 1
    })
    expect(second.closes).toEqual([{ code: REALTIME_CLOSE.overloaded, reason: 'slow consumer' }])
    expect(hub.snapshot().connectionCount).toBe(0)

    const shutdownClient = new FakeSocket('transport-shutdown')
    hub.open(shutdownClient, {
      authorization: `Bearer ${TOKEN_A}`,
      desktopClientId: 'desktop-main'
    })
    await hub.receive(
      shutdownClient.transportId,
      canonicalHello('hello-shutdown', ++now)
    )
    await hub.shutdown('restart', now + 1_000)
    expect(realtimeEnvelopeSchema.parse(JSON.parse(shutdownClient.sent.at(-1)!))).toMatchObject({
      message_type: 'backend.shutdown',
      payload: { reason: 'restart', deadline_at_ms: now + 1_000 }
    })
    expect(shutdownClient.closes).toEqual([
      { code: REALTIME_CLOSE.restart, reason: 'backend restarting' }
    ])
  })

  test('bounds inbound work and closes a heartbeat timeout without leaking timers', async () => {
    let releaseSession!: () => void
    const sessionGate = new Promise<void>((resolve) => {
      releaseSession = resolve
    })
    const inboundHub = new RealtimeHub({
      backendStartId: 'backend-start-inbound',
      authorize: (authorization) => authorization === `Bearer ${TOKEN_A}`,
      sessions: {
        currentSession: async () => {
          await sessionGate
          return idleSession(Date.now())
        }
      },
      queueCapacity: 1,
      connectionCapacity: 1,
      jsonPayloadMaximumBytes: 16_384,
      handshakeTimeoutMs: 1_000,
      heartbeatIntervalMs: 1_000,
      connectionTimeoutMs: 2_000
    })
    const inbound = new FakeSocket('transport-inbound')
    inboundHub.open(inbound, { authorization: `Bearer ${TOKEN_A}` })
    const capacity = new FakeSocket('transport-capacity')
    inboundHub.open(capacity, { authorization: null })
    expect(capacity.closes).toEqual([
      { code: REALTIME_CLOSE.overloaded, reason: 'connection capacity reached' }
    ])
    expect(inboundHub.snapshot().connectionCount).toBe(1)
    const hello = inboundHub.receive(
      inbound.transportId,
      canonicalHello('hello-inbound', Date.now())
    )
    const queued = inboundHub.receive(
      inbound.transportId,
      canonicalPing('ping-queued', Date.now())
    )
    await inboundHub.receive(
      inbound.transportId,
      canonicalPing('ping-overflow', Date.now())
    )
    expect(inbound.closes).toEqual([
      { code: REALTIME_CLOSE.overloaded, reason: 'inbound queue full' }
    ])
    releaseSession()
    await Promise.all([hello, queued])
    await inboundHub.shutdown()

    const failingHub = new RealtimeHub({
      backendStartId: 'backend-start-failing-session',
      authorize: (authorization) => authorization === `Bearer ${TOKEN_A}`,
      sessions: {
        currentSession: () => {
          throw new Error('private-session-reader-canary')
        }
      },
      queueCapacity: 1,
      jsonPayloadMaximumBytes: 16_384,
      handshakeTimeoutMs: 1_000,
      heartbeatIntervalMs: 1_000,
      connectionTimeoutMs: 2_000
    })
    const failing = new FakeSocket('transport-failing-session')
    failingHub.open(failing, { authorization: `Bearer ${TOKEN_A}` })
    await failingHub.receive(
      failing.transportId,
      canonicalHello('hello-failing-session', Date.now())
    )
    const failureMessage = JSON.parse(failing.sent[0]!) as unknown
    expect(realtimeEnvelopeSchema.parse(failureMessage)).toMatchObject({
      message_type: 'protocol.error',
      payload: {
        code: 'unexpected_message',
        message: 'Realtime session state is unavailable.'
      }
    })
    expect(JSON.stringify(failureMessage)).not.toContain('private-session-reader-canary')
    expect(failing.closes).toEqual([
      { code: REALTIME_CLOSE.internalError, reason: 'unexpected_message' }
    ])
    await failingHub.shutdown()

    const timeoutHub = new RealtimeHub({
      backendStartId: 'backend-start-timeout',
      authorize: (authorization) => authorization === `Bearer ${TOKEN_A}`,
      sessions: { currentSession: () => idleSession(Date.now()) },
      queueCapacity: 2,
      jsonPayloadMaximumBytes: 16_384,
      handshakeTimeoutMs: 100,
      heartbeatIntervalMs: 5,
      connectionTimeoutMs: 15
    })
    const timeout = new FakeSocket('transport-timeout')
    timeoutHub.open(timeout, { authorization: `Bearer ${TOKEN_A}` })
    await timeoutHub.receive(
      timeout.transportId,
      canonicalHello('hello-timeout', Date.now())
    )
    await Bun.sleep(40)
    expect(timeout.pings.length).toBeGreaterThan(0)
    expect(timeout.closes).toEqual([
      { code: REALTIME_CLOSE.goingAway, reason: 'connection timeout' }
    ])
    expect(timeoutHub.snapshot().connectionCount).toBe(0)
    await timeoutHub.shutdown()
  })

  test('never evicts a queued final transcript to admit a partial', async () => {
    const hub = new RealtimeHub({
      backendStartId: 'backend-start-transcript-priority',
      authorize: (authorization) => authorization === `Bearer ${TOKEN_A}`,
      sessions: { currentSession: () => runningSession('session-1', 1_000, 1) },
      queueCapacity: 1,
      jsonPayloadMaximumBytes: 16_384,
      handshakeTimeoutMs: 1_000,
      heartbeatIntervalMs: 1_000,
      connectionTimeoutMs: 2_000
    })
    const socket = new FakeSocket('transport-transcript-priority')
    hub.open(socket, { authorization: `Bearer ${TOKEN_A}` })
    await hub.receive(socket.transportId, canonicalHello('hello-transcript', 1_000))
    socket.sent.length = 0
    socket.sendStatus = -1

    await hub.publish(sessionStatusEnvelope('backpressure', 1_001, 2))
    await hub.publish(transcriptEnvelope('final', true, 1_002))
    await hub.publish(transcriptEnvelope('partial', false, 1_003))

    expect(socket.closes).toEqual([])
    socket.sendStatus = 1
    hub.drain(socket.transportId)
    const transcripts = socket.sent
      .map((serialized) => JSON.parse(serialized) as Record<string, unknown>)
      .filter((message) => message.message_type === 'asr.transcript')
    expect(transcripts).toHaveLength(1)
    expect(transcripts[0]).toMatchObject({
      payload: { text: 'final', final: true }
    })
    await hub.shutdown()
  })

  test('routes text and voice activity through the Bun ingest boundary with source identity', async () => {
    let now = 2_000
    const currentSession = runningSession('session-live', now, 1)
    const textCommands: Array<Record<string, unknown>> = []
    const voiceCommands: Array<Record<string, unknown>> = []
    const textIngest = new TextIngestDispatcher({
      sessions: { currentSession: () => currentSession },
      sink: { dispatch: (command) => { textCommands.push(command as Record<string, unknown>) } },
      capacity: 2,
      now: () => now
    })
    const voiceActivity = new VoiceActivityDispatcher({
      sessions: { currentSession: () => currentSession },
      sink: { notify: (command) => { voiceCommands.push(command as Record<string, unknown>) } }
    })
    const hub = new RealtimeHub({
      backendStartId: 'backend-start-ingest-routing',
      authorize: (authorization) => authorization === `Bearer ${TOKEN_A}`,
      sessions: { currentSession: () => currentSession },
      textIngest,
      voiceActivity,
      queueCapacity: 2,
      jsonPayloadMaximumBytes: 16_384,
      handshakeTimeoutMs: 1_000,
      heartbeatIntervalMs: 1_000,
      connectionTimeoutMs: 2_000,
      now: () => now,
      nextMessageId: () => 'server-message'
    })
    const socket = new FakeSocket('transport-ingest-routing')
    hub.open(socket, {
      authorization: `Bearer ${TOKEN_A}`,
      desktopClientId: 'desktop-main'
    })
    await hub.receive(socket.transportId, {
      ...canonicalHello('hello-ingest-routing', now),
      trace_id: 'trace-ingest-routing'
    })
    socket.sent.length = 0

    await hub.receive(socket.transportId, {
      protocol_version: 4,
      message_type: 'client.text.submit',
      message_id: 'text-routing-1',
      trace_id: 'trace-text-routing',
      session_id: 'session-live',
      created_at_ms: ++now,
      payload: {
        input_id: 'text-routing-1',
        text: 'hello bun',
        target_persona_id: 'persona-1'
      }
    })
    expect(realtimeEnvelopeSchema.parse(JSON.parse(socket.sent.at(-1)!))).toMatchObject({
      message_type: 'ingest.ack',
      trace_id: 'trace-text-routing',
      session_id: 'session-live',
      payload: {
        input_id: 'text-routing-1',
        input_kind: 'text',
        stage: 'received'
      }
    })
    expect(textCommands).toEqual([
      expect.objectContaining({
        sessionId: 'session-live',
        inputId: 'text-routing-1',
        text: 'hello bun',
        targetPersonaId: 'persona-1',
        connectionId: 'backend-start-ingest-routing:desktop-main',
        traceContext: expect.objectContaining({
          traceId: 'trace-text-routing',
          correlation: expect.objectContaining({
            requestId: 'text-routing-1',
            backendStartId: 'backend-start-ingest-routing'
          })
        })
      })
    ])

    await hub.receive(socket.transportId, {
      protocol_version: 4,
      message_type: 'client.voice.activity',
      message_id: 'voice-routing-1',
      trace_id: 'trace-routing-voice',
      session_id: 'session-live',
      created_at_ms: ++now,
      payload: { occurred_at_ms: now, source: 'system_audio' }
    })
    expect(voiceCommands).toEqual([
      expect.objectContaining({
        sessionId: 'session-live',
        occurredAtMs: now,
        source: 'system_audio',
        traceContext: expect.objectContaining({ traceId: 'trace-routing-voice' })
      })
    ])
    await hub.shutdown()
  })
})

class FakeSocket implements RealtimeSocketPort {
  readonly sent: string[] = []
  readonly pings: string[] = []
  readonly closes: Array<{ code: number; reason: string }> = []
  sendStatus = 1

  constructor(readonly transportId: string) {}

  sendText(value: string): number {
    this.sent.push(value)
    return this.sendStatus
  }

  ping(value = ''): number {
    this.pings.push(value)
    return this.sendStatus
  }

  close(code: number, reason: string): void {
    this.closes.push({ code, reason })
  }

  terminate(): void {}
}

class WebSocketProbe {
  readonly #messages: unknown[] = []
  readonly #messageWaiters: Array<(message: unknown) => void> = []
  readonly #closes: Array<{ code: number; reason: string }> = []
  readonly #closeWaiters: Array<(close: { code: number; reason: string }) => void> = []
  readonly opened: Promise<void>

  constructor(readonly socket: WebSocket) {
    this.opened = withTimeout(new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true })
      socket.addEventListener('error', () => reject(new Error('websocket open failed')), {
        once: true
      })
    }), 'websocket open')
    socket.addEventListener('message', (event) => {
      const value = typeof event.data === 'string'
        ? JSON.parse(event.data) as unknown
        : event.data
      const waiter = this.#messageWaiters.shift()
      if (waiter === undefined) this.#messages.push(value)
      else waiter(value)
    })
    socket.addEventListener('close', (event) => {
      const value = { code: event.code, reason: event.reason }
      const waiter = this.#closeWaiters.shift()
      if (waiter === undefined) this.#closes.push(value)
      else waiter(value)
    })
  }

  send(value: unknown): void {
    this.socket.send(JSON.stringify(value))
  }

  sendBinary(value: Uint8Array): void {
    this.socket.send(value)
  }

  nextMessage(): Promise<unknown> {
    const message = this.#messages.shift()
    const pending = message === undefined
      ? new Promise<unknown>((resolve) => this.#messageWaiters.push(resolve))
      : Promise.resolve(message)
    return withTimeout(pending, 'websocket message')
  }

  nextClose(): Promise<{ code: number; reason: string }> {
    const close = this.#closes.shift()
    const pending = close === undefined
      ? new Promise<{ code: number; reason: string }>((resolve) =>
          this.#closeWaiters.push(resolve)
        )
      : Promise.resolve(close)
    return withTimeout(pending, 'websocket close')
  }

  close(): void {
    if (this.socket.readyState < WebSocket.CLOSING) this.socket.close()
  }
}

async function startApp(
  port: number,
  token: string,
  backendStartId: string
): Promise<RunningProcessApp> {
  const channel = tokenChannel(token)
  const app = await startProcessApp(environment(port, channel), {
    buildId: 'bck-008-test',
    realtime: {
      backendStartId,
      handshakeTimeoutMs: 75,
      heartbeatIntervalMs: 1_000,
      connectionTimeoutMs: 2_000
    }
  })
  liveApps.add(app)
  return app
}

async function connect(port: number): Promise<WebSocketProbe> {
  const client = new WebSocketProbe(new WebSocket(`ws://127.0.0.1:${port}/ws`))
  liveClients.add(client)
  await client.opened
  return client
}

function legacyHello(token: string) {
  return {
    protocol_version: 4,
    type: 'client.hello',
    token,
    supported_protocol_versions: [4, 3]
  }
}

function canonicalHello(messageId: string, now: number) {
  return {
    protocol_version: 4,
    message_type: 'client.hello',
    message_id: messageId,
    created_at_ms: now,
    payload: { supported_protocol_versions: [4, 3] }
  }
}

function canonicalPing(messageId: string, now: number) {
  return {
    protocol_version: 4,
    message_type: 'client.ping',
    message_id: messageId,
    created_at_ms: now,
    payload: { request_id: messageId }
  }
}

function canonicalTextSubmit(messageId: string, now: number, sessionId: string) {
  return {
    protocol_version: 4,
    message_type: 'client.text.submit',
    message_id: messageId,
    session_id: sessionId,
    created_at_ms: now,
    payload: { input_id: messageId, text: 'synthetic text' }
  }
}

function sessionStatusEnvelope(
  messageId: string,
  now: number,
  revision: number
): RealtimeEnvelope {
  return realtimeMessageRegistry['session.status'].schema.parse({
    protocol_version: 4,
    message_type: 'session.status',
    message_id: messageId,
    created_at_ms: now,
    payload: { session: idleSession(now, revision) }
  }) as RealtimeEnvelope
}

function transcriptEnvelope(
  text: string,
  final: boolean,
  now: number
): RealtimeEnvelope {
  return realtimeMessageRegistry['asr.transcript'].schema.parse({
    protocol_version: 4,
    message_type: 'asr.transcript',
    message_id: `transcript-${text}`,
    session_id: 'session-1',
    created_at_ms: now,
    payload: {
      source: 'microphone',
      text,
      final,
      started_at_ms: now - 1,
      ended_at_ms: now,
      revision: final ? 2 : 1
    }
  }) as RealtimeEnvelope
}

function idleSession(updatedAt: number, revision = 0): SessionSnapshot {
  return {
    session_id: null,
    state: 'idle',
    started_at_ms: null,
    updated_at_ms: updatedAt,
    revision
  }
}

function runningSession(
  sessionId: string,
  updatedAt: number,
  revision: number
): SessionSnapshot {
  return {
    session_id: sessionId,
    state: 'running',
    started_at_ms: updatedAt,
    updated_at_ms: updatedAt,
    revision
  }
}

function environment(port: number, fileDescriptor: number) {
  return {
    ADVX_BACKEND_MODE: 'production',
    ADVX_BACKEND_HOST: '127.0.0.1',
    ADVX_BACKEND_PORT: String(port),
    ADVX_DATA_DIR: 'D:/private/advx-data',
    ADVX_STARTUP_TOKEN_FD: String(fileDescriptor)
  }
}

function tokenChannel(token: string): number {
  const directory = mkdtempSync(join(tmpdir(), 'advx-bck-008-'))
  temporaryDirectories.add(directory)
  const path = join(directory, 'startup-token')
  writeFileSync(path, token, 'utf8')
  return openSync(path, 'r')
}

function availablePort(): number {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('reserved')
  })
  const port = server.port
  if (port === undefined) throw new Error('Bun did not assign a probe port')
  server.stop(true)
  return port
}

function canBind(port: number): boolean {
  try {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port,
      fetch: () => new Response('probe')
    })
    server.stop(true)
    return true
  } catch {
    return false
  }
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    Bun.sleep(2_000).then(() => {
      throw new Error(`${label} timed out`)
    })
  ])
}
