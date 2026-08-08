# CUT-013 Independent Final Review

## Scope And Source Identity

This Maker review is bound to branch `TS_backend_refactor` at base HEAD
`b90f5914592ca8fec9c18285068964358b575a04`. The last clean-clone source
accepted by `CUT-012` is commit
`78d74e94be61b5a358daee158cf79977dce6b500`; `b90f5914` adds only the
accepted `CUT-012` control-plane record.

The review used four sequential, non-overlapping review lanes because the
current execution authority prohibits subagent delegation. These lanes are
review evidence, not task acceptance. A distinct exact-commit Checker must
still inspect the candidate and decide whether `CUT-013` is `DONE`.

| Lane | Run/context identity | Verdict |
| --- | --- | --- |
| Architecture and product semantics | `cut-013-architecture-reviewer-root-20260808-153` / `cut-013-architecture-reviewer-root-context-20260808-153` | PASS after fixes |
| Data migration and rollback | `cut-013-data-reviewer-root-20260808-154` / `cut-013-data-reviewer-root-context-20260808-154` | PASS |
| Security and packaging | `cut-013-security-reviewer-root-20260808-155` / `cut-013-security-reviewer-root-context-20260808-155` | PASS after fixes |
| Test and evidence completeness | `cut-013-evidence-reviewer-root-20260808-156` / `cut-013-evidence-reviewer-root-context-20260808-156` | PASS after fixes |

## Findings And Repairs

1. The backend supervisor's public process identity carried the one-time
   startup token even though the token is only needed for the inherited stdin
   startup channel. The token was removed from `BackendProcessIdentitySpec`,
   its default value, the Electron identity object, and the focused tests.
2. `desktop:list-sources`, `media:get-access-status`, and
   `media:request-microphone` did not call the existing control-sender guard.
   All three handlers now reject untrusted renderer senders before performing
   the sensitive operation.
3. Thirteen migration plan-check tests had stale synthetic assumptions from
   the early Foundation cursor. Their fixtures now create the intended invalid
   state explicitly without weakening the production checker.
4. The phase-gate index and Phase 04 state were stale. They now reflect the
   already accepted `GATE-04` through `GATE-08` records and leave only
   `GATE-09` open.

No other adjacent hardening item was promoted into this task.

## Required Risk Review

| Required concern | Review conclusion |
| --- | --- |
| Hidden Node/Bun assumptions | Electron Main uses its required Node/Electron APIs only to resolve and supervise the backend. Development starts the Bun CLI; the packaged application starts the compiled Bun executable directly. No hidden Node backend child was found. Bun-owned modules use Bun or Bun-supported `node:` compatibility APIs. |
| Untracked Python requirements | The tracked product, build, test, and package graph contains no Python file, Python manifest, or Python lockfile. The untracked owner tree under `apps/backend` is preserved, untouched, and excluded from tracked release/package claims. The optional room-6657 optimizer wrapper is not part of normal product execution. |
| Stale evidence | The stale gate index, phase status, and synthetic plan-check expectations were repaired. `INVARIANTS.md` remains an intentionally frozen FND-002 historical baseline rather than being rewritten as current evidence. |
| Suppressed scans | No suppressed current scan was found. The accepted CUT-011 repository scan remains applicable because this task adds no Python or package-manager dependency. The accepted CUT-012 artifact hash was rechecked before reuse. |
| Secret exposure | The supervisor identity no longer carries the one-time token. The existing startup pipe, log redaction, authenticated loopback boundary, and new IPC sender checks remain covered by targeted tests. |
| Cancellation fences | Runtime coordinator, scheduler, barrage, Viewer generation, shared-brain side effects, and process lifecycle tests pass. No epoch, sequence, abort, or shutdown fence was removed. |
| Unsupported platform claims | Current support and proof remain Windows x64 only. The application is unsigned, unpublished, and undeployed; macOS and Windows arm64 remain unproven and unsupported. |

## Decisive Verification

| Check | Result |
| --- | --- |
| Architecture, lifecycle, cancellation, and product-semantics tests | 59 pass, 0 fail, 391 expectations |
| SQLite migration, database, and persistence-fault tests | 14 pass, 0 fail, 88 expectations |
| Focused security and diagnostics tests | 22 pass, 0 fail, 165 expectations |
| Desktop suite after the security fixes | 40 pass, 0 fail across 9 files |
| Migration plan-check regression suite | 50 pass, 0 fail, 197 expectations |
| Repository TypeScript | PASS |
| Windows x64 packaging/release-inertness check | PASS |
| Live migration plan-check | PASS: 133 tasks, 73 links, 130 accepted evidence records, 0 errors |

The broad `CUT-012` clean-clone, install, package, and installed E2E matrix was
not repeated because this task did not change its dependency, build, or
packaging graph. Its accepted result file SHA-256 remains
`c9531a34c6237c7f68c28e5bb840e172cdb3a8320c82c6ee2998bda8cb9f1cb9`.
Current shared desktop security boundaries received fresh targeted tests and
repository TypeScript verification instead.

## Limitations And Verdict

- Rollback is restore-from-backup, not an in-place downgrade; Bun-only writes
  made after the retained backup are not preserved by rollback.
- No new macOS, Windows arm64, signing, publishing, deployment, or
  credentialed external-Provider claim is made.
- CI/CD remains disabled for automatic triggers. The workflow is
  `workflow_dispatch`-only and was not triggered during this review.

Maker verdict: the current implementation satisfies the bounded `CUT-013`
review contract after the listed fixes and may advance to `VERIFY`. This is
not acceptance; only the distinct exact-commit Checker may mark it `DONE`.

Maker evidence is at
`.omx/artifacts/typescript-bun/CUT-013/cut-013-maker-root-20260808-157/result.json`
with SHA-256
`1f4baae88a4d9e739c9c3519f8ab132fb4a23dec42bbb89430e77f9cc00f4e7d`.

## Recovery Note

The first exact-commit Checker rejected the provisional acceptance transition
because one negative plan-check fixture required an exhaustive error set and
therefore rejected an additional valid downstream dependency diagnostic. The
recovery changes only that assertion to require the blocker error as a subset.
It does not change product code or weaken the production checker. A new exact
commit must be checked; evidence for the rejected candidate is not reused.
