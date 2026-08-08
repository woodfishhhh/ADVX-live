# ADVX Live TypeScript + Bun Migration Master Plan

> Status: `PLANNED`
>
> Current phase: `00`
>
> Execution state: [STATE.md](./STATE.md)
>
> Loop contract: [LOOP.md](./LOOP.md)
>
> Product code changed by this planning pass: none

## Requirements Summary

Migrate the local FastAPI/Python backend, Python tests, Python scripts, Python
packaging, and Python-owned generated contracts to TypeScript running on Bun.
Preserve the existing Electron/React product, local-first architecture, protocol
semantics, SQLite data, Provider replaceability, cancellation rules, replay
evidence, and Windows/macOS release goals.

The migration must improve agent-oriented development:

- deterministic setup and commands;
- one language across contracts and backend behavior;
- structured runtime validation;
- fault-injection and property-based tests;
- inspectable logs, traces, replay, and diagnostics;
- small, independently verifiable loop tasks;
- reliable resumption from a fresh context.

## Acceptance Criteria

| ID | Final claim | Required proof |
| --- | --- | --- |
| `AC-01` | Bun is the workspace package manager and backend runtime | Clean `bun install --frozen-lockfile`; committed text `bun.lock`; no active pnpm workspace or uv install path |
| `AC-02` | Active backend product code is TypeScript | No tracked `.py` under active app, package, script, test, or workflow paths |
| `AC-03` | Python is absent from active development and release paths | Root scripts, CI, packaging, smoke, and docs quickstarts invoke no `python`, `uv`, `pytest`, `ruff`, FastAPI, or Uvicorn |
| `AC-04` | Existing control and realtime contracts remain compatible | Versioned schema fixtures and HTTP/WS/binary parity tests pass |
| `AC-05` | Session, epoch, latest-wins, TTL, cancellation, and zero-side-effect invariants survive | Deterministic unit tests plus fast-check model/property tests pass |
| `AC-06` | Existing SQLite user data is preserved | Copy-based migration test, rollback test, schema audit, and representative data comparison pass |
| `AC-07` | StepFun ASR and OpenAI-compatible model access work through replaceable ports | Recorded provider tests plus separately labeled credentialed proof, or an authorized accepted limitation that removes the unsupported claim from release scope |
| `AC-08` | Electron owns and supervises the Bun backend safely | Dev and packaged start/health/restart/stop/orphan-process smokes pass |
| `AC-09` | The backend ships without a separate Bun installation | `bun build --compile` artifact launches from packaged Electron on required platform targets |
| `AC-10` | Debugging is materially improved | Trace-correlated JSONL, replay, diagnostics bundle, fault injection, and current-HEAD artifacts exist |
| `AC-11` | Static and automated gates are unified | `bun run lint`, `format:check`, `typecheck`, `test`, and `build` pass from the repository root |
| `AC-12` | Release security is not weakened | Loopback auth, IPC sender checks, Electron fuses, ASAR integrity, secret scanning, and crash evidence gates pass |
| `AC-13` | Fake and live evidence remain distinct | Evidence index labels deterministic fake, recorded, credentialed live, platform, `BLOCKED`, and `ACCEPTED_LIMITATION` separately |
| `AC-14` | The plan can resume safely after interruption | A fresh verifier can reconstruct the current task from `STATE`, master plan, phase plan, git, and last two run records |

## RALPLAN-DR Summary

### Principles

1. Preserve behavior before deleting the oracle.
2. Contracts and evidence lead; framework code follows.
3. One owner and one source of truth per stateful concern.
4. Every asynchronous result must be explainable as accepted or discarded.
5. The release artifact, not the development server, is the final system.

### Decision Drivers

1. Product parity and user-data safety.
2. Agent development speed and debuggability.
3. Low operational complexity for a local Electron application.

### Viable Options

| Option | Benefits | Costs and risks | Verdict |
| --- | --- | --- | --- |
| Contract-first strangler migration | Python remains an oracle; vertical slices can be compared; rollback remains available | Temporary dual runtime and duplicate test cost | Chosen |
| Big-bang rewrite | Short calendar path if everything works; no temporary adapters | Highest semantic drift, data, packaging, and debugging risk | Rejected |
| NestJS platform rewrite | Familiar modules, DI, decorators, broad ecosystem | Heavier Bun boundary, more framework surface, weak fit for local single-process runtime | Rejected |
| Keep Python and only switch package tooling | Lowest immediate effort | Does not meet the user's Python-free objective or remove two-language agent friction | Rejected |

## ADR-MIG-000: Migration Strategy

**Decision**

Use a contract-first strangler migration. Keep Python executable and tests as a
read-only behavioral oracle until each TypeScript vertical slice has accepted
parity evidence. Switch Electron through an explicit compatibility selector,
then remove Python only in the final cutover phase.

**Drivers**

- The current backend already implements nontrivial cancellation, persistence,
  Provider, protocol, and replay behavior.
- Packaged Electron lifecycle is as important as route-level correctness.
- User data must survive the migration.

**Alternatives considered**

- Big-bang replacement.
- NestJS-based platform rewrite.
- Partial toolchain-only migration.

**Why chosen**

The strangler path gives every loop iteration a bounded target, preserves a
working baseline, and enables machine-comparable evidence instead of relying on
memory or prose.

**Consequences**

- Python remains temporarily present and testable.
- Some fixtures and compatibility adapters exist only during migration.
- The final deletion phase is larger but mechanically gated.

**Follow-ups**

- Resolve candidate dependency ADRs after Phase 00 spikes.
- Record accepted decisions in `docs/DECISIONS.md`.
- Archive rather than silently overwrite historical Python design statements.

## Target Architecture

```text
Electron Main (Node boundary)
  |- safeStorage / permissions / capture / window ownership
  |- BackendSupervisor
  |    `- compiled Bun backend child process
  |- typed preload bridges
  `- React renderers
         |
         | loopback HTTP + versioned WebSocket/binary protocol
         v
Bun Backend
  |- Elysia API and OpenAPI/Scalar in development
  |- Application services and explicit ports
  |- Session / observation / audience domain
  |- ASR and model Provider adapters
  |- p-queue + AbortController + epoch/sequence fences
  |- bun:sqlite + Drizzle + WAL/outbox
  `- JSONL / OTel / replay / diagnostics
```

Electron's embedded Node runtime remains an explicit platform boundary. Backend
domain and application packages must not import Electron.

## Dependency Graph

```text
Phase 00 Foundation
  |\
  | `------> Phase 01 Contracts
  |             |\
  v             v \
Phase 02 Backend  Phase 03 Data
       \           /
        v         v
        Phase 04 Agent Runtime
                |
                v
        Phase 05 Desktop Integration
                |
                v
        Phase 06 Observability
                |
                v
        Phase 07 Test Convergence
                |
                v
          Phase 08 Packaging
                  |
                  v
          Phase 09 Cutover
```

Tests are written with each task. Phase 07 migrates and unifies the remaining
test/tool surface; it is not permission to defer all testing until late.

## Phase Overview

| Phase | Outcome | Plan | Entry gate | Exit gate |
| --- | --- | --- | --- | --- |
| 00 | Candidate stack is proven on this machine and versions are locked | [01](./01-FOUNDATION-TOOLCHAIN.md) | Plan activated | `GATE-00` |
| 01 | TypeScript owns canonical HTTP/WS/binary contracts | [02](./02-CONTRACTS-PROTOCOL.md) | `GATE-00` | `GATE-01` |
| 02 | Bun backend shell implements control/session lifecycle | [03](./03-BUN-BACKEND.md) | `GATE-01` | `GATE-02` |
| 03 | Bun owns safe SQLite persistence and migrations | [04](./04-DATA-PERSISTENCE.md) | `GATE-01` | `GATE-03` |
| 04 | ASR, model, observation, audience, and barrage runtime reach parity | [05](./05-AGENT-RUNTIME.md) | `GATE-02`, `GATE-03` | `GATE-04` |
| 05 | Electron can supervise either backend and then Bun by default | [06](./06-DESKTOP-INTEGRATION.md) | `GATE-04` | `GATE-05` |
| 06 | Runtime is traceable, replayable, evaluable, and diagnosable | [07](./07-OBSERVABILITY-REPLAY.md) | `GATE-05` | `GATE-06` |
| 07 | TypeScript tests and static tooling cover the migrated behavior | [08](./08-TEST-TOOLING.md) | `GATE-05`, `GATE-06` | `GATE-07` |
| 08 | Compiled Bun backend ships inside hardened Electron packages | [09](./09-PACKAGING-SECURITY.md) | `GATE-07` | `GATE-08` |
| 09 | Bun is the only active backend and Python is safely removed | [10](./10-CUTOVER-CLEANUP.md) | `GATE-08` | `GATE-09` |

## Master Task Table

This table is canonical for individual task status and dependencies. Numbered
phase documents define task scope, proof, and rollback without duplicating
mutable status. `STATE.md` contains only the current cursor and derived phase
summary.

### Phase 00: Foundation And Toolchain

| ID | Status | Task | Depends | Proof |
| --- | --- | --- | --- | --- |
| `FND-001` | `DONE` | Capture current backend, script, test, protocol, DB, and packaging inventory | none | Versioned baseline report |
| `FND-002` | `DONE` | Freeze migration invariants and parity fixture classes | `FND-001` | Invariant checklist reviewed |
| `FND-003` | `DONE` | Lock Bun/Node/Electron runtime ownership and version policy | `FND-001` | Compatibility matrix |
| `FND-004` | `DONE` | Spike Bun Windows executable compilation and lifecycle | `FND-003` | Launch/stop/profile artifact |
| `FND-005` | `DONE` | Spike Elysia HTTP, WebSocket, binary payload, OpenAPI, and abort behavior | `FND-003` | Protocol spike report |
| `FND-006` | `DONE` | Spike `bun:sqlite` + stable Drizzle + WAL + packaged data path | `FND-003` | DB reopen/migration artifact |
| `FND-007` | `DONE` | Spike AI SDK Provider plus p-queue scheduling, cancellation, and deadlines | `FND-002`, `FND-003` | Recorded Provider/scheduler matrix |
| `FND-008` | `DONE` | Spike Bun OpenTelemetry export and redaction | `FND-003` | Local trace artifact |
| `FND-009` | `DONE` | Decide approved dependencies, exact versions, licenses, and owners | `FND-004..008` | ADR set |
| `FND-010` | `DONE` | Establish coexistence Bun workspace, text lock, package layout, and root command contract | `FND-009` | Frozen-install workspace proof |
| `FND-011` | `DONE` | Add migration-only baseline/parity harness without switching runtime | `FND-002`, `FND-010` | Baseline harness passes |
| `FND-012` | `DONE` | Add a TypeScript plan/state/link/dependency drift checker for the migration loop | `FND-010` | Negative and clean plan checks |
| `GATE-00` | `DONE` | Independent foundation review | `FND-001..012` | Accepted phase evidence |

### Phase 01: Contracts And Protocol

| ID | Status | Task | Depends | Proof |
| --- | --- | --- | --- | --- |
| `CON-001` | `DONE` | Catalogue Pydantic models, OpenAPI routes, WS envelopes, and binary codecs | `GATE-00` | Contract inventory |
| `CON-002` | `DONE` | Establish canonical TypeScript schema package and version constants | `CON-001` | Schema type/runtime checks |
| `CON-003` | `DONE` | Port identifiers, timestamps, enums, errors, and common metadata | `CON-002` | Fixture round trips |
| `CON-004` | `DONE` | Port control-plane request/response contracts | `CON-003` | OpenAPI parity |
| `CON-005` | `DONE` | Port realtime JSON event envelopes | `CON-003` | Cross-runtime fixtures |
| `CON-006` | `DONE` | Port binary audio/frame ingest header and codec | `CON-003` | Byte-for-byte fixtures |
| `CON-007` | `DONE` | Generate development OpenAPI/Scalar surface from Elysia schemas | `CON-004` | Snapshot and UI smoke |
| `CON-008` | `DONE` | Decide Eden Treaty versus generated OpenAPI control client | `CON-007` | `ADR-MIG-002` |
| `CON-009` | `DONE` | Create Python-oracle versus TypeScript contract parity suite | `CON-004..006` | Parity report |
| `CON-010` | `DONE` | Add version negotiation and incompatible-client rejection | `CON-005`, `CON-006` | Negative protocol tests |
| `GATE-01` | `DONE` | Independent contract/protocol review | `CON-001..010` | Accepted phase evidence |

### Phase 02: Bun Backend Shell

| ID | Status | Task | Depends | Proof |
| --- | --- | --- | --- | --- |
| `BCK-001` | `DONE` | Create backend package with domain/application/api/infrastructure/providers boundaries | `GATE-01` | Dependency-direction check |
| `BCK-002` | `DONE` | Add typed config loading and validation without leaking secrets | `BCK-001` | Config error tests |
| `BCK-003` | `DONE` | Implement loopback bind, startup token auth, health, and readiness | `BCK-002` | Auth/health integration |
| `BCK-004` | `DONE` | Define clocks, IDs, cancellation, storage, and Provider ports | `BCK-001` | Port contract tests |
| `BCK-005` | `DONE` | Port room and session lifecycle state machine | `BCK-004` | State transition parity |
| `BCK-006` | `DONE` | Port runtime-spec validate/apply/rollback and epoch fencing | `BCK-005` | Hot-reload parity |
| `BCK-007` | `DONE` | Implement Elysia control routes using canonical schemas | `BCK-003`, `BCK-006` | HTTP parity |
| `BCK-008` | `DONE` | Implement authenticated WebSocket hub and bounded connections | `BCK-003`, `CON-010` | WS lifecycle tests |
| `BCK-009` | `DONE` | Implement binary ingest dispatch with size/backpressure limits | `BCK-008`, `CON-006` | Binary fault tests |
| `BCK-010` | `DONE` | Implement clean startup, signal handling, shutdown, and exit codes | `BCK-007..009` | Process smoke |
| `BCK-011` | `DONE` | Compare control/session vertical slice with Python oracle | `BCK-005..010` | Recorded parity |
| `GATE-02` | `DONE` | Independent backend-shell review | `BCK-001..011` | Accepted phase evidence |

`GATE-02` was accepted by root Checker `gate-02-checker-root-20260803-001` in a
run/context distinct from Recovery Maker002 after the human explicitly directed
the root to continue without subagents. The Checker matched all 22 accepted
dependency-evidence hashes, five protected boundaries, and the 44-source Bun
backend aggregate, then passed strict TypeScript, the production boundary
check, the focused BCK-003 suite, and live plan-check. Phase 02 is `DONE`; only
`DAT-001` is promoted and no Phase 03 implementation has started.

### Phase 03: Data Persistence

| ID | Status | Task | Depends | Proof |
| --- | --- | --- | --- | --- |
| `DAT-001` | `DONE` | Map Alembic/SQLAlchemy schema and transaction ownership | `GATE-01` | Schema/owner matrix |
| `DAT-002` | `DONE` | Lock stable Drizzle version and migration runner | `DAT-001`, `FND-006` | `ADR-MIG-001` |
| `DAT-003` | `DONE` | Implement data-directory ownership, WAL, pragmas, and connections | `DAT-002`, `BCK-001` | Reopen/WAL tests |
| `DAT-004` | `DONE` | Port room, session, runtime revision, and config repositories | `DAT-003` | Repository parity |
| `DAT-005` | `DONE` | Port viewer pool, presence, moderation, and private state | `DAT-003` | Deterministic restore |
| `DAT-006` | `DONE` | Port room events and bounded working-history persistence | `DAT-003` | Ordering/retention tests |
| `DAT-007` | `DONE` | Port long-term memory, evidence references, and deletion semantics | `DAT-006` | Memory lifecycle tests |
| `DAT-008` | `DONE` | Port mode meme event log, undo, decay, and archive semantics | `DAT-006` | Meme lifecycle tests |
| `DAT-009` | `DONE` | Add durable outbox/job records needed for restart recovery | `DAT-004..008` | Crash/restart test |
| `DAT-010` | `DONE` | Build SQLite-Backup-API-based Python DB to Bun schema migration and rollback | `DAT-004..009` | Migration comparison |
| `DAT-011` | `DONE` | Add corruption, lock, disk-full, and migration-failure handling | `DAT-010` | Fault artifacts |
| `GATE-03` | `DONE` | Independent persistence review | `DAT-001..011` | Accepted phase evidence |

Distinct root Checker `gate-03-checker-root-20260804-001` matched all 25 Maker
hashes and recorded a 40-file current persistence/source aggregate. Fresh
strict TypeScript, the 64-source boundary check, and the complete persistence
folder pass 38 tests across 10 files with 363 assertions. A fresh disposable
six-migration WAL probe passes all 13 latency, bound, atomicity, Top-K, batch,
yield, and event-loop checks under 438 interleaved reads. Copy-and-swap,
stopped-source comparison, untouched-backup restore, and Python ownership of
live user data remain intact. `GATE-03` and Phase 03 are `DONE`; only
`AGT-001` is promoted to `READY`, and no Phase 04 implementation has started.
Evidence:
`.omx/artifacts/typescript-bun/GATE-03/gate-03-checker-root-20260804-001/`.

Root Maker `gate-03-maker-root-20260804-001` mapped all eight persistence exit
criteria to the 11 accepted DAT records. The previously missing measured-budget
criterion now uses a real all-migrations WAL database under 438 interleaved
background reads. All 13 budgets pass for RoomEvent append, bounded recent
context, atomic runtime revision, 32-Viewer restore, Top-K memory, bounded and
yielding outbox batches, and event-loop p95. `D-044` records the measured
limits. Strict backend TypeScript, all accepted-evidence manifest receipts,
diff hygiene, and live plan-check pass. `GATE-03` and Phase 03 are `VERIFY`;
Phase 04 remains `TODO` pending a distinct Checker. Candidate evidence:
`.omx/artifacts/typescript-bun/GATE-03/gate-03-maker-root-20260804-001/`.

Distinct root Checker `dat-011-checker-root-20260804-001` matched all 27 Maker
hashes, passed fresh strict TypeScript, five focused tests with 40 assertions,
the 64-source boundary check, diff hygiene, and one bounded independent probe.
The probe verifies existing-only recovery creates no database in an existing
wrong directory, corrupt bytes and a future journal remain unchanged, explicit
preservation state is not overwritten, and an orphan SHM fails closed. Source
review confirms all ten required injection classes are real or explicitly
simulated at their OS boundary and produce retryable, failed-closed,
rolled-back, or committed status. `DAT-011` is `DONE`; Phase 03 and only
`GATE-03` are `READY`. Evidence:
`.omx/artifacts/typescript-bun/DAT-011/dat-011-checker-root-20260804-001/`.

Root Maker `dat-011-maker-root-20260804-001` added machine-classifiable SQLite
fault statuses and fail-closed recovery boundaries without starting `GATE-03`.
Focused real injection covers lock and timeout contention, read-only and
disk-full writes, a corrupted copy, future schema, interrupted migration,
transaction exception, child-process crashes before/after commit, and an
orphan sidecar. Prior usable state remains readable where possible, and
existing-only recovery refuses to create an empty database in a missing or
mismatched directory. Strict TypeScript, five DAT-011 tests with 40 assertions,
three directly affected persistence suites with 87 assertions, the 64-source
boundary check, and diff hygiene pass. `DAT-011` and Phase 03 are `VERIFY`;
`GATE-03` remains `TODO` pending a distinct Checker. Candidate evidence:
`.omx/artifacts/typescript-bun/DAT-011/dat-011-maker-root-20260804-001/`.

Recovery Maker `dat-004-recovery-maker-root-20260804-001` repaired only the two
repository parity gaps rejected by the prior Checker. Session-start identity
lookup now returns the existing Session for the same client request ID and
canonical hash and rejects a changed hash with a stable optimistic conflict;
Room clear now physically deletes the Room and relies on the reviewed foreign
keys to cascade Session and runtime revision rows. Strict TypeScript, the three
focused DAT-004 tests with 25 assertions, four directly affected port tests
with 23 assertions, and the 55-source boundary check pass. `DAT-004` and Phase
03 are `VERIFY` pending a distinct recovery Checker; DAT-005 remains `TODO`.

Recovery Checker `dat-004-recovery-checker-root-20260804-001`, in a distinct
run/context that did not participate in Maker implementation, matched all 30
candidate hashes. Fresh targeted gates and a Checker-owned disposable probe
accept matching Session-start recovery, changed-hash conflict, destructive
Room-clear rollback, and committed foreign-key cascade to zero dependent rows.
`DAT-004` is `DONE`; Phase 03 and only `DAT-005` are `READY`.

Root Maker `dat-005-maker-root-20260804-001` added a sequential immutable
Viewer table migration, matching Drizzle schema, and a caller-transaction-owned
repository for deterministic restore, lifecycle/moderation/behavior CAS,
bounded private state, population metadata, and permanent Session-scoped ID
tombstones. A close/reopen test restores active, left, and kicked Viewers in
Persona/ordinal/ID order; rollback tests couple Viewer and population changes.
Strict TypeScript, three focused DAT-005 tests with 24 assertions, the three
directly affected DAT-004 tests with 25 assertions, and the 56-source boundary
check pass. `DAT-005` and Phase 03 are `VERIFY` pending a distinct Checker;
`DAT-006` remains `TODO`.

Root Checker `dat-005-checker-root-20260804-001`, in a distinct run/context,
matched all 37 Maker hashes and passed strict TypeScript plus the three focused
tests. It rejected the schema claim: DAT-001 freezes exactly 14 database
defaults for `session_viewer_instances`, while both the target SQL migration
and Drizzle declaration add a fifteenth default, `state='active'`. A disposable
real-migration probe reproduces the exact unexpected default. `DAT-005` and
Phase 03 are `BLOCKED` at attempt 1; `DAT-006` remains `TODO`.

Recovery Maker `dat-005-recovery-maker-root-20260804-001` removed only the
unreviewed Viewer `state` default from migration SQL and Drizzle, updated the
exact migration checksum, and locked the accepted 14-default set plus omitted
required-state failure in the focused test. Strict TypeScript, three DAT-005
tests with 26 assertions, three directly affected DAT-004 tests with 25
assertions, and the prior Checker-owned migration probe now pass. `DAT-005` and
Phase 03 are `VERIFY` pending a distinct recovery Checker; `DAT-006` remains
`TODO`.

Recovery Checker `dat-005-recovery-checker-root-20260804-001`, in a distinct
run/context that did not participate in Recovery Maker implementation, matched
all 20 candidate hashes and confirmed the recovery source delta is confined to
the four declared migration, schema, and focused-test files. Fresh targeted
gates and a Checker-owned disposable migration probe accept the exact 14
DAT-001 defaults, required explicit Viewer storage state, and matching migration
checksum. `DAT-005` is `DONE`; Phase 03 and only `DAT-006` are `READY`.

Root Maker `dat-006-maker-root-20260804-001` added the exact current
`room_events` storage shape as immutable migration 0003 plus matching Drizzle
schema and a typed repository under the existing transaction boundary. The
repository canonicalizes and hashes bounded source-specific payloads, provides
exact idempotent append and strictly ordered recovery, prunes each source by
its own cutoff/count in the append transaction, and builds bounded public and
reply windows while retaining event evidence references. Audience barrage is
excluded from public context and Observation triggers. Strict TypeScript,
three DAT-006 tests with 33 assertions, the directly affected DAT-004 and
DAT-005 tests, and the 57-source boundary check pass. `DAT-006` and Phase 03
are `VERIFY`; `DAT-007` and `DAT-008` remain `TODO` pending a distinct Checker.

Root Checker `dat-006-checker-root-20260804-001`, in a distinct run/context,
matched all 31 Maker hashes and passed the focused suite and boundary check. It
rejected accepted-barrage evidence parity: the real Python `model_dump` payload
includes explicit `null` for the unused side of each event/frame evidence
union. The Python oracle accepts that exact shape, but the Bun Room-event
factory rejects it as `invalid_record`, blocking durable accepted barrage with
evidence. `DAT-006` and Phase 03 are `BLOCKED` at attempt 1; `DAT-007` and
`DAT-008` remain `TODO`.

Recovery Maker `dat-006-recovery-maker-root-20260804-001` repaired only the
accepted-barrage evidence null-shape blocker. The validator now accepts omitted
or explicit `null` for the unused union field while preserving the required
event/frame identity checks, and the focused test uses the exact Python
model-dump shape. Strict TypeScript, three DAT-006 tests with 33 assertions, the
57-source boundary check, and the original Checker blocker probe pass.
`DAT-006` and Phase 03 are `VERIFY` pending a distinct recovery Checker;
`DAT-007` and `DAT-008` remain `TODO`.

Recovery Checker `dat-006-recovery-checker-root-20260804-001`, in a distinct
run/context that did not participate in the repair, matched all 35 candidate
hashes and confirmed the product delta is exactly the validator and focused
test. Fresh strict TypeScript, three DAT-006 tests with 33 assertions, the
57-source boundary check, and a Checker-owned three-case probe pass. The exact
Python model-dump null shape is accepted while an empty event ID and negative
frame index remain rejected. `DAT-006` is `DONE`; Phase 03 and only `DAT-007`
are `READY`; `DAT-008` remains `TODO`.

Root Maker `dat-007-maker-root-20260804-001` completed only `DAT-007` without
subagents. Immutable migration 0004 and matching Drizzle declarations port the
current four-table Room long-term-memory shape, including detached evidence
snapshots and revision-zero heads for existing and new Rooms. The typed
caller-transaction repository implements evidence-backed candidate commit,
exact idempotency, head/revision fences, bounded active selection,
edit/merge/replace, revoke/delete/reset, and rollback. Strict TypeScript, four
DAT-007 tests with 53 assertions, nine directly affected DAT-004..006 tests
with 84 assertions, and the 58-source boundary check pass. Phase 03 and
`DAT-007` are `VERIFY`; `DAT-008` remains `TODO` pending a distinct Checker.

Root Checker `dat-007-checker-root-20260804-001`, in a distinct run/context,
matched all 37 Maker hashes and passed strict TypeScript, four focused tests
with 53 assertions, diff hygiene, and the 58-source boundary check. It rejected
the schema-parity claim: DAT-001 freezes seven CHECK constraints for
`room_long_term_memories` and four for `room_memory_candidates`, while SQL
migration 0004 and Drizzle add an unreviewed `type_allowed` check to each. A
Checker-owned real-migration probe reports all 11 required checks and exactly
the two unexpected checks. `DAT-007` and Phase 03 are `BLOCKED` at attempt 1;
`DAT-008` remains `TODO`.

Root Recovery Maker `dat-007-recovery-maker-root-20260804-001` completed only
the bounded `DAT-007-MEMORY-TYPE-CHECK-DRIFT` repair. The two unreviewed SQL and
Drizzle type checks are removed, migration 0004's checksum matches its repaired
bytes, and the focused test now locks the exact DAT-001 CHECK sets for all four
memory tables. Strict TypeScript, four DAT-007 tests with 57 assertions, nine
directly affected DAT-004..006 tests with 84 assertions, the 58-source boundary
check, and the original Checker probe pass. Phase 03 and `DAT-007` are
`VERIFY`; `DAT-008` remains `TODO` pending a distinct Recovery Checker.

Recovery Checker `dat-007-recovery-checker-root-20260804-001`, in a distinct
run/context that did not participate in the repair, matched all 24 candidate
hashes and confirmed the recovery product delta is exactly the four declared
migration, checksum, schema, and focused-test files. Fresh strict TypeScript,
four DAT-007 tests with 57 assertions, diff hygiene, the 58-source boundary
check, and a Checker-owned disposable migration probe pass. The probe derives
all four exact CHECK sets from DAT-001, finds zero missing or unexpected
constraints, confirms the immutable checksum, and confirms invalid memory
types still fail at the repository boundary. `DAT-007` is `DONE`; Phase 03 and
only `DAT-008` are `READY`.

Root Maker `dat-008-maker-root-20260804-001` completed only `DAT-008` without
subagents. Immutable migration 0005 and matching Drizzle declarations port the
exact four DAT-001 Mode meme tables. Typed ports and a caller-transaction-owned
repository implement Mode namespace isolation, pending/accepted/rejected
candidates, automatic ingestion with revision CAS, normalized Python-compatible
source provenance, immutable lifecycle events, revision-checked edit and undo,
restore, disable, pin/use tracking, decay selection, archive, exact
idempotency, and rollback. Strict TypeScript and four focused DAT-008 tests
with 56 assertions pass; 13 directly affected shared persistence tests with
141 assertions and the 59-source boundary check pass. `DAT-008` and Phase 03
are `VERIFY`; `DAT-009` remains `TODO` pending a distinct Checker.

Root Checker `dat-008-checker-root-20260804-001`, in a distinct run/context
that did not participate in Maker implementation, matched all 38 candidate
hashes. Fresh strict TypeScript, four focused tests with 56 assertions, diff
hygiene, and the 59-source boundary check pass. A Checker-owned disposable
migration probe derives the four authoritative DAT-001 tables and confirms all
35 columns, 16 CHECK constraints, four foreign keys, two indexes, one unique
constraint, and migration 0005's checksum. Source review confirms that Mode
namespace selection and mutations stay isolated, Python-shaped provenance and
immutable revision events are durable, undo/archive transitions roll back
atomically, and candidates never enter Room events. `DAT-008` is `DONE`; Phase
03 and only `DAT-009` are `READY`.

Root Maker `dat-009-maker-root-20260804-001` completed only `DAT-009` without
subagents. Immutable migration 0006 and matching Drizzle declarations add one
durable outbox/job table for committed domain events, eligible memory/meme
side effects, and migration/recovery markers. Typed ports and the
caller-transaction-owned repository implement exact idempotency, bounded
leases, expired-lease reclaim, retry availability, terminal settlement, and
Room/session-epoch/Viewer-sequence fences. Transient Provider/media state is
rejected from durable payloads. Strict TypeScript and four focused DAT-009
tests with 39 assertions pass; 17 directly affected DAT-004..008 tests with
197 assertions, diff hygiene, and the 60-source boundary check pass. `DAT-009`
and Phase 03 are `VERIFY`; `DAT-010` remains `TODO` pending a distinct
Checker.

Root Checker `dat-009-checker-root-20260804-001`, in a distinct run/context
that did not participate in Maker implementation, matched all 29 candidate
hashes. Fresh strict TypeScript, four DAT-009 tests with 39 assertions, diff
hygiene, and the 60-source boundary check pass. A Checker-owned disposable
restart probe independently proves expired-lease reclaim after reopen, stale
attempt rejection, Session-epoch fencing, bounded claim enforcement,
Provider-request payload rejection, and terminal cancellation across another
reopen. Source review confirms that only committed domain events, eligible
memory/meme side effects, and migration/recovery markers are modeled as
durable work; in-flight Provider work is not resumable. `DAT-009` is `DONE`;
Phase 03 and only `DAT-010` are `READY`.

Root Maker `dat-010-maker-root-20260804-001` completed only `DAT-010` without
subagents. A retained Python Online Backup API adapter captures the real
Python-owned SQLite database while its WAL is active, records app/schema
versions, verifies integrity and SHA-256, and emits a closed artifact without
WAL/SHM sidecars. After both backends stop, the migration copies only that
artifact into an isolated workspace, proves semantic schema compatibility,
adopts the exact Bun migration baseline, applies version 6, compares full
pre-existing table digests, and passes Bun read/write/restart plus untouched
backup restoration. The source bytes remain unchanged. Rehearsal selects
`copy-and-swap`; Bun-owned online backup and destructive Bun migration remain
prohibited. Strict TypeScript and two focused tests with 33 assertions pass,
along with the directly affected DAT-002, DAT-003, and DAT-009 tests, the
62-source boundary check, Python Ruff, and diff hygiene. `DAT-010` and Phase 03
are `VERIFY`; `DAT-011` remains `TODO` pending a distinct Checker.

Root Checker `dat-010-checker-root-20260804-001`, in a distinct run/context
that did not participate in Maker implementation, matched all 38 candidate
hashes. Fresh strict TypeScript, two DAT-010 tests with 33 assertions, diff
hygiene, and the 62-source boundary check pass. It rejected the migration's
cutoff safety: the online backup completes before both backends stop, and the
candidate never compares the stopped source's logical state with that earlier
backup. A Checker-owned real Python/Bun probe commits one Room write in that
window. Migration returns success even though the stopped source contains the
row and both the migrated working copy and rollback copy omit it; the source
and backup hashes also differ. `DAT-010` and Phase 03 are `BLOCKED` at attempt
1; `DAT-011` remains `TODO`.

Root Recovery Maker `dat-010-recovery-maker-root-20260804-001` repaired only
the `DAT-010-POST-BACKUP-WRITE-WINDOW` boundary. After both backends stop and
before creating the working directory, the migration now compares the stopped
Source's exact legacy table set, row counts, and deterministic semantic digests
with the closed backup, failing as `comparison_failed` on any mismatch. The
focused regression repeats the Checker's valid post-backup Room write and now
proves no working database, Bun journal, or outbox is created while the Source
retains the late row. Strict TypeScript and all three DAT-010 tests with 39
assertions, the 62-source boundary check, and diff hygiene pass. `DAT-010` and
Phase 03 are `VERIFY`; the blocker remains active at attempt 1 pending a
distinct Recovery Checker, and `DAT-011` remains `TODO`.

Root Recovery Checker `dat-010-recovery-checker-root-20260804-001`, in a
distinct run/context that did not participate in the repair, matched all 27
Recovery Maker hashes and confirmed exactly two product files differ from the
rejected candidate. Fresh strict TypeScript, three DAT-010 tests with 39
assertions, diff hygiene, and the 62-source boundary check pass. The original
Checker-owned real late-write scenario now fails as `comparison_failed` before
working-copy creation, with no migration success; Source retains the committed
row and no Bun journal/outbox is adopted. The accepted online backup,
copy-and-swap migration/restart/restore rehearsal, and destructive-migration
prohibition remain intact. `DAT-010` is `DONE`; Phase 03 and only `DAT-011` are
`READY`.

Root Checker `dat-002-checker-root-20260803-001`, in a run/context distinct
from the Maker, matched all 20 candidate hashes and accepted `ADR-MIG-001` plus
the executable ADVX-owned migration runner. The exact stable runtime pin is
`drizzle-orm@0.45.2`; Drizzle Kit/Studio is absent from the installed graph.
Reviewed plain SQL, sequential names, exact checksums, the immutable journal,
atomic rollback, and the fail-closed Online Backup API port are locked.
`DAT-001..002` are `DONE`; only `DAT-003` is promoted and no `DAT-003`
implementation has started.

### Phase 04: Agent Runtime

| ID | Status | Task | Depends | Proof |
| --- | --- | --- | --- | --- |
| `AGT-001` | `DONE` | Define normalized Provider capabilities, errors, usage, and cancellation | `GATE-02`, `GATE-03` | Provider contract tests |
| `AGT-002` | `DONE` | Port StepFun ASR, isolated channels, and coordinated turn/degraded semantics | `AGT-001` | Recorded SSE/turn parity |
| `AGT-003` | `DONE` | Implement AI SDK based `ModelGateway` with SDK retries disabled | `AGT-001`, `FND-007` | Recorded physical-request matrix |
| `AGT-004` | `DONE` | Validate all model outputs against canonical schemas | `AGT-003` | Malformed-output tests |
| `AGT-005` | `DONE` | Implement bounded queue, priority, rate gate, retry, and timeout policy | `AGT-001` | Virtual-clock tests |
| `AGT-006` | `DONE` | Port ObservationWave merge, frozen context, exact 120-second/15-frame bundle, and triggers | `AGT-005` | Wave/frame parity |
| `AGT-007` | `DONE` | Port SessionAudience and deterministic Viewer pool behavior | `GATE-03`, `AGT-005` | Restore/allocation tests |
| `AGT-008` | `DONE` | Port immutable per-Viewer context and independent barrage/silence decision contract | `AGT-006`, `AGT-007`, `AGT-009` | Per-Viewer isolation/context fixtures |
| `AGT-009` | `DONE` | Port deterministic candidate budgets, rotation, mentions, and ambient selection; no Director | `AGT-006`, `AGT-007` | Seeded selection tests |
| `AGT-010` | `DONE` | Port independent Viewer generation and silence/barrage results | `AGT-003`, `AGT-004`, `AGT-008` | Multi-viewer fixtures |
| `AGT-011` | `DONE` | Port barrage validation, dedupe, density, evidence, and publication | `AGT-010` | Pipeline parity |
| `AGT-012` | `DONE` | Port memory extraction and meme persistence side effects | `AGT-009`, `AGT-011`, `GATE-03` | Side-effect tests |
| `AGT-013` | `DONE` | Prove epoch/sequence/TTL/cancelled stale work has zero side effects | `AGT-005..012` | Property/race evidence |
| `AGT-014` | `DONE` | Add deterministic fake and recorded Provider adapters | `AGT-002`, `AGT-003` | Offline replay |
| `AGT-015` | `DONE` | Run separately labeled credentialed ASR/model capability proof | `AGT-014` | Live evidence or authorized accepted limitation |
| `GATE-04` | `DONE` | Independent agent-runtime review | `AGT-001..014` | Accepted phase evidence plus external-condition table |

Distinct root Checker `agt-014-checker-root-20260804-002` matched all 38 Maker
manifest entries and recomputed the eight-file source aggregate as
`b4042fc6f6f80b841fe262631c0cf29478a4cb263c1c47ff4a02d4efbbcbf58d`.
Source review confirms deterministic fake and sanitized recorded ASR/model
adapters expose explicit evidence metadata, deterministic latency,
configured failure, caller/deadline abort controls, and no live fallback.
Fresh AGT-014 tests pass 4/16; AGT-002 passes 11/56; AGT-003 passes 5/36;
strict backend TypeScript, the 85-source import-boundary check, targeted
source hygiene, and final live plan-check pass. Verdict: PASS. `AGT-014` is
`DONE`; Phase 04 is `READY`; only dependency-satisfied `AGT-015` is promoted
to `READY`; `current_task=null`, `next_task=AGT-015`, and
`same_blocker_attempts=0`. No credentialed-live Provider claim is made; that
proof belongs to `AGT-015`. `EVIDENCE.md` now records the accepted proof;
`BLOCKERS.md` is unchanged. Evidence:
`.omx/artifacts/typescript-bun/AGT-014/agt-014-checker-root-20260804-002/`.

Distinct root Checker `agt-015-checker-root-20260804-002` matched all 29 Maker
manifest entries and recomputed the two-file source aggregate as
`c98a5fba70a06ae8a9409276e3e8c9bc5ded88ff6d0c1559dd5d98bc73388b80`.
Fresh credentialed live proof independently passed: the real StepFun ASR
adapter returned final events for isolated `microphone` and `system_audio`,
and the real OpenAI-compatible `step-3.7-flash` Viewer call accepted a PNG
image and returned non-empty text with `finishReason=stop`. Capability probes
passed; caller cancellation returned `aborted`; expired deadlines returned
`timeout` for both Provider families; the explicit-consent guard rejected a
run without `AGT015_LIVE_CONSENT=1`. Strict backend TypeScript, secret hygiene,
and final live plan-check pass. Verdict: PASS. `AGT-015` is `DONE`; Phase 04
is `READY`; only dependency-satisfied `GATE-04` is promoted to `READY`;
`current_task=null`, `next_task=GATE-04`, and `same_blocker_attempts=0`. No
GATE-04 completion claim is made. `EVIDENCE.md` now records the accepted
Checker proof; `BLOCKERS.md` is unchanged. Evidence:
`.omx/artifacts/typescript-bun/AGT-015/agt-015-checker-root-20260804-002/`.

Root Maker `gate-04-maker-root-20260804-001` performed the phase-exit review
against the current `05-AGENT-RUNTIME.md` checklist. Accepted DONE evidence
covers no-Director semantics (`AGT-009`), isolated/cancellation-safe ASR and
turn degradation (`AGT-002`, `AGT-013`), replaceable ModelGateway and the
two-request retry budget (`AGT-001`, `AGT-003`), exact wave/frame timing
(`AGT-006`), local deterministic selection and independent Viewers
(`AGT-007..010`), barrage fences/publication (`AGT-011`), nonblocking
memory/meme side effects (`AGT-012`), and separately classified
fake/recorded/live Provider evidence (`AGT-014`, `AGT-015`). Current source
manifests and accepted evidence are bound to HEAD
`41665a96cf67eb82cbe02f83abbbe2b79b100e48`; baseline live plan-check passes
133 tasks, 72 links, 63 accepted records, and 0 errors. `GATE-04` and Phase 04
are `IN_PROGRESS`; `current_task=GATE-04`, `next_task=null`, and
`same_blocker_attempts=0`. Candidate evidence:
`.omx/artifacts/typescript-bun/GATE-04/gate-04-maker-root-20260804-001/`.

Distinct root Checker `gate-04-checker-root-20260804-002` matched all 49 Maker
manifest entries with zero mismatches and independently reviewed the current
HEAD source. The accepted AGT-001 through AGT-015 matrix satisfies the
agent-runtime checklist: no structural Director implementation, isolated ASR
channels, degraded/late-pairing and stale-work fences, replaceable ModelGateway
with SDK retries disabled, exact wave/frame timing, deterministic selection,
independent Viewers, barrage fences, nonblocking memory/meme side effects, and
separate fake/recorded/live evidence. Strict backend TypeScript, the
85-production-source import-boundary check, and final live plan-check pass with
133 tasks, 72 links, 64 accepted records, and zero errors. Verdict: PASS;
`GATE-04` is `DONE`, Phase 04 is `READY`, and the phase promotion exposes only
`DES-001` as `READY` in Phase 05. This gate does not claim Electron/Bun
supervision, route wiring, or orphan-process cleanup; those remain DES tasks.
`EVIDENCE.md` now records the accepted Checker proof; `BLOCKERS.md` is
unchanged. Evidence:
`.omx/artifacts/typescript-bun/GATE-04/gate-04-checker-root-20260804-002/`.

Root Maker `agt-015-maker-root-20260804-001` ran the credential-gated live
proof with `AGT015_LIVE_CONSENT=1` and an environment-only StepFun key. The
live StepFun ASR adapter returned final events independently for `microphone`
and `system_audio`; the live OpenAI-compatible Viewer call to `step-3.7-flash`
accepted a PNG image and returned non-empty text. Capability probes passed,
caller cancellation returned `aborted`, and expired deadlines returned
`timeout` for both Provider families. The sanitized proof records only
destination/model metadata, outcome lengths/counters, usage, and redacted
request-ID presence; it never emits credentials. `AGT-015` and Phase 04 are
`VERIFY`; `current_task=AGT-015`, `next_task=null`, and
`same_blocker_attempts=0`. `EVIDENCE.md` and `BLOCKERS.md` remain unchanged.
Candidate evidence:
`.omx/artifacts/typescript-bun/AGT-015/agt-015-maker-root-20260804-001/`.

Root Maker `agt-014-maker-root-20260804-001` added deterministic fake ASR and
model adapters plus separately labeled sanitized recorded SSE/model adapters.
Both families expose immutable evidence metadata, deterministic latency,
configured failure, and caller/deadline abort controls, with no live fallback
path. Focused AGT-014 tests pass 4/16; AGT-002 passes 11/56; AGT-003 passes
5/36; strict backend TypeScript, the 85-source boundary check, and targeted
source hygiene pass. `AGT-014` and Phase 04 are `VERIFY`; `current_task=AGT-014`,
`next_task=null`, and `same_blocker_attempts=0`. `EVIDENCE.md` and
`BLOCKERS.md` remain unchanged. Candidate evidence:
`.omx/artifacts/typescript-bun/AGT-014/agt-014-maker-root-20260804-001/`.

Distinct root Checker `agt-013-checker-root-20260804-002` matched all 36 Maker
manifest entries and recomputed the five-file source aggregate as
`29beeafde4842f6d70ba5ec163aa9d205d9aa18ee7e2973a9ce5a3ec96b35481`.
Fresh AGT-013 tests pass 4/25; BCK-005 passes 5/57; BCK-006 passes 9/85;
strict backend TypeScript and the 81-source import-boundary check pass. Source
review confirms the cooperative task scope, typed cancellation, lifecycle
drain ordering, all eight required schedule labels, and all seven zero-effect
counters. Fast-check generated model/property coverage remains the separately
owned TST-004 task; the adjacent BCK-010 real-child platform failure does not
block AGT-013. Verdict: PASS. `AGT-013` is `DONE`; Phase 04 is `READY`; only
dependency-satisfied `AGT-014` is promoted to `READY`; `current_task=null`,
`next_task=AGT-014`, and `same_blocker_attempts=0`. `EVIDENCE.md` now records
the accepted Checker proof. Evidence:
`.omx/artifacts/typescript-bun/AGT-013/agt-013-checker-root-20260804-002/`.

Root Maker `agt-013-maker-root-20260804-001` replaced the transient runtime
task-scope no-op with a real cooperative scope. Running tasks receive an
AbortSignal and typed cancellation reason; lifecycle stop and runtime
replacement cancel and drain old work before terminal/replacement state
commits. A deterministic AGT-013 schedule matrix covers stop during
ASR-shaped work, new input during Viewer generation, epoch change during repair
retry, Viewer kick, deadline boundary, delayed batch replacement,
crash-before-publication, stale-token reconnect, and queue overflow; every
stale result leaves display, room event, cooldown, private state, memory, meme,
and outbox counters at zero. Focused AGT-013 tests pass 4/25; BCK-005 passes
5/57; BCK-006 passes 9/85; strict backend TypeScript, the 81-source boundary
check, and targeted source hygiene pass. The BCK-010 real-child probe remains
an adjacent external platform failure and is recorded without scope expansion.
`AGT-013` and Phase 04 are `VERIFY`; `current_task=AGT-013`, `next_task=null`,
and `same_blocker_attempts=0`. `EVIDENCE.md` and `BLOCKERS.md` are unchanged.
Candidate evidence:
`.omx/artifacts/typescript-bun/AGT-013/agt-013-maker-root-20260804-001/`.

Distinct root Checker `agt-012-checker-root-20260804-001` matched all 41 Maker
manifest entries and recomputed the ten-file source aggregate
`9d4e793bb5783cbb21fc35071a43bb8230421b25cb90bfdc076db2809f917ce7`.
Protected repository contracts, SQLite repositories, Python parity sources,
and architecture references are unchanged. Fresh targeted AGT-012 tests pass
10/68, the directly affected AGT-010 regression passes 5/48, strict backend
TypeScript, the 81-source import-boundary check, targeted source hygiene, and
live plan-check pass. The deterministic Provider limitation remains explicit;
broader stale-work race proof remains AGT-013. Verdict: PASS. `AGT-012` is
`DONE`; Phase 04 is `READY`; only dependency-satisfied `AGT-013` is promoted
to `READY`; `current_task=null`, `next_task=AGT-013`, and
`same_blocker_attempts=0`. `EVIDENCE.md` now records the accepted Checker
evidence; `BLOCKERS.md` is unchanged.
Accepted evidence:
`.omx/artifacts/typescript-bun/AGT-012/agt-012-checker-root-20260804-001/`.

Root Maker `agt-012-maker-root-20260804-001` added the real AGT-012
application path. A newly committed public barrage synchronously submits but
never awaits a bounded one-at-a-time memory task; idempotent publication does
not resubmit. The memory-role Provider gets one bounded structured request with
only owned public evidence. Before extraction and each write, the application
rechecks current Session scope and the exact frozen memory head inside the
transaction. Stable identity independent of revision prevents deleted or
revoked content from re-entering, while sequential newly created candidates
advance only their own accepted revisions. Mode-meme proposal remains a
separate typed path with current-scope and provenance validation, persisted
auto-ingest settings, namespace isolation, source, undo, 0.5 decay, 30-day
archive, and pin exclusion; no Director or candidate-to-barrage path exists.
Focused AGT-012 tests pass 10/68, the directly affected AGT-010 regression
passes 5/48, strict backend TypeScript, the 81-source boundary check, and
targeted source hygiene pass. `AGT-012` and Phase 04 are `VERIFY`;
`current_task=AGT-012`, `next_task=null`, `same_blocker_attempts=0`, and
`AGT-013` remains `TODO` pending a distinct Checker. `EVIDENCE.md` and
`BLOCKERS.md` are unchanged. Candidate evidence:
`.omx/artifacts/typescript-bun/AGT-012/agt-012-maker-root-20260804-001/`.

Distinct root Recovery Checker
`agt-011-recovery-checker-root-20260804-001` matched all 32 Recovery Maker
manifest entries and the exact two-file source aggregate. The canonical string
runtime counts Unicode code points and retains public JSON Schema
`maxLength: 160`; a Checker-owned probe accepts 159/160 astral code points and
rejects 161, while the pipeline regression publishes the exact boundary text
through the atomic event. Fresh AGT-011 passes 5/37, contracts pass 14/83,
strict contracts/backend TypeScript, the 79-source boundary check, diff
hygiene, and live plan-check pass. Verdict: PASS. `AGT-011` is `DONE`, its
blocker is resolved, Phase 04 and only dependency-satisfied `AGT-012` are
`READY`; `current_task=null`, `next_task=AGT-012`, and
`same_blocker_attempts=0`. Accepted evidence:
`.omx/artifacts/typescript-bun/AGT-011/agt-011-recovery-checker-root-20260804-001/`.

Root Recovery Maker `agt-011-recovery-maker-root-20260804-001` repaired only
the active Unicode public-event blocker. The canonical contract string runtime
now enforces JSON Schema length in Unicode code points instead of UTF-16 code
units, while the public schema retains `maxLength: 160`. One focused pipeline
regression publishes exactly 160 astral code points through the atomic public
event. The original rejecting probe now reports `success=true`; AGT-011 passes
5/37, contracts pass 14/83, strict contracts/backend TypeScript, the 79-source
boundary check, and diff hygiene pass. `AGT-011` and Phase 04 return to
`VERIFY`; the blocker remains active pending a distinct Recovery Checker,
`current_task=AGT-011`, `next_task=null`, `same_blocker_attempts=1`, and
`AGT-012` remains `TODO`. `EVIDENCE.md` is unchanged. Candidate evidence:
`.omx/artifacts/typescript-bun/AGT-011/agt-011-recovery-maker-root-20260804-001/`.

Distinct root Checker `agt-011-checker-root-20260804-001` matched all 38 Maker
manifest entries and the six-file source aggregate, then reproduced AGT-011
4/33, strict backend TypeScript, and the 79-source boundary check. A bounded
public-event probe rejects the candidate: exactly 160 astral Unicode code
points have UTF-16 length 320, so `barrageSnapshotSchema` returns
`success=false` with `Expected at most 160 characters`. The accepted AGT-004
boundary truncates by Unicode code point, while AGT-011 invokes the canonical
public schema before its atomic commit. The otherwise valid message is
therefore discarded instead of published, violating the explicit 160-character
product rule. `AGT-011-UNICODE-PUBLIC-EVENT-LENGTH` is active; `AGT-011` and
Phase 04 are `BLOCKED` at `same_blocker_attempts=1`; `current_task=AGT-011`,
`next_task=null`, and `AGT-012` remains `TODO`. `EVIDENCE.md` is unchanged.
Evidence:
`.omx/artifacts/typescript-bun/AGT-011/agt-011-checker-root-20260804-001/`.

Root Maker `agt-011-maker-root-20260804-001` added the concrete Bun barrage
pipeline behind AGT-010's accepted generation ports. The pipeline enforces the
ordered schema, local identity, scope/observation/sequence, deadline and
cancellation, presence/moderation/revision, evidence/target, content, semantic
duplicate, density, and trusted-public-event boundary. Its serialized atomic
port contract couples the public event, duplicate/density history, and one
bounded Viewer cooldown/behavior/relationship state update; rejection changes
none of them and cannot write memory. Publication keys make retries idempotent,
and every delayed batch item advances only through its exact prior committed
batch prefix and revisions. Focused AGT-011 tests pass 4/33, the directly
affected AGT-010 regression passes 5/47, strict backend TypeScript, the
79-source boundary check, diff hygiene, and live plan-check pass. `AGT-011` and
Phase 04 are `VERIFY`; `AGT-012` remains `TODO` pending a distinct root
Checker. Candidate evidence:
`.omx/artifacts/typescript-bun/AGT-011/agt-011-maker-root-20260804-001/`.

Distinct root Checker `agt-010-checker-root-20260804-001` matched all 33 Maker
manifest entries and the exact five-file source aggregate, then accepted one
independent logical generation per Viewer, legal direct-mention silence,
immediate/500 ms publication pacing, atomic final fencing with shared-history
insertion, preserved publication linkage, and zero late effects from cancelled
or stale remainder. Fresh focused tests pass 5/47; strict backend TypeScript,
the 78-source boundary check, diff hygiene, and live plan-check pass. `AGT-010`
is `DONE`; Phase 04 and only `AGT-011` are `READY`. Accepted evidence:
`.omx/artifacts/typescript-bun/AGT-010/agt-010-checker-root-20260804-001/`.

Root Maker `agt-010-maker-root-20260804-001` added one independent logical
Viewer generation per candidate and an application-owned paced publication
boundary. Accepted texts publish immediately then every 500 ms; every item is
atomically re-fenced with shared-history insertion and retains Viewer, target,
intent, evidence, parent, and current-input linkage. Silence remains legal,
and cancelled or stale work drops the remaining unpublished texts. Five
focused tests pass with 47 assertions, strict backend TypeScript, the 78-source
boundary check, diff hygiene, and live plan-check pass. `AGT-010` and Phase 04
are `VERIFY`; `AGT-011` remains `TODO` pending a distinct root Checker.
Candidate evidence:
`.omx/artifacts/typescript-bun/AGT-010/agt-010-maker-root-20260804-001/`.

Distinct root Recovery Checker `agt-006-recovery-checker-root-20260804-001`
matched all 28 Recovery Maker manifest entries and the two-file recovery source
receipt with aggregate SHA-256
`b56ed0c079d4d1a1c8e27bbeee80821b07febe89445bcb9e9393e2fa0eca4088`.
Fresh AGT-006 tests pass 6/48, strict backend TypeScript, the 74-source boundary
check, diff hygiene, and live plan-check pass. The original rejecting probe now
selects `0,8,17,25,34,42,51,59,67,75,83,95,103,111,119`, exactly matching the
timestamp-uniform targets with maximum error 2 seconds and no index-uniform
bias. The existing direct-mode regression also proves trigger-frame retention,
chronological order, timestamps, and the 15-frame limit. Verdict: PASS.
`AGT-006` is `DONE`, its blocker is resolved, Phase 04 is `READY`, and only
`AGT-007` is promoted to `READY`; `current_task=null`, `next_task=AGT-007`, and
`same_blocker_attempts=0`. Accepted evidence:
`.omx/artifacts/typescript-bun/AGT-006/agt-006-recovery-checker-root-20260804-001/`.

Root Recovery Maker `agt-006-recovery-maker-root-20260804-001` repaired only
`AGT-006-TIME-UNIFORM-FRAME-SAMPLING`. The reducer now distributes 15 targets
uniformly across the representative timestamp span and chooses the nearest
unused frame for each target before applying the existing trigger-frame
retention rule. The original rejecting irregular-timeline probe now selects
`0,8,17,25,34,42,51,59,67,75,83,95,103,111,119`, exactly matching the expected
timestamp-uniform sample, with maximum target error reduced from 35.5 seconds
to 2 seconds. A focused regression protects that distribution. AGT-006 tests
pass 6/48, strict backend TypeScript and the 74-source boundary check pass.
`AGT-006` and Phase 04 return through `READY` and `IN_PROGRESS` to `VERIFY`;
`current_task=AGT-006`, `next_task=null`, `same_blocker_attempts=1`, and
`AGT-007` remains `TODO`. The blocker stays active pending a distinct fresh
Recovery Checker; `EVIDENCE.md` remains unchanged. Candidate evidence:
`.omx/artifacts/typescript-bun/AGT-006/agt-006-recovery-maker-root-20260804-001/`.

Distinct root Checker `agt-006-checker-root-20260804-001` matched all 35 Maker
manifest entries and the seven-file source receipt with aggregate SHA-256
`cc49b8182e495736bb37ded8fbfa4321d54875718111c46fcfcf10f832b37e18`.
Fresh AGT-006 tests pass 5/47, the directly affected DAT-006 regression passes
3/34, and strict backend TypeScript, the 74-source boundary check, diff
hygiene, and live plan-check pass. A bounded irregular-timeline probe rejects
the claimed time-uniform reducer: actual selected seconds are
`0,5,11,16,21,26,32,37,42,48,53,58,75,99,119`, while nearest uniform time
targets select `0,8,17,25,34,42,51,59,67,75,83,95,103,111,119`. The actual
maximum target error is 35.5 seconds rather than 2 seconds, proving the
implementation samples representative array indexes instead of timestamps.
Verdict: FAIL under `INV-FRAME-004` and the Phase 04 acceptance rule.
`AGT-006-TIME-UNIFORM-FRAME-SAMPLING` is active; `AGT-006` and Phase 04 are
`BLOCKED` at `same_blocker_attempts=1`; `current_task=AGT-006`,
`next_task=null`, and `AGT-007` remains `TODO`. `EVIDENCE.md` is unchanged.
Evidence:
`.omx/artifacts/typescript-bun/AGT-006/agt-006-checker-root-20260804-001/`.

Root Maker `agt-006-maker-root-20260804-001` implemented only `AGT-006`. The
Bun ObservationWave service owns the non-extending one-second nearby user-input
merge, product trigger priority, exact screen threshold/cooldown/busy behavior,
recursive barrage suppression, frozen bounded context and room-memory revision,
creation/deadline metadata, and deterministic replay identity. Its bounded
one-frame-per-second timeline uses the full available latest 120 seconds,
segment-reference 90% similarity, five-second anchors, segment-end
representatives, unconditional trigger-frame retention, direct-mode 30-second
filtering, and time-uniform reduction to at most 15 ordered frames. The SQLite
context query now excludes future events from a requested frozen window.
Focused AGT-006 tests pass 5/47, the directly affected DAT-006 regression passes
3/34, and strict backend TypeScript, the 74-source boundary check, diff hygiene,
and live plan-check pass. `AGT-006` and Phase 04 are `VERIFY`;
`current_task=AGT-006`, `next_task=null`, and `AGT-007` remains `TODO` pending a
distinct later root Checker. Candidate evidence:
`.omx/artifacts/typescript-bun/AGT-006/agt-006-maker-root-20260804-001/`.

Distinct root Recovery Checker `agt-005-recovery-checker-root-20260804-001`
matched all 35 Recovery Maker manifest entries and the two-file recovery source
receipt with aggregate SHA-256
`4357a9c4765dbc0f06d48ae3af8fde24c429f2c91760fbdd275fa87768b7cc68`.
Fresh AGT-005 tests pass 6/46, strict backend TypeScript, the 73-source boundary
check, diff hygiene, and live plan-check pass. The original rejecting probe now
proves the repaired priority and capacity boundary: system signal abort is
`true`, system status is `superseded`, final voice status is `completed`, and
one request remains running while one remains queued until physical release.
Verdict: PASS. `AGT-005` is `DONE`, its blocker is resolved, Phase 04 is
`READY`, and only `AGT-006` is promoted to `READY`; `current_task=null`,
`next_task=AGT-006`, and `same_blocker_attempts=0`. Accepted evidence:
`.omx/artifacts/typescript-bun/AGT-005/agt-005-recovery-checker-root-20260804-001/`.

Recovery Maker `agt-005-recovery-maker-root-20260804-001` repaired only
`AGT-005-FINAL-VOICE-PRIORITY`. Final voice now shares user-input priority and
therefore supersedes lower-priority dispatched system audio, while a distinct
queue controller preserves p-queue queued cancellation without allowing a
running Provider abort to release its concurrency slot early or settle as
generic cancellation. The rejecting probe now passes system abort `true`,
system `superseded`, final voice `completed`, and retains one running plus one
queued item until system release. Focused AGT-005 tests pass 6/46; strict
backend TypeScript and the 73-source boundary check pass. `AGT-005` and Phase
04 return to `VERIFY`; `current_task=AGT-005`, `next_task=null`,
`same_blocker_attempts=1`, and `AGT-006` remains `TODO` pending a distinct
fresh Recovery Checker. Candidate evidence:
`.omx/artifacts/typescript-bun/AGT-005/agt-005-recovery-maker-root-20260804-001/`.

Distinct root Checker `agt-005-checker-root-20260804-001` matched all 29 Maker
manifest entries and the seven-file source receipt. Fresh AGT-005 tests pass
6/43, strict backend TypeScript and the 73-source boundary check pass, and diff
hygiene is clean. Its bounded probe demonstrates product-priority drift:
D-043 and the Python authority classify final user voice above standalone
system audio, but the Bun scheduler assigns both priority `40`. A dispatched
system-audio request is therefore not aborted or superseded by newer final
voice; it completes while final voice waits. Verdict: FAIL.
`AGT-005-FINAL-VOICE-PRIORITY` is `ACTIVE`; `AGT-005` and Phase 04 are
`BLOCKED` at `same_blocker_attempts=1`; `current_task=AGT-005`,
`next_task=null`, and `AGT-006` remains `TODO`. Evidence:
`.omx/artifacts/typescript-bun/AGT-005/agt-005-checker-root-20260804-001/`.

Root Maker `agt-005-maker-root-20260804-001` implemented only `AGT-005` with
the accepted `p-queue` primitive behind an infrastructure adapter and an
application-owned scheduling policy. The production scheduler bounds in-flight
and queued work, enforces per-trigger candidate budgets, finite priority,
queued latest-wins and dispatched-work replacement rules, rate-key pacing, one
deadline-bounded transient retry, a shared two-request retry/repair budget, and
graceful drain/cancel. Six focused virtual-clock/request-budget tests pass with
43 assertions. Strict backend TypeScript, the 73-source production import
boundary check and its four focused regressions, diff hygiene, and live
plan-check pass. `AGT-005` and Phase 04 are `VERIFY`; `current_task=AGT-005`,
`next_task=null`, and `AGT-006` remains `TODO` pending a distinct later root
Checker. Candidate evidence:
`.omx/artifacts/typescript-bun/AGT-005/agt-005-maker-root-20260804-001/`.

Distinct Recovery Checker `agt-004-recovery-checker-root-20260804-001`
matched all 43 Recovery Maker hashes and the four-file recovery source
receipt. Fresh AGT-004 tests pass 8/44, along with strict contracts/backend
TypeScript, the 71-source boundary check, and diff hygiene. The original
rejecting probe now rejects `straße` plus `STRASSE`, publishes 160 of 200
emoji, and accepts 3,000 emoji code points. Independent Bun and Python Unicode
14.0.0 receipts each contain 1,530 nonidentity casefold mappings with SHA-256
`1d4fac94d5be772dca0aa80fabd1b9aac1534348c4e9552e8d4f58e40546e2cd`.
Verdict: PASS. `AGT-004` is `DONE`, its blocker is resolved, Phase 04 is
`READY`, and only `AGT-005` is promoted to `READY`; `current_task=null`,
`next_task=AGT-005`, and `same_blocker_attempts=0`. Accepted evidence:
`.omx/artifacts/typescript-bun/AGT-004/agt-004-recovery-checker-root-20260804-001/`.

Recovery Maker `agt-004-recovery-maker-root-20260804-001` repaired only the
active Unicode text blocker. A generated dependency-free Python Unicode 14.0.0
casefold table contains all 1,530 nonidentity mappings; input bounds and display
truncation now operate on Unicode code points. The rejecting Checker probe now
rejects `straße` plus `STRASSE`, publishes 160 of 200 emoji, and accepts 3,000
emoji code points. Bun and Python full-mapping receipts share SHA-256
`1d4fac94d5be772dca0aa80fabd1b9aac1534348c4e9552e8d4f58e40546e2cd`.
Eight focused tests with 44 assertions, strict contracts/backend TypeScript,
the 71-source boundary check, and diff hygiene pass. `AGT-004` and Phase 04
return to `VERIFY`; `current_task=AGT-004`, `next_task=null`,
`same_blocker_attempts=1`, and `AGT-005` remains `TODO` pending a distinct
fresh Recovery Checker. Candidate evidence:
`.omx/artifacts/typescript-bun/AGT-004/agt-004-recovery-maker-root-20260804-001/`.

Distinct root Checker `agt-004-checker-root-20260804-001` matched the 36-entry
Maker manifest and eight-file source receipt. Fresh AGT-004 tests pass 7/37,
along with strict contracts/backend TypeScript, the 71-source boundary check,
and diff hygiene. A bounded Checker probe nevertheless shows direct canonical
text drift: JavaScript UTF-16 length/slice rejects 3,000 emoji code points,
publishes only 80 of 200 emoji at the 160-character limit, and accepts
`straße` plus `STRASSE` as distinct. The Python oracle accepts the 3,000-code-
point input, publishes 160 emoji, and rejects the casefold duplicate. Verdict:
FAIL. `AGT-004` and Phase 04 are `BLOCKED` at `same_blocker_attempts=1`;
`current_task=AGT-004`, `next_task=null`, and `AGT-005` remains `TODO`.
Evidence:
`.omx/artifacts/typescript-bun/AGT-004/agt-004-checker-root-20260804-001/`.

Root Maker `agt-004-maker-root-20260804-001` added the canonical Viewer output
schema and a Bun validation service. The service strips model-owned identity,
validates all publication fields and event/frame/viewer fences, keeps accepted
input text up to 4,000 characters while deriving 160-character display text,
and allows only one schema repair when at least six seconds and one shared
physical request remain. Seven focused AGT-004 tests with 37 assertions, the
affected AGT-003 regression with 36 assertions, contracts tests with 83
assertions, strict TypeScript, the 71-source boundary check, and diff hygiene
pass. `AGT-004` and Phase 04 are `VERIFY`; `current_task=AGT-004`,
`next_task=null`, and `AGT-005` remains `TODO` pending a distinct root Checker.
Candidate evidence:
`.omx/artifacts/typescript-bun/AGT-004/agt-004-maker-root-20260804-001/`.

Distinct Recovery Checker `agt-003-recovery-checker-root-20260804-001`
matched all 33 Recovery Maker hashes and an 11-file reviewed
source/package/lock receipt. Fresh AGT-003 and AGT-001 tests pass with 36 and
32 assertions, respectively, along with strict TypeScript, the 70-source
boundary check, and diff hygiene. A Checker-captured recorded stream probe
makes one physical HTTP 503 request, emits `started,failed`, preserves
retryable `provider_unavailable`, HTTP 503, and request ID `stream-503`, and
writes zero bytes to stderr. Source review confirms the explicit non-logging
callback captures the original error before normalization, while both
`maxRetries: 0` settings and the shared two-request ceiling remain intact.
Verdict: PASS. `AGT-003` is `DONE`, its blocker is resolved, Phase 04 and only
`AGT-004` are `READY`, `current_task=null`, `next_task=AGT-004`, and
`same_blocker_attempts=0`. Evidence:
`.omx/artifacts/typescript-bun/AGT-003/agt-003-recovery-checker-root-20260804-001/`.

Recovery Maker `agt-003-recovery-maker-root-20260804-001` repaired only the
active streaming error blocker. An explicit non-logging `onError` captures the
original AI SDK stream error, and the gateway normalizes it before awaiting
terminal promises. The rejecting Checker's probe now observes one physical
HTTP 503 request, `started,failed`, retryable `provider_unavailable`, HTTP 503,
and upstream request ID `stream-503`, with no raw SDK error output. Five
AGT-003 tests with 36 assertions and four AGT-001 regressions with 32
assertions pass, along with strict TypeScript, the 70-source boundary check,
and diff hygiene. `AGT-003` and Phase 04 return through `READY` and
`IN_PROGRESS` to `VERIFY`; `current_task=AGT-003`, `next_task=null`,
`same_blocker_attempts=1`, and `AGT-004` remains `TODO`. The blocker stays
active pending a distinct fresh Recovery Checker. Candidate evidence:
`.omx/artifacts/typescript-bun/AGT-003/agt-003-recovery-maker-root-20260804-001/`.

Distinct root Checker `agt-003-checker-root-20260804-001` matched all 26 Maker
hashes and confirmed the candidate tests, strict TypeScript, the 70-source
boundary check, and diff hygiene pass. Its bounded recorded stream probe then
returned HTTP 503 from one physical request. The gateway emitted
`started,failed`, but the safe result was non-retryable `provider.unknown`
from ADVX rather than `provider_unavailable` with the upstream request ID.
Because `streamText()` has no explicit `onError`, AI SDK also wrote the raw
`AI_APICallError`, request body values, and upstream response body to stderr.
This violates AGT-003's normalized-error and safe-boundary requirements even
though both `maxRetries: 0` settings and the shared two-request budget pass.
Verdict: FAIL. `AGT-003` and Phase 04 are `BLOCKED` at attempt 1;
`current_task=AGT-003`, `next_task=null`, and `AGT-004` remains `TODO`.
Evidence:
`.omx/artifacts/typescript-bun/AGT-003/agt-003-checker-root-20260804-001/`.

Root Maker `agt-003-maker-root-20260804-001` implemented the AI SDK Core plus
OpenAI-compatible `AiSdkModelGateway` behind the ADVX-owned Provider port.
Endpoint, credentials, headers, role-model selection, text/image conversion,
streaming/non-streaming output, abort/deadline, safe metadata, and normalized
failures stay inside the adapter. Both AI SDK call paths explicitly use
`maxRetries: 0`. A separate application-owned budget shared by initial,
transient-retry, and protocol-repair calls enforces the two-physical-request
ceiling before transport. The focused recorded matrix passes success `1`,
transient-to-success `2`, malformed-to-repair `2`, and
transient-to-malformed-no-third `2`. Four AGT-003 tests with 32 assertions and
four directly affected AGT-001 tests with 32 assertions pass, along with strict
TypeScript, the 70-source boundary check, and diff hygiene. `AGT-003` and Phase
04 are `VERIFY`; `current_task=AGT-003`, `next_task=null`, and `AGT-004`
remains `TODO` pending a distinct root Checker. Candidate evidence:
`.omx/artifacts/typescript-bun/AGT-003/agt-003-maker-root-20260804-001/`.

Distinct Recovery Checker `agt-002-recovery-checker-root-20260804-002` matched
all 34 Recovery Maker hashes and independently reproduced the eleven AGT-002
tests with 56 assertions, four AGT-001 regressions with 28 assertions, strict
TypeScript, the 68-source boundary check, and diff hygiene. Its controlled
four-case probe observes cancellation `0/0`, ordinary reconnect `1/1`, an
in-flight system final spanning degradation `1/1`, and degraded waves `1/1`.
Source review confirms turn closure preserves pending-source ownership and
successful completion promotes the source to persisted on the live tombstone
without a second wave. Verdict: PASS. `AGT-002` is `DONE`, its blocker is
resolved, Phase 04 is `READY`, and only `AGT-003` is promoted to `READY`;
`current_task=null`, `next_task=AGT-003`, and `same_blocker_attempts=0`.
Accepted evidence:
`.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-checker-root-20260804-002/`.

Recovery Maker `agt-002-recovery-maker-root-20260804-002` repaired only the
in-flight degraded-final ownership gap. Closing an active turn now copies its
pending-source reservations into the tombstone. When an already-started sink
persistence completes after degradation, the coordinator removes that pending
reservation and records the source as persisted on the live tombstone; a failed
persistence releases the reservation for a valid retry. A focused deferred-sink
regression and the rejecting Checker's original four-case probe both pass:
cancellation `0/0`, ordinary reconnect `1/1`, cross-degradation system finals
`1/1`, and degraded waves `1/1`. Eleven AGT-002 tests with 56 assertions,
AGT-001 regression, strict TypeScript, and the 68-source boundary check pass.
`AGT-002` and Phase 04 follow `BLOCKED` -> `READY` -> `IN_PROGRESS` ->
`VERIFY`; `current_task=AGT-002`, `next_task=null`,
`same_blocker_attempts=2`, and `AGT-003` remains `TODO`. The blocker remains
active pending a distinct Recovery Checker. Candidate evidence:
`.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-maker-root-20260804-002/`.

Distinct Recovery Checker `agt-002-recovery-checker-root-20260804-001` matched
all 33 Recovery Maker hashes and confirmed that cancellation-before-final and
ordinary reconnect dedupe now pass. Its controlled asynchronous sink held a
system final across the three-second degradation boundary. The candidate
created one degraded wave, but closure discarded the pending-source identity;
after the held persistence completed, a new Provider ID persisted the same late
system final again. Actual system finals are two instead of one. `AGT-002` and
Phase 04 are `BLOCKED` at `same_blocker_attempts=2`; `current_task=AGT-002`,
`next_task=null`, and `AGT-003` remains `TODO`. Evidence:
`.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-checker-root-20260804-001/`.

Recovery Maker `agt-002-recovery-maker-root-20260804-001` repaired only the
active cancellation/reconnect final-dedup blocker. Coordinated turns now check
cancelled/completed/degraded tombstones and pending/persisted source identity
before `persistFinal()`. Cancelled turns drop late finals; the same source and
turn cannot persist twice when reconnect changes Provider IDs; a degraded turn
still persists its one missing paired system-audio final exactly once without a
second wave. Ten focused tests with 54 assertions pass, along with strict
TypeScript. `AGT-002` and Phase 04 return through `READY` and `IN_PROGRESS` to
`VERIFY`; `current_task=AGT-002`, `next_task=null`, and `AGT-003` remains
`TODO`. The blocker remains active pending a distinct Recovery Checker.
Candidate evidence:
`.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-maker-root-20260804-001/`.

Distinct root Checker `agt-002-checker-root-20260804-001` matched all 36 Maker
hashes and reproduced the ten AGT-002 tests with 53 assertions, the four
AGT-001 regressions with 28 assertions, strict TypeScript, the 68-source
boundary check, and diff hygiene. A Checker-owned cancellation/reconnect probe
found that final persistence happens before coordinated-turn cancellation,
closure, and same-source checks. Cancelling before a final persists one final
instead of zero; replaying the same source/turn under a new reconnect identity
persists two finals instead of one. `AGT-002` and Phase 04 are `BLOCKED` at
attempt 1; `current_task=AGT-002`, `next_task=null`, and `AGT-003` remains
`TODO`. Evidence:
`.omx/artifacts/typescript-bun/AGT-002/agt-002-checker-root-20260804-001/`.

Root Maker `agt-002-maker-root-20260804-001` implemented only the StepFun ASR
vertical slice. The Bun backend now has a real HTTP/SSE StepFun adapter with
normalized retry, timeout, cancellation, and failure handling; isolated
microphone and system-audio Providers, buffers, timers, status, and reconnect
lifecycle; 0.8-second silence submission and eight-second system-audio hard
segmentation; and final-only turn coordination with the 1.5-second microphone
pause, three-second required-system degradation, late-final persistence, and
one-wave idempotency. Ten recorded/deterministic tests with 53 assertions pass,
as do strict backend TypeScript, the directly affected AGT-001 regression, and
the 68-source boundary check. `AGT-002` and Phase 04 are `VERIFY`;
`current_task=AGT-002`, `next_task=null`, and `AGT-003` remains `TODO` pending a
distinct root Checker. No credentialed live Provider claim is made. Candidate
evidence:
`.omx/artifacts/typescript-bun/AGT-002/agt-002-maker-root-20260804-001/`.

Distinct root Checker `agt-001-checker-root-20260804-001` matched all 22 Maker
hashes and passed fresh AGT-001 and BCK-004 tests with 52 assertions total,
strict TypeScript, the 64-source boundary check, diff hygiene, and a bounded
Checker-owned public-contract probe. The probe binds provider revision, role
model, request/response IDs, usage/latency, health/capability results, safe
failure projection, and the absence of OpenAI wire tokens at the application
port. `AGT-001` is `DONE`; Phase 04 and only `AGT-002` are `READY`. No
`AGT-002` implementation has started. Evidence:
`.omx/artifacts/typescript-bun/AGT-001/agt-001-checker-root-20260804-001/`.

Root Maker `agt-001-maker-root-20260804-001` completed only the normalized
Provider contract. The application port now binds health and capability
probes, model/ASR identity, provider revision and role model, domain
text/image/structured/streaming requests, request/response IDs, usage,
latency, safe failure code/retryability/source, caller abort, monotonic
deadline, and one bounded protocol-repair attempt. Raw OpenAI-compatible wire
and SDK objects remain outside the application boundary. Four AGT-001 tests
with 28 assertions, four directly affected BCK-004 tests with 24 assertions,
strict backend TypeScript, and the 64-source boundary check pass. `AGT-001`
and Phase 04 are `VERIFY`; `AGT-002` remains `TODO` pending a distinct root
Checker. Candidate evidence:
`.omx/artifacts/typescript-bun/AGT-001/agt-001-maker-root-20260804-001/`.

### Phase 05: Desktop Integration

| ID | Status | Task | Depends | Proof |
| --- | --- | --- | --- | --- |
| `DES-001` | `DONE` | Extract backend supervisor interface from Python-specific process logic | `GATE-04` | Interface tests |
| `DES-002` | `DONE` | Add development launch path for Bun source backend | `DES-001` | Dev lifecycle smoke |
| `DES-003` | `DONE` | Add launch path for compiled Bun backend artifact | `DES-001`, `FND-004` | Executable smoke |
| `DES-004` | `DONE` | Preserve short-lived auth and secure Provider-secret injection | `DES-002`, `DES-003` | Secret boundary tests |
| `DES-005` | `DONE` | Port health, readiness, restart budget, and orphan cleanup | `DES-002..004` | Crash/restart smoke |
| `DES-006` | `DONE` | Switch desktop control API client behind compatibility adapter | `DES-005`, `CON-008` | Dual-backend parity |
| `DES-007` | `DONE` | Switch realtime WebSocket/event client behind compatibility adapter | `DES-005`, `CON-010` | Event parity |
| `DES-008` | `DONE` | Route text, frame, microphone, and system-audio ingest to Bun | `DES-007` | Source-specific smokes |
| `DES-009` | `DONE` | Preserve renderer stores, UI state, and permission boundaries | `DES-006..008` | UI/runtime smoke |
| `DES-010` | `DONE` | Add temporary explicit Python/Bun backend selector for parity and rollback | `DES-006..009` | Switch/restart evidence |
| `DES-011` | `DONE` | Run complete recorded Electron-to-overlay pipeline on Bun | `DES-010` | Recorded E2E |
| `GATE-05` | `DONE` | Independent desktop-integration review | `DES-001..011` | Accepted phase evidence |

### Phase 06: Observability, Replay, And Eval

| ID | Status | Task | Depends | Proof |
| --- | --- | --- | --- | --- |
| `OBS-001` | `DONE` | Define Pino JSONL event schema, correlation IDs, and redaction | `GATE-05` | Schema/redaction tests |
| `OBS-002` | `DONE` | Propagate trace context through HTTP, WS, queues, Providers, and DB | `OBS-001` | End-to-end trace |
| `OBS-003` | `DONE` | Port viewer traces and AI call evidence with privacy bounds | `OBS-001`, `OBS-002` | Trace parity |
| `OBS-004` | `DONE` | Port debug snapshot/query APIs | `OBS-003` | Debug API tests |
| `OBS-005` | `DONE` | Port headless harness with isolated data directories and stable exits | `OBS-003`, `AGT-014` | Headless artifact |
| `OBS-006` | `DONE` | Compare one local trace UI and choose at most one | `FND-008`, `OBS-002` | `ADR-MIG-003` |
| `OBS-007` | `DONE` | Port recorded replay and explicit live replay boundary | `OBS-005` | Deterministic replay |
| `OBS-008` | `DONE` | Add Agent eval fixture format and deterministic evaluators | `OBS-007` | Eval JSON report |
| `OBS-009` | `DONE` | Evaluate Promptfoo integration without remote sharing | `OBS-008` | Go/no-go report |
| `OBS-010` | `DONE` | Add AI SDK DevTools only behind a local development flag | `AGT-003` | Production exclusion proof |
| `OBS-011` | `DONE` | Build diagnostics bundle with logs, trace, screenshots, dumps, profiles, and versions | `OBS-003..010` | Bundle manifest |
| `OBS-012` | `DONE` | Add Bun CPU/heap profile commands and Electron content tracing | `OBS-011` | Profile artifacts |
| `GATE-06` | `DONE` | Independent observability/replay review | `OBS-001..012` | Accepted phase evidence |

### Phase 07: Test And Tooling Convergence

| ID | Status | Task | Depends | Proof |
| --- | --- | --- | --- | --- |
| `TST-000` | `DONE` | Reconcile accepted desktop/observability inputs and open the convergence phase | `GATE-05`, `GATE-06` | Entry audit |
| `TST-001` | `DONE` | Upgrade and configure repository Vitest projects | `TST-000` | Focused suites pass |
| `TST-002` | `DONE` | Map every retained Python test to TypeScript proof or explicit deletion rationale | `TST-000` | Test coverage ledger |
| `TST-003` | `DONE` | Port domain/application/provider unit tests | `TST-002` | Unit parity |
| `TST-004` | `DONE` | Add fast-check model/property tests for ordering and cancellation invariants | `TST-000`, `AGT-013` | Seed/replay artifacts |
| `TST-005` | `DONE` | Add MSW failure scenarios for HTTP/SSE/WS Provider boundaries | `TST-000`, `AGT-014` | Fault suite |
| `TST-006` | `DONE` | Add protocol fuzz and invalid-payload corpus | `TST-000`, `CON-010`, `BCK-009` | Negative suite |
| `TST-007` | `DONE` | Add Vitest Browser Mode for critical renderer states | `TST-000`, `DES-009` | Browser component suite |
| `TST-008` | `DONE` | Consolidate Electron Playwright E2E with traces on failure | `TST-000`, `DES-011` | Trace-enabled E2E |
| `TST-009` | `DONE` | Port process lifecycle and evidence verification scripts to TypeScript | `TST-000`, `OBS-011` | Script parity |
| `TST-010` | `DONE` | Adopt Oxlint/Oxfmt with reviewed rules and exclusions | `TST-000`, `FND-009` | Lint/format gates |
| `TST-011` | `DONE` | Add Knip unused file/export/dependency analysis | `TST-010` | Reviewed Knip baseline |
| `TST-012` | `DONE` | Add Bun frozen-install, audit, typecheck, test, and build CI | `TST-001..011`, `TST-014` | Clean CI run |
| `TST-013` | `DONE` | Add migration parity gate that runs until Python removal | `TST-002..009`, `TST-014` | Dual-runtime report |
| `TST-014` | `DONE` | Port or retire every active non-backend Python CLI/corpus/profile/sync/SkillOpt script | `FND-001`, `TST-009` | Script inventory reaches zero active Python |
| `GATE-07` | `DONE` | Independent test/tooling review | `TST-000..014` | Accepted phase evidence |

### Phase 08: Packaging And Security

| ID | Status | Task | Depends | Proof |
| --- | --- | --- | --- | --- |
| `PKG-001` | `DONE` | Create deterministic Bun backend compile command and manifest | `GATE-07` | Reproducible artifact |
| `PKG-002` | `DONE` | Lock target OS/architecture/baseline matrix | `PKG-001`, `FND-004` | `ADR-MIG-004` |
| `PKG-003` | `DONE` | Embed or copy required assets without writing into ASAR | `PKG-001` | Asset runtime smoke |
| `PKG-004` | `DONE` | Package backend executable through electron-builder `extraResources` | `PKG-002`, `PKG-003` | Unpacked smoke |
| `PKG-005` | `DONE` | Verify user-data, database, logs, and diagnostics paths after install | `PKG-004` | Installed-path audit |
| `PKG-006` | `DONE` | Verify clean termination, restart, uninstall, and no orphan process | `PKG-004`, `PKG-005` | NSIS lifecycle evidence |
| `PKG-007` | `DONE` | Enable and verify Electron security fuses and ASAR integrity | `PKG-004` | Fuse/integrity audit |
| `PKG-008` | `DONE` | Add local crashReporter dump smoke and consent boundary | `OBS-011`, `PKG-004` | Crash artifact |
| `PKG-009` | `DONE` | Add secret scan, dependency audit, license/SBOM, and artifact manifest | `PKG-001` | Security reports |
| `PKG-010` | `DONE` | Run installed Windows end-to-end pipeline and evidence bundle | `PKG-005..009` | Installed E2E |
| `PKG-011` | `ACCEPTED_LIMITATION` | Validate macOS package path or obtain an authorized accepted limitation | `PKG-002..009` | Platform evidence or narrowed release claim |
| `PKG-012` | `DONE` | Design signed-update and rollback policy without enabling production updates | `PKG-010` | Reviewed release runbook |
| `GATE-08` | `DONE` | Independent package/security review | `PKG-001..010`, `PKG-012` | Accepted phase evidence plus external-condition table |

### Phase 09: Cutover And Cleanup

| ID | Status | Task | Depends | Proof |
| --- | --- | --- | --- | --- |
| `CUT-001` | `DONE` | Make Bun the default backend while retaining explicit local Python rollback | `GATE-08` | Default/rollback smoke |
| `CUT-002` | `DONE` | Complete bounded Bun-default soak across recorded scenarios | `CUT-001` | Soak report |
| `CUT-003` | `DONE` | Back up representative legacy data and rehearse rollback | `CUT-001`, `DAT-010` | Restore evidence |
| `CUT-004` | `DONE` | Run final credentialed and platform evidence matrix | `CUT-002`, `CUT-003` | Live/platform evidence |
| `CUT-005` | `DONE` | Switch all root/workspace scripts from pnpm/uv/Python to Bun/TS | `CUT-004` | Root command gate |
| `CUT-006` | `DONE` | Switch CI, contracts, headless, replay, and evidence scripts | `CUT-005` | CI and script gate |
| `CUT-007` | `DONE` | Update architecture, backend, protocol, setup, and product-status docs | `CUT-005`, `CUT-006` | Documentation audit |
| `CUT-008` | `DONE` | Remove Python backend source and Python-only tests after human gate | `CUT-004..007` | Tracked-file audit |
| `CUT-009` | `DONE` | Remove `pyproject.toml`, `uv.lock`, Alembic runtime, and Python ignores | `CUT-008` | Toolchain audit |
| `CUT-010` | `DONE` | Remove temporary dual-runtime adapters and migration-only shims | `CUT-008`, `CUT-009` | Dead-code audit |
| `CUT-011` | `DONE` | Run repository-wide no-Python/no-pnpm/no-uv scan with allowlisted history only | `CUT-009`, `CUT-010` | Scan artifact |
| `CUT-012` | `DONE` | Run clean-clone install, lint, typecheck, tests, build, and installed E2E | `CUT-011` | Clean-clone evidence |
| `CUT-013` | `DONE` | Independent architecture, security, data, and test review | `CUT-012` | Review verdict |
| `CUT-014` | `DONE` | Close or explicitly retain rollback window and archive migration state | `CUT-013` | Closure record |
| `GATE-09` | `DONE` | Final proof-or-stop verification | `CUT-001..014` | Final accepted evidence |

Maker `cut-002-maker-root-20260808-125` completed only the bounded Windows x64
Bun-default soak. Four Electron cycles cover the required media combinations,
barrage/silence behavior, explicit backend restart and reconnect, in-flight
quit, Provider failure/recovery, SQLite write/retention, resource thresholds,
diagnostics/redaction, and cleanup. The soak found and fixed the real Windows
lifecycle defect by connecting the existing Bun IPC shutdown contract before
forced termination. Strict targeted checks and the final soak pass; the
eight-file candidate aggregate is
`12c626665a1fa7e38a158c7a0cfd9620e4c8891cf3228f2e2915e3c14f33dc3a`.
`CUT-002` and Phase 09 are `VERIFY`; `CUT-003` remains `TODO` pending a distinct
Checker. No wider platform, credentialed-live, long-haul, or durable runtime
Session-persistence claim is made.

Independent Checker `cut-002-checker-root-20260808-126`, in distinct context
`cut-002-checker-root-context-20260808-126`, did not participate in
implementation. It recomputed the eight-file aggregate with zero mismatches and
reran strict CUT-002 TypeScript, the focused real Bun child lifecycle test, and
the four-cycle Windows x64 soak. All checks exit `0`; restart/reconnect,
Provider failure/recovery, SQLite integrity/retention, diagnostics redaction,
resource thresholds, in-flight quit, port release, and orphan cleanup pass.
`CUT-002` is `DONE`; only dependency-satisfied `CUT-003` is promoted to
`READY`. Python remains the parity oracle, and no later task was started.

Maker `cut-003-maker-root-20260808-127` completed only the Windows x64,
privacy-safe backup and rollback rehearsal. The real online backup, hash
manifest, closed-source comparison, Bun copy-and-swap migration, supervised Bun
recorded scenario, post-stop restore, and stdin-controlled Python oracle start
all pass. Bun and Python both exit with code `0`, their ports are released, the
legacy rows remain readable after restore, and the rollback copy contains no Bun
migration journal or durable outbox. The supported path is explicitly
restore-from-backup and restart; no in-place rollback or retention of Bun-only
post-backup state is claimed. The four-file candidate aggregate is
`cd034d849b3490f55b5c5a611ffa2866b768c81b574c5ea025d3ecd365ffd361`.
`CUT-003` and Phase 09 are `VERIFY`; `CUT-004` remains `TODO` pending a distinct
Checker.

Independent Checker `cut-003-checker-root-20260808-128`, in distinct context
`cut-003-checker-root-context-20260808-128`, did not participate in
implementation. It recomputed the four-file source aggregate and all four
database manifest entries with zero mismatches, then reran strict TypeScript and
the complete Windows x64 rehearsal. Online backup, Bun migration and recorded
scenario, clean Bun shutdown, post-stop restore, real Python oracle startup,
retained legacy state, clean Python shutdown, and both port releases pass.
`CUT-003` is `DONE`; only dependency-satisfied `CUT-004` is promoted to
`READY`. Restore-from-backup remains the only supported rollback and Python
remains the parity oracle.

Maker `cut-004-maker-root-20260808-129`, in distinct context
`cut-004-maker-root-context-20260808-129`, completed only the final external
evidence matrix. Fresh credentialed StepFun LLM/ASR proof, focused current
Model error normalization, current Windows x64 installed lifecycle, and current
security/license/SBOM evidence pass. Accepted recorded product, legacy rollback,
and Windows-only platform-limitation artifacts are reused. The current audit
found and directly resolved `GHSA-2v37-7h3g-55p8` by pinning transitive
`nanoid` from `3.3.16` to `3.3.17` in both Bun and pnpm resolution; the pnpm
built-in age gate remains explicitly disabled with `minimumReleaseAge: 0`.
The seven-file candidate aggregate is
`56117a916df347af15809355e33e39cb435907352c050ccfdd6743338f3e1524`.
`CUT-004` and Phase 09 are `VERIFY`; `CUT-005` remains `TODO` pending a
distinct Checker. Windows x64 remains the only release claim and Python remains
the parity oracle.

Independent Checker `cut-004-checker-root-20260808-130`, in distinct context
`cut-004-checker-root-context-20260808-130`, did not participate in
implementation. It reran strict CUT-004 TypeScript and the complete current
matrix: fresh credentialed StepFun LLM/ASR proof, five focused Model error
tests, a new Windows x64 build/install/product/restart/uninstall/orphan cycle,
and fresh security/license/SBOM evidence all pass. It independently recomputed
the seven-file aggregate
`56117a916df347af15809355e33e39cb435907352c050ccfdd6743338f3e1524`
with zero mismatches. `CUT-004` is `DONE`; only dependency-satisfied `CUT-005`
is promoted to `READY`. Windows x64 remains the only release claim, and Python
remains the parity oracle.

Maker `cut-005-maker-root-20260808-131`, in distinct context
`cut-005-maker-root-context-20260808-131`, switched the supported root and
workspace package-manager/script-runner surface to Bun `1.3.14`. Frozen install,
contracts/drift, lint/format, strict TypeScript, root tests, replay/eval/evidence,
recorded E2E, build, audit, and the real Windows x64 unpacked package path pass.
The root test gate also repaired only the stale import-boundary declarations it
directly exposed; the final run passes 5 lifecycle, 239 backend, and 42 desktop
tests. The focused command gate reports zero active pnpm/uv/Python/npm/yarn
package-script invocations. The 15-file candidate aggregate is
`5483af572a86d7dbdc28bb3f8114f684614a9adca94d5d8fcf7a6aee0fc6abef`.
`CUT-005` and Phase 09 are `VERIFY`; `CUT-006` remains `TODO` pending a distinct
Checker. Windows x64 remains the only release claim, `minimumReleaseAge: 0`
keeps the pnpm built-in dependency-age policy explicitly disabled, and Python
remains the parity oracle.

Independent Checker `cut-005-checker-root-20260808-132`, in distinct context
`cut-005-checker-root-context-20260808-132`, did not participate in
implementation. It reran the frozen install, strict command gate, workspace
TypeScript, root tests, contracts drift, lint/format/audit,
replay/eval/evidence, recorded E2E, and Windows x64 unpacked package path. All
exit `0`; 5 lifecycle, 239 backend, and 42 desktop tests pass, and the 15-file
aggregate matches Maker evidence with zero mismatches. `CUT-005` is `DONE`;
only dependency-satisfied `CUT-006` is promoted to `READY`. Windows x64 remains
the only release claim, pnpm's dependency-age policy remains disabled, and
Python remains the parity oracle.

Maker `cut-006-maker-root-20260808-133`, in distinct context
`cut-006-maker-root-context-20260808-133`, switched only the active CI and
automation surface. The one workflow now uses pinned Bun setup, frozen Bun
install, TypeScript contract/lifecycle/evidence gates, Bun backend build, test
and Windows x64 package matrices, and a hash-bound artifact manifest. No
additional scheduled, release, reusable-action, or hidden executable project
automation exists, and no workflow sets up or invokes Python, uv, pip, or pnpm.
The authorized product/release claim remains Windows x64 only; Ubuntu
quality/unit runners do not create a Linux product claim.

The first direct smoke exposed and then resolved the only current blocker:
Playwright Electron launch cannot be hosted directly in Bun on this boundary.
Bun now orchestrates a bounded Node-only Playwright child while Electron still
supervises the Bun backend. Final source smoke and full source/compiled TST-008
pass with barrage, overlay, diagnostics, stop, port-release, and cleanup proof.
Frozen install, contract drift, strict targeted TypeScript, TST-012, audit,
backend compile, unpacked package, and the five-file package manifest also pass.
The focused gate reports one workflow, seven active helpers, zero legacy hits,
and the 14-file candidate aggregate
`1a14f9bafc87e9d82fd3acfc0f683cc17c67473c8930e7a821d67898c6afee37`.
`CUT-006` and Phase 09 are `VERIFY`; `CUT-007` remains `TODO` pending a
distinct Checker. Python remains the parity oracle.

Independent Checker `cut-006-checker-root-20260808-134`, in distinct context
`cut-006-checker-root-context-20260808-134`, did not participate in
implementation. It reran frozen install, contract drift, strict focused
checks, TST-012, full Windows x64 source/compiled Electron evidence, backend
compile, unpacked package, five-file artifact manifest, audit, signature
status, and port/orphan checks. All decisive commands exit `0`; source and
compiled scenarios deliver barrage with clean shutdown and zero fatal
diagnostics, package backend identity is preserved, all inspected executables
are unsigned, and no port 8765 listener or Electron/Bun orphan remains. The
14-file aggregate
`1a14f9bafc87e9d82fd3acfc0f683cc17c67473c8930e7a821d67898c6afee37`
matches Maker evidence with zero mismatches. `CUT-006` is `DONE`; only
dependency-satisfied `CUT-007` is promoted to `READY`. Windows x64 remains the
only release claim and Python remains the parity oracle.

Maker `cut-007-maker-root-20260808-135`, in distinct context
`cut-007-maker-root-context-20260808-135`, aligned the current documentation
surface with the implemented Electron-supervised Bun/Elysia product. Repository
and app READMEs, architecture/backend/product/protocol/real-pipeline documents,
and the new operations baseline now describe authenticated loopback HTTP v3,
realtime v4/v3, `ADVX-BIN/3`, Windows x64 packaging, security, troubleshooting,
release limits, and clean child-process shutdown. Historical Python, Pydantic,
FastAPI, and Viewer/Director material is retained only behind explicit
historical or `Superseded` labels; current speaking semantics have no central
Director.

Strict CUT-007 TypeScript, the focused documentation audit, targeted format,
and scoped diff checks exit `0`. The audit reports 16 active documents, five
historical documents, zero legacy command/backend/Director-semantic hits, zero
broken local links, and a preserved Python oracle. The 24-file candidate
aggregate is
`f99bb85e79c3e4b6428b10323246e5510745a90c64f9eabac9475ae1637d2060`.
`CUT-007` and Phase 09 are `VERIFY`; `CUT-008` remains `TODO` pending a distinct
Checker. Windows x64 remains the only release claim and Python remains the
parity oracle.

Independent Checker `cut-007-checker-root-20260808-136`, in distinct context
`cut-007-checker-root-context-20260808-136`, did not participate in
implementation. Strict CUT-007 TypeScript, the focused documentation audit,
targeted format, scoped diff, and all 24 source identity comparisons pass. The
audit confirms 16 current documents, five explicitly historical/parity
documents, zero legacy command/backend/Director-semantic hits, zero broken
local links, and a preserved Python oracle. The final aggregate
`f99bb85e79c3e4b6428b10323246e5510745a90c64f9eabac9475ae1637d2060`
matches Maker evidence with zero mismatches. `CUT-007` is `DONE`; only
dependency-satisfied `CUT-008` is promoted to `READY`, still subject to its
explicit human deletion gate. Windows x64 remains the only release claim and
Python remains the parity oracle.

Readiness Maker `cut-008-readiness-maker-root-20260808-137`, in distinct
context `cut-008-readiness-maker-root-context-20260808-137`, activated only
CUT-008 and used the plan-authorized pre-gate inventory path. It identified
149 tracked CUT-008 deletion candidates, six worktree-only files requiring
ownership review, 11 CUT-009 toolchain/migration holds, and four explicitly
retained language-neutral assets. TST-002 covers all 14 current Python test
modules with 47 behavior rows and zero unmapped, missing, or stale modules.
The machine-readable readiness artifact is hash-bound and validates with exit
`0`, but `deletionAuthorized=false` and `destructiveChangesPerformed=false`.

The required four-part human deletion authorization has not been supplied,
and the earlier instruction to preserve the Python parity oracle remains
binding. `CUT-008` therefore remains `IN_PROGRESS` at blocker attempt 1/3;
`CUT-009` remains `TODO`. No Python source, tests, adapters, toolchain,
fixtures, evidence, rollback assets, commit, push, publish, sign, or deploy
changed.

Blocker auditor `cut-008-blocker-audit-root-20260808-138`, in distinct context
`cut-008-blocker-audit-root-context-20260808-138`, confirmed the same
irreversible authority condition across three consecutive goal turns. An
initial explicit override request received no authorization; the readiness run
then bound the candidate inventory, test mapping, rollback path, limitations,
and exact gate text; the final audit found no new human statement or plan
decision. Further work would require deleting the protected oracle or merely
repeating the same check.

`CUT-008` and Phase 09 are `BLOCKED` with
`CUT-008-HUMAN-DELETION-GATE` at attempt 3/3. `CUT-009` remains `TODO` and no
later task is promoted. Python remains intact and runnable. The aggregate goal
must resume only after new human authority or a gate-changing plan decision.

Recovery Maker `cut-008-recovery-maker-root-20260808-139`, in distinct context
`cut-008-recovery-maker-root-context-20260808-139`, received the exact
four-part human authorization. It binds accepted evidence to
`41665a96cf67eb82cbe02f83abbbe2b79b100e48`, names
`TS_backend_refactor` plus accepted CUT-003 restore-from-backup evidence as the
post-deletion rollback, and retains the Windows x64-only,
unsigned/unpublished/undeployed, macOS-unproven, and CUT-012-pending
limitations. The durable authority is recorded in
`CUT-008-PYTHON-DELETION-AUTHORIZATION.md`.

`CUT-008-HUMAN-DELETION-GATE` is resolved. `CUT-008` and Phase 09 return to
`IN_PROGRESS`; `current_task=CUT-008`, `next_task=null`, and
`same_blocker_attempts=0`. Only CUT-008 deletion and direct reference repair
may proceed; `CUT-009` remains `TODO`.

Maker `cut-008-maker-root-20260808-140`, in distinct context
`cut-008-maker-root-context-20260808-140`, verified and removed all 149
hash-bound tracked CUT-008 candidates plus six authorized worktree-only Python
files. Electron Main no longer constructs the Python adapter, active parity
commands are removed, and the two language-neutral room-6657 JSON assets are
retained at `resources/audience-presets/room-6657` with unchanged hashes. All
11 CUT-009 holds and accepted TST-002/CUT-003 evidence remain intact.

Strict TypeScript, the focused 155-file deletion gate, the supported 17-test
desktop process suite, five lifecycle tests, desktop build, retained-skill
check, targeted formatting/diff checks, live plan validation, and port/orphan
audit pass. The 12-file candidate source aggregate is
`f4a5e94e69b144c0d4be55dda15f574a2b03cb961b860678cedfafaaf8ee4f65`.
`CUT-008` and Phase 09 are `VERIFY`; `CUT-009` remains `TODO` pending a
distinct Checker.

Independent Checker `cut-008-checker-root-20260808-141`, in distinct context
`cut-008-checker-root-context-20260808-141`, reran strict CUT-008 and repository
TypeScript, the focused deletion gate, and the supported desktop process suite.
All exit `0`. It confirms 149 tracked and six worktree-only candidates absent,
11 CUT-009 holds present, accepted TST-002/CUT-003 evidence retained, and zero
Maker/Checker identity mismatches at aggregate
`f4a5e94e69b144c0d4be55dda15f574a2b03cb961b860678cedfafaaf8ee4f65`.

`CUT-008` is `DONE`; Phase 09 returns to `READY`; `current_task=null`,
`next_task=CUT-009`, and `same_blocker_attempts=0`. Only dependency-satisfied
CUT-009 is promoted. No later task was started.

Checkpoint Maker `cut-008-checkpoint-maker-root-20260808-142` performed an
ownership audit, explicitly staged the cumulative accepted migration work, and
created commit `97c81436dcb6df3b30709f6380ddad35b46ac892`. Its 608 changed paths contain
zero `.omx`, `output`, or `promo` paths. After the branch check returned exactly
`TS_backend_refactor`, the commit was pushed only to
`origin/TS_backend_refactor` with an explicit refspec.

Independent exact-commit Checker
`cut-008-commit-checker-root-20260808-143`, in distinct context
`cut-008-commit-checker-root-context-20260808-143`, verified that exact commit
and upstream ref. Repository TypeScript, the focused CUT-008 gate, 17 desktop
process tests, commit whitespace validation, live plan-check, and the final
port/process audit pass. `CUT-008` remains `DONE`, CUT-009 remains the sole
`READY` next task, and no later task was started.

Maker `cut-009-maker-root-20260808-144`, in distinct context
`cut-009-maker-root-context-20260808-144`, removed the 11 accepted Python
toolchain/Alembic holds, removed Python-specific root ignores, and aligned the
current developer documentation with the completed cutover. `apps/backend`
retains only its documentation tombstone. Per the new human direction, Bun CI
is manual-only until migration completion; no remote CI was triggered.

The Bun SQL migration chain, accepted schema inventory and rollback evidence,
and four CUT-010 migration shims remain. Repository TypeScript, strict CUT-009
TypeScript, the focused toolchain audit, formatting, and five Bun migration
runner tests pass. A one-time adjacent legacy migration suite run found three
known failures because its CUT-010 shim still invokes Python removed by CUT-008;
CUT-009 does not repair or delete that later-task boundary. `CUT-009` and Phase
09 are `VERIFY`; `current_task=CUT-009`, `next_task=null`, and no later task was
started.

Independent exact-commit Checker
`cut-009-commit-checker-root-20260808-145`, in distinct context
`cut-009-commit-checker-root-context-20260808-145`, verified commit
`3ff566d6fe8eb3eb6d025da3e08fd8d08e7cdec0` and its identical
`origin/TS_backend_refactor` ref. The 26-path commit contains no prohibited or
cache paths. Repository TypeScript, the focused CUT-009 gate, five Bun migration
runner tests, formatting, commit validation, and live plan-check pass with the
same 26-file aggregate as Maker.

`CUT-009` is `DONE`; Phase 09 returns to `READY`; `current_task=null`,
`next_task=CUT-010`, and `same_blocker_attempts=0`. Only CUT-010 is promoted,
including the already recorded legacy Python shim finding. Automatic CI remains
manual-only until migration completion under explicit human direction. No
CUT-010 implementation or later task was started.

Maker `cut-010-maker-root-20260808-146`, in distinct context
`cut-010-maker-root-context-20260808-146`, removed the temporary Python and
dual-runtime selector/transports, copied Python OpenAPI contracts, parity-only
clients/tests, SQLite Python migration adapters, and closed rollback branches.
The supported runtime is Bun-only. Durable realtime v3/v4 negotiation, Bun SQL
migration history, CUT-003 restore evidence, trace redaction, and diagnostics
remain.

Repository TypeScript, the focused CUT-010 checker, targeted contract, desktop,
trace and migration tests, the Bun OpenAPI drift check, PKG-012 package/rollback
checks, live plan-check, and whitespace validation pass. The focused checker
reports no active tracked Python files and source aggregate
`34626421746e88ffa986de45ff2cab1d466ae71a8a5c6a3cd7a843362aa66235`.
Automatic CI remains `workflow_dispatch`-only until migration completion.

`CUT-010` and Phase 09 are `VERIFY`; `current_task=CUT-010`, `next_task=null`,
and `same_blocker_attempts=0`. CUT-011 remains `TODO` pending a distinct
exact-commit Checker. No later task was started.

Independent exact-commit Checker
`cut-010-commit-checker-root-20260808-147`, in distinct context
`cut-010-commit-checker-root-context-20260808-147`, verified commit
`48896ea63719857b699021d4b8b543ae311ec19a`, tree
`0fa9d1c20646e95afa0d8354257cc22bcb414df5`, and the identical
`origin/TS_backend_refactor` ref. The tracked worktree had zero diff and the 73
changed paths contained zero prohibited, cache, Codex configuration, or secret
paths.

Repository TypeScript, focused CUT-010, 14 contract test blocks, 10 desktop
backend tests, eight trace/migration tests, Bun OpenAPI byte equality, PKG-012,
commit whitespace validation, and live plan-check pass. The Checker matched
Maker source aggregate
`34626421746e88ffa986de45ff2cab1d466ae71a8a5c6a3cd7a843362aa66235`.

`CUT-010` is `DONE`; Phase 09 returns to `READY`; `current_task=null`,
`next_task=CUT-011`, and `same_blocker_attempts=0`. Only CUT-011 is promoted.
Automatic CI remains `workflow_dispatch`-only until migration completion. No
later task was started.

Maker `cut-011-maker-root-20260808-148`, in distinct context
`cut-011-maker-root-context-20260808-148`, added the machine-readable tracked
repository and package-script scan required by CUT-011. It removed the root
pnpm lock/workspace and ignore, retired five accepted but obsolete migration
checkers that could invoke or require removed toolchains, removed pnpm
diagnostics telemetry, renamed the durable realtime wire family to
`legacy-v3-v4`, and reworded active source comments.

Repository TypeScript, strict CUT-011 TypeScript, the focused scan, targeted
formatting, and 12 realtime/diagnostics tests pass. Across 563 tracked/task
files, all 2,572 term matches are classified: 2,465 historical migration
documentation, 103 fixture/test strings, zero generated matches, and four
explicitly retained non-product example matches. Active toolchain paths,
package-script invocations, and active violations are zero. Active-surface
aggregate is
`376487996ac187fb1f8b91377f23bc274e9370d0fec796d59c35dfacd336b82e`.
CI remains manual-only.

`CUT-011` and Phase 09 are `VERIFY`; `current_task=CUT-011`, `next_task=null`,
and `same_blocker_attempts=0`. CUT-012 remains `TODO` pending a distinct
exact-commit Checker. No clean checkout or later task was started.

Independent exact-commit Checker
`cut-011-commit-checker-root-20260808-149`, in distinct context
`cut-011-commit-checker-root-context-20260808-149`, verified commit
`55b2d3157aa05339c62eafb9ffd621f25204fb53`, tree
`a33c42c7ad7974a931afdc90e8b364d53e690c85`, and the identical
`origin/TS_backend_refactor` ref. The tracked worktree had zero diff and the 29
changed paths contained zero prohibited, cache, Codex configuration, secret, or
unrelated paths.

Repository TypeScript, strict CUT-011 TypeScript, the focused repository scan,
focused formatting, 12 realtime/diagnostics tests, commit whitespace
validation, and live plan-check pass. The exact scan covers 563 tracked files,
classifies 2,572 matches, and reports zero active toolchain paths,
package-script invocations, or active violations. Maker and Checker share
active-surface aggregate
`376487996ac187fb1f8b91377f23bc274e9370d0fec796d59c35dfacd336b82e`.

`CUT-011` is `DONE`; Phase 09 returns to `READY`; `current_task=null`,
`next_task=CUT-012`, and `same_blocker_attempts=0`. Only CUT-012 is promoted.
Automatic CI remains `workflow_dispatch`-only until migration completion. No
clean checkout or later task was started.

Maker `cut-012-maker-root-20260808-151`, in distinct context
`cut-012-maker-root-context-20260808-151`, added the reproducible clean-clone
runner, Bun-only security/SBOM/artifact evidence, stable LF checkout policy,
and explicit Electron runtime installation for install/build/package paths.
A remote Windows x64 checkout began without dependencies, build outputs, local
evidence, or dependency caches.

Frozen install, strict CUT-012 and repository TypeScript, contract drift,
lint/format, unit/integration/property/fault tests, replay/eval, desktop build,
backend compile, Windows package, installed E2E, runtime scan, fuse/ASAR
integrity, crash evidence, inert release checks, and security/SBOM/artifact
verification all pass. The security result has zero advisories, zero direct
license-policy failures, a 740-component CycloneDX 1.5 SBOM, and confirms CI
remains `workflow_dispatch`-only.

The initial live plan-check exposed four historical `.omx` links that cannot
exist in a real clone because `.omx` is intentionally untracked. The focused
repair admits only strictly shaped task/run/file evidence pointers while still
rejecting ordinary missing links and escaping paths. Strict TypeScript, two
focused regression tests, and live plan-check pass. `CUT-012` and Phase 09 are
`VERIFY`; `current_task=CUT-012`, `next_task=null`, and
`same_blocker_attempts=0`. CUT-013 remains `TODO` pending an exact-commit
Checker in a second fresh checkout.

Independent exact-commit Checker
`cut-012-commit-checker-root-20260808-152`, in distinct context
`cut-012-commit-checker-root-context-20260808-152`, cloned the identical
`origin/TS_backend_refactor` commit
`78d74e94be61b5a358daee158cf79977dce6b500` into a second new checkout. Its
tree is `6d348032ba992ffc50023b22a264900c82574074`, tracked source stayed clean, and
the 11 task-range paths contained zero prohibited or unrelated paths.

The exact commit passed all 21 clean-clone commands with new empty dependency
caches. Installed Windows x64 text/frame/microphone/system-audio/voice/
overlay, restart, graceful stop, uninstall, and zero-orphan checks pass.
Security scanned 556 tracked files with zero secret findings, audit advisories,
direct license-policy failures, trusted dependency scripts, or untrusted
dependency scripts; the CycloneDX 1.5 SBOM contains 740 components. Fuses,
ASAR integrity, crash evidence, runtime scan, and release inertness pass. Live
plan-check reports 133 tasks, 72 links, 130 evidence records, and zero errors.

`CUT-012` is `DONE`; Phase 09 returns to `READY`; `current_task=null`,
`next_task=CUT-013`, and `same_blocker_attempts=0`. Only CUT-013 is promoted.
Automatic CI remains `workflow_dispatch`-only. No later task, release action,
or deployment was started.

Maker `cut-013-maker-root-20260808-157`, in distinct context
`cut-013-maker-root-context-20260808-157`, completed only the bounded final
review. Four sequential review lanes covered architecture/product semantics,
data/rollback, security/packaging, and test/evidence completeness. The review
removed the startup token from the public supervisor identity, added the
existing sender guard to three sensitive IPC handlers, repaired stale
plan-check fixtures, and reconciled the accepted gate/phase index. Targeted
architecture, persistence, security, desktop, plan-check, TypeScript, package
inertness, and live control-plane checks pass. The review makes only a Windows
x64, unsigned, unpublished, undeployed claim; CI remains manual-only and was
not run. `CUT-013` and Phase 09 are `VERIFY`; `current_task=CUT-013`,
`next_task=null`, and `same_blocker_attempts=0`. A distinct exact-commit
Checker must decide acceptance; `CUT-014` remains `TODO`.
Maker evidence is at
`.omx/artifacts/typescript-bun/CUT-013/cut-013-maker-root-20260808-157/result.json`
with SHA-256
`1f4baae88a4d9e739c9c3519f8ab132fb4a23dec42bbb89430e77f9cc00f4e7d`.

Checker `cut-013-commit-checker-root-20260808-158` rejected the first exact
candidate when the provisional `DONE` cursor caused one negative plan-check
fixture to emit an additional downstream dependency diagnostic. Recovery Maker
`cut-013-recovery-maker-root-20260808-159` changed only that fixture to assert
the required blocker error as a subset; it did not weaken the production
checker or change product runtime code. All 50 plan-check tests, 197
expectations, live plan-check, and whitespace now pass. `CUT-013` remains
`VERIFY`, `CUT-014` remains `TODO`, and the rejected commit evidence is not
reused. Recovery evidence SHA-256 is
`76a9c7a62d919235b9f917145e0773741f0eee74ccb6d17c0119549720ade765`.

New independent exact-commit Checker
`cut-013-commit-checker-root-20260808-160`, in distinct context
`cut-013-commit-checker-root-context-20260808-160`, verified commit
`6a433e7970f48f5ddd2fec631f9986746af39ecb`, tree
`b3f4d12a4b9d55325dc7cd2e9974b438137e30d6`, and the identical
`origin/TS_backend_refactor` ref without reusing rejected commit evidence.
The task-range 12-path ownership/prohibited-path audit, tracked-Python audit,
and whitespace pass. Fresh architecture/cancellation `59/59`, data/rollback
`14/14`, security/diagnostics `17/17`, plan-check `50/50`, repository
TypeScript, package inertness, IPC/token boundary, and live plan-check all pass.
Accepted unchanged CUT-003 rollback and CUT-012 clean-clone artifact hashes
match. `CUT-013` is `DONE`; Phase 09 returns to `READY`;
`current_task=null`, `next_task=CUT-014`, and `same_blocker_attempts=0`. Only
CUT-014 is promoted. CI remains `workflow_dispatch`-only and was not run.
Checker evidence SHA-256 is
`44822baed182a9b02302ac5ba0527f98b46b609997ccafb8eff8c38dc72136f7`.

Maker `cut-014-maker-root-20260808-161`, in distinct context
`cut-014-maker-root-context-20260808-161`, retained a dormant source/data
recovery window and recorded its ownership, duration, exit conditions, exact
source identities, backup/restore procedure, artifact custody, limitations,
superseded-work status, final evidence index, and documentation archive. No
release has shipped, so the operational clock has not started; after a first
authorized signed Windows x64 release reaches full promotion, retention is at
least 30 calendar days. The last complete Python oracle is exact commit
`41665a96`; deletion checkpoint is `97c81436`; rollback remains restore from a
verified pre-migration backup, never in place. `STATE.md` is compacted while
Git, `RUN-LOG.md`, and `EVIDENCE.md` retain history. `CUT-014` and Phase 09 are
`VERIFY`; `current_task=CUT-014`, `next_task=null`, and
`same_blocker_attempts=0`. CI remains `workflow_dispatch`-only and was not
triggered. `GATE-09` remains `TODO` pending a distinct exact-commit Checker.
Maker evidence is at
`.omx/artifacts/typescript-bun/CUT-014/cut-014-maker-root-20260808-161/result.json`
with SHA-256
`b2b5ebc0adb9db18da5f53f02b49ce2c459e4d763421a1ffc9b3eed23e264687`.

Independent exact-commit Checker
`cut-014-commit-checker-root-20260808-162`, in distinct context
`cut-014-commit-checker-root-context-20260808-162`, accepted candidate commit
`60c6e768d59362d21ea206741a0afa6f58c48f5d` and tree
`493d9ce7c8d0540e0ee7198bf503944ee25c53a9` after confirming identical
`origin/TS_backend_refactor`, a tracked-clean worktree, the exact five-document
task scope, the closure contract, retained evidence hashes, 50 plan-check
tests, live plan-check, and whitespace. Automatic CI remains disabled and was
not triggered. `CUT-014` is `DONE`; Phase 09 and only `GATE-09` are `READY`;
`current_task=null`, `next_task=GATE-09`, and `same_blocker_attempts=0`.
Checker evidence is at
`.omx/artifacts/typescript-bun/CUT-014/cut-014-commit-checker-root-20260808-162/result.json`
with SHA-256
`2ff50fdf8aff6a4e025bfd4b302b62dddd086a353fdd5fc1ba39a4674262b1b3`.

Final-gate Maker `gate-09-maker-root-20260809-163`, in distinct context
`gate-09-maker-root-context-20260809-163`, audited all 11 final requirements
against base HEAD `1614fafc700ed4d53bda811c9758b391e7aaccf4`. Ten requirements pass and the
exact-commit evidence binding is pending the required Checker. The Maker
corrected the migration entry README's stale planning/paused status and reran
the existing Windows x64 installed check because `CUT-013` had changed the
Electron supervision/lifecycle boundary after the earlier `CUT-012` package
proof. The fresh compiled/package/NSIS/install/recorded-pipeline/restart/
uninstall check passes with zero Electron or Bun orphan. The first package
attempt stopped at an external Electron download timeout; source inspection
identified the required proxy activation, and the next bounded attempt passed
with `ELECTRON_GET_USE_PROXY=true` without a source change. Provider source
hashes still match accepted credentialed-live evidence, all retained evidence
hashes match, plan-check tests and live plan-check pass, and automatic CI stays
disabled and untriggered. `GATE-09` and Phase 09 are `VERIFY`;
`current_task=GATE-09`, `next_task=null`, and `same_blocker_attempts=0`.
Maker evidence is at
`.omx/artifacts/typescript-bun/GATE-09/gate-09-maker-root-20260809-163/result.json`
with SHA-256
`83618b4ae8e9656d08ec0141bd6572a0432e620cd7268fe712d64bce9f14d605`.

Recovery Maker `gate-09-recovery-maker-root-20260809-165`, in distinct context
`gate-09-recovery-maker-root-context-20260809-165`, kept `GATE-09` at `VERIFY`
after the provisional acceptance transition exposed two negative plan-check
fixtures that depended on the live Phase 09/gate status. The initial exact
candidate audit passed, but no accepted `GATE-09` evidence was added and its
verdict is not reused. The recovery changes only
`scripts/migration-plan-check.test.ts`: one fixture now corrupts the current
phase row explicitly, and the phase-before-gate fixture uses terminal Phase 08.
The production checker and product runtime are unchanged. All 50 plan-check
tests, 197 expectations, live plan-check, and whitespace pass; CI remains
disabled and untriggered. A new exact-commit Checker is required. Recovery
Maker evidence is at
`.omx/artifacts/typescript-bun/GATE-09/gate-09-recovery-maker-root-20260809-165/result.json`
with SHA-256
`d819cb32c5fde4ce0b8fb7f128e8bf048808a7767db4988835df7bd88e6f88ba`.

New exact-commit Checker `gate-09-recovery-commit-checker-root-20260809-166`,
in distinct context
`gate-09-recovery-commit-checker-root-context-20260809-166`, accepted commit
`d897d112e1a8fe06fba420ba5de0bb072eaa26b5`, tree
`1e769cfcb9475f46ed53f7ca5289394b1697eb77`, and identical
`origin/TS_backend_refactor`. The five-path recovery candidate has a clean
tracked worktree and no prohibited path. All 11 final requirements pass:
product runtime is unchanged after the accepted final review, the bounded
migration-control test repair and all 50 tests pass, Provider and retained
artifact identities match, the current Windows x64 installed result is
terminal and orphan-free, no Python or alternate lock/workspace input remains,
live plan-check passes, and automatic CI remains disabled and untriggered.
`GATE-09` and Phase 09 are `DONE`; both task cursors are empty. Checker evidence
is at
`.omx/artifacts/typescript-bun/GATE-09/gate-09-recovery-commit-checker-root-20260809-166/result.json`
with SHA-256
`83eb49f4aefd9824b6fef40c4ce5a8c60739d3ba3cd2e9dd7d6120469ac5d327`.

## Gate External Conditions

These rows are machine-checkable required terminal conditions, not optional
dependency waivers:

| Gate | External task | Allowed terminal status | Required claim behavior |
| --- | --- | --- | --- |
| `GATE-04` | `AGT-015` | `DONE` or `ACCEPTED_LIMITATION` | Live Provider capability is proven, or the unsupported capability is removed from current release scope |
| `GATE-08` | `PKG-011` | `DONE` or `ACCEPTED_LIMITATION` | macOS installed support is proven, or that target is removed from current release scope |

A plain `BLOCKED`, `DEFERRED`, or missing status never satisfies a gate.

## Global Verification Matrix

| Concern | Task-level proof | Phase proof | Final proof |
| --- | --- | --- | --- |
| Contracts | Fixture round trip and negative case | Python/TS protocol parity | No duplicated active schema source |
| Domain semantics | Focused unit test | Recorded vertical-slice parity | Full scenario matrix |
| Concurrency | Deterministic clock test | fast-check model/property suite | Soak with zero stale side effects |
| Persistence | Repository test | Copy migration + crash recovery | Representative legacy DB and rollback |
| Provider | Recorded adapter fixture | Deterministic replay | Credentialed result or honest `BLOCKED` |
| Desktop | Focused supervisor test | Electron recorded smoke | Installed application E2E |
| Security | Boundary test | Fuse/secret/license reports | Independent security review |
| Packaging | Executable smoke | Installed lifecycle | Clean-clone reproducible package |
| Python removal | Per-slice test mapping | Dual-runtime parity gate | Repository and artifact scan |

Detailed evidence contracts live in each phase file and [EVIDENCE.md](./EVIDENCE.md).

## Pre-Mortem

### Failure 1: TypeScript Looks Green But Changes Product Semantics

**Likely cause:** tests are ported mechanically from implementation details while
epoch, frozen-wave, Viewer identity, silence, retry, or memory semantics drift.

**Mitigation:** preserve Python recorded fixtures, test observable events, add
property-based invariants, and require product-spec review at `GATE-04`.

### Failure 2: Development Works But Installed Electron Cannot Run Bun

**Likely cause:** executable assets, working directory, secret handoff, signals,
database paths, CPU target, ASAR, or signing behavior differ after packaging.

**Mitigation:** make compiled-executable and Electron-child spikes Phase 00 work;
repeat proof on unpacked, installed, restart, and uninstall paths before cutover.

### Failure 3: User Data Is Corrupted Or Rollback Becomes Impossible

**Likely cause:** incompatible schema changes are applied in place, migration
failure is partially committed, or Python is deleted before a restore rehearsal.

**Mitigation:** copy-based migration, transaction boundaries, backup manifest,
readable migration version, crash/failure injection, and an explicit human gate
before `CUT-008`.

### Failure 4: The Loop Declares Victory From Its Own Checkbox

**Likely cause:** the implementing agent updates status and emits a completion
promise without current-HEAD proof.

**Mitigation:** maker/checker split, append-only evidence index, external command
gates, bounded attempts, and final proof-or-stop review.

## Expanded Test Plan

| Layer | Required coverage |
| --- | --- |
| Unit | Domain state transitions, codecs, schemas, scheduling, repositories, redaction |
| Property/model | Ordering, epoch/sequence fences, latest-wins, cancellation, TTL, idempotency |
| Integration | Elysia routes, WS, binary ingest, SQLite migrations, Provider adapters |
| Contract | Python oracle versus TS fixtures, OpenAPI snapshot, protocol version rejection |
| Component/browser | Critical renderer states in real Chromium through Vitest Browser Mode |
| Electron E2E | Start, permissions, capture, text/audio/frame ingest, overlay, stop, crash recovery |
| Replay/eval | Deterministic recorded runs, style/contract evals, prompt regression |
| Packaging | Compiled backend, extraResources, installed paths, NSIS lifecycle, platform matrix |
| Observability | Trace correlation, log redaction, diagnostics bundle, crash/profile artifacts |
| Security | Loopback auth, IPC sender validation, fuses, ASAR integrity, secret/license/SBOM scans |

## Risk Register

| Risk | Probability | Impact | Owner | Mitigation |
| --- | --- | --- | --- | --- |
| Bun dependency is Node-only or behaves differently | Medium | High | Phase 00 | Compatibility spike and exit criteria |
| Bun compiled EXE misses runtime asset/native behavior | Medium | High | Phase 00/08 | Early compile spike and installed smoke |
| Elysia/Eden over-couples clients | Medium | Medium | Phase 01 | Keep versioned schemas/OpenAPI as exit |
| Drizzle release or migration tooling is unstable | Medium | High | Phase 00/03 | Stable pin, plain SQL escape hatch |
| `bun:sqlite` synchronous work blocks realtime loop | Medium | High | Phase 03/04 | Measure, bound queries, isolate heavy work |
| Provider cancellation cannot stop network work immediately | Medium | High | Phase 04 | Abort plus final epoch/sequence fence |
| OTel support under Bun is incomplete | Medium | Medium | Phase 00/06 | JSONL remains authoritative |
| Dual runtime causes fixture drift | Medium | Medium | All | One fixture source and parity CI |
| Agent loop expands scope | Medium | High | All | One task/run, path scope, attempt budget |
| Python deletion happens prematurely | Low | Critical | Phase 09 | Human gate and rollback rehearsal |

## Available Agent Types And Staffing Guidance

| Lane | Role | Suggested count | Reasoning | Responsibility |
| --- | --- | ---: | --- | --- |
| Repo mapping | `explore` | 1-2 | Low | Locate current Python/TS behavior and file ownership |
| Dependency spikes | `dependency-expert` | 1 | High | Version, Bun compatibility, license, maintenance risk |
| Architecture | `architect` | 1 | XHigh | Review boundaries, data ownership, migration ordering |
| Implementation | `executor` | 1 | Medium | Own the single active migration task |
| Concurrency/debug | `debugger` | 1 | High | Diagnose lifecycle, cancellation, race, packaging failures |
| Tests | `test-engineer` | 1 | Medium | Port and strengthen decisive proof |
| Completion gate | `verifier` | 1 | High | Bind claims to current evidence and reject false `DONE` |
| Final review | `code-reviewer` | 1 | High | Cross-cutting correctness/security/maintainability review |

Do not start with all roles at once. Phase 00 should prove the single-agent loop,
state, and checker contract first.

## Follow-Up Execution Paths

### Durable Default

Use `$ultragoal` with this plan as the durable goal/ledger owner:

```text
$ultragoal docs/migrations/typescript-bun/00-MASTER-PLAN.md
```

### Optional Team Support

The current state schema permits one `IN_PROGRESS` migration task. Native
subagents or an OMX team may parallelize bounded research, repository mapping,
test diagnosis, and independent review for that one task, but only one owner may
edit its implementation files.

Do not run several master-plan implementation tasks concurrently until a
planning/review change introduces a multi-cursor state schema, file ownership,
integration order, and conflict recovery. File-disjoint appearance alone is not
enough because contracts, generated artifacts, root scripts, and evidence
ledgers are shared.

### Persistent Sequential Fallback

Use Ralph only when a single-owner fresh-context loop is intentionally selected.
Ralph must consume [PROMPT.md](./PROMPT.md), respect attempt limits, and use an
independent verifier. It is not the default over Team + Ultragoal.

## Team Verification Path

1. The leader names one active task and one implementation owner.
2. Support agents receive bounded read-only research, test, or review slices.
3. The implementation owner returns the diff, commands, artifacts, and
   limitations.
4. A verifier reruns decisive gates against the integrated state.
5. The leader updates the master status, state cursor, and `EVIDENCE.md`.
6. `omx team status <team-name>` confirms no active or failed tasks.
7. Only after evidence is checkpointed may `omx team shutdown <team-name>` run.

## Plan Change Policy

- Preserve stable task IDs once referenced by a run log or commit.
- Mark removed tasks `SUPERSEDED` and point to the replacement.
- A build iteration cannot weaken acceptance criteria.
- Changes to architecture, destructive data handling, or final completion rules
  require planning/review mode and a recorded rationale.
- Update `STATE.md` when task dependencies or the next cursor change.
