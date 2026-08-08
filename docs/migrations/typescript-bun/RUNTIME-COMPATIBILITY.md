# Runtime Compatibility And Version Policy

> Task: `FND-003`
>
> Effective date: 2026-07-30
>
> Baseline: `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`
>
> Machine-readable semantic mirror:
> [compatibility-matrix.json](../../../.omx/artifacts/typescript-bun/FND-003/fnd-003-maker-20260730-001/compatibility-matrix.json)

## Decision

ADVX locks Bun `1.3.14`, host Node.js `24.18.0`, and Electron `43.2.0` as the
initial runtime pins. During the backend migration, the resolved desktop build
stack is frozen at electron-vite `4.0.1`, Vite `7.3.6`, TypeScript `5.9.3`,
`@types/node` `24.13.3`, and electron-builder `26.15.3`.

These are exact policy pins. The current range specifiers remain recorded as
baseline facts, but their lower bounds are not target versions and must not
silently replace the resolved pins.

`FND-010` now applies these accepted pins in an additive coexistence workspace.
The root `packageManager` remains `pnpm@11.9.0`; `CUT-005` owns the later
single-manager switch. The active Python backend and default runtime remain
unchanged while Bun `1.3.14` owns the new `apps/backend-bun` workspace and
frozen-install proof.

## Runtime Ownership

| ID | Surface | Owner | Initial version | Final contract |
| --- | --- | --- | --- | --- |
| `OWN-BUN` | Backend runtime | Bun | `1.3.14` | Bun runs the TypeScript backend. The packaged app carries a compiled backend executable and does not require a separately installed Bun. |
| `OWN-WORKSPACE` | Final workspace package manager and active script surface | Bun | `1.3.14` | Bun owns install, workspaces, and active root scripts after assigned cutover tasks. Final active scripts require no system Python. |
| `OWN-HOST-NODE` | Electron, electron-vite, Vite, TypeScript, and packaging tooling host | Host Node.js | `24.18.0` | A host Node installation remains required wherever the selected Electron toolchain invokes Node. Node is not claimed removed. |
| `OWN-ELECTRON-MAIN` | Electron Main | Electron embedded Node.js | `24.18.0` | Main uses Electron's embedded Node runtime, not the host Node executable. |
| `OWN-ELECTRON-PRELOAD` | Electron preload | Electron embedded Node.js with context isolation | `24.18.0` | Preloads keep privileged APIs in the isolated context and expose only narrow `contextBridge` APIs. |
| `OWN-RENDERER` | Electron renderer | Chromium web runtime | `150.0.7871.129` | Renderer code remains isolated from direct Node and Bun access. |

Electron's process model documents that Main runs in a Node environment,
preloads have privileged Node access, and ordinary renderer code has no direct
Node API access. Context isolation separates the preload world from the loaded
site. [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model),
[Electron context isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation)

The Electron `43.2.0` release bundles Node `24.18.0`, Chromium
`150.0.7871.129`, and V8 `15.0.1240245`. The local Windows x64 probe resolved
Electron `43.2.0`, Node `24.18.0`, Chromium `150.0.7871.129`, and the Electron
runtime string `15.0.1240245-electron.0`.
[Electron 43.2.0 release](https://releases.electronjs.org/release/v43.2.0)

The equal initial host and embedded Node numbers are intentional but
coincidental ownership facts. Never infer the host Node version from
`process.versions.node` inside Electron, or infer Electron's embedded Node from
`node --version`.

## Exact Initial Pins

### Runtime

| Component | Exact pin | Current local evidence | Policy |
| --- | --- | --- | --- |
| Bun | `1.3.14` | `bun --version` returned `1.3.14` | Backend runtime and final package-manager/script owner |
| Host Node.js | `24.18.0` | `node --version` returned `22.23.1` | Downstream execution precondition; current host is a policy mismatch |
| Electron | `43.2.0` | Installed manifest and probe returned `43.2.0` | Desktop runtime |
| Electron embedded Node.js | `24.18.0` | Probe returned `24.18.0` | Main/preload runtime |
| Electron embedded Chromium | `150.0.7871.129` | Probe returned `150.0.7871.129` | Renderer runtime |
| Electron embedded V8 | release `15.0.1240245` | Probe returned `15.0.1240245-electron.0` | Electron-bundled engine |

Bun `1.3.14` is an upstream tagged release. Node `24.18.0` is an official
Krypton LTS release dated 2026-06-23, and the Node schedule keeps the v24 line
in its LTS lifecycle through 2028-04-30.
[Bun 1.3.14](https://github.com/oven-sh/bun/releases/tag/bun-v1.3.14),
[Node 24.18.0](https://nodejs.org/en/blog/release/v24.18.0),
[Node release schedule](https://github.com/nodejs/Release/blob/main/schedule.json)

### Frozen Desktop Build Stack

| Component | Resolved pin | Current manifest constraint | Host Node engine |
| --- | --- | --- | --- |
| Electron | `43.2.0` | `^43.2.0` | `>=22.12.0` |
| electron-vite | `4.0.1` | `^4.0.0` | `^20.19.0 || >=22.12.0` |
| Vite | `7.3.6` | `^7.0.0` | `^20.19.0 || >=22.12.0` |
| TypeScript | `5.9.3` | `^5.8.0` | `>=14.17` |
| `@types/node` | `24.13.3` | `^24.0.0` | not declared |
| electron-builder | `26.15.3` | `^26.0.0` | `>=14.0.0` |

Vite's official guide requires Node `20.19+` or `22.12+`. Exact upstream
package metadata for electron-vite `4.0.1` declares the equivalent
`^20.19.0 || >=22.12.0` range, and Electron `43.2.0` declares
`>=22.12.0`. [Vite compatibility note](https://vite.dev/guide/),
[electron-vite 4.0.1 metadata](https://registry.npmjs.org/electron-vite/4.0.1),
[Electron 43.2.0 metadata](https://registry.npmjs.org/electron/43.2.0)

The current host Node `22.23.1` satisfies those three package engines but fails
the repository's Node `24+` policy. It is therefore a baseline mismatch, not
evidence for the target `24.18.0` pin. Any downstream task that executes the
target toolchain must first provide `node --version` evidence for `24.18.0`.

## Upgrade Rules

1. Use exact versions for Bun, host Node, Electron, electron-vite, Vite,
   TypeScript, `@types/node`, and electron-builder when their assigned manifest
   and lockfile tasks apply the policy.
2. Do not couple Bun, Node, Electron, Vite, electron-vite, TypeScript, or
   electron-builder upgrades to backend migration slices.
3. Make every upgrade an explicit, isolated, reviewed change. A pair may share
   one change only when an upstream compatibility constraint requires it and
   the reason is recorded.
4. Regenerate the active lockfile exactly once with the approved pinned package
   manager; never hand edit it.
5. Run a clean frozen install, static lifecycle review, targeted typecheck,
   desktop build, embedded-version probe, focused launch/shutdown smoke, and
   native-module ABI/rebuild check when native modules exist.
6. Read upstream engines, release notes, breaking changes, native-module
   guidance, and security advisories before accepting an upgrade.
7. Track host Node and Electron embedded Node independently even when their
   version strings match.

Electron warns that native Node modules use a different ABI and must be rebuilt
for the selected Electron release. Electron upgrades therefore require an
explicit native-module check rather than a build-only claim.
[Electron native modules](https://www.electronjs.org/docs/latest/tutorial/using-native-node-modules),
[Electron breaking changes](https://www.electronjs.org/docs/latest/breaking-changes)

`FND-003` does not claim a clean advisory scan. `FND-009` owns final dependency
approval, advisory review, update grouping, and exit strategy.

## Platform And CPU Claim Boundaries

| OS | Architecture | Status | Allowed claim |
| --- | --- | --- | --- |
| Windows | x64 | Required current evidence baseline | Current `FND-003` evidence is local Windows x64 only. `FND-004` must test the selected compiled target and CPU baseline. |
| macOS | arm64 | Accepted limitation for current release | Not released or supported; requires future build, package, install, launch, shutdown, native-media, signing, and notarization evidence before any support claim. |
| Windows | arm64 | Decision-gated | No ADVX support claim until `PKG-002` and `ADR-MIG-004` decide scope and platform proof passes. |
| macOS | x64 | Accepted limitation for current release | Not released or supported; no ADVX support claim until the future platform matrix explicitly restores it and installed proof passes. |
| Linux | any | Outside current product OS families | No ADVX product support claim. |

The architecture retains Windows and macOS platform boundaries, but the current
release and support scope is Windows x64 only under the authorized PKG-011
limitation. A downloadable upstream artifact or cross-compilation target proves
only upstream availability, not ADVX build, package, install, lifecycle, native
dependency, signing, or product support.

Upstream artifact availability is never substituted for ADVX platform proof.

Bun documents standard x64 binaries as requiring AVX and AVX2, while baseline
x64 builds target older SSE4.2-capable CPUs. Bun also exposes
`bun-windows-x64-baseline` as a compiled-executable target.
[Bun installation CPU requirements](https://bun.com/docs/installation),
[Bun standalone executable targets](https://bun.com/docs/bundler/executables)

For `FND-004`, record the exact target and test-machine CPU evidence. Test the
Windows x64 baseline target unless ADVX explicitly chooses and documents an
AVX2 minimum. A successful standard x64 launch cannot prove baseline
compatibility, and this policy does not invent evidence for either CPU class.

macOS arm64 remains the expected future macOS evidence path, but it is not
currently released or supported merely because Bun and Electron publish arm64
artifacts. Windows arm64 and macOS x64 remain outside the current release scope
under `PKG-002`, `PKG-011`, and `ADR-MIG-004`.

## Dependency Lifecycle Policy

The policy is default deny. The `FND-010` coexistence candidate sets root
`trustedDependencies` to an explicit empty array. Defining that field replaces
Bun's built-in default list rather than extending it. Empty means no dependency
lifecycle scripts; a non-empty list would mean only the named packages.
[Bun lifecycle policy](https://bun.com/docs/pm/lifecycle)

The exact local manifest review found:

| Package | Resolved instance | Lifecycle script | `FND-010` decision |
| --- | --- | --- | --- |
| esbuild | `0.25.12` | `postinstall: node install.js` | Not trusted. The script validates/downloads the platform binary, but Bun installs the platform-specific optional package and a clean Windows build passes with scripts denied. macOS remains unproven and cannot widen this list. |
| esbuild | `0.28.1` | `postinstall: node install.js` | Not trusted for the same reason; a clean Windows desktop build passes without it. |
| electron-winstaller | `5.4.0` | `install: node ./script/select-7z-arch.js` | Not trusted. It selects a bundled 7-Zip architecture for the deferred packaging tree, which is not required by the current workspace gate. |
| electron | `43.2.0` | none | No trust entry exists. Binary acquisition remains explicitly owned by the checked-in helper below. |

All reviewed packages use the MIT license. Clean Windows replay from an empty
dependency directory reports zero untrusted scripts and passes backend,
contracts, and desktop builds with the empty allowlist. That is evidence that
no dependency lifecycle script is necessary for this gate; it is not macOS or
packaging proof. Every later addition still requires exact source, script,
effect, license, necessity, Windows, and macOS review.

Electron binary installation remains explicitly owned by
`apps/desktop/scripts/ensure-electron.mjs`. That script checks `path.txt` and
the binary, then runs Electron's installer on demand. Electron `43.2.0` has no
dependency lifecycle script in its exact upstream or installed manifest, so
ADVX must not assume implicit Electron fetching through Bun lifecycle trust.
Electron documents the binary download and `@electron/get` behavior separately.
[Electron installation](https://www.electronjs.org/docs/latest/tutorial/installation),
[Electron 43.2.0 metadata](https://registry.npmjs.org/electron/43.2.0)

## Lockfile Policy

The `FND-010` coexistence candidate now contains both the existing
`pnpm-lock.yaml` and a Bun `1.3.14`-generated text `bun.lock`; `bun.lockb` does
not exist. The policy is:

1. `FND-010` created `bun.lock` exactly once under Bun `1.3.14` by converting
   the intentionally refreshed pnpm lock, then refreshed the text lock only
   through Bun after manifest changes.
2. Commit the text `bun.lock`; never create or commit `bun.lockb`.
3. Never hand edit `bun.lock`.
4. Use `bun install --frozen-lockfile` or the equivalent `bun ci` in frozen
   install paths.
5. During coexistence, a shared manifest change is incomplete unless the same
   isolated change intentionally refreshes and reviews both `pnpm-lock.yaml`
   and `bun.lock`, and both frozen-install checks pass. Never run one package
   manager against a dependency directory created by the other and present the
   mixed directory as clean evidence.
6. Root `packageManager` remains `pnpm@11.9.0` while the pnpm lock and active
   desktop scripts remain authoritative. Bun `1.3.14` is separately pinned by
   root `engines`, owns the additive workspace/install proof, and is the
   supported root script runner. `CUT-005` owns the later single-manager switch.
7. Keep `pnpm-lock.yaml` until `CUT-005` removes active pnpm script ownership
   after equivalent Bun commands pass.

Bun documents `bun.lock` as the current text lockfile, `bun.lockb` as the
pre-1.2 binary format, and `bun ci` as equivalent to
`bun install --frozen-lockfile`. It also documents automatic pnpm conversion
when `pnpm-lock.yaml` exists and `bun.lock` does not, which is why the first
creation belongs only to `FND-010`.
[Bun install and lockfile](https://bun.com/docs/pm/cli/install)

### Dependency Resolution Policy

By explicit product-owner decision, `FND-010` has no seven-day
minimum-release-age policy. pnpm v11 has a built-in one-day
`minimumReleaseAge` default, so `pnpm-workspace.yaml` explicitly sets
`minimumReleaseAge: 0` only as the sentinel that disables that default. Zero is
not a new policy threshold. Neither `minimumReleaseAgeExclude` nor
`minimumReleaseAgeExcludes` is allowed, and no exception list is part of the
coexistence workspace. Bun has no age-gate or exception configuration, so root
`bunfig.toml` remains absent.
[pnpm minimumReleaseAge setting](https://pnpm.io/settings#minimumreleaseage)

Supply-chain reproducibility instead relies on the exact versions accepted in
`FND-009`, intentional same-change refresh and review of both `bun.lock` and
`pnpm-lock.yaml`, and independent clean frozen installs for both managers.
Fresh lock-free resolution proves that the shared manifest set remains
resolvable; frozen replay proves the checked-in locks remain reproducible.

## TypeScript Migration Sequence

This order is locked to the existing master plan:

1. **Additive backend:** create `apps/backend-bun` without changing the default;
   retain `apps/backend` and Python as the parity oracle.
2. **Shared contracts:** migrate canonical HTTP, WebSocket, and binary schemas
   into the shared TypeScript contracts package and keep cross-runtime fixtures.
3. **Vertical backend slices:** port the verified backend shell/control/session
   slice, then persistence, then Provider and audience runtime behavior.
4. **Electron selector:** after adapters and lifecycle checks exist, add the
   temporary `python-oracle`, `bun-source`, and `bun-compiled` selector; Python
   remains the default.
5. **Bun default:** switch the default only at `CUT-001`, after parity and
   packaging gates, while retaining an explicit local Python rollback.
6. **Workspace and automation cutover:** move active root and CI commands to
   Bun and eliminate system-Python requirements only after equivalent checks
   pass. Host Node remains where Electron tooling requires it.
7. **Mechanical finalization:** after the human deletion gate, remove Python
   and migration shims, then mechanically rename `apps/backend-bun` to
   `apps/backend`. Do not mix the rename with semantic porting.

No step in this sequence permits early Python deletion or a broad renderer
rewrite.

## Vite And Electron-Vite Compatibility Sequence

1. Freeze Electron `43.2.0`, electron-vite `4.0.1`, Vite `7.3.6`, TypeScript
   `5.9.3`, `@types/node` `24.13.3`, and electron-builder `26.15.3` throughout
   backend migration.
2. Open separate upgrade work only for a named compatibility, security, or
   product need. Do not use manifest range floors as target versions.
3. Select and install the host Node exact pin first as an independent
   toolchain precondition; verify repository policy and every target engine.
4. Select an exact Vite/electron-vite pair from upstream metadata and release
   notes. Keep Electron and TypeScript unchanged unless their own isolated
   upgrade is approved.
5. Regenerate the active lockfile once, then run frozen install, lifecycle
   review, typecheck, desktop build, Electron launch/shutdown, and native-module
   checks.
6. Upgrade Electron separately, inspect breaking changes, probe embedded
   Node/Chromium/V8, and rebuild native modules. Never treat an embedded-Node
   change as a host-Node change.

## Accepted Versions And Licenses

| Component | Version | Status | License | Evidence strength |
| --- | --- | --- | --- | --- |
| Bun | `1.3.14` | Initial exact pin | MIT with bundled component notices | Official tagged release and license plus live command |
| Host Node.js | `24.18.0` | Initial exact pin and downstream precondition | MIT plus bundled dependency notices | Official release and LTS schedule |
| Electron | `43.2.0` | Initial exact pin | MIT | Official release, exact upstream metadata/license, and local probe |
| electron-vite | `4.0.1` | Frozen resolved build stack | MIT | Exact upstream metadata/license and installed manifest |
| Vite | `7.3.6` | Frozen resolved build stack | MIT | Official docs, exact upstream metadata/license, and installed manifest |
| TypeScript | `5.9.3` | Frozen resolved build stack | Apache-2.0 | Exact upstream metadata/tagged license and installed manifest |
| `@types/node` | `24.13.3` | Frozen resolved build stack | MIT | Exact upstream metadata and installed manifest |
| electron-builder | `26.15.3` | Frozen resolved build stack | MIT | Exact upstream metadata and installed manifest |
| esbuild | `0.25.12 and 0.28.1` | Lifecycle candidates, not yet allowed | MIT | Exact upstream metadata/tagged license and installed manifest scan |
| electron-winstaller | `5.4.0` | Lifecycle candidate, not yet allowed | MIT | Exact upstream metadata/tagged license and installed manifest scan |

Sources:

- [Bun license](https://raw.githubusercontent.com/oven-sh/bun/bun-v1.3.14/LICENSE.md)
- [Node 24.18.0 license and bundled notices](https://raw.githubusercontent.com/nodejs/node/v24.18.0/LICENSE)
- [Electron 43.2.0 license](https://raw.githubusercontent.com/electron/electron/v43.2.0/LICENSE)
- [electron-vite 4.0.1 license](https://raw.githubusercontent.com/alex8088/electron-vite/v4.0.1/LICENSE)
- [Vite 7.3.6 license](https://raw.githubusercontent.com/vitejs/vite/v7.3.6/LICENSE)
- [Vite 7.3.6 metadata](https://registry.npmjs.org/vite/7.3.6)
- [TypeScript 5.9.3 license](https://raw.githubusercontent.com/microsoft/TypeScript/v5.9.3/LICENSE.txt)
- [TypeScript 5.9.3 metadata](https://registry.npmjs.org/typescript/5.9.3)
- [`@types/node` 24.13.3 metadata](https://registry.npmjs.org/@types%2fnode/24.13.3)
- [DefinitelyTyped license](https://raw.githubusercontent.com/DefinitelyTyped/DefinitelyTyped/master/LICENSE)
- [electron-builder 26.15.3 metadata](https://registry.npmjs.org/electron-builder/26.15.3)
- [esbuild 0.25.12 metadata](https://registry.npmjs.org/esbuild/0.25.12)
- [esbuild 0.28.1 metadata](https://registry.npmjs.org/esbuild/0.28.1)
- [esbuild license](https://raw.githubusercontent.com/evanw/esbuild/v0.28.1/LICENSE.md)
- [electron-winstaller 5.4.0 metadata](https://registry.npmjs.org/electron-winstaller/5.4.0)
- [electron-winstaller 5.4.0 license](https://raw.githubusercontent.com/electron/windows-installer/v5.4.0/LICENSE)

MIT and Apache-2.0 are permissive inputs compatible with the repository's
current dependency posture, subject to preserving applicable license and
bundled-notice terms. This is an engineering compatibility statement, not a
substitute for `FND-009` license/SBOM review or legal approval.

## Evidence And Limitations

Maker evidence:

- [current-toolchain.json](../../../.omx/artifacts/typescript-bun/FND-003/fnd-003-maker-20260730-001/current-toolchain.json)
- [lifecycle-script-audit.json](../../../.omx/artifacts/typescript-bun/FND-003/fnd-003-maker-20260730-001/lifecycle-script-audit.json)
- [official-sources.json](../../../.omx/artifacts/typescript-bun/FND-003/fnd-003-maker-20260730-001/official-sources.json)
- `FND-010` workspace, dual-lock, lifecycle, resolution-policy,
  command-contract, and
  Python-preservation candidate evidence is under
  `.omx/artifacts/typescript-bun/FND-010/fnd-010-maker-20260730-004/`.

Limitations:

- `FND-010` proves local Windows x64 clean frozen installs and source builds,
  not packaging, installation, signing, macOS, or production support.
- The coexistence workspace does not switch the default backend, remove Python,
  or adopt deferred packaging or schema tooling.
- No credentialed Provider, deployment, commit, or push claim is made.
- Upstream artifact availability is never substituted for ADVX platform proof.
- The `FND-010` candidate remains `VERIFY` until a fresh independent Checker
  accepts it.
