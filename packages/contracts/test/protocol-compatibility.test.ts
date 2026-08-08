import { describe, expect, test } from 'bun:test'
import { fileURLToPath } from 'node:url'
import {
  ADVX_PROTOCOL_COMPATIBILITY,
  guardBinaryProtocolVersion,
  guardConnectionIdentity,
  guardPostHandshakeVersion,
  negotiateRealtimeProtocol,
  validateHttpProtocolVersion,
  type ProtocolCompatibilityFailure,
  type ProtocolConnectionContext
} from '../src/compatibility'

const root = fileURLToPath(new URL('../../../', import.meta.url))

function negotiate(input: {
  preferredVersion?: unknown
  supportedVersions?: unknown
  serverSupportedVersions?: readonly number[]
  backendStartId?: unknown
  sessionId?: unknown
  audienceEpoch?: unknown
} = {}): ReturnType<typeof negotiateRealtimeProtocol> {
  return negotiateRealtimeProtocol({
    preferredVersion: 4,
    supportedVersions: [4, 3],
    backendStartId: 'backend-start-1',
    sessionId: 'session-1',
    audienceEpoch: 1,
    ...input
  })
}

function context(input: Parameters<typeof negotiate>[0] = {}): ProtocolConnectionContext {
  const result = negotiate(input)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(`handshake failed with ${result.code}`)
  return result.context
}

function expectFailure(
  result: { readonly ok: boolean },
  expected: Pick<ProtocolCompatibilityFailure, 'code' | 'transport' | 'stage' | 'retryable' | 'rehandshakeRequired'>
): ProtocolCompatibilityFailure {
  expect(result).toMatchObject({ ok: false, ...expected })
  if (result.ok) throw new Error('expected a fail-closed result')
  return result as ProtocolCompatibilityFailure
}

async function pythonNegotiationOracle(): Promise<Record<string, unknown>> {
  const child = Bun.spawn([
    'uv', 'run', '--project', 'apps/backend', 'python',
    'packages/contracts/test/protocol-compatibility-oracle.py'
  ], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, PYTHONUTF8: '1' }
  })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    child.kill()
  }, 10_000)
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ])
  clearTimeout(timeout)
  if (timedOut || exitCode !== 0) {
    throw new Error(`Python negotiation oracle failed (${exitCode}): ${stderr}`)
  }
  return JSON.parse(stdout) as Record<string, unknown>
}

describe('CON-010 protocol compatibility', () => {
  test('current client/current server negotiates realtime v4', () => {
    const result = negotiate()
    expect(result).toMatchObject({ ok: true, negotiatedVersion: 4 })
    if (result.ok) {
      expect(result.context.binaryVersions).toEqual([3])
      expect(Object.isFrozen(result.context)).toBe(true)
    }
  })

  test('supported older client/current server negotiates realtime v3', () => {
    const result = negotiate({ preferredVersion: 3, supportedVersions: undefined })
    expect(result).toMatchObject({ ok: true, negotiatedVersion: 3 })
    if (result.ok) expect(result.context.binaryVersions).toEqual([1, 2])
  })

  test('current client/supported older Python oracle boundary negotiates realtime v3', async () => {
    const oracle = await pythonNegotiationOracle()
    expect(oracle).toEqual({
      current_server_supported: [3, 4],
      current_client_current_server: 4,
      older_client_current_server: 3,
      current_client_older_v3_oracle: 3
    })
    expect(negotiate({ serverSupportedVersions: [3] })).toMatchObject({
      ok: true,
      negotiatedVersion: oracle.current_client_older_v3_oracle
    })
  }, 15_000)

  test('unknown future major version fails closed', () => {
    const failure = expectFailure(
      negotiate({ preferredVersion: 99, supportedVersions: [99] }),
      {
        code: 'unsupported-protocol-version',
        transport: 'realtime',
        stage: 'handshake',
        retryable: false,
        rehandshakeRequired: true
      }
    )
    expect(failure.supportedVersions).toEqual([3, 4])
    expect(failure.receivedVersion).toBe(99)
  })

  test('missing version fails closed', () => {
    const failure = expectFailure(
      negotiate({ preferredVersion: undefined, supportedVersions: undefined }),
      {
        code: 'missing-protocol-version',
        transport: 'realtime',
        stage: 'handshake',
        retryable: false,
        rehandshakeRequired: true
      }
    )
    expect(failure.supportedVersions).toEqual([3, 4])
    expect(failure).not.toHaveProperty('receivedVersion')
  })

  test('post-handshake JSON version differing from negotiated version fails closed', () => {
    const failure = expectFailure(guardPostHandshakeVersion(context(), 3), {
      code: 'post-handshake-version-mismatch',
      transport: 'realtime',
      stage: 'post-handshake',
      retryable: false,
      rehandshakeRequired: true
    })
    expect(failure).toMatchObject({
      supportedVersions: [4],
      receivedVersion: 3,
      negotiatedVersion: 4
    })
  })

  test('binary/realtime mapping accepts v4 with ADVX-BIN/3 and v3 with legacy v1/v2 only', () => {
    const current = context()
    const legacy = context({ preferredVersion: 3, supportedVersions: [3] })
    expect(guardBinaryProtocolVersion(current, 3)).toMatchObject({ ok: true, version: 3 })
    expect(guardBinaryProtocolVersion(legacy, 1)).toMatchObject({ ok: true, version: 1 })
    expect(guardBinaryProtocolVersion(legacy, 2)).toMatchObject({ ok: true, version: 2 })
    expectFailure(guardBinaryProtocolVersion(current, 2), {
      code: 'binary-version-mismatch',
      transport: 'binary',
      stage: 'binary-ingest',
      retryable: true,
      rehandshakeRequired: false
    })
    expectFailure(guardBinaryProtocolVersion(legacy, 3), {
      code: 'binary-version-mismatch',
      transport: 'binary',
      stage: 'binary-ingest',
      retryable: true,
      rehandshakeRequired: false
    })
    expectFailure(guardBinaryProtocolVersion(current, 9), {
      code: 'unsupported-binary-version',
      transport: 'binary',
      stage: 'binary-ingest',
      retryable: true,
      rehandshakeRequired: false
    })
    expectFailure(guardBinaryProtocolVersion(current, undefined), {
      code: 'missing-protocol-version',
      transport: 'binary',
      stage: 'binary-ingest',
      retryable: true,
      rehandshakeRequired: false
    })
  })

  test('reconnect after backend restart rejects the old start identity and accepts a new handshake', () => {
    const oldContext = context()
    expectFailure(guardConnectionIdentity(oldContext, {
      backendStartId: 'backend-start-2',
      startupTokenMatches: true,
      sessionId: 'session-1',
      audienceEpoch: 1
    }), {
      code: 'stale-backend-start',
      transport: 'connection',
      stage: 'connection-identity',
      retryable: true,
      rehandshakeRequired: true
    })
    const newContext = context({ backendStartId: 'backend-start-2' })
    expect(guardConnectionIdentity(newContext, {
      backendStartId: 'backend-start-2',
      startupTokenMatches: true,
      sessionId: 'session-1',
      audienceEpoch: 1
    })).toEqual({ ok: true, transport: 'connection', stage: 'connection-identity' })
  })

  test('stale startup token, Session, and audience_epoch fail with distinct secret-safe codes', () => {
    const active = context()
    const staleToken = expectFailure(guardConnectionIdentity(active, {
      backendStartId: 'backend-start-1',
      startupTokenMatches: false,
      sessionId: 'session-1',
      audienceEpoch: 1
    }), {
      code: 'stale-startup-token',
      transport: 'connection',
      stage: 'connection-identity',
      retryable: true,
      rehandshakeRequired: true
    })
    expectFailure(guardConnectionIdentity(active, {
      backendStartId: 'backend-start-1',
      startupTokenMatches: true,
      sessionId: 'session-stale',
      audienceEpoch: 1
    }), {
      code: 'stale-session',
      transport: 'connection',
      stage: 'connection-identity',
      retryable: true,
      rehandshakeRequired: false
    })
    expectFailure(guardConnectionIdentity(active, {
      backendStartId: 'backend-start-1',
      startupTokenMatches: true,
      sessionId: 'session-1',
      audienceEpoch: 2
    }), {
      code: 'stale-audience-epoch',
      transport: 'connection',
      stage: 'connection-identity',
      retryable: true,
      rehandshakeRequired: false
    })
    expect(JSON.stringify(staleToken)).not.toContain('token-value-canary')
    expect(staleToken).not.toHaveProperty('token')
  })

  test('HTTP v3 remains the only accepted control protocol', () => {
    expect(validateHttpProtocolVersion(3)).toMatchObject({ ok: true, version: 3 })
    expectFailure(validateHttpProtocolVersion(4), {
      code: 'unsupported-protocol-version',
      transport: 'http',
      stage: 'request',
      retryable: false,
      rehandshakeRequired: false
    })
    expect(ADVX_PROTOCOL_COMPATIBILITY).toMatchObject({
      http: { current: 3 },
      realtime: { current: 4, readable: [3, 4] },
      binary: { current: 3, readable: [1, 2, 3] }
    })
  })
})
