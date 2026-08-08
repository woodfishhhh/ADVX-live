# ADVX contracts

`@advx/contracts` is the framework-neutral, hand-authored runtime-schema
authority. A declaration created with `schema` produces all three contract
views:

- `InferSchema<typeof declaration>` static TypeScript types;
- `check`, `safeParse`, and path-aware `parse` runtime validation;
- stable JSON Schema through `declaration.jsonSchema`, `SchemaRegistry`, and
  JSON Schema/OpenAPI `$ref` helpers.

The dependency-free DSL intentionally supports only the subset ADVX owns:
strings, finite numbers, integers, booleans, JSON literals/enums, optional
properties, strict objects, bounded records and redacted JSON, arrays, unions,
nullable values, and explicit refinements. Strict objects reject unknown keys.
Bounded redacted JSON rejects credential and raw-media field names. This package
does not claim to implement the complete JSON Schema specification.

Production code imports from `@advx/contracts`. Synthetic fixture helpers are
isolated at `@advx/contracts/fixtures`; the production root does not export or
import them.

## HTTP control plane

Hand-authored HTTP schemas live under `src/http/` and are exported from both
`@advx/contracts` and `@advx/contracts/http`. `httpOperationRegistry` is the
canonical registry for all 47 accepted HTTP method/path bindings. Every entry
has a stable operation ID, strict path/query/body schemas, response status to
runtime-schema mappings, and normalized error code/status/retryability records.

Provider status, model discovery, capability results, runtime specs, debug
records, replay bundles, and fixtures never serialize credentials. The
`PUT /configuration/providers` entry is explicitly marked as a controlled
secret boundary: its public metadata schema excludes keys, while the future
internal setup adapter owns secret ingestion outside the serializable public
contract. Debug image responses are metadata-only contracts; raw image/audio
and Provider wire payloads are not public ADVX schemas.

Replay schemas require redacted bundles, role-whitelisted Provider outputs,
contiguous ordered events, unique correlated output identities, and explicit
external-Provider opt-in for live replay. Recorded replay rejects that opt-in.

## Binary ingest

`@advx/contracts/binary` owns the six accepted `ADVX-BIN` bindings: audio and
frame for readable v1, v2, and v3. V1/v2 are compatibility readers; v3 is the
canonical current writer. Exported layout constants document each big-endian
fixed-field byte offset and the JSON/body boundaries. Bodies remain opaque,
non-enumerable `Uint8Array` data and are omitted from JSON serialization.

## Generated Bun OpenAPI

`src/generated/bun-control-openapi.ts` is generated from the Elysia/Bun OpenAPI
snapshot. It is a typed projection and drift artifact; the hand-authored
runtime schemas and operation registries remain the contract authority.

Do not edit files under `src/generated/` manually. From the repository root:

```powershell
bun run contracts
bun run contracts:bun-openapi:check
```

The generated surface contains only the Bun control-plane projection. Historical
Python OpenAPI output is retained through accepted migration evidence and Git,
not as an active package export.
