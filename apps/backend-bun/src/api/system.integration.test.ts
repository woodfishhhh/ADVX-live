import { afterEach, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  healthResponseSchema,
  normalizedErrorSchema
} from '@advx/contracts'

import { BackendStartupError } from '../infrastructure'
import { startProcessApp, type RunningProcessApp } from '../main'

const TOKEN_A = 'A'.repeat(43)
const TOKEN_B = 'B'.repeat(43)
const RAW_EXCEPTION = 'D:/private/runtime.sqlite provider-secret-model'
const liveApps = new Set<RunningProcessApp>()
const temporaryDirectories = new Set<string>()

afterEach(async () => {
  for (const app of liveApps) await app.stop()
  liveApps.clear()
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true })
  }
  temporaryDirectories.clear()
})

describe('BCK-003 loopback authentication and system probes', () => {
  test('serves authenticated health, readiness, and version with safe request IDs', async () => {
    const port = availablePort()
    const channel = tokenChannel(TOKEN_A)
    let readiness: 'ready' | 'throw' = 'ready'
    const app = await startProcessApp(environment(port, channel.fileDescriptor), {
      readiness: () => {
        if (readiness === 'throw') throw new Error(RAW_EXCEPTION)
        return { contract: true, database: true, runtime: true }
      },
      buildId: 'bck-003-test-build'
    })
    liveApps.add(app)

    expect(app.server).toEqual({ hostname: '127.0.0.1', port })
    expect(app.isAuthenticationActive()).toBe(true)

    const missing = await fetch(endpoint(port, '/health'))
    expect(missing.status).toBe(401)
    expect(normalizedErrorSchema.parse(await missing.json())).toEqual({
      code: 'invalid_local_token',
      retryable: false,
      safe_detail: 'A valid local bearer token is required.'
    })
    expect(missing.headers.get('www-authenticate')).toBe('Bearer')
    expect(missing.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)

    const malformed = await fetch(endpoint(port, '/health'), {
      headers: { authorization: `Basic ${TOKEN_A}` }
    })
    expect(malformed.status).toBe(401)

    const health = await authorizedFetch(port, '/health', TOKEN_A, {
      'x-request-id': 'desktop-main:request-1',
      'x-advx-trace-id': 'trace-http-health'
    })
    expect(health.status).toBe(200)
    expect(health.headers.get('x-request-id')).toBe('desktop-main:request-1')
    expect(health.headers.get('x-advx-trace-id')).toBe('trace-http-health')
    expect(healthResponseSchema.parse(await health.json())).toEqual({
      status: 'ok',
      protocol_version: 3
    })

    const ready = await authorizedFetch(port, '/ready', TOKEN_A)
    expect(ready.status).toBe(200)
    expect(await ready.json()).toEqual({
      status: 'ready',
      protocol_version: 3,
      checks: { contract: true, database: true, runtime: true }
    })

    const version = await authorizedFetch(port, '/version', TOKEN_A)
    expect(version.status).toBe(200)
    expect(await version.json()).toEqual({
      backend_version: '0.1.0',
      http_protocol_version: 3,
      realtime_protocol_version: 4,
      schema_package_version: 1,
      build_id: 'bck-003-test-build'
    })

    readiness = 'throw'
    const unavailable = await authorizedFetch(port, '/ready', TOKEN_A)
    expect(unavailable.status).toBe(503)
    const unavailableText = await unavailable.text()
    expect(JSON.parse(unavailableText)).toEqual({
      status: 'not_ready',
      protocol_version: 3,
      checks: { contract: false, database: false, runtime: false }
    })
    for (const forbidden of [TOKEN_A, RAW_EXCEPTION, 'provider-secret-model']) {
      expect(unavailableText).not.toContain(forbidden)
    }

    await app.stop()
    liveApps.delete(app)
    expect(app.isAuthenticationActive()).toBe(false)
    expect(canBind(port)).toBe(true)
  })

  test('reports exact persistence failures as safe degraded health', async () => {
    const cases: Array<{
      code: string
      detail: Record<string, string>
    }> = [
      { code: 'sqlite_migration_failed', detail: {} },
      { code: 'sqlite_validation_failed', detail: { backup_path: '' } },
      { code: 'sqlite_recovery_failed', detail: {} }
    ]
    let selected = cases[0]!
    const port = availablePort()
    const channel = tokenChannel(TOKEN_A)
    const app = await startProcessApp(environment(port, channel.fileDescriptor), {
      health: () => ({
        status: 'degraded',
        persistenceError: { code: selected.code, ...selected.detail }
      })
    })
    liveApps.add(app)

    for (const { code, detail } of cases) {
      selected = { code, detail }
      const response = await authorizedFetch(port, '/health', TOKEN_A)
      expect(response.status).toBe(200)
      const text = await response.text()
      expect(healthResponseSchema.parse(JSON.parse(text))).toEqual({
        status: 'degraded',
        protocol_version: 3,
        persistence_error: { code, ...detail }
      })
      expect(text).not.toContain(RAW_EXCEPTION)
    }
  })

  test('rejects stale and cross-start credentials after a clean restart', async () => {
    const port = availablePort()
    const firstChannel = tokenChannel(TOKEN_A)
    const first = await startProcessApp(environment(port, firstChannel.fileDescriptor))
    liveApps.add(first)
    expect((await authorizedFetch(port, '/health', TOKEN_A)).status).toBe(200)
    await first.stop()
    liveApps.delete(first)

    const secondChannel = tokenChannel(TOKEN_B)
    const second = await startProcessApp(environment(port, secondChannel.fileDescriptor))
    liveApps.add(second)
    expect((await authorizedFetch(port, '/health', TOKEN_A)).status).toBe(401)
    expect((await authorizedFetch(port, '/health', TOKEN_B)).status).toBe(200)
  })

  test('fails safely before listen when the inherited token is malformed', async () => {
    const port = availablePort()
    const invalid = 'D:/secret/token.txt invalid-token'
    const channel = tokenChannel(invalid)

    let startupError: unknown
    try {
      await startProcessApp(environment(port, channel.fileDescriptor))
    } catch (error) {
      startupError = error
    }

    expect(startupError).toBeInstanceOf(BackendStartupError)
    expect((startupError as BackendStartupError).code).toBe(
      'startup_token_malformed'
    )
    expect(JSON.stringify(startupError)).not.toContain(invalid)
    expect(() => readFileSync(channel.fileDescriptor)).toThrow()
    expect(canBind(port)).toBe(true)
  })

  test('normalizes a listener collision without leaking the startup token', async () => {
    const port = availablePort()
    const occupied = Bun.serve({
      hostname: '127.0.0.1',
      port,
      fetch: () => new Response('occupied')
    })
    const channel = tokenChannel(TOKEN_A)

    try {
      let startupError: unknown
      try {
        await startProcessApp(environment(port, channel.fileDescriptor))
      } catch (error) {
        startupError = error
      }
      expect(startupError).toBeInstanceOf(BackendStartupError)
      expect((startupError as BackendStartupError).code).toBe('listen_failed')
      expect(JSON.stringify(startupError)).not.toContain(TOKEN_A)
      expect(await (await fetch(endpoint(port, '/'))).text()).toBe('occupied')
    } finally {
      occupied.stop(true)
    }
  })

  test('starts the real process entry with token only on an inherited pipe', async () => {
    const port = availablePort()
    const inheritedEnvironment = Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/_API_KEY$/i.test(key) && key !== 'ADVX_LOCAL_TOKEN'
      )
    )
    const child = spawn(process.execPath, [join(import.meta.dir, '../main.ts')], {
      cwd: join(import.meta.dir, '../../'),
      env: {
        ...inheritedEnvironment,
        ADVX_BACKEND_MODE: 'production',
        ADVX_BACKEND_HOST: '127.0.0.1',
        ADVX_BACKEND_PORT: String(port)
      },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    child.stdout?.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr?.on('data', (chunk: Buffer) => stderr.push(chunk))

    try {
      const tokenPipe = child.stdin
      if (tokenPipe === null) {
        throw new Error('Inherited startup token pipe was not created')
      }
      tokenPipe.write(TOKEN_A)
      tokenPipe.end()

      const response = await waitForHealth(port, TOKEN_A)
      expect(response.status).toBe(200)
      expect(healthResponseSchema.parse(await response.json()).status).toBe('ok')
      expect(child.spawnargs.join(' ')).not.toContain(TOKEN_A)
      expect(child.spawnargs.join(' ')).not.toContain('ADVX_LOCAL_TOKEN')
    } finally {
      child.kill()
      if (child.exitCode === null) await once(child, 'exit')
    }

    const processOutput = Buffer.concat([...stdout, ...stderr]).toString('utf8')
    expect(processOutput).not.toContain(TOKEN_A)
    expect(canBind(port)).toBe(true)
  }, 10_000)
})

function environment(port: number, fileDescriptor: number) {
  return {
    ADVX_BACKEND_MODE: 'production',
    ADVX_BACKEND_HOST: '127.0.0.1',
    ADVX_BACKEND_PORT: String(port),
    ADVX_DATA_DIR: 'D:/private/advx-data',
    ADVX_STARTUP_TOKEN_FD: String(fileDescriptor),
    ADVX_PROVIDER_PROFILES_JSON: JSON.stringify([
      {
        id: 'private-provider',
        baseUrl: 'https://provider.invalid/v1',
        model: 'provider-secret-model',
        credentialRef: 'safeStorage:provider-1'
      }
    ])
  }
}

function tokenChannel(token: string) {
  const directory = mkdtempSync(join(tmpdir(), 'advx-bck-003-'))
  temporaryDirectories.add(directory)
  const path = join(directory, 'startup-token')
  writeFileSync(path, token, 'utf8')
  return { fileDescriptor: openSync(path, 'r') }
}

function availablePort(): number {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('reserved')
  })
  const port = server.port
  if (port === undefined) throw new Error('Bun did not assign a probe port')
  server.stop(true)
  return port
}

function canBind(port: number): boolean {
  try {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port,
      fetch: () => new Response('probe')
    })
    server.stop(true)
    return true
  } catch {
    return false
  }
}

function endpoint(port: number, path: string): string {
  return `http://127.0.0.1:${port}${path}`
}

function authorizedFetch(
  port: number,
  path: string,
  token: string,
  headers: Record<string, string> = {}
) {
  return fetch(endpoint(port, path), {
    headers: { ...headers, authorization: `Bearer ${token}` }
  })
}

async function waitForHealth(port: number, token: string): Promise<Response> {
  const deadline = Date.now() + 5_000
  while (Date.now() < deadline) {
    try {
      const response = await authorizedFetch(port, '/health', token)
      if (response.status === 200) return response
    } catch {
      // The child has not reached listen yet.
    }
    await Bun.sleep(25)
  }
  throw new Error('Process entry did not begin serving health before the deadline')
}
