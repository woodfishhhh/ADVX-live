import { describe, expect, test } from 'bun:test'

import {
  createModelRequestBudget,
  monotonicDeadline,
  providerRevision,
  wallClockTimestampMs,
  type AsrProviderEvent,
  type AsrRequest,
  type ModelGenerationRequest,
  type ModelStreamEvent,
  type ProviderCallContext,
  type ProviderIdentity,
  type ProviderRoleModel
} from '../application/ports'
import {
  DeterministicAsrProvider,
  DeterministicModelProvider
} from './fake/deterministic-providers'
import {
  RecordedAsrProvider,
  RecordedModelProvider,
  type RecordedAsrFixture,
  type RecordedModelFixture
} from './recorded/recorded-providers'

const asrIdentity: ProviderIdentity<'asr'> = {
  kind: 'asr',
  providerProfileId: 'asr-test-profile',
  providerRevision: providerRevision('asr-test-revision')
}

const modelIdentity: ProviderIdentity<'model'> = {
  kind: 'model',
  providerProfileId: 'model-test-profile',
  providerRevision: providerRevision('model-test-revision')
}

const asrRoleModel: ProviderRoleModel<'asr'> = {
  role: 'asr',
  modelId: 'asr-test-model'
}

const modelRequestRole: ProviderRoleModel<'viewer'> = {
  role: 'viewer',
  modelId: 'viewer-test-model'
}

describe('AGT-014 deterministic and recorded Provider adapters', () => {
  test('deterministic ASR emits a stable transcript and exposes fake evidence', async () => {
    const delays: number[] = []
    const provider = new DeterministicAsrProvider({
      provider: asrIdentity,
      roleModel: asrRoleModel,
      plan: { text: 'deterministic transcript', utteranceId: 'utterance-1' },
      controls: {
        latencyMs: 25,
        sleep: async (delayMs) => { delays.push(delayMs) },
        monotonicNow: () => 10
      }
    })

    const events = await collectAsr(provider.transcribe(asrRequest('asr-1'), callContext()))
    expect(provider.evidence).toEqual({
      evidenceClass: 'fake',
      source: 'deterministic',
      adapterId: 'advx-deterministic-asr-v1',
      sanitized: true,
      liveFallback: false
    })
    expect(delays).toEqual([25])
    expect(events).toMatchObject([
      {
        type: 'transcript',
        transcript: {
          requestId: 'asr-1',
          text: 'deterministic transcript',
          final: true,
          utteranceId: 'utterance-1'
        }
      }
    ])
  })

  test('deterministic model supports generation, streaming, errors, and aborts', async () => {
    const provider = new DeterministicModelProvider({
      provider: modelIdentity,
      plan: (request) => request.requestId === 'abort'
        ? { abort: true }
        : request.requestId === 'error'
          ? {
              failure: {
                code: 'provider_unavailable',
                source: 'provider',
                retryable: true
              }
            }
        : {
            text: 'hello world',
            deltas: ['hello', ' world'],
            usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 }
          }
    })

    const generated = await provider.generate(
      modelRequest('generate'),
      callContext(),
      createModelRequestBudget()
    )
    expect(generated).toMatchObject({
      ok: true,
      value: {
        output: { type: 'text', text: 'hello world' },
        usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 }
      }
    })

    const streamed = await collectModel(
      provider.stream(modelRequest('stream'), callContext(), createModelRequestBudget())
    )
    expect(streamed).toMatchObject([
      { type: 'started', requestId: 'stream' },
      { type: 'text_delta', textDelta: 'hello' },
      { type: 'text_delta', textDelta: ' world' },
      { type: 'completed', result: { output: { text: 'hello world' } } }
    ])

    const aborted = await provider.generate(
      modelRequest('abort'),
      callContext(),
      createModelRequestBudget()
    )
    expect(aborted).toMatchObject({
      ok: false,
      error: { code: 'aborted', source: 'caller' }
    })
    const failed = await provider.generate(
      modelRequest('error'),
      callContext(),
      createModelRequestBudget()
    )
    expect(failed).toMatchObject({
      ok: false,
      error: { code: 'provider_unavailable', retryable: true }
    })
    expect(provider.evidence.evidenceClass).toBe('fake')
  })

  test('recorded adapters replay sanitized ASR/SSE data without live fallback', async () => {
    const asrFixture: RecordedAsrFixture = {
      recordingId: 'recording-asr-1',
      sanitized: true,
      events: [
        { requestId: 'recorded-asr', text: 'recorded transcript', final: true }
      ]
    }
    const asr = new RecordedAsrProvider({
      provider: asrIdentity,
      roleModel: asrRoleModel,
      fixture: asrFixture
    })
    const asrEvents = await collectAsr(
      asr.transcribe(asrRequest('recorded-asr'), callContext())
    )
    expect(asr.evidence).toMatchObject({
      evidenceClass: 'recorded',
      source: 'recorded_sse',
      recordingId: 'recording-asr-1',
      sanitized: true,
      liveFallback: false
    })
    expect(asrEvents).toMatchObject([
      { type: 'transcript', transcript: { text: 'recorded transcript' } }
    ])

    const modelFixture: RecordedModelFixture = {
      recordingId: 'recording-model-1',
      sanitized: true,
      responses: [
        {
          requestId: 'recorded-model',
          text: 'recorded model response',
          deltas: ['recorded ', 'model response']
        }
      ]
    }
    const model = new RecordedModelProvider({
      provider: modelIdentity,
      fixture: modelFixture
    })
    const modelEvents = await collectModel(
      model.stream(
        modelRequest('recorded-model'),
        callContext(),
        createModelRequestBudget()
      )
    )
    expect(model.evidence).toMatchObject({
      evidenceClass: 'recorded',
      source: 'recorded_sse',
      recordingId: 'recording-model-1',
      sanitized: true,
      liveFallback: false
    })
    expect(modelEvents).toHaveLength(4)
    expect(modelEvents.slice(1)).toMatchObject([
      { type: 'text_delta', textDelta: 'recorded ' },
      { type: 'text_delta', textDelta: 'model response' },
      { type: 'completed', result: { output: { text: 'recorded model response' } } }
    ])

    const missing = await model.generate(
      modelRequest('missing'),
      callContext(),
      createModelRequestBudget()
    )
    expect(missing).toMatchObject({
      ok: false,
      error: { code: 'provider_error', source: 'advx' }
    })
  })

  test('adapters fail closed on caller abort and expired deadline', async () => {
    const controller = new AbortController()
    controller.abort()
    const provider = new DeterministicModelProvider({
      provider: modelIdentity,
      plan: { text: 'never emitted' }
    })
    const aborted = await provider.generate(
      modelRequest('caller-abort'),
      callContext(controller.signal),
      createModelRequestBudget()
    )
    expect(aborted).toMatchObject({ ok: false, error: { code: 'aborted' } })

    const expired = await provider.generate(
      modelRequest('deadline'),
      callContext(new AbortController().signal, 10),
      createModelRequestBudget()
    )
    expect(expired).toMatchObject({ ok: false, error: { code: 'timeout' } })
  })
})

async function collectAsr(iterable: AsyncIterable<AsrProviderEvent>): Promise<AsrProviderEvent[]> {
  const events: AsrProviderEvent[] = []
  for await (const event of iterable) events.push(event)
  return events
}

async function collectModel(iterable: AsyncIterable<ModelStreamEvent>): Promise<ModelStreamEvent[]> {
  const events: ModelStreamEvent[] = []
  for await (const event of iterable) events.push(event)
  return events
}

function asrRequest(requestId: string): AsrRequest {
  return {
    requestId,
    provider: asrIdentity,
    roleModel: asrRoleModel,
    sessionId: 'session-agt-014' as AsrRequest['sessionId'],
    source: 'microphone',
    startedAt: wallClockTimestampMs(100),
    endedAt: wallClockTimestampMs(200),
    format: { sampleRateHz: 16_000, channels: 1, sampleWidthBits: 16 },
    pcm: new Uint8Array([1, 2, 3])
  }
}

function modelRequest(requestId: string): ModelGenerationRequest {
  return {
    requestId,
    provider: modelIdentity,
    roleModel: modelRequestRole,
    purpose: 'viewer',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    output: { type: 'text' },
    stream: true,
    protocolRepairAttempt: 0
  }
}

function callContext(
  signal = new AbortController().signal,
  expiresAt = 60_000
): ProviderCallContext {
  return {
    callerSignal: signal,
    deadline: monotonicDeadline(expiresAt),
    cancellationReason: () => signal.aborted
      ? { code: 'caller_cancelled' }
      : undefined
  }
}
