# PKG-009 Security, License, And SBOM Decision

## Tool Boundary

This task uses the tools already present in the repository and does not install
another scanner. The focused checker runs:

- `bun audit --json` for the Bun dependency graph;
- `pnpm licenses list --json` for exact installed package/license metadata;
- a local high-confidence secret scanner over repository text inputs, excluding
  `.git`, `node_modules`, `.advx-data`, migration evidence, build caches, and
  `.env*` files;
- a CycloneDX 1.5 SBOM generated from the installed license inventory;
- a lifecycle/trusted-build review of pnpm workspace policy and installed
  package manifests; and
- generated/source-map exposure checks plus a hash-bound artifact manifest.

The local scanner is an equivalent reviewed scanner for this offline evidence
run. It only reports high-confidence private-key and provider-token formats and
never records matching content, environment values, or user data.

## License Policy

Direct runtime and build dependencies are accepted only when their installed
license is one of `MIT`, `Apache-2.0`, `BSD-3-Clause`, or `ISC`. The current
transitive inventory additionally allowlists the reviewed permissive or weakly
copyleft expressions `BSD-2-Clause`, `0BSD`, `BlueOak-1.0.0`, `CC-BY-4.0`,
`MPL-2.0`, `Python-2.0`, `(AFL-2.1 OR BSD-3-Clause)`, `(MIT OR CC0-1.0)`,
`(WTFPL OR MIT)`, `WTFPL OR ISC`, and `WTFPL`. Any unlisted expression is a
review failure; GPL/AGPL/SSPL and unknown expressions are not silently accepted.
The direct-runtime decision remains narrower than this transitive report and
must retain required license/NOTICE attribution in future distributions.

## Lifecycle And Generated-Artifact Policy

The root `trustedDependencies` list remains empty. pnpm may build only the
explicit `electron` and `esbuild` packages; `electron-winstaller` and `msw`
remain explicitly denied. Declared lifecycle scripts are reported but are not
treated as trusted merely because they exist in an installed manifest.

The artifact manifest records the dirty source HEAD, runtime/tool versions,
compiled Bun backend identity, desktop output tree identity, report hashes,
resource hashes, schema/migration metadata, and unsigned local evidence state.
Generated output is rejected when it contains source maps, source files,
private-key files, or environment files. The manifest itself is written after
all referenced reports and is intentionally excluded from its own hash list.
