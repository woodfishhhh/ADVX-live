# Migration Blocker Ledger

> Mode: append-only attempts, mutable current-status summary
>
> Current blockers: none

## Purpose

`STATE.md` lists only active blocker IDs. This file preserves the diagnosis,
bounded attempts, artifacts, and recovery decision without bloating the current
loop cursor.

A risk, open decision, missing nice-to-have tool, or unexecuted future platform
test is not yet a blocker. A blocker exists when a `READY` or `IN_PROGRESS`
task cannot satisfy its acceptance criteria with the current authority,
environment, dependencies, or implementation path.

## Attempt Policy

- Maximum consecutive attempts with the same error signature: three.
- Every attempt must change a hypothesis, diagnostic, input, or recovery action.
- Blind reruns do not count as progress.
- After attempt three, mark the task `BLOCKED`, preserve artifacts, and stop.
- Resume only when new evidence, authority, environment, or a plan decision
  changes the blocker.
- Do not weaken a gate, delete a test, or relabel missing live/platform proof.

## Blocker Record

```md
## <blocker-id> - <task-id> - <short title>

- Status: `ACTIVE | RESOLVED | DEFERRED | ACCEPTED_LIMITATION`
- First seen:
- Last updated:
- Owner:
- Task claim blocked:
- Error signature:
- Environment:
- Why this is a blocker:
- Attempts:
  1. `<hypothesis/action/result/artifact>`
  2. `<hypothesis/action/result/artifact>`
  3. `<hypothesis/action/result/artifact>`
- Security/data impact:
- Current evidence:
  - ...
- Resolution condition:
- Recovery task or decision:
- Accepted limitation authority/scope/expiry:
- Resolved by run:
- Residual limitation:
```

Never include credentials, private recordings, raw screenshots, or secret
values in a blocker record.

## Active Blockers

None.

## Resolved Blockers

## `CUT-008-HUMAN-DELETION-GATE` - `CUT-008` - Python deletion authorization missing

- Status: `RESOLVED`
- First seen: 2026-08-08
- Last updated: 2026-08-08
- Owner: `cut-008-recovery-maker-root-20260808-139`
- Task claim blocked: `CUT-008` cannot remove the Python backend source, tests,
  launch adapters, contract exporter, or packaging artifacts before the
  explicit human deletion gate.
- Error signature: `CUT008_HUMAN_DELETION_GATE_AUTHORIZATION_MISSING`
- Environment: `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  dirty Windows x64 worktree; Bun `1.3.14`.
- Why this is a blocker: Phase 09 requires an authorized human to state that
  the Python parity oracle may be deleted, bind accepted evidence to a commit,
  name the post-deletion rollback path, and list known release limitations.
  That authority was missing through blocker attempt 3. A later explicit human
  instruction supplied all four statements and locally overrode the earlier
  oracle-preservation constraint for CUT-008 only.
- Attempts:
  1. Readiness Maker `cut-008-readiness-maker-root-20260808-137` generated a
     non-destructive, hash-bound inventory: 149 tracked CUT-008 candidates,
     six worktree-only ownership-review files, 11 CUT-009 holds, four retained
     language-neutral assets, and complete TST-002 mapping for 14 current test
     modules. The gate remains unsatisfied. Evidence:
     `.omx/artifacts/typescript-bun/CUT-008/cut-008-readiness-maker-root-20260808-137/readiness.json`.
  2. The next continuation supplied the exact four-part authorization template,
     prefilled with the accepted HEAD, CUT-003 restore-from-backup procedure,
     Windows-only limitation, unsigned/unpublished state, macOS limitation, and
     pending CUT-012 clean-clone proof. No authorization was returned; inferred
     continuation still cannot satisfy a human gate.
  3. Blocker auditor `cut-008-blocker-audit-root-20260808-138` re-read STATE,
     Phase 09, the durable ledger, and current authority. No human statement or
     gate-changing plan decision exists, and all non-destructive readiness work
     is already complete. It preserved a machine-readable blocked result and
     stopped rather than rerun or delete protected files. Evidence:
     `.omx/artifacts/typescript-bun/CUT-008/cut-008-blocker-audit-root-20260808-138/result.json`.
- Security/data impact: no Python, data, fixture, credential, evidence, or
  rollback asset was removed; release scope remains Windows x64 only.
- Current evidence:
  - `.omx/artifacts/typescript-bun/CUT-008/cut-008-readiness-maker-root-20260808-137/readiness.json`
  - `.omx/artifacts/typescript-bun/CUT-008/cut-008-blocker-audit-root-20260808-138/result.json`
  - `.omx/artifacts/typescript-bun/CUT-003/cut-003-checker-root-20260808-128/`
  - `docs/migrations/typescript-bun/10-CUTOVER-CLEANUP.md`
  - `docs/migrations/typescript-bun/CUT-008-PYTHON-DELETION-AUTHORIZATION.md`
  - `docs/migrations/typescript-bun/PKG-011-MACOS-LIMITATION-DECISION.md`
- Resolution condition: satisfied by the explicit four-part human statement
  recorded in `CUT-008-PYTHON-DELETION-AUTHORIZATION.md`.
- Recovery task or decision: after authorization, a new CUT-008 Maker must
  confirm ownership of worktree-only candidates, execute only the task-owned
  deletion, repair direct references, and stop at `VERIFY` for a distinct
  Checker.
- Accepted limitation authority/scope/expiry: Windows x64 only; unsigned,
  unpublished, and undeployed; macOS unproven; CUT-012 clean-clone verification
  pending. This does not widen release scope.
- Resolved by run: `cut-008-recovery-maker-root-20260808-139`.
- Residual limitation: rollback after deletion depends on branch
  `TS_backend_refactor` plus accepted CUT-003 restore-from-backup evidence.

## `DES-007-RECONNECT-HANDSHAKE-DEDUPE` - `DES-007` - reconnect handshake dedupe gate

- Status: `RESOLVED`
- First seen: 2026-08-05
- Last updated: 2026-08-05
- Owner: `des-007-checker-root-20260805-014`
- Task claim blocked: DES-007 must preserve an authenticated, reconnect-safe
  realtime handshake while normalizing Bun and Python event wires.
- Error signature: `DES007_RECONNECT_BACKEND_READY_DEDUPED_BEFORE_HANDSHAKE`
- Environment: `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  dirty worktree; Bun `1.3.14`; host Node `22.23.1` with the expected engine
  warning.
- Why this was a blocker: `backend-realtime-adapter.ts` retained message
  identities across a reconnect when the supervised `backendStartId` is
  unchanged. `backend-client.ts` initially applied the duplicate gate before
  the `backend.ready` branch. A repeated handshake could therefore be
  discarded before `connectPromise` resolved, causing the ready backend to time
  out.
- Attempts:
  1. DES-007 Maker implemented the realtime compatibility boundary and passed
     all bounded runtime, type, protocol, plan, manifest, and diff checks; the
     independent Checker then reproduced the deterministic ordering failure.
     Evidence:
     `.omx/artifacts/typescript-bun/DES-007/des-007-checker-root-20260805-012/`.
  2. Recovery Maker `des-007-recovery-maker-root-20260805-013` moved the
     validated `backend.ready` branch before duplicate filtering. The probe now
     reports `backend_ready_gate_line=937`, `duplicate_gate_line=947`, and
     `duplicate_gate_precedes_ready=False`; all bounded regression checks pass.
     Evidence:
     `.omx/artifacts/typescript-bun/DES-007/des-007-recovery-maker-root-20260805-013/`.
- Security/data impact: no secrets, user data, Python oracle, dependencies,
  lockfiles, `output/`, or `promo/` content changed.
- Current evidence:
  - `.omx/artifacts/typescript-bun/DES-007/des-007-maker-root-20260805-011/`
  - `.omx/artifacts/typescript-bun/DES-007/des-007-checker-root-20260805-012/`
  - `.omx/artifacts/typescript-bun/DES-007/des-007-recovery-maker-root-20260805-013/`
  - `.omx/artifacts/typescript-bun/DES-007/des-007-checker-root-20260805-014/`
  - `apps/desktop/src/main/backend/backend-client.ts`
  - `apps/desktop/src/main/backend/backend-realtime-adapter.ts`
- Resolution condition: satisfied by handling `backend.ready` before duplicate
  filtering, refreshing the source receipt, and obtaining fresh independent
  Checker acceptance.
- Recovery task or decision: completed by the recovery Maker; DES-008 is now
  the only promoted task.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `des-007-checker-root-20260805-014`.
- Residual limitation: none.

## Other Resolved Blockers

## `DES-006-BUN-GENERATED-TYPE-ALIAS` - `DES-006` - Bun adapter binds Python generated types

- Status: `RESOLVED`
- First seen: 2026-08-05
- Last updated: 2026-08-05
- Owner: `des-006-checker-root-20260805-010`
- Task claim blocked: DES-006 must provide a Bun generated OpenAPI control
  client behind the shared desktop-facing adapter.
- Error signature: `DES006_BUN_ADAPTER_IMPORTS_PYTHON_OPERATION_MAP`
- Environment: `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  dirty worktree; Bun `1.3.14`; host Node `22.23.1` with the expected engine
  warning.
- Why this was a blocker: `backend-control-adapter.ts` initially imported
  unsuffixed `operations as BunOperations`, which mapped to the retained
  Python-derived `./openapi` output rather than the reserved Bun output.
  Consequently the Bun adapter's compile-time operation/response witness was
  bound to the wrong backend contract.
- Attempts:
  1. Distinct Checker `des-006-checker-root-20260805-008` independently matched
     all 14 Maker manifest entries and the source aggregate, reran the five
     focused adapter tests, strict desktop/contracts TypeScript, Bun OpenAPI
     snapshot, generated drift, and live plan-check. All runtime gates passed,
     but the import-boundary probe reported
     `index_unsuffixed=True`, `index_bun_alias=True`,
     `adapter_unsuffixed_import=True`, `adapter_bun_alias_import=False`.
     Evidence:
     `.omx/artifacts/typescript-bun/DES-006/des-006-checker-root-20260805-008/`.
  2. Recovery Maker `des-006-recovery-maker-root-20260805-009` changed only
     the type import to `bunOperations as BunOperations`, preserving the
     shared Python-default transport and all realtime/binary boundaries. The
     import-boundary probe now resolves the reserved Bun generated map; the
     focused regression and remaining DES-006 gates are rerun below. Evidence:
     `.omx/artifacts/typescript-bun/DES-006/des-006-recovery-maker-root-20260805-009/`.
- 3. Fresh independent Checker `des-006-checker-root-20260805-010` matched all
  14 Maker manifest entries and the nine-file source aggregate. The
  case-sensitive import-boundary probe reports
  `adapter_python_map_import=False`, `adapter_bun_map_import=True`, and a
  generated Bun operation witness. Focused adapter tests pass 5/5; strict
  desktop/contracts TypeScript, Bun OpenAPI snapshot, generated drift, live
  plan-check, and diff-check pass. Evidence:
  `.omx/artifacts/typescript-bun/DES-006/des-006-checker-root-20260805-010/`.
- Security/data impact: no secrets, user data, raw media, `output/`, or
  `promo/` content was read or changed; no Python, dependency, lock, or
  downstream task change occurred.
- Current evidence:
  - `.omx/artifacts/typescript-bun/DES-006/des-006-checker-root-20260805-010/`
  - `.omx/artifacts/typescript-bun/DES-006/des-006-recovery-maker-root-20260805-009/`
  - `packages/contracts/src/generated/index.ts`
  - `apps/desktop/src/main/backend/backend-control-adapter.ts`
- Resolution condition: satisfied by the recovery Maker import correction and
  fresh Checker `des-006-checker-root-20260805-010`.
- Recovery task or decision: completed; normal task order resumes at `DES-007`.
- Resolved by run: `des-006-checker-root-20260805-010`.
- Accepted limitation authority/scope/expiry: none.
- Residual limitation: none for this blocker; realtime WebSocket and later
  cutover concerns remain their declared DES-007+ tasks.

## `AGT-011-UNICODE-PUBLIC-EVENT-LENGTH` - `AGT-011` - public barrage schema counts UTF-16 units instead of Unicode code points

- Status: `RESOLVED`
- First seen: 2026-08-04
- Last updated: 2026-08-04
- Owner: `root`
- Task claim blocked: AGT-011 must accept the product-authoritative text after
  truncation to 160 Unicode code points and create the canonical public event.
- Error signature: `BARRAGE_PUBLIC_SCHEMA_REJECTS_160_ASTRAL_CODEPOINTS`.
- Environment: Windows, Bun `1.3.14`, branch `TS_backend_refactor`, HEAD
  `41665a96cf67eb82cbe02f83abbbe2b79b100e48`; deterministic local schema
  probe with no Provider credentials or user data.
- Why this is a blocker: AGT-004 and `model-output.ts` intentionally match the
  Python oracle by truncating text in Unicode code points. The AGT-011 public
  event then passes that text through `barrageSnapshotSchema`, whose generic
  string parser enforces `maxLength` using JavaScript UTF-16 `value.length`.
  A valid 160-code-point emoji message therefore becomes 320 code units and is
  dropped before the public room event and Viewer state commit. This directly
  contradicts the product rule that overlong model text is truncated rather
  than discarded.
- Attempts:
  1. Distinct root Checker `agt-011-checker-root-20260804-001` matched all 38
     Maker manifest entries and all six product/test source hashes. Fresh
     AGT-011 tests pass 4/33, strict TypeScript and the 79-source boundary check
     pass. A bounded canonical-schema probe supplies exactly 160 astral Unicode
     code points; `Array.from(text).length` is 160, `text.length` is 320, and
     `barrageSnapshotSchema.safeParse()` returns `success=false` with
     `Expected at most 160 characters`. Evidence:
     `.omx/artifacts/typescript-bun/AGT-011/agt-011-checker-root-20260804-001/`.
  2. Root Recovery Maker `agt-011-recovery-maker-root-20260804-001` changed
     only the canonical string runtime length semantics and one focused
     AGT-011 regression. Runtime `minLength`/`maxLength` now count Unicode code
     points while the emitted public JSON Schema retains `maxLength: 160`.
     The original rejecting probe now reports 160 code points, UTF-16 length
     320, and `success=true`; the pipeline atomically publishes the exact text.
     Focused AGT-011 tests pass 5/37, contracts tests pass 14/83, strict
     contracts/backend TypeScript and the 79-source boundary check pass. The
     blocker remains `ACTIVE` pending a distinct fresh Recovery Checker.
     Evidence:
     `.omx/artifacts/typescript-bun/AGT-011/agt-011-recovery-maker-root-20260804-001/`.
  3. Distinct root Recovery Checker
     `agt-011-recovery-checker-root-20260804-001` matched all 32 Recovery Maker
     manifest entries and the exact two-file source aggregate. Source review
     confirms runtime `minLength`/`maxLength` count Unicode code points while
     public JSON Schema retains `maxLength: 160`. A bounded probe accepts 159
     and 160 astral code points and rejects 161 at `text`; the pipeline
     regression publishes the exact 160-code-point text through its atomic
     public event. Fresh AGT-011 passes 5/37, contracts pass 14/83, strict
     contracts/backend TypeScript, the 79-source boundary check, diff hygiene,
     and live plan-check pass. Verdict: `PASS`. Evidence:
     `.omx/artifacts/typescript-bun/AGT-011/agt-011-recovery-checker-root-20260804-001/`.
- Security/data impact: none. Product impact is loss of valid emoji-containing
  public barrage at the declared absolute length boundary.
- Current evidence:
  - `.omx/artifacts/typescript-bun/AGT-011/agt-011-checker-root-20260804-001/unicode-public-event-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-011/agt-011-checker-root-20260804-001/source-inspection.json`
  - `.omx/artifacts/typescript-bun/AGT-011/agt-011-checker-root-20260804-001/candidate-verification.json`
  - `.omx/artifacts/typescript-bun/AGT-011/agt-011-recovery-checker-root-20260804-001/unicode-boundary-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-011/agt-011-recovery-checker-root-20260804-001/candidate-verification.json`
  - `.omx/artifacts/typescript-bun/AGT-011/agt-011-recovery-checker-root-20260804-001/source-inspection.json`
- Resolution condition: make the canonical barrage public-event runtime schema
  enforce 160 Unicode code points while retaining the public JSON Schema
  `maxLength: 160`, then add one focused AGT-011 regression that publishes 160
  astral code points through the atomic pipeline.
- Recovery task or decision: completed; `AGT-012` is the next single task.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `agt-011-recovery-checker-root-20260804-001`.
- Residual limitation: none for this blocker; memory/meme side effects and
  broader race proof remain their declared `AGT-012` and `AGT-013` tasks.

## `AGT-006-TIME-UNIFORM-FRAME-SAMPLING` - `AGT-006` - frame reduction is index-uniform rather than time-uniform

- Status: `RESOLVED`
- First seen: 2026-08-04
- Last updated: 2026-08-04
- Owner: `root`
- Task claim blocked: `AGT-006` requires the final bundle to reduce more than
  15 representatives uniformly across time while preserving chronological
  order and timestamps.
- Error signature: `FRAME_REDUCTION_USES_INDEX_UNIFORM_NOT_TIME_UNIFORM`.
- Environment: Windows, Bun `1.3.14`, branch `TS_backend_refactor`, HEAD
  `41665a96cf67eb82cbe02f83abbbe2b79b100e48`; deterministic synthetic frame
  timeline, no Provider credentials or user data.
- Why this is a blocker: `INV-FRAME-004`, the Phase 04 plan, and the product
  specification explicitly require time-uniform selection. The Bun reducer
  computes slots from representative array positions. An irregular candidate
  timeline therefore overrepresents dense time regions and does not satisfy
  the accepted visual context contract.
- Attempts:
  1. Distinct root Checker `agt-006-checker-root-20260804-001` matched all 35
     Maker manifest entries and the seven-file source receipt. Fresh focused
     AGT-006 and DAT-006 tests, strict TypeScript, the 74-source boundary check,
     diff hygiene, and live plan-check pass. A bounded irregular-timeline probe
     compares 15 uniform timestamp targets across seconds 0 through 119. The
     implementation selects
     `0,5,11,16,21,26,32,37,42,48,53,58,75,99,119`, with 12 selections in the
     first 60 seconds and maximum target error 35.5 seconds; nearest
     timestamp-uniform selections are
     `0,8,17,25,34,42,51,59,67,75,83,95,103,111,119`, with eight selections in
     the first 60 seconds and maximum target error 2 seconds. Evidence:
     `.omx/artifacts/typescript-bun/AGT-006/agt-006-checker-root-20260804-001/`.
  2. Root Recovery Maker `agt-006-recovery-maker-root-20260804-001` changed
     only the reducer and its focused regression. It now places targets
     uniformly across the representative timestamp span and chooses the
     nearest unused frame per target before retaining trigger frames. The
     original rejecting probe now exactly matches
     `0,8,17,25,34,42,51,59,67,75,83,95,103,111,119`; early selections are
     eight and maximum target error is 2 seconds. AGT-006 tests pass 6/48,
     strict TypeScript and the 74-source boundary check pass. Evidence:
     `.omx/artifacts/typescript-bun/AGT-006/agt-006-recovery-maker-root-20260804-001/`.
  3. Distinct root Recovery Checker
     `agt-006-recovery-checker-root-20260804-001` matched all 28 Recovery Maker
     manifest entries and both source hashes, reran the original rejecting
     probe, and reproduced AGT-006 6/48, strict TypeScript, the 74-source
     boundary check, diff hygiene, and live plan-check. The probe exactly
     matches the 15 timestamp targets with maximum error 2 seconds and no
     index-uniform bias; the existing direct-mode regression retains the old
     trigger frame, order, timestamps, and limit. Evidence:
     `.omx/artifacts/typescript-bun/AGT-006/agt-006-recovery-checker-root-20260804-001/`.
- Security/data impact: none. The impact is temporal bias in model-visible
  frame context.
- Current evidence:
  - `.omx/artifacts/typescript-bun/AGT-006/agt-006-checker-root-20260804-001/candidate-verification.json`
  - `.omx/artifacts/typescript-bun/AGT-006/agt-006-checker-root-20260804-001/time-uniform-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-006/agt-006-recovery-maker-root-20260804-001/source-receipt.json`
  - `.omx/artifacts/typescript-bun/AGT-006/agt-006-recovery-maker-root-20260804-001/rejecting-probe-after.json`
- Resolution condition: satisfied by the distinct Recovery Checker matching
  the two-file receipt and reproducing the original probe plus focused gate.
- Recovery task or decision: none; proceed to `AGT-007` only through the
  canonical cursor.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `agt-006-recovery-checker-root-20260804-001`.
- Residual limitation: none.

## `AGT-005-FINAL-VOICE-PRIORITY` - `AGT-005` - final voice does not supersede dispatched system-audio work

- Status: `RESOLVED`
- First seen: 2026-08-04
- Last updated: 2026-08-04
- Owner: `root`
- Task claim blocked: `AGT-005` requires product-authoritative priority and
  dispatched-work replacement behavior for model scheduling.
- Error signature: `FINAL_VOICE_USER_PRIORITY_COLLAPSED_WITH_SYSTEM_AUDIO`.
- Environment: Windows, Bun `1.3.14`, `p-queue@9.3.3`, branch
  `TS_backend_refactor`, HEAD
  `41665a96cf67eb82cbe02f83abbbe2b79b100e48`; deterministic local scheduler,
  no Provider credentials or user data.
- Why this is a blocker: D-043 classifies standalone system-audio final as
  priority 2, while the current product scheduler classifies user voice as
  priority 3. A newer final user voice is therefore higher-priority input and
  must supersede dispatched system-audio work. The Bun scheduler assigns both
  `final_voice` and `system_audio` priority `40`, and running work is
  superseded only when the new numeric priority is greater. The system request
  consequently completes while the newer final voice waits. This is the
  explicit AGT-005 priority/replacement contract, not optional hardening.
- Attempts:
  1. Distinct root Checker `agt-005-checker-root-20260804-001` matched all 29
     Maker manifest entries and the seven-file source receipt. Fresh AGT-005
     tests pass 6/43, strict TypeScript and the 73-source boundary check pass,
     but one bounded Checker probe starts dispatched `system_audio` and then
     submits `final_voice` in the same Viewer lane. Expected system abort and
     `superseded`; actual abort is `false`, system status is `completed`, and
     final voice stays queued until release. Evidence:
     `.omx/artifacts/typescript-bun/AGT-005/agt-005-checker-root-20260804-001/`.
  2. Recovery Maker `agt-005-recovery-maker-root-20260804-001` raised
     `final_voice` to the user-input priority while retaining its
     same-priority dispatched completion rule. It also separated queued
     p-queue cancellation from the Provider execution signal so aborting
     running work does not release concurrency or settle as generic
     `cancelled` before the physical attempt ends. The rejecting probe now
     observes system abort `true`, system `superseded`, final voice
     `completed`, and the pre-release snapshot remains one running plus one
     queued. Focused AGT-005 tests pass 6/46; strict TypeScript and the
     73-source boundary check pass. The blocker remains active pending a
     distinct fresh Recovery Checker. Evidence:
     `.omx/artifacts/typescript-bun/AGT-005/agt-005-recovery-maker-root-20260804-001/`.
  3. Distinct root Recovery Checker
     `agt-005-recovery-checker-root-20260804-001` matched all 35 Recovery Maker
     manifest entries and the two-file source receipt with aggregate
     `4357a9c4765dbc0f06d48ae3af8fde24c429f2c91760fbdd275fa87768b7cc68`.
     Fresh AGT-005 tests pass 6/46, strict TypeScript and the 73-source boundary
     check pass, and the original rejecting probe now reports system abort
     `true`, system `superseded`, final voice `completed`, with one running and
     one queued request before physical release. Evidence:
     `.omx/artifacts/typescript-bun/AGT-005/agt-005-recovery-checker-root-20260804-001/`.
- Security/data impact: none. The impact is incorrect realtime ordering and
  stale system-audio work delaying newer final user input.
- Current evidence:
  - `.omx/artifacts/typescript-bun/AGT-005/agt-005-checker-root-20260804-001/candidate-verification.json`
  - `.omx/artifacts/typescript-bun/AGT-005/agt-005-checker-root-20260804-001/priority-probe.ts`
  - `.omx/artifacts/typescript-bun/AGT-005/agt-005-checker-root-20260804-001/priority-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-005/agt-005-recovery-maker-root-20260804-001/priority-probe.json`
- Resolution condition: make `final_voice` higher priority than
  `system_audio`, preserve same-priority final-voice dispatched completion and
  newer-user supersession, add only the focused regression, and keep all
  accepted queue, budget, rate, retry, deadline, and drain behavior intact.
- Recovery task or decision: resolved; normal promotion selects `AGT-006`.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `agt-005-recovery-checker-root-20260804-001`.
- Residual limitation: none.

## `AGT-004-UNICODE-TEXT-PARITY` - `AGT-004` - Unicode text length, truncation, and duplicate parity drift

- Status: `RESOLVED`
- First seen: 2026-08-04
- Last updated: 2026-08-04
- Owner: `root`
- Task claim blocked: `AGT-004` requires canonical 4,000-character input,
  160-character display truncation, and nonduplicate barrage text behavior
  matching the Python parity oracle.
- Error signature: `UTF16_LENGTH_SLICE_AND_LOWERCASE_DRIFT_FROM_CODEPOINT_CASEFOLD`.
- Environment: Windows, Bun `1.3.14`, branch `TS_backend_refactor`, HEAD
  `41665a96cf67eb82cbe02f83abbbe2b79b100e48`; deterministic synthetic text,
  no Provider or user data.
- Why this is a blocker: the TypeScript schema measures string length in
  UTF-16 code units, publication uses `slice(0, 160)`, and duplicate
  normalization uses `toLowerCase()`. Python measures Unicode code points,
  slices 160 code points, and uses `casefold()`. The current Bun service thus
  rejects valid astral-character input, under-truncates astral display text,
  and publishes a casefold duplicate the oracle rejects. These are explicit
  AGT-004 acceptance behaviors, not an optional robustness improvement.
- Attempts:
  1. Distinct root Checker `agt-004-checker-root-20260804-001` matched all 36
     Maker hashes and the eight-file source receipt. Fresh AGT-004 tests pass
     7/37, as do strict TypeScript, the 71-source boundary check, and diff
     hygiene. Its bounded TypeScript probe accepts `straße` and `STRASSE`,
     publishes 80 code points from 200 emoji, and rejects 3,000 emoji code
     points; the Python oracle rejects the duplicate, publishes 160, and
     accepts 3,000. Evidence:
     `.omx/artifacts/typescript-bun/AGT-004/agt-004-checker-root-20260804-001/`.
  2. Recovery Maker `agt-004-recovery-maker-root-20260804-001` generated a
     dependency-free Python Unicode 14.0.0 casefold table with all 1,530
     nonidentity mappings and changed Viewer input bounds plus publication
     truncation to count code points. The rejecting Checker probe now rejects
     the casefold duplicate, publishes 160 of 200 emoji, and accepts 3,000
     emoji code points. Bun and Python full-mapping receipts share SHA-256
     `1d4fac94d5be772dca0aa80fabd1b9aac1534348c4e9552e8d4f58e40546e2cd`.
     Eight focused tests with 44 assertions and strict TypeScript pass. The
     blocker remains active only until a distinct fresh Recovery Checker
     accepts the candidate. Evidence:
     `.omx/artifacts/typescript-bun/AGT-004/agt-004-recovery-maker-root-20260804-001/`.
  3. Distinct Recovery Checker
     `agt-004-recovery-checker-root-20260804-001` matched all 43 Recovery
     Maker hashes and the four-file recovery source receipt. Fresh focused
     AGT-004 tests pass 8/44; strict contracts/backend TypeScript, the
     71-source boundary check, and diff hygiene pass. Its independent probe
     rejects the casefold duplicate, publishes 160 of 200 emoji, and accepts
     3,000 emoji code points. Independent Bun and Python full-mapping receipts
     both contain 1,530 mappings and share SHA-256
     `1d4fac94d5be772dca0aa80fabd1b9aac1534348c4e9552e8d4f58e40546e2cd`.
     Evidence:
     `.omx/artifacts/typescript-bun/AGT-004/agt-004-recovery-checker-root-20260804-001/`.
- Security/data impact: no secret or user data was read. The impact is product
  correctness and parity for valid Unicode Viewer output.
- Current evidence:
  - `.omx/artifacts/typescript-bun/AGT-004/agt-004-checker-root-20260804-001/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/AGT-004/agt-004-checker-root-20260804-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-004/agt-004-checker-root-20260804-001/python-oracle-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-004/agt-004-recovery-maker-root-20260804-001/blocker-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-004/agt-004-recovery-maker-root-20260804-001/unicode-parity.json`
  - `.omx/artifacts/typescript-bun/AGT-004/agt-004-recovery-maker-root-20260804-001/source-receipt.json`
  - `.omx/artifacts/typescript-bun/AGT-004/agt-004-recovery-checker-root-20260804-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-004/agt-004-recovery-checker-root-20260804-001/unicode-parity.json`
- Resolution condition: count and truncate by Unicode code points up to the
  exact 4,000/160 limits, implement Python-compatible casefold equivalence for
  duplicate detection, add only the focused regression cases, and preserve
  all existing repair, identity, evidence, and target behavior.
- Recovery task or decision: resolved; normal task promotion selects
  `AGT-005` next.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `agt-004-recovery-checker-root-20260804-001`.
- Residual limitation: none.

## `AGT-003-STREAM-ERROR-NORMALIZATION-AND-RAW-LOG` - `AGT-003` - streaming failures lose Provider identity and log raw SDK errors

- Status: `RESOLVED`
- First seen: 2026-08-04
- Last updated: 2026-08-04
- Owner: `root`
- Task claim blocked: `AGT-003` requires normalized streaming errors and a
  safe ADVX boundary that does not expose Provider SDK/wire objects.
- Error signature: `STREAM_503_BECOMES_UNKNOWN_AND_DEFAULT_ONERROR_LOGS_RAW`.
- Environment: Windows, Bun `1.3.14`, AI SDK `7.0.42`,
  `@ai-sdk/openai-compatible@3.0.17`, branch `TS_backend_refactor`, HEAD
  `41665a96cf67eb82cbe02f83abbbe2b79b100e48`; synthetic recorded endpoint,
  no credentialed Provider call.
- Why this is a blocker: `streamText()` has no explicit `onError` handler.
  AI SDK therefore logs the raw `AI_APICallError`, request body values, and
  upstream response body to stderr. Its `textStream` suppresses that original
  error; the later terminal rejection reaches the gateway as a different error
  and is normalized to non-retryable `provider.unknown` from ADVX, losing HTTP
  503 and `x-request-id`. This directly violates the task's normalized-error
  and safe-boundary requirements.
- Attempts:
  1. Distinct Checker `agt-003-checker-root-20260804-001` verified all 26 Maker
     hashes and reran the passing candidate suite. Its bounded recorded probe
     sent one streaming HTTP 503. Physical count and budget remained correct,
     but events were `started,failed` with actual `provider.unknown` instead of
     `provider_unavailable`, the upstream request ID was lost, and raw SDK
     request/response error data appeared on stderr. Evidence:
     `.omx/artifacts/typescript-bun/AGT-003/agt-003-checker-root-20260804-001/`.
  2. Recovery Maker `agt-003-recovery-maker-root-20260804-001` installed an
     explicit non-logging stream callback, retained the original error, and
     normalized it before terminal promise handling. The original Checker
     probe now passes with one physical request, retryable
     `provider_unavailable`, HTTP 503, upstream request ID `stream-503`, and no
     raw SDK error output. Five focused tests with 36 assertions pass. The
     blocker remains active only until a distinct fresh Recovery Checker
     accepts the candidate. Evidence:
     `.omx/artifacts/typescript-bun/AGT-003/agt-003-recovery-maker-root-20260804-001/`.
  3. Distinct Recovery Checker
     `agt-003-recovery-checker-root-20260804-001` matched all 33 Recovery Maker
     hashes and an 11-file reviewed source/package/lock receipt. Fresh focused
     tests, strict TypeScript, the 70-source boundary check, and diff hygiene
     pass. Its separately captured probe makes one physical HTTP 503 request,
     returns retryable `provider_unavailable` with HTTP 503 and request ID
     `stream-503`, and writes zero bytes to stderr. Both retry disables and the
     shared two-request budget remain correct. Verdict: `PASS`; the blocker is
     resolved and `AGT-003` is `DONE`. Evidence:
     `.omx/artifacts/typescript-bun/AGT-003/agt-003-recovery-checker-root-20260804-001/`.
- Security/data impact: the probe used synthetic text only, but the same
  default handler can write real prompt/request values and Provider error
  bodies into ordinary backend logs. No real secret or user data was read.
- Current evidence:
  - `.omx/artifacts/typescript-bun/AGT-003/agt-003-checker-root-20260804-001/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/AGT-003/agt-003-checker-root-20260804-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-003/agt-003-recovery-maker-root-20260804-001/blocker-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-003/agt-003-recovery-maker-root-20260804-001/source-receipt.json`
  - `.omx/artifacts/typescript-bun/AGT-003/agt-003-recovery-checker-root-20260804-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-003/agt-003-recovery-checker-root-20260804-001/checker-probe.stderr.txt`
  - `.omx/artifacts/typescript-bun/AGT-003/agt-003-recovery-checker-root-20260804-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/AGT-003/agt-003-recovery-checker-root-20260804-001/source-check.json`
- Resolution condition: install an explicit non-logging stream `onError`
  callback, retain and normalize the original `APICallError` as HTTP 503
  `provider_unavailable` with its request ID, emit no raw SDK/wire error, keep
  one physical request with `maxRetries: 0`, and pass the focused regression.
- Recovery task or decision: resolved; normal task promotion selects
  `AGT-004` next.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `agt-003-recovery-checker-root-20260804-001`.
- Residual limitation: credentialed Provider proof remains `AGT-015` and is not
  part of this recorded blocker.

## `AGT-002-CANCELLED-RECONNECTED-FINAL-DEDUP-GAP` - `AGT-002` - cancelled and reconnected turns can persist late or duplicate finals

- Status: `RESOLVED`
- First seen: 2026-08-04
- Last updated: 2026-08-04
- Owner: `root`
- Task claim blocked: `AGT-002` requires cancellation or reconnect during a
  coordinated turn to prevent a late or duplicate final transcript, degraded
  completion, or ObservationWave.
- Error signature: `AGT002_CANCELLED_OR_RECONNECTED_FINAL_PERSISTED`.
- Environment: Windows, Bun `1.3.14`, branch `TS_backend_refactor`, HEAD
  `41665a96cf67eb82cbe02f83abbbe2b79b100e48`; deterministic in-memory sink,
  no credentialed Provider or user audio.
- Why this is a blocker: `AsrTurnCoordinator.accept()` deduplicates only by
  Provider `utteranceId`/`responseId` and calls `persistFinal()` before checking
  whether the coordinated turn is cancelled, closed, or already contains that
  source. A cancellation recorded before the Provider final therefore still
  persists the late transcript. Reconnection of the same captured source with
  a new Provider request/utterance identity persists the same final twice.
  Both outcomes directly violate the AGT-002 final idempotency and cancellation
  acceptance condition even though the existing focused suite remains green.
- Attempts:
  1. Distinct root Checker `agt-002-checker-root-20260804-001` matched all 36
     Maker hashes and reproduced ten AGT-002 tests with 53 assertions, four
     AGT-001 regressions with 28 assertions, strict TypeScript, the 68-source
     boundary check, and diff hygiene. A Checker-owned two-case probe cancels
     `turn-1` before its final and observes one persisted final instead of zero;
     it then submits the same microphone source/turn across two reconnect
     request identities and observes two persisted finals instead of one.
     Evidence:
     `.omx/artifacts/typescript-bun/AGT-002/agt-002-checker-root-20260804-001/`.
  2. Recovery Maker `agt-002-recovery-maker-root-20260804-001` changed only the
     coordinator and its focused test. Coordinated-turn cancellation, closure,
     and same-source pending/persisted identity are now checked before the sink
     side effect. Cancelled tombstones reject every later final; active and
     closed turns reserve a source before persistence so a new Provider ID
     cannot duplicate it. Completed/degraded tombstones retain their persisted
     sources, while a degraded turn still accepts its one missing system-audio
     source once without scheduling another wave. The focused suite passes ten
     tests with 54 assertions, including cancellation before final, same
     source/turn reconnect under a different utterance ID, and different-ID
     retry of the degraded late system final. The candidate is `VERIFY`; this
     blocker remains `ACTIVE` pending a distinct Recovery Checker. Evidence:
     `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-maker-root-20260804-001/`.
  3. Distinct Recovery Checker `agt-002-recovery-checker-root-20260804-001`
     matched all 33 Recovery Maker hashes and reproduced the focused suite,
     AGT-001 regression, strict TypeScript, the 68-source boundary check, and
     diff hygiene. Cancellation before final and ordinary same-source reconnect
     now pass. A Checker-owned controlled sink then held a system-audio
     `persistFinal()` across the three-second degradation boundary. The wave
     degraded exactly once, but `#closeTurn()` replaced the active pending set
     with an empty tombstone. When the held persistence completed, the closed
     tombstone was not updated; a different-ID system reconnect therefore
     persisted the same late system final again. Actual system-final count is
     two instead of one, with the expected single wave. Verdict: `FAIL`.
     Evidence:
     `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-checker-root-20260804-001/`.
  4. Recovery Maker `agt-002-recovery-maker-root-20260804-002` changed only the
     coordinator and its focused test relative to the rejected candidate.
     Active-to-degraded closure now copies pending-source ownership into the
     tombstone. Completion of the already-started sink persistence atomically
     removes that pending reservation and marks the source persisted on the
     live tombstone; failure releases the reservation. The original Checker
     probe now passes cancellation `0/0`, ordinary reconnect `1/1`, in-flight
     degraded system finals `1/1`, and degraded waves `1/1`. Eleven AGT-002
     tests with 56 assertions, AGT-001 regression, strict TypeScript, and the
     68-source boundary check pass. The candidate is `VERIFY`; this blocker
     remains `ACTIVE` pending a distinct Recovery Checker. Evidence:
     `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-maker-root-20260804-002/`.
  5. Distinct Recovery Checker `agt-002-recovery-checker-root-20260804-002`
     matched all 34 Recovery Maker hashes and reproduced eleven AGT-002 tests
     with 56 assertions, four AGT-001 regressions with 28 assertions, strict
     TypeScript, the 68-source boundary check, and diff hygiene. Its controlled
     probe passes cancellation `0/0`, ordinary reconnect `1/1`, an in-flight
     system final spanning degradation `1/1`, and degraded waves `1/1`.
     Source review confirms `#closeTurn()` carries pending ownership and the
     completion path promotes that source to persisted on the live tombstone.
     Verdict: `PASS`; the blocker is resolved and `AGT-002` is `DONE`.
     Evidence:
     `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-checker-root-20260804-002/`.
- Security/data impact: no secret, credential, raw audio, user data, Python
  oracle, dependency/lock, `output/`, or `promo/` content changed. Before the
  accepted recovery, cancellation/reconnect could duplicate Room transcript
  state; the accepted deterministic probe now proves zero late cancelled final
  and exactly one final plus one wave for the affected reconnect/degraded cases.
- Current evidence:
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-checker-root-20260804-001/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-checker-root-20260804-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-checker-root-20260804-001/checker-probe.txt`
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-checker-root-20260804-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-maker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-maker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-checker-root-20260804-001/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-checker-root-20260804-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-maker-root-20260804-002/blocker-probe.ts`
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-maker-root-20260804-002/blocker-probe.json`
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-checker-root-20260804-002/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/AGT-002/agt-002-recovery-checker-root-20260804-002/checker-probe.json`
- Resolution condition: before persistence, distinguish cancelled, active,
  completed, and degraded coordinated-turn tombstones and track which source
  finals are already persisted. A cancelled turn must drop every later final;
  reconnect/retry of an already persisted source in the same turn must be a
  no-op even when Provider request/utterance IDs change. A degraded turn must
  still allow its one previously missing paired system-audio final to persist
  once without retriggering. Add only the focused cancellation/reconnect and
  degraded-late-final regressions, then rerun the current AGT-002 gate.
  Pending-source ownership must survive an active-to-degraded closure: when an
  already-started late system persistence completes after degradation, the
  tombstone must atomically move that source from pending to persisted so a
  different Provider identity cannot persist it again.
- Recovery task or decision: resolved; normal task promotion selects
  `AGT-003` next.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `agt-002-recovery-checker-root-20260804-002`.
- Residual limitation: credentialed StepFun capability proof remains owned by
  `AGT-015`; Windows loopback capture and Electron wiring remain later desktop
  tasks and are not part of this blocker.

## `DAT-010-POST-BACKUP-WRITE-WINDOW` - `DAT-010` - writes after backup can be lost at cutover

- Status: `RESOLVED`
- First seen: 2026-08-04
- Last updated: 2026-08-04
- Owner: `root`
- Task claim blocked: the rehearsed copy-and-swap procedure migrates every
  committed legacy row present when both backends stop.
- Error signature: `DAT010_POST_BACKUP_PRE_STOP_WRITE_LOSS`.
- Environment: Windows, Bun `1.3.14`, branch `TS_backend_refactor`, HEAD
  `41665a96cf67eb82cbe02f83abbbe2b79b100e48`; synthetic Python-owned database
  only, no user database used.
- Why this is a blocker: the online backup returns before the stop callback.
  A valid legacy write can commit in that interval. The candidate compares the
  working and rollback copies only with the earlier backup; after stop it hashes
  the source only to detect later mutation, never comparing the stopped source
  with the backup. It can therefore report a successful migration while
  omitting committed rows from the cutover database.
- Attempts:
  1. Distinct root Checker `dat-010-checker-root-20260804-001` matched all 38
     Maker hashes and passed strict TypeScript, two focused tests with 33
     assertions, the 62-source boundary check, and diff hygiene. A
     Checker-owned real Python/Bun probe created the verified online backup,
     committed one Room write before stop, and observed migration success with
     `sourceLateRows=1`, `workingLateRows=0`, `rollbackLateRows=0`, and unequal
     stopped-source/backup hashes. Evidence:
     `.omx/artifacts/typescript-bun/DAT-010/dat-010-checker-root-20260804-001/`.
  2. Root Recovery Maker `dat-010-recovery-maker-root-20260804-001` added a
     stopped-Source versus closed-backup full logical snapshot comparison before
     working-copy creation. The new focused regression repeats the exact late
     Room write and now receives `comparison_failed`; the working database is
     absent, Source retains the row, and no Bun journal/outbox exists. Strict
     TypeScript and three DAT-010 tests with 39 assertions, the 62-source
     boundary check, and diff hygiene pass. The blocker remains active pending
     a distinct Recovery Checker. Evidence:
     `.omx/artifacts/typescript-bun/DAT-010/dat-010-recovery-maker-root-20260804-001/`.
  3. Distinct root Recovery Checker
     `dat-010-recovery-checker-root-20260804-001` matched all 27 candidate
     hashes and confirmed the recovery product delta is exactly the two
     blocker-owned files. Fresh strict TypeScript, three DAT-010 tests with 39
     assertions, diff hygiene, and the 62-source boundary check pass. The
     original Checker-owned real late-write scenario now exits through
     `comparison_failed` before working-copy creation, does not return migration
     success, and retains the committed Source row without adopting a Bun
     journal/outbox. Evidence:
     `.omx/artifacts/typescript-bun/DAT-010/dat-010-recovery-checker-root-20260804-001/`.
- Security/data impact: no user database was opened and no source row was
  deleted. In a real cutover, a post-backup committed write could be silently
  omitted from the Bun copy, which is direct data loss. No Python oracle,
  dependency/lock, `output/`, or `promo/` content changed.
- Current evidence:
  - `.omx/artifacts/typescript-bun/DAT-010/dat-010-checker-root-20260804-001/probe.ts`
  - `.omx/artifacts/typescript-bun/DAT-010/dat-010-checker-root-20260804-001/probe-output.json`
  - `.omx/artifacts/typescript-bun/DAT-010/dat-010-checker-root-20260804-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/DAT-010/dat-010-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/DAT-010/dat-010-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/DAT-010/dat-010-recovery-maker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/DAT-010/dat-010-recovery-maker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/DAT-010/dat-010-recovery-checker-root-20260804-001/probe-output.json`
  - `.omx/artifacts/typescript-bun/DAT-010/dat-010-recovery-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/DAT-010/dat-010-recovery-checker-root-20260804-001/verdict.md`
- Resolution condition: after both backends stop and before any working-copy
  migration, compare the stopped source's complete logical snapshot with the
  closed backup and fail closed on any mismatch. Add one focused regression
  that commits after backup but before stop and proves no migration is adopted
  while the source remains usable. Retain every currently passing backup,
  schema, migration, Bun smoke, restore, and prohibition assertion.
- Recovery task or decision: bounded recovery of `DAT-010`; do not start
  `DAT-011`.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `dat-010-recovery-checker-root-20260804-001`.
- Residual limitation: Bun 1.3.14 still has no approved owned Online Backup API;
  destructive Bun migrations remain prohibited as already required by
  `ADR-MIG-001` and DAT-010.

## `DAT-007-MEMORY-TYPE-CHECK-DRIFT` - `DAT-007` - memory tables add unreviewed type checks

- Status: `RESOLVED`
- First seen: 2026-08-04
- Last updated: 2026-08-04
- Owner: `root`
- Task claim blocked: migration 0004 and its Drizzle declarations match the
  current four-table Python/Alembic long-term-memory schema.
- Error signature: `DAT007_UNREVIEWED_MEMORY_TYPE_CHECKS`.
- Environment: Windows, Bun `1.3.14`, branch `TS_backend_refactor`, HEAD
  `41665a96cf67eb82cbe02f83abbbe2b79b100e48`; no user database used.
- Why this is a blocker: DAT-001 freezes seven migrated CHECK constraints for
  `room_long_term_memories` and four for `room_memory_candidates`. Candidate
  migration 0004 and Drizzle each add a `type_allowed` CHECK to both tables.
  These constraints are absent from the Python models, Alembic migration, and
  generated schema inventory. This changes the durable schema instead of
  porting it and can reject source rows during the later legacy migration.
- Attempts:
  1. Distinct root Checker `dat-007-checker-root-20260804-001` matched all 37
     Maker hashes and passed strict TypeScript, four focused tests with 53
     assertions, the 58-source boundary check, and diff hygiene. A
     Checker-owned disposable real-migration probe found every required CHECK
     plus exactly `ck_room_long_term_memories_type_allowed` and
     `ck_room_memory_candidates_type_allowed`; it exited 1 with
     `passed=false`. Evidence:
     `.omx/artifacts/typescript-bun/DAT-007/dat-007-checker-root-20260804-001/`.
  2. Root Recovery Maker `dat-007-recovery-maker-root-20260804-001` removed
     only the two extra SQL/Drizzle checks, updated the exact migration checksum,
     and added four-table CHECK-set assertions. Strict TypeScript, four focused
     tests with 57 assertions, nine directly affected DAT-004..006 tests with 84
     assertions, and the 58-source boundary check pass. The original Checker
     probe now reports the exact seven plus four blocker-owned CHECK sets with
     zero missing or unexpected constraints. The blocker remains active pending
     a distinct Recovery Checker. Evidence:
     `.omx/artifacts/typescript-bun/DAT-007/dat-007-recovery-maker-root-20260804-001/`.
  3. Distinct root Recovery Checker
     `dat-007-recovery-checker-root-20260804-001` matched all 24 Recovery Maker
     hashes and confirmed the product delta from the rejected candidate is
     exactly the four declared blocker-owned files. Fresh strict TypeScript,
     four focused tests with 57 assertions, diff hygiene, and the 58-source
     boundary check pass. A Checker-owned disposable migration probe derives
     all four exact memory-table CHECK sets from DAT-001, reports zero missing
     or unexpected constraints, confirms the immutable checksum, and confirms
     invalid memory types still fail with `invalid_record` at the repository
     boundary. Evidence:
     `.omx/artifacts/typescript-bun/DAT-007/dat-007-recovery-checker-root-20260804-001/`.
- Security/data impact: no user database was opened. The extra constraints do
  not expose data, but they create a future legacy-migration compatibility risk.
  No Python oracle, dependency/lock, `output/`, or `promo/` content changed.
- Current evidence:
  - `.omx/artifacts/typescript-bun/DAT-007/dat-007-checker-root-20260804-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/DAT-007/dat-007-checker-root-20260804-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/DAT-007/dat-007-checker-root-20260804-001/validation.json`
  - `.omx/artifacts/typescript-bun/DAT-007/dat-007-checker-root-20260804-001/verdict.md`
  - `.omx/artifacts/typescript-bun/DAT-007/dat-007-recovery-checker-root-20260804-001/manifest-check.json`
  - `.omx/artifacts/typescript-bun/DAT-007/dat-007-recovery-checker-root-20260804-001/checker-probe.json`
- Resolution condition: remove only the two unreviewed SQL and Drizzle CHECK
  constraints, update migration 0004's exact checksum, and make the focused
  schema test compare the exact DAT-001 CHECK sets. Retain typed repository
  validation and all previously passing lifecycle behavior.
- Recovery task or decision: bounded recovery of `DAT-007`; do not start
  `DAT-008`.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `dat-007-recovery-checker-root-20260804-001`.
- Residual limitation: async memory extraction orchestration remains owned by
  `AGT-012`; legacy database conversion remains owned by `DAT-010`.

## `DAT-006-BARRAGE-EVIDENCE-NULL-PARITY` - `DAT-006` - accepted barrage evidence with explicit nulls is rejected

- Status: `RESOLVED`
- First seen: 2026-08-04
- Last updated: 2026-08-04
- Owner: `root`
- Task claim blocked: accepted audience barrage and its event/frame evidence
  references can be persisted with current Python payload parity.
- Error signature: `ROOM_EVENT_EVIDENCE_NULL_UNION_REJECTED`.
- Environment: Windows, Bun `1.3.14`, Python `3.11/3.12` project environment,
  branch `TS_backend_refactor`, HEAD
  `41665a96cf67eb82cbe02f83abbbe2b79b100e48`; no user database used.
- Why this is a blocker: `PersistentViewerRoomWriter` persists
  `ViewerBarrageEvent.model_dump(mode="json")`. Its `EvidenceRef` union includes
  both optional keys, so event evidence carries `frame_index=null` and frame
  evidence carries `event_id=null`. The Python persistence validator accepts
  that real product shape. The Bun validator requires the unused key to be
  absent, so a valid accepted barrage with evidence cannot enter durable Room
  history. This violates the explicit DAT-006 evidence-reference requirement.
- Attempts:
  1. Distinct root Checker `dat-006-checker-root-20260804-001` matched all 31
     Maker hashes and passed strict TypeScript, three focused tests with 33
     assertions, and the 57-source boundary check. A Checker-owned Python probe
     accepts and hashes the exact model-dump payload; the paired Bun probe
     rejects it with `invalid_record: Room event evidence reference scope is
     invalid`. Evidence:
     `.omx/artifacts/typescript-bun/DAT-006/dat-006-checker-root-20260804-001/`.
  2. Recovery Maker `dat-006-recovery-maker-root-20260804-001` changed only the
     Room-event validator and focused test from the rejected product candidate.
     The unused evidence union field is now absent-equivalent when omitted or
     explicit `null`; required non-empty event IDs and nonnegative frame indexes
     remain enforced. Strict TypeScript, three DAT-006 tests with 33 assertions,
     the 57-source boundary check, and the original Checker blocker probe pass.
     The blocker remains active until a distinct recovery Checker accepts the
     candidate. Evidence:
     `.omx/artifacts/typescript-bun/DAT-006/dat-006-recovery-maker-root-20260804-001/`.
  3. Recovery Checker `dat-006-recovery-checker-root-20260804-001`, in a
     distinct run/context, matched all 35 candidate hashes and confirmed only
     the validator and focused test differ from the rejected product candidate.
     Fresh strict TypeScript, three DAT-006 tests with 33 assertions, the
     57-source boundary check, and a Checker-owned three-case probe pass. The
     exact Python model-dump null shape is accepted; empty event IDs and negative
     frame indexes still return `invalid_record`. Evidence:
     `.omx/artifacts/typescript-bun/DAT-006/dat-006-recovery-checker-root-20260804-001/`.
- Security/data impact: no user database, credential, raw media, Python oracle,
  dependency, lock, later data task, commit, push, deploy, subagent, `output/`,
  or `promo/` content was changed or inspected.
- Current evidence:
  - `.omx/artifacts/typescript-bun/DAT-006/dat-006-checker-root-20260804-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/DAT-006/dat-006-checker-root-20260804-001/python-oracle-probe.json`
  - `.omx/artifacts/typescript-bun/DAT-006/dat-006-recovery-maker-root-20260804-001/`
  - `.omx/artifacts/typescript-bun/DAT-006/dat-006-recovery-checker-root-20260804-001/`
  - `apps/backend/src/advx_backend/application/viewer_runtime_adapters.py`
  - `apps/backend/src/advx_backend/application/room_event_persistence.py`
- Resolution condition: treat the unused evidence union field as absent when it
  is either omitted or explicit `null`, while still requiring a non-empty
  `event_id` for event evidence and a nonnegative `frame_index` for frame
  evidence. Add one focused regression using the exact Python model-dump shape;
  preserve all accepted DAT-006 behavior and do not expand scope.
- Recovery task or decision: the distinct recovery Checker accepted the exact
  bounded repair. `DAT-006` is `DONE` and `DAT-007` is `READY`.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `dat-006-recovery-checker-root-20260804-001`.
- Residual limitation: none.

## `DAT-005-VIEWER-STATE-DEFAULT-DRIFT` - `DAT-005` - Viewer storage state has an unreviewed database default

- Status: `RESOLVED`
- First seen: 2026-08-04
- Last updated: 2026-08-04
- Owner: `root`
- Task claim blocked: the Bun Viewer schema and repository preserve the current
  Python-migrated database snapshot and its explicit default contract.
- Error signature: `UNEXPECTED_SESSION_VIEWER_INSTANCES_STATE_DEFAULT`.
- Environment: Windows, Bun `1.3.14`, branch `TS_backend_refactor`, HEAD
  `41665a96cf67eb82cbe02f83abbbe2b79b100e48`, disposable SQLite fixture only.
- Why this is a blocker: DAT-001 records exactly 14 migrated database defaults
  for `session_viewer_instances`; `state` is not one of them. The target SQL and
  Drizzle schema add `DEFAULT 'active'`, changing an omitted required storage
  state from a constraint failure into an active Viewer row. This is schema and
  product-state parity, not optional hardening.
- Attempts:
  1. Distinct root Checker `dat-005-checker-root-20260804-001` matched all 37
     Maker hashes, passed strict TypeScript and three focused tests with 24
     assertions, then compared the candidate to the accepted DAT-001 default
     inventory. Its Checker-owned real-migration probe reports all 14 expected
     defaults plus the single unexpected `state` default and exits 1. Evidence:
     `.omx/artifacts/typescript-bun/DAT-005/dat-005-checker-root-20260804-001/`.
  2. Recovery Maker `dat-005-recovery-maker-root-20260804-001` removed only the
     SQL and Drizzle `state` default, updated the exact SQL checksum, and added
     focused assertions for the exact 14-default set plus omitted-state
     rejection. Strict TypeScript, three DAT-005 tests with 26 assertions, and
     three directly affected DAT-004 tests with 25 assertions pass. The prior
     Checker-owned migration probe now reports no missing or unexpected
     defaults and `passed=true`. The blocker remains active until a distinct
     recovery Checker accepts the candidate. Evidence:
     `.omx/artifacts/typescript-bun/DAT-005/dat-005-recovery-maker-root-20260804-001/`.
  3. Recovery Checker `dat-005-recovery-checker-root-20260804-001`, in a
     distinct run/context, matched all 20 Recovery Maker hashes and confirmed
     exactly four source files differ from the rejected candidate. Fresh strict
     TypeScript, three DAT-005 tests with 26 assertions, three directly affected
     DAT-004 tests with 25 assertions, diff hygiene, and a Checker-owned
     disposable migration probe pass. The migrated table has exactly the 14
     accepted defaults, `state` has no default, omitted `state` fails its
     required constraint, explicit state persists, and the declared/calculated
     migration checksums match. Evidence:
     `.omx/artifacts/typescript-bun/DAT-005/dat-005-recovery-checker-root-20260804-001/`.
- Security/data impact: no user database, credential, raw media, Python oracle,
  dependency, lock, later data task, commit, push, deploy, subagent, `output/`,
  or `promo/` content was changed or inspected.
- Current evidence:
  - `.omx/artifacts/typescript-bun/DAT-005/dat-005-checker-root-20260804-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/DAT-005/dat-005-recovery-maker-root-20260804-001/`
  - `docs/migrations/typescript-bun/DAT-001-PERSISTENCE-INVENTORY.md`
- Resolution condition: remove the `state` database default from both immutable
  migration `0002_session_viewer_instances.sql` and the Drizzle declaration,
  update the migration checksum, and add one focused assertion that the 14
  accepted defaults are exact and an insert omitting required `state` fails.
  Preserve every accepted DAT-005 repository behavior and do not expand scope.
- Recovery task or decision: the distinct recovery Checker accepted the exact
  bounded repair. `DAT-005` is `DONE` and `DAT-006` is `READY`.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `dat-005-recovery-checker-root-20260804-001`.
- Residual limitation: none.

## `DAT-004-REPOSITORY-PARITY-GAPS` - `DAT-004` - Session-start idempotency and Room clear are missing

- Status: `RESOLVED`
- First seen: 2026-08-04
- Last updated: 2026-08-04
- Owner: `root`
- Task claim blocked: Room, Session, and runtime revision repositories have
  parity with the current Python persistence behavior.
- Error signature: the same `client_request_id` and canonical request hash on a
  new Session ID returns `transaction_failed` instead of the existing Session;
  the Room repository exposes only `get` and `save`, and a `cleared` state
  update leaves one dependent `session_records` row instead of physically
  deleting the Room and cascading runtime data.
- Environment: Windows, Bun `1.3.14`, branch `TS_backend_refactor`, HEAD
  `41665a96cf67eb82cbe02f83abbbe2b79b100e48`, disposable SQLite fixture only.
- Why this is a blocker: DAT-001 explicitly records durable Session-start
  idempotency and physical Room clear/cascade as current product behavior.
  These are correctness and deletion semantics, not optional hardening.
- Attempts:
  1. Distinct root Checker matched the 29-entry Maker manifest, inspected the
     target repositories against `SQLiteRoomRepository` and
     `SQLiteSessionRuntimeRepository`, and ran one bounded diagnostic fixture.
     Positive migration, close/reopen, marker, forged-context, transaction
     rollback, runtime rollback, strict TypeScript, focused tests, and boundary
     checks pass. The diagnostic reproduces both missing behaviors without
     accessing user data.
  2. Recovery Maker `dat-004-recovery-maker-root-20260804-001` added the
     explicit transaction-context idempotent-start lookup and physical Room
     clear only. The Session insert path now uses an uncached one-shot insert,
     recovers a matching concurrent identity without a duplicate, and reports
     a stable optimistic conflict for a changed hash. The focused DAT-004 test
     proves exact existing-record recovery and zero remaining Room, Session,
     and runtime revision rows after clear. Strict TypeScript, three DAT-004
     tests with 25 assertions, four port tests with 23 assertions, and the
     55-source boundary check pass. The blocker remains active until a distinct
     Checker accepts this candidate.
  3. Recovery Checker `dat-004-recovery-checker-root-20260804-001`, in a
     distinct run/context, matched all 30 Maker hashes and ran one bounded
     disposable probe. Matching identity returns the original Session without
     a duplicate, both lookup and save reject a changed hash with
     `optimistic_conflict`, a forced rollback restores Room, Session, and
     runtime revision counts to one each, and committed clear reduces all
     three counts to zero. Fresh targeted gates pass and resolve the blocker.
- Security/data impact: no user database, credential, raw media, Python oracle,
  dependency, lock, later data task, commit, push, deploy, subagent, `output/`,
  or `promo/` content was changed or inspected.
- Current evidence:
  - `.omx/artifacts/typescript-bun/DAT-004/dat-004-checker-root-20260804-001/parity-gap-probe.json`
  - `.omx/artifacts/typescript-bun/DAT-004/dat-004-checker-root-20260804-001/checker-probe.json`
  - `.omx/artifacts/typescript-bun/DAT-004/dat-004-recovery-maker-root-20260804-001/`
  - `.omx/artifacts/typescript-bun/DAT-004/dat-004-recovery-checker-root-20260804-001/`
- Resolution condition: add an explicit transaction-context repository path
  that returns the existing Session for the same client start ID and canonical
  hash while rejecting a changed hash with a stable optimistic identity
  conflict; add an explicit destructive Room clear/delete operation that
  physically deletes the Room and proves foreign-key cascade of its Session and
  runtime revision rows. Preserve the existing application-owned transaction,
  migration schema, and all accepted DAT-004 behavior.
- Recovery task or decision: the distinct recovery Checker accepted both
  repaired paths. DAT-004 is `DONE` and DAT-005 is `READY`.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `dat-004-recovery-checker-root-20260804-001`.
- Residual limitation: Viewer-dependent commit invariants remain owned by
  DAT-005 and are not part of this rejection.

## `GATE-02-CHECKER-THREAD-LIMIT` - `GATE-02` - fresh Terra Checker slot is unavailable

- Status: `RESOLVED`
- First seen: 2026-08-03
- Last updated: 2026-08-03
- Owner: `root`
- Task claim blocked: current-HEAD Phase 02 evidence is independently accepted
  by a fresh registered direct-leaf Terra Checker before `GATE-02` becomes
  `DONE`.
- Error signature: `spawn_agent(agent_type=luna_tester, fork_turns=none)` fails
  before context creation with `collab spawn failed: agent thread limit
  reached`.
- Environment: Windows, branch `TS_backend_refactor`, HEAD
  `41665a96cf67eb82cbe02f83abbbe2b79b100e48`, dirty worktree, configured
  `gpt-5.6-terra`, `max_depth=1`, repository session capacity raised from three
  to four during diagnosis.
- Why this is a blocker: the Maker cannot self-accept. The collaboration
  runtime exposes no operation to release a completed child thread, and the
  only reusable leaf cannot prove its model family is Terra. Reusing it or a
  direct CLI process would violate the explicit configured-role requirement.
- Attempts:
  1. Fresh registered Terra dispatch 004 hit the thread limit. The repository
     session limit was then raised from three to four without changing agent
     depth; fresh dispatch 005 hit the same limit. A no-write diagnostic on the
     existing completed leaf returned unknown model/family, so it was not used
     as a Checker.
  2. On the next resumed goal turn, fresh registered no-write Terra slot probe
     006 used a new identity and a leaf-only contract but again failed before
     context creation with the same thread-limit signature. The live agent
     inventory still contained only root and the completed unknown-model leaf;
     no new child or descendant was created.
  3. On the third consecutive resumed goal turn, fresh registered no-write
     Terra slot probe 007 used another new identity and the same bounded
     leaf-only contract. It again failed before context creation with the exact
     thread-limit signature. No slot became available and no child or
     descendant was created, exhausting the three-turn blocked audit.
- Resumed audit after external change:
  1. The human restarted Codex Desktop after the global future-session
     `agents.max_threads` setting was raised. Fresh direct-leaf Terra probe 012
     still failed before context creation. A read-only live state query found
     four top-level user tasks updated within five minutes: this ADVX migration,
     COD-123 inspection, video-translation research, and price UI work. Those
     four roots fill the runtime's four available slots, so no child slot exists
     in this task. No new child or descendant was created.
  2. The next automatic goal continuation repeated the live five-minute root
     inventory and again found the same four active top-level tasks. Fresh
     direct-leaf Terra probe 013 used a new identity but failed before context
     creation with the same thread-limit signature. No new child or descendant
     was created.
  3. The third consecutive resumed goal turn again found four active top-level
     tasks. Fresh direct-leaf Terra probe 014 used another new identity but
     failed before context creation with the same thread-limit signature. No
     new child or descendant was created, exhausting the resumed blocked audit.
- Security/data impact: none. No new child or descendant agent ran, no
  credentials or user data were accessed, and no product, test, Python oracle,
  dependency, lock, or Phase 03 source changed.
- Current evidence:
  - `.omx/artifacts/typescript-bun/GATE-02/gate-02-maker-20260803-002/`
  - `.omx/artifacts/typescript-bun/GATE-02/gate-02-checker-dispatch-20260803-005/`
  - `.omx/artifacts/typescript-bun/GATE-02/gate-02-checker-dispatch-20260803-006/`
  - `.omx/artifacts/typescript-bun/GATE-02/gate-02-checker-dispatch-20260803-007/`
  - `.omx/artifacts/typescript-bun/GATE-02/gate-02-checker-dispatch-20260803-012/`
  - `.omx/artifacts/typescript-bun/GATE-02/gate-02-checker-dispatch-20260803-013/`
  - `.omx/artifacts/typescript-bun/GATE-02/gate-02-checker-dispatch-20260803-014/`
  - `docs/migrations/typescript-bun/RUN-LOG.md`
- Resolution condition: satisfied by the human's explicit instruction for this
  root to continue without calling subagents. Root Checker
  `gate-02-checker-root-20260803-001` ran in a run/context distinct from Recovery
  Maker002, did not participate in its implementation, and accepted only the
  bounded current-task evidence and targeted checks.
- Recovery task or decision: `GATE-02` is accepted; promote only `DAT-001` and
  stop without implementing it.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `gate-02-checker-root-20260803-001`.
- Residual limitation: the accepted Checker is the primary root under explicit
  human no-subagent authority, not a Terra leaf; Maker/Checker run and context
  separation, targeted evidence review, and all technical acceptance checks
  remain intact.

## `GATE-02-CHECKER-MODEL-UNAVAILABLE` - `GATE-02` - registered leaf Checker model is unavailable

- Status: `RESOLVED`
- First seen: 2026-08-03
- Last updated: 2026-08-03
- Owner: `root`
- Task claim blocked: current-HEAD Phase 02 evidence is independently accepted
  by a fresh direct-leaf Checker before `GATE-02` becomes `DONE`.
- Error signature: `spawn_agent(agent_type=luna_tester, fork_turns=none)` fails
  before context creation with `Unknown model gpt-5.6-luna`; available models
  are reported as `gpt-5.6-sol` and `gpt-5.6-terra`.
- Environment: Windows, branch `TS_backend_refactor`, HEAD
  `41665a96cf67eb82cbe02f83abbbe2b79b100e48`, dirty worktree, direct-agent
  depth limited to one.
- Why this is a blocker: the Maker is forbidden to self-accept, and the
  repository Sol-Luna contract requires the configured registered Checker role
  rather than a substitute model, generic role, or direct CLI process. No
  independent Checker context exists, so gate criterion 8 cannot be claimed.
- Attempts:
  1. The first registered direct-leaf dispatch used the then-configured Luna
     role and failed before context creation with the exact error signature.
  2. A second dispatch used a fresh run/context identity and failed with the
     same exact signature; no agent was created.
  3. The live role file had changed to available `gpt-5.6-terra`, providing a
     materially changed input, but the registered session role still resolved
     unavailable `gpt-5.6-luna` and failed before context creation.
- Recovery evidence: explicit human authority now says to continue with Terra;
  replacement repository instructions and the registered role configuration
  consistently select a direct-leaf `gpt-5.6-terra` Checker. The blocker stays
  active only until a fresh registered Checker context is successfully created.
- Security/data impact: none. No child agent ran, no credentials or user data
  were accessed, and no product, test, Python oracle, dependency, lock, or
  Phase 03 source changed.
- Current evidence:
  - `.omx/artifacts/typescript-bun/GATE-02/gate-02-maker-20260803-001/`
  - `.omx/artifacts/typescript-bun/GATE-02/gate-02-checker-dispatch-20260803-003/`
  - `docs/migrations/typescript-bun/RUN-LOG.md`
- Resolution condition: satisfied for the old signature. Explicit human
  authority, replacement Sol-Terra instructions, and the registered role now
  select `gpt-5.6-terra`; new dispatches advance to the distinct collaboration
  thread-limit failure instead of returning the unavailable-model error.
- Recovery task or decision: resume only `GATE-02`; do not start `DAT-001`.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `gate-02-checker-dispatch-20260803-005`.
- Residual limitation: actual Terra Checker execution is now blocked by
  `GATE-02-CHECKER-THREAD-LIMIT`.

## `BCK-008-HANDSHAKE-AUTH-ORDER` - `BCK-008` - Session state is read before handshake authentication

- Status: `RESOLVED`
- First seen: 2026-08-03
- Last updated: 2026-08-03
- Owner: `bck-008-checker-20260803-003`
- Task claim blocked: the WebSocket handshake authenticates before entering
  application work and preserves Python v3/v4 authentication error/close
  ordering.
- Error signature: a schema-valid Python-wire `client.hello` with an invalid
  startup token calls `sessions.currentSession()` once. If that reader throws,
  the peer receives `unexpected_message` and close `1011`; the Python oracle
  authenticates first and requires `authentication_failed` and close `4401`.
- Environment: Windows, branch `TS_backend_refactor`, HEAD
  `41665a96cf67eb82cbe02f83abbbe2b79b100e48`, Bun `1.3.14`, dirty worktree.
- Why this was a blocker: an unauthenticated peer crossed into the Session
  application dependency before its credential is accepted and can distinguish
  internal Session-reader availability. This violates the explicit
  authenticated-handshake boundary and current Python wire ordering.
- Attempts:
  1. Fresh Checker matched all 30 Maker hashes, passed the required targeted
     gates, inspected the Bun and Python handshake order, and ran one compact
     probe. The probe observed one unauthorized Session read, safe but wrong
     `unexpected_message`, and close `1011` instead of zero reads,
     `authentication_failed`, and close `4401`.
  2. Recovery Maker delayed canonical-header authentication from connection
     open until after hello shape/version validation, moved both canonical and
     legacy credential checks before the Session reader, and cleared the
     pending header on authentication or cleanup. One focused two-form
     regression proves both invalid credentials call authorization once,
     perform zero Session reads even when the reader would throw, emit
     `authentication_failed`, and close `4401`. Checker002's exact probe now
     passes; all targeted gates remain green. The blocker stays active only
     until an independent Checker accepts this candidate.
  3. Fresh independent Recovery Checker matched all 24 Maker002 hashes and
     passed strict TypeScript, the 39-source boundary check, six focused tests,
     Checker002's exact probe, BCK-003 auth/process regression, and the three
     named CON-010 cases. Invalid legacy and canonical credentials each perform
     zero Session reads, emit `authentication_failed`, and close `4401`; a
     genuine reader failure after valid authentication remains redacted and
     closes `1011`.
- Security/data impact: the synthetic reader-error canary remains redacted and
  no real secret or user data was exposed. Unauthorized peers no longer cross
  into Session application work or distinguish Session-reader availability.
- Current evidence:
  - `.omx/artifacts/typescript-bun/BCK-008/bck-008-checker-20260803-002/`
  - `.omx/artifacts/typescript-bun/BCK-008/bck-008-maker-20260803-002/`
  - `.omx/artifacts/typescript-bun/BCK-008/bck-008-checker-20260803-003/`
- Resolution condition: satisfied. After safe hello shape/version validation,
  both legacy-token and canonical-header credentials are authenticated before
  any Session read; invalid credentials emit the canonical authentication
  failure before close and invoke the Session reader zero times.
- Recovery task or decision: complete only `BCK-008`; promote but do not start
  `BCK-009`.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `bck-008-checker-20260803-003`.
- Residual limitation: none accepted.

## `BCK-007-WRONG-ROOM-HTTP-MAPPING` - `BCK-007` - rejected candidate is reported as a missing Session

- Status: `RESOLVED`
- First seen: 2026-08-03
- Last updated: 2026-08-03
- Owner: `bck-007-checker-20260803-003`
- Task claim blocked: Elysia control routes preserve canonical HTTP status and
  normalized error-code parity for rejected runtime apply requests.
- Error signature: a schema-valid `POST /runtime/sessions/{session_id}/apply`
  whose candidate spec has a different `room_id` returns
  `404 runtime_session_not_found`; the canonical route contract and Python
  parity oracle require `422 runtime_apply_rejected`.
- Environment: Windows, branch `TS_backend_refactor`, HEAD
  `41665a96cf67eb82cbe02f83abbbe2b79b100e48`, Bun `1.3.14`, dirty worktree.
- Why this was a blocker: the requested Session exists and the rejection is
  caused by candidate content, so `404` falsely reported resource absence and
  violated BCK-007's explicit HTTP parity acceptance.
- Attempts:
  1. Fresh Checker matched all 25 Maker hashes, passed the targeted gates, and
     ran one bounded route probe. Source inspection showed
     `RuntimeSpecCoordinator.apply` emitted `wrong_room` for this candidate,
     while `mapControlError` mapped every coordinator `wrong_room` to not-found.
     The probe reproduced exact actual `404 runtime_session_not_found` versus
     expected `422 runtime_apply_rejected`.
  2. Recovery Maker changed only coordinator-error normalization and one
     focused route regression. `wrong_session` remained not-found;
     `wrong_room` mapped to `422 runtime_apply_rejected` only for runtime apply.
     Five focused tests passed with 51 assertions and Checker001's exact probe
     reported the expected status/code pair.
  3. Fresh independent Recovery Checker matched all 22 Maker002 manifest
     entries and passed strict TypeScript, the 36-source boundary check, all
     five focused tests, Checker001's exact probe, OpenAPI snapshot check, and
     a four-case narrowness probe. Wrong-Room apply returns 422; wrong Session,
     missing Session query, and non-apply wrong-Room remain 404.
- Security/data impact: no secret, user data, raw media, Provider, SQLite,
  Python oracle, `output/`, or `promo/` content was read or changed. Returned
  details remain bounded and secret-safe.
- Current evidence:
  - `.omx/artifacts/typescript-bun/BCK-007/bck-007-checker-20260803-001/`
  - `.omx/artifacts/typescript-bun/BCK-007/bck-007-maker-20260803-002/`
  - `.omx/artifacts/typescript-bun/BCK-007/bck-007-checker-20260803-003/`
- Resolution condition: satisfied. Different-Room runtime apply maps to
  `422 runtime_apply_rejected`; genuine missing-Session paths retain 404; one
  focused regression and independent targeted verification pass.
- Recovery task or decision: complete only `BCK-007`; promote but do not start
  `BCK-008`.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `bck-007-checker-20260803-003`.
- Residual limitation: none for this blocker.

## `BCK-006-APPLY-ID-OPERATION-ALIAS` - `BCK-006` - apply ID omits operation and rollback target identity

- Status: `RESOLVED`
- First seen: 2026-08-02
- Last updated: 2026-08-03
- Owner: `bck-006-checker-20260802-002`
- Task claim blocked: `apply_id` identity includes the actual operation,
  canonical content, base revision, and rollback target semantics; exact replay
  is idempotent while every conflicting reuse fails closed.
- Error signature: `BCK006_APPLY_ID_OPERATION_TARGET_ALIAS`.
- Environment:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  dirty worktree; Bun `1.3.14`; all 22 Maker manifest hashes match.
- Why this is a blocker: `RuntimeSpecRecord` stores `applyId`, base revision,
  and canonical content but no operation discriminator or rollback target.
  `#requireMatchingApply` therefore compares only Room, Session, base revision,
  and canonical JSON. A prior apply ID can be reused as a rollback ID when the
  selected target contains the same canonical spec, and a rollback ID can be
  reused with a different target revision when both targets contain identical
  canonical specs. Both conflicts return the prior committed record rather
  than `apply_id_conflict`, so a caller can be told an intended rollback was
  idempotently satisfied even though that command identity never committed.
- Attempts:
  1. Fresh independent Checker passed strict typecheck, the 34-source boundary
     check, and all seven focused tests with 75 assertions. Its compact runtime
     probe then reused `shared-id` across apply and rollback and observed
     `accepted:2:true`; it also reused `rollback-id` with target revision `1`
     changed to `3` while both targets held the same full spec and observed
     `accepted:3:true`. Both cases required `rejected:apply_id_conflict`.
     Evidence:
     `.omx/artifacts/typescript-bun/BCK-006/bck-006-checker-20260802-001/`.
  2. Recovery Maker `bck-006-maker-20260802-002` added explicit persisted
     `bootstrap`/`apply`/`rollback` operation identity and exact nullable
     rollback target revision to every runtime revision. Apply-ID matching now
     compares both fields in addition to Room, Session, base revision, and
     canonical content. Exactly the two Checker001 regressions now reject
     cross-operation and changed-target reuse with `apply_id_conflict`; exact
     apply and rollback replays remain idempotent. Strict typecheck, the
     34-source boundary check, nine focused tests with 85 assertions, and the
     live plan check pass. This is a recovery candidate only: the blocker
     remains `ACTIVE`, `same_blocker_attempts=1`, and a fresh Checker must
     accept it. Evidence:
     `.omx/artifacts/typescript-bun/BCK-006/bck-006-maker-20260802-002/`.
  3. Fresh Recovery Checker `bck-006-checker-20260802-002` matched all 19
     Maker002 manifest entries, passed strict typecheck, the 34-source boundary
     check, and nine focused tests with 85 assertions. Its independent probe
     reran both original aliases and observed `rejected:apply_id_conflict` for
     each, while exact apply and exact rollback replay returned the original
     committed record. Evidence:
     `.omx/artifacts/typescript-bun/BCK-006/bck-006-checker-20260802-002/`.
- Security/data impact: the probe uses only synthetic in-memory specs and fake
  ports. No secret, credential, Provider, user data, raw media, `output/`, or
  `promo/` content was read or changed. No dependency/lock, Python oracle,
  product repair, downstream task, commit, push, or deploy occurred.
- Current evidence:
  - `checker-probe.ts`
  - `checker-probe.json`
  - `typecheck.txt`
  - `boundary-check.txt`
  - `focused-tests.txt`
  - `plan-check-final.txt`
  - `validation.json`
  - `.omx/artifacts/typescript-bun/BCK-006/bck-006-checker-20260802-002/`
- Resolution condition: bind every `apply_id` to an explicit operation identity
  and bind rollback identities to the exact target revision (or an equivalent
  collision-resistant command fingerprint), then reject both reproduced
  conflicting reuses while preserving exact same-command replay.
- Recovery task or decision: closed by Recovery Maker002 and Recovery
  Checker002; normal task order resumes at `BCK-007`.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `bck-006-checker-20260802-002`.
- Residual limitation: none.

## `BCK-001-UNCLASSIFIED-ROOT-BOUNDARY-BYPASS` - `BCK-001` - unclassified source roots bypass dependency boundaries

- Status: `RESOLVED`
- First seen: 2026-08-02
- Last updated: 2026-08-02
- Owner: `bck-001-checker-20260802-002`
- Task claim blocked: enforce domain/application inward-only imports, lateral
  adapter isolation, and adapter wiring only from explicit composition roots.
- Error signature: `BCK001_UNCLASSIFIED_ROOT_IMPORT_BYPASS`.
- Environment:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  dirty worktree; Bun `1.3.14`; all 19 Maker manifest hashes match.
- Why this is a blocker: the compiler-API checker skips any source whose first
  path segment is not one of its named layers. A domain fixture importing
  `../app` therefore records zero violations, and a root `rogue.ts` importing
  `./infrastructure/adapter` also records zero violations. This permits an
  inner layer to reach outward through an unclassified module and permits
  undeclared composition roots, so the stated boundary policy is not
  enforceable.
- Attempts:
  1. Fresh independent Checker ran the accepted production checks and a compact
     nine-case fixture probe. Seven representative inner/outward forbidden
     directions were rejected, but both unclassified-root cases passed with
     zero violations. The fake-backed application probe separately imported
     both entry files, returned the expected profile, and observed zero
     `Bun.spawn` and `Bun.serve` calls. Evidence:
     `.omx/artifacts/typescript-bun/BCK-001/bck-001-checker-20260802-001/`.
  2. Recovery Maker `bck-001-maker-20260802-002` defined the exact composition
     roots as `app.ts`, `main.ts`, and `index.ts`, rejected imports of those
     roots from every named layer, and rejected every other root production
     source. The only added regression cases are Checker001's original
     `domain/invalid.ts -> ../app` and
     `rogue.ts -> ./infrastructure/adapter` fixtures; both now produce exactly
     one violation. All 17 unchanged production sources were freshly hashed;
     strict typecheck, production boundaries, six focused tests, and the direct
     two-case reproduction pass. This is a recovery candidate only: the
     blocker remains `ACTIVE`, `same_blocker_attempts=1`, and a fresh Checker
     must accept it. Evidence:
     `.omx/artifacts/typescript-bun/BCK-001/bck-001-maker-20260802-002/`.
  3. Fresh independent Recovery Checker `bck-001-checker-20260802-002`
     reproduced both original cases. Each now yields exactly one violation;
     all 17 production source hashes and 13 unchanged Maker001 evidence hashes
     match, and the targeted command set passes. Evidence:
     `.omx/artifacts/typescript-bun/BCK-001/bck-001-checker-20260802-002/`.
- Security/data impact: no secret, credential, Provider, user-data, raw media,
  `output/`, or `promo/` content was read or changed. No dependency/lock,
  Python oracle, accepted OpenAPI snapshot, implementation, commit, push,
  deploy, or downstream task change occurred.
- Current evidence:
  - `checker-probe.ts`
  - `checker-probe.json`
  - `checker-probe.txt`
  - `typecheck.txt`
  - `boundary-check.txt`
  - `focused-tests.txt`
  - `checker-probe.ts`
  - `checker-probe.json`
  - `checker-probe.txt`
  - `plan-check-final.txt`
- Resolution condition: classify every non-test source under the package or
  enforce a closed allowlist of explicit composition-root files, then reject
  both the domain-to-unclassified-root route and an undeclared root adapter
  import while retaining the accepted layer-direction cases.
- Recovery task or decision: resolved; promote only `BCK-002` to `READY`.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `bck-001-checker-20260802-002`.
- Residual limitation: dynamic-import hardening was not required to establish
  this blocker and was not added to the compact fixture set.

## `GATE-01-OPENAPI-SNAPSHOT-DRIFT` - `GATE-01` - TypeScript OpenAPI snapshot is stale

- Status: `RESOLVED`
- First seen: 2026-08-01
- Last updated: 2026-08-02
- Owner: `gate-01-checker-20260802-003`
- Task claim blocked: GATE-01 criterion 7, OpenAPI/Scalar generated from the
  canonical TypeScript contract path with a deterministic current snapshot.
- Error signature: `GATE01_OPENAPI_SNAPSHOT_DIFF_AT_35647`.
- Environment:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  dirty worktree; Bun `1.3.14`.
- Why this was a blocker: the stale checked-in snapshot SHA-256 was
  `12499b4dbbabca40ae60475c642bc37922fd2d4231f5b256be1af8a2d4b134e6`,
  while the deterministic TypeScript generator produced `955b8164...` and the
  stale AI-call enum retained `queued`/`running` instead of the canonical
  `preparing`/`sent` values.
- Attempts:
  1. Checker001 matched all protected boundaries and accepted receipts, but its
     compact gate probe rejected criterion 7 at byte offset 35647. Evidence:
     `.omx/artifacts/typescript-bun/GATE-01/gate-01-checker-20260801-001/`.
  2. Recovery Maker002 regenerated only the deterministic TypeScript snapshot;
     targeted typecheck, OpenAPI check, 36 unaffected hashes, and ten accepted
     receipts passed. Evidence:
     `.omx/artifacts/typescript-bun/GATE-01/gate-01-maker-20260801-002/`.
  3. Fresh independent Recovery Checker003 verified both predecessor manifests,
     all 36 unaffected protected hashes, all ten accepted receipt hashes, the
     exact corrected `AiCallStatus` set, and byte-identical snapshot/generator
     SHA-256 `955b8164...`. Strict backend-Bun typecheck, focused OpenAPI check,
     compact current-hash/gate probe, and final plan check pass. Evidence:
     `.omx/artifacts/typescript-bun/GATE-01/gate-01-checker-20260802-003/`.
- Security/data impact: no secret, credential, Provider, user-data, raw media,
  `output/`, or `promo/` content was read or changed. No commit, push, deploy,
  dependency/lock mutation, Python deletion, or downstream implementation
  occurred.
- Current evidence:
  - `checker-probe.ts`
  - `checker-probe.json`
  - `typecheck.txt`
  - `openapi-check.txt`
  - `source-cursor-receipt.json`
  - `validation.json`
  - `verdict.json`
  - `plan-check-final.txt`
  - `manifest.sha256`
- Resolution condition: satisfied. The checked-in snapshot exactly equals the
  current deterministic TypeScript generator output and the focused drift check
  remains green against matching accepted boundaries.
- Recovery task or decision: none. `BCK-001` is promoted to `READY` but was not
  started by the Checker.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `gate-01-checker-20260802-003`.
- Residual limitation: this gate reuses accepted `CON-001..010` proof and does
  not claim live Provider/platform behavior or any Phase 02 implementation.

## `CON-009-AI-CALL-STATUS-REGRESSION-COVERAGE-GAP` - `CON-009` - changed AI-call status enum lacks an exact-set regression

- Status: `RESOLVED`
- First seen: 2026-08-01
- Last updated: 2026-08-01
- Owner: `con-009-checker-20260801-002`
- Task claim blocked: accept the cross-runtime parity suite together with
  focused regression coverage for the TypeScript `AiCallStatus` correction.
- Error signature: `CON009_AI_CALL_STATUS_EXACT_SET_TEST_MISSING`.
- Environment:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  Bun `1.3.14`; Recovery Maker002's changed-source hash and all 18 protected
  production/parity/oracle/manifest/lock/evidence hashes match.
- Why this was a blocker: the implementation matched the retained Python
  Pydantic enum and generated Python OpenAPI authority exactly, but the first
  candidate had no focused exact-set regression. The parity synthesizer
  selected only the first enum member, so it could not detect missing or extra
  values among the other eight.
- Attempts:
  1. Fresh independent Checker reproduced `bun run test:contract-parity`,
     contracts strict typecheck, all 24 existing schema assertions, focused
     Ruff, and the live plan check. A compact 16-check probe passed the other
     15 acceptance boundaries and failed only the missing exact-set regression.
     No implementation repair was made. Evidence:
     `.omx/artifacts/typescript-bun/CON-009/con-009-checker-20260801-001/`.
  2. Recovery Maker `con-009-maker-20260801-002` imported
     `aiCallStatusSchema` into the focused schema test and added one exact-set
     regression for all nine retained Python-authoritative values, runtime
     acceptance, and rejection of representative extra value `unknown`.
     Contracts strict typecheck and all 25 focused assertions passed. Evidence:
     `.omx/artifacts/typescript-bun/CON-009/con-009-maker-20260801-002/`.
  3. Fresh independent Recovery Checker002 matched the repaired test and all
     protected hashes, reran contracts strict typecheck and the 25 focused
     assertions, and passed a Checker-owned probe against the exact TypeScript,
     Python, and generated-authority nine-value set plus `unknown` rejection.
     Checker001's 15 accepted parity/security/process boundaries were reused;
     the parity matrix was not rerun. Evidence:
     `.omx/artifacts/typescript-bun/CON-009/con-009-checker-20260801-002/`.
- Security/data impact: no credential sentinel, Provider credential field, or
  raw image data URL escaped into the Checker report or artifacts. No private
  recording, screenshot, Provider payload, `output/`, or `promo/` content was
  read or changed.
- Current evidence:
  - `.omx/artifacts/typescript-bun/CON-009/con-009-checker-20260801-002/checker-probe.json`
  - `.omx/artifacts/typescript-bun/CON-009/con-009-checker-20260801-002/source-receipt.json`
  - `.omx/artifacts/typescript-bun/CON-009/con-009-checker-20260801-002/schema-test.txt`
  - `.omx/artifacts/typescript-bun/CON-009/con-009-checker-20260801-002/typecheck.txt`
  - `.omx/artifacts/typescript-bun/CON-009/con-009-checker-20260801-001/contract-parity-report.json`
- Resolution condition: satisfied. The focused regression locks the exact
  nine-value authority and rejects representative extra `unknown`; the fresh
  Checker reproduced the targeted gate.
- Recovery task or decision: resolved; only `CON-010` may be promoted next.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `con-009-checker-20260801-002`.
- Residual limitation: synthetic deterministic parity only; no live Provider
  or platform behavior is claimed.

## `CON-006-BINARY-BINDING-DIRECTION-REGISTRY-GAP` - `CON-006` - accepted binary bindings omit direction metadata

- Status: `RESOLVED`
- First seen: 2026-08-01
- Last updated: 2026-08-01
- Owner: `con-006-checker-20260801-002`
- Task claim blocked: publish the exact six accepted ADVX-BIN v1/v2/v3
  audio/frame bindings through a typed direction/media/source registry.
- Error signature: `CON006_BINDING_DIRECTION_METADATA_MISSING`.
- Environment:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  Bun `1.3.14`; Maker001 source receipt SHA256
  `724f7238492acf3f2b15599b4416d56194463bdd8fba96b53645538902b293ca`;
  all 18 changed/protected hashes match.
- Why this is a blocker: `advxBinaryCodecRegistry` publishes typed
  `id`, `version`, `binding`, `mediaType`, and compatibility `mode`, but its
  interface and six records have no `direction`. The accepted contract
  inventory defines all six as `client-to-backend`, and the explicit Checker
  acceptance target requires typed direction metadata. This is a concrete
  contract-registry omission, not an optional browser or hardening claim.
- Attempts:
  1. Fresh Checker source inspection plus a 35-check compact byte/negative
     probe reproduced one exact failure: `binding direction registry`; the
     other 34 checks passed, including all six/665 fixture bytes, required
     parser failures, opaque body handling, and unsigned-64 boundaries.
  2. Recovery Maker `con-006-maker-20260801-002` added the typed literal
     `direction: 'client-to-backend'` field to `AdvxBinaryCodecBinding` and all
     exact six registry records, plus only the focused six-unique-ID and exact
     direction assertion. Contracts typecheck, all focused package tests, a
     bounded six-record direction probe, and the live plan check pass.
     Checker001's accepted binary/parity/negative/portability evidence remains
     applicable because codec bytes, fixtures, parsing, the Python oracle, and
     portability sources are unchanged. The candidate is in `VERIFY`; the
     blocker remains `ACTIVE` pending fresh independent Checker evidence:
     `.omx/artifacts/typescript-bun/CON-006/con-006-maker-20260801-002/`.
  3. Fresh independent Checker `con-006-checker-20260801-002` matched all 15
     Maker002 changed/control/protected hashes, inspected the typed literal,
     passed contracts typecheck and all focused package tests, and matched six
     unique registry records and directions to the exact six accepted inventory
     bindings. Checker001's accepted unchanged binary/parity/negative/
     portability evidence remains applicable.
- Security/data impact: no credential, Provider, user-data, raw recording,
  `output/`, or `promo/` content was read or changed. The Python oracle,
  desktop adapter, dependencies, locks, and accepted evidence remain intact.
- Current evidence:
  - `.omx/artifacts/typescript-bun/CON-006/con-006-checker-20260801-001/checker-probe.ts`
  - `.omx/artifacts/typescript-bun/CON-006/con-006-checker-20260801-001/verdict.json`
  - `.omx/artifacts/typescript-bun/CON-006/con-006-checker-20260801-001/README.md`
  - `.omx/artifacts/typescript-bun/CON-006/con-006-checker-20260801-002/source-receipt.json`
  - `.omx/artifacts/typescript-bun/CON-006/con-006-checker-20260801-002/verdict.json`
  - `.omx/artifacts/typescript-bun/CON-006/con-006-checker-20260801-002/inventory-direction-probe.txt`
- Resolution condition: add typed direction metadata bound to each of the
  exact six accepted registry records without changing codec bytes or the
  retained Python oracle, then pass the same focused package, fixture,
  negative, Bun/Node/browser portability, and plan checks under a fresh Maker
  and distinct Checker.
- Recovery task or decision: completed and independently accepted; only
  `CON-007` is promoted to `READY`, but it was not started by this Checker.
- Accepted limitation authority/scope/expiry: none; product contract metadata
  cannot be waived here.
- Resolved by run: `con-006-checker-20260801-002`.
- Residual limitation: live WS hub integration, desktop adapter migration,
  CON-007, and CON-010 remain outside this task and were not claimed.

## `CON-005-PAIRED-AUDIO-TURN-IDENTITY-GAP` - `CON-005` - late-final branch bypasses shared turn identity

- Status: `RESOLVED`
- First seen: 2026-08-01
- Last updated: 2026-08-01
- Owner: `con-005-checker-20260801-002`
- Task claim blocked: paired audio validates one shared `turn_id`, one stable
  trigger/idempotency identity, coherent required/degraded state, and a
  persisted late system-audio final that cannot authorize a second
  ObservationWave.
- Error signature: `CON005_LATE_FINAL_BYPASSES_SHARED_TURN_IDENTITY`.
- Environment:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  Bun `1.3.14`; the failing `payloads.ts` hash matches Maker001's source
  receipt.
- Why this is a blocker: `pairedAudioTurnPayloadSchema` returns the late-final
  persistence-ID comparison from inside the degraded branch. That successful
  early return skips the later invariant requiring the one
  `observation_trigger.trigger_id` to equal the aggregate `turn_id`. A payload
  with aggregate `turn_id=turn-1` and equal trigger/idempotency values
  `turn-2` therefore validates whenever its late-final persistence IDs agree.
  This is a concrete paired-audio protocol-compatibility failure, not optional
  hardening.
- Attempts:
  1. Fresh independent Checker `con-005-checker-20260801-001` passed contracts
     typecheck, all 24 focused tests, the 19-family Python Pydantic oracle, and
     the live pre-closeout plan check. A Checker-owned compact probe confirmed
     the other deciding inventory, envelope, semantic, version, serialization,
     legacy-export, and paired-audio cases, then exited `1` only because the
     mismatched shared turn identity above was accepted. Evidence:
     `.omx/artifacts/typescript-bun/CON-005/con-005-checker-20260801-001/`.
  2. Recovery Maker `con-005-maker-20260801-002` moved the aggregate
     trigger/idempotency-to-`turn_id` check ahead of every branch and added the
     exact degraded late-final cross-turn regression. The valid same-turn late
     final remains accepted, the existing literal second-wave case remains
     rejected, and contracts typecheck, all focused tests, the bounded blocker
     probe, and the live plan check pass. The candidate is in `VERIFY`; the
     blocker remains `ACTIVE` pending fresh independent Checker evidence:
     `.omx/artifacts/typescript-bun/CON-005/con-005-maker-20260801-002/`.
  3. Fresh independent Checker `con-005-checker-20260801-002` matched both
     Maker002 changed-source hashes and the protected pre-closeout evidence,
     generated OpenAPI, and manager locks. Direct source inspection confirms
     the trigger/idempotency-to-aggregate-`turn_id` check executes before every
     paired-audio branch. Strict contracts typecheck, all 24 focused tests, and
     a Checker-owned bounded three-case probe pass: the valid same-turn
     degraded late final remains accepted and persisted, the exact cross-turn
     late final is rejected, and literal second-wave authorization is rejected.
     Checker001's accepted unchanged protocol boundaries were reused without
     rerunning the Python oracle. Evidence:
     `.omx/artifacts/typescript-bun/CON-005/con-005-checker-20260801-002/`.
- Security/data impact: no credential, raw media, private recording, or secret
  value was read or serialized. The failure can mis-associate an observation
  trigger with the wrong paired-audio turn and weaken idempotent wave
  authorization.
- Current evidence:
  - `.omx/artifacts/typescript-bun/CON-005/con-005-checker-20260801-002/paired-audio-probe.ts`
  - `.omx/artifacts/typescript-bun/CON-005/con-005-checker-20260801-002/paired-audio-probe.txt`
  - `.omx/artifacts/typescript-bun/CON-005/con-005-checker-20260801-002/verdict.json`
  - `.omx/artifacts/typescript-bun/CON-005/con-005-checker-20260801-002/source-receipt.json`
- Resolution condition: make every paired-audio validation path enforce the
  shared aggregate `turn_id` against the single trigger/idempotency identity,
  retain late-final persistence/coherence and literal non-authorization, add a
  focused regression for this exact degraded late-final case, and pass the four
  bounded CON-005 checks plus a fresh independent compact probe.
- Recovery task or decision: completed and independently accepted; only
  `CON-006` is promoted to `READY`, but it was not started by this Checker.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `con-005-checker-20260801-002`.
- Residual limitation: no live WebSocket hub, binary codec, OpenAPI generation,
  runtime/desktop behavior, CON-010 negotiation/rejection, or `CON-006` claim is
  included.

## `CON-004-HTTP-BOUNDARY-COMPLETENESS-GAP` - `CON-004` - accepted HTTP request and success boundaries are incomplete

- Status: `RESOLVED`
- First seen: 2026-08-01
- Last updated: 2026-08-01
- Owner: `con-004-checker-20260801-002`
- Task claim blocked: `CON-004` requires every accepted HTTP control-plane route to have its retained
  request boundary, success-status schema, and normalized error records, while
  every Provider credential input is contained in a declared nonserializable
  controlled-secret boundary.
- Error signature: `CON004_PROVIDER_PROBE_SECRET_BOUNDARY_AND_SUCCESS_STATUS_GAP`.
- Environment:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  Bun `1.3.14`; dirty Maker source identity is recorded in the Checker artifact.
- Why this is a blocker: the retained Python
  `POST /configuration/providers/probe` accepts
  `ProviderConfigurationRequest | None`; the request model carries Provider
  credential inputs. The new operation registry instead gives that route a
  public `{ provider_profile_id? }` body and marks only
  `PUT /configuration/providers` as a nonserializable controlled-secret
  boundary. This removes an accepted probe input mode rather than representing
  it through the required secret boundary. Separately, accepted
  `POST /sessions` declares only a `409` response schema, so the per-route
  success-status criterion is not satisfied.
- Attempts:
  1. Fresh independent Checker `con-004-checker-20260801-001` matched all 14
     Maker changed-source hashes, passed contracts typecheck and all 21 focused
     tests, then ran a Checker-owned compact protocol-safety probe. The probe
     confirmed `47/47` exact routes, 21 Shared Brain routes, and 47 unique IDs,
     but exited `1` with exactly the two boundary failures above. The live
     pre-closeout plan checker passed. Evidence:
     `.omx/artifacts/typescript-bun/CON-004/con-004-checker-20260801-001/`.
  2. Recovery Maker `con-004-maker-20260801-002` repaired only the two rejected
     boundaries. Legacy `POST /sessions` now declares its `200` null response
     schema alongside the retained normalized `409` contract. Provider probe
     now uses a nonserializable controlled-secret boundary whose public
     metadata is exactly the optional profile-ID request and rejects
     credentials, raw media, and representative Provider wire payloads.
     Contracts typecheck, all 21 focused tests, and the bounded protocol-safety
     probe pass with the unchanged 47 routes, 21 Shared Brain routes, and 47
     unique operation IDs. The blocker remains `ACTIVE` pending a fresh
     independent Checker. Evidence:
     `.omx/artifacts/typescript-bun/CON-004/con-004-maker-20260801-002/`.
  3. Fresh independent Checker `con-004-checker-20260801-002` matched both
     Maker002 changed-source hashes and all protected hashes, passed strict
     contracts typecheck and all 21 focused tests, and ran an independently
     generated compact protocol-safety probe. The probe passed with the exact
     47 accepted method/path bindings, 21 Shared Brain bindings, 47 unique
     operation IDs, explicit 2xx schemas and normalized error records on every
     route, the actual `POST /sessions` `200` null schema plus normalized `409`,
     the nonserializable Provider-probe controlled-secret boundary, strict
     optional profile-ID public metadata, and representative runtime/replay
     safety. Evidence:
     `.omx/artifacts/typescript-bun/CON-004/con-004-checker-20260801-002/`.
- Security/data impact: no credential value was read or written. The gap is a
  protocol-compatibility and secret-boundary declaration failure; public
  schemas continue to reject representative secret/raw-media fields.
- Current evidence:
  - `.omx/artifacts/typescript-bun/CON-004/con-004-checker-20260801-002/protocol-safety-probe.ts`
  - `.omx/artifacts/typescript-bun/CON-004/con-004-checker-20260801-002/protocol-safety-probe.txt`
  - `.omx/artifacts/typescript-bun/CON-004/con-004-checker-20260801-002/verdict.json`
  - `.omx/artifacts/typescript-bun/CON-004/con-004-checker-20260801-002/source-receipt.json`
- Resolution condition: represent every retained Provider credential-bearing
  input, including the capability-probe input mode, as a nonserializable
  controlled-secret boundary whose public metadata rejects secret fields; and
  make the per-route response contract explicitly satisfy or correctly scope
  the success-status requirement for `POST /sessions`. A fresh independent
  Checker must rerun the four bounded CON-004 checks.
- Recovery task or decision: completed and independently accepted; only
  `CON-005` is promoted to `READY`, but it was not started by this Checker.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `con-004-checker-20260801-002`.
- Residual limitation: no `CON-005`, `CON-006`, `CON-007`, cross-runtime parity,
  generated OpenAPI/Scalar, or `GATE-01` claim is included in this resolution.

## `CON-002-STRICT-OBJECT-PROTOTYPE-KEY-GAP` - `CON-002` - strict objects accept inherited prototype names

- Status: `RESOLVED`
- First seen: 2026-07-31
- Last updated: 2026-07-31
- Owner: `con-002-checker-20260731-002`
- Task claim blocked: strict object declarations reject every unknown own key
  consistently in runtime validation and emitted JSON Schema.
- Error signature: `STRICT_OBJECT_ACCEPTS_PROTOTYPE_NAMED_UNKNOWN_KEYS`.
- Environment:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  Bun `1.3.14`; dirty source identity and protected hashes are sealed in the
  Checker artifact.
- Why this is a blocker: `schema.object` checks unknown keys with
  `key in properties`. For a normal declaration object, inherited
  `Object.prototype` names therefore appear present even when not declared.
  A schema containing only `id` accepts own enumerable `toString`,
  `constructor`, and `__proto__` input keys, then silently omits them from the
  parsed result. This violates the documented strict-object contract and
  disagrees with emitted `additionalProperties: false`.
- Attempts:
  1. Fresh independent Checker `con-002-checker-20260731-001` reproduced all
     three false accepts in one bounded runtime probe. Contracts typecheck and
     all eight focused tests still pass, proving the existing focused suite
     misses this accepted-unknown-key class. Maker manifest/source integrity,
     dependency and fixture boundaries, legacy/generated isolation, and
     protected hashes otherwise pass. Evidence:
     `.omx/artifacts/typescript-bun/CON-002/con-002-checker-20260731-001/`.
  2. Recovery Maker `con-002-maker-20260731-002` replaced declaration and input
     membership checks with `Object.hasOwn`. One focused regression rejects own
     enumerable `toString`, `constructor`, and `__proto__` keys with exact
     paths and proves an inherited required `id` remains missing. Contracts
     typecheck and all nine focused tests pass. Evidence:
     `.omx/artifacts/typescript-bun/CON-002/con-002-maker-20260731-002/`.
  3. Fresh independent Checker `con-002-checker-20260731-002` verified the
     Maker002 manifest, actual changed-source hashes, protected artifacts, and
     the exact own-property source checks. Its bounded runtime probe rejects
     own enumerable `toString`, `constructor`, and `__proto__` at exact paths
     and rejects an inherited `id` as missing. Contracts typecheck and all nine
     focused tests pass. Evidence:
     `.omx/artifacts/typescript-bun/CON-002/con-002-checker-20260731-002/`.
- Security/data impact: no product implementation, production test, lockfile,
  dependency, Python oracle, parity suite, credential, private media,
  `output/`, or `promo/` content was modified or inspected.
- Current evidence:
  - `raw/strict-object-probe.txt`
  - `raw/contracts-typecheck.txt`
  - `raw/contracts-test.txt`
  - `source-receipt-verification.json`
  - `verdict.json`
  - `manifest.sha256`
  - Candidate `source-receipt.json`
  - Candidate `verification-report.json`
  - Candidate `manifest.sha256`
  - Checker002 `raw/strict-object-probe.txt`
  - Checker002 `raw/contracts-typecheck.txt`
  - Checker002 `raw/contracts-test.txt`
  - Checker002 `source-receipt-verification.json`
  - Checker002 `verdict.json`
  - Checker002 `manifest.sha256`
- Resolution condition: satisfied. Own-property membership now governs declared
  properties and input required fields, and the independent probe proves exact
  rejection without weakening focused type/runtime checks.
- Recovery task or decision: none. `CON-002` is accepted; only the next
  canonical task `CON-003` may start in a later cycle.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `con-002-checker-20260731-002`.
- Residual limitation: the Checker did not require complete JSON Schema
  implementation or any `CON-003..007` payload schema.

## `FND-012-DEPENDENCY-READINESS-SCHEMA-GAP` - `FND-012` - checker accepts invalid dependency ranges and unsatisfied dependencies

- Status: `RESOLVED`
- First seen: 2026-07-30
- Last updated: 2026-07-30
- Owner: `fnd-012-checker-20260730-003`
- Task claim blocked: the migration drift checker rejects invalid dependency
  ranges and prevents a task or gate from advancing until every declared
  dependency is `DONE`, except an explicitly permitted exact
  `ACCEPTED_LIMITATION`.
- Error signature:
  `REVERSED_DEPENDENCY_RANGE_ACCEPTED`;
  `UNSATISFIED_GATE_DEPENDENCY_ACCEPTED`;
  `UNSATISFIED_TASK_DEPENDENCY_ACCEPTED`.
- Environment:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  exact dirty source identity is sealed in the Checker artifact; Bun `1.3.14`.
- Why this is a blocker: the dependency parser accepts descending ranges as
  empty dependency sets, and the execution rules validate phase-entry gates
  without validating each advanced row's declared dependencies. Consequently,
  `FND-012..010`, `GATE-00=READY` while `FND-012=VERIFY`, and
  `FND-012=VERIFY` while `FND-010=TODO` each return `passed` with zero errors.
  This contradicts `PROMPT.md` and `LOOP.md`, which require selected and
  promoted tasks to have `DONE` dependencies.
- Attempts:
  1. Fresh independent Checker `fnd-012-checker-20260730-002` verified the
     Maker002 manifest `20/20` and its exact reported SHA256, strict focused
     TypeScript, all `44/44` focused tests, the live 133-task read-only report,
     protected `7/7` migration parity, CLI exit `0/1/2`, and `42/45`
     Checker-owned hostile cases plus all `9/9` LOOP transition rows. The
     repaired closed inventory, including add/remove-both-documents cases, is
     accepted. The three dependency false negatives above reproduce in
     isolated copies without rewriting any document. Evidence:
     `.omx/artifacts/typescript-bun/FND-012/fnd-012-checker-20260730-002/`.
  2. Recovery Maker `fnd-012-maker-20260730-003` rejects descending, empty,
     malformed-width, and unknown-prefix ranges; validates every declared
     dependency for all five advanced non-terminal/terminal work statuses; and
     scopes `ACCEPTED_LIMITATION` to the exact Gate External Conditions pair.
     All `48/48` focused tests, strict TypeScript, and the live 133-task
     read-only check pass.
     The candidate returned only `FND-012` to `VERIFY`; the blocker remains
     `ACTIVE` pending a fresh independent Checker. Evidence:
     `.omx/artifacts/typescript-bun/FND-012/fnd-012-maker-20260730-003/`.
  3. Fresh independent Checker `fnd-012-checker-20260730-003` verified the
     Maker003 manifest and exact source receipt, strict TypeScript, all `48/48`
     focused tests, and the live 133-task read-only check. Three isolated
     fixtures now reject descending `FND-012..010`, `GATE-00=READY` while
     `FND-012=VERIFY`, and `FND-012=VERIFY` while `FND-010=TODO`. Source and
     focused-test inspection confirm `ACCEPTED_LIMITATION` is accepted only for
     the exact Gate External Conditions pair. Evidence:
     `.omx/artifacts/typescript-bun/FND-012/fnd-012-checker-20260730-003/`.
- Security/data impact: no product runtime, Python oracle, parity harness,
  lockfile, patch, dependency, credential, private media, `output/`, or
  `promo/` content was modified or inspected.
- Current evidence:
  - `reports/verification.json`
  - `reports/verdict.json`
  - `raw/reversed-range.json`
  - `raw/gate-ready-fnd012-verify.json`
  - `raw/fnd012-verify-fnd010-todo.json`
- Resolution condition: reject descending or empty dependency ranges; reject
  any advanced task or gate whose declared dependency is not `DONE` unless the
  exact dependency explicitly permits `ACCEPTED_LIMITATION`; retain the
  accepted closed-inventory, blocker, evidence, link, cursor, gate, and
  transition checks; and return only `FND-012` to `VERIFY`.
- Recovery task or decision: a fresh recovery Maker repairs `FND-012` without
  starting `GATE-00`.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `fnd-012-checker-20260730-003`.
- Residual limitation: the drift checker validates the locked ADVX migration
  schema and control plane; it is not a general Markdown workflow framework.

## `FND-012-TASK-INVENTORY-SCHEMA-GAP` - `FND-012` - checker lacks a closed canonical task-ID inventory

- Status: `RESOLVED`
- First seen: 2026-07-30
- Last updated: 2026-07-30
- Owner: `fnd-012-checker-20260730-002`
- Task claim blocked: the migration drift checker rejects missing, duplicate,
  and unknown task IDs across the canonical master plan and phase-owned task
  definitions.
- Error signature:
  `WELL_FORMED_UNKNOWN_MASTER_TASK_ACCEPTED`;
  `CANONICAL_LEAF_TASK_REMOVAL_ACCEPTED`;
  `DUPLICATE_ACTIVE_BLOCKER_RECORD_ACCEPTED`.
- Environment:
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;
  dirty source identity is sealed in the Checker artifact; Bun `1.3.14`.
- Why this was a blocker: Maker001 derived known IDs solely from the mutable
  master table, allowing a valid extra `FND-999`, removal of `CUT-014` with a
  narrowed `GATE-09` range, and a duplicated ACTIVE blocker record.
- Attempts:
  1. Fresh independent Checker `fnd-012-checker-20260730-001` verified the
     Maker manifest and core gates, then reproduced all three false negatives
     in isolated copies. Evidence:
     `.omx/artifacts/typescript-bun/FND-012/fnd-012-checker-20260730-001/`.
  2. Recovery Maker `fnd-012-maker-20260730-002` added an explicit code-owned
     per-phase inventory for all 133 canonical task/gate IDs and exact
     numbered-document heading validation. Evidence:
     `.omx/artifacts/typescript-bun/FND-012/fnd-012-maker-20260730-002/`.
  3. Fresh independent Checker `fnd-012-checker-20260730-002` proved the exact
     133-ID master and per-phase inventories, rejected valid added and removed
     IDs even when both master and phase documents changed together, rejected
     duplicate ACTIVE records and all required heading mutations, and confirmed
     the source inventory is code-owned rather than derived from mutable
     documents. Evidence:
     `.omx/artifacts/typescript-bun/FND-012/fnd-012-checker-20260730-002/`.
- Security/data impact: no product runtime, Python oracle, parity harness,
  lockfile, patch, dependency, credential, private media, `output/`, or
  `promo/` content was modified or inspected.
- Current evidence:
  - Checker002 `reports/independent-matrix.json`
  - Checker002 `reports/maker-manifest-verification.json`
  - Maker002 `reports/hostile-matrix.json`
- Resolution condition: satisfied.
- Recovery task or decision: none.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `fnd-012-checker-20260730-002`.
- Residual limitation: the separate dependency-readiness/schema blocker remains
  active; inventory repair alone does not make `FND-012` complete.

## `FND-004-SIGNAL-EXIT-CODE-MISMATCH` - `FND-004` - documented signal exit codes do not match Windows Bun-parent behavior

- Status: `RESOLVED`
- First seen: 2026-07-30
- Last updated: 2026-07-30
- Owner: `fnd-004-checker-20260730-002`
- Task claim blocked: the disposable compiled executable handles parent and OS
  termination with documented exit codes.
- Error signature:
  `STANDARD_SIGTERM_EXIT_143_NOT_DOCUMENTED_ZERO`;
  `BASELINE_SIGINT_EXIT_130_NOT_DOCUMENTED_ZERO`;
  `MAKER_VALIDATOR_OMITS_SIGNAL_CASES`.
- Environment: local Windows x64 AVX2-capable host,
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`,
  Bun `1.3.14` / `1.3.14+0d9b296af`.
- Why this was a blocker: Maker attempt 1 documented exit `0` for `SIGINT` and
  `SIGTERM`, while independent Bun-parent execution returned `130` and `143`;
  its validator did not exercise the mismatched cases.
- Attempts:
  1. Checker `fnd-004-checker-20260730-001` ran standard `SIGTERM` and baseline
     `SIGINT` from a Bun `1.3.14` parent with hostile cwd, empty child `PATH`,
     parent `BUN_BE_BUN=1`, sanitized child environment, bounded waits, and
     process-tree checks. Three observations reproduced standard `143` and
     baseline `130`, both bounded with no orphan. Evidence:
     `.omx/artifacts/typescript-bun/FND-004/fnd-004-checker-20260730-001/`.
  2. Recovery Maker `fnd-004-maker-20260730-002` corrected the contract:
     authenticated parent shutdown and real
     `GenerateConsoleCtrlEvent(CTRL_C_EVENT)` are application-handled exit-`0`
     paths, while all four Bun-parent forced-kill combinations are
     `SIGINT=130` and `SIGTERM=143`, not signal-handler proof. No graceful
     `SIGTERM` or `SIGBREAK` semantics are claimed. Targeted generation passed
     `212/212`; frozen validation passed `213/213`. Evidence:
     `.omx/artifacts/typescript-bun/FND-004/fnd-004-maker-20260730-002/`.
  3. Independent Checker `fnd-004-checker-20260730-002` verified all 49 Maker
     manifest entries, reran the frozen validator, produced bit-identical
     standard and baseline rebuilds, and independently exercised authenticated
     shutdown, real Windows Ctrl+C, and all four Bun-parent forced-kill cases.
     Its targeted validation passed `151/151`; every path was bounded and left
     no orphan. Evidence:
     `.omx/artifacts/typescript-bun/FND-004/fnd-004-checker-20260730-002/`.
- Security/data impact: no credentials, private media, user data, product code,
  Python oracle, lockfile, `docs/README.md`, `output/`, or `promo/` content was
  modified or inspected.
- Current evidence:
  - `reports/independent-verification.json`
  - `reports/official-source-verification.json`
  - `checker-report.md`
  - checker-owned hostile fixtures, profiles, bit-identical rebuilt
    executables, real Windows Ctrl+C reports, and integrity manifest
- Resolution condition: satisfied by recovery Maker
  `fnd-004-maker-20260730-002` and independent Checker
  `fnd-004-checker-20260730-002`.
- Recovery task or decision: complete `FND-004`; promote exactly `FND-005` to
  `READY`.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `fnd-004-checker-20260730-002`.
- Residual limitation: real `GenerateConsoleCtrlEvent(CTRL_C_EVENT)` proves the
  application Ctrl+C path for both targets. Bun-parent
  `child.kill('SIGINT'/'SIGTERM')` remains forced-termination evidence only.

## `FND-002-SEMANTIC-REGISTER-DIVERGENCE` - `FND-002` - invariant register does not faithfully freeze authoritative behavior

- Status: `RESOLVED`
- First seen: 2026-07-29
- Last updated: 2026-07-30
- Owner: `fnd-002-checker-20260730-005`
- Task claim blocked: the numbered register and machine-readable mirror preserve
  product behavior without reducing it to implementation details, and every
  current contradiction is explicitly classified as non-passing parity.
- Historical H1 error signature:
  `SECURITY_SOURCE_PRECEDENCE_AND_FRAMEWORK_FLAGS_PROMOTED`;
  `QUEUE_PRIORITY_SEMANTICS_REDUCED`;
  `CURRENT_WAVE_FENCE_CONTRADICTION_OMITTED`;
  `VIEWER_SILENCE_DEFAULT_NONPARITY_OMITTED`;
  `WINDOW_BATCH_MULTI_VIEWER_NONPARITY_OMITTED`;
  `PUBLICATION_COUNT_NONPARITY_OMITTED`;
  `MARKDOWN_JSON_SEMANTIC_MIRROR_DIVERGENCE`;
  `SEVEN_LINE_RANGES_BEYOND_EOF`.
- Current adjacent semantic error signature:
  `PROTOCOL_REPAIR_SIX_SECOND_GATE_OMITTED`;
  `DIRECT_PERSONA_TARGET_BUDGET_REDUCED`;
  `SYSTEM_AUDIO_SEGMENTATION_FIXED_PARAMETERS_OMITTED`;
  `H2_MACHINE_REGISTER_POINTER_STALE`.
- Environment: local Windows development worktree,
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Why this is a blocker: `FND-002` requires an architect or verifier to confirm
  that no product invariant was reduced to a framework implementation detail.
  The architect rejected that claim, and a separate verifier reproduced the
  decisive semantic, source, gap, mirror, and citation failures. The candidate
  therefore cannot enter accepted evidence or promote `FND-003`.
- Attempts:
  1. Architect run `fnd-002-checker-20260729-001` rejected the Maker candidate;
     independent verifier/recorder run `fnd-002-checker-20260729-002` reran the
     Maker validator and manifest, directly inspected the cited authority and
     oracle code, reproduced Markdown/JSON matches of statements `0/31`,
     sources `21/31`, normalized oracle paths `5/31`, proofs `27/31`, and found
     seven cited ranges extending beyond EOF. Evidence:
     `.omx/artifacts/typescript-bun/FND-002/fnd-002-checker-20260729-002/`.
  2. Maker run `fnd-002-maker-20260729-002` repaired the framework-neutral
     security rules, full priority semantics, current non-parity gaps,
     publication modality, and all invalid ranges. Its artifact-local parser
     reports exact Markdown/JSON matches of invariants `31/31`, gaps `18/18`,
     fixtures `5/5`, all 21 required families, 196 valid cited line segments,
     and every required contradiction as `NON_PASSING`. Evidence:
     `.omx/artifacts/typescript-bun/FND-002/fnd-002-maker-20260729-002/`.
     This is a candidate repair and does not resolve the blocker without a new
     independent Checker.
  3. Independent Checker run `fnd-002-checker-20260729-003` rebuilt the
     Markdown/JSON comparison without using the Maker generator and confirmed
     invariants `31/31`, gaps `18/18`, fixture classes `5/5`, all 178
     references, 196 line segments, 25 owners, the Maker manifest, and all
     required explicit contradictions structurally pass. The semantic audit
     still rejects the register: `INV-QUEUE-001` weakens required
     same-priority pending replacement with `MAY`; `INV-BUDGET-001` omits the
     fixed user/screen/ambient/direct budgets; `INV-PUB-002` drops the positive
     immediate-history insertion requirement; `INV-TRIG-002` omits the exact
     `0.2` threshold; and no current-non-parity gap records the product
     30-second Viewer TTL default versus current `0`, or the screen budget
     `ceil(active/4)` versus the current fixed default `4`. Evidence:
     `.omx/artifacts/typescript-bun/FND-002/fnd-002-checker-20260729-003/`.
      The same H1 blocker signature reached the maximum three attempts.
- H2 recovery hypothesis reset:
  - New error signature:
    `SAME_PRIORITY_PENDING_REPLACEMENT_WEAKENED`;
    `FIXED_RESPONSE_BUDGETS_REDUCED`;
    `PUBLISHED_HISTORY_POSITIVE_REQUIREMENT_DROPPED`;
    `EXACT_SCREEN_TRIGGER_THRESHOLD_REDUCED`;
    `VIEWER_TTL_DEFAULT_NONPARITY_OMITTED`;
    `SCREEN_BUDGET_NONPARITY_OMITTED`.
  - Reset basis: independent Checker
    `fnd-002-checker-20260729-003` established that the structural register was
    sound and isolated six semantic omissions, which is a changed diagnosis
    permitted by `LOOP.md`; the complete H1 three-attempt history above remains
    intact.
  - Same-blocker attempts for H2: `1`.
  - Attempt 1: Maker `fnd-002-maker-20260730-003` changed only the invariant
    register, control ledger, and fresh candidate artifacts. It restored
    mandatory same-priority automatic pending replacement and the exact
    30-second TTL; exact user `6`, screen `ceil(active/4)`, ambient `2`, and
    direct-target `1` budgets; immediate published-history insertion with user
    association; exact screen threshold `0.2`; and expanded existing
    `GAP-FENCE-001` and `GAP-VIEW-002` with the two current non-parity facts.
    The task is `VERIFY`; this candidate is not accepted evidence.
  - Independent Checker `fnd-002-checker-20260730-004` confirmed all six named
    H2 repairs, exact Markdown/JSON rows for 31 invariants, 18 gaps, and five
    fixture classes, 184 valid references, 25 existing owners, all 42 current
    authority/oracle hashes, and all 13 Maker manifest entries. Its open-ended
    semantic audit rejected the candidate because `INV-GEN-001` omits the exact
    six-second remaining-deadline gate in the confirmed product contract;
    `INV-BUDGET-001` reduces direct Viewer-or-Persona targeting to a named
    Viewer; `INV-ASR-002` omits the fixed 0.8-second silence and 8-second maximum
    standalone system-audio segmentation; and `INVARIANTS.md` still links its
    source-state and machine-readable register to
    `fnd-002-maker-20260729-002`. This is a changed adjacent signature, not a
    recurrence of the repaired H2 six-item signature, so the H2
    `same_blocker_attempts` count remains `1`. Evidence:
    `.omx/artifacts/typescript-bun/FND-002/fnd-002-checker-20260730-004/`.
- H3 recovery hypothesis reset:
  - New adjacent signature:
    `PROTOCOL_REPAIR_SIX_SECOND_GATE_OMITTED`;
    `DIRECT_PERSONA_TARGET_BUDGET_REDUCED`;
    `SYSTEM_AUDIO_SEGMENTATION_FIXED_PARAMETERS_OMITTED`;
    `H2_MACHINE_REGISTER_POINTER_STALE`.
  - Reset basis: independent Checker
    `fnd-002-checker-20260730-004` accepted every H2 repair and isolated three
    adjacent semantic omissions plus one stale canonical artifact pointer.
    This changed diagnosis preserves all H1 and H2 history and starts H3 at
    `same_blocker_attempts=1`.
  - Attempt 1: Maker `fnd-002-maker-20260730-004` preserved the six H2 repairs
    and all prior non-passing contradictions; froze protocol repair as one
    structurally-invalid-result repair only when at least 6 seconds remain,
    with at most two physical Provider requests and no Viewer substitution;
    restored the direct Viewer-or-Persona one-target budget with deterministic
    eligible Persona-instance selection; froze standalone system-audio final
    submission after approximately 0.8 seconds of silence and hard
    segmentation after at most 8 seconds; expanded `GAP-ASR-001` to require
    exact integrated proof; and updated both canonical pointers to the H3
    artifact directory. A fresh 31-invariant adjacent audit, exact mirror,
    reference/owner/source-state validation, manifest verification, and
    `git diff --check` are recorded under
    `.omx/artifacts/typescript-bun/FND-002/fnd-002-maker-20260730-004/`.
    The task is `VERIFY`; this candidate is not accepted evidence.
  - Independent Checker `fnd-002-checker-20260730-005` reviewed all 31
    invariants, all 18 gaps, all 21 required families, and all five evidence
    classes against the authoritative documents and current parity oracle. It
    confirmed exact Markdown/JSON mirrors, 186 valid references, 212 valid line
    ranges, 25 existing owners, 43 authority/oracle hashes, all 14 Maker
    manifest entries, all H1/H2/H3 repairs, and every explicit non-passing
    contradiction. The verdict is `PASS`.
- Security/data impact: the H3 candidate preserves the known token environment,
  privileged-channel, scheduler, silence, `WINDOW_BATCH`, publication-count,
  and frame contradictions as non-passing while retaining every H2 repair.
  Verification did not modify or inspect secrets, user data, raw media,
  `output/`, or `promo/` contents.
- Current evidence:
  - architect identity `fnd-002-checker-20260729-001` /
    `fnd-002-checker-context-20260729-001`
  - verifier `checker-report.json`, `semantic-diff.json`,
    `line-reference-audit.json`, `source-state.json`, and validation outputs
  - Maker candidate
    `.omx/artifacts/typescript-bun/FND-002/fnd-002-maker-20260729-001/`
  - repaired Maker candidate
    `.omx/artifacts/typescript-bun/FND-002/fnd-002-maker-20260729-002/`
  - independent attempt 3 `semantic-audit.json`,
    `independent-structural-audit.json`, and `received-source-state.json`
  - H2 Maker candidate
    `.omx/artifacts/typescript-bun/FND-002/fnd-002-maker-20260730-003/`
  - H2 independent Checker `semantic-audit.json`,
    `independent-structural-audit.json`, `checker-report.json`, and
    `received-source-state.json`
  - H3 Maker candidate
    `.omx/artifacts/typescript-bun/FND-002/fnd-002-maker-20260730-004/`
  - H3 independent Checker
    `.omx/artifacts/typescript-bun/FND-002/fnd-002-checker-20260730-005/`
- Resolution condition: met by `fnd-002-checker-20260730-005`.
- Recovery task or decision: none; `FND-002` is accepted and exactly `FND-003`
  is promoted to `READY`.
- Accepted limitation authority/scope/expiry: none; no scope weakening accepted.
- Resolved by run: `fnd-002-checker-20260730-005`.
- Residual limitation: the correctly non-passing security, scheduler, silence,
  `WINDOW_BATCH`, publication-count, and frame contradictions must remain
  explicit in any later repair.

## `FND-001-HTTP-ROUTE-CATALOG` - `FND-001` - incomplete HTTP route catalog

- Status: `RESOLVED`
- First seen: 2026-07-29
- Last updated: 2026-07-29
- Owner: `fnd-001-checker-20260729-002`
- Task claim blocked: the machine-readable live baseline completely catalogs
  backend routes.
- Error signature: independent AST discovery finds 47 tracked Python HTTP route
  decorators; Maker `inventory.json` records 17 and omits 30.
- Environment: local Windows development worktree,
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`
- Why this is a blocker: `FND-001` explicitly requires a backend route catalog;
  the accepted baseline cannot omit active routes.
- Attempts:
  1. Checker compared every tracked Python decorator through `ast.parse` against
     the Maker inventory. The Maker collector's line regex omitted 29 multiline
     decorators and one empty-string `POST` decorator. See
     `.omx/artifacts/typescript-bun/FND-001/fnd-001-checker-20260729-001/`.
  2. Maker replaced the HTTP collector with `ast.NodeVisitor` over all 164
     tracked Python files and independently generated an `ast.walk` expected
     key set. Both sets contain exactly 47 unique routes, including the empty
     path, with no missing or extra keys. Candidate evidence:
     `.omx/artifacts/typescript-bun/FND-001/fnd-001-maker-20260729-002/`.
- Security/data impact: none; verification was read-only outside checker control
  records and did not inspect secrets, user data, raw media, `output/`, or
  `promo/` contents.
- Current evidence:
  - `ast-discovery.json`
  - `static-verification.json`
  - `checker-report.json`
  - Maker attempt 2 `inventory.json`, `expected-http-routes.json`, and
    `maker-self-check.json`
  - Checker attempt 2 `route-comparison.json`, `static-validation.json`, and
    `validation-summary.json`
- Resolution condition: a new Maker run produces a complete machine-readable
  HTTP route catalog, moves `FND-001` to `VERIFY`, and a new checker context
  independently confirms it.
- Recovery task or decision: independently verify Maker attempt 2; do not
  promote `FND-002` before acceptance.
- Accepted limitation authority/scope/expiry: none.
- Resolved by run: `fnd-001-checker-20260729-002`, which independently parsed
  all 164 tracked Python files and found HTTP live=47, recorded=47,
  missing=0, extra=0, duplicates=0.
- Residual limitation: static AST discovery proves declared decorators, not
  dynamic runtime registration. The checker freshly recorded `pnpm typecheck`
  exit 2 as the reproducible pre-existing `AudienceMode` baseline failure;
  `pnpm test` and `pnpm build` exited 0.

## `FND-005-PROTOCOL-SCHEMA-PARITY` - `FND-005` - Elysia spike diverges from current protocol schema

- Status: `RESOLVED`
- First seen: 2026-07-30
- Last updated: 2026-07-30
- Owner: `fnd-005-checker-20260730-002`
- Task claim blocked: the disposable Elysia service matches the current
  startup-token, WebSocket JSON, and binary v3 protocol semantics closely
  enough to accept `FND-005`.
- Error signature:
  `V3_FIXTURE_CANONICAL_ROUNDTRIP_MISMATCH`;
  `WS_WRONG_VERSION_MISCLASSIFIED`;
  `WS_JSON_SCHEMA_NOT_STRICT`;
  `V3_JSON_HEADER_EXTRA_FIELD_ACCEPTED`.
- Environment: local Windows x64 worktree,
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`,
  Bun `1.3.14` revision `0d9b296af`.
- Why this is a blocker: FND-005 requires a current-protocol spike, not only
  successful echo transport. Both Maker fixtures decode through the Python
  oracle but neither re-encodes byte-for-byte. The candidate also accepts an
  extra `client.hello` field, accepts `client.ping` without
  `protocol_version`, accepts an unknown binary JSON-header field, and reports
  a wrong WebSocket version as `authentication_failed`/`4401` rather than
  `version_mismatch`/`4406`.
- Attempts:
  1. Checker verified all 22 Maker manifest entries before testing and rehashed
     them after testing; reran the 16-test Python baseline; decoded and
     re-encoded both fixtures with the authoritative Python codec; and ran 36
     independent Elysia runtime assertions. Results were Python baseline
     `16/16`, Python oracle `7/8`, and independent runtime `32/36`. Exact
     dependency/source provenance passed `3/3`; the frozen Checker-owned
     install and app typecheck passed. Evidence:
     `.omx/artifacts/typescript-bun/FND-005/fnd-005-checker-20260730-001/`.
  2. Maker recovery attempt 2 reproduced the received failures first (Python
     oracle `7/8`, Elysia runtime `32/36`), then generated both v3 fixtures with
     the authoritative Python encoder and defined exactness as complete
     decode/re-encode byte identity. It repaired negotiation ordering and the
     current error payload/`4406`, strict `client.hello` and `client.ping`
     validation, and v3 JSON-header unknown-field/coordination rejection.
     Recovery checks pass Python fixture generation `2/2`, Python oracle `8/8`,
     independent-like runtime `36/36`, and the full disposable spike `63/63`.
     Evidence:
     `.omx/artifacts/typescript-bun/FND-005/fnd-005-maker-20260730-002/`.
     The blocker remains active until a fresh independent Checker accepts it.
- Resolved by run: `fnd-005-checker-20260730-002`. The fresh Checker first
  verified and later rehashed all 71 recovery Maker manifest entries against
  manifest SHA-256
  `c4732ab0b0d3f6eb9b167e0d5ac6913516793c6f1de67d937e7365995904ff8d`.
  Checker-owned proof passed Python baseline `16/16`, live Python handshake
  ordering `2/2`, Python v3 oracle `9/9`, Elysia runtime `40/40`, exact
  dependency provenance `3/3`, frozen install, and typecheck. Both canonical
  fixtures regenerate to the claimed hashes and round-trip byte-for-byte.
  Wrong version returns the exact current payload and `4406`; strict
  `client.hello`/`client.ping`, unknown fields, and invalid coordination
  combinations reject without binary echo.
- Security/data impact: the candidate remains loopback-only and synthetic; no
  secret, Provider, user-data, raw-media, `output/`, or `promo/` content was
  inspected or changed. Root normalized `package.json` and `pnpm-lock.yaml`
  blobs still equal `HEAD`; no root `bun.lock` or `bun.lockb` exists.
- Current evidence:
  - `reports/oracle-parity.json`
  - `reports/independent-check.json`
  - `reports/dependency-provenance.json`
  - `reports/source-state.json`
  - `reports/verdict.json`
  - `raw/python-protocol-baseline.txt`
  - `raw/frozen-install.txt`
  - `raw/independent-check.txt`
  - Maker recovery:
    `.omx/artifacts/typescript-bun/FND-005/fnd-005-maker-20260730-002/`
  - Independent acceptance:
    `.omx/artifacts/typescript-bun/FND-005/fnd-005-checker-20260730-002/`
- Resolution condition: a fresh Maker candidate uses the current strict
  realtime JSON semantics, emits the current wrong-version error/close
  classification, rejects binary v3 JSON-header fields and coordination
  combinations rejected by the Python oracle, and provides fixtures whose
  claimed exactness is defined and independently reproducible.
- Resolution result: `FND-005` is `DONE`; exactly `FND-006` is `READY`.
- Accepted limitation authority/scope/expiry: localhost native `drain` was not
  observed and remains a limitation; bounded admission plus Bun's configured
  hard transport limit is accepted only for the backpressure slice. This does
  not waive protocol/schema parity.
- Residual limitation: no v1/v2 parity, Electron, packaging, macOS, signing,
  deployment, Provider, credentialed-live, or production-load claim is
  accepted.

## `FND-007-SCHEDULER-CAPACITY` - `FND-007` - p-queue backlog bypasses wrapper capacity

- Status: `RESOLVED`
- First seen: 2026-07-30
- Last updated: 2026-07-30
- Owner: `fnd-007-checker-20260730-002`
- Task claim blocked: the disposable ADVX-owned p-queue boundary enforces a
  bounded admission capacity while preserving concurrency, cancellation,
  deadlines, and finite priority behavior.
- Error signature:
  `FND007_SCHEDULER_CAPACITY_COUNTS_ONLY_TRANSIENT_PENDING`.
- Environment: local Windows x64 worktree,
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`,
  Bun `1.3.14` revision `0d9b296a`.
- Why this is a blocker: `FND-007` explicitly requires a bounded scheduler
  boundary. With configured capacity `2`, the independent Checker held one
  running task and submitted six more at staggered intervals. All seven
  unfinished tasks were accepted and none was rejected.
- Root cause: `AdvxScheduler.submit` checks only `#pending.length`. The drain
  loop removes each item from `#pending` before adding it to the kind/viewer
  p-queue. Items active or waiting inside p-queue therefore disappear from the
  admission count, allowing the downstream backlog to exceed the advertised
  capacity.
- Attempts:
  1. Checker verified the immutable Maker manifest `29/29`, completed a fresh
     frozen install/typecheck, reproduced Maker tests `9/9` with `86`
     assertions, then ran `bun run check-capacity.ts`. The adversarial command
     exited `1` with configured capacity `2`, accepted unfinished work `7`,
     rejected work `0`, and started work `1`. Evidence:
     `.omx/artifacts/typescript-bun/FND-007/fnd-007-checker-20260730-001/`.
  2. Recovery Maker `fnd-007-maker-20260730-002` introduced a single
     ADVX-owned admitted-unfinished counter and idempotent settlement path
     covering wrapper pending, p-queue queued/rejected, active, abort, expiry,
     fence, error, and success outcomes. Frozen Bun tests passed `10/10` with
     `108` assertions. The standalone staggered regression exited `0`: capacity
     `2`, admitted before release `2`, maximum admitted `2`, excess rejected
     `5`, admitted after release/closeout `0`, and post-release work published.
     Abort/expiry/zero-effect paths also returned capacity to zero and allowed
     reuse. This is a recovery candidate; the blocker remains `ACTIVE` until a
     fresh independent Checker accepts it. Evidence:
     `.omx/artifacts/typescript-bun/FND-007/fnd-007-maker-20260730-002/`.
  3. Fresh independent Checker `fnd-007-checker-20260730-002` copied the
     recovery source into a Checker-owned frozen input, verified the recovery
     manifest `53/53` before and after, and ran a hostile capacity suite. At
     configured capacity `2`, exactly one active and one p-queue queued item
     remained admitted, all five staggered excess submissions rejected with
     `scheduler_capacity_exceeded`, maximum admission stayed `2`, closeout
     returned to `0`, and post-settlement admission succeeded. Eight terminal
     paths, an abort/completion race, and active/backlog/interval-delayed
     `idle()` behavior all released without a negative or leaked count.
     Checker tests passed `4/4` with `60` assertions; the copied candidate
     passed `10/10` with `108` assertions. Evidence:
     `.omx/artifacts/typescript-bun/FND-007/fnd-007-checker-20260730-002/`.
- Passing slices retained: Provider text/image/non-stream/stream/structured
  output, error normalization, two-request physical budget, bounded
  connect/stream abort, explicit `maxRetries: 0`, queued/in-flight cancellation,
  queued expiry, interval/deadline behavior, finite-admission priority behavior,
  deterministic replay, privacy, and artifact-only final fences.
- Security/data impact: none. The Checker used only loopback deterministic
  fixtures and current code/test semantics; it read no credentials, environment
  files, user data, or real media.
- Current evidence:
  - `raw/capacity-adversarial.txt`
  - `check-capacity.ts`
  - `reports/verdict.json`
  - `reports/verification-matrix.json`
  - `reports/maker-manifest-post.json`
  - `reports/source-state-pre-verdict.json`
  - recovery `reports/capacity-regression.json`
  - recovery `reports/scheduler-matrix.json`
  - recovery `reports/summary.json`
  - recovery `manifest.sha256`
  - accepted recovery `reports/hostile-scheduler-matrix.json`
  - accepted recovery `reports/scheduler-verification.json`
  - accepted recovery `reports/verdict.json`
  - accepted recovery `manifest.sha256`
- Resolution condition: the wrapper counts every admitted unfinished item
  across its pending selector, p-queue queued work, and active work; it rejects
  submissions beyond the configured bound; a frozen staggered-admission
  regression proves the limit; and a new independent Checker accepts the
  repaired candidate.
- Resolution result: `FND-007` is `DONE`; exactly `FND-008` is promoted to
  `READY`. No `FND-008` implementation artifact was created.
- Accepted limitation authority/scope/expiry: none. Bounded queue capacity is
  an invariant and cannot be waived by the artifact-only evidence label.
- Residual limitations: native p-queue timeout still begins only after dequeue,
  so the ADVX wrapper must enforce queued expiry and the outer deadline.
  Continuous-load fairness is not proven; the current result is limited to
  finite bounded admission. `GAP-FENCE-001`, `GAP-VIEW-001`, and
  `GAP-VIEW-002` remain non-passing product gaps.

## Resolved Recovery Record

## `FND-010-MINIMUM-RELEASE-AGE-POLICY` - `FND-010` - dual-manager age-policy contract requires recovery

- Status: `RESOLVED`
- First seen: 2026-07-30
- Last updated: 2026-07-30
- Owner: `fnd-010-checker-20260730-006`
- Task claim blocked: the coexistence workspace follows the explicit
  human-directed no-age-policy contract, contains no age-gate exceptions, and
  can refresh both locks from the same exact-pinned manifests with independent
  frozen replay.
- Current error signature: resolved.
- Environment: local Windows x64 worktree,
  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`,
  Bun `1.3.14`, pnpm `11.9.0`.
- Why this is a blocker: `pnpm config get minimumReleaseAge` returns
  `undefined`, so the checked-in pnpm exception list is inactive. A
  Checker-owned new resolution with `minimumReleaseAge: 10080` added still
  fails on under-age `@ai-sdk/provider@4.0.4`. A Checker-owned Bun new
  resolution with the live `bunfig.toml` fails on under-age
  `@ai-sdk/gateway@4.0.32`, `@ai-sdk/provider@4.0.4`, and
  `@ai-sdk/provider-utils@5.0.15`. Frozen installs pass only because release age
  is not reapplied to existing lock entries; that does not prove the documented
  shared-manifest lock-refresh contract.
- Attempts:
  1. Fresh Checker `fnd-010-checker-20260730-001` verified the immutable Maker
     manifest `54/54`, ran independent Bun and pnpm frozen roots, passed scoped
     builds/tests and Python parity, then ran current-policy and minimal-set
     new-resolution probes. The current Bun policy exited `1`; the current
     pnpm policy resolved with no age gate; activating seven days with the
     current pnpm exceptions exited `1`. A corrected probe-only minimal set of
     five exact AI versions passed for pnpm, the corresponding five package
     names passed for Bun, and removing any one exception failed (`12/12`
     positive/negative probes). Evidence:
     `.omx/artifacts/typescript-bun/FND-010/fnd-010-checker-20260730-001/`.
  2. Recovery Maker `fnd-010-maker-20260730-003` received an explicit human
     policy override canceling the minimum-release-age gate instead of adding
     exceptions. The Maker removed the now-empty `bunfig.toml`, removed pnpm
     `minimumReleaseAge` and `minimumReleaseAgeExclude`, updated the FND-010
     contract, and regenerated both locks through their owning managers from
     the same manifest set. Fresh lock-free resolution and independent frozen
     installs pass for both managers; scoped backend/contracts/desktop checks,
     default-deny lifecycle review, process lifecycle, Python health/viewer
     parity, and hostile reintroduction mutations pass. The candidate is
     repaired, but this blocker remains `ACTIVE` until a fresh independent
     Checker verifies complete policy removal and accepts the dual-lock/build
     evidence. Evidence:
     `.omx/artifacts/typescript-bun/FND-010/fnd-010-maker-20260730-003/`.
  3. Fresh independent Checker `fnd-010-checker-20260730-002` verified that
     source `bunfig.toml` is absent, all three pnpm age keys are absent from
     root configuration, and live `pnpm config get` returns `undefined`.
     Official pnpm 11.x settings nevertheless define a built-in `1440`-minute
     `minimumReleaseAge` default with non-strict fallback. Ordinary lock-free
     pnpm `11.9.0` resolution exited `0` but auto-wrote four
     `minimumReleaseAgeExclude` entries. An otherwise identical fresh control
     using `--config.minimumReleaseAge=0` exited `0` without writing an age key
     or exception. Maker003's own sealed raw pnpm output records the same four
     automatic exceptions, even though its generated lock SHA exactly matches
     the source lock and sealed snapshot. Frozen Bun/pnpm installs, required
     direct pins, shared direct resolutions, scoped checks, process lifecycle,
     Python health/viewer parity, fail-closed commands, production audit
     boundary, and all `17/17` hostile mutations pass. Later transitive range
     re-resolution drift is recorded as expected temporal observation and is
     not the blocker. Verdict: `FAIL`. Evidence:
     `.omx/artifacts/typescript-bun/FND-010/fnd-010-checker-20260730-002/`.
  4. Recovery Maker `fnd-010-maker-20260730-004` applied the product-owner's
     final no-seven-day-policy contract by setting pnpm
     `minimumReleaseAge: 0` solely as the sentinel that disables pnpm v11's
     built-in one-day default. Neither pnpm exception key exists and root
     `bunfig.toml` remains absent. Ordinary lock-free pnpm resolution reports
     effective zero and writes no exception list; an explicit CLI zero control
     agrees. Fresh Bun resolution passes. Both unchanged source locks replay
     frozen through their owning managers; direct workspace resolutions remain
     aligned. Backend-bun typecheck/test/build, contracts typecheck, desktop
     build, process lifecycle `4/4`, Python health `4/4`, viewer parity `1/1`,
     production/full audit boundary, empty `trustedDependencies`, pnpm
     `allowBuilds`, Bun untrusted, and `19/19` hostile mutations pass. Maker003,
     Checker002, and necessary earlier manifests rehash before and after. The
     blocker remains `ACTIVE`, owned by the pending fresh Checker; the Maker
     does not accept `DONE`. Evidence:
     `.omx/artifacts/typescript-bun/FND-010/fnd-010-maker-20260730-004/`.
  5. Fresh independent Checker `fnd-010-checker-20260730-003` preserved the
     latest human instruction that pnpm's built-in policy must be explicitly
     disabled: source contains exactly `minimumReleaseAge: 0`, both exception
     keys are absent/undefined, `bunfig.toml` is absent, ordinary lock-free
     pnpm resolution reads zero without CLI injection and writes no exception,
     the explicit-zero control agrees, and fresh Bun resolution passes.
     Independent Bun/pnpm frozen installs, backend-bun
     typecheck/test/build, contracts typecheck, desktop build, process
     lifecycle `4/4`, Python health `4/4`, viewer parity `1/1`, the sole known
     `AudienceMode` root typecheck baseline, lifecycle restrictions, and
     `21/21` hostile mutations pass. Fresh pnpm production audit has zero
     high/critical findings. The full-tree audit now reports high-severity
     `GHSA-52cp-r559-cp3m` at root
     `openapi-typescript@7.13.0 -> @redocly/openapi-core@1.34.17 ->
     js-yaml@4.2.0`. That path is not electron-builder packaging, so it cannot
     use the accepted deferred packaging boundary. Verdict: `FAIL`; FND-010
     and Phase 00 return to `BLOCKED`, `same_blocker_attempts=3`, and
     FND-011/FND-012 remain `TODO`. Evidence:
     `.omx/artifacts/typescript-bun/FND-010/fnd-010-checker-20260730-003/`.
  6. Recovery Maker `fnd-010-maker-20260730-005` addressed only Checker003's
     two non-packaging root OpenAPI high paths. Root `openapi-typescript` is
     exactly `7.13.0`; Bun and pnpm apply the same exact overrides for
     `@redocly/openapi-core@1.34.18`, `js-yaml@4.3.0`, and
     `minimatch@10.2.6`; both register the single Redocly CommonJS patch.
     Bun `1.3.14` and pnpm `11.9.0` independently emitted the retained
     517-byte patch with SHA256
     `2ce4959e1555cddcaa3ace4fa90cf5c75c71412b92b632497c2344ea137ebef1`.
     The requested
     `fbcf5c0d0b773db1cb22be0e4a295decaf65043ea6c843df9bce759999523871`
     belongs to the semantically identical 421-byte form that omits the Git
     blob `index` metadata line; manager-generated bytes were retained rather
     than falsifying the hash. Fresh/frozen installs, all three audits, Node
     `24.18.0` and Bun header-match probes, contracts canonical-LF byte parity,
     Windows `electron-builder --dir`, scoped builds, lifecycle, focused
     Python parity, and all `24/24` hostile mutations pass. The blocker remains
     `ACTIVE` for a fresh Checker; FND-010 and Phase 00 move only to `VERIFY`.
     Evidence:
     `.omx/artifacts/typescript-bun/FND-010/fnd-010-maker-20260730-005/`.
  7. Fresh independent Checker `fnd-010-checker-20260730-004` verified the
     required zero sentinel, absent/undefined exception keys, absent Bun age
     configuration, exact override/patch registrations, the 517-byte LF patch
     SHA256
     `2ce4959e1555cddcaa3ace4fa90cf5c75c71412b92b632497c2344ea137ebef1`,
     fresh frozen installs, ordinary pnpm lock-free resolution without
     generated exceptions, and zero high/critical pnpm production/full and Bun
     full audits. Node `24.18.0` and Bun pass Redocly's public
     `readFileFromUrl` header-match path; reverting the installed Redocly import
     reproduces `minimatch is not a function` in both runtimes. The global
     override is nevertheless unsafe: fresh `pnpm why -r minimatch` shows
     `dir-compare@4.2.0` forced to `minimatch@10.2.6`, and a Checker-owned
     Node `24.18.0` `compareSync(..., { includeFilter: 'package*.json' })`
     probe fails with `(0 , minimatch_1.default) is not a function`. Fresh
     Windows `electron-builder --win --dir` still exits zero after a fresh
     desktop build, so the ordinary packaging smoke does not exercise the
     broken public filter path. Verdict: `FAIL`; `FND-010` and Phase 00 are
     `BLOCKED`, `same_blocker_attempts=4`, and `FND-011`/`FND-012` remain
     `TODO`. Evidence:
     `.omx/artifacts/typescript-bun/FND-010/fnd-010-checker-20260730-004/`.
  8. Fresh recovery Maker `fnd-010-maker-20260730-006` replaced the rejected
     global minimatch override with identical Bun/pnpm overrides for
     `@redocly/openapi-core@1.34.18`, `js-yaml@4.3.0`, and
     `brace-expansion@5.0.8`. Both managers register only the brace CommonJS
     adapter; minimatch `3.1.5`, `5.1.9`, `9.0.9`, and `10.2.6` remain in
     their declared parent ranges while brace resolves only to fixed `5.0.8`.
     The pnpm-manager patch is 403 LF-only bytes with SHA256
     `e7b410e653bc2a2e650f9f0d5839e53a6fa4624c45a2bee74af00456512c8311`.
     The requested 336-byte `844c8371...` research patch has the same two-line
     payload but a different hunk header/context; Bun Windows
     `patch --commit` reports EPERM, so the retained pnpm-generated bytes are
     authoritative and both managers prove strict replay plus identical
     installed CJS/ESM bytes. Fresh/frozen installs, zero high/critical audits,
     Node `24.18.0` and Bun consumer probes in both trees, plain-brace failure,
     the 19-pattern corpus and bounded safety limits, contracts byte parity,
     Node 24 desktop build, Windows `--dir` packaging, scoped builds, lifecycle
     `4/4`, Python health `4/4`, viewer parity `1/1`, and all hostile
     mutations pass. The Maker moves only to `VERIFY`; the blocker remains
     `ACTIVE` for a fresh Checker, `same_blocker_attempts` stays `4`, and
     FND-011/FND-012 remain `TODO`. Evidence:
     `.omx/artifacts/typescript-bun/FND-010/fnd-010-maker-20260730-006/`.
  9. Fresh independent Checker `fnd-010-checker-20260730-005` accepted the
     repaired supply-chain slices: the effective pnpm age value is exactly
     zero, both exception keys and Bun age configuration are absent, the exact
     dual override/patch contract and 403-byte patch replay, zero
     high/critical audits, four Node/Bun consumer matrices, plain-brace
     controls, the 19-pattern corpus, contracts bytes, Node 24 desktop build,
     fresh Windows directory packaging, scoped checks, process lifecycle
     `4/4`, Python health `4/4`, and all hostile mutations pass. The required
     Python viewer parity gate does not reproduce: two pytest attempts stalled,
     and a bounded 30-second diagnostic timed out in
     `ViewerRuntime.dispatch()` while awaiting futures. Static inspection
      confirms the fixture clock always returns `1250`, while request pacing
      defaults to `200` milliseconds, so later pacing turns cannot observe time
      advancement. Checker003 and Maker006 had instead run the lightweight
      `apps/backend/tests/test_viewer_runtime_contract.py`; neither earlier
      `1/1` log executed or hashed the required recorded E2E fixture. The
      relevant current files are tracked, clean, and identical to the shared
      HEAD, and no Checker-owned retry process remains. Verdict: `FAIL`;
      `FND-010` and Phase 00 remain `BLOCKED`,
     `same_blocker_attempts=5`, and FND-011/FND-012 remain `TODO`. Evidence:
      `.omx/artifacts/typescript-bun/FND-010/fnd-010-checker-20260730-005/`.
   10. Recovery Maker `fnd-010-maker-20260730-007` replaced only the recorded
      replay's fixed clock with a deterministic advancing clock and injected
      its sleeper into `ViewerRuntime`. The original `2000` millisecond wave
      and decision deadlines remain unchanged. The fixture now explicitly
      records the retained `viewer_request_start_interval_ms: 200` setting and
      its current canonical hash; the regression asserts exactly 27 logical
      sleeps of 200 milliseconds for 28 independent viewer calls. The required
      bounded command
      `uv run --project apps/backend pytest tests/e2e/test_viewer_runtime_recorded.py -q`
      reports `1 passed in 0.46s`. Ruff passes. Policy and protected hashes,
      both manager locks, the single brace patch, and `EVIDENCE.md` remain
      unchanged. This is a recovery candidate; the blocker stays `ACTIVE`
       until a fresh independent Checker accepts it. Evidence:
       `.omx/artifacts/typescript-bun/FND-010/fnd-010-maker-20260730-007/`.
   11. Fresh independent Checker `fnd-010-checker-20260730-006` verified that
       Maker007 changed only the recorded fixture/test surface: the product
       `ViewerRuntime` and settings files retain their Checker005 hashes, the
       original 2000-millisecond wave and assessment deadlines remain, and no
       interval-zero, skip, xfail, or weakened assertion exists. The required
       bounded recorded E2E test reports `1 passed in 0.63s`; an independent
       evidence run proves 28 provider calls, exactly 27 logical
       200-millisecond sleeps, and matching fixture/model/manual canonical
       hashes. Focused Ruff passes. Source/live pnpm age is exactly zero, both
       exception keys are absent/undefined, Bun age files are absent, the exact
       override/single-patch and lock hashes remain accepted, fresh pnpm/Bun
       frozen installs preserve both locks, and Maker006, Checker005, and
       Maker007 manifests verify. Verdict: `PASS`; FND-010 becomes `DONE`,
       Phase 00 and FND-011 become `READY`, `current_task=null`,
       `next_task=FND-011`, `same_blocker_attempts=0`, and FND-012 remains
       `TODO`. Evidence:
       `.omx/artifacts/typescript-bun/FND-010/fnd-010-checker-20260730-006/`.
- Passing slices retained: exact workspace graph and links, text `bun.lock`,
  no `bun.lockb`, retained pnpm lock, independent frozen installs, accepted
  direct dependency pins, empty trusted dependency list with clean builds and
  zero `bun pm untrusted` findings, root command ownership, Python default and
  oracle preservation, backend/contracts/desktop scoped checks, known
  `AudienceMode` root typecheck baseline, process lifecycle, and focused Python
  health. The recorded Python viewer parity slice now passes independently.
- Security/data impact: no secret, credential, Provider, `.env`, user-data, raw
  media, `output/`, or `promo/` content was read or changed. No production,
  deploy, publish, commit, push, signing, or Python deletion action occurred.
- Current evidence:
  - `reports/verdict.json`
  - `reports/verification-matrix.json`
  - `reports/candidate-diff-validation.json`
  - `reports/recorded-pacing-validation.json`
  - `reports/policy-validation.json`
  - `reports/frozen-install-validation.json`
  - `reports/upstream-manifests.json`
  - `manifest.sha256`
- Resolution condition: a fresh independent Checker verifies that ordinary
  supported Bun and pnpm resolution has no effective minimum-release-age gate
  and does not auto-write an exception list, both locks remain bound to their
  owning managers and the same exact-pinned manifest set, independent frozen
  installs pass, scoped build/lifecycle/parity checks pass, and hostile
  policy-reintroduction mutations are rejected. Production audit must retain
  zero high/critical findings, and every full-tree high finding must be
  confined to the already accepted deferred electron-builder packaging
  boundary. Any global cross-major override must also preserve every affected
  parent consumer's public API; at minimum the `dir-compare@4.2.0`
  `includeFilter` path must pass under Node `24.18.0`, not merely an
  `electron-builder --dir` smoke that bypasses it. The Python viewer parity
  test must also finish and report `1/1` under the retained request-pacing
  semantics; a stalled or skipped test is not accepted.
- Resolved by run: `fnd-010-checker-20260730-006`.
- Residual limitations: host Node `22.23.1` remains below the locked downstream
  `24.18.0` precondition. Registry advisory data is time-varying. Bun lacks a
  production-only audit selector. Packaging, macOS, credentialed Provider
  behavior, deployment, and FND-011/FND-012 are not claimed.

## OBS-001 / obs-001-maker-root-20260806-025

- Status: resolved by independent Checker
  `obs-001-checker-root-20260806-026`.
- The targeted schema/redaction, lifecycle, strict TypeScript, and Bun build
  checks pass, and the Checker accepted `OBS-001` as `DONE`. No blocker was
  opened; `OBS-003` is the sole promoted next task.

## OBS-002 / obs-002-maker-root-20260806-027

- No blocker opened. Independent Checker
  `obs-002-checker-root-20260806-028` accepted the Maker's focused propagation
  tests, strict Bun TypeScript, live plan-check, and diff-check; `OBS-002` is
  `DONE` and `OBS-003` is promoted.
- The full system integration file was not used as a gate because one broad
  Windows run hit the existing 5-second lifecycle timeout while the targeted
  authenticated trace test passed. This is recorded as non-blocking test
  flakiness, not a product blocker.
- Bounded recovery `obs-002-maker-root-20260806-029` added terminal records for
  immediate scheduler rejections. Fresh Checker
  `obs-002-checker-root-20260806-030` accepted the correction; no blocker is
  open and `OBS-003` is promoted.

## OBS-003 / obs-003-maker-root-20260806-031

- No migration blocker opened. The Electron error
  `ERR_MODULE_NOT_FOUND` for `packages/contracts/src/http/common` was
  reproduced as a dev SSR externalization boundary and addressed by bundling
  `@advx/contracts` through the main `ssr.noExternal` guard; the bounded dev
  smoke now starts Electron without a module-resolution error.
- The existing Python parity oracle, broad test history, and downstream task
  order remain unchanged. A fresh independent Checker is still required to
  accept `OBS-003` and promote only `OBS-004`.

Independent Checker `obs-003-checker-root-20260806-032` recomputed the scoped
aggregate with zero mismatches, reran the focused commands, and accepted the
module-resolution correction and evidence normalizer. `OBS-003` is `DONE`; no
blocker remains and only `OBS-004` is promoted.

## OBS-004 / obs-004-maker-root-20260806-033

No migration blocker opened. The Maker added an authenticated, protocol-v3
`/debug/snapshot` endpoint with bounded cursor pagination and explicit
`unavailable` fields for diagnostics that are not yet owned by the composed
Bun process (model scheduler, circuit state, or Electron capture report).
Focused debug, adjacent observability regressions, strict Bun TypeScript, Bun
build, live plan-check, and diff-check pass. A distinct Checker must review
the candidate evidence before `OBS-004` can become `DONE` and `OBS-005` can be
promoted.

Independent Checker `obs-004-checker-root-20260806-034` recomputed the scoped
aggregate with zero mismatches, reran the focused commands, and accepted the
authenticated bounded snapshot contract. `OBS-004` is `DONE`; no blocker
remains and only `OBS-005` is promoted to `READY`.

## OBS-005 / obs-005-maker-root-20260806-035

No migration blocker opened. The Bun headless harness has focused lifecycle
coverage for deterministic isolated runs, deadline aborts, resource cleanup,
stable exits, and invalid input. The CLI's valid and invalid JSON paths were
smoke-tested. Full product replay is intentionally deferred to `OBS-007`, and
the Python parity oracle remains unchanged. A fresh independent Checker must
recompute the scoped aggregate and accept `DONE` before `OBS-006` is promoted.

Independent Checker `obs-005-checker-root-20260806-036` recomputed the scoped
aggregate with zero mismatches, reran the focused commands, and accepted
`OBS-005` as `DONE`. No blocker remains; only `OBS-006` is promoted to
`READY`.

## OBS-006 / obs-006-maker-root-20260806-037

No migration blocker opened. The bounded comparison evaluated all three
options required by the plan and `ADR-MIG-003` chooses no additional trace UI
for normal ADVX development or packaging. Existing sanitized JSONL, debug
snapshot, headless artifacts, and OTel correlation remain authoritative; no
new service or dependency was introduced. A fresh independent Checker must
accept `DONE` before `OBS-007` is promoted.

Independent Checker `obs-006-checker-root-20260806-038` recomputed the ADR
aggregate with zero mismatches, confirmed all seven decision criteria, and
accepted `OBS-006` as `DONE`. No blocker remains; only `OBS-007` is promoted
to `READY`.

## OBS-007 / obs-007-maker-root-20260806-039

No migration blocker opened. Bun now has a deterministic recorded replay
service with explicit output-identity, redaction, digest, and no-external-call
checks, plus an authenticated `/debug/replay` boundary. Live replay remains
unavailable without explicit verified Provider provenance. A fresh independent
Checker must accept `DONE` before `OBS-008` is promoted.

Independent Checker `obs-007-checker-root-20260806-040` recomputed the scoped
aggregate with zero mismatches, reran the focused replay/headless checks, and
accepted `OBS-007` as `DONE`. No blocker remains; only `OBS-008` is promoted
to `READY`.

## OBS-008 / obs-008-maker-root-20260806-041

No migration blocker opened. The deterministic Agent evaluator is bounded to
local synthetic or recorded evidence, rejects live Provider fixtures, and
emits machine-readable evidence for each of the eight plan assertions. A fresh
independent Checker must recompute the scoped aggregate and accept `DONE`
before `OBS-009` is promoted.

Independent Checker `obs-008-checker-root-20260806-042` recomputed the scoped
aggregate with zero mismatches, reran the focused evaluator/type/build checks,
and accepted `OBS-008` as `DONE`. No blocker remains; only `OBS-009` is
promoted to `READY`.

## OBS-009 / obs-009-maker-root-20260806-043

No migration blocker opened. The Promptfoo spike records a bounded `NO_GO`
without installing the candidate dependency: the existing ADVX evaluator has
the required deterministic per-assertion evidence, while Promptfoo would add a
Node-only runner, large dependency surface, cache/telemetry controls, and a
second evidence boundary. A fresh independent Checker must accept `DONE`
before `OBS-010` is promoted.

Independent Checker `obs-009-checker-root-20260806-044` recomputed the one-file
decision aggregate with zero mismatches, reran the registry/no-install probes,
decision review, plan-check, diff-check, and ledger validation, and accepted
`OBS-009` as `DONE`. No blocker remains; only `OBS-010` is promoted to `READY`.

## OBS-010 / obs-010-maker-root-20260806-045

No migration blocker opened. The bounded AI SDK DevTools evaluation records a
`NO_GO` without installing the candidate dependency. The official local viewer
captures complete prompts, outputs, tool calls, and raw Provider data into
plaintext local generations; the current gateway has no sanitizing interception
layer that could preserve the secrets and raw-media exclusion boundary. The
existing redacted ADVX observability surfaces remain authoritative. A fresh
independent Checker must recompute the decision evidence and accept `DONE`
before `OBS-011` is promoted.

Independent Checker `obs-010-checker-root-20260806-046` recomputed the one-file
decision aggregate with zero mismatches, reran the registry, absence, strict
TypeScript, Bun build, decision review, plan-check, diff-check, and ledger
validation probes, and accepted `OBS-010` as `DONE`. No blocker remains; only
`OBS-011` is promoted to `READY`.

## OBS-011 / obs-011-maker-root-20260806-047

No migration blocker opened. The bounded diagnostics bundle builder and CLI
accept only requested redacted artifacts, make missing and excluded data
explicit, sanitize JSON, enforce file/byte limits, and hash every included
file. Focused tests, strict TypeScript, Bun build, CLI smoke, and diff-check
pass. A fresh independent Checker must recompute the scoped aggregate and
accept `DONE` before `OBS-012` is promoted.
Independent Checker `obs-011-checker-root-20260806-048` recomputed the scoped
aggregate with zero mismatches, reran the focused bundle tests, strict Bun
TypeScript, Bun build, CLI smoke, plan-check, diff-check, and ledger
validation, and accepted `OBS-011` as `DONE`. No blocker remains; only
`OBS-012` is promoted to `READY`.

## OBS-012 / obs-012-maker-root-20260806-049

No migration blocker opened. Bun CPU and heap profiling, bounded runtime
memory/CPU samples with queue and Provider-latency correlation, and opt-in
Electron content tracing are implemented with local output and shutdown
cleanup. Focused tests, strict TypeScript, builds, CLI smoke, and live
content-trace smoke pass. The existing Python dev-backend path failed during
the live Electron smoke because its workspace was unavailable; content trace
collection completed and this adjacent issue does not block OBS-012. A fresh
independent Checker must recompute the scoped aggregate and accept `DONE`
before `GATE-06` is evaluated.

## OBS-012 / obs-012-checker-root-20260806-050

No migration blocker remains. The independent Checker accepted the bounded
Bun CPU/heap profiling, runtime correlation samples, and opt-in Electron
content tracing after zero-mismatch source review and focused live checks.
The existing Python development-backend path warning is recorded as an
adjacent nonblocking issue. `OBS-012` is `DONE`; only `GATE-06` is promoted to
`READY`.

## GATE-06 / gate-06-maker-root-20260806-051

No migration blocker opened. The Phase 06 exit review found all twelve
observability tasks independently accepted and every gate criterion mapped to
accepted proof. `GATE-06` is `VERIFY`; a distinct Checker must accept it before
`TST-000` is promoted.

## GATE-06 / gate-06-checker-root-20260806-052

No migration blocker remains. The independent Checker accepted all ten Phase
06 exit criteria and promoted only `TST-000` to `READY`. Python remains the
parity oracle; no packaging, cutover, or cleanup task was started.

## TST-014 / 2026-08-07

No blocker opened. The bounded maker verification passes for the Bun corpus,
profile, room-6657 sync/SkillOpt adapter, and viewer evidence replacement.
The recorded Python E2E/parity oracle and backend-owned helpers are retained
by decision, not treated as active non-backend CLI debt. An independent
Checker must confirm the inventory and focused results before `DONE`.

The distinct Checker `tst-014-checker-root-20260807-080` confirmed the
inventory, focused commands, retained oracle boundaries, and live plan-check.
No TST-014 blocker remains; only `TST-012` is promoted.

## TST-000 / tst-000-maker-root-20260806-053

No migration blocker opened. The entry audit records two baseline limitations:
the full Bun suite currently has one import-boundary failure, and the
Playwright runner is not installed (only `playwright-core` is declared). Both
are explicitly assigned to later tooling work and do not change this
planning-only task. `TST-000` is `VERIFY`; an independent Checker must accept
the audit before `TST-001` is promoted.

## TST-000 / tst-000-checker-root-20260806-054

No migration blocker remains for the entry audit. The Bun import-boundary
failure and unavailable Playwright runner remain recorded as later tooling
limitations. `TST-000` is `DONE`; only `TST-001` is promoted to `READY`.

## TST-001 / tst-001-maker-root-20260806-055

No migration blocker opened. The Playwright runner and explicit browser
project are now configured; actual browser cases remain owned by TST-007. The
accepted TST-000 import-boundary failure is unchanged. A direct adjacent run of
`scripts/migration-plan-check.test.ts` exposed 13 stale mutation-expectation
failures, while the live plan-check CLI passes with zero errors. That test debt
is recorded but does not block this project-boundary task. `TST-001` is
`VERIFY`; a distinct Checker must review the nine-file aggregate and focused
project suite before any promotion.

Independent Checker `tst-001-checker-root-20260806-056` rejected the first
candidate after the desktop Main restart-budget lifecycle test exceeded its
explicit 15000 ms deadline by 13 ms under project concurrency. This is the
current bounded verification issue, not a formal `BLOCKED` transition; the
task remains `VERIFY`, `same_blocker_attempts=0`, and recovery is limited to
the timeout plus the focused rerun.

Recovery Maker `tst-001-recovery-maker-root-20260806-057` resolved that bounded
verification issue by matching the per-test deadline to the 30000 ms desktop
Main project deadline. The target passed at 20506 ms and the complete focused
suite passed 13 files and 44 tests. No formal migration blocker is open;
acceptance remains pending a fresh Checker of the recovery aggregate.

Final Checker `tst-001-checker-root-20260806-058` recomputed the ten-file
recovery aggregate with zero mismatches and passed the fresh 13-file/44-test
focused project suite. The restart-budget case passed at 29273 ms under its
bounded 30000 ms deadline. No TST-001 migration blocker remains; the task is
`DONE` and only `TST-002` is promoted to `READY`. The accepted import-boundary
limitation and adjacent stale plan-check mutation self-test remain recorded for
their owning later work.

## TST-012 / 2026-08-07

The first bounded audit run found high advisories for `brace-expansion`,
`fast-uri`, and `js-yaml`. This was a current-task dependency blocker, not a
reason to widen the test matrix. Exact fixed overrides were applied, the
obsolete brace-expansion patch was removed, and both lockfiles were regenerated.
The final `bun install --frozen-lockfile` and `bun audit --json` exit `0` with
an empty audit result. `minimumReleaseAge: 0` remains explicit and no
`minimumReleaseAgeExclude` policy is present.

No migration blocker remains for the Maker verification. The accepted full
Bun import-boundary limitation remains assigned to TST-000/later tooling and
is not repeated as a TST-012 blocker. A distinct Checker must still accept the
TST-012 candidate before promotion.

Independent Checker `tst-012-checker-root-20260807-082` reran the bounded
dependency, workflow, type, lint/format, focused runtime, build, diff, and
plan checks with exit `0`. No TST-012 blocker remains; the audit is empty and
only dependency-satisfied `TST-013` is promoted. The accepted TST-000
import-boundary limitation and existing lint warnings remain nonblocking
follow-up items.

## TST-013 / 2026-08-07

No migration blocker opened. The bounded dual-runtime aggregate passes all
required categories, including HTTP/WebSocket normalization, recorded
barrage/silence behavior, persistence projection, shutdown/resource cleanup,
and redacted offline replay invariants.

The Python parity fixture currently returns an internal 500 from its
authenticated debug route and logs the corresponding traceback while Bun
returns a redacted snapshot. This is retained as twelve explicit
`python-debug-snapshot-unavailable` classifications in the report, not
discarded or promoted to an unbounded test expansion. The Bun redaction proof,
zero-orphan check, released ports, and temporary-directory cleanup remain
passing. An independent Checker must review this classified boundary before
`TST-013` can be marked `DONE`.

Independent Checker `tst-013-checker-root-20260807-084` reran the bounded
aggregate, strict typechecks, live plan-check, and diff check with exit `0`.
No TST-013 blocker remains; the Python debug-route 500 is a retained,
classified boundary and not an unexplained parity drop. Only `GATE-07` is
promoted.

## GATE-07 / 2026-08-07

No migration blocker opened. The bounded phase-exit audit passes all eleven
criteria, the retained-test ledger has 47/47 mapped rows with zero unmapped,
and the accepted TST-000..014 Checker records are current enough for this
gate. Existing Node engine, credentialed-live Provider, and classified Python
debug-route limitations remain explicit and do not block the recorded/tooling
exit claim.

Independent Checker `gate-07-checker-root-20260807-087` reran the gate audit,
coverage-ledger validation, live plan-check, and diff hygiene with exit `0`.
No GATE-07 blocker remains; only `PKG-001` is promoted.

## PKG-011 / pkg-011-maker-root-20260807-113

The bounded macOS package-path run is externally blocked on the current
Windows 11 x64 host. The repository workflow has no macOS runner, `xcodebuild`
and `codesign` are unavailable, and no macOS 13+ hardware, Developer ID
signing identity, or notarization authority is present. Bun Darwin arm64/x64
cross-build attempts fail during target-runtime extraction, and
electron-builder rejects the macOS package path because it is being invoked on
Windows. These are recorded as separate cross-build diagnostics rather than
installed macOS proof.

This is one bounded PKG-011 attempt. The exact missing authority/resources are
recorded in `docs/migrations/typescript-bun/PKG-011-MACOS-LIMITATION-DECISION.md`
and the result under
`.omx/artifacts/typescript-bun/PKG-011/pkg-011-maker-root-20260807-113/`.
The next executable runbook is to execute the strict typecheck and checker on
a macOS 13+ arm64 runner with Xcode CLI tools, Developer ID signing, and
notarization credentials, then repeat the equivalent Bun compile and
electron-builder `--mac --arm64 --dir` path. The current Windows x64 release
claim remains the only proven claim; no `ACCEPTED_LIMITATION` authorization was
given. A distinct Checker must decide the planned `BLOCKED` transition.

Independent Checker `pkg-011-checker-root-20260807-114` reproduced the same
external condition and accepted the bounded result as `BLOCKED` at
`same_blocker_attempts=1`. No macOS release claim is made and `PKG-012` is not
promoted. On 2026-08-08 the human instruction `Windows-only 限制授权`
explicitly narrowed the current release scope to Windows x64. Recovery Maker
`pkg-011-limitation-maker-root-20260808-115` aligned release-facing claims and
returned the task to `VERIFY`; the blocker remains active only until a distinct
Checker accepts or rejects the terminal limitation.

## `PKG-011-MACOS-PLATFORM` - `PKG-011` - macOS package authority unavailable

- Status: `ACCEPTED_LIMITATION`
- First seen: 2026-08-07
- Last updated: 2026-08-08
- Owner: migration release gate
- Task claim blocked: `PKG-011` cannot validate the supported macOS package
  path or make an installed macOS release claim.
- Error signature: Bun Darwin arm64/x64 target extraction fails on Windows;
  electron-builder reports that macOS builds are supported only on macOS.
- Environment: Windows 11 x64, no macOS workflow runner, no `xcodebuild`, no
  `codesign`, and no macOS hardware or signing/notarization authority.
- Why this is a blocker: cross-build output cannot prove native dependencies,
  installed lifecycle, media behavior, signing, or notarization on macOS.
- Attempts:
  1. `pkg-011-maker-root-20260807-113`: ran the bounded cross-build and
     electron-builder diagnostics; no installed proof was produced.
  2. `pkg-011-checker-root-20260807-114`: independently reproduced the same
     platform condition; result remains `BLOCKED`.
  3. `pkg-011-limitation-maker-root-20260808-115`: recorded explicit human
     Windows-only authorization, aligned downstream release claims, and passed
     the focused accepted-limitation checker; terminal acceptance is pending a
     distinct Checker.
- Security/data impact: no release widening; Windows x64 claim remains intact.
- Current evidence:
  - `.omx/artifacts/typescript-bun/PKG-011/pkg-011-checker-root-20260807-114/`
  - `docs/migrations/typescript-bun/PKG-011-MACOS-LIMITATION-DECISION.md`
- Resolution condition: a distinct Checker accepts the human-authorized
  Windows-only limitation, or future installed macOS evidence replaces it.
- Recovery task or decision: verify the authorization and downstream claim
  alignment; do not promote `PKG-012` before terminal acceptance.
- Accepted limitation authority/scope/expiry: human user instruction
  `Windows-only 限制授权`, 2026-08-08; current release Windows x64 only;
  revisit owner is the future macOS release owner; expires before any macOS
  release candidate, download, signing, notarization, support statement, or
  public availability.
- Resolved by run: `pkg-011-limitation-checker-root-20260808-116`.
- Residual limitation: macOS arm64/x64 remains unproven and unreleased.

Independent limitation Checker `pkg-011-limitation-checker-root-20260808-116`
accepted the authorization, release-claim alignment, revisit owner/trigger,
focused checker result, and exact `GATE-08` permission. The blocker is closed
as `ACCEPTED_LIMITATION`, not as platform proof or `DONE`; only `PKG-012` is
promoted.

## CUT-005 / cut-005-maker-root-20260808-131

No migration blocker remains. The first supported root Bun test run found one
stale import-boundary declaration: 238 of 239 backend tests passed, while the
boundary checker did not recognize later accepted operational source areas and
two reviewed dependencies. The Maker repaired only that direct blocker,
preserved the three composition-root rule, and reran the focused boundary gate
plus the root command successfully. A distinct Checker must still accept or
reject CUT-005; CUT-006 is not promoted by this Maker record.

Independent Checker `cut-005-checker-root-20260808-132` reran the frozen
install, strict command gate, root tests, contracts drift, workspace checks,
replay/eval/evidence, recorded E2E, and Windows x64 package command with exit
`0`. The 15-file aggregate matches Maker evidence with zero mismatches. CUT-005
has no blocker and is accepted as `DONE`; only CUT-006 is promoted to `READY`.

## CUT-006 / cut-006-maker-root-20260808-133

No migration blocker remains. The first replacement runtime smoke deterministically
stalled at Playwright Electron launch because the launcher was hosted directly
inside Bun. The bounded repair moved only that launcher into a Node child,
retained Bun orchestration and the supervised Bun backend, added child-tree
cleanup, and passed both the source full-pipeline smoke and source/compiled
TST-008. A distinct Checker must still accept or reject CUT-006; CUT-007 is not
promoted by this Maker record.

Independent Checker `cut-006-checker-root-20260808-134` reran the focused gate,
source/compiled Windows Electron matrix, package/manifest, audit, signature,
and process-cleanup checks with exit `0`. The 14-file aggregate matches Maker
evidence with zero mismatches. CUT-006 has no blocker and is accepted as
`DONE`; only CUT-007 is promoted to `READY`.

## CUT-007 / cut-007-maker-root-20260808-135

No migration blocker remains. The focused documentation audit covers the
current repository/app READMEs, architecture, backend design, decisions,
product, protocol, real-pipeline, and operations surfaces. It reports zero
legacy command/backend/Director-semantic hits and zero broken local links;
retained historical documents are explicitly labeled and the Python parity
oracle remains present. A distinct Checker must still accept or reject
CUT-007; CUT-008 is not promoted by this Maker record.

Independent Checker `cut-007-checker-root-20260808-136` reran the strict
documentation gate, formatting, diff validation, and 24-file identity
comparison with exit `0` and zero mismatches. CUT-007 has no blocker and is
accepted as `DONE`; only CUT-008 is promoted to `READY`. The Python parity
oracle remains present, and CUT-008 still requires its explicit human deletion
gate before any removal work.
