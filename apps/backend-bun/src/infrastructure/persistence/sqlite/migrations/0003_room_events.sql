CREATE TABLE room_events (
  event_id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  audience_epoch INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  occurred_at_ms INTEGER NOT NULL,
  CONSTRAINT fk_room_events_room_id_rooms
    FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE,
  CONSTRAINT fk_room_events_session_id_session_records
    FOREIGN KEY (session_id) REFERENCES session_records(session_id) ON DELETE CASCADE,
  CONSTRAINT ck_room_events_sequence_nonnegative CHECK (sequence >= 0),
  CONSTRAINT ck_room_events_audience_epoch_nonnegative CHECK (audience_epoch >= 0),
  CONSTRAINT ck_room_events_occurred_at_nonnegative CHECK (occurred_at_ms >= 0),
  CONSTRAINT uq_room_events_room_session_sequence UNIQUE (
    room_id,
    session_id,
    sequence
  )
);

CREATE INDEX ix_room_events_room_occurred_at_ms
  ON room_events (room_id, occurred_at_ms);
