import {
  canonicalJson,
  type CanonicalRuntimeSpec,
  type Epoch,
  type ModeDefinition,
  type PersonaTemplate,
  type Revision,
  type RoomId,
  type SessionId,
  type ViewerId
} from '@advx/contracts'

import type {
  TransactionBoundary,
  ViewerInstanceRecord,
  ViewerInstanceRepository,
  ViewerInstanceVariant,
  ViewerPoolRecord,
  ViewerPoolUpdate,
  ViewerPrivateState,
  ViewerRevisionFence
} from '../ports/repositories'
import type { WallClockTimestampMs } from '../ports/time'

export const MIN_SESSION_VIEWERS = 1
export const MAX_ACTIVE_SESSION_VIEWERS = 32
export const MAX_CREATED_SESSION_VIEWERS = 128

export type SessionAudienceDependencies = Readonly<{
  transactions: TransactionBoundary
  viewers: ViewerInstanceRepository
}>

export type SessionAudienceCreateInput = Readonly<{
  roomId: RoomId
  sessionId: SessionId
  audienceEpoch: Epoch
  sessionSeed: string
  spec: CanonicalRuntimeSpec
  createdAt: WallClockTimestampMs
  expectedPopulationRevision: Revision
}>

export type SessionAudienceRestoreInput = Readonly<{
  sessionId: SessionId
  spec: CanonicalRuntimeSpec
}>

export type ViewerSequenceFence = Readonly<{
  viewerInstanceId: ViewerId
  viewerSequence: number
  presenceRevision: Revision
  moderationRevision: Revision
  behaviorRevision: Revision
}>

export type ViewerPrivateStateCommit = ViewerSequenceFence & Readonly<{
  privateState: ViewerPrivateState
  updatedAt: WallClockTimestampMs
}>

export type ViewerReplacement = Readonly<{
  removedViewer: ViewerInstanceRecord
  replacementViewer: ViewerInstanceRecord
  populationRevision: Revision
}>

export type SessionAudienceReconciliation = Readonly<{
  snapshot: ViewerPoolRecord
  retainedViewerIds: readonly ViewerId[]
  resetViewerIds: readonly ViewerId[]
  addedViewerIds: readonly ViewerId[]
  removedViewerIds: readonly ViewerId[]
}>

export type SessionAudienceErrorCode =
  | 'invalid_scope'
  | 'invalid_population'
  | 'viewer_not_found'
  | 'viewer_state_conflict'
  | 'viewer_limit_reached'

export class SessionAudienceError extends Error {
  constructor(
    readonly code: SessionAudienceErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'SessionAudienceError'
  }
}

export class SessionAudienceService {
  readonly #dependencies: SessionAudienceDependencies
  #spec: CanonicalRuntimeSpec
  #pool: ViewerPoolRecord
  #claimedSequences = new Map<ViewerId, number>()
  #operation: Promise<void> = Promise.resolve()

  private constructor(
    dependencies: SessionAudienceDependencies,
    spec: CanonicalRuntimeSpec,
    pool: ViewerPoolRecord
  ) {
    this.#dependencies = dependencies
    this.#spec = spec
    this.#pool = freezePool(pool)
    for (const viewer of pool.viewers) {
      this.#claimedSequences.set(viewer.viewerInstanceId, viewer.viewerSequence)
    }
  }

  static async create(
    dependencies: SessionAudienceDependencies,
    input: SessionAudienceCreateInput
  ): Promise<SessionAudienceService> {
    validateScope(input)
    const allocation = allocateInitialPool(input)
    await dependencies.transactions.run(async (transaction) => {
      await dependencies.viewers.addAll(transaction, allocation.viewers)
      await dependencies.viewers.advancePool(
        transaction,
        poolUpdate(allocation),
        input.expectedPopulationRevision
      )
    })
    return new SessionAudienceService(dependencies, input.spec, allocation)
  }

  static async restoreEligible(
    dependencies: SessionAudienceDependencies,
    input: SessionAudienceRestoreInput
  ): Promise<SessionAudienceService | null> {
    const pool = await dependencies.transactions.run(
      async (transaction) =>
        await dependencies.viewers.restoreEligiblePool(transaction, input.sessionId)
    )
    if (pool === null) return null
    if (pool.roomId !== input.spec.room.room_id) {
      fail('invalid_scope', 'restored audience belongs to another Room')
    }
    const { target } = personaCounts(input.spec)
    if (target !== pool.targetConcurrentViewers) {
      fail('invalid_population', 'restored audience target does not match runtime spec')
    }
    validateRestoredPool(pool)
    return new SessionAudienceService(dependencies, input.spec, pool)
  }

  snapshot(): ViewerPoolRecord {
    return this.#pool
  }

  activeViewers(): readonly ViewerInstanceRecord[] {
    return Object.freeze(
      this.#pool.viewers.filter(
        (viewer) =>
          viewer.storageState === 'active' && viewer.lifecycleState === 'active'
      )
    )
  }

  eligibleViewers(now: WallClockTimestampMs): readonly ViewerInstanceRecord[] {
    finiteTimestamp(now, 'Viewer eligibility time')
    return Object.freeze(
      this.activeViewers().filter(
        (viewer) =>
          (viewer.mutedUntil === null || viewer.mutedUntil <= now) &&
          (viewer.privateState.cooldown_until_ms === null ||
            viewer.privateState.cooldown_until_ms <= now)
      )
    )
  }

  claimViewerSequence(
    viewerInstanceId: ViewerId,
    viewerSequence: number,
    now: WallClockTimestampMs
  ): boolean {
    if (!Number.isSafeInteger(viewerSequence) || viewerSequence < 1) return false
    const viewer = this.#viewer(viewerInstanceId)
    if (!this.#eligible(viewer, now)) return false
    const current = this.#claimedSequences.get(viewerInstanceId) ?? viewer.viewerSequence
    if (viewerSequence !== current + 1) return false
    this.#claimedSequences.set(viewerInstanceId, viewerSequence)
    return true
  }

  fenceCurrent(fence: ViewerSequenceFence): boolean {
    const viewer = this.#pool.viewers.find(
      (item) => item.viewerInstanceId === fence.viewerInstanceId
    )
    return (
      viewer !== undefined &&
      viewer.storageState === 'active' &&
      viewer.lifecycleState === 'active' &&
      this.#claimedSequences.get(fence.viewerInstanceId) === fence.viewerSequence &&
      viewer.presenceRevision === fence.presenceRevision &&
      viewer.moderationRevision === fence.moderationRevision &&
      viewer.behaviorRevision === fence.behaviorRevision
    )
  }

  commitPrivateState(input: ViewerPrivateStateCommit): Promise<boolean> {
    return this.#exclusive(async () => {
      if (!this.fenceCurrent(input)) return false
      const current = this.#viewer(input.viewerInstanceId)
      if (input.privateState.revision !== current.privateState.revision + 1) {
        fail('viewer_state_conflict', 'Viewer private-state revision must advance once')
      }
      lifecycleTimestamp(current, input.updatedAt)
      const next = freezeViewer({
        ...current,
        privateState: freezePrivateState(input.privateState),
        viewerSequence: input.viewerSequence,
        behaviorRevision: asRevision(current.behaviorRevision + 1),
        updatedAt: input.updatedAt
      })
      await this.#dependencies.transactions.run(async (transaction) => {
        await this.#dependencies.viewers.save(
          transaction,
          next,
          revisionFence(current)
        )
      })
      this.#pool = replaceViewer(this.#pool, next)
      return true
    })
  }

  leave(
    viewerInstanceId: ViewerId,
    occurredAt: WallClockTimestampMs
  ): Promise<ViewerInstanceRecord> {
    return this.#exclusive(async () => {
      const current = this.#viewer(viewerInstanceId)
      requireLifecycle(current, 'active')
      lifecycleTimestamp(current, occurredAt)
      const next = freezeViewer({
        ...current,
        lifecycleState: 'left',
        presenceRevision: asRevision(current.presenceRevision + 1),
        behaviorRevision: asRevision(current.behaviorRevision + 1),
        lastLeftAt: occurredAt,
        mutedUntil: null,
        muteReason: null,
        updatedAt: occurredAt
      })
      const pool = advancePoolSnapshot(this.#pool, { viewers: replaceInList(this.#pool.viewers, next) })
      await this.#persistTransition(current, next, pool)
      this.#pool = pool
      this.#claimedSequences.set(viewerInstanceId, next.viewerSequence)
      return next
    })
  }

  rejoin(
    viewerInstanceId: ViewerId,
    occurredAt: WallClockTimestampMs
  ): Promise<ViewerInstanceRecord> {
    return this.#exclusive(async () => {
      const current = this.#viewer(viewerInstanceId)
      requireLifecycle(current, 'left')
      lifecycleTimestamp(current, occurredAt)
      const { counts } = personaCounts(this.#spec)
      const activeForPersona = this.activeViewers().filter(
        (viewer) => viewer.personaId === current.personaId
      ).length
      if (activeForPersona >= (counts.get(current.personaId) ?? 0)) {
        fail('viewer_state_conflict', 'Viewer Persona has no active rejoin slot')
      }
      const next = freezeViewer({
        ...current,
        lifecycleState: 'active',
        presenceRevision: asRevision(current.presenceRevision + 1),
        behaviorRevision: asRevision(current.behaviorRevision + 1),
        joinedAt: occurredAt,
        joinCount: current.joinCount + 1,
        updatedAt: occurredAt
      })
      const pool = advancePoolSnapshot(this.#pool, { viewers: replaceInList(this.#pool.viewers, next) })
      await this.#persistTransition(current, next, pool)
      this.#pool = pool
      this.#claimedSequences.set(viewerInstanceId, next.viewerSequence)
      return next
    })
  }

  kickAndReplace(
    viewerInstanceId: ViewerId,
    occurredAt: WallClockTimestampMs,
    reason: string | null = null
  ): Promise<ViewerReplacement> {
    return this.#exclusive(async () => {
      const current = this.#viewer(viewerInstanceId)
      requireLifecycle(current, 'active')
      lifecycleTimestamp(current, occurredAt)
      const kicked = freezeViewer({
        ...current,
        lifecycleState: 'kicked',
        presenceRevision: asRevision(current.presenceRevision + 1),
        moderationRevision: asRevision(current.moderationRevision + 1),
        behaviorRevision: asRevision(current.behaviorRevision + 1),
        mutedUntil: null,
        muteReason: null,
        kickedAt: occurredAt,
        kickReason: reason,
        updatedAt: occurredAt
      })
      const removed = freezeViewer({
        ...kicked,
        lifecycleState: 'removed',
        removedEpoch: this.#pool.audienceEpoch,
        storageState: 'removed'
      })
      const replacement = this.#newReplacement(current, occurredAt)
      const nextViewers = [
        ...replaceInList(this.#pool.viewers, removed),
        replacement
      ]
      const pool = advancePoolSnapshot(this.#pool, {
        viewers: nextViewers,
        nextCreationOrdinal: replacement.ordinal + 1
      })
      await this.#dependencies.transactions.run(async (transaction) => {
        await this.#dependencies.viewers.save(
          transaction,
          kicked,
          revisionFence(current)
        )
        await this.#dependencies.viewers.remove(
          transaction,
          current.sessionId,
          current.viewerInstanceId,
          current.audienceEpoch,
          occurredAt
        )
        await this.#dependencies.viewers.addAll(transaction, [replacement])
        await this.#dependencies.viewers.advancePool(
          transaction,
          poolUpdate(pool),
          this.#pool.populationRevision
        )
      })
      this.#pool = pool
      this.#claimedSequences.delete(current.viewerInstanceId)
      this.#claimedSequences.set(replacement.viewerInstanceId, 0)
      return Object.freeze({
        removedViewer: removed,
        replacementViewer: replacement,
        populationRevision: pool.populationRevision
      })
    })
  }

  reconcileRuntime(
    spec: CanonicalRuntimeSpec,
    nextAudienceEpoch: Epoch,
    occurredAt: WallClockTimestampMs
  ): Promise<SessionAudienceReconciliation> {
    return this.#exclusive(async () => {
      if (spec.room.room_id !== this.#pool.roomId) {
        fail('invalid_scope', 'runtime spec belongs to another Room')
      }
      if (nextAudienceEpoch <= this.#pool.audienceEpoch) {
        fail('invalid_scope', 'runtime reconciliation must advance audience epoch')
      }
      const mode = activeMode(spec)
      const { counts, target, personas } = personaCounts(spec)
      const remaining = new Map(counts)
      const active = [...this.activeViewers()].sort(compareViewerOrdinal)
      const retainedActive = new Set<ViewerId>()
      for (const viewer of active) {
        const available = remaining.get(viewer.personaId) ?? 0
        if (available <= 0) continue
        retainedActive.add(viewer.viewerInstanceId)
        remaining.set(viewer.personaId, available - 1)
      }
      const reassignmentSlots = personaSlots(
        mode,
        remaining,
        `${this.#pool.sessionSeed}\0reconcile\0${nextAudienceEpoch}`
      )
      const reassignmentIds = active
        .filter((viewer) => !retainedActive.has(viewer.viewerInstanceId))
        .map((viewer) => viewer.viewerInstanceId)
      const assignments = new Map<ViewerId, string>()
      for (let index = 0; index < reassignmentSlots.length; index += 1) {
        const viewerId = reassignmentIds[index]
        if (viewerId !== undefined) assignments.set(viewerId, reassignmentSlots[index]!)
      }
      const removedIds = new Set(reassignmentIds.slice(reassignmentSlots.length))
      const retained: ViewerId[] = []
      const reset: ViewerId[] = []
      const removed: ViewerId[] = []
      const saves: Array<Readonly<{ before: ViewerInstanceRecord; after: ViewerInstanceRecord }>> = []
      const removals: Array<Readonly<{ before: ViewerInstanceRecord; terminal: ViewerInstanceRecord }>> = []
      const nextViewers: ViewerInstanceRecord[] = []

      for (const before of this.#pool.viewers) {
        if (before.storageState === 'removed') {
          nextViewers.push(freezeViewer({ ...before, audienceEpoch: nextAudienceEpoch }))
          continue
        }
        if (removedIds.has(before.viewerInstanceId)) {
          const terminal = freezeViewer({
            ...before,
            audienceEpoch: nextAudienceEpoch,
            lifecycleState: 'ended',
            presenceRevision: asRevision(before.presenceRevision + 1),
            behaviorRevision: asRevision(before.behaviorRevision + 1),
            updatedAt: occurredAt
          })
          const tombstone = freezeViewer({
            ...terminal,
            lifecycleState: 'removed',
            removedEpoch: nextAudienceEpoch,
            storageState: 'removed'
          })
          removals.push({ before, terminal })
          nextViewers.push(tombstone)
          removed.push(before.viewerInstanceId)
          continue
        }
        const assignedPersonaId = assignments.get(before.viewerInstanceId)
        const persona = personas.get(assignedPersonaId ?? before.personaId)
        const changed =
          persona !== undefined &&
          (persona.persona_id !== before.personaId ||
            personaSignature(this.#spec, before.personaId) !==
              personaSignature(spec, persona.persona_id))
        if (changed && persona !== undefined) {
          const after = freezeViewer({
            ...before,
            audienceEpoch: nextAudienceEpoch,
            personaId: persona.persona_id,
            personaRevision: asRevision(persona.revision),
            personaContentHash: persona.content_hash,
            variant: freezeVariant({
              ...before.variant,
              focus: persona.traits?.[0] ?? persona.role
            }),
            privateState: defaultPrivateState(),
            behaviorRevision: asRevision(before.behaviorRevision + 1),
            updatedAt: occurredAt
          })
          saves.push({ before, after })
          nextViewers.push(after)
          reset.push(after.viewerInstanceId)
        } else {
          const after = freezeViewer({ ...before, audienceEpoch: nextAudienceEpoch })
          nextViewers.push(after)
          retained.push(after.viewerInstanceId)
        }
      }

      const activeCounts = activePersonaCounts(nextViewers)
      const deficits = new Map<string, number>()
      for (const [personaId, count] of counts) {
        const deficit = count - (activeCounts.get(personaId) ?? 0)
        if (deficit > 0) deficits.set(personaId, deficit)
      }
      const additions: ViewerInstanceRecord[] = []
      const usedUsernames = new Set(nextViewers.map((viewer) => viewer.username))
      let nextOrdinal = Math.max(
        this.#pool.nextCreationOrdinal,
        ...this.#pool.viewers.map((viewer) => viewer.ordinal + 1)
      )
      for (const personaId of personaSlots(mode, deficits, this.#pool.sessionSeed)) {
        if (nextOrdinal > MAX_CREATED_SESSION_VIEWERS) {
          fail('viewer_limit_reached', 'Session Viewer creation limit reached')
        }
        const persona = personas.get(personaId)
        if (persona === undefined) {
          fail('invalid_population', 'runtime Persona slot is unavailable')
        }
        const viewer = createViewer({
          roomId: this.#pool.roomId,
          sessionId: this.#pool.sessionId,
          audienceEpoch: nextAudienceEpoch,
          sessionSeed: this.#pool.sessionSeed,
          persona,
          ordinal: nextOrdinal,
          createdAt: occurredAt,
          usedUsernames
        })
        additions.push(viewer)
        nextViewers.push(viewer)
        nextOrdinal += 1
      }
      if (activePersonaCounts(nextViewers).size > counts.size || activeCount(nextViewers) !== target) {
        fail('invalid_population', 'runtime reconciliation did not reach exact Viewer counts')
      }
      for (const [personaId, count] of counts) {
        if ((activePersonaCounts(nextViewers).get(personaId) ?? 0) !== count) {
          fail('invalid_population', 'runtime reconciliation did not preserve Persona counts')
        }
      }
      const pool = freezePool({
        ...this.#pool,
        audienceEpoch: nextAudienceEpoch,
        targetConcurrentViewers: target,
        populationRevision: asRevision(this.#pool.populationRevision + 1),
        nextCreationOrdinal: nextOrdinal,
        viewers: nextViewers
      })
      await this.#dependencies.transactions.run(async (transaction) => {
        for (const change of saves) {
          await this.#dependencies.viewers.save(
            transaction,
            change.after,
            revisionFence(change.before)
          )
        }
        for (const removal of removals) {
          await this.#dependencies.viewers.save(
            transaction,
            removal.terminal,
            revisionFence(removal.before)
          )
          await this.#dependencies.viewers.remove(
            transaction,
            removal.before.sessionId,
            removal.before.viewerInstanceId,
            nextAudienceEpoch,
            occurredAt
          )
        }
        await this.#dependencies.viewers.addAll(transaction, additions)
        await this.#dependencies.viewers.advancePool(
          transaction,
          poolUpdate(pool),
          this.#pool.populationRevision
        )
      })
      this.#pool = pool
      this.#spec = spec
      for (const viewerId of removed) this.#claimedSequences.delete(viewerId)
      for (const viewer of additions) {
        this.#claimedSequences.set(viewer.viewerInstanceId, viewer.viewerSequence)
      }
      return Object.freeze({
        snapshot: pool,
        retainedViewerIds: Object.freeze(retained),
        resetViewerIds: Object.freeze(reset),
        addedViewerIds: Object.freeze(additions.map((viewer) => viewer.viewerInstanceId)),
        removedViewerIds: Object.freeze(removed)
      })
    })
  }

  async #persistTransition(
    before: ViewerInstanceRecord,
    after: ViewerInstanceRecord,
    pool: ViewerPoolRecord
  ): Promise<void> {
    await this.#dependencies.transactions.run(async (transaction) => {
      await this.#dependencies.viewers.save(
        transaction,
        after,
        revisionFence(before)
      )
      await this.#dependencies.viewers.advancePool(
        transaction,
        poolUpdate(pool),
        this.#pool.populationRevision
      )
    })
  }

  #newReplacement(
    removedViewer: ViewerInstanceRecord,
    createdAt: WallClockTimestampMs
  ): ViewerInstanceRecord {
    const ordinal = Math.max(
      this.#pool.nextCreationOrdinal,
      ...this.#pool.viewers.map((viewer) => viewer.ordinal + 1)
    )
    if (ordinal > MAX_CREATED_SESSION_VIEWERS) {
      fail('viewer_limit_reached', 'Session Viewer creation limit reached')
    }
    const { counts, personas } = personaCounts(this.#spec)
    const activeCounts = activePersonaCounts(
      this.#pool.viewers.filter(
        (viewer) => viewer.viewerInstanceId !== removedViewer.viewerInstanceId
      )
    )
    const deficits = new Map<string, number>()
    for (const [personaId, count] of counts) {
      const deficit = count - (activeCounts.get(personaId) ?? 0)
      if (deficit > 0) deficits.set(personaId, deficit)
    }
    const mode = activeMode(this.#spec)
    const personaId = personaSlots(
      mode,
      deficits,
      `${this.#pool.sessionSeed}\0replacement\0${ordinal}`
    )[0] ?? removedViewer.personaId
    const persona = personas.get(personaId)
    if (persona === undefined) fail('invalid_population', 'replacement Persona is unavailable')
    return createViewer({
      roomId: this.#pool.roomId,
      sessionId: this.#pool.sessionId,
      audienceEpoch: this.#pool.audienceEpoch,
      sessionSeed: this.#pool.sessionSeed,
      persona,
      ordinal,
      createdAt,
      usedUsernames: new Set(this.#pool.viewers.map((viewer) => viewer.username))
    })
  }

  #viewer(viewerInstanceId: ViewerId): ViewerInstanceRecord {
    const viewer = this.#pool.viewers.find(
      (item) => item.viewerInstanceId === viewerInstanceId
    )
    if (viewer === undefined) fail('viewer_not_found', 'Viewer is not known in this Session')
    return viewer
  }

  #eligible(viewer: ViewerInstanceRecord, now: WallClockTimestampMs): boolean {
    finiteTimestamp(now, 'Viewer mailbox claim time')
    return (
      viewer.storageState === 'active' &&
      viewer.lifecycleState === 'active' &&
      (viewer.mutedUntil === null || viewer.mutedUntil <= now) &&
      (viewer.privateState.cooldown_until_ms === null ||
        viewer.privateState.cooldown_until_ms <= now)
    )
  }

  #exclusive<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const result = this.#operation.then(operation, operation)
    this.#operation = result.then(() => undefined, () => undefined)
    return result
  }
}

function allocateInitialPool(input: SessionAudienceCreateInput): ViewerPoolRecord {
  const mode = activeMode(input.spec)
  const { counts, target, personas } = personaCounts(input.spec)
  const usedUsernames = new Set<string>()
  const viewers = personaSlots(mode, counts, input.sessionSeed).map(
    (personaId, index) =>
      createViewer({
        roomId: input.roomId,
        sessionId: input.sessionId,
        audienceEpoch: input.audienceEpoch,
        sessionSeed: input.sessionSeed,
        persona: personas.get(personaId)!,
        ordinal: index + 1,
        createdAt: input.createdAt,
        usedUsernames
      })
  )
  return freezePool({
    sessionId: input.sessionId,
    roomId: input.roomId,
    audienceEpoch: input.audienceEpoch,
    sessionSeed: input.sessionSeed,
    nextCreationOrdinal: viewers.length + 1,
    targetConcurrentViewers: target,
    populationRevision: asRevision(input.expectedPopulationRevision + 1),
    viewers
  })
}

function createViewer(input: Readonly<{
  roomId: RoomId
  sessionId: SessionId
  audienceEpoch: Epoch
  sessionSeed: string
  persona: PersonaTemplate
  ordinal: number
  createdAt: WallClockTimestampMs
  usedUsernames: Set<string>
}>): ViewerInstanceRecord {
  const seed = `${input.sessionSeed}\0${input.sessionId}\0${input.ordinal}\0viewer-v2`
  const digest = sha256Bytes(seed)
  const baseUsername = username(digest, input.ordinal)
  const alias = uniqueUsername(baseUsername, input.usedUsernames)
  input.usedUsernames.add(alias)
  return freezeViewer({
    viewerInstanceId: `viewer-${sha256Hex(seed).slice(0, 24)}` as ViewerId,
    roomId: input.roomId,
    sessionId: input.sessionId,
    audienceEpoch: input.audienceEpoch,
    personaId: input.persona.persona_id,
    personaRevision: asRevision(input.persona.revision),
    personaContentHash: input.persona.content_hash,
    ordinal: input.ordinal,
    username: alias,
    displayName: alias,
    avatarSeed: sha256Hex(digest, 'avatar').slice(0, 24),
    colorSeed: sha256Hex(digest, 'color').slice(0, 16),
    locale: 'zh-CN',
    variant: freezeVariant({
      activity_baseline: unit(digest, 10),
      attention_span: unit(digest, 12),
      social_initiative: unit(digest, 14),
      reply_affinity: unit(digest, 16),
      expression_length: unit(digest, 0),
      skepticism: unit(digest, 2),
      encouragement: unit(digest, 4),
      meme_affinity: unit(digest, 6),
      focus: input.persona.traits?.[0] ?? input.persona.role,
      silence_tendency: unit(digest, 8),
      stay_duration_tendency: unit(digest, 18),
      rejoin_tendency: unit(digest, 20)
    }),
    privateState: defaultPrivateState(),
    viewerSequence: 0,
    lifecycleState: 'active',
    presenceRevision: 1 as Revision,
    moderationRevision: 1 as Revision,
    behaviorRevision: 1 as Revision,
    joinedAt: input.createdAt,
    lastLeftAt: null,
    joinCount: 1,
    mutedUntil: null,
    muteReason: null,
    kickedAt: null,
    kickReason: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    createdEpoch: input.audienceEpoch,
    removedEpoch: null,
    storageState: 'active'
  })
}

function personaCounts(spec: CanonicalRuntimeSpec): Readonly<{
  counts: Map<string, number>
  target: number
  personas: Map<string, PersonaTemplate>
}> {
  const mode = activeMode(spec)
  const personas = new Map(
    spec.personas.map((persona) => [persona.persona_id, persona])
  )
  const counts = new Map<string, number>()
  let target = 0
  for (const [personaId, count] of Object.entries(mode.persona_counts)) {
    if (count === 0) continue
    const persona = personas.get(personaId)
    if (persona === undefined || persona.enabled === false) {
      fail('invalid_population', 'Mode contains an unavailable Persona')
    }
    counts.set(personaId, count)
    target += count
  }
  if (target < MIN_SESSION_VIEWERS || target > MAX_ACTIVE_SESSION_VIEWERS) {
    fail('invalid_population', 'active Viewer target must be between 1 and 32')
  }
  return { counts, target, personas }
}

function activeMode(spec: CanonicalRuntimeSpec): ModeDefinition {
  const mode = spec.modes.find((item) => item.mode_id === spec.active_mode_id)
  if (mode === undefined) fail('invalid_population', 'active Mode is missing')
  return mode
}

function personaSlots(
  mode: ModeDefinition,
  counts: ReadonlyMap<string, number>,
  sessionSeed: string
): string[] {
  const slots: Array<Readonly<{ personaId: string; ordinal: number; digest: Uint8Array }>> = []
  for (const [personaId, count] of counts) {
    for (let ordinal = 1; ordinal <= count; ordinal += 1) {
      slots.push({
        personaId,
        ordinal,
        digest: sha256Bytes(
          `${sessionSeed}\0${mode.mode_id}\0${personaId}\0${ordinal}\0persona-slot-v2`
        )
      })
    }
  }
  slots.sort(
    (left, right) =>
      compareBytes(left.digest, right.digest) ||
      compareStrings(left.personaId, right.personaId) ||
      left.ordinal - right.ordinal
  )
  return slots.map((slot) => slot.personaId)
}

function personaSignature(spec: CanonicalRuntimeSpec, personaId: string): string {
  const persona = spec.personas.find((item) => item.persona_id === personaId)
  const mode = activeMode(spec)
  return canonicalJson({
    revision: persona?.revision ?? null,
    content_hash: persona?.content_hash ?? null,
    override: mode.persona_overrides?.[personaId] ?? null
  })
}

function poolUpdate(pool: ViewerPoolRecord): ViewerPoolUpdate {
  return Object.freeze({
    sessionId: pool.sessionId,
    audienceEpoch: pool.audienceEpoch,
    sessionSeed: pool.sessionSeed,
    nextCreationOrdinal: pool.nextCreationOrdinal,
    targetConcurrentViewers: pool.targetConcurrentViewers,
    populationRevision: pool.populationRevision
  })
}

function advancePoolSnapshot(
  pool: ViewerPoolRecord,
  update: Readonly<{
    viewers: readonly ViewerInstanceRecord[]
    nextCreationOrdinal?: number
  }>
): ViewerPoolRecord {
  return freezePool({
    ...pool,
    viewers: update.viewers,
    nextCreationOrdinal: update.nextCreationOrdinal ?? pool.nextCreationOrdinal,
    populationRevision: asRevision(pool.populationRevision + 1)
  })
}

function replaceViewer(
  pool: ViewerPoolRecord,
  viewer: ViewerInstanceRecord
): ViewerPoolRecord {
  return freezePool({ ...pool, viewers: replaceInList(pool.viewers, viewer) })
}

function replaceInList(
  viewers: readonly ViewerInstanceRecord[],
  viewer: ViewerInstanceRecord
): ViewerInstanceRecord[] {
  return viewers.map((item) =>
    item.viewerInstanceId === viewer.viewerInstanceId ? viewer : item
  )
}

function revisionFence(viewer: ViewerInstanceRecord): ViewerRevisionFence {
  return Object.freeze({
    presenceRevision: viewer.presenceRevision,
    moderationRevision: viewer.moderationRevision,
    behaviorRevision: viewer.behaviorRevision
  })
}

function activePersonaCounts(
  viewers: readonly ViewerInstanceRecord[]
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const viewer of viewers) {
    if (viewer.storageState !== 'active' || viewer.lifecycleState !== 'active') continue
    counts.set(viewer.personaId, (counts.get(viewer.personaId) ?? 0) + 1)
  }
  return counts
}

function activeCount(viewers: readonly ViewerInstanceRecord[]): number {
  return viewers.filter(
    (viewer) =>
      viewer.storageState === 'active' && viewer.lifecycleState === 'active'
  ).length
}

function defaultPrivateState(): ViewerPrivateState {
  return freezePrivateState({
    revision: 1,
    published_event_ids: [],
    direct_interaction_event_ids: [],
    attention: [],
    mood: {},
    cooldown_until_ms: null,
    attention_strength: 0.5,
    arousal: 0,
    fatigue: 0,
    engagement: 0.5,
    last_spoke_at_ms: null,
    last_reacted_at_ms: null,
    current_thread_id: null,
    current_target_viewer_id: null,
    host_affinity: 0,
    peer_affinities: {},
    silence_streak: 0,
    speech_streak: 0
  })
}

function freezePrivateState(state: ViewerPrivateState): ViewerPrivateState {
  return Object.freeze({
    ...state,
    published_event_ids: [...state.published_event_ids],
    direct_interaction_event_ids: [...state.direct_interaction_event_ids],
    attention: [...state.attention],
    mood: { ...state.mood },
    peer_affinities: { ...state.peer_affinities }
  })
}

function freezeVariant(variant: ViewerInstanceVariant): ViewerInstanceVariant {
  return Object.freeze({ ...variant })
}

function freezeViewer(viewer: ViewerInstanceRecord): ViewerInstanceRecord {
  return Object.freeze({
    ...viewer,
    variant: freezeVariant(viewer.variant),
    privateState: freezePrivateState(viewer.privateState)
  })
}

function freezePool(pool: ViewerPoolRecord): ViewerPoolRecord {
  return Object.freeze({
    ...pool,
    viewers: Object.freeze(
      [...pool.viewers].sort(compareViewerOrdinal).map(freezeViewer)
    )
  })
}

function validateScope(input: SessionAudienceCreateInput): void {
  if (
    input.roomId.length === 0 ||
    input.sessionId.length === 0 ||
    input.sessionSeed.length === 0 ||
    input.spec.room.room_id !== input.roomId
  ) {
    fail('invalid_scope', 'Room, Session, seed, and runtime spec must share scope')
  }
  if (input.audienceEpoch < 1 || input.expectedPopulationRevision < 1) {
    fail('invalid_scope', 'audience epoch and population revision must be positive')
  }
  finiteTimestamp(input.createdAt, 'Viewer pool creation time')
  personaCounts(input.spec)
}

function validateRestoredPool(pool: ViewerPoolRecord): void {
  const ids = new Set<ViewerId>()
  const ordinals = new Set<number>()
  let maximumOrdinal = 0
  for (const viewer of pool.viewers) {
    if (viewer.sessionId !== pool.sessionId || viewer.roomId !== pool.roomId) {
      fail('invalid_scope', 'restored Viewer does not belong to its pool')
    }
    if (ids.has(viewer.viewerInstanceId) || ordinals.has(viewer.ordinal)) {
      fail('invalid_population', 'restored Viewer identity or ordinal is duplicated')
    }
    ids.add(viewer.viewerInstanceId)
    ordinals.add(viewer.ordinal)
    maximumOrdinal = Math.max(maximumOrdinal, viewer.ordinal)
  }
  if (pool.nextCreationOrdinal <= maximumOrdinal) {
    fail('invalid_population', 'restored next Viewer ordinal would recycle identity')
  }
}

function requireLifecycle(
  viewer: ViewerInstanceRecord,
  lifecycle: ViewerInstanceRecord['lifecycleState']
): void {
  if (viewer.storageState !== 'active' || viewer.lifecycleState !== lifecycle) {
    fail('viewer_state_conflict', `Viewer must be ${lifecycle}`)
  }
}

function lifecycleTimestamp(
  viewer: ViewerInstanceRecord,
  occurredAt: WallClockTimestampMs
): void {
  finiteTimestamp(occurredAt, 'Viewer lifecycle time')
  if (occurredAt < viewer.createdAt || occurredAt < viewer.updatedAt) {
    fail('viewer_state_conflict', 'Viewer lifecycle time precedes current state')
  }
}

function finiteTimestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative safe integer`)
  }
}

function asRevision(value: number): Revision {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('invalid_scope', 'revision must be a positive safe integer')
  }
  return value as Revision
}

function compareViewerOrdinal(
  left: ViewerInstanceRecord,
  right: ViewerInstanceRecord
): number {
  return (
    left.ordinal - right.ordinal ||
    compareStrings(left.viewerInstanceId, right.viewerInstanceId)
  )
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const difference = left[index]! - right[index]!
    if (difference !== 0) return difference
  }
  return left.length - right.length
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function sha256Bytes(...chunks: readonly (string | Uint8Array)[]): Uint8Array {
  const hasher = new Bun.CryptoHasher('sha256')
  for (const chunk of chunks) hasher.update(chunk)
  return new Uint8Array(hasher.digest())
}

function sha256Hex(...chunks: readonly (string | Uint8Array)[]): string {
  return Buffer.from(sha256Bytes(...chunks)).toString('hex')
}

function unit(digest: Uint8Array, offset: number): number {
  return ((digest[offset]! << 8) | digest[offset + 1]!) / 65_535
}

function username(digest: Uint8Array, ordinal: number): string {
  const template = digest[0]! % 6
  if (template === 0) return GIVEN_NAMES[digest[1]! % GIVEN_NAMES.length]!
  if (template === 1) return `小${NICKNAMES[digest[1]! % NICKNAMES.length]!}`
  if (template === 2) {
    return `${STATES[digest[1]! % STATES.length]!}${ROLES[digest[2]! % ROLES.length]!}`
  }
  if (template === 3) {
    return `${GAME_WORDS[digest[1]! % GAME_WORDS.length]!}${ROLES[digest[2]! % ROLES.length]!}`
  }
  if (template === 4) {
    return `${GIVEN_NAMES[digest[1]! % GIVEN_NAMES.length]!}的${OBJECTS[digest[2]! % OBJECTS.length]!}`
  }
  const number = (((digest[3]! << 8) | digest[4]!) + ordinal) % 100
  return `${HANDLES[digest[1]! % HANDLES.length]!}_${number.toString().padStart(2, '0')}`
}

function uniqueUsername(username: string, used: ReadonlySet<string>): string {
  if (!used.has(username)) return username
  let suffix = 2
  while (used.has(`${username}_${suffix}`)) suffix += 1
  return `${username}_${suffix}`
}

function fail(code: SessionAudienceErrorCode, message: string): never {
  throw new SessionAudienceError(code, message)
}

const GIVEN_NAMES = [
  '阿北', '阿沐', '小陈', '小林', '阿澈', '桃子',
  '柚子', '小七', '小满', '阿禾', '南风', '可乐'
] as const
const NICKNAMES = [
  '土豆', '青柠', '泡芙', '栗子', '团子', '番茄',
  '豆花', '布丁', '年糕', '汽水', '键帽', '耳机'
] as const
const STATES = [
  '熬夜', '路过', '排队', '潜水', '摸鱼', '掉线',
  '手慢', '蹲点', '观战', '等开局', '看回放', '刚上线'
] as const
const GAME_WORDS = [
  '排位', '残局', '补枪', '守点', '烟雾', '压枪',
  '爆头', '开麦', '观战', '练枪', '上分', '回防'
] as const
const ROLES = [
  '练习生', '研究员', '观察员', '路人', '替补', '记录员',
  '队友', '摸鱼员', '气氛组', '小助手', '爱好者', '玩家'
] as const
const OBJECTS = [
  '耳机', '键盘', '鼠标', '手柄', '汽水', '外设',
  '显示器', '弹幕', '盒饭', '键帽', '背包', '充电线'
] as const
const HANDLES = [
  'momo', 'nono', 'kira', 'vivi', 'zero', 'mika',
  'niko', 'mimi', 'yoyo', 'kiwi', 'sora', 'nana'
] as const
