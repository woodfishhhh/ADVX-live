# Migration Evidence Index

> Mode: append-only index
>
> Artifact root: `.omx/artifacts/typescript-bun/<task-id>/<run-id>/`
>
> Rule: a maker cannot accept its own implementation evidence

## Purpose

This file indexes accepted proof. It does not duplicate raw logs, screenshots,
traces, profiles, dumps, test reports, or diagnostics bundles.

Evidence is admissible only when it is:

- bound to an exact commit or exact dirty-tree diff identity;
- produced by a documented command or procedure;
- fresh enough for the claim;
- classified by environment and Provider/platform type;
- inspectable at a stable artifact path;
- independently checked where the task or gate requires it;
- explicit about limitations and omitted claims.

## Evidence Classes

| Class | Definition | Typical Claims |
| --- | --- | --- |
| `static` | Source/config/schema inspection | Dependency or boundary shape |
| `unit` | Deterministic focused test | Local behavior |
| `integration` | Multiple real local components | Protocol, DB, application flow |
| `property` | Seeded generated cases | Ordering/cancellation invariants |
| `synthetic` | Fake Provider or generated source | Orchestration/failure handling |
| `recorded` | Privacy-reviewed recorded fixture | Reproducible product pipeline |
| `credentialed-live` | Authorized real external Provider | Provider interoperability |
| `unpacked` | Built but not installed application | Build/resource wiring |
| `installed-platform` | Installed app on named OS/arch | Lifecycle and platform behavior |
| `manual-visual` | Human visual inspection | UI/overlay/trace usability |
| `security` | Scanner, audit, SBOM, fuse/integrity result | Release security posture |
| `review` | Independent diff/evidence review | Task or phase acceptance |

## Required Record

Append one record per accepted task or gate:

```md
### <task-id> / <run-id>

- Claim:
- Status: `DONE`
- Commit:
- Dirty diff identity: `clean` or `<artifact hash/path>`
- Date:
- Environment:
- Evidence class:
- Maker:
- Maker run/context ID:
- Checker:
- Checker run/context ID:
- Checker parent run ID:
- Checker participated in implementation: `false`
- Reviewed source-state hash:
- Commands/procedure:
  - `<command>` -> exit `<code>`
- Artifacts:
  - `<path>` (`sha256:<hash>`, `<size>`)
- Accepted assertions:
  - ...
- Limitations:
  - ...
- Related run log:
  - `<run-id>`
```

Do not edit an accepted record to make later results look older. Append a
superseding record and link the previous run.

The checker run/context identity must differ from the maker identity. A role
rename inside one context is inadmissible. A checker that authored the reviewed
diff is also inadmissible.

For an authorized external limitation, use:

```md
### <task-id> / <run-id> / accepted limitation

- Status: `ACCEPTED_LIMITATION`
- Missing proof:
- Blocking authority/environment:
- Release claim removed or narrowed:
- Authorized by:
- Authorization reference/date:
- Revisit owner and trigger:
- Available lower-class evidence:
- Downstream gates explicitly permitting this status:
- Limitations:
```

This record does not prove the missing capability. It prevents a permanent
`BLOCKED` task from being silently called `DONE`.

## Phase Gate Index

| Gate | Status | Accepted Commit | Run ID | Evidence Classes | Limitations |
| --- | --- | --- | --- | --- | --- |
| `GATE-00` | `TODO` | - | - | - | - |
| `GATE-01` | `TODO` | - | - | - | - |
| `GATE-02` | `TODO` | - | - | - | - |
| `GATE-03` | `TODO` | - | - | - | - |
| `GATE-04` | `TODO` | - | - | - | - |
| `GATE-05` | `DONE` | `41665a96cf67eb82cbe02f83abbbe2b79b100e48` | `gate-05-checker-root-20260806-024` | review, unit, integration, recorded, unpacked | Node 22 engine warning; no signed packaged-release claim |
| `GATE-06` | `DONE` | `41665a96cf67eb82cbe02f83abbbe2b79b100e48` | `gate-06-checker-root-20260806-052` | review, observability, replay, lifecycle | Node 22 engine warning; no credentialed-live claim |
| `GATE-07` | `DONE` | `41665a96cf67eb82cbe02f83abbbe2b79b100e48` | `gate-07-checker-root-20260807-087` | phase-gate, review, static, ledger | Node 22 engine warning; no credentialed-live claim |
| `GATE-08` | `TODO` | - | - | - | - |
| `GATE-09` | `TODO` | - | - | - | - |

## Accepted Records

### CUT-004 / cut-004-checker-root-20260808-130

- Claim: the current release-critical external matrix passes for credentialed
  LLM/ASR Providers, Windows installed lifecycle, legacy rollback, current
  security reports, and the deterministic product matrix, with macOS explicitly
  removed from current release scope by the authorized limitation.
- Status: `DONE`
- Original authorization baseline:
  `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity: seven-file aggregate
  `56117a916df347af15809355e33e39cb435907352c050ccfdd6743338f3e1524`
- Date: `2026-08-08`
- Environment: Windows x64; Bun `1.3.14`; Node `24.18.0` inside Electron and
  host Node `22.23.1` for Electron tooling; pnpm `11.9.0`
- Evidence class: `credentialed-live`, `unit`, `installed-platform`, `recorded`,
  `security`, `review`
- Maker: root
- Maker run/context ID: `cut-004-maker-root-20260808-129` /
  `cut-004-maker-root-context-20260808-129`
- Checker: root
- Checker run/context ID: `cut-004-checker-root-20260808-130` /
  `cut-004-checker-root-context-20260808-130`
- Checker parent run ID: `cut-004-maker-root-20260808-129`
- Checker participated in implementation: `false`
- Reviewed source-state hash:
  `sha256:56117a916df347af15809355e33e39cb435907352c050ccfdd6743338f3e1524`
- Commands/procedure:
  - `bun run typecheck:cut-004` -> exit `0`
  - credentialed `bun scripts/check-cut-004.ts` -> exit `0`; seven matrix rows pass
  - independent seven-file identity recomputation -> zero mismatches
  - current installed Windows checker -> exit `0`; pipeline, restart, uninstall,
    and zero-orphan audit pass
  - current security checker -> exit `0`; 3518 files, zero secret findings,
    zero advisories, 564 license/SBOM components, zero direct-policy failures
  - `pnpm why nanoid -r` -> one resolved version, `3.3.17`
- Artifacts:
  - `.omx/artifacts/typescript-bun/CUT-004/cut-004-checker-root-20260808-130/result.json`
    (`sha256:940a6d7b315beee9f4dfd8ed30b017c0800dc48e4ec7bae64d733466db50b023`, 4384 bytes)
  - `.omx/artifacts/typescript-bun/CUT-004/cut-004-checker-root-20260808-130/credentialed-live.json`
    (`sha256:eed05e7c52712e03cef0e97fabf5500d26a9134497ce96d137e12315fb2548f6`, 2493 bytes)
  - `.omx/artifacts/typescript-bun/CUT-004/cut-004-checker-root-20260808-130/windows-installed/result.json`
    (`sha256:d81da7ff08720736e7556a13283932100b123531a06fa22f26f2f27edd3f4b31`, 3282 bytes)
  - `.omx/artifacts/typescript-bun/CUT-004/cut-004-checker-root-20260808-130/windows-installed/runtime-e2e/installed-overlay.png`
    (`sha256:47507abce8aa16d199195b42776bf9b316965b21ba8c513f98c2d4c9ecf063d4`, 20942 bytes)
  - `.omx/artifacts/typescript-bun/CUT-004/cut-004-checker-root-20260808-130/security/result.json`
    (`sha256:3fc759a7caef60a21f104b42b663e94b02d1b62bd0b76b54495682c72ebab428`, 928 bytes)
  - `.omx/artifacts/typescript-bun/CUT-004/cut-004-checker-root-20260808-130/security/sbom.cdx.json`
    (`sha256:85d6cbd3172dbf272a68a7a4b4cc6f9ffe9dd49578f1f0e7aa93b3f0a9a0e3c6`, 142570 bytes)
- Accepted assertions:
  - credentialed Provider metadata records `https://api.stepfun.com/v1`,
    `step-3.7-flash`, `stepaudio-2.5-asr`, date, HEAD, source hashes, and
    limitations without credentials or private content
  - the live Viewer returns non-empty text; LLM cancellation/deadline normalize
    to `aborted`/`timeout`; five current Model Gateway error tests pass
  - live microphone and system-audio paths each produce a normalized ASR final
  - the installed Windows x64 app completes the real recorded media-to-overlay
    path, graceful restart, uninstall, and zero-orphan lifecycle
  - accepted `CUT-002` product and `CUT-003` legacy rollback evidence remains
    admissible; authorized `PKG-011` remains an accepted limitation, not a
    macOS support claim
  - current `bun audit` is empty after exact `nanoid@3.3.17` resolution in Bun,
    pnpm, and the installed tree; `minimumReleaseAge: 0` remains explicit
- Limitations:
  - live inputs are synthetic PCM and a one-pixel PNG; no user media was used
  - current release scope is Windows x64 only; macOS is unsupported
  - the local build is unsigned; no signing, publish, update, or deploy occurred
  - Python remains the parity oracle and was not removed
- Related run log: `cut-004-checker-root-20260808-130`

### CUT-003 / cut-003-checker-root-20260808-128

- Claim: a privacy-safe legacy database can be backed up online, migrated on an
  isolated Bun copy, exercised through a recorded scenario, restored after Bun
  stops, and accepted by the real Python oracle without an in-place rollback
  claim.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity: four-file aggregate
  `cd034d849b3490f55b5c5a611ffa2866b768c81b574c5ea025d3ecd365ffd361`
- Date: `2026-08-08`
- Environment: Windows x64; Bun `1.3.14`; Python oracle `0.1.0`; synthetic
  legacy SQLite fixture
- Evidence class: integration, recorded, data-safety, rollback, review
- Maker run/context ID: `cut-003-maker-root-20260808-127` /
  `cut-003-maker-root-context-20260808-127`
- Checker run/context ID: `cut-003-checker-root-20260808-128` /
  `cut-003-checker-root-context-20260808-128`
- Checker parent run ID: `cut-003-maker-root-20260808-127`
- Checker participated in implementation: `false`
- Original reviewed source-state baseline:
  `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Commands/procedure:
  - `pnpm typecheck:cut-003` -> exit `0`
  - `pnpm check:cut-003` -> exit `0`; 11.427 seconds
  - source identity and database manifest recomputation -> eight total entries,
    zero mismatches
  - scoped diff, live plan, and JSONL ledger checks -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/CUT-003/cut-003-checker-root-20260808-128/result.json`
    (`sha256:c0ce607700d689ae10b47f4991f6b7c1e83395d2bb6e4ad955c6f2b71432eb9a`, 1923 bytes)
  - `.omx/artifacts/typescript-bun/CUT-003/cut-003-checker-root-20260808-128/backup-manifest.json`
    (`sha256:49549c2a824585dccd99d249302bca8e75184878b5d25e6b11a931c4b4449cb2`, 1671 bytes)
  - `.omx/artifacts/typescript-bun/CUT-003/cut-003-checker-root-20260808-128/source-identities.json`
    (`sha256:f6580a896fd20452481c5ad6559fa5696c6a168db509186aee02e9e08776f645`, 866 bytes)
  - `.omx/artifacts/typescript-bun/CUT-003/cut-003-checker-root-20260808-128/verification.json`
    (`sha256:4a861cc3696aa197b96c57a73dbcb0bad057af1b513f5c524e2527ff8ccc88a9`, 1822 bytes)
  - four synthetic SQLite source/backup/migrated/rollback files under the same
    evidence root, with exact hashes and sizes in `backup-manifest.json`
- Accepted assertions:
  - Python application `0.1.0` owns an active-WAL legacy source at Alembic head
    `0006_viewer_lifecycle`; the closed source remains unchanged
  - SQLite Online Backup API produces a `quick_check=ok`, sidecar-free,
    hash-bound artifact before copy-and-swap migration
  - Bun `1.3.14` reaches migration version `6`, applies only
    `0006_durable_outbox`, and preserves 20 legacy tables
  - the supervised Bun backend completes a recorded text-to-barrage scenario,
    emits a recorded Provider trace, exits with code `0`, and releases its port
  - a new restore created after Bun stops starts the real Python oracle; health
    and authenticated control return `200`, legacy rows remain, Python exits
    with code `0`, and its port is released
  - the restored copy contains neither `advx_schema_migrations` nor
    `durable_outbox`
- Limitations: Windows x64 synthetic fixture only. Restore-from-backup and
  restart is the supported rollback. In-place Python rollback and retention of
  Bun-only migration/outbox or post-backup state are not claimed.
- Related run log: `cut-003-checker-root-20260808-128`

### CUT-002 / cut-002-checker-root-20260808-126

- Claim: the Bun-default Electron runtime completes the bounded Windows x64
  recorded soak with deterministic Provider/data checks and clean process
  lifecycle behavior.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity: eight-file aggregate
  `12c626665a1fa7e38a158c7a0cfd9620e4c8891cf3228f2e2915e3c14f33dc3a`
- Date: `2026-08-08`
- Environment: Windows x64; Bun `1.3.14`; Electron-embedded Node `24.18.0`;
  pnpm host warning Node `22.23.1`
- Evidence class: unit, integration, synthetic, recorded, review
- Maker run/context ID: `cut-002-maker-root-20260808-125` /
  `cut-002-maker-root-context-20260808-125`
- Checker run/context ID: `cut-002-checker-root-20260808-126` /
  `cut-002-checker-root-context-20260808-126`
- Checker parent run ID: `cut-002-maker-root-20260808-125`
- Checker participated in implementation: `false`
- Reviewed source-state hash: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Commands/procedure:
  - `pnpm typecheck:cut-002` -> exit `0`
  - focused real Bun child supervisor Vitest -> exit `0`; 1 passed, 17 skipped
  - `pnpm check:cut-002` -> exit `0`; four cycles and three targeted backend
    tests passed
  - source identity, scoped diff, live plan, and JSONL ledger checks -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/CUT-002/cut-002-checker-root-20260808-126/result.json`
    (`sha256:8e6d2fc5fa6b736428c9cc917ed730685e30bc328931c98d5bef27b3e5417566`, 4505 bytes)
  - `.omx/artifacts/typescript-bun/CUT-002/cut-002-checker-root-20260808-126/runtime-diagnostics.json`
    (`sha256:cb54d7c6a3e10d0560b740a1e8f239ac687cc569e3ec858dd62fda8389ed4033`, 26607 bytes)
  - `.omx/artifacts/typescript-bun/CUT-002/cut-002-checker-root-20260808-126/diagnostics-bundle/manifest.json`
    (`sha256:1df2e7f4a95bc1d57e34456ca840674f10cff7cc6d60f7ae767d65e166ac9ecd`, 1626 bytes)
  - `.omx/artifacts/typescript-bun/CUT-002/cut-002-checker-root-20260808-126/source-identities.json`
    (`sha256:f84f959bf4cef758c4edeacc19921fbf4b7de98150601614e5eea9c9d237bdf2`, 1613 bytes)
  - `.omx/artifacts/typescript-bun/CUT-002/cut-002-checker-root-20260808-126/verification.json`
    (`sha256:1304e3dc6d18ca6084b0ac681a5c5b7faf26e36c9cca1e33388ede1aae39faff`, 2158 bytes)
- Accepted assertions:
  - three clean Session cycles and one in-flight Electron quit cover the stated
    text/frame/microphone/system-audio combinations
  - two barrage waves, one silence wave, and zero stale output are observed
  - explicit backend restart changes PID and reconnects WebSocket state
  - Provider timeout/rate-limit/recovery and migrated SQLite write/rollback/
    retention behavior pass focused tests
  - three resource samples remain below threshold; SQLite `quick_check=ok` and
    the WAL is empty
  - five redacted diagnostics artifacts contain zero fatal/unhandled events or
    fixture-secret leaks; the backend port is released and no orphan remains
  - Bun restart and disposal use graceful IPC shutdown; the focused real-child
    test records exit code `0` without `backend.stop.forced`
- Limitations: Windows x64 recorded fixtures only; no credentialed-live,
  long-haul, macOS, durable runtime Session-persistence, or runtime-compaction
  claim.
- Related run log: `cut-002-checker-root-20260808-126`

### CUT-001 / cut-001-checker-root-20260808-124

- Claim: Bun is the development and supported packaged default while
  `python-oracle` remains an explicit local-only rollback.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity: 14-file aggregate
  `0469c0f7a9a5a449d54ea55e9e969da10564eae0a636ec42e19d4a15828b72a7`
- Date: `2026-08-08`
- Environment: Windows x64; Bun `1.3.14`; Node host warning `22.23.1`
- Evidence class: static, unit, integration, review
- Maker run/context ID: `cut-001-maker-root-20260808-123` /
  `cut-001-maker-root-context-20260808-123`
- Checker run/context ID: `cut-001-checker-root-20260808-124` /
  `cut-001-checker-root-context-20260808-124`
- Checker parent run ID: `cut-001-maker-root-20260808-123`
- Checker participated in implementation: `false`
- Reviewed source-state hash: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Commands/procedure:
  - desktop strict TypeScript and production build -> exit `0`
  - three focused desktop test files -> exit `0`; 26 tests passed
  - `pnpm check:cut-001` -> exit `0`
  - final strict TypeScript, script syntax, diff, live plan, source identity, and
    ledger checks -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/CUT-001/cut-001-checker-root-20260808-124/result.json`
    (`sha256:ac0e0d69ca7f8e554db91d368f8be27d2203b54f43dd48893c54fb75053e7a5c`, 1389 bytes)
  - `.omx/artifacts/typescript-bun/CUT-001/cut-001-checker-root-20260808-124/source-identities.json`
    (`sha256:667d4913d55e5901429b3d14830e4fa0b86b27eebb9deb45aa5cbf5e684b26a0`, 2753 bytes)
  - `.omx/artifacts/typescript-bun/CUT-001/cut-001-checker-root-20260808-124/verification.json`
    (`sha256:18c78082772d6fe2222ee8c69f8d941210a42db8f11db5ec161e267eb333f18c`, 985 bytes)
- Accepted assertions:
  - development defaults to supervised `bun-source`; packaged selection is
    always `bun-compiled`; Python selection is local-only and absent from UI
  - Bun readiness authenticates and validates backend/protocol/schema versions
  - compiled Bun and Python rollback smokes use separate synthetic copies,
    stop cleanly, release both ports, and preserve their seed markers
  - explicit compiled-Bun failure leaves the Python rollback copy unchanged
- Limitations: Windows x64 only; no soak or representative legacy restore is
  claimed by CUT-001; those remain CUT-002/CUT-003.
- Related run log: `cut-001-checker-root-20260808-124`

### FND-001 / fnd-001-checker-20260729-002

- Claim: The live backend, script, test, protocol, database, packaging, and
  Python-entry-point baseline is complete and bound to the received source
  state.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity:
  `tracked-binary-sha256:324d38631cb3e97a08ec1fd1a9b76deb982db4bd3df9b8cbbd15a94a974d5e67`;
  full reviewed source state is recorded in `received-source-state.json`.
- Date: 2026-07-29
- Environment: local Windows x64 development worktree
- Evidence class: `static`, `unit`, `review`
- Maker: baseline inventory and route-catalog repair
- Maker run/context ID:
  `fnd-001-maker-20260729-002` /
  `fnd-001-maker-context-20260729-002`
- Checker: independent baseline verifier
- Checker run/context ID:
  `fnd-001-checker-20260729-002` /
  `fnd-001-checker-context-20260729-002`
- Checker parent run ID: `fnd-001-maker-20260729-002`
- Checker participated in implementation: `false`
- Reviewed source-state hash:
  `af5acb31bc908aee11619c71bbe0de4ccc604852e81f6620758fb6394c399876`
- Commands/procedure:
  - `python .../verify-independent.py` -> exit `0`
  - `pnpm typecheck` -> exit `2` (accepted pre-existing baseline fact:
    `AudienceMode` is not exported from `shared/contracts`)
  - `pnpm test` -> exit `0` (Node `4/4`, Vitest `9/9`, pytest `45/45`)
  - `pnpm build` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/FND-001/fnd-001-checker-20260729-002/static-validation.json`
    (`sha256:91840e973f7107404907b620b818d4fed836a8d0f539fff4addf548b9e83551c`,
    `22862` bytes)
  - `.omx/artifacts/typescript-bun/FND-001/fnd-001-checker-20260729-002/route-comparison.json`
    (`sha256:77646b7397ea3e2021b1258394a483ff94018161235178e1d4a6ae5ed2782207`,
    `34034` bytes)
  - `.omx/artifacts/typescript-bun/FND-001/fnd-001-checker-20260729-002/validation-summary.json`
    (`sha256:9dc60dc6b97ab2a533997984957335ef2c07fb11c6fdb6f9db637da4c37d5bb2`,
    `3526` bytes)
  - `.omx/artifacts/typescript-bun/FND-001/fnd-001-checker-20260729-002/received-source-state.json`
    (`sha256:1e930275e687a86de54f909176b7301c0e21de58b14d5afdcb78b3331cd56acd`,
    `5401` bytes)
- Accepted assertions:
  - All Maker attempt 2 JSON parses and its 24-file manifest matches exact
    byte counts and SHA-256 hashes.
  - Independent AST parsing of all 164 tracked Python files finds 47 HTTP
    routes, including 29 multiline decorators and one empty route string;
    recorded=47, missing=0, extra=0, duplicates=0.
  - All tracked counts, generated files, Python classifications, root scripts,
    Python entry points, WS and required catalogs, 33 representative hashes,
    environment versions, provenance, branch, HEAD, and source fingerprints
    match.
  - Prior failure evidence remains intact and Maker attempt 2 changed only its
    allowed evidence and FND-001 control-ledger scope.
- Limitations:
  - Static AST discovery proves declared decorators, not dynamic runtime
    registration.
  - The typecheck failure is accepted only as an accurately reproduced baseline
    fact; it is not a successful typecheck claim and was not fixed by FND-001.
  - Current-state and received/sealed fingerprints cannot prove a file was
    never edited and restored.
  - No credentialed Provider, installed-platform, or production evidence was
    required or produced.
- Related run log:
  - `fnd-001-checker-20260729-002`

### FND-002 / fnd-002-checker-20260730-005

- Claim: The numbered behavioral invariant register and its machine-readable
  mirror preserve authoritative product semantics without framework reduction,
  and explicitly retain every current non-parity and missing-proof boundary.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity:
  `register-sha256:b0ccdb832ada3b0f9260845deab3b136c3a55f79ade00febeca3dbe1070c4f1d`;
  `machine-register-sha256:c9f52a23230f915eab9205f2a960c6ad1760c20da32159dcc221dc9746af1310`;
  `maker-source-state-sha256:5adaae9b9a38fbd0c83ac9740b168780f58f027d0859dbbfd19ecf9b7146eee9`.
- Date: 2026-07-30
- Environment: local Windows x64 development worktree
- Evidence class: `static`, `review`
- Maker: H3 invariant-register repair
- Maker run/context ID:
  `fnd-002-maker-20260730-004` /
  `fnd-002-maker-context-20260730-004`
- Checker: fresh independent Checker/verifier
- Checker run/context ID:
  `fnd-002-checker-20260730-005` /
  `fnd-002-checker-context-20260730-005`
- Checker parent run ID: `fnd-002-maker-20260730-004`
- Checker participated in implementation: `false`
- Reviewed source-state hash:
  `c8459a67aaaf5cc6422ff0ea980ce7d921bd79bdeccbd866dd9dcc14e9436a67`
- Commands/procedure:
  - `node .omx/artifacts/typescript-bun/FND-002/fnd-002-checker-20260730-005/verify-independent.mjs`
    -> exit `0`
  - `git diff --check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/FND-002/fnd-002-checker-20260730-005/independent-structural-audit.json`
    (`sha256:310245993fd9abc895e2c4d3036e1f1bd541090bed28dee064b8001dd89a3878`,
    `90104` bytes)
  - `.omx/artifacts/typescript-bun/FND-002/fnd-002-checker-20260730-005/semantic-audit.json`
    (`sha256:964095bbca21900ed2f8550016244b00f5972083722cb1d0cc0c004b702131fc`,
    `15624` bytes)
  - `.omx/artifacts/typescript-bun/FND-002/fnd-002-checker-20260730-005/received-source-state.json`
    (`sha256:c8459a67aaaf5cc6422ff0ea980ce7d921bd79bdeccbd866dd9dcc14e9436a67`,
    `1749` bytes)
  - `.omx/artifacts/typescript-bun/FND-002/fnd-002-checker-20260730-005/git-diff-check.json`
    (`sha256:f4076cc51cd3a5ae0dce5fabf913617d0911ce8524d507bc654256d55b3a8097`,
    `293` bytes)
- Accepted assertions:
  - Exact Markdown/JSON mirrors pass for 31 invariants, 18 gaps, and five
    evidence classes; all 21 required families match their canonical order.
  - All 186 referenced paths resolve, all 212 cited line ranges are within EOF,
    all 25 owner IDs exist, and all 43 authority/oracle hashes match.
  - All 14 Maker manifest entries match exact byte counts and SHA-256 hashes
    before Checker ledger edits.
  - H1 and H2 repairs remain intact. H3 preserves the six-second conditional
    protocol repair, two-request cap, no Viewer substitution, exact candidate
    budgets, deterministic direct-Persona selection, standalone system-audio
    segmentation, and current canonical artifact pointers.
  - `GAP-ASR-001` still requires integrated proof and remains
    `MISSING_PROOF` / `NON_PASSING`; all other recorded contradictions remain
    explicit and non-passing.
- Limitations:
  - This task freezes behavior and proof boundaries; it does not implement the
    missing parity behavior or satisfy any gap.
  - No broad `pnpm` test, typecheck, or build was required or run.
  - No credentialed Provider, installed-platform, packaged-release, production,
    deployment, commit, or push evidence was produced.
- Related run log:
  - `fnd-002-checker-20260730-005`

### FND-003 / fnd-003-checker-20260730-001

- Claim: Bun, host Node, Electron, the frozen desktop build stack, runtime
  ownership, lifecycle trust, text lockfile, platform/CPU boundaries, and
  migration ordering are locked without changing product or tooling state.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty source identity:
  `received-source-state-sha256:c87fa0e6638c4c9a794105fd5db906c355a3345302d0fcf159c4e5b67725d5a4`;
  `package-head/worktree-blob:3cca2f9ffd5d575b94fbaacfce6f10a341bb1524`;
  `pnpm-lock-head/worktree-blob:ca3ab2c5d7f5b63c38d0dcdbec42021f4ef6211f`.
- Date: 2026-07-30
- Environment: local Windows x64 development worktree
- Evidence class: `static`, `local runtime`, `review`
- Maker: runtime compatibility policy and machine-readable matrix
- Maker run/context ID:
  `fnd-003-maker-20260730-001` /
  `fnd-003-maker-context-20260730-001`
- Checker: fresh independent Checker/verifier
- Checker run/context ID:
  `fnd-003-checker-20260730-001` /
  `fnd-003-checker-context-20260730-001`
- Checker parent run ID: `fnd-003-maker-20260730-001`
- Checker participated in implementation: `false`
- Reviewed source-state hash:
  `c87fa0e6638c4c9a794105fd5db906c355a3345302d0fcf159c4e5b67725d5a4`
- Commands/procedure:
  - `node .omx/artifacts/typescript-bun/FND-003/fnd-003-checker-20260730-001/verify-independent.mjs`
    -> exit `0`
  - checker-local Electron embedded-version probe -> exit `0`
  - normalized Git blob comparisons for `package.json` and `pnpm-lock.yaml`
    -> equal to `HEAD`
  - fresh official/upstream source retrieval and fact checks -> `33/33`
  - `git diff --check` -> exit `0` with pre-existing line-ending warnings only
- Artifacts:
  - `.omx/artifacts/typescript-bun/FND-003/fnd-003-checker-20260730-001/independent-verification.json`
    (`sha256:10f99a4f6e008207a615cf9f2f66ce56d30be758d977054c63f7687a07a7c810`,
    `28690` bytes)
  - `.omx/artifacts/typescript-bun/FND-003/fnd-003-checker-20260730-001/received-source-state.json`
    (`sha256:951fb2a36f0c794413699e286f3e0a61cb5f566a9566964764b622066f08ba74`,
    `3406` bytes)
  - `.omx/artifacts/typescript-bun/FND-003/fnd-003-checker-20260730-001/official-source-verification.json`
    (`sha256:525f95891131330bf68305e6e61fed9fa40a967410ced419695e357ac7dbd6c4`,
    `20756` bytes)
  - `.omx/artifacts/typescript-bun/FND-003/fnd-003-checker-20260730-001/electron-probe.json`
    (`sha256:347affe0ebb9cf86aa9c35a355b8ee8cd80bce1ccc512a53896a58a62a452c3e`,
    `1196` bytes)
- Accepted assertions:
  - Exact policy pins are Bun `1.3.14`, target host Node `24.18.0`, Electron
    `43.2.0`, electron-vite `4.0.1`, Vite `7.3.6`, TypeScript `5.9.3`,
    `@types/node` `24.13.3`, and electron-builder `26.15.3`.
  - Current host Node `22.23.1` is a mismatch and downstream execution
    precondition, not accepted evidence for target Node `24.18.0`.
  - Fresh Electron evidence proves embedded Node `24.18.0`, Chromium
    `150.0.7871.129`, and V8 `15.0.1240245-electron.0`; it does not prove or
    claim Node removal from Electron.
  - Lifecycle execution is default deny. Only `esbuild` and
    `electron-winstaller` are initial candidates, not an accepted allowlist.
  - `bun.lock` creation remains owned by `FND-010`; only text `bun.lock` is
    allowed, `bun.lockb` is forbidden, and neither exists now.
  - The TypeScript and Vite/electron-vite sequences preserve the Python oracle,
    defer runtime/default/tooling cutover to assigned gates, and keep Electron
    upgrades separate from host Node changes.
  - Windows x64 is the only local evidence class. macOS and other CPU/OS
    combinations remain pending or decision-gated; upstream artifact
    availability is not ADVX support proof.
  - All 13 Maker manifest entries match exact byte counts and SHA-256 hashes.
  - `package.json` and `pnpm-lock.yaml` have no content change; the former is
    dirty only at the worktree stat/line-ending layer.
- Limitations:
  - This task locks compatibility policy; it does not install, upgrade,
    compile, package, switch a runtime, create a lockfile, or migrate product
    code.
  - Python remains present and active as the parity oracle.
  - No broad `pnpm` test, typecheck, or build was required or run.
  - No clean advisory, SBOM, macOS, installed-platform, credentialed Provider,
    production, deployment, commit, push, or release evidence was produced.
- Related run log:
  - `fnd-003-checker-20260730-001`

### FND-004 / fnd-004-checker-20260730-002

- Claim: Bun `1.3.14` can produce disposable Windows x64 standard and baseline
  backend executables with explicit runtime-config isolation, injected writable
  paths, embedded assets, bounded parent/console lifecycle, truthful
  forced-termination codes, profiles, and no orphan process.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty source identity:
  `received-source-state-sha256:656a8a97eee160030f3f2726abfb16bd9ed6f668d9feaa9ea32feb7eaa7e5b46`;
  `package-head/worktree-blob:3cca2f9ffd5d575b94fbaacfce6f10a341bb1524`;
  `pnpm-lock-head/worktree-blob:ca3ab2c5d7f5b63c38d0dcdbec42021f4ef6211f`.
- Date: 2026-07-30
- Environment: local Windows x64 AVX2-capable development host
- Evidence class: `local runtime`, `static`, `review`
- Maker: corrected disposable executable lifecycle spike
- Maker run/context ID:
  `fnd-004-maker-20260730-002` /
  `fnd-004-maker-context-20260730-002`
- Checker: fresh independent Checker/verifier
- Checker run/context ID:
  `fnd-004-checker-20260730-002` /
  `fnd-004-checker-context-20260730-002`
- Checker parent run ID: `fnd-004-maker-20260730-002`
- Checker participated in implementation: `false`
- Commands/procedure:
  - Maker frozen validator `bun validate.ts --check` -> `213/213`, exit `0`
  - exact standard and baseline rebuilds with all four
    `--no-compile-autoload-*` controls -> bit-identical
  - checker-owned parent, forced-signal, real Windows Ctrl+C, hostile-cwd,
    profile, process-tree, and source-preservation runs
  - `bun validate-independent.ts` -> `151/151`, exit `0`
  - fresh official/tagged Bun and Microsoft fact retrieval -> `6/6` sources
  - `git diff --check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/FND-004/fnd-004-checker-20260730-002/reports/independent-verification.json`
    (`sha256:701443c654d10d1e2cce0ac1bf024be5c2a38e3d27f224cc2b0249ddb9f973d7`,
    `67259` bytes)
  - `.omx/artifacts/typescript-bun/FND-004/fnd-004-checker-20260730-002/reports/official-source-verification.json`
    (`sha256:9c795fcaceb4ae9b59ae223dde6eab4aa329192fd5f06eaf832ed92b05027df0`,
    `4814` bytes)
  - `.omx/artifacts/typescript-bun/FND-004/fnd-004-checker-20260730-002/reports/spike-report.json`
    (`sha256:dd607424e4e3ac0e5144ba268537dd653d9a9f0e32a7efdfd85b72df9bb92e53`,
    `44264` bytes)
  - `.omx/artifacts/typescript-bun/FND-004/fnd-004-checker-20260730-002/checker-report.md`
    (`sha256:9100291f988e544c7bf8aa8ff601fd8037ee2ff5d4d8e8bf5c6ea6203193015c`,
    `3433` bytes)
  - standard executable
    (`sha256:a60bebc1bceb1ca17d2649de4b0be7418da5659a39044f01a58a3fa42f068542`,
    `98480216` bytes)
  - baseline executable
    (`sha256:26ee10aa1bc27d13546899aebca84d626657c765206d4091e935e8400fc8bd3a`,
    `97757272` bytes)
- Accepted assertions:
  - All 49 recovery Maker manifest entries match exact byte counts and SHA-256
    hashes; the frozen validator covers and passes `213/213`.
  - Exact frozen-source-path rebuilds are bit-identical to both Maker binaries.
    Checker-owned copied-source-path rebuilds preserve size but differ in hash
    because Bun embeds source provenance paths.
  - Standard and baseline authenticated parent shutdown and real
    `GenerateConsoleCtrlEvent(CTRL_C_EVENT)` are application-handled exit-`0`
    paths, bounded with no orphan.
  - Bun-parent `child.kill('SIGINT')` and `child.kill('SIGTERM')` are
    forced-termination observations with truthful exit `130` and `143` for both
    targets. They are not application signal-handler proof; no graceful
    `SIGTERM` or `SIGBREAK` behavior is accepted.
  - Both PE x64 executables pass assigned loopback-only listener,
    health/readiness, injected `bun:sqlite`, embedded asset, one structured
    JSONL log, hostile autoload poison isolation, empty child `PATH`, parent
    `BUN_BE_BUN=1` sanitization, one-process live tree, no beside-executable
    write, and empty after-exit tree checks.
  - Nonempty CPU and heap profiles record executable, target, `BUN_OPTIONS`,
    workload, hashes, and limitations.
  - Package and pnpm lock normalized blobs equal `HEAD`; no `bun.lock` or
    `bun.lockb`; product/tooling/Python/FND-005 implementation and unrelated
    `docs/README.md`, `output/`, and `promo/` content are preserved.
- Limitations:
  - Evidence is local Windows x64 on one AVX2-capable Ryzen 9 7845HX host.
    Baseline execution here is not older SSE4.2-only hardware proof.
  - No macOS, Windows arm64, signing, installer, product-load, leak,
    performance-budget, credentialed Provider, production, deployment, commit,
    push, or release evidence was produced.
  - No broad `pnpm` test, typecheck, or build was required or run.
- Related run log:
  - `fnd-004-checker-20260730-002`

### FND-005 / fnd-005-checker-20260730-002

- Claim: Bun `1.3.14` with Elysia can implement the disposable current-v3
  ADVX HTTP/WebSocket protocol spike with strict schemas, canonical binary
  fixtures, bounded abort/backpressure behavior, development-only API docs,
  and graceful authenticated stop.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Date: 2026-07-30
- Environment: local Windows x64, Bun `1.3.14`
- Evidence class: `unit`, `integration`, `synthetic`, `static`, `review`
- Maker run/context ID:
  `fnd-005-maker-20260730-002` /
  `fnd-005-maker-context-20260730-002`
- Checker run/context ID:
  `fnd-005-checker-20260730-002` /
  `fnd-005-checker-context-20260730-002`
- Checker parent run ID: `fnd-005-maker-20260730-002`
- Checker participated in implementation: `false`
- Commands/procedure:
  - recovery Maker manifest pre/post verification -> `71/71`
  - focused Python realtime/protocol baseline -> `16/16`
  - live Python startup token/version ordering -> `2/2`
  - Python fixture generation -> `2/2`
  - authoritative v3 codec/schema oracle -> `9/9`
  - Checker-owned Elysia runtime assertions -> `40/40`
  - frozen install, app typecheck, exact dependency provenance -> pass,
    pass, `3/3`
  - source/preservation checks, `git diff --check`, process sweep -> pass
- Artifacts:
  - `.omx/artifacts/typescript-bun/FND-005/fnd-005-checker-20260730-002/reports/independent-check.json`
  - `.omx/artifacts/typescript-bun/FND-005/fnd-005-checker-20260730-002/reports/oracle-parity.json`
  - `.omx/artifacts/typescript-bun/FND-005/fnd-005-checker-20260730-002/reports/python-authority-probe.json`
  - `.omx/artifacts/typescript-bun/FND-005/fnd-005-checker-20260730-002/reports/dependency-provenance.json`
  - `.omx/artifacts/typescript-bun/FND-005/fnd-005-checker-20260730-002/reports/source-state-final.json`
- Accepted assertions:
  - Recovery Maker manifest SHA-256 is
    `c4732ab0b0d3f6eb9b167e0d5ac6913516793c6f1de67d937e7365995904ff8d`
    and all 71 entries matched before and after verification.
  - Binary v3 uses the exact 9-byte `>4sBI` outer header. Audio and frame
    fixtures regenerate from the authoritative Python encoder, match SHA-256
    `ba2e033da08924325d69a52d7c88478d0012ca79c744b5130bb6d6ff6c74e34d`
    and
    `a88ec7426b2cc2d7f7068164e965a019599b9f3c465e09e8c3d436764038573c`,
    and decode/re-encode and echo byte-for-byte.
  - Current startup negotiation checks version support before token validity.
    Wrong version emits the exact current `version_mismatch` payload and
    closes `4406`; strict JSON and invalid binary combinations reject.
  - Schema-valid/invalid HTTP, authenticated WS connect/hello/ping/close,
    maximum payload recovery, distinct bounded abort causes, development-only
    OpenAPI/Scalar, and loopback binding passed.
  - Outbound admission accepted `3` and rejected `997` requested messages
    under `49,152` bytes; Bun's `65,536`-byte close-on-limit hard bound was
    configured. Native localhost backpressure signals remained `0`.
  - The child used the Elysia Bun adapter, had no Node child or
    `@elysiajs/node`/`node:http` server path, and authenticated stop exited `0`
    in `51.6 ms` with no orphan.
  - Elysia `1.4.29`, `@elysiajs/openapi` `1.4.15`, and
    `@elysiajs/eden` `1.4.9` match exact MIT registry/source provenance.
    Eden Treaty is technically viable but unadopted; `CON-008` remains open.
  - Root normalized `package.json` and `pnpm-lock.yaml` blobs equal `HEAD`;
    no root `bun.lock*` or `FND-006` artifact exists; product/Python authority
    files and unrelated `docs/README.md`, `output/`, and `promo/` are
    preserved.
- Limitations:
  - Native localhost `drain` was not observed; only bounded application
    admission plus Bun's configured hard limit is accepted.
  - The spike implements and claims current v3 only. No v1/v2 parity,
    Electron, packaging, macOS, signing, deployment, Provider,
    credentialed-live, or production-load evidence is accepted.
- Related run log:
  - `fnd-005-checker-20260730-002`

### FND-006 / fnd-006-checker-20260730-001

- Claim: Bun `1.3.14` `bun:sqlite`, stable Drizzle, WAL, explicit migrations,
  transaction/crash recovery, injected data paths, local Drizzle Studio, and
  backup/restore have an independently supported candidate-spike conclusion.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Date: 2026-07-30
- Environment: local Windows x64, Bun `1.3.14`, SQLite `3.53.0`
- Evidence class: `integration`, `synthetic`, `static`, `review`
- Maker run/context ID:
  `fnd-006-maker-20260730-001` /
  `fnd-006-maker-context-20260730-001`
- Checker run/context ID:
  `fnd-006-checker-20260730-001` /
  `fnd-006-checker-context-20260730-001`
- Checker parent run ID: `fnd-006-maker-20260730-001`
- Checker participated in implementation: `false`
- Reviewed source state:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`,
  dirty tree preserved.
- Commands/procedure:
  - Maker manifest pre/post verification -> `33/33`
  - live Python Alembic/schema authority -> `10/10`
  - Checker-owned Bun/Drizzle runtime -> `18/18`
  - frozen install and typecheck -> pass
  - exact registry/tag/source provenance -> `5/5`
  - local Drizzle Studio bounded smoke -> supported local UI path reached
  - comprehensive Checker validation -> `23/23`
  - source preservation, `git diff --check`, and process sweep -> pass
- Artifacts:
  - `.omx/artifacts/typescript-bun/FND-006/fnd-006-checker-20260730-001/results/authority.json`
  - `.omx/artifacts/typescript-bun/FND-006/fnd-006-checker-20260730-001/results/runtime.json`
  - `.omx/artifacts/typescript-bun/FND-006/fnd-006-checker-20260730-001/results/studio.json`
  - `.omx/artifacts/typescript-bun/FND-006/fnd-006-checker-20260730-001/results/backup.json`
  - `.omx/artifacts/typescript-bun/FND-006/fnd-006-checker-20260730-001/results/provenance.json`
  - `.omx/artifacts/typescript-bun/FND-006/fnd-006-checker-20260730-001/results/validation-summary.json`
- Accepted assertions:
  - Maker manifest SHA-256 is
    `c38181070470009280b377b4c1ee78b81cbbbf9789d71a81d3c5e08094aec6d2`;
    all `33/33` entries matched before and after verification.
  - The live Python oracle produced a fresh synthetic database at Alembic head
    `0006_viewer_lifecycle`; required pragmas, representative schema/data,
    integrity, foreign keys, and WAL-active online backup passed.
  - `drizzle-orm` `0.45.2` applied the exact explicit candidate migration once,
    preserved Alembic identity/data, reported `user_version=7006`, and reopened
    without duplicate ledger application.
  - Nested savepoint success, inner rollback with outer continuation, complete
    outer rollback, durable new-process reopen, and abrupt crash recovery
    preserved committed rows while excluding uncommitted rows and orphans.
  - `drizzle-kit` `0.31.10` with `@libsql/client` `0.17.4` bound only
    `127.0.0.1:49837`, printed its supported local Studio URL, and was stopped
    boundedly with no child process.
  - Injected database files remained outside the synthetic
    `resources/app.asar` tree and no database/WAL/SHM files were written beside
    resources. This is packaging simulation only.
  - Backup/restore verdict is **`NO_GO_BUN_API`**. Bun `1.3.14` runtime
    prototype, pinned official types/docs, and Drizzle expose no true SQLite
    Online Backup API. `Database.serialize`, `VACUUM INTO`, filesystem
    DB/WAL/SHM copy, and a Python helper are not substitutes for a Bun API.
  - Python `sqlite3.Connection.backup` was independently exercised while the
    synthetic source was open and WAL-active; the restore preserved schema
    versions, representative rows, integrity, and foreign keys.
- Limitations:
  - The Python fallback proves only the current migration boundary. It does not
    approve a final Python-free backup architecture.
  - Windows retained a zero-byte WAL and a 32768-byte SHM after clean close in
    the observed run; checkpoint reported no busy or pending frames.
  - Studio is a beta development-only inspector. The path proof is synthetic
    packaging simulation, not Electron/installer proof.
  - No global dependency adoption, real user database, macOS, signing,
    deployment, production-load, or release claim is accepted.
  - `FND-009`, `DAT-002`, and `ADR-MIG-001` retain decision ownership.
- Related run log:
  - `fnd-006-checker-20260730-001`

### FND-007 / fnd-007-checker-20260730-002

- Claim: AI SDK Core with an OpenAI-compatible adapter and an ADVX-owned
  `p-queue`/`AbortController` boundary can preserve explicit retry ownership,
  the two-request physical budget, structured/streaming behavior, cancellation,
  deadlines, finite priority, bounded admission, and final publication fences
  in a disposable Bun spike.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Date: 2026-07-30
- Environment: local Windows x64, Bun `1.3.14`
- Evidence class: `deterministic_fake`, `recorded_provider`, `static`, `review`
- Maker run/context ID:
  `fnd-007-maker-20260730-002` /
  `fnd-007-maker-context-20260730-002`
- Checker run/context ID:
  `fnd-007-checker-20260730-002` /
  `fnd-007-checker-context-20260730-002`
- Checker parent run ID: `fnd-007-maker-20260730-002`
- Checker participated in implementation: `false`
- Reviewed source state:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  recovery Maker manifest SHA-256
  `6963651d166bafbebd93150700ad99f0d0e7945eb266ebd901ef4e63ef5946e7`;
  Checker-owned copied source SHA-256
  `0bdbe43d3d72db6029eb801f4406c0058f3325f8c488c4d8272099d392c72d2c`.
- Commands/procedure:
  - recovery Maker manifest pre/post verification -> `53/53`
  - prior Maker and rejected Checker manifests -> `29/29`, `38/38`
  - Checker-owned frozen install and TypeScript typechecks -> pass
  - copied candidate Bun tests -> `10/10`, `108` assertions
  - Checker hostile scheduler tests -> `4/4`, `60` assertions
  - focused Python parity oracle -> `9/9`
  - normalized deterministic replay -> identical SHA-256
    `35fa289311c4ef70fb65594f0cbd33b4567b9f15a78af004e4d92e637ab0bc43`
  - official registry/tag, installed license, privacy, source preservation,
    and process checks -> `26/26` accepted checks
- Artifacts:
  - `.omx/artifacts/typescript-bun/FND-007/fnd-007-checker-20260730-002/reports/verdict.json`
  - `.omx/artifacts/typescript-bun/FND-007/fnd-007-checker-20260730-002/reports/provider-verification.json`
  - `.omx/artifacts/typescript-bun/FND-007/fnd-007-checker-20260730-002/reports/scheduler-verification.json`
  - `.omx/artifacts/typescript-bun/FND-007/fnd-007-checker-20260730-002/reports/hostile-scheduler-matrix.json`
  - `.omx/artifacts/typescript-bun/FND-007/fnd-007-checker-20260730-002/reports/package-verification.json`
  - `.omx/artifacts/typescript-bun/FND-007/fnd-007-checker-20260730-002/reports/privacy-evidence-audit.json`
  - `.omx/artifacts/typescript-bun/FND-007/fnd-007-checker-20260730-002/reports/source-state-pre-verdict.json`
  - `.omx/artifacts/typescript-bun/FND-007/fnd-007-checker-20260730-002/manifest.sha256`
- Accepted assertions:
  - The recovery Maker manifest matches `53/53` before and after independent
    verification. The prior Maker and rejected Checker manifests remain
    intact at `29/29` and `38/38`.
  - Capacity `2` holds exactly one active plus one p-queue queued item while
    five staggered excess submissions all reject with
    `scheduler_capacity_exceeded`; maximum admission is `2`, closeout is `0`,
    and admission reopens after settlement.
  - Success, pre-drain abort/expiry, p-queue queued abort, in-flight abort, run
    throw, fence zero effect, and publish throw each return admission to zero
    and permit reuse. An abort/completion race does not double-release.
    `idle()` stays pending across active work, p-queue backlog, and interval
    delay, then returns boundedly after settlement.
  - The copied Provider replay passes text, file-image input, non-stream JSON,
    SSE stream, JSON Schema structured silence, malformed repair, usage, and
    401/404/408/429/503 normalization with no deprecated image or unsupported
    response-format warning.
  - All `5/5` AI SDK call paths set `maxRetries: 0`. Six logical budget cases
    use `1,2,2,2,2,1` physical requests; none exceeds two or extends beyond the
    outer deadline.
  - Transport closeout records `21` requests, `11` JSON-Schema requests,
    `2` disconnects, `1` stream cancellation, `0` active requests, and `0`
    post-abort side effects.
  - Per-kind/per-Viewer concurrency, queued/in-flight cancellation, queued
    expiry, interval/deadline behavior, finite priority, deterministic
    clock/seed, and session/epoch/Viewer/sequence/deadline/cancel final fences
    pass without a p-queue deep import or internal patch.
  - Exact stable package pins, npm registry integrity, published upstream tags,
    and installed license files match. This is candidate evidence only;
    `FND-009` retains adoption ownership.
  - Privacy scan hits are `0`; stored ADVX records retain no AI SDK types, wire
    payloads, raw prompts/images, credentials, or raw Provider responses.
  - Root normalized `package.json` and `pnpm-lock.yaml` equal `HEAD`; no root
    `bun.lock*`; Python/product authority hashes, `docs/README.md`, `output/`,
    and `promo/` are preserved; no `FND-008` artifact or candidate process
    exists.
- Limitations:
  - Evidence is only `deterministic_fake`/`recorded_provider`; no credentialed
    live Provider, production network, Electron, packaged-release, deployment,
    commit, push, or release claim is accepted.
  - Native p-queue timeout begins after dequeue; queued expiry and the outer
    deadline remain ADVX-wrapper responsibilities.
  - Priority no-starvation proof is finite bounded admission only; continuous
    load fairness is not proven.
  - Scheduler/fence evidence is artifact-only and does not repair
    `GAP-FENCE-001`, `GAP-VIEW-001`, or `GAP-VIEW-002`.
- Related run log:
  - `fnd-007-checker-20260730-002`

### FND-008 / fnd-008-checker-20260730-001

- Claim: Bun can run the required local OpenTelemetry trace, W3C propagation,
  OTLP/HTTP loopback export, Pino JSONL correlation, redaction boundary, and
  safe `bun:sqlite` transaction in a disposable FND-008 spike.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Date: 2026-07-30
- Environment: local Windows x64, Bun `1.3.14`
- Evidence class: `deterministic_fake`, `integration`, `static`, `review`
- Maker run/context ID:
  `fnd-008-maker-20260730-001` /
  `fnd-008-maker-context-20260730-001`
- Checker run/context ID:
  `fnd-008-checker-20260730-001` /
  `fnd-008-checker-context-20260730-001`
- Checker parent run ID: `fnd-008-maker-20260730-001`
- Checker participated in Maker implementation: `false`
- Reviewed source state:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  dirty tree preserved.
- Commands/procedure:
  - Maker manifest before and after independent verification -> `35/35`
  - Checker-owned `bun install --frozen-lockfile` -> pass
  - Checker TypeScript typecheck -> pass
  - Checker hostile Bun suite -> `4/4`, `52` assertions
  - fresh generation plus validation -> `52/52` checks
  - focused Python `test_ai_call_store.py` oracle -> `1/1`
  - registry integrity, installed version/license, static calling-point,
    source-preservation, lifecycle, runtime-network, and process checks -> pass
  - `git diff --check` -> exit `0`; only existing LF/CRLF warnings
- Artifacts:
  - `.omx/artifacts/typescript-bun/FND-008/fnd-008-checker-20260730-001/reports/final-summary.json`
  - `.omx/artifacts/typescript-bun/FND-008/fnd-008-checker-20260730-001/reports/verdict.json`
  - `.omx/artifacts/typescript-bun/FND-008/fnd-008-checker-20260730-001/reports/topology.json`
  - `.omx/artifacts/typescript-bun/FND-008/fnd-008-checker-20260730-001/reports/otlp-captures.json`
  - `.omx/artifacts/typescript-bun/FND-008/fnd-008-checker-20260730-001/reports/sqlite.json`
  - `.omx/artifacts/typescript-bun/FND-008/fnd-008-checker-20260730-001/reports/privacy-audit.json`
  - `.omx/artifacts/typescript-bun/FND-008/fnd-008-checker-20260730-001/reports/package-verification.json`
  - `.omx/artifacts/typescript-bun/FND-008/fnd-008-checker-20260730-001/reports/source-state-pre-verdict.json`
  - `.omx/artifacts/typescript-bun/FND-008/fnd-008-checker-20260730-001/manifest.sha256`
- Accepted assertions:
  - Maker manifest SHA-256 is
    `bbb76aaec0aefbd803462cbe5db5ca75dc18fe63fa1b014381081d5f357e8b78`;
    all `35/35` entries matched before and after verification.
  - Checker manifest SHA-256 is
    `60ee94d7a94de35781bebe4f782f3a4d19f504ad8b9909146293b8d2a1afdc33`;
    all `64/64` entries match.
  - Two distinct fresh trace IDs,
    `16c882106478ae4956c1f20910fe1663` and
    `2f4aa2d70478149742fa77826fef2111`, each bind exactly six real finished SDK
    spans and six parseable JSONL records.
  - W3C `traceparent` crosses a real loopback `fetch` into Elysia. The route is
    the root-span child; queue wait, deterministic Provider stage, SQLite
    transaction, and response are route children at sequences `3..6`.
  - Both normalized topologies match SHA-256
    `f91ea2aa7e5cf7388788bcc395078bbb86b3ea2b71c67724f36d0d231e07259e`.
  - The real OTLP/HTTP exporter produced two nonempty `3463`-byte requests to a
    collector bound to `127.0.0.1`. Each parses to six matching spans and
    contains no Authorization or Cookie.
  - JSONL remains authoritative. Runtime external endpoint and DNS counts are
    zero; both ports closed; no candidate Bun/Node process remained.
  - A real on-disk `bun:sqlite Database.transaction` produced two rows that
    survived reopen. Columns are limited to trace/request IDs, prompt
    hash/length, image/audio byte lengths, completion tokens, and status.
  - Checker-owned dynamic canaries cover complete prompt, image, audio, API
    key, bearer, cookie, client secret, raw Provider payload, hidden reasoning,
    private frame, private screenshot, nested forbidden keys, raw/base64/
    base64url forms, and credential digests. Across `39` runtime evidence files:
    dynamic canary, credential digest, forbidden JSON, private-path, and
    Maker-canary overlap hits are all `0`.
  - Static AST review found six allowlisted logger calls, five span wrappers,
    no span mutation/exception calls, and no request body, headers, raw Provider
    payload, wire object, or `Error` object passed to telemetry or Pino.
  - All ten exact package pins match registry integrity, installed versions,
    licenses, license files, and lock entries. Local GitHub `git ls-remote`
    transport was unavailable; official OpenTelemetry docs/upstream and the
    official Elysia, Pino, and TypeScript release pages were reviewed
    separately. Adoption is not approved here.
  - Root `package.json`/`pnpm-lock.yaml` normalized content and blob hashes equal
    `HEAD`; no root `bun.lock*`; Python/product authority hashes,
    `docs/README.md`, `output/`, and `promo/` are preserved; no FND-009
    artifact exists.
- Limitations:
  - Evidence is `deterministic_fake`; the Provider stage is a deterministic
    synthetic local fixture. `recorded_provider` is not claimed.
  - The Electron request root span is simulated inside Bun, not packaged
    Electron proof.
  - No credentialed-live Provider, remote collector, production network,
    global dependency adoption, deployment, commit, push, or future OBS-task
    claim is accepted.
  - `GAP-PRIV-001` remains `NON_PASSING`.
- Related run log:
  - `fnd-008-checker-20260730-001`

### FND-009 / fnd-009-checker-20260730-001

- Claim: the migration dependency ADR set records admissible exact pins,
  licenses, runtime/development boundaries, owners, advisory treatments,
  update groups, exit strategies, spike evidence, and overlap decisions
  without adopting the dependencies into the root workspace.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Date: 2026-07-30
- Environment: local Windows x64, Bun `1.3.14`, npm official audit service
- Evidence class: `integration`, `static`, `official-primary`, `review`
- Maker run/context ID:
  `fnd-009-maker-20260730-001` /
  `fnd-009-maker-context-20260730-001`
- Checker run/context ID:
  `fnd-009-checker-20260730-001` /
  `fnd-009-checker-context-20260730-001`
- Checker parent run ID: `fnd-009-maker-20260730-001`
- Checker participated in Maker implementation: `false`
- Reviewed source state:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  pre-verdict tracked dirty-diff SHA-256
  `324d38631cb3e97a08ec1fd1a9b76deb982db4bd3df9b8cbbd15a94a974d5e67`.
- Commands/procedure:
  - Maker manifest before independent checking -> `30/30`
  - Checker-owned runtime/dev/deferred-packager Bun and npm exact-pin installs
  - clean Bun frozen reinstall and `bun audit --json` for all three trees
  - clean npm lock/`npm ci` and `npm audit --json` for all three trees
  - exact npm registry/provenance and installed-license review
  - accepted FND-003 through FND-008 evidence cross-check -> `14/14`
  - Checker semantic validation -> `43/43`
  - hostile ADR mutations -> `10/10` rejected
  - final pre-seal boundary/privacy/source check -> `17/17`
  - `git diff --check` -> exit `0`; only existing LF/CRLF warnings
- Artifacts:
  - `.omx/artifacts/typescript-bun/FND-009/fnd-009-checker-20260730-001/reports/verdict.json`
  - `.omx/artifacts/typescript-bun/FND-009/fnd-009-checker-20260730-001/reports/security-audit-summary.json`
  - `.omx/artifacts/typescript-bun/FND-009/fnd-009-checker-20260730-001/reports/registry-inventory.json`
  - `.omx/artifacts/typescript-bun/FND-009/fnd-009-checker-20260730-001/reports/license-samples.json`
  - `.omx/artifacts/typescript-bun/FND-009/fnd-009-checker-20260730-001/reports/esbuild-boundary.json`
  - `.omx/artifacts/typescript-bun/FND-009/fnd-009-checker-20260730-001/reports/evidence-overlap-review.json`
  - `.omx/artifacts/typescript-bun/FND-009/fnd-009-checker-20260730-001/reports/hostile-mutations.json`
  - `.omx/artifacts/typescript-bun/FND-009/fnd-009-checker-20260730-001/reports/source-state.json`
  - `.omx/artifacts/typescript-bun/FND-009/fnd-009-checker-20260730-001/manifest.sha256`
- Accepted assertions:
  - Maker manifest SHA-256 is
    `5e29c2a0a1b07745018c9dd5c80fc7c3e9c77c4777bc43b386bf1d5ee2ac4988`;
    all `30/30` entries matched before and after verification.
  - Checker manifest SHA-256 is
    `27d0d85f729fdd451facbc3bf8bf078ae29f7cdd4e0e35ae36bd4ebe823a6de4`;
    all `53/53` entries match.
  - The accepted runtime-only tree has zero Bun/npm advisories. The accepted
    development tree has zero high/critical findings and four npm
    package-level moderate findings, all attributable to
    `drizzle-kit -> @esbuild-kit/esm-loader -> @esbuild-kit/core-utils ->
    esbuild@0.18.20`.
  - The affected loader imports esbuild only for `transform`,
    `transformSync`, and `version`; no esbuild `serve` API call exists. The
    generic `serve` bundled in drizzle-kit is the Hono Node adapter, not the
    vulnerable esbuild development server. `DAT-002` must nevertheless fresh
    re-audit and upgrade, replace, or remove this tree, which never enters
    production runtime.
  - The isolated deferred electron-builder `26.15.3` tree reproduces zero
    critical and sixteen npm package-level high findings for
    `GHSA-mh99-v99m-4gvg` through packaging-only minimatch/brace-expansion
    paths. The npm downgrade suggestion is not accepted as a fix;
    `PKG-004`/`PKG-009` retain ownership.
  - All `21` accepted direct npm packages match exact official registry
    version, integrity, MIT/Apache-2.0 SPDX license, engines/deprecation
    availability, repository, gitHead/signature/attestation availability.
    Eighteen installed direct package license files were hashed. This is an
    engineering compatibility review, not legal approval.
  - `packages/contracts` remains the only editable schema authority; Elysia
    `t`/JSON Schema is transport expression. FND-007 source uses AI SDK
    `jsonSchema` and has no Zod import/use. Eden remains deferred to `CON-008`.
  - Electron `43.2.0` remains a distributed desktop runtime despite manifest
    placement as a development dependency. Node remains its build and
    embedded main/preload boundary.
  - p-queue, Pino, OpenTelemetry, authoritative JSONL, rejected overlap
    libraries, `NO_GO_BUN_API`, `DAT-002`/`ADR-MIG-001`, `CON-008`,
    `OBS-006`, `PKG-004`/`PKG-009`, and `GAP-PRIV-001 NON_PASSING` boundaries
    remain intact.
  - Root package/pnpm content equals `HEAD`; no root Bun lock, product/Python
    change, FND-010 artifact, or FND-010/backend-bun candidate process exists.
    `docs/README.md`, `output/`, and `promo/` remain preserved.
- Limitations:
  - Host Node is locally `22.23.1`; the accepted Node `24.18.0` pin remains a
    downstream execution precondition.
  - Existing root packaging usage is not claimed clean or newly approved.
  - No root adoption, packaged Electron, macOS, credentialed Provider, remote
    telemetry, production, legal approval, or privacy-gap closure is claimed.
  - `GAP-PRIV-001` remains `NON_PASSING`.
- Related run log:
  - `fnd-009-checker-20260730-001`

### FND-010 / fnd-010-checker-20260730-006

- Claim: the coexistence Bun/pnpm workspace, text locks, package layout, root
  command contract, explicit no-age-policy sentinel, and fixed brace adapter
  replay through both managers without weakening the retained recorded Viewer
  request pacing semantics.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Date: 2026-07-30
- Environment: local Windows x64, pnpm `11.9.0`, Bun `1.3.14`, Python `3.11`
- Evidence class: `static`, `integration`, `recorded`, `security`, `review`
- Maker run/context ID:
  `fnd-010-maker-20260730-007` /
  `fnd-010-maker-context-20260730-007`
- Checker run/context ID:
  `fnd-010-checker-20260730-006` /
  `fnd-010-checker-context-20260730-006`
- Checker parent run ID: `fnd-010-maker-20260730-007`
- Checker participated in Maker implementation: `false`
- Reviewed source state:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  dirty source hashes are sealed in the Checker artifact.
- Commands/procedure:
  - Maker006, Checker005, and Maker007 manifest verification
  - bounded required recorded E2E pytest -> `1 passed in 0.63s`
  - independent recorded evidence/canonical-hash proof
  - focused Ruff -> `All checks passed!`
  - live/source pnpm zero-sentinel and absent-exception verification
  - fresh independent pnpm/Bun frozen installs and brace probes
- Artifacts:
  - `.omx/artifacts/typescript-bun/FND-010/fnd-010-checker-20260730-006/reports/verdict.json`
  - `.omx/artifacts/typescript-bun/FND-010/fnd-010-checker-20260730-006/reports/verification-matrix.json`
  - `.omx/artifacts/typescript-bun/FND-010/fnd-010-checker-20260730-006/reports/candidate-diff-validation.json`
  - `.omx/artifacts/typescript-bun/FND-010/fnd-010-checker-20260730-006/reports/recorded-pacing-validation.json`
  - `.omx/artifacts/typescript-bun/FND-010/fnd-010-checker-20260730-006/reports/policy-validation.json`
  - `.omx/artifacts/typescript-bun/FND-010/fnd-010-checker-20260730-006/reports/frozen-install-validation.json`
  - `.omx/artifacts/typescript-bun/FND-010/fnd-010-checker-20260730-006/manifest.sha256`
- Accepted assertions:
  - Maker007 is fixture/test-only; product `ViewerRuntime` and settings retain
    their pre-repair hashes.
  - The recorded replay preserves its original 2000-millisecond wave and
    assessment deadlines, explicitly retains 200 milliseconds in both
    canonical specs, and contains no interval-zero, skip, xfail, or weakened
    acceptance path.
  - Twenty-eight selected/provider calls produce exactly 27 logical
    200-millisecond waits. Fixture, model, and independent canonical JSON
    SHA-256 all equal
    `e0c988ee4e0b015e5c5f02244a7cfbb4e29f4bedab3921be973b30cda534573e`.
  - Source and live pnpm `minimumReleaseAge` are exactly zero; both exception
    keys are absent/undefined; `bunfig.toml` and `bun.lockb` are absent.
  - Exact Redocly/js-yaml/brace overrides, the single 403-byte brace patch,
    and both lock hashes remain those independently accepted by Checker005.
  - Fresh pnpm and Bun frozen installs preserve their locks and replay the
    callable brace adapter.
- Limitations:
  - Checker005's accepted heavyweight audit, Node 24 consumer/build, contracts,
    and Windows packaging evidence is reused after current source/hash/policy
    checks rather than rerun.
  - Host Node remains `22.23.1`; the project pin is `24.18.0`.
  - No macOS, credentialed Provider, production, deploy, FND-011
    implementation, or FND-012 implementation claim is made.
- Related run log:
  - `fnd-010-checker-20260730-006`

### FND-011 / fnd-011-checker-20260730-001

- Claim: a migration-only strict TypeScript harness can run the real Python
  FastAPI `/health` oracle, compare JSON and binary fixture output, normalize
  only explicitly classified nondeterminism, persist machine-readable results,
  and clean isolated temporary data without switching either product runtime.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Date: 2026-07-30
- Environment: local Windows x64, Bun `1.3.14`, TypeScript `5.9.3`,
  Python `3.11`
- Evidence class: `unit`, `integration`, `synthetic`, `review`
- Maker run/context ID:
  `fnd-011-maker-20260730-001` /
  `fnd-011-maker-context-20260730-001`
- Checker run/context ID:
  `fnd-011-checker-20260730-001` /
  `fnd-011-checker-context-20260730-001`
- Checker parent run ID: `fnd-011-maker-20260730-001`
- Checker participated in Maker implementation: `false`
- Reviewed source state:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  exact Maker/Checker source hashes are sealed in the Checker artifact.
- Commands/procedure:
  - Maker manifest verification -> `17/17`
  - `bun run test:migration-parity` with Checker-owned
    `ADVX_PARITY_REPORT`
  - Checker hostile matrix -> `8/8` false-parity cases rejected
  - Checker temporary data live/cleanup proof
  - Python health baseline -> `4 passed`
  - backend-bun baseline -> `1 passed`
  - focused Python Ruff -> `All checks passed!`
- Artifacts:
  - `.omx/artifacts/typescript-bun/FND-011/fnd-011-checker-20260730-001/reports/verdict.json`
  - `.omx/artifacts/typescript-bun/FND-011/fnd-011-checker-20260730-001/reports/verification-matrix.json`
  - `.omx/artifacts/typescript-bun/FND-011/fnd-011-checker-20260730-001/reports/health-parity-report.json`
  - `.omx/artifacts/typescript-bun/FND-011/fnd-011-checker-20260730-001/reports/hostile-summary.json`
  - `.omx/artifacts/typescript-bun/FND-011/fnd-011-checker-20260730-001/reports/scope-boundary.json`
  - `.omx/artifacts/typescript-bun/FND-011/fnd-011-checker-20260730-001/manifest.sha256`
- Accepted assertions:
  - Removing only `test:migration-parity` from the root manifest reproduces the
    accepted FND-010 root hash; the ordinary root `test` command is unchanged.
  - Neither product runtime imports the harness. Python assumptions remain
    only in `tests/parity/python_health_oracle.py`.
  - The root command uses local exact TypeScript `5.9.3`, passes seven Bun
    tests/18 assertions, and records passed oracle/decode/candidate stages.
  - The accepted report has `proofScope=migration-fixture-harness`,
    `productParityClaimed=false`, zero JSON/binary diffs, and exactly two
    explicit nondeterminism rules for the fixture ID and timestamp.
  - Undeclared JSON/binary differences, invalid/missing rules, oracle nonzero
    and timeout, decode failure, and candidate failure all write failed
    reports. Timeout leaves no Checker-owned process.
  - The temporary `ADVX_DATA_DIR` exists during the oracle and is absent after
    cleanup.
  - Reports contain no secret, credential, environment dump, or raw media.
    FND-010 locks, policy, overrides, patch, and product/Python hashes remain
    unchanged.
  - `CUT-010` retains the final retain/remove decision and remains `TODO`.
- Limitations:
  - The TypeScript health output is a deterministic migration fixture, not the
    Bun product health implementation.
  - The machine report retains explicit synthetic volatile values and local
    diagnostics; no private input is used.
  - No FND-012 implementation, product runtime switch, Python deletion,
    commit, push, deployment, or platform claim is made.
- Related run log:
  - `fnd-011-checker-20260730-001`

### FND-012 / fnd-012-checker-20260730-003

- Claim: the ADVX-owned TypeScript migration drift checker reads the live
  control plane without rewriting it and rejects malformed links, inventory,
  dependencies, cursor, evidence, blocker, gate, and transition state.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Date: 2026-07-30
- Environment: local Windows x64, Bun `1.3.14`, TypeScript `5.9.3`
- Evidence class: `static`, `unit`, `synthetic`, `review`
- Maker run/context ID:
  `fnd-012-maker-20260730-003` /
  `fnd-012-maker-context-20260730-003`
- Checker run/context ID:
  `fnd-012-checker-20260730-003` /
  `fnd-012-checker-context-20260730-003`
- Checker parent run ID: `fnd-012-maker-20260730-003`
- Checker participated in Maker implementation: `false`
- Reviewed source state:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  Maker dirty source SHA256
  `a3a645e9d249df0d4f4cd523c5e676bd39e93c8ee9635df5bfe3209d8d6a00f2`
  and exact file hashes are sealed in the Maker and Checker artifacts.
- Commands/procedure:
  - Maker manifest verification -> `9/9`, exact manifest SHA256
  - strict TypeScript -> exit `0`
  - `bun test scripts/migration-plan-check.test.ts` -> `48 passed`,
    `0 failed`, 188 expectations
  - `bun run migration:plan-check` -> 133 tasks, 67 links, zero errors
  - three independent isolated dependency fixtures -> all exit `1`
- Artifacts:
  - `.omx/artifacts/typescript-bun/FND-012/fnd-012-checker-20260730-003/reports/verdict.json`
  - `.omx/artifacts/typescript-bun/FND-012/fnd-012-checker-20260730-003/reports/verification.json`
  - `.omx/artifacts/typescript-bun/FND-012/fnd-012-checker-20260730-003/raw/reversed-range.json`
  - `.omx/artifacts/typescript-bun/FND-012/fnd-012-checker-20260730-003/raw/gate-ready-fnd012-verify.json`
  - `.omx/artifacts/typescript-bun/FND-012/fnd-012-checker-20260730-003/raw/fnd012-verify-fnd010-todo.json`
  - `.omx/artifacts/typescript-bun/FND-012/fnd-012-checker-20260730-003/manifest.sha256`
- Accepted assertions:
  - The live control plane passes without document writes.
  - The closed 133-ID master/phase inventory and accepted link, cursor,
    evidence, blocker, gate, and transition checks remain intact.
  - Descending, empty, malformed-width, and unknown-prefix dependency ranges
    are rejected instead of becoming empty dependency sets.
  - Every `READY`, `IN_PROGRESS`, `VERIFY`, `DONE`, or `BLOCKED` row requires
    its declared dependencies to be `DONE`.
  - `ACCEPTED_LIMITATION` satisfies readiness only for the exact
    downstream/dependency pair named by Gate External Conditions.
- Limitations:
  - This proves FND-012 only; `GATE-00` was promoted to `READY` but not run.
  - No product runtime, Python oracle, parity harness, dependency, lock,
    packaging, production, commit, push, deploy, or platform claim is made.
- Related run log:
  - `fnd-012-checker-20260730-003`

### GATE-00 / gate-00-checker-20260730-001

- Claim: Phase 00 Foundation Exit is independently accepted against the eight
  explicit `GATE-00` criteria, using the 12 already accepted
  `FND-001..012` records without rerunning their broad proof.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Received tracked dirty-diff Git hash:
  `4fc84b94046ba6dbc84bdf7a8a329035444cf53b`
- Date: 2026-07-30
- Environment: local Windows x64, branch `TS_backend_refactor`, Bun `1.3.14`
- Evidence class: `static`, `review`
- Maker run/context ID:
  `gate-00-maker-20260730-001` /
  `gate-00-maker-context-20260730-001`
- Checker run/context ID:
  `gate-00-checker-20260730-001` /
  `gate-00-checker-context-20260730-001`
- Checker parent run ID: `gate-00-maker-20260730-001`
- Checker participated in Maker implementation: `false`
- Reviewed source state:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  exact pre-closeout control-document and Maker-artifact hashes are recorded in
  the Checker source receipt.
- Commands/procedure:
  - Maker manifest verification -> `3/3`; manifest-file SHA-256
    `6b0327abfbad22108dac2b192907ebef2299e51ab162e31498d74f1603d6c272`
  - source review of the accepted `FND-001..012` records and Maker criteria map
  - pre-closeout `bun run migration:plan-check` -> exit `0`, 133 tasks,
    67 links, 12 accepted evidence records, zero errors
  - final post-closeout `bun run migration:plan-check` -> exit `0`, 133 tasks,
    67 links, 13 accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/GATE-00/gate-00-checker-20260730-001/verdict.json`
  - `.omx/artifacts/typescript-bun/GATE-00/gate-00-checker-20260730-001/verification.md`
  - `.omx/artifacts/typescript-bun/GATE-00/gate-00-checker-20260730-001/source-receipt.json`
  - `.omx/artifacts/typescript-bun/GATE-00/gate-00-checker-20260730-001/raw-plan-check-before.json`
  - `.omx/artifacts/typescript-bun/GATE-00/gate-00-checker-20260730-001/raw-plan-check-final.json`
  - `.omx/artifacts/typescript-bun/GATE-00/gate-00-checker-20260730-001/manifest.sha256`
- Accepted assertions:
  - Criterion 1: `FND-003` locks Bun `1.3.14`, Electron `43.2.0`, and embedded
    Node `24.18.0`; accepted `FND-004..008` records use Bun `1.3.14`.
  - Criterion 2: `FND-004` proves Windows x64 standard and baseline executable
    launch, authenticated parent/Ctrl+C exit `0`, bounded shutdown, and no
    orphan.
  - Criterion 3: accepted records contain Elysia `GO`, SQLite/Drizzle `GO` with
    `NO_GO_BUN_API` for online backup, AI SDK/p-queue candidate `GO` within its
    evidence limits, and local tracing/OTLP/Pino candidate `GO` with JSONL
    authoritative.
  - Criterion 4: `FND-009` records exact pins, licenses, owners, provenance,
    advisory treatments, and limitations.
  - Criterion 5: accepted preservation assertions retain the Python oracle and
    product runtime/default; `FND-010` proves coexistence and `FND-011` proves
    neither product runtime imports the parity harness.
  - Criterion 6: `FND-011` compares the real Python FastAPI `/health` oracle
    with the migration fixture harness and records zero JSON/binary diffs.
  - Criterion 7: `FND-012` accepts the live plan and closes malformed cursor,
    dependency, evidence, blocker, link, gate, inventory, and transition
    rejection coverage.
  - Criterion 8: all 12 prerequisite evidence records were indexed before this
    record; only this independent Checker then marked `GATE-00`/Phase 00
    `DONE` and promoted `CON-001` to `READY`.
- Limitations:
  - This gate reuses accepted Foundation proof; it does not expand or rerun
    those spike, install, audit, parity, hostile-matrix, or repository-suite
    claims.
  - No product code/test, dependency, lock, Python oracle, runtime default,
    commit, push, deploy, Python deletion, `GATE-01`, or `CON-001`
    implementation action occurred.
- Related run log:
  - `gate-00-checker-20260730-001`

### CON-001 / con-001-checker-20260730-001

- Claim: the canonical Markdown and JSON contract inventories assign every
  scoped externally observed HTTP, WebSocket JSON, WebSocket binary, debug,
  replay, error, runtime, persona, mode, session, room, and barrage payload
  family an explicit current and future owner without implementing schemas.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Received tracked dirty-diff Git hash:
  `4fc84b94046ba6dbc84bdf7a8a329035444cf53b`
- Date: 2026-07-30
- Environment: local Windows x64, branch `TS_backend_refactor`
- Evidence class: `static`, `review`
- Maker run/context ID:
  `con-001-maker-20260730-001` /
  `con-001-maker-context-20260730-001`
- Checker run/context ID:
  `con-001-checker-20260730-001` /
  `con-001-checker-context-20260730-001`
- Checker parent run ID: `con-001-maker-20260730-001`
- Checker participated in Maker implementation: `false`
- Reviewed source state:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  exact pre-closeout inventory, control-document, accepted-route, and Maker
  artifact hashes are recorded in the Checker source receipt.
- Commands/procedure:
  - Maker manifest verification -> `3/3`; manifest-file SHA-256
    `1e5b56e7af81f499ca9f415f09ce0ffe3464da3e77304a189f09365893f38c58`
  - Checker-owned focused PowerShell inventory validation -> exit `0`
  - exact comparison with accepted FND-001 route evidence -> 47 HTTP and one
    WebSocket endpoint, zero missing and zero extra
  - independent top-level class scan across ten scoped contract modules ->
    `121/121` classified, zero missing, extra, or classification errors
  - final `bun run migration:plan-check` -> exit `0`, 133 tasks, 68 links,
    14 accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/CON-001/con-001-checker-20260730-001/validation.json`
  - `.omx/artifacts/typescript-bun/CON-001/con-001-checker-20260730-001/verdict.json`
  - `.omx/artifacts/typescript-bun/CON-001/con-001-checker-20260730-001/source-receipt.json`
  - `.omx/artifacts/typescript-bun/CON-001/con-001-checker-20260730-001/raw-plan-check-final.json`
  - `.omx/artifacts/typescript-bun/CON-001/con-001-checker-20260730-001/manifest.sha256`
- Accepted assertions:
  - Maker001's three sealed entries and reported manifest-file SHA-256 match.
  - The machine inventory contains 126 ownership rows and 73 bindings with 199
    unique stable IDs, all eight required mapping fields, 597 valid path
    references, and all 12 required categories.
  - The accepted FND-001 comparison matches exactly: 47 HTTP routes and one
    WebSocket endpoint with no missing or extra route.
  - Ten scoped contract modules contain exactly 121 top-level contract classes;
    every class maps to an inventory row with matching disposition.
  - Nineteen WS JSON message families resolve to current Python contract
    literals. Six binary bindings cover audio/frame for readable ADVX-BIN
    versions 1, 2, and 3 with current version 3.
  - All 158 externally observed entries name a future task. All 45 absent
    TypeScript consumers use explicit owned-none declarations. Provider wire,
    database row, application-port, raw-media, and resolved-frame internals
    remain outside the public inventory.
  - Markdown totals and category counts agree with JSON and provide usable
    ownership inputs for `CON-002..007` without claiming future schemas.
- Limitations:
  - This is inventory evidence only. It does not implement or validate future
    TypeScript schemas, regenerate contracts, or change protocol behavior.
  - Internal database and Provider wire models remain intentionally excluded.
  - No product code/test, Python oracle, parity suite, dependency, lock,
    commit, push, deploy, Python deletion, or `CON-002` implementation action
    occurred.
- Related run log:
  - `con-001-checker-20260730-001`

### CON-002 / con-002-checker-20260731-002

- Claim: `packages/contracts` is the dependency-free, framework-neutral
  TypeScript runtime schema authority, and strict object schemas use own
  properties for declaration membership, unknown-key rejection, and required
  input membership.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Date: 2026-07-31
- Environment: local Windows x64, branch `TS_backend_refactor`, Bun `1.3.14`
- Evidence class: `static`, `unit`, `review`
- Maker run/context ID:
  `con-002-maker-20260731-002` /
  `con-002-maker-context-20260731-002`
- Checker run/context ID:
  `con-002-checker-20260731-002` /
  `con-002-checker-context-20260731-002`
- Checker parent run ID: `con-002-maker-20260731-002`
- Checker participated in Maker implementation: `false`
- Reviewed source state:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  exact Maker manifest, changed-source, unchanged contract-source, protected
  lock/generated/Python-oracle, prior Checker evidence, and pre-closeout
  evidence-index hashes are recorded in the Checker source receipt.
- Commands/procedure:
  - Maker002 manifest verification -> `2/2`
  - source inspection -> both schema-declaration and input required-field
    membership use `Object.hasOwn`
  - `bun run --filter @advx/contracts typecheck` -> exit `0`
  - `bun run --filter @advx/contracts test` -> exit `0`, 9 focused tests
  - Checker-owned bounded runtime probe -> exit `0`
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/CON-002/con-002-checker-20260731-002/source-receipt-verification.json`
  - `.omx/artifacts/typescript-bun/CON-002/con-002-checker-20260731-002/verification.json`
  - `.omx/artifacts/typescript-bun/CON-002/con-002-checker-20260731-002/verdict.json`
  - `.omx/artifacts/typescript-bun/CON-002/con-002-checker-20260731-002/raw/strict-object-probe.txt`
  - `.omx/artifacts/typescript-bun/CON-002/con-002-checker-20260731-002/raw/contracts-typecheck.txt`
  - `.omx/artifacts/typescript-bun/CON-002/con-002-checker-20260731-002/raw/contracts-test.txt`
  - `.omx/artifacts/typescript-bun/CON-002/con-002-checker-20260731-002/raw/migration-plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/CON-002/con-002-checker-20260731-002/manifest.sha256`
- Accepted assertions:
  - Maker002's two sealed manifest entries and both changed source hashes match.
  - Protected generated OpenAPI, pnpm/Bun locks, Python health oracle and
    runtime files, Checker001 manifest, and pre-closeout evidence index match.
  - `schema.object` recognizes only own declared properties and only own input
    values when enforcing required fields.
  - An independent probe rejects own enumerable `toString`, `constructor`, and
    `__proto__` with exact unknown-key paths and rejects inherited `id` with
    the exact required-value-missing path.
  - Strict TypeScript and all nine focused schema tests pass.
  - Maker002 added no dependency, did not expand the schema DSL, did not port
    `CON-003..007` payloads, and preserved fixture/generated/legacy boundaries.
  - `CON-002-STRICT-OBJECT-PROTOTYPE-KEY-GAP` is resolved.
- Limitations:
  - This acceptance does not claim complete payload migration, OpenAPI parity,
    Python parity, consumer-wide compatibility, or `GATE-01`.
  - No broad suite, install, audit, commit, push, deploy, Python deletion, or
    `CON-003` implementation occurred.
- Related run log:
  - `con-002-checker-20260731-002`

### CON-003 / con-003-checker-20260801-001

- Claim: canonical hand-authored TypeScript runtime schemas and derived public
  types cover the shared identifiers, numeric scalars, versions, Python-owned
  enums, normalized errors, and bounded metadata owned by `CON-003`.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Date: 2026-08-01
- Environment: local Windows x64, branch `TS_backend_refactor`, Bun `1.3.14`
- Evidence class: `static`, `unit`, `review`
- Maker run/context ID:
  `con-003-maker-20260731-001` /
  `con-003-maker-context-20260731-001`
- Checker run/context ID:
  `con-003-checker-20260801-001` /
  `con-003-checker-context-20260801-001`
- Checker parent run ID: `con-003-maker-20260731-001`
- Checker participated in Maker implementation: `false`
- Reviewed source state:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  exact Maker manifest, eight changed-source, six protected, ten Python
  authority, and pre-closeout evidence-index hashes are recorded in the
  Checker source receipt.
- Commands/procedure:
  - Maker001 manifest verification -> `2/2`
  - changed-source verification -> `8/8`; protected files -> `6/6`; recorded
    Python authorities -> `10/10`
  - source comparison of all nine ported enum sets with their recorded Python
    declarations -> exact, zero invented or missing values
  - `bun run --filter @advx/contracts typecheck` -> exit `0`
  - `bun run --filter @advx/contracts test` -> exit `0`, 15 focused tests
  - Checker-owned bounded common-schema probe -> exit `0`, 54 assertions
  - final `bun run migration:plan-check` -> exit `0`, 133 tasks, 68 links,
    16 accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/CON-003/con-003-checker-20260801-001/source-receipt-verification.json`
  - `.omx/artifacts/typescript-bun/CON-003/con-003-checker-20260801-001/verification.json`
  - `.omx/artifacts/typescript-bun/CON-003/con-003-checker-20260801-001/verdict.json`
  - `.omx/artifacts/typescript-bun/CON-003/con-003-checker-20260801-001/common-schema-probe.ts`
  - `.omx/artifacts/typescript-bun/CON-003/con-003-checker-20260801-001/common-schema-probe.txt`
  - `.omx/artifacts/typescript-bun/CON-003/con-003-checker-20260801-001/typecheck.txt`
  - `.omx/artifacts/typescript-bun/CON-003/con-003-checker-20260801-001/contracts-test.txt`
  - `.omx/artifacts/typescript-bun/CON-003/con-003-checker-20260801-001/plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/CON-003/con-003-checker-20260801-001/manifest.sha256`
- Accepted assertions:
  - All Room, Session, Viewer, Persona, Observation, Generation, Barrage, and
    apply ID schemas enforce string length `1..128`.
  - Timestamps and ordinary durations/revisions are non-negative; deadlines,
    positive variants, and epoch are positive integers.
  - HTTP protocol v3, realtime current v4 with exact accepted versions `[3,4]`,
    trace v1, and package schema v1 are runtime-validated constants.
  - Room and barrage sources, observation trigger/source, session state and
    outcome, viewer lifecycle, trace response, observation wave, and realtime
    protocol error enums match the recorded Python authorities exactly.
  - Normalized errors require a bounded code and retryability, permit only an
    optional bounded `safe_detail`, and reject unknown keys. `safe_detail` is
    canonical sanitized metadata, not a `CON-004` HTTP payload.
  - Pagination, bounded-list, and trace/correlation metadata enforce their
    declared bounds and strict object shape.
  - Production root exports exclude fixture helpers; fixture, generated, and
    legacy subpaths remain isolated. No dependency, lock, generated OpenAPI,
    Python oracle, or prior accepted evidence changed.
- Limitations:
  - This acceptance owns only common scalars and errors. It does not claim or
    implement HTTP route payloads, realtime envelopes, binary codecs, full
    domain models, OpenAPI parity, cross-runtime parity, or `GATE-01`.
  - No broad suite, install, audit, Python parity run, implementation repair,
    commit, push, deploy, Python deletion, or `CON-004` implementation occurred.
- Related run log:
  - `con-003-checker-20260801-001`

### CON-004 / con-004-checker-20260801-002

- Claim: canonical TypeScript control-plane request/response contracts cover
  the accepted 47 HTTP method/path bindings with explicit success schemas,
  normalized errors, and nonserializable Provider credential boundaries.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity:
  `sha256:bb53626bd432b14078dbb3044191bb78ca12ca83864f9dfa2d3f25fbc3b6239e`
  (`source-receipt.json`)
- Date: 2026-08-01
- Environment: local Windows x64, branch `TS_backend_refactor`, Bun `1.3.14`
- Evidence class: `static`, `unit`, `review`
- Maker run/context ID:
  `con-004-maker-20260801-002` /
  `con-004-maker-context-20260801-002`
- Checker run/context ID:
  `con-004-checker-20260801-002` /
  `con-004-checker-context-20260801-002`
- Checker parent run ID: `con-004-maker-20260801-002`
- Checker participated in Maker implementation: `false`
- Reviewed source-state hash:
  `sha256:bb53626bd432b14078dbb3044191bb78ca12ca83864f9dfa2d3f25fbc3b6239e`
- Commands/procedure:
  - Maker002 source receipt verification -> both changed-source hashes and all
    five protected hashes match
  - direct source inspection of the two repaired HTTP boundaries -> match
  - `bun run --filter @advx/contracts typecheck` -> exit `0`
  - `bun run --filter @advx/contracts test` -> exit `0`, 21 focused tests
  - Checker-owned compact protocol-safety probe -> exit `0`, zero failures
  - pre-closeout `bun run migration:plan-check` -> exit `0`, 133 tasks, 68
    links, 16 accepted evidence records, zero errors
  - final `bun run migration:plan-check` -> exit `0`, 133 tasks, 68 links, 17
    accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/CON-004/con-004-checker-20260801-002/source-receipt.json`
  - `.omx/artifacts/typescript-bun/CON-004/con-004-checker-20260801-002/verdict.json`
  - `.omx/artifacts/typescript-bun/CON-004/con-004-checker-20260801-002/protocol-safety-probe.ts`
  - `.omx/artifacts/typescript-bun/CON-004/con-004-checker-20260801-002/protocol-safety-probe.txt`
  - `.omx/artifacts/typescript-bun/CON-004/con-004-checker-20260801-002/typecheck.txt`
  - `.omx/artifacts/typescript-bun/CON-004/con-004-checker-20260801-002/contracts-test.txt`
  - `.omx/artifacts/typescript-bun/CON-004/con-004-checker-20260801-002/plan-check-pre-closeout.txt`
  - `.omx/artifacts/typescript-bun/CON-004/con-004-checker-20260801-002/plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/CON-004/con-004-checker-20260801-002/manifest.sha256`
- Accepted assertions:
  - The registry exactly matches all 47 accepted method/path bindings, includes
    exactly 21 Shared Brain bindings, and has 47 unique operation IDs.
  - Every accepted route has an explicit 2xx response schema and at least one
    well-formed normalized error record.
  - Legacy `POST /sessions` validates its actual `200` null success, rejects a
    non-null success value, and retains its normalized `409`
    `runtime_snapshot_required` behavior.
  - `POST /configuration/providers/probe` retains credential-bearing input only
    as a nonserializable `controlled-secret-boundary`. Its public metadata
    accepts absent or present `provider_profile_id` and rejects model/ASR
    credentials, credential containers, raw audio/images, and a representative
    Provider wire payload.
  - Representative runtime-spec references, apply secret rejection, rollback
    ordering, recorded replay external-call prohibition, and recorded Provider
    raw-media rejection remain intact.
  - `CON-004-HTTP-BOUNDARY-COMPLETENESS-GAP` is resolved.
- Limitations:
  - This acceptance does not claim realtime JSON envelopes, binary ingest,
    generated OpenAPI/Scalar, cross-runtime parity, version negotiation, or
    `GATE-01` completion.
  - No broad suite, install, audit, Python parity run, implementation repair,
    dependency/lock change, commit, push, deploy, Python deletion, or `CON-005`
    implementation occurred. `output/` and `promo/` contents were not read.
- Related run log:
  - `con-004-checker-20260801-002`

### CON-005 / con-005-checker-20260801-002

- Claim: canonical TypeScript realtime JSON contracts retain the accepted
  protocol boundary and enforce paired-audio turn identity before every branch,
  including degraded late-final persistence without second-wave authorization.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity:
  `sha256:15a235deebadd3c4e2627e6a17fec9728b7f40c49a07deb94ab0a69c65b5a8da`
  (`source-receipt.json`)
- Date: 2026-08-01
- Environment: local Windows x64, branch `TS_backend_refactor`, Bun `1.3.14`
- Evidence class: `static`, `unit`, `review`
- Maker run/context ID:
  `con-005-maker-20260801-002` /
  `con-005-maker-context-20260801-002`
- Checker run/context ID:
  `con-005-checker-20260801-002` /
  `con-005-checker-context-20260801-002`
- Checker parent run ID: `con-005-maker-20260801-002`
- Checker participated in Maker implementation: `false`
- Reviewed source-state hash:
  `sha256:15a235deebadd3c4e2627e6a17fec9728b7f40c49a07deb94ab0a69c65b5a8da`
- Commands/procedure:
  - Maker002 source receipt verification -> both changed-source hashes and all
    four protected pre-closeout hashes match
  - direct inspection of the paired-audio refinement and focused regression ->
    aggregate identity check precedes every branch
  - `bun run --filter @advx/contracts typecheck` -> exit `0`
  - `bun run --filter @advx/contracts test` -> exit `0`, 24 focused tests
  - Checker-owned bounded three-case paired-audio probe -> exit `0`, all cases
    passed
  - pre-closeout `bun run migration:plan-check` -> exit `0`, 133 tasks, 68
    links, 17 accepted evidence records, zero errors
  - final `bun run migration:plan-check` -> exit `0`, 133 tasks, 68 links, 18
    accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/CON-005/con-005-checker-20260801-002/source-receipt.json`
  - `.omx/artifacts/typescript-bun/CON-005/con-005-checker-20260801-002/verdict.json`
  - `.omx/artifacts/typescript-bun/CON-005/con-005-checker-20260801-002/paired-audio-probe.ts`
  - `.omx/artifacts/typescript-bun/CON-005/con-005-checker-20260801-002/paired-audio-probe.txt`
  - `.omx/artifacts/typescript-bun/CON-005/con-005-checker-20260801-002/typecheck.txt`
  - `.omx/artifacts/typescript-bun/CON-005/con-005-checker-20260801-002/contracts-test.txt`
  - `.omx/artifacts/typescript-bun/CON-005/con-005-checker-20260801-002/plan-check-pre-closeout.txt`
  - `.omx/artifacts/typescript-bun/CON-005/con-005-checker-20260801-002/plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/CON-005/con-005-checker-20260801-002/manifest.sha256`
- Accepted assertions:
  - Every present `observation_trigger.trigger_id` and `idempotency_key` equals
    the aggregate `turn_id` before any paired-audio branch can accept.
  - A valid same-turn degraded late system-audio final remains accepted with
    the persisted late-final payload intact.
  - The exact degraded cross-turn late-final payload is rejected.
  - A late system-audio final cannot authorize a second ObservationWave.
  - Checker001's already accepted one-WS-endpoint, 19-family v3/v4,
    envelope/scope, semantic, secret/raw-media, and legacy-export boundaries
    remain applicable because Maker002 changed only the paired-audio refinement
    and one TypeScript regression.
  - `CON-005-PAIRED-AUDIO-TURN-IDENTITY-GAP` is resolved.
- Limitations:
  - This acceptance does not claim binary ingest, generated OpenAPI/Scalar,
    live WebSocket runtime behavior, version negotiation/rejection, desktop or
    backend migration, `CON-006`, or `GATE-01` completion.
  - No broad suite, install, audit, Python oracle/parity run, implementation
    repair, dependency/lock change, commit, push, deploy, or Python deletion
    occurred. `output/` and `promo/` contents were not read.
- Related run log:
  - `con-005-checker-20260801-002`

### CON-006 / con-006-checker-20260801-002

- Claim: the TypeScript binary ingest codec preserves the accepted exact byte,
  parser, opaque-body, offset/u64, and cross-runtime boundaries while publishing
  the exact six accepted bindings with typed `client-to-backend` direction.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity:
  `sha256:36089206217780e74e956d691e03abdb2bddab2158d5a56ed388f75a039d638b`
  (`source-receipt.json`)
- Date: 2026-08-01
- Environment: local Windows x64, branch `TS_backend_refactor`, Bun `1.3.14`
- Evidence class: `static`, `unit`, `review`
- Maker run/context ID:
  `con-006-maker-20260801-002` /
  `con-006-maker-context-20260801-002`
- Checker run/context ID:
  `con-006-checker-20260801-002` /
  `con-006-checker-context-20260801-002`
- Checker parent run ID: `con-006-maker-20260801-002`
- Checker participated in Maker implementation: `false`
- Reviewed source-state hash:
  `sha256:36089206217780e74e956d691e03abdb2bddab2158d5a56ed388f75a039d638b`
- Commands/procedure:
  - Maker002 source receipt verification -> both changed-source hashes and all
    13 control, unchanged-boundary, and protected hashes match
  - direct source inspection -> binding interface and registry use the typed
    literal `direction: 'client-to-backend'`
  - `bun run --filter @advx/contracts typecheck` -> exit `0`
  - `bun run --filter @advx/contracts test` -> exit `0`, four binary tests and
    24 existing schema assertions passed
  - Checker-owned compact six-entry inventory/direction probe -> exit `0`, six
    registry entries, six unique IDs, six accepted inventory bindings, six
    exact direction matches
  - pre-closeout `bun run migration:plan-check` -> exit `0`, 133 tasks, 68
    links, 18 accepted evidence records, zero errors
  - final `bun run migration:plan-check` -> exit `0`, 133 tasks, 68 links, 19
    accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/CON-006/con-006-checker-20260801-002/source-receipt.json`
  - `.omx/artifacts/typescript-bun/CON-006/con-006-checker-20260801-002/verdict.json`
  - `.omx/artifacts/typescript-bun/CON-006/con-006-checker-20260801-002/inventory-direction-probe.ts`
  - `.omx/artifacts/typescript-bun/CON-006/con-006-checker-20260801-002/inventory-direction-probe.txt`
  - `.omx/artifacts/typescript-bun/CON-006/con-006-checker-20260801-002/typecheck.txt`
  - `.omx/artifacts/typescript-bun/CON-006/con-006-checker-20260801-002/contracts-test.txt`
  - `.omx/artifacts/typescript-bun/CON-006/con-006-checker-20260801-002/plan-check-pre-closeout.txt`
  - `.omx/artifacts/typescript-bun/CON-006/con-006-checker-20260801-002/plan-check-final.txt`
- Accepted assertions:
  - `AdvxBinaryCodecBinding.direction` is the typed literal
    `'client-to-backend'`; every exact registry entry carries it.
  - The registry has exactly six unique IDs and matches the accepted six
    `ws-binary-message` inventory identities and directions.
  - Checker001's accepted six-fixture/665-byte byte parity, negative-parser,
    opaque-body, offset/unsigned-64, and Bun/Node/browser portability evidence
    remains applicable because all four unchanged binary-boundary hashes and
    the Python oracle hash match Maker002's receipt.
  - `CON-006-BINARY-BINDING-DIRECTION-REGISTRY-GAP` is resolved.
- Limitations:
  - This acceptance does not claim live WS hub integration, desktop adapter
    migration, generated OpenAPI/Scalar, version negotiation/rejection,
    `CON-007`, `CON-010`, or `GATE-01` completion.
  - No broad suite, install, audit, Python oracle/parity rerun, Node/browser
    rerun, implementation repair, dependency/lock change, commit, push, deploy,
    or Python change/deletion occurred. `output/` and `promo/` contents were not
    read.
- Related run log:
  - `con-006-checker-20260801-002`

### CON-007 / con-007-checker-20260801-001

- Claim: the development OpenAPI/Scalar surface is generated from the canonical
  TypeScript control-route registry, is deterministic and secret-safe, covers
  all declared responses, and remains closed in production unless explicitly
  enabled.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity:
  `sha256:7f143cce35ffb44bd2d6ff1625ec379bc53df487768ca43ee55655cc7d9b3718`
  (`source-receipt.json`)
- Date: 2026-08-01
- Environment: local Windows x64, branch `TS_backend_refactor`, Bun `1.3.14`
- Evidence class: `static`, `unit`, `integration`, `review`
- Maker run/context ID:
  `con-007-maker-20260801-001` /
  `con-007-maker-context-20260801-001`
- Checker run/context ID:
  `con-007-checker-20260801-001` /
  `con-007-checker-context-20260801-001`
- Checker parent run ID: `con-007-maker-20260801-001`
- Checker participated in Maker implementation: `false`
- Reviewed source-state hash:
  `sha256:7f143cce35ffb44bd2d6ff1625ec379bc53df487768ca43ee55655cc7d9b3718`
- Commands/procedure:
  - Maker source receipt verification -> all seven implementation/snapshot
    hashes match; four canonical contract-source hashes were additionally bound
  - direct source inspection of document generation, snapshot command, Scalar
    enablement, and controlled-secret request handling
  - Checker-owned bounded OpenAPI/Scalar probe -> exit `0`; OpenAPI `3.1.0`, 43
    paths, 47 exact bindings, 48 success declarations, 226 normalized error
    records, two controlled-secret boundaries, zero example keys
  - `bun run --filter @advx/backend-bun typecheck` -> exit `0`
  - `bun run --filter @advx/backend-bun test` -> exit `0`, six focused tests,
    388 assertions
  - `bun run --filter @advx/backend-bun openapi:check` -> exit `0`
  - `bun run --filter @advx/backend-bun build` -> exit `0`, 341 modules
  - final `bun run migration:plan-check` -> exit `0`, 133 tasks, 68 links, 20
    accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/CON-007/con-007-checker-20260801-001/source-receipt.json`
  - `.omx/artifacts/typescript-bun/CON-007/con-007-checker-20260801-001/verdict.json`
  - `.omx/artifacts/typescript-bun/CON-007/con-007-checker-20260801-001/verify.ts`
  - `.omx/artifacts/typescript-bun/CON-007/con-007-checker-20260801-001/independent-probe.txt`
  - `.omx/artifacts/typescript-bun/CON-007/con-007-checker-20260801-001/typecheck.txt`
  - `.omx/artifacts/typescript-bun/CON-007/con-007-checker-20260801-001/test.txt`
  - `.omx/artifacts/typescript-bun/CON-007/con-007-checker-20260801-001/openapi-check.txt`
  - `.omx/artifacts/typescript-bun/CON-007/con-007-checker-20260801-001/build.txt`
  - `.omx/artifacts/typescript-bun/CON-007/con-007-checker-20260801-001/plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/CON-007/con-007-checker-20260801-001/manifest.sha256`
- Accepted assertions:
  - The checked snapshot exactly reproduces the deterministic OpenAPI 3.1
    serialization generated from the canonical 47-operation registry.
  - Exactly 43 paths and all 47 method/path/operation-ID bindings are present;
    every declared success status and normalized error status/code is included.
  - Path, query, public request, and controlled public-metadata schemas match
    their canonical schemas. The two controlled Provider operations expose no
    internal secret fields in their JSON schemas and contain zero
    `example`/`examples` keys or secret-value canaries.
  - Every non-health operation declares local bearer security; `/health`
    remains unauthenticated.
  - In-memory Elysia handling returns `200/200` for development UI/spec,
    `404/404` for production default, and `200/200` for explicit production
    opt-in. No listener or process was started.
- Limitations:
  - This acceptance does not claim business route handlers, live auth,
    listening on port 8765, process lifecycle, control-client selection,
    cross-runtime parity, version negotiation, `CON-008+`, or `GATE-01`.
  - No broad suite, dependency install/audit, Python oracle/parity rerun,
    implementation repair, dependency/lock change, commit, push, deploy, or
    Python change/deletion occurred. `output/` and `promo/` contents were not
    read.
- Related run log:
  - `con-007-checker-20260801-001`

### CON-008 / con-008-checker-20260801-001

- Claim: `ADR-MIG-002` decisively selects generated OpenAPI control-operation
  types plus an ADVX-owned fetch adapter and supplies an implementation-ready
  ownership, drift, rollout, rollback, and exit contract for `DES-006`.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity:
  `sha256:6e3e2ca566aa2a8172b272ab0731bb422f221619ffc77fba1d42e48ad388e062`
  (`source-receipt.json`)
- Date: 2026-08-01
- Environment: local Windows x64, branch `TS_backend_refactor`, Bun `1.3.14`
- Evidence class: `static`, `generation`, `review`
- Maker run/context ID:
  `con-008-maker-20260801-001` /
  `con-008-maker-context-20260801-001`
- Checker run/context ID:
  `con-008-checker-20260801-001` /
  `con-008-checker-context-20260801-001`
- Checker parent run ID: `con-008-maker-20260801-001`
- Checker participated in Maker implementation: `false`
- Reviewed source-state hash:
  `sha256:a748ae6f6da20ed457205eeb36177c5f19aace14ab7f506e0eebd006526a943b`
- Commands/procedure:
  - official Elysia Eden overview and Treaty parameter review -> direct
    application-type inference and Fetch `AbortSignal` support confirmed
  - official openapi-typescript 7.x introduction/CLI review -> local OpenAPI
    3.1 input and runtime-free generation contract confirmed
  - exact installed `openapi-typescript@7.13.0` local snapshot generation ->
    exit `0`; emitted `paths`, `operations`, and all 47 stable operation IDs
  - Checker-owned compact ADR/snapshot/dependency probe -> exit `0`; all 12
    Maker receipt hashes and ten protected boundaries match, exactly 47 unique
    operations, Eden absent from manifests/locks, no reserved output or
    `CON-009` implementation
  - final `bun run migration:plan-check` -> exit `0`, 133 tasks, 68 links, 21
    accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/CON-008/con-008-checker-20260801-001/source-receipt.json`
  - `.omx/artifacts/typescript-bun/CON-008/con-008-checker-20260801-001/verdict.json`
  - `.omx/artifacts/typescript-bun/CON-008/con-008-checker-20260801-001/verify.ts`
  - `.omx/artifacts/typescript-bun/CON-008/con-008-checker-20260801-001/independent-probe.txt`
  - `.omx/artifacts/typescript-bun/CON-008/con-008-checker-20260801-001/openapi-typescript.txt`
  - `.omx/artifacts/typescript-bun/CON-008/con-008-checker-20260801-001/official-sources.md`
  - `.omx/artifacts/typescript-bun/CON-008/con-008-checker-20260801-001/plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/CON-008/con-008-checker-20260801-001/manifest.sha256`
- Accepted assertions:
  - Eden Treaty is technically viable, directly infers from/imports the Elysia
    app type, and supports an abort signal; that coupling is rejected for this
    Python/Bun coexistence and Elysia-replaceable control boundary.
  - The exact existing dev-only generator consumes the deterministic CON-007
    OpenAPI 3.1 snapshot and emits framework-neutral runtime-free operation
    types for all 47 stable operation IDs without a new runtime package.
  - `DES-006` owns one fetch adapter and the generation/drift gate, including
    auth, normalized error/runtime validation, timeout/abort composition, zero
    implicit retry, dual-backend rollout, rollback, and exit conditions.
  - Realtime and binary contracts are excluded. Python remains live/default
    until its planned selector and cutover tasks.
- Limitations:
  - This acceptance does not implement a client, generate the reserved checked
    output, prove dual-backend parity, switch the live backend, or start
    `CON-009`/`DES-006`.
  - No product repair, broad suite, build, test, install, audit, manifest/lock
    change, Python oracle change, commit, push, deploy, or inspection of
    `output/` or `promo/` occurred.
- Related run log:
  - `con-008-checker-20260801-001`

### CON-009 / con-009-checker-20260801-002

- Claim: the deterministic Python-oracle versus TypeScript contract parity
  suite covers the accepted HTTP, realtime, and binary authority boundaries,
  and the task's corrected AI-call status enum has focused exact-set
  regression coverage.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity:
  `sha256:c78ac0085ac68a8dee85b6b20d4fe06d908b86f53c992f40242a9686ff5fcfdf`
  (`source-receipt.json`)
- Date: 2026-08-01
- Environment: local Windows x64, branch `TS_backend_refactor`, Bun `1.3.14`
- Evidence class: `static`, `unit`, `integration`, `review`
- Maker run/context ID:
  `con-009-maker-20260801-002` /
  `con-009-maker-context-20260801-002`
- Checker run/context ID:
  `con-009-checker-20260801-002` /
  `con-009-checker-context-20260801-002`
- Checker parent run ID: `con-009-maker-20260801-002`
- Checker participated in Maker implementation: `false`
- Reviewed source-state hash:
  `sha256:c78ac0085ac68a8dee85b6b20d4fe06d908b86f53c992f40242a9686ff5fcfdf`
- Commands/procedure:
  - Recovery Maker source receipt plus current-file verification -> repaired
    schema-test hash and all 18 protected hashes match
  - `bun run --filter @advx/contracts typecheck` -> exit `0`
  - `bun test packages/contracts/test/schema.test.ts` -> exit `0`; focused
    script harness reports 25 assertions
  - Checker-owned exact-set/protected-hash probe -> exit `0`; exact nine
    statuses, representative extra `unknown` rejected, 19 current hashes match
  - reused Checker001's accepted parity report and cleanup evidence because the
    protected production/parity/oracle boundaries are unchanged
  - final `bun run migration:plan-check` -> exit `0`, 133 tasks, 68 links, 22
    accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/CON-009/con-009-checker-20260801-002/source-receipt.json`
  - `.omx/artifacts/typescript-bun/CON-009/con-009-checker-20260801-002/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/CON-009/con-009-checker-20260801-002/checker-probe.json`
  - `.omx/artifacts/typescript-bun/CON-009/con-009-checker-20260801-002/typecheck.txt`
  - `.omx/artifacts/typescript-bun/CON-009/con-009-checker-20260801-002/schema-test.txt`
  - `.omx/artifacts/typescript-bun/CON-009/con-009-checker-20260801-002/verdict.json`
  - `.omx/artifacts/typescript-bun/CON-009/con-009-checker-20260801-002/plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/CON-009/con-009-checker-20260801-002/manifest.sha256`
- Accepted assertions:
  - The focused test imports and references `aiCallStatusSchema`; its
    JSON-schema enum and runtime accepted set exactly equal `preparing`, `sent`,
    `streaming`, `received`, `succeeded`, `failed`, `blocked`, `cancelled`, and
    `interrupted`, while `unknown` is rejected.
  - Checker001's accepted two-way parity remains bound to exact coverage of 47
    HTTP bindings, 162 serializable public contracts, 226 normalized errors,
    19 retained realtime families, and six binary fixtures totaling 665 bytes;
    normalized paths and semantic-loss diffs remain zero.
  - Controlled secrets and raw media remain contained; both Python subprocesses
    and the temporary directory were cleanly terminated/removed in the reused
    accepted run.
  - Production schemas, generated Python OpenAPI authority, parity runners,
    fixtures, retained Python oracles, manifests, locks, and pre-closeout
    evidence retain their accepted hashes.
  - `CON-009-AI-CALL-STATUS-REGRESSION-COVERAGE-GAP` is resolved.
- Limitations:
  - This acceptance remains deterministic synthetic parity and does not claim
    live Provider/platform behavior, version negotiation, incompatible-client
    rejection, `CON-010`, or `GATE-01` completion.
  - No broad suite, full parity rerun, install, audit, implementation repair,
    production/Python change, dependency/lock change, commit, push, deploy, or
    inspection of `output/` or `promo/` occurred.
- Related run log:
  - `con-009-checker-20260801-002`

### CON-010 / con-010-checker-20260801-001

- Claim: the framework-neutral production compatibility API negotiates the
  retained HTTP, realtime, and binary protocol versions, rejects unsupported
  or stale connections fail closed, and serializes stable secret-safe failure
  reasons.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty source-state identity:
  `sha256:b7646f06d25d1db7528977572b66dcdf1171446e090d1075dfe7785e4b7cda9d`
  (canonical hashes in `source-receipt.json`)
- Date: 2026-08-01
- Environment: local Windows x64, branch `TS_backend_refactor`, Bun `1.3.14`
- Evidence class: `static`, `unit`, `integration`, `review`
- Maker run/context ID:
  `con-010-maker-20260801-001` /
  `con-010-maker-context-20260801-001`
- Checker run/context ID:
  `con-010-checker-20260801-001` /
  `con-010-checker-context-20260801-001`
- Checker parent run ID: `con-010-maker-20260801-001`
- Checker participated in Maker implementation: `false`
- Reviewed source-state hash:
  `sha256:b7646f06d25d1db7528977572b66dcdf1171446e090d1075dfe7785e4b7cda9d`
- Commands/procedure:
  - all 14 Maker-reviewed source/authority hashes match; the accepted
    CON-005/006/009 receipt hashes and 16 protected current hashes also match
  - `bun run --filter @advx/contracts typecheck` -> exit `0`
  - `bun test packages/contracts/test/protocol-compatibility.test.ts` -> exit
    `0`; 10 tests, 38 assertions
  - `uv run --project apps/backend ruff check
    packages/contracts/test/protocol-compatibility-oracle.py` -> exit `0`
  - `uv run --project apps/backend python
    packages/contracts/test/protocol-compatibility-oracle.py` -> exit `0`;
    current/current `4`, older/current `3`, current/older-v3 `3`
  - Checker-owned compatibility probe -> exit `0`; 39 scenarios, 14 distinct
    failure codes, three secret canaries, three serialized failure samples
  - final `bun run migration:plan-check` -> exit `0`, 133 tasks, 68 links, 23
    accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/CON-010/con-010-checker-20260801-001/source-receipt.json`
  - `.omx/artifacts/typescript-bun/CON-010/con-010-checker-20260801-001/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/CON-010/con-010-checker-20260801-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/CON-010/con-010-checker-20260801-001/typecheck.txt`
  - `.omx/artifacts/typescript-bun/CON-010/con-010-checker-20260801-001/protocol-compatibility-test.txt`
  - `.omx/artifacts/typescript-bun/CON-010/con-010-checker-20260801-001/ruff.txt`
  - `.omx/artifacts/typescript-bun/CON-010/con-010-checker-20260801-001/python-oracle.txt`
  - `.omx/artifacts/typescript-bun/CON-010/con-010-checker-20260801-001/verdict.json`
  - `.omx/artifacts/typescript-bun/CON-010/con-010-checker-20260801-001/plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/CON-010/con-010-checker-20260801-001/manifest.sha256`
- Accepted assertions:
  - authority is HTTP v3, realtime current v4/readable v3, and binary current
    v3/readable v1-v2 compatibility; current/current chooses v4 while both
    retained older boundaries choose v3
  - post-handshake JSON must equal the negotiated version; realtime v4 accepts
    only `ADVX-BIN/3`, while realtime v3 accepts legacy v1/v2; unsupported and
    mismatched binary versions have distinct codes
  - future, missing, and invalid versions fail closed; restart invalidates the
    old context, a new handshake passes, and stale start, startup-token
    comparison, Session, and audience epoch have distinct stable codes
  - failures always expose `code`, `transport`, `stage`, `retryable`, and
    `rehandshakeRequired` with relevant version fields; no API declares a raw
    token field and serialized failures contain no token or identity values
  - the root and `./compatibility` exports resolve for a workspace consumer;
    the implementation imports only repository-local modules
  - accepted CON-005/006/009 schema, fixture, oracle, manifest, parity, and lock
    boundaries remain unchanged except the intended CON-010 files/exports
- Limitations:
  - This acceptance proves the reusable contract boundary with synthetic and
    retained-oracle evidence; it does not claim a real WebSocket, backend child
    process restart, or desktop reconnect lifecycle.
  - No broad suite, install, audit, implementation repair, runtime integration,
    dependency/lock change, Python oracle deletion/replacement, commit, push,
    deploy, `GATE-01`, or downstream task work occurred.
- Related run log:
  - `con-010-checker-20260801-001`

### GATE-01 / gate-01-checker-20260802-003

- Claim: Phase 01 Contract Exit is independently accepted after the sole
  rejected OpenAPI snapshot-drift boundary was repaired, with accepted
  `CON-001..010` proof reused only after current hash matching.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty source identity:
  `sha256:8292c6b9cc7b77f65225ca67f8dd1f70c0169f2ef9915391e97c3af937ab27fa`
- Date: 2026-08-02
- Environment: local Windows x64, branch `TS_backend_refactor`, Bun `1.3.14`
- Evidence class: `static`, `unit`, `review`
- Maker run/context ID:
  `gate-01-maker-20260801-002` /
  `gate-01-maker-context-20260801-002`
- Checker run/context ID:
  `gate-01-checker-20260802-003` /
  `gate-01-checker-context-20260802-003`
- Checker parent run ID: `gate-01-maker-20260801-002`
- Checker participated in Maker implementation: `false`
- Reviewed source-state hash:
  `sha256:8292c6b9cc7b77f65225ca67f8dd1f70c0169f2ef9915391e97c3af937ab27fa`
- Commands/procedure:
  - Recovery Maker002 manifest -> `8/8`; rejection Checker001 manifest ->
    `7/7`
  - all 36 unaffected protected hashes and all ten accepted `CON-001..010`
    Checker verdict receipt hashes match
  - `bun run --filter @advx/backend-bun typecheck` -> exit `0`
  - `bun run --filter @advx/backend-bun openapi:check` -> exit `0`; snapshot
    matches the 47-operation registry
  - Checker-owned compact current-hash/gate probe -> exit `0`; canonical
    `AiCallStatus` is exactly `preparing`, `sent`, `streaming`, `received`,
    `succeeded`, `failed`, `blocked`, `cancelled`, `interrupted`; legacy
    `queued`/`running` and `unknown` reject
  - the checked snapshot and
    `serializeAdvxOpenApiDocument(createAdvxOpenApiDocument())` are byte-exact
    SHA-256 `955b8164c3c7f619e499cdbea819aef2fdc57f4a34ac8a09a2a59b7782ced75a`,
    1,031,953 bytes, 43 paths, and 47 operations
  - final `bun run migration:plan-check` -> exit `0`, 133 tasks, 68 links, 24
    accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/GATE-01/gate-01-checker-20260802-003/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/GATE-01/gate-01-checker-20260802-003/checker-probe.json`
  - `.omx/artifacts/typescript-bun/GATE-01/gate-01-checker-20260802-003/typecheck.txt`
  - `.omx/artifacts/typescript-bun/GATE-01/gate-01-checker-20260802-003/openapi-check.txt`
  - `.omx/artifacts/typescript-bun/GATE-01/gate-01-checker-20260802-003/source-cursor-receipt.json`
  - `.omx/artifacts/typescript-bun/GATE-01/gate-01-checker-20260802-003/validation.json`
  - `.omx/artifacts/typescript-bun/GATE-01/gate-01-checker-20260802-003/verdict.json`
  - `.omx/artifacts/typescript-bun/GATE-01/gate-01-checker-20260802-003/plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/GATE-01/gate-01-checker-20260802-003/manifest.sha256`
- Accepted assertions:
  - Checker001's criteria 1-6 and 8 remain accepted because the 36 unaffected
    protected source hashes and all ten prerequisite Checker receipt hashes are
    unchanged.
  - Criterion 7 now passes: the repaired checked snapshot exactly equals the
    deterministic current TypeScript OpenAPI generator and contains the
    corrected canonical AI-call status schema.
  - Criterion 9 passes only through this independent current-HEAD evidence
    index and closeout.
  - The Python parity oracle and desktop Python-generated OpenAPI authority are
    unchanged; `BCK-001` had no boundary directories and was not started.
  - `GATE-01` and Phase 01 are `DONE`; Phase 02 and only `BCK-001` are `READY`;
    `current_task=null`, `next_task=BCK-001`, and
    `same_blocker_attempts=0`.
- Limitations:
  - This gate intentionally reuses accepted prerequisite proof and does not
    rerun the full contracts, parity, binary/schema, OpenAPI, hostile, build,
    install, audit, or repository-wide suites.
  - No implementation repair, dependency/lock mutation, Python change/deletion,
    Phase 02 implementation, commit, push, deploy, Ultragoal ledger update, or
    inspection of `output/` or `promo/` occurred.
- Related run log:
  - `gate-01-checker-20260802-003`

### BCK-001 / bck-001-checker-20260802-002

- Claim: The Bun backend package has enforced inward dependency boundaries,
  only the three declared composition roots, and Python-free in-memory
  application instantiation without opening a listener.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty source identity:
  `sha256:1086a11b3878afe5d43503b9d51e62d150eb8ac8e917e88c2e4a7f885086cade`
- Date: 2026-08-02
- Environment: local Windows x64, branch `TS_backend_refactor`, Bun `1.3.14`
- Evidence class: `static`, `unit`, `review`
- Maker run/context ID:
  `bck-001-maker-20260802-002` /
  `bck-001-maker-context-20260802-002`
- Checker run/context ID:
  `bck-001-checker-20260802-002` /
  `bck-001-checker-context-20260802-002`
- Checker parent run ID: `bck-001-maker-20260802-002`
- Checker participated in Maker implementation: `false`
- Reviewed source-state hash:
  `sha256:1086a11b3878afe5d43503b9d51e62d150eb8ac8e917e88c2e4a7f885086cade`
- Commands/procedure:
  - Recovery Maker002 manifest current-hash check -> `18/18`
  - `bun run --filter @advx/backend-bun typecheck` -> exit `0`
  - `bun run --filter @advx/backend-bun check:boundaries` -> exit `0`, 17
    production sources
  - `bun run --filter @advx/backend-bun test:bck-001` -> exit `0`, six tests,
    nine assertions
  - Checker-owned two-case recovery and import/instantiation probe -> exit `0`
  - `bun run migration:plan-check` -> exit `0`, 133 tasks, 68 links, 25
    accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/BCK-001/bck-001-checker-20260802-002/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/BCK-001/bck-001-checker-20260802-002/checker-probe.json`
  - `.omx/artifacts/typescript-bun/BCK-001/bck-001-checker-20260802-002/checker-probe.txt`
  - `.omx/artifacts/typescript-bun/BCK-001/bck-001-checker-20260802-002/typecheck.txt`
  - `.omx/artifacts/typescript-bun/BCK-001/bck-001-checker-20260802-002/boundary-check.txt`
  - `.omx/artifacts/typescript-bun/BCK-001/bck-001-checker-20260802-002/focused-tests.txt`
  - `.omx/artifacts/typescript-bun/BCK-001/bck-001-checker-20260802-002/source-cursor-receipt.json`
  - `.omx/artifacts/typescript-bun/BCK-001/bck-001-checker-20260802-002/validation.json`
  - `.omx/artifacts/typescript-bun/BCK-001/bck-001-checker-20260802-002/verdict.json`
  - `.omx/artifacts/typescript-bun/BCK-001/bck-001-checker-20260802-002/plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/BCK-001/bck-001-checker-20260802-002/manifest.sha256`
- Accepted assertions:
  - The two original rejected cases now each yield exactly one violation.
  - `app.ts`, `index.ts`, and `main.ts` are the exact composition-root
    allowlist; every other root production source is rejected.
  - All 17 production source hashes match Recovery Maker002 and pass the live
    production boundary check.
  - All 13 unchanged Maker001 package/application/in-memory/no-Python/no-listen
    evidence hashes match; fresh entry import and in-memory instantiation
    observe zero `Bun.spawn` and `Bun.serve` calls.
  - `BCK-001` is `DONE`; Phase 02 and only `BCK-002` are `READY`;
    `current_task=null`, `next_task=BCK-002`, and `same_blocker_attempts=0`.
- Limitations:
  - Dynamic-import hardening was outside the actual blocker and was neither
    required nor added.
  - This acceptance does not claim config, auth, health, listen, business
    routes, persistence, Provider runtime, lifecycle, parity, or downstream
    task completion.
  - No broad suite, install, audit, build, OpenAPI/parity suite, dependency or
    lock change, Python oracle change/deletion, commit, push, deploy, Ultragoal
    ledger update, `BCK-002` work, or inspection of `output/` or `promo/`
    occurred.
- Related run log:
  - `bck-001-checker-20260802-002`

### BCK-002 / bck-002-checker-20260802-001

- Claim: The Bun backend has strict immutable typed configuration with
  production-safe defaults, secret-redacted validation, and process-only
  environment composition before any listener can start.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty source identity:
  `sha256:f3f06ecd4e2eec7c1692045ea97c853238efcb411c117e42df9a7c1da51f88e7`
- Date: 2026-08-02
- Environment: local Windows x64, branch `TS_backend_refactor`, Bun `1.3.14`
- Evidence class: `static`, `unit`, `review`
- Maker run/context ID:
  `bck-002-maker-20260802-001` /
  `bck-002-maker-context-20260802-001`
- Checker run/context ID:
  `bck-002-checker-20260802-001` /
  `bck-002-checker-context-20260802-001`
- Checker parent run ID: `bck-002-maker-20260802-001`
- Checker participated in Maker implementation: `false`
- Reviewed source-state hash:
  `sha256:f3f06ecd4e2eec7c1692045ea97c853238efcb411c117e42df9a7c1da51f88e7`
- Commands/procedure:
  - Maker001 manifest current-hash check -> `18/18`
  - `bun run --filter @advx/backend-bun typecheck` -> exit `0`
  - `bun run --filter @advx/backend-bun check:boundaries` -> exit `0`, 18
    production sources
  - `bun run --filter @advx/backend-bun test:bck-002` -> exit `0`, five tests,
    30 assertions
  - Checker-owned config/redaction/pre-listen probe -> exit `0`, 14 invalid
    pre-listen cases, six secret/redaction cases, zero serve/spawn calls
  - `bun run migration:plan-check` -> exit `0`, 133 tasks, 68 links, 26
    accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/BCK-002/bck-002-checker-20260802-001/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/BCK-002/bck-002-checker-20260802-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/BCK-002/bck-002-checker-20260802-001/checker-probe.txt`
  - `.omx/artifacts/typescript-bun/BCK-002/bck-002-checker-20260802-001/typecheck.txt`
  - `.omx/artifacts/typescript-bun/BCK-002/bck-002-checker-20260802-001/boundary-check.txt`
  - `.omx/artifacts/typescript-bun/BCK-002/bck-002-checker-20260802-001/focused-tests.txt`
  - `.omx/artifacts/typescript-bun/BCK-002/bck-002-checker-20260802-001/source-cursor-receipt.json`
  - `.omx/artifacts/typescript-bun/BCK-002/bck-002-checker-20260802-001/validation.json`
  - `.omx/artifacts/typescript-bun/BCK-002/bck-002-checker-20260802-001/verdict.json`
  - `.omx/artifacts/typescript-bun/BCK-002/bck-002-checker-20260802-001/plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/BCK-002/bck-002-checker-20260802-001/manifest.sha256`
- Accepted assertions:
  - All required configuration groups are readonly and recursively frozen.
  - Defaults are production `127.0.0.1:8765`, bounded queue/payload/retry, and
    exactly `30000 ms` for the Viewer request deadline; docs, debug tools, and
    remote telemetry default closed.
  - The startup token channel has only `kind`, inherited `fileDescriptor`,
    `encoding`, and `oneTime`; it has no plaintext token field or value.
  - Provider profiles have only public `id`, credential-free HTTP(S)
    `baseUrl`, `model`, and opaque `credentialRef`; credential fields and URL
    credentials/query values reject.
  - Invalid, unknown, non-loopback, out-of-range, production exposure, remote
    telemetry, and plaintext-secret configuration fails before listening.
  - Error text, JSON serialization, and Node inspection do not contain raw
    secret canaries. Only `main.ts` reads `process.env`; no production source
    reads `Bun.env`.
  - `createProcessApp` still starts no `Bun.serve` and no `Bun.spawn`/Python.
  - `BCK-002` is `DONE`; Phase 02 and only `BCK-003` are `READY`;
    `current_task=null`, `next_task=BCK-003`, and `same_blocker_attempts=0`.
- Limitations:
  - This acceptance does not claim BCK-003 token reading/consumption, auth,
    listen, health, readiness, or packaging/platform behavior.
  - No broad test, install, audit, build, parity/OpenAPI/full suite,
    dependency/lock mutation, Python oracle change/deletion, commit, push,
    deploy, Ultragoal ledger update, `BCK-003` work, or inspection of
    `output/` or `promo/` occurred.
- Related run log:
  - `bck-002-checker-20260802-001`

### BCK-003 / bck-003-checker-20260802-001

- Claim: The real Bun/Elysia process binds only the configured loopback,
  consumes a startup-scoped inherited credential, serves authenticated health,
  readiness, and version identity, normalizes safe request errors, and releases
  authentication, listeners, and child processes on stop/failure.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty source identity:
  `sha256:14b135b6357cf7a41221ba5516738bd737818eaf5690da6579bfddd599175a79`
- Date: 2026-08-02
- Environment: local Windows x64, branch `TS_backend_refactor`, Bun `1.3.14`
- Evidence class: `static`, `unit`, `platform_process`, `review`
- Maker run/context ID:
  `bck-003-maker-20260802-001` /
  `bck-003-maker-context-20260802-001`
- Checker run/context ID:
  `bck-003-checker-20260802-001` /
  `bck-003-checker-context-20260802-001`
- Checker parent run ID: `bck-003-maker-20260802-001`
- Checker participated in Maker implementation: `false`
- Reviewed source-state hash:
  `sha256:14b135b6357cf7a41221ba5516738bd737818eaf5690da6579bfddd599175a79`
- Commands/procedure:
  - Maker001 manifest current-hash check -> `31/31`
  - `bun run --cwd apps/backend-bun typecheck` -> exit `0`
  - `bun run --cwd apps/backend-bun check:boundaries` -> exit `0`, 20
    production sources
  - `bun run --cwd apps/backend-bun test:bck-003` -> exit `0`, five tests,
    39 assertions
  - Checker-owned Windows live process probe -> exit `0`, two real child
    starts on exact default `127.0.0.1:8765`, zero surviving PIDs
  - `bun run --cwd apps/backend-bun openapi:check` -> exit `0`, unchanged
    47-operation registry snapshot
  - `bun run migration:plan-check` -> exit `0`, 133 tasks, 68 links, 27
    accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/BCK-003/bck-003-checker-20260802-001/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/BCK-003/bck-003-checker-20260802-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/BCK-003/bck-003-checker-20260802-001/checker-probe.txt`
  - `.omx/artifacts/typescript-bun/BCK-003/bck-003-checker-20260802-001/typecheck.txt`
  - `.omx/artifacts/typescript-bun/BCK-003/bck-003-checker-20260802-001/boundary-check.txt`
  - `.omx/artifacts/typescript-bun/BCK-003/bck-003-checker-20260802-001/focused-tests.txt`
  - `.omx/artifacts/typescript-bun/BCK-003/bck-003-checker-20260802-001/openapi-check.txt`
  - `.omx/artifacts/typescript-bun/BCK-003/bck-003-checker-20260802-001/source-inspection.md`
  - `.omx/artifacts/typescript-bun/BCK-003/bck-003-checker-20260802-001/source-cursor-receipt.json`
  - `.omx/artifacts/typescript-bun/BCK-003/bck-003-checker-20260802-001/validation.json`
  - `.omx/artifacts/typescript-bun/BCK-003/bck-003-checker-20260802-001/verdict.json`
  - `.omx/artifacts/typescript-bun/BCK-003/bck-003-checker-20260802-001/plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/BCK-003/bck-003-checker-20260802-001/manifest.sha256`
- Accepted assertions:
  - Current configuration and runtime bind only `127.0.0.1` or `::1`; the
    production default was proven live at exact `127.0.0.1:8765`.
  - The current Windows-compatible default is inherited stdin fd0. A fresh
    opaque 43-character base64url token was delivered only on that pipe, never
    through environment, arguments, config, responses, errors, or logs.
  - Authenticated `/health`, `/ready`, and `/version` expose canonical liveness,
    exact readiness booleans, backend/protocol/schema/build identity, and safe
    generated/propagated request IDs.
  - Missing, malformed, stale, and cross-start credentials reject. Readiness
    exceptions, malformed startup credentials, and listener collision expose
    only normalized safe results without token, path, Provider model, or raw
    exception disclosure.
  - Stop clears in-memory authentication and releases the listener; restart
    rejects the old token, both real child PIDs exited, and default port 8765
    could be rebound.
  - `BCK-003` is `DONE`; Phase 02 and only `BCK-004` are `READY`;
    `current_task=null`, `next_task=BCK-004`, and `same_blocker_attempts=0`.
- Limitations:
  - Default readiness remains database-not-ready until planned persistence.
  - BCK-007 owns canonical control-route migration; BCK-010 owns full signal
    handling and exit-code lifecycle.
  - This is local Windows source-process evidence, not packaged-release,
    Electron-supervisor, credentialed Provider, or later backend behavior.
  - No broad suite, install, audit, build, dependency/lock mutation, Python
    oracle change/deletion, desktop work, commit, push, deploy, Ultragoal ledger
    update, `BCK-004` work, or inspection of `output/` or `promo/` occurred.
- Related run log:
  - `bck-003-checker-20260802-001`

### BCK-004 / bck-004-checker-20260802-001

- Claim: The Bun backend application layer defines the complete BCK-004 port
  surface with explicit typed boundaries for time, IDs, cancellation, events,
  repositories/transactions, Providers, telemetry, and shutdown.
- Status: `DONE`
- Evidence class: `static`, `unit`, `review`
- Maker run/context ID:
  `bck-004-maker-20260802-001` /
  `bck-004-maker-context-20260802-001`
- Checker run/context ID:
  `bck-004-checker-20260802-001` /
  `bck-004-checker-context-20260802-001`
- Checker parent run ID: `bck-004-maker-20260802-001`
- Checker participated in Maker implementation: `false`
- Reviewed source-state hash:
  `sha256:f72dbff44587eb47a779083a8541c8cfd313d75307fc47197a63cf48db33e1bb`
- Commands/procedure:
  - Maker manifest comparison -> 24/24 current hashes, zero mismatches
  - `bun run --cwd apps/backend-bun typecheck` -> exit `0`
  - `bun run --cwd apps/backend-bun check:boundaries` -> exit `0`, 29
    production sources
  - `bun run --cwd apps/backend-bun test:bck-004` -> exit `0`, four tests,
    23 assertions
  - Checker-owned strict TypeScript compile probe -> exit `0`
  - Checker-owned Bun runtime/source probe -> exit `0`
  - final `bun run migration:plan-check` -> exit `0`, 133 tasks, 68 links,
    28 accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/BCK-004/bck-004-checker-20260802-001/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/BCK-004/bck-004-checker-20260802-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/BCK-004/bck-004-checker-20260802-001/checker-probe.txt`
  - `.omx/artifacts/typescript-bun/BCK-004/bck-004-checker-20260802-001/checker-probe-compile.txt`
  - `.omx/artifacts/typescript-bun/BCK-004/bck-004-checker-20260802-001/typecheck.txt`
  - `.omx/artifacts/typescript-bun/BCK-004/bck-004-checker-20260802-001/boundary-check.txt`
  - `.omx/artifacts/typescript-bun/BCK-004/bck-004-checker-20260802-001/focused-tests.txt`
  - `.omx/artifacts/typescript-bun/BCK-004/bck-004-checker-20260802-001/source-inspection.md`
  - `.omx/artifacts/typescript-bun/BCK-004/bck-004-checker-20260802-001/source-cursor-receipt.json`
  - `.omx/artifacts/typescript-bun/BCK-004/bck-004-checker-20260802-001/validation.json`
  - `.omx/artifacts/typescript-bun/BCK-004/bck-004-checker-20260802-001/verdict.json`
  - `.omx/artifacts/typescript-bun/BCK-004/bck-004-checker-20260802-001/plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/BCK-004/bck-004-checker-20260802-001/manifest.sha256`
- Accepted assertions:
  - Wall and monotonic timestamps remain distinct branded types; deterministic
    clocks and generic typed ID generators inject independently.
  - Task handles provide caller-controlled cooperative cancellation with a
    typed reason, and task scopes expose awaitable drain.
  - Typed application events publish through a safe-JSON envelope.
  - Runtime-spec, Room, and Session repositories require explicit branded
    transaction context; the boundary passes the same context to all three.
  - ASR/model calls require caller-owned `AbortSignal` plus monotonic deadline;
    serializable Provider shapes expose no credential/apiKey/token/secret/
    password field.
  - Trace/log ports expose only bounded structured correlation/status/count/
    duration/error fields, not raw prompts, media, responses, paths, arbitrary
    metadata, or credentials.
  - Shutdown notification is idempotent and awaitable.
  - Production application sources import neither infrastructure nor Provider
    implementations and contain no generic service locator or string-indexed
    dependency bag.
  - `BCK-004` is `DONE`; Phase 02 and only `BCK-005` are `READY`;
    `current_task=null`, `next_task=BCK-005`, and `same_blocker_attempts=0`.
- Limitations:
  - BCK-005 owns room/session lifecycle operations and parity.
  - Adapters, Provider implementations, persistence behavior, and process
    signal wiring remain downstream work.
  - No broad suite, install, audit, build, dependency/lock mutation, Python
    oracle change/deletion, downstream task, commit, push, deploy, Ultragoal
    ledger update, or inspection of `output/` or `promo/` occurred.
- Related run log:
  - `bck-004-checker-20260802-001`

### BCK-005 / bck-005-checker-20260802-001

- Claim: The Bun backend application layer owns a deterministic Room/Session
  lifecycle with stable identity, epoch/revision fencing, legal recovery,
  immutable state publication, and terminal resource release.
- Status: `DONE`
- Evidence class: `static`, `unit`, `deterministic`, `review`
- Maker run/context ID:
  `bck-005-maker-20260802-001` /
  `bck-005-maker-context-20260802-001`
- Checker run/context ID:
  `bck-005-checker-20260802-001` /
  `bck-005-checker-context-20260802-001`
- Checker parent run ID: `bck-005-maker-20260802-001`
- Checker participated in Maker implementation: `false`
- Reviewed source-state hash:
  `sha256:5762691216c048387615059f17b90a5e5217348867998a27e157e0f57dff095b`
- Commands/procedure:
  - Maker manifest comparison -> 20/20 current hashes, zero mismatches
  - `bun run --cwd apps/backend-bun typecheck` -> exit `0`
  - `bun run --cwd apps/backend-bun check:boundaries` -> exit `0`, 32
    production sources
  - `bun run --cwd apps/backend-bun test:bck-005` -> exit `0`, five tests,
    57 assertions
  - Checker-owned Bun runtime probe -> exit `0`
  - bounded source/scope inspection -> zero BCK-006, persistence, Provider
    generation, HTTP, or WebSocket implementation in BCK-005 sources
  - final `bun run migration:plan-check` -> exit `0`, 133 tasks, 68 links,
    29 accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/BCK-005/bck-005-checker-20260802-001/runtime-probe.ts`
  - `.omx/artifacts/typescript-bun/BCK-005/bck-005-checker-20260802-001/runtime-probe-output.json`
  - `.omx/artifacts/typescript-bun/BCK-005/bck-005-checker-20260802-001/typecheck.txt`
  - `.omx/artifacts/typescript-bun/BCK-005/bck-005-checker-20260802-001/boundary-check.txt`
  - `.omx/artifacts/typescript-bun/BCK-005/bck-005-checker-20260802-001/focused-tests.txt`
  - `.omx/artifacts/typescript-bun/BCK-005/bck-005-checker-20260802-001/source-inspection.md`
  - `.omx/artifacts/typescript-bun/BCK-005/bck-005-checker-20260802-001/source-cursor-receipt.json`
  - `.omx/artifacts/typescript-bun/BCK-005/bck-005-checker-20260802-001/validation.json`
  - `.omx/artifacts/typescript-bun/BCK-005/bck-005-checker-20260802-001/verdict.json`
  - `.omx/artifacts/typescript-bun/BCK-005/bck-005-checker-20260802-001/plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/BCK-005/bck-005-checker-20260802-001/manifest.sha256`
- Accepted assertions:
  - The accepted public SessionState remains exactly `idle`, `starting`,
    `running`, `paused`, `stopping`, and `error`; the migration-owned internal
    graph adds only `stopped`, `degraded`, and `failed` as required.
  - One Room ID and one logical Session ID remain stable. The initial audience
    epoch is one and eligible in-process/restored recovery preserves the
    Session ID while advancing the epoch.
  - Exact client-start identity replay is idempotent; a conflicting fingerprint
    fails closed with zero publisher, resource, or task-scope effects.
  - Pause, resume, degrade, fail, recover, and stop reject wrong/stale command
    identity or revision before side effects, and transition legality is closed.
  - Only explicitly recoverable degraded/failed nonterminal snapshots may be
    restored; stale work is cancelled and drained before a fresh scope runs.
  - Snapshots, events, and payloads are frozen; revisions and event IDs are
    ordered; normalized lifecycle errors do not disclose raw failures.
  - Stop attempts `stopping`, cancellation, drain, exactly-once release, then
    `stopped` even when publication, drain, and release fail; it remains
    terminal and repeated stop has zero effects.
  - `BCK-005` is `DONE`; Phase 02 and only `BCK-006` are `READY`;
    `current_task=null`, `next_task=BCK-006`, and `same_blocker_attempts=0`.
- Limitations:
  - BCK-006 owns runtime-spec validation, atomic apply/rollback, and wave-boundary
    epoch fencing.
  - Persistence adapters, transport exposure, Provider generation, process
    integration, and Python parity remain downstream work.
  - No broad suite, install, audit, build, dependency/lock mutation, Python
    oracle change/deletion, downstream task, commit, push, deploy, Ultragoal
    ledger update, or inspection of `output/` or `promo/` occurred.
- Related run log:
  - `bck-005-checker-20260802-001`

### BCK-006 / bck-006-checker-20260802-002

- Claim: Runtime-spec validate/apply/rollback is canonical, atomic, monotonic,
  epoch-fenced, and binds each `apply_id` to its exact operation and rollback
  target while preserving exact-command idempotency.
- Status: `DONE`
- Evidence class: `static`, `unit`, `deterministic`, `review`
- Maker run/context ID:
  `bck-006-maker-20260802-002` /
  `bck-006-maker-context-20260802-002`
- Checker run/context ID:
  `bck-006-checker-20260802-002` /
  `bck-006-checker-context-20260802-002`
- Checker parent run ID: `bck-006-maker-20260802-002`
- Checker participated in Maker implementation: `false`
- Reviewed source-state hash:
  `sha256:60c85b5a3fcad97dacb1f9ae520d1d1b9ed123b8d2fff58b0e97a8dc27f5b513`
- Commands/procedure:
  - Recovery Maker002 manifest comparison -> 19/19 current hashes, zero
    mismatches
  - `pnpm --filter @advx/backend-bun typecheck` -> exit `0`
  - `pnpm --filter @advx/backend-bun check:boundaries` -> exit `0`, 34
    production sources
  - `pnpm --filter @advx/backend-bun test:bck-006` -> exit `0`, nine tests,
    85 assertions
  - Checker-owned Bun runtime probe -> exit `0`, both original aliases reject
    and both exact replays remain idempotent
  - bounded source/current-hash inspection -> operation and exact nullable
    target persist and match before content; prior atomicity/failure/epoch/fence
    boundaries remain present
  - final `bun run migration:plan-check` -> exit `0`, 133 tasks, 68 links,
    30 accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/BCK-006/bck-006-checker-20260802-002/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/BCK-006/bck-006-checker-20260802-002/checker-probe.json`
  - `.omx/artifacts/typescript-bun/BCK-006/bck-006-checker-20260802-002/manifest-check.json`
  - `.omx/artifacts/typescript-bun/BCK-006/bck-006-checker-20260802-002/typecheck.txt`
  - `.omx/artifacts/typescript-bun/BCK-006/bck-006-checker-20260802-002/boundary-check.txt`
  - `.omx/artifacts/typescript-bun/BCK-006/bck-006-checker-20260802-002/focused-tests.txt`
  - `.omx/artifacts/typescript-bun/BCK-006/bck-006-checker-20260802-002/source-inspection.md`
  - `.omx/artifacts/typescript-bun/BCK-006/bck-006-checker-20260802-002/source-cursor-receipt.json`
  - `.omx/artifacts/typescript-bun/BCK-006/bck-006-checker-20260802-002/validation.json`
  - `.omx/artifacts/typescript-bun/BCK-006/bck-006-checker-20260802-002/verdict.md`
  - `.omx/artifacts/typescript-bun/BCK-006/bck-006-checker-20260802-002/plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/BCK-006/bck-006-checker-20260802-002/manifest.sha256.json`
- Accepted assertions:
  - Every revision persists `bootstrap`, `apply`, or `rollback` plus an exact
    rollback target revision or `null`.
  - Existing apply-ID matching checks operation and exact target before
    canonical content; cross-operation and changed-target reuse both fail with
    `apply_id_conflict` even when canonical bytes match.
  - Exact same apply and exact same rollback target replay return the original
    record without another revision or epoch advance.
  - The previously accepted canonical validation, pending/committed visibility,
    atomic wave cutover, failure retention, monotonic revision/epoch, rollback,
    bounded diff, and stale-work fence behavior remains covered by the focused
    tests and current source boundaries.
  - `BCK-006` is `DONE`; Phase 02 and only `BCK-007` are `READY`;
    `current_task=null`, `next_task=BCK-007`, and `same_blocker_attempts=0`.
- Limitations:
  - BCK-007 owns canonical Elysia control routes; persistence, WebSocket/binary
    transport, process integration, and Python parity remain downstream.
  - No broad suite, install, audit, build, dependency/lock mutation, Python
    oracle change/deletion, downstream task, commit, push, deploy, Ultragoal
    ledger update, or inspection of `output/` or `promo/` occurred.
- Related run log:
  - `bck-006-checker-20260802-002`

### BCK-007 / bck-007-checker-20260803-003

- Claim: Authenticated Elysia control routes use canonical request/response
  schemas, delegate through the Bun application layer, and preserve canonical
  HTTP status and normalized error-code parity for Session/runtime control.
- Status: `DONE`
- Evidence class: `static`, `unit`, `integration`, `deterministic`, `review`
- Maker run/context ID:
  `bck-007-maker-20260803-002` /
  `bck-007-maker-context-20260803-002`
- Checker run/context ID:
  `bck-007-checker-20260803-003` /
  `bck-007-checker-context-20260803-003`
- Checker parent run ID: `bck-007-maker-20260803-002`
- Checker participated in Maker implementation: `false`
- Reviewed source-state hash:
  `sha256:27bec92f85d412e3009eb8adeec2a96a2ca37aab3d3873006bcf28162dc2d373`
- Commands/procedure:
  - Recovery Maker002 manifest comparison -> 22/22 current hashes, zero
    mismatches
  - `bun run --cwd apps/backend-bun typecheck` -> exit `0`
  - `bun run --cwd apps/backend-bun check:boundaries` -> exit `0`, 36
    production sources
  - `bun run --cwd apps/backend-bun test:bck-007` -> exit `0`, five tests,
    51 assertions
  - Checker001 exact blocker probe -> exit `0`, wrong-Room apply returns
    `422 runtime_apply_rejected`
  - Checker-owned mapping probe -> exit `0`, apply wrong-Room is 422 while
    wrong Session, missing Session query, and non-apply wrong-Room are 404
  - `bun run --cwd apps/backend-bun openapi:check` -> exit `0`, 47 operations
  - final `bun scripts/migration-plan-check.ts` -> exit `0`, 133 tasks, 68
    links, 31 accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/BCK-007/bck-007-checker-20260803-003/manifest-check.json`
  - `.omx/artifacts/typescript-bun/BCK-007/bck-007-checker-20260803-003/typecheck.txt`
  - `.omx/artifacts/typescript-bun/BCK-007/bck-007-checker-20260803-003/boundary-check.txt`
  - `.omx/artifacts/typescript-bun/BCK-007/bck-007-checker-20260803-003/focused-tests.txt`
  - `.omx/artifacts/typescript-bun/BCK-007/bck-007-checker-20260803-003/checker001-probe.txt`
  - `.omx/artifacts/typescript-bun/BCK-007/bck-007-checker-20260803-003/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/BCK-007/bck-007-checker-20260803-003/checker-probe.json`
  - `.omx/artifacts/typescript-bun/BCK-007/bck-007-checker-20260803-003/openapi-check.txt`
  - `.omx/artifacts/typescript-bun/BCK-007/bck-007-checker-20260803-003/source-inspection.md`
  - `.omx/artifacts/typescript-bun/BCK-007/bck-007-checker-20260803-003/source-cursor-receipt.json`
  - `.omx/artifacts/typescript-bun/BCK-007/bck-007-checker-20260803-003/validation.json`
  - `.omx/artifacts/typescript-bun/BCK-007/bck-007-checker-20260803-003/verdict.md`
  - `.omx/artifacts/typescript-bun/BCK-007/bck-007-checker-20260803-003/plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/BCK-007/bck-007-checker-20260803-003/manifest.sha256.json`
- Accepted assertions:
  - Control routes authenticate and enforce their canonical protocol version
    before parsing or starting work, and emit bounded normalized errors.
  - Canonical path/body/success schemas guard the legacy Session and runtime
    Session start/current/apply/rollback/recover surface; handlers remain thin
    and delegate lifecycle/spec work through application-owned operations.
  - A schema-valid runtime apply candidate belonging to another Room returns
    canonical `422 runtime_apply_rejected`, not a false missing-Session result.
  - Coordinator `wrong_session`, a genuine missing Session query, and
    non-apply coordinator `wrong_room` retain
    `404 runtime_session_not_found`; the recovery is operation-narrow.
  - The canonical public six-state `SessionState`, all 47 OpenAPI operations,
    and previously accepted BCK-003/BCK-005/BCK-006 boundaries remain intact.
  - `BCK-007` is `DONE`; Phase 02 and only `BCK-008` are `READY`;
    `current_task=null`, `next_task=BCK-008`, and
    `same_blocker_attempts=0`.
- Limitations:
  - BCK-008/BCK-009 own WebSocket and binary ingest; durable persistence,
    process lifecycle, desktop supervision, and Python-oracle vertical-slice
    parity remain downstream tasks.
  - The process composition continues to report normalized runtime persistence
    unavailable until a concrete runtime-control kernel adapter is injected.
  - No broad suite, install, audit, build, dependency/lock mutation, Python
    oracle change/deletion, downstream task, commit, push, deploy, Ultragoal
    ledger update, or inspection of `output/` or `promo/` occurred.
- Related run log:
  - `bck-007-checker-20260803-003`

### BCK-008 / bck-008-checker-20260803-003

- Claim: The Bun backend exposes an authenticated, version-negotiated,
  bounded WebSocket hub whose safe handshake rejects invalid legacy and
  canonical credentials before Session application work while retaining
  connection, publication, restart, slow-consumer, and shutdown semantics.
- Status: `DONE`
- Evidence class: `static`, `unit`, `integration`, `deterministic`, `security`,
  `review`
- Maker run/context ID:
  `bck-008-maker-20260803-002` /
  `bck-008-maker-context-20260803-002`
- Checker run/context ID:
  `bck-008-checker-20260803-003` /
  `bck-008-checker-context-20260803-003`
- Checker parent run ID: `bck-008-maker-20260803-002`
- Checker participated in Maker implementation: `false`
- Reviewed source-state hash:
  `sha256:ad3985e4cbbd3300e4325dd7d574cbd4bccb629f4fd227aba823f91a07fdcb34`
- Commands/procedure:
  - Recovery Maker002 manifest comparison -> 24/24 current hashes, zero
    mismatches
  - `bun run --cwd apps/backend-bun typecheck` -> exit `0`
  - `bun run --cwd apps/backend-bun check:boundaries` -> exit `0`, 39
    production sources
  - `bun run --cwd apps/backend-bun test:bck-008` -> exit `0`, six tests,
    58 assertions
  - Checker002 exact blocker probe -> exit `0`, zero Session reads,
    `authentication_failed`, close `4401`, no serialized canary
  - `bun run --cwd apps/backend-bun test:bck-003` -> exit `0`, five tests,
    39 assertions
  - three named CON-010 negotiation/restart tests -> exit `0`, three tests,
    nine assertions
  - final `bun scripts/migration-plan-check.ts` -> exit `0`, 133 tasks, 68
    links, 32 accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/BCK-008/bck-008-checker-20260803-003/manifest-check.json`
  - `.omx/artifacts/typescript-bun/BCK-008/bck-008-checker-20260803-003/typecheck.txt`
  - `.omx/artifacts/typescript-bun/BCK-008/bck-008-checker-20260803-003/boundary-check.txt`
  - `.omx/artifacts/typescript-bun/BCK-008/bck-008-checker-20260803-003/focused-tests.txt`
  - `.omx/artifacts/typescript-bun/BCK-008/bck-008-checker-20260803-003/checker002-probe.json`
  - `.omx/artifacts/typescript-bun/BCK-008/bck-008-checker-20260803-003/bck-003-regression.txt`
  - `.omx/artifacts/typescript-bun/BCK-008/bck-008-checker-20260803-003/protocol-check.txt`
  - `.omx/artifacts/typescript-bun/BCK-008/bck-008-checker-20260803-003/process-cleanup.json`
  - `.omx/artifacts/typescript-bun/BCK-008/bck-008-checker-20260803-003/source-inspection.md`
  - `.omx/artifacts/typescript-bun/BCK-008/bck-008-checker-20260803-003/source-cursor-receipt.json`
  - `.omx/artifacts/typescript-bun/BCK-008/bck-008-checker-20260803-003/validation.json`
  - `.omx/artifacts/typescript-bun/BCK-008/bck-008-checker-20260803-003/verdict.md`
  - `.omx/artifacts/typescript-bun/BCK-008/bck-008-checker-20260803-003/plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/BCK-008/bck-008-checker-20260803-003/manifest.sha256.json`
- Accepted assertions:
  - Safe unsupported-version, schema, and message-type checks occur before
    credential acceptance, while credential acceptance occurs before the first
    Session read.
  - Invalid legacy hello tokens and canonical Authorization headers each call
    authorization once, perform zero Session reads, emit
    `authentication_failed`, close `4401`, and reveal no reader canary.
  - A genuine Session-reader failure after valid authentication remains
    redacted and closes `1011`, preserving the intended post-auth failure class.
  - Authenticated v3/v4 negotiation, backend-start plus desktop-client identity,
    bounded connections/queues/payloads, typed publication, heartbeat timeout,
    duplicate replacement, restart/reconnect, slow-consumer closure, shutdown
    notification, and listener cleanup remain covered.
  - `BCK-008` is `DONE`; Phase 02 and only `BCK-009` are `READY`;
    `current_task=null`, `next_task=BCK-009`, and
    `same_blocker_attempts=0`.
- Limitations:
  - BCK-009 owns binary frame decoding and ingest dispatch; binary frames still
    receive bounded `pipeline_unavailable` rejection.
  - Durable persistence, full process lifecycle, desktop supervision, and
    Python-oracle vertical-slice parity remain downstream tasks.
  - No product repair, broad suite, install, audit, build, dependency/lock
    mutation, Python oracle change/deletion, downstream task, commit, push,
    deploy, Ultragoal ledger update, subagent delegation by this Checker, or
    content inspection of `output/` or `promo/` occurred.
- Related run log:
  - `bck-008-checker-20260803-003`

### BCK-009 / bck-009-checker-20260803-001

- Claim: The authenticated Bun realtime hub decodes accepted binary
  audio/frame envelopes and dispatches typed commands through a bounded
  application service with active-Session, source-lifecycle, size, and
  backpressure gates before effects.
- Status: `DONE`
- Evidence class: `static`, `unit`, `integration`, `deterministic`, `protocol`,
  `security`, `review`
- Maker run/context ID:
  `bck-009-maker-20260803-001` /
  `bck-009-maker-context-20260803-001`
- Checker run/context ID:
  `bck-009-checker-20260803-001` /
  `bck-009-checker-context-20260803-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Reviewed source-state hash:
  `sha256:2739b386f2fac84e62be537c7ad1d3879b5e2eb0ed0eff5790b70eaa13c4234d`
- Commands/procedure:
  - Maker manifest comparison -> 29/29 current hashes, zero mismatches
  - `bun run --cwd apps/backend-bun typecheck` -> exit `0`
  - `bun run --cwd apps/backend-bun check:boundaries` -> exit `0`, 41
    production sources
  - `bun run --cwd apps/backend-bun test:bck-009` -> exit `0`, five tests,
    30 assertions
  - `bun run --cwd apps/backend-bun test:bck-008` -> exit `0`, six tests,
    58 assertions
  - compact Checker real-WebSocket offset/default-sink probe -> exit `0`
  - final `bun scripts/migration-plan-check.ts` -> exit `0`, 133 tasks, 68
    links, 33 accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/BCK-009/bck-009-checker-20260803-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/BCK-009/bck-009-checker-20260803-001/typecheck.txt`
  - `.omx/artifacts/typescript-bun/BCK-009/bck-009-checker-20260803-001/boundary-check.txt`
  - `.omx/artifacts/typescript-bun/BCK-009/bck-009-checker-20260803-001/focused-tests.txt`
  - `.omx/artifacts/typescript-bun/BCK-009/bck-009-checker-20260803-001/bck-008-regression.txt`
  - `.omx/artifacts/typescript-bun/BCK-009/bck-009-checker-20260803-001/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/BCK-009/bck-009-checker-20260803-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/BCK-009/bck-009-checker-20260803-001/process-cleanup.json`
  - `.omx/artifacts/typescript-bun/BCK-009/bck-009-checker-20260803-001/source-inspection.md`
  - `.omx/artifacts/typescript-bun/BCK-009/bck-009-checker-20260803-001/source-cursor-receipt.json`
  - `.omx/artifacts/typescript-bun/BCK-009/bck-009-checker-20260803-001/validation.json`
  - `.omx/artifacts/typescript-bun/BCK-009/bck-009-checker-20260803-001/verdict.md`
  - `.omx/artifacts/typescript-bun/BCK-009/bck-009-checker-20260803-001/plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/BCK-009/bck-009-checker-20260803-001/manifest.sha256.json`
- Accepted assertions:
  - The hub uses the accepted `@advx/contracts` decoder and exact view bounds;
    API transport wiring remains thin and bounded.
  - Negotiated realtime v4 accepts only binary v3; realtime v3 accepts only
    binary v1/v2. Incompatible versions reject before sink effects.
  - Valid audio/image bodies become typed application commands. Current v3
    audio acknowledges `committed`; legacy audio and frames acknowledge
    `received` in canonical or Python-compatible legacy wire form.
  - Unsupported version/type/source, truncated headers, declared-length
    mismatch, oversized payload, stale Session, stopped audio, ended capture,
    and capacity flood cases produce stable bounded rejections with no invalid
    sink effect.
  - Media bodies are non-enumerable on commands and absent from ordinary JSON
    errors, logs, traces, and evidence. The default unavailable sink rejects
    honestly instead of fabricating downstream success.
  - `BCK-009` is `DONE`; Phase 02 and only `BCK-010` are `READY`;
    `current_task=null`, `next_task=BCK-010`, and
    `same_blocker_attempts=0`.
- Limitations:
  - BCK-010 owns full process signal/startup/shutdown/exit behavior; durable
    persistence, desktop supervision, and Python-oracle vertical-slice parity
    remain downstream tasks.
  - No broad suite, install, audit, build, dependency/lock mutation, Python
    oracle change/deletion, downstream task, commit, push, deploy, Ultragoal
    ledger update, subagent delegation by this Checker, or inspection of
    `output/` or `promo/` occurred.
- Related run log:
  - `bck-009-checker-20260803-001`

### BCK-010 / bck-010-checker-20260803-001

- Claim: The Bun backend process has deterministic boot/readiness and a
  parent-, signal-, and IPC-aware once-only shutdown lifecycle with bounded
  cleanup, forced-exit fallback, stable exit codes, port release, and no
  orphaned process after Electron supervision disappears.
- Status: `DONE`
- Evidence class: `static`, `unit`, `integration`, `process`, `deterministic`,
  `security`, `review`
- Maker run/context ID:
  `bck-010-maker-20260803-003` /
  `bck-010-maker-context-20260803-003`
- Checker run/context ID:
  `bck-010-checker-20260803-001` /
  `bck-010-checker-context-20260803-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Reviewed source-state hash:
  `sha256:13a93173cc6378a7be69b39ab5eff5fce66cfc25f1ea75dfbeebaa060f1d66b1`
- Commands/procedure:
  - Recovery Maker003 manifest comparison -> 32/32 current hashes, zero
    mismatches
  - `bun run --cwd apps/backend-bun typecheck` -> exit `0`
  - `bun run --cwd apps/backend-bun check:boundaries` -> exit `0`, 43 sources
  - `bun run --cwd apps/backend-bun test:bck-010` -> exit `0`, six tests,
    60 assertions
  - `bun run --cwd apps/backend-bun test:bck-003` -> exit `0`, five tests,
    39 assertions
  - Recovery Maker003 real process smoke -> exit `0`, authenticated health,
    clean IPC exit, port release, zero descendants, zero sensitive leaks
  - compact Checker real parent-loss probe -> exit `0`, backend exit code `0`
    in 710 ms, port released, zero descendants, zero token leak
  - final `bun scripts/migration-plan-check.ts` -> exit `0`, 133 tasks, 68
    links, 34 accepted evidence records, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/BCK-010/bck-010-checker-20260803-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/BCK-010/bck-010-checker-20260803-001/typecheck.txt`
  - `.omx/artifacts/typescript-bun/BCK-010/bck-010-checker-20260803-001/boundary-check.txt`
  - `.omx/artifacts/typescript-bun/BCK-010/bck-010-checker-20260803-001/focused-tests.txt`
  - `.omx/artifacts/typescript-bun/BCK-010/bck-010-checker-20260803-001/bck-003-regression.txt`
  - `.omx/artifacts/typescript-bun/BCK-010/bck-010-checker-20260803-001/process-smoke.json`
  - `.omx/artifacts/typescript-bun/BCK-010/bck-010-checker-20260803-001/parent-loss-controller.ts`
  - `.omx/artifacts/typescript-bun/BCK-010/bck-010-checker-20260803-001/parent-loss-probe.ts`
  - `.omx/artifacts/typescript-bun/BCK-010/bck-010-checker-20260803-001/parent-loss-probe.json`
  - `.omx/artifacts/typescript-bun/BCK-010/bck-010-checker-20260803-001/process-cleanup.json`
  - `.omx/artifacts/typescript-bun/BCK-010/bck-010-checker-20260803-001/source-inspection.md`
  - `.omx/artifacts/typescript-bun/BCK-010/bck-010-checker-20260803-001/source-cursor-receipt.json`
  - `.omx/artifacts/typescript-bun/BCK-010/bck-010-checker-20260803-001/validation.json`
  - `.omx/artifacts/typescript-bun/BCK-010/bck-010-checker-20260803-001/verdict.md`
  - `.omx/artifacts/typescript-bun/BCK-010/bck-010-checker-20260803-001/plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/BCK-010/bck-010-checker-20260803-001/manifest.sha256.json`
- Accepted assertions:
  - Importing `main.ts` starts no listener/process or signal/control handler;
    `import.meta.main` is the only real-process entry.
  - Config/token/composition precede resource initialization, listener bind,
    real listener health, and ready publication. Supervision is installed
    before every asynchronous stage and races non-cooperative boot work.
  - The first signal, valid IPC message, parent loss, programmatic request, or
    startup failure owns one shutdown. Task scopes cancel/drain before
    WebSocket/listener close, then database flush/close and trace/log flush.
  - Cleanup continues after failures. One global deadline attempts remaining
    boundaries and forces stable exit `22`; clean/startup/cleanup exits remain
    `0`, `20`, and `21`.
  - A real child publishes ready only after bound health, accepts authenticated
    health and IPC shutdown, exits zero, releases its port, leaves no
    descendants, and leaks no credentials or raw failure detail.
  - A separate real parent-loss probe proves the backend exits independently
    within 710 ms after its actual supervisor dies, with exit code zero, port
    release, zero descendants, and no token leak.
  - `BCK-010` is `DONE`; Phase 02 and only `BCK-011` are `READY`;
    `current_task=null`, `next_task=BCK-011`, and
    `same_blocker_attempts=0`.
- Limitations:
  - BCK-011 owns recorded control/Session comparison with the retained Python
    oracle; persistence, desktop supervision integration, and packaged-runtime
    lifecycle remain downstream tasks.
  - No broad suite, install, audit, build, dependency/lock mutation, Python
    oracle change/deletion, downstream task, commit, push, deploy, Ultragoal
    ledger update, subagent delegation by this Checker, or inspection of
    `output/` or `promo/` occurred.
- Related run log:
  - `bck-010-checker-20260803-001`

### BCK-011 / bck-011-checker-20260803-001

- Claim: The real Bun backend matches the retained Python oracle for the
  authenticated Control/Session vertical slice, including state, revision,
  epoch, event, error, identity, and final process-resource behavior.
- Status: `DONE`
- Evidence class: `static`, `integration`, `process`, `deterministic`,
  `security`, `parity`, `review`
- Maker run/context ID:
  `bck-011-maker-20260803-001` /
  `bck-011-maker-context-20260803-001`
- Checker run/context ID:
  `bck-011-checker-20260803-001` /
  `bck-011-checker-context-20260803-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Reviewed source-state hash:
  `sha256:8c9ddd5eae4c225cc18caf4db825bba4d467343db74bbacd1ec2be6fc7fb8c9b`
- Commands/procedure:
  - Maker manifest comparison -> 17/17 current hashes, zero mismatches
  - `bun run --filter @advx/backend-bun typecheck` -> exit `0`
  - `bun run --filter @advx/backend-bun check:boundaries` -> exit `0`, 44
    sources
  - `uv run --project apps/backend ruff check tests/parity/python_control_session_server.py`
    -> exit `0`
  - Checker-owned `bun run test:bck-011` with an artifact-local report path ->
    exit `0`, ten HTTP stages and seven realtime messages per backend, zero
    normalized diffs
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/BCK-011/bck-011-checker-20260803-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/BCK-011/bck-011-checker-20260803-001/control-session-parity.json`
  - `.omx/artifacts/typescript-bun/BCK-011/bck-011-checker-20260803-001/source-inspection.md`
  - `.omx/artifacts/typescript-bun/BCK-011/bck-011-checker-20260803-001/validation.json`
  - `.omx/artifacts/typescript-bun/BCK-011/bck-011-checker-20260803-001/verdict.md`
  - `.omx/artifacts/typescript-bun/BCK-011/bck-011-checker-20260803-001/plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/BCK-011/bck-011-checker-20260803-001/manifest.sha256.json`
- Accepted assertions:
  - The retained Python adapter composes the actual Python runtime and installs
    only the fixed synthetic Provider profile; the Bun child runs the real
    `main.ts` process entry with its startup token on inherited stdin.
  - Both real backends authenticate and complete health, start, snapshot,
    invalid apply validation, apply, pause, resume, rollback, stop, and final
    idle state with matching HTTP status/error and retained semantic fields.
  - Normalization is limited to genuine volatile or legacy-derived identity
    fields. Runtime spec/config hash/revision, Room/Session state/revision,
    audience epoch, apply/rollback identity, event order/state/revision, and
    final resources remain compared. Viewer-pool fields alone remain owned by
    `AGT-007` and are retained in raw evidence.
  - Each backend emits seven matching realtime messages: ready/idle revision 0,
    then starting 1, running 2, paused 3, running 4, stopping 5, and idle 6.
  - Both processes exit zero, release their distinct loopback ports, leave zero
    descendants after stop, remove isolated temporary data, and leak no token,
    temporary path, or traceback.
  - `BCK-011` is `DONE`; Phase 02 and only `GATE-02` are `READY`;
    `current_task=null`, `next_task=GATE-02`, and
    `same_blocker_attempts=0`. `GATE-02` was not started.
- Limitations:
  - Viewer-pool membership and `diff.*_viewer_ids` remain explicitly downstream
    under `AGT-007`; durable persistence and desktop supervision remain their
    planned phase boundaries.
  - No product/test repair, broad suite, install, audit, build, dependency/lock
    mutation, Python oracle deletion or product Python edit, prior-task rerun,
    downstream task, commit, push, deploy, aggregate-goal or Ultragoal update,
    subagent/delegation, or inspection of `output/` or `promo/` occurred.
- Related run log:
  - `bck-011-checker-20260803-001`

### GATE-02 / gate-02-checker-root-20260803-001

- Claim: The current Bun backend shell satisfies all eight Phase 02 exit
  criteria and may release the data-persistence phase without reopening
  accepted `BCK-001..011` proof.
- Status: `DONE`
- Evidence class: `static`, `integration`, `security`, `review`
- Maker run/context ID:
  `gate-02-maker-20260803-002` /
  `gate-02-maker-context-20260803-002`
- Checker run/context ID:
  `gate-02-checker-root-20260803-001` /
  `gate-02-checker-root-context-20260803-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:a62a3451aa440b2843888bb6af7d8844f5be0f506d5904faf02cc7d86075f86e`
- Reviewed production-source aggregate:
  `sha256:a62a3451aa440b2843888bb6af7d8844f5be0f506d5904faf02cc7d86075f86e`
- Commands/procedure:
  - Accepted dependency receipt comparison -> 22/22 hashes, zero mismatches
  - Protected boundary comparison -> 5/5 hashes, zero mismatches
  - Production source aggregation -> 44 sources, exact Maker aggregate
  - `bun run --filter @advx/backend-bun typecheck` -> exit `0`
  - `bun run --filter @advx/backend-bun check:boundaries` -> exit `0`, 44
    sources
  - `bun run --filter @advx/backend-bun test:bck-003` -> exit `0`, five tests,
    39 assertions
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/GATE-02/gate-02-checker-root-20260803-001/validation.json`
  - `.omx/artifacts/typescript-bun/GATE-02/gate-02-checker-root-20260803-001/verdict.md`
  - `.omx/artifacts/typescript-bun/GATE-02/gate-02-checker-root-20260803-001/manifest.sha256.json`
  - `.omx/artifacts/typescript-bun/GATE-02/gate-02-checker-root-20260803-001/plan-check-final.json`
- Accepted assertions:
  - All 11 dependencies are `DONE`; their 22 accepted validation/verdict hashes
    and five protected source/lock/oracle hashes remain exact.
  - The current 44-file production tree matches the Maker aggregate exactly.
  - Dependency direction, fail-closed configuration, loopback authentication,
    system probes, lifecycle parity, bounded realtime/binary ingest, process
    cleanup, and application-port routing remain covered by accepted evidence.
  - Fresh targeted current-state checks pass, including the real process-entry
    BCK-003 case; no broad proof matrix was repeated.
  - `GATE-02` and Phase 02 are `DONE`; Phase 03 and only `DAT-001` are `READY`.
- Limitations:
  - The Checker is the primary root under explicit human no-subagent authority,
    not a Terra leaf. It is still a separate run/context from Recovery Maker002
    and did not participate in Maker implementation.
  - No Phase 03 implementation, broad suite, install, audit, build,
    dependency/lock mutation, Python oracle change/deletion, commit, push,
    deploy, or inspection of `output/` or `promo/` occurred.
- Related run log:
  - `gate-02-checker-root-20260803-001`

### DAT-001 / dat-001-checker-root-20260803-001

- Claim: The current SQLAlchemy/Alembic persistence schema, transaction
  ownership, retention, deletion behavior, and exercising fixtures are
  completely inventoried for the Bun persistence migration.
- Status: `DONE`
- Evidence class: `static`, `integration`, `deterministic`, `review`
- Maker run/context ID:
  `dat-001-maker-root-20260803-001` /
  `dat-001-maker-root-context-20260803-001`
- Checker run/context ID:
  `dat-001-checker-root-20260803-001` /
  `dat-001-checker-root-context-20260803-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:1cd6ad8f867953a16b9c3a9c542e64d8e7e91ffe5b8741724ffb7cc6466995a4`
- Commands/procedure:
  - Maker manifest comparison -> 31/31 hashes, zero mismatches
  - `bun run test:dat-001` -> exit `0`, one pytest passed, generated inventory
    current
  - targeted Ruff over exporter and test -> exit `0`
  - Checker-owned 19-table/document-section coverage probe -> exit `0`
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/DAT-001/dat-001-checker-root-20260803-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/DAT-001/dat-001-checker-root-20260803-001/coverage-check.json`
  - `.omx/artifacts/typescript-bun/DAT-001/dat-001-checker-root-20260803-001/validation.json`
  - `.omx/artifacts/typescript-bun/DAT-001/dat-001-checker-root-20260803-001/verdict.md`
  - `.omx/artifacts/typescript-bun/DAT-001/dat-001-checker-root-20260803-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/DAT-001/dat-001-checker-root-20260803-001/manifest.sha256.json`
- Accepted assertions:
  - The real six-revision Alembic chain ends at `0006_viewer_lifecycle`; a
    disposable migrated database and declarative metadata each contain the
    same 19 application tables.
  - Columns, types, primary keys, indexes, uniqueness, check predicates, and
    foreign-key actions have zero structural mismatch. Both raw normalized
    snapshots remain inspectable.
  - Nineteen SQL defaults retained by `session_records` and
    `session_viewer_instances`, but represented only as Python defaults in the
    model, remain explicit downstream parity decisions.
  - The exact current write adapters, target repositories, application-owned
    transaction boundaries, cleanup/retention behavior, deletion semantics,
    and existing fixture coverage are mapped without claiming future CRUD
    parity.
  - `DAT-001` is `DONE`; Phase 03 and only `DAT-002` are `READY`.
- Limitations:
  - Repository CRUD parity, new Bun schema/runtime code, backup migration, and
    fault behavior remain owned by `DAT-002..011`.
  - No user database, broad suite, dependency/lock mutation, Python oracle
    change/deletion, downstream implementation, commit, push, deploy, subagent,
    `output/`, or `promo/` work occurred.
- Related run log:
  - `dat-001-checker-root-20260803-001`

### DAT-002 / dat-002-checker-root-20260803-001

- Claim: Stable Drizzle ownership, reviewed plain-SQL migration policy, the
  executable runtime runner, immutable journal/checksum rules, and the
  fail-closed destructive-migration backup boundary are locked.
- Status: `DONE`
- Evidence class: `static`, `integration`, `data-safety`, `review`
- Maker run/context ID:
  `dat-002-maker-root-20260803-001` /
  `dat-002-maker-root-context-20260803-001`
- Checker run/context ID:
  `dat-002-checker-root-20260803-001` /
  `dat-002-checker-root-context-20260803-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:3f322f402b69c8e5594e98c5943e07cc048083ff5ac7748f994791b91a7cb8e1`
- Commands/procedure:
  - Maker manifest comparison -> 20/20 hashes, zero mismatches
  - `bun run test:dat-002` -> exit `0`, strict TypeScript plus five tests and
    17 assertions
  - `bun run --filter @advx/backend-bun check:boundaries` -> exit `0`, 46
    sources
  - targeted npm registry and Bun/pnpm installed-graph checks -> exit `0`
  - Checker-owned invalid-backup-receipt probe -> exit `0`, zero schema/journal
    mutations
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/DAT-002/dat-002-checker-root-20260803-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/DAT-002/dat-002-checker-root-20260803-001/dependency-check.json`
  - `.omx/artifacts/typescript-bun/DAT-002/dat-002-checker-root-20260803-001/backup-probe.json`
  - `.omx/artifacts/typescript-bun/DAT-002/dat-002-checker-root-20260803-001/validation.json`
  - `.omx/artifacts/typescript-bun/DAT-002/dat-002-checker-root-20260803-001/verdict.md`
  - `.omx/artifacts/typescript-bun/DAT-002/dat-002-checker-root-20260803-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/DAT-002/dat-002-checker-root-20260803-001/manifest.sha256.json`
- Accepted assertions:
  - `drizzle-orm@0.45.2` is the exact latest stable runtime pin. The rejected
    Drizzle Kit/Studio tree is absent from importers and installed graphs.
  - Drizzle declarations and reviewed SQL have locked locations; plain SQL is
    the only unsupported-schema escape hatch and `drizzle-kit push` is not in
    the runtime trust boundary.
  - The ADVX runner owns contiguous `NNNN_slug` names, exact SQL SHA-256 values,
    an immutable strict journal, and one atomic transaction with complete
    rollback on failure.
  - Applied drift and unknown future journal state fail closed before pending
    SQL. Invalid or absent Online Backup API proof leaves both schema and
    journal untouched before a destructive migration.
  - Bun `1.3.14` remains `NO_GO_BUN_API`. `DAT-010` may use the retained Python
    online-backup adapter only for legacy cutover; post-Python destructive
    migrations remain prohibited until a true Bun/native adapter is proven.
  - `DAT-002` is `DONE`; Phase 03 and only `DAT-003` are `READY`.
- Limitations:
  - Actual Drizzle table declarations, data-directory connection ownership,
    legacy baseline adoption, and the concrete backup adapter remain owned by
    `DAT-003`, `DAT-004..008`, and `DAT-010`.
  - No user database, Python oracle change/deletion, dependency/lock mutation,
    later task, broad suite, commit, push, deploy, subagent, `output/`, or
    `promo/` work occurred.
- Related run log:
  - `dat-002-checker-root-20260803-001`

### DAT-003 / dat-003-checker-root-20260803-001

- Claim: The actual Bun process owns a safe absolute data directory and one
  SQLite WAL connection with verified pragmas, honest readiness, clean
  checkpoint/close behavior, and disposable fixture support.
- Status: `DONE`
- Evidence class: `static`, `integration`, `process-lifecycle`, `data-safety`
- Maker run/context ID:
  `dat-003-maker-root-20260803-001` /
  `dat-003-maker-root-context-20260803-001`
- Checker run/context ID:
  `dat-003-checker-root-20260803-001` /
  `dat-003-checker-root-context-20260803-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:1a8e7ada4140a1795e007827e466b80e8a683ff7dabad7cd17d695c674bfafba`
- Commands/procedure:
  - Maker manifest comparison -> 22/22 hashes, zero mismatches
  - `bun run test:dat-003` -> exit `0`, strict TypeScript plus four tests and
    31 assertions
  - `bun run --filter @advx/backend-bun test:bck-010` -> exit `0`, six tests
    and 60 assertions
  - `bun run --filter @advx/backend-bun check:boundaries` -> exit `0`, 48
    production sources
  - `git diff --check` -> exit `0`
  - Checker-owned disposable SQLite probe -> exit `0`
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/DAT-003/dat-003-checker-root-20260803-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/DAT-003/dat-003-checker-root-20260803-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/DAT-003/dat-003-checker-root-20260803-001/source-state.sha256.json`
  - `.omx/artifacts/typescript-bun/DAT-003/dat-003-checker-root-20260803-001/validation.json`
  - `.omx/artifacts/typescript-bun/DAT-003/dat-003-checker-root-20260803-001/verdict.md`
  - `.omx/artifacts/typescript-bun/DAT-003/dat-003-checker-root-20260803-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/DAT-003/dat-003-checker-root-20260803-001/manifest.sha256.json`
- Accepted assertions:
  - `advx.sqlite3` opens only under an absolute non-packaged data directory and
    retains the Python-parity pragma baseline.
  - One backend-process owner provides the synchronous read/write connection;
    competing ownership fails before a second writable open.
  - Database health is path-free and becomes ready only after pragma and
    integrity verification.
  - Flush and close truncate/checkpoint WAL, release the owned handle, and
    permit a clean reopen with persisted data intact.
  - The actual authenticated Bun process reports database readiness, shuts
    down cleanly, releases its port, and leaks neither the token nor data path.
- Limitations:
  - Schema declarations, repositories, migrations against legacy user data,
    and backup/restore remain owned by later `DAT-004..011` tasks.
  - No user database, Python oracle change/deletion, dependency/lock mutation,
    later task, broad suite, commit, push, deploy, subagent, `output/`, or
    `promo/` work occurred.
- Related run log:
  - `dat-003-checker-root-20260803-001`

### DAT-004 / dat-004-recovery-checker-root-20260804-001

- Claim: Room, Session, and runtime revision repositories preserve current
  Python persistence behavior, including Session-start idempotency and physical
  Room clear with transactional foreign-key cascade.
- Status: `DONE`
- Evidence class: `static`, `integration`, `data-safety`, `review`
- Maker run/context ID:
  `dat-004-recovery-maker-root-20260804-001` /
  `dat-004-recovery-maker-root-context-20260804-001`
- Checker run/context ID:
  `dat-004-recovery-checker-root-20260804-001` /
  `dat-004-recovery-checker-root-context-20260804-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:9ce86a7cf7cacd119c1931b7e84daceb104250bc1ca8639232270327808d4d33`
- Commands/procedure:
  - Recovery Maker manifest comparison -> 30/30 hashes, zero mismatches
  - `bun run --filter @advx/backend-bun typecheck` -> exit `0`
  - `bun run --filter @advx/backend-bun test:dat-004` -> exit `0`, three tests
    and 25 assertions
  - `bun run --filter @advx/backend-bun test:bck-004` -> exit `0`, four tests
    and 23 assertions
  - `bun run --filter @advx/backend-bun check:boundaries` -> exit `0`, 55
    production sources
  - Checker-owned disposable idempotency/clear probe -> exit `0`
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/DAT-004/dat-004-recovery-checker-root-20260804-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/DAT-004/dat-004-recovery-checker-root-20260804-001/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/DAT-004/dat-004-recovery-checker-root-20260804-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/DAT-004/dat-004-recovery-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/DAT-004/dat-004-recovery-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/DAT-004/dat-004-recovery-checker-root-20260804-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/DAT-004/dat-004-recovery-checker-root-20260804-001/manifest.sha256.json`
- Accepted assertions:
  - Room and Session optimistic revisions, durable lifecycle/recovery markers,
    runtime apply identity, canonical config/hash, pending/commit/reject,
    audience epoch, and rollback behavior retain the prior Checker's accepted
    evidence.
  - Matching client request ID and canonical hash return the existing Session;
    matching save retry does not create a duplicate, while changed hashes fail
    with `optimistic_conflict` through lookup and save paths.
  - Room clear is a physical delete within the caller-owned transaction. A
    forced rollback restores Room, Session, and runtime revision rows; a
    committed clear cascades both dependent levels and a repeated clear is
    idempotently false.
  - `DAT-004` is `DONE`; Phase 03 and only `DAT-005` are `READY`.
- Limitations:
  - Viewer state, room events, long-term memory, meme persistence, durable jobs,
    legacy database migration, and fault handling remain owned by
    `DAT-005..011`.
  - No user database, Python oracle change/deletion, dependency/lock mutation,
    later task implementation, broad suite, commit, push, deploy, subagent,
    `output/`, or `promo/` work occurred.
- Related run log:
  - `dat-004-recovery-checker-root-20260804-001`

### DAT-005 / dat-005-recovery-checker-root-20260804-001

- Claim: Viewer pool, presence, moderation, behavior/private state, population
  metadata, deterministic recovery, and permanent ID tombstones preserve the
  current Python persistence contract without adding a storage-state default.
- Status: `DONE`
- Evidence class: `static`, `integration`, `data-safety`, `review`
- Maker run/context ID:
  `dat-005-recovery-maker-root-20260804-001` /
  `dat-005-recovery-maker-root-context-20260804-001`
- Checker run/context ID:
  `dat-005-recovery-checker-root-20260804-001` /
  `dat-005-recovery-checker-root-context-20260804-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:8a5be92cf9ad7db1ef6ced6762835ef181148b8afe0dadc1dfebd25f8c9bece2`
- Commands/procedure:
  - Recovery Maker manifest comparison -> 20/20 hashes, zero mismatches
  - Original-to-recovery source comparison -> exactly four declared files
  - `bun run test:dat-005` -> exit `0`, strict TypeScript plus three tests and
    26 assertions
  - `bun run --filter @advx/backend-bun test:dat-004` -> exit `0`, three tests
    and 25 assertions
  - `git diff --check` -> exit `0`
  - Checker-owned disposable Viewer-default probe -> exit `0`
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/DAT-005/dat-005-recovery-checker-root-20260804-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/DAT-005/dat-005-recovery-checker-root-20260804-001/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/DAT-005/dat-005-recovery-checker-root-20260804-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/DAT-005/dat-005-recovery-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/DAT-005/dat-005-recovery-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/DAT-005/dat-005-recovery-checker-root-20260804-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/DAT-005/dat-005-recovery-checker-root-20260804-001/manifest.sha256.json`
- Accepted assertions:
  - The migrated Viewer table exposes exactly the 14 DAT-001 database-default
    columns; required storage `state` has no default and an omitted-state insert
    is rejected rather than silently creating an active Viewer.
  - Explicit-state inserts succeed, and the immutable migration's declared
    checksum equals its calculated SQL SHA-256.
  - Stable Viewer IDs/ordinals, deterministic eligible-Session restore,
    lifecycle and revision fences, bounded private state, population CAS,
    rollback coupling, and Session-scoped tombstones retain the focused Maker
    evidence because their source hashes match.
  - `DAT-005` is `DONE`; Phase 03 and only `DAT-006` are `READY`.
- Limitations:
  - Room events, working history, long-term memory, meme persistence, durable
    jobs, legacy database migration, and fault handling remain owned by
    `DAT-006..011`.
  - No user database, Python oracle change/deletion, dependency/lock mutation,
    later task implementation, broad suite, commit, push, deploy, subagent,
    `output/`, or `promo/` work occurred.
- Related run log:
  - `dat-005-recovery-checker-root-20260804-001`

### DAT-006 / dat-006-recovery-checker-root-20260804-001

- Claim: Room events and bounded working history preserve source tagging,
  ordering, idempotency, retention, public/reply exclusion, and accepted-barrage
  evidence references, including the exact Python model-dump null shape.
- Status: `DONE`
- Evidence class: `static`, `integration`, `data-safety`, `review`
- Maker run/context ID:
  `dat-006-recovery-maker-root-20260804-001` /
  `dat-006-recovery-maker-root-context-20260804-001`
- Checker run/context ID:
  `dat-006-recovery-checker-root-20260804-001` /
  `dat-006-recovery-checker-root-context-20260804-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:60718a89835046aa19ccd6e2d6f232ea41b40a3d2b4e98d152e07de69f348d53`
- Commands/procedure:
  - Recovery Maker manifest comparison -> 35/35 hashes, zero mismatches
  - Rejected-to-recovery product comparison -> exactly two declared files
  - `bun run test:dat-006` -> exit `0`, strict TypeScript plus three tests and
    33 assertions
  - `bun run --filter @advx/backend-bun check:boundaries` -> exit `0`, 57
    production sources
  - Checker-owned exact null/required-field probe -> exit `0`
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/DAT-006/dat-006-recovery-checker-root-20260804-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/DAT-006/dat-006-recovery-checker-root-20260804-001/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/DAT-006/dat-006-recovery-checker-root-20260804-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/DAT-006/dat-006-recovery-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/DAT-006/dat-006-recovery-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/DAT-006/dat-006-recovery-checker-root-20260804-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/DAT-006/dat-006-recovery-checker-root-20260804-001/manifest.sha256.json`
- Accepted assertions:
  - Source-tagged Room events retain exact idempotency, strict recovery order,
    bounded public/reply windows, per-source transactional retention, event
    evidence links, and audience-barrage Observation-trigger exclusion.
  - The current Python producer's event evidence with `frame_index=null` and
    frame evidence with `event_id=null` persist successfully; omitted unused
    fields remain accepted.
  - Event evidence still requires a non-empty event ID and frame evidence still
    requires a nonnegative frame index; invalid values return `invalid_record`.
  - `DAT-006` is `DONE`; Phase 03 and only `DAT-007` are `READY`; `DAT-008`
    remains `TODO`.
- Limitations:
  - Long-term memory, meme persistence, durable jobs, legacy database migration,
    and fault handling remain owned by `DAT-007..011`.
  - No user database, Python oracle change/deletion, dependency/lock mutation,
    later task implementation, broad suite, commit, push, deploy, subagent,
    `output/`, or `promo/` work occurred.
- Related run log:
  - `dat-006-recovery-checker-root-20260804-001`

### DAT-007 / dat-007-recovery-checker-root-20260804-001

- Claim: Room long-term memory persistence matches the current four-table
  Python/Alembic schema and preserves evidence-backed lifecycle, idempotency,
  revision fences, deletion semantics, and rollback.
- Status: `DONE`
- Evidence class: `static`, `integration`, `data-safety`, `review`
- Maker run/context ID:
  `dat-007-recovery-maker-root-20260804-001` /
  `dat-007-recovery-maker-root-context-20260804-001`
- Checker run/context ID:
  `dat-007-recovery-checker-root-20260804-001` /
  `dat-007-recovery-checker-root-context-20260804-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:e00ccb715d09fd95e66a09ea3d15eb4de8598d7061b1301e297de05c68f0d486`
- Commands/procedure:
  - Recovery Maker manifest comparison -> 24/24 hashes, zero mismatches
  - Rejected-to-recovery product comparison -> exactly four declared files
  - `bun run test:dat-007` -> exit `0`, strict TypeScript plus four tests and
    57 assertions
  - `bun run --filter @advx/backend-bun check:boundaries` -> exit `0`, 58
    production sources
  - Checker-owned disposable migration/type-guard probe -> exit `0`
  - `git diff --check` -> exit `0`, line-ending warnings only
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/DAT-007/dat-007-recovery-checker-root-20260804-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/DAT-007/dat-007-recovery-checker-root-20260804-001/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/DAT-007/dat-007-recovery-checker-root-20260804-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/DAT-007/dat-007-recovery-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/DAT-007/dat-007-recovery-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/DAT-007/dat-007-recovery-checker-root-20260804-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/DAT-007/dat-007-recovery-checker-root-20260804-001/manifest.sha256.json`
- Accepted assertions:
  - The migrated database exposes exactly the DAT-001 CHECK sets for all four
    Room memory tables: seven long-term-memory, two head, one evidence, and
    four candidate constraints, with no missing or unexpected checks.
  - Migration 0004's declared checksum equals its calculated SQL SHA-256, and
    invalid memory types still fail with `invalid_record` at the typed
    repository boundary.
  - Evidence-backed candidate commit, exact idempotency, head/revision fences,
    bounded active selection, edit/merge/replace, revoke/delete/reset, and
    transactional rollback retain the focused Maker evidence.
  - `DAT-007` is `DONE`; Phase 03 and only `DAT-008` are `READY`.
- Limitations:
  - Async memory extraction orchestration remains owned by `AGT-012`; meme
    persistence, durable jobs, legacy database migration, and fault handling
    remain owned by `DAT-008..011`.
  - No user database, Python oracle change/deletion, dependency/lock mutation,
    later task implementation, broad suite, commit, push, deploy, subagent,
    `output/`, or `promo/` work occurred.
- Related run log:
  - `dat-007-recovery-checker-root-20260804-001`

### DAT-008 / dat-008-checker-root-20260804-001

- Claim: Mode meme persistence matches the current four-table Python/Alembic
  schema and preserves namespace isolation, candidate decisions, normalized
  provenance, immutable event revisions, undo, decay/archive selection, and
  rollback.
- Status: `DONE`
- Evidence class: `static`, `integration`, `data-safety`, `review`
- Maker run/context ID:
  `dat-008-maker-root-20260804-001` /
  `dat-008-maker-root-context-20260804-001`
- Checker run/context ID:
  `dat-008-checker-root-20260804-001` /
  `dat-008-checker-root-context-20260804-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:c4bc1707250f13eb9467a68822101a3a6c9e9d3fc53d7b9dea462e230f940ff4`
- Commands/procedure:
  - Maker manifest comparison -> 38/38 hashes, zero mismatches
  - `bun run test:dat-008` -> exit `0`, strict TypeScript plus four tests and
    56 assertions
  - `bun run --filter @advx/backend-bun check:boundaries` -> exit `0`, 59
    production sources
  - Checker-owned DAT-001-derived real-migration probe -> exit `0`
  - `git diff --check` -> exit `0`, line-ending warnings only
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/DAT-008/dat-008-checker-root-20260804-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/DAT-008/dat-008-checker-root-20260804-001/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/DAT-008/dat-008-checker-root-20260804-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/DAT-008/dat-008-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/DAT-008/dat-008-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/DAT-008/dat-008-checker-root-20260804-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/DAT-008/dat-008-checker-root-20260804-001/manifest.sha256.json`
- Accepted assertions:
  - The migrated database exposes exactly the four DAT-001 Mode meme tables
    with 35 columns, 16 CHECK constraints, four foreign keys, two indexes, one
    unique constraint, no inferred defaults, and the exact migration checksum.
  - Candidate pending/accepted/rejected outcomes, exact idempotency, settings
    CAS, normalized Python source provenance, immutable lifecycle events,
    revision-checked edit/undo, restore/disable/archive, pin/use metadata,
    decay/archive selection, and rollback retain the focused Maker evidence.
  - Namespace-scoped reads and mutations prevent cross-Mode application, and
    no Meme candidate is written to or transformed into a Room event.
  - `DAT-008` is `DONE`; Phase 03 and only `DAT-009` are `READY`.
- Limitations:
  - Runtime memory/meme side-effect orchestration remains owned by `AGT-012`;
    durable jobs, legacy database migration, and fault handling remain owned
    by `DAT-009..011`.
  - No user database, Python oracle change/deletion, dependency/lock mutation,
    later task implementation, broad suite, commit, push, deploy, subagent,
    `output/`, or `promo/` work occurred.
- Related run log:
  - `dat-008-checker-root-20260804-001`

### DAT-009 / dat-009-checker-root-20260804-001

- Claim: durable outbox/job records survive restart without treating
  interrupted Provider work as resumable, and every side effect is protected
  by exact idempotency plus current epoch/sequence fences.
- Status: `DONE`
- Evidence class: `static`, `integration`, `data-safety`, `review`
- Maker run/context ID:
  `dat-009-maker-root-20260804-001` /
  `dat-009-maker-root-context-20260804-001`
- Checker run/context ID:
  `dat-009-checker-root-20260804-001` /
  `dat-009-checker-root-context-20260804-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:25aeb0dc871339c86d7622887f556681627757f316acf6104d4acee124f4b9a8`
- Commands/procedure:
  - Maker manifest comparison -> 29/29 hashes, zero mismatches
  - `bun run test:dat-009` -> exit `0`, strict TypeScript plus four tests and
    39 assertions
  - `bun run --filter @advx/backend-bun check:boundaries` -> exit `0`, 60
    production sources
  - Checker-owned disposable restart/lease/fence probe -> exit `0`
  - `git diff --check` -> exit `0`, line-ending warnings only
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/DAT-009/dat-009-checker-root-20260804-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/DAT-009/dat-009-checker-root-20260804-001/probe.ts`
  - `.omx/artifacts/typescript-bun/DAT-009/dat-009-checker-root-20260804-001/probe-output.json`
  - `.omx/artifacts/typescript-bun/DAT-009/dat-009-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/DAT-009/dat-009-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/DAT-009/dat-009-checker-root-20260804-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/DAT-009/dat-009-checker-root-20260804-001/manifest.sha256.json`
- Accepted assertions:
  - Immutable migration 0006 and matching Drizzle declarations expose one
    durable table for committed domain events, eligible memory/meme side
    effects, and migration/recovery markers.
  - Exact idempotency, bounded leasing, expired-lease reclaim, retries,
    terminal settlement, and Room/session-epoch/Viewer-sequence fences retain
    the focused Maker evidence.
  - A stale attempt cannot settle reclaimed work, changed Session epoch fences
    the side effect, and terminal cancellation remains ineligible after reopen.
  - Bounded canonical payload validation rejects representative transient
    Provider request state; in-flight streams are not modeled as resumable.
  - `DAT-009` is `DONE`; Phase 03 and only `DAT-010` are `READY`.
- Limitations:
  - Runtime memory/meme side-effect orchestration remains owned by `AGT-012`;
    legacy database migration and persistence fault handling remain owned by
    `DAT-010..011`.
  - No user database, Python oracle change/deletion, dependency/lock mutation,
    later task implementation, broad suite, commit, push, deploy, subagent,
    `output/`, or `promo/` work occurred.
- Related run log:
  - `dat-009-checker-root-20260804-001`

### DAT-010 / dat-010-recovery-checker-root-20260804-001

- Claim: a Python-owned WAL database can be backed up online, stopped at a
  lossless cutoff, migrated by copy-and-swap, exercised by Bun, and restored
  without permitting unproven destructive Bun migration.
- Status: `DONE`
- Evidence class: `static`, `integration`, `data-safety`, `rollback`, `review`
- Maker run/context ID:
  `dat-010-recovery-maker-root-20260804-001` /
  `dat-010-recovery-maker-root-context-20260804-001`
- Checker run/context ID:
  `dat-010-recovery-checker-root-20260804-001` /
  `dat-010-recovery-checker-root-context-20260804-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:27e1d7125adc8cf470130075d513fce2c11fa0fc7ad3502c892d73a47764e12a`
- Commands/procedure:
  - Recovery Maker manifest comparison -> 27/27 hashes, zero mismatches
  - rejected-candidate comparison -> exactly two changed product files
  - `bun run test:dat-010` -> exit `0`, strict TypeScript plus three tests and
    39 assertions
  - `bun run --filter @advx/backend-bun check:boundaries` -> exit `0`, 62
    production sources
  - original Checker late-write scenario verifier -> exit `0`; the underlying
    scenario now fails closed with `comparison_failed`
  - `git diff --check` -> exit `0`, line-ending warnings only
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/DAT-010/dat-010-recovery-checker-root-20260804-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/DAT-010/dat-010-recovery-checker-root-20260804-001/probe-verifier.ts`
  - `.omx/artifacts/typescript-bun/DAT-010/dat-010-recovery-checker-root-20260804-001/probe-output.json`
  - `.omx/artifacts/typescript-bun/DAT-010/dat-010-recovery-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/DAT-010/dat-010-recovery-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/DAT-010/dat-010-recovery-checker-root-20260804-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/DAT-010/dat-010-recovery-checker-root-20260804-001/manifest.sha256.json`
- Accepted assertions:
  - The retained Python `sqlite3.Connection.backup` path captures a consistent,
    hashed, integrity-checked, sidecar-free artifact while Python owns an active
    WAL database.
  - Both backends stop before the stopped Source is compared with the backup by
    exact legacy table set, row counts, and deterministic semantic digests.
  - A valid write after backup but before stop fails closed before working-copy
    creation; Source retains the row and no Bun journal/outbox is adopted.
  - An unchanged backup migrates through Bun version 6, preserves every legacy
    table digest, survives Bun read/write/restart smoke, and restores from the
    untouched artifact.
  - Copy-and-swap is selected. Bun-owned online backup remains unavailable and
    destructive Bun migration remains prohibited.
  - `DAT-010` is `DONE`; Phase 03 and only `DAT-011` are `READY`.
- Limitations:
  - Corruption, locks, disk-full/write-failure, interrupted migration, and
    sidecar mismatch handling remain owned by `DAT-011`.
  - No user database, Python oracle change/deletion, dependency/lock mutation,
    later task implementation, broad suite, commit, push, deploy, subagent,
    `output/`, or `promo/` work occurred.
- Related run log:
  - `dat-010-recovery-checker-root-20260804-001`

### DAT-011 / dat-011-checker-root-20260804-001

- Claim: SQLite persistence faults are machine-classifiable, preserve prior
  usable state where possible, and fail closed without creating an empty
  database in a wrong recovery directory.
- Status: `DONE`
- Evidence class: `static`, `integration`, `data-safety`, `crash`, `review`
- Maker run/context ID:
  `dat-011-maker-root-20260804-001` /
  `dat-011-maker-root-context-20260804-001`
- Checker run/context ID:
  `dat-011-checker-root-20260804-001` /
  `dat-011-checker-root-context-20260804-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:6e481b6b3d7b7e9eec7c579e40731cad3de17eb14a088ad673823c3603828703`
- Commands/procedure:
  - Maker manifest comparison -> 27/27 hashes, zero mismatches
  - `bun run test:dat-011` -> exit `0`, strict TypeScript plus five tests and
    40 assertions
  - `bun run --filter @advx/backend-bun check:boundaries` -> exit `0`, 64
    production sources
  - Checker-owned existing/corrupt/future/sidecar probe -> exit `0`
  - `git diff --check` -> exit `0`, line-ending warnings only
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/DAT-011/dat-011-checker-root-20260804-001/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/DAT-011/dat-011-checker-root-20260804-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/DAT-011/dat-011-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/DAT-011/dat-011-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/DAT-011/dat-011-checker-root-20260804-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/DAT-011/dat-011-checker-root-20260804-001/manifest.sha256.json`
- Accepted assertions:
  - Real SQLite lock, timeout, read-only, full-write, corruption, migration,
    transaction, crash, and sidecar exercises produce explicit retryable,
    failed-closed, rolled-back, or committed status; the read-only-directory
    OS failure is injected explicitly as `EACCES`.
  - Existing-only recovery refuses missing, empty, or sidecar-mismatched
    targets and opens without create permission, so a wrong directory cannot
    silently gain a replacement database.
  - A healthy source remains intact beside a corrupt working copy, failed
    migrations and transactions roll back, crash-before-commit work is absent,
    and crash-after-commit work is durable exactly once.
  - Future journals are rejected before mutation, and explicit prior-copy
    preservation state is retained by the public classifier.
  - `DAT-011` is `DONE`; Phase 03 and only `GATE-03` are `READY`.
- Limitations:
  - Whole-phase persistence acceptance remains owned by `GATE-03` and was not
    started in this run.
  - No user database, Python oracle change/deletion, dependency/lock mutation,
    later task implementation, broad suite, commit, push, deploy, subagent,
    `output/`, or `promo/` work occurred.
- Related run log:
  - `dat-011-checker-root-20260804-001`

### GATE-03 / gate-03-checker-root-20260804-001

- Claim: The current Bun persistence implementation satisfies all eight Phase
  03 exit criteria while retaining Python as the live-data owner and rollback
  oracle until later integration and cutover gates.
- Status: `DONE`
- Evidence class: `static`, `integration`, `data-safety`, `performance`,
  `review`
- Maker run/context ID:
  `gate-03-maker-root-20260804-001` /
  `gate-03-maker-root-context-20260804-001`
- Checker run/context ID:
  `gate-03-checker-root-20260804-001` /
  `gate-03-checker-root-context-20260804-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:be045f5c6c0dc8dde01e2468d36ab98d10e0fce9a7164234e2f1b3c5afe342a4`
- Maker manifest hash:
  `sha256:69fdae7a880efa874a3f0afe4f4df7be86f88d2fdacb3ada498f40742173c627`
- Commands/procedure:
  - Maker manifest comparison -> 25/25 hashes, zero mismatches
  - `bun test src/infrastructure/persistence/sqlite` from `apps/backend-bun`
    -> exit `0`, 38 tests across 10 files with 363 assertions
  - `bun run --filter @advx/backend-bun typecheck` -> exit `0`
  - `bun run --filter @advx/backend-bun check:boundaries` -> exit `0`, 64
    production sources
  - fresh persistence budget probe -> exit `0`, all 13 checks under 438
    interleaved background reads
  - `git diff --check` -> exit `0`, line-ending warnings only
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/GATE-03/gate-03-checker-root-20260804-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/GATE-03/gate-03-checker-root-20260804-001/reviewed-source-receipt.json`
  - `.omx/artifacts/typescript-bun/GATE-03/gate-03-checker-root-20260804-001/persistence-suite.txt`
  - `.omx/artifacts/typescript-bun/GATE-03/gate-03-checker-root-20260804-001/budget-probe-output.json`
  - `.omx/artifacts/typescript-bun/GATE-03/gate-03-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/GATE-03/gate-03-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/GATE-03/gate-03-checker-root-20260804-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/GATE-03/gate-03-checker-root-20260804-001/manifest.sha256.json`
- Accepted assertions:
  - All 11 `DAT-001..011` accepted Checker manifests and all 25 Maker
    candidate entries match exactly.
  - The complete current persistence suite passes schema, immutable migration,
    WAL/close, repository semantics, legacy copy/rollback, and fault handling.
  - The fresh real WAL probe passes all 13 `D-044` budgets. Measured p95 is
    2.223 ms for RoomEvent append, 5.357 ms for bounded context, 3.284 ms for
    runtime revision, 7.615 ms for 32-Viewer restore, 2.434 ms for Top-K
    memory, 2.896 ms for 16-row outbox batches, and 16.606 ms for loop lag.
  - The stopped source is compared against the online-backup snapshot before a
    working copy is created; copy-and-swap and untouched-backup restore remain
    enforced.
  - Python remains the live user-data owner. Bun opens only synthetic or copied
    databases until later desktop-integration and cutover gates permit more.
  - `GATE-03` and Phase 03 are `DONE`; Phase 04 and only `AGT-001` are `READY`.
- Limitations:
  - Current performance evidence is Windows x64 with Bun 1.3.14 on a synthetic
    temporary database. macOS and release-hardware replication remain later
    platform-gate work.
  - No product source, user database, Python oracle change/deletion,
    dependency/lock mutation, Phase 04 implementation, broad repository suite,
    commit, push, deploy, subagent, `output/`, or `promo/` work occurred.
- Related run log:
  - `gate-03-checker-root-20260804-001`

### AGT-001 / agt-001-checker-root-20260804-001

- Claim: Bun application Provider ports expose normalized ADVX domain
  capabilities, calls, results, failures, cancellation metadata, provider
  revision, and role-model identity without OpenAI-compatible wire objects.
- Status: `DONE`
- Evidence class: `static`, `deterministic_fake`, `review`
- Maker run/context ID:
  `agt-001-maker-root-20260804-001` /
  `agt-001-maker-root-context-20260804-001`
- Checker run/context ID:
  `agt-001-checker-root-20260804-001` /
  `agt-001-checker-root-context-20260804-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:fb841e6a9a145ef79accdd2182d74918541961e991f9956801186f0987c51717`
- Maker manifest hash:
  `sha256:76a709c54f532571977ba38c7f665eb17c52eed71c19d1a3739b9f89e8769c38`
- Commands/procedure:
  - Maker manifest comparison -> 22/22 hashes, zero mismatches
  - `bun run test:agt-001` -> exit `0`, four tests with 28 assertions
  - `bun run test:bck-004` -> exit `0`, four tests with 24 assertions
  - `bun run typecheck` -> exit `0`
  - `bun run check:boundaries` -> exit `0`, 64 production sources
  - Checker-owned public-contract probe -> exit `0`, seven checks
  - `git diff --check` -> exit `0`, line-ending warnings only
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/AGT-001/agt-001-checker-root-20260804-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/AGT-001/agt-001-checker-root-20260804-001/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/AGT-001/agt-001-checker-root-20260804-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-001/agt-001-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/AGT-001/agt-001-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/AGT-001/agt-001-checker-root-20260804-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/AGT-001/agt-001-checker-root-20260804-001/manifest.sha256.json`
- Accepted assertions:
  - Health and capability probes cover text, image, structured output,
    streaming, and speech-recognition capability names through one shared
    Provider control port.
  - Model and ASR calls bind profile identity and a validated provider
    revision; model results also bind the selected ADVX role/model and bounded
    protocol-repair attempt.
  - Model results retain request/response IDs, normalized output and finish
    reason, token usage, latency, and optional upstream request ID.
  - Safe failures retain only code, derived message code, retryability, source,
    bounded HTTP/retry metadata, and optional request ID. Unknown raw fields are
    dropped by the runtime constructor.
  - Caller abort and monotonic deadline remain explicit and map to distinct
    normalized error codes.
  - The application port contains no OpenAI URL, headers, body, choices, SDK
    imports, or raw Provider response contract.
  - `AGT-001` is `DONE`; Phase 04 and only `AGT-002` are `READY`.
- Limitations:
  - Evidence is deterministic contract proof, not recorded or credentialed
    Provider behavior. StepFun ASR and AI SDK adapters remain `AGT-002` and
    `AGT-003`.
  - No production change, Python oracle change/deletion, dependency/lock
    mutation, later task implementation, credentialed call, broad repository
    suite, commit, push, deploy, subagent, `output/`, or `promo/` work occurred.
- Related run log:
  - `agt-001-checker-root-20260804-001`

### AGT-002 / agt-002-recovery-checker-root-20260804-002

- Claim: The Bun StepFun ASR slice preserves normalized recorded SSE behavior,
  isolated microphone/system-audio lifecycles, bounded segmentation, final-only
  persistence, and idempotent coordinated-turn degradation semantics.
- Status: `DONE`
- Evidence class: `recorded`, `deterministic_runtime`, `review`
- Maker run/context ID:
  `agt-002-recovery-maker-root-20260804-002` /
  `agt-002-recovery-maker-root-context-20260804-002`
- Checker run/context ID:
  `agt-002-recovery-checker-root-20260804-002` /
  `agt-002-recovery-checker-root-context-20260804-002`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:d13feb4aef6dca7095b24514fb6d4b422e8c44679d4b4d0ef9bd43330664d838`
- Maker manifest hash:
  `sha256:9bd0d40d1eb1b8531e73645cb47d1d5156f7e96eaab13f624d01b293dd6e8e91`
- Commands/procedure:
  - Maker manifest comparison -> 34/34 hashes, zero mismatches
  - `bun run test:agt-002` -> exit `0`, 11 tests with 56 assertions
  - `bun run test:agt-001` -> exit `0`, 4 tests with 28 assertions
  - `bun run typecheck` -> exit `0`
  - `bun run check:boundaries` -> exit `0`, 68 production sources
  - Checker-controlled concurrency probe -> exit `0`, cancellation `0/0`,
    ordinary reconnect `1/1`, in-flight degraded system final `1/1`, and
    degraded wave `1/1`
  - `git diff --check` plus targeted whitespace review -> exit `0`
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-checker-root-20260804-002/manifest-check.json`
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-checker-root-20260804-002/source-check.json`
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-checker-root-20260804-002/agt-002-test.txt`
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-checker-root-20260804-002/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-checker-root-20260804-002/checker-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-checker-root-20260804-002/validation.json`
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-checker-root-20260804-002/verdict.md`
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-checker-root-20260804-002/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-checker-root-20260804-002/manifest.sha256.json`
- Accepted assertions:
  - The StepFun adapter maps recorded partial/final SSE, rejects malformed and
    out-of-order input, deduplicates replay, and normalizes 401, 429, 5xx, and
    disconnect behavior without exposing Provider wire objects upstream.
  - Microphone and system audio retain isolated connection, buffer, retry,
    stop, failure, and status state. System audio submits after 0.8 seconds of
    silence and segments continuous audio at eight seconds.
  - Partials remain UI/debug-only. Standalone system finals trigger directly;
    microphone finals respect the 1.5-second pause.
  - Paired sources share one turn and create exactly one ObservationWave.
    Missing required system audio degrades once after three seconds.
  - A late or already-persisting system final is retained once with its
    source/turn identity and cannot create a second wave or duplicate final,
    even when reconnect changes Provider request/utterance identity.
  - Cancellation before a late final and provider stop both produce zero final
    persistence and zero ObservationWave.
  - `AGT-002` is `DONE`; Phase 04 and only `AGT-003` are `READY`.
- Limitations:
  - Provider evidence is recorded/deterministic, not a credentialed StepFun
    capability result. Credentialed proof remains `AGT-015`.
  - Windows loopback capture and Electron wiring remain later desktop tasks.
  - No product implementation, Python oracle change/deletion, dependency/lock
    mutation, later task implementation, broad repository suite, commit, push,
    deploy, subagent, `output/`, or `promo/` work occurred in this Checker run.
- Related run log:
  - `agt-002-recovery-checker-root-20260804-002`

### AGT-003 / agt-003-recovery-checker-root-20260804-001

- Claim: The Bun ModelGateway uses AI SDK Core behind the normalized ADVX
  Provider port, disables SDK retries, enforces the ADVX-owned physical-request
  budget, and safely preserves streaming Provider failures without raw SDK or
  wire logging.
- Status: `DONE`
- Evidence class: `recorded`, `deterministic_runtime`, `review`
- Maker run/context ID:
  `agt-003-recovery-maker-root-20260804-001` /
  `agt-003-recovery-maker-root-context-20260804-001`
- Checker run/context ID:
  `agt-003-recovery-checker-root-20260804-001` /
  `agt-003-recovery-checker-root-context-20260804-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:73c3dc0c567e4f0c3cc6b1f47cf9a38308d904220cb805c571b86f2726b9b79b`
- Maker manifest hash:
  `sha256:90ba29548a2fabfa04f0a3f87a6948506736de42f2d54aec586c85943441b9f0`
- Commands/procedure:
  - Maker manifest comparison -> 33/33 hashes, zero mismatches
  - 11-file source/package/lock receipt -> 11/11 hashes, zero mismatches
  - `bun run test:agt-003` -> exit `0`, 5 tests with 36 assertions
  - `bun run test:agt-001` -> exit `0`, 4 tests with 32 assertions
  - `bun run typecheck` -> exit `0`
  - `bun run check:boundaries` -> exit `0`, 70 production sources
  - Checker-captured recorded stream probe -> exit `0`, one physical HTTP 503
    request, `started,failed`, retryable `provider_unavailable`, HTTP 503,
    request ID `stream-503`, zero stderr bytes
  - `git diff --check` plus targeted whitespace review -> exit `0`
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/AGT-003/agt-003-recovery-checker-root-20260804-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/AGT-003/agt-003-recovery-checker-root-20260804-001/source-check.json`
  - `.omx/artifacts/typescript-bun/AGT-003/agt-003-recovery-checker-root-20260804-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-003/agt-003-recovery-checker-root-20260804-001/checker-probe.stdout.txt`
  - `.omx/artifacts/typescript-bun/AGT-003/agt-003-recovery-checker-root-20260804-001/checker-probe.stderr.txt`
  - `.omx/artifacts/typescript-bun/AGT-003/agt-003-recovery-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/AGT-003/agt-003-recovery-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/AGT-003/agt-003-recovery-checker-root-20260804-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/AGT-003/agt-003-recovery-checker-root-20260804-001/manifest.sha256.json`
- Accepted assertions:
  - AI SDK Core and the OpenAI-compatible adapter remain behind the ADVX
    Provider port. Endpoint, credentials, headers, role-model selection, text
    and image conversion, and Provider wire responses do not enter application
    request/result contracts.
  - Non-streaming and streaming generation preserve normalized request and
    response IDs, usage, finish reason, latency, timeout, and caller abort.
  - Both AI SDK call paths use `maxRetries: 0`. The application-owned budget is
    shared across initial, transient-retry, and protocol-repair calls and
    rejects a third physical request before transport.
  - A streaming HTTP 503 makes one physical request, emits one terminal safe
    failure, and preserves retryability, HTTP status, and upstream request ID.
    The explicit stream error callback writes no raw request, response, or SDK
    error to stderr.
  - `AGT-003` is `DONE`; its blocker is resolved; Phase 04 and only `AGT-004`
    are `READY`.
- Limitations:
  - Provider evidence is recorded/deterministic, not a credentialed live
    capability result. Credentialed proof remains `AGT-015`.
  - Canonical schema validation and malformed-output handling remain
    `AGT-004`; this acceptance does not claim them complete.
  - No product implementation, Python oracle change/deletion, dependency/lock
    mutation, later task implementation, broad repository suite, commit, push,
    deploy, subagent, `output/`, or `promo/` work occurred in this Checker run.
- Related run log:
  - `agt-003-recovery-checker-root-20260804-001`

### AGT-004 / agt-004-recovery-checker-root-20260804-001

- Claim: Viewer model output is validated against the canonical schema,
  invalid publication identity/evidence/target is fenced, one bounded schema
  repair is permitted, and Unicode text bounds, truncation, and duplicate
  detection match the Python parity oracle.
- Status: `DONE`
- Evidence class: `deterministic_runtime`, `parity`, `review`
- Maker run/context ID:
  `agt-004-recovery-maker-root-20260804-001` /
  `agt-004-recovery-maker-root-context-20260804-001`
- Checker run/context ID:
  `agt-004-recovery-checker-root-20260804-001` /
  `agt-004-recovery-checker-root-context-20260804-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:51068d23516e82ab2cd98b44686c848f6a8f02691635cdcbb02b43b679229210`
- Maker manifest hash:
  `sha256:6cd7cf2d217e4e55b7110e2a99298a1de6d041e9496a872535c7103228326efe`
- Commands/procedure:
  - Recovery Maker manifest comparison -> 43/43 hashes, zero mismatches
  - Four-file recovery source receipt -> 4/4 hashes, zero mismatches
  - `bun run test:agt-004` -> exit `0`, 8 tests with 44 assertions
  - contracts strict TypeScript -> exit `0`
  - backend strict TypeScript -> exit `0`
  - `bun run check:boundaries` -> exit `0`, 71 production sources
  - original rejecting Checker probe -> exit `0`, casefold duplicate rejected,
    160 of 200 emoji published, and 3,000 emoji code points accepted
  - independent Bun/Python Unicode receipts -> Unicode 14.0.0, 1,530
    nonidentity mappings, identical SHA-256
    `1d4fac94d5be772dca0aa80fabd1b9aac1534348c4e9552e8d4f58e40546e2cd`
  - `git diff --check` plus targeted whitespace review -> exit `0`
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/AGT-004/agt-004-recovery-checker-root-20260804-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/AGT-004/agt-004-recovery-checker-root-20260804-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-004/agt-004-recovery-checker-root-20260804-001/unicode-parity.json`
  - `.omx/artifacts/typescript-bun/AGT-004/agt-004-recovery-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/AGT-004/agt-004-recovery-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/AGT-004/agt-004-recovery-checker-root-20260804-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/AGT-004/agt-004-recovery-checker-root-20260804-001/manifest.sha256.json`
- Accepted assertions:
  - Action, intent, target, barrage texts, reaction type, decision reason, and
    evidence are validated before publication; model-owned identity is
    removed and invalid identity/evidence/target cannot publish.
  - Exact silence is accepted without publication. Malformed schema output can
    use at most one repair only when at least six seconds and one physical
    request remain inside the shared two-request budget.
  - Viewer input accepts up to 4,000 Unicode code points; accepted display text
    is truncated to 160 code points without splitting astral characters.
  - Duplicate barrage detection uses Python-compatible full casefold for the
    current Unicode 14.0.0 parity oracle.
  - `AGT-004` is `DONE`; its blocker is resolved; Phase 04 and only `AGT-005`
    are `READY`.
- Limitations:
  - The dependency-free casefold table is deliberately bound to the current
    Python oracle's Unicode 14.0.0 data. A later oracle Unicode-version change
    may require deterministic regeneration; it does not block this acceptance.
  - Queue and scheduling policy remains `AGT-005`.
  - No product implementation, Python oracle change/deletion, dependency/lock
    mutation, later task implementation, broad repository suite, commit, push,
    deploy, subagent, `output/`, or `promo/` work occurred in this Checker run.
- Related run log:
  - `agt-004-recovery-checker-root-20260804-001`

### AGT-005 / agt-005-recovery-checker-root-20260804-001

- Claim: Bun model scheduling enforces bounded queueing, product-authoritative
  trigger priority and replacement, rate pacing, deadlines, retry/request
  budgets, and graceful drain/cancel without releasing physical capacity early.
- Status: `DONE`
- Evidence class: `deterministic_runtime`, `virtual_clock`, `review`
- Maker run/context ID:
  `agt-005-recovery-maker-root-20260804-001` /
  `agt-005-recovery-maker-root-context-20260804-001`
- Checker run/context ID:
  `agt-005-recovery-checker-root-20260804-001` /
  `agt-005-recovery-checker-root-context-20260804-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:4357a9c4765dbc0f06d48ae3af8fde24c429f2c91760fbdd275fa87768b7cc68`
- Maker manifest hash:
  `sha256:cb9d2d26363621eae31f36ff2a0ffb27f0c4909cf7c03adfffe8bff1522d41a9`
- Commands/procedure:
  - Recovery Maker manifest comparison -> 35/35 hashes, zero mismatches
  - Two-file recovery source receipt -> 2/2 hashes, zero mismatches
  - `bun run test:agt-005` -> exit `0`, 6 tests with 46 assertions
  - backend strict TypeScript -> exit `0`
  - `bun run check:boundaries` -> exit `0`, 73 production sources
  - original rejecting priority probe -> exit `0`, system signal aborted,
    system superseded, final voice completed, and physical capacity retained
  - `git diff --check` plus targeted whitespace review -> exit `0`
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/AGT-005/agt-005-recovery-checker-root-20260804-001/candidate-verification.json`
  - `.omx/artifacts/typescript-bun/AGT-005/agt-005-recovery-checker-root-20260804-001/priority-verification.json`
  - `.omx/artifacts/typescript-bun/AGT-005/agt-005-recovery-checker-root-20260804-001/priority-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-005/agt-005-recovery-checker-root-20260804-001/agt-005-test.txt`
  - `.omx/artifacts/typescript-bun/AGT-005/agt-005-recovery-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/AGT-005/agt-005-recovery-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/AGT-005/agt-005-recovery-checker-root-20260804-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/AGT-005/agt-005-recovery-checker-root-20260804-001/manifest.sha256.json`
- Accepted assertions:
  - The application-owned policy bounds in-flight and queued work, enforces
    trigger candidate budgets and finite priority, and retains the accepted
    queued latest-wins and dispatched-work rules.
  - Final user voice has higher priority than standalone system audio. It
    supersedes dispatched system work while the Provider attempt continues to
    own its real active slot until physical settlement.
  - Per-rate-key starts are paced, one eligible transient retry remains inside
    the deadline, and retry plus protocol repair share the two-request budget.
  - Graceful drain rejects new work while allowing admitted work to settle;
    forced cancellation covers queued and dispatched work without reopening.
  - `AGT-005` is `DONE`; its blocker is resolved; Phase 04 and only `AGT-006`
    are `READY`.
- Limitations:
  - Provider evidence is deterministic, not a credentialed live capability
    result. Credentialed proof remains `AGT-015`.
  - ObservationWave behavior remains `AGT-006`; this acceptance does not claim
    that task complete.
  - No product implementation, Python oracle change/deletion, dependency/lock
    mutation, later task implementation, broad repository suite, commit, push,
    deploy, subagent, `output/`, or `promo/` work occurred in this Checker run.
- Related run log:
  - `agt-005-recovery-checker-root-20260804-001`

### AGT-006 / agt-006-recovery-checker-root-20260804-001

- Claim: Bun ObservationWave implements the product-authoritative merge,
  trigger, frozen-context, memory-revision, deadline/replay, and exact bounded
  120-second/15-frame timeline contract, including timestamp-uniform sampling.
- Status: `DONE`
- Evidence class: `deterministic_runtime`, `synthetic_timeline`, `review`
- Maker run/context ID:
  `agt-006-recovery-maker-root-20260804-001` /
  `agt-006-recovery-maker-root-context-20260804-001`
- Checker run/context ID:
  `agt-006-recovery-checker-root-20260804-001` /
  `agt-006-recovery-checker-root-context-20260804-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:b56ed0c079d4d1a1c8e27bbeee80821b07febe89445bcb9e9393e2fa0eca4088`
- Maker manifest hash:
  `sha256:a89e51428787ff6a0cc721759714c710c95fa7c4e92642db05553e488f310c8b`
- Commands/procedure:
  - Recovery Maker manifest comparison -> 28/28 hashes, zero mismatches
  - Two-file recovery source receipt -> 2/2 hashes, zero mismatches
  - Original seven-file source-chain comparison -> two recovered and five
    unchanged sources, plus seven unchanged reviewed dependencies
  - `bun run test:agt-006` -> exit `0`, 6 tests with 48 assertions
  - backend strict TypeScript -> exit `0`
  - `bun run check:boundaries` -> exit `0`, 74 production sources
  - original rejecting time-uniform probe -> exit `0`, actual timestamps equal
    all expected targets, maximum target error 2 seconds,
    `timeUniformPassed=true`, and `indexUniformDetected=false`
  - `git diff --check` plus targeted whitespace review -> exit `0`
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/AGT-006/agt-006-recovery-checker-root-20260804-001/candidate-verification.json`
  - `.omx/artifacts/typescript-bun/AGT-006/agt-006-recovery-checker-root-20260804-001/source-chain-verification.json`
  - `.omx/artifacts/typescript-bun/AGT-006/agt-006-recovery-checker-root-20260804-001/time-uniform-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-006/agt-006-recovery-checker-root-20260804-001/agt-006-test.txt`
  - `.omx/artifacts/typescript-bun/AGT-006/agt-006-recovery-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/AGT-006/agt-006-recovery-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/AGT-006/agt-006-recovery-checker-root-20260804-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/AGT-006/agt-006-recovery-checker-root-20260804-001/manifest.sha256.json`
- Accepted assertions:
  - Nearby user text/final voice uses a non-extending one-second merge, trigger
    priority and exact screen threshold/cooldown/busy admission are preserved,
    and audience barrage cannot recursively trigger a wave.
  - Public/reply context is frozen at exact bounded windows and Room memory is
    bound by revision; future events are excluded from the frozen query.
  - The timeline keeps one frame per second over the available latest 120
    seconds, compares against segment references at 90% similarity and the
    five-second anchor, and retains segment-end representatives.
  - Direct mode excludes ordinary frames older than 30 seconds while always
    retaining the trigger frame. More than 15 representatives are sampled by
    timestamp targets, returned chronologically with timestamps and contiguous
    frame indexes, and capped at 15.
  - Creation/deadline metadata and replay identity remain deterministic.
  - `AGT-006` is `DONE`; its blocker is resolved; Phase 04 and only `AGT-007`
    are `READY`.
- Limitations:
  - Visual comparison and timeline evidence is deterministic and synthetic;
    credentialed Provider capability proof remains `AGT-015`.
  - SessionAudience and Viewer-pool behavior remains `AGT-007`; this acceptance
    does not claim that task complete.
  - No product implementation, Python oracle change/deletion, dependency/lock
    mutation, later task implementation, broad repository suite, commit, push,
    deploy, subagent, `output/`, or `promo/` work occurred in this Checker run.
- Related run log:
  - `agt-006-recovery-checker-root-20260804-001`

### AGT-007 / agt-007-checker-root-20260804-001

- Claim: Bun SessionAudience owns deterministic Viewer creation, exact
  per-Persona population, lifecycle/replacement, private state and sequence
  fences, runtime reconciliation, crash restore, and same-Session ID nonreuse.
- Status: `DONE`
- Evidence class: `deterministic_runtime`, `sqlite_integration`, `review`
- Maker run/context ID:
  `agt-007-maker-root-20260804-001` /
  `agt-007-maker-root-context-20260804-001`
- Checker run/context ID:
  `agt-007-checker-root-20260804-001` /
  `agt-007-checker-root-context-20260804-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:bacb62e6cda6ef63c965470b9b484ff659e4982094155ee7914b3e10c386d2b6`
- Maker manifest hash:
  `sha256:8f34a8e9253c6ff7f3b322eedbd11d4e7301f51119e1979742479e8f3995b527`
- Commands/procedure:
  - Maker manifest comparison -> 32/32 hashes, zero mismatches
  - Five-file source receipt aggregate -> exact match
  - `bun run test:agt-007` -> exit `0`, 5 tests with 57 assertions
  - `bun run test:dat-005` -> exit `0`, 3 tests with 26 assertions
  - backend strict TypeScript -> exit `0`
  - `bun run check:boundaries` -> exit `0`, 75 production sources
  - Checker-owned real SQLite lifecycle/reconcile/restore probe -> exit `0`
  - `git diff --check` -> exit `0`
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/AGT-007/agt-007-checker-root-20260804-001/candidate-verification.json`
  - `.omx/artifacts/typescript-bun/AGT-007/agt-007-checker-root-20260804-001/source-inspection.json`
  - `.omx/artifacts/typescript-bun/AGT-007/agt-007-checker-root-20260804-001/sqlite-session-audience-probe.ts`
  - `.omx/artifacts/typescript-bun/AGT-007/agt-007-checker-root-20260804-001/sqlite-session-audience-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-007/agt-007-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/AGT-007/agt-007-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/AGT-007/agt-007-checker-root-20260804-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/AGT-007/agt-007-checker-root-20260804-001/manifest.sha256.json`
- Accepted assertions:
  - Session seed deterministically produces exact 1-32 Viewer populations,
    Python-compatible stable identities, aliases, and microvariants.
  - Leave/rejoin preserves identity and private state; kick atomically
    tombstones the old identity and fills the exact Persona deficit with a new
    nonrecycled ordinal.
  - Latest-wins Viewer sequence fences reject stale commits, and personal
    cooldown excludes a Viewer only until its deadline.
  - Runtime revision reconciliation preserves eligible identities, resets
    changed Persona state, advances the audience/population revisions, and
    reaches exact Persona counts.
  - Eligible SQLite crash restore retains committed Viewer state, exact counts,
    identity, and the next never-recycled creation ordinal.
  - `AGT-007` is `DONE`; Phase 04 and only dependency-satisfied `AGT-009` are
    `READY`; `AGT-008` remains `TODO` on its declared dependency.
- Limitations:
  - Evidence is deterministic local runtime and SQLite integration evidence;
    credentialed Provider and platform packaging proof remain later tasks.
  - Candidate selection and independent Viewer context remain `AGT-009` and
    `AGT-008`; this acceptance does not claim either task complete.
  - No product implementation, Python oracle change/deletion, dependency/lock
    mutation, later task implementation, broad repository suite, commit, push,
    deploy, subagent, `output/`, or `promo/` work occurred in this Checker run.
- Related run log:
  - `agt-007-checker-root-20260804-001`

### AGT-009 / agt-009-checker-root-20260804-001

- Claim: Bun selects Viewer candidates locally and deterministically before
  Provider dispatch with exact user/system, screen, ambient, and direct-target
  budgets, replayable rotation, eligibility filtering, and no Director.
- Status: `DONE`
- Evidence class: `unit`, `static`, `review`
- Maker run/context ID:
  `agt-009-maker-root-20260804-001` /
  `agt-009-maker-root-context-20260804-001`
- Checker run/context ID:
  `agt-009-checker-root-20260804-001` /
  `agt-009-checker-root-context-20260804-001`
- Checker parent run ID: `root`
- Checker participated in Maker implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:c2ca998c333f96c2246c3876929426f50ae1dddc236ad98a17b4fe3f26940621`
- Maker manifest hash:
  `sha256:06f1ed3e7d1d5fa1f3ee092370c20ef96b555deaa37715cbc41d5248f5b357d6`
- Commands/procedure:
  - Maker manifest comparison -> 29/29 hashes, zero mismatches
  - Five-file source receipt aggregate -> exact match
  - `bun run --cwd apps/backend-bun test:agt-009` -> exit `0`, 5 tests with 33 assertions
  - `bun run --cwd apps/backend-bun typecheck` -> exit `0`
  - `bun run --cwd apps/backend-bun check:boundaries` -> exit `0`, 76 production sources
  - `git diff --check` -> exit `0`
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/AGT-009/agt-009-checker-root-20260804-001/candidate-verification.json`
  - `.omx/artifacts/typescript-bun/AGT-009/agt-009-checker-root-20260804-001/source-inspection.json`
  - `.omx/artifacts/typescript-bun/AGT-009/agt-009-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/AGT-009/agt-009-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/AGT-009/agt-009-checker-root-20260804-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/AGT-009/agt-009-checker-root-20260804-001/manifest.sha256.json`
- Accepted assertions:
  - User/final-voice/system-audio observations select at most 6 eligible
    candidates; screen selects `ceil(active population / 4)` in seeded replay
    order; ambient selects 2 through rotation.
  - An accurate Viewer or Persona mention selects exactly one eligible target;
    a missing, muted, or otherwise ineligible target receives no substitute.
  - Room, Session, audience epoch, storage presence, lifecycle presence, and
    active moderation are enforced; personal cooldown is not a hard mute.
  - Seed, epoch, observation, budget kind, and Viewer identity yield replayable
    ordering, while never-spoken and least-recent state provide fairness.
  - Selection imports no Provider, Director, or theme model and contains no
    post-generation ranking or discard path.
  - `AGT-009` is `DONE`; Phase 04 and only dependency-satisfied `AGT-008` are
    `READY`.
- Limitations:
  - Independent Viewer request construction/generation, publication fences,
    and credentialed Provider proof remain their declared later tasks.
  - Evidence is deterministic local unit/static review evidence; it makes no
    credentialed-live or platform claim.
  - No product implementation, Python oracle change/deletion, dependency/lock
    mutation, later task implementation, broad repository suite, commit, push,
    deploy, subagent, `output/`, or `promo/` work occurred in this Checker run.
- Related run log:
  - `agt-009-checker-root-20260804-001`

### AGT-008 / agt-008-checker-root-20260804-001

- Claim: Bun builds an immutable, isolated context for each candidate Viewer
  and exposes the product-authoritative independent barrage-or-silence
  decision contract without Director or global arbitration.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity:
  `sha256:13c6ce91f83da202342225d7d920c82992d22ef38791a5aad8c2dcc001850ed5`
- Date: 2026-08-04
- Environment: Windows, Bun 1.3.14, branch `TS_backend_refactor`
- Evidence class: `unit`, `static`, `review`
- Maker: root
- Maker run/context ID:
  `agt-008-maker-root-20260804-001` /
  `agt-008-maker-root-context-20260804-001`
- Checker: root
- Checker run/context ID:
  `agt-008-checker-root-20260804-001` /
  `agt-008-checker-root-context-20260804-001`
- Checker parent run ID: `root`
- Checker participated in implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:13c6ce91f83da202342225d7d920c82992d22ef38791a5aad8c2dcc001850ed5`
- Maker manifest hash:
  `sha256:849fdba0b6f7b15eb2e690cd2385a4818c551e87366ca4083f08830df3359b5a`
- Commands/procedure:
  - Maker manifest comparison -> 35/35 hashes, zero mismatches
  - Five-file source receipt aggregate -> exact match
  - `bun run --cwd apps/backend-bun test:agt-008` -> exit `0`, 4 tests with 46 assertions
  - `bun run --cwd apps/backend-bun typecheck` -> exit `0`
  - `bun run --cwd apps/backend-bun check:boundaries` -> exit `0`, 77 production sources
  - `git diff --check` -> exit `0`
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/AGT-008/agt-008-checker-root-20260804-001/candidate-verification.json`
  - `.omx/artifacts/typescript-bun/AGT-008/agt-008-checker-root-20260804-001/source-inspection.json`
  - `.omx/artifacts/typescript-bun/AGT-008/agt-008-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/AGT-008/agt-008-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/AGT-008/agt-008-checker-root-20260804-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/AGT-008/agt-008-checker-root-20260804-001/manifest.sha256.json`
- Accepted assertions:
  - Every context contains the complete current input, a 60-second public
    window bounded to 16 per source and 48 total, a 30-second/8-item reply
    window, at most 15 frames, and revisioned shared memory.
  - Full Persona, active-mode override, instance microvariant, and only the
    candidate's private state and cooldown are deeply cloned and frozen.
  - Session, epoch, observation, Viewer sequence, runtime, Persona, presence,
    moderation, behavior, Provider, model, and deadline fences are retained.
  - Same-wave contexts share frozen public evidence and memory while excluding
    peer private state and unpublished peer output; old summaries cannot enter.
  - Both barrage and silence remain legal for every Viewer; a direct Viewer or
    Persona mention does not force speech, and legacy window-batch or
    silence-disabled settings cannot override the current product contract.
  - No Director, theme model, Provider dispatch, global ranking, or
    multi-Viewer arbitration exists in the AGT-008 builder.
  - `AGT-008` is `DONE`; Phase 04 and only dependency-satisfied `AGT-010` are
    `READY`.
- Limitations:
  - Provider-backed per-Viewer generation, repair limits, publication pacing,
    and final side-effect fences remain their declared later tasks.
  - Evidence is deterministic local unit/static review evidence; it makes no
    credentialed-live or platform claim.
  - No product implementation, Python oracle change/deletion, dependency/lock
    mutation, later task implementation, broad repository suite, commit, push,
    deploy, subagent, `output/`, or `promo/` work occurred in this Checker run.
- Related run log:
  - `agt-008-checker-root-20260804-001`

### AGT-010 / agt-010-checker-root-20260804-001

- Claim: Bun performs one independent logical generation per selected Viewer
  and publishes accepted barrage texts immediately then every 500 ms through
  final-fenced, shared-history-owning commits.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity:
  `sha256:fdf6aa75a3b99df431e5c37e33ccb69719375b5764b4de319caa39deaebf3db7`
- Date: 2026-08-04
- Environment: Windows, Bun 1.3.14, branch `TS_backend_refactor`
- Evidence class: `unit`, `static`, `review`
- Maker: root
- Maker run/context ID:
  `agt-010-maker-root-20260804-001` /
  `agt-010-maker-root-context-20260804-001`
- Checker: root
- Checker run/context ID:
  `agt-010-checker-root-20260804-001` /
  `agt-010-checker-root-context-20260804-001`
- Checker parent run ID: `root`
- Checker participated in implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:fdf6aa75a3b99df431e5c37e33ccb69719375b5764b4de319caa39deaebf3db7`
- Maker manifest hash:
  `sha256:641cff0b1f2318213460a8a257fb9bf03388a681904e823d8b6eb7196f6774d5`
- Commands/procedure:
  - Maker manifest comparison -> 33/33 hashes, zero mismatches
  - Five-file source receipt aggregate -> exact match
  - `bun run --cwd apps/backend-bun test:agt-010` -> exit `0`, 5 tests with 47 assertions
  - `bun run --cwd apps/backend-bun typecheck` -> exit `0`
  - `bun run --cwd apps/backend-bun check:boundaries` -> exit `0`, 78 production sources
  - `git diff --check` -> exit `0`
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/AGT-010/agt-010-checker-root-20260804-001/candidate-verification.json`
  - `.omx/artifacts/typescript-bun/AGT-010/agt-010-checker-root-20260804-001/source-inspection.json`
  - `.omx/artifacts/typescript-bun/AGT-010/agt-010-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/AGT-010/agt-010-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/AGT-010/agt-010-checker-root-20260804-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/AGT-010/agt-010-checker-root-20260804-001/manifest.sha256.json`
- Accepted assertions:
  - Every selected Viewer receives one independent logical Provider-backed
    generation from only its frozen context and selected frame bytes.
  - Silence is a legal terminal result, including for an accurately directly
    mentioned Viewer, and causes no publication.
  - The first accepted text publishes without delay; every later accepted text
    waits for the prior committed publication time plus exactly 500 ms.
  - Every publication crosses one atomic final-fence/shared-history boundary;
    only successful commits enter shared history.
  - Viewer, target, intent, reaction type, evidence, parent event, and current
    input event linkage survive each publication.
  - Cancellation, expiry, supersession, or a stale final fence drops every
    remaining unpublished text without a later publication effect.
  - No Director, theme model, target-count discard, multi-Viewer generation,
    window batch, or global ranking path exists in AGT-010.
  - `AGT-010` is `DONE`; Phase 04 and only dependency-satisfied `AGT-011` are
    `READY`.
- Limitations:
  - The concrete schema-through-public-event barrage pipeline, dedupe, density,
    presence/moderation/revision checks, and one-time state updates remain
    `AGT-011`; broader race/property proof remains `AGT-013`.
  - Evidence is deterministic local unit/static review evidence; it makes no
    credentialed-live or platform claim.
  - No product implementation, Python oracle change/deletion, dependency/lock
    mutation, later task implementation, broad repository suite, commit, push,
    deploy, subagent, `output/`, or `promo/` work occurred in this Checker run.
- Related run log:
  - `agt-010-checker-root-20260804-001`

### AGT-011 / agt-011-recovery-checker-root-20260804-001

- Claim: Bun validates, deduplicates, density-limits, and atomically publishes
  evidence-backed Viewer barrage with exactly one bounded Viewer state update,
  including the product-authoritative 160-Unicode-code-point public boundary.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity:
  `sha256:e1f30fdbf99d7b442f9655c3b82f7a294e00c4c9bc17d7de5b9255cfad98f13a`
- Date: 2026-08-04
- Environment: Windows, Bun 1.3.14, branch `TS_backend_refactor`
- Evidence class: `unit`, `static`, `review`
- Maker: root
- Maker run/context ID:
  `agt-011-recovery-maker-root-20260804-001` /
  `agt-011-recovery-maker-root-context-20260804-001`
- Checker: root
- Checker run/context ID:
  `agt-011-recovery-checker-root-20260804-001` /
  `agt-011-recovery-checker-root-context-20260804-001`
- Checker parent run ID: `root`
- Checker participated in implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:e1f30fdbf99d7b442f9655c3b82f7a294e00c4c9bc17d7de5b9255cfad98f13a`
- Maker manifest hash:
  `sha256:c526edb09fa40b06253985a4a98d6e1c5b54a9f46a67a973aceddfdec6e0d6d9`
- Commands/procedure:
  - Maker manifest comparison -> 32/32 hashes, zero mismatches
  - Two-file source receipt aggregate -> exact match
  - Checker Unicode boundary probe -> exit `0`, 159/160 accepted, 161 rejected
  - `bun run --cwd apps/backend-bun test:agt-011` -> exit `0`, 5 tests with 37 assertions
  - `bun run --cwd packages/contracts test` -> exit `0`, 14 tests with 83 assertions
  - contracts/backend strict TypeScript -> exit `0`
  - `bun run --cwd apps/backend-bun check:boundaries` -> exit `0`, 79 production sources
  - `git diff --check` -> exit `0`
  - final `bun run migration:plan-check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/AGT-011/agt-011-recovery-checker-root-20260804-001/candidate-verification.json`
  - `.omx/artifacts/typescript-bun/AGT-011/agt-011-recovery-checker-root-20260804-001/source-inspection.json`
  - `.omx/artifacts/typescript-bun/AGT-011/agt-011-recovery-checker-root-20260804-001/unicode-boundary-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-011/agt-011-recovery-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/AGT-011/agt-011-recovery-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/AGT-011/agt-011-recovery-checker-root-20260804-001/plan-check-final.json`
  - `.omx/artifacts/typescript-bun/AGT-011/agt-011-recovery-checker-root-20260804-001/manifest.sha256.json`
- Accepted assertions:
  - The ordered pipeline enforces local Viewer identity, scope, observation,
    sequence, deadline/cancellation, lifecycle, moderation, revision,
    evidence/target, blocked-content, semantic-deduplication, and committed
    density fences before public publication.
  - Runtime string `minLength`/`maxLength` uses Unicode code points and the
    public barrage JSON Schema still declares `maxLength: 160`; 160 astral
    code points publish intact and 161 are rejected at the schema boundary.
  - Each successful idempotent serialized commit couples the canonical public
    event, duplicate/density history, and exactly one bounded Viewer cooldown,
    behavior-revision, relationship, and private-state update.
  - Rejection changes no public history or Viewer state and cannot write
    memory; delayed batch texts retain exact prefix and revision fences.
  - `AGT-011` is `DONE`, its blocker is resolved, and Phase 04 plus only
    dependency-satisfied `AGT-012` are `READY`.
- Limitations:
  - Memory/meme extraction and persistence remain `AGT-012`; broader generated
    cancellation/race proof remains `AGT-013`.
  - Evidence is deterministic local unit/static review evidence; it makes no
    credentialed-live or platform claim.
  - No product implementation, Python oracle change/deletion, dependency/lock
    mutation, later task implementation, broad repository suite, commit, push,
    deploy, subagent, `output/`, or `promo/` work occurred in this Checker run.
- Related run log:
  - `agt-011-recovery-checker-root-20260804-001`

### AGT-012 / agt-012-checker-root-20260804-001

- Claim: Bun detaches bounded, evidence-backed memory extraction after newly
  committed public events and preserves separate mode-meme persistence side
  effects without blocking the public barrage.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity:
  `sha256:9d4e793bb5783cbb21fc35071a43bb8230421b25cb90bfdc076db2809f917ce7`
- Date: 2026-08-04
- Environment: Windows, Bun 1.3.14, branch `TS_backend_refactor`
- Evidence class: `unit`, `static`, `review`
- Maker: root
- Maker run/context ID:
  `agt-012-maker-root-20260804-001` /
  `agt-012-maker-root-context-20260804-001`
- Checker: root
- Checker run/context ID:
  `agt-012-checker-root-20260804-001` /
  `agt-012-checker-root-context-20260804-001`
- Checker parent run ID: `root`
- Checker participated in implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:9d4e793bb5783cbb21fc35071a43bb8230421b25cb90bfdc076db2809f917ce7`
- Maker manifest hash:
  `sha256:0720d5a4f68fc87a94c8040f7e216ff09a5222d74b46f1ab78dff45403afdf34`
- Commands/procedure:
  - Maker manifest comparison -> 41/41 hashes, zero mismatches
  - Ten-file source receipt aggregate -> exact match
  - Protected repository/SQLite/Python parity source hashes -> unchanged
  - `bun run --cwd apps/backend-bun test:agt-012` -> exit `0`, 10 tests with 68 assertions
  - `bun run --cwd apps/backend-bun test:agt-010` -> exit `0`, 5 tests with 48 assertions
  - `bun run --cwd apps/backend-bun typecheck` -> exit `0`
  - `bun run --cwd apps/backend-bun check:boundaries` -> exit `0`, 81 production sources
  - targeted source hygiene -> exit `0`, ten AGT-012 files
  - final `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/AGT-012/agt-012-checker-root-20260804-001/checker-source-review.json`
  - `.omx/artifacts/typescript-bun/AGT-012/agt-012-checker-root-20260804-001/checker-source-aggregate.json`
  - `.omx/artifacts/typescript-bun/AGT-012/agt-012-checker-root-20260804-001/maker-manifest-check.json`
  - `.omx/artifacts/typescript-bun/AGT-012/agt-012-checker-root-20260804-001/checker-source-hygiene.json`
  - `.omx/artifacts/typescript-bun/AGT-012/agt-012-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/AGT-012/agt-012-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/AGT-012/agt-012-checker-root-20260804-001/plan-check-final.txt`
  - `.omx/artifacts/typescript-bun/AGT-012/agt-012-checker-root-20260804-001/manifest.sha256.json`
- Accepted assertions:
  - Only a newly committed public event submits one bounded side-effect task;
    idempotent replay and side-effect failure do not block or repeat it.
  - The memory-role Provider receives owned public evidence under current
    Session and exact memory-head fences; stable identity prevents deleted or
    revoked memory re-entry.
  - Mode-meme proposal/storage is a separate typed path with current-scope and
    provenance checks, namespace auto-ingest, durable source, undo, 0.5 decay,
    30-day archive, and pin exclusion.
  - No Director shortcut or candidate-to-barrage conversion exists in the
    AGT-012 surface.
- Limitations:
  - Memory-role Provider proof is deterministic fake evidence, not a
    credentialed-live Provider claim; broader stale-work race proof remains
    `AGT-013`.
  - No product implementation, Python oracle change/deletion, dependency/lock
    mutation, later task implementation, broad repository suite, commit, push,
    deploy, subagent, `output/`, or `promo/` work occurred in this Checker run.
- Related run log:
  - `agt-012-checker-root-20260804-001`

### AGT-013 / agt-013-checker-root-20260804-002

- Claim: Bun runtime-owned stale work is cooperatively cancellable and drained
  at session stop/runtime replacement boundaries, with rejected results causing
  zero visible, private, memory, meme, cooldown, or outbox side effects.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity:
  `sha256:29beeafde4842f6d70ba5ec163aa9d205d9aa18ee7e2973a9ce5a3ec96b35481`
- Date: 2026-08-04
- Environment: Windows, Bun 1.3.14, branch `TS_backend_refactor`
- Evidence class: `unit`, `static`, `review`
- Maker: root
- Maker run/context ID:
  `agt-013-maker-root-20260804-001` /
  `agt-013-maker-root-context-20260804-001`
- Checker: root
- Checker run/context ID:
  `agt-013-checker-root-20260804-002` /
  `agt-013-checker-root-context-20260804-002`
- Checker parent run ID: `root`
- Checker participated in implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:29beeafde4842f6d70ba5ec163aa9d205d9aa18ee7e2973a9ce5a3ec96b35481`
- Maker manifest hash:
  `sha256:45ce27719f927be5602809d70c3194c7446b2ec1bcb53d1ce5efa1e06e3d041f`
- Commands/procedure:
  - Maker manifest comparison -> 36/36 hashes, zero mismatches
  - Five-file source receipt aggregate -> exact match
  - `bun run --cwd apps/backend-bun test:agt-013` -> exit `0`, 4 tests with 25 assertions
  - `bun run --cwd apps/backend-bun test:bck-005` -> exit `0`, 5 tests with 57 assertions
  - `bun run --cwd apps/backend-bun test:bck-006` -> exit `0`, 9 tests with 85 assertions
  - `bun run --cwd apps/backend-bun typecheck` -> exit `0`
  - `bun run --cwd apps/backend-bun check:boundaries` -> exit `0`, 81 production sources
  - final `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/AGT-013/agt-013-checker-root-20260804-002/maker-manifest-check.json`
  - `.omx/artifacts/typescript-bun/AGT-013/agt-013-checker-root-20260804-002/source-review.json`
  - `.omx/artifacts/typescript-bun/AGT-013/agt-013-checker-root-20260804-002/source-hygiene.json`
  - `.omx/artifacts/typescript-bun/AGT-013/agt-013-checker-root-20260804-002/validation.json`
  - `.omx/artifacts/typescript-bun/AGT-013/agt-013-checker-root-20260804-002/verdict.md`
  - `.omx/artifacts/typescript-bun/AGT-013/agt-013-checker-root-20260804-002/manifest.sha256.json`
- Accepted assertions:
  - The transient task scope tracks active tasks, passes an AbortSignal and
    typed cancellation reason, cancels all owned work, and drains it.
  - Lifecycle stop and runtime replacement cancel/drain before terminal or
    replacement state commits.
  - The deterministic schedule matrix covers stop during ASR-shaped work, new
    input during Viewer generation, repair retry epoch change, Viewer kick,
    deadline boundary, delayed batch replacement, crash-before-publication,
    stale-token reconnect, and queue overflow; all seven side-effect counters
    remain zero for rejected work.
- Limitations:
  - This task-level proof accepts the deterministic schedule matrix; fast-check
    generated model/property coverage remains the separately owned `TST-004`.
  - The adjacent BCK-010 real-child probe remains an external platform failure;
    accepted BCK-010 evidence is unchanged and this does not block AGT-013.
  - No Python oracle change/deletion, dependency/lock mutation, later task
    implementation, broad repository suite, commit, push, deploy, subagent,
    `output/`, or `promo/` work occurred in this Checker run.
- Related run log:
  - `agt-013-checker-root-20260804-002`

### AGT-014 / agt-014-checker-root-20260804-002

- Claim: Deterministic fake and sanitized recorded ASR/model adapters provide
  offline replay evidence with explicit source metadata, deterministic latency,
  configured provider failures, caller/deadline abort controls, and no live
  fallback path.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity: `sha256:b4042fc6f6f80b841fe262631c0cf29478a4cb263c1c47ff4a02d4efbbcbf58d`
- Date: 2026-08-04
- Environment: Windows, Bun 1.3.14, branch `TS_backend_refactor`
- Evidence class: `unit`, `static`, `review`
- Maker: root
- Maker run/context ID:
  `agt-014-maker-root-20260804-001` /
  `agt-014-maker-root-context-20260804-001`
- Checker: root
- Checker run/context ID:
  `agt-014-checker-root-20260804-002` /
  `agt-014-checker-root-context-20260804-002`
- Checker parent run ID: `root`
- Checker participated in implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:b4042fc6f6f80b841fe262631c0cf29478a4cb263c1c47ff4a02d4efbbcbf58d`
- Maker manifest hash:
  `sha256:d0ea8509ce31dbcc9f804f071a3b7d55cde26e83fc3c8796f1fc0000e5f28d39`
- Commands/procedure:
  - Maker manifest comparison -> 38/38 hashes, zero mismatches
  - Eight-file source receipt aggregate -> exact match
  - `bun run --cwd apps/backend-bun test:agt-014` -> exit `0`, 4 tests with 16 assertions
  - `bun run --cwd apps/backend-bun test:agt-002` -> exit `0`, 11 tests with 56 assertions
  - `bun run --cwd apps/backend-bun test:agt-003` -> exit `0`, 5 tests with 36 assertions
  - `bun run --cwd apps/backend-bun typecheck` -> exit `0`
  - `bun run --cwd apps/backend-bun check:boundaries` -> exit `0`, 85 production sources
  - Targeted source hygiene -> exit `0`, zero forbidden references
  - Final `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 62 accepted evidence, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/AGT-014/agt-014-checker-root-20260804-002/maker-manifest-check.json`
  - `.omx/artifacts/typescript-bun/AGT-014/agt-014-checker-root-20260804-002/source-review.json`
  - `.omx/artifacts/typescript-bun/AGT-014/agt-014-checker-root-20260804-002/source-hygiene.json`
  - `.omx/artifacts/typescript-bun/AGT-014/agt-014-checker-root-20260804-002/validation.json`
  - `.omx/artifacts/typescript-bun/AGT-014/agt-014-checker-root-20260804-002/verdict.md`
  - `.omx/artifacts/typescript-bun/AGT-014/agt-014-checker-root-20260804-002/manifest.sha256.json`
- Accepted assertions:
  - Deterministic fake ASR and model adapters are stable and never use live
    transport.
  - Recorded sanitized SSE/model fixtures are explicitly labeled and fail
    closed when a response is missing.
  - Evidence metadata distinguishes fake from recorded sources and fixes
    `liveFallback` to `false`.
  - Latency, provider failure, caller abort, and deadline abort are covered by
    focused tests.
- Limitations:
  - No credentialed-live Provider claim is made; AGT-015 owns live capability
    proof or an authorized accepted limitation.
  - No Python oracle change/deletion, dependency/lock mutation, later task
    implementation, broad repository suite, commit, push, deploy, subagent,
    `output/`, or `promo/` work occurred in this Checker run.
- Related run log:
  - `agt-014-checker-root-20260804-002`

### AGT-015 / agt-015-checker-root-20260804-002

- Claim: Credentialed live capability is proven for the current Bun Provider
  adapters: isolated StepFun ASR calls for microphone and system audio, plus a
  compatible multimodal Viewer call through the OpenAI-compatible model port.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity: `sha256:c98a5fba70a06ae8a9409276e3e8c9bc5ded88ff6d0c1559dd5d98bc73388b80`
- Date: 2026-08-04
- Environment: Windows, Bun 1.3.14, branch `TS_backend_refactor`
- Evidence class: `credentialed_live`, `unit`, `static`, `review`
- Maker: root
- Maker run/context ID:
  `agt-015-maker-root-20260804-001` /
  `agt-015-maker-root-context-20260804-001`
- Checker: root
- Checker run/context ID:
  `agt-015-checker-root-20260804-002` /
  `agt-015-checker-root-context-20260804-002`
- Checker parent run ID: `root`
- Checker participated in implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:c98a5fba70a06ae8a9409276e3e8c9bc5ded88ff6d0c1559dd5d98bc73388b80`
- Maker manifest hash:
  `sha256:633e4c0f2547ff5a32926bdb4e3735c1e668ffe9daea699d96fe2b315111938b`
- Commands/procedure:
  - Maker manifest comparison -> 29/29 hashes, zero mismatches
  - Two-file source receipt aggregate -> exact match
  - `AGT015_LIVE_CONSENT=1 bun run --cwd apps/backend-bun proof:agt-015` -> exit `0`
  - Live StepFun ASR -> final event for `microphone` and final event for `system_audio`
  - Live `step-3.7-flash` Viewer -> PNG accepted, text output length `17`, `finishReason=stop`
  - Live cancellation/deadline -> ASR `aborted`/`timeout`; model `aborted`/`timeout`
  - Consent guard without `AGT015_LIVE_CONSENT` -> exit `1`, no network call
  - `bun run --cwd apps/backend-bun typecheck` -> exit `0`
  - Secret leak scan -> no API key occurrence in Maker or Checker artifacts
  - Final `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 63 accepted evidence, zero errors
- Artifacts:
  - `.omx/artifacts/typescript-bun/AGT-015/agt-015-maker-root-20260804-001/live-proof.txt`
  - `.omx/artifacts/typescript-bun/AGT-015/agt-015-checker-root-20260804-002/live-proof.txt`
  - `.omx/artifacts/typescript-bun/AGT-015/agt-015-checker-root-20260804-002/maker-manifest-check.json`
  - `.omx/artifacts/typescript-bun/AGT-015/agt-015-checker-root-20260804-002/source-review.json`
  - `.omx/artifacts/typescript-bun/AGT-015/agt-015-checker-root-20260804-002/validation.json`
  - `.omx/artifacts/typescript-bun/AGT-015/agt-015-checker-root-20260804-002/verdict.md`
  - `.omx/artifacts/typescript-bun/AGT-015/agt-015-checker-root-20260804-002/manifest.sha256.json`
- Accepted assertions:
  - Destination metadata is `https://api.stepfun.com/v1` for ASR and the
    OpenAI-compatible model call; model metadata is `stepaudio-2.5-asr` and
    `step-3.7-flash`.
  - ASR channels are invoked separately and each returns a final normalized
    event from the live HTTP/SSE adapter.
  - The live Viewer request carries a PNG image through the ModelProvider port
    and returns non-empty text with a normal stop finish.
  - Cancellation and deadline behavior is fail-closed and bounded, and live
    execution requires explicit consent.
- Limitations:
  - The live proof uses synthetic PCM and a one-pixel PNG; no user media was
    used or persisted.
  - This task does not claim desktop supervision, process cleanup, or complete
    `GATE-04`; those remain the next canonical gate task.
  - No Python oracle change/deletion, dependency/lock mutation, later task
    implementation, broad repository suite, commit, push, deploy, subagent,
    `output/`, or `promo/` work occurred in this Checker run.
- Related run log:
  - `agt-015-checker-root-20260804-002`

### GATE-04 / gate-04-checker-root-20260804-002

- Claim: The Phase 04 agent-runtime checklist is satisfied by accepted
  evidence from AGT-001 through AGT-015, with no structural Director product
  semantics and explicit separation of fake, recorded, and credentialed-live
  Provider evidence.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity:
  `sha256:41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Date: 2026-08-04
- Environment: Windows, Bun 1.3.14, branch `TS_backend_refactor`
- Evidence class: `static`, `review`
- Maker: root
- Maker run/context ID:
  `gate-04-maker-root-20260804-001` /
  `gate-04-maker-root-context-20260804-001`
- Checker: root
- Checker run/context ID:
  `gate-04-checker-root-20260804-002` /
  `gate-04-checker-root-context-20260804-002`
- Checker parent run ID: `root`
- Checker participated in implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Maker manifest hash:
  `sha256:4ec4a74f9d7dfc7a3d9d359f8a4df7da30de42cc7a805b21f442a21f42ae87e5`
- Commands/procedure:
  - Maker manifest comparison -> 49/49 hashes, zero mismatches
  - Current source review -> zero structural Director matches, isolated
    `microphone` and `system_audio` ASR providers, and AI SDK retries `0`
  - `bun run --cwd apps/backend-bun typecheck` -> exit `0`
  - `bun run --cwd apps/backend-bun check:boundaries` -> exit `0`, 85
    production sources
  - Final `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 64
    accepted evidence, zero errors
  - `git diff --check -- apps/backend-bun docs/migrations/typescript-bun
    .omx/ultragoal/ledger.jsonl` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/GATE-04/gate-04-maker-root-20260804-001/`
  - `.omx/artifacts/typescript-bun/GATE-04/gate-04-checker-root-20260804-002/`
- Accepted assertions:
  - Accepted AGT-001..AGT-015 evidence covers isolated/cancellation-safe ASR,
    degraded and late-pairing turns, replaceable ModelGateway with bounded
    two-request behavior, exact wave/frame timing, deterministic candidate
    selection, independent Viewers, barrage fences, stale-work zero-side-effect
    behavior, and nonblocking memory/meme side effects.
  - Current Bun source review finds no structural Director implementation and
    keeps fake, recorded, and credentialed-live evidence classes separate.
- Limitations:
  - This gate does not claim Electron-to-Bun supervision, Bun process launch,
    route wiring, or orphan-process cleanup; Phase 05 DES tasks own those
    claims beginning with `DES-001`.
  - Accepted upstream evidence was reused; unchanged broad suites were not
    rerun. No Python oracle change/deletion, dependency/lock mutation, later
    task implementation, commit, push, deploy, subagent, `output/`, or `promo/`
    work occurred in this Checker run.
- Related run log:
  - `gate-04-checker-root-20260804-002`

### DES-001 / des-001-checker-root-20260804-002

- Claim: Electron Main now depends on a runtime-neutral backend supervisor
  interface while Python-specific command construction remains in a temporary
  adapter.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity:
  `sha256:2f408ab7f96a1776b9e85bb607829cc67fee983cef2e3db17e43b7dc4b641c44`
- Date: 2026-08-04
- Environment: Windows, Node 22.23.1, Bun workspace, branch
  `TS_backend_refactor`
- Evidence class: `unit`, `static`, `review`
- Maker: root
- Maker run/context ID:
  `des-001-maker-root-20260804-001` /
  `des-001-maker-root-context-20260804-001`
- Checker: root
- Checker run/context ID:
  `des-001-checker-root-20260804-002` /
  `des-001-checker-root-context-20260804-002`
- Checker parent run ID: `root`
- Checker participated in implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:2f408ab7f96a1776b9e85bb607829cc67fee983cef2e3db17e43b7dc4b641c44`
- Commands/procedure:
  - Four-file source receipt -> exact aggregate match
  - `pnpm --filter @advx/desktop exec vitest run src/main/backend/backend-process.test.ts` -> exit `0`, 11 tests passed
  - `pnpm exec tsc --noEmit -p apps/desktop/tsconfig.node.json` -> exit `0`
  - `git diff --check -- apps/desktop/src/main/backend apps/desktop/src/main/index.ts` -> exit `0`
  - Source review -> all eight lifecycle methods, identity/exit metadata,
    Python adapter boundary, and app-quit `dispose()` confirmed
- Artifacts:
  - `.omx/artifacts/typescript-bun/DES-001/des-001-maker-root-20260804-001/`
  - `.omx/artifacts/typescript-bun/DES-001/des-001-checker-root-20260804-002/`
- Accepted assertions:
  - `BackendSupervisor` exposes `prepare`, `start`, `waitReady`, `status`,
    `restart`, `stop`, `forceStop`, and `dispose` for spawned and external
    backends.
  - Identity carries version, port, token, data directory, log location,
    instance ID, and PID; exits carry code, signal, PID, instance ID,
    timestamp, and expected/unexpected state.
  - Python `uv`/Uvicorn command construction is isolated in
    `backend-process-python.ts`; renderer boundaries do not expose the
    supervisor.
- Limitations:
  - Full desktop typecheck still reports unrelated renderer-only errors and
    was not expanded into this task.
  - Bun source/compiled launch, startup auth injection, and orphan cleanup
    remain DES-002/DES-003/DES-004/DES-005 scope.
  - No Python oracle change/deletion, dependency/lock mutation, later task,
    commit, push, deploy, subagent, `output/`, or `promo/` work occurred.
- Related run log:
  - `des-001-checker-root-20260804-002`

### DES-002 / des-002-checker-root-20260805-001

- Claim: Electron Main can launch and supervise the Bun source backend in
  unpackaged development without leaking Provider secrets or weakening the
  loopback startup boundary.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity: `sha256:469ca45c392cb72527d691f0fbd8d87c309e5c092f8048c32136a801ee124a4d`
- Date: 2026-08-05
- Environment: Windows, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `integration`, `unit`, `static`, `review`
- Maker: root
- Maker run/context ID:
  `des-002-maker-root-20260804-001` /
  `des-002-maker-root-context-20260804-001`
- Checker: root
- Checker run/context ID:
  `des-002-checker-root-20260805-001` /
  `des-002-checker-root-context-20260805-001`
- Checker parent run ID: `root`
- Checker participated in implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:469ca45c392cb72527d691f0fbd8d87c309e5c092f8048c32136a801ee124a4d`
- Maker manifest hash:
  `sha256:8d35ffc0b6c8d480de7417f4f185c8e09463e916973f7c56727e99a2f62f0002`
- Commands/procedure:
  - Maker manifest comparison -> 17/17 entries, zero mismatches
  - Source aggregate recomputation -> exact five-file match
  - `pnpm --filter @advx/desktop exec vitest run src/main/backend/backend-process.test.ts` -> exit `0`, 13 tests passed; real Bun child authenticated `/health` and disposed cleanly
  - `pnpm exec tsc --noEmit -p apps/desktop/tsconfig.node.json` -> exit `0`
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 65 accepted evidence, zero errors
  - `git diff --check -- apps/desktop/src/main/backend apps/desktop/src/main/index.ts docs/migrations/typescript-bun .omx/ultragoal/ledger.jsonl` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/DES-002/des-002-maker-root-20260804-001/`
  - `.omx/artifacts/typescript-bun/DES-002/des-002-checker-root-20260805-001/`
- Accepted assertions:
  - `ADVX_BACKEND_RUNTIME=bun-source` selects the unpackaged Bun source path;
    Python remains the default oracle.
  - Bun is resolved to an absolute executable without shell interpolation and
    runs `apps/backend-bun/src/main.ts` from the repository root on the
    assigned loopback port.
  - The child uses an isolated data directory, explicit environment allowlist,
    inherited stdin startup token, authenticated health readiness deadline,
    hidden-window spawn, inherited development logging, and supervisor-owned
    process-tree termination.
  - Ambient `ADVX_LOCAL_TOKEN`, Provider profile JSON, API-key variables, and
    startup credentials are absent from child args/environment/log forwarding.
- Limitations:
  - Compiled Bun launch is DES-003; selector convergence and broader restart /
    orphan policy remain later DES tasks.
  - Full desktop renderer typecheck retains unrelated pre-existing errors and
    was not expanded. No Python oracle change/deletion, dependency/lock
    mutation, commit, push, deploy, `output/`, or `promo/` work occurred.
- Related run log:
  - `des-002-checker-root-20260805-001`

### DES-003 / des-003-checker-root-20260805-002

- Claim: Electron Main can launch the Phase 00/08 compiled Bun backend from
  unpackaged or packaged resource paths with explicit cwd and a scrubbed child
  environment.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity:
  `sha256:1102c128d63aed343550cf5009135fe60ba92d292a8e3da40a5c439869d2cdcf`
- Date: 2026-08-05
- Environment: Windows, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `integration`, `unit`, `static`, `review`
- Maker: root
- Maker run/context ID:
  `des-003-maker-root-20260805-001` /
  `des-003-maker-root-context-20260805-001`
- Checker: root
- Checker run/context ID:
  `des-003-checker-root-20260805-002` /
  `des-003-checker-root-context-20260805-002`
- Checker parent run ID: `root`
- Checker participated in implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:1102c128d63aed343550cf5009135fe60ba92d292a8e3da40a5c439869d2cdcf`
- Maker manifest hash:
  `sha256:c159ec29b3851284f51872fa0b61d2c9745be5b157727acc9c34498f13da6cbe`
- Compiled artifact:
  `advx-des003-probe.exe`, 100083200 bytes,
  `sha256:161b819e504358d7a7e93fe8d2355d2e94e94edda880e1e7e5e8cef89d8f9e21`,
  Windows x64, explicitly `unsigned-local`.
- Commands/procedure:
  - Maker manifest comparison -> 23/23 entries, zero mismatches
  - Source aggregate recomputation -> exact seven-file match
  - `bun build apps/backend-bun/src/main.ts --compile --no-compile-autoload-dotenv --no-compile-autoload-bunfig --no-compile-autoload-package-json --no-compile-autoload-tsconfig --outfile .omx/artifacts/typescript-bun/DES-003/advx-des003-probe.exe` -> exit `0`
  - `bun .../compiled-smoke.ts` -> exit `0`; hostile cwd, authenticated `/health` 200, protocol `3`, empty args, scrubbed Bun/provider environment, clean dispose
  - `pnpm --filter @advx/desktop exec vitest run src/main/backend/backend-process.test.ts` -> exit `0`, 15 tests passed
  - `pnpm exec tsc --noEmit -p apps/desktop/tsconfig.node.json` -> exit `0`
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 66 accepted evidence, zero errors
  - `git diff --check -- apps/desktop/src/main/backend apps/desktop/src/main/index.ts docs/migrations/typescript-bun .omx/ultragoal/ledger.jsonl` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/DES-003/des-003-maker-root-20260805-001/`
  - `.omx/artifacts/typescript-bun/DES-003/des-003-checker-root-20260805-002/`
- Accepted assertions:
  - Packaged resources resolve under `resourcesPath/backend`; unpackaged mode
    supports a repository-relative default and explicit executable override.
  - The compiled process has an explicit cwd and no Bun CLI/source arguments.
  - Missing, non-file, non-executable, quarantined, wrong-architecture, and
    optional unsigned-policy failures are explicit; `BUN_BE_BUN`, `BUN_INSTALL`,
    Bun config variables, API keys, Provider profiles, and ambient secrets are
    absent from the child environment.
  - Inherited stdin startup auth, authenticated readiness, hidden window, and
    supervisor process-tree ownership are preserved.
- Limitations:
  - The smoke artifact is unsigned by design; release signing and
    electron-builder `extraResources` packaging belong to later packaging
    tasks. No Python oracle change/deletion, dependency/lock mutation, commit,
    push, deploy, `output/`, or `promo/` work occurred.
- Related run log:
  - `des-003-checker-root-20260805-002`

### DES-004 / des-004-checker-root-20260805-004

- Claim: Electron Main preserves short-lived authenticated startup and secure
  Provider-secret injection for Bun source and compiled backend paths without
  weakening renderer or Python parity boundaries.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Date: 2026-08-05
- Environment: Windows, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `integration`, `unit`, `static`, `review`
- Maker: root
- Maker run/context ID:
  `des-004-maker-root-20260805-003` /
  `des-004-maker-root-context-20260805-003`
- Checker: root
- Checker run/context ID:
  `des-004-checker-root-20260805-004` /
  `des-004-checker-root-context-20260805-004`
- Checker parent run ID: `root`
- Checker participated in implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:f9ddebc3d05897bac6e49c6e7a30515f1902ebcf5ad907994c3b87d91d4b3bbb`
- Maker manifest: 27/27 entries matched with zero mismatches.
- Reviewed source aggregate:
  `sha256:f9ddebc3d05897bac6e49c6e7a30515f1902ebcf5ad907994c3b87d91d4b3bbb`
- Commands/procedure:
  - Fresh desktop auth/process tests -> exit `0`, 18 tests passed across two files
  - Fresh Bun authentication/configuration tests -> exit `0`, 10 tests passed
  - `pnpm exec tsc --noEmit -p apps/desktop/tsconfig.node.json` -> exit `0`
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 68 accepted evidence, zero errors
  - `git diff --check -- apps/desktop/src/main/backend apps/desktop/src/main/index.ts docs/migrations/typescript-bun .omx/ultragoal/ledger.jsonl` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/DES-004/des-004-maker-root-20260805-003/`
  - `.omx/artifacts/typescript-bun/DES-004/des-004-checker-root-20260805-004/`
- Accepted assertions:
  - Main creates the startup credential from fresh random bytes and does not
    accept ambient `ADVX_LOCAL_TOKEN` as the desktop credential.
  - Bun source passes `--no-env-file`; both Bun modes keep startup auth on the
    inherited stdin channel and exclude the token, Provider/API-key fields,
    `BUN_BE_BUN`, `BUN_CONFIG_FILE`, and other unapproved runtime controls from
    child args/environment.
  - Temporary startup bytes are cleared on supervisor stdin completion/error;
    ordinary output redacts bearer credentials.
  - Electron `safeStorage` remains the persisted Provider credential owner;
    only Main decrypts and injects the selected current profile through the
    authenticated client, while preload/renderer expose no token or supervisor
    bridge. Stop clears transient Provider/runtime state.
  - Python remains the parity oracle and was not deleted or changed by this
    Checker.
- Limitations:
  - Bun control-route compatibility remains DES-006 scope; full renderer and
    repository suites were not expanded for this Main-boundary task.
  - No Python oracle change/deletion, dependency/lock mutation, later task,
    commit, push, deploy, `output/`, or `promo/` work occurred.
- Related run log:
  - `des-004-maker-root-20260805-003`
  - `des-004-checker-root-20260805-004`

### DES-005 / des-005-checker-root-20260805-006

- Claim: Desktop health/restart supervision reports backend loss as a fatal
  renderer state and stops active capture without late ingest, while retaining
  bounded readiness, restart, and child-process cleanup behavior.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Date: 2026-08-05
- Environment: Windows, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `integration`, `unit`, `static`, `review`
- Maker: root
- Maker run/context ID:
  `des-005-maker-root-20260805-005` /
  `des-005-maker-root-context-20260805-005`
- Checker: root
- Checker run/context ID:
  `des-005-checker-root-20260805-006` /
  `des-005-checker-root-context-20260805-006`
- Checker parent run ID: `root`
- Checker participated in implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:e58181ee2c8ddbb42943a5515bff9583ad965b58463c9f4f5ab47d4e51d21e30`
- Maker manifest: 13/13 entries matched with zero mismatches.
- Reviewed source aggregate:
  `sha256:e58181ee2c8ddbb42943a5515bff9583ad965b58463c9f4f5ab47d4e51d21e30`
- Commands/procedure:
  - Maker manifest and source-receipt recomputation -> exit `0`, exact match
  - `pnpm --filter @advx/desktop exec vitest run src/renderers/control/hooks/useMediaController.test.ts src/main/backend/backend-process.test.ts` -> exit `0`, 19 tests passed across two files
  - `pnpm exec tsc --noEmit -p apps/desktop/tsconfig.node.json` -> exit `0`
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 68 accepted evidence, zero errors
  - `git diff --check -- apps/desktop/src/main apps/desktop/src/shared apps/desktop/src/renderers/control/hooks docs/migrations/typescript-bun .omx/ultragoal/ledger.jsonl` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/DES-005/des-005-maker-root-20260805-005/`
  - `.omx/artifacts/typescript-bun/DES-005/des-005-checker-root-20260805-006/`
- Accepted assertions:
  - A connected-to-disconnected transition triggers cleanup only when an AI
    audience session is active; local preview and idle sessions are not
    interrupted.
  - The backend-loss branch disables the audience ingest ref before stopping
    display, camera, microphone, and system-audio capture, releases the
    overlay, and dispatches a fatal session error without attempting a stop
    request against an unavailable backend.
  - Existing protocol-v3 health readiness, explicit restart-budget enforcement,
    bounded three-attempt recovery, Windows process-tree termination, and app
    shutdown disposal remain intact and are covered by the fresh supervisor
    suite/source review.
  - Main logging and the shared lifecycle contract accept the typed
    `backend-loss` reason; the Python parity oracle remains present and
    unchanged.
- Limitations:
  - Renderer web typecheck still reports pre-existing `AudienceMode` and
    frame-bundle errors in unrelated control surfaces; it is not a DES-005
    acceptance gate.
  - Packaged Electron crash/update/uninstall orphan evidence remains later
    packaging scope. No Python oracle change/deletion, dependency/lock
    mutation, later task implementation, commit, push, deploy, `output/`, or
    `promo/` work occurred.
- Related run log:
  - `des-005-maker-root-20260805-005`
  - `des-005-checker-root-20260805-006`

### DES-006 / des-006-checker-root-20260805-010

- Claim: Desktop control calls use one compatibility adapter whose Python
  default remains intact while the explicit Bun transport is bound to the
  reserved generated Bun OpenAPI operation and response types.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Date: 2026-08-05
- Environment: Windows, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `integration`, `unit`, `static`, `review`
- Maker: root
- Maker run/context ID:
  `des-006-recovery-maker-root-20260805-009` /
  `des-006-recovery-maker-root-context-20260805-009`
- Checker: root
- Checker run/context ID:
  `des-006-checker-root-20260805-010` /
  `des-006-checker-root-context-20260805-010`
- Checker parent run ID: `root`
- Checker participated in implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:10db4f2290397e85d8bdfba0e9c5bb5647a8419c3fb6e174943ba2ba859e1fa4`
- Maker manifest: 14/14 entries matched with zero mismatches.
- Reviewed source aggregate:
  `sha256:10db4f2290397e85d8bdfba0e9c5bb5647a8419c3fb6e174943ba2ba859e1fa4`
- Commands/procedure:
  - Case-sensitive generated import-boundary probe -> exit `0`, Python map
    `false`, Bun map `true`, generated Bun witness `true`
  - `pnpm --filter @advx/desktop exec vitest run src/main/backend/backend-control-adapter.test.ts` -> exit `0`, 5 tests passed
  - `pnpm exec tsc --noEmit -p apps/desktop/tsconfig.node.json` -> exit `0`
  - `pnpm --filter @advx/contracts typecheck` -> exit `0`
  - `bun run --cwd apps/backend-bun openapi:check` -> exit `0`, 47-operation snapshot matched
  - `pnpm contracts:bun-openapi:check` -> exit `0`, generated types up to date
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 70 accepted evidence, zero errors
  - `git diff --check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/DES-006/des-006-recovery-maker-root-20260805-009/`
  - `.omx/artifacts/typescript-bun/DES-006/des-006-checker-root-20260805-010/`
- Accepted assertions:
  - The adapter imports `bunOperations as BunOperations`; the generated Bun
    operation/response witness is no longer bound to the Python-derived
    unsuffixed export.
  - Python remains the default transport. Shared protocol-v3 auth, timeout,
    caller abort, zero implicit retry, error normalization, and canonical
    response validation remain behind one desktop-facing control interface.
  - The generated Bun OpenAPI snapshot and drift check cover the 47-operation
    Bun control registry, and the focused adapter suite passes 5/5.
  - The Python parity oracle, realtime/binary paths, renderer boundaries,
    dependencies, and later task scope remain unchanged.
- Limitations:
  - Realtime WebSocket/event compatibility remains `DES-007` scope.
  - Packaged lifecycle and complete recorded Electron-to-overlay proof remain
    later DES/GATE scope. The host emits the existing Node engine warning
    because Node 22.23.1 is below the workspace's requested 24.18.0.
  - No commit, push, deploy, `output/`, or `promo/` work occurred.
- Related run log:
  - `des-006-recovery-maker-root-20260805-009`
  - `des-006-checker-root-20260805-010`

### DES-007 / des-007-checker-root-20260805-014

- Claim: Desktop realtime WebSocket/event traffic uses one compatibility
  boundary for Python and Bun wire families, preserves authenticated hello,
  rejects stale connection scopes, deduplicates non-handshake events, and
  safely resolves reconnect handshakes.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Date: 2026-08-05
- Environment: Windows, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `integration`, `unit`, `protocol`, `static`, `review`
- Maker: root
- Maker run/context ID:
  `des-007-recovery-maker-root-20260805-013` /
  `des-007-recovery-maker-root-context-20260805-013`
- Checker: root
- Checker run/context ID:
  `des-007-checker-root-20260805-014` /
  `des-007-checker-root-context-20260805-014`
- Checker parent run ID: `root`
- Checker participated in implementation: `false`
- Human authority: continue with the primary root and do not call subagents.
- Reviewed source-state hash:
  `sha256:11ff6d813868c08a1e51e3b067432079d47fcd2a1d257c30cc7f11fb37c51eff`
- Maker manifest: 16/16 entries matched with zero mismatches.
- Reviewed source aggregate:
  `sha256:11ff6d813868c08a1e51e3b067432079d47fcd2a1d257c30cc7f11fb37c51eff`
- Commands/procedure:
  - Recomputed recovery Maker manifest and source receipt -> exit `0`, exact
    match
  - Reconnect-order probe -> exit `0`, `backend.ready` line 937 precedes the
    duplicate gate line 947
  - `pnpm --filter @advx/desktop exec vitest run src/main/backend/backend-realtime-adapter.test.ts src/main/backend/backend-control-adapter.test.ts` -> exit `0`, 8 tests passed across two files
  - `pnpm exec tsc --noEmit -p apps/desktop/tsconfig.node.json` -> exit `0`
  - `pnpm --filter @advx/contracts typecheck` -> exit `0`
  - `bun test apps/backend-bun/src/api/realtime.integration.test.ts` -> exit
    `0`, 6 tests and 58 assertions passed
  - `uv run --project apps/backend pytest apps/backend/tests/test_realtime_api.py apps/backend/tests/test_realtime_ingest_api.py -q` -> exit `0`, 16 passed, one environment warning
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 70 accepted evidence, zero errors
  - `git diff --check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/DES-007/des-007-recovery-maker-root-20260805-013/`
  - `.omx/artifacts/typescript-bun/DES-007/des-007-checker-root-20260805-014/`
- Accepted assertions:
  - The desktop adapter accepts canonical Bun envelopes and legacy Python wire,
    while native Electron continues sending the authenticated hello message.
  - Socket callbacks are bound to the supervised backend-start identity and
    connection generation; stale session and audience-epoch events are
    rejected, and bounded event identities are deduplicated.
  - `backend.ready` is handled before event dedupe, so a same-start reconnect
    cannot discard the handshake before resolving `connectPromise`.
  - Bun realtime integration and the retained Python realtime API/ingest oracle
    both pass; no Python implementation is removed or changed.
- Limitations:
  - The host emits the existing Node engine warning because Node 22.23.1 is
    below the workspace's requested 24.18.0.
  - Source-specific Bun ingest routing remains DES-008 scope; packaged and
    complete Electron pipeline proof remain later DES/GATE scope. No
    dependency/lock mutation, commit, push, deploy, `output/`, or `promo/`
    work occurred.
- Related run log:
  - `des-007-recovery-maker-root-20260805-013`
  - `des-007-checker-root-20260805-014`
### DES-008 / des-008-checker-root-20260805-016

- Claim: Bun desktop integration routes text, screen representative frames,
  microphone chunks, and Windows system-audio chunks through typed ingest
  boundaries while preserving source, session, target, and connection
  identity; voice activity remains advisory.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Date: 2026-08-05
- Environment: Windows, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `integration`, `unit`, `protocol`, `static`, `review`
- Maker: root
- Maker run/context ID:
  `des-008-maker-root-20260805-015` /
  `des-008-maker-root-context-20260805-015`
- Checker: root
- Checker run/context ID:
  `des-008-checker-root-20260805-016` /
  `des-008-checker-root-context-20260805-016`
- Checker parent run ID: `root`
- Checker participated in implementation: `false`
- Reviewed source-state hash:
  `sha256:633ff5b5c9b5fdde8ca176609c47cf3a09c550612e1f6ef669170892c1a8e104`
- Reviewed source aggregate:
  `sha256:633ff5b5c9b5fdde8ca176609c47cf3a09c550612e1f6ef669170892c1a8e104`
- Maker manifest: 7/7 entries matched with zero mismatches.
- Commands/procedure:
  - Bun realtime and binary integration -> exit `0`, 12 tests and 91
    assertions passed
  - Desktop realtime/control adapter regressions -> exit `0`, 8 tests passed
  - Bun, desktop Node, and Contracts strict TypeScript -> exit `0`
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 71
    accepted evidence, zero errors
  - `git diff --check` -> exit `0`
- Accepted assertions:
  - Text messages are session/capacity guarded and reach a typed Bun text
    ingest port with input, target, and connection identity intact.
  - Voice activity reaches an advisory Bun port with its original microphone or
    system-audio source and cannot disrupt the realtime stream.
  - Existing binary frame/audio dispatch covers screen, microphone, and Windows
    system-audio chunks without a capture or permission rewrite.
  - Python remains the parity oracle; no dependencies, renderer stores, or
    downstream tasks were changed.
- Limitations:
  - Concrete Bun ingest pipeline sinks remain composition points for later
    backend work; the default process composition retains the unavailable sink
    behavior until that later service is wired.
  - Complete Electron-to-overlay proof remains DES-011/GATE-05 scope.
  - The host emits the existing Node engine warning because Node 22.23.1 is
    below the requested 24.18.0.
  - No commit, push, deploy, `output/`, or `promo/` work occurred.
- Artifacts:
  - `.omx/artifacts/typescript-bun/DES-008/des-008-maker-root-20260805-015/`
  - `.omx/artifacts/typescript-bun/DES-008/des-008-checker-root-20260805-016/`
- Related run log:
  - `des-008-maker-root-20260805-015`
  - `des-008-checker-root-20260805-016`
### DES-009 / des-009-checker-root-20260805-018

- Claim: Renderer stores, UI state, media permission boundaries, session
  recovery, and overlay isolation remain intact while the desktop client uses
  the migrated backend boundary.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Date: 2026-08-05
- Environment: Windows, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `unit`, `static`, `build`, `review`
- Maker: root
- Maker run/context ID:
  `des-009-maker-root-20260805-017` /
  `des-009-maker-root-context-20260805-017`
- Checker: root
- Checker run/context ID:
  `des-009-checker-root-20260805-018` /
  `des-009-checker-root-context-20260805-018`
- Checker parent run ID: `root`
- Checker participated in implementation: `false`
- Reviewed source-state hash:
  `sha256:426f7a7b23fece9b316166e425d4ca8eabeb7a1b99225c9801f5c899a843a878`
- Maker manifest: 5/5 entries matched with zero mismatches.
- Commands/procedure:
  - Focused renderer tests -> exit `0`, 3 files and 9 tests passed
  - Strict desktop Node and web TypeScript -> exit `0`
  - Desktop Electron build -> exit `0`, Main, preload, and four renderer
    entry points built
  - Store/permission/overlay source review -> exit `0`
  - `git diff --check` -> exit `0`
- Accepted assertions:
  - Zustand and typed selectors remain the local owner of navigation and
    session presentation state.
  - Microphone and system-audio permission/status channels remain independent;
    pause, clear, stop, emergency-stop, and error recovery remain explicit.
  - Overlay windows remain isolated, non-focusable, always-on-top, and
    click-through with sender-checked IPC.
  - Optional runtime fields fall back to local settings without widening the
    renderer contract; Python remains the parity oracle.
- Limitations:
  - Full interactive Electron UI automation remains later GATE/TST scope.
  - The host emits the existing Node engine warning because Node 22.23.1 is
    below the requested 24.18.0.
  - No commit, push, deploy, `output/`, or `promo/` work occurred.
- Artifacts:
  - `.omx/artifacts/typescript-bun/DES-009/des-009-maker-root-20260805-017/`
  - `.omx/artifacts/typescript-bun/DES-009/des-009-checker-root-20260805-018/`
- Related run log:
  - `des-009-maker-root-20260805-017`
  - `des-009-checker-root-20260805-018`

### DES-010 / des-010-checker-root-20260805-020

- Claim: Desktop can explicitly select `python-oracle`, `bun-source`, or
  `bun-compiled` for development/test parity and rollback while keeping Python
  as the default until cutover.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Date: 2026-08-05
- Environment: Windows, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `unit`, `integration`, `static`, `build`, `review`
- Maker: root
- Maker run/context ID:
  `des-010-maker-root-20260805-019` /
  `des-010-maker-root-context-20260805-019`
- Checker: root
- Checker run/context ID:
  `des-010-checker-root-20260805-020` /
  `des-010-checker-root-context-20260805-020`
- Checker parent run ID: `des-010-maker-root-20260805-019`
- Checker participated in implementation: `false`
- Reviewed source-state hash:
  `sha256:9d604e3157aea8b0ca9f3c9751543142512c12bb3ef4f09b7fa38f40d3fa460f`
- Maker manifest: 8/8 entries matched with zero mismatches.
- Commands/procedure:
  - Selector/client tests -> exit `0`, 2 files and 7 tests passed
  - Backend process lifecycle tests -> exit `0`, 1 file and 16 tests passed,
    including real Bun source readiness and clean restart budget behavior
  - Strict desktop Node and web TypeScript -> exit `0`
  - Desktop Electron build -> exit `0`, Main, preload, and four renderer
    entry points built
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 73 accepted
    evidence records, zero errors
  - `git diff --check` -> exit `0`
- Accepted assertions:
  - The selector domain is explicit; unknown and omitted values resolve to
    `python-oracle`, while packaged `bun-source` resolves to Python so the
    unsupported source mode is not exposed in production.
  - Electron Main and `BackendClient` use the same immutable per-start
    selection, diagnostics expose `backendRuntime`, and Main logs the selected
    runtime and data directory.
  - Bun source and compiled modes use isolated data directories; changing the
    selected mode requires a clean application stop/start, and normal restart
    remains bounded by the existing supervisor.
  - No renderer toggle, Python oracle removal, Provider secret exposure,
    dependency change, commit, push, deploy, `output/`, or `promo/` work
    occurred.
- Limitations:
  - Full recorded Electron-to-overlay pipeline remains DES-011 and later
    GATE/TST scope.
  - The host emits the existing Node engine warning because Node 22.23.1 is
    below the requested 24.18.0.
- Artifacts:
  - `.omx/artifacts/typescript-bun/DES-010/des-010-maker-root-20260805-019/`
  - `.omx/artifacts/typescript-bun/DES-010/des-010-checker-root-20260805-020/`
- Related run log:
  - `des-010-maker-root-20260805-019`
  - `des-010-checker-root-20260805-020`

### DES-011 / des-011-checker-root-20260806-022

- Claim: Electron can run the recorded Bun backend through the complete input,
  barrage, overlay, trace, stop, and cleanup path without orphaning the child.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Date: 2026-08-06
- Environment: Windows, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `recorded`, `integration`, `protocol`, `build`, `platform`,
  `review`
- Maker: root
- Maker run/context ID:
  `des-011-maker-root-20260806-021` /
  `des-011-maker-root-context-20260806-021`
- Checker: root
- Checker run/context ID:
  `des-011-checker-root-20260806-022` /
  `des-011-checker-root-context-20260806-022`
- Checker parent run ID: `des-011-maker-root-20260806-021`
- Checker participated in implementation: `false`
- Reviewed source-state hash:
  `sha256:2ae9292ef13c8c1d208ed03c91faf60fe5dbff0686771b26556b27a0c872b7f5`
- Maker manifest: 13/13 entries matched with zero mismatches.
- Commands/procedure:
  - Focused Bun binary/control/recorded integration tests -> exit `0`, 3
    files and 11 tests passed with 88 assertions
  - Strict Bun and desktop TypeScript -> exit `0`
  - Desktop Electron build -> exit `0`
  - Windows Electron smoke -> exit `0`; Bun readiness, session start, frame,
    microphone, system-audio, voice activity, text, overlay, trace/frame hash,
    stop, close, and port 8765 release all passed
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 74 accepted
    evidence records, zero errors
  - `git diff --check` -> exit `0`
- Accepted assertions:
  - The recorded fixture is opt-in and keeps Python as the parity oracle.
  - All four input kinds preserve source/session identity; frame evidence is
    SHA-256 recorded and the Provider trace identifies `recorded-viewer-v1`.
  - The overlay renders the delivered barrage through the existing isolated,
    click-through Electron window.
  - Session stop closes Electron and releases the Bun port; no orphan process
    remains from the smoke.
- Limitations:
  - This is recorded deterministic evidence, not credentialed live Provider
    evidence; the latter remains outside DES-011 scope.
  - The host emits the existing Node engine warning because Node 22.23.1 is
    below the requested 24.18.0.
  - No commit, push, deploy, `output/`, or `promo/` work occurred.
- Artifacts:
  - `.omx/artifacts/typescript-bun/DES-011/des-011-maker-root-20260806-021/`
  - `.omx/artifacts/typescript-bun/DES-011/des-011-checker-root-20260806-022/`
  - `apps/desktop/artifacts/bun-recorded-pipeline-smoke/proof.json`
  - `apps/desktop/artifacts/bun-recorded-pipeline-smoke/overlay.png`
- Related run log:
  - `des-011-maker-root-20260806-021`
  - `des-011-checker-root-20260806-022`

### GATE-05 / gate-05-checker-root-20260806-024

- Claim: The desktop-integration phase preserves Electron privilege boundaries,
  bounded Bun/Python supervision, auth and Provider-secret isolation, adapter
  compatibility, four-source capture routing, overlay behavior, and accepted
  recorded full-pipeline evidence.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Dirty diff identity: scoped source-state aggregate
  `sha256:5e76b4c47cd25af53b8059683ee6ee4d7086d8ad2ae59424d1bf7f4ef957cacb`
  over 158 LF-normalized files; Maker and Checker recomputed identical values.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `review`, `unit`, `integration`, `recorded`, `unpacked`
- Maker: root
- Maker run/context ID:
  `gate-05-maker-root-20260806-023` /
  `gate-05-maker-root-context-20260806-023`
- Checker: root, independent review context
- Checker run/context ID:
  `gate-05-checker-root-20260806-024` /
  `gate-05-checker-root-context-20260806-024`
- Checker parent run ID: `gate-05-maker-root-20260806-023`
- Checker participated in implementation: `false`
- Reviewed source-state hash:
  `sha256:5e76b4c47cd25af53b8059683ee6ee4d7086d8ad2ae59424d1bf7f4ef957cacb`
- Commands/procedure:
  - Desktop control/realtime/auth tests -> exit `0`, 4 files and 12 tests
  - Isolated restart-budget test -> exit `0`, 1 test
  - Recorded Electron Bun smoke -> exit `0`, all four inputs, overlay, trace,
    stop, close, and port 8765 release
  - Bundled Main import scan -> exit `0`, no external contracts or
    extensionless `http/common` import
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 75 accepted
    evidence records, zero errors
  - `git diff --check` -> exit `0`
- Accepted assertions:
  - Main owns supervision, auth, safeStorage, and IPC registration; preload
    remains a typed allowlist; renderers do not gain Main privileges.
  - Python remains the default parity oracle; Bun source and compiled modes are
    explicit, isolated, and bounded by the existing supervisor.
  - Startup auth and Provider secrets do not enter renderer, CLI arguments, or
    ordinary logs; accepted DES-004 evidence remains current.
  - All four input kinds reach Bun with source identity intact, and the
    recorded Electron smoke renders the existing overlay and cleans up.
- Limitations:
  - Node 22.23.1 emits the existing Node 24 engine warning.
  - The checker does not claim a signed packaged release; packaging is Phase 08.
  - A concurrent full multi-file Vitest run once hit the existing 15-second
    Windows restart-budget test timeout; the focused decisive test passed.
- Artifacts:
  - `.omx/artifacts/typescript-bun/GATE-05/gate-05-maker-root-20260806-023/`
  - `.omx/artifacts/typescript-bun/GATE-05/gate-05-checker-root-20260806-024/`
  - `apps/desktop/artifacts/bun-recorded-pipeline-smoke/proof.json`
  - `apps/desktop/artifacts/bun-recorded-pipeline-smoke/overlay.png`
- Related run log:
  - `gate-05-maker-root-20260806-023`
  - `gate-05-checker-root-20260806-024`

### OBS-001 / obs-001-checker-root-20260806-026

- Claim: Bun diagnostics use a versioned, redacted Pino JSONL envelope with
  bounded rotation and process lifecycle flushing.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Dirty diff identity: `sha256:217b9af42187764c9e68c15ee90949aa4a278e0be760b6e65b2588807b8ace0f`
  over five LF-normalized source files; Maker and Checker recomputed identical
  values.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `unit`, `integration`, `review`
- Maker run/context ID:
  `obs-001-maker-root-20260806-025` /
  `obs-001-maker-root-context-20260806-025`
- Checker run/context ID:
  `obs-001-checker-root-20260806-026` /
  `obs-001-checker-root-context-20260806-026`
- Checker parent run ID: `obs-001-maker-root-20260806-025`
- Checker participated in implementation: `false`
- Commands/procedure:
  - Focused diagnostic tests -> exit `0`, 5 tests and 31 assertions
  - Process lifecycle regression -> exit `0`, 6 tests
  - `pnpm --filter @advx/backend-bun typecheck` -> exit `0`
  - `pnpm --filter @advx/backend-bun build` -> exit `0`
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 76 accepted
    evidence records, zero errors
  - `git diff --check` -> exit `0`
- Accepted assertions:
  - persisted lines contain the common schema version, timestamp, string level,
    versioned event, and process identity without pretty-print output;
  - authorization/startup tokens, nested Provider headers, prompt/response
    bodies, Windows usernames, safeStorage values, binary content, and Error
    message/cause secrets are not persisted;
  - rotation is bounded and occurs before an oversized line, while start,
    ready, stop, and failure events use the local data directory;
  - Python remains the parity oracle and no downstream task, commit, push, or
    deployment claim is made.
- Artifacts:
  - `.omx/artifacts/typescript-bun/OBS-001/obs-001-maker-root-20260806-025/`
  - `.omx/artifacts/typescript-bun/OBS-001/obs-001-checker-root-20260806-026/`

### OBS-002 / obs-002-checker-root-20260806-028

- Claim: Bun preserves diagnostic trace context across HTTP, realtime,
  application events, queue/Provider calls, and database transactions without
  replacing product identity.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Dirty diff identity: `sha256:e5587f86f523f97cab2e722e8d3a9696f712c5a65c36e909ef58b134bb9927ce`
  over 24 LF-normalized source files; Maker and Checker recomputed identical
  values.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `unit`, `integration`, `review`
- Maker run/context ID:
  `obs-002-maker-root-20260806-027` /
  `obs-002-maker-root-context-20260806-027`
- Checker run/context ID:
  `obs-002-checker-root-20260806-028` /
  `obs-002-checker-root-context-20260806-028`
- Checker parent run ID: `obs-002-maker-root-20260806-027`
- Checker participated in implementation: `false`
- Commands/procedure:
  - Focused propagation and regression tests -> exit `0`, 37 tests and 326
    assertions
  - Targeted HTTP trace test -> exit `0`, 1 test and 22 assertions
  - `pnpm --filter @advx/backend-bun typecheck` -> exit `0`
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 77 accepted
    evidence records, zero errors
  - `git diff --check` -> exit `0`
- Accepted assertions:
  - HTTP and canonical WS identities retain a bounded trace ID while product
    SessionId, epoch, sequence, and backendStartId remain authoritative;
  - text, voice, and binary ingest commands, ACK/rejection receipts, lifecycle
    events, viewer/memory requests, Provider contexts, and transaction contexts
    carry the correlation;
  - scheduler terminal records cover completed and discarded/cancelled work;
  - Python remains the parity oracle and no downstream task, commit, push, or
    deployment claim is made.
- Artifacts:
  - `.omx/artifacts/typescript-bun/OBS-002/obs-002-maker-root-20260806-027/`
  - `.omx/artifacts/typescript-bun/OBS-002/obs-002-checker-root-20260806-028/`

### OBS-002 recovery / obs-002-checker-root-20260806-030

- Claim: immediate scheduler rejection outcomes emit terminal trace records,
  closing the discarded-work branch of OBS-002.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Dirty diff identity: `sha256:f40b62b3da768e20a49bffc9494dbbe92431dea44f0b76fd0cd75e0956b02103`
  over the same 24 LF-normalized source files; Maker and fresh Checker
  recomputed identical values.
- Date: 2026-08-06
- Maker run/context ID:
  `obs-002-maker-root-20260806-029` /
  `obs-002-maker-root-context-20260806-029`
- Checker run/context ID:
  `obs-002-checker-root-20260806-030` /
  `obs-002-checker-root-context-20260806-030`
- Checker participated in implementation: `false`
- Commands/procedure:
  - Focused propagation/regression tests -> exit `0`, 37 tests and 328
    assertions
  - Targeted HTTP trace test -> exit `0`, 1 test and 22 assertions
  - `pnpm --filter @advx/backend-bun typecheck` -> exit `0`
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 78 accepted
    evidence records, zero errors
  - `git diff --check` -> exit `0`
- Accepted assertion: terminal trace records now cover immediate expired,
  cancelled, closed, capacity, and lower-priority scheduler outcomes as well as
  admitted work; no new downstream task was started.
- Artifacts:
  - `.omx/artifacts/typescript-bun/OBS-002/obs-002-maker-root-20260806-029/`
  - `.omx/artifacts/typescript-bun/OBS-002/obs-002-checker-root-20260806-030/`

### OBS-003 / obs-003-maker-root-20260806-031

- Claim: Bun preserves privacy-safe viewer and AI-call evidence with a
  versioned normalizer that can compare Python-oracle and Bun records while
  retaining provider/model identity, candidate decision, Viewer/memory/frame
  references, outcome, latency, and bounded usage/input metadata.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Dirty source identity: `sha256:5a6b00816f5fff016bc96d53e0d4499f785c172462ec87945f41dba5306941e4`
  over five scoped files.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `unit`, `integration`, `review`
- Maker run/context ID:
  `obs-003-maker-root-20260806-031` /
  `obs-003-maker-root-context-20260806-031`
- Checker run/context ID:
  `obs-003-checker-root-20260806-032` /
  `obs-003-checker-root-context-20260806-032`
- Checker parent run ID: `obs-003-maker-root-20260806-031`
- Checker participated in implementation: `false`
- Commands/procedure:
  - trace normalizer plus recorded pipeline integration -> exit `0`, 4 tests
    and 22 assertions
  - `pnpm --filter @advx/backend-bun typecheck` -> exit `0`
  - `pnpm --filter @advx/desktop typecheck` -> exit `0`
  - `pnpm --filter @advx/desktop build` -> exit `0`
  - bounded desktop dev startup smoke -> exit `0`, no module-resolution error
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 78 accepted
    evidence, zero errors
  - `git diff --check` -> exit `0`
- Accepted assertions:
  - trace payloads remain on the existing versioned contracts and normalization
    adds a stable runtime/version envelope;
  - AI-call endpoints lose query credentials, raw model text is omitted, and
    input metadata is bounded to category, byte count, and SHA-256 digest;
  - recorded Bun debug evidence contains stable correlation and viewer outcome
    fields without changing the Python parity oracle;
  - Electron dev no longer asks Node's ESM loader to resolve extensionless
    workspace contract imports.
- Checker verdict: `DONE`; the five-file source aggregate matched with zero
  mismatches, all focused commands exited `0`, and only `OBS-004` was promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/OBS-003/obs-003-maker-root-20260806-031/`

### OBS-004 / obs-004-checker-root-20260806-034

- Claim: independent acceptance of the authenticated, bounded Bun debug
  snapshot/query API.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Dirty source identity: `sha256:3739f21a315fa1a87b6d4d0ec96e8401c05db639d722143e7a694a93582394c3`
  over the same seven scoped files; Maker and Checker recomputed identical
  values with zero mismatches.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `unit`, `integration`, `review`
- Maker run/context ID:
  `obs-004-maker-root-20260806-033` /
  `obs-004-maker-root-context-20260806-033`
- Checker run/context ID:
  `obs-004-checker-root-20260806-034` /
  `obs-004-checker-root-context-20260806-034`
- Checker parent run ID: `obs-004-maker-root-20260806-033`
- Checker participated in implementation: `false`
- Commands/procedure:
  - source aggregate recomputation -> exit `0`, zero mismatches
  - focused debug, recorded-pipeline, and OBS-003 normalizer tests -> exit
    `0`, 6 tests and 31 assertions
  - `pnpm --filter @advx/backend-bun typecheck` -> exit `0`
  - `pnpm --filter @advx/backend-bun build` -> exit `0`, Bun bundle 688 modules
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 80 accepted
    evidence records, zero errors
  - `git diff --check` -> exit `0`
- Accepted assertions:
  - debug access requires the local bearer token and protocol-v3 header;
  - the snapshot is read-only, bounded, cursor-paginated, redacted, and keeps
    missing runtime-owned diagnostics explicit;
  - backend/session/epoch identity, queue state, Provider status, event
    summaries, database health/schema, capture reports, and fatal/degraded
    reason are represented without fabricating unavailable state;
  - Python remains the parity oracle and no downstream task was started.
- Checker verdict: `DONE`; only `OBS-005` is promoted to `READY`.
- Artifacts:
  - `.omx/artifacts/typescript-bun/OBS-004/obs-004-checker-root-20260806-034/`

### OBS-005 / obs-005-checker-root-20260806-036

- Claim: the Bun headless harness provides isolated data directories, stable
  exits, deterministic fixture execution, bounded deadline aborts, resource
  cleanup accounting, and lifecycle/result artifacts without replacing the
  Python parity oracle.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Dirty source identity: `sha256:7508ba5ec0d2a32d3394619c03ab2d2d5b81e62ca90df6a2f79277234ba1a130`
  over seven scoped files; Maker and Checker recomputed identical values with
  zero mismatches.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `unit`, `integration`, `review`
- Maker run/context ID:
  `obs-005-maker-root-20260806-035` /
  `obs-005-maker-root-context-20260806-035`
- Checker run/context ID:
  `obs-005-checker-root-20260806-036` /
  `obs-005-checker-root-context-20260806-036`
- Checker parent run ID: `obs-005-maker-root-20260806-035`
- Checker participated in implementation: `false`
- Commands/procedure:
  - source aggregate recomputation -> exit `0`, zero mismatches
  - focused headless harness tests -> exit `0`, 3 tests and 5 assertions
  - `pnpm --filter @advx/backend-bun typecheck` -> exit `0`
  - `pnpm --filter @advx/backend-bun build` -> exit `0`, Bun bundle 690 modules
  - valid CLI smoke -> exit `0`, one JSON result envelope and zero remaining
    resources
  - invalid JSON CLI smoke -> exit `2`, one `invalid_json` envelope
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 80 accepted
    evidence records, zero errors
  - `git diff --check` -> exit `0`
- Accepted assertions:
  - the harness creates and removes isolated temporary data directories;
  - seeded virtual time/randomness and recorded/fake modes yield deterministic
    fixture evidence while live Provider mode is explicitly unavailable;
  - timeout aborts run cleanup and report all registered resource kinds;
  - CLI stdout is one stable JSON envelope with actionable exit codes;
  - full product replay remains the planned `OBS-007` scope.
- Checker verdict: `DONE`; the seven-file source aggregate matched with zero
  mismatches, all focused commands exited `0` except the expected invalid JSON
  CLI exit `2`, and only `OBS-006` was promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/OBS-005/obs-005-maker-root-20260806-035/`
  - `.omx/artifacts/typescript-bun/OBS-005/obs-005-checker-root-20260806-036/`

### OBS-006 / obs-006-checker-root-20260806-038

- Claim: a bounded comparison of the three plan-allowed trace UI options was
  completed and `ADR-MIG-003` chooses no additional trace UI for normal ADVX
  development or packaging.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Dirty source identity: `sha256:b94354445d93399fcd7b876c45cb9154aad6c391d2fe6b0d5703834ee2a07674`
  over `docs/migrations/typescript-bun/ADR-MIG-003.md`; Maker and Checker
  recomputed identical values with zero mismatches.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `decision`, `review`
- Maker run/context ID:
  `obs-006-maker-root-20260806-037` /
  `obs-006-maker-root-context-20260806-037`
- Checker run/context ID:
  `obs-006-checker-root-20260806-038` /
  `obs-006-checker-root-context-20260806-038`
- Checker parent run ID: `obs-006-maker-root-20260806-037`
- Checker participated in implementation: `false`
- Commands/procedure:
  - ADR source aggregate recomputation -> exit `0`, zero mismatches
  - comparison/ADR review -> exit `0`, all seven required criteria covered
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 81
    accepted evidence records, zero errors
  - `git diff --check` -> exit `0`
  - ledger JSONL parse -> exit `0`, all lines valid
- Accepted assertions:
  - Phoenix/OpenInference and TypeScript-first Langfuse-compatible paths were
    compared without adding either runtime or dependency;
  - local-only operation, Python/remote-service burden, OTel/OpenInference
    compatibility, display quality, packaging, deletion/redaction, and value
    beyond JSONL were explicitly evaluated;
  - the existing sanitized diagnostics bundle remains authoritative and
    optional external consumers cannot block product lifecycle;
  - no remote telemetry or second raw persistence authority was introduced.
- Checker verdict: `DONE`; the one-file ADR aggregate matched with zero
  mismatches and only `OBS-007` was promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/OBS-006/obs-006-maker-root-20260806-037/`
  - `.omx/artifacts/typescript-bun/OBS-006/obs-006-checker-root-20260806-038/`

### OBS-007 / obs-007-checker-root-20260806-040

- Claim: Bun ports the recorded replay boundary with deterministic evidence,
  explicit live replay separation, and an authenticated `/debug/replay` route.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Dirty source identity: `sha256:b256f7d8c84bc4fb9cb258e9b91d6ce879e38ae6c2a8c8d79701a4b8325c5466`
  over ten scoped files; Maker and Checker recomputed identical values with
  zero mismatches.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `unit`, `integration`, `review`
- Maker run/context ID:
  `obs-007-maker-root-20260806-039` /
  `obs-007-maker-root-context-20260806-039`
- Checker run/context ID:
  `obs-007-checker-root-20260806-040` /
  `obs-007-checker-root-context-20260806-040`
- Checker parent run ID: `obs-007-maker-root-20260806-039`
- Checker participated in implementation: `false`
- Commands/procedure:
  - source aggregate recomputation -> exit `0`, zero mismatches
  - `pnpm --filter @advx/backend-bun typecheck` -> exit `0`
  - `pnpm --filter @advx/backend-bun test:obs-007` -> exit `0`, 4 tests and
    10 assertions
  - adjacent headless harness tests -> exit `0`, 3 tests and 5 assertions
  - `pnpm --filter @advx/backend-bun openapi:check` -> exit `0`, 47-operation
    snapshot unchanged
  - `pnpm --filter @advx/backend-bun build` -> exit `0`, Bun bundle 691 modules
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 82
    accepted evidence records, zero errors
  - `git diff --check` -> exit `0`
- Accepted assertions:
  - recorded bundles are redacted, digest-checked, correlation-checked, and
    every Provider output identity is consumed exactly once;
  - recorded replay runs twice in isolated directories and returns a stable
    canonical digest with zero external transport calls;
  - live replay requires explicit external-call opt-in and verified
    credentialed provenance, with no silent recorded/fake fallback;
  - the protocol-v3 authenticated `/debug/replay` route exposes the shared
    normalized error families and does not alter the Python oracle.
- Checker verdict: `DONE`; the ten-file source aggregate matched with zero
  mismatches and only `OBS-008` was promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/OBS-007/obs-007-maker-root-20260806-039/`
  - `.omx/artifacts/typescript-bun/OBS-007/obs-007-checker-root-20260806-040/`

### OBS-008 / obs-008-checker-root-20260806-042

- Claim: Bun provides a deterministic Agent eval fixture format and
  per-assertion JSON evidence for the eight observable Agent requirements.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Dirty source identity: `sha256:693e1132b04c1739411e58a2baef3506927fcd33fafdfb9439d309023e3d99f5`
  over eight scoped files; Maker and Checker recomputed identical values with
  zero mismatches.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `unit`, `fixture`, `review`
- Maker run/context ID:
  `obs-008-maker-root-20260806-041` /
  `obs-008-maker-root-context-20260806-041`
- Checker run/context ID:
  `obs-008-checker-root-20260806-042` /
  `obs-008-checker-root-context-20260806-042`
- Checker parent run ID: `obs-008-maker-root-20260806-041`
- Checker participated in implementation: `false`
- Commands/procedure:
  - source aggregate recomputation -> exit `0`, zero mismatches
  - `pnpm --filter @advx/backend-bun typecheck` -> exit `0`
  - `pnpm --filter @advx/backend-bun test:obs-008` -> exit `0`, 3 tests and
    14 assertions
  - `pnpm --filter @advx/backend-bun build` -> exit `0`, Bun bundle 693 modules
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 83
    accepted evidence records, zero errors
  - `git diff --check` -> exit `0`
  - ledger JSONL parse -> exit `0`, 193 lines valid
- Accepted assertions:
  - fixture metadata is versioned, privacy-classified, Provider-evidence
    classified, and rejects live Provider evidence for deterministic runs;
  - eligible Viewer calls and Director/global-theme exclusion are evaluated
    from explicit call and model identity evidence;
  - barrage/silence shape, barrage count/length/repair bounds, frozen reply
    context, stale epoch/sequence rejection, cancellation cleanup, and
    degraded failure without invented output each produce separate evidence;
  - reports are canonical JSON with one machine-readable result per requested
    assertion, not only a scalar score.
- Checker verdict: `DONE`; the eight-file source aggregate matched with zero
  mismatches and only `OBS-009` was promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/OBS-008/obs-008-maker-root-20260806-041/`
  - `.omx/artifacts/typescript-bun/OBS-008/obs-008-checker-root-20260806-042/`

### OBS-009 / obs-009-checker-root-20260806-044

- Claim: Promptfoo was evaluated as an optional local developer/CI runner and
  received a bounded go/no-go decision without adding a dependency.
- Status: `DONE`
- Decision: `NO_GO` for workspace or default-CI adoption; optional external
  developer use remains outside the migration runtime.
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Dirty source identity: `sha256:51c42cc8fe2b8edafd21c8730a3cf475d0ba577b8e60e4d4a56d49007bdeb911`
  over `docs/migrations/typescript-bun/OBS-009-PROMPTFOO-DECISION.md`; Maker
  and Checker recomputed identical values with zero mismatches.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `decision`, `registry-metadata`, `review`
- Maker run/context ID:
  `obs-009-maker-root-20260806-043` /
  `obs-009-maker-root-context-20260806-043`
- Checker run/context ID:
  `obs-009-checker-root-20260806-044` /
  `obs-009-checker-root-context-20260806-044`
- Checker parent run ID: `obs-009-maker-root-20260806-043`
- Checker participated in implementation: `false`
- Commands/procedure:
  - source aggregate recomputation -> exit `0`, zero mismatches
  - `npm view promptfoo@0.122.0 version engines time --json` -> exit `0`,
    Node `>=22.22.0`, published 2026-08-04
  - global/project-local executable probe -> exit `0`, Promptfoo not installed
  - workspace reference probe -> exit `0`, no Promptfoo package or lockfile
    entry
  - decision report review -> exit `0`, all six acceptance criteria addressed
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 84
    accepted evidence records, zero errors
  - `git diff --check` -> exit `0`
  - ledger JSONL parse -> exit `0`, 194 lines valid
- Accepted assertions:
  - Promptfoo's Node/TypeScript adapter path is technically usable without
    requiring Python for the selected JavaScript path, but is not Bun-native;
  - exact pinning and offline flags can bound a run, yet telemetry/cache and
    best-effort export redaction require a second control boundary;
  - the existing ADVX evaluator already provides the required local fixtures,
    ADVX-owned assertions, canonical JSON, and per-assertion evidence;
  - no current migration requirement justifies the additional dependency,
    matrix/UI surface, or evidence/persistence boundary.
- Checker verdict: `DONE`; the one-file decision aggregate matched with zero
  mismatches and only `OBS-010` was promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/OBS-009/obs-009-maker-root-20260806-043/`
  - `.omx/artifacts/typescript-bun/OBS-009/obs-009-checker-root-20260806-044/`

### OBS-010 / obs-010-checker-root-20260806-046

- Claim: AI SDK DevTools was evaluated for local development and explicitly
  declined for the ADVX workspace/product runtime without adding a dependency
  or raw-data interception boundary.
- Status: `DONE`
- Decision: `NO_GO` for workspace or product adoption; an external opt-in tool
  remains outside the migration runtime.
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Dirty source identity: `sha256:1c4f904912e9a7ee45e458052fa6c48cb2787d574d2327f344494e65727682bb`
  over `docs/migrations/typescript-bun/OBS-010-AI-SDK-DEVTOOLS-DECISION.md`;
  Maker and Checker recomputed identical values with zero mismatches.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `decision`, `registry-metadata`, `build-inspection`,
  `review`
- Maker run/context ID:
  `obs-010-maker-root-20260806-045` /
  `obs-010-maker-root-context-20260806-045`
- Checker run/context ID:
  `obs-010-checker-root-20260806-046` /
  `obs-010-checker-root-context-20260806-046`
- Checker parent run ID: `obs-010-maker-root-20260806-045`
- Checker participated in implementation: `false`
- Commands/procedure:
  - source aggregate recomputation -> exit `0`, one file, zero mismatches
  - `npm view @ai-sdk/devtools@1.0.11 version engines time --json` -> exit `0`,
    Node `>=22`, published 2026-08-06
  - product-tree package/hook probe -> exit `0`, no package, middleware,
    viewer, or lockfile reference
  - `pnpm --filter @advx/backend-bun typecheck` -> exit `0`
  - `pnpm --filter @advx/backend-bun build` -> exit `0`, Bun bundle 693 modules
  - decision report review -> exit `0`, all five acceptance criteria addressed
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 85 accepted
    evidence records, zero errors
  - `git diff --check` -> exit `0`
  - ledger JSONL parse -> exit `0`, 196 lines valid
- Accepted assertions:
  - the current direct `generateText`/`streamText` path remains unchanged when
    no middleware is installed;
  - no DevTools package, hook, viewer, or production bundle reference exists;
  - the official raw prompt/output/tool/provider capture and plaintext local
    generation model cannot satisfy the current secrets and raw-media exclusion
    boundary without a new sanitizing layer;
  - the decision preserves existing redacted ADVX observability and the Python
    parity oracle, while leaving an explicit reopening contract.
- Checker verdict: `DONE`; the one-file decision aggregate matched with zero
  mismatches and only `OBS-011` was promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/OBS-010/obs-010-maker-root-20260806-045/`
  - `.omx/artifacts/typescript-bun/OBS-010/obs-010-checker-root-20260806-046/`

### OBS-011 / obs-011-checker-root-20260806-048

- Claim: a bounded local diagnostics bundle is manifest-driven and includes
  only requested, explicitly redacted artifacts that are available.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Reviewed source-state hash: `sha256:c932c28fdf0fe3c7eaab54e772491e9d26f520d53eb9e5c10d74c7bfcdd2366f`
  over seven scoped files; Maker and Checker recomputed identical values.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `observability`, `redaction`, `manifest-integrity`,
  `build-inspection`, `review`
- Maker run/context ID:
  `obs-011-maker-root-20260806-047` /
  `obs-011-maker-root-context-20260806-047`
- Checker run/context ID:
  `obs-011-checker-root-20260806-048` /
  `obs-011-checker-root-context-20260806-048`
- Checker parent run ID: `obs-011-maker-root-20260806-047`
- Checker participated in implementation: `false`
- Source aggregate: `c932c28fdf0fe3c7eaab54e772491e9d26f520d53eb9e5c10d74c7bfcdd2366f`
  over seven scoped files; Maker and Checker recomputed identical values with
  zero mismatches.
- Commands/procedure:
  - scoped aggregate recomputation -> exit `0`, seven files, zero mismatches
  - `pnpm --filter @advx/backend-bun test:obs-011` -> exit `0`, 4/4 tests,
    25 expectations
  - `pnpm --filter @advx/backend-bun typecheck` -> exit `0`
  - `pnpm --filter @advx/backend-bun build` -> exit `0`, Bun bundle 694 modules
  - diagnostics CLI smoke -> exit `0`, one versions artifact with a 64-character
    SHA-256
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 86
    accepted evidence records, zero errors
  - `git diff --check` -> exit `0`
  - ledger JSONL parse -> exit `0`, 198 lines valid
- Accepted assertions:
  - only requested kinds are copied; supplied unrequested candidates are
    recorded as explicit exclusions;
  - every requested but unavailable kind is represented with a bounded missing
    reason;
  - JSON passes the existing redaction sanitizer and configuration artifacts
    are restricted to uppercase names, never values;
  - regular-file, symlink, absolute-path, file-count, per-file, and total-byte
    limits are enforced before writing;
  - every included artifact records SHA-256 and byte size, and the manifest
    records bounded integrity metadata without recursive self-hashing;
  - no dependency, Python parity-oracle, downstream task, commit, push, deploy,
    or Python deletion occurred.
- Checker verdict: `DONE`; only dependency-satisfied `OBS-012` is promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/OBS-011/obs-011-maker-root-20260806-047/`
  - `.omx/artifacts/typescript-bun/OBS-011/obs-011-checker-root-20260806-048/`

### OBS-012 / obs-012-checker-root-20260806-050

- Claim: Bun CPU/heap profiling, bounded runtime memory/CPU sampling with
  queue and Provider-latency correlation, and opt-in Electron content tracing
  are repeatable, locally stored, time-bounded, and cleaned up on shutdown.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Reviewed source-state hash: `sha256:c43d0f52ffb1486fd5efb4e24fd1145f87596cbf9fe83f99eb4c84923d36bfd4`
  over 15 scoped files; Maker and Checker recomputed identical values.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `observability`, `profiling`, `content-tracing`,
  `lifecycle`, `build-inspection`, `review`
- Maker run/context ID:
  `obs-012-maker-root-20260806-049` /
  `obs-012-maker-root-context-20260806-049`
- Checker run/context ID:
  `obs-012-checker-root-20260806-050` /
  `obs-012-checker-root-context-20260806-050`
- Checker parent run ID: `obs-012-maker-root-20260806-049`
- Checker participated in implementation: `false`
- Source aggregate: `c43d0f52ffb1486fd5efb4e24fd1145f87596cbf9fe83f99eb4c84923d36bfd4`
  over 15 scoped files; zero mismatches.
- Commands/procedure:
  - scoped aggregate recomputation -> exit `0`, 15 files, zero mismatches
  - `pnpm --filter @advx/backend-bun test:obs-012` -> exit `0`, 5/5 tests,
    20 expectations
  - strict Bun and desktop TypeScript checks -> exit `0`
  - `pnpm --filter @advx/desktop exec vitest run
    src/main/observability/content-tracing.test.ts` -> exit `0`, 2/2 tests
  - Bun build -> exit `0`, 696 modules; Electron build -> exit `0`
  - runtime sample CLI -> exit `0`, queue depth and Provider latency fields
    captured; CPU/heap CLI -> exit `0`, profile artifacts and metadata produced
  - live Electron content-trace smoke (500 ms) -> exit `0`, trace and metadata
    produced; existing Python dev-backend path warning was nonblocking
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 87
    accepted evidence records, zero errors
  - `git diff --check` -> exit `0`; ledger JSONL validation -> exit `0`, 200
    lines valid before this accepted-evidence event
- Accepted assertions:
  - CPU and heap profile commands are bounded and write local metadata;
    absent profile artifacts fail the invocation rather than producing false
    success.
  - Runtime samples include memory/CPU deltas and optional queue-depth and
    Provider-latency correlation with duration and sample-count limits.
  - Electron content tracing is explicitly opt-in, category allowlisted,
    locally redacted, deadline bounded, and stopped before backend shutdown;
    startup cannot orphan a late tracing session.
  - Profile outputs remain consumable by the OBS-011 diagnostics manifest and
    receive its hash and byte-size accounting.
  - Python parity, dependencies, downstream tasks, commits, pushes, deploys,
    and unrelated worktree files remain untouched.
- Checker verdict: `DONE`; only dependency-satisfied `GATE-06` is promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/OBS-012/obs-012-maker-root-20260806-049/`
  - `.omx/artifacts/typescript-bun/OBS-012/obs-012-checker-root-20260806-050/`

### GATE-06 / gate-06-checker-root-20260806-052

- Claim: the observability and replay phase satisfies its independent exit
  criteria across diagnostics, trace propagation, parity evidence, headless
  cleanup, replay/evaluation privacy classes, trace UI scope, production
  exclusion, diagnostics bundling, and failure-path proof.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Reviewed source-state hash: `sha256:cd9726e3d098395b39379356a185641503d6ef500b6034947430bc613faa1e43`
  over the current gate source-state manifest; Maker and Checker reviewed the
  same HEAD and artifact hashes.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `phase-gate`, `observability`, `replay`, `lifecycle`,
  `review`
- Maker run/context ID:
  `gate-06-maker-root-20260806-051` /
  `gate-06-maker-root-context-20260806-051`
- Checker run/context ID:
  `gate-06-checker-root-20260806-052` /
  `gate-06-checker-root-context-20260806-052`
- Checker parent run ID: `gate-06-maker-root-20260806-051`
- Checker participated in implementation: `false`
- Commands/procedure:
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 88
    accepted evidence records, zero errors
  - Maker artifact hash verification -> exit `0`, all declared hashes match
  - OBS-001..OBS-012 evidence consistency scan -> exit `0`, twelve `DONE`
    records with independent Checker and non-participation declarations
  - recorded pipeline proof inspection -> exit `0`, one trace, overlay rendered,
    backend port released, Electron closed, temporary directory removed
  - ADR-MIG-003 and production instrumentation absence scans -> exit `0`
  - ledger JSONL validation -> exit `0`, 202 lines valid before this event
  - `git diff --check` -> exit `0`
- Accepted assertions:
  - all persisted diagnostics are versioned and redacted JSONL;
  - a recorded trace follows Electron/Bun/Provider/DB context into overlay
    delivery, with GATE-05 cleanup proof;
  - viewer and AI-call parity is documented, headless data is isolated, and
    replay/evaluation reports carry privacy and Provider evidence classes;
  - ADR-MIG-003 explicitly chooses no additional trace UI;
  - development instrumentation is absent from inspected production source and
    build output;
  - diagnostics bundles are manifest-driven, hashed, bounded, and local;
  - independent Checker evidence covers recorded replay and failure paths.
- Limitations: Node 22.23.1 emits the existing Node 24 engine warning; live
  Provider capability remains a separate credentialed evidence class and is
  not claimed by this recorded phase gate.
- Checker verdict: `DONE`; only dependency-satisfied `TST-000` is promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/GATE-06/gate-06-maker-root-20260806-051/`
  - `.omx/artifacts/typescript-bun/GATE-06/gate-06-checker-root-20260806-052/`

### TST-000 / tst-000-checker-root-20260806-054

- Claim: Phase 07 has a durable entry audit bound to accepted GATE-05 and
  GATE-06 evidence, with refreshed Python test/tool inventory, current
  Vitest/Playwright/typecheck/lint/format/build baselines, suite classifications,
  and a verified TST-000 dependency barrier.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Reviewed source-state hash: `sha256:a631ef635ca135dd45f2f54cb0291b092e5bc8c7b977f250d27d38869268dd18`
  over the Checker source-state manifest; Maker and Checker reviewed the same
  HEAD and planning artifacts.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1, Bun 1.3.14, pnpm 11.9.0, branch
  `TS_backend_refactor`
- Evidence class: `phase-entry`, `inventory`, `baseline`, `planning`, `review`
- Maker run/context ID:
  `tst-000-maker-root-20260806-053` /
  `tst-000-maker-root-context-20260806-053`
- Checker run/context ID:
  `tst-000-checker-root-20260806-054` /
  `tst-000-checker-root-context-20260806-054`
- Checker parent run ID: `tst-000-maker-root-20260806-053`
- Checker participated in implementation: `false`
- Commands/procedure:
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, 89
    accepted evidence records, zero errors
  - inventory, baseline, and entry-barrier JSON parse -> exit `0`
  - TST dependency reachability scan -> exit `0`, TST-001..TST-014 all reach
    TST-000 and TST-001 is first eligible
  - STATE/master cursor check -> exit `0`; only TST-001 promoted
  - ledger JSONL validation -> exit `0`, 204 lines valid before this event
  - `git diff --check` -> exit `0`
- Accepted assertions:
  - accepted GATE-05/GATE-06 evidence is the explicit Phase 07 entry barrier;
  - 14 Python backend test modules plus the recorded E2E module and 12 active
    Python tools are inventoried with generated, platform, recorded, and
    credentialed-adjacent boundaries;
  - current baselines preserve pass, fail, unavailable, and reserved outcomes:
    desktop Vitest 9/9 files and 39 tests pass, Python collection finds 47
    tests, strict typecheck/build pass, the Bun full baseline records 207
    passed and one import-boundary failure, Playwright is unavailable, and
    lint/format remain fail-closed until TST-010;
  - every root TST-001..TST-014 dependency graph reaches TST-000, and only
    TST-001 is promoted after acceptance;
  - no product behavior, dependency, Python oracle, commit, push, deploy, or
    unrelated dirty file was changed.
- Limitations: this entry audit does not repair the known Bun import-boundary
  baseline or install Playwright; later TST tasks own those tooling changes.
- Checker verdict: `DONE`; only dependency-satisfied `TST-001` is promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/TST-000/tst-000-maker-root-20260806-053/`
  - `.omx/artifacts/typescript-bun/TST-000/tst-000-checker-root-20260806-054/`

### TST-001 / tst-001-checker-root-20260806-058

- Claim: the repository has explicit Vitest projects aligned to Bun backend,
  Electron Main/preload, renderer DOM, browser, contract, and evidence/eval
  runtime boundaries, with bounded and inspectable policy.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Reviewed source-state hash:
  `sha256:da6ea02e83cfc07c01652d8bbdf3144be801498856f589e4fcd641a7f60dd7fb`
  over ten sorted source/config/lockfile entries.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1, Bun 1.3.14, pnpm 11.9.0, Vitest
  3.2.7, branch `TS_backend_refactor`
- Evidence class: `test-tooling`, `runtime-boundary`, `focused-suite`, `review`
- Maker run/context ID:
  `tst-001-recovery-maker-root-20260806-057` /
  `tst-001-recovery-maker-root-context-20260806-057`
- Checker run/context ID:
  `tst-001-checker-root-20260806-058` /
  `tst-001-checker-root-context-20260806-058`
- Checker parent run ID: `tst-001-recovery-maker-root-20260806-057`
- Checker participated in implementation: `false`
- Commands/procedure:
  - recovery aggregate recomputation -> exit `0`, ten files and zero mismatches
  - `pnpm test:tst-001` -> exit `0`, project TypeScript plus 13 Vitest files
    and 44 Vitest tests passed
  - restart-budget lifecycle case -> pass at 29273 ms under a bounded 30000 ms
    deadline
  - prior independent `pnpm test:projects:browser` probe -> exit `0`, configured
    Playwright Chromium project loads with no cases before TST-007
  - `pnpm migration:plan-check` -> exit `0` after accepted synchronization
  - ledger JSONL validation and `git diff --check` -> exit `0`
- Accepted assertions:
  - eight explicit projects prevent a single global environment from hiding
    Node, DOM, browser, or Bun assumptions;
  - Bun-only tests execute in Bun through a no-shell argument-array bridge with
    bounded output, per-test/process deadlines, fixed cwd, and exit propagation;
  - timeouts, isolation, retries, fake-timer cleanup, concurrency, V8 coverage
    scope, browser screenshots, and JSON test artifacts are explicit;
  - repository contracts, live plan evidence, parity harness, and deterministic
    evaluator are included in focused projects;
  - Playwright is installed and browser-mode cases remain owned by TST-007;
  - Python remains the parity oracle.
- Limitations: Node 22.23.1 emits the existing Node 24.18.0 engine warning; the
  accepted TST-000 import-boundary failure is unchanged; the stale mutation
  expectations in `scripts/migration-plan-check.test.ts` are adjacent debt,
  while the live plan-check CLI passes.
- Checker verdict: `DONE`; only dependency-satisfied `TST-002` is promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/TST-001/tst-001-maker-root-20260806-055/`
  - `.omx/artifacts/typescript-bun/TST-001/tst-001-checker-root-20260806-056/`
  - `.omx/artifacts/typescript-bun/TST-001/tst-001-recovery-maker-root-20260806-057/`
  - `.omx/artifacts/typescript-bun/TST-001/tst-001-checker-root-20260806-058/`

### TST-002 / tst-002-checker-root-20260806-060

- Claim: every retained Python test behavior has a machine-readable migration
  row with current TypeScript proof, an explicit superseding boundary, or a
  precisely owned remaining port gap.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Reviewed source-state hash:
  `sha256:5e62c0fc022de087326044bd93bc504f2439259df25a1ef5f3c53367ead00230`
  over four sorted ledger/validator/config entries.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1, Bun 1.3.14, pnpm 11.9.0, Python
  3.12 project environment, branch `TS_backend_refactor`
- Evidence class: `test-ledger`, `python-parity`, `coverage-mapping`, `review`
- Maker run/context ID: `tst-002-maker-root-20260806-059` /
  `tst-002-maker-root-context-20260806-059`
- Checker run/context ID: `tst-002-checker-root-20260806-060` /
  `tst-002-checker-root-context-20260806-060`
- Checker parent run ID: `tst-002-maker-root-20260806-059`
- Checker participated in implementation: `false`
- Commands/procedure:
  - Maker aggregate recomputation -> exit `0`, four files and zero mismatches
  - `pnpm test:tst-002` -> exit `0`, strict TypeScript plus live pytest
    collection and ledger validation
  - live pytest collection -> 47 tests across 14 inventory modules
  - `pnpm migration:plan-check` -> exit `0` after accepted synchronization
  - ledger JSONL validation and `git diff --check` -> exit `0`
- Accepted assertions:
  - all 47 collected pytest node IDs have unique rows, including both
    parametrized invalid-handshake cases;
  - the ledger classifies 27 rows as ported, 7 as superseded, 13 as unmapped
    and assigned to TST-003, and none as approved-delete;
  - every claimed TypeScript proof path exists and every superseded row names
    the migrated invariant or boundary;
  - unmapped rows claim no replacement proof, so the ledger does not hide
    remaining work;
  - the validator fails closed for collection drift, missing modules,
    duplicate/extra rows, missing proof paths, unowned gaps, and incomplete
    deletion approval;
  - Python remains the parity oracle.
- Limitations: this mapping task does not port the 13 explicitly unmapped
  behaviors; TST-003 owns those focused unit/integration ports.
- Checker verdict: `DONE`; only dependency-satisfied `TST-003` is promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/TST-002/tst-002-maker-root-20260806-059/`
  - `.omx/artifacts/typescript-bun/TST-002/tst-002-checker-root-20260806-060/`

### TST-003 / tst-003-checker-root-20260806-062

- Claim: every TST-002-owned unit/integration parity gap now has direct Bun
  proof or an explicit accepted superseding invariant.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Reviewed source-state hash:
  `sha256:a823df36a4caa3a63da9d7647ca13594f6d6af8fbf1df8ae798d4e5936351ab5`
  over 19 sorted implementation, test, ledger, and script entries.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1, Bun 1.3.14, pnpm 11.9.0, Python
  3.12 project environment, branch `TS_backend_refactor`
- Evidence class: `unit-parity`, `integration-parity`, `python-oracle`, `review`
- Maker run/context ID: `tst-003-maker-root-20260806-061` /
  `tst-003-maker-root-context-20260806-061`
- Checker run/context ID: `tst-003-checker-root-20260806-062` /
  `tst-003-checker-root-context-20260806-062`
- Checker parent run ID: `tst-003-maker-root-20260806-061`
- Checker participated in implementation: `false`
- Commands/procedure:
  - Maker aggregate recomputation -> exit `0`, 19 files and zero mismatches
  - `pnpm test:tst-003` -> exit `0`, strict backend TypeScript plus 26 tests
    across six files and 201 expectations
  - `pnpm test:tst-002` -> exit `0`, fresh 47-test Python collection and
    closed ledger with zero errors
  - `bun run --filter @advx/backend-bun openapi:check` -> exit `0`, all 47
    operations match
  - `bun run --filter @advx/backend-bun build` -> exit `0`, 698 modules bundled
  - `pnpm migration:plan-check` -> exit `0` after accepted synchronization
  - ledger JSONL validation and `git diff --check` -> exit `0`
- Accepted assertions:
  - bounded append-only AI-call persistence retains and reloads the newest
    records without rewriting accepted history;
  - Provider setup is authenticated, idempotent, secret-safe, conflict-aware,
    and exposes the retained defaults, role models, and redacted capabilities;
  - all three retained persistence failures have exact safe degraded-health
    codes and no private exception disclosure;
  - realtime backpressure never evicts a queued final transcript to admit a
    partial transcript;
  - four legacy prompt rows are explicitly superseded by the accepted
    independent per-Viewer silence policy rather than silently omitted;
  - the ledger now contains 36 ported, 11 superseded, zero unmapped, and zero
    approved-delete rows, while Python remains the parity oracle.
- Limitations: Node 22.23.1 emits the existing Node 24.18.0 engine warning;
  generated ordering/cancellation property coverage remains owned by TST-004.
- Checker verdict: `DONE`; only dependency-satisfied `TST-004` is promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/TST-003/tst-003-maker-root-20260806-061/`
  - `.omx/artifacts/typescript-bun/TST-003/tst-003-checker-root-20260806-062/`

### TST-004 / tst-004-checker-root-20260806-064

- Claim: ordering, invalidation, cancellation, bounded-work, selection,
  persistence-order, and retry-cap invariants have seeded, replayable
  fast-check proof against the migrated Bun implementation.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Reviewed source-state hash:
  `sha256:0ed186f2a84bf98bb34f132d3f39e9089e9fce1fc133e43a2509eae7658af737`
  over nine sorted implementation, dependency, and lock entries.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1, Bun 1.3.14, pnpm 11.9.0,
  fast-check 4.9.0, branch `TS_backend_refactor`
- Evidence class: `property-test`, `model-test`, `seed-replay`, `review`
- Maker run/context ID: `tst-004-maker-root-20260806-063` /
  `tst-004-maker-root-context-20260806-063`
- Checker run/context ID: `tst-004-checker-root-20260806-064` /
  `tst-004-checker-root-context-20260806-064`
- Checker parent run ID: `tst-004-maker-root-20260806-063`
- Checker participated in implementation: `false`
- Commands/procedure:
  - Maker aggregate recomputation -> exit `0`, nine files and zero mismatches
  - `pnpm test:tst-004` -> exit `0`, strict backend TypeScript plus eight
    properties across three files and 655 generated runs
  - stored candidate budget/rotation seed `1387554732` -> exit `0`, one pass
    and seven filtered properties
  - manifest validation -> eight passing artifacts, eight unique seeds, 655
    total runs
  - deliberate failure-path review -> seed `123`, path `0:0`, counterexample
    `[0]`, one shrink, safe error, and runtime tuple persisted before rejection
  - `pnpm migration:plan-check` -> exit `0` after accepted synchronization
  - ledger JSONL validation and `git diff --check` -> exit `0`
- Accepted assertions:
  - Viewer sequence handling is next-only and older fences cannot remain
    current;
  - replacement advances the audience epoch and invalidates older work;
  - repeated concurrent stop/drain releases resources once;
  - cancellation dominates late task completion with zero side effects;
  - scheduler queue and active concurrency never exceed configured caps;
  - candidate selection is budgeted, deterministic for replay, and rotates
    across Observation identities;
  - SQLite recovery returns the configured ascending event tail;
  - retry delay never exceeds the configured cap and a logical request uses at
    most two physical attempts;
  - failure artifacts contain the minimized case and exact replay inputs.
- Limitations: Node 22.23.1 emits the existing Node 24.18.0 engine warning;
  Provider HTTP/SSE/WS fault injection remains owned by TST-005.
- Checker verdict: `DONE`; only dependency-satisfied `TST-005` is promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/TST-004/tst-004-maker-root-20260806-063/`
  - `.omx/artifacts/typescript-bun/TST-004/tst-004-checker-root-20260806-064/`

### TST-005 / tst-005-checker-root-20260806-066

- Claim: active AI SDK and StepFun ASR remote boundaries have deterministic
  MSW fault coverage for HTTP/SSE failures, with an explicitly reserved
  WebSocket transport fixture and safe normalized outputs.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Reviewed source-state hash:
  `sha256:c3dd653f90c9033081c2207336e08d666062a709a1ce3246e9e5000743dfc8e8`
  over nine sorted implementation, dependency, runner, and lock entries.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1 host, Bun 1.3.14, pnpm 11.9.0,
  MSW 2.15.0, branch `TS_backend_refactor`
- Evidence class: `fault-injection`, `protocol-negative`, `review`
- Maker run/context ID: `tst-005-maker-root-20260806-065` /
  `tst-005-maker-root-context-20260806-065`
- Checker run/context ID: `tst-005-checker-root-20260806-066` /
  `tst-005-checker-root-context-20260806-066`
- Checker parent run ID: `tst-005-maker-root-20260806-065`
- Checker participated in implementation: `false`
- Commands/procedure:
  - Maker aggregate recomputation -> exit `0`, nine files and zero mismatches
  - `pnpm test:tst-005` -> exit `0`, strict backend TypeScript plus nine tests
    and 57 expectations
  - direct `bun run --filter @advx/backend-bun test:agt-003` -> exit `0`, five
    tests and 36 expectations
  - manifest validation -> status passed, nine scenarios, exact MSW 2.15.0,
    Bun 1.3.14, and the reserved WebSocket boundary
  - Checker artifact secret scan -> zero model-secret, ASR-secret, or raw-body
    marker matches
  - live plan-check, ledger JSONL validation, and `git diff --check` -> exit `0`
- Accepted assertions:
  - refusal, timeout, caller cancellation, 401/403/429/5xx, malformed JSON,
    split/truncated SSE, partial usage, slow streams, and bounded typed-output
    repair are exercised through the real Provider adapters;
  - malformed AI SDK HTTP 2xx responses normalize as non-retryable protocol
    `invalid_response` failures;
  - retry eligibility and cancellation behavior remain bounded, with no late
    completion and no secret-bearing result or artifact;
  - no active runtime Provider uses WebSocket, so the accepted WebSocket
    close/invalid-frame/reconnect case is a reserved transport fixture and not
    a production implementation claim;
  - MSW remains an exact dev-only dependency and its optional build script is
    explicitly disabled under pnpm.
- Limitations: the host pnpm process emits the existing Node 24.18.0 engine
  warning under Node 22.23.1; task implementation and tests execute under Bun
  1.3.14. Protocol fuzzing remains owned by TST-006.
- Checker verdict: `DONE`; only dependency-satisfied `TST-006` is promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/TST-005/tst-005-maker-root-20260806-065/`
  - `.omx/artifacts/typescript-bun/TST-005/tst-005-checker-root-20260806-066/`

### TST-006 / tst-006-checker-root-20260806-068

- Claim: the Bun server safely and deterministically rejects the bounded
  invalid protocol corpus without crash, hostile allocation, downstream work,
  or ambiguous partial acceptance.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Reviewed source-state hash:
  `sha256:ec09bfff748132fd25f4f947959c130531ed55b6a87d02dd2958f6d3505811da`
  over five sorted corpus, test, runner, and script entries.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1 host, Bun 1.3.14, pnpm 11.9.0,
  branch `TS_backend_refactor`
- Evidence class: `protocol-negative`, `resource-bound`, `review`
- Maker run/context ID: `tst-006-maker-root-20260806-067` /
  `tst-006-maker-root-context-20260806-067`
- Checker run/context ID: `tst-006-checker-root-20260806-068` /
  `tst-006-checker-root-context-20260806-068`
- Checker parent run ID: `tst-006-maker-root-20260806-067`
- Checker participated in implementation: `false`
- Commands/procedure:
  - Maker aggregate recomputation -> exit `0`, five files and zero mismatches
  - `pnpm test:tst-006` -> exit `0`, strict backend TypeScript plus six tests
    and 70 expectations
  - manifest validation -> status passed, 18 cases, eight categories, corpus
    SHA match, 3,851-byte corpus, and bounded declaration-only hostile input
  - source review -> real Elysia routes, ReplayService, RealtimeHub, ADVX-BIN
    decoder, BinaryIngestDispatcher, and TextIngestDispatcher
  - live plan-check, ledger JSONL validation, and `git diff --check` -> exit `0`
- Accepted assertions:
  - missing, extra, wrong-type, oversized, and future-version control traffic
    is normalized and the authenticated health route remains responsive;
  - replay sequence gaps, duplicates, and reordering are rejected before the
    recorded runner executes;
  - unknown realtime kinds and oversized JSON close safely without token
    disclosure or retained connection state;
  - invalid binary magic, versions, headers, lengths, body declarations, and
    media metadata perform zero dispatch and leave no in-flight work;
  - stale-Session and post-stop traffic performs zero partial text ingest;
  - nonfatal binary/session rejection preserves follow-up ping handling;
  - hostile fixtures remain at or below 4,096 bytes, with the oversized body
    represented only by a length declaration;
  - decompression is not applicable to retained ingress; bounded media
    metadata is the accepted applicable limit.
- Limitations: the host pnpm process emits the existing Node 24.18.0 engine
  warning under Node 22.23.1; task implementation and tests execute under Bun
  1.3.14.
- Checker verdict: `DONE`; only dependency-satisfied `TST-007` is promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/TST-006/tst-006-maker-root-20260806-067/`
  - `.omx/artifacts/typescript-bun/TST-006/tst-006-checker-root-20260806-068/`

### TST-007 / tst-007-checker-root-20260806-070

- Claim: critical renderer behavior is exercised in real Chromium with the
  actual store, components, callbacks, focus, and keyboard paths rather than
  DOM emulation or copied fixtures.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Reviewed source-state hash:
  `sha256:3055261c69c61e6e7978069aed395e8c7002799a8d04b0294ff0a96b2ff38c38`
  over five sorted browser-test, runner, TypeScript, script, and config entries.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1 Vitest host, Bun 1.3.14 runner,
  Playwright Chromium using system Chrome, branch `TS_backend_refactor`
- Evidence class: `real-browser`, `renderer-component`, `accessibility`, `review`
- Maker run/context ID: `tst-007-maker-root-20260806-069` /
  `tst-007-maker-root-context-20260806-069`
- Checker run/context ID: `tst-007-checker-root-20260806-070` /
  `tst-007-checker-root-context-20260806-070`
- Checker parent run ID: `tst-007-maker-root-20260806-069`
- Checker participated in implementation: `false`
- Commands/procedure:
  - Maker aggregate recomputation -> exit `0`, five files and zero mismatches
  - `pnpm test:tst-007` -> exit `0`, strict runner and desktop TypeScript plus
    one real-Chromium file with five passing tests
  - manifest validation -> status passed, five exact scenarios, seven exact
    coverage families, zero failed/pending, Playwright Chromium provider
  - source review -> actual Zustand store, LiveStage, overlay App,
    useBackendRuntime/AppShell, LiveDeviceStrip, and SourcePickerDialog
  - residual-process scan -> zero matching runner or browser process
  - live plan-check, ledger JSONL validation, and `git diff --check` -> exit `0`
- Accepted assertions:
  - Zustand session updates render pause, resume, clear, and bounded stop state
    through the actual LiveStage controls;
  - overlay callbacks preserve barrage order, density eviction, mode rendering,
    and clear behavior;
  - backend disconnected and failed notices render, retry invokes the runtime
    hook, and a connected result clears the failure UI;
  - microphone and system-audio controls retain separate identities and actions
    while microphone/camera permission restrictions render clearly;
  - SourcePickerDialog receives focus, exposes a permission error as an alert,
    and handles Escape through a real keyboard event;
  - the browser suite exits without a matching residual process.
- Limitations: this component-browser proof does not replace Electron preload,
  IPC, window, or OS integration E2E owned by TST-008. The host emits the
  existing Node 24.18.0 engine warning under Node 22.23.1.
- Checker verdict: `DONE`; only dependency-satisfied `TST-008` is promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/TST-007/tst-007-maker-root-20260806-069/`
  - `.omx/artifacts/typescript-bun/TST-007/tst-007-checker-root-20260806-070/`

### TST-008 / tst-008-checker-root-20260806-072

- Claim: Electron Playwright E2E uses one reusable, bounded fixture to prove a
  decisive recorded Bun source pipeline and a real compiled Bun lifecycle,
  while capturing actionable failure evidence and leaving no child process or
  product-data residue.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Reviewed source-state hash:
  `sha256:e3eef0a9469f22512e6c6241f061a4ad769319978a2e9f39033208a926d3c4c5`
  over six sorted fixture, runner, compatibility-entry, TypeScript-config, and
  package-script entries.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1 test host, Bun 1.3.14 runner,
  Electron 43.2.0, Playwright 1.61.1, branch `TS_backend_refactor`
- Evidence class: `electron-e2e`, `cross-process`, `compiled-runtime`, `cleanup`,
  `review`
- Maker run/context ID: `tst-008-maker-root-20260806-071` /
  `tst-008-maker-root-context-20260806-071`
- Checker run/context ID: `tst-008-checker-root-20260806-072` /
  `tst-008-checker-root-context-20260806-072`
- Checker parent run ID: `tst-008-maker-root-20260806-071`
- Checker participated in implementation: `false`
- Commands/procedure:
  - Maker aggregate recomputation -> exit `0`, six files and zero mismatches
  - fresh `pnpm test:tst-008` -> exit `0`, strict fixture/runner, desktop, and
    Bun TypeScript, Electron build, and two passing cross-process scenarios
  - Checker suite validation -> exact source full-pipeline and compiled
    recorded-lifecycle cases, zero fatal diagnostics, suite SHA match
  - residual probe -> port 8765 free and zero TST-008 Electron/backend/runner
    processes
  - live plan-check, ledger JSONL validation, and `git diff --check` -> exit `0`
- Accepted assertions:
  - both runtime modes use isolated Electron user data and runtime-specific
    backend data under temporary roots;
  - the normal-CI source case submits text, frame, microphone, and system audio,
    receives a deterministic recorded barrage, renders the real overlay, and
    records a Provider trace with a frame hash;
  - the temporary compiled executable is hashed and drives a real supervised
    recorded session, barrage, trace, stop, and cleanup before being removed;
  - main, renderer, and process diagnostics are structured and bounded;
    renderer page errors/crashes and process errors are fatal;
  - failure paths retain a Playwright trace, screenshots of open windows, and a
    bounded redacted application log; video is intentionally disabled for this
    short deterministic scenario;
  - startup, action, and shutdown waits are bounded, finally cleanup stops the
    session and Electron, targeted process-tree termination is available, port
    8765 is released, and temporary data is removed;
  - credentialed Provider and non-Windows platform matrices remain explicit
    jobs rather than slowing normal CI.
- Limitations: the pnpm/Node test host reports Node 22.23.1 instead of the
  declared Node 24.18.0 engine. The scenario uses deterministic recorded
  Provider behavior and does not claim live credentials or non-Windows proof.
- Checker verdict: `DONE`; only dependency-satisfied `TST-009` is promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/TST-008/tst-008-maker-root-20260806-071/`
  - `.omx/artifacts/typescript-bun/TST-008/tst-008-checker-root-20260806-072/`

### TST-009 / tst-009-checker-root-20260806-074

- Claim: active lifecycle, replay, fixture, artifact-hash, redaction, OpenAPI,
  and evidence-validation scripts run as strict TypeScript with Bun on Windows,
  emit machine JSON with stable exits, require safe artifact roots, clean up on
  interruption, and do not mutate product data.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Reviewed source-state hash:
  `sha256:335ae56a0ff86fdf501a52cb075011bb0d9a2d4a636db1011c22278aa5d5b498`
  over thirteen sorted script, test, config, ledger, and package entries.
- Date: 2026-08-06
- Environment: Windows x64, Node 22.23.1 pnpm host, Bun 1.3.14, branch
  `TS_backend_refactor`
- Evidence class: `typescript-script`, `process-lifecycle`, `recorded-replay`,
  `artifact-integrity`, `redaction`, `data-safety`, `review`
- Maker run/context ID: `tst-009-maker-root-20260806-073` /
  `tst-009-maker-root-context-20260806-073`
- Checker run/context ID: `tst-009-checker-root-20260806-074` /
  `tst-009-checker-root-context-20260806-074`
- Checker parent run ID: `tst-009-maker-root-20260806-073`
- Checker participated in implementation: `false`
- Commands/procedure:
  - Maker aggregate recomputation -> exit `0`, thirteen files, zero mismatches
  - fresh `ADVX_TST009_ARTIFACT_ROOT=<checker>/suite pnpm test:tst-009` ->
    exit `0`, strict TypeScript and seven focused tests with 24 expectations
  - `pnpm test:tst-002` -> exit `0`, 47 rows, zero unmapped/errors
  - secret, legacy-path, and residual-task-process probes -> zero each
  - live plan-check, ledger validation, and `git diff --check` -> exit `0`
- Accepted assertions:
  - typed lifecycle helpers preserve socket shutdown, graceful SIGTERM, forced
    fallback, and timer cleanup behavior;
  - the guarded script runtime uses explicit safe roots, atomic JSON, stable
    exit codes, and registered cleanup for both signal and timeout aborts;
  - the retained CS2 recording is parsed and projected in memory to its active
    mode/current Bun contract, runs through real `ReplayService` twice, consumes
    six events and the exact Viewer/visual-summary/memory/ASR identities, and
    makes zero external Provider calls;
  - the 180,816-byte source fixture remains byte-identical with SHA-256
    `e7203a1471c0905ded13e753c026c9dd90fc1185d80626281d39acd87832364c`;
  - replay artifacts are re-hashed, credential/raw fields are rejected, and
    generated OpenAPI types exactly match the checked-in 296,668-byte file;
  - all four superseded `.mjs` entries are absent, and the active package and
    TST-002 ledger point to TypeScript replacements.
- Limitations: the retained Python-era fixture requires a deterministic
  active-mode projection for the current 32-persona contract; the source
  fixture and Python oracle remain unchanged. The pnpm host reports Node
  22.23.1 instead of declared Node 24.18.0.
- Checker verdict: `DONE`; only dependency-satisfied `TST-010` is promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/TST-009/tst-009-maker-root-20260806-073/`
  - `.omx/artifacts/typescript-bun/TST-009/tst-009-checker-root-20260806-074/`

### TST-010 / tst-010-checker-root-20260806-076

- Claim: Oxlint is the fast default TypeScript/JavaScript linter with reviewed
  staged rules and exclusions, while Oxfmt is the sole formatter with a bounded
  first gate covering repository style plus JSON, Markdown, YAML, Electron/Vite,
  and reviewed TypeScript inputs.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Reviewed source-state hash:
  `sha256:9bf3020f66e22330b3c14af726798e52bcb1c1f9275c41cce97e10e22a06a801`
  over eleven sorted configs, locks, reviewed sources, and decision entries.
- Date: 2026-08-06
- Environment: Windows x64, Bun 1.3.14, pnpm 11.9.0, Node 22.23.1, branch
  `TS_backend_refactor`
- Evidence class: `lint`, `format`, `typescript`, `dependency-lock`, `review`
- Maker run/context ID: `tst-010-maker-root-20260806-075` /
  `tst-010-maker-root-context-20260806-075`
- Checker run/context ID: `tst-010-checker-root-20260806-076` /
  `tst-010-checker-root-context-20260806-076`
- Checker parent run ID: `tst-010-maker-root-20260806-075`
- Checker participated in implementation: `false`
- Commands/procedure:
  - Maker aggregate recomputation -> exit `0`, eleven files, zero mismatches
  - fresh `pnpm test:tst-010` -> exit `0`, lint, format, and strict TypeScript
  - focused ports test -> exit `0`, 4 tests and 24 expectations
  - structured config/dependency review -> 13 blocking rules, two warning
    rules, zero formatter conflicts, exact versions in both locks, age gate `0`
- Accepted assertions:
  - Oxlint covers active handwritten Bun, Electron, contracts, scripts, tests,
    and Vite source while generated, Python, build, evidence, `output/`, and
    `promo/` paths are explicitly excluded;
  - the first rule stage blocks reviewed correctness, suspicious, import,
    Promise, and React defects and exits with zero errors;
  - Oxfmt is the sole formatter and preserves single quotes, no semicolons,
    two-space indentation, LF, final newlines, and stable import/package order;
  - the bounded nine-file formatter baseline covers JSON, Markdown, YAML,
    Electron/Vite config, and reviewed TypeScript without silently rewriting
    hundreds of legacy-format files or generated contracts;
  - strict TypeScript remains authoritative instead of enabling duplicate
    type-aware lint without a measured benefit;
  - pnpm's built-in dependency-age policy is explicitly disabled with
    `minimumReleaseAge: 0`, and the Python parity oracle remains intact.
- Limitations: 11 duplicate-import or React exhaustive-dependency findings remain
  visible warnings. Broad existing format drift is outside this first formatter
  baseline. The pnpm host reports Node 22.23.1 rather than declared Node 24.18.0.
- Checker verdict: `DONE`; only dependency-satisfied `TST-011` is promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/TST-010/tst-010-maker-root-20260806-075/`
  - `.omx/artifacts/typescript-bun/TST-010/tst-010-checker-root-20260806-076/`

### TST-011 / tst-011-checker-root-20260807-078

- Claim: Knip has a reviewed Bun-hosted workspace baseline covering root
  tooling, Bun entries and dynamic modules, Electron-Vite entries, contracts,
  test runners, generated/declaration boundaries, and exact OS/parity binaries
  without concealing the remaining audit queue.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Reviewed source-state hash:
  `sha256:edeac1559b863bdb6d353eaf21b19c599da39f348af0a764dbb38d0012aa3b9e`
  over five sorted config, lockfile, and decision entries.
- Date: 2026-08-07
- Environment: Windows x64, Bun 1.3.14, pnpm 11.9.0, Node 22.23.1, branch
  `TS_backend_refactor`
- Evidence class: `dead-code-audit`, `dependency-audit`, `typescript`, `review`
- Maker run/context ID: `tst-011-maker-root-20260807-077` /
  `tst-011-maker-root-context-20260807-077`
- Checker run/context ID: `tst-011-checker-root-20260807-078` /
  `tst-011-checker-root-context-20260807-078`
- Checker parent run ID: `tst-011-maker-root-20260807-077`
- Checker participated in implementation: `false`
- Commands/procedure:
  - Maker aggregate recomputation -> exit `0`, five files, zero mismatches
  - fresh `pnpm test:tst-011` -> exit `0`, 69 affected file records and 179
    visible findings, focused formatting, and strict TypeScript
  - `pnpm test:binary-portability` -> exit `0`, six fixture round trips, 665
    bytes
  - structured config review -> two exact dynamic entries, two
    generated/declaration suppression keys, two exact binaries, no top-level
    ignore, and deleted demo absent
  - live plan check and `git diff --check` -> exit `0`
- Accepted assertions:
  - no source directory is blanket-ignored; generated contracts and Electron
    declaration files retain only narrowly scoped export/type suppression;
  - dynamic heap profiling and SQLite crash fixtures are explicit entries;
  - contract type, parity, and binary portability runners are declared and the
    binary portability command executes the retained Python fixtures;
  - `taskkill.exe` remains a Windows lifecycle primitive and `uv` remains the
    Python parity-oracle command, both as exact allowlist entries;
  - the unreferenced desktop demo fixture is removed, while capture, packaging,
    CSS, observability, public export/type, and semantic-alias findings remain
    visible for their owners;
  - Python parity source remains intact and pnpm's built-in dependency-age
    policy remains explicitly disabled with `minimumReleaseAge: 0`.
- Limitations: the initial report intentionally remains non-clean: 69 affected
  file records and 179 individual findings are a review queue. Node 22.23.1 is
  below the declared Node 24.18.0 engine.
- Checker verdict: `DONE`; only dependency-satisfied `TST-014` is promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/TST-011/tst-011-maker-root-20260807-077/`
  - `.omx/artifacts/typescript-bun/TST-011/tst-011-checker-root-20260807-078/`

## TST-014 / tst-014-maker-root-20260807-079

- Maker run/context: `tst-014-maker-root-20260807-079` /
  `tst-014-maker-root-context-20260807-079` on branch `TS_backend_refactor` at
  HEAD `41665a96cf67eb82cbe02f83abbbe2b79b100e48`.
- Decision: the six active non-backend Python root tooling entry points are
  replaced by Bun TypeScript scripts. The Python recorded E2E/parity oracle
  and backend-owned helper scripts remain explicit retained boundaries.
- Focused verification: `pnpm typecheck:tst-014`, `pnpm test:tst-014`,
  `bun scripts/sync-room-6657-skill.ts --check`, and the Bun viewer evidence
  verifier all exit `0`.
- Evidence: `.omx/artifacts/typescript-bun/TST-014/`
  `tst-014-maker-root-20260807-079/` (`inventory.json`, `source-files.json`,
  `verification.json`).
- Maker status: `VERIFY`; independent Checker acceptance is still required.

### PKG-001 / pkg-001-checker-root-20260807-093

- Claim: deterministic Bun backend compile command, manifest, reproducibility
  comparison, and hostile-cwd supervisor launch.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Dirty diff identity: reviewed source aggregate
  `b91385da9f23da0bcab463608b4763a90a6774846e3be1bb6288dcfee5cafb00`
- Date: `2026-08-07`
- Environment: Windows x64, Bun `1.3.14`, pnpm `11.9.0`
- Evidence class: `unpacked`, `integration`, `security`, `review`
- Maker: `pkg-001-maker-root-20260807-090`
- Maker run/context ID: `pkg-001-maker-root-20260807-090` /
  `pkg-001-maker-root-context-20260807-090`
- Checker: `pkg-001-checker-root-20260807-093`
- Checker run/context ID: `pkg-001-checker-root-20260807-093` /
  `pkg-001-checker-root-context-20260807-093`
- Checker parent run ID: `pkg-001-maker-root-20260807-090`
- Checker participated in implementation: `false`
- Commands/procedure:
  - `pnpm typecheck:pkg-001` -> exit `0`
  - focused two-build and hostile-cwd runner -> exit `0`
  - `pnpm migration:plan-check` -> exit `0`
  - `bun scripts/check-test-migration-ledger.ts` -> exit `0`
  - `git diff --check` -> exit `0`
- Artifacts:
  - `.omx/artifacts/typescript-bun/PKG-001/pkg-001-checker-root-20260807-093/`
    (`result.json`, two manifests, two compiled executables, checker report)
- Accepted assertions:
  - compile entrypoint, target, flags, asset policy, disabled autoload, and
    hash manifest are explicit;
  - same-source clean builds have matching inputs, equal size, and byte-equal
    output; any unexpected difference would be recorded and bounded;
  - `main.js.map` is absent from both shipped output roots;
  - hostile cwd files do not affect authenticated `/health`; parent `BUN_BE_BUN`
    and Provider-looking values are scrubbed; no poison preload marker is
    written; supervisor disposal is clean.
- Limitations: PKG-002 owns the platform target matrix; PKG-003/004 own asset
  copying and Electron packaging; Python remains the parity oracle.
- Related run log: `pkg-001-maker-root-20260807-090` and
  `pkg-001-checker-root-20260807-093`

## TST-013 / tst-013-maker-root-20260807-083

- Maker run/context: `tst-013-maker-root-20260807-083` /
  `tst-013-maker-root-context-20260807-083` on branch `TS_backend_refactor` at
  HEAD `41665a96cf67eb82cbe02f83abbbe2b79b100e48`.
- Decision: add one Bun aggregate parity command for the Python/Bun control
  slice, health parity, recorded Python viewer oracle, and Bun replay verifier.
- Focused verification: `pnpm typecheck:tst-013`, the aggregate
  `bun scripts/run-tst-013.ts --artifact-root .omx/artifacts/test-results/tst-013-3`,
  and the parity harness typecheck all exit `0`.
- Aggregate result: seven required categories pass; one known Python debug
  endpoint difference is retained as twelve explicit
  `python-debug-snapshot-unavailable` classifications. Ports, descendants,
  temporary directories, redaction, and offline Provider invariants pass.
- Evidence: `.omx/artifacts/typescript-bun/TST-013/`
  `tst-013-maker-root-20260807-083/` (`tst-013-report.json`, control/session,
  health, and Bun replay artifacts).
- Source aggregate: five implementation/decision files, SHA-256
  `30cc5ecf1b9e083cec6c4068df77c3c3a3732dbd2ec490215ec2656d1daf4d77`, zero
  mismatches in the distinct Checker review.
- Status: `VERIFY`; an independent Checker must accept this candidate before
  `DONE` and before promoting `GATE-07`.

### GATE-07 / gate-07-checker-root-20260807-087

- Claim: Phase 07 test/tooling convergence satisfies the eleven-item exit
  checklist using accepted TST-000..014 evidence and the coverage ledger.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48` (dirty worktree)
- Reviewed source-state hash: `sha256:28f0167449d333b8a7b1be46176f8d90c886322be3a037cda69de3cd0af8a2a4`
  over five scoped source/control files; Maker and Checker matched with zero
  mismatches.
- Date: 2026-08-07
- Environment: Windows x64, Node 22.23.1, Bun 1.3.14, pnpm 11.9.0, branch
  `TS_backend_refactor`
- Evidence class: `phase-gate`, `review`, `static`, `ledger`
- Maker run/context ID: `gate-07-maker-root-20260807-086` /
  `gate-07-maker-root-context-20260807-086`
- Checker run/context ID: `gate-07-checker-root-20260807-087` /
  `gate-07-checker-root-context-20260807-087`
- Checker parent run ID: `gate-07-maker-root-20260807-086`
- Checker participated in implementation: `false`
- Commands/procedure:
  - `pnpm check:gate-07` -> exit `0`, 11/11 criteria;
  - `bun scripts/check-test-migration-ledger.ts` -> exit `0`, 47/47 rows,
    zero unmapped;
  - `bun run migration:plan-check` -> exit `0`, 133 tasks, 72 links, zero
    errors;
  - `git diff --check` -> exit `0`.
- Accepted assertions: Phase 07 entry, Vitest boundaries, coverage ledger,
  critical regression proof, Browser/Electron role separation, Bun evidence
  scripts, Oxlint/Oxfmt, Knip, frozen CI/audit/type/build/parity, Python-tool
  inventory, and independent Checker coverage all pass. `PKG-001` is the only
  promoted next task.
- Limitations: Node 22 engine warning, no credentialed-live Provider claim,
  and the classified TST-013 Python debug-route boundary remain explicit.
- Checker verdict: `GATE-07 VERIFY -> DONE`; Phase 07 is `DONE`.
- Artifacts:
  - `.omx/artifacts/typescript-bun/GATE-07/gate-07-maker-root-20260807-086/`
  - `.omx/artifacts/typescript-bun/GATE-07/gate-07-checker-root-20260807-087/`

### TST-013 / tst-013-checker-root-20260807-084

- Status: `DONE`
- Maker run/context ID: `tst-013-maker-root-20260807-083` /
  `tst-013-maker-root-context-20260807-083`
- Checker run/context ID: `tst-013-checker-root-20260807-084` /
  `tst-013-checker-root-context-20260807-084`
- Checker parent run ID: `tst-013-maker-root-20260807-083`
- Checker participated in implementation: `false`
- Reviewed source-state hash: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Source aggregate: five files, SHA-256
  `30cc5ecf1b9e083cec6c4068df77c3c3a3732dbd2ec490215ec2656d1daf4d77`, zero
  mismatches.
- Commands/procedure:
  - `pnpm typecheck:tst-013` -> exit `0`;
  - parity-harness strict TypeScript -> exit `0`;
  - fresh TST-013 aggregate -> exit `0`, seven categories passed;
  - `bun run migration:plan-check` -> exit `0` (133 tasks, 72 links, 103
    accepted evidence, zero errors);
  - `git diff --check` -> exit `0`.
- Accepted assertions: all required TST-013 categories pass; the Python debug
  route 500/traceback remains twelve explicit classifications; Bun redaction,
  recorded barrage/silence, offline Provider behavior, port release, zero
  descendants, and temporary-data cleanup pass. Python parity sources remain
  intact.
- Checker verdict: `TST-013 VERIFY -> DONE`; only `GATE-07` is promoted.
- Accepted evidence:
  `.omx/artifacts/typescript-bun/TST-013/tst-013-checker-root-20260807-084/`.

### TST-012 / tst-012-checker-root-20260807-082

- Status: `DONE`
- Maker run/context ID: `tst-012-maker-root-20260807-081` /
  `tst-012-maker-root-context-20260807-081`
- Checker run/context ID: `tst-012-checker-root-20260807-082` /
  `tst-012-checker-root-context-20260807-082`
- Checker parent run ID: `tst-012-maker-root-20260807-081`
- Checker participated in implementation: `false`
- Reviewed source-state hash: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Source aggregate: eight files, SHA-256
  `9a2604472125ee0ed6a2ae698958f01d599accdf801314c19c94058ca909670f`, zero
  mismatches.
- Commands/procedure:
  - `pnpm test:tst-012` -> exit `0`, all required workflow markers present;
  - `bun install --frozen-lockfile` -> exit `0`;
  - `bun audit --json` -> exit `0`, `{}`;
  - `bun run lint` -> exit `0`, 11 existing warnings and no errors;
  - `bun run format:check` -> exit `0`;
  - contracts/backend/desktop strict typechecks -> exit `0`;
  - focused lifecycle/backend/Electron Main tests -> exit `0` (7 + 19 + 30);
  - `bun run test:tst-014`, both Bun builds, scoped diff check, and live
    `bun run migration:plan-check` -> exit `0`.
- Accepted assertions:
  - CI uses Bun 1.3.14 frozen install and fatal audit with read-only
    permissions, push/PR triggers, and no pnpm install fallback;
  - contract drift, type, lint, format, focused tests, recorded evidence, and
    backend/desktop builds are explicit workflow steps;
  - pnpm's built-in dependency-age policy is explicitly closed with
    `minimumReleaseAge: 0`, no exception list is present, and fixed dependency
    overrides yield a clean audit;
  - the Python parity oracle remains intact and only `TST-013` is promoted.
- Limitations: the accepted TST-000 full-suite import-boundary limitation and
  existing lint warnings remain visible for later owners; they do not violate
  TST-012 acceptance.
- Checker verdict: `DONE`; only dependency-satisfied `TST-013` is promoted.
- Artifacts:
  - `.omx/artifacts/typescript-bun/TST-012/tst-012-maker-root-20260807-081/`
  - `.omx/artifacts/typescript-bun/TST-012/tst-012-checker-root-20260807-082/`

### TST-014 / tst-014-checker-root-20260807-080

- Independent Checker run/context: `tst-014-checker-root-20260807-080` /
  `tst-014-checker-root-context-20260807-080`; parent Maker
  `tst-014-maker-root-20260807-079`; no implementation participation.
- Status: `DONE`
- Maker run/context ID: `tst-014-maker-root-20260807-079` /
  `tst-014-maker-root-context-20260807-079`
- Checker run/context ID: `tst-014-checker-root-20260807-080` /
  `tst-014-checker-root-context-20260807-080`
- Checker parent run ID: `tst-014-maker-root-20260807-079`
- Checker participated in implementation: `false`
- Reviewed source-state hash: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Recomputed the eight-file Maker aggregate
  `93a24e86752e62727568a5d21a01a12697a1c270bf3c83e958e176e99652a991` with
  zero mismatches.
- Fresh focused TypeScript, TST-014 tests, Bun evidence, generated Skill
  check, retired-root-reference scan, retained-oracle scan, scoped diff check,
  and live plan-check all exit `0`.
- Verdict: `TST-014 VERIFY -> DONE`; only dependency-satisfied `TST-012` is
  promoted to `READY`.
- Accepted evidence:
  `.omx/artifacts/typescript-bun/TST-014/tst-014-checker-root-20260807-080/`.

## TST-012 / tst-012-maker-root-20260807-081

- Maker run/context: `tst-012-maker-root-20260807-081` /
  `tst-012-maker-root-context-20260807-081` on branch `TS_backend_refactor` at
  HEAD `41665a96cf67eb82cbe02f83abbbe2b79b100e48`.
- Decision: add the bounded Bun CI workflow and static contract checker. The
  pnpm built-in release-age policy stays explicitly disabled with
  `minimumReleaseAge: 0`; no exception list is present.
- Dependency resolution: fixed overrides for `brace-expansion@5.0.9`,
  `fast-uri@3.1.5`, and `js-yaml@4.3.1`; the obsolete brace-expansion patch is
  removed; both lockfiles are regenerated.
- Focused verification: frozen install, `bun audit --json`, contract drift,
  strict typecheck, Oxlint, Oxfmt, lifecycle/backend/Desktop Main tests,
  TST-009 recorded evidence, and backend/desktop builds all exit `0`.
- Evidence: `.omx/artifacts/typescript-bun/TST-012/`
  `tst-012-maker-root-20260807-081/` (`source-files.json`,
  `verification.json`).
- Maker status: `VERIFY`; independent Checker acceptance is still required.

### PKG-002 / pkg-002-checker-root-20260807-095

- Claim: lock the Bun/Electron target OS, architecture, baseline, native-risk,
  signing, and runner matrix in ADR-MIG-004.
- Status: `DONE`
- Maker run/context ID: `pkg-002-maker-root-20260807-094` /
  `pkg-002-maker-root-context-20260807-094`
- Checker run/context ID: `pkg-002-checker-root-20260807-095` /
  `pkg-002-checker-root-context-20260807-095`
- Checker parent run ID: `pkg-002-maker-root-20260807-094`
- Checker participated in implementation: `false`
- Reviewed source-state hash: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Final source aggregate: five files, SHA-256
  `7e99ba7bd562ae9e5ac9baed59b4d491ed80038343c918299f16175b78241395`, zero
  mismatches.
- Commands/procedure:
  - `pnpm typecheck:pkg-002` -> exit `0`;
  - `bun scripts/check-pkg-002.ts` -> exit `0`, 13/13 criteria;
  - `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links, zero errors;
  - `bun scripts/check-test-migration-ledger.ts` -> exit `0`, 47/47 rows,
    zero unmapped;
  - `git diff --check` -> exit `0` (existing CRLF normalization warnings
    only); ultragoal ledger JSONL parse -> `ledger-jsonl-ok`.
- Accepted assertions:
  - Windows x64 Bun baseline (`bun-windows-x64-baseline`) is the only current
    release target, supervised by Electron 43.2.0 and NSIS;
  - Windows arm64, macOS arm64, and macOS x64 target shapes are documented but
    explicitly not released without installed proof or accepted limitation;
  - minimum OS floors, Bun target shapes, Electron targets, native/WASM risks,
    signing gaps, runner availability, FND-004 baseline evidence, and the
    cross-compilation boundary are explicit;
  - only PKG-003 is promoted to `READY`; Python remains the parity oracle.
- Limitations: no new macOS/Windows arm64 installed or signing evidence is
  claimed; PKG-011 owns that decision.
- Accepted evidence:
  `.omx/artifacts/typescript-bun/PKG-002/pkg-002-checker-root-20260807-095/`

### PKG-003 / pkg-003-checker-root-20260807-097

- Claim: inventory and package all non-code backend runtime assets without
  writing into ASAR or installed resources.
- Status: `DONE`
- Maker run/context ID: `pkg-003-maker-root-20260807-096` /
  `pkg-003-maker-root-context-20260807-096`
- Checker run/context ID: `pkg-003-checker-root-20260807-097` /
  `pkg-003-checker-root-context-20260807-097`
- Checker parent run ID: `pkg-003-maker-root-20260807-096`
- Checker participated in implementation: `false`
- Reviewed source-state hash: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Final source aggregate: six files, SHA-256
  `ac1634d3cc2deca2f77d5ae392c026b85d0dc28cf80aced8798b2017be57f3a8`, zero
  mismatches after the final plan transition.
- Embedded asset evidence: seven byte identities (package manifest plus six
  SQLite migration SQL files); copied runtime assets: zero.
- Test-only exclusions: agent-eval fixture, TST-006 corpus, Python legacy
  fixture, and OpenAPI snapshot remain outside `resources/backend`.
- Commands/procedure:
  - `pnpm typecheck:pkg-003` -> exit `0`;
  - `bun scripts/check-pkg-003.ts` -> exit `0`;
  - packaged-like resource smoke -> health/readiness/version/debug `200`,
    database schema metadata `6`, explicit missing executable error,
    unchanged resource tree, redirected runtime data, no hostile preload, and
    clean disposal;
  - Maker-side `pnpm migration:plan-check` -> exit `0`, 133 tasks, 72 links,
    zero errors; coverage ledger 47/47 with zero unmapped; `git diff --check`
    and ultragoal ledger JSONL parse pass.
- Limitations: electron-builder `extraResources` handoff is owned by PKG-004;
  no installed installer claim is made by PKG-003.
- Accepted evidence:
  `.omx/artifacts/typescript-bun/PKG-003/pkg-003-checker-root-20260807-097/`

### PKG-004 / pkg-004-checker-root-20260807-099

- Claim: package the compiled Bun backend through electron-builder
  `extraResources` and prove the unpacked runtime handoff.
- Status: `DONE`
- Maker run/context ID: `pkg-004-maker-root-20260807-098` /
  `pkg-004-maker-root-context-20260807-098`
- Checker run/context ID: `pkg-004-checker-root-20260807-099` /
  `pkg-004-checker-root-context-20260807-099`
- Checker parent run ID: `pkg-004-maker-root-20260807-098`
- Checker participated in implementation: `false`
- Reviewed source-state hash: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Final source aggregate: six files, SHA-256
  `1ebeb6a88c9ccbe9003d98906abe014de42217d62e667e6817497a4cafac1971`, zero
  mismatches after the final plan transition.
- Packaging evidence: electron-builder `26.15.3` on Windows x64 with
  `apps/backend-bun/dist` -> `resources/backend`, filter
  `advx-backend-bun*`; exactly one backend executable is present and its
  101645824 bytes match the compile manifest SHA-256.
- Commands/procedure:
  - `pnpm typecheck:pkg-004` -> exit `0`;
  - `bun scripts/check-pkg-004.ts` -> exit `0`;
  - real electron-builder Windows x64 `--dir` output -> exit `0`;
  - packaged health/readiness/version/debug -> `200`;
  - database schema metadata -> `6`;
  - explicit missing executable error, immutable resources, redirected data,
    hostile working-directory isolation, and clean disposal -> pass.
- Limitations: this is unsigned unpacked local evidence only; installer,
  signing, upgrade, uninstall, macOS, and Windows arm64 claims remain owned by
  later Phase 08 tasks.
- Accepted evidence:
  `.omx/artifacts/typescript-bun/PKG-004/pkg-004-checker-root-20260807-099/`

### PKG-005 / pkg-005-checker-root-20260807-101

- Claim: verify installed user-data, Bun backend-data, database, logs, and
  diagnostics paths after packaging on Windows x64.
- Status: `DONE`
- Maker run/context ID: `pkg-005-maker-root-20260807-100` /
  `pkg-005-maker-root-context-20260807-100`
- Checker run/context ID: `pkg-005-checker-root-20260807-101` /
  `pkg-005-checker-root-context-20260807-101`
- Checker parent run ID: `pkg-005-maker-root-20260807-100`
- Checker participated in implementation: `false`
- Reviewed source-state hash: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Final source aggregate: five files, SHA-256
  `5787076afbbdea49bcca85b80d10025f6ba166e39c832a36b651f165459a82e1`, zero
  mismatches after the final plan transition.
- Installed evidence: the independent checker passes on Bun `1.3.14`/
  Windows x64; the supervised compiled backend creates SQLite/WAL/SHM under
  `userData/backend/bun-compiled`; logs, crash dumps, redacted trace metadata,
  and 112 persona files remain in declared paths; resources remain
  byte-identical; hostile cwd files do not execute; and the same-user-data
  upgrade simulation restores the workspace byte-for-byte.
- Commands/procedure:
  - `pnpm typecheck:pkg-005` -> exit `0`;
  - `bun scripts/check-pkg-005.ts --artifact-root
    .omx/artifacts/typescript-bun/PKG-005/pkg-005-checker-root-20260807-101`
    -> exit `0`;
  - live plan-check -> exit `0`, 133 tasks, 72 links, zero errors;
  - coverage ledger -> exit `0`, 47/47 rows, zero unmapped;
  - ledger JSONL parse -> `ledger-jsonl-ok`;
  - no `pkg-005` process remains after the packaged audit.
- Accepted evidence:
  `.omx/artifacts/typescript-bun/PKG-005/pkg-005-checker-root-20260807-101/`.
- Limitations: unsigned unpacked Windows x64 evidence only; NSIS uninstall
  retention, signing, macOS, arm64, and production update behavior remain
  later Phase 08 tasks.

### PKG-006 / pkg-006-checker-root-20260807-103

- Claim: verify the Windows x64 Electron/Bun lifecycle boundary.
- Status: `DONE`
- Maker run/context ID: `pkg-006-maker-root-20260807-102` /
  `pkg-006-maker-root-context-20260807-102`
- Checker run/context ID: `pkg-006-checker-root-20260807-103` /
  `pkg-006-checker-root-context-20260807-103`
- Checker parent run ID: `pkg-006-maker-root-20260807-102`
- Checker participated in implementation: `false`
- Reviewed source-state hash: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Final source aggregate: five files, SHA-256
  `6777289da5a7748771aa81cba8895d8718f53441c30cd9a9f205a55dcf085dbc`, with
  zero mismatches after the final plan transition.
- Evidence: Bun `1.3.14`/Windows x64 builds the compiled backend, Electron
  bundle, and NSIS installer; first start and graceful quit complete;
  unexpected backend exit recovers with a new PID; forced Electron-tree
  termination releases the port and leaves no backend PID; hostile cwd input is
  ignored. User data remains outside the install root by decision.
- Limitation: the interactive renderer-crash and Provider-in-flight matrix is
  explicitly owned by installed E2E `PKG-010`; no stronger claim is made here.
- Accepted evidence:
  `.omx/artifacts/typescript-bun/PKG-006/pkg-006-checker-root-20260807-103/`.

### PKG-007 / pkg-007-checker-root-20260807-106

- Claim: enable and verify Electron fuses plus ASAR/resource integrity on the
  Windows x64 packaged path.
- Status: `DONE`
- Maker run/context ID: `pkg-007-maker-root-20260807-105` /
  `pkg-007-maker-root-context-20260807-105`
- Checker run/context ID: `pkg-007-checker-root-20260807-106` /
  `pkg-007-checker-root-context-20260807-106`
- Checker parent run ID: `pkg-007-maker-root-20260807-105`
- Checker participated in implementation: `false`
- Reviewed source-state hash: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Final source aggregate: eight files, SHA-256
  `3b685b2fa2300b9f31976fb97d685a345fcda2069ff8a8c3baa0ee315ac7f4ae`, with
  zero mismatches after the final plan transition.
- Evidence: Electron `43.2.0` fuses read as RunAsNode, NODE_OPTIONS, and CLI
  inspect disabled; cookie encryption, embedded ASAR integrity, and
  OnlyLoadAppFromAsar enabled. The hardened package launches, reaches Bun
  backend readiness, retains preload/IPC and renderer isolation, rejects a
  tampered loaded ASAR entry and invalid backend PE, and ignores hostile cwd
  preload inputs.
- Accepted evidence:
  `.omx/artifacts/typescript-bun/PKG-007/pkg-007-checker-root-20260807-106/`.

### PKG-008 / pkg-008-checker-root-20260807-108

- Role: independent Checker; distinct context
  `pkg-008-checker-root-context-20260807-108`; parent Maker
  `pkg-008-maker-root-20260807-107`; no implementation participation.
- Status: `DONE`
- Maker run/context ID: `pkg-008-maker-root-20260807-107` /
  `pkg-008-maker-root-context-20260807-107`
- Checker run/context ID: `pkg-008-checker-root-20260807-108` /
  `pkg-008-checker-root-context-20260807-108`
- Checker parent run ID: `pkg-008-maker-root-20260807-107`
- Checker participated in implementation: `false`
- Reviewed source-state hash: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Source review: recomputed the final six-file source aggregate after the
  control-plane transition at HEAD `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
  with zero mismatches:
  `606b3ca38b715f7aa6baff0d62a502232e85de65c4c0d08ba5728d28f0ad4384`.
- Verification: `pnpm typecheck:pkg-008` and the independent crash smoke exit
  `0` on Windows x64/Bun `1.3.14`. The real Electron control renderer crash
  produces one 706064-byte local minidump under `crash-dumps/reports`; runtime
  annotations contain only app/runtime versions and `session_id`; the provider
  secret and raw-content sentinel are absent; upload is disabled; and the
  diagnostics manifest references the dump by relative path/hash with
  `embedded=false`.
- Decision: `PKG-008` `VERIFY` -> `DONE`; Phase 08 is `READY`,
  `current_task=null`, and only dependency-satisfied `PKG-009` is promoted.
- Accepted evidence:
  `.omx/artifacts/typescript-bun/PKG-008/pkg-008-checker-root-20260807-108/`.
- Preservation: Python parity oracle, unrelated dirty changes, dependency
  policy, commits, pushes, deploys, and later tasks remain untouched.

### CUT-005 / cut-005-checker-root-20260808-132

- Claim: Bun `1.3.14` is the single supported package manager and root/workspace
  script caller for install, development, contracts, checks, tests,
  replay/eval/evidence, Windows x64 build/package, and audit.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity: 15-file aggregate
  `5483af572a86d7dbdc28bb3f8114f684614a9adca94d5d8fcf7a6aee0fc6abef`
- Date: `2026-08-08`
- Environment: Windows x64; Bun `1.3.14`; Electron/Node tooling remains bounded
  to the desktop workspace
- Evidence class: `static`, `unit`, `integration`, `unpacked`, `review`
- Maker run/context ID: `cut-005-maker-root-20260808-131` /
  `cut-005-maker-root-context-20260808-131`
- Checker run/context ID: `cut-005-checker-root-20260808-132` /
  `cut-005-checker-root-context-20260808-132`
- Checker parent run ID: `cut-005-maker-root-20260808-131`
- Checker participated in implementation: `false`
- Reviewed source-state hash:
  `sha256:5483af572a86d7dbdc28bb3f8114f684614a9adca94d5d8fcf7a6aee0fc6abef`
- Commands/procedure:
  - frozen Bun install -> exit `0`; no lock or install changes
  - strict CUT-005 checker -> exit `0`; 15 criteria, zero forbidden active
    package-script invocations
  - independent 15-file identity recomputation -> zero Maker mismatches
  - workspace TypeScript, contract drift, lint, format, and audit -> exit `0`
  - root unit/integration command -> exit `0`; 5 lifecycle, 239 backend, and
    42 desktop tests
  - replay, eval, evidence, and recorded E2E commands -> exit `0`
  - Windows x64 compile, desktop build, and electron-builder unpacked package
    command -> exit `0`
- Artifact:
  - `.omx/artifacts/typescript-bun/CUT-005/cut-005-checker-root-20260808-132/result.json`
    (`sha256:4c5d357e2832280da0a5e358915a5a6f72a3e3abc6497bc0d7a5e003f11193b0`,
    4650 bytes)
- Accepted assertions:
  - `packageManager` and the Bun engine are pinned to `bun@1.3.14` / `1.3.14`
  - active root/workspace package scripts invoke no pnpm, uv, Python, npm, npx,
    yarn, or pip command
  - desktop Node execution is limited to Electron tooling and does not create a
    second package-manager policy
  - root development launches Electron through Bun, and Electron continues to
    supervise the Bun backend process
  - `minimumReleaseAge: 0` explicitly disables pnpm's dependency-age policy
  - the original three composition roots remain enforced while already accepted
    operational source areas are recognized by the boundary checker
- Limitations:
  - current release scope is Windows x64 only
  - CI, scheduled/hidden automation, and helper paths remain owned by CUT-006
  - legacy pnpm compatibility artifacts remain tracked for later cleanup
  - Python remains the parity oracle and was not removed
- Related run log: `cut-005-checker-root-20260808-132`

### CUT-006 / cut-006-checker-root-20260808-134

- Claim: the complete active CI and automation surface uses Bun setup/frozen
  install, TypeScript contract/lifecycle/evidence helpers, Bun backend build,
  test/package matrices, and hash-bound Windows x64 artifact manifests without
  active Python, uv, pip, or pnpm workflow setup/invocation.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity: 14-file aggregate
  `1a14f9bafc87e9d82fd3acfc0f683cc17c67473c8930e7a821d67898c6afee37`
- Date: `2026-08-08`
- Environment: Windows x64; Bun `1.3.14`; workflow Node `24.18.0`; local
  Playwright Node boundary `v22.23.1`; Electron embedded Node `24.3.0`
- Evidence class: `static`, `integration`, `recorded`, `unpacked`, `review`
- Maker run/context ID: `cut-006-maker-root-20260808-133` /
  `cut-006-maker-root-context-20260808-133`
- Checker run/context ID: `cut-006-checker-root-20260808-134` /
  `cut-006-checker-root-context-20260808-134`
- Checker parent run ID: `cut-006-maker-root-20260808-133`
- Checker participated in implementation: `false`
- Reviewed source-state hash:
  `sha256:1a14f9bafc87e9d82fd3acfc0f683cc17c67473c8930e7a821d67898c6afee37`
- Commands/procedure:
  - frozen Bun install, contract drift, strict focused TypeScript, TST-012,
    and audit -> exit `0`
  - focused CUT-006 gate -> one workflow, seven active helpers, zero legacy
    invocation hits
  - independent 14-file identity recomputation -> zero Maker mismatches
  - full Windows x64 TST-008 -> source full-pipeline and compiled lifecycle
    scenarios pass with barrage, overlay coverage where required, zero fatal
    diagnostics, clean stop, port release, and temporary-directory cleanup
  - Bun backend compile and electron-builder unpacked package -> exit `0`
  - five-file package manifest -> compiled/packaged backend identity preserved
  - Authenticode and orphan audit -> all inspected executables unsigned; zero
    port 8765 listeners and zero candidate Electron/Bun orphans
- Artifacts:
  - `.omx/artifacts/typescript-bun/CUT-006/cut-006-checker-root-20260808-134/result.json`
    (`sha256:e7376f3c603fc8abb15176350eb4957bd25961480e52b137bc921a911ac96ce8`,
    3567 bytes)
  - `.omx/artifacts/typescript-bun/CUT-006/cut-006-checker-root-20260808-134/package-manifest/artifact-manifest.json`
    (`sha256:3584a7b902cbdde6b9e5026635296e066acc125fc12cfff4b2c13c1e389b90cc`,
    1501 bytes)
  - `.omx/artifacts/test-results/tst-008/manifest.json`
    (`sha256:356b2ad5de8007d6eea95bf5c95a13fe21af1a52ea7f4d4e8f6986fb7bdf928c`,
    1225 bytes)
  - `.omx/artifacts/test-results/tst-008/suite.json`
    (`sha256:609c0bc09c1deb20f1686cd1d67800b839401dfac6723841ae3a4574f7e7c603`,
    3540 bytes)
- Accepted assertions:
  - inventory covers the only active workflow and all active helper paths;
    no separate scheduled, release, reusable-action, or hidden executable
    project automation exists
  - Bun owns package-manager and backend execution; Node owns only the bounded
    Electron/Playwright tool boundary
  - Python parity/oracle source remains present but is absent from active CI
  - the Windows x64 manifest binds current HEAD, runtime identity, hashes,
    sizes, and compiled/package backend byte identity
  - `minimumReleaseAge: 0` remains explicit and no exception list exists
- Limitations:
  - GitHub-hosted workflow was not run because no push was authorized
  - Windows x64 is the only release/support claim; Ubuntu quality/unit runner
    execution is not a Linux product claim
  - artifacts are unsigned and unpublished
  - Python remains the parity oracle and was not removed
- Related run log: `cut-006-checker-root-20260808-134`

### PKG-012 / pkg-012-checker-root-20260808-118

- Claim: design and independently review a signed-update, staged rollout,
  incident stop, and database-safe rollback policy without enabling production
  updates or release authority.
- Status: `DONE`
- Maker run/context ID: `pkg-012-maker-root-20260808-117` /
  `pkg-012-maker-root-context-20260808-117`
- Checker run/context ID: `pkg-012-checker-root-20260808-118` /
  `pkg-012-checker-root-context-20260808-118`
- Checker parent run ID: `pkg-012-maker-root-20260808-117`
- Checker participated in implementation: `false`
- Reviewed source-state hash: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Final source aggregate: four files, SHA-256
  `564675fc2afdc78c1f4373659a45bf0ea677f9ec5eb5a0c0f3bfef81fb3babd9`, with
  zero Maker/Checker mismatches.
- Verification:
  - `pnpm run typecheck:pkg-012` -> exit `0`
  - focused PKG-012 checker -> exit `0`, 25 required clauses, zero failures,
    zero active updater markers
  - targeted `oxfmt --check` -> exit `0`
- Accepted assertions: the runbook covers signing identity, secret custody,
  least-privilege CI, immutable artifact promotion, update metadata/channels,
  atomic desktop/backend compatibility, staged rollout, database-compatible
  rollback, incident stop control, and pre-publish evidence. It retains the
  authorized Windows x64-only scope and the Python parity oracle.
- Inertness proof: no updater dependency or product marker, feed/publish
  configuration, signing credential, CI write authority, package-target change,
  signature, notarization, publish, deploy, runtime change, or database action
  was introduced.
- Decision: `PKG-012` `VERIFY` -> `DONE`; Phase 08 is `READY`,
  `current_task=null`, and only dependency-satisfied `GATE-08` is promoted.
- Accepted evidence:
  `.omx/artifacts/typescript-bun/PKG-012/pkg-012-checker-root-20260808-118/`.

### GATE-08 / gate-08-checker-root-20260808-120

- Claim: independently accept the Phase 08 package/security exit against its
  exact 13-criterion checklist and external platform condition without
  repeating already accepted task-level heavy proof.
- Status: `DONE`
- Maker run/context ID: `gate-08-maker-root-20260808-119` /
  `gate-08-maker-root-context-20260808-119`
- Checker run/context ID: `gate-08-checker-root-20260808-120` /
  `gate-08-checker-root-context-20260808-120`
- Checker parent run ID: `gate-08-maker-root-20260808-119`
- Checker participated in implementation: `false`
- Reviewed source-state hash: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Final source aggregate: four files, SHA-256
  `eba86b35161582e3771074b7a8d8e0ed52a942535b1439a7df6ac82974a590a5`, with
  zero Maker/Checker mismatches.
- Environment/evidence class: Windows x64, Bun `1.3.14`, accepted phase-evidence
  aggregate over 12 independently accepted PKG Checker artifacts.
- Verification:
  - `pnpm run typecheck:gate-08` -> exit `0`
  - focused Gate audit -> exit `0`, 13/13 criteria, 12 accepted artifacts,
    zero identity mismatches, zero failures
  - targeted `oxfmt --check` -> exit `0`
  - source identity comparison -> exit `0`
- Accepted assertions: deterministic compile/autoload isolation, packaged
  assets, installed paths and lifecycle cleanup, Electron fuses/integrity,
  bounded crash evidence, security/SBOM reports, and the installed Windows
  pipeline retain accepted evidence. `PKG-011` satisfies only the exact
  authorized Windows-only external condition; `PKG-012` remains inert.
- Semantic drift decision: the Gate command registration changes the whole-file
  `package.json` hash, but the exact Windows x64 package command is unchanged
  and no updater dependency, macOS target invocation, signing, publish, or
  deployment authority is enabled. Every other PKG-011/012 reviewed file
  remains byte-identical.
- Limitations: current release proof is Windows x64 only; the artifact remains
  unsigned; automatic updates are disabled; macOS proof is not claimed; Python
  remains the local parity oracle for Phase 09 rollback.
- Decision: `GATE-08` `VERIFY` -> `DONE`; Phase 08 is `DONE`; Phase 09 and only
  dependency-satisfied `CUT-001` are promoted to `READY`.
- Accepted evidence:
  `.omx/artifacts/typescript-bun/GATE-08/gate-08-checker-root-20260808-120/`.

### PKG-011 / pkg-011-limitation-checker-root-20260808-116 / accepted limitation

- Status: `ACCEPTED_LIMITATION`
- Missing proof: macOS arm64/x64 installed lifecycle, native media behavior,
  signing, and notarization.
- Blocking authority/environment: no macOS hardware/runner, Xcode CLI,
  Developer ID, or notarization authority is available in the Windows x64
  worktree.
- Release claim removed or narrowed: current release and support scope is
  Windows x64 only; Windows arm64, macOS arm64, and macOS x64 are not released
  or supported.
- Authorized by: human user.
- Authorization reference/date: explicit selection and confirmation
  `Windows-only 限制授权`, 2026-08-08.
- Revisit owner and trigger: the future macOS release owner must replace this
  limitation with independently accepted installed-platform evidence before
  any macOS release candidate, download, signing, notarization, support
  statement, or public availability.
- Available lower-class evidence: the earlier Windows-host cross-build and
  platform-availability record at
  `.omx/artifacts/typescript-bun/PKG-011/pkg-011-checker-root-20260807-114/`;
  it is not installed macOS proof.
- Maker run/context ID: `pkg-011-limitation-maker-root-20260808-115` /
  `pkg-011-limitation-maker-root-context-20260808-115`
- Checker run/context ID: `pkg-011-limitation-checker-root-20260808-116` /
  `pkg-011-limitation-checker-root-context-20260808-116`
- Checker parent run ID: `pkg-011-limitation-maker-root-20260808-115`
- Checker participated in implementation: `false`
- Reviewed source-state hash: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Final source aggregate: ten files, SHA-256
  `067735bc9fd3e5ae3c82bec633bbcc2ff92eb57d3c6694f7a9e6ecfef9f062f9`, with
  zero mismatches.
- Commands/procedure:
  - `pnpm run typecheck:pkg-011` -> exit `0`
  - focused accepted-limitation checker -> exit `0`,
    `status=accepted_limitation`, zero failures
  - release-facing superseded-claim scan -> clean
- Accepted assertions: authorization, narrowed claim, unsupported targets,
  revisit owner/trigger, Windows x64 release command, downstream release-doc
  alignment, and dormant-only macOS builder configuration are explicit.
- Downstream gates explicitly permitting this status: only the `GATE-08` /
  `PKG-011` external-condition row; no other correctness, data, security, or
  platform claim is waived.
- Limitations: this record prevents the missing macOS proof from being called
  `DONE`; it does not prove macOS support.
- Accepted evidence:
  `.omx/artifacts/typescript-bun/PKG-011/pkg-011-limitation-checker-root-20260808-116/`.

### PKG-010 / pkg-010-checker-root-20260807-112

- Claim: independently accept the installed Windows x64 Electron/Bun recorded
  pipeline and bounded diagnostics bundle.
- Status: `DONE`
- Maker run/context ID: `pkg-010-maker-root-20260807-111` /
  `pkg-010-maker-root-context-20260807-111`
- Checker run/context ID: `pkg-010-checker-root-20260807-112` /
  `pkg-010-checker-root-context-20260807-112`
- Checker parent run ID: `pkg-010-maker-root-20260807-111`
- Checker participated in implementation: `false`
- Reviewed source-state hash: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Final source aggregate: five files, SHA-256
  `7cf7ccbc7ab66f2b6a17a9ae031f442c382e96a22eae2888fd2d1c1ab6c983d5`, with
  zero mismatches after the control-plane transition.
- Verification: `pnpm typecheck:pkg-010` and the independent checker exit `0`
  on Windows x64/Bun `1.3.14`. The real NSIS install launches the packaged
  Electron app and supervised Bun backend, proves the ready/version handshake,
  Session start, recorded text/frame/microphone/system-audio/voice-activity
  flow, overlay rendering, redacted diagnostics manifest, clean stop, restart,
  uninstall, artifact hashes, retained user-data path, and zero Electron/Bun
  orphans.
- Decision: `PKG-010` `VERIFY` -> `DONE`; Phase 08 is `READY`,
  `current_task=null`, and only dependency-satisfied `PKG-011` is promoted.
- Accepted evidence:
  `.omx/artifacts/typescript-bun/PKG-010/pkg-010-checker-root-20260807-112/`.
- Preservation: Python parity oracle, unrelated dirty changes, dependency
  policy, commits, pushes, deploys, and later tasks remain untouched.

### PKG-009 / pkg-009-checker-root-20260807-110

- Claim: produce and independently review the Phase 08 security, license, SBOM,
  lifecycle, generated-output, and artifact-manifest reports.
- Status: `DONE`
- Maker run/context ID: `pkg-009-maker-root-20260807-109` /
  `pkg-009-maker-root-context-20260807-109`
- Checker run/context ID: `pkg-009-checker-root-20260807-110` /
  `pkg-009-checker-root-context-20260807-110`
- Checker parent run ID: `pkg-009-maker-root-20260807-109`
- Checker participated in implementation: `false`
- Reviewed source-state hash: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Final source aggregate: four files, SHA-256
  `32fd4489bd63c81f83a07be3d2ce896714b7f401861455c0d14dffacc5381b10`, zero
  mismatches after the control-plane transition.
- Verification: `pnpm typecheck:pkg-009` and the independent checker exit `0`
  on Windows x64/Bun `1.3.14`. The high-confidence scanner covers 3494 text
  files with zero findings; `bun audit --json` is empty; the exact installed
  license inventory has 564 components with zero direct-policy failures; the
  CycloneDX 1.5 SBOM, lifecycle/trusted-build review, generated/source-map
  review, and unsigned hash-bound artifact manifest all pass.
- Decision: `PKG-009` `VERIFY` -> `DONE`; Phase 08 is `READY`,
  `current_task=null`, and only dependency-satisfied `PKG-010` is promoted.
- Accepted evidence:
  `.omx/artifacts/typescript-bun/PKG-009/pkg-009-checker-root-20260807-110/`.

#### PKG-011 / pkg-011-checker-root-20260807-114 / historical blocked record

This retained record documents the earlier blocker diagnosis. It is not an
accepted task/gate record and does not satisfy PKG-011 or any dependency.

- Role: independent Checker; distinct context
  `pkg-011-checker-root-context-20260807-114`; parent Maker
  `pkg-011-maker-root-20260807-113`; no implementation participation.
- Status: `BLOCKED`
- Maker run/context ID: `pkg-011-maker-root-20260807-113` /
  `pkg-011-maker-root-context-20260807-113`
- Checker run/context ID: `pkg-011-checker-root-20260807-114` /
  `pkg-011-checker-root-context-20260807-114`
- Checker parent run ID: `pkg-011-maker-root-20260807-113`
- Checker participated in implementation: `false`
- Reviewed source-state hash: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Final source aggregate: four files, SHA-256
  `a136bd7ab685106f6a53e6c67c162a86b277cddcac403b96c705a60da280fdfd`, with
  zero mismatches after the control-plane transition.
- Verification: `pnpm run typecheck:pkg-011` and the independent PKG-011
  checker exit `0`, with deterministic result status `blocked`. The Windows
  x64 host has no macOS runner in the workflow, no `xcodebuild`/`codesign`, no
  macOS hardware, and no Developer ID/notarization authority. Bun Darwin
  arm64/x64 target extraction fails and electron-builder records that macOS
  builds are supported only on macOS. Cross-build diagnostics are retained as
  separate evidence and do not substitute for installed proof.
- Release boundary: Windows x64 remains the only proven release claim;
  macOS installed lifecycle, native media behavior, signing, and notarization
  are not claimed. `ACCEPTED_LIMITATION` was not authorized.
- Decision: `PKG-011` `VERIFY` -> `BLOCKED`; Phase 08 remains blocked,
  `current_task=PKG-011`, `next_task=null`, `same_blocker_attempts=1`, and
  `PKG-012` is not promoted.
- Blocker evidence:
  `.omx/artifacts/typescript-bun/PKG-011/pkg-011-checker-root-20260807-114/`.
- Preservation: Python parity oracle, unrelated dirty changes, dependency
  policy, commits, pushes, deploys, and later tasks remain untouched.

### CUT-007 / cut-007-checker-root-20260808-136

- Claim: align all current-state repository, application, architecture,
  backend, product, protocol, real-pipeline, and operations documentation with
  the implemented TypeScript + Bun product while preserving historical records.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity:
  `f99bb85e79c3e4b6428b10323246e5510745a90c64f9eabac9475ae1637d2060`
- Date: 2026-08-08
- Environment: Windows x64; Bun `1.3.14`; branch `TS_backend_refactor`
- Evidence class: `static`, `review`
- Maker: root
- Maker run/context ID: `cut-007-maker-root-20260808-135` /
  `cut-007-maker-root-context-20260808-135`
- Checker: root independent run/context
- Checker run/context ID: `cut-007-checker-root-20260808-136` /
  `cut-007-checker-root-context-20260808-136`
- Checker parent run ID: `cut-007-maker-root-20260808-135`
- Checker participated in implementation: `false`
- Reviewed source-state hash: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Commands/procedure:
  - `bun run typecheck:cut-007` -> exit `0`
  - `bun scripts/check-cut-007.ts --artifact-root .omx/artifacts/typescript-bun/CUT-007/cut-007-checker-root-20260808-136` -> exit `0`
  - targeted Oxfmt check -> exit `0`
  - scoped `git diff --check` -> exit `0`
  - Maker/Checker source identity comparison -> 24 files, zero mismatches
- Artifacts:
  - `.omx/artifacts/typescript-bun/CUT-007/cut-007-checker-root-20260808-136/result.json`
    (`sha256:1ec3b314c718a2e4193df54f9ac263db07e70eca94e0fa9a646b9d43690f6781`,
    5209 bytes)
- Accepted assertions:
  - 16 current documents describe the Electron-supervised Bun/Elysia backend,
    authenticated protocols, Windows x64 operations/release, and clean lifecycle.
  - Five retained Python/Viewer design documents are explicitly historical,
    superseded, or parity-only.
  - Active docs contain zero legacy package/runtime commands, stale backend
    authority, stale positive Director semantics, or broken local links.
  - D-004, D-011, D-018, and D-027 are superseded; D-045, D-046, and D-047
    are accepted.
  - The Python parity oracle remains present and was not modified or removed by
    CUT-007.
- Limitations:
  - Windows x64 is the only release/support claim; local artifacts are unsigned
    and unpublished.
  - This documentation acceptance does not authorize CUT-008 deletion work.
- Related run log:
  - `cut-007-checker-root-20260808-136`

### CUT-008 / cut-008-checker-root-20260808-141

- Claim: remove the authorized Python parity backend source, Python-only tests,
  scripts, and desktop supervisor adapter while retaining language-neutral
  assets, accepted evidence, rollback material, and CUT-009 holds.
- Status: `DONE`
- Commit: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Dirty diff identity:
  `f4a5e94e69b144c0d4be55dda15f574a2b03cb961b860678cedfafaaf8ee4f65`
- Date: 2026-08-08
- Environment: Windows x64; Bun `1.3.14`; branch `TS_backend_refactor`
- Evidence class: `static`, `unit`, `review`
- Maker: root
- Maker run/context ID: `cut-008-maker-root-20260808-140` /
  `cut-008-maker-root-context-20260808-140`
- Checker: root independent run/context
- Checker run/context ID: `cut-008-checker-root-20260808-141` /
  `cut-008-checker-root-context-20260808-141`
- Checker parent run ID: `cut-008-maker-root-20260808-140`
- Checker participated in implementation: `false`
- Reviewed source-state hash: `41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Commands/procedure:
  - `bun run typecheck:cut-008` -> exit `0`
  - focused CUT-008 deletion checker -> exit `0`
  - `bun run typecheck` -> exit `0`
  - supported desktop process Vitest -> exit `0`; 17 tests passed
  - Maker/Checker source identity comparison -> 12 files, zero mismatches
  - live plan validation and port/process audit -> exit `0`; no listener or
    repository backend process remained
- Artifacts:
  - `.omx/artifacts/typescript-bun/CUT-008/cut-008-checker-root-20260808-141/result.json`
    (`sha256:88dee1d957670ff382922c7cdd8896527cdfde1708381174b2a8691295b75285`,
    3445 bytes)
- Accepted assertions:
  - all 149 hash-bound tracked candidates and six authorized worktree-only
    candidates are absent;
  - all 11 CUT-009 toolchain/migration holds remain;
  - TST-002 accounts for all 14 removed current Python test modules through 47
    behavior rows with zero unmapped, missing, or stale modules;
  - Electron Main no longer constructs the Python supervisor adapter;
  - room-6657 language-neutral JSON assets retain their hashes under
    `resources/audience-presets/room-6657`;
  - rollback remains `TS_backend_refactor` plus accepted CUT-003
    restore-from-backup evidence.
- Limitations:
  - Windows x64 only; unsigned, unpublished, and undeployed;
  - macOS unproven; CUT-012 clean-clone verification pending;
  - CUT-009 toolchain removal and CUT-010 shim cleanup remain separate tasks.
- Related run log:
  - `cut-008-checker-root-20260808-141`

#### Exact commit binding / cut-008-commit-checker-root-20260808-143

- Status: `DONE`; exact-commit acceptance revalidated
- Accepted checkpoint commit:
  `97c81436dcb6df3b30709f6380ddad35b46ac892`
- Accepted tree: `a89c123bb3bb8d3a1c8906fe6b971d3e2815b901`
- Upstream ref: `origin/TS_backend_refactor` at the same commit
- Checkpoint Maker run/context ID:
  `cut-008-checkpoint-maker-root-20260808-142` /
  `cut-008-checkpoint-maker-root-context-20260808-142`
- Independent Checker run/context ID:
  `cut-008-commit-checker-root-20260808-143` /
  `cut-008-commit-checker-root-context-20260808-143`
- Checker participated in implementation or staging: `false`
- Commit ownership audit:
  - 608 changed paths;
  - zero `.omx`, `output`, or `promo` paths;
  - zero sensitive path names and zero common credential signatures;
  - tracked worktree diff from the checked commit: zero.
- Commands/procedure:
  - `bun run typecheck` -> exit `0`
  - `bun run check:cut-008` -> exit `0`; 149 tracked and six
    worktree-only candidates absent, 11 CUT-009 holds present
  - supported desktop process Vitest -> exit `0`; 17 tests passed
  - commit whitespace validation -> exit `0`
  - `bun run migration:plan-check` -> exit `0`; 133 tasks, 72 links,
    126 accepted evidence records, zero errors
  - port/process audit -> zero port 8765 listeners and zero repository
    Bun/Electron processes
- Artifact:
  `.omx/artifacts/typescript-bun/CUT-008/cut-008-commit-checker-root-20260808-143/result.json`
  (`sha256:df77152f0dc522d01c6aad392992fb9b5fbc31a68fa10a29bb24eaf6362286f6`,
  1733 bytes)
- Decision: the prior dirty-diff acceptance is now bound to the exact pushed
  checkpoint commit. `CUT-008` remains `DONE`; `CUT-009` remains the sole next
  task.
- Limitations: Windows x64 only; unsigned, unpublished, undeployed; macOS
  unproven; CUT-012 clean-clone verification pending.
- Related run logs:
  - `cut-008-checkpoint-maker-root-20260808-142`
  - `cut-008-commit-checker-root-20260808-143`

### CUT-009 / cut-009-commit-checker-root-20260808-145

- Claim: remove the active Python packaging/test/lint lock boundary, Alembic
  runtime and revisions, Python-specific ignores, CI setup/caches, and stale
  developer instructions while preserving represented schema/rollback history
  and the later CUT-010 shim boundary.
- Status: `DONE`
- Accepted commit: `3ff566d6fe8eb3eb6d025da3e08fd8d08e7cdec0`
- Accepted tree: `ee8d7a8b877675d345191ab34c483a83a1d9de5f`
- Date: 2026-08-08
- Environment: Windows x64; Bun `1.3.14`; branch `TS_backend_refactor`
- Evidence class: `static`, `unit`, `review`
- Maker: root
- Maker run/context ID: `cut-009-maker-root-20260808-144` /
  `cut-009-maker-root-context-20260808-144`
- Checker: root independent run/context
- Checker run/context ID:
  `cut-009-commit-checker-root-20260808-145` /
  `cut-009-commit-checker-root-context-20260808-145`
- Checker parent run ID: `cut-009-maker-root-20260808-144`
- Checker participated in implementation: `false`
- Checker participated in staging: `false`
- Reviewed source-state hash: `3ff566d6fe8eb3eb6d025da3e08fd8d08e7cdec0`
- Upstream identity: `origin/TS_backend_refactor` resolved to the accepted
  commit before verification.
- Source identity:
  `2844cd1a124ed49c39f1463965ae679341211301574aa6af345489d915f4612c`
  across 26 files; Maker/Checker mismatch count: zero.
- Commands/procedure:
  - `bun run typecheck` -> exit `0`
  - strict CUT-009 TypeScript and focused checker -> exit `0`
  - targeted Oxfmt check -> exit `0`
  - `bun test .../migration-runner.test.ts` -> exit `0`; five tests passed
  - commit whitespace and ownership checks -> exit `0`; 26 changed paths,
    zero prohibited/cache paths, zero tracked worktree diff
  - `bun run migration:plan-check` -> exit `0`; 133 tasks, 72 links,
    126 pre-acceptance evidence records, zero errors
- Accepted assertions:
  - all 11 accepted Python toolchain/Alembic paths are absent;
  - `apps/backend/README.md` is the only tracked file under `apps/backend`;
  - Python-specific root ignores, active package commands, CI setup/caches,
    tracked editor tasks, and stale active developer instructions are absent;
  - 10 Bun/schema/rollback history paths and four CUT-010 shims remain;
  - automatic CI triggers are disabled; the workflow is manual-only until
    migration completion under explicit human direction.
- Artifact:
  `.omx/artifacts/typescript-bun/CUT-009/cut-009-commit-checker-root-20260808-145/result.json`
  (`sha256:4ce778c9f7257cc9c73f38839c4d94efdc0eadc05dbb8b41356c4061fc8248bd`,
  7900 bytes)
- Adjacent finding: the legacy migration suite still has three failures because
  its CUT-010-owned compatibility shim invokes Python removed by CUT-008. The
  failure is recorded for the now-READY CUT-010 task and is not used as CUT-009
  proof.
- Limitations: Windows x64 only; unsigned, unpublished, undeployed; macOS
  unproven; CUT-012 clean-clone verification pending.
- Next task: `CUT-010`
