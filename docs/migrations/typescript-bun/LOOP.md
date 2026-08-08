# TypeScript + Bun Migration Loop Contract

> Applies to: `docs/migrations/typescript-bun/`
>
> Autonomy level: L1 planning now; L2 assisted implementation after activation
>
> Default execution unit: one task per fresh context

## Outcome

Repeated agent runs must converge on a verified TypeScript/Bun migration without
losing architectural intent, falsely claiming completion, expanding scope, or
destroying the Python rollback path before parity is proven.

## Durable State Model

```text
stable charter and architecture
        |
        v
00-MASTER-PLAN.md -----> current phase plan
        |                       |
        v                       v
     STATE.md <---------- task result
        |                       |
        +----> RUN-LOG.md ------+
        |
        +----> BLOCKERS.md ----> changed hypothesis
        |
        +----> EVIDENCE.md ----> independent gate
```

`STATE.md` is a rebuildable cursor, not an audit log. `RUN-LOG.md` and Git retain
history. `BLOCKERS.md` preserves bounded recovery attempts. `EVIDENCE.md`
records only proof that a gate accepts.

## Status Vocabulary

| Status | Meaning | Allowed transition |
| --- | --- | --- |
| `PLANNED` | Plan exists; implementation is not authorized | `ACTIVE` |
| `TODO` | Defined but prerequisites are incomplete | `READY`, `DEFERRED` |
| `READY` | Prerequisites and scope are known | `IN_PROGRESS` |
| `IN_PROGRESS` | The only implementation task owned by the current run | `VERIFY`, `BLOCKED` |
| `VERIFY` | Implementation is finished; independent proof is pending | `DONE`, `BLOCKED` |
| `BLOCKED` | The same blocker survived bounded recovery | `READY`, `DEFERRED`, `ACCEPTED_LIMITATION` |
| `DONE` | Required proof exists and is indexed | terminal |
| `DEFERRED` | Explicitly removed from the active critical path | `READY` |
| `ACCEPTED_LIMITATION` | An authorized human narrowed an external Provider/platform/release claim and the unmet proof is indexed | terminal |
| `SUPERSEDED` | Replaced by another stable task ID | terminal |

There may be at most one `IN_PROGRESS` task. A phase may contain several `READY`
tasks, but the loop selects only one.

Dependencies require `DONE` by default. `ACCEPTED_LIMITATION` satisfies a
dependency only when that exact downstream task or gate explicitly permits it.
It cannot waive product correctness, data safety, security, or a claim that
remains in release scope.

## Fresh-Context Lifecycle

1. Read `AGENTS.md`, `README.md`, `LOOP.md`, and `STATE.md`.
2. Confirm the repository root, branch, HEAD, and working tree.
3. Preserve unrelated changes. `output/` and `promo/` are currently unrelated.
4. Read the current master-plan row and current phase task.
5. If `STATE.md` names a blocker, read only that blocker record.
6. Read only the code, docs, tests, and recent history named by that task.
7. Run `bun run migration:plan-check` after `FND-012`; before then, manually
   reconcile the cursor, master row, dependencies, blocker, and evidence.
8. Run the task's baseline check before editing.
9. Implement the smallest complete change for that one task.
10. Run its targeted verification.
11. If implementation passes, set the task to `VERIFY`; a separate verifier
   checks the claim and records accepted evidence.
12. Update the task row in `00-MASTER-PLAN.md`, update the cursor/derived phase
    summary in `STATE.md`, and append one `RUN-LOG.md` entry.
13. Exit. The next task starts in a fresh context.

Do not opportunistically complete a second task. Record adjacent findings as
notes, blockers, or new task proposals.

## Status Ownership

- `00-MASTER-PLAN.md` is canonical for task status and dependencies.
- `STATE.md` is canonical for the one active cursor; its phase table is derived.
- Phase documents define work and gates but do not duplicate mutable task
  status.
- `RUN-LOG.md` records transitions; `EVIDENCE.md` proves accepted `DONE`.

If these disagree, pause implementation, repair the cursor from Git, evidence,
and the run log, then append a planning entry explaining the correction.

## Task Selection

Choose work in this order:

1. A task explicitly named by an active human instruction.
2. The only `IN_PROGRESS` task.
3. The `next_task` named in `STATE.md`, if it is `READY`.
4. The highest-priority `READY` task whose dependencies are `DONE`.
5. A blocker-resolution task explicitly linked from a `BLOCKED` critical-path
   task.

Never select work solely because it looks easy.

## Task Promotion

- A checker that accepts a task as `DONE` evaluates the master table in order.
- It promotes the next highest-priority `TODO` whose dependencies are all
  `DONE` to `READY` and writes that ID to `STATE.md`.
- A phase gate promotes the first eligible task in the next phase only after the
  gate itself is `DONE`.
- A planning run may intentionally expose several independent `READY` tasks for
  worktree execution, but `STATE.md` still names one default cursor.
- If unfinished work exists but no task is eligible, do not guess. Record the
  dependency deadlock or missing decision and move the responsible task to
  `BLOCKED`.
- A `BLOCKED` external-evidence task may become `ACCEPTED_LIMITATION` only after
  explicit human authorization names the narrowed claim, affected release
  scope, expiry/revisit owner, and evidence record.

## Maker And Checker

- Every run has a unique `run_id` and `context_id`; a delegated checker also
  records its `parent_run_id` when one exists.
- The maker may implement, run targeted checks, and move a task to `VERIFY`.
- The maker may not move its own task from `VERIFY` to `DONE`.
- The checker reads the diff, reruns the minimum decisive gate, verifies the
  evidence is bound to the current HEAD, and then records `DONE` or `BLOCKED`.
- `checker_run_id` and `checker_context_id` must differ from the maker values.
  Changing a role label inside the same context is not independent verification.
- The checker must not be an implementation owner or author of the reviewed
  diff. It records the exact commit or dirty-diff hash received before checking.
- After `DONE`, the checker performs the task-promotion rule and records the
  resulting single cursor.
- A phase gate requires a verifier role or a clearly separate review context.
- Fake, deterministic, recorded, credentialed live, and platform proof are
  separate evidence classes and cannot substitute for each other.
- `ACCEPTED_LIMITATION` is not successful proof. The checker records what cannot
  be claimed and verifies every downstream gate has adjusted its wording.

## Accepted Evidence

Evidence must identify:

- task ID and claim;
- current commit or exact dirty-tree diff identity;
- command or manual procedure;
- exit code and concise result;
- artifact path;
- environment and fixture class;
- timestamp;
- verifier identity or role;
- maker/checker run and context IDs;
- reviewed source-state hash and checker non-participation declaration;
- limitations.

Chat prose and completion promises are not evidence.

## Backpressure

Every implementation task has a targeted check. Every phase ends with a broader
gate. The following are default backpressure layers:

```text
schema/type validation
  -> focused unit test
  -> integration or protocol test
  -> typecheck + lint
  -> package build
  -> process lifecycle smoke
  -> recorded replay
  -> credentialed/platform proof when required
```

Do not repeatedly run the broadest suite when a smaller failing gate already
identifies the problem. Do not weaken, skip, delete, or retry-away a failing test.

## Attempt And Budget Limits

| Limit | Default |
| --- | ---: |
| Implementation tasks per iteration | 1 |
| Consecutive attempts on the same error signature | 3 |
| Fresh-context iterations without material progress | 2 |
| Parallel implementation owners for the same files | 1 |
| Broad full-suite reruns after identical failure | 1 |
| Automatic external production actions | 0 |

Before any unattended scheduler starts, `STATE.md` must contain explicit
positive iteration and wall-clock limits plus whichever token or cost limit the
runner can actually enforce. `null` means unattended execution is disabled, not
unlimited. The loop stops when any hard budget is exhausted and records the
remaining task as unfinished; budget exhaustion never converts work to `DONE`.

After the third attempt on the same blocker, record `BLOCKED`, summarize all
attempts in `BLOCKERS.md`, preserve artifacts, and stop. A new diagnosis or plan
decision must change the hypothesis before retrying.

## Safety Boundaries

- Never edit or reveal `.env`, credentials, provider secrets, user data, raw
  audio, raw frames, or Electron user-data directories.
- Never pass secrets through command-line arguments or ordinary logs.
- Never auto-push, auto-merge, publish, sign, or deploy.
- Never delete Python source, `uv.lock`, migrations, or the Python test oracle
  before the cutover gate explicitly authorizes it.
- Never change active product semantics to make TypeScript parity easier.
- Never introduce Redis or another sidecar to solve a local queue problem.
- Never allow renderer code to gain backend, filesystem, or secret privileges.
- Never treat a successful deterministic fake as a live Provider result.
- Never revert unrelated user changes.

## Human Gates

Explicit human authorization is required before:

- changing the locked product contract rather than matching it;
- destructive or irreversible data migration;
- deleting the rollback-capable Python implementation;
- enabling remote telemetry or uploading traces;
- enabling automatic updates;
- code signing, publishing, pushing, or merging;
- broad scope changes outside this migration.

Local reversible implementation and verification may proceed automatically once
the migration is activated.

## Git Policy

- Target branch is `main`; this loop does not invent a release branch policy.
- Inspect `git status` before every task.
- Use an isolated worktree when the active tree is dirty and implementation
  would otherwise overlap unrelated work.
- One task should form one reviewable commit only when the active execution
  instruction authorizes commits.
- A commit is not proof. Verification must still be fresh and indexed.

## Completion Protocol

Task signal:

```text
ADVX_LOOP_TASK_READY_FOR_VERIFICATION:<TASK_ID>
```

Phase signal:

```text
ADVX_LOOP_PHASE_VERIFIED:<PHASE_ID>
```

Final wrapper signal:

```text
<promise>ADVX_TYPESCRIPT_BUN_MIGRATION_COMPLETE</promise>
```

The final signal is allowed only when:

1. every critical-path implementation task is `DONE`;
2. every Gate External Conditions task is `DONE` or has the exact authorized
   `ACCEPTED_LIMITATION` permitted by the master table;
3. every phase gate has current-HEAD evidence;
4. the final packaged Electron application starts and stops cleanly;
5. recorded parity and all live/platform evidence still in release scope are
   separately present;
6. rollback has been tested or explicitly closed after its retention window;
7. active source, scripts, CI, packaging, and release artifacts contain no
   Python runtime dependency;
8. an independent verifier approves the final claim.

## Kill Switch

Set `pause: true` in `STATE.md` with a reason. A fresh run that sees the flag must
perform no implementation work and exit after reporting the pause.
