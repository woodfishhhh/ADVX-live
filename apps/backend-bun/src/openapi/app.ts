import { openapi, type ElysiaOpenAPIConfig } from '@elysiajs/openapi'
import { Elysia } from 'elysia'
import { createAdvxOpenApiDocument } from './document'

export type DocumentationAppOptions = {
  readonly mode: 'development' | 'production'
  readonly enableDocumentation?: boolean
}

export function createContractDocumentationApp(options: DocumentationAppOptions) {
  const enabled =
    options.mode === 'development' || options.enableDocumentation === true
  const documentation =
    createAdvxOpenApiDocument() as unknown as ElysiaOpenAPIConfig['documentation']

  return new Elysia().use(
    openapi({
      enabled,
      path: '/openapi',
      specPath: '/openapi/json',
      provider: 'scalar',
      documentation
    })
  )
}
