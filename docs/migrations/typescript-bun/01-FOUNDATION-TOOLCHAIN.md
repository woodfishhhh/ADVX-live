# Phase 00: Foundation And Toolchain

> First task: `FND-001`
>
> Entry: migration activation
>
> Exit: `GATE-00`

## Goal

Prove that the proposed Bun stack works inside ADVX Live's real Windows-first
Electron lifecycle before committing the migration to framework-specific code.
This phase locks versions, ownership, workspace shape, evidence classes, and
candidate dependency go/no-go decisions.

## Repository Anchors

- `package.json:6-17` currently routes development, backend, tests, contracts,
  evidence, and headless tools through pnpm, uv, and Python.
- `apps/backend/pyproject.toml:1-39` defines the complete Python dependency and
  pytest/ruff boundary.
- `apps/desktop/package.json:6-43` defines Electron, electron-vite, Vite,
  TypeScript, Vitest, and current smoke commands.
- `pnpm-workspace.yaml:1-12` includes only the desktop and packages.
- `docs/ARCHITECTURE.md:31-39` locks failure isolation, replaceable Providers,
  stale-result rejection, cancellation, and resource release.
- `docs/VIEWER_RUNTIME_INTEGRATION_PLAN.md:32-38` requires machine-readable
  schema, explainable async outcomes, UI-independent replay, and honest evidence.

## Proposed Workspace Shape

This is the default for the spike. `FND-010` may change it only with evidence.

```text
apps/
  backend/             # Python oracle until cutover
  backend-bun/         # TypeScript/Bun implementation during coexistence
  desktop/
packages/
  contracts/           # canonical TS runtime schemas and protocol types
  testkit/             # only if shared fixtures justify a package
```

At cutover, remove the Python app and rename `backend-bun` to `backend` in one
mechanical task. Do not use a mixed `src-python`/`src-typescript` directory.

## Candidate Dependency Gate

| Candidate | Required capability | Go condition | No-go fallback |
| --- | --- | --- | --- |
| Bun runtime | HTTP/WS, Web Streams, fetch, compile, profiles | Spikes run on supported Windows/macOS targets | Re-scope migration; do not fake Bun adoption |
| Elysia | Typed HTTP, WS/binary, abort, OpenAPI | Protocol spike passes without hidden Node server adapter | Hono or Bun.serve spike, one framework only |
| Elysia `t` / JSON Schema | Runtime validation and shared contracts | Round trips and OpenAPI are stable | TypeBox directly |
| AI SDK Core | OpenAI-compatible multimodal, structured output, abort | Recorded StepFun/model matrix passes | Thin provider-specific fetch adapter |
| `p-queue` | Concurrency, priority, rate interval | Virtual-clock policy is expressible | Small ADVX-owned queue, no Redis |
| `bun:sqlite` | Transactions, WAL, backup/reopen | Packaged path and migration spike pass | Bun SQL SQLite path or reviewed alternate driver |
| Drizzle stable | Typed schema and controlled migrations | Stable release passes existing DB migration spike | Plain SQL migrations over `bun:sqlite` |
| Pino | Structured local JSONL and redaction | Log contract remains Bun-safe | Small structured logger wrapper |
| OpenTelemetry | Trace export and propagation | Bun spike exports current trace without secrets | JSONL remains authoritative |

## Tasks

### `FND-001` Capture The Live Baseline

**Allowed scope**

- Read the repository.
- Write only migration plan state, run log, and baseline evidence.
- Do not modify product or tooling files.

**Actions**

1. Record HEAD, branch, `git status`, OS, architecture, Bun, Node, pnpm, Python,
   and uv versions.
2. Count tracked Python, TypeScript, TSX, shell, PowerShell, and generated files.
3. Catalogue root scripts and all Python entry points.
4. Catalogue backend route, WS, provider, domain, repository, migration, debug,
   headless, replay, and evidence modules.
5. Record current root validation results without fixing unrelated failures.
6. Hash representative protocol, OpenAPI, SQLite schema, recorded fixture, and
   product-spec sources.

**Baseline commands**

```powershell
git status --short --branch
git rev-parse HEAD
bun --version
node --version
pnpm --version
python --version
uv --version
git ls-files "*.py"
git ls-files "*.ts" "*.tsx"
pnpm typecheck
pnpm test
pnpm build
```

**Acceptance**

- A machine-readable inventory identifies every active Python entry point.
- Existing failures, if any, are recorded as baseline facts rather than silently
  attributed to migration work.
- The artifact is bound to the exact baseline commit and dirty-tree state.

**Evidence**

`.omx/artifacts/typescript-bun/FND-001/<run-id>/`

### `FND-002` Lock Behavioral Invariants

Extract a numbered invariant list from current product, architecture, protocol,
backend, and requirements documents. Map every invariant to at least one current
test, fixture, or explicit test gap.

At minimum include:

- loopback-only and short-lived startup authentication;
- renderer privilege isolation;
- Room/Session/audience epoch identity;
- frozen same-wave context;
- latest-wins and bounded queues;
- cancellation plus final stale-result fence;
- silence as a legal Viewer result;
- independent Viewer Provider requests;
- no recursive wave from audience barrage;
- memory evidence/deletion rules;
- deterministic fake versus live Provider evidence;
- complete 120-second frame timeline plus exact segment-reference, segment-end,
  trigger-frame, direct-frame-age, and 15-frame uniform-sampling rules;
- stop releases capture, audio, sockets, tasks, and child process.

**Gate:** an architect or verifier confirms no product invariant was reduced to a
framework implementation detail.

### `FND-003` Lock Runtime Ownership And Versions

Define:

- Bun version pin and upgrade rule;
- Node version used by Electron tooling;
- Electron-embedded Node boundary;
- supported OS and CPU architecture;
- package-manager lifecycle-script allowlist;
- `bun.lock` policy;
- TypeScript migration sequence;
- Vite/electron-vite compatibility sequence.

Do not claim that Node is removed from Electron. Do require that the backend and
active project scripts no longer need a system Python at final cutover.

### `FND-004` Bun Compiled Executable Spike

Build a disposable Bun backend executable that:

1. binds only to `127.0.0.1` on an assigned port;
2. exposes health/readiness;
3. opens SQLite under an injected temporary data directory;
4. disables compiled-executable `.env`, bunfig, and package.json autoload using
   the current Bun API/CLI controls;
5. ignores a hostile working directory containing conflicting `.env`,
   `bunfig.toml`, and `package.json`, and a parent environment containing
   `BUN_BE_BUN=1`;
6. writes one structured log;
7. handles parent-requested shutdown and OS termination;
8. exits with a documented code;
9. generates CPU and heap profiles;
10. starts without Bun installed separately.

Test standard and baseline Windows x64 targets. Record executable size, startup
time, shutdown time, child-process tree, and asset behavior.

**No-go:** unexplained orphan processes, writes beside the executable, missing
runtime assets, or an unbounded shutdown.

### `FND-005` Elysia Protocol Spike

Prove in one disposable service:

- schema-validated HTTP request/response;
- local startup-token authentication;
- WebSocket connect, message, close, and abort;
- binary frame/audio message echo using the current header layout;
- maximum payload rejection;
- bounded outbound backpressure behavior;
- OpenAPI JSON and development-only Scalar UI;
- graceful server stop.

Record whether Eden Treaty is technically viable, but defer its adoption to
`CON-008`.

### `FND-006` SQLite And Drizzle Spike

Against a copy of a synthetic representative database:

1. enable WAL and required pragmas;
2. run an explicit migration;
3. perform nested transaction/error rollback scenarios;
4. reopen after abrupt process termination;
5. verify database location outside packaged resources;
6. inspect through Drizzle Studio in development;
7. test the SQLite online Backup API path, restore, and schema-version
   reporting; do not copy an open main DB/WAL/SHM set.

Use the patched stable Drizzle line. Do not adopt a release candidate as the
migration foundation.

### `FND-007` AI SDK Provider And Scheduler Spike

Run recorded or synthetic OpenAI-compatible fixtures covering:

- text and image input;
- non-streaming and streaming response;
- structured output;
- malformed partial JSON;
- 401, 404, 408, 429, and 5xx normalization;
- `AbortSignal` during connect and during stream;
- token/usage metadata;
- one retry within a fixed deadline.

Set the AI SDK call-level retry option explicitly to zero during the spike.
ADVX owns the shared physical-request budget; SDK-internal retries must not
create hidden third or fourth HTTP requests. Instrument the transport and prove
one logical Viewer decision produces no more than two physical Provider
requests across initial call, transient retry, and protocol repair.

Exercise the proposed `p-queue`/`AbortController` boundary with:

- per-kind and per-Viewer concurrency;
- queued cancellation before start;
- in-flight cancellation;
- priority without starvation;
- rate interval and deadline interaction;
- epoch/sequence invalidation after completion;
- retry budget that cannot exceed the outer deadline;
- deterministic clock/seed control for tests.

The spike must keep AI SDK message types out of stored ADVX domain records.
Reject `p-queue` if core ordering and cancellation policies require patching its
internals; use a small ADVX-owned scheduler port instead.

### `FND-008` OpenTelemetry Spike

Produce one trace:

```text
Electron request
  -> Elysia route
  -> queue wait
  -> recorded Provider call
  -> SQLite transaction
  -> response
```

Verify trace IDs appear in JSONL logs. Verify prompt, image bytes, audio bytes,
credentials, and raw Provider payloads are absent by default.

### `FND-009` Dependency ADRs

For every accepted dependency record:

- exact version/range;
- runtime or development-only classification;
- license;
- Bun and Electron boundary;
- owner package;
- security advisories reviewed;
- update grouping;
- exit strategy.

Reject duplicate schema, HTTP, queue, logging, tracing, and state-machine
libraries unless the overlap has a measured benefit.

### `FND-010` Workspace And Command Contract

Establish an additive Bun workspace during coexistence:

- add Bun-compatible root `workspaces` metadata;
- create `apps/backend-bun` and approved shared-package entries;
- generate and commit the text `bun.lock`;
- prove `bun install --frozen-lockfile` from a clean dependency directory;
- keep `pnpm-lock.yaml` only during the explicit dual-tool transition;
- document how shared manifests avoid silent Bun/pnpm lock drift;
- review lifecycle scripts and configure only required trusted dependencies;
- keep no seven-day minimum-release-age policy: set pnpm
  `minimumReleaseAge: 0` only as the sentinel that disables pnpm v11's built-in
  one-day default, configure no pnpm exception list, and add no Bun age
  configuration;
- enforce supply-chain reproducibility through the `FND-009` exact pins,
  same-change dual-lock review, and clean frozen-install proof;
- keep the active Python backend/default unchanged until its later gate.

Then lock final package names and the intended root commands:

```text
bun install --frozen-lockfile
bun run dev
bun run dev:desktop
bun run dev:backend
bun run contracts
bun run lint
bun run format:check
bun run typecheck
bun run test
bun run build
bun run evidence:viewer-runtime
bun run migration:plan-check
```

During coexistence, keep explicit oracle commands such as `test:python-oracle`;
do not overload `test` with hidden runtime selection.

### `FND-011` Baseline And Parity Harness

Create the minimal TypeScript harness that can:

- invoke Python oracle fixtures without embedding Python assumptions in product
  code;
- normalize volatile IDs/timestamps;
- compare JSON and binary outputs;
- classify expected nondeterminism;
- write a machine-readable diff;
- run headlessly in a temporary data directory.

This harness is migration infrastructure and must have a removal/retention
decision in `CUT-010`.

Ownership boundary: `CUT-010` owns the final retain-or-remove decision and its
dead-code evidence. Until that decision, the harness stays under
`tests/parity`, is callable only through the explicit migration script, and
must not be imported by either product runtime.

### `FND-012` Migration Plan Drift Checker

Create a small TypeScript command that reads the Markdown/YAML artifacts without
rewriting them and fails on:

- broken relative links;
- missing, duplicate, or unknown task IDs;
- dependency cycles or references to missing tasks;
- more than one `IN_PROGRESS` task;
- `STATE.md` cursor/status disagreement with the master table;
- a `DONE` task without accepted evidence;
- a `VERIFY` task already presented as complete;
- identical or missing maker/checker run/context identity for `DONE`;
- a checker recorded as an implementation owner or missing the reviewed
  source-state hash;
- an active blocker missing from `BLOCKERS.md`;
- a phase marked complete before its gate is `DONE`;
- an unsatisfied master-plan Gate External Conditions row;
- a task whose dependencies allow execution before a required phase-entry gate;
- invalid status transitions or malformed frontmatter.

Keep the schema ADVX-owned and small. Evaluate the upstream Loop Engineering
`loop-sync` ideas, but do not install a general loop framework unless its value
and maintenance boundary are separately approved.

Add fixtures that intentionally trigger each failure. The clean planning
artifact in this directory must pass.

## `GATE-00` Foundation Exit

The checker must verify:

- [ ] Every spike used the live pinned Bun/Node/Electron environment.
- [ ] Backend executable launch and clean shutdown are proven.
- [ ] Elysia, SQLite, AI SDK, and tracing each have a go/no-go conclusion.
- [ ] Accepted versions and licenses are recorded.
- [ ] No product code or runtime default changed prematurely.
- [ ] The parity harness can compare at least one simple health/control fixture.
- [ ] The plan drift checker accepts the live plan and rejects malformed
      cursor, dependency, evidence, blocker, and link fixtures.
- [ ] `STATE.md` points to `CON-001` only after all required evidence is indexed.

## Rollback

This phase should be additive. Delete disposable spike outputs and revert only
the migration-specific workspace/tool files if a candidate fails. The existing
pnpm/Python application remains the executable baseline.

## Observations

To be filled during execution.
