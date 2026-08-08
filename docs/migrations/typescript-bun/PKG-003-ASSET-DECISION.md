# PKG-003 Runtime Asset Decision

## Decision

The Bun backend ships its runtime assets by **embedding them in the compiled
executable**. PKG-003 does not add backend files to `extraResources`; the
Electron `extraResources` copy of the executable remains PKG-004's packaging
boundary. The compiled backend must start from a staged `resources/backend`
directory that contains only the executable and must not write into that
directory, ASAR, or any installed resource path.

## Runtime Inventory

| Category | Asset or boundary | Strategy | Reason / owner |
| --- | --- | --- | --- |
| Migrations | Six `src/infrastructure/persistence/sqlite/migrations/*.sql` files | Embed through Bun `with { type: 'text' }` imports | Migration SQL is immutable runtime input; checksums remain in the typed manifest and PKG-003 verifies source hashes |
| Schema/version data | Migration names, versions, checksums, and destructive flags in `migrations/index.ts` | Embed as TypeScript data | No standalone schema file is read at runtime; PKG-003 includes the SQL bytes in the compile source aggregate |
| Backend identity | `apps/backend-bun/package.json` | Embed through the static JSON import in `src/main.ts` | `/version` and debug metadata need the package version/name without a working-directory lookup |
| Prompt/persona/mode resources | No standalone Bun backend files | None; code/contracts only | Current Bun runtime has no file-backed prompt/persona/mode lookup; Python skill resources remain parity-oracle/test inputs |
| MIME/media metadata | No standalone Bun backend files | None; contracts and protocol constants | Metadata is compiled TypeScript; no resource path is resolved at runtime |
| WASM/native modules | Bun `bun:sqlite` and `bun:ffi`; no backend `.node` or backend WASM asset | Runtime-provided | Native risk is covered by ADR-MIG-004; desktop `@echogarden/fvad-wasm` is a separate desktop boundary |
| Certificates | None required for the local control plane | None | TLS/certificate provisioning is not part of this local Electron loop |
| Static debug assets | None required at runtime | None | Debug, replay, profiles, logs, and diagnostics are written under explicit user-data/artifact paths |

## Test-Only Inputs Not Shipped

These files remain available to tests and tooling but are not runtime backend
assets and must not be copied into `resources/backend`:

- `apps/backend-bun/src/application/evaluation/fixtures/agent-eval-smoke.json`;
- `apps/backend-bun/src/testing/fixtures/tst-006-negative-corpus.json`;
- `apps/backend-bun/src/infrastructure/persistence/sqlite/legacy-database-fixture.py`;
- `apps/backend-bun/openapi/advx-control-plane.openapi.json` (generated
  contract snapshot used by the OpenAPI check).

## Acceptance Boundary

PKG-003 records byte hashes for every embedded asset, verifies that the Bun
compile manifest names the same assets and no copied backend assets, stages a
packaged-like `resources/backend` directory containing only the executable,
and launches through the existing Electron supervisor with a hostile working
directory. Authenticated health, readiness, version identity, and database
startup must pass while the staged resource tree remains byte-identical. A
missing executable must fail with the existing explicit missing-resource
error. PKG-004 owns the electron-builder `extraResources` handoff.
