# CUT-003 Backup And Rollback Rehearsal

## Scope

This rehearsal is authorized for Windows x64 and uses only the privacy-safe
legacy fixture from `DAT-010`. The fixture contains synthetic Room, Viewer,
Session, and text-event rows. It contains no user data, Provider credential,
audio, frame, Electron user data, or production path.

## Supported Procedure

1. Start the retained Python SQLite owner at application version `0.1.0` and
   identify Alembic head `0006_viewer_lifecycle`.
2. Create a SQLite Online Backup API artifact and record its SHA-256, byte
   length, schema version, application version, timestamp, and `quick_check`.
3. Stop the legacy owner, compare the closed source with the backup, and use
   Bun `1.3.14` to migrate only an isolated copy to migration version `6`.
4. Start the real supervised Bun backend on the migrated copy and execute one
   recorded text-to-barrage scenario.
5. Stop the Bun client and backend cleanly and release the loopback port.
6. Restore a new rollback copy from the still-untouched backup artifact.
7. Start the real Python oracle on that restored copy.
8. Verify authenticated health/control behavior, Alembic head, retained
   synthetic rows, SQLite integrity, and clean shutdown.

The supported rollback is **restore-from-backup and restart**, not an in-place
runtime selector flip and not a reverse migration of the Bun working database.

## Compatibility Boundary

The first five Bun migrations are the validated semantic baseline for the
legacy Alembic schema. Migration `0006_durable_outbox` adds Bun-owned
`advx_schema_migrations` and `durable_outbox` state. Python does not own or
consume those records, so Bun-only migration metadata, outbox work, and any
post-backup writes are not rollback-retained. No destructive legacy-table
change is claimed, but in-place Python rollback remains unsupported because
application ownership and Bun-only state are not backward compatible.

## Stop Conditions

The rehearsal fails on any version mismatch, hash mismatch, source/backup
semantic mismatch, SQLite integrity failure, sidecar on a closed backup,
recorded-scenario failure, forced Bun shutdown, unreleased port, failed Python
startup, missing retained legacy row, or leaked synthetic credential.
