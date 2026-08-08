# Phase 03: Data Persistence

> Entry: `GATE-01`
>
> Exit: `GATE-03`

## Goal

Give the Bun backend safe ownership of ADVX SQLite data with explicit schema
versions, transactions, migrations, backups, crash recovery, and parity with the
current SQLAlchemy/Alembic implementation.

## Repository Anchors

- `docs/BACKEND_DESIGN.md:217-229` defines SQLite ownership, data-directory, and
  migration boundaries.
- `docs/BACKEND_DESIGN.md:421-445` defines startup, health, and migration
  expectations.
- `apps/backend/alembic` and SQLAlchemy models are the current schema oracle.
- `apps/backend/src/advx_backend/infrastructure/persistence/sqlite/database.py`
  owns the existing SQLite online Backup API path and restore behavior.
- `apps/backend/README.md:17-32` documents `ADVX_DATA_DIR`, Alembic, WAL,
  authentication, and privacy behavior.
- `docs/ARCHITECTURE.md:460-516` locks cancellation, failure, and test behavior.

## Data Principles

1. Never test schema migration on the only copy of user data.
2. The application owns one writable SQLite connection policy.
3. Transactions align with application use cases, not repository method calls.
4. Schema version is readable before application services start.
5. Migrations are forward, atomic where SQLite permits, and failure-aware.
6. Backups include database, schema version, app version, hash, and timestamp.
7. Raw audio, raw frames, credentials, hidden reasoning, and raw Provider
   payloads are not persisted.
8. SQLite synchronous work is measured and bounded so it cannot silently stall
   the realtime loop.

## Schema Ownership Matrix

`DAT-001` fills this table with exact current names.

| Concern | Exact current tables | Current write adapter | Target repository | Transaction owner |
| --- | --- | --- | --- | --- |
| Audience profile and relationships | `audience_profiles`, `audience_host_relationships`, `audience_peer_relationships` | `SQLiteAudienceRepository`, `SQLiteRelationshipRepository` | `AudienceRepository`, `RelationshipRepository` | `AudienceService` use case through one unit of work |
| Audience memory and Session membership | `audience_memories`, `memory_evidence`, `session_audiences` | `SQLiteMemoryRepository`, `SQLiteSessionRecordRepository` | `MemoryRepository`, `SessionRepository` | audience/memory use case through one unit of work |
| Room, Session, runtime revision | `rooms`, `session_records`, `session_runtime_revisions` | `SQLiteRoomRepository`, `SQLiteSessionRuntimeRepository` | `RoomRepository`, `SessionRepository` | one `RuntimeSessionService` state transition |
| Viewer pool and private state | `session_viewer_instances` | `SQLiteViewerInstanceRepository` plus bounded direct updates | `AudienceRepository` | one viewer lifecycle/reconciliation transition |
| Room events | `room_events` | `SQLiteRoomEventRepository` | `RoomEventRepository` | append and retention prune in one event transaction |
| Long-term room memory | `room_long_term_memories`, `room_memory_evidence`, `room_memory_heads`, `room_memory_candidates` | `SQLiteRoomMemoryRepository`, `SQLiteRoomMemoryServiceRepository` | `MemoryRepository` | one fenced memory command or candidate decision |
| Mode memes | `mode_memes`, `mode_meme_events`, `mode_meme_settings`, `mode_meme_candidates` | `SQLiteModeMemeRepository`, `SQLiteModeMemeServiceRepository` | `MemeRepository` | one meme command, candidate decision, or maintenance pass |
| Outbox/jobs | none | none | `OutboxRepository` | command transaction under `DAT-009` |

The complete normalized column, type, default, index, constraint, and foreign-key
inventory is generated at [dat-001-schema-inventory.json](./dat-001-schema-inventory.json).
Transaction, cleanup, deletion, fixture, and parity decisions are recorded in
[DAT-001-PERSISTENCE-INVENTORY.md](./DAT-001-PERSISTENCE-INVENTORY.md).

## Tasks

### `DAT-001` Schema And Transaction Inventory

Capture:

- every table, column, type, default, index, constraint, and foreign key;
- Alembic revision order and current head;
- repository/service write paths;
- transaction boundaries;
- cleanup/retention jobs;
- user-visible deletion behavior;
- fixtures that exercise persistence.

Generate a normalized schema artifact from both the current database and
declarative models. Record intentional SQLite-specific behavior.

### `DAT-002` Drizzle And Migration ADR

Choose:

- stable Drizzle package version;
- TypeScript schema location;
- plain SQL migration output and review rules;
- runtime migration runner;
- schema journal ownership;
- migration naming and checksum policy;
- SQLite online Backup API adapter used before destructive migration;
- escape hatch for unsupported SQL.

Do not use `drizzle-kit push` on production/user databases. `push` may be used
only in disposable development spikes.

Decision candidate: [ADR-MIG-001](./ADR-MIG-001.md). The executable
ADVX-owned runner is
`apps/backend-bun/src/infrastructure/persistence/sqlite/migration-runner.ts`.
It retains `drizzle-orm@0.45.2`, rejects the vulnerable Drizzle Kit tooling
tree, owns an immutable exact-SQL journal, and fails closed before destructive
SQL unless a verified SQLite Online Backup API adapter has completed.

### `DAT-003` Connection And Data Directory

Implement:

- injected absolute data directory;
- directory creation and permissions;
- database open with required pragmas;
- WAL and busy-timeout policy;
- one writable ownership model;
- read/query policy;
- health status;
- clean close and checkpoint behavior;
- temporary/fixture database helpers.

Opening a database inside ASAR or packaged resources must fail with a clear
configuration error.

### `DAT-004` Room, Session, And Revision Repositories

Port repository behavior for:

- Room identity and metadata;
- Session lifecycle/recovery status;
- runtime-spec pending/committed revisions;
- canonical hash and `apply_id`;
- audience epoch;
- last clean shutdown/recovery markers.

Test optimistic conflict and rollback paths.

### `DAT-005` Viewer State Repositories

Port:

- deterministic ViewerInstance identity and ordinal;
- Persona reference/revision;
- stable microvariant;
- active/left/kicked state;
- moderation and presence revisions;
- bounded private state and cooldown;
- crash restore for an eligible Session;
- non-reuse of removed IDs in the same Session.

### `DAT-006` Room Event Persistence

Port:

- source-tagged user text, final transcripts, system events, and accepted barrage;
- ordering and idempotency;
- bounded query windows;
- source-specific retention;
- public context exclusion rules;
- event evidence references.

Audience barrage must not recursively become an Observation trigger.

### `DAT-007` Long-Term Memory

Port:

- evidence-backed facts/shared experiences;
- source event IDs and revision;
- confidence/type metadata;
- async extraction result application;
- merge/conflict policy already implemented;
- delete/revoke/modify semantics;
- prevention of deleted values re-entering later context.

Start with SQLite FTS5 if retrieval is required for parity. Orama/sqlite-vec
experiments are separate future decisions and cannot block the runtime migration.

### `DAT-008` Mode Meme Event Log

Port:

- mode namespace isolation;
- normalized source;
- proposed/accepted/archived/reverted state;
- automatic write with undo;
- decay and low-frequency archive;
- provenance;
- current-mode application.

A `MemeCandidate` is never stored as or transformed directly into a
`BarrageEvent`.

### `DAT-009` Durable Outbox And Recovery

Persist only work that must survive a process restart, such as:

- committed domain events awaiting publication;
- eligible memory/meme side effects;
- migration/recovery markers.

Do not persist in-flight model streams or pretend an interrupted Provider request
can resume. On restart, apply idempotency and epoch/sequence fences before any
side effect.

### `DAT-010` Legacy Database Migration

Migration procedure:

1. ask the Python oracle's existing SQLite online Backup API path to create a
   consistent migration backup while it still owns the source;
2. record source application/schema versions and stop both backends;
3. hash the closed backup and run SQLite integrity checks;
4. never copy a live main DB together with WAL/SHM sidecars;
5. inspect schema/Alembic revision from the consistent backup;
6. create a second isolated working copy of that backup;
7. migrate the working copy;
8. compare row counts and representative semantic queries;
9. start Bun against the migrated working copy;
10. run read/write/restart smoke;
11. rehearse restoration from the untouched Backup-API artifact;
12. prove the Bun-owned Backup API adapter before any future destructive Bun
    migration.

Decide whether the migration is in-place after backup or copy-and-swap only after
the rehearsal. No user data is destructively upgraded during planning.

### `DAT-011` Persistence Fault Matrix

Inject:

- locked database;
- busy timeout;
- read-only directory;
- disk-full or write failure simulation;
- corrupted copy;
- unsupported future schema;
- interrupted migration;
- transaction exception;
- process crash before/after commit;
- WAL/sidecar mismatch.

Each case must produce a safe status and preserve the prior usable copy when
possible. Recovery must fail closed rather than silently creating an empty DB in
the wrong directory.

## Performance Budget

Measure representative operations under concurrent runtime load:

| Operation | Budget decision |
| --- | --- |
| append RoomEvent | Record p50/p95 and loop blocking |
| read recent context | Bound rows and payload |
| apply runtime revision | Atomic and wave-boundary safe |
| restore Viewer pool | Startup budget |
| memory retrieval | Top-K and time budget |
| outbox drain | Bounded batch and yield behavior |

Do not lock arbitrary numbers before the Phase 00/03 measurement. Record the
chosen budgets in `docs/DECISIONS.md`.

## Verification

Expected commands:

```powershell
bun run --filter @advx/backend-bun test:persistence
bun run test:db-schema-parity
bun run test:db-migration
bun run test:db-recovery
```

## `GATE-03` Persistence Exit

- [ ] Schema and migration history are mapped.
- [ ] Drizzle/plain SQL ownership is locked on a stable version.
- [ ] WAL, transactions, data paths, and close behavior are proven.
- [ ] All required repositories pass semantic parity tests.
- [ ] Legacy copy migration and rollback rehearsal pass.
- [ ] Fault injection never silently discards or replaces user data.
- [ ] Sync SQLite operations meet measured realtime budgets.
- [ ] Current-HEAD evidence is independently accepted.

## Rollback

The Python backend remains the active owner of live data. Bun operates only on
synthetic or copied databases until desktop integration and cutover gates
explicitly permit otherwise.

## Observations

To be filled during execution.
