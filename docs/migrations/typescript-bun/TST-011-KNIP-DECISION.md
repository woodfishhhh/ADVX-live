# TST-011 Knip Decision

## Scope

`TST-011` adds a reviewed Knip 6.32.0 baseline for TypeScript and Bun code. It
does not claim a clean repository or change the accepted Python parity oracle.
The exact dev-only tool is locked in both package managers and runs through
`knip-bun`.

## Entry Configuration

`knip.json` declares the workspace entry points instead of excluding source
trees:

| Boundary            | Explicit entries                                                                                | Owner and reason                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Root                | Vitest config, scripts, root tests                                                              | Repository tooling and test runners                                          |
| Bun backend         | process, headless, diagnostics, profiling, OpenAPI, scripts                                     | Bun launch and operational CLIs                                              |
| Bun dynamic modules | heap preload and SQLite crash fixture                                                           | `OBS-012` profile spawn and `DAT-011` test child spawn use constructed paths |
| Electron            | Vite config, Main, preload, renderer mains, scripts                                             | Electron-Vite multi-entry build and desktop lifecycle                        |
| Contracts           | package exports, generated index, compile-time type test, parity and binary portability runners | public contract/API and retained parity checks                               |

Generated contracts and Electron declaration files have the only issue
allowlists. They remain in the project graph; the allowlists suppress only
generated/declaration export and type noise. `taskkill.exe` is a Windows child
cleanup primitive owned by desktop lifecycle, and `uv` remains the intentional
Python parity-oracle command. Both are exact binary allowlist entries.

The capture preload and renderer remain explicit Electron-Vite build entries.
They are not ignored: the desktop capture owner must either connect or remove
that standalone surface in a dedicated desktop task.

## First Baseline Classification

The Maker report records 69 affected file records and 179 individual findings.
It is a review queue, not a success-only report.

| Finding class                                                               | Decision                                                                                                                                                                   |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dynamic Bun files                                                           | Fixed by explicit entries; no directory ignore                                                                                                                             |
| Contract compile-time/parity runners                                        | Fixed by explicit entries and a runnable `test:binary-portability` command                                                                                                 |
| `apps/desktop/src/shared/demo.ts`                                           | Deleted: no import, package entry, test, or build reference exists                                                                                                         |
| `apps/desktop/src/main/windows/capture.ts`                                  | Retained and visible: its isolated window factory has no current caller; the desktop capture owner must connect or remove it in a dedicated task                           |
| Generated/declaration export/type noise                                     | Narrow allowlist, owned by contract generation and Electron type declaration boundaries                                                                                    |
| `taskkill.exe` and `uv` binaries                                            | Narrow allowlist; Windows process cleanup and retained Python oracle                                                                                                       |
| `tailwindcss`                                                               | Retained and visible: it is consumed by the renderer CSS `@import`, which Knip does not resolve as a TypeScript import                                                     |
| `electron-builder`                                                          | Retained and visible: a deferred packaging dependency owned by `PKG-004`/`PKG-009`; this task does not alter package-release scope                                         |
| OpenTelemetry dependencies                                                  | Retained and visible for `OBS-011`/`OBS-012` ownership review; static source imports are absent, but this tooling task does not rewrite an accepted observability boundary |
| Remaining exports, types, duplicate schema aliases, files, and dependencies | Retained as visible report findings for their product owners; no blanket ignore or unrelated cleanup                                                                       |

The duplicate schema aliases remain visible because their names carry distinct
contract semantics even where their current shapes match. They must not be
silently merged by a dead-code configuration task.

## Verification And Rollback

`pnpm test:tst-011` runs the Bun-hosted JSON baseline, the focused config and
decision-record format check, and strict TypeScript. `pnpm knip` remains a
failing audit command until its visible findings are deliberately addressed.

Rollback is limited to removing `knip.json`, the two root Knip scripts, the
exact Knip dependency and lockfile entries, the TST-011 decision record, and
the deletion of the isolated demo fixture. No application dependency or Python
oracle is removed by this task.
