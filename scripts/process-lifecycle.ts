import { connect } from 'node:net'

export async function waitForCompletionOrTimeout(
  completion: PromiseLike<unknown>,
  timeoutMs: number
): Promise<void> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<void>((resolveTimeout) => {
    timeoutId = setTimeout(resolveTimeout, timeoutMs)
  })

  try {
    await Promise.race([completion, timeout])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}

export function requestShutdownViaSocket(
  socketPath: string,
  timeoutMs = 500
): Promise<boolean> {
  return new Promise((resolveRequest) => {
    let completed = false
    const socket = connect(socketPath)
    const timeout = setTimeout(() => finish(false), timeoutMs)
    timeout.unref()

    function finish(accepted: boolean): void {
      if (completed) return
      completed = true
      clearTimeout(timeout)
      socket.destroy()
      resolveRequest(accepted)
    }

    socket.once('connect', () => socket.write('quit\n'))
    socket.once('data', (data) => finish(data.toString('utf8').trim() === 'ok'))
    socket.once('error', () => finish(false))
    socket.once('close', () => finish(false))
  })
}

export type TerminateWithFallbackOptions = Readonly<{
  isRunning(): boolean
  requestTermination(signal: NodeJS.Signals): void
  waitForExit(): PromiseLike<unknown>
  gracefulTimeoutMs: number
  forceTimeoutMs: number
  onForce(): void
}>

export async function terminateWithFallback({
  isRunning,
  requestTermination,
  waitForExit,
  gracefulTimeoutMs,
  forceTimeoutMs,
  onForce
}: TerminateWithFallbackOptions): Promise<boolean> {
  if (!isRunning()) return false

  requestTermination('SIGTERM')
  await waitForCompletionOrTimeout(waitForExit(), gracefulTimeoutMs)
  if (!isRunning()) return false

  onForce()
  requestTermination('SIGKILL')
  await waitForCompletionOrTimeout(waitForExit(), forceTimeoutMs)
  return true
}
