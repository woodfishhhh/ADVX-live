import { describe, expect, test } from 'bun:test'
import { HTTP_OPERATION_COUNT, httpOperations } from '@advx/contracts'
import { createContractDocumentationApp } from './app'
import {
  ADVX_OPENAPI_VERSION,
  createAdvxOpenApiDocument,
  serializeAdvxOpenApiDocument
} from './document'

describe('CON-007 OpenAPI document', () => {
  test('documents all 47 control operations and every declared error', () => {
    const document = createAdvxOpenApiDocument()
    const documentedOperations = Object.values(document.paths).flatMap((path) =>
      Object.values(path)
    )

    expect(document.openapi).toBe(ADVX_OPENAPI_VERSION)
    expect(documentedOperations).toHaveLength(HTTP_OPERATION_COUNT)

    for (const operation of httpOperations) {
      const path = operation.path.replace(
        /:([A-Za-z_][A-Za-z0-9_]*)/g,
        '{$1}'
      )
      const documented = document.paths[path]?.[operation.method.toLowerCase()]
      expect(documented?.operationId).toBe(operation.operationId)
      expect(documented?.security).toEqual(
        operation.path === '/health'
          ? undefined
          : [{ LocalBearerToken: [] }]
      )

      for (const status of Object.keys(operation.responses)) {
        expect(documented?.responses[status]).toBeDefined()
      }
      for (const error of operation.errors) {
        expect(documented?.responses[String(error.status)]?.[
          'x-advx-error-codes'
        ]).toContain(error.code)
      }
    }
  })

  test('publishes only public metadata for controlled secret boundaries', () => {
    const document = createAdvxOpenApiDocument()
    const serialized = serializeAdvxOpenApiDocument(document)
    const secretBoundaryOperations = Object.values(document.paths)
      .flatMap((path) => Object.values(path))
      .filter(
        (operation) =>
          operation.requestBody?.['x-advx-boundary'] ===
          'controlled-secret-boundary'
      )

    expect(secretBoundaryOperations).toHaveLength(2)
    for (const operation of secretBoundaryOperations) {
      expect(operation.requestBody?.['x-advx-serializable-public-contract']).toBe(
        false
      )
      expect(operation.requestBody?.['x-advx-internal-secret-fields']).toEqual([
        'model_api_key',
        'asr_api_key'
      ])
      expect(
        operation.requestBody?.content['application/json'].schema.properties
      ).not.toHaveProperty('model_api_key')
      expect(
        operation.requestBody?.content['application/json'].schema.properties
      ).not.toHaveProperty('asr_api_key')
    }
    expect(serialized).not.toMatch(/"examples?"\s*:/i)
  })

  test('matches the checked-in deterministic snapshot', async () => {
    const snapshot = await Bun.file(
      new URL('../../openapi/advx-control-plane.openapi.json', import.meta.url)
    ).text()
    expect(snapshot).toBe(serializeAdvxOpenApiDocument())
  })
})

describe('CON-007 Scalar exposure', () => {
  test('exposes Scalar and JSON in development', async () => {
    const app = createContractDocumentationApp({ mode: 'development' })
    const [ui, spec] = await Promise.all([
      app.handle(new Request('http://localhost/openapi')),
      app.handle(new Request('http://localhost/openapi/json'))
    ])

    expect(ui.status).toBe(200)
    expect(await ui.text()).toContain('api-reference')
    expect(spec.status).toBe(200)
    expect((await spec.json()).openapi).toBe(ADVX_OPENAPI_VERSION)
  })

  test('keeps production closed unless explicitly enabled', async () => {
    const production = createContractDocumentationApp({ mode: 'production' })
    const enabled = createContractDocumentationApp({
      mode: 'production',
      enableDocumentation: true
    })

    const [closedUi, closedSpec, enabledUi, enabledSpec] = await Promise.all([
      production.handle(new Request('http://localhost/openapi')),
      production.handle(new Request('http://localhost/openapi/json')),
      enabled.handle(new Request('http://localhost/openapi')),
      enabled.handle(new Request('http://localhost/openapi/json'))
    ])

    expect([closedUi.status, closedSpec.status]).toEqual([404, 404])
    expect([enabledUi.status, enabledSpec.status]).toEqual([200, 200])
  })
})
