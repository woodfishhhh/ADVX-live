# PKG-004 Packaging Decision

## Decision

Electron-builder packages the compiled Bun backend through `extraResources`.
The source directory is `apps/backend-bun/dist`, resolved relative to the
desktop project, and the unpacked destination is `resources/backend`. The
filter admits only the platform executable named `advx-backend-bun.exe` on
Windows (or `advx-backend-bun` on other supported hosts); the build manifest,
source maps, test fixtures, and Python files are not shipped as runtime
resources.

The supported local packaging sequence is `pnpm package:desktop`:

1. compile the Bun backend with `pnpm build:bun-backend`;
2. bundle Electron Main, preload, and renderer output;
3. run electron-builder for the locked Windows x64 unpacked target.

The existing Main-process resolver keeps development and packaged paths
distinct. Packaged mode resolves `process.resourcesPath/backend/<executable>`;
development mode resolves `apps/backend-bun/dist/<executable>`. The backend
supervisor supplies the explicit startup token, port, working directory, and
user-data path, so the executable never writes into ASAR or installed
resources.

## Acceptance Boundary

`PKG-004` proves a real electron-builder `--dir` output on Windows x64. The
checker verifies that the unpacked resource contains exactly the compiled
backend executable, that its bytes match the compile manifest, and that a
missing executable fails with the explicit resolver error before launch. It
then starts the packaged resource through the Electron supervisor and checks
authenticated health, readiness, version identity, database schema metadata,
read-only resource bytes, redirected runtime data, and clean disposal.

This is unpacked local evidence only. The artifact is unsigned and does not
claim installer, signing, upgrade, uninstall, macOS, or Windows arm64 proof;
those claims remain owned by later Phase 08 tasks.
