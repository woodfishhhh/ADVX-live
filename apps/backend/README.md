# Removed Python backend and toolchain

> Status: source and Python-only tests were removed by authorized CUT-008;
> Python packaging, pytest/Ruff configuration, uv lock, and Alembic runtime
> were removed by CUT-009. The current backend is
> [`apps/backend-bun`](../backend-bun/README.md).

This directory is a documentation-only tombstone. It is not a runnable
backend, development command, CI runtime, package input, or release artifact.
Durable schema history is represented by the Bun SQL migration chain and the
accepted migration evidence under `docs/migrations/typescript-bun`.

The deletion authority is recorded in
[`CUT-008-PYTHON-DELETION-AUTHORIZATION.md`](../../docs/migrations/typescript-bun/CUT-008-PYTHON-DELETION-AUTHORIZATION.md).
Post-deletion rollback uses branch `TS_backend_refactor` plus the accepted
CUT-003 restore-from-backup evidence. Language-neutral 6657 assets moved to
[`resources/audience-presets/room-6657`](../../resources/audience-presets/room-6657).

Historical implementation details are preserved in Git history and migration
evidence. Current architecture, protocol, setup, and operational instructions
live in:

- [Bun backend design](../../docs/BACKEND_DESIGN.md)
- [System architecture](../../docs/ARCHITECTURE.md)
- [Realtime ingest protocol](../../docs/INGEST_PROTOCOL.md)
- [Operations](../../docs/OPERATIONS.md)
