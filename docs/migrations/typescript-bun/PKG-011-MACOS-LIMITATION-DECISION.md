# PKG-011 macOS Validation Decision

> Status: `ACCEPTED_LIMITATION`
>
> Authorized: 2026-08-08 by the human instruction
> `Windows-only 限制授权`
>
> Current release scope: Windows x64 only

## Current Result

This run is executed on the Windows 11 x64 worktree. The checker keeps macOS
cross-build attempts as separate evidence, but does not treat them as installed
proof. Bun `bun-darwin-arm64` and `bun-darwin-x64` compile attempts are recorded
with their exact exit codes and output; the Electron macOS arm64 package attempt
is also recorded. The current host has no macOS runner, Xcode command-line
tools, or `codesign`, so the installed lifecycle path cannot be exercised here.

The platform proof remains unavailable, but the authorized current release
scope is now explicitly Windows x64 only. `PKG-011` records
`ACCEPTED_LIMITATION`, not `DONE`: no macOS arm64 or macOS x64 installed,
native dependency, microphone/system-audio, signing, notarization, download,
or support claim is made.

## Human Authorization And Revisit Contract

- Authorization: the user selected and then explicitly confirmed
  `Windows-only 限制授权` on 2026-08-08.
- Narrowed claim: the current ADVX Live release supports Windows x64 only.
- Unsupported current targets: Windows arm64, macOS arm64, and macOS x64.
- Revisit owner: the future macOS release owner assigned before a macOS
  release candidate is created.
- Revisit trigger and expiry: this limitation must be replaced by accepted
  installed-platform evidence before any macOS release candidate, download,
  signing, notarization, support statement, or public availability.
- Downstream behavior: release-facing documentation must identify macOS as a
  future architecture target, not as a currently supported or MVP release
  platform. Dormant package configuration may remain for future validation but
  must not be invoked by the current release command.

## Missing Authority And Resource

- macOS 13+ arm64 hardware or a target-specific macOS runner;
- Xcode command-line tools and `codesign` on that runner; and
- Developer ID/notarization authority for any signed-release claim.

The accepted platform matrix in `ADR-MIG-004.md` documents these targets as
outside the current release scope. The explicit 2026-08-08 human authorization,
revisit owner, and trigger above now satisfy the limitation authority that the
matrix alone did not provide.

## Next Validation Runbook

Before a future macOS release, use a macOS 13+ arm64 runner and run
`pnpm install --frozen-lockfile`, `pnpm run typecheck:pkg-011`, and
`bun scripts/check-pkg-011.ts --mode platform --artifact-root
.omx/artifacts/typescript-bun/PKG-011/macos-platform`. Then run
`pnpm exec electron-builder --mac --arm64 --dir --projectDir apps/desktop
--config electron-builder.yml
--config.directories.output=.omx/artifacts/typescript-bun/PKG-011/macos-arm64`.
Then execute the equivalent packaged CDP/session/recorded-input/overlay/
diagnostics/stop/restart/uninstall flow and retain process-tree evidence. Keep
codesign/notarization evidence separate and do not widen the release matrix
until installed proof is independently accepted.

## Preservation

Python remains the parity oracle. This decision does not delete, replace, sign,
publish, deploy, or otherwise change the Windows release artifact.
