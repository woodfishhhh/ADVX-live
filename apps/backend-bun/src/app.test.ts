import { describe, expect, test } from 'bun:test'

import { createApp } from './app'
import { InMemoryBackendProfileReader } from './providers'

describe('BCK-001 application composition', () => {
  test('instantiates with an in-memory fake without listening or spawning Python', async () => {
    const profileReader = new InMemoryBackendProfileReader({
      name: '@advx/backend-bun',
      runtime: 'bun'
    })
    const app = createApp(
      { profileReader },
      { mode: 'development', enableDocumentation: true }
    )

    expect(app.application.describeBackend()).toEqual({
      name: '@advx/backend-bun',
      runtime: 'bun'
    })
    expect(profileReader.readCount).toBe(1)

    const response = await app.api.handle(
      new Request('http://localhost/openapi/json')
    )
    expect(response.status).toBe(200)
    expect((await response.json()) as { openapi: string }).toHaveProperty(
      'openapi',
      '3.1.0'
    )
  })
})
