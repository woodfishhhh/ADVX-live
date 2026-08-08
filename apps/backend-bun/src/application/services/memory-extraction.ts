import type {
  Epoch,
  Revision,
  RoomId,
  SessionId
} from '@advx/contracts'

import {
  createModelRequestBudget,
  monotonicDeadline,
  protocolRepairAttempt,
  type CancellationReason,
  type ModelGenerationRequest,
  type ModelProvider,
  type ProviderCallContext,
  type ProviderIdentity,
  type ProviderRoleModel,
  createTraceContext
} from '../ports'
import type {
  RoomMemoryEvidence,
  RoomMemoryType
} from '../ports/repositories'

export const ROOM_MEMORY_EXTRACTION_SCHEMA_NAME = 'room_memory_extraction_v1'
export const ROOM_MEMORY_EXTRACTION_MAX_CANDIDATES = 32
export const ROOM_MEMORY_EXTRACTION_TIMEOUT_MS = 2_000
export const ROOM_MEMORY_EXTRACTION_MAX_OUTPUT_TOKENS = 4_096

export type RoomMemoryExtractionScope = Readonly<{
  roomId: RoomId
  sessionId: SessionId
  audienceEpoch: Epoch
  observationId: string
}>

export type RoomMemoryExtractionInput = Readonly<{
  scope: RoomMemoryExtractionScope
  events: readonly RoomMemoryEvidence[]
  currentRevision: Revision
}>

export type ExtractedRoomMemoryCandidate = Readonly<{
  memoryType: RoomMemoryType
  content: string
  evidenceEventIds: readonly string[]
  tags: readonly string[]
  importance: number
  confidence: number
}>

export interface RoomMemoryExtractorPort {
  extract(
    input: RoomMemoryExtractionInput,
    signal: AbortSignal
  ): Promise<readonly ExtractedRoomMemoryCandidate[]>
}

export type ModelRoomMemoryExtractorDependencies = Readonly<{
  provider: Pick<ModelProvider, 'generate'>
  providerIdentity: ProviderIdentity<'model'>
  roleModel: ProviderRoleModel<'memory'>
  nextRequestId?: () => string
  monotonicNow?: () => number
  timeoutMs?: number
}>

export class ModelRoomMemoryExtractorError extends Error {
  constructor(
    readonly code: 'invalid_input' | 'provider_failure' | 'invalid_output',
    message: string
  ) {
    super(message)
    this.name = 'ModelRoomMemoryExtractorError'
  }
}

export class ModelRoomMemoryExtractor implements RoomMemoryExtractorPort {
  readonly #nextRequestId: () => string
  readonly #monotonicNow: () => number
  readonly #timeoutMs: number

  constructor(private readonly dependencies: ModelRoomMemoryExtractorDependencies) {
    this.#nextRequestId = dependencies.nextRequestId ?? (() => crypto.randomUUID())
    this.#monotonicNow = dependencies.monotonicNow ?? (() => performance.now())
    this.#timeoutMs = dependencies.timeoutMs ?? ROOM_MEMORY_EXTRACTION_TIMEOUT_MS
    if (!positiveInteger(this.#timeoutMs)) {
      throw new ModelRoomMemoryExtractorError(
        'invalid_input',
        'memory extraction timeout must be a positive integer'
      )
    }
    if (dependencies.roleModel.role !== 'memory') {
      throw new ModelRoomMemoryExtractorError(
        'invalid_input',
        'memory extraction requires the configured memory role model'
      )
    }
  }

  async extract(
    input: RoomMemoryExtractionInput,
    signal: AbortSignal
  ): Promise<readonly ExtractedRoomMemoryCandidate[]> {
    validateExtractionInput(input)
    if (signal.aborted) {
      throw new ModelRoomMemoryExtractorError(
        'provider_failure',
        'memory extraction was cancelled before dispatch'
      )
    }

    const requestId = this.#nextRequestId()
    if (requestId.trim().length === 0) {
      throw new ModelRoomMemoryExtractorError(
        'invalid_input',
        'memory extraction request ID must not be empty'
      )
    }
    const request = modelRequest(
      requestId,
      input,
      this.dependencies.providerIdentity,
      this.dependencies.roleModel,
      createTraceContext({
        correlation: {
          requestId,
          roomId: input.scope.roomId,
          sessionId: input.scope.sessionId,
          epoch: input.scope.audienceEpoch,
          observationId: input.scope.observationId
        }
      })
    )
    const controller = new AbortController()
    let timedOut = false
    const abortFromCaller = () => controller.abort(signal.reason)
    signal.addEventListener('abort', abortFromCaller, { once: true })
    const timeout = setTimeout(() => {
      timedOut = true
      controller.abort('memory_extraction_deadline')
    }, this.#timeoutMs)
    const context: ProviderCallContext = {
      callerSignal: controller.signal,
      deadline: monotonicDeadline(this.#monotonicNow() + this.#timeoutMs),
      traceContext: request.traceContext,
      cancellationReason: (): CancellationReason | undefined => {
        if (timedOut) {
          return { code: 'deadline_exceeded', messageCode: 'memory_extraction_timeout' }
        }
        if (signal.aborted) {
          return { code: 'caller_cancelled', messageCode: 'memory_extraction_cancelled' }
        }
        return undefined
      }
    }

    try {
      const outcome = await this.dependencies.provider.generate(
        request,
        context,
        createModelRequestBudget()
      )
      if (!outcome.ok) {
        throw new ModelRoomMemoryExtractorError(
          'provider_failure',
          `memory Provider failed with ${outcome.error.code}`
        )
      }
      if (
        outcome.value.finishReason !== 'stop' ||
        outcome.value.output.type !== 'structured' ||
        outcome.value.output.schemaName !== ROOM_MEMORY_EXTRACTION_SCHEMA_NAME
      ) {
        throw new ModelRoomMemoryExtractorError(
          'invalid_output',
          'memory Provider did not return the required structured result'
        )
      }
      return parseMemoryExtractionOutput(
        outcome.value.output.text,
        new Set(input.events.map((event) => event.eventId))
      )
    } finally {
      clearTimeout(timeout)
      signal.removeEventListener('abort', abortFromCaller)
    }
  }
}

export function parseMemoryExtractionOutput(
  text: string,
  allowedEvidenceEventIds: ReadonlySet<string>
): readonly ExtractedRoomMemoryCandidate[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ModelRoomMemoryExtractorError(
      'invalid_output',
      'memory Provider returned invalid JSON'
    )
  }
  if (!plainObject(raw) || !exactKeys(raw, ['candidates'])) {
    throw new ModelRoomMemoryExtractorError(
      'invalid_output',
      'memory Provider response must contain only candidates'
    )
  }
  const candidates = raw.candidates
  if (
    !Array.isArray(candidates) ||
    candidates.length > ROOM_MEMORY_EXTRACTION_MAX_CANDIDATES
  ) {
    throw new ModelRoomMemoryExtractorError(
      'invalid_output',
      'memory candidate list exceeds its bounded contract'
    )
  }

  const accepted: ExtractedRoomMemoryCandidate[] = []
  for (const candidate of candidates) {
    const parsed = parseCandidate(candidate, allowedEvidenceEventIds)
    if (parsed !== null) accepted.push(parsed)
  }
  return deepFreeze(accepted)
}

function modelRequest(
  requestId: string,
  input: RoomMemoryExtractionInput,
  provider: ProviderIdentity<'model'>,
  roleModel: ProviderRoleModel<'memory'>,
  traceContext: import('../ports/observability').TraceContext
): ModelGenerationRequest {
  return {
    requestId,
    traceContext,
    provider,
    roleModel,
    purpose: 'memory',
    messages: [
      {
        role: 'system',
        content: [{
          type: 'text',
          text: [
            'Extract zero or more durable room memory candidates from public events only.',
            'Use only supplied evidence IDs. Do not infer missing evidence.',
            'Facts and preferences require downstream non-AI evidence validation.',
            'Return exactly one JSON object with only a candidates array.',
            'Each candidate has memory_type, content, evidence_event_ids, tags, importance, and confidence.'
          ].join(' ')
        }]
      },
      {
        role: 'user',
        content: [{
          type: 'text',
          text: JSON.stringify({
            room_id: input.scope.roomId,
            session_id: input.scope.sessionId,
            audience_epoch: input.scope.audienceEpoch,
            observation_id: input.scope.observationId,
            current_revision: input.currentRevision,
            public_events: input.events.map((event) => ({
              event_id: event.eventId,
              source_type: event.sourceType,
              occurred_at_ms: event.occurredAt,
              summary: event.summary
            }))
          })
        }]
      }
    ],
    output: { type: 'structured', schemaName: ROOM_MEMORY_EXTRACTION_SCHEMA_NAME },
    stream: false,
    protocolRepairAttempt: protocolRepairAttempt(0),
    maxOutputTokens: ROOM_MEMORY_EXTRACTION_MAX_OUTPUT_TOKENS
  }
}

function validateExtractionInput(input: RoomMemoryExtractionInput): void {
  const { scope, events } = input
  if (
    scope.roomId.trim().length === 0 ||
    scope.sessionId.trim().length === 0 ||
    scope.observationId.trim().length === 0 ||
    !positiveInteger(Number(scope.audienceEpoch)) ||
    !nonnegativeInteger(Number(input.currentRevision)) ||
    events.length < 1 ||
    events.length > 128
  ) {
    throw new ModelRoomMemoryExtractorError(
      'invalid_input',
      'memory extraction scope, revision, or evidence bound is invalid'
    )
  }
  const ids = new Set<string>()
  for (const event of events) {
    if (
      event.eventId.trim().length === 0 ||
      ids.has(event.eventId) ||
      !Number.isFinite(event.occurredAt) ||
      event.occurredAt < 0 ||
      [...event.summary].length > 1_000
    ) {
      throw new ModelRoomMemoryExtractorError(
        'invalid_input',
        'memory extraction evidence is invalid or duplicated'
      )
    }
    ids.add(event.eventId)
  }
}

function parseCandidate(
  raw: unknown,
  allowedEvidenceEventIds: ReadonlySet<string>
): ExtractedRoomMemoryCandidate | null {
  if (
    !plainObject(raw) ||
    !exactKeys(raw, [
      'memory_type',
      'content',
      'evidence_event_ids',
      'tags',
      'importance',
      'confidence'
    ]) ||
    !memoryType(raw.memory_type) ||
    typeof raw.content !== 'string' ||
    !Array.isArray(raw.evidence_event_ids) ||
    !Array.isArray(raw.tags) ||
    !unitInterval(raw.importance) ||
    !unitInterval(raw.confidence)
  ) return null

  const content = raw.content.trim()
  if (content.length === 0 || [...content].length > 4_000) return null
  if (
    raw.evidence_event_ids.length < 1 ||
    raw.evidence_event_ids.length > 128 ||
    raw.evidence_event_ids.some((value) =>
      typeof value !== 'string' ||
      value.trim().length === 0 ||
      !allowedEvidenceEventIds.has(value)
    ) ||
    new Set(raw.evidence_event_ids).size !== raw.evidence_event_ids.length
  ) return null
  if (
    raw.tags.length > 32 ||
    raw.tags.some((value) =>
      typeof value !== 'string' ||
      value.trim().length === 0 ||
      [...value.trim()].length > 128
    )
  ) return null

  return deepFreeze({
    memoryType: raw.memory_type,
    content,
    evidenceEventIds: raw.evidence_event_ids,
    tags: raw.tags.map((tag) => tag.trim()),
    importance: raw.importance,
    confidence: raw.confidence
  })
}

function memoryType(value: unknown): value is RoomMemoryType {
  return value === 'user_preference' ||
    value === 'real_world_fact' ||
    value === 'room_lore' ||
    value === 'shared_experience'
}

function unitInterval(value: unknown): value is number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  return keys.length === sortedExpected.length &&
    keys.every((key, index) => key === sortedExpected[index])
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0
}

function nonnegativeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const item of Object.values(value)) deepFreeze(item)
  return value
}
