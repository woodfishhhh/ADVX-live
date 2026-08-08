# PKG-001 Compile Decision

## Locked Command

The single supported backend compile command is `pnpm build:bun-backend` (the
script is Bun-native and invokes `bun build` with an argument array). It uses
`apps/backend-bun/src/main.ts` as the entry point and writes
`apps/backend-bun/dist/advx-backend-bun.exe` on Windows (or the platform
equivalent name). The command records the exact output path and SHA-256 hash in
`backend-manifest.json` beside the executable.

The compile contract is intentionally explicit:

- target: Bun runtime, native host platform and architecture;
- source maps: `none`; the command removes Bun 1.3.14's stray `main.js.map`
  sidecar when the compiler leaves one despite that request, so no source-map
  file is shipped beside the executable;
- defines and external modules: empty; Bun bundles the backend dependency graph;
- embedded assets: the statically imported backend package manifest;
- copied assets: none in PKG-001 (asset packaging is PKG-003/PKG-004);
- environment inlining: disabled;
- compiled executable autoload: `.env`, `bunfig.toml`, `package.json`, and
  `tsconfig.json` all disabled with the Bun 1.3.14 CLI controls;
- reproducibility inputs: Bun/Node/pnpm versions, git HEAD and tracked dirty
  diff, source aggregate hash, source count, and package manifest identity.

## Verification Boundary

`pnpm test:pkg-001` type-checks the two PKG-001 scripts, compiles the same
source/configuration twice into clean directories, compares the source/config
inputs and output bytes, and records any bounded Bun metadata difference rather
than assuming byte identity. It then launches the first executable through the
existing Electron backend supervisor from a hostile working directory containing
conflicting `.env`, `bunfig.toml`, and `package.json` files. The parent process
sets `BUN_BE_BUN=1` and a Provider-looking secret; the supervisor allowlist must
scrub both before launch. Authenticated `/health` readiness and clean disposal
are required, and the hostile Bunfig preload must not run.

The PKG-001 maker run passed on Windows x64 with Bun 1.3.14. Both clean builds
were byte-identical (`101645824` bytes); health returned `200`, no poison marker
was written, and the supervised child reached `disposed` without an orphan.
The Python backend remains the parity oracle and is not altered by this task.
