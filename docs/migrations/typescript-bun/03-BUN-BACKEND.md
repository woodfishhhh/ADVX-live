# Phase 02: Bun Backend Shell

> Entry: `GATE-01`
>
> Exit: `GATE-02`

## Goal

Create a production-shaped Bun/Elysia backend that owns process lifecycle,
configuration, loopback authentication, control APIs, realtime connections, and
room/session state transitions while still delegating complex Provider and
persistence behavior to ports or temporary adapters.

## Repository Anchors

- `docs/BACKEND_DESIGN.md:9-24` locks a local single-process backend, SQLite, and
  Ports/Adapters without distributed-service infrastructure.
- `docs/BACKEND_DESIGN.md:26-95` defines the current `api -> application ->
  domain` dependency direction and provider/infrastructure boundaries.
- `docs/ARCHITECTURE.md:40-79` separates Electron-owned configuration/capture
  from backend-owned runtime behavior.
- `docs/ARCHITECTURE.md:136-155` defines Session state and identity.
- `apps/backend/src/advx_backend` is the Python behavioral oracle.

## Target Package Shape

```text
apps/backend-bun/
  package.json
  tsconfig.json
  src/
    main.ts
    app.ts
    api/
      http/
      ws/
      middleware/
    application/
      services/
      ports/
      dto/
    domain/
      room/
      session/
      audience/
      observation/
      barrage/
      memory/
    infrastructure/
      config/
      persistence/
      telemetry/
      process/
    providers/
      asr/
      model/
      fake/
```

Dependencies point inward. `domain` imports no Elysia, Electron, AI SDK, Drizzle,
Pino, OpenTelemetry, environment variables, filesystem, or wall clock.

Use explicit composition through `createApp(deps)` and constructors. Do not add
a decorator-based DI container.

## Tasks

### `BCK-001` Backend Package And Boundaries

Create the package skeleton, TypeScript configuration, entry points, test
projects, and import-boundary rules.

**Acceptance**

- Domain imports only domain/shared contracts.
- Application imports domain and abstract ports.
- API/providers/infrastructure implement ports and compose outward dependencies.
- The package can instantiate a test application with in-memory fakes.
- No Python subprocess is required merely to import or typecheck the package.

### `BCK-002` Typed Configuration

Define validated configuration groups:

- process host/port/data directory;
- one-time startup token channel;
- queue, timeout, retry, and payload limits;
- logging/tracing flags;
- development-only tools;
- Provider profiles without stored plaintext credentials.

Rules:

- Bun's environment loading is runtime convenience, not contract validation.
- Missing or invalid configuration fails before listening.
- Secrets are redacted from exceptions and object inspection.
- Development defaults cannot silently enable production exposure.

### `BCK-003` Loopback Auth, Health, And Readiness

Implement:

- bind to `127.0.0.1` or `::1` according to the locked policy;
- one-time or startup-scoped authentication;
- `/health` for process liveness;
- `/ready` for contract, DB, and required runtime readiness;
- `/version` for backend, protocol, schema, and build identity;
- request IDs and safe errors.

Reject missing, stale, malformed, or cross-start tokens. Health endpoints must
not disclose paths, secrets, model names beyond the approved public profile, or
raw exception messages.

### `BCK-004` Application Ports

Define small interfaces for:

- clock and monotonic time;
- ID generation;
- task scope and cancellation;
- event publication;
- runtime-spec repository;
- room/session repositories;
- transaction boundary;
- ASR Provider;
- model Provider;
- trace/log sink;
- process shutdown notification.

Avoid a generic service locator. Tests inject deterministic clocks, IDs, and
fakes explicitly.

### `BCK-005` Room And Session Lifecycle

Port observable state transitions:

```text
idle -> starting -> running -> paused -> stopping -> stopped
              \-> degraded
              \-> failed
```

Cover:

- stable Room and Session IDs;
- audience epoch initialization and increments;
- start idempotency;
- pause/resume legality;
- stop as a terminal resource-release path;
- crash-recovery eligibility;
- stale command rejection;
- state snapshot publication.

Do not port Provider generation yet. Use deterministic fakes to prove lifecycle.

### `BCK-006` Runtime Spec Apply And Rollback

Port:

- schema and reference validation;
- canonical serialization and hash;
- `apply_id`, base revision, and conflict checks;
- pending versus committed revision;
- atomic wave-boundary application;
- epoch increment;
- old-work cancellation/fencing;
- rollback to prior committed revision;
- machine-readable diff summary.

No partial runtime spec becomes observable. A failed apply keeps the prior
revision running.

### `BCK-007` Control Routes

Implement Elysia routes from canonical contract schemas. Keep handlers thin:

```text
parse/auth
  -> application command/query
  -> map domain result
  -> normalized response
```

No route handler directly manipulates SQLite, calls a Provider, or owns session
state.

### `BCK-008` WebSocket Hub

Implement:

- authenticated handshake;
- one connection identity per backend start and desktop client;
- bounded inbound/outbound queues;
- typed JSON envelope validation;
- ping/timeout and clean close;
- server restart/reconnect semantics;
- subscription/event publication;
- slow-consumer policy;
- shutdown notification.

Do not use an unbounded event emitter as the domain event bus.

### `BCK-009` Binary Ingest Dispatch

Decode and validate current audio/frame messages, then dispatch typed application
commands.

Required negative cases:

- unsupported version/type/source;
- truncated header;
- declared length mismatch;
- oversized payload;
- message for unknown/stale Session;
- audio after its source stopped;
- frame after capture source ended;
- flood/backpressure behavior.

Raw bytes do not enter ordinary JSON logs or traces.

### `BCK-010` Process Lifecycle

Implement deterministic:

- boot sequence;
- readiness publication;
- parent-process liveness handling;
- graceful stop deadline;
- cancellation of application task scopes;
- WS/server close;
- DB flush/close;
- trace/log flush;
- forced-exit fallback;
- stable exit codes.

The backend must never keep the Electron app alive after requested shutdown.

### `BCK-011` Control/Session Parity Slice

Run the same synthetic sequence against Python and Bun:

```text
health
-> start session
-> snapshot
-> validate spec
-> apply spec
-> pause
-> resume
-> rollback
-> stop
```

Compare normalized responses, state transitions, epochs, events, error codes,
and final resource state. Differences require either a fix or a reviewed product
decision; they cannot be normalized away for convenience.

## Verification

Expected task commands:

```powershell
bun run --filter @advx/backend-bun typecheck
bun run --filter @advx/backend-bun test
bun run test:contract-parity
bun run smoke:backend-process
```

## `GATE-02` Backend Shell Exit

- [ ] Dependency direction is enforced.
- [ ] Config fails closed and secrets are redacted.
- [ ] Loopback auth, health, readiness, and version behavior are tested.
- [ ] Room/Session and runtime-spec transitions match the oracle.
- [ ] WS and binary ingest are bounded and versioned.
- [ ] Start, restart, stop, and forced-stop leave no orphan process.
- [ ] No business route bypasses application ports.
- [ ] Current-HEAD evidence is independently accepted.

## Rollback

Electron still launches Python by default. Remove the additive Bun package and
contract adapters if this phase fails. Do not modify or migrate the user's live
database in this phase.

## Observations

To be filled during execution.
