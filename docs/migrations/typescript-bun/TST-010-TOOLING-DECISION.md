# TST-010 Oxlint And Oxfmt Decision

## Baseline

- The repository had no active ESLint, Prettier, Oxlint, or Oxfmt configuration.
- TypeScript compiler projects remain the authoritative type gate.
- Ruff remains authoritative for the retained Python parity oracle; TST-010 does
  not change Python linting or formatting.
- `.editorconfig` requires UTF-8, LF, final newlines, two-space indentation for
  non-Python files, and four-space Python indentation.

## Oxlint

Oxlint `1.77.0` is the default TypeScript/JavaScript lint gate. The unclassified
category presets are disabled rather than turning hundreds of legacy findings into
an unactionable baseline. The first stage explicitly makes these reviewed
correctness and suspicious rules blocking:

- constant binary expressions, constructor returns, duplicate object keys,
  unsafe `finally` control flow, and unexpected multiline parsing;
- self imports, with duplicate imports reported as non-blocking migration debt;
- invalid Promise static, return-wrap, and API-parameter patterns;
- React hook ordering, keyed lists, child ownership, and state mutation.

React exhaustive dependency findings remain warnings while the existing hook
inventory is reviewed. `react-in-jsx-scope` is disabled because the desktop uses
the automatic JSX runtime. Broad preset categories, style findings, and
legacy-script findings do not block this first gate; additional rules can be
promoted only after their current findings are classified.

Oxlint type-aware mode is not enabled. The existing strict `tsc --noEmit`
projects already cover the repository's type boundary, while adding a second
type engine would duplicate the normal gate without a demonstrated defect or
runtime benefit. This can be revisited with a measured, task-scoped reason.

Generated contracts, build output, migration evidence, unrelated promotional
work, and the retained Python tree are excluded. Handwritten contract source,
tests, Electron main/preload/renderers, Bun backend source, repository scripts,
and Vite configuration remain in scope.

## Oxfmt

Oxfmt `0.62.0` is the sole configured formatter. No Prettier or second formatter
runs before or after it. Its checked configuration preserves the repository's
single quotes, no semicolons, two-space indentation, LF endings, and final
newlines. Import sorting and package-key sorting are disabled to avoid semantic
or high-noise mechanical changes during migration.

The first format gate is deliberately bounded to the tooling configuration and
the files reviewed while resolving TST-010 findings. That set exercises
handwritten TypeScript, package configuration, the Electron/Vite configuration,
the Electron builder YAML, and this Markdown decision. Oxfmt found broad legacy
source drift during the spike, so repository-wide formatting is not enabled by
silently rewriting hundreds of migration files. Later tasks may expand the
explicit gate after reviewing that mechanical diff.

Generated contract files are explicitly excluded. Markdown uses preserved prose
wrapping, and import/package-key sorting stay disabled. This makes Oxfmt the one
authoritative formatter without churning accepted migration evidence or generated
artifacts merely to obtain a green first baseline.

## Rollback

The tooling change is isolated to exact root development dependencies, the two
root configuration files, and root scripts. Rollback removes those entries and
restores the two fail-closed TST-010 placeholder commands. It does not alter the
Python oracle, runtime behavior, persisted data, or generated contracts.
