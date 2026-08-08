import {
  canonicalJson,
  type Revision,
  type RoomEventSource,
  type RoomId
} from '@advx/contracts'
import type { Database } from 'bun:sqlite'

import type {
  RoomMemoryCandidate,
  RoomMemoryCommitResult,
  RoomMemoryEdit,
  RoomMemoryEvidence,
  RoomMemoryMerge,
  RoomMemoryRecord,
  RoomMemoryReplacement,
  RoomMemoryRepository,
  RoomMemorySlice,
  RoomMemorySliceQuery,
  RoomMemoryState,
  RoomMemoryType,
  TransactionContext
} from '../../../application/ports/repositories'
import {
  wallClockTimestampMs,
  type WallClockTimestampMs
} from '../../../application/ports/time'
import { SqlitePersistenceError } from './errors'
import { SqliteTransactionBoundary } from './transaction'

type MemoryRow = Readonly<{
  memory_id: string
  room_id: string
  memory_type: string
  content: string
  tags_json: string
  importance: number
  confidence: number
  origin: string
  state: string
  superseded_by: string | null
  last_recalled_at_ms: number | null
  expires_at_ms: number | null
  revision: number
  created_at_ms: number
  updated_at_ms: number
}>

type EvidenceRow = Readonly<{
  memory_id: string
  event_id: string
  source_type: string
  occurred_at_ms: number
  evidence_summary: string
}>

type EventRow = Readonly<{
  event_id: string
  room_id: string
  source_type: string
  occurred_at_ms: number
  content_json: string
}>

type CandidateRow = Readonly<{
  candidate_id: string
  decision_json: string
}>

type CandidatePayload = Readonly<{
  candidate_id: string
  room_id: string
  idempotency_key: string
  base_revision: number
  candidate_type: RoomMemoryType
  content: string
  tags: readonly string[]
  memory_id: string
  memory_origin: string
  importance: number
  confidence: number
  evidence_event_ids: readonly string[]
}>

const MEMORY_TYPES = new Set<RoomMemoryType>([
  'user_preference',
  'real_world_fact',
  'room_lore',
  'shared_experience'
])
const MEMORY_STATES = new Set<RoomMemoryState>(['active', 'superseded', 'revoked'])
const EVENT_SOURCES = new Set<RoomEventSource>([
  'user_text',
  'user_voice',
  'audience_barrage',
  'screen_observation',
  'system_event'
])
const NON_AI_EVIDENCE = new Set<RoomEventSource>([
  'user_text',
  'user_voice',
  'screen_observation',
  'system_event'
])

const MAX_ID_CHARS = 128
const MAX_CONTENT_CHARS = 4_000
const MAX_TAGS = 128
const MAX_TAG_CHARS = 128
const MAX_EVIDENCE = 128
const MAX_EVIDENCE_SUMMARY_CHARS = 1_000
const MAX_LIST_ITEMS = 128

export class SqliteRoomMemoryRepository implements RoomMemoryRepository {
  constructor(private readonly transactions: SqliteTransactionBoundary) {}

  async headRevision(
    transaction: TransactionContext,
    roomId: RoomId
  ): Promise<Revision> {
    validateId(roomId, 'Room ID')
    return headRevision(this.transactions.connection(transaction), roomId)
  }

  async readSlice(
    transaction: TransactionContext,
    query: RoomMemorySliceQuery
  ): Promise<RoomMemorySlice> {
    validateId(query.roomId, 'Room ID')
    validateTimestamp(query.observedAt, 'observed timestamp')
    validateLimit(query.limit)
    validateIds(query.evidenceEventIds, 'evidence event IDs', true)
    const database = this.transactions.connection(transaction)
    const revision = headRevision(database, query.roomId)
    const bindings: (string | number)[] = [query.roomId, query.observedAt]
    let evidenceClause = ''
    if (query.evidenceEventIds.length > 0) {
      evidenceClause = `AND EXISTS (
        SELECT 1 FROM room_memory_evidence AS evidence
        WHERE evidence.memory_id = memories.memory_id
          AND evidence.event_id IN (${placeholders(query.evidenceEventIds.length)})
      )`
      bindings.push(...query.evidenceEventIds)
    }
    bindings.push(query.limit)
    const rows = database
      .query(
        `SELECT memories.* FROM room_long_term_memories AS memories
         WHERE memories.room_id = ?
           AND memories.state = 'active'
           AND (memories.expires_at_ms IS NULL OR memories.expires_at_ms > ?)
           ${evidenceClause}
         ORDER BY memories.importance DESC, memories.updated_at_ms DESC,
           memories.memory_id
         LIMIT ?`
      )
      .all(...bindings) as MemoryRow[]
    const items = memoryRecords(database, rows)
    return Object.freeze({
      roomId: query.roomId,
      memoryRevision: revision,
      memoryIds: Object.freeze(items.map((item) => item.memoryId)),
      items
    })
  }

  async commitCandidate(
    transaction: TransactionContext,
    candidate: RoomMemoryCandidate,
    createdAt: WallClockTimestampMs
  ): Promise<RoomMemoryCommitResult> {
    validateCandidate(candidate)
    validateTimestamp(createdAt, 'candidate timestamp')
    const database = this.transactions.connection(transaction)
    const payload = candidatePayload(candidate)
    const existing = database
      .query(
        `SELECT candidate_id, decision_json FROM room_memory_candidates
         WHERE room_id = ? AND idempotency_key = ?`
      )
      .get(candidate.roomId, candidate.idempotencyKey) as CandidateRow | null
    if (existing !== null) return replayCandidate(existing, payload)

    const duplicateId = database
      .query('SELECT 1 AS present FROM room_memory_candidates WHERE candidate_id = ?')
      .get(candidate.candidateId)
    if (duplicateId !== null) conflict('memory candidate ID already exists')
    if (headRevision(database, candidate.roomId) !== candidate.baseRevision) {
      conflict('Room memory head is stale')
    }
    const evidence = validatedEvents(database, candidate.roomId, candidate.evidenceEventIds)
    if (
      candidate.memoryType !== 'room_lore' &&
      !evidence.some((item) => NON_AI_EVIDENCE.has(item.source_type as RoomEventSource))
    ) {
      invalid('facts and preferences require non-AI evidence')
    }
    if (
      database
        .query('SELECT 1 AS present FROM room_long_term_memories WHERE memory_id = ?')
        .get(candidate.memoryId) !== null
    ) {
      conflict('memory ID already exists')
    }

    database
      .query(
        `INSERT INTO room_long_term_memories (
           memory_id, room_id, memory_type, content, tags_json, importance,
           confidence, origin, state, superseded_by, last_recalled_at_ms,
           expires_at_ms, revision, created_at_ms, updated_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', NULL, NULL, NULL, 1, ?, ?)`
      )
      .run(
        candidate.memoryId,
        candidate.roomId,
        candidate.memoryType,
        candidate.content,
        canonicalJson(candidate.tags),
        candidate.importance,
        candidate.confidence,
        candidate.origin,
        createdAt,
        createdAt
      )
    insertEvidence(database, candidate.memoryId, evidence)
    const nextRevision = asRevision(candidate.baseRevision + 1)
    const decision = {
      decision: 'created',
      candidate: payload,
      result_memory_id: candidate.memoryId,
      memory_revision: 1,
      head_revision: nextRevision
    } as const
    database
      .query(
        `INSERT INTO room_memory_candidates (
           candidate_id, room_id, idempotency_key, base_revision, candidate_type,
           content, tags_json, evidence_event_ids_json, outcome, result_memory_id,
           decision_json, created_at_ms, updated_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?, ?, ?)`
      )
      .run(
        candidate.candidateId,
        candidate.roomId,
        candidate.idempotencyKey,
        candidate.baseRevision,
        candidate.memoryType,
        candidate.content,
        canonicalJson(candidate.tags),
        canonicalJson(candidate.evidenceEventIds),
        candidate.memoryId,
        canonicalJson(decision),
        createdAt,
        createdAt
      )
    advanceHead(database, candidate.roomId, candidate.baseRevision, createdAt)
    return Object.freeze({
      accepted: true,
      memoryId: candidate.memoryId,
      memoryRevision: asRevision(1),
      headRevision: nextRevision,
      created: true
    })
  }

  async listActive(
    transaction: TransactionContext,
    roomId: RoomId,
    observedAt: WallClockTimestampMs,
    limit: number
  ): Promise<readonly RoomMemoryRecord[]> {
    validateId(roomId, 'Room ID')
    validateTimestamp(observedAt, 'observed timestamp')
    validateLimit(limit)
    const database = this.transactions.connection(transaction)
    headRevision(database, roomId)
    const rows = database
      .query(
        `SELECT * FROM room_long_term_memories
         WHERE room_id = ? AND state = 'active'
           AND (expires_at_ms IS NULL OR expires_at_ms > ?)
         ORDER BY updated_at_ms DESC, memory_id LIMIT ?`
      )
      .all(roomId, observedAt, limit) as MemoryRow[]
    return memoryRecords(database, rows)
  }

  async get(
    transaction: TransactionContext,
    roomId: RoomId,
    memoryId: string
  ): Promise<RoomMemoryRecord> {
    validateId(roomId, 'Room ID')
    validateId(memoryId, 'memory ID')
    return memoryRecord(this.transactions.connection(transaction), roomId, memoryId)
  }

  async edit(
    transaction: TransactionContext,
    edit: RoomMemoryEdit
  ): Promise<RoomMemoryRecord> {
    validateId(edit.roomId, 'Room ID')
    validateId(edit.memoryId, 'memory ID')
    validateRevision(edit.expectedRevision, 'memory revision', 1)
    validateContent(edit.content)
    validateUnitInterval(edit.confidence, 'memory confidence')
    validateTimestamp(edit.updatedAt, 'memory timestamp')
    validateIds(edit.evidenceEventIds, 'evidence event IDs', false)
    const database = this.transactions.connection(transaction)
    const evidence = validatedEvents(database, edit.roomId, edit.evidenceEventIds)
    const head = headRevision(database, edit.roomId)
    const result = database
      .query(
        `UPDATE room_long_term_memories
         SET content = ?, confidence = ?, revision = ?, updated_at_ms = ?
         WHERE room_id = ? AND memory_id = ? AND revision = ?`
      )
      .run(
        edit.content,
        edit.confidence,
        edit.expectedRevision + 1,
        edit.updatedAt,
        edit.roomId,
        edit.memoryId,
        edit.expectedRevision
      )
    requireChanged(result.changes, 'Room memory revision is stale')
    database.run('DELETE FROM room_memory_evidence WHERE memory_id = ?', [edit.memoryId])
    insertEvidence(database, edit.memoryId, evidence)
    advanceHead(database, edit.roomId, head, edit.updatedAt)
    return memoryRecord(database, edit.roomId, edit.memoryId)
  }

  async merge(
    transaction: TransactionContext,
    merge: RoomMemoryMerge
  ): Promise<RoomMemoryRecord> {
    validateId(merge.roomId, 'Room ID')
    validateId(merge.memoryId, 'memory ID')
    validateId(merge.sourceMemoryId, 'source memory ID')
    if (merge.memoryId === merge.sourceMemoryId) invalid('memory cannot be merged into itself')
    validateRevision(merge.expectedRevision, 'memory revision', 1)
    validateRevision(merge.sourceExpectedRevision, 'source memory revision', 1)
    validateContent(merge.content)
    validateTimestamp(merge.updatedAt, 'memory timestamp')
    const database = this.transactions.connection(transaction)
    const head = headRevision(database, merge.roomId)
    const target = database
      .query(
        `UPDATE room_long_term_memories SET content = ?, revision = ?, updated_at_ms = ?
         WHERE room_id = ? AND memory_id = ? AND revision = ? AND state = 'active'`
      )
      .run(
        merge.content,
        merge.expectedRevision + 1,
        merge.updatedAt,
        merge.roomId,
        merge.memoryId,
        merge.expectedRevision
      )
    const source = database
      .query(
        `UPDATE room_long_term_memories
         SET state = 'superseded', superseded_by = ?, revision = ?, updated_at_ms = ?
         WHERE room_id = ? AND memory_id = ? AND revision = ? AND state = 'active'`
      )
      .run(
        merge.memoryId,
        merge.sourceExpectedRevision + 1,
        merge.updatedAt,
        merge.roomId,
        merge.sourceMemoryId,
        merge.sourceExpectedRevision
      )
    if (target.changes !== 1 || source.changes !== 1) {
      conflict('Room memory revision is stale')
    }
    database
      .query(
        `INSERT OR IGNORE INTO room_memory_evidence (
           memory_id, event_id, source_type, occurred_at_ms, evidence_summary
         ) SELECT ?, event_id, source_type, occurred_at_ms, evidence_summary
           FROM room_memory_evidence WHERE memory_id = ?`
      )
      .run(merge.memoryId, merge.sourceMemoryId)
    advanceHead(database, merge.roomId, head, merge.updatedAt)
    return memoryRecord(database, merge.roomId, merge.memoryId)
  }

  async replace(
    transaction: TransactionContext,
    replacement: RoomMemoryReplacement
  ): Promise<RoomMemoryRecord> {
    validateId(replacement.roomId, 'Room ID')
    validateId(replacement.memoryId, 'memory ID')
    validateId(replacement.replacementMemoryId, 'replacement memory ID')
    if (replacement.memoryId === replacement.replacementMemoryId) {
      invalid('replacement memory ID must be new')
    }
    validateRevision(replacement.expectedRevision, 'memory revision', 1)
    validateContent(replacement.content)
    validateTimestamp(replacement.updatedAt, 'memory timestamp')
    validateIds(replacement.evidenceEventIds, 'evidence event IDs', false)
    const database = this.transactions.connection(transaction)
    const current = requireMemoryRow(database, replacement.roomId, replacement.memoryId)
    if (current.revision !== replacement.expectedRevision || current.state !== 'active') {
      conflict('Room memory revision is stale')
    }
    if (
      database
        .query('SELECT 1 AS present FROM room_long_term_memories WHERE memory_id = ?')
        .get(replacement.replacementMemoryId) !== null
    ) {
      conflict('replacement memory ID already exists')
    }
    const evidence = validatedEvents(
      database,
      replacement.roomId,
      replacement.evidenceEventIds
    )
    const head = headRevision(database, replacement.roomId)
    database
      .query(
        `INSERT INTO room_long_term_memories (
           memory_id, room_id, memory_type, content, tags_json, importance,
           confidence, origin, state, superseded_by, last_recalled_at_ms,
           expires_at_ms, revision, created_at_ms, updated_at_ms
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'manual_replace', 'active', NULL, NULL, ?, 1, ?, ?)`
      )
      .run(
        replacement.replacementMemoryId,
        replacement.roomId,
        current.memory_type,
        replacement.content,
        current.tags_json,
        current.importance,
        current.confidence,
        current.expires_at_ms,
        replacement.updatedAt,
        replacement.updatedAt
      )
    insertEvidence(database, replacement.replacementMemoryId, evidence)
    const result = database
      .query(
        `UPDATE room_long_term_memories
         SET state = 'superseded', superseded_by = ?, revision = ?, updated_at_ms = ?
         WHERE room_id = ? AND memory_id = ? AND revision = ? AND state = 'active'`
      )
      .run(
        replacement.replacementMemoryId,
        replacement.expectedRevision + 1,
        replacement.updatedAt,
        replacement.roomId,
        replacement.memoryId,
        replacement.expectedRevision
      )
    requireChanged(result.changes, 'Room memory revision is stale')
    advanceHead(database, replacement.roomId, head, replacement.updatedAt)
    return memoryRecord(database, replacement.roomId, replacement.replacementMemoryId)
  }

  async revoke(
    transaction: TransactionContext,
    roomId: RoomId,
    memoryId: string,
    expectedRevision: Revision,
    updatedAt: WallClockTimestampMs
  ): Promise<RoomMemoryRecord> {
    validateId(roomId, 'Room ID')
    validateId(memoryId, 'memory ID')
    validateRevision(expectedRevision, 'memory revision', 1)
    validateTimestamp(updatedAt, 'memory timestamp')
    const database = this.transactions.connection(transaction)
    const head = headRevision(database, roomId)
    const result = database
      .query(
        `UPDATE room_long_term_memories
         SET state = 'revoked', revision = ?, updated_at_ms = ?
         WHERE room_id = ? AND memory_id = ? AND revision = ? AND state = 'active'`
      )
      .run(expectedRevision + 1, updatedAt, roomId, memoryId, expectedRevision)
    requireChanged(result.changes, 'Room memory revision is stale')
    advanceHead(database, roomId, head, updatedAt)
    return memoryRecord(database, roomId, memoryId)
  }

  async delete(
    transaction: TransactionContext,
    roomId: RoomId,
    memoryId: string,
    expectedRevision: Revision,
    updatedAt: WallClockTimestampMs
  ): Promise<boolean> {
    validateId(roomId, 'Room ID')
    validateId(memoryId, 'memory ID')
    validateRevision(expectedRevision, 'memory revision', 1)
    validateTimestamp(updatedAt, 'memory timestamp')
    const database = this.transactions.connection(transaction)
    const head = headRevision(database, roomId)
    const result = database
      .query(
        `DELETE FROM room_long_term_memories
         WHERE room_id = ? AND memory_id = ? AND revision = ?`
      )
      .run(roomId, memoryId, expectedRevision)
    if (result.changes === 0) {
      const existing = database
        .query(
          'SELECT revision FROM room_long_term_memories WHERE room_id = ? AND memory_id = ?'
        )
        .get(roomId, memoryId)
      if (existing !== null) conflict('Room memory revision is stale')
      return false
    }
    advanceHead(database, roomId, head, updatedAt)
    return true
  }

  async reset(
    transaction: TransactionContext,
    roomId: RoomId,
    expectedRevision: Revision,
    updatedAt: WallClockTimestampMs
  ): Promise<number> {
    validateId(roomId, 'Room ID')
    validateRevision(expectedRevision, 'memory head revision', 0)
    validateTimestamp(updatedAt, 'memory timestamp')
    const database = this.transactions.connection(transaction)
    if (headRevision(database, roomId) !== expectedRevision) {
      conflict('Room memory head is stale')
    }
    const row = database
      .query('SELECT COUNT(*) AS count FROM room_long_term_memories WHERE room_id = ?')
      .get(roomId) as { count: number }
    if (!isSafeInteger(row.count, 0)) invariant('persisted Room memory count is invalid')
    if (row.count === 0) return 0
    database.run('DELETE FROM room_long_term_memories WHERE room_id = ?', [roomId])
    advanceHead(database, roomId, expectedRevision, updatedAt)
    return row.count
  }
}

function candidatePayload(candidate: RoomMemoryCandidate): CandidatePayload {
  return {
    candidate_id: candidate.candidateId,
    room_id: candidate.roomId,
    idempotency_key: candidate.idempotencyKey,
    base_revision: candidate.baseRevision,
    candidate_type: candidate.memoryType,
    content: candidate.content,
    tags: candidate.tags,
    memory_id: candidate.memoryId,
    memory_origin: candidate.origin,
    importance: candidate.importance,
    confidence: candidate.confidence,
    evidence_event_ids: candidate.evidenceEventIds
  }
}

function replayCandidate(
  row: CandidateRow,
  incoming: CandidatePayload
): RoomMemoryCommitResult {
  const decision = parseObject(row.decision_json, 'stored memory candidate decision')
  const storedValue = decision.candidate
  if (!isRecord(storedValue)) invariant('stored memory candidate payload is invalid')
  const stored = { ...storedValue }
  const candidate = { ...incoming } as Record<string, unknown>
  delete stored.base_revision
  delete candidate.base_revision
  if (canonicalJson(stored) !== canonicalJson(candidate)) {
    conflict('memory idempotency key was used with a different candidate')
  }
  const memoryId = decision.result_memory_id
  const memoryRevision = decision.memory_revision
  const nextHead = decision.head_revision
  if (
    typeof memoryId !== 'string' ||
    !isSafeInteger(memoryRevision, 1) ||
    !isSafeInteger(nextHead, 0)
  ) {
    invariant('stored memory candidate result is invalid')
  }
  return Object.freeze({
    accepted: true,
    memoryId,
    memoryRevision: asRevision(memoryRevision),
    headRevision: asRevision(nextHead),
    created: false
  })
}

function validatedEvents(
  database: Database,
  roomId: RoomId,
  eventIds: readonly string[]
): readonly EventRow[] {
  validateIds(eventIds, 'evidence event IDs', false)
  const rows = database
    .query(
      `SELECT event_id, room_id, source_type, occurred_at_ms, content_json
       FROM room_events WHERE event_id IN (${placeholders(eventIds.length)})`
    )
    .all(...eventIds) as EventRow[]
  const byId = new Map(rows.map((row) => [row.event_id, row]))
  const ordered = eventIds.map((eventId) => byId.get(eventId))
  if (ordered.some((row) => row === undefined || row.room_id !== roomId)) {
    invalid('all memory evidence must exist in the same Room')
  }
  for (const row of ordered) {
    if (row === undefined || !EVENT_SOURCES.has(row.source_type as RoomEventSource)) {
      invariant('persisted evidence event source is invalid')
    }
  }
  return ordered as EventRow[]
}

function insertEvidence(
  database: Database,
  memoryId: string,
  events: readonly EventRow[]
): void {
  for (const event of events) {
    database.run(
      `INSERT INTO room_memory_evidence (
         memory_id, event_id, source_type, occurred_at_ms, evidence_summary
       ) VALUES (?, ?, ?, ?, ?)`,
      [
        memoryId,
        event.event_id,
        event.source_type,
        event.occurred_at_ms,
        event.content_json.slice(0, MAX_EVIDENCE_SUMMARY_CHARS)
      ]
    )
  }
}

function headRevision(database: Database, roomId: RoomId): Revision {
  const row = database
    .query('SELECT revision FROM room_memory_heads WHERE room_id = ?')
    .get(roomId) as { revision: number } | null
  if (row === null) invariant('Room memory head is missing')
  return asRevision(row.revision)
}

function advanceHead(
  database: Database,
  roomId: RoomId,
  expectedRevision: Revision,
  updatedAt: WallClockTimestampMs
): void {
  const result = database
    .query(
      `UPDATE room_memory_heads SET revision = ?, updated_at_ms = ?
       WHERE room_id = ? AND revision = ?`
    )
    .run(expectedRevision + 1, updatedAt, roomId, expectedRevision)
  requireChanged(result.changes, 'Room memory head is stale')
  database
    .query(
      `UPDATE rooms SET revision = ?, updated_at_ms = ?
       WHERE room_id = ? AND revision = ?`
    )
    .run(expectedRevision + 1, updatedAt, roomId, expectedRevision)
}

function memoryRecord(database: Database, roomId: RoomId, memoryId: string): RoomMemoryRecord {
  return memoryFromRow(database, requireMemoryRow(database, roomId, memoryId))
}

function requireMemoryRow(database: Database, roomId: RoomId, memoryId: string): MemoryRow {
  const row = database
    .query('SELECT * FROM room_long_term_memories WHERE room_id = ? AND memory_id = ?')
    .get(roomId, memoryId) as MemoryRow | null
  if (row === null) notFound('Room memory is missing')
  return row
}

function memoryRecords(
  database: Database,
  rows: readonly MemoryRow[]
): readonly RoomMemoryRecord[] {
  return Object.freeze(rows.map((row) => memoryFromRow(database, row)))
}

function memoryFromRow(database: Database, row: MemoryRow): RoomMemoryRecord {
  if (!MEMORY_TYPES.has(row.memory_type as RoomMemoryType)) {
    invariant('persisted memory type is invalid')
  }
  if (!MEMORY_STATES.has(row.state as RoomMemoryState)) {
    invariant('persisted memory state is invalid')
  }
  const tags = parseStringArray(row.tags_json, 'persisted memory tags')
  const evidenceRows = database
    .query(
      `SELECT * FROM room_memory_evidence
       WHERE memory_id = ? ORDER BY occurred_at_ms, event_id`
    )
    .all(row.memory_id) as EvidenceRow[]
  const evidence = evidenceRows.map(evidenceFromRow)
  if (evidence.length === 0) invariant('persisted Room memory has no evidence')
  validateUnitInterval(row.importance, 'persisted memory importance')
  validateUnitInterval(row.confidence, 'persisted memory confidence')
  validateRevision(row.revision, 'persisted memory revision', 1)
  validateTimestamp(row.created_at_ms, 'persisted memory creation timestamp')
  validateTimestamp(row.updated_at_ms, 'persisted memory update timestamp')
  if (row.updated_at_ms < row.created_at_ms) {
    invariant('persisted memory timestamps are invalid')
  }
  return Object.freeze({
    memoryId: row.memory_id,
    roomId: row.room_id as RoomId,
    memoryType: row.memory_type as RoomMemoryType,
    content: row.content,
    tags: Object.freeze(tags),
    importance: row.importance,
    confidence: row.confidence,
    origin: row.origin,
    state: row.state as RoomMemoryState,
    supersededBy: row.superseded_by,
    lastRecalledAt: nullableTimestamp(row.last_recalled_at_ms),
    expiresAt: nullableTimestamp(row.expires_at_ms),
    revision: asRevision(row.revision),
    createdAt: wallClockTimestampMs(row.created_at_ms),
    updatedAt: wallClockTimestampMs(row.updated_at_ms),
    evidence: Object.freeze(evidence)
  })
}

function evidenceFromRow(row: EvidenceRow): RoomMemoryEvidence {
  if (!EVENT_SOURCES.has(row.source_type as RoomEventSource)) {
    invariant('persisted memory evidence source is invalid')
  }
  validateTimestamp(row.occurred_at_ms, 'persisted evidence timestamp')
  if (row.evidence_summary.length > MAX_EVIDENCE_SUMMARY_CHARS) {
    invariant('persisted evidence summary exceeds the limit')
  }
  return Object.freeze({
    eventId: row.event_id,
    sourceType: row.source_type as RoomEventSource,
    occurredAt: wallClockTimestampMs(row.occurred_at_ms),
    summary: row.evidence_summary
  })
}

function validateCandidate(candidate: RoomMemoryCandidate): void {
  validateId(candidate.candidateId, 'candidate ID')
  validateId(candidate.roomId, 'Room ID')
  validateId(candidate.idempotencyKey, 'idempotency key')
  validateRevision(candidate.baseRevision, 'memory base revision', 0)
  validateId(candidate.memoryId, 'memory ID')
  if (!MEMORY_TYPES.has(candidate.memoryType)) invalid('memory type is invalid')
  validateContent(candidate.content)
  validateIds(candidate.evidenceEventIds, 'evidence event IDs', false)
  if (candidate.tags.length > MAX_TAGS) invalid('memory tags exceed the limit')
  for (const tag of candidate.tags) validateText(tag, MAX_TAG_CHARS, 'memory tag')
  validateText(candidate.origin, MAX_ID_CHARS, 'memory origin')
  validateUnitInterval(candidate.importance, 'memory importance')
  validateUnitInterval(candidate.confidence, 'memory confidence')
}

function validateIds(ids: readonly string[], label: string, allowEmpty: boolean): void {
  if ((!allowEmpty && ids.length === 0) || ids.length > MAX_EVIDENCE) {
    invalid(`${label} are invalid`)
  }
  for (const id of ids) validateId(id, label)
  if (new Set(ids).size !== ids.length) invalid(`${label} must be unique`)
}

function validateId(value: string, label: string): void {
  validateText(value, MAX_ID_CHARS, label)
}

function validateContent(value: string): void {
  validateText(value, MAX_CONTENT_CHARS, 'memory content')
}

function validateText(value: string, maximum: number, label: string): void {
  if (value.trim().length === 0 || value.length > maximum) invalid(`${label} is invalid`)
}

function validateLimit(value: number): void {
  if (!isSafeInteger(value, 1) || value > MAX_LIST_ITEMS) invalid('memory limit is invalid')
}

function validateRevision(value: number, label: string, minimum: number): void {
  if (!isSafeInteger(value, minimum)) invalid(`${label} is invalid`)
}

function validateTimestamp(value: number, label: string): void {
  if (!isSafeInteger(value, 0)) invalid(`${label} is invalid`)
}

function validateUnitInterval(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) invalid(`${label} is invalid`)
}

function parseObject(value: string, label: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value)
    if (isRecord(parsed)) return parsed
  } catch (error) {
    throw new SqlitePersistenceError('invariant_violation', `${label} is invalid`, {
      cause: error
    })
  }
  invariant(`${label} is invalid`)
}

function parseStringArray(value: string, label: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === 'string')) {
      return parsed
    }
  } catch (error) {
    throw new SqlitePersistenceError('invariant_violation', `${label} are invalid`, {
      cause: error
    })
  }
  invariant(`${label} are invalid`)
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ')
}

function nullableTimestamp(value: number | null): WallClockTimestampMs | null {
  return value === null ? null : wallClockTimestampMs(value)
}

function asRevision(value: number): Revision {
  if (!isSafeInteger(value, 0)) invariant('persisted revision is invalid')
  return value as Revision
}

function isSafeInteger(value: unknown, minimum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
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
