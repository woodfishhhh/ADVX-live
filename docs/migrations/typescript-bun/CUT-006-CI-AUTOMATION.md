# CUT-006 CI And Automation Switch

## Active Inventory

The repository has one active GitHub Actions workflow:
`.github/workflows/bun-ci.yml`. There are no separate scheduled, release,
publish, or reusable-action workflows, and no executable project automation in
the repository-scoped `.codex` or `.omx` configuration files. The workflow and
the local helpers it reaches are the complete active CUT-006 automation scope.

Historical migration checkers and the Python parity suites are retained as
evidence/oracle paths. They are not normal CI, release, scheduled, or supported
local-development automation and are not rewritten by this task.

## Workflow Contract

Every job uses Bun `1.3.14` and
`bun install --frozen-lockfile --ignore-scripts`. Node `24.18.0` is installed
only for Electron, Playwright, Vitest Browser Mode, and electron-builder tools.
No job sets up, caches, or invokes Python, uv, pip, pnpm, or a Python action.

The workflow contains three bounded lanes:

| Lane | Platform | Responsibility |
| --- | --- | --- |
| Quality | Ubuntu | Contract drift, strict TypeScript, lint/format, replay/eval/evidence, build, audit, and CI contract |
| Test matrix | Ubuntu and Windows x64 | Bun unit/integration tests and the recorded Electron source/compiled lifecycle matrix |
| Package matrix | Windows x64 | Compiled Bun backend, unpacked Electron package, hash manifest, and artifact upload |

The Windows package lane writes a TypeScript-owned manifest containing the Git
HEAD, runtime identity, file hashes/sizes, and compiled-versus-packaged backend
identity. It does not sign, publish, deploy, or enable updates.

## Local And Hidden Helpers

- `scripts/build-bun-backend.ts` records `bun@1.3.14` as package-manager
  provenance instead of probing pnpm.
- `scripts/check-bun-control-openapi.ts` reports the supported Bun regeneration
  command.
- `apps/desktop/scripts/run-tst-008.ts` invokes workspace preparation/build
  through the current Bun executable while retaining Node only for Playwright.
- Desktop runtime and AI-call smoke commands use the supervised recorded Bun
  backend and the TypeScript recorded-pipeline integration. Bun owns the smoke
  orchestration while a bounded Node child owns only the Playwright/Electron
  launcher, matching the existing TST-008 runtime boundary. The FastAPI runtime
  smoke launcher is retired.
- `scripts/write-ci-artifact-manifest.ts` owns the Windows x64 CI package
  manifest.

The Microsoft SkillOpt checkout and Python backend/parity paths remain the
explicitly accepted external-tool and parity-oracle boundaries. CUT-006 does
not delete or disguise them. General documentation alignment belongs to
CUT-007, while Python source deletion still requires CUT-008 and its human
gate.

## Verification Boundary

Because this branch is not pushed, the GitHub-hosted workflow is not executed
by this task. The same frozen install, contract, typecheck, focused test,
recorded Electron, build/package, audit, and artifact-manifest commands are run
locally on Windows x64. Static validation checks every workflow and active
helper path. No commit, push, publish, sign, deploy, or Python-oracle removal is
performed.
