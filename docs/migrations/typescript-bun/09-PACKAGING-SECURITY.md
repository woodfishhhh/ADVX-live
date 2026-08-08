# Phase 08: Packaging And Security

> Entry: `GATE-07`
>
> Exit: `GATE-08`

## Goal

Ship the Bun backend as a deterministic, supervised component of the Electron
application and prove that installed lifecycle, filesystem, privilege, secret,
artifact, and platform behavior remain safe.

Development success with `bun run` is not packaging proof. The exit gate
requires the compiled backend inside an installed application.

## Repository Anchors

- `electron-builder.yml` owns the desktop packaging configuration.
- `apps/desktop/src/main` owns backend process launch, secret handoff, app
  lifecycle, and Electron privileges.
- Phase 05 defines the runtime-neutral supervisor and Bun compiled mode.
- Phase 06 defines diagnostics and crash/profile artifact boundaries.
- Phase 07 defines clean CI and installed E2E evidence.

## Release Artifact Model

Each build must emit a manifest binding:

```text
source commit
dirty-tree status
Bun/Electron/electron-builder versions
target OS and architecture
backend compile command
backend executable hash and size
desktop application hash and size
included resource hashes
contract/schema versions
database migration head
security scan reports
test/evidence run IDs
signing/notarization state
```

Unsigned local test artifacts must say `unsigned`. They must never be described
as release-ready signed packages.

## Filesystem And Process Rules

- Application resources are immutable after installation.
- SQLite, logs, traces, dumps, profiles, and user configuration live under
  Electron-managed user-data paths.
- Backend working-directory assumptions are prohibited.
- Bundled assets are read-only; migrations never write inside ASAR/resources.
- Electron Main owns the backend child process and its full process tree.
- App quit, crash, update, uninstall, and test timeout cannot leave an orphan.
- Provider credentials are not embedded in JavaScript, ASAR, executable
  resources, environment dumps, command lines, or crash annotations.

## Tasks

### `PKG-001` Deterministic Backend Compile

Create one build command using the validated Bun compile path from Phase 00.
Record:

- entry point;
- target;
- defines/external modules;
- embedded or copied assets;
- source-map policy;
- explicit disabling of compiled-executable `.env`, bunfig, and package.json
  autoload through the current Bun API/CLI controls;
- reproducibility inputs;
- output path;
- hash manifest.

Build the same commit twice in a clean environment and investigate unexpected
differences rather than assuming byte-for-byte reproducibility is available.

Launch the artifact from a hostile working directory containing conflicting
`.env`, `bunfig.toml`, and `package.json`. It must use only Electron's explicit
startup configuration and must not load Provider secrets or runtime settings
from that directory. Repeat with the parent environment containing
`BUN_BE_BUN=1`; the Electron supervisor must scrub it and start the backend
entrypoint normally.

### `PKG-002` Platform Target Matrix

Lock `ADR-MIG-004` with at least:

| Platform | Development | CI Build | Installed Proof | Release Requirement |
| --- | --- | --- | --- | --- |
| Windows x64 | Required | Required | Required | Required |
| Windows arm64 | Decision | Decision | Decision | Decision |
| macOS arm64 | Desired | Required if supported | Required or accepted limitation | Product decision |
| macOS x64 | Decision | Decision | Decision | Decision |

For each target, record Bun compile support, minimum OS, Electron target, native
dependency risk, signing path, and available runner/hardware.

Cross-compilation is not a substitute for installed execution on that platform.

### `PKG-003` Runtime Assets

Inventory every non-code backend dependency:

- migrations;
- schema/version data;
- prompt/persona/mode resources;
- MIME/media metadata;
- WASM or native modules;
- certificates if explicitly required;
- static debug assets.

Choose embed versus `extraResources` deliberately. Verify packaged path
resolution, read-only behavior, missing-file errors, and artifact hashes.

### `PKG-004` electron-builder Integration

Package the compiled backend through `extraResources` or another reviewed
electron-builder mechanism. Configure:

- per-platform source path;
- executable filename and permissions;
- unpacked-resource location;
- artifact inclusion checks;
- development versus packaged resolution;
- version compatibility handshake.

Add a packaging assertion that fails when the executable or required asset is
missing, rather than discovering it after installation.

### `PKG-005` Installed Data Paths

Install the application into a clean test profile and prove:

- application resources stay unchanged;
- user-data and backend-data paths are writable and separate as designed;
- database, WAL/SHM, logs, diagnostics, screenshots, dumps, and profiles appear
  only in declared locations;
- spaces and non-ASCII Windows paths do not break launch;
- upgrade preserves user state;
- uninstall behavior matches the documented retention decision.

### `PKG-006` Process Lifecycle

Verify normal and abnormal lifecycle:

- first start;
- restart;
- backend crash;
- Electron renderer crash;
- app quit during Provider work;
- forced app termination;
- Windows logoff/shutdown signal where testable;
- upgrade/relaunch;
- uninstall;
- test timeout.

Use process-tree evidence to prove no backend remains. Retries and force-kill
must be bounded and diagnostics must retain the original exit cause.

### `PKG-007` Electron Fuses And ASAR Integrity

Review and enable Electron fuses appropriate to this application, including
Node/CLI and ASAR integrity controls where supported by the chosen Electron
version.

Verify:

- expected fuses in the packaged binary;
- application still launches;
- preload/IPC behavior remains intact;
- backend resources remain discoverable;
- tampered ASAR or backend artifact fails clearly;
- renderer cannot use disabled Node capabilities.

Do not flip fuses without installed smoke evidence.

### `PKG-008` Local Crash Evidence

Configure Electron `crashReporter` for local dump generation only unless a
separate human decision authorizes upload.

Prove:

- a deliberate test crash creates a bounded local artifact;
- annotations contain versions and IDs, not secrets or raw user content;
- diagnostics manifest can reference the dump without embedding it by default;
- retention/deletion is documented;
- crash upload endpoint remains disabled.

### `PKG-009` Security, License, And SBOM Reports

Produce:

- secret scan, preferably Gitleaks or an equivalent reviewed scanner;
- `bun audit` result;
- dependency/license report with an explicit allow/deny policy;
- CycloneDX or SPDX SBOM, for example via Syft if adopted;
- artifact manifest and hashes;
- package lifecycle-script/trusted-dependency review;
- generated-file and source-map exposure review.

Candidate tools are adopted only after checking current maintenance, license,
Windows support, output format, and CI behavior. Security findings are triaged;
reports are not green merely because exit codes are ignored.

### `PKG-010` Installed Windows Pipeline

On a clean Windows environment:

```text
install
-> launch
-> backend ready/version handshake
-> start Session
-> recorded text/frame/microphone/system-audio flow
-> barrage/silence reaches overlay
-> diagnostics bundle
-> stop
-> restart
-> uninstall
-> orphan/path audit
```

Record installer/application/backend hashes, OS build, architecture, paths,
process evidence, and artifacts.

### `PKG-011` macOS Validation

Run the equivalent package and lifecycle path on supported macOS targets. If
hardware, credentials, or platform support is unavailable:

- mark the task `BLOCKED`, not `DONE`;
- record the exact missing authority/resource;
- retain cross-build evidence separately;
- state what release claim cannot yet be made;
- provide the next executable validation command/runbook.

The task may become `ACCEPTED_LIMITATION` only when an authorized human changes
the current release platform matrix, records the unsupported claim and revisit
owner, and downstream release documentation stops claiming that target.

### `PKG-012` Signed Update And Rollback Runbook

Design without enabling production updates:

- signing and notarization identities;
- secret custody;
- CI authority;
- artifact promotion;
- update metadata and channel policy;
- backend/desktop compatibility;
- staged rollout;
- rollback and database compatibility;
- incident stop switch;
- evidence required before publish.

The runbook must incorporate the current `PKG-011` result. If it is
`ACCEPTED_LIMITATION`, the runbook must not claim, sign, notarize, or publish for
the unsupported target.

This planning task does not sign, notarize, publish, deploy, or turn on
auto-update.

## Security Review Checklist

- [ ] Context isolation and sandbox settings match the desktop threat model.
- [ ] IPC sender/frame validation is explicit.
- [ ] Preload exposes no generic invoke, filesystem, shell, or HTTP primitive.
- [ ] Loopback HTTP/WS is authenticated and origin/host behavior is bounded.
- [ ] Startup tokens and Provider secrets avoid CLI/log/crash artifacts.
- [ ] Executable/resource integrity is checked before launch.
- [ ] Database and diagnostics file permissions are reviewed.
- [ ] Remote telemetry and crash upload are disabled by default.
- [ ] Dependency lifecycle scripts and trusted packages are reviewed.
- [ ] No Python interpreter or Python package is bundled.

## `GATE-08` Packaging Exit

- [ ] Backend compile command and artifact manifest are deterministic enough to
      reproduce and diagnose.
- [ ] Compiled Bun autoload is disabled and the hostile-working-directory smoke
      proves no ambient `.env`/bunfig/package.json or `BUN_BE_BUN` affects
      startup.
- [ ] `ADR-MIG-004` locks the platform matrix and unresolved claims.
- [ ] Required assets resolve in packaged read-only resources.
- [ ] Installed data is written only to documented user-data paths.
- [ ] Start, crash, restart, quit, update/relaunch, and uninstall leave no
      orphan backend.
- [ ] Electron fuses and ASAR/resource integrity pass installed smoke tests.
- [ ] Local crash evidence is bounded and remote upload remains disabled.
- [ ] Secret, dependency, license, SBOM, and artifact reports are reviewed.
- [ ] The installed Windows recorded pipeline passes.
- [ ] `PKG-011` is `DONE`, or an authorized `ACCEPTED_LIMITATION` narrows the
      release platform matrix; a plain `BLOCKED` status cannot pass this gate.
- [ ] Signed-update work remains a reviewed runbook, not an enabled side effect.
- [ ] An independent security/package checker accepts the evidence.

## Rollback

Electron continues to support the explicit `python-oracle` selector until Phase
09. Packaging changes can revert to the last verified application artifact;
user data remains compatible and backed up.

## Observations

To be filled during execution.
