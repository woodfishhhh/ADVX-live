# DAT-001 Persistence Inventory

> Task: `DAT-001`
>
> Schema oracle: SQLAlchemy declarative metadata plus a disposable database
> migrated by the real Alembic runner

## Generated Schema Authority

Run `bun run inventory:dat-001` to regenerate and compare
[dat-001-schema-inventory.json](./dat-001-schema-inventory.json). The exporter
starts the real `SQLiteDatabase` in an isolated temporary directory, applies the
production Alembic chain, reads the resulting SQLite catalog, and separately
normalizes `Base.metadata`. It never opens user data.

The current head is `0006_viewer_lifecycle`. Revision order is:

1. `0001_initial`
2. `0002_room_runtime`
3. `0003_mode_meme_candidates`
4. `0004_shared_brain_controls`
5. `0005_detach_memory_evidence_events`
6. `0006_viewer_lifecycle`

Both authorities contain the same 19 application tables. Table/column shape,
types, primary keys, indexes, uniqueness, checks, and foreign-key actions match
after ignoring constraint names. The generated artifact retains both original
snapshots, including every name.

## Default Drift

The migrated database retains 19 SQL defaults that the model declares only as
Python-side defaults. This is current behavior, not a comparison error to hide:

- `session_records`: `session_seed`, `next_creation_ordinal`,
  `target_concurrent_viewers`, `population_revision`, `controller_state_json`.
- `session_viewer_instances`: `username`, `avatar_seed`, `color_seed`, `locale`,
  `persona_content_hash`, `presence_state`, `presence_revision`,
  `moderation_revision`, `behavior_revision`, `join_count`, `viewer_sequence`,
  `behavior_state_json`, `created_at_ms`, `updated_at_ms`.

`DAT-002`, `DAT-004`, and `DAT-005` must either reproduce these database
defaults or introduce an explicit reviewed migration that removes reliance on
them. Drizzle schema generation must not silently infer that they are absent.

## Transaction Ownership

| Tables | Current write path | Atomic boundary required in Bun |
| --- | --- | --- |
| `audience_profiles`, `audience_host_relationships`, `audience_peer_relationships`, `audience_memories`, `memory_evidence`, `session_audiences` | `AudienceService` and `SQLiteSessionRecordStore` use `SQLiteUnitOfWork`; repositories never commit | one application use case, with rollback on error or missing explicit commit |
| `rooms`, `session_records`, `session_runtime_revisions`, `session_viewer_instances` | `RuntimeSessionService` creates one `AsyncSession` per durable start/apply/rollback/recovery step and passes it to all involved repositories | one fenced lifecycle transition; Provider preparation stays outside the DB transaction and failed preparation records a separate rejected revision |
| `session_viewer_instances`, `session_records` | `ViewerAudienceService` updates viewer state and population revision together; new viewer creation advances ordinal and population revision together | one viewer lifecycle mutation; no ID reuse after removal |
| `room_events` | `PersistentRuntimeRoomEventStore` appends and prunes in the same session; `ViewerRuntimeRoomEventSink` owns one append commit | one accepted event plus its retention prune |
| `room_long_term_memories`, `room_memory_evidence`, `room_memory_heads`, `room_memory_candidates` | `SharedBrainService` opens one session per command; candidate commit is fenced by Room lock and retries one stale-head conflict | one memory command/candidate decision, including head revision and evidence links |
| `mode_memes`, `mode_meme_events`, `mode_meme_settings`, `mode_meme_candidates` | `SharedBrainService` opens one session per command; maintenance decays and archives all selected rows before one commit | one candidate decision or command; one maintenance pass is atomic |

Current application modules directly accepting `AsyncSession` are migration
facts, not the target boundary. Bun repositories remain transaction-agnostic;
the application service receives an explicit transaction context as already
defined by the Phase 02 ports.

## Cleanup And Retention

- Migration backup cleanup keeps at most five backups and removes backups older
  than 14 days after a new verified online backup is created.
- `room_events` pruning applies both the configured time cutoff and maximum
  count inside the append transaction.
- `0005_detach_memory_evidence_events` intentionally removes the foreign key
  from durable room-memory evidence to prunable room events. Event pruning must
  not erase accepted long-term memory provenance identifiers.
- Audience and room memory reads exclude expired rows by `expires_at_ms`; no
  general background hard-delete job currently removes those rows.
- Meme maintenance decays inactive unpinned memes and archives low-frequency or
  low-intensity records after 30 days. It does not delete their event history.
- Viewer removal is a durable state transition (`state` and `presence_state`),
  not a row delete; the same Session must never reuse a removed viewer ID.
- No durable outbox/job table exists. `DAT-009` owns that addition.

## User-Visible Deletion

- Deleting an audience profile cascades its memories, relationship rows,
  Session membership, and memory evidence through declared foreign keys.
- Deleting an audience memory first removes relationships sourced from that
  memory; its evidence cascades, while `superseded_by` references use
  `ON DELETE SET NULL`.
- Clearing a Room physically deletes the Room and its dependent runtime rows.
  This is not a renderer-level convenience operation and must remain an
  explicit destructive command.
- Room memory supports revoke/archive state changes separately from hard delete
  and reset. Hard delete removes evidence rows and nulls replacement/result
  references rather than resurrecting deleted content.
- Meme archive/revoke/disable operations are state transitions with append-only
  meme events. Candidate result references use `ON DELETE SET NULL`.
- Raw audio, frames, credentials, hidden reasoning, and raw Provider payloads
  have no table or column in either schema authority.

## Persistence Fixtures

| Fixture/test | Current proof |
| --- | --- |
| `apps/backend/tests/test_persistence_inventory.py` | real Alembic upgrade, declarative/database normalization, exact head, connection pragmas, deterministic artifact check |
| `apps/backend/tests/test_health.py` | migration failure, corrupt database, recovery-write failure, and machine-readable degraded health |
| `apps/backend/tests/test_backend_pipeline.py` | disposable real runtime database through Session, Room event, and shutdown paths |
| `apps/backend/tests/test_sessions_api.py` | disposable authenticated Session API and missing/conflict behavior |
| `tests/parity/python_control_session_server.py` plus `tests/parity/run-control-session-parity.ts` | retained Python/Bun control and Session oracle with isolated data and process cleanup |

The current Python suite does not directly exhaustively CRUD every one of the 19
tables. That is not concealed as DAT-001 proof: repository parity belongs to
`DAT-004..008`, fault behavior to `DAT-011`, and end-to-end migration comparison
to `DAT-010`.

## Target Constraints

- The Bun schema starts from the migrated-database snapshot, not only the
  declarative model.
- One process owns the writable connection policy; WAL, foreign keys, 5000 ms
  busy timeout, and `synchronous=NORMAL` are explicit startup settings.
- Schema version is readable before application services start.
- Migration and destructive recovery always operate on a verified backup, never
  the only copy of user data.
- Repository methods never commit. The caller owns commit/rollback for the
  complete use case.
