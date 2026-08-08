# CUT-008 Python Deletion Authorization

> Recorded: 2026-08-08
>
> Authority: explicit human instruction in the active migration task
>
> Scope: CUT-008 only

The authorized human supplied the following irreversible-gate statements:

```text
Python parity oracle may be deleted.
The accepted evidence is bound to commit 41665a96cf67eb82cbe02f83abbbe2b79b100e48.
The rollback path is TS_backend_refactor plus CUT-003 restore-from-backup evidence.
Known limitations: Windows x64 only; unsigned, unpublished, undeployed; macOS unproven; CUT-012 clean-clone verification pending.
```

This authorization permits CUT-008 to remove the Python backend source,
Python-only tests, launch/supervisor adapters, contract export path, and
Python packaging/freeze artifacts listed by the accepted readiness inventory.
It does not authorize CUT-009 toolchain/migration removal, CUT-010 shim
cleanup, commit, push, publication, signing, or deployment.

Language-neutral fixtures, behavior ledgers, accepted evidence, and the
CUT-003 backup/restore evidence remain retained. The rollback branch and data
procedure are the only accepted post-deletion rollback path.
