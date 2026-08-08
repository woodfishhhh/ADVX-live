import { describe, expect, test } from 'bun:test'
import { canonicalSha256, type CanonicalRuntimeSpec } from '@advx/contracts'

import { createApp } from '../app'
import { createTransientRuntimeControl } from '../infrastructure/transient-runtime-control'
import { InMemoryBackendProfileReader } from '../providers'

const TOKEN = 'r'.repeat(43)

describe('Bun replay debug route', () => {
  test('returns deterministic recorded replay evidence', async () => {
    const app = createApp(
      {
        profileReader: new InMemoryBackendProfileReader({ name: '@advx/backend-bun', runtime: 'bun' }),
        runtimeControl: createTransientRuntimeControl({ publish: async () => {} })
      },
      {
        mode: 'production',
        system: {
          authorize: (authorization) => authorization === `Bearer ${TOKEN}`,
          readiness: () => ({ contract: true, database: true, runtime: true }),
          backendVersion: 'test',
          buildId: 'replay-test'
        }
      }
    )
    const body = replayRequest()
    const response = await app.api.handle(new Request('http://localhost/debug/replay', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${TOKEN}`,
        'x-advx-protocol-version': '3',
        'content-type': 'application/json'
      },
      body: JSON.stringify(body)
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      bundle_id: 'bundle-route-test',
      mode: 'recorded',
      deterministic_proof: true,
      external_transport_call_count: 0
    })
  })
})

function replayRequest() {
  const spec: CanonicalRuntimeSpec = {
    protocol_version: 3,
    audience_contract_version: 3,
    config_revision: 1,
    room: { room_id: 'room-route-test', display_name: 'Route Test', created_at_ms: 0, updated_at_ms: 0 },
    active_mode_id: 'mode-route-test',
    personas: [{ persona_id: 'persona-route-test', document_version: 1, revision: 1, content_hash: 'b'.repeat(64), display_name: 'Route Viewer', role: 'viewer', silence_bias: 0, burst_bias: 0, repetition_bias: 0, cooldown_ms: 0, enabled: true }],
    modes: [{ mode_id: 'mode-route-test', namespace_id: 'namespace-route-test', revision: 1, persona_counts: { 'persona-route-test': 1 }, normal_response_range: { minimum: 0, maximum: 1 }, highlight_response_range: { minimum: 0, maximum: 1 } }],
    provider: { provider_profile_id: 'recorded-profile', viewer_model: 'recorded-viewer', memory_model: 'recorded-memory', visual_summary_model: 'recorded-visual' }
  }
  const outputs = [{ generation_request_id: 'generation-route-test', provider_role: 'viewer' as const, output: { action: 'silence' } }]
  return {
    mode: 'recorded' as const,
    bundle: {
      replay_schema_version: 1 as const,
      protocol_version: 3 as const,
      audience_contract_version: 3 as const,
      bundle_id: 'bundle-route-test',
      created_at_ms: 2_000,
      seed: 1,
      virtual_clock_start_ms: 2_000,
      config_hash: canonicalSha256(spec),
      canonical_runtime_spec: spec,
      events: [{ sequence: 1, event_type: 'viewer.completed', occurred_at_ms: 2_001, payload: { generation_request_id: 'generation-route-test' } }],
      recorded_provider_outputs: outputs,
      recorded_outputs_digest: canonicalSha256(outputs),
      redacted: true as const
    }
  }
}
