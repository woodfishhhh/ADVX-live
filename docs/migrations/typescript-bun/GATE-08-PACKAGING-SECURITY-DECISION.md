# GATE-08 Packaging And Security Exit Decision

> Candidate status: `VERIFY`
>
> Current release scope: Windows x64 only

## Scope

This gate reviews the accepted `PKG-001` through `PKG-012` evidence against
the Phase 08 exit checklist. It does not rerun the compiled-package, installed
pipeline, crash, lifecycle, SBOM, or platform matrices. Those task-level proofs
remain authoritative unless their reviewed source boundary changes.

The gate performs one bounded machine-readable audit over the master table,
accepted evidence index, exact Checker artifacts, the external-condition row,
and the current files already hash-bound by `PKG-011` and `PKG-012`.

## Accepted Evidence Inventory

| Task | Terminal status | Accepted Checker artifact | Gate use |
| --- | --- | --- | --- |
| `PKG-001` | `DONE` | `pkg-001-checker-root-20260807-093/result.json` | Deterministic compile manifest and hostile-cwd/autoload proof |
| `PKG-002` | `DONE` | `pkg-002-checker-root-20260807-095/result.json` | Windows x64 baseline and platform matrix |
| `PKG-003` | `DONE` | `pkg-003-checker-root-20260807-097/result.json` | Embedded/read-only runtime assets |
| `PKG-004` | `DONE` | `pkg-004-checker-root-20260807-099/result.json` | electron-builder `extraResources` package handoff |
| `PKG-005` | `DONE` | `pkg-005-checker-root-20260807-101/result.json` | Installed user-data/database/log/diagnostics paths |
| `PKG-006` | `DONE` | `pkg-006-checker-root-20260807-103/result.json` | Start, stop, restart, forced exit, port release, and orphan audit |
| `PKG-007` | `DONE` | `pkg-007-checker-root-20260807-106/result.json` | Electron fuses and ASAR/resource integrity |
| `PKG-008` | `DONE` | `pkg-008-checker-root-20260807-108/result.json` | Bounded local crash evidence with upload disabled |
| `PKG-009` | `DONE` | `pkg-009-checker-root-20260807-110/result.json` | Secret, dependency, license, SBOM, lifecycle, and artifact reports |
| `PKG-010` | `DONE` | `pkg-010-checker-root-20260807-112/result.json` | Installed Windows recorded pipeline and no-orphan uninstall |
| `PKG-011` | `ACCEPTED_LIMITATION` | `pkg-011-limitation-checker-root-20260808-116/result.json` | Authorized Windows-only release boundary |
| `PKG-012` | `DONE` | `pkg-012-checker-root-20260808-118/result.json` | Inert signed-update and database-safe rollback runbook |

Each indexed task has an accepted evidence section naming a distinct Checker
that did not participate in implementation. The gate checker also hashes the
12 result files and revalidates current file identities recorded by the
accepted `PKG-011` and `PKG-012` results. The expected `package.json` hash
change caused by registering this Gate's two check commands is reviewed
semantically instead: the Windows x64 package command, absent updater
dependency, and absent macOS/publish flags must remain identical to the
accepted boundary.

## Exit Criteria

| Criterion | Phase 08 claim | Accepted source |
| --- | --- | --- |
| `compile-manifest` | Backend compile command and manifest are reproducible and diagnosable | `PKG-001` |
| `autoload-isolation` | Compiled Bun ignores ambient dotenv, bunfig, package, tsconfig, cwd, and `BUN_BE_BUN` inputs | `PKG-001` |
| `platform-matrix` | `ADR-MIG-004` and the accepted limitation lock the current platform claim | `PKG-002`, `PKG-011` |
| `packaged-assets` | Required assets resolve from packaged read-only resources | `PKG-003`, `PKG-004` |
| `installed-data` | Installed writes stay under documented user-data paths | `PKG-005` |
| `lifecycle-orphans` | Start, crash/restart, quit/relaunch, uninstall, and cleanup leave no backend orphan | `PKG-006`, `PKG-010` |
| `fuses-integrity` | Electron fuses and loaded ASAR/resource integrity pass | `PKG-007` |
| `crash-boundary` | Local crash evidence is bounded and remote upload remains disabled | `PKG-008` |
| `security-reports` | Secret, dependency, license, SBOM, lifecycle, and artifact reports are reviewed | `PKG-009` |
| `installed-pipeline` | The installed Windows x64 recorded pipeline passes | `PKG-010` |
| `external-platform-condition` | The only external platform condition has an allowed terminal status and narrowed claim | `PKG-011` |
| `signed-update-inert` | Signed-update work remains a reviewed runbook without an enabled updater or release side effect | `PKG-012` |
| `independent-review` | Every Phase 08 task has admissible independent Checker evidence | `PKG-001..012` |

The Maker audit must pass all 13 criteria before moving `GATE-08` to `VERIFY`.
Only a distinct Gate Checker may accept `DONE` and promote `CUT-001`.

## External Condition Decision

The master plan permits `GATE-08` to accept `PKG-011` as either `DONE` or
`ACCEPTED_LIMITATION`. The current result is an explicit human-authorized
`ACCEPTED_LIMITATION`: Windows x64 is the only current release and support
scope; Windows arm64, macOS arm64, and macOS x64 are not released or claimed.

This status satisfies only the named platform condition. It does not waive
package correctness, security, data compatibility, lifecycle cleanup, signing,
notarization, or future macOS installed proof.

## Security And Release Boundary

The current product has no updater dependency, feed, publish configuration,
signing credential, notarization identity, or release-authorized CI job. The
accepted `PKG-012` result hash-binds those inert files and the Gate audit rejects
identity drift. Automatic updates, signing, publishing, and deployment remain
disabled and require separate human authorization.

The packaged Windows artifact contains the compiled Bun backend rather than a
Python interpreter or Python package. The source-tree Python implementation and
explicit local `python-oracle` selector remain intact for Phase 09 rollback and
parity work; Gate 08 does not authorize their removal.

## Review Result

The bounded Maker audit is expected to emit 13 passing criteria, zero failed
artifact statuses, zero accepted-boundary identity mismatches, and the exact
Windows-only external condition. This document is a review candidate, not its
own acceptance evidence. The distinct Checker result and `EVIDENCE.md` record
decide the final gate status.

## Limitations

- Current release proof is Windows x64 only.
- The current artifact is unsigned and automatic updates remain disabled.
- macOS installed lifecycle, native media, signing, and notarization are not
  claimed.
- Python remains the local parity oracle until the Phase 09 cutover tasks
  explicitly retire it.
