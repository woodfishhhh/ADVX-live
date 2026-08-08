# Phase 06: Observability, Replay, And Eval

> Entry: `GATE-05`
>
> Exit: `GATE-06`

## Goal

Make the migrated runtime explainable and reproducible without turning
telemetry into a second product database or leaking prompts, screenshots,
audio, credentials, or user content.

The minimum useful result is not a dashboard. It is a local evidence chain that
can answer:

```text
what entered the system
-> which Session / epoch / sequence owned it
-> which queue or Provider touched it
-> what decision was produced
-> what reached the desktop
-> why work stopped, failed, or was discarded
```

## Repository Anchors

- `apps/backend` currently writes `ai-calls.jsonl` and
  `viewer-traces.jsonl`; their useful semantics must survive the migration.
- `docs/ARCHITECTURE.md` defines Session ownership and process boundaries.
- `docs/REAL_PIPELINE.md` defines the current real-pipeline evidence path.
- `docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md` defines the current barrage/silence
  outcome and deterministic candidate-selection rules.
- `tests/fixtures` is the home for small synthetic or recorded-safe fixtures.

## Evidence Model

### Authoritative Local Records

Pino JSONL files remain the primary inspectable runtime record. OpenTelemetry
spans enrich correlation and tool interoperability; they do not replace the
JSONL evidence contract.

Every record must have a stable common envelope:

```ts
type DiagnosticEnvelope = {
  schemaVersion: number
  timestamp: string
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  event: string
  process: 'desktop-main' | 'backend' | 'renderer' | 'overlay'
  backendStartId?: string
  sessionId?: string
  epoch?: number
  sequence?: number
  traceId?: string
  spanId?: string
  source?: 'text' | 'frame' | 'microphone' | 'system-audio'
  viewerId?: string
  providerKind?: string
  outcome?: 'success' | 'failure' | 'cancelled' | 'discarded'
  durationMs?: number
  attributes?: Record<string, unknown>
}
```

User content is referenced by bounded summaries, counts, hashes, fixture IDs, or
explicitly consented diagnostic attachments. Raw content is not the default.

### Evidence Classes

| Class | Meaning | May Prove |
| --- | --- | --- |
| `unit` | Deterministic local code test | Schema and local behavior |
| `synthetic` | Generated input with fake Providers | Orchestration and failure handling |
| `recorded` | Privacy-reviewed local fixture | Replay and product-flow parity |
| `credentialed-live` | Real Provider with authorized credential | Provider interoperability |
| `installed-platform` | Packaged application on named OS/arch | Packaging and lifecycle |
| `manual-visual` | Human-inspected UI or trace | Visual or diagnostic usability |

No lower class silently substitutes for a required higher class.

## Privacy And Retention Rules

- Redact authorization, cookies, API keys, startup tokens, local filesystem
  identities, and Provider headers before serialization.
- Do not log raw image bytes, audio bytes, complete prompts, complete responses,
  or saved credentials.
- Bounded text excerpts require an explicit development flag and visible
  diagnostics state.
- Logs, traces, screenshots, profiles, and dumps inherit the local data
  directory and retention policy.
- Remote export is disabled by default and requires a separate human decision.
- Diagnostics deletion must not delete product state or the SQLite database.

## Tasks

### `OBS-001` Pino JSONL Schema And Redaction

Define versioned event names, the shared envelope, Pino serializers, redaction
paths, file rotation, flush-on-exit behavior, and schema tests.

Required negative tests:

- authorization and startup token;
- nested Provider headers;
- prompt/response bodies;
- Windows username paths;
- Electron safeStorage values;
- error objects whose message or cause contains a secret.

Do not use pretty-print output as the persisted evidence format.

### `OBS-002` Correlation And Trace Propagation

Propagate stable identity across:

```text
Electron request
-> HTTP or WebSocket
-> application command
-> queue item
-> Provider call
-> database transaction
-> emitted event
-> renderer/overlay receipt
```

Keep `SessionId`, epoch, sequence, and `backendStartId` as product/runtime
identity. Trace IDs are diagnostic identity and must not replace them.

Verify cancellation, reconnect, retry, and discarded stale work produce a
complete terminal span or record rather than a dangling trace.

### `OBS-003` Viewer Traces And AI Call Evidence

Port the useful fields from existing viewer and AI-call JSONL records:

- model/provider identity without credentials;
- request category and bounded input metadata;
- selected Viewer and candidate reason;
- barrage/silence outcome;
- latency, token/usage data when supplied;
- repair/truncation status;
- cancellation or stale-result reason;
- same-wave and memory references by stable IDs.

Add a versioned normalizer so Python-oracle and Bun traces can be compared while
both runtimes exist.

### `OBS-004` Debug Snapshot And Query APIs

Expose authenticated loopback-only diagnostic queries for:

- current backend build/version;
- active Session/epoch;
- queue depth and in-flight work;
- Provider availability and circuit state;
- latest bounded event summaries;
- database/schema version;
- capture source status reported by Electron;
- last fatal/degraded reason.

The API must be read-only, bounded, paginated where applicable, and excluded
from unauthenticated Renderer access.

### `OBS-005` Headless Harness

Port the current headless/evidence runner to TypeScript. Each run receives:

- isolated data directory;
- fixture and Provider mode;
- fixed seed and clock controls when supported;
- wall-clock deadline;
- clean stdout result envelope;
- deterministic exit code;
- diagnostics artifact root;
- forced cleanup on timeout.

The harness must prove no backend, socket, task, database handle, or temporary
capture producer remains after exit.

### `OBS-006` Local Trace UI Decision

Time-box a comparison of at most:

- a local Phoenix/OpenInference path;
- a TypeScript-first Langfuse-compatible path;
- no additional UI, using the ADVX diagnostics bundle only.

The decision must evaluate:

- local-only operation;
- whether it introduces a Python runtime or remote service;
- OpenTelemetry/OpenInference compatibility;
- prompt/tool/model display quality;
- installation and packaging burden;
- data deletion and redaction behavior;
- usefulness beyond the existing JSONL viewer.

A trace UI is optional. If Phoenix requires Python to be part of normal ADVX
development, it conflicts with the Python-free target unless isolated as an
external, optional diagnostic tool. Record the decision as `ADR-MIG-003`.

### `OBS-007` Recorded Replay

Define a replay manifest containing:

```text
fixture version
input events and timing
seed/clock policy
Provider mode
expected invariant set
allowed nondeterministic fields
privacy classification
artifact hashes
```

Replay must distinguish recorded adapters from credentialed live Providers.
Never name a recorded result as live.

### `OBS-008` Agent Eval Fixtures

Create deterministic evaluators for observable product requirements such as:

- only eligible Viewers are called;
- no Director/global-theme model appears;
- `barrage` and `silence` parse correctly;
- barrage count, length, and repair bounds hold;
- reply context and same-wave freeze are preserved;
- no stale epoch/sequence result is emitted;
- cancellation leaves no late memory write;
- failure degrades without inventing output.

Evaluator output must be JSON with per-assertion evidence, not only a scalar
score.

### `OBS-009` Promptfoo Evaluation Spike

Evaluate Promptfoo as a developer/CI evaluation runner using local fixtures and
ADVX-owned assertions.

Accept only if it:

- runs under the chosen Bun/Node boundary without Python;
- can be pinned and invoked deterministically;
- does not require cloud sharing or remote telemetry;
- preserves raw evidence locally;
- supports custom TypeScript Provider/evaluator adapters;
- adds more value than a small Vitest-based eval harness.

Record a go/no-go decision. Do not force adoption merely because the package is
popular.

### `OBS-010` AI SDK DevTools Boundary

Evaluate AI SDK DevTools for local development only. If adopted:

- the package and hook are gated by an explicit development flag;
- production builds exclude its interception and UI;
- secrets and raw user media remain excluded;
- disabling it restores the normal Provider path exactly;
- a build inspection proves it is absent from packaged artifacts.

### `OBS-011` Diagnostics Bundle

Generate a manifest-driven local bundle containing only requested, available
artifacts:

- redacted logs and viewer traces;
- build/runtime/dependency versions;
- health and bounded debug snapshot;
- replay/eval report;
- selected screenshots;
- Electron content trace;
- Bun CPU/heap profile;
- local crash dump metadata;
- configuration names, never secret values;
- SHA-256 and size for every file.

The manifest must state missing artifacts and why. Bundle creation must never
silently broaden data collection.

### `OBS-012` Performance Profiles

Add repeatable commands for:

- Bun CPU profiling;
- Bun heap snapshots;
- Electron `contentTracing`;
- process memory/CPU samples during a bounded scenario;
- queue depth and Provider latency correlation.

Profiles must be opt-in, time-bounded, locally stored, and referenced from the
diagnostics manifest.

## `GATE-06` Observability Exit

- [ ] All persisted diagnostics use a versioned, redacted JSONL contract.
- [ ] One trace follows a recorded input across Electron, Bun, Provider, DB, and
      overlay delivery.
- [ ] Existing viewer-trace and AI-call evidence has a documented parity map.
- [ ] Headless runs terminate deterministically with isolated data.
- [ ] Replay fixtures state their privacy and Provider evidence class.
- [ ] Agent evaluators emit per-assertion machine-readable results.
- [ ] `ADR-MIG-003` chooses one optional trace UI or explicitly chooses none.
- [ ] Development instrumentation is absent from production packages.
- [ ] Diagnostics bundles are manifest-driven, hashed, bounded, and local.
- [ ] An independent checker accepts recorded replay plus failure-path evidence.

## Rollback

Disable OpenTelemetry exporters, optional trace UI, Promptfoo, and AI SDK
DevTools independently. Pino JSONL and existing debug evidence remain sufficient
to operate and diagnose the Bun runtime.

## Observations

To be filled during execution.
