import { describe, expect, test } from 'bun:test'

import type { SessionId } from '@advx/contracts'

import { createApp } from '../app'
import {
  DEFAULT_ASR_BASE_URL,
  DEFAULT_ASR_MODEL,
  parseProviderConfigurationInput
} from '../application'
import {
  createTransientRuntimeControl,
  StaticBackendProfileReader
} from '../infrastructure'
import { RecordedPipelineFixture } from '../infrastructure/recorded-pipeline'

const TOKEN = 't'.repeat(43)

describe('TST-003 Provider configuration parity', () => {
  test('keeps the retained ASR defaults for legacy setup input', () => {
    const parsed = parseProviderConfigurationInput({
      model_base_url: 'https://models.example/v1',
      model_name: 'test-model',
      model_api_key: 'private-model-key',
      asr_api_key: 'private-asr-key'
    })

    expect(parsed.asr_base_url).toBe(DEFAULT_ASR_BASE_URL)
    expect(parsed.asr_model).toBe(DEFAULT_ASR_MODEL)
  })

  test('authenticates idempotent setup and never serializes controlled secrets', async () => {
    const harness = createHarness()
    const missing = await request(harness.api, '/configuration/providers', {
      authorization: null
    })
    const initial = await request(harness.api, '/configuration/providers')
    const configured = await request(harness.api, '/configuration/providers', {
      method: 'PUT',
      body: providerPayload()
    })
    const configuredAgain = await request(harness.api, '/configuration/providers', {
      method: 'PUT',
      body: providerPayload()
    })

    expect(missing.status).toBe(401)
    expect(await initial.json()).toEqual({
      configured: false,
      provider_profile_id: null,
      model_base_url: null,
      model_name: null,
      viewer_model: null,
      memory_model: null,
      visual_summary_model: null,
      asr_base_url: null,
      asr_model: null
    })
    const expected = {
      configured: true,
      provider_profile_id: 'default',
      model_base_url: 'https://models.example/v1',
      model_name: 'test-model',
      viewer_model: 'test-model',
      memory_model: 'test-model',
      visual_summary_model: 'test-model',
      asr_base_url: 'https://speech.example/v1',
      asr_model: 'custom-asr'
    }
    expect(await configured.json()).toEqual(expected)
    expect(await configuredAgain.json()).toEqual(expected)
    const serialized = JSON.stringify({
      status: harness.pipeline.providerStatus(),
      fixture: harness.pipeline.snapshot()
    })
    expect(serialized).not.toContain('private-model-key')
    expect(serialized).not.toContain('private-asr-key')
  })

  test('rejects replacement and configuration while a session is active', async () => {
    const harness = createHarness()
    expect((await request(harness.api, '/configuration/providers', {
      method: 'PUT',
      body: providerPayload()
    })).status).toBe(200)

    const replacement = await request(harness.api, '/configuration/providers', {
      method: 'PUT',
      body: providerPayload({ model_name: 'different-model' })
    })
    expect(replacement.status).toBe(409)
    expect(await replacement.json()).toMatchObject({
      code: 'providers_already_configured'
    })

    harness.pipeline.markSessionStarted('session-active' as SessionId)
    const active = await request(harness.api, '/configuration/providers', {
      method: 'PUT',
      body: providerPayload()
    })
    expect(active.status).toBe(409)
    expect(await active.json()).toMatchObject({ code: 'session_active' })
  })

  test('returns configured role models and a redacted capability result', async () => {
    const harness = createHarness()
    const secrets = ['private-model-key', 'private-asr-key']
    const configured = await request(harness.api, '/configuration/providers', {
      method: 'PUT',
      body: providerPayload({
        provider_profile_id: 'active-profile',
        model_name: 'shared-v1',
        viewer_model: 'viewer-v1',
        memory_model: 'shared-v1',
        visual_summary_model: 'shared-v1'
      })
    })
    const models = await request(harness.api, '/configuration/providers/models')
    const probe = await request(harness.api, '/configuration/providers/probe', {
      method: 'POST',
      body: {}
    })

    expect(await configured.json()).toMatchObject({
      provider_profile_id: 'active-profile',
      viewer_model: 'viewer-v1',
      memory_model: 'shared-v1',
      visual_summary_model: 'shared-v1'
    })
    const modelsBody = await models.json()
    expect(modelsBody).toEqual({
      provider_profile_id: 'active-profile',
      model_ids: ['viewer-v1', 'shared-v1']
    })
    const probeBody = await probe.json()
    expect(probe.status).toBe(200)
    expect(probeBody).toMatchObject({
      provider_profile_id: 'active-profile',
      status: 'passed'
    })
    expect(probeBody.checks.at(-1)).toEqual({
      capability: 'asr_adapter',
      status: 'skipped',
      model_id: 'custom-asr',
      error_code: 'requires_final_audio',
      http_status: null
    })
    const serialized = JSON.stringify({ probeBody, modelsBody })
    for (const secret of secrets) expect(serialized).not.toContain(secret)
  })
})

function createHarness() {
  const pipeline = new RecordedPipelineFixture()
  const app = createApp(
    {
      profileReader: new StaticBackendProfileReader(),
      runtimeControl: createTransientRuntimeControl({ publish: async () => {} })
    },
    {
      mode: 'production',
      recordedPipeline: pipeline,
      system: {
        authorize: (authorization) => authorization === `Bearer ${TOKEN}`,
        readiness: () => ({ contract: true, database: true, runtime: true }),
        backendVersion: 'test',
        buildId: 'tst-003-provider-test'
      }
    }
  )
  return { api: app.api, pipeline }
}

function providerPayload(overrides: Record<string, unknown> = {}) {
  return {
    model_base_url: 'https://models.example/v1',
    model_name: 'test-model',
    model_api_key: 'private-model-key',
    asr_base_url: 'https://speech.example/v1',
    asr_model: 'custom-asr',
    asr_api_key: 'private-asr-key',
    ...overrides
  }
}

async function request(
  api: { handle(request: Request): Response | Promise<Response> },
  path: string,
  options: Readonly<{
    method?: string
    body?: unknown
    authorization?: string | null
  }> = {}
) {
  return api.handle(new Request(`http://localhost${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.authorization === null
        ? {}
        : { authorization: options.authorization ?? `Bearer ${TOKEN}` }),
      'x-advx-protocol-version': '3',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' })
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  }))
}
