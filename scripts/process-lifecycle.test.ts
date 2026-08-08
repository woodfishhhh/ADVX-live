import { afterEach, describe, expect, test } from 'bun:test'
import { randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:net'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  requestShutdownViaSocket,
  terminateWithFallback
} from './process-lifecycle.ts'
import {
  ExecutionGuard,
  SCRIPT_EXIT,
  ScriptError
} from './evidence-script-runtime.ts'

const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeServer(server)))
})

describe('process lifecycle TypeScript parity', () => {
  test('clears a fallback timer after completion', async () => {
    const moduleUrl = pathToFileURL(resolve('scripts/process-lifecycle.ts')).href
    const child = Bun.spawn(
      [
        process.env.ADVX_NODE_EXECUTABLE?.trim() || 'node',
        '--input-type=module',
        '--eval',
        `import { waitForCompletionOrTimeout } from ${JSON.stringify(moduleUrl)}; await waitForCompletionOrTimeout(Promise.resolve(), 60_000)`
      ],
      { stdin: 'ignore', stdout: 'ignore', stderr: 'pipe', windowsHide: true }
    )
    const startedAt = performance.now()
    const exitCode = await child.exited
    const elapsedMs = performance.now() - startedAt
    const stderr = await new Response(child.stderr).text()

    expect(exitCode).toBe(0)
    expect(stderr).not.toMatch(/\b(?:Error|ERR_[A-Z_]+)\b/)
    expect(elapsedMs).toBeLessThan(10_000)
  }, 15_000)

  test('requests graceful shutdown through the local control socket', async () => {
    const socketPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\advx-live-test-${randomBytes(8).toString('hex')}`
      : `/tmp/advx-live-test-${randomBytes(8).toString('hex')}.sock`
    const server = createServer((socket) => {
      socket.once('data', (data) => {
        expect(data.toString('utf8')).toBe('quit\n')
        socket.end('ok\n')
      })
    })
    servers.push(server)
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(socketPath, resolveListen)
    })

    expect(await requestShutdownViaSocket(socketPath)).toBe(true)
  })

  test('uses SIGTERM without forcing a process that exits during its grace period', async () => {
    let running = true
    const signals: NodeJS.Signals[] = []
    const forced = await terminateWithFallback({
      isRunning: () => running,
      requestTermination: (signal) => {
        signals.push(signal)
        if (signal === 'SIGTERM') running = false
      },
      waitForExit: async () => {},
      gracefulTimeoutMs: 1,
      forceTimeoutMs: 1,
      onForce: () => {
        throw new Error('a graceful exit must not be forced')
      }
    })

    expect(forced).toBe(false)
    expect(signals).toEqual(['SIGTERM'])
  })

  test('forces a process only after its grace period expires', async () => {
    const signals: NodeJS.Signals[] = []
    let forceNotified = false
    const forced = await terminateWithFallback({
      isRunning: () => true,
      requestTermination: (signal) => signals.push(signal),
      waitForExit: async () => {},
      gracefulTimeoutMs: 1,
      forceTimeoutMs: 1,
      onForce: () => {
        forceNotified = true
      }
    })

    expect(forced).toBe(true)
    expect(forceNotified).toBe(true)
    expect(signals).toEqual(['SIGTERM', 'SIGKILL'])
  })

  test('runs registered cleanup after signal and timeout aborts', async () => {
    for (const reason of ['signal', 'timeout'] as const) {
      let cleaned = false
      const guard = new ExecutionGuard(reason === 'signal' ? 1_000 : 1)
      guard.addCleanup(() => {
        cleaned = true
      })
      if (reason === 'signal') queueMicrotask(() => process.emit('SIGTERM'))

      let caught: unknown
      try {
        await guard.race(new Promise<never>(() => {}))
      } catch (error) {
        caught = error
      } finally {
        await guard.close()
      }

      expect(caught).toBeInstanceOf(ScriptError)
      expect((caught as ScriptError).exitCode).toBe(SCRIPT_EXIT.interrupted)
      expect(cleaned).toBe(true)
    }
  })
})

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose())
  })
}
