import {
  ADVX_HTTP_PROTOCOL_VERSION,
  ADVX_REALTIME_PROTOCOL_VERSION
} from '@advx/contracts'
import { dlopen } from 'bun:ffi'
import { request as requestHttp } from 'node:http'
import { resolve } from 'node:path'

import { createApp } from './app'
import backendPackage from '../package.json' with { type: 'json' }
import {
  BACKEND_PROCESS_EXIT_CODES,
  ProcessLifecycleSupervisor,
  type BackendProcessExitCode,
  type BackendProcessHost,
  type BackendProcessLifecycleResult,
  type BackendProcessStopReason,
  type ProcessCleanupStep,
  type ProcessLifecycleResources,
  type ShutdownNotice,
  wallClockTimestampMs
} from './application'
import {
  BackendStartupError,
  AdvxSqliteDatabase,
  AdvxSqliteDatabaseError,
  ADVX_SQLITE_MIGRATIONS,
  loadBackendConfigFromEnvironment,
  RealtimeSessionEventBridge,
  StartupTokenCredential,
  StaticBackendProfileReader,
  createDiagnosticLogger,
  createTransientRuntimeControl,
  type BackendConfig
} from './infrastructure'
import type { DiagnosticLogger } from './infrastructure'
import { RecordedPipelineFixture } from './infrastructure/recorded-pipeline'
import type { HealthProbeResult, ReadinessChecks } from './api'
import { BoundedDebugEventStore } from './api/debug'

export const BACKEND_PROCESS_DEFAULTS = Object.freeze({
  gracefulDeadlineMs: 5_000,
  parentCheckIntervalMs: 1_000,
  healthProbeDeadlineMs: 1_000
})

export type BackendProcessReadyPublication = Readonly<{
  type: 'advx.backend.ready'
  schema_version: 1
  pid: number
  parent_pid: number
  host: '127.0.0.1' | '::1'
  port: number
  http_protocol_version: typeof ADVX_HTTP_PROTOCOL_VERSION
  realtime_protocol_version: typeof ADVX_REALTIME_PROTOCOL_VERSION
}>

export type BackendProcessStoppedPublication = Readonly<{
  type: 'advx.backend.stopped'
  schema_version: 1
  reason: BackendProcessStopReason
  exit_code: BackendProcessExitCode
  forced: boolean
  cleanup_failures: readonly string[]
}>

export type BackendProcessFailurePublication = Readonly<{
  type: 'advx.backend.failure'
  schema_version: 1
  code: string
  exit_code: typeof BACKEND_PROCESS_EXIT_CODES.startupFailure
}>

export type BackendProcessPublication =
  | BackendProcessReadyPublication
  | BackendProcessStoppedPublication
  | BackendProcessFailurePublication

export interface BackendProcessPublisher {
  publish(event: BackendProcessPublication): void | Promise<void>
}

export type ProcessAppComposition = ReturnType<typeof createProcessApp>

export type StartProcessAppOptions = {
  readonly health?: () => HealthProbeResult | Promise<HealthProbeResult>
  readonly readiness?: () => ReadinessChecks | Promise<ReadinessChecks>
  readonly buildId?: string
  readonly realtime?: NonNullable<
    NonNullable<Parameters<typeof createApp>[1]>['realtime']
  >
  readonly lifecycle?: Readonly<{
    resources?: ProcessLifecycleResources
    host?: BackendProcessHost
    publisher?: BackendProcessPublisher
    gracefulDeadlineMs?: number
    parentCheckIntervalMs?: number
    verifyHealth?: (
      host: string,
      port: number,
      signal: AbortSignal
    ) => void | Promise<void>
  }>
}

export type RunningProcessApp = Awaited<ReturnType<typeof startProcessApp>>

export type BackendProcessRunResult =
  | BackendProcessLifecycleResult
  | Readonly<{
      reason: 'startup_failed'
      exitCode: typeof BACKEND_PROCESS_EXIT_CODES.startupFailure
      forced: false
      cleanupFailures: readonly string[]
    }>

export function createProcessApp(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  startupToken?: StartupTokenCredential,
  options: StartProcessAppOptions = {}
) {
  return composeProcessApp(
    loadBackendConfigFromEnvironment(environment),
    startupToken,
    options
  )
}

export async function startProcessApp(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  options: StartProcessAppOptions = {}
) {
  const config = loadBackendConfigFromEnvironment(environment)
  const startupToken = StartupTokenCredential.consume(config.startupTokenChannel)
  const host = options.lifecycle?.host ?? createNodeProcessHost()
  const publisher = options.lifecycle?.publisher ?? NOOP_PROCESS_PUBLISHER
  const resources = options.lifecycle?.resources ?? {}
  let app: ReturnType<typeof composeProcessApp> | undefined
  let supervisor: ProcessLifecycleSupervisor | undefined
  let bootCancellation: AbortController | undefined
  let bootStage: 'composition' | 'resources' | 'listen' | 'health' | 'publish' =
    'composition'

  try {
    app = composeProcessApp(config, startupToken, options)
    const bootController = new AbortController()
    bootCancellation = bootController
    const cleanupSteps = processCleanupSteps(
      app,
      startupToken,
      resources,
      bootController
    )
    supervisor = new ProcessLifecycleSupervisor({
      host,
      cleanupSteps,
      gracefulDeadlineMs:
        options.lifecycle?.gracefulDeadlineMs ??
        BACKEND_PROCESS_DEFAULTS.gracefulDeadlineMs,
      parentCheckIntervalMs:
        options.lifecycle?.parentCheckIntervalMs ??
        BACKEND_PROCESS_DEFAULTS.parentCheckIntervalMs,
      createShutdownNotice
    })
    supervisor.start()
    if (supervisor.isStopping()) {
      return runningProcessApp(app, config, startupToken, supervisor, publisher)
    }
    bootStage = 'resources'
    if (!(await completeBootStage(
      () => resources.initialize?.(bootController.signal),
      supervisor
    ))) {
      return runningProcessApp(app, config, startupToken, supervisor, publisher)
    }
    if (supervisor.isStopping()) {
      return runningProcessApp(app, config, startupToken, supervisor, publisher)
    }
    bootStage = 'listen'
    app.api.listen({
      hostname: config.process.host,
      port: config.process.port
    })
    bootStage = 'health'
    if (!(await completeBootStage(
      () => (
        options.lifecycle?.verifyHealth ?? verifyBoundHealthEndpoint
      )(config.process.host, config.process.port, bootController.signal),
      supervisor
    ))) {
      return runningProcessApp(app, config, startupToken, supervisor, publisher)
    }
    if (supervisor.isStopping()) {
      return runningProcessApp(app, config, startupToken, supervisor, publisher)
    }
    bootStage = 'publish'
    if (!(await completeBootStage(
      () => publisher.publish(readyPublication(config, host.parentPid)),
      supervisor
    ))) {
      return runningProcessApp(app, config, startupToken, supervisor, publisher)
    }
  } catch (error) {
    if (app !== undefined && supervisor?.isStopping()) {
      return runningProcessApp(app, config, startupToken, supervisor, publisher)
    }
    startupToken.clear()
    if (supervisor !== undefined) {
      await supervisor.requestStop('startup_failed')
    } else if (app !== undefined) {
      await cleanupFailedStartup(
        app,
        startupToken,
        resources,
        host,
        options,
        bootCancellation ?? new AbortController()
      )
    }
    if (error instanceof BackendStartupError) throw error
    if (error instanceof AdvxSqliteDatabaseError) {
      throw new BackendStartupError(`sqlite_${error.code}`)
    }
    throw new BackendStartupError(
      bootStage === 'listen' ? 'listen_failed' : 'startup_failed'
    )
  }

  return runningProcessApp(app, config, startupToken, supervisor, publisher)
}

export async function runBackendProcess(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  options: StartProcessAppOptions = {}
): Promise<BackendProcessRunResult> {
  const publisher = options.lifecycle?.publisher ?? createJsonLineProcessPublisher()
  let logger: DiagnosticLogger | undefined
  try {
    const config = loadBackendConfigFromEnvironment(environment)
    let processOptions = withDefaultProcessDatabase(environment, options)
    if (processOptions.lifecycle?.resources?.logs === undefined) {
      logger = createDiagnosticLogger({
        directory: resolve(config.process.dataDirectory, 'logs'),
        process: 'backend',
        level: config.observability.logging.level
      })
      logger.emit({
        level: 'info',
        event: 'backend.start.v1',
        process: 'backend',
        attributes: {
          mode: config.process.mode,
          port: config.process.port
        }
      })
      processOptions = withProcessLogger(processOptions, logger)
    }
    const app = await startProcessApp(environment, {
      ...processOptions,
      lifecycle: { ...processOptions.lifecycle, publisher }
    })
    logger?.emit({
      level: 'info',
      event: 'backend.ready.v1',
      process: 'backend',
      outcome: 'success',
      attributes: { port: config.process.port }
    })
    app.debugEvents.append({
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'backend.ready.v1'
    })
    const result = await app.completion
    logger?.emit({
      level: result.exitCode === 0 ? 'info' : 'error',
      event: 'backend.stop.v1',
      process: 'backend',
      outcome: result.exitCode === 0 ? 'success' : 'failure',
      attributes: {
        reason: result.reason,
        forced: result.forced,
        cleanupFailures: result.cleanupFailures
      }
    })
    app.debugEvents.append({
      timestamp: new Date().toISOString(),
      level: result.exitCode === 0 ? 'info' : 'error',
      event: 'backend.stop.v1',
      ...(result.exitCode === 0 ? {} : { reason: result.reason })
    })
    await logger?.close()
    return result
  } catch (error) {
    const code =
      error instanceof BackendStartupError
        ? error.code
        : error instanceof AdvxSqliteDatabaseError
        ? `sqlite_${error.code}`
        : 'startup_failed'
    try {
      logger?.emit({
        level: 'error',
        event: 'backend.failure.v1',
        process: 'backend',
        outcome: 'failure',
        attributes: { code }
      })
      await logger?.close()
      await publisher.publish({
        type: 'advx.backend.failure',
        schema_version: 1,
        code,
        exit_code: BACKEND_PROCESS_EXIT_CODES.startupFailure
      })
    } catch {
      // Failure publication is best effort and never replaces the stable exit code.
    }
    return Object.freeze({
      reason: 'startup_failed',
      exitCode: BACKEND_PROCESS_EXIT_CODES.startupFailure,
      forced: false,
      cleanupFailures: Object.freeze([])
    })
  }
}

function withProcessLogger(
  options: StartProcessAppOptions,
  logger: DiagnosticLogger
): StartProcessAppOptions {
  const resources = options.lifecycle?.resources
  return {
    ...options,
    lifecycle: {
      ...options.lifecycle,
      resources: {
        ...resources,
        logs: logger
      }
    }
  }
}

function withDefaultProcessDatabase(
  environment: Readonly<Record<string, string | undefined>>,
  options: StartProcessAppOptions
): StartProcessAppOptions {
  const configuredResources = options.lifecycle?.resources
  if (configuredResources?.database !== undefined) return options

  const config = loadBackendConfigFromEnvironment(environment)
  const database = new AdvxSqliteDatabase({
    dataDirectory: resolve(config.process.dataDirectory)
  })
  const configuredReadiness = options.readiness
  const configuredInitialize = configuredResources?.initialize

  return {
    ...options,
    readiness: async () => {
      const checks =
        configuredReadiness === undefined
          ? { contract: true, database: true, runtime: true }
          : await configuredReadiness()
      return {
        ...checks,
        database: checks.database === true && database.isReady()
      }
    },
    lifecycle: {
      ...options.lifecycle,
      resources: {
        ...configuredResources,
        initialize: async (signal) => {
          database.initialize(signal)
          await configuredInitialize?.(signal)
        },
        database
      }
    }
  }
}

export function createNodeProcessHost(
  forceExit: (exitCode: BackendProcessExitCode) => void = () => {}
): BackendProcessHost {
  return {
    parentPid: process.ppid,
    onSignal: (signal, listener) => process.on(signal, listener),
    offSignal: (signal, listener) => process.off(signal, listener),
    onControlMessage: (listener) => process.on('message', listener),
    offControlMessage: (listener) => process.off('message', listener),
    isProcessAlive,
    setParentMonitor: (callback, intervalMs) => setInterval(callback, intervalMs),
    clearParentMonitor: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
    unrefParentMonitor: (handle) => {
      ;(handle as ReturnType<typeof setInterval>).unref()
    },
    setDeadline: (callback, delayMs) => setTimeout(callback, delayMs),
    clearDeadline: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    forceExit
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false
  if (process.platform === 'win32') {
    try {
      return isWindowsProcessAlive(pid)
    } catch {
      // Retain the portable probe if the packaged Bun runtime cannot load FFI.
    }
  }
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function isWindowsProcessAlive(pid: number): boolean {
  const kernel = dlopen('kernel32.dll', {
    OpenProcess: {
      args: ['u32', 'bool', 'u32'],
      returns: 'ptr'
    },
    GetExitCodeProcess: {
      args: ['ptr', 'ptr'],
      returns: 'bool'
    },
    CloseHandle: {
      args: ['ptr'],
      returns: 'bool'
    }
  })
  try {
    const processQueryLimitedInformation = 0x1000
    const stillActive = 259
    const handle = kernel.symbols.OpenProcess(
      processQueryLimitedInformation,
      false,
      pid
    )
    if (handle === null) return false
    try {
      const exitCode = new Uint32Array(1)
      return (
        kernel.symbols.GetExitCodeProcess(handle, exitCode) &&
        exitCode[0] === stillActive
      )
    } finally {
      kernel.symbols.CloseHandle(handle)
    }
  } finally {
    kernel.close()
  }
}

function composeProcessApp(
  config: BackendConfig,
  startupToken: StartupTokenCredential | undefined,
  options: StartProcessAppOptions
) {
  const sessionEvents = new RealtimeSessionEventBridge()
  const debugEvents = new BoundedDebugEventStore()
  const recordedPipeline = environmentFlag(process.env.ADVX_RECORDED_PIPELINE)
    ? new RecordedPipelineFixture()
    : undefined
  const app = createApp(
    {
      profileReader: new StaticBackendProfileReader(),
      runtimeControl: createTransientRuntimeControl(sessionEvents),
      ...(recordedPipeline === undefined
        ? {}
        : {
            binaryIngestSink: recordedPipeline.binaryIngestSink,
            textIngestSink: recordedPipeline.textIngestSink,
            voiceActivitySink: recordedPipeline.voiceActivitySink
          })
    },
    {
      mode: config.process.mode,
      enableDocumentation: config.developmentTools.documentationEnabled,
      ...(recordedPipeline === undefined ? {} : { recordedPipeline }),
      ...(startupToken === undefined
        ? {}
        : {
            system: {
              authorize: (authorization: string | null) =>
                startupToken.matchesAuthorization(authorization),
              ...(options.health === undefined ? {} : { health: options.health }),
              readiness:
                options.readiness ??
                (() => ({ contract: true, database: false, runtime: true })),
              backendVersion: backendPackage.version,
              buildId:
                options.buildId ??
                `${backendPackage.name}@${backendPackage.version}+source`
            },
            realtime: {
              ...options.realtime,
              queueCapacity: config.limits.queueCapacity,
              connectionCapacity:
                options.realtime?.connectionCapacity ?? config.limits.queueCapacity,
              jsonPayloadMaximumBytes: config.limits.jsonPayloadMaximumBytes,
              maxPayloadLength: config.limits.binaryPayloadMaximumBytes,
              backpressureLimit:
                config.limits.queueCapacity * config.limits.jsonPayloadMaximumBytes
            },
            debug: {
              database: options.lifecycle?.resources?.database as
                | { health(): ReturnType<AdvxSqliteDatabase['health']> }
                | undefined,
              databaseSchemaVersion: ADVX_SQLITE_MIGRATIONS.length,
              providers: config.providers.map((provider) => ({
                id: provider.id,
                model: provider.model,
                baseUrl: provider.baseUrl
              })),
              events: debugEvents
            }
          })
    }
  )
  if (startupToken !== undefined) {
    debugEvents.append({
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'backend.start.v1'
    })
  }
  if (app.realtime !== undefined) {
    sessionEvents.attach(app.realtime)
    recordedPipeline?.attachPublisher(app.realtime)
  }
  recordedPipeline?.attachRuntimeReader((sessionId) =>
    app.application.currentRuntimeSession(sessionId)
  )
  return { ...app, config, debugEvents } as const satisfies {
    readonly config: BackendConfig
    readonly debugEvents: BoundedDebugEventStore
  }
}

function environmentFlag(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

function runningProcessApp(
  app: ReturnType<typeof composeProcessApp>,
  config: BackendConfig,
  startupToken: StartupTokenCredential,
  supervisor: ProcessLifecycleSupervisor,
  publisher: BackendProcessPublisher
) {
  const completion = supervisor.whenComplete()
  void completion
    .then((result) => publisher.publish(stoppedPublication(result)))
    .catch(() => {})
  return {
    ...app,
    server: Object.freeze({
      hostname: config.process.host,
      port: config.process.port
    }),
    completion,
    isAuthenticationActive: () => startupToken.isActive(),
    stop: (reason: BackendProcessStopReason = 'requested') =>
      supervisor.requestStop(reason)
  } as const
}

async function completeBootStage(
  start: () => void | Promise<void>,
  supervisor: ProcessLifecycleSupervisor
): Promise<boolean> {
  if (supervisor.isStopping()) return false
  const stage = Promise.resolve()
    .then(start)
    .then(
      () => ({ status: 'completed' as const }),
      (error: unknown) => ({ status: 'failed' as const, error })
    )
  const outcome = await Promise.race([
    stage,
    supervisor.whenComplete().then(() => ({ status: 'stopping' as const }))
  ])
  if (outcome.status === 'failed') throw outcome.error
  return outcome.status === 'completed'
}

function createShutdownNotice(reason: BackendProcessStopReason): ShutdownNotice {
  return Object.freeze({
    requestId: crypto.randomUUID(),
    reason,
    requestedAt: wallClockTimestampMs(Date.now()),
    exitCode: reason === 'startup_failed'
      ? BACKEND_PROCESS_EXIT_CODES.startupFailure
      : reason === 'fatal_error'
      ? BACKEND_PROCESS_EXIT_CODES.cleanupFailure
      : BACKEND_PROCESS_EXIT_CODES.clean
  })
}

function processCleanupSteps(
  app: ReturnType<typeof composeProcessApp>,
  startupToken: StartupTokenCredential,
  resources: ProcessLifecycleResources,
  bootCancellation: AbortController
): ProcessCleanupStep[] {
  return [
    {
      name: 'boot-cancel',
      run: () => bootCancellation.abort({ code: 'process_shutdown' })
    },
    {
      name: 'startup-token-clear',
      run: () => startupToken.clear()
    },
    ...(resources.taskScopes === undefined
      ? []
      : [
          {
            name: 'application-task-cancel',
            run: () => cancelTaskScopes(resources.taskScopes!)
          },
          {
            name: 'application-task-drain',
            run: () => drainTaskScopes(resources.taskScopes!)
          }
        ]),
    {
      name: 'websocket-close',
      run: (reason) => app.realtime?.shutdown(realtimeShutdownReason(reason))
    },
    {
      name: 'server-close',
      run: () => {
        const listener = app.api.server
        listener?.stop(true)
        app.api.server = null
      }
    },
    ...(resources.database === undefined
      ? []
      : [
          { name: 'database-flush', run: () => resources.database!.flush() },
          { name: 'database-close', run: () => resources.database!.close() }
        ]),
    ...(resources.traces === undefined
      ? []
      : [{ name: 'trace-flush', run: () => resources.traces!.flush() }]),
    ...(resources.logs === undefined
      ? []
      : [{ name: 'log-flush', run: () => resources.logs!.flush() }])
  ]
}

async function cleanupFailedStartup(
  app: ReturnType<typeof composeProcessApp>,
  startupToken: StartupTokenCredential,
  resources: ProcessLifecycleResources,
  host: BackendProcessHost,
  options: StartProcessAppOptions,
  bootCancellation: AbortController
): Promise<void> {
  const cleanup = new ProcessLifecycleSupervisor({
    host,
    cleanupSteps: processCleanupSteps(app, startupToken, resources, bootCancellation),
    gracefulDeadlineMs:
      options.lifecycle?.gracefulDeadlineMs ??
      BACKEND_PROCESS_DEFAULTS.gracefulDeadlineMs,
    parentCheckIntervalMs:
      options.lifecycle?.parentCheckIntervalMs ??
      BACKEND_PROCESS_DEFAULTS.parentCheckIntervalMs,
    createShutdownNotice
  })
  await cleanup.requestStop('startup_failed')
}

function cancelTaskScopes(taskScopes: NonNullable<ProcessLifecycleResources['taskScopes']>): void {
  const failures: unknown[] = []
  for (const scope of taskScopes) {
    try {
      scope.cancelAll({ code: 'process_shutdown' })
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0) throw new Error('application task cancellation failed')
}

async function drainTaskScopes(
  taskScopes: NonNullable<ProcessLifecycleResources['taskScopes']>
): Promise<void> {
  const outcomes = await Promise.allSettled(taskScopes.map((scope) => scope.drain()))
  if (outcomes.some((outcome) => outcome.status === 'rejected')) {
    throw new Error('application task drain failed')
  }
}

function realtimeShutdownReason(reason: BackendProcessStopReason) {
  if (reason === 'restart') return 'restart' as const
  if (reason === 'fatal_error') return 'fatal_error' as const
  return 'requested' as const
}

async function verifyBoundHealthEndpoint(
  host: string,
  port: number,
  bootSignal: AbortSignal
): Promise<void> {
  const signal = AbortSignal.any([
    bootSignal,
    AbortSignal.timeout(BACKEND_PROCESS_DEFAULTS.healthProbeDeadlineMs)
  ])
  await new Promise<void>((resolve, reject) => {
    const request = requestHttp({
      host,
      port,
      path: '/health',
      method: 'GET',
      agent: false,
      headers: { connection: 'close' },
      signal
    }, (response) => {
      response.resume()
      if (response.statusCode === 401) resolve()
      else reject(new Error('health endpoint probe failed'))
    })
    request.once('error', reject)
    request.end()
  })
}

function readyPublication(
  config: BackendConfig,
  parentPid: number
): BackendProcessReadyPublication {
  return Object.freeze({
    type: 'advx.backend.ready',
    schema_version: 1,
    pid: process.pid,
    parent_pid: parentPid,
    host: config.process.host,
    port: config.process.port,
    http_protocol_version: ADVX_HTTP_PROTOCOL_VERSION,
    realtime_protocol_version: ADVX_REALTIME_PROTOCOL_VERSION
  })
}

function stoppedPublication(
  result: BackendProcessLifecycleResult
): BackendProcessStoppedPublication {
  return Object.freeze({
    type: 'advx.backend.stopped',
    schema_version: 1,
    reason: result.reason,
    exit_code: result.exitCode,
    forced: result.forced,
    cleanup_failures: result.cleanupFailures
  })
}

function createJsonLineProcessPublisher(): BackendProcessPublisher {
  return {
    publish(event) {
      const line = `${JSON.stringify(event)}\n`
      if (event.type === 'advx.backend.failure') process.stderr.write(line)
      else process.stdout.write(line)
    }
  }
}

const NOOP_PROCESS_PUBLISHER: BackendProcessPublisher = Object.freeze({
  publish() {}
})

if (import.meta.main) {
  const host = createNodeProcessHost((exitCode) => process.exit(exitCode))
  void runBackendProcess(process.env, { lifecycle: { host } }).then((result) => {
    process.exitCode = result.exitCode
  })
}
