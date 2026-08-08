import {
  canonicalJson,
  viewerInstanceSchema,
  viewerInstanceVariantSchema,
  viewerLifecycleStateSchema,
  viewerPrivateStateSchema,
  type Epoch,
  type Revision,
  type RoomId,
  type SessionId,
  type SessionOutcome,
  type ViewerId,
  type ViewerLifecycleState
} from '@advx/contracts'
import type { SQLQueryBindings } from 'bun:sqlite'

import type {
  PersistedSessionState,
  PersistedViewerState,
  TransactionContext,
  ViewerInstanceRecord,
  ViewerInstanceRepository,
  ViewerInstanceVariant,
  ViewerPoolRecord,
  ViewerPoolUpdate,
  ViewerPrivateState,
  ViewerRevisionFence
} from '../../../application/ports/repositories'
import {
  wallClockTimestampMs,
  type WallClockTimestampMs
} from '../../../application/ports/time'
import { SqlitePersistenceError } from './errors'
import { SqliteTransactionBoundary } from './transaction'

type ViewerRow = Readonly<{
  session_id: string
  viewer_instance_id: string
  persona_id: string
  persona_revision: number
  ordinal: number
  display_name: string
  micro_variant_json: string
  username: string
  avatar_seed: string
  color_seed: string
  locale: string
  persona_content_hash: string
  presence_state: string
  presence_revision: number
  moderation_revision: number
  behavior_revision: number
  joined_at_ms: number | null
  last_left_at_ms: number | null
  join_count: number
  muted_until_ms: number | null
  mute_reason: string | null
  kicked_at_ms: number | null
  kick_reason: string | null
  viewer_sequence: number
  behavior_state_json: string
  created_at_ms: number
  updated_at_ms: number
  created_epoch: number
  removed_epoch: number | null
  state: PersistedViewerState
  room_id: string | null
  audience_epoch: number | null
}>

type ViewerSessionRow = Readonly<{
  session_id: string
  room_id: string | null
  state: PersistedSessionState | null
  audience_epoch: number | null
  recovery_json: string | null
  session_seed: string
  next_creation_ordinal: number
  target_concurrent_viewers: number
  population_revision: number
  ended_at_ms: number | null
  outcome: SessionOutcome | null
}>

const VIEWER_COLUMNS = `
  viewers.session_id,
  viewers.viewer_instance_id,
  viewers.persona_id,
  viewers.persona_revision,
  viewers.ordinal,
  viewers.display_name,
  viewers.micro_variant_json,
  viewers.username,
  viewers.avatar_seed,
  viewers.color_seed,
  viewers.locale,
  viewers.persona_content_hash,
  viewers.presence_state,
  viewers.presence_revision,
  viewers.moderation_revision,
  viewers.behavior_revision,
  viewers.joined_at_ms,
  viewers.last_left_at_ms,
  viewers.join_count,
  viewers.muted_until_ms,
  viewers.mute_reason,
  viewers.kicked_at_ms,
  viewers.kick_reason,
  viewers.viewer_sequence,
  viewers.behavior_state_json,
  viewers.created_at_ms,
  viewers.updated_at_ms,
  viewers.created_epoch,
  viewers.removed_epoch,
  viewers.state,
  sessions.room_id,
  sessions.audience_epoch`

export class SqliteViewerInstanceRepository implements ViewerInstanceRepository {
  constructor(private readonly transactions: SqliteTransactionBoundary) {}

  async get(
    transaction: TransactionContext,
    sessionId: SessionId,
    viewerInstanceId: ViewerId
  ): Promise<ViewerInstanceRecord | null> {
    const row = this.transactions
      .connection(transaction)
      .query(
        `SELECT ${VIEWER_COLUMNS}
         FROM session_viewer_instances AS viewers
         INNER JOIN session_records AS sessions ON sessions.session_id = viewers.session_id
         WHERE viewers.session_id = ? AND viewers.viewer_instance_id = ?`
      )
      .get(sessionId, viewerInstanceId) as ViewerRow | null
    return row === null ? null : viewerFromRow(row)
  }

  async listActive(
    transaction: TransactionContext,
    sessionId: SessionId
  ): Promise<readonly ViewerInstanceRecord[]> {
    const rows = this.transactions
      .connection(transaction)
      .query(
        `SELECT ${VIEWER_COLUMNS}
         FROM session_viewer_instances AS viewers
         INNER JOIN session_records AS sessions ON sessions.session_id = viewers.session_id
         WHERE viewers.session_id = ? AND viewers.state = 'active'
         ORDER BY viewers.persona_id, viewers.ordinal, viewers.viewer_instance_id`
      )
      .all(sessionId) as ViewerRow[]
    return Object.freeze(rows.map(viewerFromRow))
  }

  async restoreEligiblePool(
    transaction: TransactionContext,
    sessionId: SessionId
  ): Promise<ViewerPoolRecord | null> {
    const database = this.transactions.connection(transaction)
    const session = database
      .query(
        `SELECT session_id, room_id, state, audience_epoch, recovery_json,
                session_seed, next_creation_ordinal, target_concurrent_viewers,
                population_revision, ended_at_ms, outcome
         FROM session_records WHERE session_id = ?`
      )
      .get(sessionId) as ViewerSessionRow | null
    if (session === null || !isEligibleForCrashRestore(session)) return null
    if (session.room_id === null || session.audience_epoch === null) {
      invariant('eligible viewer pool is missing Room or audience epoch')
    }

    const viewers = await this.listActive(transaction, sessionId)
    const maximum = database
      .query(
        `SELECT COALESCE(MAX(ordinal), 0) AS maximum_ordinal
         FROM session_viewer_instances WHERE session_id = ?`
      )
      .get(sessionId) as { maximum_ordinal: number }
    const nextCreationOrdinal = Math.max(
      session.next_creation_ordinal,
      maximum.maximum_ordinal + 1
    )
    if (!Number.isSafeInteger(nextCreationOrdinal) || nextCreationOrdinal < 1) {
      invariant('persisted next Viewer ordinal is invalid')
    }
    if (
      !Number.isSafeInteger(session.target_concurrent_viewers) ||
      session.target_concurrent_viewers < 1 ||
      session.target_concurrent_viewers > 32
    ) {
      invariant('persisted target Viewer count is invalid')
    }

    return Object.freeze({
      sessionId: session.session_id as SessionId,
      roomId: session.room_id as RoomId,
      audienceEpoch: asEpoch(session.audience_epoch, 'persisted audience epoch'),
      sessionSeed: session.session_seed || session.session_id,
      nextCreationOrdinal,
      targetConcurrentViewers: session.target_concurrent_viewers,
      populationRevision: asPositiveRevision(
        session.population_revision,
        'persisted population revision'
      ),
      viewers
    })
  }

  async addAll(
    transaction: TransactionContext,
    viewers: readonly ViewerInstanceRecord[]
  ): Promise<void> {
    if (viewers.length === 0) return
    const database = this.transactions.connection(transaction)
    const first = viewers[0]!
    const session = database
      .query('SELECT room_id FROM session_records WHERE session_id = ?')
      .get(first.sessionId) as { room_id: string | null } | null
    if (session === null) notFound('Viewer Session is missing')
    if (session.room_id !== first.roomId) invalid('Viewer Room does not match its Session')

    for (const viewer of viewers) {
      validateViewer(viewer, 'input')
      if (viewer.sessionId !== first.sessionId || viewer.roomId !== first.roomId) {
        invalid('all inserted Viewers must belong to the same Room and Session')
      }
      if (viewer.storageState !== 'active' || viewer.removedEpoch !== null) {
        invalid('a new Viewer must begin in active storage')
      }
      const result = database.run(
        `INSERT INTO session_viewer_instances (
           session_id, viewer_instance_id, persona_id, persona_revision, ordinal,
           display_name, micro_variant_json, username, avatar_seed, color_seed,
           locale, persona_content_hash, presence_state, presence_revision,
           moderation_revision, behavior_revision, joined_at_ms, last_left_at_ms,
           join_count, muted_until_ms, mute_reason, kicked_at_ms, kick_reason,
           viewer_sequence, behavior_state_json, created_at_ms, updated_at_ms,
           created_epoch, removed_epoch, state
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                   ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id, viewer_instance_id) DO NOTHING`,
        viewerParameters(viewer)
      )
      if (result.changes !== 1) conflict('Viewer instance ID already exists in Session')
    }
  }

  async save(
    transaction: TransactionContext,
    viewer: ViewerInstanceRecord,
    expected: ViewerRevisionFence
  ): Promise<void> {
    validateViewer(viewer, 'input')
    validateRevisionAdvance(viewer, expected)
    if (viewer.storageState !== 'active' || viewer.removedEpoch !== null) {
      invalid('removed Viewer state must use the remove operation')
    }
    const result = this.transactions
      .connection(transaction)
      .run(
        `UPDATE session_viewer_instances
         SET persona_id = ?, persona_revision = ?, display_name = ?,
             micro_variant_json = ?, username = ?, avatar_seed = ?, color_seed = ?,
             locale = ?, persona_content_hash = ?, presence_state = ?,
             presence_revision = ?, moderation_revision = ?, behavior_revision = ?,
             joined_at_ms = ?, last_left_at_ms = ?, join_count = ?, muted_until_ms = ?,
             mute_reason = ?, kicked_at_ms = ?, kick_reason = ?, viewer_sequence = ?,
             behavior_state_json = ?, updated_at_ms = ?
         WHERE session_id = ? AND viewer_instance_id = ? AND state = 'active'
           AND ordinal = ? AND created_epoch = ?
           AND presence_revision = ? AND moderation_revision = ?
           AND behavior_revision = ?`,
        [
          viewer.personaId,
          viewer.personaRevision,
          viewer.displayName,
          canonicalJson(viewer.variant),
          viewer.username,
          viewer.avatarSeed,
          viewer.colorSeed,
          viewer.locale,
          viewer.personaContentHash,
          viewer.lifecycleState,
          viewer.presenceRevision,
          viewer.moderationRevision,
          viewer.behaviorRevision,
          viewer.joinedAt,
          viewer.lastLeftAt,
          viewer.joinCount,
          viewer.mutedUntil,
          viewer.muteReason,
          viewer.kickedAt,
          viewer.kickReason,
          viewer.viewerSequence,
          canonicalJson(viewer.privateState),
          viewer.updatedAt,
          viewer.sessionId,
          viewer.viewerInstanceId,
          viewer.ordinal,
          viewer.createdEpoch,
          expected.presenceRevision,
          expected.moderationRevision,
          expected.behaviorRevision
        ]
      )
    if (result.changes !== 1) conflict('Viewer revision is stale or Viewer was removed')
  }

  async remove(
    transaction: TransactionContext,
    sessionId: SessionId,
    viewerInstanceId: ViewerId,
    removedEpoch: Epoch,
    updatedAt: WallClockTimestampMs
  ): Promise<void> {
    if (!Number.isSafeInteger(removedEpoch) || removedEpoch < 0) {
      invalid('removed audience epoch must be a nonnegative integer')
    }
    const result = this.transactions
      .connection(transaction)
      .run(
        `UPDATE session_viewer_instances
         SET state = 'removed', presence_state = 'removed', removed_epoch = ?,
             updated_at_ms = ?
         WHERE session_id = ? AND viewer_instance_id = ? AND state = 'active'`,
        [removedEpoch, updatedAt, sessionId, viewerInstanceId]
      )
    if (result.changes !== 1) conflict('Viewer instance is missing or already removed')
  }

  async advancePool(
    transaction: TransactionContext,
    update: ViewerPoolUpdate,
    expectedPopulationRevision: Revision
  ): Promise<void> {
    if (
      !Number.isSafeInteger(expectedPopulationRevision) ||
      expectedPopulationRevision < 1 ||
      update.populationRevision !== expectedPopulationRevision + 1
    ) {
      invalid('population revision must advance exactly once')
    }
    if (!Number.isSafeInteger(update.audienceEpoch) || update.audienceEpoch < 0) {
      invalid('audience epoch must be a nonnegative integer')
    }
    if (!Number.isSafeInteger(update.nextCreationOrdinal) || update.nextCreationOrdinal < 1) {
      invalid('next Viewer ordinal must be a positive integer')
    }
    if (
      !Number.isSafeInteger(update.targetConcurrentViewers) ||
      update.targetConcurrentViewers < 1 ||
      update.targetConcurrentViewers > 32
    ) {
      invalid('target Viewer count must be between 1 and 32')
    }
    if (update.sessionSeed.length === 0) invalid('Session seed must not be empty')

    const database = this.transactions.connection(transaction)
    const maximum = database
      .query(
        `SELECT COALESCE(MAX(ordinal), 0) AS maximum_ordinal
         FROM session_viewer_instances WHERE session_id = ?`
      )
      .get(update.sessionId) as { maximum_ordinal: number }
    if (update.nextCreationOrdinal <= maximum.maximum_ordinal) {
      invalid('next Viewer ordinal must exceed every previously allocated ordinal')
    }
    const result = database.run(
      `UPDATE session_records
       SET audience_epoch = ?, session_seed = ?, next_creation_ordinal = ?,
           target_concurrent_viewers = ?, population_revision = ?
       WHERE session_id = ? AND population_revision = ?`,
      [
        update.audienceEpoch,
        update.sessionSeed,
        update.nextCreationOrdinal,
        update.targetConcurrentViewers,
        update.populationRevision,
        update.sessionId,
        expectedPopulationRevision
      ]
    )
    if (result.changes !== 1) conflict('Viewer population revision is stale')
  }
}

function viewerFromRow(row: ViewerRow): ViewerInstanceRecord {
  if (row.room_id === null || row.audience_epoch === null) {
    invariant('persisted Viewer is missing Room or audience epoch')
  }
  if (!viewerLifecycleStateSchema.check(row.presence_state)) {
    invariant('persisted Viewer lifecycle state is invalid')
  }
  const variant = normalizeVariant(parseJson(row.micro_variant_json), 'persisted')
  const privateState = normalizePrivateState(
    parseJson(row.behavior_state_json),
    'persisted'
  )
  const viewer: ViewerInstanceRecord = Object.freeze({
    viewerInstanceId: row.viewer_instance_id as ViewerId,
    roomId: row.room_id as RoomId,
    sessionId: row.session_id as SessionId,
    audienceEpoch: asEpoch(row.audience_epoch, 'persisted audience epoch'),
    personaId: row.persona_id,
    personaRevision: asPositiveRevision(row.persona_revision, 'persisted Persona revision'),
    personaContentHash: row.persona_content_hash,
    ordinal: row.ordinal,
    username: row.username || row.display_name,
    displayName: row.display_name,
    avatarSeed: row.avatar_seed || row.viewer_instance_id,
    colorSeed: row.color_seed || row.viewer_instance_id,
    locale: row.locale,
    variant,
    privateState,
    viewerSequence: row.viewer_sequence,
    lifecycleState: row.presence_state,
    presenceRevision: asPositiveRevision(
      row.presence_revision,
      'persisted presence revision'
    ),
    moderationRevision: asPositiveRevision(
      row.moderation_revision,
      'persisted moderation revision'
    ),
    behaviorRevision: asPositiveRevision(
      row.behavior_revision,
      'persisted behavior revision'
    ),
    joinedAt: nullableTimestamp(row.joined_at_ms),
    lastLeftAt: nullableTimestamp(row.last_left_at_ms),
    joinCount: row.join_count,
    mutedUntil: nullableTimestamp(row.muted_until_ms),
    muteReason: row.mute_reason,
    kickedAt: nullableTimestamp(row.kicked_at_ms),
    kickReason: row.kick_reason,
    createdAt: wallClockTimestampMs(row.created_at_ms),
    updatedAt: wallClockTimestampMs(row.updated_at_ms),
    createdEpoch: asEpoch(row.created_epoch, 'persisted created epoch'),
    removedEpoch:
      row.removed_epoch === null
        ? null
        : asEpoch(row.removed_epoch, 'persisted removed epoch'),
    storageState: row.state
  })
  validateViewer(viewer, 'persisted')
  return viewer
}

function viewerParameters(viewer: ViewerInstanceRecord): SQLQueryBindings[] {
  return [
    viewer.sessionId,
    viewer.viewerInstanceId,
    viewer.personaId,
    viewer.personaRevision,
    viewer.ordinal,
    viewer.displayName,
    canonicalJson(viewer.variant),
    viewer.username,
    viewer.avatarSeed,
    viewer.colorSeed,
    viewer.locale,
    viewer.personaContentHash,
    viewer.lifecycleState,
    viewer.presenceRevision,
    viewer.moderationRevision,
    viewer.behaviorRevision,
    viewer.joinedAt,
    viewer.lastLeftAt,
    viewer.joinCount,
    viewer.mutedUntil,
    viewer.muteReason,
    viewer.kickedAt,
    viewer.kickReason,
    viewer.viewerSequence,
    canonicalJson(viewer.privateState),
    viewer.createdAt,
    viewer.updatedAt,
    viewer.createdEpoch,
    viewer.removedEpoch,
    viewer.storageState
  ]
}

function validateViewer(
  viewer: ViewerInstanceRecord,
  source: 'input' | 'persisted'
): void {
  const contract = viewerInstanceSchema.safeParse({
    viewer_instance_id: viewer.viewerInstanceId,
    room_id: viewer.roomId,
    session_id: viewer.sessionId,
    audience_epoch: viewer.audienceEpoch,
    persona_id: viewer.personaId,
    persona_revision: viewer.personaRevision,
    persona_content_hash: viewer.personaContentHash,
    ordinal: viewer.ordinal,
    username: viewer.username,
    display_name: viewer.displayName,
    avatar_seed: viewer.avatarSeed,
    color_seed: viewer.colorSeed,
    locale: viewer.locale,
    variant: viewer.variant,
    private_state: viewer.privateState,
    viewer_sequence: viewer.viewerSequence,
    lifecycle_state: viewer.lifecycleState,
    presence_revision: viewer.presenceRevision,
    moderation_revision: viewer.moderationRevision,
    behavior_revision: viewer.behaviorRevision,
    joined_at_ms: viewer.joinedAt,
    last_left_at_ms: viewer.lastLeftAt,
    join_count: viewer.joinCount,
    muted_until_ms: viewer.mutedUntil,
    mute_reason: viewer.muteReason,
    kicked_at_ms: viewer.kickedAt,
    kick_reason: viewer.kickReason,
    created_at_ms: viewer.createdAt,
    removed_at_ms:
      viewer.lifecycleState === 'kicked' ? viewer.kickedAt : null
  })
  if (!contract.success) fail(source, 'Viewer record violates the runtime contract')
  if (viewer.updatedAt < viewer.createdAt) fail(source, 'Viewer update precedes creation')
  if (viewer.createdEpoch > viewer.audienceEpoch) {
    fail(source, 'Viewer creation epoch exceeds its current audience epoch')
  }
  if (
    viewer.removedEpoch !== null &&
    viewer.removedEpoch < viewer.createdEpoch
  ) {
    fail(source, 'Viewer removal epoch precedes creation')
  }
  if (viewer.storageState === 'removed') {
    if (viewer.lifecycleState !== 'removed' || viewer.removedEpoch === null) {
      fail(source, 'removed Viewer storage must retain removed lifecycle and epoch')
    }
  } else if (viewer.lifecycleState === 'removed' || viewer.removedEpoch !== null) {
    fail(source, 'active Viewer storage cannot carry removed lifecycle state')
  }
  if (viewer.lifecycleState === 'active' && viewer.joinedAt === null) {
    fail(source, 'active Viewer must retain its join timestamp')
  }
  if (viewer.joinedAt !== null && viewer.joinCount < 1) {
    fail(source, 'joined Viewer must retain a positive join count')
  }
  if (viewer.joinedAt !== null && viewer.joinedAt < viewer.createdAt) {
    fail(source, 'Viewer join precedes creation')
  }
  if (viewer.lastLeftAt !== null && viewer.lastLeftAt < viewer.createdAt) {
    fail(source, 'Viewer leave precedes creation')
  }
  if (viewer.kickedAt !== null && viewer.kickedAt < viewer.createdAt) {
    fail(source, 'Viewer kick precedes creation')
  }
  if (viewer.lifecycleState === 'kicked' && viewer.kickedAt === null) {
    fail(source, 'kicked Viewer must retain its kick timestamp')
  }
  if (viewer.muteReason !== null && viewer.mutedUntil === null) {
    fail(source, 'Viewer mute reason requires a mute deadline')
  }
}

function validateRevisionAdvance(
  viewer: ViewerInstanceRecord,
  expected: ViewerRevisionFence
): void {
  const revisions = [
    [viewer.presenceRevision, expected.presenceRevision],
    [viewer.moderationRevision, expected.moderationRevision],
    [viewer.behaviorRevision, expected.behaviorRevision]
  ] as const
  if (
    revisions.some(
      ([next, previous]) =>
        !Number.isSafeInteger(previous) ||
        previous < 1 ||
        (next !== previous && next !== previous + 1)
    ) ||
    revisions.every(([next, previous]) => next === previous)
  ) {
    invalid('exactly one or more Viewer revisions must advance by one')
  }
}

function normalizeVariant(
  value: unknown,
  source: 'input' | 'persisted'
): ViewerInstanceVariant {
  const result = viewerInstanceVariantSchema.safeParse(value)
  if (!result.success) fail(source, 'Viewer microvariant JSON is invalid')
  return Object.freeze({
    activity_baseline: result.data.activity_baseline ?? 0.5,
    attention_span: result.data.attention_span ?? 0.5,
    social_initiative: result.data.social_initiative ?? 0.5,
    reply_affinity: result.data.reply_affinity ?? 0.5,
    expression_length: result.data.expression_length,
    skepticism: result.data.skepticism,
    encouragement: result.data.encouragement,
    meme_affinity: result.data.meme_affinity,
    focus: result.data.focus,
    silence_tendency: result.data.silence_tendency,
    stay_duration_tendency: result.data.stay_duration_tendency ?? 0.5,
    rejoin_tendency: result.data.rejoin_tendency ?? 0.5
  })
}

function normalizePrivateState(
  value: unknown,
  source: 'input' | 'persisted'
): ViewerPrivateState {
  const result = viewerPrivateStateSchema.safeParse(value)
  if (!result.success) fail(source, 'Viewer private state JSON is invalid')
  return Object.freeze({
    revision: result.data.revision ?? 1,
    published_event_ids: result.data.published_event_ids ?? [],
    direct_interaction_event_ids: result.data.direct_interaction_event_ids ?? [],
    attention: result.data.attention ?? [],
    mood: result.data.mood ?? {},
    cooldown_until_ms: result.data.cooldown_until_ms ?? null,
    attention_strength: result.data.attention_strength ?? 0.5,
    arousal: result.data.arousal ?? 0,
    fatigue: result.data.fatigue ?? 0,
    engagement: result.data.engagement ?? 0.5,
    last_spoke_at_ms: result.data.last_spoke_at_ms ?? null,
    last_reacted_at_ms: result.data.last_reacted_at_ms ?? null,
    current_thread_id: result.data.current_thread_id ?? null,
    current_target_viewer_id: result.data.current_target_viewer_id ?? null,
    host_affinity: result.data.host_affinity ?? 0,
    peer_affinities: result.data.peer_affinities ?? {},
    silence_streak: result.data.silence_streak ?? 0,
    speech_streak: result.data.speech_streak ?? 0
  })
}

function isEligibleForCrashRestore(session: ViewerSessionRow): boolean {
  if (session.outcome !== 'interrupted' || session.ended_at_ms === null) return false
  if (session.recovery_json === null) return false
  const recovery = parseJson(session.recovery_json)
  return isRecord(recovery) && recovery.recovery_eligible === true
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch (error) {
    throw new SqlitePersistenceError(
      'invariant_violation',
      'persisted Viewer JSON is invalid',
      { cause: error }
    )
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asPositiveRevision(value: number, label: string): Revision {
  if (!Number.isSafeInteger(value) || value < 1) invariant(`${label} is invalid`)
  return value as Revision
}

function asEpoch(value: number, label: string): Epoch {
  if (!Number.isSafeInteger(value) || value < 0) invariant(`${label} is invalid`)
  return value as Epoch
}

function nullableTimestamp(value: number | null): WallClockTimestampMs | null {
  return value === null ? null : wallClockTimestampMs(value)
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
