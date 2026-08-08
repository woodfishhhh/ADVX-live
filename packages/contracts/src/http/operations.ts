import { normalizedErrorSchema } from '../errors'
import type { Schema } from '../schema'
import {
  emptyObjectSchema,
  candidatePathParamsSchema,
  memoryPathParamsSchema,
  memePathParamsSchema,
  namespacePathParamsSchema,
  roomPathParamsSchema,
  sessionPathParamsSchema,
  viewerPathParamsSchema,
  boundedIdentifierSchema
} from './common'
import {
  providerCapabilityProbeRequestSchema,
  providerCapabilityProbeResultSchema,
  providerConfigurationStatusSchema,
  providerModelDiscoverySchema,
  providerPublicSetupMetadataSchema
} from './configuration'
import {
  aiCallImagePreviewMetadataSchema,
  aiCallQueryResponseSchema,
  aiCallQuerySchema,
  aiCallTraceSchema,
  debugRuntimeSnapshotSchema,
  replayRequestSchema,
  replayResultSchema,
  traceExportArtifactSchema,
  traceQueryResponseSchema,
  traceQuerySchema
} from './debug'
import {
  healthResponseSchema,
  legacySessionSnapshotSchema,
  muteViewerRequestSchema,
  runtimeApplyRequestSchema,
  runtimeRollbackRequestSchema,
  runtimeSessionSnapshotSchema,
  runtimeSessionStartRequestSchema,
  sessionAudienceSnapshotSchema,
  viewerCommandRequestSchema,
  viewerSnapshotSchema
} from './runtime'
import {
  autoIngestRequestSchema,
  autoIngestResponseSchema,
  candidateCommitResponseSchema,
  deleteMemoryResponseSchema,
  expectedRevisionRequestSchema,
  legacyMemeImportRequestSchema,
  legacyMemeImportResponseSchema,
  listMemesQuerySchema,
  memeCandidateSchema,
  memeEditRequestSchema,
  memeMaintenanceResponseSchema,
  memoryCandidateRequestSchema,
  memoryEditRequestSchema,
  memoryHeadResponseSchema,
  memoryMergeRequestSchema,
  memoryReplaceRequestSchema,
  memoryResetResponseSchema,
  modeMemeSchema,
  positiveExpectedRevisionQuerySchema,
  roomLongTermMemorySchema
} from './shared-brain'
import { schema } from '../schema'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

export type HttpErrorRecord = {
  readonly status: number
  readonly code: string
  readonly retryable: boolean
}

export type HttpRequestBody =
  | {
      readonly kind: 'public'
      readonly schema: Schema<unknown>
    }
  | {
      readonly kind: 'controlled-secret-boundary'
      readonly publicMetadataSchema: Schema<unknown>
      readonly internalSecretFields: readonly ['model_api_key', 'asr_api_key']
      readonly serializablePublicContract: false
    }

export type HttpOperation = {
  readonly operationId: string
  readonly method: HttpMethod
  readonly path: string
  readonly pathParams: Schema<unknown>
  readonly query: Schema<unknown>
  readonly body?: HttpRequestBody
  readonly responses: Readonly<Record<number, Schema<unknown>>>
  readonly errors: readonly HttpErrorRecord[]
}

const publicBody = (bodySchema: Schema<unknown>): HttpRequestBody => ({
  kind: 'public',
  schema: bodySchema
})

const controlledProviderSetupBody: HttpRequestBody = {
  kind: 'controlled-secret-boundary',
  publicMetadataSchema: providerPublicSetupMetadataSchema,
  internalSecretFields: ['model_api_key', 'asr_api_key'],
  serializablePublicContract: false
}

const controlledProviderProbeBody: HttpRequestBody = {
  kind: 'controlled-secret-boundary',
  publicMetadataSchema: providerCapabilityProbeRequestSchema,
  internalSecretFields: ['model_api_key', 'asr_api_key'],
  serializablePublicContract: false
}

const error = (status: number, code: string, retryable = false): HttpErrorRecord => ({
  status,
  code,
  retryable
})

const legacyGuardErrors = [
  error(401, 'invalid_local_token'),
  error(426, 'protocol_version_mismatch')
] as const
const runtimeGuardErrors = [
  error(401, 'invalid_local_token'),
  error(409, 'protocol_version_conflict'),
  error(422, 'unsupported_protocol_version')
] as const

type OperationInput = Omit<HttpOperation, 'pathParams' | 'query' | 'errors'> & {
  readonly pathParams?: Schema<unknown>
  readonly query?: Schema<unknown>
  readonly errors?: readonly HttpErrorRecord[]
  readonly guard?: 'none' | 'legacy' | 'runtime'
}

const operation = (input: OperationInput): HttpOperation => ({
  operationId: input.operationId,
  method: input.method,
  path: input.path,
  pathParams: input.pathParams ?? emptyObjectSchema,
  query: input.query ?? emptyObjectSchema,
  ...(input.body === undefined ? {} : { body: input.body }),
  responses: input.responses,
  errors: [
    ...(input.guard === 'legacy'
      ? legacyGuardErrors
      : input.guard === 'runtime'
        ? runtimeGuardErrors
        : []),
    ...(input.errors ?? [])
  ]
})

const listMemoriesResponseSchema = schema.array(roomLongTermMemorySchema, {
  maxItems: 100_000
})
const listMemesResponseSchema = schema.array(modeMemeSchema, { maxItems: 100_000 })
const listMemeCandidatesResponseSchema = schema.array(memeCandidateSchema, {
  maxItems: 100_000
})
const callIdPathParamsSchema = schema.object({ call_id: boundedIdentifierSchema })
const previewIdPathParamsSchema = schema.object({ preview_id: boundedIdentifierSchema })

export const httpOperations = [
  operation({
    operationId: 'advx.health.get',
    method: 'GET',
    path: '/health',
    guard: 'none',
    responses: { 200: healthResponseSchema },
    errors: [error(503, 'health_probe_unavailable', true)]
  }),
  operation({
    operationId: 'advx.configuration.providers.get',
    method: 'GET',
    path: '/configuration/providers',
    guard: 'legacy',
    responses: { 200: providerConfigurationStatusSchema },
    errors: [error(503, 'provider_configuration_unavailable', true)]
  }),
  operation({
    operationId: 'advx.configuration.providers.models.get',
    method: 'GET',
    path: '/configuration/providers/models',
    guard: 'legacy',
    responses: { 200: providerModelDiscoverySchema },
    errors: [error(502, 'provider_model_discovery_failed', true)]
  }),
  operation({
    operationId: 'advx.configuration.providers.probe',
    method: 'POST',
    path: '/configuration/providers/probe',
    guard: 'legacy',
    body: controlledProviderProbeBody,
    responses: { 200: providerCapabilityProbeResultSchema },
    errors: [error(502, 'provider_capability_probe_failed', true)]
  }),
  operation({
    operationId: 'advx.configuration.providers.put',
    method: 'PUT',
    path: '/configuration/providers',
    guard: 'legacy',
    body: controlledProviderSetupBody,
    responses: { 200: providerConfigurationStatusSchema },
    errors: [
      error(409, 'provider_configuration_conflict'),
      error(502, 'provider_configuration_probe_failed', true)
    ]
  }),
  operation({
    operationId: 'advx.sessions.current.get',
    method: 'GET',
    path: '/sessions/current',
    guard: 'legacy',
    responses: { 200: legacySessionSnapshotSchema },
    errors: [error(503, 'persistence_unavailable', true)]
  }),
  operation({
    operationId: 'advx.sessions.start.legacy',
    method: 'POST',
    path: '/sessions',
    guard: 'legacy',
    responses: { 200: schema.literal(null), 409: normalizedErrorSchema },
    errors: [error(409, 'runtime_snapshot_required')]
  }),
  ...(['pause', 'resume', 'stop'] as const).map((command) =>
    operation({
      operationId: `advx.sessions.${command}`,
      method: 'POST',
      path: `/sessions/{session_id}/${command}`,
      pathParams: sessionPathParamsSchema,
      guard: 'legacy',
      responses: { 200: legacySessionSnapshotSchema },
      errors: [
        error(404, 'session_not_found'),
        error(409, 'invalid_session_state'),
        error(503, 'persistence_unavailable', true)
      ]
    })
  ),
  operation({
    operationId: 'advx.debug.traces.query',
    method: 'GET',
    path: '/debug/traces',
    guard: 'runtime',
    query: traceQuerySchema,
    responses: { 200: traceQueryResponseSchema },
    errors: [
      error(422, 'invalid_trace_query'),
      error(503, 'debug_service_unavailable', true)
    ]
  }),
  operation({
    operationId: 'advx.debug.traces.export',
    method: 'POST',
    path: '/debug/traces/export',
    guard: 'runtime',
    body: publicBody(traceQuerySchema),
    responses: { 200: traceExportArtifactSchema },
    errors: [
      error(422, 'unsafe_trace_artifact'),
      error(503, 'debug_service_unavailable', true)
    ]
  }),
  operation({
    operationId: 'advx.debug.ai-calls.query',
    method: 'GET',
    path: '/debug/ai-calls',
    guard: 'runtime',
    query: aiCallQuerySchema,
    responses: { 200: aiCallQueryResponseSchema },
    errors: [
      error(422, 'invalid_ai_call_query'),
      error(503, 'debug_service_unavailable', true)
    ]
  }),
  operation({
    operationId: 'advx.debug.ai-call-image.get',
    method: 'GET',
    path: '/debug/ai-calls/images/{preview_id}',
    pathParams: previewIdPathParamsSchema,
    guard: 'runtime',
    responses: { 200: aiCallImagePreviewMetadataSchema },
    errors: [
      error(404, 'ai_call_image_not_found'),
      error(503, 'debug_service_unavailable', true)
    ]
  }),
  operation({
    operationId: 'advx.debug.ai-call.get',
    method: 'GET',
    path: '/debug/ai-calls/{call_id}',
    pathParams: callIdPathParamsSchema,
    guard: 'runtime',
    responses: { 200: aiCallTraceSchema },
    errors: [
      error(404, 'ai_call_not_found'),
      error(503, 'debug_service_unavailable', true)
    ]
  }),
  operation({
    operationId: 'advx.debug.runtime.get',
    method: 'GET',
    path: '/debug/runtime/{session_id}',
    pathParams: sessionPathParamsSchema,
    guard: 'runtime',
    responses: { 200: debugRuntimeSnapshotSchema },
    errors: [
      error(404, 'runtime_session_not_found'),
      error(503, 'runtime_snapshot_unavailable', true)
    ]
  }),
  operation({
    operationId: 'advx.debug.replay',
    method: 'POST',
    path: '/debug/replay',
    guard: 'runtime',
    body: publicBody(replayRequestSchema),
    responses: { 200: replayResultSchema },
    errors: [
      error(422, 'unsafe_replay_bundle'),
      error(422, 'invalid_replay_request'),
      error(503, 'live_replay_unavailable', true),
      error(503, 'replay_service_unavailable', true)
    ]
  }),
  operation({
    operationId: 'advx.runtime.sessions.start',
    method: 'POST',
    path: '/runtime/sessions',
    guard: 'runtime',
    body: publicBody(runtimeSessionStartRequestSchema),
    responses: { 201: runtimeSessionSnapshotSchema },
    errors: [
      error(409, 'client_request_conflict'),
      error(422, 'runtime_start_rejected'),
      error(503, 'runtime_persistence_unavailable', true)
    ]
  }),
  operation({
    operationId: 'advx.runtime.sessions.current',
    method: 'GET',
    path: '/runtime/sessions/{session_id}',
    pathParams: sessionPathParamsSchema,
    guard: 'runtime',
    responses: { 200: runtimeSessionSnapshotSchema },
    errors: [
      error(404, 'runtime_session_not_found'),
      error(503, 'runtime_persistence_unavailable', true)
    ]
  }),
  operation({
    operationId: 'advx.runtime.sessions.apply',
    method: 'POST',
    path: '/runtime/sessions/{session_id}/apply',
    pathParams: sessionPathParamsSchema,
    guard: 'runtime',
    body: publicBody(runtimeApplyRequestSchema),
    responses: { 200: runtimeSessionSnapshotSchema },
    errors: [
      error(404, 'runtime_session_not_found'),
      error(409, 'client_request_conflict'),
      error(422, 'runtime_apply_rejected'),
      error(503, 'runtime_persistence_unavailable', true)
    ]
  }),
  operation({
    operationId: 'advx.runtime.sessions.rollback',
    method: 'POST',
    path: '/runtime/sessions/{session_id}/rollback',
    pathParams: sessionPathParamsSchema,
    guard: 'runtime',
    body: publicBody(runtimeRollbackRequestSchema),
    responses: { 200: runtimeSessionSnapshotSchema },
    errors: [
      error(404, 'runtime_session_not_found'),
      error(409, 'client_request_conflict'),
      error(422, 'runtime_rollback_rejected'),
      error(503, 'runtime_persistence_unavailable', true)
    ]
  }),
  operation({
    operationId: 'advx.runtime.sessions.recover',
    method: 'POST',
    path: '/runtime/sessions/{session_id}/recover',
    pathParams: sessionPathParamsSchema,
    guard: 'runtime',
    responses: { 200: runtimeSessionSnapshotSchema },
    errors: [
      error(404, 'runtime_session_not_found'),
      error(409, 'runtime_recovery_rejected'),
      error(503, 'runtime_persistence_unavailable', true)
    ]
  }),
  operation({
    operationId: 'advx.runtime.audience.current',
    method: 'GET',
    path: '/runtime/sessions/{session_id}/audience',
    pathParams: sessionPathParamsSchema,
    guard: 'runtime',
    responses: { 200: sessionAudienceSnapshotSchema },
    errors: [
      error(404, 'viewer_not_found'),
      error(503, 'viewer_audience_persistence_unavailable', true)
    ]
  }),
  operation({
    operationId: 'advx.runtime.viewer.mute',
    method: 'POST',
    path: '/runtime/sessions/{session_id}/viewers/{viewer_id}/mute',
    pathParams: viewerPathParamsSchema,
    guard: 'runtime',
    body: publicBody(muteViewerRequestSchema),
    responses: { 200: viewerSnapshotSchema },
    errors: [
      error(404, 'viewer_not_found'),
      error(409, 'viewer_command_conflict'),
      error(503, 'viewer_audience_persistence_unavailable', true)
    ]
  }),
  ...(['unmute', 'kick'] as const).map((command) =>
    operation({
      operationId: `advx.runtime.viewer.${command}`,
      method: 'POST',
      path: `/runtime/sessions/{session_id}/viewers/{viewer_id}/${command}`,
      pathParams: viewerPathParamsSchema,
      guard: 'runtime',
      body: publicBody(viewerCommandRequestSchema),
      responses: { 200: viewerSnapshotSchema },
      errors: [
        error(404, 'viewer_not_found'),
        error(409, 'viewer_command_conflict'),
        error(503, 'viewer_audience_persistence_unavailable', true)
      ]
    })
  ),
  operation({
    operationId: 'advx.shared-brain.memories.list',
    method: 'GET',
    path: '/shared-brain/rooms/{room_id}/memories',
    pathParams: roomPathParamsSchema,
    guard: 'runtime',
    responses: { 200: listMemoriesResponseSchema },
    errors: [error(503, 'shared_brain_service_unavailable', true)]
  }),
  operation({
    operationId: 'advx.shared-brain.memory-head.get',
    method: 'GET',
    path: '/shared-brain/rooms/{room_id}/memory-head',
    pathParams: roomPathParamsSchema,
    guard: 'runtime',
    responses: { 200: memoryHeadResponseSchema },
    errors: [error(503, 'shared_brain_service_unavailable', true)]
  }),
  operation({
    operationId: 'advx.shared-brain.memory.get',
    method: 'GET',
    path: '/shared-brain/rooms/{room_id}/memories/{memory_id}',
    pathParams: memoryPathParamsSchema,
    guard: 'runtime',
    responses: { 200: roomLongTermMemorySchema },
    errors: [
      error(404, 'memory_not_found'),
      error(503, 'shared_brain_service_unavailable', true)
    ]
  }),
  operation({
    operationId: 'advx.shared-brain.memory.edit',
    method: 'PUT',
    path: '/shared-brain/rooms/{room_id}/memories/{memory_id}',
    pathParams: memoryPathParamsSchema,
    guard: 'runtime',
    body: publicBody(memoryEditRequestSchema),
    responses: { 200: roomLongTermMemorySchema },
    errors: [
      error(409, 'revision_conflict'),
      error(422, 'shared_brain_invariant'),
      error(503, 'shared_brain_service_unavailable', true)
    ]
  }),
  operation({
    operationId: 'advx.shared-brain.memes.maintenance',
    method: 'POST',
    path: '/shared-brain/modes/{namespace_id}/memes/maintenance',
    pathParams: namespacePathParamsSchema,
    guard: 'runtime',
    responses: { 200: memeMaintenanceResponseSchema },
    errors: [
      error(422, 'shared_brain_invariant'),
      error(503, 'shared_brain_service_unavailable', true)
    ]
  }),
  operation({
    operationId: 'advx.shared-brain.memory.merge',
    method: 'POST',
    path: '/shared-brain/rooms/{room_id}/memories/{memory_id}/merge',
    pathParams: memoryPathParamsSchema,
    guard: 'runtime',
    body: publicBody(memoryMergeRequestSchema),
    responses: { 200: roomLongTermMemorySchema },
    errors: [error(409, 'revision_conflict'), error(422, 'shared_brain_invariant')]
  }),
  operation({
    operationId: 'advx.shared-brain.memory.replace',
    method: 'POST',
    path: '/shared-brain/rooms/{room_id}/memories/{memory_id}/replace',
    pathParams: memoryPathParamsSchema,
    guard: 'runtime',
    body: publicBody(memoryReplaceRequestSchema),
    responses: { 200: roomLongTermMemorySchema },
    errors: [error(409, 'revision_conflict'), error(422, 'shared_brain_invariant')]
  }),
  operation({
    operationId: 'advx.shared-brain.memory-candidate.commit',
    method: 'POST',
    path: '/shared-brain/memory-candidates',
    guard: 'runtime',
    body: publicBody(memoryCandidateRequestSchema),
    responses: { 200: candidateCommitResponseSchema },
    errors: [error(409, 'revision_conflict'), error(422, 'shared_brain_invariant')]
  }),
  operation({
    operationId: 'advx.shared-brain.memory.revoke',
    method: 'POST',
    path: '/shared-brain/rooms/{room_id}/memories/{memory_id}/revoke',
    pathParams: memoryPathParamsSchema,
    guard: 'runtime',
    body: publicBody(expectedRevisionRequestSchema),
    responses: { 200: roomLongTermMemorySchema },
    errors: [error(409, 'revision_conflict'), error(422, 'shared_brain_invariant')]
  }),
  operation({
    operationId: 'advx.shared-brain.memory.delete',
    method: 'DELETE',
    path: '/shared-brain/rooms/{room_id}/memories/{memory_id}',
    pathParams: memoryPathParamsSchema,
    query: positiveExpectedRevisionQuerySchema,
    guard: 'runtime',
    responses: { 200: deleteMemoryResponseSchema },
    errors: [error(404, 'memory_not_found'), error(409, 'revision_conflict')]
  }),
  operation({
    operationId: 'advx.shared-brain.memories.reset',
    method: 'POST',
    path: '/shared-brain/rooms/{room_id}/memories/reset',
    pathParams: roomPathParamsSchema,
    guard: 'runtime',
    body: publicBody(expectedRevisionRequestSchema),
    responses: { 200: memoryResetResponseSchema },
    errors: [error(409, 'revision_conflict'), error(422, 'shared_brain_invariant')]
  }),
  operation({
    operationId: 'advx.shared-brain.memes.list',
    method: 'GET',
    path: '/shared-brain/modes/{namespace_id}/memes',
    pathParams: namespacePathParamsSchema,
    query: listMemesQuerySchema,
    guard: 'runtime',
    responses: { 200: listMemesResponseSchema },
    errors: [error(503, 'shared_brain_service_unavailable', true)]
  }),
  operation({
    operationId: 'advx.shared-brain.memes.active.list',
    method: 'GET',
    path: '/shared-brain/modes/{namespace_id}/memes/active',
    pathParams: namespacePathParamsSchema,
    guard: 'runtime',
    responses: { 200: listMemesResponseSchema },
    errors: [error(503, 'shared_brain_service_unavailable', true)]
  }),
  operation({
    operationId: 'advx.shared-brain.meme-candidates.pending.list',
    method: 'GET',
    path: '/shared-brain/modes/{namespace_id}/meme-candidates/pending',
    pathParams: namespacePathParamsSchema,
    guard: 'runtime',
    responses: { 200: listMemeCandidatesResponseSchema },
    errors: [error(503, 'shared_brain_service_unavailable', true)]
  }),
  operation({
    operationId: 'advx.shared-brain.auto-ingest.get',
    method: 'GET',
    path: '/shared-brain/modes/{namespace_id}/auto-ingest',
    pathParams: namespacePathParamsSchema,
    guard: 'runtime',
    responses: { 200: autoIngestResponseSchema },
    errors: [error(503, 'shared_brain_service_unavailable', true)]
  }),
  operation({
    operationId: 'advx.shared-brain.auto-ingest.put',
    method: 'PUT',
    path: '/shared-brain/modes/{namespace_id}/auto-ingest',
    pathParams: namespacePathParamsSchema,
    guard: 'runtime',
    body: publicBody(autoIngestRequestSchema),
    responses: { 200: autoIngestResponseSchema },
    errors: [error(409, 'revision_conflict'), error(422, 'shared_brain_invariant')]
  }),
  operation({
    operationId: 'advx.shared-brain.meme-candidate.commit',
    method: 'POST',
    path: '/shared-brain/meme-candidates',
    guard: 'runtime',
    body: publicBody(memeCandidateSchema),
    responses: { 200: candidateCommitResponseSchema },
    errors: [error(409, 'revision_conflict'), error(422, 'shared_brain_invariant')]
  }),
  operation({
    operationId: 'advx.shared-brain.legacy-meme.import',
    method: 'POST',
    path: '/shared-brain/modes/{namespace_id}/legacy-memes/import',
    pathParams: namespacePathParamsSchema,
    guard: 'runtime',
    body: publicBody(legacyMemeImportRequestSchema),
    responses: { 200: legacyMemeImportResponseSchema },
    errors: [error(409, 'revision_conflict'), error(422, 'shared_brain_invariant')]
  }),
  operation({
    operationId: 'advx.shared-brain.meme-candidate.approve',
    method: 'POST',
    path: '/shared-brain/modes/{namespace_id}/meme-candidates/{candidate_id}/approve',
    pathParams: candidatePathParamsSchema,
    guard: 'runtime',
    responses: { 200: candidateCommitResponseSchema },
    errors: [error(409, 'revision_conflict'), error(422, 'shared_brain_invariant')]
  }),
  operation({
    operationId: 'advx.shared-brain.meme-candidate.reject',
    method: 'POST',
    path: '/shared-brain/modes/{namespace_id}/meme-candidates/{candidate_id}/reject',
    pathParams: candidatePathParamsSchema,
    guard: 'runtime',
    responses: { 200: memeCandidateSchema },
    errors: [error(409, 'revision_conflict'), error(422, 'shared_brain_invariant')]
  }),
  operation({
    operationId: 'advx.shared-brain.meme.edit',
    method: 'PUT',
    path: '/shared-brain/modes/{namespace_id}/memes/{meme_id}',
    pathParams: memePathParamsSchema,
    guard: 'runtime',
    body: publicBody(memeEditRequestSchema),
    responses: { 200: modeMemeSchema },
    errors: [error(409, 'revision_conflict'), error(422, 'shared_brain_invariant')]
  })
] as const satisfies readonly HttpOperation[]

export const HTTP_OPERATION_COUNT = 47 as const

if (httpOperations.length !== HTTP_OPERATION_COUNT) {
  throw new Error(`Expected ${HTTP_OPERATION_COUNT} HTTP operations`)
}

const operationEntries = httpOperations.map((entry) => [
  `${entry.method} ${entry.path}`,
  entry
] as const)
if (new Set(operationEntries.map(([key]) => key)).size !== operationEntries.length) {
  throw new Error('Duplicate HTTP method/path binding')
}
if (new Set(httpOperations.map((entry) => entry.operationId)).size !== httpOperations.length) {
  throw new Error('Duplicate HTTP operation ID')
}
if (httpOperations.some((entry) => entry.errors.length === 0)) {
  throw new Error('Every HTTP operation must declare normalized errors')
}

export const httpOperationRegistry: Readonly<Record<string, HttpOperation>> =
  Object.freeze(Object.fromEntries(operationEntries))
