import type {
  Revision,
  RoomId
} from '@advx/contracts'

import {
  wallClockTimestampMs,
  type ModeMemeCandidate,
  type ModeMemeCommitResult,
  type ModeMemeRecord,
  type ModeMemeRepository,
  type RoomMemoryCandidate,
  type RoomMemoryEvidence,
  type RoomMemoryRepository,
  type TransactionBoundary,
  type TransactionContext
} from '../ports'
import type {
  AcceptedBarrageSideEffectPort,
  AcceptedBarrageSideEffectSubmission
} from './barrage-pipeline'
import type {
  ExtractedRoomMemoryCandidate,
  RoomMemoryExtractionScope,
  RoomMemoryExtractorPort
} from './memory-extraction'

export const SHARED_BRAIN_MAX_OUTSTANDING_EXTRACTIONS = 16
export const MODE_MEME_DECAY_FACTOR = 0.5
export const MODE_MEME_ARCHIVE_AFTER_MS = 30 * 24 * 60 * 60 * 1_000
export const MODE_MEME_ARCHIVE_MAX_USES = 3

export interface SharedBrainSessionFence {
  isCurrent(
    transaction: TransactionContext,
    scope: RoomMemoryExtractionScope
  ): Promise<boolean>
}

export interface ModeMemeProvenancePort {
  isValid(
    transaction: TransactionContext,
    candidate: ModeMemeCandidate
  ): Promise<boolean>
}

export type ModeMemeProposalResult =
  | Readonly<{
    status: 'committed'
    result: ModeMemeCommitResult
  }>
  | Readonly<{
    status: 'pending'
    candidateId: string
  }>
  | Readonly<{
    status: 'rejected'
    reason: 'invalid_candidate' | 'stale_scope' | 'invalid_provenance'
  }>

export type SharedBrainSideEffectFailure = Readonly<{
  kind: 'memory_extraction'
  code: 'extractor_failed' | 'memory_commit_failed'
  scope: RoomMemoryExtractionScope
  errorName: string
}>

export type SharedBrainSideEffectSnapshot = Readonly<{
  accepting: boolean
  active: number
  queued: number
  capacity: number
}>

export type SharedBrainSideEffectDependencies = Readonly<{
  transactions: TransactionBoundary
  memories: RoomMemoryRepository
  modeMemes: ModeMemeRepository
  sessionFence: SharedBrainSessionFence
  memeProvenance: ModeMemeProvenancePort
  memoryExtractor: RoomMemoryExtractorPort
  maxOutstandingExtractions?: number
  wallClockNow?: () => number
  onFailure?: (failure: SharedBrainSideEffectFailure) => void
}>

type QueuedMemoryExtraction = Readonly<{
  submission: AcceptedBarrageSideEffectSubmission
  scope: RoomMemoryExtractionScope
  evidence: readonly RoomMemoryEvidence[]
  controller: AbortController
}>

export class SharedBrainSideEffectService implements AcceptedBarrageSideEffectPort {
  readonly #capacity: number
  readonly #wallClockNow: () => number
  readonly #pending: QueuedMemoryExtraction[] = []
  readonly #idleWaiters = new Set<() => void>()
  #active: QueuedMemoryExtraction | null = null
  #accepting = true

  constructor(private readonly dependencies: SharedBrainSideEffectDependencies) {
    this.#capacity = dependencies.maxOutstandingExtractions ??
      SHARED_BRAIN_MAX_OUTSTANDING_EXTRACTIONS
    this.#wallClockNow = dependencies.wallClockNow ?? (() => Date.now())
    if (!positiveInteger(this.#capacity)) {
      throw new RangeError('shared-brain extraction capacity must be positive')
    }
  }

  snapshot(): SharedBrainSideEffectSnapshot {
    return Object.freeze({
      accepting: this.#accepting,
      active: this.#active === null ? 0 : 1,
      queued: this.#pending.length,
      capacity: this.#capacity
    })
  }

  submitAcceptedPublication(submission: AcceptedBarrageSideEffectSubmission): boolean {
    if (
      !this.#accepting ||
      this.#pending.length + (this.#active === null ? 0 : 1) >= this.#capacity ||
      !validAcceptedSubmission(submission)
    ) return false

    const scope = deepFreeze({
      roomId: submission.roomId,
      sessionId: submission.sessionId,
      audienceEpoch: submission.audienceEpoch,
      observationId: submission.observationId
    })
    const evidence = deepFreeze([{
      eventId: submission.event.barrage.barrage_id,
      sourceType: 'audience_barrage' as const,
      occurredAt: wallClockTimestampMs(submission.event.barrage.created_at_ms),
      summary: submission.event.barrage.text
    }])
    this.#pending.push(Object.freeze({
      submission,
      scope,
      evidence,
      controller: new AbortController()
    }))
    queueMicrotask(() => this.#pump())
    return true
  }

  async idle(): Promise<void> {
    if (this.#active === null && this.#pending.length === 0) return
    await new Promise<void>((resolve) => this.#idleWaiters.add(resolve))
  }

  cancelScope(scope: RoomMemoryExtractionScope): void {
    if (this.#active !== null && sameScope(this.#active.scope, scope)) {
      this.#active.controller.abort('shared_brain_scope_cancelled')
    }
    for (let index = this.#pending.length - 1; index >= 0; index -= 1) {
      const item = this.#pending[index]!
      if (!sameScope(item.scope, scope)) continue
      item.controller.abort('shared_brain_scope_cancelled')
      this.#pending.splice(index, 1)
    }
    this.#settleIdle()
  }

  async close(): Promise<void> {
    this.#accepting = false
    this.#active?.controller.abort('shared_brain_service_closed')
    for (const item of this.#pending) {
      item.controller.abort('shared_brain_service_closed')
    }
    this.#pending.splice(0)
    this.#settleIdle()
    await this.idle()
  }

  async proposeMeme(candidate: ModeMemeCandidate): Promise<ModeMemeProposalResult> {
    if (!validMemeCandidate(candidate)) {
      return Object.freeze({ status: 'rejected', reason: 'invalid_candidate' })
    }
    const scope = deepFreeze({
      roomId: candidate.roomId,
      sessionId: candidate.sessionId,
      audienceEpoch: candidate.audienceEpoch,
      observationId: candidate.observationId
    })
    return await this.dependencies.transactions.run(async (transaction) => {
      if (!await this.dependencies.sessionFence.isCurrent(transaction, scope)) {
        return Object.freeze({ status: 'rejected', reason: 'stale_scope' as const })
      }
      if (!await this.dependencies.memeProvenance.isValid(transaction, candidate)) {
        return Object.freeze({ status: 'rejected', reason: 'invalid_provenance' as const })
      }
      const setting = await this.dependencies.modeMemes.getAutoIngest(
        transaction,
        candidate.namespaceId
      )
      if (!setting.enabled) {
        await this.dependencies.modeMemes.saveCandidate(transaction, candidate)
        return Object.freeze({
          status: 'pending' as const,
          candidateId: candidate.candidateId
        })
      }
      const result = await this.dependencies.modeMemes.commitCandidate(
        transaction,
        candidate
      )
      return Object.freeze({ status: 'committed' as const, result })
    })
  }

  async undoMeme(
    namespaceId: string,
    memeId: string,
    expectedRevision: Revision
  ): Promise<ModeMemeRecord> {
    return await this.dependencies.transactions.run(
      async (transaction) => await this.dependencies.modeMemes.changeState(
        transaction,
        {
          namespaceId,
          memeId,
          expectedRevision,
          state: 'revoked',
          action: 'revoked',
          updatedAt: wallClockTimestampMs(this.#wallClockNow())
        }
      )
    )
  }

  async maintainMemes(namespaceId: string): Promise<readonly string[]> {
    const now = wallClockTimestampMs(this.#wallClockNow())
    const inactiveBefore = wallClockTimestampMs(
      Math.max(0, now - MODE_MEME_ARCHIVE_AFTER_MS)
    )
    return await this.dependencies.transactions.run(async (transaction) => {
      const candidates = await this.dependencies.modeMemes.listArchiveCandidates(
        transaction,
        namespaceId,
        inactiveBefore
      )
      const archived: string[] = []
      for (const candidate of candidates) {
        if (
          candidate.namespaceId !== namespaceId ||
          candidate.state !== 'active' ||
          candidate.source.pinned ||
          candidate.updatedAt > inactiveBefore
        ) continue
        const decayed = await this.dependencies.modeMemes.edit(transaction, {
          namespaceId,
          memeId: candidate.memeId,
          expectedRevision: candidate.revision,
          text: candidate.text,
          intensity: Math.max(0, candidate.intensity * MODE_MEME_DECAY_FACTOR),
          updatedAt: now
        })
        if (
          decayed.intensity > 0.1 &&
          decayed.source.useCount >= MODE_MEME_ARCHIVE_MAX_USES
        ) continue
        const archivedMeme = await this.dependencies.modeMemes.changeState(
          transaction,
          {
            namespaceId,
            memeId: decayed.memeId,
            expectedRevision: decayed.revision,
            state: 'archived',
            action: 'archived',
            updatedAt: now
          }
        )
        archived.push(archivedMeme.memeId)
      }
      return Object.freeze(archived)
    })
  }

  #pump(): void {
    if (this.#active !== null) return
    const item = this.#pending.shift()
    if (item === undefined) {
      this.#settleIdle()
      return
    }
    this.#active = item
    void this.#runMemoryExtraction(item)
      .catch((error: unknown) => {
        if (item.controller.signal.aborted) return
        this.#reportFailure(item.scope, 'extractor_failed', error)
      })
      .finally(() => {
        this.#active = null
        this.#pump()
      })
  }

  async #runMemoryExtraction(item: QueuedMemoryExtraction): Promise<void> {
    const current = await this.#currentMemoryRevision(item)
    if (!current || item.controller.signal.aborted) return
    const extracted = await this.dependencies.memoryExtractor.extract(
      {
        scope: item.scope,
        events: item.evidence,
        currentRevision: item.submission.memoryRevision
      },
      item.controller.signal
    )
    if (extracted.length > 32) {
      throw new RangeError('memory extractor exceeded the candidate bound')
    }

    let expectedRevision = item.submission.memoryRevision
    const identities = new Set<string>()
    for (const output of extracted) {
      if (item.controller.signal.aborted) return
      const candidate = await memoryCandidate(
        item.scope.roomId,
        expectedRevision,
        output,
        item.evidence
      )
      if (candidate === null || identities.has(candidate.memoryId)) continue
      identities.add(candidate.memoryId)
      let result
      try {
        result = await this.dependencies.transactions.run(async (transaction) => {
          if (!await this.dependencies.sessionFence.isCurrent(transaction, item.scope)) {
            return null
          }
          const head = await this.dependencies.memories.headRevision(
            transaction,
            item.scope.roomId
          )
          if (head !== expectedRevision) return null
          return await this.dependencies.memories.commitCandidate(
            transaction,
            candidate,
            wallClockTimestampMs(this.#wallClockNow())
          )
        })
      } catch (error) {
        this.#reportFailure(item.scope, 'memory_commit_failed', error)
        return
      }
      if (result === null) return
      if (!result.created) return
      expectedRevision = result.headRevision
    }
  }

  async #currentMemoryRevision(item: QueuedMemoryExtraction): Promise<boolean> {
    return await this.dependencies.transactions.run(async (transaction) =>
      await this.dependencies.sessionFence.isCurrent(transaction, item.scope) &&
      await this.dependencies.memories.headRevision(
        transaction,
        item.scope.roomId
      ) === item.submission.memoryRevision
    )
  }

  #reportFailure(
    scope: RoomMemoryExtractionScope,
    code: SharedBrainSideEffectFailure['code'],
    error: unknown
  ): void {
    try {
      this.dependencies.onFailure?.(Object.freeze({
        kind: 'memory_extraction',
        code,
        scope,
        errorName: error instanceof Error ? error.name : 'UnknownError'
      }))
    } catch {
      // Diagnostics cannot make an already-detached side effect observable to barrage.
    }
  }

  #settleIdle(): void {
    if (this.#active !== null || this.#pending.length > 0) return
    for (const resolve of this.#idleWaiters) resolve()
    this.#idleWaiters.clear()
  }
}

async function memoryCandidate(
  roomId: RoomId,
  baseRevision: Revision,
  output: ExtractedRoomMemoryCandidate,
  evidence: readonly RoomMemoryEvidence[]
): Promise<RoomMemoryCandidate | null> {
  if (!validExtractedCandidate(output, evidence)) return null
  const content = output.content.trim()
  const identity = JSON.stringify({
    room_id: roomId,
    memory_type: output.memoryType,
    content
  })
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))
  const digest = [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
  return deepFreeze({
    candidateId: `memory-candidate-${digest.slice(0, 24)}`,
    roomId,
    idempotencyKey: `memory-extract-${digest}`,
    baseRevision,
    memoryId: `memory-${digest.slice(0, 24)}`,
    memoryType: output.memoryType,
    content,
    evidenceEventIds: output.evidenceEventIds,
    tags: output.tags,
    origin: 'extracted',
    importance: output.importance,
    confidence: output.confidence
  })
}

function validAcceptedSubmission(submission: AcceptedBarrageSideEffectSubmission): boolean {
  const barrage = submission.event.barrage
  return submission.event.type === 'barrage.event' &&
    submission.roomId === barrage.room_id &&
    submission.sessionId === barrage.session_id &&
    submission.audienceEpoch === barrage.audience_epoch &&
    submission.observationId === barrage.observation_id &&
    !isBlank(submission.observationId) &&
    !isBlank(barrage.barrage_id) &&
    !isBlank(barrage.text) &&
    nonnegativeInteger(Number(submission.memoryRevision))
}

function validExtractedCandidate(
  candidate: ExtractedRoomMemoryCandidate,
  evidence: readonly RoomMemoryEvidence[]
): boolean {
  const allowedEvidence = new Set(evidence.map((item) => item.eventId))
  const evidenceIds = candidate.evidenceEventIds
  const hasNonAiEvidence = evidence.some((item) => item.sourceType !== 'audience_barrage')
  return !isBlank(candidate.content) &&
    [...candidate.content.trim()].length <= 4_000 &&
    evidenceIds.length >= 1 &&
    evidenceIds.length <= 128 &&
    new Set(evidenceIds).size === evidenceIds.length &&
    evidenceIds.every((eventId) => allowedEvidence.has(eventId)) &&
    candidate.tags.length <= 32 &&
    candidate.tags.every((tag) => !isBlank(tag) && [...tag.trim()].length <= 128) &&
    unitInterval(candidate.importance) &&
    unitInterval(candidate.confidence) &&
    (candidate.memoryType === 'room_lore' || hasNonAiEvidence)
}

function validMemeCandidate(candidate: ModeMemeCandidate): boolean {
  return candidate.outcome === 'pending' &&
    !isBlank(candidate.candidateId) &&
    !isBlank(candidate.roomId) &&
    !isBlank(candidate.sessionId) &&
    positiveInteger(Number(candidate.audienceEpoch)) &&
    !isBlank(candidate.observationId) &&
    !isBlank(candidate.namespaceId) &&
    !isBlank(candidate.text) &&
    [...candidate.text.trim()].length <= 500 &&
    candidate.evidenceEventIds.length >= 1 &&
    candidate.evidenceEventIds.length <= 128 &&
    new Set(candidate.evidenceEventIds).size === candidate.evidenceEventIds.length &&
    candidate.evidenceEventIds.every((value) => !isBlank(value)) &&
    candidate.evidenceFrameIndexes.length <= 60 &&
    new Set(candidate.evidenceFrameIndexes).size === candidate.evidenceFrameIndexes.length &&
    candidate.evidenceFrameIndexes.every(nonnegativeInteger) &&
    Number.isFinite(candidate.createdAt) &&
    candidate.createdAt >= 0
}

function sameScope(
  left: RoomMemoryExtractionScope,
  right: RoomMemoryExtractionScope
): boolean {
  return left.roomId === right.roomId &&
    left.sessionId === right.sessionId &&
    left.audienceEpoch === right.audienceEpoch &&
    left.observationId === right.observationId
}

function unitInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1
}

function isBlank(value: string): boolean {
  return value.trim().length === 0
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
