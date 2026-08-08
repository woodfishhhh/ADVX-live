import { describe, expect, test } from 'bun:test'
import { canonicalSha256, type ReplayRequest } from '@advx/contracts'

import {
  ReplayService,
  ReplayServiceError,
  type RecordedReplayRunContext
} from './replay-service'

describe('recorded replay service', () => {
  test('consumes every recorded identity twice and proves deterministic output', async () => {
    const request = replayRequest()
    const contexts: RecordedReplayRunContext[] = []
    const service = new ReplayService({
      recordedRunner: async (bundle, context) => {
        contexts.push(context)
        return {
          decisions: bundle.events.map((event) => event.payload),
          selected_viewer_ids: ['viewer-1'],
          barrages: [{ text: 'hello' }],
          memories: [],
          traces: [],
          consumed_provider_roles: ['viewer'],
          consumed_provider_outputs: [{
            provider_role: 'viewer',
            generation_request_id: 'generation-1',
            call_index: 1
          }],
          external_transport_call_count: 0
        }
      }
    })

    const result = await service.replay(request)

    expect(result).toMatchObject({
      bundle_id: 'bundle-replay-test',
      mode: 'recorded',
      deterministic_proof: true,
      credentialed_provider_proof: false,
      event_count: 1,
      trace_count: 0,
      external_transport_call_count: 0,
      recorded_evidence: { consumed_provider_roles: ['viewer'] }
    })
    expect(result.replay_digest).toMatch(/^[0-9a-f]{64}$/)
    expect(contexts).toHaveLength(2)
    expect(contexts[0]?.run_number).toBe(1)
    expect(contexts[1]?.run_number).toBe(2)
    expect(contexts[0]?.data_directory).not.toBe(contexts[1]?.data_directory)
  })

  test('rejects live replay unless a verified external Provider is configured', async () => {
    const service = new ReplayService()
    await expect(service.replay({
      ...replayRequest(),
      mode: 'live',
      allow_external_provider_calls: true
    })).rejects.toMatchObject({ code: 'live_replay_unavailable' })
  })

  test('accepts an injected live Provider only with verified provenance', async () => {
    const service = new ReplayService({
      liveProvider: async () => ({
        provider_profile_id: 'profile-live-test',
        credentialed: true,
        external_transport_verified: true,
        external_transport_call_count: 1,
        fake_fallback_used: false
      })
    })
    const result = await service.replay({
      ...replayRequest(),
      mode: 'live',
      allow_external_provider_calls: true
    })
    expect(result).toMatchObject({
      mode: 'live',
      deterministic_proof: false,
      credentialed_provider_proof: true,
      provider_profile_id: 'profile-live-test',
      external_transport_call_count: 1
    })
  })
})

function replayRequest(): ReplayRequest {
  const canonicalRuntimeSpec = {
    protocol_version: 3 as const,
    audience_contract_version: 3 as const,
    config_revision: 1,
    room: {
      room_id: 'room-replay-test',
      display_name: 'Replay Test',
      created_at_ms: 0,
      updated_at_ms: 0
    },
    active_mode_id: 'mode-replay-test',
    personas: [{
      persona_id: 'persona-replay-test',
      document_version: 1,
      revision: 1,
      content_hash: 'a'.repeat(64),
      display_name: 'Replay Viewer',
      role: 'viewer',
      silence_bias: 0,
      burst_bias: 0,
      repetition_bias: 0,
      cooldown_ms: 0,
      enabled: true
    }],
    modes: [{
      mode_id: 'mode-replay-test',
      namespace_id: 'namespace-replay-test',
      revision: 1,
      persona_counts: { 'persona-replay-test': 1 },
      normal_response_range: { minimum: 0, maximum: 1 },
      highlight_response_range: { minimum: 0, maximum: 1 }
    }],
    provider: {
      provider_profile_id: 'recorded-profile',
      viewer_model: 'recorded-viewer',
      memory_model: 'recorded-memory',
      visual_summary_model: 'recorded-visual'
    }
  }
  return {
    mode: 'recorded',
    bundle: {
      replay_schema_version: 1,
      protocol_version: 3,
      audience_contract_version: 3,
      bundle_id: 'bundle-replay-test',
      created_at_ms: 1_000,
      seed: 6657,
      virtual_clock_start_ms: 1_000,
      config_hash: canonicalSha256(canonicalRuntimeSpec),
      canonical_runtime_spec: canonicalRuntimeSpec,
      events: [{
        sequence: 1,
        event_type: 'viewer.completed',
        occurred_at_ms: 1_100,
        payload: {
          generation_request_id: 'generation-1',
          viewer_instance_id: 'viewer-1'
        }
      }],
      recorded_provider_outputs: [{
        generation_request_id: 'generation-1',
        provider_role: 'viewer',
        output: { action: 'barrage', text: 'hello' }
      }],
      recorded_outputs_digest: canonicalSha256([{
        generation_request_id: 'generation-1',
        provider_role: 'viewer',
        output: { action: 'barrage', text: 'hello' }
      }]),
      redacted: true
    }
  }
}
