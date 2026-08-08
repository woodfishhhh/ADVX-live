# TypeScript + Bun Migration Dependency ADRs

> Task: `FND-009`
>
> Decision date: 2026-07-30
>
> Evidence run: `fnd-009-maker-20260730-001`
>
> Scope: migration-specific dependency approval only

## Decision

The migration may use the exact accepted pins in this document when their owning
task adopts them. `FND-009` does not modify the root workspace, install a root
dependency, create a root Bun lockfile, or approve a floating version range.

`packages/contracts` remains the cross-process schema authority. Elysia `t` and
JSON Schema are the Bun HTTP transport expression of that authority. No direct
Zod, TypeBox, Valibot, or parallel editable schema authority is approved.

The Electron boundary remains Node-based. Bun owns the target backend and future
workspace/runtime surfaces assigned by later tasks; it does not remove host Node
from Electron build tooling or embedded Node from Electron main/preload.

## Status Vocabulary

| Status | Meaning |
| --- | --- |
| `ACCEPTED` | Approved as an exact runtime dependency for its named owner and boundary |
| `ACCEPTED_DEV_ONLY` | Approved only for development, build, inspection, or type tooling |
| `BUILTIN` | Approved runtime/platform surface, not an npm manifest dependency |
| `DEFERRED` | Not approved now; the named downstream owner must decide |
| `REJECTED` | Must not be added under the current migration decision |

## Manifest And Update Policy

1. All accepted npm dependencies use exact versions, not `^`, `~`, tags, or
   other floating ranges.
2. Update one named update group at a time. Re-run exact registry, integrity,
   license, engines, deprecation, provenance, Bun/Electron boundary, audit, and
   focused regression checks before changing its pin.
3. Bun and `@types/bun` move together. Host Node, Electron, and their embedded
   runtime matrix are reviewed together, but an Electron update must not
   silently change the Bun backend.
4. OpenTelemetry packages move as one `observability-otel` group because their
   API/core/SDK/exporter compatibility is coupled.
5. A high or critical advisory, incompatible license, removed provenance, or
   unsupported engine blocks adoption until it is explicitly deferred,
   rejected, or mitigated by fresh evidence.

## Runtime And Toolchain

| Dependency | Status | Exact tested version | Class | SPDX/license source | Owner / update group |
| --- | --- | --- | --- | --- | --- |
| Bun | `BUILTIN` | `1.3.14` | Backend runtime/compiler; future workspace tool | [MIT plus bundled notices](https://api.github.com/repos/oven-sh/bun/contents/LICENSE.md?ref=bun-v1.3.14) | repo toolchain / `runtime-bun` |
| Node.js | `BUILTIN` | `24.18.0` | Electron/build host runtime | [MIT plus bundled notices](https://api.github.com/repos/nodejs/node/contents/LICENSE?ref=v24.18.0) | repo toolchain / `runtime-node-electron` |
| Electron | `ACCEPTED_DEV_ONLY` | `43.2.0` | Desktop runtime acquired by build tooling | [MIT registry metadata](https://registry.npmjs.org/electron/43.2.0) | `apps/desktop` / `runtime-node-electron` |
| electron-vite | `ACCEPTED_DEV_ONLY` | `4.0.1` | Electron build tool | [MIT registry metadata](https://registry.npmjs.org/electron-vite/4.0.1) | `apps/desktop` / `desktop-build` |
| Vite | `ACCEPTED_DEV_ONLY` | `7.3.6` | Renderer/build tool | [MIT registry metadata](https://registry.npmjs.org/vite/7.3.6) | `apps/desktop` / `desktop-build` |
| TypeScript | `ACCEPTED_DEV_ONLY` | `5.9.3` | Compiler/typechecker | [Apache-2.0 registry metadata](https://registry.npmjs.org/typescript/5.9.3) | repo toolchain / `typescript-types` |
| `@types/bun` | `ACCEPTED_DEV_ONLY` | `1.3.14` | Bun backend types | [MIT registry metadata](https://registry.npmjs.org/@types%2fbun/1.3.14) | `apps/backend-bun` / `runtime-bun` |
| `@types/node` | `ACCEPTED_DEV_ONLY` | `24.13.3` | Electron/tooling types | [MIT registry metadata](https://registry.npmjs.org/@types%2fnode/24.13.3) | `apps/desktop` / `typescript-types` |
| electron-builder | `DEFERRED` | `26.15.3` | Packaging tool candidate | [MIT registry metadata](https://registry.npmjs.org/electron-builder/26.15.3) | repo toolchain / `desktop-packaging` |

The exact runtime and build pins were independently accepted by
`FND-003`; Bun Windows x64 compile/lifecycle evidence was independently accepted
by `FND-004`. Those artifacts do not prove macOS, Windows arm64, an installed
Electron application, signing, production load, or removal of Node.

Electron-builder is not newly approved by this ADR. The fresh combined audit
reports high transitive paths, including `electron-builder -> app-builder-lib`
or `electron-winstaller`/`@electron/asar -> minimatch -> brace-expansion
<=5.0.7`. `PKG-004` and `PKG-009` must select a clean fixed packaging tree or
measured alternative. The audit's suggested downgrade is not treated as a
valid fix for the frozen migration candidate.

Fallback: keep Electron upgrades separate, preserve the current product build
until packaging tasks pass, and keep Bun backend code independent of Electron
and Node-only build APIs.

## HTTP And Schema

| Dependency | Status | Exact tested version | Class | SPDX/license source | Owner / update group |
| --- | --- | --- | --- | --- | --- |
| Elysia | `ACCEPTED` | `1.4.29` | Bun HTTP/WebSocket runtime | [MIT registry metadata](https://registry.npmjs.org/elysia/1.4.29) | `apps/backend-bun` / `backend-http` |
| `@elysiajs/openapi` | `ACCEPTED_DEV_ONLY` | `1.4.15` | Development-only docs/OpenAPI | [MIT registry metadata](https://registry.npmjs.org/@elysiajs%2fopenapi/1.4.15) | `apps/backend-bun` / `backend-http` |
| `@elysiajs/eden` | `REJECTED` | `1.4.9` | Elysia-coupled control-client candidate | [MIT registry metadata](https://registry.npmjs.org/@elysiajs%2feden/1.4.9) | `packages/contracts` / `contracts-client` |
| openapi-typescript | `ACCEPTED_DEV_ONLY` | `7.13.0` | Control-client type generation from checked-in OpenAPI | [MIT registry metadata](https://registry.npmjs.org/openapi-typescript/7.13.0) | repo toolchain / `contracts-client` |
| direct TypeBox | `REJECTED` | `NOT_TESTED` | Duplicate schema authority | Not adopted | `packages/contracts` / `schema-authority` |
| direct Zod | `REJECTED` | `4.3.6` | Duplicate schema authority | [MIT registry metadata](https://registry.npmjs.org/zod/4.3.6) | `packages/contracts` / `schema-authority` |
| `@types/json-schema` | `REJECTED` | `7.0.15` | Unneeded direct type package | [MIT registry metadata](https://registry.npmjs.org/@types%2fjson-schema/7.0.15) | `packages/contracts` / `schema-authority` |

`FND-005` independently accepted Elysia for the current-v3 HTTP, WebSocket,
binary, strict-validation, abort, loopback, and development-only OpenAPI spike.
It proved Eden technically viable but explicitly did not adopt it. `CON-008`
resolves that deferral through `ADR-MIG-002`: Eden is rejected for the migration
control-client boundary, while the already-pinned `openapi-typescript@7.13.0`
is accepted only as generation tooling. No new runtime client dependency is
approved.

Elysia internal or re-exported schema machinery is not a direct TypeBox
approval. The accepted Provider spike used AI SDK `jsonSchema`; it did not use
Zod or import `@types/json-schema`. Direct Zod and direct TypeBox would create a
second editable ADVX schema source, so both are rejected.

Fallback: keep versioned JSON Schema/OpenAPI and an ADVX transport adapter so
Elysia can be replaced without changing domain contracts. Hono and any second
HTTP framework are rejected because the accepted spikes measured no additional
benefit.

## ADR-MIG-002: Generated OpenAPI Control Client

- Status: `ACCEPTED` by independent Checker
  `con-008-checker-20260801-001` /
  `con-008-checker-context-20260801-001`.
- Decision date: 2026-08-01.
- Decision owner: Phase 01 / `CON-008`; rollout owner: Electron Main / `DES-006`.
- Decision: generate compile-time control-plane operation types from the
  deterministic `CON-007` OpenAPI document and consume them through an
  ADVX-owned `fetch` adapter. Do not adopt Eden Treaty or another runtime HTTP
  client package for this migration boundary.

### Alternatives Evaluated

| Alternative | Evidence and benefit | Decision |
| --- | --- | --- |
| Eden Treaty (`@elysiajs/eden@1.4.9`) | Elysia documents Eden as an RPC-like client that infers directly from the Elysia server type, with typed data/errors and no generation. Its fetch parameters can carry an `AbortSignal`. The exact candidate is MIT and actively published. | `REJECTED` for the migration control client. Direct inference requires the client to import an Elysia application type, couples Electron to the server framework/version graph, and cannot describe the retained Python oracle through the same boundary. |
| Generated OpenAPI operation types (`openapi-typescript@7.13.0`) | The official generator accepts local OpenAPI 3.0/3.1 JSON or YAML, emits runtime-free `paths`, `operations`, and component types, and supports request/response typing. The exact already-pinned tool is MIT. | `CHOSEN`. The checked-in OpenAPI document is a framework-neutral, deterministic compatibility boundary usable by both the Node-based Electron client and Bun backend work. |
| Handwritten untyped `fetch` calls only | No generation step or runtime package. | `REJECTED` as the target because it cannot bind all operation inputs, success statuses, and normalized error shapes to the accepted contract snapshot. The ADVX adapter remains handwritten only for transport policy, with generated types constraining its operation surface. |

Official references:

- [Elysia Eden overview](https://elysiajs.com/eden/overview) and
  [Treaty fetch parameters](https://elysiajs.com/eden/treaty/parameters).
- [`@elysiajs/eden@1.4.9` registry record](https://www.npmjs.com/package/%40elysiajs/eden).
- [openapi-typescript introduction](https://openapi-ts.dev/introduction) and
  [CLI generation contract](https://openapi-ts.dev/cli).
- [`openapi-typescript@7.13.0` registry record](https://www.npmjs.com/package/openapi-typescript).

The choice is architectural rather than a maintenance rejection: both exact
candidates are current, documented, TypeScript-native, and MIT. Eden's tighter
server-type coupling is valuable for a single Elysia-only application, but is
the wrong ownership boundary during Python/Bun coexistence and for the planned
`DES-006` dual-backend adapter.

### Approved Tooling And Ownership

- The only approved additional surface for this decision is the existing root
  dev/build pin `openapi-typescript@7.13.0`. It remains generation-only and must
  not enter the Electron or Bun runtime dependency graph.
- No `@elysiajs/eden`, `openapi-fetch`, Axios, or other control-client runtime
  dependency is approved. `DES-006` owns a small adapter over the Web-standard
  `fetch`, `Request`, `Response`, `Headers`, and `AbortSignal` APIs already
  available in Electron Main's Node runtime.
- The editable schema authority remains `packages/contracts` and its canonical
  HTTP operation registry. Elysia route schemas and the `CON-007` OpenAPI file
  are transport projections, not new editable domain-model authorities.
- The generation input is
  `apps/backend-bun/openapi/advx-control-plane.openapi.json`; the reserved
  output is `packages/contracts/src/generated/bun-control-openapi.ts`. This
  distinct output must coexist with the Python-derived
  `packages/contracts/src/generated/openapi.ts` until planned cutover.
- `DES-006` adds one deterministic generation command equivalent to
  `openapi-typescript apps/backend-bun/openapi/advx-control-plane.openapi.json -o packages/contracts/src/generated/bun-control-openapi.ts`
  and a drift check that regenerates from the checked-in input and byte-compares
  the output. Both the existing `openapi:check` snapshot gate and the generated
  type drift gate must pass before the Bun control client is accepted.
- Generated `operations` keyed by the stable `operationId` values are the
  preferred compile-time binding. Runtime status/body validation remains owned
  by the ADVX adapter and canonical contract validators; generated TypeScript
  declarations are not runtime validation.

### Desktop Transport Contract

`DES-006` must place the generated control client behind the existing
desktop-facing compatibility adapter. Renderer stores, hooks, IPC, and preload
must not import Elysia application types, generated route maps, backend-kind
conditionals, or the startup token.

The ADVX adapter owns:

- the loopback base URL, startup-scoped bearer token, protocol-version header,
  JSON serialization, and secret exclusion from errors and logs;
- selection of the operation-specific timeout and composition of that timeout
  with a caller-provided abort signal;
- distinct normalization of caller abort, deadline expiry, network failure,
  non-2xx status, malformed JSON, and schema/protocol mismatch into the stable
  desktop `BackendClientError` boundary;
- parsing declared normalized error bodies by status/code, with a bounded
  fallback for undeclared or malformed error responses;
- zero implicit retries. Any future retry remains an explicit operation policy
  above the transport and must preserve idempotency and cancellation rules.

The Python client remains the live/default source until its planned selector
and cutover tasks. `DES-006` may add the Bun implementation beside it and compare
both through the same adapter, but this ADR does not authorize switching the
live client, changing renderer behavior, or removing the Python oracle.

### Realtime, Binary, And Non-Goals

This decision covers authenticated JSON control-plane HTTP operations only.
Realtime WebSocket envelopes and binary audio/frame codecs remain explicitly
versioned contracts owned by `CON-005`, `CON-006`, `CON-010`, and `DES-007`;
they must not be inferred from Eden or generated OpenAPI types.

Non-goals for `CON-008` are client implementation, route handlers, runtime
validation changes, auth redesign, retry policy expansion, WebSocket/binary
transport, renderer or IPC changes, Python parity execution, runtime selection,
and Python removal.

### Rollout, Rollback, And Exit

- Rollout: `DES-006` generates the reserved type file, implements the
  ADVX-owned Node-compatible adapter, retains the Python implementation, and
  proves both implementations satisfy the desktop-facing control interface.
- Rollback: select the Python adapter, stop the Bun backend, and remove the Bun
  generated output/adapter without changing renderer consumers or canonical
  schemas. The checked-in OpenAPI document may remain as development contract
  evidence.
- Exit criteria: reopen this ADR only if the OpenAPI projection cannot express
  an accepted control operation or error contract, the deterministic drift
  gate cannot be maintained, or measured adapter complexity becomes materially
  greater than an Elysia-independent alternative. Eden may be reconsidered only
  after Python coexistence ends and only if Elysia types remain behind the
  adapter/package boundary; it is not an automatic fallback.

## Database

| Dependency | Status | Exact tested version | Class | SPDX/license source | Owner / update group |
| --- | --- | --- | --- | --- | --- |
| `bun:sqlite` | `BUILTIN` | Bun `1.3.14` builtin | Backend SQLite runtime | [Bun MIT plus bundled notices](https://api.github.com/repos/oven-sh/bun/contents/LICENSE.md?ref=bun-v1.3.14) | `apps/backend-bun` / `runtime-bun` |
| drizzle-orm | `ACCEPTED` | `0.45.2` | Runtime repository/SQL mapping | [Apache-2.0 registry metadata](https://registry.npmjs.org/drizzle-orm/0.45.2) | `apps/backend-bun` / `database-runtime` |
| drizzle-kit | `NOT_ADOPTED` | `0.31.10` re-audited | Removed schema tooling candidate | [MIT registry metadata](https://registry.npmjs.org/drizzle-kit/0.31.10) | none; disposable historical spike only |
| `@libsql/client` | `NOT_ADOPTED` | `0.17.4` historical spike | Removed Studio helper candidate | [MIT registry metadata](https://registry.npmjs.org/@libsql%2fclient/0.17.4) | none; disposable historical spike only |

`FND-006` independently accepted the exact Drizzle runtime spike, explicit
migration application, WAL, nested transactions, crash recovery, reopen, and
bounded local Studio behavior. The `DAT-002` re-audit on 2026-08-03 still
attributes the moderate esbuild advisory to
`drizzle-kit -> @esbuild-kit/esm-loader -> @esbuild-kit/core-utils -> esbuild
0.18.20`. `drizzle-kit` and its `@libsql/client` Studio helper are therefore not
adopted in any importer or installed dependency graph. Optional Drizzle peer
metadata may still name `@libsql/client`; no package snapshot is installed for
it. ADVX owns reviewed plain SQL, its exact checksum, and its runtime journal;
the historical Studio proof does not approve a remote database or a retained
development dependency.

The Online Backup verdict stays `NO_GO_BUN_API`: Bun `1.3.14` has no accepted
true SQLite Online Backup API. `Database.serialize`, `VACUUM INTO`, copying
DB/WAL/SHM files, and the Python helper are not approved substitutes. The
Python backup exercise is migration-boundary evidence only, not final
architecture. `ADR-MIG-001` makes the runtime fail closed for every destructive
migration without a verified Online Backup API adapter. `DAT-010` owns the
temporary retained-Python adapter; no destructive post-Python migration is
allowed until a true Bun/native adapter passes a separate proof gate.

Fallback: explicit SQL migrations and repository ports. No local Studio stack
is retained, so removal does not change production persistence.

## Provider And Scheduler

| Dependency | Status | Exact tested version | Class | SPDX/license source | Owner / update group |
| --- | --- | --- | --- | --- | --- |
| AI SDK Core (`ai`) | `ACCEPTED` | `7.0.42` | Provider runtime behind `ModelGateway` | [Apache-2.0 registry metadata](https://registry.npmjs.org/ai/7.0.42) | `apps/backend-bun` / `provider-sdk` |
| `@ai-sdk/openai-compatible` | `ACCEPTED` | `3.0.17` | Provider adapter | [Apache-2.0 registry metadata](https://registry.npmjs.org/@ai-sdk%2fopenai-compatible/3.0.17) | `apps/backend-bun` / `provider-sdk` |
| p-queue | `ACCEPTED` | `9.3.3` | Queue primitive behind ADVX scheduler | [MIT registry metadata](https://registry.npmjs.org/p-queue/9.3.3) | `apps/backend-bun` / `scheduler` |

`FND-007` independently accepted deterministic-fake and recorded-provider
behavior for structured/streaming calls, cancellation, bounded admission,
capacity release, deadlines, and final fences. It did not produce credentialed
live Provider evidence.

The SDK is usable only behind an ADVX-owned `ModelGateway`, with SDK retries
explicitly set to `0`. p-queue is usable only behind the ADVX scheduler,
admission, deadline, capacity, epoch/sequence, and final-publication fence
wrapper. p-queue does not own product eligibility or persistence.

BullMQ, Redis, and any second queue are rejected: they add sidecar/distributed
semantics and provided no measured benefit over the accepted local scheduler
spike. Fallbacks are the stable ADVX ports: a direct recorded HTTP adapter
behind `ModelGateway` and another in-process queue behind the scheduler
interface.

## Logging And Tracing

| Dependency | Status | Exact tested version | Class | SPDX/license source | Owner / update group |
| --- | --- | --- | --- | --- | --- |
| Pino | `ACCEPTED` | `10.3.1` | Local structured logger | [MIT registry metadata](https://registry.npmjs.org/pino/10.3.1) | `apps/backend-bun` / `observability-logging` |
| `@opentelemetry/api` | `ACCEPTED` | `1.9.1` | Trace API/context | [Apache-2.0 registry metadata](https://registry.npmjs.org/@opentelemetry%2fapi/1.9.1) | `apps/backend-bun` / `observability-otel` |
| `@opentelemetry/core` | `ACCEPTED` | `2.10.0` | W3C propagation | [Apache-2.0 registry metadata](https://registry.npmjs.org/@opentelemetry%2fcore/2.10.0) | `apps/backend-bun` / `observability-otel` |
| `@opentelemetry/resources` | `ACCEPTED` | `2.10.0` | Allowlisted resources | [Apache-2.0 registry metadata](https://registry.npmjs.org/@opentelemetry%2fresources/2.10.0) | `apps/backend-bun` / `observability-otel` |
| `@opentelemetry/sdk-trace-base` | `ACCEPTED` | `2.10.0` | Trace SDK primitives | [Apache-2.0 registry metadata](https://registry.npmjs.org/@opentelemetry%2fsdk-trace-base/2.10.0) | `apps/backend-bun` / `observability-otel` |
| `@opentelemetry/sdk-trace-node` | `ACCEPTED` | `2.10.0` | Tracer provider proven under Bun | [Apache-2.0 registry metadata](https://registry.npmjs.org/@opentelemetry%2fsdk-trace-node/2.10.0) | `apps/backend-bun` / `observability-otel` |
| `@opentelemetry/exporter-trace-otlp-http` | `ACCEPTED` | `0.221.0` | Optional loopback exporter | [Apache-2.0 registry metadata](https://registry.npmjs.org/@opentelemetry%2fexporter-trace-otlp-http/0.221.0) | `apps/backend-bun` / `observability-otel` |

Pino may write only through an ADVX allowlist/redaction wrapper to local JSONL.
JSONL remains authoritative. OpenTelemetry may record only allowlisted
correlation and timing attributes; it must not record prompts, raw or complete
media, credentials, Provider raw payloads/responses, hidden reasoning, private
frames/screenshots, or arbitrary Error/request objects. OTel is not a raw
persistence layer.

`FND-008` independently accepted local Windows x64 W3C propagation, SDK spans,
two real loopback OTLP/HTTP exports, authoritative correlated JSONL, and hostile
privacy canary exclusion for the disposable spike. The Provider stage remained
synthetic. The evidence does not close `GAP-PRIV-001` or prove a remote
collector, trace UI, packaged Electron application, production network, or
credentialed Provider.

Remote telemetry remains disabled. `OBS-006` may choose at most one local trace
UI later. Winston, a second logger, a second tracer, and parallel raw trace
persistence are rejected because no measured benefit offsets the duplicated
privacy and correlation surfaces. Fallback: disable export and retain the
authoritative JSONL stream behind ADVX-owned logger/tracing wrappers.

## Test Tooling

| Dependency | Status | Exact tested version | Class | SPDX/license source | Owner / update group |
| --- | --- | --- | --- | --- | --- |
| MSW | `ACCEPTED_DEV_ONLY` | `2.15.0` | HTTP, SSE, and WebSocket Provider fault injection | [MIT registry metadata](https://registry.npmjs.org/msw/2.15.0) | `apps/backend-bun` / `provider-fault-tests` |

`TST-005` keeps MSW outside production dependencies and exercises the active
AI SDK HTTP/SSE and StepFun ASR HTTP/SSE adapters without replacing their
request clients. Its WebSocket handler is a reserved remote-Provider transport
fixture because no active runtime Provider adapter currently uses WebSocket;
it does not add or claim a new production transport. Fallback is the existing
injected-Fetch test boundary, with less faithful network interception.

## State Machine

XState and other state-machine libraries are `REJECTED` with exact tested
version `NOT_TESTED`. No `FND-003..008` spike measured a lifecycle-visualization
benefit. Explicit ADVX-owned state remains the default. Adoption may reopen only
through a focused future task with measured benefit; a fallback possibility is
not simultaneous dependency approval.

## Root OpenAPI Tooling Security Mitigation

`FND-010` pins root `openapi-typescript` to `7.13.0` and applies the same
workspace-wide override set in Bun and pnpm:
`@redocly/openapi-core=1.34.18`, `js-yaml=4.3.0`, and
`brace-expansion=5.0.8`. Both managers register only
`patches/brace-expansion@5.0.8.patch`. The patch changes only the tail of
`dist/commonjs/index.js`: it copies the existing named exports onto `expand`
and makes that callable function the CommonJS export. It does not modify the
ESM build, set or preserve an enumerable `__esModule` marker, change brace
semantics, or change product code.

This is a security mitigation, not a general dependency-upgrade policy.
`js-yaml@4.3.0` removes the root OpenAPI path for
`GHSA-52cp-r559-cp3m`; fixed `brace-expansion@5.0.8` removes
`GHSA-mh99-v99m-4gvg` without crossing the declared `minimatch` major ranges.
Fresh pnpm production/full audits and Bun full audit report zero high or
critical findings. The resolved tree intentionally retains
`minimatch@3.1.5`, `5.1.9`, `9.0.9`, and `10.2.6`; all four consume the single
fixed brace implementation while preserving their own public APIs.

Maker005's conclusion that a global `minimatch@10.2.6` override was safe is
withdrawn. Checker004 proved that override forced `dir-compare@4.2.0` across a
declared major boundary and broke its public `includeFilter` path. The accepted
candidate contains no global minimatch override. Node `24.18.0` and Bun
`1.3.14` pass the callable CommonJS adapter, unchanged ESM named exports, the
Redocly header path, glob/filelist/dir-compare consumers, Electron asar
unpack/unpackDir, and app-builder's matcher path. A plain unpatched
`brace-expansion@5.0.8` still reproduces the CommonJS not-callable failure,
which binds the compatibility claim to the one adapter.

License evidence is exact-version registry metadata:
`@redocly/openapi-core@1.34.18`, `js-yaml@4.3.0`, and
`brace-expansion@5.0.8` are MIT. The retained minimatch versions keep their
existing license obligations; this mitigation does not introduce a new direct
license family.

Owner: repository toolchain / `root-openapi-security`, with packaging impact
rechecked by `PKG-004` and `PKG-009`. Exit strategy: remove the global
`brace-expansion` override and CommonJS adapter when every supported consumer
natively selects a fixed brace release that is callable for legacy CommonJS
parents or no callable parent remains. The removal must regenerate both locks
through their owning managers and repeat frozen installs, full audits, the
Node/Bun consumer matrix, contracts byte parity, and Windows `--dir` packaging
compatibility before acceptance. Until then, the remaining risk is patch
maintenance: each brace update must review the exact CJS tail, ESM non-change,
upstream safety limits, patch application, and installed-byte parity in both
managers.

## Security Review

Fresh evidence was retrieved on 2026-07-30 from exact-version npm registry
metadata, npm tarball integrity records, official runtime/upstream sources,
`bun audit --json`, and `npm audit --json`.

| Finding | Severity | Directness and path | Decision |
| --- | --- | --- | --- |
| `GHSA-mh99-v99m-4gvg`, `brace-expansion <=5.0.7` | High | Transitive packaging paths under direct electron-builder | electron-builder `26.15.3` is `DEFERRED`; no new migration adoption |
| `GHSA-67mh-4wv8-2f99`, `esbuild <=0.24.2` | Moderate | Transitive under the rejected drizzle-kit candidate | `DAT-002` removes the tooling tree from the approved stack; no importer or installed graph contains it |

The npm report expands these two root advisories into `16` high and `4`
moderate package-level findings in the combined tree; no critical advisory was
reported. No accepted runtime direct package had a direct advisory. The raw
audit outputs and normalized path treatment are in the Maker artifact.

## License Review

Accepted dependencies are MIT or Apache-2.0. Both are permissive and compatible
with the current repository distribution model when required license and NOTICE
attribution is retained in the distribution and future SBOM. The fresh review
found no accepted-license conflict. Deferred and rejected entries are not
license approval for adoption.

## Evidence And Limits

Machine-readable decisions, registry/integrity/provenance inventory, audit
normalization, license review, overlap review, source state, validator summary,
raw commands, timestamps, and manifest are stored at:

`.omx/artifacts/typescript-bun/FND-009/fnd-009-maker-20260730-001/`

Accepted spike evidence is limited to the independently accepted Checker
artifacts for `FND-003` through `FND-008`, as indexed by `EVIDENCE.md`. This ADR
does not claim dependency adoption, a clean root audit, macOS support, packaged
Electron behavior, signing, production load, remote telemetry, credentialed
Provider behavior, or complete privacy closure.
