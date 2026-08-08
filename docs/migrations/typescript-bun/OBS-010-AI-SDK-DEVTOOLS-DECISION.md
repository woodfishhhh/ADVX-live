# OBS-010: AI SDK DevTools Boundary

> Decision: **NO-GO for the ADVX workspace and product runtime**
>
> Date: 2026-08-06
>
> Maker: `obs-010-maker-root-20260806-045`

## Scope

This is a bounded evaluation of AI SDK DevTools for local development. The
candidate was inspected from registry metadata only; it was not installed and
no package, lockfile, Provider hook, or viewer command was added. The current
backend remains on `ai@7.0.42` and calls `generateText`/`streamText` directly
from `apps/backend-bun/src/providers/model/model-gateway.ts`.

The candidate snapshot is `@ai-sdk/devtools@1.0.11`, published on
2026-08-06, with the engine requirement `node >=22`. The official DevTools
documentation describes an experimental local viewer and explicitly says not
to use it in production. It also describes a `devToolsMiddleware`/
`wrapLanguageModel` interception path and local plaintext generation storage:

- [AI SDK DevTools](https://ai-sdk.dev/docs/ai-sdk-core/devtools)
- [AI SDK middleware](https://ai-sdk.dev/docs/ai-sdk-core/middleware)

## Acceptance Matrix

| Requirement | Result | Evidence and limitation |
| --- | --- | --- |
| Explicit development flag | `NO-GO` | No hook or package is present in the product tree, so the normal Provider path has no opt-in interception. Adoption would require a new explicit development-only boundary. |
| Production interception/UI exclusion | `PASS (absence)` | The package, middleware, viewer command, and related build references are absent from the workspace; the existing Bun production build therefore contains no DevTools surface. |
| Secrets and raw user media excluded | `NO` | The official tool captures complete prompts, outputs, tool calls, timing/token data, and raw Provider data and stores local generations in plaintext. The current gateway has no sanitizing interception layer, so enabling the default hook would violate this boundary. |
| Disabling restores the normal Provider path | `PASS (unchanged)` | No middleware was added. `AiSdkModelGateway` continues to invoke the existing `generateText`/`streamText` path directly. |
| Build inspection proves packaged absence | `PASS` | Product-tree reference scan finds no DevTools package or hook, and the scoped Bun production build remains unchanged. |

## Decision

Do **not** add `@ai-sdk/devtools` to the workspace and do not add a DevTools
hook or UI. The local viewer is useful for exploratory debugging, but its
default interception and plaintext evidence model are incompatible with the
current requirement that secrets and raw user media stay excluded. The
existing redacted JSONL/debug snapshot, replay/eval evidence, and OTel
correlation surfaces provide the bounded ADVX observability path without a
second raw-data boundary.

This is not a claim that AI SDK DevTools cannot run as an explicitly external
tool. Reopening the decision requires a new scoped task that first defines a
sanitizing Provider boundary, proves an explicit development flag, verifies
production tree-shaking/package absence, and proves that disabling the hook is
byte-for-byte equivalent to the current Provider path.

## Rollback

The decision is documentation-only. Reopening it requires a new scoped task;
there is no dependency, lockfile, runtime, desktop, Python parity oracle, or
packaging change to roll back.
