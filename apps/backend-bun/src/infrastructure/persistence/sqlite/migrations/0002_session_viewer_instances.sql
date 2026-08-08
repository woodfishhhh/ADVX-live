CREATE TABLE session_viewer_instances (
  session_id TEXT NOT NULL,
  viewer_instance_id TEXT NOT NULL,
  persona_id TEXT NOT NULL,
  persona_revision INTEGER NOT NULL,
  ordinal INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  micro_variant_json TEXT NOT NULL,
  username TEXT NOT NULL DEFAULT '',
  avatar_seed TEXT NOT NULL DEFAULT '',
  color_seed TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT 'zh-CN',
  persona_content_hash TEXT NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000',
  presence_state TEXT NOT NULL DEFAULT 'active',
  presence_revision INTEGER NOT NULL DEFAULT 1,
  moderation_revision INTEGER NOT NULL DEFAULT 1,
  behavior_revision INTEGER NOT NULL DEFAULT 1,
  joined_at_ms INTEGER,
  last_left_at_ms INTEGER,
  join_count INTEGER NOT NULL DEFAULT 0,
  muted_until_ms INTEGER,
  mute_reason TEXT,
  kicked_at_ms INTEGER,
  kick_reason TEXT,
  viewer_sequence INTEGER NOT NULL DEFAULT 0,
  behavior_state_json TEXT NOT NULL DEFAULT '{}',
  created_at_ms INTEGER NOT NULL DEFAULT 0,
  updated_at_ms INTEGER NOT NULL DEFAULT 0,
  created_epoch INTEGER NOT NULL,
  removed_epoch INTEGER,
  state TEXT NOT NULL,
  CONSTRAINT pk_session_viewer_instances PRIMARY KEY (session_id, viewer_instance_id),
  CONSTRAINT fk_session_viewer_instances_session_id_session_records
    FOREIGN KEY (session_id) REFERENCES session_records(session_id) ON DELETE CASCADE,
  CONSTRAINT ck_session_viewer_instances_persona_revision_positive CHECK (
    persona_revision >= 1
  ),
  CONSTRAINT ck_session_viewer_instances_ordinal_nonnegative CHECK (ordinal >= 0),
  CONSTRAINT ck_session_viewer_instances_created_epoch_nonnegative CHECK (
    created_epoch >= 0
  ),
  CONSTRAINT ck_session_viewer_instances_removed_after_created CHECK (
    removed_epoch IS NULL OR removed_epoch >= created_epoch
  ),
  CONSTRAINT ck_session_viewer_instances_state_allowed CHECK (
    state IN ('active', 'removed')
  )
);

CREATE INDEX ix_session_viewer_instances_session_state_viewer
  ON session_viewer_instances (session_id, state, viewer_instance_id);
CREATE INDEX ix_session_viewer_instances_session_persona_ordinal
  ON session_viewer_instances (session_id, persona_id, ordinal);
