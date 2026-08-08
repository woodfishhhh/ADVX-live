import {
  canonicalJson,
  type Epoch,
  type RoomId,
  type SafeJsonValue,
  type SessionId,
  type ViewerId
} from '@advx/contracts'
import type { Database } from 'bun:sqlite'

import type {
  DurableOutboxClaim,
  DurableOutboxEnqueue,
  DurableOutboxFence,
  DurableOutboxFenceKind,
  DurableOutboxKind,
  DurableOutboxLeaseIdentity,
  DurableOutboxRecord,
  DurableOutboxRetry,
  DurableOutboxSettlement,
  DurableOutboxStatus,
  OutboxRepository,
  TransactionContext
} from '../../../application/ports/repositories'
import {
  wallClockTimestampMs,
  type WallClockTimestampMs
} from '../../../application/ports/time'
import { SqlitePersistenceError } from './errors'
import type { SqliteTransactionBoundary } from './transaction'

type OutboxRow = Readonly<{
  work_id: string
  idempotency_key: string
  kind: string
  topic: string
  fence_kind: string
  room_id: string | null
  session_id: string | null
  audience_epoch: number | null
  observation_id: string | null
  viewer_instance_id: string | null
  viewer_sequence: number | null
  payload_json: string
  status: string
  attempt_count: number
  available_at_ms: number
  lease_owner: string | null
  lease_expires_at_ms: number | null
  last_error_code: string | null
  created_at_ms: number
  updated_at_ms: number
  settled_at_ms: number | null
}>

const MAX_ID_CHARS = 128
const MAX_TOPIC_CHARS = 128
const MAX_PAYLOAD_BYTES = 64 * 1024
const MAX_PAYLOAD_DEPTH = 32
const MAX_CLAIM_BATCH = 100

const OUTBOX_KINDS = new Set<DurableOutboxKind>([
  'domain_event',
  'memory_side_effect',
  'meme_side_effect',
  'migration_marker',
  'recovery_marker'
])
const OUTBOX_STATUSES = new Set<DurableOutboxStatus>([
  'pending',
  'leased',
  'completed',
  'cancelled',
  'dead_letter'
])
const FENCE_KINDS = new Set<DurableOutboxFenceKind>([
  'none',
  'room',
  'session_epoch',
  'viewer_sequence'
])
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  'access_token',
  'audio_bytes',
  'frame_bytes',
  'full_frame',
  'full_prompt',
  'model_stream',
  'provider_credential',
  'provider_request',
  'provider_response',
  'provider_stream',
  'raw_audio',
  'secret'
])
const TOPIC_PATTERN = /^[a-z][a-z0-9_.:-]*$/

export class SqliteOutboxRepository implements OutboxRepository {
  constructor(private readonly transactions: SqliteTransactionBoundary) {}

  async get(
    transaction: TransactionContext,
    workId: string
  ): Promise<DurableOutboxRecord | null> {
    validateId(workId, 'outbox work ID')
    const row = this.transactions
      .connection(transaction)
      .query('SELECT * FROM durable_outbox WHERE work_id = ?')
      .get(workId) as OutboxRow | null
    return row === null ? null : outboxRecord(row)
  }

  async enqueue(
    transaction: TransactionContext,
    command: DurableOutboxEnqueue
  ): Promise<Readonly<{ workId: string; created: boolean }>> {
    const payloadJson = validateEnqueue(command)
    const database = this.transactions.connection(transaction)
    const idempotent = database
      .query('SELECT * FROM durable_outbox WHERE idempotency_key = ?')
      .get(command.idempotencyKey) as OutboxRow | null
    if (idempotent !== null) {
      requireSameEnqueue(idempotent, command, payloadJson)
      return Object.freeze({ workId: idempotent.work_id, created: false })
    }
    const reusedId = database
      .query('SELECT work_id FROM durable_outbox WHERE work_id = ?')
      .get(command.workId) as { work_id: string } | null
    if (reusedId !== null) conflict('outbox work ID was reused')

    database
      .query(
        `INSERT INTO durable_outbox (
           work_id, idempotency_key, kind, topic, fence_kind, room_id,
           session_id, audience_epoch, observation_id, viewer_instance_id,
           viewer_sequence, payload_json, status, attempt_count,
           available_at_ms, lease_owner, lease_expires_at_ms, last_error_code,
           created_at_ms, updated_at_ms, settled_at_ms
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0,
           ?, NULL, NULL, NULL, ?, ?, NULL
         )`
      )
      .run(
        command.workId,
        command.idempotencyKey,
        command.kind,
        command.topic,
        command.fence.kind,
        command.fence.roomId,
        command.fence.sessionId,
        command.fence.audienceEpoch,
        command.fence.observationId,
        command.fence.viewerId,
        command.fence.viewerSequence,
        payloadJson,
        command.availableAt,
        command.createdAt,
        command.createdAt
      )
    return Object.freeze({ workId: command.workId, created: true })
  }

  async claim(
    transaction: TransactionContext,
    command: DurableOutboxClaim
  ): Promise<readonly DurableOutboxRecord[]> {
    validateClaim(command)
    const database = this.transactions.connection(transaction)
    const placeholders = command.kinds.map(() => '?').join(', ')
    const candidates = database
      .query(
        `SELECT work_id FROM durable_outbox
         WHERE kind IN (${placeholders})
           AND (
             (status = 'pending' AND available_at_ms <= ?)
             OR
             (status = 'leased' AND lease_expires_at_ms <= ?)
           )
         ORDER BY
           CASE
             WHEN status = 'pending' THEN available_at_ms
             ELSE lease_expires_at_ms
           END,
           created_at_ms,
           work_id
         LIMIT ?`
      )
      .all(...command.kinds, command.now, command.now, command.limit) as Array<{
      work_id: string
    }>

    const claimed: DurableOutboxRecord[] = []
    for (const candidate of candidates) {
      const result = database
        .query(
          `UPDATE durable_outbox
           SET status = 'leased',
               attempt_count = attempt_count + 1,
               lease_owner = ?,
               lease_expires_at_ms = ?,
               updated_at_ms = ?
           WHERE work_id = ?
             AND (
               (status = 'pending' AND available_at_ms <= ?)
               OR
               (status = 'leased' AND lease_expires_at_ms <= ?)
             )`
        )
        .run(
          command.workerId,
          command.leaseExpiresAt,
          command.now,
          candidate.work_id,
          command.now,
          command.now
        )
      if (result.changes !== 1) {
        invariant('outbox claim candidate changed inside its transaction')
      }
      claimed.push(requireRecord(database, candidate.work_id))
    }
    return Object.freeze(claimed)
  }

  async fenceCurrent(
    transaction: TransactionContext,
    lease: DurableOutboxLeaseIdentity
  ): Promise<boolean> {
    const database = this.transactions.connection(transaction)
    const row = requireLeasedRow(database, lease)
    const fence = outboxFence(row)
    if (fence.kind === 'none') return true
    if (fence.kind === 'room') {
      const room = database
        .query('SELECT state FROM rooms WHERE room_id = ?')
        .get(fence.roomId) as { state: string } | null
      return room?.state === 'active'
    }
    const session = database
      .query(
        'SELECT room_id, audience_epoch FROM session_records WHERE session_id = ?'
      )
      .get(fence.sessionId) as
      | { room_id: string | null; audience_epoch: number | null }
      | null
    if (
      session === null ||
      session.room_id !== fence.roomId ||
      session.audience_epoch !== fence.audienceEpoch
    ) {
      return false
    }
    if (fence.kind === 'session_epoch') return true
    const viewer = database
      .query(
        `SELECT viewer_sequence, presence_state, state
         FROM session_viewer_instances
         WHERE session_id = ? AND viewer_instance_id = ?`
      )
      .get(fence.sessionId, fence.viewerId) as
      | { viewer_sequence: number; presence_state: string; state: string }
      | null
    return (
      viewer !== null &&
      viewer.viewer_sequence === fence.viewerSequence &&
      viewer.presence_state === 'active' &&
      viewer.state === 'active'
    )
  }

  async settle(
    transaction: TransactionContext,
    command: DurableOutboxSettlement
  ): Promise<DurableOutboxRecord> {
    validateSettlement(command)
    const database = this.transactions.connection(transaction)
    const row = requireLeasedRow(database, command)
    if (command.settledAt < row.updated_at_ms) {
      conflict('outbox settlement timestamp is stale')
    }
    const result = database
      .query(
        `UPDATE durable_outbox
         SET status = ?,
             lease_owner = NULL,
             lease_expires_at_ms = NULL,
             last_error_code = ?,
             updated_at_ms = ?,
             settled_at_ms = ?
         WHERE work_id = ?
           AND status = 'leased'
           AND lease_owner = ?
           AND attempt_count = ?`
      )
      .run(
        command.status,
        command.errorCode,
        command.settledAt,
        command.settledAt,
        command.workId,
        command.workerId,
        command.expectedAttempt
      )
    requireChanged(result.changes, 'outbox lease is stale')
    return requireRecord(database, command.workId)
  }

  async retry(
    transaction: TransactionContext,
    command: DurableOutboxRetry
  ): Promise<DurableOutboxRecord> {
    validateRetry(command)
    const database = this.transactions.connection(transaction)
    const row = requireLeasedRow(database, command)
    if (command.retriedAt < row.updated_at_ms) {
      conflict('outbox retry timestamp is stale')
    }
    const result = database
      .query(
        `UPDATE durable_outbox
         SET status = 'pending',
             available_at_ms = ?,
             lease_owner = NULL,
             lease_expires_at_ms = NULL,
             last_error_code = ?,
             updated_at_ms = ?,
             settled_at_ms = NULL
         WHERE work_id = ?
           AND status = 'leased'
           AND lease_owner = ?
           AND attempt_count = ?`
      )
      .run(
        command.availableAt,
        command.errorCode,
        command.retriedAt,
        command.workId,
        command.workerId,
        command.expectedAttempt
      )
    requireChanged(result.changes, 'outbox lease is stale')
    return requireRecord(database, command.workId)
  }
}

function validateEnqueue(command: DurableOutboxEnqueue): string {
  validateId(command.workId, 'outbox work ID')
  validateId(command.idempotencyKey, 'outbox idempotency key')
  if (!OUTBOX_KINDS.has(command.kind)) invalid('outbox kind is invalid')
  validateTopic(command.topic)
  validateFence(command.fence)
  validateTimestamp(command.createdAt, 'outbox created timestamp')
  validateTimestamp(command.availableAt, 'outbox available timestamp')
  if (command.availableAt < command.createdAt) {
    invalid('outbox availability precedes creation')
  }
  return serializePayload(command.payload)
}

function validateClaim(command: DurableOutboxClaim): void {
  validateId(command.workerId, 'outbox worker ID')
  validateTimestamp(command.now, 'outbox claim timestamp')
  validateTimestamp(command.leaseExpiresAt, 'outbox lease expiration')
  if (command.leaseExpiresAt <= command.now) {
    invalid('outbox lease expiration must follow claim time')
  }
  if (
    !Number.isSafeInteger(command.limit) ||
    command.limit < 1 ||
    command.limit > MAX_CLAIM_BATCH
  ) {
    invalid('outbox claim limit is invalid')
  }
  if (command.kinds.length === 0 || command.kinds.length > OUTBOX_KINDS.size) {
    invalid('outbox claim kinds are invalid')
  }
  const unique = new Set<DurableOutboxKind>()
  for (const kind of command.kinds) {
    if (!OUTBOX_KINDS.has(kind) || unique.has(kind)) {
      invalid('outbox claim kinds are invalid')
    }
    unique.add(kind)
  }
}

function validateSettlement(command: DurableOutboxSettlement): void {
  validateLease(command)
  validateTimestamp(command.settledAt, 'outbox settlement timestamp')
  if (command.status === 'completed') {
    if (command.errorCode !== null) {
      invalid('completed outbox work cannot have an error code')
    }
  } else {
    validateErrorCode(command.errorCode)
  }
}

function validateRetry(command: DurableOutboxRetry): void {
  validateLease(command)
  validateErrorCode(command.errorCode)
  validateTimestamp(command.retriedAt, 'outbox retry timestamp')
  validateTimestamp(command.availableAt, 'outbox retry availability')
  if (command.availableAt < command.retriedAt) {
    invalid('outbox retry availability precedes retry time')
  }
}

function validateLease(command: DurableOutboxLeaseIdentity): void {
  validateId(command.workId, 'outbox work ID')
  validateId(command.workerId, 'outbox worker ID')
  if (!Number.isSafeInteger(command.expectedAttempt) || command.expectedAttempt < 1) {
    invalid('outbox lease attempt is invalid')
  }
}

function validateFence(fence: DurableOutboxFence): void {
  if (!FENCE_KINDS.has(fence.kind)) invalid('outbox fence kind is invalid')
  validateOptionalId(fence.roomId, 'outbox Room ID')
  validateOptionalId(fence.sessionId, 'outbox Session ID')
  validateOptionalId(fence.observationId, 'outbox Observation ID')
  validateOptionalId(fence.viewerId, 'outbox Viewer ID')
  if (
    fence.audienceEpoch !== null &&
    (!Number.isSafeInteger(fence.audienceEpoch) || fence.audienceEpoch < 1)
  ) {
    invalid('outbox audience epoch is invalid')
  }
  if (
    fence.viewerSequence !== null &&
    (!Number.isSafeInteger(fence.viewerSequence) || fence.viewerSequence < 0)
  ) {
    invalid('outbox Viewer sequence is invalid')
  }
  if (!fenceShapeValid(fence)) invalid('outbox fence fields are inconsistent')
}

function fenceShapeValid(fence: DurableOutboxFence): boolean {
  const noViewer = fence.viewerId === null && fence.viewerSequence === null
  if (fence.kind === 'none') {
    return (
      fence.roomId === null &&
      fence.sessionId === null &&
      fence.audienceEpoch === null &&
      fence.observationId === null &&
      noViewer
    )
  }
  if (fence.kind === 'room') {
    return (
      fence.roomId !== null &&
      fence.sessionId === null &&
      fence.audienceEpoch === null &&
      fence.observationId === null &&
      noViewer
    )
  }
  if (fence.kind === 'session_epoch') {
    return (
      fence.roomId !== null &&
      fence.sessionId !== null &&
      fence.audienceEpoch !== null &&
      noViewer
    )
  }
  return (
    fence.roomId !== null &&
    fence.sessionId !== null &&
    fence.audienceEpoch !== null &&
    fence.viewerId !== null &&
    fence.viewerSequence !== null
  )
}

function requireSameEnqueue(
  row: OutboxRow,
  command: DurableOutboxEnqueue,
  payloadJson: string
): void {
  if (
    row.work_id !== command.workId ||
    row.kind !== command.kind ||
    row.topic !== command.topic ||
    row.fence_kind !== command.fence.kind ||
    row.room_id !== command.fence.roomId ||
    row.session_id !== command.fence.sessionId ||
    row.audience_epoch !== command.fence.audienceEpoch ||
    row.observation_id !== command.fence.observationId ||
    row.viewer_instance_id !== command.fence.viewerId ||
    row.viewer_sequence !== command.fence.viewerSequence ||
    row.payload_json !== payloadJson ||
    row.available_at_ms !== command.availableAt ||
    row.created_at_ms !== command.createdAt
  ) {
    conflict('outbox idempotency key was used with different work')
  }
}

function requireLeasedRow(
  database: Database,
  lease: DurableOutboxLeaseIdentity
): OutboxRow {
  validateLease(lease)
  const row = database
    .query(
      `SELECT * FROM durable_outbox
       WHERE work_id = ?
         AND status = 'leased'
         AND lease_owner = ?
         AND attempt_count = ?`
    )
    .get(lease.workId, lease.workerId, lease.expectedAttempt) as OutboxRow | null
  if (row === null) conflict('outbox lease is stale')
  return row
}

function requireRecord(database: Database, workId: string): DurableOutboxRecord {
  const row = database
    .query('SELECT * FROM durable_outbox WHERE work_id = ?')
    .get(workId) as OutboxRow | null
  if (row === null) invariant('outbox record is missing')
  return outboxRecord(row)
}

function outboxRecord(row: OutboxRow): DurableOutboxRecord {
  if (!OUTBOX_KINDS.has(row.kind as DurableOutboxKind)) {
    invariant('persisted outbox kind is invalid')
  }
  if (!OUTBOX_STATUSES.has(row.status as DurableOutboxStatus)) {
    invariant('persisted outbox status is invalid')
  }
  if (!Number.isSafeInteger(row.attempt_count) || row.attempt_count < 0) {
    invariant('persisted outbox attempt count is invalid')
  }
  const createdAt = persistedTimestamp(row.created_at_ms, 'outbox created timestamp')
  const updatedAt = persistedTimestamp(row.updated_at_ms, 'outbox updated timestamp')
  const availableAt = persistedTimestamp(
    row.available_at_ms,
    'outbox available timestamp'
  )
  if (updatedAt < createdAt || availableAt < createdAt) {
    invariant('persisted outbox timestamps are invalid')
  }
  const leaseExpiresAt =
    row.lease_expires_at_ms === null
      ? null
      : persistedTimestamp(row.lease_expires_at_ms, 'outbox lease expiration')
  const settledAt =
    row.settled_at_ms === null
      ? null
      : persistedTimestamp(row.settled_at_ms, 'outbox settlement timestamp')
  const leased = row.status === 'leased'
  const settled =
    row.status === 'completed' ||
    row.status === 'cancelled' ||
    row.status === 'dead_letter'
  if (
    leased !== (row.lease_owner !== null && leaseExpiresAt !== null) ||
    settled !== (settledAt !== null)
  ) {
    invariant('persisted outbox lifecycle is inconsistent')
  }
  return Object.freeze({
    workId: row.work_id,
    idempotencyKey: row.idempotency_key,
    kind: row.kind as DurableOutboxKind,
    topic: row.topic,
    fence: outboxFence(row),
    payload: parsePayload(row.payload_json),
    status: row.status as DurableOutboxStatus,
    attemptCount: row.attempt_count,
    availableAt,
    leaseOwner: row.lease_owner,
    leaseExpiresAt,
    lastErrorCode: row.last_error_code,
    createdAt,
    updatedAt,
    settledAt
  })
}

function outboxFence(row: OutboxRow): DurableOutboxFence {
  if (!FENCE_KINDS.has(row.fence_kind as DurableOutboxFenceKind)) {
    invariant('persisted outbox fence kind is invalid')
  }
  const fence: DurableOutboxFence = Object.freeze({
    kind: row.fence_kind as DurableOutboxFenceKind,
    roomId: row.room_id as RoomId | null,
    sessionId: row.session_id as SessionId | null,
    audienceEpoch: row.audience_epoch as Epoch | null,
    observationId: row.observation_id,
    viewerId: row.viewer_instance_id as ViewerId | null,
    viewerSequence: row.viewer_sequence
  })
  if (!fenceShapeValid(fence)) invariant('persisted outbox fence is inconsistent')
  return fence
}

function serializePayload(payload: SafeJsonValue): string {
  const violation = payloadViolation(payload)
  if (violation !== null) invalid(violation)
  let value: string
  try {
    value = canonicalJson(payload)
  } catch (error) {
    throw new SqlitePersistenceError('invalid_record', 'outbox payload is invalid', {
      cause: error
    })
  }
  if (new TextEncoder().encode(value).byteLength > MAX_PAYLOAD_BYTES) {
    invalid('outbox payload is too large')
  }
  return value
}

function parsePayload(value: string): SafeJsonValue {
  if (new TextEncoder().encode(value).byteLength > MAX_PAYLOAD_BYTES) {
    invariant('persisted outbox payload is too large')
  }
  try {
    const parsed: unknown = JSON.parse(value)
    if (canonicalJson(parsed) !== value) {
      invariant('persisted outbox payload is not canonical')
    }
    const violation = payloadViolation(parsed)
    if (violation !== null) invariant('persisted outbox payload is invalid')
    return parsed as SafeJsonValue
  } catch (error) {
    if (error instanceof SqlitePersistenceError) throw error
    throw new SqlitePersistenceError(
      'invariant_violation',
      'persisted outbox payload is invalid',
      { cause: error }
    )
  }
}

function payloadViolation(value: unknown, depth = 0): string | null {
  if (depth > MAX_PAYLOAD_DEPTH) return 'outbox payload is too deeply nested'
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return null
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? null : 'outbox payload contains a non-finite number'
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const violation = payloadViolation(child, depth + 1)
      if (violation !== null) return violation
    }
    return null
  }
  if (typeof value !== 'object') return 'outbox payload contains an unsupported value'
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(normalizePayloadKey(key))) {
      return 'outbox payload contains non-durable Provider or media state'
    }
    const violation = payloadViolation(child, depth + 1)
    if (violation !== null) return violation
  }
  return null
}

function normalizePayloadKey(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .toLowerCase()
}

function validateTopic(value: string): void {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_TOPIC_CHARS ||
    !TOPIC_PATTERN.test(value)
  ) {
    invalid('outbox topic is invalid')
  }
}

function validateErrorCode(value: string | null): asserts value is string {
  if (value === null) invalid('outbox error code is required')
  validateTopic(value)
}

function validateOptionalId(value: string | null, label: string): void {
  if (value !== null) validateId(value, label)
}

function validateId(value: string, label: string): void {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_ID_CHARS) {
    invalid(label + ' is invalid')
  }
}

function validateTimestamp(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) invalid(label + ' is invalid')
}

function persistedTimestamp(value: number, label: string): WallClockTimestampMs {
  if (!Number.isSafeInteger(value) || value < 0) {
    invariant('persisted ' + label + ' is invalid')
  }
  return wallClockTimestampMs(value)
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

function invariant(message: string): never {
  throw new SqlitePersistenceError('invariant_violation', message)
}
