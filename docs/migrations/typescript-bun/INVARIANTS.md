# ADVX Live Behavioral Invariant Register

> Register version: 2
>
> Task: `FND-002`
>
> Source state: `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`
>
> Maker source-state artifact:
> `.omx/artifacts/typescript-bun/FND-002/fnd-002-maker-20260730-004/source-state.json`

## 1. Authority And Interpretation

This register freezes observable behavior for migration parity. The normative
statements below are framework-neutral. References to the current
Python/FastAPI/Electron implementation are parity-oracle evidence only and do
not prescribe the TypeScript/Bun design.

Authority precedence is:

1. Confirmed product rules in
   `docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md`.
2. Implemented wire rules and tests in `docs/INGEST_PROTOCOL.md`.
3. Current architecture and backend behavioral contracts in
   `docs/ARCHITECTURE.md` and `docs/BACKEND_DESIGN.md`.
4. `docs/REAL_PIPELINE.md` for current platform/process observations.
5. `docs/VIEWER_RUNTIME_REQUIREMENTS_LOG.md` only where it is not superseded;
   its Director rules are explicitly historical.

When a lower-precedence source or implementation contradicts a higher-precedence
product rule, the product rule remains the invariant and the difference is
recorded as a parity gap. No current implementation detail weakens the rule.

## 2. Numbered Invariants

Each row contains one normative behavioral statement. `Proof` names an existing
test/fixture or a stable gap ID; a test reference means only that the stated
part is exercised, not that every cross-process or packaged condition is proven.

| ID | Normative behavioral statement | Authoritative source | Current parity oracle | Proof |
| --- | --- | --- | --- | --- |
| `INV-SEC-001` | Startup control and data transport MUST listen only on loopback and MUST NOT expose a LAN-facing port by default. | `docs/ARCHITECTURE.md:428-434`; `docs/REAL_PIPELINE.md:30-36` | `apps/desktop/src/main/index.ts:53,166`; `apps/desktop/src/main/backend/backend-client.ts:117` | `apps/desktop/src/main/backend/backend-process.test.ts`; `GAP-LIFE-001` |
| `INV-SEC-002` | Every application startup MUST use unpredictable short-term local authentication; Renderer MUST NOT receive the plaintext authentication token or Provider credentials; credentials MUST NOT enter command-line arguments, environment variables, ordinary configuration, responses, or logs; stop MUST clear injected in-memory secrets. | `docs/ARCHITECTURE.md:430-432,450-454`; `docs/REAL_PIPELINE.md:30-36` | `apps/desktop/src/main/index.ts:53-54,129-133`; `apps/backend/src/advx_backend/bootstrap.py:87,626-630`; `apps/backend/tests/test_configuration_api.py:53-139` | `apps/backend/tests/test_configuration_api.py`; `GAP-SEC-001` |
| `INV-SEC-003` | UI rendering contexts MUST receive only narrow, capability-specific bridges and MUST NOT have direct authority over secrets, backend or external-service access, filesystem access, capture, safe storage, or process lifecycle. | `docs/migrations/typescript-bun/01-FOUNDATION-TOOLCHAIN.md:113-125`; `docs/ARCHITECTURE.md:46-57`; `docs/REAL_PIPELINE.md:3`; `docs/migrations/typescript-bun/06-DESKTOP-INTEGRATION.md:25-34` | `apps/desktop/src/preload/control.ts`; `apps/desktop/src/main/windows/control.ts:52-57`; `apps/desktop/src/main/logging.ts:61-81` | `GAP-SEC-001` |
| `INV-ID-001` | Every runtime effect MUST be scoped by stable Room identity, logical Session identity, and the active `audience_epoch`, with Viewer/Observation/generation identities added where applicable. | `docs/ARCHITECTURE.md:268-282,456-465`; `docs/BACKEND_DESIGN.md:181-183` | `apps/backend/src/advx_backend/domain/observation_wave.py:85-107`; `apps/backend/tests/test_runtime_session_api.py:202-346` | `apps/backend/tests/test_runtime_session_api.py`; `apps/backend/tests/test_realtime_api.py` |
| `INV-CFG-001` | A runtime-spec apply MUST become visible atomically at an ObservationWave boundary, increment `audience_epoch`, preserve the previous committed revision on failure, and give old-epoch work zero visible or persistent side effects. | `docs/ARCHITECTURE.md:256,462-465`; `docs/BACKEND_DESIGN.md:352,415-420` | `apps/backend/tests/test_runtime_session_api.py:234-325`; `apps/backend/src/advx_backend/application/viewer_runtime.py` | `apps/backend/tests/test_runtime_session_api.py`; `GAP-FENCE-001` |
| `INV-CTX-001` | All Viewers in one wave MUST receive the same frozen public context and memory revision, while each Viewer receives only its own private state and cannot observe same-wave peer output before that output is published. | `docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md:153-163,217`; `docs/ARCHITECTURE.md:268-286,307-313`; `docs/BACKEND_DESIGN.md:170,174-177` | `apps/backend/src/advx_backend/application/context_builder.py`; `apps/backend/src/advx_backend/application/viewer_runtime.py` | `GAP-CTX-001` |
| `INV-PROTO-001` | Every HTTP, WebSocket, JSON, and binary ingest input MUST validate authentication, message type, negotiated protocol version, size, ordering, identity, media source, encoding, and declared-versus-actual length before domain processing. | `docs/INGEST_PROTOCOL.md:13-31,79-125`; `docs/ARCHITECTURE.md:428-433` | `apps/backend/tests/test_realtime_api.py:40-115`; `apps/backend/tests/test_realtime_ingest_api.py:132-346` | `apps/backend/tests/test_realtime_api.py`; `apps/backend/tests/test_realtime_ingest_api.py` |
| `INV-QUEUE-001` | Input, observation, Viewer, transcript, frame, and publication queues MUST be bounded. Newer user input or a higher-priority wave MUST supersede older work and make older results zero-effect; lower-priority work MUST NOT interrupt user input. For same-priority system-audio, frame, or ambient work, a newer wave MUST replace older undispatched pending work, while dispatched requests MUST retain a completion chance subject to all fences and the Viewer request deadline. The product-default Viewer request TTL MUST be exactly 30 seconds from wave creation; expired results MUST have zero effect. A newer same-priority user wave MUST make results from the older user wave zero-effect. | `docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md:21,59,102,108,239-240`; `docs/ARCHITECTURE.md:319-325,433,464-467`; `docs/BACKEND_DESIGN.md:175,183` | `apps/backend/src/advx_backend/contracts/viewer_runtime.py:67-70`; `apps/backend/src/advx_backend/application/reaction_scheduler.py:145-275,410-483,584-703`; `apps/backend/src/advx_backend/application/viewer_runtime.py:1090-1107,1301-1313`; `apps/backend/tests/test_viewer_reaction_retention.py:234-315` | `apps/backend/tests/test_viewer_reaction_retention.py`; `GAP-FENCE-001` |
| `INV-FENCE-001` | Replaced, expired, cancelled, stopped, protocol-invalid, or stale work MUST pass a final Session/epoch/Observation/Viewer/sequence/deadline/evidence fence and MUST have zero effects on UI, Room history, behavior state, memory, meme state, or persistence. | `docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md:21,102,205,213-217`; `docs/ARCHITECTURE.md:462-467`; `docs/BACKEND_DESIGN.md:176,181-183` | `apps/backend/tests/test_viewer_reaction_retention.py:316-386`; `apps/backend/src/advx_backend/application/viewer_runtime.py` | `apps/backend/tests/test_viewer_reaction_retention.py`; `GAP-FENCE-001` |
| `INV-VIEW-001` | `silence` MUST be a legal result for every Viewer, including a directly mentioned Viewer, and direct mention MUST NOT force speech. | `docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md:176,180-203`; `docs/VIEWER_RUNTIME_REQUIREMENTS_LOG.md:124-128` | `apps/backend/tests/test_viewer_runtime_prompts.py:7-29`; `apps/backend/src/advx_backend/contracts/viewer_runtime.py:60-63,370-380` | `apps/backend/tests/test_viewer_runtime_prompts.py`; `GAP-VIEW-001` |
| `INV-VIEW-002` | Candidate Viewers MUST make independent Provider-backed barrage-or-silence decisions through separate per-Viewer Provider requests, with no Director, central topic model, global answer, or multi-Viewer generation arbitration. | `docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md:13-20,149-180,246-250` | `apps/backend/src/advx_backend/contracts/viewer_runtime.py:55-62,86-100`; `apps/backend/src/advx_backend/application/viewer_runtime_coordinator.py:280-290,428-437`; `apps/backend/src/advx_backend/providers/model/viewer_runtime.py:482-550` | `tests/fixtures/cs2/viewer_runtime_recorded.json`; `tests/e2e/test_viewer_runtime_recorded.py`; `GAP-VIEW-002` |
| `INV-TRIG-001` | A published `audience_barrage` MUST NOT recursively trigger another ObservationWave. | `docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md:98-102,242-249`; `docs/ARCHITECTURE.md:294-301` | `apps/backend/src/advx_backend/application/ingest_service.py`; `apps/backend/src/advx_backend/application/viewer_runtime.py` | `GAP-TRIG-001` |
| `INV-BUDGET-001` | Candidate budgets MUST be exactly 6 for a user observation, `ceil(active viewers / 4)` for a screen observation, 2 for ambient, and one target for a direct mention of an accurately named Viewer or Persona. A direct Persona mention MUST select exactly one eligible Persona instance under the local deterministic pre-dispatch rule. Candidate count and rotation MUST be decided locally and deterministically before Provider dispatch, with replayable selection and no post-generation ranking or discard of otherwise valid current results. | `docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md:17-21,60,213-217,237-240` | `apps/backend/src/advx_backend/contracts/viewer_runtime.py:78-80`; `apps/backend/src/advx_backend/application/viewer_runtime_coordinator.py:543-573`; `apps/backend/src/advx_backend/application/viewer_behavior_service.py`; `apps/backend/tests/test_viewer_reaction_retention.py:234-315` | `apps/backend/tests/test_viewer_reaction_retention.py`; `tests/fixtures/cs2/viewer_runtime_recorded.json`; `GAP-VIEW-002` |
| `INV-GEN-001` | Each candidate MUST receive one logical generation that decides silence or content. A structurally invalid result MAY receive only one protocol repair and only when at least 6 seconds remain before the deadline; total physical Provider requests MUST remain at most 2, and repair MUST NOT substitute another Viewer. | `docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md:61,202-203`; `docs/ARCHITECTURE.md:326-328`; `docs/BACKEND_DESIGN.md:457-458` | `apps/backend/src/advx_backend/providers/model/viewer_runtime.py:294-295,1168-1169`; `apps/backend/src/advx_backend/application/viewer_runtime.py` | `tests/fixtures/cs2/viewer_runtime_recorded.json`; `GAP-VIEW-002` |
| `INV-PUB-001` | For a barrage batch, the first text MUST publish immediately, later texts MUST publish at 500 ms intervals, and every delayed text MUST be re-fenced immediately before publication. | `docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md:200-205,217` | `apps/backend/src/advx_backend/application/viewer_runtime.py` | `GAP-PUB-001` |
| `INV-PUB-002` | Every published message MUST enter shared history immediately at publication and MUST retain its association with the user message; unpublished messages MUST NOT enter shared history. For `action=barrage`, `texts` SHOULD normally contain 3-6 distinct complete texts. For `action=silence`, `intent` and `reaction_type` MUST be `silence` and `target` and `texts` MUST be null. Each displayed text longer than 160 Chinese characters MUST be truncated to 160 characters instead of causing whole-result discard. | `docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md:34-36,180-205,211-217` | `apps/backend/tests/test_viewer_runtime_contract.py:7-17`; `apps/backend/src/advx_backend/contracts/viewer_runtime.py`; `apps/backend/src/advx_backend/providers/model/viewer_runtime.py:191-220` | `apps/backend/tests/test_viewer_runtime_contract.py`; `GAP-PUB-001` |
| `INV-FRAME-001` | Frame selection MUST use the full available timeline up to the latest 120 seconds, sampled at 1 fps where continuous sampling is specified, without deleting raw timeline entries merely because they are similar. | `docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md:38-55,92-96,110-129` | `apps/backend/src/advx_backend/domain/observation_wave.py:5-10,37-52`; `apps/backend/src/advx_backend/application/observation_wave_builder.py:20-44` | `GAP-FRAME-001`; `GAP-FRAME-002` |
| `INV-FRAME-002` | Frame condensation MUST compare each frame with its segment reference, start a new segment at 10% accumulated change or after the 5-second anchor, and retain the segment-end frame as representative. | `docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md:52-53,118-127` | `apps/backend/src/advx_backend/application/observation_wave_builder.py:60-87,90-106` | `GAP-FRAME-001`; `GAP-FRAME-002` |
| `INV-FRAME-003` | The frame that triggered the wave MUST always be retained, while ordinary direct frames older than 30 seconds MUST be excluded before dispatch. | `docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md:51,114-126,153-159` | `apps/backend/src/advx_backend/domain/observation_wave.py:81-98`; `apps/backend/src/advx_backend/application/viewer_runtime_coordinator.py:741-797` | `GAP-FRAME-001`; `GAP-FRAME-002` |
| `INV-FRAME-004` | When representatives exceed 15, the final bundle MUST be uniformly time-sampled to at most 15 frames while preserving chronological order and timestamps. | `docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md:55,120-127,157` | `apps/backend/src/advx_backend/domain/observation_wave.py:5-9,67-81`; `apps/backend/src/advx_backend/application/observation_wave_builder.py:38-57,86-87` | `GAP-FRAME-001`; `GAP-FRAME-002` |
| `INV-TRIG-002` | Trigger merging MUST use a non-extending 1-second window; a screen-change trigger requires an exact threshold of `0.2` and a 5-second global cooldown, MUST be dropped while another trigger is pending/processing, and MUST NOT overlap a pending wave. | `docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md:54,58,73,92-102`; `docs/ARCHITECTURE.md:294-301` | `apps/backend/src/advx_backend/contracts/viewer_runtime.py:73,82-85`; `apps/backend/src/advx_backend/application/ingest_service.py` | `GAP-TRIG-002` |
| `INV-ASR-001` | Microphone and system audio MUST use isolated, independently schedulable ASR streams and buffers and MUST never be mixed into one recognition input. | `docs/ARCHITECTURE.md:116-118,180-182`; `docs/REAL_PIPELINE.md:3,12,59-67` | `apps/backend/src/advx_backend/providers/asr/stepfun.py`; `apps/backend/src/advx_backend/application/ingest_service.py` | `apps/backend/tests/test_realtime_ingest_api.py`; `GAP-ASR-001` |
| `INV-ASR-002` | Standalone system audio MUST submit a final segment after approximately 0.8 seconds of silence and MUST hard-segment after at most 8 seconds of continuous system audio. Only final ASR transcripts MAY persist as Room events; a paired microphone/system turn MUST share one `turn_id` and trigger exactly one wave, degrade after 3 seconds if the paired final is late, and persist that late final without retriggering. | `docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md:49,75-86,87-90`; `docs/INGEST_PROTOCOL.md:42,57-72,73-75`; `docs/BACKEND_DESIGN.md:168-170` | `apps/desktop/src/renderers/control/audio.ts:1-8,28-37`; `apps/backend/tests/test_realtime_ingest_api.py:193-254`; `apps/backend/src/advx_backend/application/ingest_service.py` | `apps/backend/tests/test_realtime_ingest_api.py`; `GAP-ASR-001` |
| `INV-CTX-002` | Viewer public context MUST be bounded to the latest 60 seconds with per-source quotas of 16 and total 48, while reply context MUST be independently bounded to 30 seconds and 8 items and preserve a parent only while that parent remains eligible. | `docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md:56-57,135-147,231-235`; `docs/ARCHITECTURE.md:260-265` | `apps/backend/src/advx_backend/contracts/viewer_runtime.py:74-77`; `apps/backend/src/advx_backend/application/context_builder.py` | `tests/fixtures/cs2/viewer_runtime_recorded.json`; `GAP-CTX-002` |
| `INV-MEM-001` | Long-term memory MUST derive from public evidence, retain evidence references and revision, and MUST NOT treat AI-only output as proof of real-world fact. | `docs/ARCHITECTURE.md:456-458`; `docs/BACKEND_DESIGN.md:370-372,426-437` | `apps/backend/src/advx_backend/application/memory_service.py`; `apps/backend/src/advx_backend/infrastructure/persistence/sqlite` | `tests/fixtures/cs2/viewer_runtime_recorded.json`; `tests/e2e/test_viewer_runtime_recorded.py`; `GAP-MEM-001` |
| `INV-MEM-002` | After memory deletion, revocation, edit, expiry, or replacement is committed, later waves MUST use the new head and the removed value MUST NOT re-enter through retrieval, reply chains, summaries, replay, backup, or stale asynchronous work. | `docs/ARCHITECTURE.md:447-458`; `docs/BACKEND_DESIGN.md:416-420,426-450`; `docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md:141-147,231-235` | `apps/backend/src/advx_backend/application/memory_service.py`; `apps/backend/src/advx_backend/infrastructure/persistence/sqlite` | `GAP-MEM-001` |
| `INV-ASYNC-001` | Memory extraction and meme validation/persistence MUST run independently and MUST NOT block barrage validation or publication; neither a memory nor meme candidate MAY directly become a barrage. | `docs/ARCHITECTURE.md:456-458`; `docs/BACKEND_DESIGN.md:178-181,376,437` | `apps/backend/src/advx_backend/application/memory_service.py`; `apps/backend/src/advx_backend/application/meme_service.py` | `tests/e2e/test_viewer_runtime_recorded.py`; `GAP-MEM-002` |
| `INV-PRIV-001` | Persistence, logs, traces, replay bundles, and diagnostics MUST NOT retain raw audio, complete frames/private screenshots, complete prompts, raw Provider responses, hidden reasoning, or credentials. | `docs/ARCHITECTURE.md:450-456`; `docs/BACKEND_DESIGN.md:362,460,470-486`; `docs/INGEST_PROTOCOL.md:102-107,127-130` | `apps/backend/src/advx_backend/infrastructure/logging`; `apps/backend/src/advx_backend/infrastructure/persistence/sqlite`; `apps/desktop/src/main/logging-redaction.ts` | `apps/backend/tests/test_ai_call_store.py`; `GAP-PRIV-001` |
| `INV-EVID-001` | Deterministic fake, recorded-provider replay, credentialed live Provider, platform/process, and packaged-release evidence MUST be labeled separately and MUST NOT substitute for one another. | `docs/ARCHITECTURE.md:500-514`; `docs/BACKEND_DESIGN.md:481-490`; `docs/migrations/typescript-bun/LOOP.md:109-139` | `tests/fixtures/cs2/viewer_runtime_recorded.json`; `tests/e2e/test_viewer_runtime_recorded.py`; `docs/REAL_PIPELINE.md:49-70` | `tests/e2e/test_viewer_runtime_recorded.py`; `GAP-EVID-001` |
| `INV-RECON-001` | Reconnect or backend recovery MUST establish a fresh data plane and MUST NOT replay old capture buffers, uncommitted audio, complete frames, old Provider requests, deadlines, queues, or old-epoch candidates. | `docs/INGEST_PROTOCOL.md:63-66`; `docs/BACKEND_DESIGN.md:446-450`; `docs/REAL_PIPELINE.md:74-81` | `apps/backend/tests/test_runtime_session_api.py:327-346`; `apps/backend/src/advx_backend/application/ingest_service.py` | `apps/backend/tests/test_runtime_session_api.py`; `GAP-RECON-001` |
| `INV-STOP-001` | Stop and application exit MUST make the Session reject results, cancel and drain bounded tasks, release screen/window capture, microphone and system audio, close sockets, clear buffers, and terminate the supervised child process without an orphan. | `docs/ARCHITECTURE.md:149-155,428-434,462-465`; `docs/BACKEND_DESIGN.md:181-190,459`; `docs/REAL_PIPELINE.md:49-57` | `apps/backend/tests/test_viewer_reaction_retention.py:355-386`; `apps/backend/tests/test_realtime_api.py:251-290`; `apps/desktop/src/main/backend/backend-process.test.ts:62-96` | `apps/backend/tests/test_viewer_reaction_retention.py`; `apps/backend/tests/test_realtime_api.py`; `apps/desktop/src/main/backend/backend-process.test.ts`; `GAP-LIFE-001` |

### 2.1 Exact Family Mapping

The machine register MUST copy these family values exactly; family names are
coverage labels, not additional behavioral requirements.

| Invariant ID | Family |
| --- | --- |
| `INV-SEC-001` | `startup_transport` |
| `INV-SEC-002` | `startup_auth` |
| `INV-SEC-003` | `renderer_security` |
| `INV-ID-001` | `identity_epoch` |
| `INV-CFG-001` | `identity_epoch` |
| `INV-CTX-001` | `frozen_context` |
| `INV-PROTO-001` | `protocol_validation` |
| `INV-QUEUE-001` | `queue_fence` |
| `INV-FENCE-001` | `queue_fence` |
| `INV-VIEW-001` | `viewer_decision` |
| `INV-VIEW-002` | `viewer_independence` |
| `INV-TRIG-001` | `trigger_semantics` |
| `INV-BUDGET-001` | `candidate_budget` |
| `INV-GEN-001` | `generation_budget` |
| `INV-PUB-001` | `publication` |
| `INV-PUB-002` | `publication` |
| `INV-FRAME-001` | `frame_timeline` |
| `INV-FRAME-002` | `frame_timeline` |
| `INV-FRAME-003` | `frame_timeline` |
| `INV-FRAME-004` | `frame_timeline` |
| `INV-TRIG-002` | `trigger_semantics` |
| `INV-ASR-001` | `asr` |
| `INV-ASR-002` | `asr` |
| `INV-CTX-002` | `context_quotas` |
| `INV-MEM-001` | `memory` |
| `INV-MEM-002` | `memory` |
| `INV-ASYNC-001` | `memory` |
| `INV-PRIV-001` | `privacy` |
| `INV-EVID-001` | `evidence_taxonomy` |
| `INV-RECON-001` | `reconnect` |
| `INV-STOP-001` | `stop_cleanup` |

## 3. Frozen Contradictions And Proof Gaps

Gap IDs are stable migration references. A future task mapping names only an
existing master-plan task or gate; it is not a new task or a replan.

| Gap ID | Affected invariants | Classification | Status | Missing or contradictory proof | Existing migration owner |
| --- | --- | --- | --- | --- | --- |
| `GAP-SEC-001` | `INV-SEC-002`, `INV-SEC-003` | `CURRENT_NON_PARITY` | `NON_PASSING` | Current desktop startup passes `ADVX_LOCAL_TOKEN` through the child environment (`apps/desktop/src/main/index.ts:129-133`), contradicting `INV-SEC-002`. Current BrowserWindow flags are only parity-oracle posture evidence, and privileged logging IPC lacks sender validation (`apps/desktop/src/main/logging.ts:61-81`); no complete bridge-capability and untrusted-sender rejection proof exists for `INV-SEC-003`. | `DES-009`, `PKG-007`, `GATE-08` |
| `GAP-LIFE-001` | `INV-SEC-001`, `INV-STOP-001` | `MISSING_PROOF` | `NON_PASSING` | Unit cleanup exists, but no integrated dev-and-packaged proof covers capture/audio/socket/task release plus child-process orphan detection. | `DES-005`, `PKG-006` |
| `GAP-FENCE-001` | `INV-CFG-001`, `INV-QUEUE-001`, `INV-FENCE-001` | `CURRENT_NON_PARITY` | `NON_PASSING` | Current priority-3 user observations are preserved or merged and run concurrently (`apps/backend/src/advx_backend/application/reaction_scheduler.py:156-195`; `apps/backend/tests/test_viewer_reaction_retention.py:234-262`), and current tests require both a newer wave and a late older wave to publish (`apps/backend/tests/test_viewer_reaction_retention.py:264-315`). The current wave fence advances for every different observation without priority comparison (`apps/backend/src/advx_backend/application/viewer_runtime.py:1301-1313`), while wave-current logic accepts admitted dispatched work from older generations (`apps/backend/src/advx_backend/application/viewer_runtime.py:1090-1107`). This contradicts the required zero-effect result for an older same-priority user wave. The product-default Viewer request TTL is exactly 30 seconds from wave creation, but current `RuntimeSettings.viewer_request_ttl_ms` defaults to `0`, which disables the deadline (`apps/backend/src/advx_backend/contracts/viewer_runtime.py:67-70`). Cross-session races and final fences across every visible and persistent side effect also lack complete proof. | `AGT-013`, `TST-004` |
| `GAP-CTX-001` | `INV-CTX-001` | `MISSING_PROOF` | `NON_PASSING` | No focused test proves that a fast same-wave unpublished Viewer result is absent from every slower peer request while private state remains isolated. | `AGT-008` |
| `GAP-CTX-002` | `INV-CTX-002` | `MISSING_PROOF` | `NON_PASSING` | Recorded fixtures exercise context, but no exact boundary suite proves all per-source quotas, parent expiry, and no old-summary re-entry. | `AGT-006`, `AGT-008` |
| `GAP-VIEW-001` | `INV-VIEW-001` | `CURRENT_NON_PARITY` | `NON_PASSING` | Current runtime/request defaults set `allow_viewer_silence=False` (`apps/backend/src/advx_backend/contracts/viewer_runtime.py:60-62,370-380`), and prompt tests require the default-disabled prompt to remove silence (`apps/backend/tests/test_viewer_runtime_prompts.py:7-17`). This contradicts silence being legal for every Viewer, including a directly mentioned Viewer, and no direct-mention silence proof exists. | `AGT-008` |
| `GAP-VIEW-002` | `INV-VIEW-002`, `INV-BUDGET-001`, `INV-GEN-001` | `CURRENT_NON_PARITY` | `NON_PASSING` | The current contract exposes `WINDOW_BATCH` alongside a `PER_VIEWER` default and a validated batch preset (`apps/backend/src/advx_backend/contracts/viewer_runtime.py:55-62,86-100`); coordinator dispatch paths select batch generation (`apps/backend/src/advx_backend/application/viewer_runtime_coordinator.py:280-290,428-437`), and the Provider performs one request for multiple Viewers (`apps/backend/src/advx_backend/providers/model/viewer_runtime.py:482-550`). This active mode contradicts independent per-Viewer Provider requests and no multi-Viewer arbitration. Product screen budget is `ceil(active viewers / 4)`, but current `RuntimeSettings.viewer_screen_speaker_budget` has fixed default `4` and the coordinator uses that fixed setting for screen selection (`apps/backend/src/advx_backend/contracts/viewer_runtime.py:78-80`; `apps/backend/src/advx_backend/application/viewer_runtime_coordinator.py:555-573`). No decisive isolation test proves per-Viewer calls, deterministic pre-dispatch rotation, no post-generation discard, and the per-Viewer two-request bound. | `AGT-007`, `AGT-009`, `AGT-010` |
| `GAP-TRIG-001` | `INV-TRIG-001` | `MISSING_PROOF` | `NON_PASSING` | No focused regression proves that an `audience_barrage` event cannot recursively enqueue a wave. | `AGT-006` |
| `GAP-TRIG-002` | `INV-TRIG-002` | `MISSING_PROOF` | `NON_PASSING` | No exact timeline test proves the non-extending merge window, global cooldown reset, and no-pending-wave overlap semantics together. | `AGT-006` |
| `GAP-PUB-001` | `INV-PUB-001`, `INV-PUB-002` | `CURRENT_NON_PARITY` | `NON_PASSING` | The current barrage-only prompt requires 1-3 texts (`apps/backend/src/advx_backend/providers/model/viewer_runtime.py:191-220`) and the contract permits at least one text (`apps/backend/src/advx_backend/contracts/viewer_runtime.py:459-484`), while product behavior says `texts` SHOULD normally contain 3-6. No virtual-clock test proves 500 ms pacing, delayed-item re-fencing, and history insertion only at publication time. | `AGT-011`, `TST-004` |
| `GAP-FRAME-001` | `INV-FRAME-001`, `INV-FRAME-002`, `INV-FRAME-003`, `INV-FRAME-004` | `CURRENT_NON_PARITY` | `NON_PASSING` | Confirmed product rules require a full available 120-second timeline, 90% similarity, 5-second segment anchor, segment-end representatives, unconditional trigger retention, ordinary direct-frame age at most 30 seconds, and at most 15 uniformly time-sampled ordered frames; current code instead clamps to 30 seconds, floors similarity at 95%, caps selection at 5, treats `EVENLY_SPACED` as latest-N, keeps the latest 5 groups, and does not decisively implement trigger/direct-age exceptions (`apps/backend/src/advx_backend/domain/observation_wave.py:5-9,37-52`; `apps/backend/src/advx_backend/application/observation_wave_builder.py:29-55,86-87`). This contradiction is NOT passing parity. | `AGT-006` |
| `GAP-FRAME-002` | `INV-FRAME-001`, `INV-FRAME-002`, `INV-FRAME-003`, `INV-FRAME-004` | `MISSING_PROOF` | `NON_PASSING` | No exact timeline fixture/test covers start-under-120-seconds behavior, 1 fps accumulation, 90% boundary, segment-reference comparison, segment-end selection, trigger preservation, direct-age filtering, uniform selection to 15, order, and timestamps. | `AGT-006`, `TST-003`, `TST-004` |
| `GAP-ASR-001` | `INV-ASR-001`, `INV-ASR-002` | `MISSING_PROOF` | `NON_PASSING` | Protocol tests cover v4 source/turn fields, and current `apps/desktop/src/renderers/control/audio.ts:1-8,28-37` contains the local 0.8-second silence and 8-second hard-segment constants, but current implementation alone does not prove the integrated behavior. Exact proof remains required for standalone system-audio final submission after approximately 0.8 seconds of silence and hard segmentation after at most 8 seconds of continuous audio, together with isolated Provider execution, final-only persistence, one shared paired turn, exactly one trigger, 3-second degradation, and late-final persistence without retriggering. | `AGT-002`, `DES-008` |
| `GAP-MEM-001` | `INV-MEM-001`, `INV-MEM-002` | `MISSING_PROOF` | `NON_PASSING` | No current lifecycle test proves deletion/revocation across revision advance, stale extractor completion, retrieval, reply linkage, replay, recovery, and backup no-reentry. | `DAT-007`, `AGT-012`, `AGT-013` |
| `GAP-MEM-002` | `INV-ASYNC-001` | `MISSING_PROOF` | `NON_PASSING` | Recorded replay observes memory/meme events but does not prove slow or failed memory/meme work cannot delay barrage publication. | `AGT-012` |
| `GAP-PRIV-001` | `INV-PRIV-001` | `MISSING_PROOF` | `NON_PASSING` | No comprehensive artifact scan proves database, logs, traces, replay, and diagnostics simultaneously exclude every prohibited payload class. | `OBS-003`, `OBS-011`, `GATE-06` |
| `GAP-EVID-001` | `INV-EVID-001` | `MISSING_PROOF` | `NON_PASSING` | Deterministic and recorded evidence exists, but current HEAD has no fresh credentialed-live Provider proof, complete platform/process matrix, or packaged-release proof. | `AGT-015`, `CUT-004`, `PKG-006`, `PKG-011` |
| `GAP-RECON-001` | `INV-RECON-001` | `MISSING_PROOF` | `NON_PASSING` | Recovery advances epoch, but no desktop/backend reconnect test proves old capture and uncommitted media buffers are never replayed. | `DES-008`, `DES-011` |

## 4. Parity Evidence And Fixture Taxonomy

Evidence classes are cumulative, not interchangeable. A higher-cost class does
not retroactively make missing lower-level determinism or protocol assertions
unnecessary.

| Class | Required label | Can prove | Cannot prove |
| --- | --- | --- | --- |
| Deterministic fake | `deterministic_fake` | Local branching, errors, deadlines, cancellation, ordering, seeds, and fences under controlled inputs | Real Provider wire compatibility, credentials, quota behavior, network timing, platform capture, or packaging |
| Recorded Provider replay | `recorded_provider` | Parser/contract parity against frozen Provider-shaped responses without network calls; deterministic regression and provenance | Current credentials, endpoint/model availability, live limits, billing, network behavior, platform capture, or packaged lifecycle |
| Credentialed live Provider | `credentialed_live_provider` | Current endpoint authentication, model/ASR capability, response shape, and bounded live behavior for the named environment | Deterministic repeatability, other Providers/models/accounts, desktop platform capture, or packaged lifecycle |
| Platform/process | `platform_process` | Real OS permissions, screen/window capture, microphone/system loopback, IPC/process supervision, sockets, and release of platform resources | Installer layout, compiled-backend embedding, signing, uninstall, update, or another OS/architecture |
| Packaged release | `packaged_release` | Installed artifact startup, embedded backend, paths, fuses/integrity, restart/stop/uninstall, and orphan behavior on the named target | Other targets, current live Provider capability unless separately credentialed, or deterministic semantic parity without fixture tests |

Non-substitution rules:

1. `deterministic_fake` MUST NOT be reported as recorded, credentialed live,
   platform, or packaged evidence.
2. `recorded_provider` MUST NOT be reported as current Provider availability or
   credentialed success.
3. `credentialed_live_provider` MUST NOT substitute for deterministic replay,
   platform capture/process, or packaged-release proof.
4. `platform_process` MUST NOT substitute for packaged-release or live Provider
   proof.
5. `packaged_release` MUST NOT substitute for a missing semantic parity fixture
   or a separately required credentialed Provider result.

The machine-readable register and coverage matrix are in
`.omx/artifacts/typescript-bun/FND-002/fnd-002-maker-20260730-004/`.
