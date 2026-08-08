import { describe, expect, spyOn, test } from 'bun:test'
import { inspect } from 'node:util'
import { MAX_BINARY_ENVELOPE_BYTES } from '@advx/contracts/binary'

import { createProcessApp } from '../../main'
import {
  BackendConfigError,
  loadBackendConfigFromEnvironment,
  parseBackendConfig
} from './backend-config'

describe('BCK-002 typed backend configuration', () => {
  test('uses closed, bounded production defaults', () => {
    expect(parseBackendConfig()).toEqual({
      process: {
        mode: 'production',
        host: '127.0.0.1',
        port: 8765,
        dataDirectory: '.advx-data'
      },
      startupTokenChannel: {
        kind: 'inherited-fd',
        fileDescriptor: 0,
        encoding: 'utf8',
        oneTime: true
      },
      limits: {
        queueCapacity: 64,
        viewerDeadlineMs: 30_000,
        providerDeadlineMs: 30_000,
        retryMaximum: 1,
        jsonPayloadMaximumBytes: 16_384,
        binaryPayloadMaximumBytes: MAX_BINARY_ENVELOPE_BYTES
      },
      observability: {
        logging: { level: 'info', json: true },
        tracing: { enabled: false, remoteTelemetry: false }
      },
      developmentTools: {
        documentationEnabled: false,
        debugToolsEnabled: false
      },
      providers: []
    })
  })

  test('maps an explicit environment into typed groups', () => {
    const config = loadBackendConfigFromEnvironment({
      ADVX_BACKEND_MODE: 'development',
      ADVX_BACKEND_HOST: '::1',
      ADVX_BACKEND_PORT: '9876',
      ADVX_DATA_DIR: 'D:/temp/advx-data',
      ADVX_STARTUP_TOKEN_FD: '7',
      ADVX_QUEUE_CAPACITY: '32',
      ADVX_VIEWER_DEADLINE_MS: '29000',
      ADVX_PROVIDER_DEADLINE_MS: '28000',
      ADVX_RETRY_MAX: '0',
      ADVX_JSON_PAYLOAD_MAX_BYTES: '32768',
      ADVX_BINARY_PAYLOAD_MAX_BYTES: '2097152',
      ADVX_LOG_LEVEL: 'debug',
      ADVX_LOG_JSON: 'false',
      ADVX_TRACE_ENABLED: 'true',
      ADVX_REMOTE_TELEMETRY: 'false',
      ADVX_DOCS_ENABLED: 'true',
      ADVX_DEBUG_TOOLS_ENABLED: 'true',
      ADVX_PROVIDER_PROFILES_JSON: JSON.stringify([
        {
          id: 'primary',
          baseUrl: 'https://provider.example/v1',
          model: 'public-model-name',
          credentialRef: 'safe-storage:provider-primary'
        }
      ])
    })

    expect(config.process).toEqual({
      mode: 'development',
      host: '::1',
      port: 9876,
      dataDirectory: 'D:/temp/advx-data'
    })
    expect(config.startupTokenChannel.fileDescriptor).toBe(7)
    expect(config.limits).toEqual({
      queueCapacity: 32,
      viewerDeadlineMs: 29_000,
      providerDeadlineMs: 28_000,
      retryMaximum: 0,
      jsonPayloadMaximumBytes: 32_768,
      binaryPayloadMaximumBytes: 2_097_152
    })
    expect(config.observability).toEqual({
      logging: { level: 'debug', json: false },
      tracing: { enabled: true, remoteTelemetry: false }
    })
    expect(config.developmentTools).toEqual({
      documentationEnabled: true,
      debugToolsEnabled: true
    })
    expect(config.providers).toEqual([
      {
        id: 'primary',
        baseUrl: 'https://provider.example/v1',
        model: 'public-model-name',
        credentialRef: 'safe-storage:provider-primary'
      }
    ])
  })

  test('rejects invalid and unknown configuration before any listen attempt', () => {
    const serve = spyOn(Bun, 'serve')

    expect(() => createProcessApp({ ADVX_BACKEND_HOST: '0.0.0.0' })).toThrow(
      BackendConfigError
    )
    expect(() => createProcessApp({ ADVX_BACKEND_PORT: '70000' })).toThrow(
      BackendConfigError
    )
    expect(() => createProcessApp({ ADVX_BACKEND_UNKNOWN: 'ignored?' })).toThrow(
      BackendConfigError
    )
    expect(() => parseBackendConfig({ limits: { retryMaximum: 2 } })).toThrow(
      BackendConfigError
    )
    expect(() => parseBackendConfig({ unexpected: true })).toThrow(
      BackendConfigError
    )
    expect(() =>
      parseBackendConfig({
        providers: [
          {
            id: 'primary',
            baseUrl: 'https://provider.example/v1?api_key=forbidden',
            model: 'model',
            credentialRef: 'not-a-reference'
          }
        ]
      })
    ).toThrow(BackendConfigError)
    expect(serve).not.toHaveBeenCalled()

    serve.mockRestore()
  })

  test('forbids plaintext credentials without exposing their values', () => {
    const canary = 'raw-secret-canary-value'
    const attempts = [
      () => loadBackendConfigFromEnvironment({ ADVX_LOCAL_TOKEN: canary }),
      () => loadBackendConfigFromEnvironment({ OPENAI_API_KEY: canary }),
      () =>
        parseBackendConfig({
          providers: [
            {
              id: 'primary',
              baseUrl: 'https://provider.example/v1',
              model: 'model',
              credentialRef: 'safe-storage:primary',
              apiKey: canary
            }
          ]
        })
    ]

    for (const attempt of attempts) {
      try {
        attempt()
        throw new Error('expected configuration rejection')
      } catch (error) {
        expect(error).toBeInstanceOf(BackendConfigError)
        expect(String(error)).not.toContain(canary)
        expect(inspect(error)).not.toContain(canary)
        expect(JSON.stringify(error)).not.toContain(canary)
      }
    }
  })

  test('keeps production documentation, debug tools, and remote telemetry closed', async () => {
    expect(() =>
      loadBackendConfigFromEnvironment({
        ADVX_BACKEND_MODE: 'production',
        ADVX_DOCS_ENABLED: 'true'
      })
    ).toThrow(BackendConfigError)
    expect(() =>
      loadBackendConfigFromEnvironment({
        ADVX_BACKEND_MODE: 'production',
        ADVX_DEBUG_TOOLS_ENABLED: 'true'
      })
    ).toThrow(BackendConfigError)
    expect(() =>
      loadBackendConfigFromEnvironment({ ADVX_REMOTE_TELEMETRY: 'true' })
    ).toThrow(BackendConfigError)

    const processApp = createProcessApp({})
    const [ui, spec] = await Promise.all([
      processApp.api.handle(new Request('http://localhost/openapi')),
      processApp.api.handle(new Request('http://localhost/openapi/json'))
    ])
    expect([ui.status, spec.status]).toEqual([404, 404])
  })
})
