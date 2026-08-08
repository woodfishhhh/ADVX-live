import {
  canonicalRuntimeSpecSchema,
  type Epoch,
  type Revision,
  type RoomId,
  type SessionId,
  type SessionOutcome
} from '@advx/contracts'
import type { Database } from 'bun:sqlite'

import type { RuntimeSpecDiffSummary } from '../../../domain/runtime-spec'
import {
  type ModeMemeRepository,
  type OutboxRepository,
  type PersistedRoomState,
  type PersistedSessionState,
  type RoomRecord,
  type RoomEventRepository,
  type RoomMemoryRepository,
  type RoomRepository,
  type RuntimeSpecCommitToken,
  type RuntimeSpecRecord,
  type RuntimeSpecRepository,
  type RuntimeSpecRevisionOperation,
  type RuntimeSpecRevisionStatus,
  type SessionRecord,
  type SessionRepository,
  type TransactionContext,
  type ViewerInstanceRepository
} from '../../../application/ports/repositories'
import { wallClockTimestampMs } from '../../../application/ports/time'
import { SqlitePersistenceError } from './errors'
import { SqliteTransactionBoundary } from './transaction'
import { SqliteViewerInstanceRepository } from './viewer-repository'
import { SqliteRoomEventRepository } from './room-event-repository'
import { SqliteRoomMemoryRepository } from './room-memory-repository'
import { SqliteModeMemeRepository } from './mode-meme-repository'
import { SqliteOutboxRepository } from './outbox-repository'

type RoomRow = Readonly<{
  room_id: string
  display_name: string
  state: PersistedRoomState
  revision: number
  created_at_ms: number
  updated_at_ms: number
}>

type SessionRow = Readonly<{
  session_id: string
  room_id: string | null
  state: PersistedSessionState | null
  audience_epoch: number | null
  active_config_hash: string | null
  recovery_json: string | null
  controller_state_json: string
  client_request_id: string | null
  client_request_hash: string | null
  started_at_ms: number
  ended_at_ms: number | null
  outcome: SessionOutcome | null
  app_version: string
}>

type RuntimeRevisionRow = Readonly<{
  session_id: string
  revision: number
  apply_id: string
  base_revision: number
  config_hash: string
  status: RuntimeSpecRevisionStatus
  canonical_spec_json: string
  diff_summary_json: string
  created_at_ms: number
  updated_at_ms: number
  room_id: string | null
  audience_epoch: number | null
}>

type ControllerState = Readonly<{
  schema_version: 1
  lifecycle_revision: number
  updated_at_ms: number
}>

type RecoveryState = Readonly<{
  schema_version: 1
  recovery_eligible: boolean
  recovered: boolean
  recovered_at_ms: number | null
  last_recovered_at_ms: number | null
  last_clean_shutdown_at_ms: number | null
}>

type RuntimePersistenceMetadata = Readonly<{
  schema_version: 1
  operation: RuntimeSpecRevisionOperation
  rollback_target_revision: number | null
  audience_epoch: number
}>

type StoredDiffSummary = RuntimeSpecDiffSummary & Readonly<{
  _advx_persistence: RuntimePersistenceMetadata
}>

export type SqliteRepositories = Readonly<{
  transactions: SqliteTransactionBoundary
  rooms: RoomRepository
  sessions: SessionRepository
  runtimeSpecs: RuntimeSpecRepository
  viewers: ViewerInstanceRepository
  roomEvents: RoomEventRepository
  memories: RoomMemoryRepository
  modeMemes: ModeMemeRepository
  outbox: OutboxRepository
}>

export function createSqliteRepositories(
  transactions: SqliteTransactionBoundary
): SqliteRepositories {
  return Object.freeze({
    transactions,
    rooms: new SqliteRoomRepository(transactions),
    sessions: new SqliteSessionRepository(transactions),
    runtimeSpecs: new SqliteRuntimeSpecRepository(transactions),
    viewers: new SqliteViewerInstanceRepository(transactions),
    roomEvents: new SqliteRoomEventRepository(transactions),
    memories: new SqliteRoomMemoryRepository(transactions),
    modeMemes: new SqliteModeMemeRepository(transactions),
    outbox: new SqliteOutboxRepository(transactions)
  })
}

export class SqliteRoomRepository implements RoomRepository {
  constructor(private readonly transactions: SqliteTransactionBoundary) {}

  async get(transaction: TransactionContext, roomId: RoomId): Promise<RoomRecord | null> {
    const row = this.transactions
      .connection(transaction)
      .query('SELECT * FROM rooms WHERE room_id = ?')
      .get(roomId) as RoomRow | null
    return row === null ? null : roomFromRow(row)
  }

  async clear(transaction: TransactionContext, roomId: RoomId): Promise<boolean> {
    const database = this.transactions.connection(transaction)
    const result = database.run('DELETE FROM rooms WHERE room_id = ?', [roomId])
    return result.changes > 0
  }

  async save(
    transaction: TransactionContext,
    room: RoomRecord,
    expectedRevision: Revision | null
  ): Promise<void> {
    validateRoom(room, expectedRevision)
    const database = this.transactions.connection(transaction)
    if (expectedRevision === null) {
      const result = database
        .query(
          `INSERT INTO rooms
            (room_id, display_name, state, revision, created_at_ms, updated_at_ms)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(room_id) DO NOTHING`
        )
        .run(
          room.roomId,
          room.displayName,
          room.state,
          room.revision,
          room.createdAt,
          room.updatedAt
        )
      requireChanged(result.changes, 'room already exists')
      database
        .query(
          `INSERT INTO room_memory_heads (room_id, revision, updated_at_ms)
           VALUES (?, 0, ?)`
        )
        .run(room.roomId, room.updatedAt)
      return
    }

    const result = database
      .query(
        `UPDATE rooms
         SET display_name = ?, state = ?, revision = ?, updated_at_ms = ?
         WHERE room_id = ? AND revision = ?`
      )
      .run(
        room.displayName,
        room.state,
        room.revision,
        room.updatedAt,
        room.roomId,
        expectedRevision
      )
    requireChanged(result.changes, 'room revision is stale')
  }
}

export class SqliteSessionRepository implements SessionRepository {
  constructor(private readonly transactions: SqliteTransactionBoundary) {}

  async get(
    transaction: TransactionContext,
    sessionId: SessionId
  ): Promise<SessionRecord | null> {
    const row = this.transactions
      .connection(transaction)
      .query('SELECT * FROM session_records WHERE session_id = ?')
      .get(sessionId) as SessionRow | null
    return row === null ? null : sessionFromRow(row)
  }

  async getIdempotentStart(
    transaction: TransactionContext,
    clientRequestId: string,
    requestHash: string
  ): Promise<SessionRecord | null> {
    return findIdempotentSession(
      this.transactions.connection(transaction),
      clientRequestId,
      requestHash
    )
  }

  async save(
    transaction: TransactionContext,
    session: SessionRecord,
    expectedRevision: Revision | null
  ): Promise<void> {
    validateSession(session, expectedRevision)
    const database = this.transactions.connection(transaction)
    const controllerJson = JSON.stringify(controllerState(session))
    const recoveryJson = JSON.stringify(recoveryState(session))
    if (expectedRevision === null) {
      if (session.clientRequestId !== null && session.clientRequestHash !== null) {
        const existing = findIdempotentSession(
          database,
          session.clientRequestId,
          session.clientRequestHash
        )
        if (existing !== null) return
      }
      const result = database.run(
        `INSERT INTO session_records (
           session_id, room_id, state, audience_epoch, active_config_hash,
           recovery_json, session_seed, next_creation_ordinal,
           target_concurrent_viewers, population_revision, controller_state_json,
           client_request_id, client_request_hash, started_at_ms, ended_at_ms,
           outcome, app_version
         ) VALUES (?, ?, ?, ?, ?, ?, '', 1, 1, 1, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT DO NOTHING`,
        [
          session.sessionId,
          session.roomId,
          session.state,
          session.audienceEpoch,
          session.activeConfigHash,
          recoveryJson,
          controllerJson,
          session.clientRequestId,
          session.clientRequestHash,
          session.startedAt,
          session.endedAt,
          session.outcome,
          session.appVersion
        ]
      )
      if (result.changes === 1) return
      if (session.clientRequestId !== null && session.clientRequestHash !== null) {
        const concurrent = findIdempotentSession(
          database,
          session.clientRequestId,
          session.clientRequestHash
        )
        if (concurrent !== null) return
      }
      conflict('session ID was already used by a different start request')
    }

    const result = database
      .query(
        `UPDATE session_records
         SET room_id = ?, state = ?, audience_epoch = ?, active_config_hash = ?,
             recovery_json = ?, controller_state_json = ?, client_request_id = ?,
             client_request_hash = ?, ended_at_ms = ?, outcome = ?, app_version = ?
         WHERE session_id = ?
           AND COALESCE(
             CAST(json_extract(controller_state_json, '$.lifecycle_revision') AS INTEGER),
             0
           ) = ?`
      )
      .run(
        session.roomId,
        session.state,
        session.audienceEpoch,
        session.activeConfigHash,
        recoveryJson,
        controllerJson,
        session.clientRequestId,
        session.clientRequestHash,
        session.endedAt,
        session.outcome,
        session.appVersion,
        session.sessionId,
        expectedRevision
      )
    requireChanged(result.changes, 'session lifecycle revision is stale')
  }
}

export class SqliteRuntimeSpecRepository implements RuntimeSpecRepository {
  constructor(private readonly transactions: SqliteTransactionBoundary) {}

  async getActive(
    transaction: TransactionContext,
    sessionId: SessionId
  ): Promise<RuntimeSpecRecord | null> {
    return this.getOne(
      this.transactions.connection(transaction),
      `WHERE revisions.session_id = ? AND revisions.status = 'committed'
       ORDER BY revisions.revision DESC LIMIT 1`,
      sessionId
    )
  }

  async getRevision(
    transaction: TransactionContext,
    sessionId: SessionId,
    revision: Revision
  ): Promise<RuntimeSpecRecord | null> {
    return this.getOne(
      this.transactions.connection(transaction),
      'WHERE revisions.session_id = ? AND revisions.revision = ?',
      sessionId,
      revision
    )
  }

  async getByApplyId(
    transaction: TransactionContext,
    sessionId: SessionId,
    applyId: string
  ): Promise<RuntimeSpecRecord | null> {
    return this.getOne(
      this.transactions.connection(transaction),
      'WHERE revisions.session_id = ? AND revisions.apply_id = ?',
      sessionId,
      applyId
    )
  }

  async nextRevision(
    transaction: TransactionContext,
    sessionId: SessionId
  ): Promise<Revision> {
    const row = this.transactions
      .connection(transaction)
      .query(
        `SELECT COALESCE(MAX(revision), 0) + 1 AS next_revision
         FROM session_runtime_revisions WHERE session_id = ?`
      )
      .get(sessionId) as { next_revision: number }
    return asRevision(row.next_revision)
  }

  async addPending(
    transaction: TransactionContext,
    record: RuntimeSpecRecord
  ): Promise<void> {
    validateRuntimeRecord(record, 'pending')
    const database = this.transactions.connection(transaction)
    const session = database
      .query('SELECT room_id FROM session_records WHERE session_id = ?')
      .get(record.sessionId) as { room_id: string | null } | null
    if (session === null) notFound('runtime session is missing')
    if (session.room_id !== record.roomId) invariant('runtime room does not match its session')

    const existing = await this.getOne(
      database,
      'WHERE revisions.session_id = ? AND revisions.apply_id = ?',
      record.sessionId,
      record.applyId
    )
    if (existing !== null) {
      requireSameRuntimeIdentity(existing, record)
      return
    }

    const active = await this.getOne(
      database,
      `WHERE revisions.session_id = ? AND revisions.status = 'committed'
       ORDER BY revisions.revision DESC LIMIT 1`,
      record.sessionId
    )
    if ((active?.revision ?? 0) !== record.baseRevision) {
      conflict('runtime base revision is stale')
    }
    const next = database
      .query(
        `SELECT COALESCE(MAX(revision), 0) + 1 AS next_revision
         FROM session_runtime_revisions WHERE session_id = ?`
      )
      .get(record.sessionId) as { next_revision: number }
    if (next.next_revision !== record.revision) conflict('runtime revision is stale')

    database
      .query(
        `INSERT INTO session_runtime_revisions (
           session_id, revision, apply_id, base_revision, config_hash, status,
           canonical_spec_json, diff_summary_json, created_at_ms, updated_at_ms
         ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`
      )
      .run(
        record.sessionId,
        record.revision,
        record.applyId,
        record.baseRevision,
        record.configHash,
        record.canonicalSpecJson,
        serializeDiffSummary(record),
        record.createdAt,
        record.updatedAt
      )
  }

  async rejectPending(
    transaction: TransactionContext,
    sessionId: SessionId,
    revision: Revision,
    updatedAt: RuntimeSpecRecord['updatedAt']
  ): Promise<void> {
    const result = this.transactions
      .connection(transaction)
      .query(
        `UPDATE session_runtime_revisions
         SET status = 'rejected', updated_at_ms = ?
         WHERE session_id = ? AND revision = ? AND status = 'pending'`
      )
      .run(updatedAt, sessionId, revision)
    requireChanged(result.changes, 'pending runtime revision does not match')
  }

  async prepareCommit(
    transaction: TransactionContext,
    record: RuntimeSpecRecord,
    expectedActiveRevision: Revision,
    rolledBackRevision?: Revision
  ): Promise<RuntimeSpecCommitToken> {
    validateRuntimeRecord(record, 'committed')
    const database = this.transactions.connection(transaction)
    const active = await this.getOne(
      database,
      `WHERE revisions.session_id = ? AND revisions.status = 'committed'
       ORDER BY revisions.revision DESC LIMIT 1`,
      record.sessionId
    )
    if ((active?.revision ?? 0) !== expectedActiveRevision) {
      conflict('runtime head changed before commit')
    }

    const pending = await this.getOne(
      database,
      'WHERE revisions.session_id = ? AND revisions.revision = ?',
      record.sessionId,
      record.revision
    )
    if (pending === null || pending.status !== 'pending') {
      conflict('pending runtime revision does not match')
    }
    requireSameRuntimeIdentity(pending, { ...record, status: 'pending' })

    if (rolledBackRevision !== undefined) {
      if (rolledBackRevision !== expectedActiveRevision) {
        conflict('rollback revision does not match the active runtime head')
      }
      const rolledBack = database
        .query(
          `UPDATE session_runtime_revisions
           SET status = 'rolled_back', updated_at_ms = ?
           WHERE session_id = ? AND revision = ? AND status = 'committed'`
        )
        .run(record.updatedAt, record.sessionId, rolledBackRevision)
      requireChanged(rolledBack.changes, 'rollback source revision is unavailable')
    }

    const committed = database
      .query(
        `UPDATE session_runtime_revisions
         SET status = 'committed', diff_summary_json = ?, updated_at_ms = ?
         WHERE session_id = ? AND revision = ? AND status = 'pending'`
      )
      .run(
        serializeDiffSummary(record),
        record.updatedAt,
        record.sessionId,
        record.revision
      )
    requireChanged(committed.changes, 'pending runtime revision changed before commit')

    const session = database
      .query(
        `UPDATE session_records
         SET audience_epoch = ?, active_config_hash = ?
         WHERE session_id = ? AND room_id = ?
           AND COALESCE(audience_epoch, 0) < ?`
      )
      .run(
        record.audienceEpoch,
        record.configHash,
        record.sessionId,
        record.roomId,
        record.audienceEpoch
      )
    requireChanged(session.changes, 'session audience epoch did not advance')

    return Object.freeze({
      record,
      commit() {}
    })
  }

  async getOne(
    database: Database,
    clause: string,
    ...parameters: (string | number)[]
  ): Promise<RuntimeSpecRecord | null> {
    const row = database
      .query(
        `SELECT revisions.*, sessions.room_id, sessions.audience_epoch
         FROM session_runtime_revisions AS revisions
         JOIN session_records AS sessions ON sessions.session_id = revisions.session_id
         ${clause}`
      )
      .get(...parameters) as RuntimeRevisionRow | null
    return row === null ? null : runtimeFromRow(row)
  }
}

function roomFromRow(row: RoomRow): RoomRecord {
  return Object.freeze({
    roomId: row.room_id as RoomId,
    displayName: row.display_name,
    state: row.state,
    revision: asRevision(row.revision),
    createdAt: wallClockTimestampMs(row.created_at_ms),
    updatedAt: wallClockTimestampMs(row.updated_at_ms)
  })
}

function sessionFromRow(row: SessionRow): SessionRecord {
  if (row.room_id === null || row.state === null) {
    invariant('session record is missing required lifecycle identity')
  }
  const controller = parseControllerState(row.controller_state_json, row.started_at_ms)
  const recovery = parseRecoveryState(row.recovery_json)
  return Object.freeze({
    sessionId: row.session_id as SessionId,
    roomId: row.room_id as RoomId,
    state: row.state,
    revision: asRevision(controller.lifecycle_revision),
    audienceEpoch: asEpoch(row.audience_epoch ?? 0),
    activeConfigHash: row.active_config_hash,
    recoveryEligible: recovery.recovery_eligible,
    lastCleanShutdownAt: nullableTimestamp(recovery.last_clean_shutdown_at_ms),
    lastRecoveredAt: nullableTimestamp(recovery.last_recovered_at_ms),
    clientRequestId: row.client_request_id,
    clientRequestHash: row.client_request_hash,
    startedAt: wallClockTimestampMs(row.started_at_ms),
    updatedAt: wallClockTimestampMs(controller.updated_at_ms),
    endedAt: nullableTimestamp(row.ended_at_ms),
    outcome: row.outcome,
    appVersion: row.app_version
  })
}

function findIdempotentSession(
  database: Database,
  clientRequestId: string,
  requestHash: string
): SessionRecord | null {
  const row = database
    .query('SELECT * FROM session_records WHERE client_request_id = ?')
    .get(clientRequestId) as SessionRow | null
  if (row !== null && row.client_request_hash !== requestHash) {
    conflict('client request ID was already used with a different canonical hash')
  }
  return row === null ? null : sessionFromRow(row)
}

function runtimeFromRow(row: RuntimeRevisionRow): RuntimeSpecRecord {
  let candidate: unknown
  let storedDiff: unknown
  try {
    candidate = JSON.parse(row.canonical_spec_json)
    storedDiff = JSON.parse(row.diff_summary_json)
  } catch (error) {
    throw new SqlitePersistenceError(
      'invariant_violation',
      'persisted runtime JSON is invalid',
      { cause: error }
    )
  }
  let spec: RuntimeSpecRecord['spec']
  try {
    spec = canonicalRuntimeSpecSchema.parse(candidate)
  } catch (error) {
    throw new SqlitePersistenceError(
      'invariant_violation',
      'persisted canonical runtime spec is invalid',
      { cause: error }
    )
  }
  const { diffSummary, metadata } = parseStoredDiffSummary(storedDiff, row)
  if (row.room_id === null) invariant('runtime session is missing its room')
  return Object.freeze({
    sessionId: row.session_id as SessionId,
    roomId: row.room_id as RoomId,
    revision: asRevision(row.revision),
    applyId: row.apply_id,
    operation: metadata.operation,
    rollbackTargetRevision:
      metadata.rollback_target_revision === null
        ? null
        : asRevision(metadata.rollback_target_revision),
    baseRevision: asRevision(row.base_revision),
    status: row.status,
    configRevision: spec.config_revision,
    audienceEpoch: asEpoch(metadata.audience_epoch ?? row.audience_epoch ?? 0),
    configHash: row.config_hash,
    canonicalSpecJson: row.canonical_spec_json,
    spec,
    diffSummary,
    createdAt: wallClockTimestampMs(row.created_at_ms),
    updatedAt: wallClockTimestampMs(row.updated_at_ms)
  })
}

function validateRoom(room: RoomRecord, expectedRevision: Revision | null): void {
  if (room.displayName.trim().length === 0 || room.updatedAt < room.createdAt) {
    invalid('room record is invalid')
  }
  requireNextRevision(room.revision, expectedRevision, 'room')
}

function validateSession(session: SessionRecord, expectedRevision: Revision | null): void {
  if (
    session.appVersion.trim().length === 0 ||
    session.updatedAt < session.startedAt ||
    (session.endedAt !== null && session.endedAt < session.startedAt) ||
    ((session.endedAt === null) !== (session.outcome === null)) ||
    ((session.clientRequestId === null) !== (session.clientRequestHash === null))
  ) {
    invalid('session record is invalid')
  }
  requireNextRevision(session.revision, expectedRevision, 'session')
}

function validateRuntimeRecord(
  record: RuntimeSpecRecord,
  expectedStatus: 'pending' | 'committed'
): void {
  if (
    record.status !== expectedStatus ||
    record.applyId.trim().length === 0 ||
    record.configHash.trim().length === 0 ||
    record.updatedAt < record.createdAt ||
    record.spec.room.room_id !== record.roomId ||
    record.spec.config_revision !== record.configRevision ||
    (record.operation === 'rollback') !== (record.rollbackTargetRevision !== null)
  ) {
    invalid('runtime revision record is invalid')
  }
}

function requireNextRevision(
  next: Revision,
  expected: Revision | null,
  recordType: string
): void {
  const required = expected === null ? 0 : expected + 1
  if (next !== required) invalid(`${recordType} revision must advance exactly once`)
}

function controllerState(session: SessionRecord): ControllerState {
  return {
    schema_version: 1,
    lifecycle_revision: session.revision,
    updated_at_ms: session.updatedAt
  }
}

function recoveryState(session: SessionRecord): RecoveryState {
  return {
    schema_version: 1,
    recovery_eligible: session.recoveryEligible,
    recovered: session.lastRecoveredAt !== null,
    recovered_at_ms: session.lastRecoveredAt,
    last_recovered_at_ms: session.lastRecoveredAt,
    last_clean_shutdown_at_ms: session.lastCleanShutdownAt
  }
}

function parseControllerState(value: string, fallbackTimestamp: number): ControllerState {
  const parsed = parseObject(value)
  const revision = parsed.lifecycle_revision ?? 0
  const updatedAt = parsed.updated_at_ms ?? fallbackTimestamp
  if (!isNonNegativeInteger(revision) || !isNonNegativeInteger(updatedAt)) {
    invariant('persisted session controller state is invalid')
  }
  return {
    schema_version: 1,
    lifecycle_revision: revision,
    updated_at_ms: updatedAt
  }
}

function parseRecoveryState(value: string | null): RecoveryState {
  const parsed = value === null ? {} : parseObject(value)
  const recoveredAt = parsed.last_recovered_at_ms ?? parsed.recovered_at_ms ?? null
  const cleanAt = parsed.last_clean_shutdown_at_ms ?? null
  if (
    (recoveredAt !== null && !isNonNegativeInteger(recoveredAt)) ||
    (cleanAt !== null && !isNonNegativeInteger(cleanAt))
  ) {
    invariant('persisted session recovery markers are invalid')
  }
  return {
    schema_version: 1,
    recovery_eligible:
      typeof parsed.recovery_eligible === 'boolean' ? parsed.recovery_eligible : false,
    recovered: recoveredAt !== null,
    recovered_at_ms: recoveredAt,
    last_recovered_at_ms: recoveredAt,
    last_clean_shutdown_at_ms: cleanAt
  }
}

function serializeDiffSummary(record: RuntimeSpecRecord): string {
  const stored: StoredDiffSummary = {
    ...record.diffSummary,
    _advx_persistence: {
      schema_version: 1,
      operation: record.operation,
      rollback_target_revision: record.rollbackTargetRevision,
      audience_epoch: record.audienceEpoch
    }
  }
  return JSON.stringify(stored)
}

function parseStoredDiffSummary(
  value: unknown,
  row: RuntimeRevisionRow
): Readonly<{
  diffSummary: RuntimeSpecDiffSummary
  metadata: RuntimePersistenceMetadata
}> {
  if (!isRecord(value)) invariant('persisted runtime diff summary is invalid')
  const metadataValue = value._advx_persistence
  const metadata = isRecord(metadataValue)
    ? parseRuntimeMetadata(metadataValue)
    : legacyRuntimeMetadata(row)
  const diffSummary = parseDiffSummary(value)
  return { diffSummary, metadata }
}

function parseRuntimeMetadata(value: Record<string, unknown>): RuntimePersistenceMetadata {
  const operation = value.operation
  const rollbackTarget = value.rollback_target_revision
  const audienceEpoch = value.audience_epoch
  if (
    (operation !== 'bootstrap' && operation !== 'apply' && operation !== 'rollback') ||
    (rollbackTarget !== null && !isPositiveInteger(rollbackTarget)) ||
    !isNonNegativeInteger(audienceEpoch) ||
    (operation === 'rollback') !== (rollbackTarget !== null)
  ) {
    invariant('persisted runtime revision metadata is invalid')
  }
  return {
    schema_version: 1,
    operation,
    rollback_target_revision: rollbackTarget,
    audience_epoch: audienceEpoch
  }
}

function legacyRuntimeMetadata(row: RuntimeRevisionRow): RuntimePersistenceMetadata {
  return {
    schema_version: 1,
    operation: row.revision === 1 && row.base_revision === 0 ? 'bootstrap' : 'apply',
    rollback_target_revision: null,
    audience_epoch: row.audience_epoch ?? 0
  }
}

function parseDiffSummary(value: Record<string, unknown>): RuntimeSpecDiffSummary {
  const changedSections = value.changedSections
  if (
    !Array.isArray(changedSections) ||
    !changedSections.every(
      (item) =>
        item === 'room' ||
        item === 'active_mode' ||
        item === 'personas' ||
        item === 'modes' ||
        item === 'provider' ||
        item === 'settings'
    ) ||
    typeof value.providerChanged !== 'boolean' ||
    typeof value.settingsChanged !== 'boolean'
  ) {
    invariant('persisted runtime diff summary is invalid')
  }
  return Object.freeze({
    changedSections,
    personas: parseIdentityDiff(value.personas),
    modes: parseIdentityDiff(value.modes),
    providerChanged: value.providerChanged,
    settingsChanged: value.settingsChanged
  })
}

function parseIdentityDiff(value: unknown): RuntimeSpecDiffSummary['personas'] {
  if (
    !isRecord(value) ||
    !isStringArray(value.addedIds) ||
    !isStringArray(value.removedIds) ||
    !isStringArray(value.changedIds) ||
    !isNonNegativeInteger(value.previousCount) ||
    !isNonNegativeInteger(value.nextCount)
  ) {
    invariant('persisted runtime identity diff is invalid')
  }
  return Object.freeze({
    addedIds: value.addedIds,
    removedIds: value.removedIds,
    changedIds: value.changedIds,
    previousCount: value.previousCount,
    nextCount: value.nextCount
  })
}

function requireSameRuntimeIdentity(
  existing: RuntimeSpecRecord,
  candidate: RuntimeSpecRecord
): void {
  if (
    existing.sessionId !== candidate.sessionId ||
    existing.roomId !== candidate.roomId ||
    existing.revision !== candidate.revision ||
    existing.applyId !== candidate.applyId ||
    existing.operation !== candidate.operation ||
    existing.rollbackTargetRevision !== candidate.rollbackTargetRevision ||
    existing.baseRevision !== candidate.baseRevision ||
    existing.configRevision !== candidate.configRevision ||
    existing.audienceEpoch !== candidate.audienceEpoch ||
    existing.configHash !== candidate.configHash ||
    existing.canonicalSpecJson !== candidate.canonicalSpecJson
  ) {
    conflict('apply ID was already used with different runtime content')
  }
}

function parseObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    if (isRecord(parsed)) return parsed
  } catch (error) {
    throw new SqlitePersistenceError(
      'invariant_violation',
      'persisted JSON object is invalid',
      { cause: error }
    )
  }
  invariant('persisted JSON object is invalid')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1
}

function asRevision(value: number): Revision {
  if (!isNonNegativeInteger(value)) invariant('persisted revision is invalid')
  return value as Revision
}

function asEpoch(value: number): Epoch {
  if (!isNonNegativeInteger(value)) invariant('persisted audience epoch is invalid')
  return value as Epoch
}

function nullableTimestamp(value: number | null) {
  return value === null ? null : wallClockTimestampMs(value)
}

function requireChanged(changes: number, message: string): void {
  if (changes !== 1) conflict(message)
}

function invalid(message: string): never {
  throw new SqlitePersistenceError('invalid_record', message)
}

function conflict(message: string): never {
  throw new SqlitePersistenceError('optimistic_conflict', message)
}

function notFound(message: string): never {
  throw new SqlitePersistenceError('not_found', message)
}

function invariant(message: string): never {
  throw new SqlitePersistenceError('invariant_violation', message)
}
