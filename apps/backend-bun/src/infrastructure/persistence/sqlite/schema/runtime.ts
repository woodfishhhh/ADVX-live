import { sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core'

export const rooms = sqliteTable(
  'rooms',
  {
    roomId: text('room_id').primaryKey(),
    displayName: text('display_name').notNull(),
    state: text('state', { enum: ['active', 'cleared'] }).notNull(),
    revision: integer('revision').notNull().default(0),
    createdAtMs: integer('created_at_ms').notNull(),
    updatedAtMs: integer('updated_at_ms').notNull()
  },
  (table) => [
    check('ck_rooms_state_allowed', sql`${table.state} IN ('active', 'cleared')`),
    check('ck_rooms_revision_nonnegative', sql`${table.revision} >= 0`),
    check('ck_rooms_created_at_nonnegative', sql`${table.createdAtMs} >= 0`),
    check(
      'ck_rooms_updated_after_created',
      sql`${table.updatedAtMs} >= ${table.createdAtMs}`
    )
  ]
)

export const sessionRecords = sqliteTable(
  'session_records',
  {
    sessionId: text('session_id').primaryKey(),
    roomId: text('room_id').references(() => rooms.roomId, { onDelete: 'cascade' }),
    state: text('state', {
      enum: ['starting', 'running', 'paused', 'stopping', 'stopped', 'failed']
    }),
    audienceEpoch: integer('audience_epoch'),
    activeConfigHash: text('active_config_hash'),
    recoveryJson: text('recovery_json'),
    sessionSeed: text('session_seed').notNull().default(''),
    nextCreationOrdinal: integer('next_creation_ordinal').notNull().default(1),
    targetConcurrentViewers: integer('target_concurrent_viewers').notNull().default(1),
    populationRevision: integer('population_revision').notNull().default(1),
    controllerStateJson: text('controller_state_json').notNull().default('{}'),
    clientRequestId: text('client_request_id'),
    clientRequestHash: text('client_request_hash'),
    startedAtMs: integer('started_at_ms').notNull(),
    endedAtMs: integer('ended_at_ms'),
    outcome: text('outcome', { enum: ['completed', 'error', 'interrupted'] }),
    appVersion: text('app_version').notNull()
  },
  (table) => [
    check('ck_session_records_started_at_nonnegative', sql`${table.startedAtMs} >= 0`),
    check(
      'ck_session_records_ended_after_started',
      sql`${table.endedAtMs} IS NULL OR ${table.endedAtMs} >= ${table.startedAtMs}`
    ),
    check(
      'ck_session_records_outcome_allowed',
      sql`${table.outcome} IS NULL OR ${table.outcome} IN ('completed', 'error', 'interrupted')`
    ),
    check(
      'ck_session_records_completion_consistent',
      sql`(${table.endedAtMs} IS NULL AND ${table.outcome} IS NULL) OR (${table.endedAtMs} IS NOT NULL AND ${table.outcome} IS NOT NULL)`
    ),
    check(
      'ck_session_records_audience_epoch_nonnegative',
      sql`${table.audienceEpoch} IS NULL OR ${table.audienceEpoch} >= 0`
    ),
    check(
      'ck_session_records_state_allowed',
      sql`${table.state} IS NULL OR ${table.state} IN ('starting', 'running', 'paused', 'stopping', 'stopped', 'failed')`
    ),
    index('ix_session_records_ended_at_ms').on(table.endedAtMs),
    index('ix_session_records_room_state_ended_at_ms').on(
      table.roomId,
      table.state,
      table.endedAtMs
    ),
    uniqueIndex('uq_session_records_client_request_id').on(table.clientRequestId)
  ]
)

export const sessionRuntimeRevisions = sqliteTable(
  'session_runtime_revisions',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => sessionRecords.sessionId, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    applyId: text('apply_id').notNull(),
    baseRevision: integer('base_revision').notNull(),
    configHash: text('config_hash').notNull(),
    status: text('status', {
      enum: ['pending', 'committed', 'rejected', 'rolled_back']
    }).notNull(),
    canonicalSpecJson: text('canonical_spec_json').notNull(),
    diffSummaryJson: text('diff_summary_json').notNull(),
    createdAtMs: integer('created_at_ms').notNull(),
    updatedAtMs: integer('updated_at_ms').notNull()
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.revision] }),
    check('ck_session_runtime_revisions_revision_positive', sql`${table.revision} >= 1`),
    check(
      'ck_session_runtime_revisions_base_revision_nonnegative',
      sql`${table.baseRevision} >= 0`
    ),
    check(
      'ck_session_runtime_revisions_status_allowed',
      sql`${table.status} IN ('pending', 'committed', 'rejected', 'rolled_back')`
    ),
    check(
      'ck_session_runtime_revisions_created_at_nonnegative',
      sql`${table.createdAtMs} >= 0`
    ),
    check(
      'ck_session_runtime_revisions_updated_after_created',
      sql`${table.updatedAtMs} >= ${table.createdAtMs}`
    ),
    uniqueIndex('uq_runtime_revision_session_apply').on(table.sessionId, table.applyId),
    index('ix_runtime_revision_session_config_hash').on(table.sessionId, table.configHash)
  ]
)

export const sessionViewerInstances = sqliteTable(
  'session_viewer_instances',
  {
    sessionId: text('session_id')
      .notNull()
      .references(() => sessionRecords.sessionId, { onDelete: 'cascade' }),
    viewerInstanceId: text('viewer_instance_id').notNull(),
    personaId: text('persona_id').notNull(),
    personaRevision: integer('persona_revision').notNull(),
    ordinal: integer('ordinal').notNull(),
    displayName: text('display_name').notNull(),
    microVariantJson: text('micro_variant_json').notNull(),
    username: text('username').notNull().default(''),
    avatarSeed: text('avatar_seed').notNull().default(''),
    colorSeed: text('color_seed').notNull().default(''),
    locale: text('locale').notNull().default('zh-CN'),
    personaContentHash: text('persona_content_hash')
      .notNull()
      .default('0'.repeat(64)),
    presenceState: text('presence_state', {
      enum: ['not_joined', 'active', 'left', 'kicked', 'ended', 'removed']
    }).notNull().default('active'),
    presenceRevision: integer('presence_revision').notNull().default(1),
    moderationRevision: integer('moderation_revision').notNull().default(1),
    behaviorRevision: integer('behavior_revision').notNull().default(1),
    joinedAtMs: integer('joined_at_ms'),
    lastLeftAtMs: integer('last_left_at_ms'),
    joinCount: integer('join_count').notNull().default(0),
    mutedUntilMs: integer('muted_until_ms'),
    muteReason: text('mute_reason'),
    kickedAtMs: integer('kicked_at_ms'),
    kickReason: text('kick_reason'),
    viewerSequence: integer('viewer_sequence').notNull().default(0),
    behaviorStateJson: text('behavior_state_json').notNull().default('{}'),
    createdAtMs: integer('created_at_ms').notNull().default(0),
    updatedAtMs: integer('updated_at_ms').notNull().default(0),
    createdEpoch: integer('created_epoch').notNull(),
    removedEpoch: integer('removed_epoch'),
    state: text('state', { enum: ['active', 'removed'] }).notNull()
  },
  (table) => [
    primaryKey({ columns: [table.sessionId, table.viewerInstanceId] }),
    check(
      'ck_session_viewer_instances_persona_revision_positive',
      sql`${table.personaRevision} >= 1`
    ),
    check(
      'ck_session_viewer_instances_ordinal_nonnegative',
      sql`${table.ordinal} >= 0`
    ),
    check(
      'ck_session_viewer_instances_created_epoch_nonnegative',
      sql`${table.createdEpoch} >= 0`
    ),
    check(
      'ck_session_viewer_instances_removed_after_created',
      sql`${table.removedEpoch} IS NULL OR ${table.removedEpoch} >= ${table.createdEpoch}`
    ),
    check(
      'ck_session_viewer_instances_state_allowed',
      sql`${table.state} IN ('active', 'removed')`
    ),
    index('ix_session_viewer_instances_session_state_viewer').on(
      table.sessionId,
      table.state,
      table.viewerInstanceId
    ),
    index('ix_session_viewer_instances_session_persona_ordinal').on(
      table.sessionId,
      table.personaId,
      table.ordinal
    )
  ]
)

export const roomEvents = sqliteTable(
  'room_events',
  {
    eventId: text('event_id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.roomId, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessionRecords.sessionId, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    sourceType: text('source_type', {
      enum: [
        'user_text',
        'user_voice',
        'audience_barrage',
        'screen_observation',
        'system_event'
      ]
    }).notNull(),
    sourceId: text('source_id').notNull(),
    audienceEpoch: integer('audience_epoch').notNull(),
    contentJson: text('content_json').notNull(),
    contentHash: text('content_hash').notNull(),
    occurredAtMs: integer('occurred_at_ms').notNull()
  },
  (table) => [
    check('ck_room_events_sequence_nonnegative', sql`${table.sequence} >= 0`),
    check(
      'ck_room_events_audience_epoch_nonnegative',
      sql`${table.audienceEpoch} >= 0`
    ),
    check(
      'ck_room_events_occurred_at_nonnegative',
      sql`${table.occurredAtMs} >= 0`
    ),
    uniqueIndex('uq_room_events_room_session_sequence').on(
      table.roomId,
      table.sessionId,
      table.sequence
    ),
    index('ix_room_events_room_occurred_at_ms').on(
      table.roomId,
      table.occurredAtMs
    )
  ]
)

export const roomLongTermMemories = sqliteTable(
  'room_long_term_memories',
  {
    memoryId: text('memory_id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.roomId, { onDelete: 'cascade' }),
    memoryType: text('memory_type', {
      enum: [
        'user_preference',
        'real_world_fact',
        'room_lore',
        'shared_experience'
      ]
    }).notNull(),
    content: text('content').notNull(),
    tagsJson: text('tags_json').notNull(),
    importance: real('importance').notNull(),
    confidence: real('confidence').notNull(),
    origin: text('origin').notNull(),
    state: text('state', { enum: ['active', 'superseded', 'revoked'] }).notNull(),
    supersededBy: text('superseded_by').references(
      (): AnySQLiteColumn => roomLongTermMemories.memoryId,
      { onDelete: 'set null' }
    ),
    lastRecalledAtMs: integer('last_recalled_at_ms'),
    expiresAtMs: integer('expires_at_ms'),
    revision: integer('revision').notNull(),
    createdAtMs: integer('created_at_ms').notNull(),
    updatedAtMs: integer('updated_at_ms').notNull()
  },
  (table) => [
    check(
      'ck_room_long_term_memories_importance_range',
      sql`${table.importance} >= 0.0 AND ${table.importance} <= 1.0`
    ),
    check(
      'ck_room_long_term_memories_confidence_range',
      sql`${table.confidence} >= 0.0 AND ${table.confidence} <= 1.0`
    ),
    check(
      'ck_room_long_term_memories_state_allowed',
      sql`${table.state} IN ('active', 'superseded', 'revoked')`
    ),
    check(
      'ck_room_long_term_memories_revision_positive',
      sql`${table.revision} >= 1`
    ),
    check(
      'ck_room_long_term_memories_not_self_superseded',
      sql`${table.supersededBy} IS NULL OR ${table.supersededBy} != ${table.memoryId}`
    ),
    check(
      'ck_room_long_term_memories_created_at_nonnegative',
      sql`${table.createdAtMs} >= 0`
    ),
    check(
      'ck_room_long_term_memories_updated_after_created',
      sql`${table.updatedAtMs} >= ${table.createdAtMs}`
    ),
    index('ix_room_long_term_memories_room_state_updated').on(
      table.roomId,
      table.state,
      table.updatedAtMs
    ),
    index('ix_room_long_term_memories_retrieval').on(
      table.roomId,
      table.state,
      table.importance,
      table.lastRecalledAtMs
    )
  ]
)

export const roomMemoryHeads = sqliteTable(
  'room_memory_heads',
  {
    roomId: text('room_id')
      .primaryKey()
      .references(() => rooms.roomId, { onDelete: 'cascade' }),
    revision: integer('revision').notNull(),
    updatedAtMs: integer('updated_at_ms').notNull()
  },
  (table) => [
    check('ck_room_memory_heads_revision_nonnegative', sql`${table.revision} >= 0`),
    check(
      'ck_room_memory_heads_updated_at_nonnegative',
      sql`${table.updatedAtMs} >= 0`
    )
  ]
)

export const roomMemoryEvidence = sqliteTable(
  'room_memory_evidence',
  {
    memoryId: text('memory_id')
      .notNull()
      .references(() => roomLongTermMemories.memoryId, { onDelete: 'cascade' }),
    eventId: text('event_id').notNull(),
    sourceType: text('source_type').notNull(),
    occurredAtMs: integer('occurred_at_ms').notNull(),
    evidenceSummary: text('evidence_summary').notNull()
  },
  (table) => [
    primaryKey({ columns: [table.memoryId, table.eventId] }),
    check(
      'ck_room_memory_evidence_occurred_at_nonnegative',
      sql`${table.occurredAtMs} >= 0`
    ),
    index('ix_room_memory_evidence_event_memory').on(table.eventId, table.memoryId)
  ]
)

export const roomMemoryCandidates = sqliteTable(
  'room_memory_candidates',
  {
    candidateId: text('candidate_id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.roomId, { onDelete: 'cascade' }),
    idempotencyKey: text('idempotency_key').notNull(),
    baseRevision: integer('base_revision').notNull(),
    candidateType: text('candidate_type', {
      enum: [
        'user_preference',
        'real_world_fact',
        'room_lore',
        'shared_experience'
      ]
    }).notNull(),
    content: text('content').notNull(),
    tagsJson: text('tags_json').notNull(),
    evidenceEventIdsJson: text('evidence_event_ids_json').notNull(),
    outcome: text('outcome', {
      enum: ['pending', 'created', 'merged', 'replaced', 'rejected', 'stale']
    }).notNull(),
    resultMemoryId: text('result_memory_id').references(
      () => roomLongTermMemories.memoryId,
      { onDelete: 'set null' }
    ),
    decisionJson: text('decision_json').notNull(),
    createdAtMs: integer('created_at_ms').notNull(),
    updatedAtMs: integer('updated_at_ms').notNull()
  },
  (table) => [
    uniqueIndex('uq_room_memory_candidates_room_idempotency').on(
      table.roomId,
      table.idempotencyKey
    ),
    check(
      'ck_room_memory_candidates_base_revision_nonnegative',
      sql`${table.baseRevision} >= 0`
    ),
    check(
      'ck_room_memory_candidates_outcome_allowed',
      sql`${table.outcome} IN ('pending', 'created', 'merged', 'replaced', 'rejected', 'stale')`
    ),
    check(
      'ck_room_memory_candidates_created_at_nonnegative',
      sql`${table.createdAtMs} >= 0`
    ),
    check(
      'ck_room_memory_candidates_updated_after_created',
      sql`${table.updatedAtMs} >= ${table.createdAtMs}`
    )
  ]
)

export const modeMemes = sqliteTable(
  'mode_memes',
  {
    memeId: text('meme_id').primaryKey(),
    modeNamespace: text('mode_namespace').notNull(),
    content: text('content').notNull(),
    intensity: real('intensity').notNull(),
    state: text('state', {
      enum: ['active', 'disabled', 'archived', 'revoked']
    }).notNull(),
    sourceJson: text('source_json').notNull(),
    revision: integer('revision').notNull(),
    createdAtMs: integer('created_at_ms').notNull(),
    updatedAtMs: integer('updated_at_ms').notNull()
  },
  (table) => [
    check(
      'ck_mode_memes_intensity_range',
      sql`${table.intensity} >= 0.0 AND ${table.intensity} <= 1.0`
    ),
    check(
      'ck_mode_memes_state_allowed',
      sql`${table.state} IN ('active', 'disabled', 'archived', 'revoked')`
    ),
    check('ck_mode_memes_revision_positive', sql`${table.revision} >= 1`),
    check(
      'ck_mode_memes_created_at_nonnegative',
      sql`${table.createdAtMs} >= 0`
    ),
    check(
      'ck_mode_memes_updated_after_created',
      sql`${table.updatedAtMs} >= ${table.createdAtMs}`
    ),
    index('ix_mode_memes_namespace_state_updated').on(
      table.modeNamespace,
      table.state,
      table.updatedAtMs
    )
  ]
)

export const modeMemeEvents = sqliteTable(
  'mode_meme_events',
  {
    eventId: text('event_id').primaryKey(),
    memeId: text('meme_id')
      .notNull()
      .references(() => modeMemes.memeId, { onDelete: 'cascade' }),
    action: text('action', {
      enum: ['created', 'edited', 'revoked', 'restored', 'disabled', 'archived']
    }).notNull(),
    payloadJson: text('payload_json').notNull(),
    previousRevision: integer('previous_revision').notNull(),
    newRevision: integer('new_revision').notNull(),
    createdAtMs: integer('created_at_ms').notNull()
  },
  (table) => [
    check(
      'ck_mode_meme_events_action_allowed',
      sql`${table.action} IN ('created', 'edited', 'revoked', 'restored', 'disabled', 'archived')`
    ),
    check(
      'ck_mode_meme_events_previous_revision_nonnegative',
      sql`${table.previousRevision} >= 0`
    ),
    check(
      'ck_mode_meme_events_new_revision_positive',
      sql`${table.newRevision} >= 1`
    ),
    check(
      'ck_mode_meme_events_created_at_nonnegative',
      sql`${table.createdAtMs} >= 0`
    )
  ]
)

export const modeMemeCandidates = sqliteTable(
  'mode_meme_candidates',
  {
    candidateId: text('candidate_id').primaryKey(),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.roomId, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => sessionRecords.sessionId, { onDelete: 'cascade' }),
    audienceEpoch: integer('audience_epoch').notNull(),
    observationId: text('observation_id').notNull(),
    modeNamespace: text('mode_namespace').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    text: text('text').notNull(),
    evidenceEventIdsJson: text('evidence_event_ids_json').notNull(),
    evidenceFrameIndexesJson: text('evidence_frame_indexes_json').notNull(),
    outcome: text('outcome', {
      enum: ['pending', 'accepted', 'rejected']
    }).notNull(),
    resultMemeId: text('result_meme_id').references(() => modeMemes.memeId, {
      onDelete: 'set null'
    }),
    createdAtMs: integer('created_at_ms').notNull(),
    updatedAtMs: integer('updated_at_ms').notNull()
  },
  (table) => [
    uniqueIndex('uq_mode_meme_candidates_namespace_idempotency').on(
      table.modeNamespace,
      table.idempotencyKey
    ),
    check(
      'ck_mode_meme_candidates_audience_epoch_positive',
      sql`${table.audienceEpoch} >= 1`
    ),
    check(
      'ck_mode_meme_candidates_outcome_allowed',
      sql`${table.outcome} IN ('pending', 'accepted', 'rejected')`
    ),
    check(
      'ck_mode_meme_candidates_created_at_nonnegative',
      sql`${table.createdAtMs} >= 0`
    ),
    check(
      'ck_mode_meme_candidates_updated_after_created',
      sql`${table.updatedAtMs} >= ${table.createdAtMs}`
    ),
    index('ix_mode_meme_candidates_namespace_outcome_created').on(
      table.modeNamespace,
      table.outcome,
      table.createdAtMs
    )
  ]
)

export const modeMemeSettings = sqliteTable(
  'mode_meme_settings',
  {
    modeNamespace: text('mode_namespace').primaryKey(),
    autoIngestEnabled: integer('auto_ingest_enabled', { mode: 'boolean' }).notNull(),
    revision: integer('revision').notNull(),
    createdAtMs: integer('created_at_ms').notNull(),
    updatedAtMs: integer('updated_at_ms').notNull()
  },
  (table) => [
    check(
      'ck_mode_meme_settings_revision_positive',
      sql`${table.revision} >= 1`
    ),
    check(
      'ck_mode_meme_settings_created_at_nonnegative',
      sql`${table.createdAtMs} >= 0`
    ),
    check(
      'ck_mode_meme_settings_updated_after_created',
      sql`${table.updatedAtMs} >= ${table.createdAtMs}`
    )
  ]
)

export const durableOutbox = sqliteTable(
  'durable_outbox',
  {
    workId: text('work_id').primaryKey(),
    idempotencyKey: text('idempotency_key').notNull(),
    kind: text('kind', {
      enum: [
        'domain_event',
        'memory_side_effect',
        'meme_side_effect',
        'migration_marker',
        'recovery_marker'
      ]
    }).notNull(),
    topic: text('topic').notNull(),
    fenceKind: text('fence_kind', {
      enum: ['none', 'room', 'session_epoch', 'viewer_sequence']
    }).notNull(),
    roomId: text('room_id'),
    sessionId: text('session_id'),
    audienceEpoch: integer('audience_epoch'),
    observationId: text('observation_id'),
    viewerInstanceId: text('viewer_instance_id'),
    viewerSequence: integer('viewer_sequence'),
    payloadJson: text('payload_json').notNull(),
    status: text('status', {
      enum: ['pending', 'leased', 'completed', 'cancelled', 'dead_letter']
    }).notNull(),
    attemptCount: integer('attempt_count').notNull(),
    availableAtMs: integer('available_at_ms').notNull(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAtMs: integer('lease_expires_at_ms'),
    lastErrorCode: text('last_error_code'),
    createdAtMs: integer('created_at_ms').notNull(),
    updatedAtMs: integer('updated_at_ms').notNull(),
    settledAtMs: integer('settled_at_ms')
  },
  (table) => [
    uniqueIndex('uq_durable_outbox_idempotency').on(table.idempotencyKey),
    check(
      'ck_durable_outbox_kind_allowed',
      sql`${table.kind} IN ('domain_event', 'memory_side_effect', 'meme_side_effect', 'migration_marker', 'recovery_marker')`
    ),
    check(
      'ck_durable_outbox_status_allowed',
      sql`${table.status} IN ('pending', 'leased', 'completed', 'cancelled', 'dead_letter')`
    ),
    check(
      'ck_durable_outbox_fence_kind_allowed',
      sql`${table.fenceKind} IN ('none', 'room', 'session_epoch', 'viewer_sequence')`
    ),
    check(
      'ck_durable_outbox_attempt_count_nonnegative',
      sql`${table.attemptCount} >= 0`
    ),
    check(
      'ck_durable_outbox_audience_epoch_positive',
      sql`${table.audienceEpoch} IS NULL OR ${table.audienceEpoch} >= 1`
    ),
    check(
      'ck_durable_outbox_viewer_sequence_nonnegative',
      sql`${table.viewerSequence} IS NULL OR ${table.viewerSequence} >= 0`
    ),
    check(
      'ck_durable_outbox_available_at_nonnegative',
      sql`${table.availableAtMs} >= 0`
    ),
    check(
      'ck_durable_outbox_lease_expires_nonnegative',
      sql`${table.leaseExpiresAtMs} IS NULL OR ${table.leaseExpiresAtMs} >= 0`
    ),
    check(
      'ck_durable_outbox_created_at_nonnegative',
      sql`${table.createdAtMs} >= 0`
    ),
    check(
      'ck_durable_outbox_updated_after_created',
      sql`${table.updatedAtMs} >= ${table.createdAtMs}`
    ),
    check(
      'ck_durable_outbox_available_after_created',
      sql`${table.availableAtMs} >= ${table.createdAtMs}`
    ),
    check(
      'ck_durable_outbox_settled_after_created',
      sql`${table.settledAtMs} IS NULL OR ${table.settledAtMs} >= ${table.createdAtMs}`
    ),
    check(
      'ck_durable_outbox_lease_state_consistent',
      sql`(
        ${table.status} = 'leased'
        AND ${table.leaseOwner} IS NOT NULL
        AND ${table.leaseExpiresAtMs} IS NOT NULL
        AND ${table.settledAtMs} IS NULL
      ) OR (
        ${table.status} <> 'leased'
        AND ${table.leaseOwner} IS NULL
        AND ${table.leaseExpiresAtMs} IS NULL
      )`
    ),
    check(
      'ck_durable_outbox_settlement_consistent',
      sql`(
        ${table.status} IN ('completed', 'cancelled', 'dead_letter')
        AND ${table.settledAtMs} IS NOT NULL
      ) OR (
        ${table.status} IN ('pending', 'leased')
        AND ${table.settledAtMs} IS NULL
      )`
    ),
    check(
      'ck_durable_outbox_fence_consistent',
      sql`(
        ${table.fenceKind} = 'none'
        AND ${table.roomId} IS NULL
        AND ${table.sessionId} IS NULL
        AND ${table.audienceEpoch} IS NULL
        AND ${table.observationId} IS NULL
        AND ${table.viewerInstanceId} IS NULL
        AND ${table.viewerSequence} IS NULL
      ) OR (
        ${table.fenceKind} = 'room'
        AND ${table.roomId} IS NOT NULL
        AND ${table.sessionId} IS NULL
        AND ${table.audienceEpoch} IS NULL
        AND ${table.observationId} IS NULL
        AND ${table.viewerInstanceId} IS NULL
        AND ${table.viewerSequence} IS NULL
      ) OR (
        ${table.fenceKind} = 'session_epoch'
        AND ${table.roomId} IS NOT NULL
        AND ${table.sessionId} IS NOT NULL
        AND ${table.audienceEpoch} IS NOT NULL
        AND ${table.viewerInstanceId} IS NULL
        AND ${table.viewerSequence} IS NULL
      ) OR (
        ${table.fenceKind} = 'viewer_sequence'
        AND ${table.roomId} IS NOT NULL
        AND ${table.sessionId} IS NOT NULL
        AND ${table.audienceEpoch} IS NOT NULL
        AND ${table.viewerInstanceId} IS NOT NULL
        AND ${table.viewerSequence} IS NOT NULL
      )`
    ),
    index('ix_durable_outbox_ready').on(
      table.kind,
      table.status,
      table.availableAtMs,
      table.createdAtMs
    ),
    index('ix_durable_outbox_expired_lease').on(
      table.status,
      table.leaseExpiresAtMs
    )
  ]
)

export const advxPersistenceSchema = {
  rooms,
  sessionRecords,
  sessionRuntimeRevisions,
  sessionViewerInstances,
  roomEvents,
  roomLongTermMemories,
  roomMemoryHeads,
  roomMemoryEvidence,
  roomMemoryCandidates,
  modeMemes,
  modeMemeEvents,
  modeMemeCandidates,
  modeMemeSettings,
  durableOutbox
} as const
