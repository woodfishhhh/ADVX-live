# Phase 01: Contracts And Protocol

> Entry: `GATE-00`
>
> Exit: `GATE-01`

## Goal

Move contract ownership from Python/Pydantic-generated TypeScript declarations
to runtime-valid TypeScript schemas without changing the current HTTP,
WebSocket, or binary ingest semantics.

This phase does not port business behavior. It establishes the shared language
that lets Python and Bun run side by side and produce comparable results.

## Repository Anchors

- `docs/DECISIONS.md:132-142` records current Pydantic/OpenAPI contract ownership
  and secret/logging boundaries.
- `packages/contracts/README.md:1-4` says generated OpenAPI declarations must not
  be edited by hand.
- `docs/INGEST_PROTOCOL.md:1-127` is the implemented HTTP/WS and binary ingest
  protocol.
- `apps/backend/openapi.json` is generated and ignored.
- `packages/contracts/src/generated/openapi.ts` is generated from Python today.

## Contract Ownership

Target dependency direction:

```text
packages/contracts runtime schemas
  |- Bun backend validation and OpenAPI
  |- desktop control client
  |- desktop realtime client
  |- fixtures and protocol tests
  `- temporary Python oracle adapter
```

The contracts package may depend on small schema/runtime libraries. It must not
depend on Electron, Elysia server instances, AI SDK provider objects, database
models, or application services.

## Compatibility Rules

- Existing protocol versions remain readable during coexistence.
- New incompatible fields require a version increment and explicit rejection.
- Optional additions must define absent/default behavior.
- Unknown enum values fail at the correct boundary; they do not silently coerce.
- IDs remain opaque strings.
- Timestamps use one documented unit and integer policy.
- JSON canonicalization used for hashes is deterministic.
- Binary headers remain byte-for-byte specified, not inferred from TypeScript
  object layout.
- Provider wire payloads never become public ADVX contracts.

## Tasks

### `CON-001` Contract Inventory

Build a table mapping:

```text
Python model / codec
  -> route or event
  -> generated TS consumer
  -> fixture
  -> compatibility version
  -> migration disposition
```

Include HTTP control routes, WS JSON messages, binary audio/frame envelopes,
debug/replay payloads, error bodies, runtime specs, personas, modes, session
snapshots, room events, and barrage events.

**Acceptance:** no externally observed backend payload lacks an owner.

### `CON-002` Canonical Runtime Schema Package

Restructure `packages/contracts` so source schemas are hand-authored TypeScript
and derived static types come from those schemas.

Required exports:

- schema/version constants;
- runtime validators;
- JSON Schema/OpenAPI references;
- stable public types;
- fixture helpers separated from production exports.

Generated artifacts, if retained, go under `src/generated` and have a single
generation command. Do not generate the canonical schema from OpenAPI after this
task.

### `CON-003` Common Scalars And Errors

Port and test:

- Room, Session, Viewer, Persona, Observation, Generation, Barrage, revision,
  and apply IDs;
- timestamp/deadline fields;
- protocol and schema versions;
- source and status enums;
- normalized error code, retryability, and safe detail;
- pagination or bounded-list metadata where present;
- trace/correlation metadata.

Do not model secrets, raw images, or raw audio as serializable debug records.

### `CON-004` Control Plane Contracts

Define schemas for:

- health/readiness/version;
- runtime-spec validation/apply/rollback;
- session start/pause/resume/stop/recover;
- Provider profile/capability probe without credentials;
- debug snapshot/query;
- replay control;
- settings and current state responses.

For each route, record status codes and normalized errors, not only success
payloads.

### `CON-005` Realtime JSON Envelopes

Define one versioned envelope with:

```text
protocol_version
message_type
message_id
room_id
session_id
audience_epoch
created_at_ms
trace_id
payload
```

Not every message requires every scoped ID, but absence rules must be explicit.
Cover ingest acknowledgements, transcripts, observation state, room events,
barrage events, runtime status, queue pressure, errors, and shutdown.

For paired audio turns, preserve and validate:

- shared `turn_id`;
- `system_audio_required`;
- `system_audio_degraded`;
- one-trigger identity and idempotency;
- the rule that a late paired system-audio final is persisted but cannot create
  a second ObservationWave.

### `CON-006` Binary Ingest Codec

Port the current audio/frame header parser and encoder with:

- byte offsets and endianness documented;
- payload type and source IDs;
- declared length versus actual length validation;
- message-size limits;
- protocol-version rejection;
- truncated and extra-byte cases;
- `turn_id` and `system_audio_required` binary-header parity;
- browser/Node/Bun interoperability fixtures.

The parity gate is byte-for-byte, not "equivalent object after parsing."

### `CON-007` OpenAPI And Scalar

Generate OpenAPI from the TypeScript route schemas and expose Scalar only in
development.

Required proof:

- stable snapshot checked into an intentional location or deterministically
  generated in CI;
- no secret examples;
- all control routes documented;
- error responses represented;
- production build does not expose the interactive UI unless explicitly enabled.

### `CON-008` Control Client ADR

Compare:

**Eden Treaty**

- lower boilerplate and direct inference;
- tighter coupling to Elysia server types and versions.

**Generated OpenAPI client**

- weaker framework coupling and clearer compatibility boundary;
- code generation and regeneration discipline.

The realtime/binary protocol remains explicitly versioned either way. Eden must
not become the only specification of messages stored on disk or sent over WS.

### `CON-009` Cross-Runtime Parity Suite

For each retained contract:

1. serialize from the Python oracle;
2. validate/parse in TypeScript;
3. serialize canonical TypeScript output;
4. parse in the temporary Python oracle when meaningful;
5. normalize documented volatility only;
6. fail on semantic field loss.

Store fixtures as synthetic data. Do not capture private recordings, screenshots,
credentials, or unredacted Provider payloads.

### `CON-010` Version Negotiation And Rejection

Implement tests for:

- current client/current server;
- supported older client/current server;
- current client/supported older oracle;
- unknown future major version;
- missing version;
- mismatched binary versus WS version;
- reconnect after backend restart;
- stale token and stale session/epoch.

Unsupported combinations must fail closed with a machine-readable reason.

## Verification Commands

Commands are finalized by `FND-010`. Expected shape:

```powershell
bun run --filter @advx/contracts typecheck
bun run --filter @advx/contracts test
bun run contracts
bun run test:contract-parity
```

## `GATE-01` Contract Exit

- [ ] TypeScript runtime schemas are canonical.
- [ ] HTTP, WS JSON, and binary protocols have explicit versions.
- [ ] Python and TypeScript pass the same synthetic fixture corpus.
- [ ] Binary fixtures are byte-for-byte compatible.
- [ ] Coordinated microphone/system-audio turn fields and degraded semantics
      survive JSON and binary round trips.
- [ ] Incompatible clients fail closed.
- [ ] OpenAPI/Scalar is generated from the TypeScript contract path.
- [ ] No framework or Provider wire types leak into persisted domain contracts.
- [ ] An independent verifier indexes current-HEAD evidence.

## Rollback

Until `GATE-01`, Python-generated OpenAPI remains the active desktop contract
source. If the TypeScript contract design fails, revert the additive contract
source and fixtures without touching the running backend or database.

## Observations

To be filled during execution.
