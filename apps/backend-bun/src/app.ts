import { createApiApp } from './api'
import type { SystemApiOptions } from './api'
import {
  BackendApplication,
  BackendApplicationError,
  BinaryIngestDispatcher,
  RealtimeHub,
  TextIngestDispatcher,
  UnavailableTextIngestSink,
  UnavailableVoiceActivitySink,
  VoiceActivityDispatcher,
  UnavailableBinaryIngestSink,
  type BinaryIngestCommandSink,
  type BackendProfileReader,
  type RuntimeControlOperations,
  type TextIngestCommandSink,
  type VoiceActivitySink
} from './application'
import { BACKEND_CONFIG_DEFAULTS } from './infrastructure'
import {
  createContractDocumentationApp,
  type DocumentationAppOptions
} from './openapi/app'
import type { RecordedPipelineFixture } from './infrastructure/recorded-pipeline'
import type { DebugApiOptions } from './api/debug'
import { ReplayService } from './application/services/replay-service'

export type CreateAppDependencies = {
  readonly profileReader: BackendProfileReader
  readonly runtimeControl?: RuntimeControlOperations
  readonly binaryIngestSink?: BinaryIngestCommandSink
  readonly textIngestSink?: TextIngestCommandSink
  readonly voiceActivitySink?: VoiceActivitySink
}

export type CreateAppOptions = DocumentationAppOptions
  & {
    readonly recordedPipeline?: RecordedPipelineFixture
    readonly debug?: Omit<DebugApiOptions, 'application' | 'authorize' | 'backendStartId' | 'backendVersion' | 'buildId'>
    readonly system?: SystemApiOptions
    readonly realtime?: Readonly<{
      backendStartId?: string
      queueCapacity?: number
      connectionCapacity?: number
      jsonPayloadMaximumBytes?: number
      maxPayloadLength?: number
      backpressureLimit?: number
      handshakeTimeoutMs?: number
      heartbeatIntervalMs?: number
      connectionTimeoutMs?: number
      now?: () => number
      nextMessageId?: () => string
    }>
  }

export type AppComposition = ReturnType<typeof createApp>

export function createApp(
  dependencies: CreateAppDependencies,
  options: CreateAppOptions = { mode: 'production' }
) {
  const application = new BackendApplication(
    dependencies.profileReader,
    dependencies.runtimeControl
  )
  const sessionReader = {
    currentSession: () => {
      try {
        return application.currentSession()
      } catch (error) {
        if (
          error instanceof BackendApplicationError &&
          error.code === 'runtime_control_unavailable'
        ) {
          const now = options.realtime?.now?.() ?? Date.now()
          return {
            session_id: null,
            state: 'idle' as const,
            started_at_ms: null,
            updated_at_ms: now,
            revision: 0
          }
        }
        throw error
      }
    }
  }
  const binaryIngest = options.system === undefined
    ? undefined
    : new BinaryIngestDispatcher({
        sessions: sessionReader,
        sink: dependencies.binaryIngestSink ?? new UnavailableBinaryIngestSink(),
        capacity:
          options.realtime?.queueCapacity ?? BACKEND_CONFIG_DEFAULTS.queueCapacity,
        ...(options.realtime?.now === undefined
          ? {}
          : { now: options.realtime.now })
      })
  const textIngest = options.system === undefined
    ? undefined
    : new TextIngestDispatcher({
        sessions: sessionReader,
        sink: dependencies.textIngestSink ?? new UnavailableTextIngestSink(),
        capacity:
          options.realtime?.queueCapacity ?? BACKEND_CONFIG_DEFAULTS.queueCapacity,
        ...(options.realtime?.now === undefined
          ? {}
          : { now: options.realtime.now })
      })
  const voiceActivity = options.system === undefined
    ? undefined
    : new VoiceActivityDispatcher({
        sessions: sessionReader,
        sink: dependencies.voiceActivitySink ?? new UnavailableVoiceActivitySink()
      })
  const backendStartId = options.realtime?.backendStartId ?? crypto.randomUUID()
  const realtime = options.system === undefined
    ? undefined
    : new RealtimeHub({
        backendStartId,
        authorize: options.system.authorize,
        sessions: sessionReader,
        ingest: binaryIngest!,
        textIngest,
        voiceActivity,
        queueCapacity:
          options.realtime?.queueCapacity ?? BACKEND_CONFIG_DEFAULTS.queueCapacity,
        ...(options.realtime?.connectionCapacity === undefined
          ? {}
          : { connectionCapacity: options.realtime.connectionCapacity }),
        jsonPayloadMaximumBytes:
          options.realtime?.jsonPayloadMaximumBytes ??
          BACKEND_CONFIG_DEFAULTS.jsonPayloadMaximumBytes,
        binaryPayloadMaximumBytes:
          options.realtime?.maxPayloadLength ??
          BACKEND_CONFIG_DEFAULTS.binaryPayloadMaximumBytes,
        ...(options.realtime?.handshakeTimeoutMs === undefined
          ? {}
          : { handshakeTimeoutMs: options.realtime.handshakeTimeoutMs }),
        ...(options.realtime?.heartbeatIntervalMs === undefined
          ? {}
          : { heartbeatIntervalMs: options.realtime.heartbeatIntervalMs }),
        ...(options.realtime?.connectionTimeoutMs === undefined
          ? {}
          : { connectionTimeoutMs: options.realtime.connectionTimeoutMs }),
        ...(options.realtime?.now === undefined
          ? {}
          : { now: options.realtime.now }),
        ...(options.realtime?.nextMessageId === undefined
          ? {}
          : { nextMessageId: options.realtime.nextMessageId })
      })
  const documentation = createContractDocumentationApp(options)
  const api = createApiApp(
    application,
    options.system === undefined
      ? undefined
      : { ...options.system, backendStartId },
    realtime === undefined
      ? undefined
      : {
          hub: realtime,
          options: {
            maxPayloadLength:
              options.realtime?.maxPayloadLength ??
              BACKEND_CONFIG_DEFAULTS.binaryPayloadMaximumBytes,
            backpressureLimit:
              options.realtime?.backpressureLimit ??
              (options.realtime?.queueCapacity ?? BACKEND_CONFIG_DEFAULTS.queueCapacity) *
                (options.realtime?.jsonPayloadMaximumBytes ??
                  BACKEND_CONFIG_DEFAULTS.jsonPayloadMaximumBytes)
          }
        },
    options.recordedPipeline,
    {
      ...options.debug,
      replay: options.debug?.replay ?? new ReplayService()
    }
  ).use(documentation)

  return { api, application, realtime, binaryIngest, textIngest, voiceActivity } as const
}
