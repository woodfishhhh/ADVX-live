# TST-012 Bun CI Decision

## Scope

TST-012 adds one read-only GitHub Actions workflow for the Bun migration
boundaries. It proves the frozen Bun install, generated-contract drift,
strict type checks, Oxlint/Oxfmt, focused runtime tests, recorded evidence,
both distributable builds, and the resolved dependency audit.

The workflow is intentionally a focused gate rather than a second copy of the
repository-wide test aggregator. The selected Bun tests cover lifecycle,
authenticated health/control, and the Electron Main supervision boundary.
The retained Python suites remain the parity oracle and are not removed or
invoked by this CI job.

## Dependency policy

The pnpm built-in release-age policy is explicitly disabled with
`minimumReleaseAge: 0`. No `minimumReleaseAgeExclude` list is present. The
same policy is kept in the Bun-facing workspace configuration so CI does not
silently reintroduce a seven-day delay or an exception list.

`bun audit --json` initially found high advisories for `brace-expansion`,
`fast-uri`, and `js-yaml`. The workspace overrides now pin the fixed releases:

- `brace-expansion: 5.0.9`
- `fast-uri: 3.1.5`
- `js-yaml: 4.3.1`
- `@redocly/openapi-core: 1.34.18` (existing reviewed pin)

The obsolete local `brace-expansion@5.0.8` patch was removed. Both `bun.lock`
and `pnpm-lock.yaml` were regenerated, and the final frozen install and audit
are clean.

## Workflow contract

`.github/workflows/bun-ci.yml` runs on pushes to `main` and
`TS_backend_refactor`, pull requests, and manual dispatch. It uses Bun 1.3.14,
Node 24.18.0 for Electron tooling, read-only repository permissions, and
`bun install --frozen-lockfile`. Audit failures are fatal; there is no
`continue-on-error`, redirection, or pnpm install fallback.

The static contract checker is `scripts/check-tst-012-ci.ts`, with strict
configuration in `scripts/tsconfig.tst-012.json`. `test:tst-012` runs the
checker under Bun, and `test:tst-014` now invokes its existing typecheck via
Bun so the CI job does not depend on pnpm being installed on the runner.

## Bounded limitations

The previously accepted TST-000 record still owns the existing full-suite
import-boundary limitation. TST-012 does not expand that known queue or turn
the Browser Mode project into a regular threaded Vitest run; Browser Mode and
the broader parity matrix remain owned by their existing tasks.
