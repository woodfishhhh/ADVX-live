import { describe, expect, it, vi } from 'vitest'
import { BackendClient } from './backend-client'
import type { BackendControlTransport } from './backend-control-adapter'

function createTransport(backendKind: BackendControlTransport['backendKind']): BackendControlTransport {
  return {
    backendKind,
    request: vi.fn()
  }
}

describe('desktop backend runtime diagnostics', () => {
  it('publishes the selected runtime in the status snapshot', () => {
    const client = new BackendClient({
      localToken: 'token',
      backendRuntime: 'bun-compiled',
      controlTransport: createTransport('bun')
    })

    expect(client.currentStatus().backendRuntime).toBe('bun-compiled')
  })

  it('retains Python diagnostics for an explicit Python transport', () => {
    const client = new BackendClient({
      localToken: 'token',
      controlTransport: createTransport('python')
    })

    expect(client.currentStatus().backendRuntime).toBe('python-oracle')
  })

  it('defaults status diagnostics to the Bun source runtime', () => {
    const client = new BackendClient({ localToken: 'token' })

    expect(client.currentStatus().backendRuntime).toBe('bun-source')
  })
})
