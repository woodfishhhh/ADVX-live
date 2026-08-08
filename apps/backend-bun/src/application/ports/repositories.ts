import type {
  CanonicalRuntimeSpec,
  Epoch,
  InferSchema,
  Revision,
  RoomId,
  RoomEventSource,
  SafeJsonValue,
  SessionId,
  SessionOutcome,
  ViewerId,
  ViewerLifecycleState,
  viewerInstanceVariantSchema,
  viewerPrivateStateSchema
} from '@advx/contracts'

import type { WallClockTimestampMs } from './time'
import type { RuntimeSpecDiffSummary } from '../../domain/runtime-spec'
import type { TraceContext } from './observability'

declare const transactionContextBrand: unique symbol

export type TransactionContext = {
  readonly transactionId: string
  readonly traceContext?: TraceContext
  readonly [transactionContextBrand]: 'transaction-context'
}

export function transactionContext(
  transactionId: string,
  traceContext?: TraceContext
): TransactionContext {
  if (transactionId.length === 0) {
    throw new TypeError('transaction ID must not be empty')
  }
  return {
    transactionId,
    ...(traceContext === undefined ? {} : { traceContext })
  } as TransactionContext
}

export type RuntimeSpecRecord = {
  readonly sessionId: SessionId
  readonly roomId: RoomId
  readonly revision: Revision
  readonly applyId: string
  readonly operation: RuntimeSpecRevisionOperation
  readonly rollbackTargetRevision: Revision | null
  readonly baseRevision: Revision
  readonly status: RuntimeSpecRevisionStatus
  readonly configRevision: Revision
  readonly audienceEpoch: Epoch
  readonly configHash: string
  readonly canonicalSpecJson: string
  readonly spec: CanonicalRuntimeSpec
  readonly diffSummary: RuntimeSpecDiffSummary
  readonly createdAt: WallClockTimestampMs
  readonly updatedAt: WallClockTimestampMs
}

export type RuntimeSpecRevisionOperation = 'bootstrap' | 'apply' | 'rollback'

export type RuntimeSpecRevisionStatus =
  | 'pending'
  | 'committed'
  | 'rejected'
  | 'rolled_back'

export type RuntimeSpecCommitToken = Readonly<{
  record: RuntimeSpecRecord
  // Preparation owns every fallible operation; commit is synchronous and no-fail.
  commit(): void
}>

export type RoomRecord = {
  readonly roomId: RoomId
  readonly displayName: string
  readonly state: PersistedRoomState
  readonly revision: Revision
  readonly createdAt: WallClockTimestampMs
  readonly updatedAt: WallClockTimestampMs
}

export type PersistedRoomState = 'active' | 'cleared'

export type PersistedSessionState =
  | 'starting'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'failed'

export type ViewerInstanceVariant = Readonly<
  Required<InferSchema<typeof viewerInstanceVariantSchema>>
>

export type ViewerPrivateState = Readonly<
  Required<InferSchema<typeof viewerPrivateStateSchema>>
>

export type PersistedViewerState = 'active' | 'removed'

export type ViewerInstanceRecord = {
  readonly viewerInstanceId: ViewerId
  readonly roomId: RoomId
  readonly sessionId: SessionId
  readonly audienceEpoch: Epoch
  readonly personaId: string
  readonly personaRevision: Revision
  readonly personaContentHash: string
  readonly ordinal: number
  readonly username: string
  readonly displayName: string
  readonly avatarSeed: string
  readonly colorSeed: string
  readonly locale: string
  readonly variant: ViewerInstanceVariant
  readonly privateState: ViewerPrivateState
  readonly viewerSequence: number
  readonly lifecycleState: ViewerLifecycleState
  readonly presenceRevision: Revision
  readonly moderationRevision: Revision
  readonly behaviorRevision: Revision
  readonly joinedAt: WallClockTimestampMs | null
  readonly lastLeftAt: WallClockTimestampMs | null
  readonly joinCount: number
  readonly mutedUntil: WallClockTimestampMs | null
  readonly muteReason: string | null
  readonly kickedAt: WallClockTimestampMs | null
  readonly kickReason: string | null
  readonly createdAt: WallClockTimestampMs
  readonly updatedAt: WallClockTimestampMs
  readonly createdEpoch: Epoch
  readonly removedEpoch: Epoch | null
  readonly storageState: PersistedViewerState
}

export type ViewerRevisionFence = Readonly<{
  presenceRevision: Revision
  moderationRevision: Revision
  behaviorRevision: Revision
}>

export type ViewerPoolRecord = Readonly<{
  sessionId: SessionId
  roomId: RoomId
  audienceEpoch: Epoch
  sessionSeed: string
  nextCreationOrdinal: number
  targetConcurrentViewers: number
  populationRevision: Revision
  viewers: readonly ViewerInstanceRecord[]
}>

export type ViewerPoolUpdate = Readonly<{
  sessionId: SessionId
  audienceEpoch: Epoch
  sessionSeed: string
  nextCreationOrdinal: number
  targetConcurrentViewers: number
  populationRevision: Revision
}>

export type RoomEventPayload = Readonly<Record<string, SafeJsonValue>>

export type RoomEventRecord = Readonly<{
  eventId: string
  roomId: RoomId
  sessionId: SessionId
  sequence: number
  sourceType: RoomEventSource
  sourceId: string | null
  audienceEpoch: Epoch
  text: string | null
  payload: RoomEventPayload
  evidenceEventIds: readonly string[]
  contentJson: string
  contentHash: string
  occurredAt: WallClockTimestampMs
}>

export type RoomEventInput = Readonly<{
  eventId: string
  roomId: RoomId
  sessionId: SessionId
  sequence: number
  sourceType: RoomEventSource
  sourceId: string | null
  audienceEpoch: Epoch
  text: string | null
  payload: RoomEventPayload
  occurredAt: WallClockTimestampMs
}>

export type RoomEventRetentionRule = Readonly<{
  keepAfter: WallClockTimestampMs
  maxEvents: number
}>

export type RoomEventRetentionPolicy = Readonly<
  Record<RoomEventSource, RoomEventRetentionRule>
>

export type RoomEventContextQuery = Readonly<{
  roomId: RoomId
  sessionId: SessionId
  observedAt: WallClockTimestampMs
  publicWindowMs: number
  replyWindowMs: number
  publicLimit: number
  replyLimit: number
  triggerEventIds: readonly string[]
}>

export type RoomEventContextWindow = Readonly<{
  publicContext: readonly RoomEventRecord[]
  replyContext: readonly RoomEventRecord[]
  observationTriggerEventIds: readonly string[]
}>

export type RoomMemoryType =
  | 'user_preference'
  | 'real_world_fact'
  | 'room_lore'
  | 'shared_experience'

export type RoomMemoryState = 'active' | 'superseded' | 'revoked'

export type RoomMemoryEvidence = Readonly<{
  eventId: string
  sourceType: RoomEventSource
  occurredAt: WallClockTimestampMs
  summary: string
}>

export type RoomMemoryRecord = Readonly<{
  memoryId: string
  roomId: RoomId
  memoryType: RoomMemoryType
  content: string
  tags: readonly string[]
  importance: number
  confidence: number
  origin: string
  state: RoomMemoryState
  supersededBy: string | null
  lastRecalledAt: WallClockTimestampMs | null
  expiresAt: WallClockTimestampMs | null
  revision: Revision
  createdAt: WallClockTimestampMs
  updatedAt: WallClockTimestampMs
  evidence: readonly RoomMemoryEvidence[]
}>

export type RoomMemoryCandidate = Readonly<{
  candidateId: string
  roomId: RoomId
  idempotencyKey: string
  baseRevision: Revision
  memoryId: string
  memoryType: RoomMemoryType
  content: string
  evidenceEventIds: readonly string[]
  tags: readonly string[]
  origin: string
  importance: number
  confidence: number
}>

export type RoomMemoryCommitResult = Readonly<{
  accepted: true
  memoryId: string
  memoryRevision: Revision
  headRevision: Revision
  created: boolean
}>

export type RoomMemorySliceQuery = Readonly<{
  roomId: RoomId
  evidenceEventIds: readonly string[]
  observedAt: WallClockTimestampMs
  limit: number
}>

export type RoomMemorySlice = Readonly<{
  roomId: RoomId
  memoryRevision: Revision
  memoryIds: readonly string[]
  items: readonly RoomMemoryRecord[]
}>

export type RoomMemoryEdit = Readonly<{
  roomId: RoomId
  memoryId: string
  expectedRevision: Revision
  content: string
  confidence: number
  evidenceEventIds: readonly string[]
  updatedAt: WallClockTimestampMs
}>

export type RoomMemoryMerge = Readonly<{
  roomId: RoomId
  memoryId: string
  sourceMemoryId: string
  expectedRevision: Revision
  sourceExpectedRevision: Revision
  content: string
  updatedAt: WallClockTimestampMs
}>

export type RoomMemoryReplacement = Readonly<{
  roomId: RoomId
  memoryId: string
  replacementMemoryId: string
  expectedRevision: Revision
  content: string
  evidenceEventIds: readonly string[]
  updatedAt: WallClockTimestampMs
}>

export type MemeCandidateOutcome = 'pending' | 'accepted' | 'rejected'

export type ModeMemeState = 'active' | 'disabled' | 'archived' | 'revoked'

export type ModeMemeAction =
  | 'created'
  | 'edited'
  | 'revoked'
  | 'restored'
  | 'disabled'
  | 'archived'

export type ModeMemeCandidate = Readonly<{
  candidateId: string
  roomId: RoomId
  sessionId: SessionId
  audienceEpoch: Epoch
  observationId: string
  namespaceId: string
  text: string
  idempotencyKey: string | null
  evidenceEventIds: readonly string[]
  evidenceFrameIndexes: readonly number[]
  outcome: MemeCandidateOutcome
  createdAt: WallClockTimestampMs
}>

export type ModeMemeSource = Readonly<{
  roomId: RoomId
  sessionId: SessionId
  audienceEpoch: Epoch
  observationId: string
  sourceCandidateId: string
  evidenceEventIds: readonly string[]
  evidenceFrameIndexes: readonly number[]
  pinned: boolean
  useCount: number
  lastUsedAt: WallClockTimestampMs | null
}>

export type ModeMemeRecord = Readonly<{
  memeId: string
  namespaceId: string
  text: string
  intensity: number
  state: ModeMemeState
  source: ModeMemeSource
  revision: Revision
  createdAt: WallClockTimestampMs
  updatedAt: WallClockTimestampMs
}>

export type ModeMemeEvent = Readonly<{
  eventId: string
  memeId: string
  action: ModeMemeAction
  payload: Readonly<Record<string, SafeJsonValue>>
  previousRevision: Revision
  newRevision: Revision
  createdAt: WallClockTimestampMs
}>

export type ModeMemeAutoIngestSetting = Readonly<{
  namespaceId: string
  enabled: boolean
  revision: Revision
}>

export type ModeMemeCommitResult = Readonly<{
  accepted: true
  memeId: string
  created: boolean
}>

export type ModeMemeEdit = Readonly<{
  namespaceId: string
  memeId: string
  expectedRevision: Revision
  text: string
  intensity: number
  updatedAt: WallClockTimestampMs
}>

export type ModeMemeStateChange = Readonly<{
  namespaceId: string
  memeId: string
  expectedRevision: Revision
  state: ModeMemeState
  action: Exclude<ModeMemeAction, 'created' | 'edited'>
  updatedAt: WallClockTimestampMs
}>

export type ModeMemePinUpdate = Readonly<{
  namespaceId: string
  memeId: string
  expectedRevision: Revision
  pinned: boolean
  updatedAt: WallClockTimestampMs
}>

export type ModeMemeUse = Readonly<{
  namespaceId: string
  memeId: string
  expectedRevision: Revision
  usedAt: WallClockTimestampMs
}>

export type DurableOutboxKind =
  | 'domain_event'
  | 'memory_side_effect'
  | 'meme_side_effect'
  | 'migration_marker'
  | 'recovery_marker'

export type DurableOutboxStatus =
  | 'pending'
  | 'leased'
  | 'completed'
  | 'cancelled'
  | 'dead_letter'

export type DurableOutboxFenceKind =
  | 'none'
  | 'room'
  | 'session_epoch'
  | 'viewer_sequence'

export type DurableOutboxFence = Readonly<{
  kind: DurableOutboxFenceKind
  roomId: RoomId | null
  sessionId: SessionId | null
  audienceEpoch: Epoch | null
  observationId: string | null
  viewerId: ViewerId | null
  viewerSequence: number | null
}>

export type DurableOutboxRecord = Readonly<{
  workId: string
  idempotencyKey: string
  kind: DurableOutboxKind
  topic: string
  fence: DurableOutboxFence
  payload: SafeJsonValue
  status: DurableOutboxStatus
  attemptCount: number
  availableAt: WallClockTimestampMs
  leaseOwner: string | null
  leaseExpiresAt: WallClockTimestampMs | null
  lastErrorCode: string | null
  createdAt: WallClockTimestampMs
  updatedAt: WallClockTimestampMs
  settledAt: WallClockTimestampMs | null
}>

export type DurableOutboxEnqueue = Readonly<{
  workId: string
  idempotencyKey: string
  kind: DurableOutboxKind
  topic: string
  fence: DurableOutboxFence
  payload: SafeJsonValue
  availableAt: WallClockTimestampMs
  createdAt: WallClockTimestampMs
}>

export type DurableOutboxClaim = Readonly<{
  workerId: string
  kinds: readonly DurableOutboxKind[]
  now: WallClockTimestampMs
  leaseExpiresAt: WallClockTimestampMs
  limit: number
}>

export type DurableOutboxLeaseIdentity = Readonly<{
  workId: string
  workerId: string
  expectedAttempt: number
}>

export type DurableOutboxSettlement = DurableOutboxLeaseIdentity &
  Readonly<{
    status: 'completed' | 'cancelled' | 'dead_letter'
    errorCode: string | null
    settledAt: WallClockTimestampMs
  }>

export type DurableOutboxRetry = DurableOutboxLeaseIdentity &
  Readonly<{
    errorCode: string
    availableAt: WallClockTimestampMs
    retriedAt: WallClockTimestampMs
  }>

export type SessionRecord = {
  readonly sessionId: SessionId
  readonly roomId: RoomId
  readonly state: PersistedSessionState
  readonly revision: Revision
  readonly audienceEpoch: Epoch
  readonly activeConfigHash: string | null
  readonly recoveryEligible: boolean
  readonly lastCleanShutdownAt: WallClockTimestampMs | null
  readonly lastRecoveredAt: WallClockTimestampMs | null
  readonly clientRequestId: string | null
  readonly clientRequestHash: string | null
  readonly startedAt: WallClockTimestampMs
  readonly updatedAt: WallClockTimestampMs
  readonly endedAt: WallClockTimestampMs | null
  readonly outcome: SessionOutcome | null
  readonly appVersion: string
}

export interface RuntimeSpecRepository {
  getActive(
    transaction: TransactionContext,
    sessionId: SessionId
  ): Promise<RuntimeSpecRecord | null>
  getRevision(
    transaction: TransactionContext,
    sessionId: SessionId,
    revision: Revision
  ): Promise<RuntimeSpecRecord | null>
  getByApplyId(
    transaction: TransactionContext,
    sessionId: SessionId,
    applyId: string
  ): Promise<RuntimeSpecRecord | null>
  nextRevision(
    transaction: TransactionContext,
    sessionId: SessionId
  ): Promise<Revision>
  addPending(
    transaction: TransactionContext,
    record: RuntimeSpecRecord
  ): Promise<void>
  rejectPending(
    transaction: TransactionContext,
    sessionId: SessionId,
    revision: Revision,
    updatedAt: WallClockTimestampMs
  ): Promise<void>
  prepareCommit(
    transaction: TransactionContext,
    record: RuntimeSpecRecord,
    expectedActiveRevision: Revision,
    rolledBackRevision?: Revision
  ): Promise<RuntimeSpecCommitToken>
}

export interface ObservationWaveBoundary {
  cutover<TResult>(work: () => Promise<TResult>): Promise<TResult>
}

export interface RuntimeSpecCapabilityGate {
  validate(spec: CanonicalRuntimeSpec): Promise<void>
}

export type RuntimeSpecWorkFence = Readonly<{
  roomId: RoomId
  sessionId: SessionId
  audienceEpoch: Epoch
  runtimeRevision: Revision
}>

export type RuntimeSpecApplyIdentity = Readonly<{
  roomId: RoomId
  sessionId: SessionId
  audienceEpoch: Epoch
  lifecycleRevision: Revision
  baseRevision: Revision
  applyId: string
  traceContext?: TraceContext
}>

export type RuntimeSpecApplyCommand = RuntimeSpecApplyIdentity & Readonly<{
  candidate: unknown
}>

export type RuntimeSpecRollbackCommand = RuntimeSpecApplyIdentity & Readonly<{
  targetRevision: Revision
}>

export interface RuntimeSpecCoordinatorPort {
  current(): RuntimeSpecRecord
  apply(command: RuntimeSpecApplyCommand): Promise<RuntimeSpecRecord>
  rollback(command: RuntimeSpecRollbackCommand): Promise<RuntimeSpecRecord>
  acceptsWork(fence: RuntimeSpecWorkFence): boolean
  commitIfCurrent(
    fence: RuntimeSpecWorkFence,
    sideEffect: () => void
  ): boolean
}

export interface RoomRepository {
  get(
    transaction: TransactionContext,
    roomId: RoomId
  ): Promise<RoomRecord | null>
  clear(
    transaction: TransactionContext,
    roomId: RoomId
  ): Promise<boolean>
  save(
    transaction: TransactionContext,
    room: RoomRecord,
    expectedRevision: Revision | null
  ): Promise<void>
}

export interface SessionRepository {
  get(
    transaction: TransactionContext,
    sessionId: SessionId
  ): Promise<SessionRecord | null>
  getIdempotentStart(
    transaction: TransactionContext,
    clientRequestId: string,
    requestHash: string
  ): Promise<SessionRecord | null>
  save(
    transaction: TransactionContext,
    session: SessionRecord,
    expectedRevision: Revision | null
  ): Promise<void>
}

export interface ViewerInstanceRepository {
  get(
    transaction: TransactionContext,
    sessionId: SessionId,
    viewerInstanceId: ViewerId
  ): Promise<ViewerInstanceRecord | null>
  listActive(
    transaction: TransactionContext,
    sessionId: SessionId
  ): Promise<readonly ViewerInstanceRecord[]>
  restoreEligiblePool(
    transaction: TransactionContext,
    sessionId: SessionId
  ): Promise<ViewerPoolRecord | null>
  addAll(
    transaction: TransactionContext,
    viewers: readonly ViewerInstanceRecord[]
  ): Promise<void>
  save(
    transaction: TransactionContext,
    viewer: ViewerInstanceRecord,
    expected: ViewerRevisionFence
  ): Promise<void>
  remove(
    transaction: TransactionContext,
    sessionId: SessionId,
    viewerInstanceId: ViewerId,
    removedEpoch: Epoch,
    updatedAt: WallClockTimestampMs
  ): Promise<void>
  advancePool(
    transaction: TransactionContext,
    update: ViewerPoolUpdate,
    expectedPopulationRevision: Revision
  ): Promise<void>
}

export interface RoomEventRepository {
  append(
    transaction: TransactionContext,
    event: RoomEventRecord
  ): Promise<boolean>
  appendWithRetention(
    transaction: TransactionContext,
    event: RoomEventRecord,
    retention: RoomEventRetentionPolicy
  ): Promise<Readonly<{ inserted: boolean; pruned: number }>>
  listForRecovery(
    transaction: TransactionContext,
    roomId: RoomId,
    sessionId: SessionId,
    maximumAudienceEpoch: Epoch,
    limit: number
  ): Promise<readonly RoomEventRecord[]>
  readContextWindow(
    transaction: TransactionContext,
    query: RoomEventContextQuery
  ): Promise<RoomEventContextWindow>
  prune(
    transaction: TransactionContext,
    roomId: RoomId,
    retention: RoomEventRetentionPolicy
  ): Promise<number>
}

export interface RoomMemoryRepository {
  headRevision(transaction: TransactionContext, roomId: RoomId): Promise<Revision>
  readSlice(
    transaction: TransactionContext,
    query: RoomMemorySliceQuery
  ): Promise<RoomMemorySlice>
  commitCandidate(
    transaction: TransactionContext,
    candidate: RoomMemoryCandidate,
    createdAt: WallClockTimestampMs
  ): Promise<RoomMemoryCommitResult>
  listActive(
    transaction: TransactionContext,
    roomId: RoomId,
    observedAt: WallClockTimestampMs,
    limit: number
  ): Promise<readonly RoomMemoryRecord[]>
  get(
    transaction: TransactionContext,
    roomId: RoomId,
    memoryId: string
  ): Promise<RoomMemoryRecord>
  edit(
    transaction: TransactionContext,
    edit: RoomMemoryEdit
  ): Promise<RoomMemoryRecord>
  merge(
    transaction: TransactionContext,
    merge: RoomMemoryMerge
  ): Promise<RoomMemoryRecord>
  replace(
    transaction: TransactionContext,
    replacement: RoomMemoryReplacement
  ): Promise<RoomMemoryRecord>
  revoke(
    transaction: TransactionContext,
    roomId: RoomId,
    memoryId: string,
    expectedRevision: Revision,
    updatedAt: WallClockTimestampMs
  ): Promise<RoomMemoryRecord>
  delete(
    transaction: TransactionContext,
    roomId: RoomId,
    memoryId: string,
    expectedRevision: Revision,
    updatedAt: WallClockTimestampMs
  ): Promise<boolean>
  reset(
    transaction: TransactionContext,
    roomId: RoomId,
    expectedRevision: Revision,
    updatedAt: WallClockTimestampMs
  ): Promise<number>
}

export interface ModeMemeRepository {
  listActive(
    transaction: TransactionContext,
    namespaceId: string
  ): Promise<readonly ModeMemeRecord[]>
  listAll(
    transaction: TransactionContext,
    namespaceId: string
  ): Promise<readonly ModeMemeRecord[]>
  listPending(
    transaction: TransactionContext,
    namespaceId: string
  ): Promise<readonly ModeMemeCandidate[]>
  getCandidate(
    transaction: TransactionContext,
    namespaceId: string,
    candidateId: string
  ): Promise<ModeMemeCandidate>
  findCandidate(
    transaction: TransactionContext,
    candidateId: string
  ): Promise<ModeMemeCandidate | null>
  saveCandidate(
    transaction: TransactionContext,
    candidate: ModeMemeCandidate
  ): Promise<void>
  commitCandidate(
    transaction: TransactionContext,
    candidate: ModeMemeCandidate
  ): Promise<ModeMemeCommitResult>
  approveCandidate(
    transaction: TransactionContext,
    namespaceId: string,
    candidateId: string,
    approvedAt: WallClockTimestampMs
  ): Promise<ModeMemeCommitResult>
  rejectCandidate(
    transaction: TransactionContext,
    namespaceId: string,
    candidateId: string,
    rejectedAt: WallClockTimestampMs
  ): Promise<ModeMemeCandidate>
  getAutoIngest(
    transaction: TransactionContext,
    namespaceId: string
  ): Promise<ModeMemeAutoIngestSetting>
  setAutoIngest(
    transaction: TransactionContext,
    namespaceId: string,
    enabled: boolean,
    expectedRevision: Revision,
    updatedAt: WallClockTimestampMs
  ): Promise<ModeMemeAutoIngestSetting>
  get(
    transaction: TransactionContext,
    namespaceId: string,
    memeId: string
  ): Promise<ModeMemeRecord>
  edit(
    transaction: TransactionContext,
    edit: ModeMemeEdit
  ): Promise<ModeMemeRecord>
  changeState(
    transaction: TransactionContext,
    change: ModeMemeStateChange
  ): Promise<ModeMemeRecord>
  setPinned(
    transaction: TransactionContext,
    update: ModeMemePinUpdate
  ): Promise<ModeMemeRecord>
  recordUse(
    transaction: TransactionContext,
    use: ModeMemeUse
  ): Promise<ModeMemeRecord>
  listArchiveCandidates(
    transaction: TransactionContext,
    namespaceId: string,
    inactiveBefore: WallClockTimestampMs
  ): Promise<readonly ModeMemeRecord[]>
  listEvents(
    transaction: TransactionContext,
    namespaceId: string,
    memeId: string
  ): Promise<readonly ModeMemeEvent[]>
}

export interface OutboxRepository {
  get(
    transaction: TransactionContext,
    workId: string
  ): Promise<DurableOutboxRecord | null>
  enqueue(
    transaction: TransactionContext,
    command: DurableOutboxEnqueue
  ): Promise<Readonly<{ workId: string; created: boolean }>>
  claim(
    transaction: TransactionContext,
    command: DurableOutboxClaim
  ): Promise<readonly DurableOutboxRecord[]>
  fenceCurrent(
    transaction: TransactionContext,
    lease: DurableOutboxLeaseIdentity
  ): Promise<boolean>
  settle(
    transaction: TransactionContext,
    command: DurableOutboxSettlement
  ): Promise<DurableOutboxRecord>
  retry(
    transaction: TransactionContext,
    command: DurableOutboxRetry
  ): Promise<DurableOutboxRecord>
}

export interface TransactionBoundary {
  run<TResult>(
    work: (transaction: TransactionContext) => Promise<TResult>,
    traceContext?: TraceContext
  ): Promise<TResult>
}
