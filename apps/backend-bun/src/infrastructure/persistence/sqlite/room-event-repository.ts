import {
  canonicalJson,
  canonicalSha256,
  roomEventSourceSchema,
  type Epoch,
  type RoomEventSource,
  type RoomId,
  type SafeJsonValue,
  type SessionId
} from '@advx/contracts'
import type { Database, SQLQueryBindings } from 'bun:sqlite'

import type {
  RoomEventContextQuery,
  RoomEventContextWindow,
  RoomEventInput,
  RoomEventPayload,
  RoomEventRecord,
  RoomEventRepository,
  RoomEventRetentionPolicy,
  TransactionContext
} from '../../../application/ports/repositories'
import {
  wallClockTimestampMs,
  type WallClockTimestampMs
} from '../../../application/ports/time'
import { SqlitePersistenceError } from './errors'
import { SqliteTransactionBoundary } from './transaction'

type RoomEventRow = Readonly<{
  event_id: string
  room_id: string
  session_id: string
  sequence: number
  source_type: string
  source_id: string
  audience_epoch: number
  content_json: string
  content_hash: string
  occurred_at_ms: number
}>

type RoomEventContent = Readonly<{
  schema_version: 1
  event_id: string
  room_id: string
  session_id: string
  sequence: number
  source_type: RoomEventSource
  source_id: string | null
  audience_epoch: number
  text: string | null
  payload: RoomEventPayload
  occurred_at_ms: number
}>

const ROOM_EVENT_SOURCES = [
  'user_text',
  'user_voice',
  'audience_barrage',
  'screen_observation',
  'system_event'
] as const satisfies readonly RoomEventSource[]

const MAX_RECOVERY_EVENTS = 4_096
const MAX_PUBLIC_EVENTS = 128
const MAX_REPLY_EVENTS = 32
const MAX_TRIGGER_EVENTS = 128
const MAX_TEXT_CHARS = 4_000
const MAX_CONTENT_BYTES = 32_768
const MAX_PER_PUBLIC_CATEGORY = 16

const PAYLOAD_KEYS = {
  user_text: ['input_id', 'target_viewer_id', 'target_persona_id'],
  user_voice: [
    'audio_source',
    'final',
    'started_at_ms',
    'ended_at_ms',
    'utterance_id',
    'turn_id',
    'revision',
    'target_resolver_id',
    'target_ambiguous',
    'target_viewer_id',
    'target_persona_id'
  ],
  audience_barrage: [
    'barrage_id',
    'audience_epoch',
    'observation_id',
    'request_id',
    'generation_request_id',
    'viewer_instance_id',
    'persona_id',
    'display_name',
    'viewer_sequence',
    'reaction_type',
    'intent',
    'target',
    'evidence_refs',
    'expires_at_ms'
  ],
  screen_observation: [
    'frame_id',
    'frame_hash',
    'captured_at_ms',
    'summary',
    'labels'
  ],
  system_event: [
    'event',
    'reason',
    'revision',
    'state',
    'mode_id',
    'round',
    'tags',
    'audio_source',
    'final',
    'started_at_ms',
    'ended_at_ms',
    'utterance_id',
    'turn_id'
  ]
} as const satisfies Readonly<Record<RoomEventSource, readonly string[]>>

export function createRoomEventRecord(input: RoomEventInput): RoomEventRecord {
  validateInput(input)
  const content: RoomEventContent = {
    schema_version: 1,
    event_id: input.eventId,
    room_id: input.roomId,
    session_id: input.sessionId,
    sequence: input.sequence,
    source_type: input.sourceType,
    source_id: input.sourceId,
    audience_epoch: input.audienceEpoch,
    text: input.text,
    payload: input.payload,
    occurred_at_ms: input.occurredAt
  }
  const contentJson = canonicalJson(content)
  if (new TextEncoder().encode(contentJson).byteLength > MAX_CONTENT_BYTES) {
    invalid('Room event content exceeds the persistence limit')
  }
  return Object.freeze({
    ...input,
    evidenceEventIds: Object.freeze(evidenceEventIds(input.payload)),
    contentJson,
    contentHash: canonicalSha256(content)
  })
}

export class SqliteRoomEventRepository implements RoomEventRepository {
  constructor(private readonly transactions: SqliteTransactionBoundary) {}

  async append(
    transaction: TransactionContext,
    event: RoomEventRecord
  ): Promise<boolean> {
    validateRecord(event, 'input')
    const database = this.transactions.connection(transaction)
    const session = database
      .query('SELECT room_id FROM session_records WHERE session_id = ?')
      .get(event.sessionId) as { room_id: string | null } | null
    if (session === null) notFound('Room event Session is missing')
    if (session.room_id !== event.roomId) {
      invariant('Room event Room does not match its Session')
    }

    const existing = getEventById(database, event.eventId)
    if (existing !== null) {
      requireSameEvent(existing, event)
      return false
    }

    const result = database.run(
      `INSERT INTO room_events (
         event_id, room_id, session_id, sequence, source_type, source_id,
         audience_epoch, content_json, content_hash, occurred_at_ms
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
      eventParameters(event)
    )
    if (result.changes === 1) return true

    const concurrent = getEventById(database, event.eventId)
    if (concurrent !== null) {
      requireSameEvent(concurrent, event)
      return false
    }
    conflict('Room event sequence was already used in the Session')
  }

  async appendWithRetention(
    transaction: TransactionContext,
    event: RoomEventRecord,
    retention: RoomEventRetentionPolicy
  ): Promise<Readonly<{ inserted: boolean; pruned: number }>> {
    const inserted = await this.append(transaction, event)
    const pruned = await this.prune(transaction, event.roomId, retention)
    return Object.freeze({ inserted, pruned })
  }

  async listForRecovery(
    transaction: TransactionContext,
    roomId: RoomId,
    sessionId: SessionId,
    maximumAudienceEpoch: Epoch,
    limit: number
  ): Promise<readonly RoomEventRecord[]> {
    requireIntegerBetween(limit, 1, MAX_RECOVERY_EVENTS, 'recovery event limit')
    if (!Number.isSafeInteger(maximumAudienceEpoch) || maximumAudienceEpoch < 1) {
      invalid('maximum recovery audience epoch must be positive')
    }
    const rows = this.transactions
      .connection(transaction)
      .query(
        `SELECT * FROM room_events
         WHERE room_id = ? AND session_id = ?
         ORDER BY sequence DESC, event_id DESC
         LIMIT ?`
      )
      .all(roomId, sessionId, limit) as RoomEventRow[]
    const events = rows
      .reverse()
      .map((row) => eventFromRow(row, roomId, sessionId, maximumAudienceEpoch))
    for (let index = 1; index < events.length; index += 1) {
      if (events[index]!.sequence <= events[index - 1]!.sequence) {
        invariant('persisted Room event sequence is not strictly increasing')
      }
    }
    return Object.freeze(events)
  }

  async readContextWindow(
    transaction: TransactionContext,
    query: RoomEventContextQuery
  ): Promise<RoomEventContextWindow> {
    validateContextQuery(query)
    const database = this.transactions.connection(transaction)
    const triggerIds = [...new Set(query.triggerEventIds)]
    const triggerEvents = selectEventsByIds(
      database,
      query.roomId,
      query.sessionId,
      triggerIds
    ).filter((event) => event.occurredAt <= query.observedAt)
    const publicCutoff = Math.max(0, query.observedAt - query.publicWindowMs)
    const publicRows = database
      .query(
        `SELECT * FROM (
           SELECT room_events.*,
             ROW_NUMBER() OVER (
               PARTITION BY CASE
                 WHEN source_type IN ('user_text', 'user_voice') THEN 'user'
                 WHEN source_type = 'screen_observation' THEN 'screen'
                 ELSE 'system_audio'
               END
               ORDER BY sequence DESC, event_id DESC
             ) AS category_rank
           FROM room_events
           WHERE room_id = ? AND session_id = ?
             AND occurred_at_ms >= ? AND occurred_at_ms <= ?
             AND (
               source_type IN ('user_text', 'user_voice', 'screen_observation')
               OR (
                 source_type = 'system_event'
                 AND json_extract(content_json, '$.payload.event') = 'system_audio_transcript'
               )
             )
         ) AS bounded_context
         WHERE category_rank <= ?
         ORDER BY sequence DESC, event_id DESC`
      )
      .all(
        query.roomId,
        query.sessionId,
        publicCutoff,
        query.observedAt,
        MAX_PER_PUBLIC_CATEGORY
      ) as RoomEventRow[]
    const publicCandidates = uniqueEvents([
      ...publicRows.map((row) => eventFromRow(row, query.roomId, query.sessionId)),
      ...triggerEvents
    ])
    const publicContext = selectPublicContext(publicCandidates, triggerIds, query)

    const replyCutoff = Math.max(0, query.observedAt - query.replyWindowMs)
    const replyRows = query.replyLimit === 0
      ? []
      : database
          .query(
            `SELECT * FROM room_events
             WHERE room_id = ? AND session_id = ? AND source_type = 'audience_barrage'
               AND occurred_at_ms >= ? AND occurred_at_ms <= ?
             ORDER BY sequence DESC, event_id DESC
             LIMIT ?`
          )
          .all(
            query.roomId,
            query.sessionId,
            replyCutoff,
            query.observedAt,
            query.replyLimit
          ) as RoomEventRow[]
    const replyCandidates = uniqueEvents([
      ...replyRows.map((row) => eventFromRow(row, query.roomId, query.sessionId)),
      ...triggerEvents.filter((event) => event.sourceType === 'audience_barrage')
    ])
    const replyContext = selectReplyContext(
      database,
      replyCandidates,
      triggerIds,
      query,
      replyCutoff
    )
    const observationTriggerEventIds = Object.freeze(
      triggerEvents
        .filter((event) => event.sourceType !== 'audience_barrage')
        .sort(compareEvents)
        .map((event) => event.eventId)
    )
    return Object.freeze({
      publicContext: Object.freeze(publicContext),
      replyContext: Object.freeze(replyContext),
      observationTriggerEventIds
    })
  }

  async prune(
    transaction: TransactionContext,
    roomId: RoomId,
    retention: RoomEventRetentionPolicy
  ): Promise<number> {
    const database = this.transactions.connection(transaction)
    let pruned = 0
    for (const source of ROOM_EVENT_SOURCES) {
      const rule = retention[source]
      if (!Number.isSafeInteger(rule.keepAfter) || rule.keepAfter < 0) {
        invalid(`Room event ${source} retention cutoff must be nonnegative`)
      }
      requireIntegerBetween(
        rule.maxEvents,
        1,
        MAX_RECOVERY_EVENTS,
        `Room event ${source} retention limit`
      )
      const result = database.run(
        `DELETE FROM room_events
         WHERE room_id = ? AND source_type = ? AND event_id NOT IN (
           SELECT event_id FROM room_events
           WHERE room_id = ? AND source_type = ? AND occurred_at_ms >= ?
           ORDER BY occurred_at_ms DESC, event_id DESC
           LIMIT ?
         )`,
        [roomId, source, roomId, source, rule.keepAfter, rule.maxEvents]
      )
      pruned += result.changes
    }
    return pruned
  }
}

function selectPublicContext(
  candidates: readonly RoomEventRecord[],
  triggerIds: readonly string[],
  query: RoomEventContextQuery
): RoomEventRecord[] {
  const triggerSet = new Set(triggerIds)
  const cutoff = Math.max(0, query.observedAt - query.publicWindowMs)
  const forced = candidates
    .filter(
      (event) => triggerSet.has(event.eventId) && event.sourceType !== 'audience_barrage'
    )
    .sort(compareEvents)
  const forcedIds = new Set(forced.map((event) => event.eventId))
  const selected = new Map<PublicCategory, RoomEventRecord[]>()
  selected.set('user', [])
  selected.set('system_audio', [])
  selected.set('screen', [])
  const forcedCounts = new Map<PublicCategory, number>([
    ['user', 0],
    ['system_audio', 0],
    ['screen', 0]
  ])
  for (const event of forced) {
    const category = publicCategory(event)
    if (category !== null) {
      forcedCounts.set(category, forcedCounts.get(category)! + 1)
    }
  }
  for (const event of [...candidates].sort(compareEvents).reverse()) {
    const category = publicCategory(event)
    if (
      forcedIds.has(event.eventId) ||
      event.occurredAt < cutoff ||
      category === null ||
      selected.get(category)!.length >=
        Math.max(0, MAX_PER_PUBLIC_CATEGORY - forcedCounts.get(category)!)
    ) {
      continue
    }
    selected.get(category)!.push(event)
  }
  let context = [
    ...forced,
    ...selected.get('user')!,
    ...selected.get('system_audio')!,
    ...selected.get('screen')!
  ].sort(compareEvents)
  if (context.length > query.publicLimit) {
    const forcedOrdered = context
      .filter((event) => forcedIds.has(event.eventId))
      .slice(0, query.publicLimit)
    const remaining = query.publicLimit - forcedOrdered.length
    const nonForced = remaining === 0
      ? []
      : context.filter((event) => !forcedIds.has(event.eventId)).slice(-remaining)
    context = [...forcedOrdered, ...nonForced].sort(compareEvents)
  }
  return context
}

function selectReplyContext(
  database: Database,
  candidates: readonly RoomEventRecord[],
  triggerIds: readonly string[],
  query: RoomEventContextQuery,
  replyCutoff: number
): RoomEventRecord[] {
  if (query.replyLimit === 0) return []
  const triggerSet = new Set(triggerIds)
  const forced = candidates
    .filter(
      (event) =>
        triggerSet.has(event.eventId) && event.sourceType === 'audience_barrage'
    )
    .sort(compareEvents)
    .slice(0, query.replyLimit)
  const forcedIds = new Set(forced.map((event) => event.eventId))
  const remaining = query.replyLimit - forced.length
  const recent = remaining === 0
    ? []
    : candidates
        .filter(
          (event) =>
            event.sourceType === 'audience_barrage' &&
            event.occurredAt >= replyCutoff &&
            !forcedIds.has(event.eventId)
        )
        .sort(compareEvents)
        .slice(-remaining)
  let context = [...forced, ...recent]
  const newest = context.at(-1)
  const parentId = newest === undefined ? null : replyParentEventId(newest)
  if (
    parentId !== null &&
    context.length > 0 &&
    query.replyLimit > 1 &&
    !context.some((event) => event.eventId === parentId)
  ) {
    const parentRow = getEventById(database, parentId)
    if (parentRow !== null) {
      const parent = eventFromRow(parentRow, query.roomId, query.sessionId)
      if (
        parent.sourceType === 'audience_barrage' &&
        parent.occurredAt >= replyCutoff &&
        parent.occurredAt <= query.observedAt
      ) {
        context = [parent, ...context.slice(-(query.replyLimit - 1))]
      }
    }
  }
  return context.sort(compareEvents).slice(-query.replyLimit)
}

function publicCategory(event: RoomEventRecord): PublicCategory | null {
  if (event.sourceType === 'user_text' || event.sourceType === 'user_voice') {
    return 'user'
  }
  if (event.sourceType === 'screen_observation') return 'screen'
  if (
    event.sourceType === 'system_event' &&
    event.payload.event === 'system_audio_transcript'
  ) {
    return 'system_audio'
  }
  return null
}

type PublicCategory = 'user' | 'system_audio' | 'screen'

function replyParentEventId(event: RoomEventRecord): string | null {
  const target = event.payload.target
  if (
    isRecord(target) &&
    target.kind === 'event' &&
    typeof target.event_id === 'string'
  ) {
    return target.event_id
  }
  return event.evidenceEventIds[0] ?? null
}

function selectEventsByIds(
  database: Database,
  roomId: RoomId,
  sessionId: SessionId,
  eventIds: readonly string[]
): RoomEventRecord[] {
  if (eventIds.length === 0) return []
  const placeholders = eventIds.map(() => '?').join(', ')
  const rows = database
    .query(
      `SELECT * FROM room_events
       WHERE room_id = ? AND session_id = ? AND event_id IN (${placeholders})`
    )
    .all(roomId, sessionId, ...eventIds) as RoomEventRow[]
  return rows.map((row) => eventFromRow(row, roomId, sessionId))
}

function uniqueEvents(events: readonly RoomEventRecord[]): RoomEventRecord[] {
  const unique = new Map<string, RoomEventRecord>()
  for (const event of events) unique.set(event.eventId, event)
  return [...unique.values()]
}

function compareEvents(left: RoomEventRecord, right: RoomEventRecord): number {
  return left.sequence - right.sequence || left.eventId.localeCompare(right.eventId)
}

function getEventById(database: Database, eventId: string): RoomEventRow | null {
  return database
    .query('SELECT * FROM room_events WHERE event_id = ?')
    .get(eventId) as RoomEventRow | null
}

function eventFromRow(
  row: RoomEventRow,
  expectedRoomId: RoomId,
  expectedSessionId: SessionId,
  maximumAudienceEpoch?: Epoch
): RoomEventRecord {
  if (!roomEventSourceSchema.check(row.source_type)) {
    invariant('persisted Room event source is invalid')
  }
  let value: unknown
  try {
    value = JSON.parse(row.content_json)
  } catch (error) {
    throw new SqlitePersistenceError(
      'invariant_violation',
      'persisted Room event content is not valid JSON',
      { cause: error }
    )
  }
  if (!isRecord(value) || canonicalJson(value) !== row.content_json) {
    invariant('persisted Room event content is not canonical')
  }
  if (canonicalSha256(value) !== row.content_hash) {
    invariant('persisted Room event content hash does not match')
  }
  const payload = value.payload
  if (!isSafePayload(payload)) invariant('persisted Room event payload is invalid')
  const sourceId = row.source_id === '' ? null : row.source_id
  const input: RoomEventInput = {
    eventId: row.event_id,
    roomId: row.room_id as RoomId,
    sessionId: row.session_id as SessionId,
    sequence: row.sequence,
    sourceType: row.source_type,
    sourceId,
    audienceEpoch: row.audience_epoch as Epoch,
    text: value.text === null || typeof value.text === 'string' ? value.text : null,
    payload,
    occurredAt: wallClockTimestampMs(row.occurred_at_ms)
  }
  if (
    row.room_id !== expectedRoomId ||
    row.session_id !== expectedSessionId ||
    (maximumAudienceEpoch !== undefined && row.audience_epoch > maximumAudienceEpoch)
  ) {
    invariant('persisted Room event scope is invalid')
  }
  let event: RoomEventRecord
  try {
    event = createRoomEventRecord(input)
  } catch (error) {
    if (error instanceof SqlitePersistenceError && error.code === 'invalid_record') {
      throw new SqlitePersistenceError(
        'invariant_violation',
        'persisted Room event content is invalid',
        { cause: error }
      )
    }
    throw error
  }
  if (
    value.schema_version !== 1 ||
    value.event_id !== row.event_id ||
    value.room_id !== row.room_id ||
    value.session_id !== row.session_id ||
    value.sequence !== row.sequence ||
    value.source_type !== row.source_type ||
    value.source_id !== sourceId ||
    value.audience_epoch !== row.audience_epoch ||
    value.occurred_at_ms !== row.occurred_at_ms ||
    event.contentJson !== row.content_json ||
    event.contentHash !== row.content_hash
  ) {
    invariant('persisted Room event envelope does not match its row')
  }
  return event
}

function validateRecord(
  event: RoomEventRecord,
  source: 'input' | 'persisted'
): void {
  const rebuilt = createRoomEventRecord(event)
  if (
    rebuilt.contentJson !== event.contentJson ||
    rebuilt.contentHash !== event.contentHash ||
    canonicalJson(rebuilt.evidenceEventIds) !== canonicalJson(event.evidenceEventIds)
  ) {
    fail(source, 'Room event canonical content does not match its fields')
  }
}

function validateInput(input: RoomEventInput): void {
  if (
    input.eventId.trim().length === 0 ||
    input.roomId.trim().length === 0 ||
    input.sessionId.trim().length === 0 ||
    !Number.isSafeInteger(input.sequence) ||
    input.sequence < 1 ||
    !roomEventSourceSchema.check(input.sourceType) ||
    (input.sourceId !== null && input.sourceId.trim().length === 0) ||
    !Number.isSafeInteger(input.audienceEpoch) ||
    input.audienceEpoch < 1 ||
    !Number.isSafeInteger(input.occurredAt) ||
    input.occurredAt < 0 ||
    (input.text !== null && input.text.length > MAX_TEXT_CHARS)
  ) {
    invalid('Room event identity, sequence, epoch, timestamp, or text is invalid')
  }
  validatePayload(input.sourceType, input.payload)
}

function validatePayload(source: RoomEventSource, payload: RoomEventPayload): void {
  rejectEmbeddedMedia(payload)
  const allowed = new Set<string>(PAYLOAD_KEYS[source])
  if (Object.keys(payload).some((key) => !allowed.has(key))) {
    invalid(`Room event ${source} payload contains an unsupported field`)
  }
  switch (source) {
    case 'user_text':
      optionalStrings(payload, ['input_id', 'target_viewer_id', 'target_persona_id'])
      break
    case 'user_voice':
      optionalStrings(payload, [
        'utterance_id',
        'turn_id',
        'target_resolver_id',
        'target_viewer_id',
        'target_persona_id'
      ])
      optionalNonNegativeIntegers(payload, ['started_at_ms', 'ended_at_ms', 'revision'])
      optionalBoolean(payload, 'final')
      optionalBoolean(payload, 'target_ambiguous')
      optionalEnum(payload, 'audio_source', ['microphone', 'system_audio'])
      break
    case 'audience_barrage':
      optionalStrings(payload, [
        'barrage_id',
        'observation_id',
        'request_id',
        'generation_request_id',
        'viewer_instance_id',
        'persona_id',
        'display_name',
        'reaction_type'
      ])
      optionalPositiveIntegers(payload, ['audience_epoch', 'viewer_sequence'])
      optionalNonNegativeIntegers(payload, ['expires_at_ms'])
      optionalEnum(payload, 'intent', [
        'react_to_host',
        'react_to_scene',
        'reply_to_viewer',
        'ask_question',
        'agree',
        'disagree',
        'encourage',
        'joke',
        'continue_thread',
        'room_meta',
        'silence'
      ])
      validateBarrageTarget(payload.target)
      validateEvidenceRefs(payload.evidence_refs)
      break
    case 'screen_observation':
      optionalStrings(payload, ['frame_id', 'frame_hash', 'summary'])
      optionalNonNegativeIntegers(payload, ['captured_at_ms'])
      optionalStringArray(payload, 'labels')
      break
    case 'system_event':
      optionalStrings(payload, [
        'event',
        'reason',
        'state',
        'mode_id',
        'utterance_id',
        'turn_id'
      ])
      optionalNonNegativeIntegers(payload, [
        'revision',
        'round',
        'started_at_ms',
        'ended_at_ms'
      ])
      optionalBoolean(payload, 'final')
      optionalEnum(payload, 'audio_source', ['system_audio'])
      optionalStringArray(payload, 'tags')
      break
  }
}

function validateContextQuery(query: RoomEventContextQuery): void {
  if (
    !Number.isSafeInteger(query.observedAt) ||
    query.observedAt < 0 ||
    !Number.isSafeInteger(query.publicWindowMs) ||
    query.publicWindowMs < 0 ||
    !Number.isSafeInteger(query.replyWindowMs) ||
    query.replyWindowMs < 0
  ) {
    invalid('Room event context windows must be nonnegative integers')
  }
  requireIntegerBetween(query.publicLimit, 1, MAX_PUBLIC_EVENTS, 'public context limit')
  requireIntegerBetween(query.replyLimit, 0, MAX_REPLY_EVENTS, 'reply context limit')
  if (
    query.triggerEventIds.length > MAX_TRIGGER_EVENTS ||
    query.triggerEventIds.some((eventId) => eventId.trim().length === 0)
  ) {
    invalid('Room event trigger set is invalid or too large')
  }
}

function requireSameEvent(existingRow: RoomEventRow, candidate: RoomEventRecord): void {
  const existing = eventFromRow(
    existingRow,
    existingRow.room_id as RoomId,
    existingRow.session_id as SessionId
  )
  if (
    existing.roomId !== candidate.roomId ||
    existing.sessionId !== candidate.sessionId ||
    existing.sequence !== candidate.sequence ||
    existing.sourceType !== candidate.sourceType ||
    existing.sourceId !== candidate.sourceId ||
    existing.audienceEpoch !== candidate.audienceEpoch ||
    existing.contentHash !== candidate.contentHash ||
    existing.occurredAt !== candidate.occurredAt
  ) {
    conflict('Room event ID was already used with different canonical content')
  }
}

function eventParameters(event: RoomEventRecord): SQLQueryBindings[] {
  return [
    event.eventId,
    event.roomId,
    event.sessionId,
    event.sequence,
    event.sourceType,
    event.sourceId ?? '',
    event.audienceEpoch,
    event.contentJson,
    event.contentHash,
    event.occurredAt
  ]
}

function evidenceEventIds(payload: RoomEventPayload): string[] {
  const ids: string[] = []
  const target = payload.target
  if (
    isRecord(target) &&
    target.kind === 'event' &&
    typeof target.event_id === 'string'
  ) {
    ids.push(target.event_id)
  }
  const refs = payload.evidence_refs
  if (Array.isArray(refs)) {
    for (const reference of refs) {
      if (
        isRecord(reference) &&
        reference.source === 'event' &&
        typeof reference.event_id === 'string'
      ) {
        ids.push(reference.event_id)
      }
    }
  }
  return [...new Set(ids)]
}

function validateBarrageTarget(value: SafeJsonValue | undefined): void {
  if (value === undefined || value === null) return
  if (!isRecord(value)) invalid('Room event barrage target is invalid')
  const allowed = new Set(['kind', 'viewer_instance_id', 'event_id'])
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    invalid('Room event barrage target contains an unsupported field')
  }
  if (
    value.kind !== 'host' &&
    value.kind !== 'scene' &&
    value.kind !== 'room' &&
    value.kind !== 'viewer' &&
    value.kind !== 'event'
  ) {
    invalid('Room event barrage target kind is invalid')
  }
  const viewerId = value.viewer_instance_id
  const eventId = value.event_id
  if (
    (value.kind === 'viewer') !== (typeof viewerId === 'string') ||
    (value.kind === 'event') !== (typeof eventId === 'string') ||
    (typeof viewerId === 'string' && viewerId.length === 0) ||
    (typeof eventId === 'string' && eventId.length === 0)
  ) {
    invalid('Room event barrage target identity is invalid')
  }
}

function validateEvidenceRefs(value: SafeJsonValue | undefined): void {
  if (value === undefined || value === null) return
  if (!Array.isArray(value)) invalid('Room event evidence references are invalid')
  for (const reference of value) {
    if (!isRecord(reference)) invalid('Room event evidence reference is invalid')
    const allowed = new Set(['source', 'event_id', 'frame_index'])
    if (Object.keys(reference).some((key) => !allowed.has(key))) {
      invalid('Room event evidence reference contains an unsupported field')
    }
    if (
      reference.source === 'event' &&
      typeof reference.event_id === 'string' &&
      reference.event_id.length > 0 &&
      (reference.frame_index === undefined || reference.frame_index === null)
    ) {
      continue
    }
    if (
      reference.source === 'frame' &&
      isNonNegativeInteger(reference.frame_index) &&
      (reference.event_id === undefined || reference.event_id === null)
    ) {
      continue
    }
    invalid('Room event evidence reference scope is invalid')
  }
}

function rejectEmbeddedMedia(value: SafeJsonValue | RoomEventPayload): void {
  if (Array.isArray(value)) {
    for (const item of value) rejectEmbeddedMedia(item)
    return
  }
  if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      const normalized = key.toLowerCase()
      if (normalized.includes('blob') || normalized.includes('pixel')) {
        invalid('raw media must not be persisted in Room events')
      }
      rejectEmbeddedMedia(item as SafeJsonValue)
    }
    return
  }
  if (typeof value === 'string' && value.trimStart().toLowerCase().startsWith('data:')) {
    invalid('raw media must not be persisted in Room events')
  }
}

function optionalStrings(payload: RoomEventPayload, keys: readonly string[]): void {
  for (const key of keys) {
    const value = payload[key]
    if (value !== undefined && value !== null && typeof value !== 'string') {
      invalid(`Room event payload ${key} must be a string`)
    }
  }
}

function optionalNonNegativeIntegers(
  payload: RoomEventPayload,
  keys: readonly string[]
): void {
  for (const key of keys) {
    const value = payload[key]
    if (value !== undefined && value !== null && !isNonNegativeInteger(value)) {
      invalid(`Room event payload ${key} must be a nonnegative integer`)
    }
  }
}

function optionalPositiveIntegers(
  payload: RoomEventPayload,
  keys: readonly string[]
): void {
  for (const key of keys) {
    const value = payload[key]
    if (
      value !== undefined &&
      value !== null &&
      (!Number.isSafeInteger(value) || Number(value) < 1)
    ) {
      invalid(`Room event payload ${key} must be a positive integer`)
    }
  }
}

function optionalBoolean(payload: RoomEventPayload, key: string): void {
  const value = payload[key]
  if (value !== undefined && value !== null && typeof value !== 'boolean') {
    invalid(`Room event payload ${key} must be a boolean`)
  }
}

function optionalEnum(
  payload: RoomEventPayload,
  key: string,
  values: readonly string[]
): void {
  const value = payload[key]
  if (
    value !== undefined &&
    value !== null &&
    (typeof value !== 'string' || !values.includes(value))
  ) {
    invalid(`Room event payload ${key} is invalid`)
  }
}

function optionalStringArray(payload: RoomEventPayload, key: string): void {
  const value = payload[key]
  if (
    value !== undefined &&
    value !== null &&
    (!Array.isArray(value) || !value.every((item) => typeof item === 'string'))
  ) {
    invalid(`Room event payload ${key} must be a string array`)
  }
}

function isSafePayload(value: unknown): value is RoomEventPayload {
  return isRecord(value) && Object.values(value).every(isSafeJsonValue)
}

function isSafeJsonValue(value: unknown): value is SafeJsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true
  }
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isSafeJsonValue)
  return isRecord(value) && Object.values(value).every(isSafeJsonValue)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function requireIntegerBetween(
  value: number,
  minimum: number,
  maximum: number,
  label: string
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    invalid(`${label} must be between ${minimum} and ${maximum}`)
  }
}

function fail(source: 'input' | 'persisted', message: string): never {
  if (source === 'input') invalid(message)
  invariant(message)
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
