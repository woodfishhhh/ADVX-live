---
schema_version: 1
migration_id: advx-typescript-bun
status: ACTIVE
pause: false
pause_reason: null
unattended: false
iteration_budget: null
wall_clock_budget_minutes: null
token_budget: null
cost_budget_usd: null
current_phase: "09"
current_task: null
next_task: "GATE-09"
baseline_commit: "41665a96cf67eb82cbe02f83abbbe2b79b100e48"
last_verified_commit: "60c6e768d59362d21ea206741a0afa6f58c48f5d"
current_head: "60c6e768d59362d21ea206741a0afa6f58c48f5d"
current_branch: "TS_backend_refactor"
worktree_root: "D:/Coding/ADVX-live"
worktree_dirty: true
last_run_id: "cut-014-commit-checker-root-20260808-162"
last_context_id: "cut-014-commit-checker-root-context-20260808-162"
maker_run_id: "cut-014-maker-root-20260808-161"
maker_context_id: "cut-014-maker-root-context-20260808-161"
checker_run_id: "cut-014-commit-checker-root-20260808-162"
checker_context_id: "cut-014-commit-checker-root-context-20260808-162"
same_blocker_attempts: 0
---

# Migration State

## Current Cursor

| Field | Value |
| --- | --- |
| Mode | Assisted implementation |
| Current phase | Phase 09: `READY` |
| Current task | None |
| Next task | `GATE-09` (`READY`) |
| Implementation authorization | Active |
| Independent verifier | Distinct exact-commit Checker required for `GATE-09` |
| Active blocker | None |

## Accepted CUT-014 Record

Maker `cut-014-maker-root-20260808-161` used distinct context
`cut-014-maker-root-context-20260808-161` on branch `TS_backend_refactor` at
base HEAD `7b43ea0a338309403b613df1a1591eb7e9dc9923`.

The Maker retained a dormant source/data recovery window and recorded exact
Bun/product defaults, the final Python oracle and deletion identities, the
CUT-003 backup/restore procedure, retention duration and owners, removal
conditions, open limitations, superseded-work status, evidence identities, and
archive locations. No release has shipped, so no operational rollback clock
has started. After a first authorized signed Windows x64 release reaches full
promotion, the minimum retention period is 30 calendar days.

Independent exact-commit Checker `cut-014-commit-checker-root-20260808-162`
used distinct context
`cut-014-commit-checker-root-context-20260808-162` and accepted commit
`60c6e768d59362d21ea206741a0afa6f58c48f5d`, tree
`493d9ce7c8d0540e0ee7198bf503944ee25c53a9`, and identical
`origin/TS_backend_refactor`. The tracked worktree was clean and the candidate
contained exactly the five owned migration documents with no prohibited path.

The closure record is
`docs/migrations/typescript-bun/CUT-014-ROLLBACK-WINDOW-CLOSURE.md`.
Maker evidence is at
`.omx/artifacts/typescript-bun/CUT-014/cut-014-maker-root-20260808-161/result.json`
with SHA-256
`b2b5ebc0adb9db18da5f53f02b49ce2c459e4d763421a1ffc9b3eed23e264687`.
Checker evidence is at
`.omx/artifacts/typescript-bun/CUT-014/cut-014-commit-checker-root-20260808-162/result.json`
with SHA-256
`2ff50fdf8aff6a4e025bfd4b302b62dddd086a353fdd5fc1ba39a4674262b1b3`.
`CUT-014` is `DONE`; Phase 09 and only `GATE-09` are `READY`;
`current_task=null`, `next_task=GATE-09`, and `same_blocker_attempts=0`. CI
remains automatic-trigger-free and `workflow_dispatch`-only; it was not
triggered.

## Closure Snapshot

| Boundary | Current state |
| --- | --- |
| Product/default runtime | ADVX Live `0.1.0`; Bun `1.3.14`; development `bun-source`; packaged `bun-compiled` |
| Release state | Windows x64 only; unsigned, unpublished, undeployed |
| Complete Python oracle | Commit `41665a96cf67eb82cbe02f83abbbe2b79b100e48`; no dedicated tag or published binary |
| Python deletion checkpoint | Commit `97c81436dcb6df3b30709f6380ddad35b46ac892` |
| Data rollback | CUT-003 restore-from-backup into a new path; no in-place downgrade |
| Rollback loss boundary | Bun-only migration metadata, outbox state, and post-backup writes are not retained |
| Retention owner | Repository maintainer before release; named release owner after publish authority |
| Retention duration | No pre-release expiry; minimum 30 days after first authorized signed release reaches full promotion |
| Documentation archive | `docs/migrations/typescript-bun/`, Git history, `RUN-LOG.md`, and `EVIDENCE.md` |
| Raw evidence archive | Local untracked `.omx/artifacts/typescript-bun/`; hash-bound and excluded from release packages |
| Final gate | `GATE-09` is `READY` and unexecuted |

## Phase State

| Phase | Status | Gate | Plan |
| --- | --- | --- | --- |
| 00 Foundation and spikes | `DONE` | `GATE-00` | [01](./01-FOUNDATION-TOOLCHAIN.md) |
| 01 Contracts and protocol | `DONE` | `GATE-01` | [02](./02-CONTRACTS-PROTOCOL.md) |
| 02 Bun backend shell | `DONE` | `GATE-02` | [03](./03-BUN-BACKEND.md) |
| 03 Data persistence | `DONE` | `GATE-03` | [04](./04-DATA-PERSISTENCE.md) |
| 04 Agent runtime | `DONE` | `GATE-04` | [05](./05-AGENT-RUNTIME.md) |
| 05 Desktop integration | `DONE` | `GATE-05` | [06](./06-DESKTOP-INTEGRATION.md) |
| 06 Observability and replay | `DONE` | `GATE-06` | [07](./07-OBSERVABILITY-REPLAY.md) |
| 07 Test and tooling convergence | `DONE` | `GATE-07` | [08](./08-TEST-TOOLING.md) |
| 08 Packaging and security | `DONE` | `GATE-08` | [09](./09-PACKAGING-SECURITY.md) |
| 09 Cutover and Python removal | `READY` | `GATE-09` | [10](./10-CUTOVER-CLEANUP.md) |

## Active Blockers

None.

## Open Limitations

- `PKG-011` is an accepted Windows-only limitation, not macOS proof.
- Signing, publishing, deployment, updater behavior, and automatic CI/CD remain
  disabled and unauthorized.
- Real user rollback requires a fresh verified pre-update backup; CUT-003 raw
  database artifacts are synthetic evidence only.
- `GATE-09` must independently prove the final definition of done against an
  exact commit before the migration can complete.

## Worktree Ownership

The tracked task surface is owned by this migration run. Existing untracked
`.codex/`, `.omx/`, `apps/backend/`, `output/`, `promo/`, and cache paths remain
uncommitted and untouched except for new CUT-014 evidence under `.omx`. A fresh
`git status` remains authoritative.

## Audit Locations

`STATE.md` is intentionally compact and rebuildable. Historical task records
remain in Git and the append-only [RUN-LOG.md](./RUN-LOG.md) and
[EVIDENCE.md](./EVIDENCE.md). The migration plan and phase documents remain
tracked and are not deleted after completion.
