import { describe, expect, test } from 'bun:test'

import {
  durationMs,
  createModelRequestBudget,
  monotonicDeadline,
  protocolRepairAttempt,
  providerFailure,
  providerRevision,
  wallClockTimestampMs,
  modelUsage,
  type ModelGenerationRequest,
  type ModelGenerationResult,
  type ModelRequestBudget,
  type ModelProvider,
  type ModelStreamEvent,
  type ProviderCallContext,
  type ProviderCapabilityProbeRequest,
  type ProviderCapabilityProbeResult,
  type ProviderHealthRequest,
  type ProviderHealthResult,
  type ProviderIdentity,
  type ProviderOutcome,
  type ProviderRoleModel
} from './index'

const modelProviderIdentity: ProviderIdentity<'model'> = {
  kind: 'model',
  providerProfileId: 'provider-profile-1',
  providerRevision: providerRevision('provider-revision-7')
}

const viewerRoleModel: ProviderRoleModel<'viewer'> = {
  role: 'viewer',
  modelId: 'viewer-model-1'
}

class FakeModelProvider implements ModelProvider {
  readonly seenContexts: ProviderCallContext[] = []
  lastRequest: ModelGenerationRequest | undefined

  async health(
    request: ProviderHealthRequest,
    context: ProviderCallContext
  ): Promise<ProviderOutcome<ProviderHealthResult>> {
    this.seenContexts.push(context)
    return {
      ok: true,
      value: {
        provider: request.provider,
        status: 'healthy',
        checkedAt: wallClockTimestampMs(20),
        latency: { totalMs: durationMs(2) }
      }
    }
  }

  async probeCapabilities(
    request: ProviderCapabilityProbeRequest,
    context: ProviderCallContext
  ): Promise<ProviderOutcome<ProviderCapabilityProbeResult>> {
    this.seenContexts.push(context)
    return {
      ok: true,
      value: {
        provider: request.provider,
        status: 'passed',
        checkedAt: wallClockTimestampMs(24),
        latency: { totalMs: durationMs(4) },
        discoveredModelIds: ['viewer-model-1'],
        checks: request.capabilities.map((capability) => ({
          capability,
          status: 'passed' as const,
          roleModel: request.roleModels[0]
        }))
      }
    }
  }

  async generate(
    request: ModelGenerationRequest,
    context: ProviderCallContext,
    requestBudget: ModelRequestBudget
  ) {
    this.seenContexts.push(context)
    this.lastRequest = request
    if (!requestBudget.take()) {
      return {
        ok: false,
        error: providerFailure({
          code: 'invalid_request',
          source: 'advx',
          retryable: false
        })
      } as const
    }
    const cancellation = context.cancellationReason()
    if (context.callerSignal.aborted || cancellation !== undefined) {
      const timedOut = cancellation?.code === 'deadline_exceeded'
      return {
        ok: false,
        error: providerFailure({
          code: timedOut ? 'timeout' : 'aborted',
          source: timedOut ? 'advx' : 'caller',
          retryable: timedOut
        })
      } as const
    }
    return {
      ok: true,
      value: resultFor(request)
    } as const
  }

  async *stream(
    request: ModelGenerationRequest,
    context: ProviderCallContext,
    requestBudget: ModelRequestBudget
  ): AsyncIterable<ModelStreamEvent> {
    this.seenContexts.push(context)
    this.lastRequest = request
    if (!requestBudget.take()) {
      yield {
        type: 'failed',
        requestId: request.requestId,
        error: providerFailure({
          code: 'invalid_request',
          source: 'advx',
          retryable: false
        })
      }
      return
    }
    const result = resultFor(request)
    yield {
      type: 'started',
      requestId: request.requestId,
      responseId: result.responseId,
      providerRequestId: result.providerRequestId
    }
    yield {
      type: 'text_delta',
      requestId: request.requestId,
      responseId: result.responseId,
      textDelta: '{"action":"silence"}'
    }
    yield { type: 'completed', result }
  }
}

describe('AGT-001 normalized Provider contract', () => {
  test('binds health and capability results to a provider revision and role model', async () => {
    const fake = new FakeModelProvider()
    const context = callContext(new AbortController().signal)
    const capabilities = [
      'text_generation',
      'image_input',
      'structured_output',
      'streaming'
    ] as const

    const health = await fake.health({ provider: modelProviderIdentity }, context)
    const probe = await fake.probeCapabilities(
      {
        provider: modelProviderIdentity,
        capabilities,
        roleModels: [viewerRoleModel]
      },
      context
    )

    expect(health).toEqual({
      ok: true,
      value: {
        provider: modelProviderIdentity,
        status: 'healthy',
        checkedAt: wallClockTimestampMs(20),
        latency: { totalMs: durationMs(2) }
      }
    })
    expect(probe.ok && probe.value.status).toBe('passed')
    expect(probe.ok && probe.value.checks.map((check) => check.capability)).toEqual(
      [...capabilities]
    )
    expect(probe.ok && probe.value.checks.every((check) => check.roleModel === viewerRoleModel))
      .toBe(true)
  })

  test(
    'carries domain input, structured output, IDs, usage, latency, and repair attempt',
    async () => {
      const fake = new FakeModelProvider()
      const request = structuredRequest()
      const result = await fake.generate(
        request,
        callContext(new AbortController().signal),
        createModelRequestBudget()
      )

      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('expected generation success')
      expect(result.value).toMatchObject({
        requestId: 'generation-1',
        responseId: 'response-generation-1',
        providerRequestId: 'upstream-generation-1',
        provider: modelProviderIdentity,
        roleModel: viewerRoleModel,
        protocolRepairAttempt: 1,
        output: {
          type: 'structured',
          schemaName: 'viewer_generation_v1',
          text: '{"action":"silence"}'
        },
        finishReason: 'stop',
        usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
        latency: { totalMs: 12, timeToFirstTokenMs: 4 }
      })
      expect(fake.lastRequest?.messages[0]?.content[1]).toMatchObject({
        type: 'image',
        mediaType: 'image/png'
      })
      for (const wireKey of ['url', 'headers', 'body', 'choices']) {
        expect(request).not.toHaveProperty(wireKey)
        expect(result.value).not.toHaveProperty(wireKey)
      }

      const events: ModelStreamEvent[] = []
      for await (const event of fake.stream(
        request,
        callContext(new AbortController().signal),
        createModelRequestBudget()
      )) {
        events.push(event)
      }
      expect(events.map((event) => event.type)).toEqual([
        'started',
        'text_delta',
        'completed'
      ])
      expect(events[2]).toEqual({ type: 'completed', result: result.value })
    }
  )

  test('normalizes safe failures without preserving upstream text or wire objects', () => {
    const failure = providerFailure({
      code: 'rate_limited',
      source: 'provider',
      retryable: true,
      httpStatus: 429,
      retryAfterMs: durationMs(1_500),
      providerRequestId: ' upstream-request-1 ',
      rawMessage: 'credential-bearing upstream message'
    } as Parameters<typeof providerFailure>[0] & { rawMessage: string })

    expect(failure).toEqual({
      code: 'rate_limited',
      messageCode: 'provider.rate_limited',
      retryable: true,
      source: 'provider',
      httpStatus: 429,
      retryAfterMs: durationMs(1_500),
      providerRequestId: 'upstream-request-1'
    })
    expect(failure).not.toHaveProperty('rawMessage')
    expect(Object.isFrozen(failure)).toBe(true)
    expect(() =>
      providerFailure({
        code: 'provider_error',
        source: 'provider',
        retryable: false,
        httpStatus: 42
      })
    ).toThrow('provider HTTP status')
  })

  test('uses caller abort and a monotonic deadline without inventing transport state', async () => {
    const fake = new FakeModelProvider()
    const controller = new AbortController()
    controller.abort('superseded')
    const context = callContext(controller.signal)

    const result = await fake.generate(
      structuredRequest(),
      context,
      createModelRequestBudget()
    )

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'aborted',
        messageCode: 'provider.aborted',
        retryable: false,
        source: 'caller'
      }
    })
    expect(fake.seenContexts[0]?.callerSignal).toBe(controller.signal)
    expect(fake.seenContexts[0]?.deadline).toEqual(monotonicDeadline(5_000))

    const deadlineController = new AbortController()
    deadlineController.abort('deadline')
    const timeout = await fake.generate(
      structuredRequest(),
      {
        callerSignal: deadlineController.signal,
        deadline: monotonicDeadline(5_000),
        cancellationReason: () => ({ code: 'deadline_exceeded' })
      },
      createModelRequestBudget()
    )
    expect(timeout).toEqual({
      ok: false,
      error: {
        code: 'timeout',
        messageCode: 'provider.timeout',
        retryable: true,
        source: 'advx'
      }
    })
    expect(() => protocolRepairAttempt(2)).toThrow('protocol repair attempt')
    expect(() => providerRevision('  ')).toThrow('provider revision')
    expect(() => modelUsage({ totalTokens: -1 })).toThrow('total tokens')

    const requestBudget = createModelRequestBudget()
    expect(requestBudget.take()).toBe(true)
    expect(requestBudget.take()).toBe(true)
    expect(requestBudget.take()).toBe(false)
    expect(requestBudget).toMatchObject({
      maximumRequests: 2,
      usedRequests: 2,
      remainingRequests: 0
    })
  })
})

function callContext(signal: AbortSignal): ProviderCallContext {
  return {
    callerSignal: signal,
    deadline: monotonicDeadline(5_000),
    cancellationReason: () =>
      signal.aborted
        ? { code: 'caller_cancelled', messageCode: 'provider.aborted' }
        : undefined
  }
}

function structuredRequest(): ModelGenerationRequest {
  return {
    requestId: 'generation-1',
    provider: modelProviderIdentity,
    roleModel: viewerRoleModel,
    purpose: 'viewer',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'decide independently' },
          {
            type: 'image',
            mediaType: 'image/png',
            bytes: new Uint8Array([1, 2, 3])
          }
        ]
      }
    ],
    output: { type: 'structured', schemaName: 'viewer_generation_v1' },
    stream: true,
    protocolRepairAttempt: protocolRepairAttempt(1),
    maxOutputTokens: 256
  }
}

function resultFor(request: ModelGenerationRequest): ModelGenerationResult {
  const schemaName = request.output.type === 'structured'
    ? request.output.schemaName
    : 'text'
  return {
    requestId: request.requestId,
    responseId: `response-${request.requestId}`,
    providerRequestId: `upstream-${request.requestId}`,
    provider: request.provider,
    roleModel: request.roleModel,
    protocolRepairAttempt: request.protocolRepairAttempt,
    output: {
      type: 'structured',
      schemaName,
      text: '{"action":"silence"}'
    },
    finishReason: 'stop',
    usage: modelUsage({ inputTokens: 10, outputTokens: 4, totalTokens: 14 }),
    latency: {
      totalMs: durationMs(12),
      timeToFirstTokenMs: durationMs(4)
    }
  }
}
