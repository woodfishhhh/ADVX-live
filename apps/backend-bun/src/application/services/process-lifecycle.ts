import type {
  ProcessShutdownNotifier,
  ShutdownNotice,
  ShutdownReceipt,
  ShutdownReason
} from '../ports/shutdown'

export const BACKEND_PROCESS_EXIT_CODES = Object.freeze({
  clean: 0,
  startupFailure: 20,
  cleanupFailure: 21,
  forcedTimeout: 22
} as const)

export type BackendProcessExitCode =
  (typeof BACKEND_PROCESS_EXIT_CODES)[keyof typeof BACKEND_PROCESS_EXIT_CODES]

export type BackendProcessStopReason = ShutdownReason

export type BackendProcessSignal = 'SIGINT' | 'SIGTERM'

export type BackendProcessControlMessage = Readonly<{
  type: 'advx.backend.shutdown'
  reason: 'requested' | 'restart'
}>

export type BackendProcessLifecycleResult = Readonly<{
  reason: BackendProcessStopReason
  exitCode: BackendProcessExitCode
  forced: boolean
  cleanupFailures: readonly string[]
}>

export type ProcessCleanupStep = Readonly<{
  name: string
  run(reason: BackendProcessStopReason): void | Promise<void>
}>

export interface BackendProcessHost {
  readonly parentPid: number
  onSignal(signal: BackendProcessSignal, listener: () => void): void
  offSignal(signal: BackendProcessSignal, listener: () => void): void
  onControlMessage(listener: (message: unknown) => void): void
  offControlMessage(listener: (message: unknown) => void): void
  isProcessAlive(pid: number): boolean
  setParentMonitor(callback: () => void, intervalMs: number): unknown
  clearParentMonitor(handle: unknown): void
  unrefParentMonitor(handle: unknown): void
  setDeadline(callback: () => void, delayMs: number): unknown
  clearDeadline(handle: unknown): void
  forceExit(exitCode: BackendProcessExitCode): void
}

export type ProcessLifecycleOptions = Readonly<{
  host: BackendProcessHost
  cleanupSteps: readonly ProcessCleanupStep[]
  gracefulDeadlineMs: number
  parentCheckIntervalMs: number
  createShutdownNotice(reason: BackendProcessStopReason): ShutdownNotice
  onComplete?: (result: BackendProcessLifecycleResult) => void
}>

export class ProcessLifecycleSupervisor implements ProcessShutdownNotifier {
  readonly #signalListeners = new Map<BackendProcessSignal, () => void>()
  readonly #controlListener = (message: unknown) => {
    if (isControlMessage(message)) void this.requestStop(message.reason)
  }
  readonly #completion: Promise<BackendProcessLifecycleResult>
  readonly #requested: Promise<ShutdownNotice>
  #resolveCompletion!: (result: BackendProcessLifecycleResult) => void
  #resolveRequested!: (notice: ShutdownNotice) => void
  #notice: ShutdownNotice | null = null
  #parentMonitor: unknown = null
  #stopPromise: Promise<BackendProcessLifecycleResult> | null = null
  #started = false

  constructor(private readonly options: ProcessLifecycleOptions) {
    requireDuration(options.gracefulDeadlineMs, 'gracefulDeadlineMs')
    requireDuration(options.parentCheckIntervalMs, 'parentCheckIntervalMs')
    this.#completion = new Promise((resolve) => {
      this.#resolveCompletion = resolve
    })
    this.#requested = new Promise((resolve) => {
      this.#resolveRequested = resolve
    })
  }

  start(): void {
    if (this.#started) return
    this.#started = true
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      const listener = () => { void this.requestStop('signal') }
      this.#signalListeners.set(signal, listener)
      this.options.host.onSignal(signal, listener)
    }
    this.options.host.onControlMessage(this.#controlListener)
    if (this.options.host.parentPid > 0) {
      if (!this.options.host.isProcessAlive(this.options.host.parentPid)) {
        void this.requestStop('parent_lost')
        return
      }
      this.#parentMonitor = this.options.host.setParentMonitor(() => {
        if (!this.options.host.isProcessAlive(this.options.host.parentPid)) {
          void this.requestStop('parent_lost')
        }
      }, this.options.parentCheckIntervalMs)
      this.options.host.unrefParentMonitor(this.#parentMonitor)
    }
  }

  requestStop(reason: BackendProcessStopReason): Promise<BackendProcessLifecycleResult> {
    void this.requestOnce(this.options.createShutdownNotice(reason))
    return this.#stopPromise!
  }

  async requestOnce(notice: ShutdownNotice): Promise<ShutdownReceipt> {
    const firstRequest = this.#stopPromise === null
    if (firstRequest) {
      this.#notice = notice
      this.#resolveRequested(notice)
      this.#stopPromise = this.#stop(notice.reason)
    }
    return {
      notice: this.#notice!,
      firstRequest
    }
  }

  whenRequested(): Promise<ShutdownNotice> {
    return this.#requested
  }

  isStopping(): boolean {
    return this.#stopPromise !== null
  }

  whenComplete(): Promise<BackendProcessLifecycleResult> {
    return this.#completion
  }

  async #stop(reason: BackendProcessStopReason): Promise<BackendProcessLifecycleResult> {
    this.#removeSupervision()
    let deadlineReached = false
    let releaseDeadline!: () => void
    const deadlinePromise = new Promise<void>((resolve) => {
      releaseDeadline = resolve
    })
    const deadline = this.options.host.setDeadline(() => {
      deadlineReached = true
      releaseDeadline()
    }, this.options.gracefulDeadlineMs)
    const cleanupFailures: string[] = []
    let forced = false

    for (let index = 0; index < this.options.cleanupSteps.length; index += 1) {
      const step = this.options.cleanupSteps[index]!
      if (deadlineReached) {
        forced = true
        this.#attemptRemaining(index, reason, cleanupFailures)
        break
      }
      const outcome = await Promise.race([
        invokeCleanupStep(step, reason),
        deadlinePromise.then(() => ({ status: 'timeout' as const }))
      ])
      if (outcome.status === 'timeout') {
        forced = true
        this.#attemptRemaining(index + 1, reason, cleanupFailures)
        break
      }
      if (outcome.status === 'failed') cleanupFailures.push(step.name)
    }

    this.options.host.clearDeadline(deadline)
    const exitCode = forced
      ? BACKEND_PROCESS_EXIT_CODES.forcedTimeout
      : reason === 'startup_failed'
      ? BACKEND_PROCESS_EXIT_CODES.startupFailure
      : cleanupFailures.length > 0 || reason === 'fatal_error'
      ? BACKEND_PROCESS_EXIT_CODES.cleanupFailure
      : BACKEND_PROCESS_EXIT_CODES.clean
    const result = Object.freeze({
      reason,
      exitCode,
      forced,
      cleanupFailures: Object.freeze([...cleanupFailures])
    })
    this.options.onComplete?.(result)
    this.#resolveCompletion(result)
    if (forced) this.options.host.forceExit(exitCode)
    return result
  }

  #attemptRemaining(
    start: number,
    reason: BackendProcessStopReason,
    cleanupFailures: string[]
  ): void {
    for (const step of this.options.cleanupSteps.slice(start)) {
      try {
        const pending = step.run(reason)
        if (pending instanceof Promise) {
          void pending.catch(() => { cleanupFailures.push(step.name) })
        }
      } catch {
        cleanupFailures.push(step.name)
      }
    }
  }

  #removeSupervision(): void {
    for (const [signal, listener] of this.#signalListeners) {
      this.options.host.offSignal(signal, listener)
    }
    this.#signalListeners.clear()
    this.options.host.offControlMessage(this.#controlListener)
    if (this.#parentMonitor !== null) {
      this.options.host.clearParentMonitor(this.#parentMonitor)
      this.#parentMonitor = null
    }
  }
}

type CleanupOutcome =
  | { readonly status: 'completed' }
  | { readonly status: 'failed' }

async function invokeCleanupStep(
  step: ProcessCleanupStep,
  reason: BackendProcessStopReason
): Promise<CleanupOutcome> {
  try {
    await step.run(reason)
    return { status: 'completed' }
  } catch {
    return { status: 'failed' }
  }
}

function requireDuration(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 60_000) {
    throw new RangeError(`${name} must be between 1 and 60000 milliseconds`)
  }
}

function isControlMessage(value: unknown): value is BackendProcessControlMessage {
  if (value === null || typeof value !== 'object') return false
  const message = value as Record<string, unknown>
  return (
    message.type === 'advx.backend.shutdown' &&
    (message.reason === 'requested' || message.reason === 'restart') &&
    Object.keys(message).every((key) => key === 'type' || key === 'reason')
  )
}
