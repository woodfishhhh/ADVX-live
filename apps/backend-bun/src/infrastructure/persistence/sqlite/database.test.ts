import { afterEach, describe, expect, test } from 'bun:test'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import type { BackendProcessPublication } from '../../../main'
import {
  ADVX_SQLITE_BUSY_TIMEOUT_MS,
  ADVX_SQLITE_DATABASE_FILENAME,
  AdvxSqliteDatabase,
  AdvxSqliteDatabaseError
} from './database'
import { createTemporaryAdvxSqliteDatabase } from './database-fixture'

const TOKEN = 'D'.repeat(43)
const temporaryDirectories = new Set<string>()
const liveChildren = new Set<ChildProcess>()

afterEach(async () => {
  for (const child of liveChildren) {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    if (child.exitCode === null && child.signalCode === null) {
      await withTimeout(once(child, 'exit'), 'child cleanup')
    }
  }
  liveChildren.clear()
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true })
  }
  temporaryDirectories.clear()
})

describe('DAT-003 SQLite connection and data directory', () => {
  test('owns one writable WAL connection, checkpoints, and reopens cleanly', () => {
    const dataDirectory = temporaryDirectory('advx-dat-003-reopen-')
    const database = new AdvxSqliteDatabase({ dataDirectory })
    database.initialize()

    expect(database.health()).toEqual({
      status: 'ready',
      ready: true,
      writableOwnerHeld: true,
      journalMode: 'wal',
      busyTimeoutMs: ADVX_SQLITE_BUSY_TIMEOUT_MS,
      foreignKeys: true,
      synchronous: 'normal',
      quickCheck: 'ok',
      failureCode: null
    })
    expect(database.path).toBe(join(dataDirectory, ADVX_SQLITE_DATABASE_FILENAME))
    expect(existsSync(database.path)).toBe(true)
    if (process.platform !== 'win32') {
      expect(statSync(dataDirectory).mode & 0o777).toBe(0o700)
      expect(statSync(database.path).mode & 0o777).toBe(0o600)
    }

    database.withWriteConnection((connection) => {
      connection.exec(`
        CREATE TABLE dat_003_probe (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO dat_003_probe (value) VALUES ('persisted');
      `)
    })
    expect(
      database.withReadConnection((connection) =>
        connection.query('SELECT value FROM dat_003_probe').get()
      )
    ).toEqual({ value: 'persisted' })

    const competingOwner = new AdvxSqliteDatabase({ dataDirectory })
    expectSqliteError(() => competingOwner.initialize(), 'writable_owner_exists')

    database.flush()
    expect(database.lastCheckpoint?.busy).toBe(0)
    database.close()
    expectSqliteError(
      () => database.withReadConnection(() => null),
      'database_not_ready'
    )

    const reopened = new AdvxSqliteDatabase({ dataDirectory })
    reopened.initialize()
    expect(
      reopened.withReadConnection((connection) =>
        connection.query('SELECT value FROM dat_003_probe').get()
      )
    ).toEqual({ value: 'persisted' })
    reopened.close()
  })

  test('rejects relative, packaged-resource, and ASAR data locations clearly', () => {
    expectSqliteError(
      () => new AdvxSqliteDatabase({ dataDirectory: '.advx-data' }),
      'invalid_data_directory'
    )
    const root = temporaryDirectory('advx-dat-003-location-')
    expectSqliteError(
      () => new AdvxSqliteDatabase({ dataDirectory: join(root, 'resources', 'data') }),
      'invalid_data_directory'
    )
    expectSqliteError(
      () => new AdvxSqliteDatabase({ dataDirectory: join(root, 'app.asar', 'data') }),
      'invalid_data_directory'
    )
    expect(existsSync(join(root, 'resources'))).toBe(false)
    expect(existsSync(join(root, 'app.asar'))).toBe(false)
  })

  test('provides an isolated fixture with idempotent cleanup', () => {
    const fixture = createTemporaryAdvxSqliteDatabase('advx-dat-003-fixture-')
    expect(fixture.database.isReady()).toBe(true)
    expect(existsSync(fixture.database.path)).toBe(true)
    fixture.cleanup()
    fixture.cleanup()
    expect(existsSync(fixture.dataDirectory)).toBe(false)
  })

  test('boots the real process with database readiness and releases it on stop', async () => {
    const port = availablePort()
    const dataDirectory = temporaryDirectory('advx-dat-003-process-')
    const child = spawn(
      process.execPath,
      [resolve(import.meta.dir, '../../../main.ts')],
      {
        cwd: resolve(import.meta.dir, '../../../..'),
        env: childEnvironment(port, dataDirectory),
        stdio: ['pipe', 'pipe', 'pipe', 'ipc']
      }
    )
    liveChildren.add(child)
    if (child.stdin === null || child.stdout === null || child.stderr === null) {
      throw new Error('real process pipes were not created')
    }
    const stdout = lineCollector(child.stdout)
    const stderr: Buffer[] = []
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.stdin.end(TOKEN)

    const ready = await stdout.next('advx.backend.ready')
    expect(ready).toMatchObject({ pid: child.pid, port })
    const readiness = await authorizedFetch(port, '/ready')
    expect(readiness.status).toBe(200)
    expect(await readiness.json()).toMatchObject({
      status: 'ready',
      checks: { contract: true, database: true, runtime: true }
    })

    expect(child.send({ type: 'advx.backend.shutdown', reason: 'requested' })).toBe(true)
    expect(await stdout.next('advx.backend.stopped')).toMatchObject({
      reason: 'requested',
      exit_code: 0,
      forced: false,
      cleanup_failures: []
    })
    if (child.exitCode === null) {
      await withTimeout(once(child, 'exit'), 'real process exit')
    }
    liveChildren.delete(child)
    expect(child.exitCode).toBe(0)
    expect(canBind(port)).toBe(true)

    const reopened = new AdvxSqliteDatabase({ dataDirectory })
    reopened.initialize()
    expect(reopened.health()).toMatchObject({ ready: true, quickCheck: 'ok' })
    reopened.close()

    const output = `${stdout.text()}${Buffer.concat(stderr).toString('utf8')}`
    expect(output).not.toContain(TOKEN)
    expect(output).not.toContain(dataDirectory)
  }, 15_000)
})

function expectSqliteError(
  operation: () => unknown,
  code: AdvxSqliteDatabaseError['code']
): void {
  try {
    operation()
  } catch (error) {
    expect(error).toBeInstanceOf(AdvxSqliteDatabaseError)
    expect((error as AdvxSqliteDatabaseError).code).toBe(code)
    return
  }
  throw new Error(`expected SQLite error ${code}`)
}

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  temporaryDirectories.add(directory)
  return directory
}

function childEnvironment(port: number, dataDirectory: string) {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        ([key]) => !/_API_KEY$/i.test(key) && key !== 'ADVX_LOCAL_TOKEN'
      )
    ),
    ADVX_BACKEND_MODE: 'production',
    ADVX_BACKEND_HOST: '127.0.0.1',
    ADVX_BACKEND_PORT: String(port),
    ADVX_DATA_DIR: dataDirectory,
    ADVX_STARTUP_TOKEN_FD: '0'
  }
}

function authorizedFetch(port: number, path: string) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { authorization: `Bearer ${TOKEN}` }
  })
}

function lineCollector(stream: NodeJS.ReadableStream) {
  const chunks: Buffer[] = []
  const events: BackendProcessPublication[] = []
  const waiters = new Map<
    BackendProcessPublication['type'],
    Array<(event: BackendProcessPublication) => void>
  >()
  let pending = ''
  stream.on('data', (chunk: Buffer) => {
    chunks.push(chunk)
    pending += chunk.toString('utf8')
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) {
      if (!line) continue
      const event = JSON.parse(line) as BackendProcessPublication
      events.push(event)
      waiters.get(event.type)?.shift()?.(event)
    }
  })
  return {
    next(type: BackendProcessPublication['type']): Promise<BackendProcessPublication> {
      const found = events.find((event) => event.type === type)
      if (found !== undefined) return Promise.resolve(found)
      const event = new Promise<BackendProcessPublication>((resolveEvent) => {
        const typed = waiters.get(type) ?? []
        typed.push(resolveEvent)
        waiters.set(type, typed)
      })
      return withTimeout(event, `process publication ${type}`)
    },
    text: () => Buffer.concat(chunks).toString('utf8')
  }
}

function availablePort(): number {
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: () => new Response('probe')
  })
  const port = server.port
  server.stop(true)
  if (port === undefined) throw new Error('Bun did not assign a port')
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

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    Bun.sleep(8_000).then(() => {
      throw new Error(`${label} timed out`)
    })
  ])
}
