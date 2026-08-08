import { afterEach, describe, expect, test } from 'bun:test'
import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import {
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  BACKEND_PROCESS_EXIT_CODES,
  ProcessLifecycleSupervisor,
  type BackendProcessExitCode,
  type BackendProcessHost,
  type BackendProcessSignal,
  type ProcessCleanupStep,
  type ShutdownNotice,
  type TaskScope,
  wallClockTimestampMs
} from './application'
import {
  runBackendProcess,
  startProcessApp,
  type BackendProcessPublication,
  type RunningProcessApp
} from './main'

const TOKEN = 'L'.repeat(43)
const SECRET_FAILURE = 'D:/private/runtime.sqlite provider-secret-value'
const liveApps = new Set<RunningProcessApp>()
const liveChildren = new Set<ChildProcess>()
const temporaryDirectories = new Set<string>()

afterEach(async () => {
  for (const app of liveApps) await app.stop()
  liveApps.clear()
  for (const child of liveChildren) {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    if (child.exitCode === null && child.signalCode === null) await once(child, 'exit')
  }
  liveChildren.clear()
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true })
  }
  temporaryDirectories.clear()
})

describe('BCK-010 process lifecycle', () => {
  test('boots a real Bun child, publishes ready, serves health, and exits on request', async () => {
    const port = availablePort()
    const child = spawn(process.execPath, [join(import.meta.dir, 'main.ts')], {
      cwd: join(import.meta.dir, '../'),
      env: childEnvironment(port),
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    })
    liveChildren.add(child)
    if (child.stdin === null || child.stdout === null || child.stderr === null) {
      throw new Error('real child lifecycle pipes were not created')
    }
    const stdout = lineCollector(child.stdout)
    const stderr: Buffer[] = []
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.stdin.end(TOKEN)

    const ready = await stdout.next('advx.backend.ready')
    expect(ready).toMatchObject({
      schema_version: 1,
      pid: child.pid,
      parent_pid: process.pid,
      host: '127.0.0.1',
      port,
      http_protocol_version: 3,
      realtime_protocol_version: 4
    })
    expect((await authorizedFetch(port, '/health')).status).toBe(200)

    expect(child.send({
      type: 'advx.backend.shutdown',
      reason: 'requested'
    })).toBe(true)
    const stopped = await stdout.next('advx.backend.stopped')
    expect(stopped).toMatchObject({
      reason: 'requested',
      exit_code: BACKEND_PROCESS_EXIT_CODES.clean,
      forced: false,
      cleanup_failures: []
    })
    if (child.exitCode === null) await once(child, 'exit')
    liveChildren.delete(child)
    expect(child.exitCode).toBe(BACKEND_PROCESS_EXIT_CODES.clean)
    expect(canBind(port)).toBe(true)
    expect(await descendantProcessIds(child.pid!)).toEqual([])

    const output = `${stdout.text()}${Buffer.concat(stderr).toString('utf8')}`
    expect(output).not.toContain(TOKEN)
    expect(output).not.toContain(SECRET_FAILURE)
  }, 15_000)

  test('uses one once-only shutdown contract and attempts ordered cleanup after failures', async () => {
    const host = new FakeProcessHost()
    const order: string[] = []
    const steps: ProcessCleanupStep[] = [
      { name: 'tasks', run: () => { order.push('tasks') } },
      {
        name: 'websocket',
        run: () => {
          order.push('websocket')
          throw new Error(SECRET_FAILURE)
        }
      },
      { name: 'server', run: () => { order.push('server') } },
      { name: 'database-flush', run: () => { order.push('database-flush') } },
      { name: 'database-close', run: () => { order.push('database-close') } },
      { name: 'trace-flush', run: () => { order.push('trace-flush') } },
      { name: 'log-flush', run: () => { order.push('log-flush') } }
    ]
    const supervisor = lifecycle(host, steps)
    supervisor.start()
    const firstNotice = notice('requested', 'first')
    const secondNotice = notice('signal', 'second')
    const first = await supervisor.requestOnce(firstNotice)
    const second = await supervisor.requestOnce(secondNotice)
    const result = await supervisor.whenComplete()

    expect(first).toEqual({ notice: firstNotice, firstRequest: true })
    expect(second).toEqual({ notice: firstNotice, firstRequest: false })
    expect(await supervisor.whenRequested()).toBe(firstNotice)
    expect(result).toEqual({
      reason: 'requested',
      exitCode: BACKEND_PROCESS_EXIT_CODES.cleanupFailure,
      forced: false,
      cleanupFailures: ['websocket']
    })
    expect(order).toEqual([
      'tasks',
      'websocket',
      'server',
      'database-flush',
      'database-close',
      'trace-flush',
      'log-flush'
    ])
    expect(host.signalListenerCount()).toBe(0)
    expect(host.parentMonitorActive).toBe(false)
    expect(JSON.stringify(result)).not.toContain(SECRET_FAILURE)
  })

  test('settles startup after parent loss across non-cooperative boot stages', async () => {
    for (const stage of ['initialize', 'health', 'publish'] as const) {
      const port = availablePort()
      const host = new FakeProcessHost()
      const publications: BackendProcessPublication[] = []
      const lifecycleOrder: string[] = []
      const never = new Promise<void>(() => {})
      const starting = startProcessApp(environment(port, tokenChannel(TOKEN)), {
        lifecycle: {
          host,
          parentCheckIntervalMs: 5,
          gracefulDeadlineMs: 100,
          verifyHealth: () => {
            lifecycleOrder.push('health-start')
            return stage === 'health' ? never : undefined
          },
          publisher: {
            publish: (event) => {
              if (event.type === 'advx.backend.ready') {
                lifecycleOrder.push('publish-start')
                if (stage === 'publish') return never
              }
              publications.push(event)
            }
          },
          resources: {
            initialize: () => {
              lifecycleOrder.push('initialize-start')
              return stage === 'initialize' ? never : undefined
            },
            database: {
              flush: () => { lifecycleOrder.push('database-flush') },
              close: () => { lifecycleOrder.push('database-close') }
            }
          }
        }
      })
      await waitUntil(() => lifecycleOrder.includes(`${stage}-start`))
      host.parentAlive = false
      host.checkParent()
      const app = await withTimeout(starting, `${stage} shutdown race`)
      liveApps.add(app)
      const result = await app.completion

      expect(result).toMatchObject({
        reason: 'parent_lost',
        exitCode: BACKEND_PROCESS_EXIT_CODES.clean,
        forced: false
      })
      expect(lifecycleOrder).toContain('database-flush')
      expect(lifecycleOrder).toContain('database-close')
      expect(publications.some((event) => event.type === 'advx.backend.ready')).toBe(false)
      expect(app.isAuthenticationActive()).toBe(false)
      expect(host.signalListenerCount()).toBe(0)
      expect(host.parentMonitorActive).toBe(false)
      expect(canBind(port)).toBe(true)
      liveApps.delete(app)
    }
  })

  test('maps SIGTERM to a clean once-only stop and removes supervision', async () => {
    const host = new FakeProcessHost()
    const order: string[] = []
    const supervisor = lifecycle(host, [
      { name: 'cleanup', run: () => { order.push('cleanup') } }
    ])
    supervisor.start()

    host.signal('SIGTERM')
    const result = await supervisor.whenComplete()

    expect(result).toEqual({
      reason: 'signal',
      exitCode: BACKEND_PROCESS_EXIT_CODES.clean,
      forced: false,
      cleanupFailures: []
    })
    expect(order).toEqual(['cleanup'])
    expect(host.signalListenerCount()).toBe(0)
    expect(host.parentMonitorActive).toBe(false)
    expect(host.forcedExitCodes).toEqual([])
  })

  test('returns the stable startup exit and cleans initialized boundaries without leaking failures', async () => {
    const port = availablePort()
    const host = new FakeProcessHost()
    const publications: BackendProcessPublication[] = []
    const order: string[] = []
    const taskScope: TaskScope = {
      spawn() {
        throw new Error('not used by process cleanup')
      },
      cancelAll(reason) {
        expect(reason).toEqual({ code: 'process_shutdown' })
        order.push('task-cancel')
      },
      async drain() {
        order.push('task-drain')
      }
    }
    const result = await runBackendProcess(
      environment(port, tokenChannel(TOKEN)),
      {
        lifecycle: {
          host,
          publisher: { publish: (event) => { publications.push(event) } },
          verifyHealth: () => { throw new Error(SECRET_FAILURE) },
          resources: {
            initialize: () => { order.push('initialize') },
            taskScopes: [taskScope],
            database: {
              flush: () => { order.push('database-flush') },
              close: () => { order.push('database-close') }
            },
            traces: { flush: () => { order.push('trace-flush') } },
            logs: { flush: () => { order.push('log-flush') } }
          }
        }
      }
    )

    expect(result).toEqual({
      reason: 'startup_failed',
      exitCode: BACKEND_PROCESS_EXIT_CODES.startupFailure,
      forced: false,
      cleanupFailures: []
    })
    expect(order).toEqual([
      'initialize',
      'task-cancel',
      'task-drain',
      'database-flush',
      'database-close',
      'trace-flush',
      'log-flush'
    ])
    expect(publications).toEqual([{
      type: 'advx.backend.failure',
      schema_version: 1,
      code: 'startup_failed',
      exit_code: BACKEND_PROCESS_EXIT_CODES.startupFailure
    }])
    expect(JSON.stringify({ result, publications })).not.toContain(SECRET_FAILURE)
    expect(JSON.stringify({ result, publications })).not.toContain(TOKEN)
    expect(host.signalListenerCount()).toBe(0)
    expect(host.parentMonitorActive).toBe(false)
    expect(canBind(port)).toBe(true)
  })

  test('forces the stable timeout exit and still invokes every remaining cleanup step', async () => {
    const host = new FakeProcessHost()
    const order: string[] = []
    const never = new Promise<void>(() => {})
    const supervisor = lifecycle(host, [
      { name: 'hung-task-drain', run: () => { order.push('hung'); return never } },
      { name: 'server-close', run: () => { order.push('server') } },
      { name: 'database-close', run: () => { order.push('database') } },
      { name: 'log-flush', run: () => { order.push('logs') } }
    ], 20)
    supervisor.start()
    const result = await supervisor.requestStop('signal')

    expect(result).toEqual({
      reason: 'signal',
      exitCode: BACKEND_PROCESS_EXIT_CODES.forcedTimeout,
      forced: true,
      cleanupFailures: []
    })
    expect(order).toEqual(['hung', 'server', 'database', 'logs'])
    expect(host.forcedExitCodes).toEqual([BACKEND_PROCESS_EXIT_CODES.forcedTimeout])
    expect(host.signalListenerCount()).toBe(0)
    expect(host.parentMonitorActive).toBe(false)
  })
})

class FakeProcessHost implements BackendProcessHost {
  readonly parentPid = 4242
  readonly forcedExitCodes: BackendProcessExitCode[] = []
  readonly #signals = new Map<BackendProcessSignal, Set<() => void>>()
  readonly #controlListeners = new Set<(message: unknown) => void>()
  parentAlive = true
  parentMonitorActive = false
  #parentCheck: (() => void) | null = null

  onSignal(signal: BackendProcessSignal, listener: () => void): void {
    const listeners = this.#signals.get(signal) ?? new Set()
    listeners.add(listener)
    this.#signals.set(signal, listeners)
  }

  offSignal(signal: BackendProcessSignal, listener: () => void): void {
    this.#signals.get(signal)?.delete(listener)
  }

  onControlMessage(listener: (message: unknown) => void): void {
    this.#controlListeners.add(listener)
  }

  offControlMessage(listener: (message: unknown) => void): void {
    this.#controlListeners.delete(listener)
  }

  isProcessAlive(_pid: number): boolean {
    return this.parentAlive
  }

  setParentMonitor(callback: () => void, _intervalMs: number): unknown {
    this.parentMonitorActive = true
    this.#parentCheck = callback
    return callback
  }

  clearParentMonitor(_handle: unknown): void {
    this.parentMonitorActive = false
    this.#parentCheck = null
  }

  unrefParentMonitor(_handle: unknown): void {}

  setDeadline(callback: () => void, delayMs: number): unknown {
    return setTimeout(callback, delayMs)
  }

  clearDeadline(handle: unknown): void {
    clearTimeout(handle as ReturnType<typeof setTimeout>)
  }

  forceExit(exitCode: BackendProcessExitCode): void {
    this.forcedExitCodes.push(exitCode)
  }

  checkParent(): void {
    this.#parentCheck?.()
  }

  signal(signal: BackendProcessSignal): void {
    for (const listener of this.#signals.get(signal) ?? []) listener()
  }

  signalListenerCount(): number {
    return [...this.#signals.values()].reduce((count, listeners) =>
      count + listeners.size, this.#controlListeners.size)
  }
}

function lifecycle(
  host: BackendProcessHost,
  cleanupSteps: readonly ProcessCleanupStep[],
  gracefulDeadlineMs = 100
): ProcessLifecycleSupervisor {
  return new ProcessLifecycleSupervisor({
    host,
    cleanupSteps,
    gracefulDeadlineMs,
    parentCheckIntervalMs: 10,
    createShutdownNotice: (reason) => notice(reason, crypto.randomUUID())
  })
}

function notice(
  reason: ShutdownNotice['reason'],
  requestId: string
): ShutdownNotice {
  return {
    requestId,
    reason,
    requestedAt: wallClockTimestampMs(1),
    exitCode: reason === 'startup_failed'
      ? BACKEND_PROCESS_EXIT_CODES.startupFailure
      : 0
  }
}

function lineCollector(stream: NodeJS.ReadableStream) {
  const events: BackendProcessPublication[] = []
  const waiters = new Map<string, Array<(event: BackendProcessPublication) => void>>()
  const chunks: Buffer[] = []
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
      const pendingEvent = new Promise<BackendProcessPublication>((resolve) => {
        const typed = waiters.get(type) ?? []
        typed.push(resolve)
        waiters.set(type, typed)
      })
      return withTimeout(pendingEvent, `process publication ${type}`)
    },
    text: () => Buffer.concat(chunks).toString('utf8')
  }
}

function childEnvironment(port: number) {
  const dataDirectory = mkdtempSync(join(tmpdir(), 'advx-bck-010-data-'))
  temporaryDirectories.add(dataDirectory)
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(
      ([key]) => !/_API_KEY$/i.test(key) && key !== 'ADVX_LOCAL_TOKEN'
    )),
    ADVX_BACKEND_MODE: 'production',
    ADVX_BACKEND_HOST: '127.0.0.1',
    ADVX_BACKEND_PORT: String(port),
    ADVX_DATA_DIR: dataDirectory,
    ADVX_STARTUP_TOKEN_FD: '0'
  }
}

function environment(port: number, fileDescriptor: number) {
  return {
    ADVX_BACKEND_MODE: 'production',
    ADVX_BACKEND_HOST: '127.0.0.1',
    ADVX_BACKEND_PORT: String(port),
    ADVX_DATA_DIR: 'D:/private/advx-data',
    ADVX_STARTUP_TOKEN_FD: String(fileDescriptor)
  }
}

function tokenChannel(token: string): number {
  const directory = mkdtempSync(join(tmpdir(), 'advx-bck-010-'))
  temporaryDirectories.add(directory)
  const path = join(directory, 'startup-token')
  writeFileSync(path, token, 'utf8')
  return openSync(path, 'r')
}

function authorizedFetch(port: number, path: string) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    headers: { authorization: `Bearer ${TOKEN}` }
  })
}

async function descendantProcessIds(parentPid: number): Promise<number[]> {
  const command = [
    `$items=Get-CimInstance Win32_Process -Filter \"ParentProcessId = ${parentPid}\"`,
    '@($items | ForEach-Object ProcessId) | ConvertTo-Json -Compress'
  ].join('; ')
  const result = Bun.spawnSync(['powershell', '-NoProfile', '-Command', command])
  if (result.exitCode !== 0) throw new Error('descendant process query failed')
  const text = result.stdout.toString().trim()
  if (!text) return []
  const value = JSON.parse(text) as number | number[] | null
  return value === null ? [] : Array.isArray(value) ? value : [value]
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('condition timed out')
    await Bun.sleep(2)
  }
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    Bun.sleep(8_000).then(() => { throw new Error(`${label} timed out`) })
  ])
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
