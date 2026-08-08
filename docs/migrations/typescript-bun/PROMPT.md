# Repeated Migration Loop Prompt

Use this prompt as the stable input for each fresh Codex, Claude Code, or other
coding-agent context. The repository files hold the changing state.

```text
You are executing the ADVX Live TypeScript + Bun migration.

Read, in order:
1. AGENTS.md
2. docs/migrations/typescript-bun/README.md
3. docs/migrations/typescript-bun/LOOP.md
4. docs/migrations/typescript-bun/STATE.md
5. the current task row in 00-MASTER-PLAN.md
6. only the current phase document
7. the last two RUN-LOG.md entries
8. only the active BLOCKERS.md record, if STATE.md names one

Before editing:
- establish a unique run_id, context_id, role, and parent_run_id if delegated;
- if unattended, verify explicit iteration/wall-clock and enforceable
  token/cost budgets are positive and not exhausted;
- confirm repository root, branch, HEAD, git status, and current diff;
- preserve unrelated changes, especially output/ and promo/;
- verify the task is READY or IN_PROGRESS and its dependencies are DONE;
- run `bun run migration:plan-check` once FND-012 exists; otherwise reconcile
  STATE, master task, dependencies, blocker, and evidence manually;
- run the task's baseline check;
- investigate current code before assuming work is missing.

During this iteration:
- execute exactly one task;
- stay inside its allowed files and behavioral scope;
- preserve the Python implementation as a parity oracle until CUT tasks permit removal;
- do not redesign product behavior;
- add or update tests with the behavior they protect;
- do not install an unapproved candidate dependency;
- do not push, merge, publish, sign, deploy, or expose secrets.

Verification:
- run the smallest decisive task gate;
- save machine-readable or inspectable artifacts at the declared evidence path;
- distinguish fake, recorded, live Provider, and platform evidence;
- never mark your own task DONE; move it to VERIFY for an independent checker.
- never reuse the maker run/context identity as the checker identity.

Before exiting:
- update the canonical task row in 00-MASTER-PLAN.md;
- update STATE.md with the exact next cursor;
- append one factual RUN-LOG.md entry;
- add accepted proof to EVIDENCE.md only if you are the independent checker;
- when accepting DONE, promote the next dependency-satisfied TODO task to READY;
- append bounded attempts to BLOCKERS.md when a concrete blocker exists;
- record adjacent findings without implementing a second task.

If the same blocker survives three attempts, mark BLOCKED and stop.
If pause is true, do no implementation.
If all external gates are genuinely satisfied, and only then, emit:
<promise>ADVX_TYPESCRIPT_BUN_MIGRATION_COMPLETE</promise>
```

## Planning Variant

Use this only to repair the plan, not product code:

```text
Read the migration charter, current STATE, master plan, current phase, current
repository facts, and recent run log. Reconcile plan drift against the code.
Do not implement. Update task scope, dependencies, acceptance criteria, or
verification only when current evidence requires it. Preserve stable task IDs;
supersede rather than silently rename completed or referenced tasks. Record the
reason in RUN-LOG.md and return the next single READY task.
```

## Review Variant

```text
Act as an independent verifier. Read the task claim, diff, acceptance criteria,
and evidence contract. Re-run the smallest decisive checks against the current
HEAD. Inspect for semantic drift, stale evidence, hidden Python dependencies,
security regressions, and missing rollback coverage. Do not implement unrelated
improvements. Mark DONE only when the evidence is admissible; otherwise mark
BLOCKED with a concrete failing claim and next diagnostic action.
```
