import { afterEach, describe, expect, test } from 'bun:test'

import {
  ADVX_BINARY_V3_LAYOUT,
  encodeAdvxBinaryEnvelope,
  type SessionSnapshot
} from '@advx/contracts'

import { createApp } from '../app'
import type {
  BinaryIngestCommand,
  BinaryIngestCommandSink,
  RuntimeControlOperations
} from '../application'
import { StaticBackendProfileReader } from '../infrastructure'

const TOKEN = 'B'.repeat(43)
const liveApps = new Set<TestApp>()
const liveClients = new Set<WebSocketProbe>()

afterEach(async () => {
  for (const client of liveClients) client.close()
  liveClients.clear()
  for (const app of liveApps) await stopApp(app)
  liveApps.clear()
})

describe('BCK-009 binary ingest dispatch', () => {
  test('dispatches current v3 audio and frame commands through the real WebSocket', async () => {
    const commands: BinaryIngestCommand[] = []
    const app = await startApp({ commands })
    const client = await readyCanonicalClient(app.port)

    client.sendBinary(binary(3, 'audio', 'audio-current', 'session-live'))
    expect(await client.nextMessage()).toMatchObject({
      message_type: 'ingest.ack',
      session_id: 'session-live',
      payload: {
        input_id: 'audio-current',
        input_kind: 'audio',
        stage: 'committed'
      }
    })
    client.sendBinary(binary(3, 'image', 'frame-current', 'session-live'))
    expect(await client.nextMessage()).toMatchObject({
      message_type: 'ingest.ack',
      session_id: 'session-live',
      payload: {
        input_id: 'frame-current',
        input_kind: 'frame',
        stage: 'received'
      }
    })

    expect(commands.map(({ kind, inputId, binaryVersion }) => ({
      kind,
      inputId,
      binaryVersion
    }))).toEqual([
      { kind: 'audio', inputId: 'audio-current', binaryVersion: 3 },
      { kind: 'frame', inputId: 'frame-current', binaryVersion: 3 }
    ])
    expect(commands[0]!.body).toEqual(new Uint8Array([11, 12, 13]))
    expect(JSON.stringify(commands)).not.toContain('body')
  })

  test('accepts legacy v1/v2 binary envelopes only on negotiated realtime v3', async () => {
    const commands: BinaryIngestCommand[] = []
    const app = await startApp({ commands })
    const legacy = await readyClient(app.port, 3)

    legacy.sendBinary(binary(1, 'audio', 'legacy-v1', 'session-live'))
    expect(await legacy.nextMessage()).toMatchObject({
      protocol_version: 3,
      type: 'ingest.ack',
      input_id: 'legacy-v1',
      stage: 'received'
    })
    legacy.sendBinary(binary(2, 'image', 'legacy-v2', 'session-live'))
    expect(await legacy.nextMessage()).toMatchObject({
      protocol_version: 3,
      type: 'ingest.ack',
      input_id: 'legacy-v2',
      input_kind: 'frame'
    })

    const current = await readyClient(app.port, 4, 'current-client')
    current.sendBinary(binary(2, 'audio', 'wrong-version', 'session-live'))
    expect(await current.nextMessage()).toMatchObject({
      type: 'ingest.rejected',
      code: 'invalid_input',
      input_id: 'wrong-version'
    })
    expect(commands).toHaveLength(2)
  })

  test('classifies unsupported, truncated, mismatched, and oversized binary faults', async () => {
    const app = await startApp()
    const client = await readyClient(app.port, 4)

    const unsupportedVersion = new Uint8Array([65, 68, 86, 88, 9])
    client.sendBinary(unsupportedVersion)
    expect(await client.nextMessage()).toMatchObject({
      code: 'unsupported_binary_version'
    })

    const unsupportedType = binary(1, 'audio', 'bad-type', 'session-live')
    unsupportedType[5] = 9
    client.sendBinary(unsupportedType)
    expect(await client.nextMessage()).toMatchObject({ code: 'unsupported_media_type' })

    const unsupportedSource = binary(2, 'audio', 'bad-source', 'session-live')
    unsupportedSource[6] = 9
    client.sendBinary(unsupportedSource)
    expect(await client.nextMessage()).toMatchObject({
      code: 'invalid_input',
      message: 'The binary envelope source is not supported.'
    })

    client.sendBinary(new Uint8Array([65, 68, 86, 88, 3]))
    expect(await client.nextMessage()).toMatchObject({ code: 'malformed_binary_envelope' })

    const mismatchedLength = binary(3, 'image', 'short-body', 'session-live').slice(0, -1)
    client.sendBinary(mismatchedLength)
    expect(await client.nextMessage()).toMatchObject({ code: 'malformed_binary_envelope' })

    client.sendBinary(oversizedImageDeclaration())
    expect(await client.nextMessage()).toMatchObject({ code: 'payload_too_large' })
  })

  test('rejects stale Sessions and media after source lifecycle completion', async () => {
    const commands: BinaryIngestCommand[] = []
    const app = await startApp({ commands })
    const client = await readyClient(app.port, 4)

    client.sendBinary(binary(3, 'audio', 'stale', 'session-old'))
    expect(await client.nextMessage()).toMatchObject({
      code: 'session_not_active',
      input_id: 'stale'
    })

    app.composition.binaryIngest!.stopAudioSource('session-live', 'microphone')
    client.sendBinary(binary(3, 'audio', 'stopped-audio', 'session-live'))
    expect(await client.nextMessage()).toMatchObject({
      code: 'unknown_input',
      message: 'The audio source is stopped.',
      input_kind: 'audio'
    })

    app.composition.binaryIngest!.endCaptureSource('session-live')
    client.sendBinary(binary(3, 'image', 'ended-frame', 'session-live'))
    expect(await client.nextMessage()).toMatchObject({
      code: 'unknown_input',
      message: 'The capture source has ended.',
      input_kind: 'frame'
    })
    expect(commands).toHaveLength(0)
  })

  test('bounds concurrent dispatch and rejects flood input without queue growth', async () => {
    let release!: () => void
    const blocked = new Promise<void>((resolve) => { release = resolve })
    let first = true
    const sink: BinaryIngestCommandSink = {
      dispatch: async () => {
        if (first) {
          first = false
          await blocked
        }
      }
    }
    const app = await startApp({ sink, queueCapacity: 1 })
    const firstClient = await readyClient(app.port, 4, 'flood-one')
    const secondClient = await readyClient(app.port, 4, 'flood-two')

    firstClient.sendBinary(binary(3, 'audio', 'held', 'session-live'))
    await waitUntil(() => app.composition.binaryIngest!.snapshot().inFlight === 1)
    secondClient.sendBinary(binary(3, 'image', 'rejected', 'session-live'))
    expect(await secondClient.nextMessage()).toMatchObject({
      type: 'ingest.rejected',
      code: 'pipeline_unavailable',
      message: 'The ingest pipeline is busy.',
      input_id: 'rejected'
    })
    expect(app.composition.binaryIngest!.snapshot()).toMatchObject({
      capacity: 1,
      inFlight: 1
    })

    release()
    expect(await firstClient.nextMessage()).toMatchObject({
      type: 'ingest.ack',
      input_id: 'held'
    })
    expect(app.composition.binaryIngest!.snapshot().inFlight).toBe(0)
  })
})

type TestApp = Readonly<{
  port: number
  composition: ReturnType<typeof createApp>
}>

async function startApp(options: Readonly<{
  commands?: BinaryIngestCommand[]
  sink?: BinaryIngestCommandSink
  queueCapacity?: number
}> = {}): Promise<TestApp> {
  const port = availablePort()
  const sink = options.sink ?? {
    dispatch(command: BinaryIngestCommand) {
      options.commands?.push(command)
    }
  }
  const composition = createApp(
    {
      profileReader: new StaticBackendProfileReader(),
      runtimeControl: runningRuntimeControl(),
      binaryIngestSink: sink
    },
    {
      mode: 'production',
      system: {
        authorize: (authorization) => authorization === `Bearer ${TOKEN}`,
        readiness: () => ({ contract: true, database: false, runtime: true }),
        backendVersion: '0.1.0',
        buildId: 'bck-009-test'
      },
      realtime: {
        backendStartId: 'bck-009-start',
        queueCapacity: options.queueCapacity ?? 8,
        connectionCapacity: 8,
        jsonPayloadMaximumBytes: 16_384,
        handshakeTimeoutMs: 500,
        heartbeatIntervalMs: 1_000,
        connectionTimeoutMs: 2_000
      }
    }
  )
  composition.api.listen({ hostname: '127.0.0.1', port })
  const app = { port, composition }
  liveApps.add(app)
  return app
}

async function stopApp(app: TestApp): Promise<void> {
  await app.composition.realtime?.shutdown()
  app.composition.api.server?.stop(true)
  app.composition.api.server = null
}

async function readyClient(
  port: number,
  protocolVersion: 3 | 4,
  clientId = 'desktop-main'
): Promise<WebSocketProbe> {
  const client = connectWithHeaders(port, { 'x-advx-client-id': clientId })
  liveClients.add(client)
  await client.opened
  client.send({
    protocol_version: protocolVersion,
    type: 'client.hello',
    token: TOKEN,
    supported_protocol_versions: [protocolVersion]
  })
  expect(await client.nextMessage()).toMatchObject({
    protocol_version: protocolVersion,
    type: 'backend.ready'
  })
  return client
}

async function readyCanonicalClient(port: number): Promise<WebSocketProbe> {
  const client = connectWithHeaders(port, {
    authorization: `Bearer ${TOKEN}`,
    'x-advx-client-id': 'canonical-client'
  })
  liveClients.add(client)
  await client.opened
  client.send({
    protocol_version: 4,
    message_type: 'client.hello',
    message_id: 'canonical-hello',
    created_at_ms: 1,
    payload: { supported_protocol_versions: [4] }
  })
  expect(await client.nextMessage()).toMatchObject({
    protocol_version: 4,
    message_type: 'backend.ready'
  })
  return client
}

function connectWithHeaders(
  port: number,
  headers: Readonly<Record<string, string>>
): WebSocketProbe {
  const WebSocketWithHeaders = WebSocket as unknown as new (
    url: string,
    options: { readonly headers: Readonly<Record<string, string>> }
  ) => WebSocket
  return new WebSocketProbe(new WebSocketWithHeaders(
    `ws://127.0.0.1:${port}/ws`,
    { headers }
  ))
}

function binary(
  version: 1 | 2 | 3,
  mediaType: 'audio' | 'image',
  inputId: string,
  sessionId: string
): Uint8Array {
  return encodeAdvxBinaryEnvelope({
    version,
    mediaType,
    source: mediaType === 'audio' ? 'microphone' : null,
    sessionId,
    inputId,
    capturedAtMs: 10,
    format: mediaType === 'audio' ? 'audio/pcm' : 'image/png',
    systemAudioRequired: false,
    body: new Uint8Array([11, 12, 13])
  })
}

function oversizedImageDeclaration(): Uint8Array {
  const header = new TextEncoder().encode(JSON.stringify({
    media_type: 'image',
    source: null,
    session_id: 'session-live',
    input_id: 'oversized',
    captured_at_ms: 10,
    format: 'image/png',
    body_length: 4_194_305
  }))
  const bytes = new Uint8Array(ADVX_BINARY_V3_LAYOUT.byteLength + header.length)
  bytes.set([65, 68, 86, 88, 3], 0)
  new DataView(bytes.buffer).setUint32(5, header.length, false)
  bytes.set(header, ADVX_BINARY_V3_LAYOUT.jsonHeader)
  return bytes
}

function runningRuntimeControl(): RuntimeControlOperations {
  const session: SessionSnapshot = {
    session_id: 'session-live',
    state: 'running',
    started_at_ms: 1,
    updated_at_ms: 1,
    revision: 1
  }
  const unused = async () => { throw new Error('unused runtime operation') }
  return {
    currentSession: () => session,
    pauseSession: unused,
    resumeSession: unused,
    stopSession: unused,
    startRuntimeSession: unused,
    currentRuntimeSession: unused,
    applyRuntimeSpec: unused,
    rollbackRuntimeSpec: unused,
    recoverRuntimeSession: unused
  }
}

class WebSocketProbe {
  readonly opened: Promise<void>
  readonly #messages: unknown[] = []
  readonly #messageWaiters: Array<(value: unknown) => void> = []

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
  }

  send(value: unknown): void {
    this.socket.send(JSON.stringify(value))
  }

  sendBinary(value: Uint8Array): void {
    this.socket.send(value)
  }

  nextMessage(): Promise<unknown> {
    const message = this.#messages.shift()
    return withTimeout(
      message === undefined
        ? new Promise<unknown>((resolve) => this.#messageWaiters.push(resolve))
        : Promise.resolve(message),
      'websocket message'
    )
  }

  close(): void {
    if (this.socket.readyState < WebSocket.CLOSING) this.socket.close()
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition timed out')
    await Bun.sleep(2)
  }
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    Bun.sleep(2_000).then(() => { throw new Error(`${label} timed out`) })
  ])
}

function availablePort(): number {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('probe')
  })
  const port = server.port
  server.stop(true)
  return port!
}
