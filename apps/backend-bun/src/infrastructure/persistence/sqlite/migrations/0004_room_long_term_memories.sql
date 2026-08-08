CREATE TABLE room_long_term_memories (
  memory_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  memory_type TEXT NOT NULL,
  content TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  importance REAL NOT NULL,
  confidence REAL NOT NULL,
  origin TEXT NOT NULL,
  state TEXT NOT NULL,
  superseded_by TEXT,
  last_recalled_at_ms INTEGER,
  expires_at_ms INTEGER,
  revision INTEGER NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CONSTRAINT fk_room_long_term_memories_room_id_rooms
    FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE,
  CONSTRAINT fk_room_long_term_memories_superseded_by_room_long_term_memories
    FOREIGN KEY (superseded_by) REFERENCES room_long_term_memories(memory_id)
    ON DELETE SET NULL,
  CONSTRAINT ck_room_long_term_memories_importance_range CHECK (
    importance >= 0.0 AND importance <= 1.0
  ),
  CONSTRAINT ck_room_long_term_memories_confidence_range CHECK (
    confidence >= 0.0 AND confidence <= 1.0
  ),
  CONSTRAINT ck_room_long_term_memories_state_allowed CHECK (
    state IN ('active', 'superseded', 'revoked')
  ),
  CONSTRAINT ck_room_long_term_memories_revision_positive CHECK (revision >= 1),
  CONSTRAINT ck_room_long_term_memories_not_self_superseded CHECK (
    superseded_by IS NULL OR superseded_by != memory_id
  ),
  CONSTRAINT ck_room_long_term_memories_created_at_nonnegative CHECK (
    created_at_ms >= 0
  ),
  CONSTRAINT ck_room_long_term_memories_updated_after_created CHECK (
    updated_at_ms >= created_at_ms
  )
);

CREATE INDEX ix_room_long_term_memories_room_state_updated
  ON room_long_term_memories (room_id, state, updated_at_ms);

CREATE INDEX ix_room_long_term_memories_retrieval
  ON room_long_term_memories (room_id, state, importance, last_recalled_at_ms);

CREATE TABLE room_memory_heads (
  room_id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CONSTRAINT fk_room_memory_heads_room_id_rooms
    FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE,
  CONSTRAINT ck_room_memory_heads_revision_nonnegative CHECK (revision >= 0),
  CONSTRAINT ck_room_memory_heads_updated_at_nonnegative CHECK (updated_at_ms >= 0)
);

CREATE TABLE room_memory_evidence (
  memory_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  occurred_at_ms INTEGER NOT NULL,
  evidence_summary TEXT NOT NULL,
  CONSTRAINT fk_room_memory_evidence_memory_id_room_long_term_memories
    FOREIGN KEY (memory_id) REFERENCES room_long_term_memories(memory_id)
    ON DELETE CASCADE,
  CONSTRAINT ck_room_memory_evidence_occurred_at_nonnegative CHECK (
    occurred_at_ms >= 0
  ),
  PRIMARY KEY (memory_id, event_id)
);

CREATE INDEX ix_room_memory_evidence_event_memory
  ON room_memory_evidence (event_id, memory_id);

CREATE TABLE room_memory_candidates (
  candidate_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  candidate_type TEXT NOT NULL,
  content TEXT NOT NULL,
  tags_json TEXT NOT NULL,
  evidence_event_ids_json TEXT NOT NULL,
  outcome TEXT NOT NULL,
  result_memory_id TEXT,
  decision_json TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  CONSTRAINT fk_room_memory_candidates_room_id_rooms
    FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE,
  CONSTRAINT fk_room_memory_candidates_result_memory_id_room_long_term_memories
    FOREIGN KEY (result_memory_id) REFERENCES room_long_term_memories(memory_id)
    ON DELETE SET NULL,
  CONSTRAINT uq_room_memory_candidates_room_idempotency UNIQUE (
    room_id,
    idempotency_key
  ),
  CONSTRAINT ck_room_memory_candidates_base_revision_nonnegative CHECK (
    base_revision >= 0
  ),
  CONSTRAINT ck_room_memory_candidates_outcome_allowed CHECK (
    outcome IN ('pending', 'created', 'merged', 'replaced', 'rejected', 'stale')
  ),
  CONSTRAINT ck_room_memory_candidates_created_at_nonnegative CHECK (
    created_at_ms >= 0
  ),
  CONSTRAINT ck_room_memory_candidates_updated_after_created CHECK (
    updated_at_ms >= created_at_ms
  )
);

INSERT INTO room_memory_heads (room_id, revision, updated_at_ms)
SELECT room_id, 0, updated_at_ms FROM rooms;
