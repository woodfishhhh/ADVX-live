CREATE TABLE mode_memes (
  meme_id TEXT NOT NULL PRIMARY KEY,
  mode_namespace TEXT NOT NULL,
  content TEXT NOT NULL,
  intensity FLOAT NOT NULL,
  state TEXT NOT NULL,
  source_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CONSTRAINT ck_mode_memes_intensity_range CHECK (
    intensity >= 0.0 AND intensity <= 1.0
  ),
  CONSTRAINT ck_mode_memes_state_allowed CHECK (
    state IN ('active', 'disabled', 'archived', 'revoked')
  ),
  CONSTRAINT ck_mode_memes_revision_positive CHECK (revision >= 1),
  CONSTRAINT ck_mode_memes_created_at_nonnegative CHECK (created_at_ms >= 0),
  CONSTRAINT ck_mode_memes_updated_after_created CHECK (
    updated_at_ms >= created_at_ms
  )
);

CREATE INDEX ix_mode_memes_namespace_state_updated
  ON mode_memes (mode_namespace, state, updated_at_ms);

CREATE TABLE mode_meme_events (
  event_id TEXT NOT NULL PRIMARY KEY,
  meme_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  previous_revision INTEGER NOT NULL,
  new_revision INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  CONSTRAINT fk_mode_meme_events_meme_id_mode_memes
    FOREIGN KEY (meme_id) REFERENCES mode_memes(meme_id)
    ON DELETE CASCADE,
  CONSTRAINT ck_mode_meme_events_action_allowed CHECK (
    action IN ('created', 'edited', 'revoked', 'restored', 'disabled', 'archived')
  ),
  CONSTRAINT ck_mode_meme_events_previous_revision_nonnegative CHECK (
    previous_revision >= 0
  ),
  CONSTRAINT ck_mode_meme_events_new_revision_positive CHECK (new_revision >= 1),
  CONSTRAINT ck_mode_meme_events_created_at_nonnegative CHECK (created_at_ms >= 0)
);

CREATE TABLE mode_meme_candidates (
  candidate_id TEXT NOT NULL PRIMARY KEY,
  room_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  audience_epoch INTEGER NOT NULL,
  observation_id TEXT NOT NULL,
  mode_namespace TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  text TEXT NOT NULL,
  evidence_event_ids_json TEXT NOT NULL,
  evidence_frame_indexes_json TEXT NOT NULL,
  outcome TEXT NOT NULL,
  result_meme_id TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CONSTRAINT fk_mode_meme_candidates_room_id_rooms
    FOREIGN KEY (room_id) REFERENCES rooms(room_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_mode_meme_candidates_session_id_session_records
    FOREIGN KEY (session_id) REFERENCES session_records(session_id)
    ON DELETE CASCADE,
  CONSTRAINT fk_mode_meme_candidates_result_meme_id_mode_memes
    FOREIGN KEY (result_meme_id) REFERENCES mode_memes(meme_id)
    ON DELETE SET NULL,
  CONSTRAINT uq_mode_meme_candidates_namespace_idempotency UNIQUE (
    mode_namespace,
    idempotency_key
  ),
  CONSTRAINT ck_mode_meme_candidates_audience_epoch_positive CHECK (
    audience_epoch >= 1
  ),
  CONSTRAINT ck_mode_meme_candidates_outcome_allowed CHECK (
    outcome IN ('pending', 'accepted', 'rejected')
  ),
  CONSTRAINT ck_mode_meme_candidates_created_at_nonnegative CHECK (
    created_at_ms >= 0
  ),
  CONSTRAINT ck_mode_meme_candidates_updated_after_created CHECK (
    updated_at_ms >= created_at_ms
  )
);

CREATE INDEX ix_mode_meme_candidates_namespace_outcome_created
  ON mode_meme_candidates (mode_namespace, outcome, created_at_ms);

CREATE TABLE mode_meme_settings (
  mode_namespace TEXT NOT NULL PRIMARY KEY,
  auto_ingest_enabled BOOLEAN NOT NULL,
  revision INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CONSTRAINT ck_mode_meme_settings_revision_positive CHECK (revision >= 1),
  CONSTRAINT ck_mode_meme_settings_created_at_nonnegative CHECK (
    created_at_ms >= 0
  ),
  CONSTRAINT ck_mode_meme_settings_updated_after_created CHECK (
    updated_at_ms >= created_at_ms
  )
);
