import {
  ADVX_BINARY_V3_LAYOUT,
  canonicalSha256,
  encodeAdvxBinaryEnvelope,
  normalizedErrorSchema,
  realtimeEnvelopeSchema,
  type CanonicalRuntimeSpec,
  type SessionSnapshot
} from '@advx/contracts'
import { afterEach, describe, expect, test } from 'bun:test'

import { createApp } from '../app'
import {
  BinaryIngestDispatcher,
  REALTIME_CLOSE,
  RealtimeHub,
  ReplayService,
  TextIngestDispatcher,
  type BinaryIngestPort,
  type RealtimeSocketPort,
  type TextIngestPort
} from '../application'
import { InMemoryBackendProfileReader } from '../providers'

type NegativeCorpus = Readonly<{
  schema_version: number
  task_id: string
  categories: readonly string[]
  control_cases: readonly Readonly<{
    id: string
    mutation:
      | 'missing_client_request_id'
      | 'extra_top_level_field'
      | 'numeric_client_request_id'
      | 'oversized_room_display_name'
      | 'none'
    http_protocol_version?: string
    expected_status: number
    expected_code: string
  }>[]
  sequence_cases: readonly Readonly<{
    id: string
    sequences: readonly number[]
    expected_status: number
    expected_code: string
  }>[]
  realtime_cases: readonly Readonly<{
    id: string
    mutation: 'unknown_event_kind' | 'oversized_json'
    expected_code: string
    expected_close_code: number
  }>[]
  binary_cases: readonly Readonly<{
    id: string
    mutation:
      | 'invalid_magic'
      | 'unsupported_version'
      | 'truncated_header'
      | 'declared_length_mismatch'
      | 'oversized_body_declaration'
      | 'overlong_media_format'
    expected_code: string
  }>[]
  session_cases: readonly Readonly<{
    id: string
    mutation: 'stale_session' | 'post_stop'
    expected_code: string
  }>[]
  resource_limits: Readonly<{
    max_corpus_file_bytes: number
    max_generated_fixture_bytes: number
    oversized_control_display_name_characters: number
    realtime_json_limit_bytes: number
    oversized_realtime_padding_characters: number
    oversized_binary_declared_body_bytes: number
    overlong_media_format_characters: number
  }>
  applicability: Readonly<{ decompression: boolean; reason: string }>
}>

const TOKEN = 't'.repeat(43)
const corpusFile = Bun.file(new URL('./fixtures/tst-006-negative-corpus.json', import.meta.url))
const corpus = await corpusFile.json() as NegativeCorpus
const activeHubs = new Set<RealtimeHub>()

afterEach(async () => {
  for (const hub of activeHubs) await hub.shutdown('requested')
  activeHubs.clear()
})

describe('TST-006 deterministic protocol negative corpus', () => {
  test('declares exactly the bounded task corpus and applicability boundary', () => {
    const cases = allCases()
    expect(corpus.schema_version).toBe(1)
    expect(corpus.task_id).toBe('TST-006')
    expect(corpus.categories).toEqual([
      'json_field_shape',
      'protocol_version',
      'control_payload_size',
      'binary_header_and_length',
      'sequence_integrity',
      'session_fencing',
      'unknown_event_kind',
      'media_metadata_limit'
    ])
    expect(cases).toHaveLength(18)
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length)
    expect(corpusFile.size).toBeLessThanOrEqual(
      corpus.resource_limits.max_corpus_file_bytes
    )
    expect(corpus.applicability).toEqual({
      decompression: false,
      reason: expect.stringContaining('do not accept compressed request bodies')
    })
  })

  test('rejects missing, extra, wrong-type, oversized, and future-version control input', async () => {
    const app = testApp()

    for (const input of corpus.control_cases) {
      const body = mutateControlRequest(input.mutation)
      const response = await postJson(
        app.api,
        '/runtime/sessions',
        body,
        input.http_protocol_version ?? '3'
      )
      const text = await response.text()
      expect(response.status, input.id).toBe(input.expected_status)
      expect(normalizedErrorSchema.parse(JSON.parse(text)).code, input.id).toBe(
        input.expected_code
      )
      expect(text, input.id).not.toContain(TOKEN)
      expect(text, input.id).not.toContain('oversized-room-canary')
    }

    const health = await app.api.handle(new Request('http://localhost/health', {
      headers: { authorization: `Bearer ${TOKEN}` }
    }))
    expect(health.status).toBe(200)
  })

  test('rejects replay sequence gaps, duplicates, and reordering before execution', async () => {
    let replayRuns = 0
    const replay = new ReplayService({
      recordedRunner: () => {
        replayRuns += 1
        throw new Error('invalid replay corpus reached execution')
      }
    })
    const app = testApp(replay)

    for (const input of corpus.sequence_cases) {
      const response = await postJson(
        app.api,
        '/debug/replay',
        replayRequest(input.sequences),
        '3'
      )
      const body = normalizedErrorSchema.parse(await response.json())
      expect(response.status, input.id).toBe(input.expected_status)
      expect(body.code, input.id).toBe(input.expected_code)
    }

    expect(replayRuns).toBe(0)
  })

  test('closes unknown event kinds and oversized JSON without downstream work', async () => {
    for (const input of corpus.realtime_cases) {
      const { hub, socket } = await readyHub({
        jsonPayloadMaximumBytes: corpus.resource_limits.realtime_json_limit_bytes
      })
      const value = input.mutation === 'unknown_event_kind'
        ? {
            protocol_version: 4,
            message_type: 'client.future.event',
            message_id: input.id,
            created_at_ms: 1_100,
            payload: {}
          }
        : JSON.stringify({
            ...canonicalPing(input.id, 1_100),
            padding: 'x'.repeat(
              corpus.resource_limits.oversized_realtime_padding_characters
            )
          })

      await hub.receive(socket.transportId, value)
      const error = parseLastEnvelope(socket)
      expect(error.message_type, input.id).toBe('protocol.error')
      expect((error.payload as { code: string }).code, input.id).toBe(input.expected_code)
      expect(socket.closes.at(-1)?.code, input.id).toBe(input.expected_close_code)
      expect(hub.snapshot().connectionCount, input.id).toBe(0)
      expect(socket.sent.join('\n'), input.id).not.toContain(TOKEN)
    }
  })

  test('rejects bounded binary header, length, and metadata faults without dispatch', async () => {
    let dispatches = 0
    const sessions = { currentSession: () => runningSession('session-live') }
    const ingest = new BinaryIngestDispatcher({
      sessions,
      sink: { dispatch: () => { dispatches += 1 } },
      capacity: 2,
      now: () => 2_000
    })
    const { hub, socket } = await readyHub({ sessions, ingest })
    let maximumFixtureBytes = 0

    for (const input of corpus.binary_cases) {
      const bytes = binaryFault(input.mutation)
      maximumFixtureBytes = Math.max(maximumFixtureBytes, bytes.byteLength)
      await hub.receive(socket.transportId, bytes)
      const rejection = parseLastEnvelope(socket)
      expect(rejection.message_type, input.id).toBe('ingest.rejected')
      expect((rejection.payload as { code: string }).code, input.id).toBe(
        input.expected_code
      )
    }

    expect(maximumFixtureBytes).toBeLessThanOrEqual(
      corpus.resource_limits.max_generated_fixture_bytes
    )
    expect(dispatches).toBe(0)
    expect(ingest.snapshot().inFlight).toBe(0)
    expect(socket.closes).toEqual([])
    await hub.receive(socket.transportId, canonicalPing('after-binary-corpus', 2_100))
    expect(parseLastEnvelope(socket).message_type).toBe('backend.pong')
  })

  test('rejects stale-Session and post-stop traffic with no partial ingest', async () => {
    let current = runningSession('session-live')
    const commands: unknown[] = []
    const sessions = { currentSession: () => current }
    const textIngest = new TextIngestDispatcher({
      sessions,
      sink: { dispatch: (command) => { commands.push(command) } },
      capacity: 2,
      now: () => 3_000
    })
    const { hub, socket } = await readyHub({ sessions, textIngest })

    for (const input of corpus.session_cases) {
      current = input.mutation === 'stale_session'
        ? runningSession('session-new')
        : idleAfterStop()
      await hub.receive(
        socket.transportId,
        canonicalText(input.id, 3_100, 'session-live')
      )
      const rejection = parseLastEnvelope(socket)
      expect(rejection.message_type, input.id).toBe('ingest.rejected')
      expect((rejection.payload as { code: string }).code, input.id).toBe(
        input.expected_code
      )
    }

    expect(commands).toEqual([])
    expect(textIngest.snapshot().inFlight).toBe(0)
    expect(socket.closes).toEqual([])
    await hub.receive(socket.transportId, canonicalPing('after-session-corpus', 3_200))
    expect(parseLastEnvelope(socket).message_type).toBe('backend.pong')
  })
})

function allCases(): readonly Readonly<{ id: string }>[] {
  return [
    ...corpus.control_cases,
    ...corpus.sequence_cases,
    ...corpus.realtime_cases,
    ...corpus.binary_cases,
    ...corpus.session_cases
  ]
}

function testApp(replay?: ReplayService) {
  return createApp(
    {
      profileReader: new InMemoryBackendProfileReader({
        name: '@advx/backend-bun',
        runtime: 'bun'
      })
    },
    {
      mode: 'production',
      system: {
        authorize: (authorization) => authorization === `Bearer ${TOKEN}`,
        readiness: () => ({ contract: true, database: true, runtime: true }),
        backendVersion: 'test',
        buildId: 'tst-006'
      },
      ...(replay === undefined ? {} : { debug: { replay } })
    }
  )
}

function mutateControlRequest(
  mutation: NegativeCorpus['control_cases'][number]['mutation']
): Record<string, unknown> {
  const body = structuredClone(startRequest(runtimeSpec())) as Record<string, unknown>
  switch (mutation) {
    case 'missing_client_request_id':
      delete body.client_request_id
      break
    case 'extra_top_level_field':
      body.unexpected = 'must-reject'
      break
    case 'numeric_client_request_id':
      body.client_request_id = 42
      break
    case 'oversized_room_display_name': {
      const spec = body.canonical_runtime_spec as Record<string, unknown>
      const room = spec.room as Record<string, unknown>
      room.display_name = 'oversized-room-canary'.padEnd(
        corpus.resource_limits.oversized_control_display_name_characters,
        'x'
      )
      break
    }
    case 'none':
      break
  }
  return body
}

function startRequest(spec: CanonicalRuntimeSpec) {
  return {
    client_request_id: 'tst-006-start',
    canonical_runtime_spec: spec,
    client_config_hash: canonicalSha256(spec)
  }
}

function runtimeSpec(): CanonicalRuntimeSpec {
  return {
    protocol_version: 3,
    audience_contract_version: 3,
    config_revision: 1,
    room: {
      room_id: 'room-tst-006',
      display_name: 'TST-006',
      created_at_ms: 1,
      updated_at_ms: 1
    },
    active_mode_id: 'mode-tst-006',
    personas: [{
      persona_id: 'persona-tst-006',
      document_version: 1,
      revision: 1,
      content_hash: '6'.repeat(64),
      display_name: 'Viewer',
      role: 'viewer',
      silence_bias: 0,
      burst_bias: 0,
      repetition_bias: 0,
      cooldown_ms: 0,
      enabled: true
    }],
    modes: [{
      mode_id: 'mode-tst-006',
      namespace_id: 'namespace-tst-006',
      revision: 1,
      persona_counts: { 'persona-tst-006': 1 },
      normal_response_range: { minimum: 0, maximum: 1 },
      highlight_response_range: { minimum: 0, maximum: 1 }
    }],
    provider: {
      provider_profile_id: 'profile-tst-006',
      viewer_model: 'viewer-model',
      memory_model: 'memory-model',
      visual_summary_model: 'visual-model'
    }
  }
}

function replayRequest(sequences: readonly number[]) {
  const spec = runtimeSpec()
  const outputs = sequences.map((_, index) => ({
    generation_request_id: `generation-tst-006-${index + 1}`,
    provider_role: 'viewer' as const,
    output: { action: 'silence' as const }
  }))
  return {
    mode: 'recorded' as const,
    bundle: {
      replay_schema_version: 1 as const,
      protocol_version: 3 as const,
      audience_contract_version: 3 as const,
      bundle_id: 'bundle-tst-006',
      created_at_ms: 2_000,
      seed: 6,
      virtual_clock_start_ms: 2_000,
      config_hash: canonicalSha256(spec),
      canonical_runtime_spec: spec,
      events: sequences.map((sequence, index) => ({
        sequence,
        event_type: 'viewer.completed',
        occurred_at_ms: 2_001 + index,
        payload: { generation_request_id: outputs[index]!.generation_request_id }
      })),
      recorded_provider_outputs: outputs,
      recorded_outputs_digest: canonicalSha256(outputs),
      redacted: true as const
    }
  }
}

async function postJson(
  api: { handle(request: Request): Response | Promise<Response> },
  path: string,
  body: unknown,
  version: string
): Promise<Response> {
  return api.handle(new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'content-type': 'application/json',
      'x-advx-protocol-version': version
    },
    body: JSON.stringify(body)
  }))
}

async function readyHub(options: Readonly<{
  sessions?: { currentSession(): SessionSnapshot | Promise<SessionSnapshot> }
  ingest?: BinaryIngestPort
  textIngest?: TextIngestPort
  jsonPayloadMaximumBytes?: number
}> = {}): Promise<{ hub: RealtimeHub; socket: FakeSocket }> {
  const hub = new RealtimeHub({
    backendStartId: `tst-006-backend-${activeHubs.size + 1}`,
    authorize: (authorization) => authorization === `Bearer ${TOKEN}`,
    sessions: options.sessions ?? { currentSession: () => runningSession('session-live') },
    ...(options.ingest === undefined ? {} : { ingest: options.ingest }),
    ...(options.textIngest === undefined ? {} : { textIngest: options.textIngest }),
    queueCapacity: 4,
    connectionCapacity: 4,
    jsonPayloadMaximumBytes: options.jsonPayloadMaximumBytes ?? 4_096,
    handshakeTimeoutMs: 1_000,
    heartbeatIntervalMs: 10_000,
    connectionTimeoutMs: 20_000,
    now: () => 1_000,
    nextMessageId: () => crypto.randomUUID()
  })
  activeHubs.add(hub)
  const socket = new FakeSocket(`transport-${activeHubs.size}`)
  hub.open(socket, {
    authorization: `Bearer ${TOKEN}`,
    desktopClientId: `desktop-${activeHubs.size}`
  })
  await hub.receive(socket.transportId, canonicalHello(`hello-${activeHubs.size}`, 1_000))
  if (parseLastEnvelope(socket).message_type !== 'backend.ready') {
    throw new Error('TST-006 realtime harness did not become ready')
  }
  return { hub, socket }
}

function binaryFault(
  mutation: NegativeCorpus['binary_cases'][number]['mutation']
): Uint8Array {
  const valid = encodeAdvxBinaryEnvelope({
    version: 3,
    mediaType: 'audio',
    source: 'microphone',
    sessionId: 'session-live',
    inputId: 'input-tst-006',
    capturedAtMs: 2_000,
    format: 'audio/pcm',
    systemAudioRequired: false,
    body: new Uint8Array([1, 2, 3])
  })
  switch (mutation) {
    case 'invalid_magic': {
      const bytes = valid.slice()
      bytes[0] = 0
      return bytes
    }
    case 'unsupported_version': {
      const bytes = valid.slice()
      bytes[4] = 99
      return bytes
    }
    case 'truncated_header':
      return new Uint8Array([65, 68, 86, 88, 3])
    case 'declared_length_mismatch':
      return valid.slice(0, -1)
    case 'oversized_body_declaration':
      return v3Declaration({
        media_type: 'audio',
        source: 'microphone',
        session_id: 'session-live',
        input_id: 'oversized-declaration',
        captured_at_ms: 2_000,
        format: 'audio/pcm',
        body_length: corpus.resource_limits.oversized_binary_declared_body_bytes
      })
    case 'overlong_media_format':
      return v3Declaration({
        media_type: 'audio',
        source: 'microphone',
        session_id: 'session-live',
        input_id: 'overlong-format',
        captured_at_ms: 2_000,
        format: 'f'.repeat(corpus.resource_limits.overlong_media_format_characters),
        body_length: 1
      }, new Uint8Array([1]))
  }
}

function v3Declaration(header: Record<string, unknown>, body = new Uint8Array()): Uint8Array {
  const encoded = new TextEncoder().encode(JSON.stringify(header))
  const bytes = new Uint8Array(ADVX_BINARY_V3_LAYOUT.byteLength + encoded.length + body.length)
  bytes.set([65, 68, 86, 88, 3], 0)
  new DataView(bytes.buffer).setUint32(ADVX_BINARY_V3_LAYOUT.jsonHeaderLength, encoded.length, false)
  bytes.set(encoded, ADVX_BINARY_V3_LAYOUT.jsonHeader)
  bytes.set(body, ADVX_BINARY_V3_LAYOUT.jsonHeader + encoded.length)
  return bytes
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

function canonicalText(messageId: string, now: number, sessionId: string) {
  return {
    protocol_version: 4,
    message_type: 'client.text.submit',
    message_id: messageId,
    session_id: sessionId,
    created_at_ms: now,
    payload: { input_id: messageId, text: 'synthetic TST-006 text' }
  }
}

function runningSession(sessionId: string): SessionSnapshot {
  return {
    session_id: sessionId,
    state: 'running',
    started_at_ms: 900,
    updated_at_ms: 1_000,
    revision: 1
  }
}

function idleAfterStop(): SessionSnapshot {
  return {
    session_id: null,
    state: 'idle',
    started_at_ms: null,
    updated_at_ms: 3_000,
    revision: 2
  }
}

function parseLastEnvelope(socket: FakeSocket) {
  const serialized = socket.sent.at(-1)
  if (serialized === undefined) throw new Error('TST-006 expected a realtime response')
  return realtimeEnvelopeSchema.parse(JSON.parse(serialized))
}

class FakeSocket implements RealtimeSocketPort {
  readonly sent: string[] = []
  readonly pings: string[] = []
  readonly closes: Array<{ code: number; reason: string }> = []

  constructor(readonly transportId: string) {}

  sendText(value: string): number {
    this.sent.push(value)
    return 1
  }

  ping(value = ''): number {
    this.pings.push(value)
    return 1
  }

  close(code: number, reason: string): void {
    this.closes.push({ code, reason })
  }

  terminate(): void {
    this.closes.push({ code: REALTIME_CLOSE.internalError, reason: 'terminated' })
  }
}
