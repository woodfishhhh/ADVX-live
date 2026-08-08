# PKG-012 Signed Update And Rollback Runbook

> Status: `PLANNING ONLY - AUTO-UPDATE DISABLED`
>
> Current release scope: Windows x64 only

This runbook designs a future signed-update path without enabling it. The
repository currently has no updater dependency, update feed, publishing target,
signing credential, or release-authorized CI job. Nothing in `PKG-012` signs,
notarizes, publishes, deploys, or turns on auto-update.

## Current Release Boundary

`PKG-011` is an authorized `ACCEPTED_LIMITATION`. The current package command
builds Windows x64 only. Windows arm64, macOS arm64, and macOS x64 are outside
the current release and support scope.

The dormant macOS builder target is retained only for future validation. This
runbook must not be used to claim, sign, notarize, upload, publish, or advertise
a macOS artifact. Before any such action, the future macOS release owner must
replace the limitation with independently accepted installed-platform,
codesign, and notarization evidence.

## Signing And Notarization Identities

The current Windows release identity is not configured. Before activation, a
release owner must nominate the legal publisher and obtain an Authenticode
certificate whose subject exactly matches that publisher. The certificate
thumbprint, issuer, validity window, and timestamp authority become release
evidence; the private key never becomes repository content.

Only the Windows signing identity is in scope. Apple Developer ID and
notarization identities are explicitly absent and unauthorized under the
current `PKG-011` limitation.

## Secret Custody

The Authenticode private key must live in an external HSM or managed signing
service. CI receives short-lived, job-scoped signing authority through a
protected release environment after two-person human approval. Credentials
must never appear in Git, `.env` files, command-line arguments, logs, crash
artifacts, caches, unsigned build artifacts, or update metadata.

The signing custodian owns enrollment, rotation, revocation, and access review.
Every use must produce an audit event tied to the source commit, workflow run,
artifact hash, approvers, and certificate thumbprint. A certificate export or
long-lived base64/PFX secret in CI is not an acceptable activation design.

## CI Authority

The existing `.github/workflows/bun-ci.yml` is validation-only: it has
`contents: read`, runs no release job, and has no signing or publishing
authority. It must remain unable to promote artifacts.

A future release workflow must be separate, pinned to a protected environment,
and callable only for an immutable version tag that resolves to the reviewed
source commit. Build and test jobs remain unprivileged. A later signing job may
consume only the exact hash-approved candidate, and a distinct promotion job
requires release-owner approval. Pull requests and arbitrary branches must
never receive signing or publishing authority.

## Artifact Promotion

Promotion is a one-way chain:

1. Freeze dependencies and record source HEAD, dirty-tree state, tool versions,
   target OS/architecture, and the backend compile manifest.
2. Build the compiled Bun backend and Windows x64 NSIS package in an
   unprivileged job.
3. Bind the installer, unpacked Electron executable, compiled backend,
   security reports, SBOM, and test run IDs by SHA-256 and byte length.
4. Independently approve the candidate hashes and evidence.
5. Sign that exact installer/application payload through the managed signer,
   verify Authenticode trust and timestamping, and record the signed hashes.
6. Place the signed candidate in immutable staging storage.
7. Generate update metadata from the staged signed bytes, review it, then
   promote the metadata pointer after a separate human approval.

Candidates and metadata are versioned and immutable. Never overwrite an
existing version or regenerate metadata for different bytes under the same
version. The Electron application and its bundled Bun backend are one atomic
release unit; backend-only promotion is forbidden.

## Update Metadata And Channel Policy

`stable` and `beta` are separate, least-privilege channels. A version may move
from beta to stable only by promoting the same signed bytes, never by rebuilding
them. Versions are monotonic SemVer within a channel. Routine updater-driven
downgrade is forbidden.

Future metadata must bind at least: application version, channel, target
platform and architecture, source commit, Electron version, backend version,
backend build ID, HTTP protocol version, realtime protocol version, schema
package version, database migration range, artifact SHA-256, byte length,
publisher certificate thumbprint, signature/timestamp status, publication time,
and minimum compatible installed version. Metadata and artifact delivery must
use authenticated TLS and immutable versioned locations.

There is currently no feed URL and no metadata format wired into the product.
Choosing an updater library, metadata schema, and hosting authority is a later
reviewed implementation task, not an implied decision in this runbook.

## Backend/Desktop Compatibility

The desktop and compiled Bun backend ship together and are accepted together.
Before promotion, installed E2E must prove the authenticated `/version`
handshake and record `backend_version`, `build_id`, HTTP protocol version,
realtime protocol version, and schema package version from the packaged child.
The current contracts are HTTP v3, realtime v4 with negotiated v3/v4 support,
and schema package v1.

The release manifest must declare those values and the database migration
range. Startup fails closed when the packaged backend identity or protocol
range does not match the desktop manifest. No updater may replace only the
backend executable, and no desktop may connect to an arbitrary release payload.

## Staged Rollout

Promotion proceeds through internal, canary, limited-percentage, and stable
stages. Each stage uses the same signed bytes and immutable metadata. Advancing
a stage requires a documented soak interval and review of install success,
authenticated version handshake, session start/stop, crash/restart behavior,
diagnostics boundaries, database health, and orphan-process evidence.

Any unexplained regression pauses promotion. There is no automatic percentage
increase, cross-channel promotion, or bypass of the human approval gate.

## Rollback And Database Compatibility

Rollback starts by stopping distribution, not by forcing a client downgrade.
Freeze the affected channel metadata, preserve incident evidence, and pin the
last known-good signed candidate. Re-promote an older binary only when its
declared protocol and database ranges accept the installed state.

Before the first launch of a release that can migrate persistent data, create a
verified copy-based backup outside the installation root and record its hash,
source application version, source schema, target migration version, and
quick-check result. The current migration boundary uses SQLite Online Backup
API evidence followed by stopped-backend copy-and-swap and a verified restore
rehearsal. It does not permit destructive Bun migrations while a Bun-owned
online-backup path is unavailable.

Never run an older binary against a newer, incompatible database. If forward
migration is not backward-readable, stop both backends, preserve the failed
data directory, restore the verified pre-update backup into a new path, verify
its hash/schema/representative tables, and only then launch the known-good
binary. User data remains outside the install root and uninstall must not be
treated as data rollback.

After Python deletion, rollback uses the `TS_backend_refactor` branch history
and the `CUT-003` restore-from-backup procedure. No in-place runtime selector
remains, and neither path substitutes for a signed known-good Windows artifact.

| Condition | Required action | Binary rollback allowed? |
| --- | --- | --- |
| Artifact/signature/metadata mismatch before launch | Quarantine candidate and keep last-good metadata | No installation occurred |
| Runtime regression with unchanged compatible schema | Stop rollout, verify cleanup, re-promote last-good signed bytes | Yes, after compatibility check |
| Forward-only database migration completed | Stop rollout and restore verified pre-update backup before downgrade | Not against the newer database |
| Suspected signing-key compromise | Stop all promotion, revoke authority, preserve audit evidence | Only to a separately trusted signed candidate |

The Phase 09 representative backup/rollback rehearsal remains the final
cutover proof. This planning task neither performs nor weakens that gate.

## Incident Stop Switch

The release owner is the incident commander until explicitly handed over. The
stop switch is server-side removal or freezing of the affected channel metadata
pointer, followed by revocation of candidate promotion authority. It must not
delete installed user data, remotely execute arbitrary commands, or silently
replace metadata bytes.

Incident steps are: stop promotion, snapshot metadata and audit logs, identify
affected hashes/versions, pin the last-good candidate, decide database-safe
recovery, notify users through the approved product channel, and require a new
independent review before resuming. A signing-key incident additionally revokes
or disables the credential and blocks all channels until a trusted identity is
established.

## Evidence Required Before Publish

No publish is authorized until every item is current-head, target-specific,
hash-bound, and independently accepted:

- protected release environment, named release owner, signing custodian, and
  two-person approval evidence;
- immutable source/tag identity, frozen install result, tool versions, backend
  compile manifest, and Windows x64 target identity;
- PKG-009 secret scan, dependency audit, license review, lifecycle review, SBOM,
  and unsigned artifact manifest;
- PKG-010 installed Windows pipeline, installer/application/backend hashes,
  authenticated version handshake, diagnostics, restart, uninstall, and
  no-orphan evidence;
- exact signed hashes plus Authenticode chain, publisher subject, certificate
  thumbprint, trusted timestamp, and verification command output;
- reviewed compatibility manifest covering app/backend/protocol/schema/database
  ranges and proof that mismatches fail closed;
- verified pre-update database backup and restore rehearsal for any release that
  changes migrations;
- staged rollout/soak decision, stop-switch rehearsal, rollback decision, and
  last-known-good signed candidate identity;
- reviewed channel metadata bound to the signed bytes, followed by explicit
  human publish authorization.

An accepted Windows-only limitation is evidence of narrowed scope, not macOS
proof. It cannot authorize a macOS artifact or claim.

## Non-Actions

`PKG-012` adds only this reviewed design and its inert static checker. It does
not add an updater library, configure a feed, grant CI write authority, create
or import signing credentials, sign, notarize, publish, deploy, alter the
package target, migrate a user database, delete the Python parity oracle, or
change runtime process behavior.
