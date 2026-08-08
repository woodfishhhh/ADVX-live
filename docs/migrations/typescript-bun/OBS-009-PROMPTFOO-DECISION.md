# OBS-009: Promptfoo Evaluation Spike

> Decision: **NO-GO for adoption in the ADVX migration runtime or default CI**
>
> Date: 2026-08-06
>
> Maker: `obs-009-maker-root-20260806-043`

## Scope

This is a bounded developer/CI evaluation of Promptfoo against the existing
ADVX-owned deterministic Agent evaluator from `OBS-008`. No Promptfoo package
was installed, no lockfile entry was added, and no production or Python parity
path was changed.

The registry snapshot inspected `promptfoo@0.122.0`, published
2026-08-04, with the engine requirement `node >=22.22.0`. The repository has no
global or project-local Promptfoo executable. Promptfoo's documented Node API,
JavaScript/TypeScript provider, JavaScript assertion, JSON output, and offline
environment controls were reviewed:

- [installation and Node runtime](https://www.promptfoo.dev/docs/installation/)
- [Node package API](https://www.promptfoo.dev/docs/usage/node-package/)
- [custom JavaScript/TypeScript providers](https://www.promptfoo.dev/docs/providers/custom-api/)
- [JavaScript assertions](https://www.promptfoo.dev/docs/configuration/expected-outputs/javascript/)
- [JSON output and local files](https://www.promptfoo.dev/docs/configuration/outputs/)
- [telemetry and offline controls](https://www.promptfoo.dev/docs/configuration/telemetry/)

## Acceptance Matrix

| Requirement | Result | Evidence and limitation |
| --- | --- | --- |
| Bun/Node boundary without Python | `PARTIAL` | Promptfoo is a Node package and its TypeScript providers are loaded by Node; a separate Node 24 runner is possible, but it is not a Bun-native evaluator and the package includes an optional `python-shell` integration. |
| Pinned, deterministic invocation | `PARTIAL` | An exact npm version, local fixture files, `--no-write`, and update/telemetry controls can bound a run. Inline function transforms are not serializable, so ADVX would need a second adapter contract. |
| No cloud sharing or remote telemetry | `PARTIAL` | `PROMPTFOO_DISABLE_TELEMETRY=1`, `PROMPTFOO_DISABLE_UPDATE=1`, `PROMPTFOO_DISABLE_REMOTE_GENERATION=true`, `PROMPTFOO_DISABLE_SHARING=1`, and `PROMPTFOO_SELF_HOSTED=1` are required. The documentation explicitly says these are not a network firewall. |
| Raw evidence stays local | `PARTIAL` | JSON export is local, but Promptfoo stores history/cache under `%USERPROFILE%\\.promptfoo` by default and exported config/output redaction is best-effort. ADVX's canonical evaluator already bounds and hashes its local evidence. |
| Custom TypeScript Provider/evaluator adapters | `PASS` | Node-loaded TypeScript providers and JavaScript assertions can call a local adapter, but the adapter would still have to translate ADVX's per-assertion report contract. |
| More value than the small ADVX harness | `NO` | Promptfoo adds provider/prompt matrices, HTML/CSV/JUnit exports, and a web viewer. OBS-008 already supplies deterministic local fixtures, ADVX-owned assertions, canonical JSON, per-assertion evidence, privacy classification, and no additional runtime or telemetry surface. No current migration task requires the extra matrix/UI value. |

## Decision

Do **not** add Promptfoo as a workspace or backend dependency, and do not add a
Promptfoo CI command. Keep the Bun evaluator as the authoritative local/CI
path. A future task may revisit Promptfoo only when a measured need for
cross-provider matrix comparison or a report format not provided by the ADVX
evaluator exists; that task must re-prove the Node boundary, offline controls,
local retention, and adapter ownership.

This is a go/no-go decision, not a claim that Promptfoo cannot run. Its
documented Node/TypeScript adapter path is usable as an explicitly external,
opt-in developer tool, but it does not add enough migration value to justify a
large dependency and a second evidence/persistence boundary now.

## Rollback

The decision is documentation-only. Reopening it requires a new scoped task;
no package, lockfile, Python oracle, or production runtime change is needed to
roll back this decision.
