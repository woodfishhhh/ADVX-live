# CUT-005 Bun Root And Workspace Commands

## Scope

Bun `1.3.14` is the single supported package manager and root/workspace script
runner for the Windows x64 migration target. Windows x64 is the only release
scope authorized by this decision. Node may still execute Electron, Vitest,
and electron-builder tooling when those tools require it; Bun remains the
caller and Node is not a second package-manager policy.

The supported install command is:

```powershell
bun install --frozen-lockfile --ignore-scripts
```

Lifecycle scripts stay disabled during installation. The reviewed Bun
`trustedDependencies` list is empty.

## Supported Commands

| Concern | Root command |
| --- | --- |
| Development | `bun run dev` |
| Desktop development | `bun run dev:desktop` |
| Backend development | `bun run dev:backend` |
| Contracts | `bun run contracts` and `bun run contracts:bun-openapi:check` |
| Lint and format | `bun run lint`, `bun run format`, and `bun run format:check` |
| Typecheck | `bun run typecheck` |
| Unit and integration tests | `bun run test` and `bun run test:projects` |
| Browser/E2E tests | `bun run test:projects:browser` and `bun run test:e2e:viewer-runtime` |
| Replay and evaluation | `bun run replay` and `bun run eval` |
| Evidence | `bun run evidence` |
| Build | `bun run build` |
| Windows x64 package directory | `bun run package:desktop` |
| Dependency audit | `bun run audit` |

`scripts/dev.mjs` runs under Bun and starts the Electron workspace through
Bun's workspace filter. Electron continues to supervise the Bun backend child
process; root development does not start a separate Python backend.

The root test switch also keeps the original three composition-root rule while
recognizing the already accepted diagnostics, headless, profiling, and testing
source areas. The recorded-pipeline API now depends on a structural API adapter
instead of importing infrastructure, Provider configuration uses the contracts
hash primitive, and only the replay service retains its reviewed temporary-file
Node standard-library imports.

## Legacy Boundaries

The Python backend remains the migration parity oracle and is not deleted by
this task. Migration-only comparison and backup helpers may still invoke it
until their owning CUT-006 or CUT-008 work is accepted. They are not supported
root/workspace product commands.

`pnpm-lock.yaml` and `pnpm-workspace.yaml` remain tracked compatibility
artifacts for later cleanup. They do not define the active package manager.
The pnpm built-in dependency-age policy is explicitly disabled with
`minimumReleaseAge: 0`, and no supported root/workspace command invokes pnpm.
CI, scheduled workflows, hidden automation, and helper-script conversion stay
owned by CUT-006.

This task does not commit, push, publish, sign, deploy, add another platform
claim, or remove the Python parity oracle.
