# Phase 05: Desktop Integration

> Entry: `GATE-04`
>
> Exit: `GATE-05`

## Goal

Connect the Bun backend to the existing Electron application without weakening
Main/preload/renderer privilege boundaries, capture behavior, secret storage,
session controls, or overlay behavior.

## Repository Anchors

- `apps/desktop/README.md:3-10` defines the three renderer surfaces and Main
  process privilege boundary.
- `docs/ARCHITECTURE.md:83-95` makes Electron Main responsible for backend
  startup, supervision, short-lived token, and IPC access.
- `docs/REAL_PIPELINE.md:14-70` documents current Python startup order and real
  end-to-end pipeline.
- `apps/desktop/src/main` owns system privileges and backend supervision.
- `apps/desktop/src/preload` owns narrow bridges.
- `apps/desktop/src/renderers` owns UI only.

## Boundary Rules

- Electron Main may know backend executable paths and startup secrets.
- Preload exposes narrow typed commands/events, not a generic HTTP or filesystem
  bridge.
- Renderer never reads saved plaintext Provider credentials.
- Backend never controls windows, global shortcuts, tray, safeStorage, capture
  permissions, or Electron lifecycle.
- Backend communication stays on authenticated loopback.
- Capture stops before or with backend shutdown; no late ingest is sent.

## Tasks

### `DES-001` Backend Supervisor Interface

Extract a runtime-neutral interface:

```text
prepare
start
waitReady
status
restart
stop
forceStop
dispose
```

Define process identity, version, port, token, data directory, log location, and
exit metadata. Keep Python-specific command construction in a temporary adapter.

Test idempotent stop, concurrent start rejection, restart budget, unexpected
exit, and app quit.

### `DES-002` Bun Development Supervisor

Launch Bun source in development with:

- repository-resolved executable;
- assigned loopback port;
- isolated data directory;
- safe startup secret channel;
- explicit child-environment allowlist;
- inherited development logging only;
- readiness deadline;
- process tree ownership;
- no visible extra terminal window unless explicitly debugging.

Do not pass Provider secrets on the command line.

### `DES-003` Compiled Backend Supervisor

Launch the Phase 00/08 compiled executable from Electron resources. Resolve paths
correctly for unpackaged and packaged applications. Verify working directory is
irrelevant or explicitly set.

Build the child environment from an allowlist and explicitly remove
`BUN_BE_BUN` plus any unapproved Bun runtime/config variables. A parent shell
must not turn the backend executable into the Bun CLI or alter its configuration.

The supervisor must fail clearly when the artifact is missing, wrong-architecture,
quarantined, unsigned when policy requires signing, or exits before readiness.

### `DES-004` Startup Auth And Secret Injection

Preserve:

- unpredictable startup-scoped auth;
- Renderer exclusion;
- no command-line or ordinary log secrets;
- no inherited `BUN_BE_BUN`, ambient `.env`, or bunfig control;
- safeStorage as persisted credential owner;
- in-memory backend injection only for enabled Provider profiles;
- cleanup on stop/restart;
- destination transparency.

Choose an IPC-safe channel such as inherited pipe/stdin or a narrowly protected
bootstrap exchange based on spike evidence. Ordinary environment variables are
not the default secret transport.

### `DES-005` Health, Restart, And Orphan Cleanup

Implement:

- startup/readiness progress;
- version/protocol compatibility check;
- bounded automatic restart only for eligible failures;
- degraded/fatal state reporting;
- capture stop on backend loss;
- child-process cleanup on normal quit, crash, update, and test timeout;
- Windows process-tree and macOS process semantics.

Never restart indefinitely.

### `DES-006` Control Client Compatibility Adapter

Provide one desktop-facing interface backed temporarily by:

- Python OpenAPI client;
- Bun Eden/generated OpenAPI client.

The renderer-facing stores and hooks must not branch throughout the UI on
backend kind. Normalize differences at the adapter boundary and record any
product-visible mismatch.

### `DES-007` Realtime Client Compatibility Adapter

Implement versioned Bun WS connection with:

- startup token;
- connection/reconnect state;
- typed envelope parsing;
- backend-start identity;
- event dedupe;
- stale Session/epoch rejection;
- slow/error status;
- clean close.

Do not treat reconnect as permission to replay old capture buffers.

### `DES-008` Capture And Ingest Routing

Route independently:

- user text;
- screen representative frames;
- microphone chunks;
- Windows system-audio chunks;
- source start/stop/error metadata.

Preserve current sampling, permission, device, and source-ending behavior.
Backend migration does not authorize a capture rewrite.

### `DES-009` Renderer State And UI

Keep:

- Zustand for local UI/session presentation state;
- typed narrow selectors;
- existing React component ownership;
- explicit AI identity;
- independent microphone/system-audio status;
- pause, clear, stop, and error recovery;
- overlay isolation and click-through behavior.

TanStack Query may be evaluated for control-plane server state only if it removes
meaningful custom retry/cache code. Do not use it as the realtime event bus.

### `DES-010` Temporary Backend Selector

Add an explicit development/test selector:

```text
python-oracle
bun-source
bun-compiled
```

Requirements:

- default remains Python until `CUT-001`;
- production users do not see an unsupported toggle;
- diagnostics record selected backend;
- switching requires a clean stop/start;
- both runtimes use isolated test data unless a migration task says otherwise.

### `DES-011` Recorded Full Pipeline

Exercise:

```text
Electron start
-> Bun ready
-> session start
-> text + frame + microphone fixture + system-audio fixture
-> ASR/model recorded adapters
-> Viewer barrage/silence
-> overlay
-> debug/trace evidence
-> stop
```

Compare normalized events with the current real-pipeline contract. Assert no
capture, socket, task, database, or backend child remains after stop.

## `GATE-05` Desktop Exit

- [ ] Main/preload/renderer privilege boundaries remain narrow.
- [ ] Bun source and compiled backend launch paths work.
- [ ] Startup auth and Provider secrets never reach renderer/CLI/logs.
- [ ] Health, version, restart, stop, and orphan cleanup are bounded.
- [ ] Control and realtime adapters hide temporary dual-runtime differences.
- [ ] All four input types reach Bun with source identity intact.
- [ ] Existing renderer/overlay behavior remains observable and controllable.
- [ ] Recorded full-pipeline evidence is accepted independently.

## Rollback

The selector returns to `python-oracle`; Bun processes are stopped; data
directories remain isolated. No user-visible migration is final in this phase.

## Observations

To be filled during execution.
