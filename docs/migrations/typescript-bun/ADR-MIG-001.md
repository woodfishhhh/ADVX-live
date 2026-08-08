# ADR-MIG-001: Drizzle And SQLite Migration Ownership

> Status: Accepted by `dat-002-checker-root-20260803-001`
>
> Date: 2026-08-03
>
> Owner: Phase 03 data persistence

## Context

ADVX must preserve the current SQLAlchemy/Alembic schema while moving runtime
ownership to Bun. `FND-006` proved `drizzle-orm` against `bun:sqlite`, but also
proved that Bun `1.3.14` has no true SQLite Online Backup API. `FND-009` left a
moderate vulnerable `esbuild@0.18.20` path under the development-only
`drizzle-kit@0.31.10` tree for this task to remove, replace, or upgrade.

## Decision

1. Keep the exact stable runtime pin `drizzle-orm@0.45.2`. Do not adopt the
   `1.0.0` beta/RC line during this migration.
2. Do not adopt `drizzle-kit` or `@libsql/client` in the repository. The current
   `drizzle-kit@0.31.10` package still reaches
   `@esbuild-kit/core-utils -> esbuild@0.18.20`; removing the entire tooling
   tree is the bounded resolution of the `FND-009` finding.
3. Put Drizzle table declarations under
   `apps/backend-bun/src/infrastructure/persistence/sqlite/schema/`. Those
   declarations are repository/query types, not a runtime migration engine.
4. Put reviewed SQL migrations under
   `apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/` and
   expose them as a compile-time ordered `SqliteMigration[]`. The first file is
   `0001_<slug>.sql`; every later file increments the four-digit version by one.
5. Use the ADVX-owned `runSqliteMigrations` function at runtime. It applies all
   pending SQL in one `BEGIN IMMEDIATE` transaction and owns transaction control.
   A migration file cannot manipulate the journal or open its own transaction.
6. The authoritative journal is the strict SQLite table
   `advx_schema_migrations`. It stores version, full migration name, exact SQL
   SHA-256, destructive classification, application timestamp, and app version.
   Previously applied names, order, classifications, and checksums are immutable.
   `PRAGMA user_version` and Drizzle's `__drizzle_migrations` are not authorities.
7. Hash exact committed UTF-8/LF SQL bytes with SHA-256. Any applied-file change,
   missing prefix, gap, reorder, unknown future row, or checksum mismatch fails
   closed before migration SQL runs.
8. Plain SQL is the escape hatch for SQLite features that Drizzle's schema DSL
   cannot express. Such SQL receives the same transaction, checksum, parity test,
   and review. There is no imperative callback or `drizzle-kit push` escape hatch.

## Backup Boundary

Every migration is explicitly classified as additive or destructive. Before any
pending destructive migration, the runner requires a successful
`SqliteOnlineBackupAdapter` receipt proving the SQLite Online Backup API method,
backup path, SHA-256, `quick_check=ok`, source schema/app versions, and timestamp.
Backup completes before the runner creates or changes the migration journal.

For the legacy cutover, `DAT-010` may implement this adapter through the retained
Python oracle's `sqlite3.Connection.backup` while Python still owns the source.
That adapter is a temporary migration boundary, not final product architecture.
With Bun `1.3.14`, the Bun-owned adapter remains unavailable; therefore the Bun
runtime must reject destructive migrations after Python removal. A later true
Bun/native Online Backup API adapter requires its own dependency, packaging,
restore, crash, and current-platform proof before that prohibition can change.
`Database.serialize`, `VACUUM INTO`, copying a live DB/WAL/SHM set, and copying
the main database file are not accepted substitutes.

## SQL Review Rules

- Generate no schema change against a production or user database.
- Never use `drizzle-kit push` on a production or user database.
- Review the committed SQL, schema declaration delta, destructive flag, and
  checksum together.
- Test migration and repeat startup on a disposable database or isolated copy.
- Test the semantic query affected by the schema change, not only table presence.
- Restore from the untouched Online Backup API artifact before approving a
  destructive migration.
- Do not edit an applied migration. Add the next numbered migration instead.

## Consequences

This keeps Drizzle ORM available for typed repositories without making Drizzle
Kit, its vulnerable development tree, or its timestamp-only journal part of the
runtime trust boundary. The runner is executable now, while actual schema files,
data-directory opening, legacy baseline adoption, and backup adapter integration
remain owned by `DAT-003`, `DAT-004..008`, and `DAT-010`.

Rollback is restore/copy-and-swap from the verified backup, never a generated
down migration against the only copy of user data.
