import { describe, expect, test } from 'bun:test'
import { canonicalSha256, type CanonicalRuntimeSpec } from '@advx/contracts'

import { createApp } from '../app'
import { createTransientRuntimeControl } from '../infrastructure/transient-runtime-control'
import { RecordedPipelineFixture } from '../infrastructure/recorded-pipeline'
import { InMemoryBackendProfileReader } from '../providers'

const TOKEN = 'r'.repeat(43)

describe('recorded Bun desktop pipeline boundary', () => {
  test('serves provider configuration and trace evidence around four input kinds', async () => {
    const fixture = new RecordedPipelineFixture()
    const runtimeControl = createTransientRuntimeControl({ publish: async () => {} })
    const app = createApp(
      {
        profileReader: new InMemoryBackendProfileReader({ name: '@advx/backend-bun', runtime: 'bun' }),
        runtimeControl,
        binaryIngestSink: fixture.binaryIngestSink,
        textIngestSink: fixture.textIngestSink,
        voiceActivitySink: fixture.voiceActivitySink
      },
      {
        mode: 'production',
        recordedPipeline: fixture,
        system: {
          authorize: (authorization) => authorization === `Bearer ${TOKEN}`,
          readiness: () => ({ contract: true, database: true, runtime: true }),
          backendVersion: 'test',
          buildId: 'recorded-test'
        }
      }
    )
    fixture.attachRuntimeReader((sessionId) => app.application.currentRuntimeSession(sessionId))

    const provider = await request(app.api, '/configuration/providers', { method: 'GET' })
    expect(provider.status).toBe(200)
    expect((await provider.json()).configured).toBe(false)

    const saved = await request(app.api, '/configuration/providers', {
      method: 'PUT',
      body: { model_base_url: 'recorded://model', model_name: 'recorded-viewer-v1' }
    })
    expect(saved.status).toBe(200)

    const spec = runtimeSpec()
    const started = await request(app.api, '/runtime/sessions', {
      method: 'POST',
      body: {
        client_request_id: 'recorded-test-start',
        canonical_runtime_spec: spec,
        client_config_hash: canonicalSha256(spec)
      }
    })
    expect(started.status).toBe(201)
    const session = (await started.json()).session_id as string
    fixture.markSessionStarted(session)
    await fixture.binaryIngestSink.dispatch({
      kind: 'frame', sessionId: session, inputId: 'frame', capturedAtMs: 1,
      format: 'image/png', binaryVersion: 1, connectionId: 'test', body: new Uint8Array([1])
    })
    await fixture.binaryIngestSink.dispatch({
      kind: 'audio', source: 'microphone', sessionId: session, inputId: 'mic', capturedAtMs: 2,
      format: 'audio/pcm', binaryVersion: 1, connectionId: 'test', body: new Uint8Array([2]), systemAudioRequired: true, turnId: 'turn'
    })
    await fixture.binaryIngestSink.dispatch({
      kind: 'audio', source: 'system_audio', sessionId: session, inputId: 'sys', capturedAtMs: 3,
      format: 'audio/pcm', binaryVersion: 1, connectionId: 'test', body: new Uint8Array([3]), systemAudioRequired: false
    })
    await fixture.textIngestSink.dispatch({ sessionId: session, inputId: 'text', createdAtMs: 4, text: 'fixture', connectionId: 'test' })

    const traces = await request(app.api, `/debug/traces?session_id=${session}`)
    expect(traces.status).toBe(200)
    const traceBody = await traces.json()
    expect(traceBody.items[0].frame_hashes).toHaveLength(1)
    expect(traceBody.metadata.input_kinds).toEqual(['frame', 'audio', 'text'])

    const aiCalls = await request(app.api, '/debug/ai-calls')
    expect(aiCalls.status).toBe(200)
    const aiCallBody = await aiCalls.json()
    expect(aiCallBody.items).toHaveLength(1)
    expect(aiCallBody.items[0]).toMatchObject({
      role: 'viewer',
      status: 'succeeded',
      model_id: 'recorded-viewer-v1'
    })
  })
})

async function request(api: { handle(request: Request): Response | Promise<Response> }, path: string, options: { method?: string; body?: unknown } = {}) {
  return api.handle(new Request(`http://localhost${path}`, {
    method: options.method ?? 'GET',
    headers: {
      authorization: `Bearer ${TOKEN}`,
      'x-advx-protocol-version': path.startsWith('/debug') || path.startsWith('/runtime') ? '3' : '3',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' })
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  }))
}

function runtimeSpec(): CanonicalRuntimeSpec {
  return {
    protocol_version: 3,
    audience_contract_version: 3,
    config_revision: 1,
    room: { room_id: 'room-recorded', display_name: 'Recorded', created_at_ms: 1, updated_at_ms: 1 },
    active_mode_id: 'mode-recorded',
    personas: [{ persona_id: 'persona-recorded', document_version: 1, revision: 1, content_hash: 'a'.repeat(64), display_name: 'Recorded', role: 'viewer', silence_bias: 0, burst_bias: 0, repetition_bias: 0, cooldown_ms: 0, enabled: true }],
    modes: [{ mode_id: 'mode-recorded', namespace_id: 'namespace-recorded', revision: 1, persona_counts: { 'persona-recorded': 1 }, normal_response_range: { minimum: 0, maximum: 1 }, highlight_response_range: { minimum: 0, maximum: 1 } }],
    provider: { provider_profile_id: 'recorded-desktop-fixture', viewer_model: 'recorded-viewer-v1', memory_model: 'recorded-memory-v1', visual_summary_model: 'recorded-visual-v1' }
  }
}
