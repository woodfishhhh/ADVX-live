CREATE TABLE durable_outbox (
  work_id TEXT NOT NULL PRIMARY KEY,
  idempotency_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  topic TEXT NOT NULL,
  fence_kind TEXT NOT NULL,
  room_id TEXT,
  session_id TEXT,
  audience_epoch INTEGER,
  observation_id TEXT,
  viewer_instance_id TEXT,
  viewer_sequence INTEGER,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt_count INTEGER NOT NULL,
  available_at_ms INTEGER NOT NULL,
  lease_owner TEXT,
  lease_expires_at_ms INTEGER,
  last_error_code TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  settled_at_ms INTEGER,
  CONSTRAINT uq_durable_outbox_idempotency UNIQUE (idempotency_key),
  CONSTRAINT ck_durable_outbox_kind_allowed CHECK (
    kind IN (
      'domain_event',
      'memory_side_effect',
      'meme_side_effect',
      'migration_marker',
      'recovery_marker'
    )
  ),
  CONSTRAINT ck_durable_outbox_status_allowed CHECK (
    status IN ('pending', 'leased', 'completed', 'cancelled', 'dead_letter')
  ),
  CONSTRAINT ck_durable_outbox_fence_kind_allowed CHECK (
    fence_kind IN ('none', 'room', 'session_epoch', 'viewer_sequence')
  ),
  CONSTRAINT ck_durable_outbox_attempt_count_nonnegative CHECK (
    attempt_count >= 0
  ),
  CONSTRAINT ck_durable_outbox_audience_epoch_positive CHECK (
    audience_epoch IS NULL OR audience_epoch >= 1
  ),
  CONSTRAINT ck_durable_outbox_viewer_sequence_nonnegative CHECK (
    viewer_sequence IS NULL OR viewer_sequence >= 0
  ),
  CONSTRAINT ck_durable_outbox_available_at_nonnegative CHECK (
    available_at_ms >= 0
  ),
  CONSTRAINT ck_durable_outbox_lease_expires_nonnegative CHECK (
    lease_expires_at_ms IS NULL OR lease_expires_at_ms >= 0
  ),
  CONSTRAINT ck_durable_outbox_created_at_nonnegative CHECK (
    created_at_ms >= 0
  ),
  CONSTRAINT ck_durable_outbox_updated_after_created CHECK (
    updated_at_ms >= created_at_ms
  ),
  CONSTRAINT ck_durable_outbox_available_after_created CHECK (
    available_at_ms >= created_at_ms
  ),
  CONSTRAINT ck_durable_outbox_settled_after_created CHECK (
    settled_at_ms IS NULL OR settled_at_ms >= created_at_ms
  ),
  CONSTRAINT ck_durable_outbox_lease_state_consistent CHECK (
    (
      status = 'leased'
      AND lease_owner IS NOT NULL
      AND lease_expires_at_ms IS NOT NULL
      AND settled_at_ms IS NULL
    )
    OR
    (
      status <> 'leased'
      AND lease_owner IS NULL
      AND lease_expires_at_ms IS NULL
    )
  ),
  CONSTRAINT ck_durable_outbox_settlement_consistent CHECK (
    (
      status IN ('completed', 'cancelled', 'dead_letter')
      AND settled_at_ms IS NOT NULL
    )
    OR
    (
      status IN ('pending', 'leased')
      AND settled_at_ms IS NULL
    )
  ),
  CONSTRAINT ck_durable_outbox_fence_consistent CHECK (
    (
      fence_kind = 'none'
      AND room_id IS NULL
      AND session_id IS NULL
      AND audience_epoch IS NULL
      AND observation_id IS NULL
      AND viewer_instance_id IS NULL
      AND viewer_sequence IS NULL
    )
    OR
    (
      fence_kind = 'room'
      AND room_id IS NOT NULL
      AND session_id IS NULL
      AND audience_epoch IS NULL
      AND observation_id IS NULL
      AND viewer_instance_id IS NULL
      AND viewer_sequence IS NULL
    )
    OR
    (
      fence_kind = 'session_epoch'
      AND room_id IS NOT NULL
      AND session_id IS NOT NULL
      AND audience_epoch IS NOT NULL
      AND viewer_instance_id IS NULL
      AND viewer_sequence IS NULL
    )
    OR
    (
      fence_kind = 'viewer_sequence'
      AND room_id IS NOT NULL
      AND session_id IS NOT NULL
      AND audience_epoch IS NOT NULL
      AND viewer_instance_id IS NOT NULL
      AND viewer_sequence IS NOT NULL
    )
  )
);

CREATE INDEX ix_durable_outbox_ready
  ON durable_outbox (kind, status, available_at_ms, created_at_ms);

CREATE INDEX ix_durable_outbox_expired_lease
  ON durable_outbox (status, lease_expires_at_ms);
