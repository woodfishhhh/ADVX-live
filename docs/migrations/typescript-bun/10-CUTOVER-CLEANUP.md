# Phase 09: Cutover, Python Removal, And Closure

> Entry: `GATE-08`
>
> Exit: `GATE-09`

## Goal

Make Bun the only active backend and repository toolchain, prove the result in a
clean environment, then remove Python and temporary migration machinery without
losing data, rollback evidence, tests, or architectural truth.

This phase contains the irreversible boundary. Python deletion requires the
explicit human gate below even when every prior phase gate is accepted.

## Entry Conditions

- `GATE-00` through `GATE-08` are `DONE`.
- Recorded parity passes against the current Python oracle.
- Installed Windows proof passes.
- Required macOS claims have proof, or `PKG-011` has an authorized
  `ACCEPTED_LIMITATION` that removes the unsupported platform claim.
- Representative legacy data migration and backup/restore have passed.
- Credentialed Provider evidence is current for every release-critical Provider.
- The Python runtime remains runnable as rollback at phase entry.
- No unresolved critical/high security or data finding is waived silently.

## Human Deletion Gate

Before `CUT-008`, an authorized human must approve:

```text
Python parity oracle may be deleted.
The accepted evidence is bound to commit <sha>.
The rollback path after deletion is <tag/artifact/branch/data procedure>.
Known release limitations are <list>.
```

The loop may prepare the deletion diff and evidence inventory, but it may not
cross this gate on a completion promise or inferred intent.

## Tasks

### `CUT-001` Bun Default With Local Rollback

Change development and supported product startup to `bun-compiled` or the
approved Bun mode while retaining an explicit local `python-oracle` rollback.

Requirements:

- diagnostics state the selected runtime;
- the selector is not exposed as an unsupported production user feature;
- switching performs a clean stop/start;
- version/schema compatibility is checked;
- Bun failure can return to Python without data mutation surprises;
- default and rollback smokes use isolated copies first.

### `CUT-002` Bun-Default Soak

Run a bounded soak across recorded product scenarios:

- repeated Session start/stop;
- text/frame/microphone/system-audio combinations;
- Viewer barrage/silence waves;
- Provider timeout/rate-limit/recovery;
- backend restart and WebSocket reconnect;
- database writes, compaction/retention if applicable;
- diagnostics bundle generation;
- Electron quit during in-flight work.

Define duration, cycles, fixtures, thresholds, resource sampling, and stop
conditions before running. Zero stale output, orphan process, unhandled
rejection, DB corruption, or secret leak is allowed.

### `CUT-003` Backup And Rollback Rehearsal

Using representative privacy-safe copies:

1. identify schema and application versions;
2. create backup and hash manifest;
3. start Bun and run migration;
4. execute a recorded scenario;
5. stop cleanly;
6. restore the documented rollback-compatible backup;
7. start Python oracle;
8. verify expected retained state and behavior.

Record exactly which forward schema changes are not backward compatible. Do not
promise in-place rollback when only restore-from-backup is safe.

### `CUT-004` Final External Evidence Matrix

Run the current release-critical matrix:

| Concern | Required Evidence |
| --- | --- |
| LLM Providers | Credentialed live request, cancellation, error normalization |
| ASR Providers | Credentialed live stream/file path as product requires |
| Windows | Installed end-to-end and lifecycle |
| macOS | Installed end-to-end or accepted limitation |
| Legacy data | Representative migration, backup, restore |
| Security | Current scans, SBOM/license, secret audit |
| Product | Recorded deterministic scenario matrix |

Credential-gated results must record date, Provider/model identity, build SHA,
and limitations without storing credentials or private content.

### `CUT-005` Root And Workspace Commands

Make Bun the single documented package manager and script runner:

- install;
- development;
- desktop/backend development;
- contracts;
- lint/format;
- typecheck;
- unit/integration/E2E;
- replay/eval/evidence;
- build/package;
- audit.

Remove active pnpm and uv invocation only after equivalent Bun commands pass.
Electron tools may still execute on Node where their own runtime requires it;
that is not a second package-manager policy.

### `CUT-006` CI And Automation Switch

Convert workflows and helper paths to:

- Bun setup and frozen install;
- TypeScript contract generation/drift check;
- TypeScript lifecycle/evidence scripts;
- Bun backend build/compile;
- test and packaging matrices;
- artifact manifests;
- no active Python setup/cache/action.

Search scheduled, release, local-development, and hidden helper scripts, not
only the primary CI workflow.

### `CUT-007` Documentation Alignment

Update current-state documents so they describe Bun, not the historical
FastAPI implementation:

- repository `AGENTS.md`;
- root and app READMEs;
- `docs/ARCHITECTURE.md`;
- `docs/BACKEND_DESIGN.md`;
- `docs/DECISIONS.md`;
- protocol and real-pipeline docs;
- setup, troubleshooting, packaging, security, and release instructions;
- diagrams and command examples.

Preserve historical design records only when clearly labeled historical or
superseded. Remove stale Director semantics from active documentation in favor
of the current speaking product specification.

### `CUT-008` Python Source And Test Removal

After the human deletion gate:

- remove FastAPI/application/domain/infrastructure/provider Python source;
- remove Python-only test source;
- remove Python launch/supervisor adapters;
- remove Python contract export path;
- remove Python packaging/freeze artifacts;
- retain fixtures, behavior ledgers, and evidence that remain language-neutral.

Review the deletion as an architecture change, not bulk cleanup. Every removed
test must already be accounted for by `TST-002`.

### `CUT-009` Python Toolchain Removal

Remove active:

- `pyproject.toml`;
- `uv.lock`;
- Alembic runtime/config and Python migrations after their history is safely
  represented;
- pytest/Ruff configuration;
- Python-specific ignores and editor tasks;
- CI Python setup and caches;
- developer instructions requiring Python/uv.

Do not delete generic `.py` examples or historical artifacts solely by
extension without checking whether they are within the product/toolchain scope.

### `CUT-010` Migration Shim Removal

Delete or simplify:

- dual Python/Bun selector;
- compatibility clients used only during parity;
- schema/trace normalizers no longer needed at runtime;
- copied Python contract artifacts;
- temporary feature flags;
- adapter branches whose rollback window has closed;
- migration-only telemetry.

Keep durable version negotiation, data migration history, and useful diagnostics.

### `CUT-011` Repository Runtime Scan

Produce a machine-readable scan for active references to:

```text
python
python3
pytest
ruff
uv
FastAPI
Pydantic
Alembic runtime
pnpm
package-lock / yarn lock
```

Classify each match:

- active violation;
- historical migration documentation;
- fixture/test string;
- third-party/generated artifact;
- explicitly retained non-product example.

The final claim is “no active project dependency or release artifact,” not
“these byte sequences never occur in Git history.”

### `CUT-012` Clean-Clone Proof

From a new checkout with no existing dependencies or caches:

```text
bun install --frozen-lockfile
contract drift check
typecheck
lint
format check
unit/integration/property/fault tests
recorded replay/eval
desktop build
backend compile
package
installed end-to-end
runtime scan
security/SBOM/artifact verification
```

Record OS, architecture, tool versions, commit, commands, exit codes, hashes,
and artifact paths. A dirty developer machine cannot substitute for this gate.

### `CUT-013` Independent Final Review

Use separate reviewers for:

- architecture and product semantics;
- data migration/rollback;
- security and packaging;
- test/evidence completeness.

Reviewers inspect current code and rerun decisive checks. They must explicitly
look for hidden Node/Bun boundary assumptions, untracked Python requirements,
stale evidence, suppressed scans, secret exposure, lost cancellation fences,
and unsupported platform claims.

Maker review record:
[CUT-013-INDEPENDENT-FINAL-REVIEW.md](./CUT-013-INDEPENDENT-FINAL-REVIEW.md).
The Maker record is the review input. The distinct exact-commit acceptance is
indexed in [EVIDENCE.md](./EVIDENCE.md).

### `CUT-014` Close Or Retain Rollback Window

Record:

- shipped/default Bun version;
- last Python-oracle commit/tag/artifact;
- data backup/restore procedure;
- duration and owner of any retained rollback window;
- conditions for removing archived artifacts;
- open limitations and owners;
- superseded migration tasks;
- final evidence index;
- documentation archive location.

Compact `STATE.md` to a terminal summary but preserve append-only run/evidence
history. Do not delete the migration plan immediately after success.

Maker closure record:
[CUT-014-ROLLBACK-WINDOW-CLOSURE.md](./CUT-014-ROLLBACK-WINDOW-CLOSURE.md).
The record is a candidate only until a distinct exact-commit Checker accepts
it.

## Final Definition Of Done

- [ ] Bun is the only active package manager, script runner, and backend runtime
      in the product repository.
- [ ] Electron's required Node runtime boundary is documented honestly.
- [ ] No Python interpreter, environment, package, source backend, test runner,
      contract generator, migration runner, CI step, or packaged artifact is
      required.
- [ ] Current HTTP, WebSocket, binary ingest, session, product, data, secret,
      lifecycle, and diagnostics behavior is preserved.
- [ ] Bun source, compiled, packaged, and installed paths have accepted proof.
- [ ] Credentialed Provider and supported platform evidence is current.
- [ ] Representative legacy data migrates, backs up, restores, and has an honest
      rollback story.
- [ ] Root commands, CI, docs, onboarding, troubleshooting, and release paths
      describe the same TypeScript/Bun system.
- [ ] No critical/high unresolved finding is hidden or relabeled as success.
- [ ] Independent reviewers accept architecture, data, security, and tests.
- [ ] `EVIDENCE.md` binds the final claim to the exact accepted commit/artifacts.

## `GATE-09` Proof-Or-Stop

The final checker emits one of:

```text
DONE
  All required evidence is admissible and bound to the final commit.

BLOCKED
  One or more required claims lack proof; list each claim and next action.

FAILED
  A proven regression or unsafe condition requires rollback/rework.
```

Only `DONE` permits the loop wrapper to emit:

```text
<promise>ADVX_TYPESCRIPT_BUN_MIGRATION_COMPLETE</promise>
```

The promise is a scheduler signal. The accepted `GATE-09` evidence is the proof.

## Rollback

Before `CUT-008`, select `python-oracle` and restore the documented compatible
data copy. After deletion, use the recorded commit/tag/artifact and
backup/restore procedure from the human gate. If neither path is valid, the
cutover may not proceed.

## Observations

To be filled during execution.
