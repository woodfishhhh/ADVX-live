# TST-014 Python Tooling Decision

`TST-014` is the maker record for the remaining active non-backend Python
tooling. The accepted `FND-001` inventory remains the source inventory; this
record only classifies the current replacement and retention decisions.

## Replacements

| Former entry point | TypeScript/Bun replacement | Decision |
| --- | --- | --- |
| `scripts/fetch_sb6657_corpus.py` | `scripts/fetch-sb6657-corpus.ts` | Ported; preserves endpoint pagination, validation, rate delay, retry bounds, header policy, canonical dedupe, metadata, and atomic output. |
| `scripts/profile_sb6657_corpus.py` | `scripts/profile-sb6657-corpus.ts` | Ported; preserves canonical input, metadata integrity checks, quantiles, aggregate-only rates, rhetorical signals, and generation guidance. |
| `scripts/sb6657_corpus_common.py` | `scripts/sb6657-corpus-common.ts` | Merged into the shared Bun corpus module; canonical JSON, SHA-256, dedupe, JSONL, and fsync/rename writes remain one implementation. |
| `scripts/sync_room_6657_skill.py` | `scripts/sync-room-6657-skill.ts` | Ported; preserves heading/directive/persona validation, learned-block limits, source hashing, deterministic JSON, and `--check`. |
| `scripts/run_room_6657_skillopt.py` | `scripts/run-room-6657-skillopt.ts` | Ported as the Bun-owned orchestration boundary. The locked Microsoft SkillOpt checkout remains an external Python integration; bootstrap, validation, isolated dry-run/run, staging provenance, review CAS, adoption, and rollback stay review-gated. |
| `scripts/verify_viewer_runtime_evidence.py` | `scripts/verify-viewer-runtime-evidence.ts` | Merged into the existing TST-009 Bun evidence verifier; the root `evidence:viewer-runtime` command no longer invokes Python. |

## Explicit Retentions

| Python path | Reason it remains | Boundary |
| --- | --- | --- |
| `tests/e2e/test_viewer_runtime_recorded.py` and `tests/e2e/viewer_runtime_recorded_evidence.py` | Recorded pytest behavior is the Python parity oracle required until cutover. | Test-only; no production or root tooling ownership. |
| `apps/backend/scripts/*.py` | Backend-owned FastAPI/OpenAPI, persistence inventory, SQLite backup, headless, and desktop smoke helpers remain backend compatibility/oracle boundaries. | Outside the master-plan “active non-backend Python CLI” cut; each root/backend invocation is inventoried for the later cutover gates. |
| `tests/parity/*.py` | Python control/session and health parity oracle. | Must not be deleted by TST-014. |

## Proof

- `package.json` and the durable scripts/SkillOpt documentation invoke the Bun
  replacements for corpus, profile, sync, SkillOpt, and viewer evidence work.
- No active root script, skill, CI entry, or developer workflow references the
  retired six Python root tools; the only remaining `viewer_runtime_recorded`
  Python import is the intentional pytest oracle.
- `pnpm typecheck:tst-014` passes.
- `pnpm test:tst-014` passes the focused corpus, profile, sync, SkillOpt
  wrapper, and Bun viewer-evidence checks.
- `bun scripts/sync-room-6657-skill.ts --check` passes against the generated
  runtime artifact.

The maker stops at `VERIFY`; an independent checker must re-run these bounded
checks and confirm that the Python oracle and backend-owned compatibility
helpers were not removed.
