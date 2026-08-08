import {
  VIEWER_GENERATION_SCHEMA_NAME,
  type Revision,
  type ViewerModelOutput
} from '@advx/contracts'

import {
  protocolRepairAttempt,
  providerRevision,
  type ModelGenerationRequest,
  type ProviderFailure,
  createTraceContext,
  type TraceContext,
  type WallClockTimestampMs
} from '../ports'
import type {
  ModelRequestScheduler,
  ModelSchedulingResult,
  ModelSchedulingStatus,
  ModelSchedulingTrigger,
  ScheduledModelTask
} from './model-request-scheduler'
import {
  ModelOutputValidationService,
  type ValidatedViewerGeneration,
  type ViewerOutputFence
} from './model-output-validation'
import type {
  ViewerDecisionContext,
  ViewerDecisionFence
} from './viewer-decision-context'

export const VIEWER_BATCH_INTERVAL_MS = 500
export const VIEWER_GENERATION_MAX_OUTPUT_TOKENS = 1_024

export type ViewerGenerationInput = Readonly<{
  context: ViewerDecisionContext
  trigger: ModelSchedulingTrigger
  callerSignal?: AbortSignal
  traceContext?: TraceContext
}>

export type ViewerGenerationAcceptanceInput = Readonly<{
  context: ViewerDecisionContext
  generation: ValidatedViewerGeneration
  signal: AbortSignal
}>

export interface ViewerBarrageAcceptancePort {
  acceptedTextIndexes(
    input: ViewerGenerationAcceptanceInput
  ): Promise<readonly number[]>
}

export type AcceptedViewerBarragePublication = Readonly<{
  contextId: string
  selectionId: string
  batchId: string
  batchIndex: number
  batchSize: number
  sourceTextIndex: number
  generationRequestId: string
  fence: ViewerDecisionFence
  viewer: ViewerDecisionContext['viewer']
  intent: ViewerModelOutput['intent']
  reactionType: string
  target: ViewerModelOutput['target']
  parentEventId: string | null
  evidenceRefs: ViewerModelOutput['evidence_refs']
  relatedInputEventIds: readonly string[]
  allowedEvidenceEventIds: readonly string[]
  replyableEventIds: readonly string[]
  activeViewerIds: readonly string[]
  frameCount: number
  roomMemoryRevision: Revision
  privateStateRevision: number
  personaCooldownMs: number
  text: string
  deadlineAt: number
}>

export type ViewerBarragePublicationCommit = Readonly<{
  publicationId: string
  publishedAt: WallClockTimestampMs
}>

export interface ViewerBarragePublicationPort {
  commitToSharedHistoryIfCurrent(
    publication: AcceptedViewerBarragePublication,
    signal: AbortSignal
  ): Promise<ViewerBarragePublicationCommit | null>
}

export interface ViewerFrameLoader {
  load(
    frame: ViewerDecisionContext['frames']['frames'][number],
    signal: AbortSignal
  ): Promise<Readonly<Uint8Array>>
}

export type PublishedViewerBarrage = Readonly<{
  publicationId: string
  publishedAt: WallClockTimestampMs
  sourceTextIndex: number
  text: string
}>

export type ViewerGenerationOutcomeStatus =
  | 'silence'
  | 'published'
  | 'interrupted'
  | 'rejected'
  | 'failed'

export type ViewerGenerationOutcome = Readonly<{
  status: ViewerGenerationOutcomeStatus
  contextId: string
  viewerInstanceId: string
  generationRequestId: string
  schedulingStatus: ModelSchedulingStatus
  physicalRequests: number
  retries: 0 | 1
  generation: ValidatedViewerGeneration | null
  published: readonly PublishedViewerBarrage[]
  droppedTextCount: number
  failure: ProviderFailure | null
}>

export type ViewerGenerationDependencies = Readonly<{
  scheduler: Pick<ModelRequestScheduler, 'schedule'>
  outputValidation: ModelOutputValidationService
  acceptance: ViewerBarrageAcceptancePort
  publication: ViewerBarragePublicationPort
  frames: ViewerFrameLoader
  monotonicNow?: () => number
  wallClockNow?: () => number
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>
}>

type CompletedViewerGenerationSchedule = Extract<
  ModelSchedulingResult<ValidatedViewerGeneration>,
  { status: 'completed' }
>

export class ViewerGenerationError extends Error {
  constructor(
    readonly code:
      | 'invalid_context'
      | 'duplicate_context'
      | 'invalid_acceptance'
      | 'invalid_publication',
    message: string
  ) {
    super(message)
    this.name = 'ViewerGenerationError'
  }
}

export class ViewerGenerationService {
  readonly #monotonicNow: () => number
  readonly #wallClockNow: () => number
  readonly #sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>

  constructor(private readonly dependencies: ViewerGenerationDependencies) {
    this.#monotonicNow = dependencies.monotonicNow ?? (() => performance.now())
    this.#wallClockNow = dependencies.wallClockNow ?? (() => Date.now())
    this.#sleep = dependencies.sleep ?? abortableSleep
  }

  runCandidates(
    inputs: readonly ViewerGenerationInput[]
  ): Promise<readonly ViewerGenerationOutcome[]> {
    const contextIds = inputs.map((input) => input.context.contextId)
    if (new Set(contextIds).size !== contextIds.length) {
      throw new ViewerGenerationError(
        'duplicate_context',
        'one candidate context may create only one logical generation'
      )
    }
    return Promise.all(inputs.map((input) => this.runCandidate(input)))
  }

  async runCandidate(
    input: ViewerGenerationInput
  ): Promise<ViewerGenerationOutcome> {
    validateInput(input)
    const context = input.context
    const generationRequestId = `viewer-generation-${context.contextId}`
    const traceContext = input.traceContext ?? createTraceContext({
      correlation: {
        requestId: generationRequestId,
        roomId: context.fence.roomId,
        sessionId: context.fence.sessionId,
        epoch: context.fence.audienceEpoch,
        sequence: context.fence.viewerSequence,
        observationId: context.fence.observationId,
        generationId: generationRequestId
      }
    })
    const signal = input.callerSignal ?? new AbortController().signal
    const deadlineAt = this.#schedulerDeadline(context.fence.deadlineAt)
    const task: ScheduledModelTask<ValidatedViewerGeneration> = {
      taskId: generationRequestId,
      triggerId: context.fence.observationId,
      traceContext,
      trigger: input.trigger,
      laneKey: `${context.fence.sessionId}:${context.fence.viewerInstanceId}`,
      rateKey: context.fence.sessionId,
      deadlineAt,
      callerSignal: signal,
      execute: async ({ context: callContext, requestBudget }) => {
        const request = await buildViewerGenerationRequest(
          context,
          generationRequestId,
          this.dependencies.frames,
          callContext.callerSignal,
          traceContext
        )
        return await this.dependencies.outputValidation.generateViewer(
          request,
          callContext,
          requestBudget,
          outputFence(context)
        )
      }
    }
    const scheduled = await this.dependencies.scheduler.schedule(task)
    if (scheduled.status !== 'completed') {
      return deepFrozenClone({
        status: nonCompletedOutcomeStatus(scheduled.status),
        contextId: context.contextId,
        viewerInstanceId: context.fence.viewerInstanceId,
        generationRequestId,
        schedulingStatus: scheduled.status,
        physicalRequests: scheduled.physicalRequests,
        retries: scheduled.retries,
        generation: null,
        published: [],
        droppedTextCount: 0,
        failure: scheduled.status === 'failed' ? scheduled.error : null
      })
    }

    const generation = scheduled.value
    if (generation.output.action === 'silence') {
      return deepFrozenClone({
        status: 'silence',
        contextId: context.contextId,
        viewerInstanceId: context.fence.viewerInstanceId,
        generationRequestId,
        schedulingStatus: scheduled.status,
        physicalRequests: scheduled.physicalRequests,
        retries: scheduled.retries,
        generation,
        published: [],
        droppedTextCount: 0,
        failure: null
      })
    }

    let acceptedIndexes: readonly number[]
    try {
      acceptedIndexes = validateAcceptedIndexes(
        await this.dependencies.acceptance.acceptedTextIndexes({
          context,
          generation,
          signal
        }),
        generation.publicationTexts.length
      )
    } catch (error) {
      if (error instanceof ViewerGenerationError) throw error
      return failedAfterGeneration(
        context,
        generationRequestId,
        scheduled,
        generation
      )
    }
    if (acceptedIndexes.length === 0) {
      return deepFrozenClone({
        status: 'rejected',
        contextId: context.contextId,
        viewerInstanceId: context.fence.viewerInstanceId,
        generationRequestId,
        schedulingStatus: scheduled.status,
        physicalRequests: scheduled.physicalRequests,
        retries: scheduled.retries,
        generation,
        published: [],
        droppedTextCount: generation.publicationTexts.length,
        failure: null
      })
    }

    const published: PublishedViewerBarrage[] = []
    let nextReleaseAt: number | null = null
    for (let batchIndex = 0; batchIndex < acceptedIndexes.length; batchIndex += 1) {
      const sourceTextIndex = acceptedIndexes[batchIndex]!
      if (signal.aborted || this.#wallClockNow() >= context.fence.deadlineAt) {
        return interruptedOutcome(
          context,
          generationRequestId,
          scheduled,
          generation,
          published,
          generation.publicationTexts.length - published.length
        )
      }
      if (nextReleaseAt !== null) {
        try {
          await this.#sleep(
            Math.max(0, nextReleaseAt - this.#wallClockNow()),
            signal
          )
        } catch {
          return interruptedOutcome(
            context,
            generationRequestId,
            scheduled,
            generation,
            published,
            generation.publicationTexts.length - published.length
          )
        }
      }
      if (signal.aborted || this.#wallClockNow() >= context.fence.deadlineAt) {
        return interruptedOutcome(
          context,
          generationRequestId,
          scheduled,
          generation,
          published,
          generation.publicationTexts.length - published.length
        )
      }

      const publication = publicationFor(
        context,
        generation,
        generationRequestId,
        acceptedIndexes,
        batchIndex,
        sourceTextIndex
      )
      let committed: ViewerBarragePublicationCommit | null
      try {
        committed = await this.dependencies.publication
          .commitToSharedHistoryIfCurrent(publication, signal)
      } catch {
        return deepFrozenClone({
          status: 'failed',
          contextId: context.contextId,
          viewerInstanceId: context.fence.viewerInstanceId,
          generationRequestId,
          schedulingStatus: scheduled.status,
          physicalRequests: scheduled.physicalRequests,
          retries: scheduled.retries,
          generation,
          published,
          droppedTextCount: generation.publicationTexts.length - published.length,
          failure: null
        })
      }
      if (committed === null) {
        return interruptedOutcome(
          context,
          generationRequestId,
          scheduled,
          generation,
          published,
          generation.publicationTexts.length - published.length
        )
      }
      validatePublicationCommit(committed)
      published.push({
        publicationId: committed.publicationId,
        publishedAt: committed.publishedAt,
        sourceTextIndex,
        text: publication.text
      })
      nextReleaseAt = committed.publishedAt + VIEWER_BATCH_INTERVAL_MS
    }

    return deepFrozenClone({
      status: 'published',
      contextId: context.contextId,
      viewerInstanceId: context.fence.viewerInstanceId,
      generationRequestId,
      schedulingStatus: scheduled.status,
      physicalRequests: scheduled.physicalRequests,
      retries: scheduled.retries,
      generation,
      published,
      droppedTextCount: generation.publicationTexts.length - published.length,
      failure: null
    })
  }

  #schedulerDeadline(wallClockDeadline: number): number {
    return this.#monotonicNow() + Math.max(
      0,
      wallClockDeadline - this.#wallClockNow()
    )
  }
}

function nonCompletedOutcomeStatus(
  status: Exclude<ModelSchedulingStatus, 'completed'>
): Extract<ViewerGenerationOutcomeStatus, 'interrupted' | 'rejected' | 'failed'> {
  if (status === 'failed') return 'failed'
  if (
    status === 'cancelled' ||
    status === 'superseded' ||
    status === 'expired' ||
    status === 'closed'
  ) {
    return 'interrupted'
  }
  return 'rejected'
}

export async function buildViewerGenerationRequest(
  context: ViewerDecisionContext,
  requestId: string,
  frames: ViewerFrameLoader,
  signal: AbortSignal,
  traceContext?: TraceContext
): Promise<ModelGenerationRequest> {
  const imageParts = await Promise.all(
    context.frames.frames.map(async (frame) => ({
      type: 'image' as const,
      mediaType: frame.encoding,
      bytes: await frames.load(frame, signal)
    }))
  )
  return deepFrozenClone({
    requestId,
    ...(traceContext === undefined ? {} : { traceContext }),
    provider: {
      kind: 'model' as const,
      providerProfileId: context.fence.providerProfileId,
      providerRevision: providerRevision(context.fence.providerRevision)
    },
    roleModel: {
      role: 'viewer' as const,
      modelId: context.fence.viewerModelId
    },
    purpose: 'viewer' as const,
    messages: [
      {
        role: 'system' as const,
        content: [{ type: 'text' as const, text: VIEWER_SYSTEM_INSTRUCTION }]
      },
      {
        role: 'user' as const,
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(providerPrompt(context))
          },
          ...imageParts
        ]
      }
    ],
    output: {
      type: 'structured' as const,
      schemaName: VIEWER_GENERATION_SCHEMA_NAME
    },
    stream: false as const,
    protocolRepairAttempt: protocolRepairAttempt(0),
    maxOutputTokens: VIEWER_GENERATION_MAX_OUTPUT_TOKENS
  })
}

const VIEWER_SYSTEM_INSTRUCTION = [
  'You are exactly one independent live-room Viewer, never a Director or group narrator.',
  'Use only the supplied frozen context and your own Persona/private state.',
  'Return one JSON object for viewer_generation_v1 with action barrage or silence.',
  'Silence is always legal, including when directly mentioned, and must use intent and reaction_type silence with null target and texts.',
  'For barrage, normally return 3-6 distinct complete short texts, preferably within 20 Chinese characters each.',
  'Use only supplied event IDs, frame indexes, active Viewer IDs, and replyable event IDs for evidence or targets.',
  'Do not invent server-owned generation, Viewer, sequence, or publication identities.'
].join(' ')

function providerPrompt(context: ViewerDecisionContext): unknown {
  return {
    schema: VIEWER_GENERATION_SCHEMA_NAME,
    context_id: context.contextId,
    selection_id: context.selectionId,
    observation: {
      room_id: context.fence.roomId,
      session_id: context.fence.sessionId,
      audience_epoch: context.fence.audienceEpoch,
      observation_id: context.fence.observationId,
      runtime_revision: context.fence.runtimeRevision,
      viewer_sequence: context.fence.viewerSequence,
      deadline_at_ms: context.fence.deadlineAt
    },
    viewer: context.viewer,
    active_viewer_ids: context.activeViewerIds,
    current_input: context.currentInput.map(providerEvent),
    public_context: context.publicContext.map(providerEvent),
    reply_context: context.replyContext.map(providerEvent),
    frames: context.frames.frames.map((frame) => ({
      frame_index: frame.frameIndex,
      captured_at_ms: frame.capturedAt,
      width: frame.width,
      height: frame.height,
      change_score: frame.changeScore
    })),
    mention: context.mention,
    room_memory: context.roomMemory,
    persona: context.persona,
    private_context: context.privateContext,
    decision: context.decision
  }
}

function providerEvent(event: ViewerDecisionContext['publicContext'][number]): unknown {
  return {
    event_id: event.eventId,
    sequence: event.sequence,
    source_type: event.sourceType,
    source_id: event.sourceId,
    audience_epoch: event.audienceEpoch,
    text: event.text,
    payload: event.payload,
    evidence_event_ids: event.evidenceEventIds,
    occurred_at_ms: event.occurredAt
  }
}

function outputFence(context: ViewerDecisionContext): ViewerOutputFence {
  return {
    allowedEventIds: [...new Set([
      ...context.publicContext.map((event) => event.eventId),
      ...context.replyContext.map((event) => event.eventId)
    ])],
    frameCount: context.frames.frames.length,
    activeViewerIds: context.activeViewerIds,
    replyableEventIds: context.replyContext.map((event) => event.eventId)
  }
}

function publicationFor(
  context: ViewerDecisionContext,
  generation: ValidatedViewerGeneration,
  generationRequestId: string,
  acceptedIndexes: readonly number[],
  batchIndex: number,
  sourceTextIndex: number
): AcceptedViewerBarragePublication {
  const target = generation.output.target
  return deepFrozenClone({
    contextId: context.contextId,
    selectionId: context.selectionId,
    batchId: generationRequestId,
    batchIndex,
    batchSize: acceptedIndexes.length,
    sourceTextIndex,
    generationRequestId,
    fence: context.fence,
    viewer: context.viewer,
    intent: generation.output.intent,
    reactionType: generation.output.reaction_type,
    target,
    parentEventId: target?.kind === 'event' ? target.event_id ?? null : null,
    evidenceRefs: generation.output.evidence_refs,
    relatedInputEventIds: context.currentInput.map((event) => event.eventId),
    allowedEvidenceEventIds: [...new Set([
      ...context.publicContext.map((event) => event.eventId),
      ...context.replyContext.map((event) => event.eventId)
    ])],
    replyableEventIds: context.replyContext.map((event) => event.eventId),
    activeViewerIds: context.activeViewerIds,
    frameCount: context.frames.frames.length,
    roomMemoryRevision: context.roomMemory.memoryRevision,
    privateStateRevision: context.privateContext.state.revision,
    personaCooldownMs: context.persona.resolved.cooldown_ms,
    text: generation.publicationTexts[sourceTextIndex]!.trim(),
    deadlineAt: context.fence.deadlineAt
  })
}

function validateInput(input: ViewerGenerationInput): void {
  const { context } = input
  if (
    context.decision.generationMode !== 'per_viewer' ||
    context.decision.silenceAllowed !== true ||
    context.decision.directMentionForcesSpeech !== false ||
    context.decision.independentDecision !== true ||
    context.decision.globalRankingAllowed !== false ||
    context.fence.viewerInstanceId !== context.viewer.viewerInstanceId ||
    context.fence.deadlineAt < 0
  ) {
    throw new ViewerGenerationError(
      'invalid_context',
      'Viewer generation requires the accepted independent decision context'
    )
  }
  const directMention = context.mention.viewerMentioned ||
    context.mention.personaMentioned
  if ((input.trigger === 'direct') !== directMention) {
    throw new ViewerGenerationError(
      'invalid_context',
      'direct scheduling must match accurate mention metadata'
    )
  }
}

function validateAcceptedIndexes(
  values: readonly number[],
  textCount: number
): readonly number[] {
  let prior = -1
  for (const value of values) {
    if (
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value >= textCount ||
      value <= prior
    ) {
      throw new ViewerGenerationError(
        'invalid_acceptance',
        'accepted text indexes must be unique, ordered, and generation-owned'
      )
    }
    prior = value
  }
  return Object.freeze([...values])
}

function validatePublicationCommit(commit: ViewerBarragePublicationCommit): void {
  if (
    commit.publicationId.trim().length === 0 ||
    commit.publicationId.length > 512 ||
    !Number.isFinite(commit.publishedAt) ||
    commit.publishedAt < 0
  ) {
    throw new ViewerGenerationError(
      'invalid_publication',
      'publication commit identity or timestamp is invalid'
    )
  }
}

function interruptedOutcome(
  context: ViewerDecisionContext,
  generationRequestId: string,
  scheduled: CompletedViewerGenerationSchedule,
  generation: ValidatedViewerGeneration,
  published: readonly PublishedViewerBarrage[],
  droppedTextCount: number
): ViewerGenerationOutcome {
  return deepFrozenClone({
    status: 'interrupted',
    contextId: context.contextId,
    viewerInstanceId: context.fence.viewerInstanceId,
    generationRequestId,
    schedulingStatus: scheduled.status,
    physicalRequests: scheduled.physicalRequests,
    retries: scheduled.retries,
    generation,
    published,
    droppedTextCount,
    failure: null
  })
}

function failedAfterGeneration(
  context: ViewerDecisionContext,
  generationRequestId: string,
  scheduled: CompletedViewerGenerationSchedule,
  generation: ValidatedViewerGeneration
): ViewerGenerationOutcome {
  return deepFrozenClone({
    status: 'failed',
    contextId: context.contextId,
    viewerInstanceId: context.fence.viewerInstanceId,
    generationRequestId,
    schedulingStatus: scheduled.status,
    physicalRequests: scheduled.physicalRequests,
    retries: scheduled.retries,
    generation,
    published: [],
    droppedTextCount: generation.publicationTexts.length,
    failure: null
  })
}

function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (milliseconds <= 0) return Promise.resolve()
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, milliseconds)
    signal.addEventListener('abort', aborted, { once: true })

    function done(): void {
      signal.removeEventListener('abort', aborted)
      resolve()
    }

    function aborted(): void {
      clearTimeout(timer)
      reject(signal.reason)
    }
  })
}

function deepFrozenClone<T>(value: T): T {
  return deepFreeze(structuredClone(value))
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    if (ArrayBuffer.isView(value)) return value
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
