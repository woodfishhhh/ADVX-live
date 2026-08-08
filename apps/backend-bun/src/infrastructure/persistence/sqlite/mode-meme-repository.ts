import {
  canonicalJson,
  type Epoch,
  type Revision,
  type RoomId,
  type SafeJsonValue,
  type SessionId
} from '@advx/contracts'
import type { Database } from 'bun:sqlite'

import type {
  MemeCandidateOutcome,
  ModeMemeAction,
  ModeMemeAutoIngestSetting,
  ModeMemeCandidate,
  ModeMemeCommitResult,
  ModeMemeEdit,
  ModeMemeEvent,
  ModeMemePinUpdate,
  ModeMemeRecord,
  ModeMemeRepository,
  ModeMemeSource,
  ModeMemeState,
  ModeMemeStateChange,
  ModeMemeUse,
  TransactionContext
} from '../../../application/ports/repositories'
import {
  wallClockTimestampMs,
  type WallClockTimestampMs
} from '../../../application/ports/time'
import { SqlitePersistenceError } from './errors'
import type { SqliteTransactionBoundary } from './transaction'

type MemeRow = Readonly<{
  meme_id: string
  mode_namespace: string
  content: string
  intensity: number
  state: string
  source_json: string
  revision: number
  created_at_ms: number
  updated_at_ms: number
}>

type MemeEventRow = Readonly<{
  event_id: string
  meme_id: string
  action: string
  payload_json: string
  previous_revision: number
  new_revision: number
  created_at_ms: number
}>

type MemeCandidateRow = Readonly<{
  candidate_id: string
  room_id: string
  session_id: string
  audience_epoch: number
  observation_id: string
  mode_namespace: string
  idempotency_key: string
  text: string
  evidence_event_ids_json: string
  evidence_frame_indexes_json: string
  outcome: string
  result_meme_id: string | null
  created_at_ms: number
  updated_at_ms: number
}>

type MemeSettingRow = Readonly<{
  mode_namespace: string
  auto_ingest_enabled: number
  revision: number
  created_at_ms: number
  updated_at_ms: number
}>

const MAX_ID_CHARS = 128
const MAX_TEXT_CHARS = 500
const MAX_EVIDENCE_EVENTS = 128
const MAX_FRAME_BUNDLE_SIZE = 15

const MEME_STATES = new Set<ModeMemeState>([
  'active',
  'disabled',
  'archived',
  'revoked'
])
const MEME_ACTIONS = new Set<ModeMemeAction>([
  'created',
  'edited',
  'revoked',
  'restored',
  'disabled',
  'archived'
])
const CANDIDATE_OUTCOMES = new Set<MemeCandidateOutcome>([
  'pending',
  'accepted',
  'rejected'
])

export class SqliteModeMemeRepository implements ModeMemeRepository {
  constructor(private readonly transactions: SqliteTransactionBoundary) {}

  async listActive(
    transaction: TransactionContext,
    namespaceId: string
  ): Promise<readonly ModeMemeRecord[]> {
    validateId(namespaceId, 'mode namespace')
    const rows = this.transactions
      .connection(transaction)
      .query(
        `SELECT * FROM mode_memes
         WHERE mode_namespace = ? AND state = 'active'
         ORDER BY updated_at_ms DESC, meme_id`
      )
      .all(namespaceId) as MemeRow[]
    return Object.freeze(rows.map(memeRecord))
  }

  async listAll(
    transaction: TransactionContext,
    namespaceId: string
  ): Promise<readonly ModeMemeRecord[]> {
    validateId(namespaceId, 'mode namespace')
    const rows = this.transactions
      .connection(transaction)
      .query(
        `SELECT * FROM mode_memes
         WHERE mode_namespace = ?
         ORDER BY updated_at_ms DESC, meme_id`
      )
      .all(namespaceId) as MemeRow[]
    return Object.freeze(rows.map(memeRecord))
  }

  async listPending(
    transaction: TransactionContext,
    namespaceId: string
  ): Promise<readonly ModeMemeCandidate[]> {
    validateId(namespaceId, 'mode namespace')
    const rows = this.transactions
      .connection(transaction)
      .query(
        `SELECT * FROM mode_meme_candidates
         WHERE mode_namespace = ? AND outcome = 'pending'
         ORDER BY created_at_ms, candidate_id`
      )
      .all(namespaceId) as MemeCandidateRow[]
    return Object.freeze(rows.map(candidateRecord))
  }

  async getCandidate(
    transaction: TransactionContext,
    namespaceId: string,
    candidateId: string
  ): Promise<ModeMemeCandidate> {
    validateId(namespaceId, 'mode namespace')
    validateId(candidateId, 'meme candidate ID')
    const row = this.transactions
      .connection(transaction)
      .query(
        `SELECT * FROM mode_meme_candidates
         WHERE mode_namespace = ? AND candidate_id = ?`
      )
      .get(namespaceId, candidateId) as MemeCandidateRow | null
    if (row === null) notFound('meme candidate is missing')
    return candidateRecord(row)
  }

  async findCandidate(
    transaction: TransactionContext,
    candidateId: string
  ): Promise<ModeMemeCandidate | null> {
    validateId(candidateId, 'meme candidate ID')
    const row = this.transactions
      .connection(transaction)
      .query('SELECT * FROM mode_meme_candidates WHERE candidate_id = ?')
      .get(candidateId) as MemeCandidateRow | null
    return row === null ? null : candidateRecord(row)
  }

  async saveCandidate(
    transaction: TransactionContext,
    candidate: ModeMemeCandidate
  ): Promise<void> {
    validateCandidate(candidate)
    const database = this.transactions.connection(transaction)
    validateIdempotency(database, candidate)
    const existing = candidateRow(database, candidate.candidateId)
    if (existing !== null) {
      requireSameCandidate(existing, candidate)
      return
    }
    insertCandidate(database, candidate, 'pending', null)
  }

  async commitCandidate(
    transaction: TransactionContext,
    candidate: ModeMemeCandidate
  ): Promise<ModeMemeCommitResult> {
    validateCandidate(candidate)
    const database = this.transactions.connection(transaction)
    validateIdempotency(database, candidate)
    const storedCandidate = candidateRow(database, candidate.candidateId)
    if (storedCandidate !== null) {
      requireSameCandidate(storedCandidate, candidate)
      if (storedCandidate.outcome === 'accepted') {
        return Object.freeze({
          accepted: true,
          memeId: storedCandidate.result_meme_id ?? memeId(candidate.candidateId),
          created: false
        })
      }
      if (storedCandidate.outcome !== 'pending') {
        conflict('meme candidate outcome is stale')
      }
    }

    const id = memeId(candidate.candidateId)
    const existingMeme = database
      .query('SELECT * FROM mode_memes WHERE meme_id = ?')
      .get(id) as MemeRow | null
    if (existingMeme !== null) {
      const existing = memeRecord(existingMeme)
      if (
        existing.namespaceId !== candidate.namespaceId ||
        existing.text !== candidate.text ||
        existing.source.sourceCandidateId !== candidate.candidateId
      ) {
        conflict('meme candidate ID was used with different content')
      }
      return Object.freeze({ accepted: true, memeId: id, created: false })
    }

    const source = sourceFromCandidate(candidate)
    database
      .query(
        `INSERT INTO mode_memes (
           meme_id, mode_namespace, content, intensity, state, source_json,
           revision, created_at_ms, updated_at_ms
         ) VALUES (?, ?, ?, 0.5, 'active', ?, 1, ?, ?)`
      )
      .run(
        id,
        candidate.namespaceId,
        candidate.text,
        serializeSource(source),
        candidate.createdAt,
        candidate.createdAt
      )
    insertEvent(database, {
      eventId: `meme-event:created:${candidate.candidateId}`,
      memeId: id,
      action: 'created',
      payload: { content: candidate.text },
      previousRevision: 0 as Revision,
      newRevision: 1 as Revision,
      createdAt: candidate.createdAt
    })

    if (storedCandidate === null) {
      insertCandidate(database, candidate, 'accepted', id)
    } else {
      const result = database
        .query(
          `UPDATE mode_meme_candidates
           SET outcome = 'accepted', result_meme_id = ?, updated_at_ms = ?
           WHERE candidate_id = ? AND outcome = 'pending'`
        )
        .run(id, candidate.createdAt, candidate.candidateId)
      requireChanged(result.changes, 'meme candidate outcome is stale')
    }
    return Object.freeze({ accepted: true, memeId: id, created: true })
  }

  async approveCandidate(
    transaction: TransactionContext,
    namespaceId: string,
    candidateId: string,
    approvedAt: WallClockTimestampMs
  ): Promise<ModeMemeCommitResult> {
    validateTimestamp(approvedAt, 'meme approval timestamp')
    const candidate = await this.getCandidate(
      transaction,
      namespaceId,
      candidateId
    )
    if (candidate.outcome !== 'pending') {
      conflict('meme candidate is not pending')
    }
    return await this.commitCandidate(transaction, {
      ...candidate,
      createdAt: approvedAt
    })
  }

  async rejectCandidate(
    transaction: TransactionContext,
    namespaceId: string,
    candidateId: string,
    rejectedAt: WallClockTimestampMs
  ): Promise<ModeMemeCandidate> {
    validateId(namespaceId, 'mode namespace')
    validateId(candidateId, 'meme candidate ID')
    validateTimestamp(rejectedAt, 'meme rejection timestamp')
    const database = this.transactions.connection(transaction)
    const result = database
      .query(
        `UPDATE mode_meme_candidates
         SET outcome = 'rejected', updated_at_ms = ?
         WHERE candidate_id = ? AND mode_namespace = ? AND outcome = 'pending'`
      )
      .run(rejectedAt, candidateId, namespaceId)
    requireChanged(result.changes, 'meme candidate is not pending')
    return candidateRecord(candidateRow(database, candidateId)!)
  }

  async getAutoIngest(
    transaction: TransactionContext,
    namespaceId: string
  ): Promise<ModeMemeAutoIngestSetting> {
    validateId(namespaceId, 'mode namespace')
    const row = this.transactions
      .connection(transaction)
      .query('SELECT * FROM mode_meme_settings WHERE mode_namespace = ?')
      .get(namespaceId) as MemeSettingRow | null
    if (row === null) {
      return Object.freeze({
        namespaceId,
        enabled: true,
        revision: 0 as Revision
      })
    }
    return settingRecord(row)
  }

  async setAutoIngest(
    transaction: TransactionContext,
    namespaceId: string,
    enabled: boolean,
    expectedRevision: Revision,
    updatedAt: WallClockTimestampMs
  ): Promise<ModeMemeAutoIngestSetting> {
    validateId(namespaceId, 'mode namespace')
    validateRevision(expectedRevision, 'mode meme setting revision', 0)
    validateTimestamp(updatedAt, 'mode meme setting timestamp')
    const database = this.transactions.connection(transaction)
    if (expectedRevision === 0) {
      const result = database
        .query(
          `INSERT INTO mode_meme_settings (
             mode_namespace, auto_ingest_enabled, revision,
             created_at_ms, updated_at_ms
           ) VALUES (?, ?, 1, ?, ?)
           ON CONFLICT(mode_namespace) DO NOTHING`
        )
        .run(namespaceId, enabled ? 1 : 0, updatedAt, updatedAt)
      requireChanged(result.changes, 'mode meme setting revision is stale')
    } else {
      const result = database
        .query(
          `UPDATE mode_meme_settings
           SET auto_ingest_enabled = ?, revision = ?, updated_at_ms = ?
           WHERE mode_namespace = ? AND revision = ?`
        )
        .run(
          enabled ? 1 : 0,
          expectedRevision + 1,
          updatedAt,
          namespaceId,
          expectedRevision
        )
      requireChanged(result.changes, 'mode meme setting revision is stale')
    }
    const row = database
      .query('SELECT * FROM mode_meme_settings WHERE mode_namespace = ?')
      .get(namespaceId) as MemeSettingRow | null
    if (row === null) invariant('mode meme setting is missing')
    return settingRecord(row)
  }

  async get(
    transaction: TransactionContext,
    namespaceId: string,
    memeId: string
  ): Promise<ModeMemeRecord> {
    validateId(namespaceId, 'mode namespace')
    validateId(memeId, 'mode meme ID', Number.POSITIVE_INFINITY)
    const row = this.transactions
      .connection(transaction)
      .query(
        'SELECT * FROM mode_memes WHERE mode_namespace = ? AND meme_id = ?'
      )
      .get(namespaceId, memeId) as MemeRow | null
    if (row === null) notFound('mode meme is missing')
    return memeRecord(row)
  }

  async edit(
    transaction: TransactionContext,
    edit: ModeMemeEdit
  ): Promise<ModeMemeRecord> {
    validateId(edit.namespaceId, 'mode namespace')
    validateId(edit.memeId, 'mode meme ID', Number.POSITIVE_INFINITY)
    validateRevision(edit.expectedRevision, 'mode meme revision', 1)
    validateText(edit.text, MAX_TEXT_CHARS, 'mode meme text')
    validateUnitInterval(edit.intensity, 'mode meme intensity')
    validateTimestamp(edit.updatedAt, 'mode meme edit timestamp')
    const database = this.transactions.connection(transaction)
    const nextRevision = asRevision(edit.expectedRevision + 1)
    const result = database
      .query(
        `UPDATE mode_memes
         SET content = ?, intensity = ?, revision = ?, updated_at_ms = ?
         WHERE meme_id = ? AND mode_namespace = ? AND revision = ?`
      )
      .run(
        edit.text,
        edit.intensity,
        nextRevision,
        edit.updatedAt,
        edit.memeId,
        edit.namespaceId,
        edit.expectedRevision
      )
    requireChanged(result.changes, 'mode meme revision is stale')
    insertEvent(database, {
      eventId: eventId(edit.memeId, 'edited', nextRevision),
      memeId: edit.memeId,
      action: 'edited',
      payload: { text: edit.text, intensity: edit.intensity },
      previousRevision: edit.expectedRevision,
      newRevision: nextRevision,
      createdAt: edit.updatedAt
    })
    return requireMeme(database, edit.namespaceId, edit.memeId)
  }

  async changeState(
    transaction: TransactionContext,
    change: ModeMemeStateChange
  ): Promise<ModeMemeRecord> {
    validateId(change.namespaceId, 'mode namespace')
    validateId(change.memeId, 'mode meme ID', Number.POSITIVE_INFINITY)
    validateRevision(change.expectedRevision, 'mode meme revision', 1)
    validateTimestamp(change.updatedAt, 'mode meme state timestamp')
    validateStateAction(change.state, change.action)
    const database = this.transactions.connection(transaction)
    const nextRevision = asRevision(change.expectedRevision + 1)
    const result = database
      .query(
        `UPDATE mode_memes
         SET state = ?, revision = ?, updated_at_ms = ?
         WHERE meme_id = ? AND mode_namespace = ? AND revision = ?`
      )
      .run(
        change.state,
        nextRevision,
        change.updatedAt,
        change.memeId,
        change.namespaceId,
        change.expectedRevision
      )
    requireChanged(result.changes, 'mode meme revision is stale')
    insertEvent(database, {
      eventId: eventId(change.memeId, change.action, nextRevision),
      memeId: change.memeId,
      action: change.action,
      payload: { state: change.state },
      previousRevision: change.expectedRevision,
      newRevision: nextRevision,
      createdAt: change.updatedAt
    })
    return requireMeme(database, change.namespaceId, change.memeId)
  }

  async setPinned(
    transaction: TransactionContext,
    update: ModeMemePinUpdate
  ): Promise<ModeMemeRecord> {
    validateId(update.namespaceId, 'mode namespace')
    validateId(update.memeId, 'mode meme ID', Number.POSITIVE_INFINITY)
    validateRevision(update.expectedRevision, 'mode meme revision', 1)
    validateTimestamp(update.updatedAt, 'mode meme pin timestamp')
    const database = this.transactions.connection(transaction)
    const row = requireMemeRow(
      database,
      update.namespaceId,
      update.memeId,
      update.expectedRevision
    )
    const source = { ...parseSource(row.source_json), pinned: update.pinned }
    updateSource(database, row, source, update.updatedAt, {
      pinned: update.pinned
    })
    return requireMeme(database, update.namespaceId, update.memeId)
  }

  async recordUse(
    transaction: TransactionContext,
    use: ModeMemeUse
  ): Promise<ModeMemeRecord> {
    validateId(use.namespaceId, 'mode namespace')
    validateId(use.memeId, 'mode meme ID', Number.POSITIVE_INFINITY)
    validateRevision(use.expectedRevision, 'mode meme revision', 1)
    validateTimestamp(use.usedAt, 'mode meme use timestamp')
    const database = this.transactions.connection(transaction)
    const row = requireMemeRow(
      database,
      use.namespaceId,
      use.memeId,
      use.expectedRevision
    )
    const current = parseSource(row.source_json)
    const source = {
      ...current,
      useCount: current.useCount + 1,
      lastUsedAt: use.usedAt
    }
    updateSource(database, row, source, use.usedAt, {
      use_count: source.useCount
    })
    return requireMeme(database, use.namespaceId, use.memeId)
  }

  async listArchiveCandidates(
    transaction: TransactionContext,
    namespaceId: string,
    inactiveBefore: WallClockTimestampMs
  ): Promise<readonly ModeMemeRecord[]> {
    validateId(namespaceId, 'mode namespace')
    validateTimestamp(inactiveBefore, 'mode meme archive cutoff')
    const rows = this.transactions
      .connection(transaction)
      .query(
        `SELECT * FROM mode_memes
         WHERE mode_namespace = ? AND state = 'active' AND updated_at_ms <= ?
         ORDER BY updated_at_ms, meme_id`
      )
      .all(namespaceId, inactiveBefore) as MemeRow[]
    return Object.freeze(rows.map(memeRecord))
  }

  async listEvents(
    transaction: TransactionContext,
    namespaceId: string,
    memeId: string
  ): Promise<readonly ModeMemeEvent[]> {
    validateId(namespaceId, 'mode namespace')
    validateId(memeId, 'mode meme ID', Number.POSITIVE_INFINITY)
    const database = this.transactions.connection(transaction)
    requireMeme(database, namespaceId, memeId)
    const rows = database
      .query(
        `SELECT * FROM mode_meme_events
         WHERE meme_id = ?
         ORDER BY new_revision, event_id`
      )
      .all(memeId) as MemeEventRow[]
    return Object.freeze(rows.map(eventRecord))
  }
}

function insertCandidate(
  database: Database,
  candidate: ModeMemeCandidate,
  outcome: MemeCandidateOutcome,
  resultMemeId: string | null
): void {
  database
    .query(
      `INSERT INTO mode_meme_candidates (
         candidate_id, room_id, session_id, audience_epoch, observation_id,
         mode_namespace, idempotency_key, text, evidence_event_ids_json,
         evidence_frame_indexes_json, outcome, result_meme_id,
         created_at_ms, updated_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      candidate.candidateId,
      candidate.roomId,
      candidate.sessionId,
      candidate.audienceEpoch,
      candidate.observationId,
      candidate.namespaceId,
      idempotencyKey(candidate),
      candidate.text,
      canonicalJson(candidate.evidenceEventIds),
      canonicalJson(candidate.evidenceFrameIndexes),
      outcome,
      resultMemeId,
      candidate.createdAt,
      candidate.createdAt
    )
}

function updateSource(
  database: Database,
  row: MemeRow,
  source: ModeMemeSource,
  updatedAt: WallClockTimestampMs,
  payload: Readonly<Record<string, SafeJsonValue>>
): void {
  const nextRevision = asRevision(row.revision + 1)
  const result = database
    .query(
      `UPDATE mode_memes
       SET source_json = ?, revision = ?, updated_at_ms = ?
       WHERE meme_id = ? AND mode_namespace = ? AND revision = ?`
    )
    .run(
      serializeSource(source),
      nextRevision,
      updatedAt,
      row.meme_id,
      row.mode_namespace,
      row.revision
    )
  requireChanged(result.changes, 'mode meme revision is stale')
  insertEvent(database, {
    eventId: eventId(row.meme_id, 'edited', nextRevision),
    memeId: row.meme_id,
    action: 'edited',
    payload,
    previousRevision: asRevision(row.revision),
    newRevision: nextRevision,
    createdAt: updatedAt
  })
}

function insertEvent(database: Database, event: ModeMemeEvent): void {
  database
    .query(
      `INSERT INTO mode_meme_events (
         event_id, meme_id, action, payload_json, previous_revision,
         new_revision, created_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      event.eventId,
      event.memeId,
      event.action,
      canonicalJson(event.payload),
      event.previousRevision,
      event.newRevision,
      event.createdAt
    )
}

function requireMeme(
  database: Database,
  namespaceId: string,
  id: string
): ModeMemeRecord {
  const row = database
    .query('SELECT * FROM mode_memes WHERE mode_namespace = ? AND meme_id = ?')
    .get(namespaceId, id) as MemeRow | null
  if (row === null) notFound('mode meme is missing')
  return memeRecord(row)
}

function requireMemeRow(
  database: Database,
  namespaceId: string,
  id: string,
  expectedRevision: Revision
): MemeRow {
  const row = database
    .query(
      `SELECT * FROM mode_memes
       WHERE mode_namespace = ? AND meme_id = ? AND revision = ?`
    )
    .get(namespaceId, id, expectedRevision) as MemeRow | null
  if (row === null) conflict('mode meme revision is stale')
  return row
}

function candidateRow(database: Database, candidateId: string): MemeCandidateRow | null {
  return database
    .query('SELECT * FROM mode_meme_candidates WHERE candidate_id = ?')
    .get(candidateId) as MemeCandidateRow | null
}

function validateIdempotency(
  database: Database,
  candidate: ModeMemeCandidate
): void {
  const row = database
    .query(
      `SELECT candidate_id FROM mode_meme_candidates
       WHERE mode_namespace = ? AND idempotency_key = ?`
    )
    .get(candidate.namespaceId, idempotencyKey(candidate)) as
    | { candidate_id: string }
    | null
  if (row !== null && row.candidate_id !== candidate.candidateId) {
    conflict('meme idempotency key was used by another candidate')
  }
}

function requireSameCandidate(
  row: MemeCandidateRow,
  candidate: ModeMemeCandidate
): void {
  if (
    row.room_id !== candidate.roomId ||
    row.session_id !== candidate.sessionId ||
    row.audience_epoch !== candidate.audienceEpoch ||
    row.observation_id !== candidate.observationId ||
    row.mode_namespace !== candidate.namespaceId ||
    row.idempotency_key !== idempotencyKey(candidate) ||
    row.text !== candidate.text ||
    row.evidence_event_ids_json !== canonicalJson(candidate.evidenceEventIds) ||
    row.evidence_frame_indexes_json !== canonicalJson(candidate.evidenceFrameIndexes)
  ) {
    conflict('meme candidate ID was used with different content')
  }
}

function memeRecord(row: MemeRow): ModeMemeRecord {
  if (!MEME_STATES.has(row.state as ModeMemeState)) {
    invariant('persisted mode meme state is invalid')
  }
  validatePersistedUnitInterval(row.intensity, 'persisted mode meme intensity')
  const createdAt = persistedTimestamp(row.created_at_ms, 'mode meme created timestamp')
  const updatedAt = persistedTimestamp(row.updated_at_ms, 'mode meme updated timestamp')
  if (updatedAt < createdAt) invariant('persisted mode meme timestamps are invalid')
  return Object.freeze({
    memeId: row.meme_id,
    namespaceId: row.mode_namespace,
    text: row.content,
    intensity: row.intensity,
    state: row.state as ModeMemeState,
    source: parseSource(row.source_json),
    revision: persistedRevision(row.revision, 'mode meme revision', 1),
    createdAt,
    updatedAt
  })
}

function candidateRecord(row: MemeCandidateRow): ModeMemeCandidate {
  if (!CANDIDATE_OUTCOMES.has(row.outcome as MemeCandidateOutcome)) {
    invariant('persisted meme candidate outcome is invalid')
  }
  const evidenceEventIds = parseStringArray(
    row.evidence_event_ids_json,
    'meme candidate evidence event IDs'
  )
  const evidenceFrameIndexes = parseFrameIndexes(
    row.evidence_frame_indexes_json,
    'meme candidate evidence frame indexes'
  )
  return Object.freeze({
    candidateId: row.candidate_id,
    roomId: row.room_id as RoomId,
    sessionId: row.session_id as SessionId,
    audienceEpoch: persistedEpoch(row.audience_epoch),
    observationId: row.observation_id,
    namespaceId: row.mode_namespace,
    text: row.text,
    idempotencyKey:
      row.idempotency_key === row.candidate_id ? null : row.idempotency_key,
    evidenceEventIds,
    evidenceFrameIndexes,
    outcome: row.outcome as MemeCandidateOutcome,
    createdAt: persistedTimestamp(
      row.created_at_ms,
      'meme candidate created timestamp'
    )
  })
}

function settingRecord(row: MemeSettingRow): ModeMemeAutoIngestSetting {
  if (row.auto_ingest_enabled !== 0 && row.auto_ingest_enabled !== 1) {
    invariant('persisted mode meme auto-ingest setting is invalid')
  }
  return Object.freeze({
    namespaceId: row.mode_namespace,
    enabled: row.auto_ingest_enabled === 1,
    revision: persistedRevision(row.revision, 'mode meme setting revision', 1)
  })
}

function eventRecord(row: MemeEventRow): ModeMemeEvent {
  if (!MEME_ACTIONS.has(row.action as ModeMemeAction)) {
    invariant('persisted mode meme action is invalid')
  }
  const previousRevision = persistedRevision(
    row.previous_revision,
    'mode meme previous revision',
    0
  )
  const newRevision = persistedRevision(
    row.new_revision,
    'mode meme new revision',
    1
  )
  if (newRevision !== previousRevision + 1) {
    invariant('persisted mode meme event revisions are invalid')
  }
  return Object.freeze({
    eventId: row.event_id,
    memeId: row.meme_id,
    action: row.action as ModeMemeAction,
    payload: parseJsonObject(row.payload_json, 'mode meme event payload'),
    previousRevision,
    newRevision,
    createdAt: persistedTimestamp(row.created_at_ms, 'mode meme event timestamp')
  })
}

function sourceFromCandidate(candidate: ModeMemeCandidate): ModeMemeSource {
  return Object.freeze({
    roomId: candidate.roomId,
    sessionId: candidate.sessionId,
    audienceEpoch: candidate.audienceEpoch,
    observationId: candidate.observationId,
    sourceCandidateId: candidate.candidateId,
    evidenceEventIds: Object.freeze([...candidate.evidenceEventIds]),
    evidenceFrameIndexes: Object.freeze([...candidate.evidenceFrameIndexes]),
    pinned: false,
    useCount: 0,
    lastUsedAt: null
  })
}

function serializeSource(source: ModeMemeSource): string {
  return canonicalJson({
    room_id: source.roomId,
    session_id: source.sessionId,
    audience_epoch: source.audienceEpoch,
    observation_id: source.observationId,
    source_candidate_id: source.sourceCandidateId,
    evidence_event_ids: source.evidenceEventIds,
    evidence_frame_indexes: source.evidenceFrameIndexes,
    pinned: source.pinned,
    use_count: source.useCount,
    last_used_at_ms: source.lastUsedAt
  })
}

function parseSource(value: string): ModeMemeSource {
  const source = parseJsonObject(value, 'mode meme source')
  const roomId = source.roomId ?? source.room_id
  const sessionId = source.sessionId ?? source.session_id
  const audienceEpoch = source.audienceEpoch ?? source.audience_epoch
  const observationId = source.observationId ?? source.observation_id
  const sourceCandidateId = source.sourceCandidateId ?? source.source_candidate_id
  const evidenceEventIds = source.evidenceEventIds ?? source.evidence_event_ids
  const evidenceFrameIndexes =
    source.evidenceFrameIndexes ?? source.evidence_frame_indexes
  const useCount = source.useCount ?? source.use_count
  const lastUsedAt = source.lastUsedAt ?? source.last_used_at_ms
  if (
    typeof roomId !== 'string' ||
    typeof sessionId !== 'string' ||
    !isPositiveInteger(audienceEpoch) ||
    typeof observationId !== 'string' ||
    typeof sourceCandidateId !== 'string' ||
    !isStringArray(evidenceEventIds) ||
    !isFrameIndexArray(evidenceFrameIndexes) ||
    typeof source.pinned !== 'boolean' ||
    !isNonNegativeInteger(useCount) ||
    (lastUsedAt !== null && !isNonNegativeInteger(lastUsedAt))
  ) {
    invariant('persisted mode meme source is invalid')
  }
  return Object.freeze({
    roomId: roomId as RoomId,
    sessionId: sessionId as SessionId,
    audienceEpoch: audienceEpoch as Epoch,
    observationId,
    sourceCandidateId,
    evidenceEventIds: Object.freeze([...evidenceEventIds]),
    evidenceFrameIndexes: Object.freeze([...evidenceFrameIndexes]),
    pinned: source.pinned,
    useCount,
    lastUsedAt: lastUsedAt === null ? null : wallClockTimestampMs(lastUsedAt)
  })
}

function validateCandidate(candidate: ModeMemeCandidate): void {
  validateId(candidate.candidateId, 'meme candidate ID')
  validateId(candidate.roomId, 'Room ID')
  validateId(candidate.sessionId, 'Session ID')
  validateRevision(candidate.audienceEpoch, 'meme candidate audience epoch', 1)
  validateId(candidate.observationId, 'observation ID')
  validateId(candidate.namespaceId, 'mode namespace')
  validateText(candidate.text, MAX_TEXT_CHARS, 'meme candidate text')
  if (candidate.idempotencyKey !== null) {
    validateId(candidate.idempotencyKey, 'meme candidate idempotency key')
  }
  validateStringArray(
    candidate.evidenceEventIds,
    1,
    MAX_EVIDENCE_EVENTS,
    'meme candidate evidence event IDs'
  )
  if (!isFrameIndexArray(candidate.evidenceFrameIndexes)) {
    invalid('meme candidate evidence frame indexes are invalid')
  }
  if (!CANDIDATE_OUTCOMES.has(candidate.outcome)) {
    invalid('meme candidate outcome is invalid')
  }
  validateTimestamp(candidate.createdAt, 'meme candidate timestamp')
}

function validateStateAction(
  state: ModeMemeState,
  action: Exclude<ModeMemeAction, 'created' | 'edited'>
): void {
  const expected: Readonly<
    Record<Exclude<ModeMemeAction, 'created' | 'edited'>, ModeMemeState>
  > = {
    revoked: 'revoked',
    restored: 'active',
    disabled: 'disabled',
    archived: 'archived'
  }
  if (!MEME_STATES.has(state) || expected[action] !== state) {
    invalid('mode meme state action is invalid')
  }
}

function idempotencyKey(candidate: ModeMemeCandidate): string {
  return candidate.idempotencyKey ?? candidate.candidateId
}

function memeId(candidateId: string): string {
  return `meme:${candidateId}`
}

function eventId(id: string, action: ModeMemeAction, revision: Revision): string {
  return `meme-event:${action}:${revision}:${id}`
}

function parseStringArray(value: string, label: string): readonly string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new SqlitePersistenceError(
      'invariant_violation',
      `persisted ${label} are invalid`,
      { cause: error }
    )
  }
  if (!isStringArray(parsed)) invariant(`persisted ${label} are invalid`)
  return Object.freeze([...parsed])
}

function parseFrameIndexes(value: string, label: string): readonly number[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    throw new SqlitePersistenceError(
      'invariant_violation',
      `persisted ${label} are invalid`,
      { cause: error }
    )
  }
  if (!isFrameIndexArray(parsed)) invariant(`persisted ${label} are invalid`)
  return Object.freeze([...parsed])
}

function parseJsonObject(
  value: string,
  label: string
): Readonly<Record<string, SafeJsonValue>> {
  try {
    const parsed: unknown = JSON.parse(value)
    if (isRecord(parsed) && canonicalJson(parsed) === value) {
      return parsed as Readonly<Record<string, SafeJsonValue>>
    }
  } catch (error) {
    throw new SqlitePersistenceError(
      'invariant_violation',
      `persisted ${label} is invalid`,
      { cause: error }
    )
  }
  invariant(`persisted ${label} is invalid`)
}

function validateStringArray(
  values: readonly string[],
  minimum: number,
  maximum: number,
  label: string
): void {
  if (values.length < minimum || values.length > maximum) invalid(`${label} are invalid`)
  for (const value of values) validateId(value, label)
}

function validateId(value: string, label: string, maximum = MAX_ID_CHARS): void {
  validateText(value, maximum, label)
}

function validateText(value: string, maximum: number, label: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    invalid(`${label} is invalid`)
  }
}

function validateRevision(value: number, label: string, minimum: number): void {
  if (!Number.isSafeInteger(value) || value < minimum) invalid(`${label} is invalid`)
}

function validateTimestamp(value: number, label: string): void {
  if (!isNonNegativeInteger(value)) invalid(`${label} is invalid`)
}

function validateUnitInterval(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) invalid(`${label} is invalid`)
}

function validatePersistedUnitInterval(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) invariant(`${label} is invalid`)
}

function persistedTimestamp(value: number, label: string): WallClockTimestampMs {
  if (!isNonNegativeInteger(value)) invariant(`persisted ${label} is invalid`)
  return wallClockTimestampMs(value)
}

function persistedRevision(
  value: number,
  label: string,
  minimum: number
): Revision {
  if (!Number.isSafeInteger(value) || value < minimum) {
    invariant(`persisted ${label} is invalid`)
  }
  return value as Revision
}

function persistedEpoch(value: number): Epoch {
  if (!isPositiveInteger(value)) invariant('persisted meme audience epoch is invalid')
  return value as Epoch
}

function asRevision(value: number): Revision {
  if (!Number.isSafeInteger(value) || value < 1) invariant('mode meme revision is invalid')
  return value as Revision
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length >= 1 &&
    value.length <= MAX_EVIDENCE_EVENTS &&
    value.every(
      (item) => typeof item === 'string' && item.length >= 1 && item.length <= MAX_ID_CHARS
    )
  )
}

function isFrameIndexArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_FRAME_BUNDLE_SIZE &&
    value.every(
      (item) => Number.isSafeInteger(item) && Number(item) >= 0 && Number(item) <= 15
    )
  )
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 1
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
