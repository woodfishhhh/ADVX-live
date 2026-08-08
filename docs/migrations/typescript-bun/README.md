# ADVX Live TypeScript + Bun Migration

> Status: implementation complete; `GATE-09` final verification active
>
> Created: 2026-07-29
>
> Baseline commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
>
> Canonical master plan: [00-MASTER-PLAN.md](./00-MASTER-PLAN.md)
>
> Loop state: [STATE.md](./STATE.md)

## Purpose

This directory is the execution control plane and durable archive for the ADVX
Live migration from a Python/FastAPI backend to a TypeScript backend running on
Bun.

The target is a Python-free product repository and release artifact. It is not a
claim that Electron stops using Node.js internally. Bun becomes the workspace
package manager, backend runtime, script runner, test helper, and backend
compiler. Electron and Electron-specific build tools retain their required Node
runtime boundary.

The implementation and authorized Python/toolchain removal are complete. The
remaining `GATE-09` task must independently bind the final definition of done
to an exact commit and accepted evidence before completion may be claimed.

## Locked Direction

| Area | Target |
| --- | --- |
| Workspace | Bun workspaces and text `bun.lock` |
| Desktop | Electron + React + electron-vite + Vite |
| Backend HTTP/WS | Bun + Elysia |
| Contracts | Elysia `t` / JSON Schema, versioned HTTP and WebSocket contracts |
| Model access | AI SDK Core behind an ADVX-owned `ModelGateway` |
| Scheduling | `AbortController`, `p-queue`, explicit epoch/sequence fences |
| Stateful workflows | XState only where lifecycle visualization pays for itself |
| Persistence | `bun:sqlite`, stable Drizzle, WAL, explicit migrations |
| Logging/tracing | Pino JSONL, OpenTelemetry, OpenInference conventions |
| Tests | Vitest, Playwright, MSW, fast-check, Promptfoo-style eval fixtures |
| Static tooling | TypeScript, Oxlint, Oxfmt, Knip |
| Packaging | `bun build --compile` backend executable inside electron-builder |

Candidate libraries are not accepted merely because they appear in this table.
Every dependency with runtime or packaging impact must pass its assigned spike
and verification gate before it becomes part of the locked stack.

## Non-Goals

- No product behavior redesign during the runtime migration.
- No removal of the Python oracle before TypeScript parity evidence exists.
- No NestJS, Redis, BullMQ, Qdrant, Temporal, or distributed-service split.
- No second editable source of truth for personas, modes, prompts, or contracts.
- No automatic production deployment, signing, publishing, push, or merge.
- No fake Provider evidence reported as a credentialed live result.
- No broad rewrite of the Electron renderer merely to match backend technology.

## Why This Is a Loop Plan

The plan borrows the useful parts of several current agent-engineering
approaches without installing their frameworks:

- [Loop Engineering](https://github.com/cobusgreyling/loop-engineering) treats
  durable state, maker/checker separation, worktrees, budgets, constraints, and
  human gates as first-class loop primitives.
- [Geoffrey Huntley's Ralph guide](https://github.com/ghuntley/how-to-ralph-wiggum)
  uses a stable prompt plus a persistent implementation plan so each fresh
  context can select one task, verify it, record progress, and exit.
- [Anthropic's long-running agent harness](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
  uses a feature list, progress file, git history, and a startup smoke test to
  recover correctly in a new context window.
- [GitHub Spec Kit](https://github.com/github/spec-kit) separates specification,
  plan, tasks, implementation, and cross-artifact analysis. Its artifact model
  is useful here, but its CLI is not installed because the migration is removing
  Python/uv from the project toolchain.

The resulting rule is simple:

> Markdown controls the loop. Git and fresh verification establish facts.

A completion promise is only a wrapper signal. It is never completion evidence.

## What We Borrowed

| Upstream idea | ADVX decision |
| --- | --- |
| `LOOP.md` plus compact `STATE.md` | Adopted as stable contract plus rebuildable cursor |
| Budget, constraints, run log, and gate files | Adopted in `LOOP.md`, `RUN-LOG.md`, `BLOCKERS.md`, and `EVIDENCE.md` |
| `loop-sync` drift detection | Reimplemented later as the small ADVX-owned `FND-012` TypeScript checker |
| Ralph external fresh-context loop | Adopted as one task per new context, not as an automatic push/tag script |
| Completion promise | Retained only as a scheduler signal after independent `GATE-09` proof |
| Spec Kit spec/plan/tasks split | Borrowed as master roadmap plus phase-owned execution documents |
| General loop CLI/runtime | Not installed during planning; the repository artifacts remain tool-neutral |
| Same-session Stop-hook repetition | Not used as the migration default because it does not reset context |
| Automatic merge, push, publish, or broad write permissions | Rejected |

## File Map

| File | Stability | Purpose |
| --- | --- | --- |
| [LOOP.md](./LOOP.md) | Stable | Loop lifecycle, state transitions, safety, budgets, and stop rules |
| [PROMPT.md](./PROMPT.md) | Stable | Minimal prompt to feed each fresh execution context |
| [INVARIANTS.md](./INVARIANTS.md) | Controlled | Numbered framework-neutral behavior, parity evidence classes, contradictions, and proof gaps |
| [RUNTIME-COMPATIBILITY.md](./RUNTIME-COMPATIBILITY.md) | Controlled | Bun, Node, Electron, build-stack, lifecycle, lockfile, and platform compatibility policy |
| [DEPENDENCY-ADRS.md](./DEPENDENCY-ADRS.md) | Controlled | Migration-specific dependency decisions, exact pins, licenses, owners, audits, boundaries, and exit strategies |
| [STATE.md](./STATE.md) | Frequently updated | One current cursor, next task, blockers, and last verified commit |
| [00-MASTER-PLAN.md](./00-MASTER-PLAN.md) | Controlled | Global decisions, dependencies, task index, gates, risks, and final DoD |
| [01-FOUNDATION-TOOLCHAIN.md](./01-FOUNDATION-TOOLCHAIN.md) | Phase-owned | Bun workspace, dependency policy, compiler, lint, and format foundation |
| [02-CONTRACTS-PROTOCOL.md](./02-CONTRACTS-PROTOCOL.md) | Phase-owned | HTTP, WebSocket, binary ingest, schema, and compatibility contracts |
| [03-BUN-BACKEND.md](./03-BUN-BACKEND.md) | Phase-owned | Elysia composition, domain/application ports, session lifecycle, and APIs |
| [04-DATA-PERSISTENCE.md](./04-DATA-PERSISTENCE.md) | Phase-owned | SQLite ownership, Drizzle migrations, parity, backup, and recovery |
| [05-AGENT-RUNTIME.md](./05-AGENT-RUNTIME.md) | Phase-owned | ASR, model gateway, scheduling, cancellation, and audience runtime |
| [06-DESKTOP-INTEGRATION.md](./06-DESKTOP-INTEGRATION.md) | Phase-owned | Electron supervisor, IPC, loopback auth, capture, and renderer boundary |
| [07-OBSERVABILITY-REPLAY.md](./07-OBSERVABILITY-REPLAY.md) | Phase-owned | Logs, traces, replay, eval, and diagnostics bundle |
| [08-TEST-TOOLING.md](./08-TEST-TOOLING.md) | Phase-owned | Test migration, browser/E2E proof, fault injection, and static gates |
| [09-PACKAGING-SECURITY.md](./09-PACKAGING-SECURITY.md) | Phase-owned | Compiled backend, packaging, fuses, crash evidence, signing readiness |
| [10-CUTOVER-CLEANUP.md](./10-CUTOVER-CLEANUP.md) | Phase-owned | Default switch, rollback window, Python removal, and document alignment |
| [EVIDENCE.md](./EVIDENCE.md) | Append-only index | Proof accepted by task and phase gates |
| [RUN-LOG.md](./RUN-LOG.md) | Append-only | One compact factual record per loop iteration |
| [BLOCKERS.md](./BLOCKERS.md) | Append-only attempts | Bounded blocker diagnosis, attempts, resolution, and residual limitations |

## Reading Order For A Fresh Agent

1. Repository `AGENTS.md`.
2. This file.
3. [LOOP.md](./LOOP.md).
4. [STATE.md](./STATE.md).
5. The current row in [00-MASTER-PLAN.md](./00-MASTER-PLAN.md).
6. [INVARIANTS.md](./INVARIANTS.md) for tasks that port, test, or verify product behavior.
7. Only the current phase document.
8. Only the repository files named by the current task.
9. The last two entries in [RUN-LOG.md](./RUN-LOG.md).
10. [BLOCKERS.md](./BLOCKERS.md) only when `STATE.md` names an active blocker.

Do not load every phase document into every iteration. The split exists to keep
the active context small and deterministic.

## Sources Of Truth

Within this migration directory:

- `00-MASTER-PLAN.md` owns individual task IDs, dependencies, and task status.
- Each numbered phase document owns task scope, acceptance, proof shape, and
  rollback guidance.
- `STATE.md` owns only the current cursor and a derived phase summary.
- `RUN-LOG.md`, `BLOCKERS.md`, and `EVIDENCE.md` own append-only history.

Do not copy a task status into a phase document. A planning/review run may amend
scope or dependencies, but it must preserve referenced task IDs and append the
reason to `RUN-LOG.md`.

The migration must preserve the observable behavior and invariants in:

- [../../ARCHITECTURE.md](../../ARCHITECTURE.md)
- [../../BACKEND_DESIGN.md](../../BACKEND_DESIGN.md)
- [../../INGEST_PROTOCOL.md](../../INGEST_PROTOCOL.md)
- [../../AUDIENCE_SPEAKING_PRODUCT_SPEC.md](../../AUDIENCE_SPEAKING_PRODUCT_SPEC.md)
- [../../VIEWER_RUNTIME_REQUIREMENTS_LOG.md](../../VIEWER_RUNTIME_REQUIREMENTS_LOG.md)
- [../../REAL_PIPELINE.md](../../REAL_PIPELINE.md)

When documents disagree, current product specifications and implemented protocol
tests take priority over historical implementation plans. Record a material
conflict in `STATE.md` and `RUN-LOG.md`; do not silently choose a convenient
interpretation.

## Starting And Stopping

Execution is active at the final verification gate. A fresh run must read
`STATE.md`, continue only its current or next task, and follow
[PROMPT.md](./PROMPT.md). Automatic CI/CD, signing, publishing, and deployment
remain disabled unless separately authorized after migration completion.

The migration is complete only when the independent final gate in
[10-CUTOVER-CLEANUP.md](./10-CUTOVER-CLEANUP.md) passes and its evidence is
indexed in [EVIDENCE.md](./EVIDENCE.md).
