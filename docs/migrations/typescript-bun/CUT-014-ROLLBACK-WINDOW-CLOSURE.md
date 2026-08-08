# CUT-014 Rollback Window And Archive Record

> Status: Maker candidate for `VERIFY`
>
> Branch/base HEAD: `TS_backend_refactor` /
> `7b43ea0a338309403b613df1a1591eb7e9dc9923`
>
> Recorded: 2026-08-08

## Decision

Retain a dormant source-and-data recovery window. Do not retain or recreate a
runtime selector in the supported product.

ADVX Live `0.1.0` is currently unsigned, unpublished, and undeployed. No
production cohort exists, so an operational post-release rollback clock has
not started. Until an authorized signed Windows x64 release exists, the
recovery material below has no automatic expiry.

After the first authorized signed Windows x64 Bun release reaches 100 percent
promotion, retain the recovery material for at least 30 calendar days. The
repository maintainer (`woodfishhhh`) is the custody owner before release. A
formally named release owner becomes the owner and incident commander when
publish authority is granted, as required by
[PKG-012-SIGNED-UPDATE-ROLLBACK-RUNBOOK.md](./PKG-012-SIGNED-UPDATE-ROLLBACK-RUNBOOK.md).
No release may occur without that named owner.

This record does not publish, sign, deploy, enable an updater, or enable
automatic CI. `GATE-09` remains a separate required task.

## Runtime Identity

| Item | Recorded value |
| --- | --- |
| Product/package version | `0.1.0` |
| Bun package manager/runtime pin | `bun@1.3.14` |
| Required Electron tooling Node | `24.18.0` |
| Development backend default | `bun-source` |
| Packaged backend default | `bun-compiled` |
| Shipped/published/deployed version | None |
| Supported platform claim | Windows x64 only |

Electron's Node runtime remains an explicit desktop/tooling boundary. It is
not an alternative product backend.

## Last Python Oracle Identity

| Item | Identity |
| --- | --- |
| Last commit containing the complete tracked Python oracle | `41665a96cf67eb82cbe02f83abbbe2b79b100e48` |
| Python deletion checkpoint | `97c81436dcb6df3b30709f6380ddad35b46ac892` |
| Deletion checkpoint tree | `a89c123bb3bb8d3a1c8906fe6b971d3e2815b901` |
| Dedicated oracle tag | None |
| Published Python binary/package artifact | None |
| Accepted post-deletion recovery path | `TS_backend_refactor` history plus CUT-003 restore-from-backup evidence |

Commit `41665a96` is the parent of the accepted deletion checkpoint, contains
161 tracked `apps/backend` paths and 166 tracked Python/toolchain paths, and is
still reachable from `TS_backend_refactor`. The existing repository tag
`#adventurex2026` is not a migration-owned oracle identity and must not be used
as rollback authority.

Oracle recovery, if explicitly authorized during an incident, must use a new
isolated checkout at exact commit `41665a96`. It must never switch or rewrite
the active `TS_backend_refactor` worktree. Because no signed Python binary was
archived, source recovery is forensic/emergency material, not a released
last-known-good artifact.

## Data Backup And Restore

The accepted rehearsal is
[CUT-003-BACKUP-ROLLBACK-REHEARSAL.md](./CUT-003-BACKUP-ROLLBACK-REHEARSAL.md).
Its independently accepted result is:

- path:
  `.omx/artifacts/typescript-bun/CUT-003/cut-003-checker-root-20260808-128/result.json`;
- result SHA-256:
  `c0ce607700d689ae10b47f4991f6b7c1e83395d2bb6e4ad955c6f2b71432eb9a`;
- SQLite Online Backup SHA-256:
  `da13e54349f40f7478ad3d59e3665fde884084944d14236da221bcd0f8c2256d`;
- source schema: `0006_viewer_lifecycle`;
- Bun target migration version: `6`;
- backup `quick_check`: `ok`;
- rehearsal platform: Windows x64;
- fixture class: synthetic, privacy-safe legacy data.

Required recovery procedure:

1. Stop Electron and the supervised backend, and prove port `8765` and owned
   child processes are released.
2. Preserve the failed Bun data directory for diagnosis; never downgrade it in
   place.
3. Select the pre-migration SQLite Online Backup artifact and verify its
   manifest, SHA-256, byte length, schema/application versions, absence of
   sidecars, and `quick_check=ok`.
4. Restore the verified backup into a new data path.
5. Verify SQLite integrity and representative Room, Viewer, Session, and event
   rows before launch.
6. Start only the explicitly authorized known-good runtime against the restored
   path, verify authenticated health/control behavior, then verify clean stop
   and port release.
7. Preserve the failed directory, backup manifest, hashes, decision, and
   operator log until the incident closes.

Rollback is restore-from-backup and restart. Reverse migration, runtime
selector flip, and older-runtime launch against the newer Bun database are not
supported. `advx_schema_migrations`, `durable_outbox`, and all post-backup Bun
writes are outside the retained rollback state.

The CUT-003 database files are synthetic evidence, not a user backup. A future
release/update operator owns creation and custody of the real pre-update backup
for each affected user data directory.

## Retained Archive

| Material | Archive location | Custody/retention rule |
| --- | --- | --- |
| Source history and Python oracle identity | `origin/TS_backend_refactor`, commits `41665a96`, `97c81436`, and descendants | Keep reachable through the rollback window; no history rewrite or force push |
| Migration decisions and procedures | `docs/migrations/typescript-bun/` | Keep tracked; after `GATE-09`, treat as read-only history except factual corrections |
| Accepted evidence index | [EVIDENCE.md](./EVIDENCE.md) | Keep tracked and append-only |
| Run history | [RUN-LOG.md](./RUN-LOG.md) | Keep tracked and append-only |
| Raw local evidence | `.omx/artifacts/typescript-bun/` | Keep untracked, hash-bound, and out of release packages |
| CUT-003 synthetic backup rehearsal | `.omx/artifacts/typescript-bun/CUT-003/cut-003-checker-root-20260808-128/` | Retain through the rollback window as reproducible evidence, not user data |
| Clean-clone final package proof | `.omx/artifacts/typescript-bun/CUT-012/cut-012-commit-checker-root-20260808-152/` | Retain through `GATE-09` and the release observation window |
| Independent final review | `.omx/artifacts/typescript-bun/CUT-013/cut-013-commit-checker-root-20260808-160/` | Retain through `GATE-09` and the release observation window |

Untracked owner content under `apps/backend/**` is not accepted archive
material, is not part of the tracked product/release claim, and remains
untouched by this task.

## Archive Removal Conditions

No retained migration or rollback material may be removed automatically. All
of the following must be true before removal:

1. `GATE-09` is independently accepted against an exact commit.
2. A named release owner and, where applicable, signing custodian exist.
3. A signed, published Windows x64 Bun release completed 100 percent promotion
   and at least 30 calendar days of observation.
4. No open data, authentication, protocol, lifecycle, packaging, or signing
   incident requires the material.
5. The shipped schema has a current, independently verified backup/restore
   rehearsal and a separately retained last-known-good signed Bun artifact.
6. Release and data owners confirm retention obligations and user-support needs
   are satisfied.
7. Explicit human approval names the exact paths/hashes to remove.

Even after those conditions, keep the tracked plan, decisions, final evidence
index, run history, exact commit identities, and closure record. Only bulky raw
local artifacts may become eligible for removal.

## Open Limitations And Owners

| Limitation | Current claim | Owner/trigger |
| --- | --- | --- |
| macOS and Windows arm64 | Unsupported and unproven | Future platform release owner; requires installed target evidence before support |
| Windows signing and trusted timestamp | Not configured or proven | Future named release owner plus signing custodian |
| Publish/deploy/update channel | Not configured or authorized | Future named release owner after all PKG-012 evidence and explicit human authorization |
| Automatic CI/CD | Disabled; workflow is `workflow_dispatch`-only | Repository maintainer after migration completion and separate enablement instruction |
| Rollback data loss window | Post-backup Bun writes are not retained | Release owner and update operator; require fresh pre-update backup and user communication |
| Raw `.omx` evidence durability | Local, untracked, hash-bound | Repository maintainer until an authorized external evidence archive exists |
| Final migration acceptance | Not yet claimed | Independent `GATE-09` Checker |

## Superseded Work

No canonical task has status `SUPERSEDED`; stable task IDs and accepted records
remain historical. Temporary dual-runtime selectors, Python adapters, copied
oracle clients, parity-only shims, Python toolchain inputs, and pnpm boundaries
were removed by accepted `CUT-008` through `CUT-011` work. Those removals do not
delete or rename their task/evidence history.

## Final Evidence Index

The canonical detailed index remains [EVIDENCE.md](./EVIDENCE.md). At the
start of this task, live plan-check reports 133 canonical tasks, 130 `DONE`,
one `ACCEPTED_LIMITATION` (`PKG-011`), `CUT-014` `READY`, `GATE-09` `TODO`, 74
links, 131 accepted evidence records, and zero errors.

| Boundary | Accepted identity |
| --- | --- |
| Human deletion authority/baseline | `CUT-008-PYTHON-DELETION-AUTHORIZATION.md`; commit `41665a96` |
| Python deletion checkpoint | `97c81436`; artifact SHA-256 `df77152f0dc522d01c6aad392992fb9b5fbc31a68fa10a29bb24eaf6362286f6` |
| Toolchain deletion | `3ff566d6fe8eb3eb6d025da3e08fd8d08e7cdec0` |
| Legacy backup/restore rehearsal | CUT-003 artifact SHA-256 `c0ce607700d689ae10b47f4991f6b7c1e83395d2bb6e4ad955c6f2b71432eb9a` |
| Clean-clone/package/installed proof | `78d74e94be61b5a358daee158cf79977dce6b500`; artifact SHA-256 `c9531a34c6237c7f68c28e5bb840e172cdb3a8320c82c6ee2998bda8cb9f1cb9` |
| Independent final review | `6a433e7970f48f5ddd2fec631f9986746af39ecb`; artifact SHA-256 `44822baed182a9b02302ac5ba0527f98b46b609997ccafb8eff8c38dc72136f7` |
| CUT-014 closure | Pending exact-commit Checker |
| Final migration gate | `GATE-09` pending; no completion promise is authorized |

## Documentation Archive Location

The durable archive remains `docs/migrations/typescript-bun/` on
`TS_backend_refactor`. `STATE.md` is compacted to the live cursor and closure
snapshot; detailed history remains in Git, `RUN-LOG.md`, and `EVIDENCE.md`.
The plan and records are not deleted after success.

Maker verdict: the rollback-window and archive contract is complete enough to
advance `CUT-014` to `VERIFY`. Only a distinct exact-commit Checker may accept
`DONE` and promote `GATE-09`.

Maker evidence is at
`.omx/artifacts/typescript-bun/CUT-014/cut-014-maker-root-20260808-161/result.json`
with SHA-256
`b2b5ebc0adb9db18da5f53f02b49ce2c459e4d763421a1ffc9b3eed23e264687`.
