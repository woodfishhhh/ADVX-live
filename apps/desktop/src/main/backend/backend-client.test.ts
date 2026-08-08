import { describe, expect, it, vi } from 'vitest'
import { BackendClient } from './backend-client'
import type { BackendControlTransport } from './backend-control-adapter'

function createTransport(): BackendControlTransport {
  return {
    request: vi.fn()
  }
}

describe('desktop backend runtime diagnostics', () => {
  it('publishes the selected runtime in the status snapshot', () => {
    const client = new BackendClient({
      localToken: 'token',
      backendRuntime: 'bun-compiled',
      controlTransport: createTransport()
    })

    expect(client.currentStatus().backendRuntime).toBe('bun-compiled')
  })

  it('defaults status diagnostics to the Bun source runtime', () => {
    const client = new BackendClient({ localToken: 'token' })

    expect(client.currentStatus().backendRuntime).toBe('bun-source')
  })
})
