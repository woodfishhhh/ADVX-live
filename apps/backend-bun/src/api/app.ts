import { Elysia } from 'elysia'
import type { BackendApplication } from '../application'
import { createControlApi } from './control'
import {
  createRecordedPipelineApi,
  type RecordedPipelineApiAdapter
} from './recorded-pipeline'
import { createRealtimeApi, type RealtimeApiOptions } from './realtime'
import { createSystemApi, type SystemApiOptions } from './system'
import { createDebugApi, type DebugApiOptions } from './debug'

export type RealtimeApiComposition = Readonly<{
  hub: import('../application').RealtimeHub
  options: RealtimeApiOptions
}>

export function createApiApp(
  application: BackendApplication,
  system?: SystemApiOptions,
  realtime?: RealtimeApiComposition,
  recordedPipeline?: RecordedPipelineApiAdapter,
  debug?: Omit<DebugApiOptions, 'application' | 'authorize' | 'backendStartId' | 'backendVersion' | 'buildId'>
) {
  const api = new Elysia({ name: 'advx-api' }).decorate(
    'application',
    application
  )
  if (system === undefined) return api
  const authenticated = api
    .use(createSystemApi(system))
    .use(
      createDebugApi({
        ...debug,
        application,
        authorize: system.authorize,
        backendStartId: system.backendStartId ?? 'http',
        backendVersion: system.backendVersion,
        buildId: system.buildId
      })
    )
    .use(
      createControlApi(application, {
        authorize: system.authorize,
        backendStartId: system.backendStartId,
        ...(recordedPipeline === undefined
          ? {}
          : {
              onSessionStarted: recordedPipeline.markSessionStarted.bind(recordedPipeline),
              onSessionStopped: recordedPipeline.markSessionStopped.bind(recordedPipeline)
            })
      })
    )
    .use(
      recordedPipeline === undefined
        ? new Elysia({ name: 'advx-recorded-pipeline-disabled' })
        : createRecordedPipelineApi(application, system.authorize, recordedPipeline)
    )
  return realtime === undefined
    ? authenticated
    : authenticated.use(createRealtimeApi(realtime.hub, realtime.options))
}
