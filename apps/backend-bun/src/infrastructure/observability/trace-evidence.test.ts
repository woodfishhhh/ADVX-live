import { describe, expect, test } from 'bun:test'

import {
  inputMetadata,
  normalizeAiCallTrace,
  normalizeViewerTrace,
  TRACE_EVIDENCE_NORMALIZER_VERSION
} from './trace-evidence'

describe('OBS-003 trace evidence normalizer', () => {
  test('normalizes viewer traces without changing the versioned contract', () => {
    const result = normalizeViewerTrace(viewerTraceFixture(), 'python')

    expect(result.normalizer_version).toBe(TRACE_EVIDENCE_NORMALIZER_VERSION)
    expect(result.source_runtime).toBe('python')
    expect(result.trace.trace_kind).toBe('viewer_request')
    expect(result.trace.memory.memory_ids).toEqual(['memory-1'])
    expect(result.trace.side_effects?.published_barrage_id).toBe('barrage-1')
  })

  test('redacts AI prompt/response text and endpoint query credentials', () => {
    const result = normalizeAiCallTrace({
      call_id: 'call-1',
      correlation_id: 'generation-1',
      role: 'viewer',
      status: 'succeeded',
      provider: 'openai-compatible',
      model_id: 'viewer-v1',
      endpoint: 'https://provider.example/v1/chat?api_key=secret',
      started_at_ms: 100,
      updated_at_ms: 120,
      completed_at_ms: 120,
      duration_ms: 20,
      request: {
        input_preview: {
          prompt: 'do not persist this prompt',
          input_sha256: 'a'.repeat(64),
          input_bytes: 42
        },
        redacted_fields: ['prompt']
      },
      response: {
        model_output: 'do not persist this output',
        parsed_output: { action: 'silence' },
        total_tokens: 12
      },
      redacted: true
    })

    expect(result.trace.endpoint).toBe('https://provider.example/v1/chat')
    expect(result.trace.request?.input_preview).toMatchObject({ prompt: '[REDACTED]' })
    expect(result.trace.response?.model_output).toBeNull()
    expect(result.trace.response?.parsed_output).toEqual({ action: 'silence' })
    expect(result.trace.response?.total_tokens).toBe(12)
  })

  test('produces bounded input metadata with a stable digest', () => {
    const metadata = inputMetadata('viewer', 'hello', {
      text_part_count: 1,
      image_part_count: 0
    })

    expect(metadata).toMatchObject({
      category: 'viewer',
      input_bytes: 5,
      input_sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'
    })
    expect(metadata.redacted_fields).toContain('input_text')
  })
})

function viewerTraceFixture() {
  return {
    trace_kind: 'viewer_request' as const,
    trace_schema_version: 1 as const,
    trace_id: 'trace-1',
    room_id: 'room-1',
    session_id: 'session-1',
    audience_epoch: 1,
    config_hash: 'b'.repeat(64),
    observation_id: 'observation-1',
    decision: {
      decision_id: 'decision-1',
      room_id: 'room-1',
      session_id: 'session-1',
      audience_epoch: 1,
      observation_id: 'observation-1',
      decision_source: 'fallback' as const,
      reason_codes: ['direct_mention'],
      created_at_ms: 100,
      expires_at_ms: 1_000
    },
    viewer_instance_id: 'viewer-1',
    viewer_sequence: 1,
    persona_revision: 1,
    instance_variant: {
      expression_length: 0.5,
      skepticism: 0.2,
      encouragement: 0.8,
      meme_affinity: 0.4,
      focus: 'chat',
      silence_tendency: 0.1
    },
    memory: { room_id: 'room-1', memory_revision: 2, memory_ids: ['memory-1'] },
    frame_hashes: ['c'.repeat(64)],
    prompt_manifest: {
      template_id: 'viewer-template',
      template_revision: 1,
      input_hash: 'd'.repeat(64),
      sections: ['context']
    },
    provider: {
      provider_role: 'viewer',
      model_id: 'viewer-v1',
      queued_at_ms: 100,
      dispatched_at_ms: 110,
      completed_at_ms: 120
    },
    response_status: 'published' as const,
    validation: { accepted: true, codes: ['schema_valid'] },
    side_effects: { published_barrage_id: 'barrage-1' },
    output_delivery: {
      ready_at_ms: 120,
      scheduled_at_ms: 120,
      published_at_ms: 120,
      queue_delay_ms: 0,
      event_count: 1,
      published_event_count: 1,
      interruption_reason: null
    }
  }
}
