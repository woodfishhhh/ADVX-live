# Removed Python parity oracle

> Status: source and Python-only tests removed by authorized CUT-008. The
> current backend is [`apps/backend-bun`](../backend-bun/README.md).

This directory remains temporarily because CUT-009 separately owns the Python
toolchain and Alembic history. It is not a runnable backend, development
command, CI runtime, package input, or release artifact.

The deletion authority is recorded in
[`CUT-008-PYTHON-DELETION-AUTHORIZATION.md`](../../docs/migrations/typescript-bun/CUT-008-PYTHON-DELETION-AUTHORIZATION.md).
Post-deletion rollback uses branch `TS_backend_refactor` plus the accepted
CUT-003 restore-from-backup evidence. Language-neutral 6657 assets moved to
[`resources/audience-presets/room-6657`](../../resources/audience-presets/room-6657).

Historical design details are preserved in Git history and migration evidence.
Current architecture, protocol, setup, and operational instructions live in:

- [Bun backend design](../../docs/BACKEND_DESIGN.md)
- [System architecture](../../docs/ARCHITECTURE.md)
- [Realtime ingest protocol](../../docs/INGEST_PROTOCOL.md)
- [Operations](../../docs/OPERATIONS.md)
