# Phase 07: Test And Tooling Convergence

> Entry: `GATE-05`, `GATE-06`
>
> Exit: `GATE-07`

## Goal

Move the remaining behavioral proof and repository tooling to TypeScript/Bun
without confusing framework migration with test coverage. Every retained Python
test must end in one of three states:

```text
ported to TypeScript proof
superseded by stronger cross-process proof
deleted with an explicit behavior-level rationale
```

Passing a smaller TypeScript suite is not parity unless the ledger accounts for
the removed Python coverage.

## Repository Anchors

- Desktop tests are colocated under `apps/desktop` as `*.test.ts`.
- Python tests under `apps/backend/tests` remain the oracle until their rows in
  the coverage ledger are accepted.
- Cross-process scenarios live under `tests/e2e`.
- Synthetic and privacy-safe fixtures live under `tests/fixtures`.
- Root scripts currently coordinate pnpm, uv, Vitest, pytest, and builds.

## Target Tooling Shape

| Concern | Preferred Tool | Boundary |
| --- | --- | --- |
| Unit/integration | Vitest projects | Backend, desktop Main/preload, renderer |
| Property/model tests | fast-check | Ordering, cancellation, state machines |
| Provider fault injection | MSW | HTTP/SSE/WS boundaries |
| Renderer browser tests | Vitest Browser Mode | Critical components/stores |
| Electron end-to-end | Playwright | Real packaged/unpackaged lifecycle |
| Lint | Oxlint | Fast default static gate |
| Format | Oxfmt after spike | One formatter only |
| Dead-code/dependency audit | Knip | Reviewed config and allowlist |
| Types | `tsc --noEmit` projects | Public and internal boundaries |
| Eval | ADVX evaluator, optional Promptfoo | Agent-output requirements |

Candidate versions and Bun compatibility are locked by Phase 00 spikes, not by
this document.

## Test Taxonomy

| Layer | May Mock | Must Not Mock |
| --- | --- | --- |
| Domain | Clock/random/ports | Domain decision logic |
| Application | Provider/repository ports | Cancellation and ordering |
| Provider adapter | Remote server via MSW | Request/stream parsing |
| Persistence | Temporary database path | SQLite/Drizzle behavior |
| Protocol | Transport peer | Envelope/schema validation |
| Desktop integration | Provider backend | Electron privilege boundaries |
| Recorded E2E | Remote Providers | Electron, Bun, protocol, overlay |
| Credentialed E2E | Nothing material | Real Provider path being claimed |

## Tasks

### `TST-000` Convergence Entry Audit

After `GATE-05` and `GATE-06` are accepted:

- bind the phase to the accepted desktop and observability evidence commits;
- refresh the Python test/tool inventory without changing behavior;
- record current Vitest/Playwright/typecheck/lint/build baselines;
- identify generated, platform, credentialed, and recorded suites;
- verify every root `TST-*` task now inherits this entry barrier;
- set only the first dependency-satisfied test task to `READY`.

This task changes planning/evidence state only. It prevents an apparently
independent tooling task from bypassing the desktop or observability gates.

### `TST-001` Vitest Project Baseline

Configure explicit Vitest projects for:

- backend unit/integration;
- desktop Main/preload;
- renderer happy-dom/jsdom where appropriate;
- browser mode;
- repository contracts;
- evidence/eval scripts.

Lock timeouts, fake-timer policy, test isolation, concurrency, coverage scope,
and artifact reporters. Avoid one global environment that hides process-specific
assumptions.

### `TST-002` Python Test Coverage Ledger

Create a machine-readable ledger with one row per retained Python test module
and parametrized behavior:

```ts
type TestMigrationRow = {
  pythonTest: string
  behavior: string
  risk: 'low' | 'medium' | 'high' | 'critical'
  replacement: string[]
  proofClass: string
  status: 'unmapped' | 'ported' | 'superseded' | 'approved-delete'
  rationale?: string
  verifier?: string
}
```

Prioritize security, protocol, persistence, resource release, cancellation,
ordering, concurrency, and Provider parsing. Thin duplicate assertions may be
deleted only after the protected behavior is identified.

### `TST-003` Unit And Integration Port

Port tests alongside each migrated module. Preserve:

- table/parameter coverage;
- error and cancellation branches;
- clock and random control;
- temporary data isolation;
- transaction and rollback assertions;
- exact protocol rejection cases;
- resource cleanup.

Do not mechanically translate pytest syntax while losing fixtures or behavior.

### `TST-004` fast-check Invariants

Add seeded model/property tests for:

- monotonically handled sequence fences;
- epoch invalidation;
- stop/dispose idempotence;
- cancellation dominance over late completion;
- bounded queue/concurrency rules;
- candidate budget and rotation;
- database event ordering;
- retry/backoff caps.

On failure, persist the seed, path, minimized counterexample, and runtime
versions so the case can be replayed.

### `TST-005` MSW Provider Fault Suite

Model the remote boundaries used by AI SDK and ASR adapters:

- connection refusal and timeout;
- 401/403/429/5xx;
- malformed JSON;
- truncated/chunk-split SSE;
- WebSocket close, invalid frame, and reconnect;
- partial usage metadata;
- slow stream after cancellation;
- Provider response that violates the typed output contract.

Tests must assert normalized errors, retry eligibility, cancellation, and no
secret leakage.

### `TST-006` Protocol Fuzz And Negative Corpus

Create small deterministic corpora for:

- missing/extra/wrong-type JSON fields;
- unsupported protocol versions;
- oversized control payloads;
- invalid binary headers and lengths;
- sequence gaps, duplicates, and reordering;
- post-stop and stale-Session traffic;
- unknown event kinds;
- decompression or media metadata limits when applicable.

The server must reject safely without crash, allocation spikes, or ambiguous
partial acceptance.

### `TST-007` Vitest Browser Mode

Use a real browser for critical renderer behavior that DOM emulation cannot
prove:

- store-to-component updates;
- overlay rendering and ordering;
- pause/clear/stop transitions;
- backend loss and reconnect UI;
- microphone/system-audio source identity;
- permission/error states;
- accessibility focus and keyboard paths where applicable.

This does not replace Electron E2E for preload/IPC or OS integration.

### `TST-008` Playwright Electron E2E

Consolidate the cross-process suites around reusable fixtures:

- isolated Electron user data and backend data;
- deterministic Provider mode;
- Bun source and Bun compiled modes;
- artifact capture on failure;
- console/page/process error collection;
- Playwright trace, screenshot, video only where useful;
- orphan-process cleanup in `finally`;
- bounded startup and shutdown deadlines.

Keep one decisive recorded full-pipeline scenario fast enough for normal CI.
Move slow credentialed/platform matrices to explicit jobs.

### `TST-009` TypeScript Evidence Scripts

Port lifecycle, replay, fixture, artifact-hash, redaction, and evidence
validation scripts from Python or ad hoc shell into TypeScript.

Scripts must:

- use structured parsers;
- return stable exit codes;
- write machine-readable output;
- accept explicit artifact roots;
- clean up on signal/timeout;
- avoid mutating product data;
- run with Bun on Windows.

### `TST-010` Oxlint And Oxfmt

Adopt Oxlint as the fast default linter after comparing current ESLint/Ruff
intent and TypeScript compiler coverage. Introduce reviewed rules in stages:

1. correctness and suspicious constructs;
2. import and promise hygiene;
3. React rules;
4. type-aware rules only if runtime/cost is justified.

Evaluate Oxfmt against the repository's single quotes, no semicolons, generated
files, Markdown, YAML, and Electron/Vite configs. Keep one authoritative
formatter; do not run two formatters in sequence.

### `TST-011` Knip Baseline

Configure workspaces, entry points, binaries, generated contracts, Electron
entry files, Vite configs, tests, and intentionally dynamic modules.

Classify the first report:

- delete confirmed dead code/dependencies;
- fix missing entry configuration;
- document narrow allowlist with owner and reason;
- never blanket-ignore a directory merely to obtain green output.

### `TST-012` Bun CI Gates

Build clean CI jobs around:

```text
bun install --frozen-lockfile
contract drift check
typecheck
oxlint
format check
focused/unit tests
recorded integration/E2E
build
bun audit
artifact verification
```

Use package-manager security settings such as controlled lifecycle scripts,
reviewed trusted dependencies, and minimum release age only after confirming
their current Bun behavior. Cache speed must not weaken frozen-install proof.

### `TST-013` Dual-Runtime Parity Gate

Until `CUT-008`, run the same privacy-safe scenario against Python and Bun and
compare normalized:

- HTTP status/body;
- WebSocket event kinds and identities;
- barrage/silence behavior;
- persistence effects;
- debug snapshot;
- shutdown/resource state;
- redacted trace invariants.

Allow nondeterministic text only behind product-defined invariants or recorded
Provider output. Every difference must be classified, not dropped.

### `TST-014` Remaining Python Tooling

Use the `FND-001` entry-point inventory and explicitly account for Python files
outside the backend source and pytest suite, including:

- `scripts/fetch_sb6657_corpus.py`;
- `scripts/profile_sb6657_corpus.py`;
- `scripts/sb6657_corpus_common.py`;
- `scripts/sync_room_6657_skill.py`;
- `scripts/run_room_6657_skillopt.py`;
- `scripts/verify_viewer_runtime_evidence.py`;
- `tests/e2e/viewer_runtime_recorded_evidence.py`;
- active helpers under `apps/backend/scripts`.

For each script:

- port it to TypeScript/Bun with equivalent structured input/output and exit
  codes;
- merge it into an existing TypeScript tool when ownership is clearer; or
- approve retirement with proof that no root script, skill, CI, documentation,
  scheduled job, or developer workflow still calls it.

Preserve corpus provenance, rate limits, robots/terms boundaries, deterministic
fixtures, evidence verification, profiling output, and SkillOpt integration
semantics. The accepted inventory must show zero active Python tool entry points
before cutover, so `CUT-011` is confirmation rather than first discovery.

## Required Failure Scenarios

The phase gate must include at least:

- Provider timeout during active Session;
- cancellation racing a late model result;
- WebSocket reconnect after backend restart;
- stale epoch/sequence event;
- SQLite busy/crash-recovery path;
- malformed binary ingest;
- Electron quit during in-flight work;
- diagnostics redaction under nested error causes;
- installed/backend executable missing or wrong version;
- rollback selector returning to Python oracle.

## `GATE-07` Test And Tooling Exit

- [ ] `TST-000` binds the phase to accepted `GATE-05` and `GATE-06` evidence.
- [ ] Vitest projects reflect process/runtime boundaries.
- [ ] Every retained Python test behavior has a reviewed ledger row.
- [ ] Critical protocol, persistence, resource-release, security, and
      concurrency regressions have TypeScript proof.
- [ ] fast-check failures are reproducible from persisted seeds.
- [ ] Provider failure and protocol-negative suites pass.
- [ ] Browser Mode and Electron E2E have non-overlapping, explicit roles.
- [ ] Evidence scripts run with Bun on Windows and return structured results.
- [ ] Oxlint/Oxfmt adoption has reviewed rules and no formatter conflict.
- [ ] Knip output is classified rather than blanket-suppressed.
- [ ] Frozen-install CI, audit, typecheck, tests, build, and recorded parity pass.
- [ ] Every active Python script outside backend/test source is ported or has an
      independently approved retirement record.
- [ ] An independent checker accepts the coverage ledger and gate artifacts.

## Rollback

Keep the existing test runner and lint/format commands available until each
replacement gate passes. Tooling adoption may roll back independently from the
backend migration; test-behavior evidence may not be discarded.

## Observations

To be filled during execution.
