import type {
  Epoch,
  ObservationTrigger,
  Revision,
  RoomId,
  SessionId
} from '@advx/contracts'

import {
  wallClockTimestampMs,
  type RoomEventContextQuery,
  type RoomEventContextWindow,
  type RoomEventRecord,
  type RoomMemorySlice,
  type WallClockTimestampMs
} from '../ports'

export const OBSERVATION_MERGE_WINDOW_MS = 1_000
export const OBSERVATION_REQUEST_TTL_MS = 30_000
export const OBSERVATION_PUBLIC_WINDOW_MS = 60_000
export const OBSERVATION_PUBLIC_LIMIT = 48
export const OBSERVATION_REPLY_WINDOW_MS = 30_000
export const OBSERVATION_REPLY_LIMIT = 8
export const FRAME_TIMELINE_WINDOW_MS = 120_000
export const DIRECT_FRAME_WINDOW_MS = 30_000
export const FRAME_SIMILARITY_THRESHOLD = 0.9
export const FRAME_SEGMENT_ANCHOR_MS = 5_000
export const FRAME_BUNDLE_LIMIT = 15
export const SCREEN_CHANGE_THRESHOLD = 0.2
export const SCREEN_TRIGGER_COOLDOWN_MS = 5_000

export type ObservationEventSource =
  | 'user_text'
  | 'final_voice'
  | 'system_audio'
  | 'frame'
  | 'ambient_tick'
  | 'audience_barrage'

export type ObservationFrame = Readonly<{
  frameId: string
  capturedAt: WallClockTimestampMs
  width: number
  height: number
  encoding: string
  contentHash: string
  dataRef: string
  changeScore: number
}>

type ObservationInputBase = Readonly<{
  eventId: string
  occurredAt: WallClockTimestampMs
}>

export type ObservationInputEvent =
  | (ObservationInputBase & Readonly<{
      source: 'user_text' | 'final_voice' | 'system_audio' | 'ambient_tick'
    }>)
  | (ObservationInputBase & Readonly<{
      source: 'frame'
      frame: ObservationFrame
      screenChangeScore: number
    }>)
  | (ObservationInputBase & Readonly<{
      source: 'audience_barrage'
    }>)

export type ObservationTriggerEvent = Readonly<{
  eventId: string
  source: Exclude<ObservationEventSource, 'audience_barrage'>
  occurredAt: WallClockTimestampMs
  frameId: string | null
}>

export type ObservationVisualMode = 'direct_frames' | 'shared_summary'

export type ObservationFrameBundleItem = ObservationFrame & Readonly<{
  frameIndex: number
}>

export type ObservationFrameBundle = Readonly<{
  timelineWindowMs: typeof FRAME_TIMELINE_WINDOW_MS
  similarityThreshold: typeof FRAME_SIMILARITY_THRESHOLD
  anchorIntervalMs: typeof FRAME_SEGMENT_ANCHOR_MS
  maximumFrames: typeof FRAME_BUNDLE_LIMIT
  frames: readonly ObservationFrameBundleItem[]
}>

export type FrozenObservationContext = Readonly<{
  publicContext: readonly RoomEventRecord[]
  replyContext: readonly RoomEventRecord[]
  publicTriggerEventIds: readonly string[]
}>

export type ObservationWave = Readonly<{
  roomId: RoomId
  sessionId: SessionId
  audienceEpoch: Epoch
  runtimeRevision: Revision
  observationId: string
  replayIdentity: string
  createdAt: WallClockTimestampMs
  frozenAt: WallClockTimestampMs
  deadlineAt: WallClockTimestampMs
  mergeWindowEndsAt: WallClockTimestampMs
  priority: number
  triggers: readonly ObservationTrigger[]
  triggerEvents: readonly ObservationTriggerEvent[]
  inputEventIds: readonly string[]
  triggerFrameIds: readonly string[]
  context: FrozenObservationContext
  roomMemory: RoomMemorySlice
  frameBundle: ObservationFrameBundle
}>

export type ObservationContextReader = (
  query: RoomEventContextQuery
) => Promise<RoomEventContextWindow>

export type ObservationMemoryReader = (query: Readonly<{
  roomId: RoomId
  evidenceEventIds: readonly string[]
  observedAt: WallClockTimestampMs
  limit: number
}>) => Promise<RoomMemorySlice>

export type ObservationWaveDependencies = Readonly<{
  readContext: ObservationContextReader
  readRoomMemory: ObservationMemoryReader
  compareFrames(reference: ObservationFrame, candidate: ObservationFrame): number
  createReplayIdentity(canonicalInput: string): string
}>

export type ObservationWaveOptions = Readonly<{
  roomId: RoomId
  sessionId: SessionId
  audienceEpoch: Epoch
  runtimeRevision: Revision
  sessionStartedAt: WallClockTimestampMs
  visualMode?: ObservationVisualMode
}>

export type ObservationSubmissionStatus =
  | 'buffered'
  | 'emitted'
  | 'ignored_recursive_barrage'
  | 'ignored_repeated_frame'
  | 'dropped_screen_cooldown'
  | 'dropped_screen_busy'
  | 'dropped_lower_priority'

export type ObservationSubmission = Readonly<{
  status: ObservationSubmissionStatus
  waves: readonly ObservationWave[]
}>

type PendingObservation = {
  readonly createdAt: WallClockTimestampMs
  readonly mergeWindowEndsAt: WallClockTimestampMs
  readonly events: ObservationInputEvent[]
}

const TRIGGER_BY_SOURCE: Readonly<
  Record<Exclude<ObservationEventSource, 'audience_barrage'>, ObservationTrigger>
> = Object.freeze({
  user_text: 'user_text',
  final_voice: 'final_voice',
  system_audio: 'system_audio',
  frame: 'screen_change',
  ambient_tick: 'ambient_tick'
})

const SOURCE_PRIORITY: Readonly<
  Record<Exclude<ObservationEventSource, 'audience_barrage'>, number>
> = Object.freeze({
  user_text: 50,
  final_voice: 50,
  system_audio: 40,
  frame: 30,
  ambient_tick: 10
})

export function observationTriggerPriority(source: ObservationEventSource): number {
  return source === 'audience_barrage' ? 0 : SOURCE_PRIORITY[source]
}

export class ObservationWaveService {
  readonly #options: Required<ObservationWaveOptions>
  readonly #dependencies: ObservationWaveDependencies
  readonly #framesBySecond = new Map<number, ObservationFrame>()
  readonly #processing = new Set<string>()
  #pending: PendingObservation | null = null
  #lastAcceptedTriggerAt: WallClockTimestampMs | null = null
  #operation: Promise<void> = Promise.resolve()

  constructor(
    options: ObservationWaveOptions,
    dependencies: ObservationWaveDependencies
  ) {
    positiveInteger(options.audienceEpoch, 'audience epoch')
    positiveInteger(options.runtimeRevision, 'runtime revision')
    this.#options = {
      ...options,
      visualMode: options.visualMode ?? 'direct_frames'
    }
    this.#dependencies = dependencies
  }

  submit(event: ObservationInputEvent): Promise<ObservationSubmission> {
    return this.#exclusive(() => this.#submit(event))
  }

  flush(observedAt: WallClockTimestampMs): Promise<ObservationWave | null> {
    return this.#exclusive(async () => {
      finiteTimestamp(observedAt, 'observation flush time')
      if (
        this.#pending === null ||
        observedAt < this.#pending.mergeWindowEndsAt
      ) {
        return null
      }
      return await this.#emitPending()
    })
  }

  completeWave(observationId: string): boolean {
    return this.#processing.delete(observationId)
  }

  get pending(): boolean {
    return this.#pending !== null
  }

  get processingCount(): number {
    return this.#processing.size
  }

  async #submit(event: ObservationInputEvent): Promise<ObservationSubmission> {
    validateInputEvent(event, this.#options.sessionStartedAt)
    const emitted: ObservationWave[] = []

    if (
      this.#pending !== null &&
      event.occurredAt >= this.#pending.mergeWindowEndsAt
    ) {
      emitted.push(await this.#emitPending())
    }

    if (event.source === 'audience_barrage') {
      return submission('ignored_recursive_barrage', emitted)
    }

    if (event.source === 'frame') {
      this.#recordFrame(event.frame)
      if (event.screenChangeScore < SCREEN_CHANGE_THRESHOLD) {
        return submission('ignored_repeated_frame', emitted)
      }
      if (this.#pending !== null || this.#processing.size > 0) {
        return submission('dropped_screen_busy', emitted)
      }
      if (
        this.#lastAcceptedTriggerAt !== null &&
        event.occurredAt - this.#lastAcceptedTriggerAt <
          SCREEN_TRIGGER_COOLDOWN_MS
      ) {
        return submission('dropped_screen_cooldown', emitted)
      }
      this.#lastAcceptedTriggerAt = event.occurredAt
      emitted.push(await this.#buildWave([event], event.occurredAt, event.occurredAt))
      return submission('emitted', emitted)
    }

    if (isNearbyInput(event)) {
      if (
        this.#pending !== null &&
        event.occurredAt < this.#pending.mergeWindowEndsAt
      ) {
        this.#pending.events.push(event)
      } else {
        this.#pending = {
          createdAt: event.occurredAt,
          mergeWindowEndsAt: wallClockTimestampMs(
            event.occurredAt + OBSERVATION_MERGE_WINDOW_MS
          ),
          events: [event]
        }
      }
      this.#lastAcceptedTriggerAt = event.occurredAt
      return submission('buffered', emitted)
    }

    if (
      this.#pending !== null &&
      observationTriggerPriority(event.source) < pendingPriority(this.#pending)
    ) {
      return submission('dropped_lower_priority', emitted)
    }

    this.#lastAcceptedTriggerAt = event.occurredAt
    emitted.push(await this.#buildWave([event], event.occurredAt, event.occurredAt))
    return submission('emitted', emitted)
  }

  async #emitPending(): Promise<ObservationWave> {
    const pending = this.#pending
    if (pending === null) throw new Error('pending observation is missing')
    const wave = await this.#buildWave(
      pending.events,
      pending.createdAt,
      pending.mergeWindowEndsAt
    )
    this.#pending = null
    return wave
  }

  async #buildWave(
    inputEvents: readonly ObservationInputEvent[],
    createdAt: WallClockTimestampMs,
    frozenAt: WallClockTimestampMs
  ): Promise<ObservationWave> {
    const events = [...inputEvents].sort(compareInputEvents)
    const inputEventIds = Object.freeze(events.map((event) => event.eventId))
    const triggerEvents = Object.freeze(events.map(triggerEvent))
    const triggerFrameIds = Object.freeze(
      events
        .filter((event): event is Extract<ObservationInputEvent, { source: 'frame' }> =>
          event.source === 'frame'
        )
        .map((event) => event.frame.frameId)
    )
    const triggers = Object.freeze(
      [...new Set(events.map((event) => TRIGGER_BY_SOURCE[event.source as Exclude<ObservationEventSource, 'audience_barrage'>]))]
        .sort((left, right) => triggerPriority(right) - triggerPriority(left))
    )
    const contextQuery: RoomEventContextQuery = {
      roomId: this.#options.roomId,
      sessionId: this.#options.sessionId,
      observedAt: frozenAt,
      publicWindowMs: OBSERVATION_PUBLIC_WINDOW_MS,
      replyWindowMs: OBSERVATION_REPLY_WINDOW_MS,
      publicLimit: OBSERVATION_PUBLIC_LIMIT,
      replyLimit: OBSERVATION_REPLY_LIMIT,
      triggerEventIds: inputEventIds
    }
    const [rawContext, rawMemory] = await Promise.all([
      this.#dependencies.readContext(contextQuery),
      this.#dependencies.readRoomMemory({
        roomId: this.#options.roomId,
        evidenceEventIds: inputEventIds,
        observedAt: frozenAt,
        limit: 16
      })
    ])
    const context = freezeContext(rawContext, frozenAt)
    const roomMemory = deepFrozenClone(rawMemory)
    const frameBundle = selectObservationFrames({
      frames: this.#timelineFrames(events, frozenAt),
      triggerFrameIds,
      observedAt: frozenAt,
      sessionStartedAt: this.#options.sessionStartedAt,
      visualMode: this.#options.visualMode,
      compareFrames: this.#dependencies.compareFrames
    })
    const deadlineAt = wallClockTimestampMs(createdAt + OBSERVATION_REQUEST_TTL_MS)
    const canonicalInput = JSON.stringify({
      schemaVersion: 1,
      roomId: this.#options.roomId,
      sessionId: this.#options.sessionId,
      audienceEpoch: this.#options.audienceEpoch,
      runtimeRevision: this.#options.runtimeRevision,
      createdAt,
      frozenAt,
      deadlineAt,
      triggers,
      triggerEvents,
      inputEventIds,
      triggerFrameIds,
      publicContext: context.publicContext.map((event) => [
        event.eventId,
        event.sequence,
        event.contentHash
      ]),
      replyContext: context.replyContext.map((event) => [
        event.eventId,
        event.sequence,
        event.contentHash
      ]),
      memoryRevision: roomMemory.memoryRevision,
      memoryIds: roomMemory.memoryIds,
      frames: frameBundle.frames.map((frame) => [
        frame.frameId,
        frame.capturedAt,
        frame.contentHash
      ])
    })
    const replayIdentity = this.#dependencies.createReplayIdentity(canonicalInput)
    if (!/^[0-9a-f]{64}$/.test(replayIdentity)) {
      throw new TypeError('replay identity must be a lowercase SHA-256 digest')
    }
    const wave = deepFrozenClone<ObservationWave>({
      roomId: this.#options.roomId,
      sessionId: this.#options.sessionId,
      audienceEpoch: this.#options.audienceEpoch,
      runtimeRevision: this.#options.runtimeRevision,
      observationId: `observation-${replayIdentity.slice(0, 48)}`,
      replayIdentity,
      createdAt,
      frozenAt,
      deadlineAt,
      mergeWindowEndsAt: wallClockTimestampMs(
        createdAt + OBSERVATION_MERGE_WINDOW_MS
      ),
      priority: Math.max(...events.map((event) => observationTriggerPriority(event.source))),
      triggers,
      triggerEvents,
      inputEventIds,
      triggerFrameIds,
      context,
      roomMemory,
      frameBundle
    })
    this.#processing.add(wave.observationId)
    return wave
  }

  #recordFrame(frame: ObservationFrame): void {
    const bucket = Math.floor(frame.capturedAt / 1_000)
    const current = this.#framesBySecond.get(bucket)
    if (
      current === undefined ||
      compareFramesChronologically(current, frame) <= 0
    ) {
      this.#framesBySecond.set(bucket, deepFrozenClone(frame))
    }
    this.#pruneFrames(frame.capturedAt)
  }

  #pruneFrames(observedAt: WallClockTimestampMs): void {
    const cutoff = observedAt - FRAME_TIMELINE_WINDOW_MS
    for (const [bucket, frame] of this.#framesBySecond) {
      if (frame.capturedAt <= cutoff && observedAt - this.#options.sessionStartedAt >= FRAME_TIMELINE_WINDOW_MS) {
        this.#framesBySecond.delete(bucket)
      }
    }
  }

  #timelineFrames(
    events: readonly ObservationInputEvent[],
    observedAt: WallClockTimestampMs
  ): readonly ObservationFrame[] {
    this.#pruneFrames(observedAt)
    const frames = [...this.#framesBySecond.values()]
    for (const event of events) {
      if (event.source === 'frame') frames.push(event.frame)
    }
    return frames
  }

  #exclusive<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const result = this.#operation.then(operation, operation)
    this.#operation = result.then(() => undefined, () => undefined)
    return result
  }
}

export function selectObservationFrames(input: Readonly<{
  frames: readonly ObservationFrame[]
  triggerFrameIds: readonly string[]
  observedAt: WallClockTimestampMs
  sessionStartedAt: WallClockTimestampMs
  visualMode: ObservationVisualMode
  compareFrames(reference: ObservationFrame, candidate: ObservationFrame): number
}>): ObservationFrameBundle {
  finiteTimestamp(input.observedAt, 'frame observation time')
  finiteTimestamp(input.sessionStartedAt, 'session start time')
  if (input.observedAt < input.sessionStartedAt) {
    throw new RangeError('frame observation time must not precede session start')
  }
  const triggerIds = new Set(input.triggerFrameIds)
  const sessionAge = input.observedAt - input.sessionStartedAt
  const cutoff = input.observedAt - FRAME_TIMELINE_WINDOW_MS
  const onePerSecond = oneFramePerSecond(input.frames, triggerIds)
  const timeline = onePerSecond.filter((frame) =>
    frame.capturedAt <= input.observedAt &&
    (triggerIds.has(frame.frameId) ||
      (sessionAge < FRAME_TIMELINE_WINDOW_MS
        ? frame.capturedAt >= input.sessionStartedAt
        : frame.capturedAt > cutoff))
  )
  const representatives = segmentRepresentatives(timeline, input.compareFrames)
  const triggerFrames = timeline.filter((frame) => triggerIds.has(frame.frameId))
  let selected = uniqueFrames([...representatives, ...triggerFrames])
  if (input.visualMode === 'direct_frames') {
    const directCutoff = input.observedAt - DIRECT_FRAME_WINDOW_MS
    selected = selected.filter(
      (frame) => frame.capturedAt >= directCutoff || triggerIds.has(frame.frameId)
    )
  }
  selected = uniformFrameSample(selected, triggerIds, FRAME_BUNDLE_LIMIT)
  const frames = Object.freeze(
    selected.map((frame, frameIndex) =>
      Object.freeze({ ...frame, frameIndex })
    )
  )
  return Object.freeze({
    timelineWindowMs: FRAME_TIMELINE_WINDOW_MS,
    similarityThreshold: FRAME_SIMILARITY_THRESHOLD,
    anchorIntervalMs: FRAME_SEGMENT_ANCHOR_MS,
    maximumFrames: FRAME_BUNDLE_LIMIT,
    frames
  })
}

function segmentRepresentatives(
  frames: readonly ObservationFrame[],
  compareFrames: ObservationWaveDependencies['compareFrames']
): ObservationFrame[] {
  if (frames.length === 0) return []
  const representatives: ObservationFrame[] = []
  let reference = frames[0]!
  let segmentEnd = reference
  for (const frame of frames.slice(1)) {
    const similarity =
      reference.contentHash === frame.contentHash
        ? 1
        : compareFrames(reference, frame)
    finiteUnitInterval(similarity, 'frame similarity')
    if (
      similarity < FRAME_SIMILARITY_THRESHOLD ||
      frame.capturedAt - reference.capturedAt > FRAME_SEGMENT_ANCHOR_MS
    ) {
      representatives.push(segmentEnd)
      reference = frame
    }
    segmentEnd = frame
  }
  representatives.push(segmentEnd)
  return representatives
}

function oneFramePerSecond(
  frames: readonly ObservationFrame[],
  triggerIds: ReadonlySet<string>
): ObservationFrame[] {
  const buckets = new Map<number, ObservationFrame>()
  for (const frame of [...frames].sort(compareFramesChronologically)) {
    validateFrame(frame)
    const bucket = Math.floor(frame.capturedAt / 1_000)
    const current = buckets.get(bucket)
    if (
      current === undefined ||
      (!triggerIds.has(current.frameId) && triggerIds.has(frame.frameId)) ||
      (triggerIds.has(current.frameId) === triggerIds.has(frame.frameId) &&
        compareFramesChronologically(current, frame) <= 0)
    ) {
      buckets.set(bucket, frame)
    }
  }
  return [...buckets.values()].sort(compareFramesChronologically)
}

function uniformFrameSample(
  frames: readonly ObservationFrame[],
  triggerIds: ReadonlySet<string>,
  limit: number
): ObservationFrame[] {
  const ordered = [...frames].sort(compareFramesChronologically)
  if (ordered.length <= limit) return ordered
  const selected = new Set<number>()
  const firstCapturedAt = ordered[0]!.capturedAt
  const capturedAtSpan = ordered.at(-1)!.capturedAt - firstCapturedAt
  for (let slot = 0; slot < limit; slot += 1) {
    const targetCapturedAt =
      firstCapturedAt + (slot * capturedAtSpan) / (limit - 1)
    let closestIndex: number | null = null
    let closestDistance = Number.POSITIVE_INFINITY
    for (let index = 0; index < ordered.length; index += 1) {
      if (selected.has(index)) continue
      const distance = Math.abs(ordered[index]!.capturedAt - targetCapturedAt)
      if (distance < closestDistance) {
        closestIndex = index
        closestDistance = distance
      }
    }
    if (closestIndex !== null) selected.add(closestIndex)
  }
  for (let index = 0; index < ordered.length; index += 1) {
    if (!triggerIds.has(ordered[index]!.frameId) || selected.has(index)) continue
    let replacement: number | null = null
    let distance = Number.POSITIVE_INFINITY
    for (const selectedIndex of selected) {
      if (triggerIds.has(ordered[selectedIndex]!.frameId)) continue
      const candidateDistance = Math.abs(
        ordered[selectedIndex]!.capturedAt - ordered[index]!.capturedAt
      )
      if (
        candidateDistance < distance ||
        (candidateDistance === distance && selectedIndex > (replacement ?? -1))
      ) {
        replacement = selectedIndex
        distance = candidateDistance
      }
    }
    if (replacement !== null) selected.delete(replacement)
    selected.add(index)
  }
  return [...selected]
    .sort((left, right) => left - right)
    .slice(0, limit)
    .map((index) => ordered[index]!)
}

function freezeContext(
  context: RoomEventContextWindow,
  frozenAt: WallClockTimestampMs
): FrozenObservationContext {
  return deepFrozenClone({
    publicContext: context.publicContext.filter(
      (event) => event.occurredAt <= frozenAt
    ),
    replyContext: context.replyContext.filter(
      (event) => event.occurredAt <= frozenAt
    ),
    publicTriggerEventIds: context.observationTriggerEventIds
  })
}

function triggerEvent(event: ObservationInputEvent): ObservationTriggerEvent {
  if (event.source === 'audience_barrage') {
    throw new TypeError('audience barrage cannot become a trigger event')
  }
  return Object.freeze({
    eventId: event.eventId,
    source: event.source,
    occurredAt: event.occurredAt,
    frameId: event.source === 'frame' ? event.frame.frameId : null
  })
}

function triggerPriority(trigger: ObservationTrigger): number {
  switch (trigger) {
    case 'user_text':
    case 'final_voice':
      return 50
    case 'system_audio':
      return 40
    case 'screen_change':
      return 30
    case 'ambient_tick':
      return 10
  }
}

function pendingPriority(pending: PendingObservation): number {
  return Math.max(
    ...pending.events.map((event) => observationTriggerPriority(event.source))
  )
}

function isNearbyInput(
  event: ObservationInputEvent
): event is ObservationInputEvent &
  Readonly<{ source: 'user_text' | 'final_voice' }> {
  return event.source === 'user_text' || event.source === 'final_voice'
}

function submission(
  status: ObservationSubmissionStatus,
  waves: readonly ObservationWave[]
): ObservationSubmission {
  return Object.freeze({ status, waves: Object.freeze([...waves]) })
}

function uniqueFrames(frames: readonly ObservationFrame[]): ObservationFrame[] {
  const byId = new Map<string, ObservationFrame>()
  for (const frame of frames) byId.set(frame.frameId, frame)
  return [...byId.values()].sort(compareFramesChronologically)
}

function compareInputEvents(
  left: ObservationInputEvent,
  right: ObservationInputEvent
): number {
  return left.occurredAt - right.occurredAt || left.eventId.localeCompare(right.eventId)
}

function compareFramesChronologically(
  left: ObservationFrame,
  right: ObservationFrame
): number {
  return left.capturedAt - right.capturedAt || left.frameId.localeCompare(right.frameId)
}

function validateInputEvent(
  event: ObservationInputEvent,
  sessionStartedAt: WallClockTimestampMs
): void {
  nonEmpty(event.eventId, 'observation event ID')
  finiteTimestamp(event.occurredAt, 'observation event time')
  if (event.occurredAt < sessionStartedAt) {
    throw new RangeError('observation event cannot precede the Session')
  }
  if (event.source === 'frame') {
    validateFrame(event.frame)
    finiteUnitInterval(event.screenChangeScore, 'screen change score')
    if (event.frame.capturedAt !== event.occurredAt) {
      throw new RangeError('frame capture and event timestamps must match')
    }
  }
}

function validateFrame(frame: ObservationFrame): void {
  nonEmpty(frame.frameId, 'frame ID')
  finiteTimestamp(frame.capturedAt, 'frame capture time')
  positiveInteger(frame.width, 'frame width')
  positiveInteger(frame.height, 'frame height')
  nonEmpty(frame.encoding, 'frame encoding')
  if (!/^[0-9a-f]{64}$/.test(frame.contentHash)) {
    throw new TypeError('frame content hash must be a lowercase SHA-256 digest')
  }
  nonEmpty(frame.dataRef, 'frame data reference')
  finiteUnitInterval(frame.changeScore, 'frame change score')
}

function nonEmpty(value: string, name: string): void {
  if (value.length === 0) throw new TypeError(`${name} must not be empty`)
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive integer`)
  }
}

function finiteTimestamp(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`)
  }
}

function finiteUnitInterval(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be between zero and one`)
  }
}

function deepFrozenClone<T>(value: T): T {
  return deepFreeze(structuredClone(value)) as T
}

function deepFreeze(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) {
    return value
  }
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}
