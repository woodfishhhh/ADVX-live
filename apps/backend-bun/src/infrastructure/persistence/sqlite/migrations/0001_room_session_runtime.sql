CREATE TABLE rooms (
  room_id TEXT NOT NULL PRIMARY KEY,
  display_name TEXT NOT NULL,
  state TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CONSTRAINT ck_rooms_state_allowed CHECK (state IN ('active', 'cleared')),
  CONSTRAINT ck_rooms_revision_nonnegative CHECK (revision >= 0),
  CONSTRAINT ck_rooms_created_at_nonnegative CHECK (created_at_ms >= 0),
  CONSTRAINT ck_rooms_updated_after_created CHECK (updated_at_ms >= created_at_ms)
);

CREATE TABLE session_records (
  session_id TEXT NOT NULL PRIMARY KEY,
  room_id TEXT REFERENCES rooms(room_id) ON DELETE CASCADE,
  state TEXT,
  audience_epoch INTEGER,
  active_config_hash TEXT,
  recovery_json TEXT,
  session_seed TEXT NOT NULL DEFAULT '',
  next_creation_ordinal INTEGER NOT NULL DEFAULT 1,
  target_concurrent_viewers INTEGER NOT NULL DEFAULT 1,
  population_revision INTEGER NOT NULL DEFAULT 1,
  controller_state_json TEXT NOT NULL DEFAULT '{}',
  client_request_id TEXT,
  client_request_hash TEXT,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms INTEGER,
  outcome TEXT,
  app_version TEXT NOT NULL,
  CONSTRAINT ck_session_records_started_at_nonnegative CHECK (started_at_ms >= 0),
  CONSTRAINT ck_session_records_ended_after_started CHECK (
    ended_at_ms IS NULL OR ended_at_ms >= started_at_ms
  ),
  CONSTRAINT ck_session_records_outcome_allowed CHECK (
    outcome IS NULL OR outcome IN ('completed', 'error', 'interrupted')
  ),
  CONSTRAINT ck_session_records_completion_consistent CHECK (
    (ended_at_ms IS NULL AND outcome IS NULL) OR
    (ended_at_ms IS NOT NULL AND outcome IS NOT NULL)
  ),
  CONSTRAINT ck_session_records_audience_epoch_nonnegative CHECK (
    audience_epoch IS NULL OR audience_epoch >= 0
  ),
  CONSTRAINT ck_session_records_state_allowed CHECK (
    state IS NULL OR state IN ('starting', 'running', 'paused', 'stopping', 'stopped', 'failed')
  ),
  CONSTRAINT uq_session_records_client_request_id UNIQUE (client_request_id)
);

CREATE INDEX ix_session_records_ended_at_ms
  ON session_records (ended_at_ms);
CREATE INDEX ix_session_records_room_state_ended_at_ms
  ON session_records (room_id, state, ended_at_ms);

CREATE TABLE session_runtime_revisions (
  session_id TEXT NOT NULL REFERENCES session_records(session_id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  apply_id TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  config_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  canonical_spec_json TEXT NOT NULL,
  diff_summary_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CONSTRAINT pk_session_runtime_revisions PRIMARY KEY (session_id, revision),
  CONSTRAINT ck_session_runtime_revisions_revision_positive CHECK (revision >= 1),
  CONSTRAINT ck_session_runtime_revisions_base_revision_nonnegative CHECK (base_revision >= 0),
  CONSTRAINT ck_session_runtime_revisions_status_allowed CHECK (
    status IN ('pending', 'committed', 'rejected', 'rolled_back')
  ),
  CONSTRAINT ck_session_runtime_revisions_created_at_nonnegative CHECK (created_at_ms >= 0),
  CONSTRAINT ck_session_runtime_revisions_updated_after_created CHECK (
    updated_at_ms >= created_at_ms
  ),
  CONSTRAINT uq_runtime_revision_session_apply UNIQUE (session_id, apply_id)
);

CREATE INDEX ix_runtime_revision_session_config_hash
  ON session_runtime_revisions (session_id, config_hash);
