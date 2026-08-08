import type { ParityOutput } from './harness'

export function createHealthCandidate(): ParityOutput {
  const health = {
    status: 'ok',
    protocol_version: 3
  }
  return {
    json: {
      health,
      metadata: {
        observation_id: 'typescript-health-fixture',
        observed_at_ms: 1
      }
    },
    binary: new TextEncoder().encode(JSON.stringify(health))
  }
}
