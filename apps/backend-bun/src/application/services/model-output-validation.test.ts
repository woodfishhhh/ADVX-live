import { describe, expect, test } from 'bun:test'
import { VIEWER_GENERATION_SCHEMA_NAME } from '@advx/contracts'

import {
  createModelRequestBudget,
  durationMs,
  modelUsage,
  monotonicDeadline,
  protocolRepairAttempt,
  providerFailure,
  providerRevision,
  type ModelGenerationRequest,
  type ModelGenerationResult,
  type ModelProvider,
  type ModelRequestBudget,
  type ModelStreamEvent,
  type ProviderCallContext,
  type ProviderFailure,
  type ProviderIdentity,
  type ProviderOutcome,
  type ProviderRoleModel
} from '../ports'
import {
  ModelOutputValidationService,
  type ViewerOutputFence
} from './model-output-validation'

const providerIdentity: ProviderIdentity<'model'> = {
  kind: 'model',
  providerProfileId: 'profile-1',
  providerRevision: providerRevision('revision-1')
}
const viewerRoleModel: ProviderRoleModel<'viewer'> = {
  role: 'viewer',
  modelId: 'viewer-model'
}
const fence: ViewerOutputFence = {
  allowedEventIds: ['event-1'],
  frameCount: 1,
  activeViewerIds: ['viewer-2'],
  replyableEventIds: ['reply-1']
}

describe('AGT-004 model output validation and repair', () => {
  test('validates a canonical barrage and derives exact publication texts', async () => {
    const longText = '界'.repeat(161)
    const provider = new ScriptedModelProvider([
      JSON.stringify({
        generation_request_id: 'model-owned-request',
        viewer_instance_id: 'model-owned-viewer',
        viewer_sequence: 999,
        action: 'barrage',
        intent: 'reply_to_viewer',
        target: { kind: 'viewer', viewer_instance_id: 'viewer-2' },
        texts: ['  first  ', longText, 'third'],
        reaction_type: 'comment',
        decision_reason: 'current evidence supports a reply',
        evidence_refs: [
          { source: 'event', event_id: 'event-1', frame_index: 999 },
          { source: 'frame', event_id: 'ignored', frame_index: 0 }
        ]
      })
    ])
    const budget = createModelRequestBudget()
    const result = await service(provider).generateViewer(
      request(), callContext(7_000), budget, fence
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error('expected canonical output')
    expect(result.value.output).toMatchObject({
      action: 'barrage',
      intent: 'reply_to_viewer',
      texts: ['first', longText, 'third'],
      evidence_refs: [
        { source: 'event', event_id: 'event-1', frame_index: null },
        { source: 'frame', event_id: null, frame_index: 0 }
      ]
    })
    expect(result.value.output).not.toHaveProperty('viewer_instance_id')
    expect(result.value.publicationTexts).toEqual([
      'first',
      '界'.repeat(160),
      'third'
    ])
    expect(provider.requests).toHaveLength(1)
    expect(budget).toMatchObject({ usedRequests: 1, remainingRequests: 1 })
  })

  test('accepts the exact silence shape without repair', async () => {
    const provider = new ScriptedModelProvider([validSilence()])
    const result = await service(provider).generateViewer(
      request(), callContext(7_000), createModelRequestBudget(), fence
    )

    expect(result.ok && result.value.output).toEqual({
      action: 'silence',
      intent: 'silence',
      target: null,
      texts: null,
      reaction_type: 'silence',
      decision_reason: 'nothing warrants a response',
      evidence_refs: []
    })
    expect(result.ok && result.value.publicationTexts).toEqual([])
    expect(provider.requests).toHaveLength(1)
  })

  test(
    'uses one schema repair at the six-second boundary without substituting identity',
    async () => {
      const provider = new ScriptedModelProvider([
        JSON.stringify({
          action: 'silence',
          intent: 'react_to_scene',
          target: null,
          texts: null,
          reaction_type: 'comment',
          decision_reason: null,
          evidence_refs: [],
          private_model_value: 'must-not-enter-repair'
        }),
        validSilence()
      ])
      const budget = createModelRequestBudget()
      const result = await service(provider).generateViewer(
        request(), callContext(7_000), budget, fence
      )

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected repaired output')
      expect(result.value.result.protocolRepairAttempt).toBe(1)
      expect(provider.requests).toHaveLength(2)
      expect(provider.requests.map((item) => ({
        requestId: item.requestId,
        provider: item.provider,
        roleModel: item.roleModel,
        purpose: item.purpose,
        protocolRepairAttempt: item.protocolRepairAttempt
      }))).toEqual([
        {
          requestId: 'generation-1',
          provider: providerIdentity,
          roleModel: viewerRoleModel,
          purpose: 'viewer',
          protocolRepairAttempt: 0
        },
        {
          requestId: 'generation-1',
          provider: providerIdentity,
          roleModel: viewerRoleModel,
          purpose: 'viewer',
          protocolRepairAttempt: 1
        }
      ])
      const repairText = provider.requests[1]?.messages.at(-1)?.content[0]
      expect(repairText).toMatchObject({ type: 'text' })
      expect(repairText?.type === 'text' && repairText.text).toContain(
        'Validation codes:'
      )
      expect(repairText?.type === 'text' && repairText.text).not.toContain(
        'must-not-enter-repair'
      )
      expect(budget).toMatchObject({ usedRequests: 2, remainingRequests: 0 })
    }
  )

  test('does not repair with less than six seconds remaining', async () => {
    const provider = new ScriptedModelProvider([invalidSilence()])
    const budget = createModelRequestBudget()
    const result = await service(provider).generateViewer(
      request(), callContext(6_999), budget, fence
    )

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'invalid_response',
        messageCode: 'provider.invalid_response',
        retryable: false,
        source: 'protocol',
        providerRequestId: 'upstream-generation-1-0'
      }
    })
    expect(provider.requests).toHaveLength(1)
    expect(budget).toMatchObject({ usedRequests: 1, remainingRequests: 1 })
  })

  test('stops after one failed repair and never exceeds the shared budget', async () => {
    const provider = new ScriptedModelProvider([invalidSilence(), invalidSilence()])
    const budget = createModelRequestBudget()
    const result = await service(provider).generateViewer(
      request(), callContext(7_000), budget, fence
    )

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatchObject({
      code: 'invalid_response',
      source: 'protocol',
      providerRequestId: 'upstream-generation-1-1'
    })
    expect(provider.requests).toHaveLength(2)
    expect(budget).toMatchObject({ usedRequests: 2, remainingRequests: 0 })

    const preusedProvider = new ScriptedModelProvider([invalidSilence()])
    const preusedBudget = createModelRequestBudget()
    expect(preusedBudget.take()).toBe(true)
    const preused = await service(preusedProvider).generateViewer(
      request(), callContext(7_000), preusedBudget, fence
    )
    expect(preused.ok).toBe(false)
    expect(preusedProvider.requests).toHaveLength(1)
    expect(preusedBudget.usedRequests).toBe(2)
  })

  test('rejects invalid identity and publication fences', async () => {
    const unknownProvider = new ScriptedModelProvider([validSilence()])
    const unknown = await service(unknownProvider).generateViewer(
      request({ output: { type: 'structured', schemaName: 'unknown_v1' } }),
      callContext(7_000),
      createModelRequestBudget(),
      fence
    )
    expect(unknown.ok).toBe(false)
    expect(unknownProvider.requests).toHaveLength(0)

    const identityProvider = new ScriptedModelProvider([
      (generation) => ({ ...resultFor(generation, validSilence()), requestId: 'other' })
    ])
    const identity = await service(identityProvider).generateViewer(
      request(), callContext(7_000), createModelRequestBudget(), fence
    )
    expect(identity.ok).toBe(false)

    const evidenceProvider = new ScriptedModelProvider([
      validBarrage({
        evidence_refs: [{ source: 'event', event_id: 'not-allowed' }]
      })
    ])
    const evidence = await service(evidenceProvider).generateViewer(
      request(), callContext(7_000), createModelRequestBudget(), fence
    )
    expect(evidence.ok).toBe(false)
    expect(evidenceProvider.requests).toHaveLength(1)

    const targetProvider = new ScriptedModelProvider([
      validBarrage({
        target: { kind: 'viewer', viewer_instance_id: 'not-active' }
      })
    ])
    const target = await service(targetProvider).generateViewer(
      request(), callContext(7_000), createModelRequestBudget(), fence
    )
    expect(target.ok).toBe(false)
    expect(targetProvider.requests).toHaveLength(1)
  })

  test('rejects duplicate texts after display truncation', async () => {
    const sharedPrefix = 'a'.repeat(160)
    const provider = new ScriptedModelProvider([
      validBarrage({ texts: [`${sharedPrefix}x`, `${sharedPrefix}y`] })
    ])
    const result = await service(provider).generateViewer(
      request(), callContext(6_999), createModelRequestBudget(), fence
    )

    expect(result.ok).toBe(false)
    expect(provider.requests).toHaveLength(1)
  })

  test('matches Python Unicode code-point and casefold text semantics', async () => {
    const emojiText = '😀'.repeat(3_000)
    const emojiProvider = new ScriptedModelProvider([
      validBarrage({ texts: [emojiText] })
    ])
    const emoji = await service(emojiProvider).generateViewer(
      request(), callContext(6_999), createModelRequestBudget(), fence
    )

    expect(emoji.ok).toBe(true)
    if (!emoji.ok) throw new Error('expected code-point-bounded text')
    expect(Array.from(emoji.value.output.texts?.[0] ?? '')).toHaveLength(3_000)
    expect(Array.from(emoji.value.publicationTexts[0] ?? '')).toHaveLength(160)

    const caseFoldProvider = new ScriptedModelProvider([
      validBarrage({ texts: ['straße', 'STRASSE'] })
    ])
    const caseFold = await service(caseFoldProvider).generateViewer(
      request(), callContext(6_999), createModelRequestBudget(), fence
    )
    expect(caseFold.ok).toBe(false)
    expect(caseFoldProvider.requests).toHaveLength(1)

    const overLimitProvider = new ScriptedModelProvider([
      validBarrage({ texts: ['😀'.repeat(4_001)] })
    ])
    const overLimit = await service(overLimitProvider).generateViewer(
      request(), callContext(6_999), createModelRequestBudget(), fence
    )
    expect(overLimit.ok).toBe(false)
    expect(overLimitProvider.requests).toHaveLength(1)
  })
})

type ScriptedResponse =
  | string
  | ProviderFailure
  | ((request: ModelGenerationRequest) => ModelGenerationResult)

class ScriptedModelProvider implements ModelProvider {
  readonly requests: ModelGenerationRequest[] = []
  readonly #responses: ScriptedResponse[]

  constructor(responses: ScriptedResponse[]) {
    this.#responses = [...responses]
  }

  async health(): Promise<never> {
    throw new Error('health is not used by AGT-004 tests')
  }

  async probeCapabilities(): Promise<never> {
    throw new Error('capability probing is not used by AGT-004 tests')
  }

  async generate(
    generation: ModelGenerationRequest,
    _context: ProviderCallContext,
    budget: ModelRequestBudget
  ): Promise<ProviderOutcome<ModelGenerationResult>> {
    this.requests.push(generation)
    if (!budget.take()) {
      return {
        ok: false,
        error: providerFailure({
          code: 'invalid_request',
          source: 'advx',
          retryable: false
        })
      }
    }
    const response = this.#responses.shift()
    if (response === undefined) throw new Error('missing scripted response')
    if (typeof response === 'function') return { ok: true, value: response(generation) }
    if (typeof response === 'string') {
      return { ok: true, value: resultFor(generation, response) }
    }
    return { ok: false, error: response }
  }

  async *stream(): AsyncIterable<ModelStreamEvent> {}
}

function service(provider: ModelProvider): ModelOutputValidationService {
  return new ModelOutputValidationService(provider, { monotonicNow: () => 1_000 })
}

function request(
  overrides: Partial<ModelGenerationRequest> = {}
): ModelGenerationRequest {
  return {
    requestId: 'generation-1',
    provider: providerIdentity,
    roleModel: viewerRoleModel,
    purpose: 'viewer',
    messages: [
      {
        role: 'user',
        content: [{ type: 'text', text: 'decide independently' }]
      }
    ],
    output: { type: 'structured', schemaName: VIEWER_GENERATION_SCHEMA_NAME },
    stream: false,
    protocolRepairAttempt: protocolRepairAttempt(0),
    maxOutputTokens: 256,
    ...overrides
  }
}

function callContext(expiresAt: number): ProviderCallContext {
  return {
    callerSignal: new AbortController().signal,
    deadline: monotonicDeadline(expiresAt),
    cancellationReason: () => undefined
  }
}

function resultFor(
  generation: ModelGenerationRequest,
  text: string
): ModelGenerationResult {
  return {
    requestId: generation.requestId,
    responseId: `response-${generation.requestId}-${generation.protocolRepairAttempt}`,
    providerRequestId:
      `upstream-${generation.requestId}-${generation.protocolRepairAttempt}`,
    provider: generation.provider,
    roleModel: generation.roleModel,
    protocolRepairAttempt: generation.protocolRepairAttempt,
    output: {
      type: 'structured',
      schemaName: generation.output.type === 'structured'
        ? generation.output.schemaName
        : 'text',
      text
    },
    finishReason: 'stop',
    usage: modelUsage({ inputTokens: 10, outputTokens: 5, totalTokens: 15 }),
    latency: { totalMs: durationMs(10) }
  }
}

function validSilence(): string {
  return JSON.stringify({
    action: 'silence',
    intent: 'silence',
    target: null,
    texts: null,
    reaction_type: 'silence',
    decision_reason: 'nothing warrants a response',
    evidence_refs: []
  })
}

function invalidSilence(): string {
  return JSON.stringify({
    action: 'silence',
    intent: 'react_to_scene',
    target: null,
    texts: null,
    reaction_type: 'comment',
    decision_reason: null,
    evidence_refs: []
  })
}

function validBarrage(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    action: 'barrage',
    intent: 'react_to_scene',
    target: null,
    texts: ['first', 'second', 'third'],
    reaction_type: 'comment',
    decision_reason: 'the scene changed',
    evidence_refs: [],
    ...overrides
  })
}
