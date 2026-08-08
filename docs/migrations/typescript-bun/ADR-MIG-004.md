# ADR-MIG-004: Lock The Bun/Electron Platform Matrix

> Status: Accepted for the Phase 08 packaging baseline by the PKG-002
> independent Checker
>
> Date: 2026-08-07
>
> Owner: Phase 08 packaging and security
>
> Current release limitation: Windows x64 only, explicitly authorized by the
> human instruction `Windows-only 限制授权` on 2026-08-08

## Decision

The current release target is **Windows x64 with the Bun baseline executable**
(`bun-windows-x64-baseline`) supervised by Electron 43.2.0 and packaged as an
NSIS installer. The baseline target is the compatibility artifact; the modern
`bun-windows-x64` target remains a comparison/performance artifact and is not a
separate release claim. PKG-004 must make the target explicit instead of
relying on the host-native `--target=bun` used by the PKG-001 compile smoke.

Windows arm64 and both macOS targets are explicitly outside the current release
scope. They remain documented Bun-supported target shapes, but no installed
proof, signing identity, or hardware runner exists in this worktree. PKG-011
records an authorized `ACCEPTED_LIMITATION` for this Windows-only release.
Before any of those targets can be promoted to release scope, the future macOS
release owner must replace the limitation with independently accepted installed
platform evidence before a release candidate, download, signing, notarization,
support statement, or public availability.

## Matrix

| Platform / artifact | Development | CI build | Installed proof | Release requirement | Bun target | Minimum OS | Electron target | Native dependency risk | Signing / runner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Windows x64 baseline | Required | Required on Windows x64 | Required in PKG-010 | **Required** | `bun-windows-x64-baseline` | Windows 10 or later | Electron 43.2.0, NSIS `win` | Backend uses Bun-provided `bun:sqlite`/`bun:ffi`; desktop has `@echogarden/fvad-wasm`; no backend `.node` addon is accepted | Authenticode is **not configured**; local Windows x64 runner is available and was exercised by FND-004 |
| Windows x64 modern | Comparison only | Comparison when runner budget permits | Not a release claim | Not required | `bun-windows-x64` | Windows 10 or later | Electron 43.2.0, NSIS `win` | Same as baseline; AVX2/modern CPU risk is the reason baseline remains release | Same Windows signing gap; same local x64 runner |
| Windows arm64 | No | Decision / unavailable | No | **Not released** | `bun-windows-arm64` | Windows 10 or later | Electron 43.2.0, NSIS `win` | Bun target exists; desktop native/WASM and installer architecture still require a real ARM runner | No ARM signing or hardware runner is available |
| macOS arm64 | Desired / no local runner | Decision / unavailable | No | **Not released** | `bun-darwin-arm64` | macOS 13 Ventura or later | Electron 43.2.0, DMG `mac` | Bun-provided SQLite/FFI plus desktop WASM must be verified on Apple Silicon | Developer ID/notarization is not configured; no macOS runner |
| macOS x64 | Decision / no local runner | Decision / unavailable | No | **Not released** | `bun-darwin-x64` | macOS 13 Ventura or later | Electron 43.2.0, DMG `mac` | Same macOS native/WASM verification gap; no release claim | Developer ID/notarization is not configured; no macOS runner |

## Evidence And Constraints

- FND-004 independent evidence is the accepted Windows x64 baseline. It
  verified both `bun-windows-x64` and `bun-windows-x64-baseline` with Bun
  `1.3.14` revision `0d9b296af`, PE machine `0x8664`, authenticated health,
  hostile-cwd isolation, parent scrubbing, shutdown, and no orphan process:
  `.omx/artifacts/typescript-bun/FND-004/fnd-004-checker-20260730-002/`.
- The current host is Windows 11 x64; this is evidence for the Windows x64
  runner only, not proof for Windows arm64 or macOS.
- The current GitHub workflow uses `ubuntu-latest` for source/type/test gates;
  it is not installed Windows or macOS package proof. A target-specific CI
  build must run on the named target runner before release evidence is accepted.
- Bun's supported compile-target list and baseline/modern CPU distinction are
  recorded from the pinned Bun documentation and must be rechecked if Bun is
  upgraded: <https://bun.sh/docs/bundler/executables>.
- Electron's platform floor is Windows 10+ for Electron v23+; Electron 43
  retains the macOS 12 floor, while the pinned Bun release baseline is macOS
  13+, so the intersection recorded above is macOS 13+:
  <https://www.electronjs.org/docs/latest/breaking-changes>.

Cross-compilation can create a candidate binary but cannot satisfy installed
execution, signing, native dependency, or lifecycle proof. No target is
promoted merely because Bun accepts its target string.
