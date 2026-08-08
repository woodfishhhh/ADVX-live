# Repository Guidelines

## Project Structure & Module Organization

`apps/desktop` contains the Electron and React client. Keep process-specific code under `src/main`, `src/preload`, and `src/renderers`; reusable client logic belongs in `src/shared`. `apps/backend-bun` is the current Elysia/Bun service, organized into `api`, `application`, `domain`, `infrastructure`, and `providers`. `apps/backend` is a retained historical Python parity oracle, not the supported product runtime. Framework-neutral runtime schemas and generated Bun OpenAPI types live in `packages/contracts`. Put distributable audience presets in `resources`, cross-process scenarios in `tests/e2e`, synthetic fixtures in `tests/fixtures`, and current product or architecture decisions in `docs`.

## Build, Test, and Development Commands

Use Bun 1.3.14 and Node.js 24.18.0. Node is limited to Electron, Playwright, Vitest Browser Mode, and electron-builder tooling.

- `bun install --frozen-lockfile --ignore-scripts` installs the reviewed workspace graph.
- `bun run dev` starts Electron, which supervises the Bun backend child.
- `bun run dev:desktop` or `bun run dev:backend` runs one side independently.
- `bun run contracts` regenerates the Bun OpenAPI snapshot and TypeScript declarations.
- `bun run contracts:bun-openapi:check` rejects contract drift.
- `bun run typecheck`, `bun run test`, and `bun run build` run repository-wide validation.
- `bun run package:desktop` builds the Windows x64 unpacked application.

## Coding Style & Naming Conventions

Follow `.editorconfig`: UTF-8, LF endings, final newlines, and two-space indentation. TypeScript uses single quotes and no semicolons. Use `PascalCase` for React components and classes and `camelCase` for functions and variables. Keep API, domain, persistence, and Provider wire types at their established ownership boundaries. Do not hand-edit `packages/contracts/src/generated/bun-control-openapi.ts`; regenerate it with `bun run contracts`.

## Testing Guidelines

Backend tests use `bun test`; desktop tests use Vitest and are colocated as `*.test.ts`. Add focused regression tests for changed behavior, then run `bun run test` and `bun run typecheck`. End-to-end tests should exercise the real Electron-supervised Bun lifecycle and prove port and process cleanup. Retained Python tests are parity-oracle evidence only. Keep fixtures small, synthetic, and free of private recordings or screenshots. No minimum coverage threshold is currently configured.

## Sol-Terra Delegation

Use the repository `$sol-luna` skill for the full delegation contract and acceptance workflow.

- Keep requirements, decisions, risks, and final results in the main Sol thread. Put bulky search output, test logs, and intermediate exploration in bounded Terra threads.
- Parallelize only read-heavy tasks that are independent. Serialize tasks that may modify the same file or code region. Without separate worktrees, multiple subagents must not edit the same area concurrently.
- Give every Terra task an explicit objective, allowed and prohibited scope, known context, completion criteria, verification commands, rollback method, and structured return format.
- Terra completion is evidence, not acceptance. Sol must inspect the actual diff and completed test results before accepting, requesting rework, adding tests, or rolling back.
- A started test command is not a passing test. Report completion, exit status, and relevant output.
- Support key conclusions with files, symbols, commands, diffs, or test evidence rather than conclusion-only summaries.
- Keep every change minimal and reversible. Do not refactor unrelated code or add production dependencies outside the delegated contract.
- Subagents are leaf workers and must not create further agents. Use `sol_escalation` only when a documented High trigger applies.
- If a configured role or model is unavailable, report the failed delegation and keep it unverified. Do not silently replace Terra or Sol High with another model or generic role.

## Commit & Pull Request Guidelines

Follow the repository's Conventional Commit style, such as `feat(desktop): add overlay controls`, `feat(backend-bun): add session runtime`, `docs: update architecture`, or `chore: update tooling`. Keep commits scoped and imperative. Pull requests should explain the user-visible change, identify affected apps, list validation commands, link relevant issues, and include screenshots for UI changes. Note regenerated contracts or documentation updates explicitly.

## Security & Configuration

Copy non-secret settings from `.env.example`, but never commit `.env` files, Provider credentials, logs, `.advx-data`, or Electron user data. Store production secrets through Electron `safeStorage`; pass the one-time backend token through the inherited startup channel and never ordinary environment configuration or logs.
