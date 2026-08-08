# Phase 04: Agent Runtime

> Entry: `GATE-02` and `GATE-03`
>
> Exit: `GATE-04`

## Goal

Port the realtime ASR, observation, candidate selection, independent Viewer
generation, barrage, memory, and meme side-effect runtime to TypeScript while
preserving the current product specification.

## Current Product Authority

`docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md` supersedes older Director-based plans:

- lines 13-21 remove the Director and require deterministic local candidate
  selection followed by independent Viewer model calls;
- lines 49-67 lock key speech/context/call defaults;
- lines 102-103 define replacement versus already-dispatched request behavior;
- lines 145-163 separate public context from bounded reply context and freeze
  same-observation inputs;
- lines 178-205 define `barrage`/`silence`, 3-6 short texts, one bounded repair,
  truncation, and 500 ms publication spacing;
- lines 213-217 define candidate budgets and pre-Provider selection;
- lines 246-252 explicitly prohibit a Director or global theme model.

Any older document or Python implementation that still uses Director semantics
is not a migration requirement. A mismatch must be resolved toward the current
product specification and recorded as intentional parity correction.

## Runtime Shape

```text
typed input events
  -> observation coalescer
  -> frozen public/private context
  -> deterministic local candidate budget and rotation
  -> one logical model call per candidate
  -> barrage or silence schema
  -> identity/epoch/sequence/TTL/evidence/content/dedupe fences
  -> paced public barrage events
  -> independent memory/meme side-effect pipeline
```

## Invariants

- No central model decides who speaks or writes a unified answer.
- Each candidate has an independent Viewer identity, prompt, private state, and
  model result.
- A Viewer may choose silence, including when directly mentioned.
- User input, final microphone ASR, final system-audio ASR, significant frame
  change, and bounded ambient tick are distinct trigger sources.
- Same-priority continuous sources replace only queued undispatched work;
  already-dispatched work may finish but must pass final fences.
- A newer user observation or higher-priority observation makes replaced work
  zero-side-effect.
- Same-observation candidates cannot see not-yet-published peer output.
- Audience barrage enters only bounded reply context, not ordinary public
  context and not a recursive observation trigger.
- Every generated text is attributed locally to an existing Viewer; a Provider
  cannot select or rewrite identity.

## Tasks

### `AGT-001` Provider Contract

Define normalized capabilities and results for:

- health and capability probe;
- text, image, structured output, and streaming support;
- request/response IDs;
- usage and latency metadata;
- safe error code, retryability, and source;
- timeout and abort;
- protocol-repair attempt;
- provider revision and role model.

Provider ports expose ADVX domain requests, not OpenAI-compatible wire objects.

### `AGT-002` StepFun ASR

Port two isolated ASR channels:

- microphone;
- Windows system audio.

Each channel has its own connection, source ID, buffer, partial/final transcript,
timeout, retry, stop, and error status. They are not mixed. Partial transcripts
are UI/debug-only; only idempotent final transcripts enter room events and
observations.

Test:

- normal final result;
- 0.8-second system-audio silence submission;
- bounded eight-second continuous segmentation;
- microphone final pause behavior from current spec;
- one channel failure without killing the other;
- paired microphone/system-audio inputs share `turn_id` and trigger exactly one
  ObservationWave;
- when required system audio has not completed after three seconds, microphone
  triggers once with `system_audio_degraded=true`;
- a paired system-audio final arriving after degradation is persisted with its
  source/turn identity but never triggers a second model wave;
- system audio without a paired `turn_id` remains an independent trigger;
- cancellation or reconnect during a coordinated turn cannot duplicate the
  final transcript, degraded completion, or ObservationWave;
- stop/cancel with no late final transcript;
- malformed/duplicate/out-of-order SSE event;
- 401/429/5xx and disconnect.

### `AGT-003` ModelGateway

Implement AI SDK Core behind an ADVX-owned interface.

Responsibilities:

- compatible endpoint and headers;
- role-specific model selection;
- text/image request conversion;
- non-streaming or streaming transport;
- abort propagation;
- safe metadata extraction;
- normalized errors;
- explicit AI SDK `maxRetries: 0` or the current equivalent;
- physical-request counting under the ADVX-owned two-request budget;
- no Provider SDK objects in persistence;
- no Vercel gateway requirement.

ModelGateway does not own Viewer selection, retries beyond passed policy, memory,
or barrage publication. SDK defaults must not retry behind the scheduler's
back. Initial call, one eligible transient retry, and one protocol repair share
one maximum of two physical Provider requests.

### `AGT-004` Output Validation And Repair

Validate:

```text
action
intent
target
texts
reaction_type
decision_reason
evidence_refs
```

Rules:

- `silence` requires null target/texts and `reaction_type=silence`;
- `barrage` contains normally 3-6 nonduplicate complete short texts;
- one logical generation per candidate;
- one schema-repair request only when at least six seconds remain;
- at most two physical Provider requests including repair;
- texts longer than the product limit are handled exactly as specified;
- invalid identity/evidence/target never reaches publication.

### `AGT-005` Queue And Scheduling Policy

Use `p-queue` plus explicit ADVX policy for:

- maximum in-flight Provider requests;
- per-trigger candidate budget;
- priority;
- queued latest-wins replacement;
- already-dispatched work;
- rate intervals;
- one network retry within remaining deadline;
- protocol repair sharing the request budget;
- bounded queue capacity;
- graceful drain/cancel.

Persist only durable side effects/outbox state, not in-memory network requests.

Count transport attempts, not logical SDK calls. Required cases:

- initial success: one physical request;
- eligible 429/5xx then success: two;
- invalid structured output then repair: two;
- transient retry followed by invalid output: no third repair request;
- protocol repair failure: no third request;
- abort/cancel: no retry;
- insufficient remaining deadline: no retry or repair.

### `AGT-006` ObservationWave

Port:

- one-second nearby-input merge window;
- trigger priority;
- source-tagged final speech/text/frame/ambient events;
- public context quotas and 60-second window;
- bounded reply context;
- one-frame-per-second timeline over the latest 120 seconds;
- all available timeline frames when the Session is younger than 120 seconds;
- first frame as each segment reference, with later frames compared to that
  reference rather than only to the immediately previous frame;
- 90% similarity grouping, five-second anchor, and accumulated-change boundary;
- the final frame of every segment as its representative;
- unconditional preservation of the current trigger frame;
- direct-mode removal of ordinary frames older than 30 seconds, except the
  trigger frame;
- time-uniform reduction to at most 15 representatives while preserving order
  and timestamps;
- frozen same-wave public context;
- room memory revision;
- creation/deadline metadata;
- replay identity.

Frame change alone triggers only when significance and cooldown requirements are
met. Ordinary repeated frames do not.

### `AGT-007` SessionAudience And Viewer State

Port:

- session seed;
- 1-32 Viewer population;
- deterministic identity/alias/microvariant;
- exact Persona counts;
- presence, leave, rejoin, kick, and replacement;
- private short-term state;
- latest-wins mailbox sequence;
- personal cooldown;
- runtime revision changes;
- eligible crash restore.

Viewer IDs are never recycled within the same Session.

### `AGT-008` Independent Viewer Context And Decision

For each candidate build:

- full current user input;
- bounded source-quota public context;
- selected recent frames;
- bounded reply context;
- explicit mention metadata;
- shared memory slice;
- full Persona/mode override/microvariant;
- only that Viewer's private state and cooldown;
- immutable session/epoch/observation/sequence/provider revisions.

The model independently chooses `barrage` or `silence`. There is no global value
ranking after generation.

### `AGT-009` Deterministic Candidate Selection

Port current local budgets and rotation:

- user input candidate budget;
- frame candidate budget derived from active population;
- ambient candidate budget;
- direct mention target;
- Session seed plus observation-derived replayable ordering;
- active/presence/moderation eligibility;
- rotation/fairness;
- no Director or theme-model call.

Selection occurs before Provider calls. Every valid generated barrage from the
selected candidates is eligible for publication; the system does not generate
many and discard by a target count afterward.

### `AGT-010` Viewer Generation And Paced Batch

One candidate returns one logical result. For a barrage result:

- publish the first accepted text immediately;
- schedule remaining accepted texts at 500 ms intervals;
- recheck all final fences before every delayed publication;
- add only published messages to shared history;
- preserve Viewer, target, intent, evidence, and parent linkage.

Cancelled/stale work drops the unpublicized remainder with zero side effects.

### `AGT-011` Barrage Pipeline

Enforce:

```text
schema
-> local Viewer identity
-> session/epoch/observation/sequence
-> deadline/cancellation
-> presence/moderation/revision
-> evidence/target
-> content/length
-> semantic duplicate/density
-> public event
```

Accepted publication updates state once. Rejected candidates update no cooldown,
memory, room event, or relationship state unless the current product explicitly
defines an independent diagnostic counter.

### `AGT-012` Memory And Meme Side Effects

After accepted public events:

- submit bounded async memory extraction;
- validate evidence and current revisions before write;
- prevent deleted/revoked memory re-entry;
- keep mode meme proposal/storage separate from barrage;
- preserve undo, decay, archive, and source;
- never allow side effects to block public barrage.

Do not resurrect the removed Director as a memory or meme shortcut.

### `AGT-013` Cancellation And Zero-Side-Effect Proof

Model adversarial interleavings:

- stop during ASR;
- new user input during Viewer generation;
- epoch change during repair retry;
- Viewer kick before result;
- Provider result at deadline boundary;
- delayed batch text after replacement;
- backend crash after DB commit before event publication;
- reconnect with stale token;
- queue overflow.

Use deterministic clocks and fast-check generated schedules. For every rejected
result assert no display, room event, cooldown, private state, memory, meme, or
outbox side effect.

### `AGT-014` Fake And Recorded Providers

Provide:

- deterministic fake ASR/model adapters for unit and E2E;
- recorded sanitized SSE/model response adapters;
- latency/error/abort controls;
- explicit metadata marking evidence source;
- no accidental fallback from live mode to fake.

### `AGT-015` Credentialed Capability Proof

With explicit credentials and consent:

- probe StepFun microphone and system-audio channels separately;
- run one compatible multimodal Viewer call;
- verify cancellation/timeout behavior where safe;
- record destination/model metadata without secrets;
- label evidence as credentialed live.

If credentials, service, or platform capture are unavailable, record `BLOCKED`.
Do not substitute recorded fixtures and mark the task live-complete. The task
may become `ACCEPTED_LIMITATION` only when an authorized human explicitly
removes or narrows that Provider capability from the current release claim,
records the revisit trigger, and accepts the lower evidence class.

## `GATE-04` Agent Runtime Exit

- [ ] Current no-Director product semantics are implemented.
- [ ] ASR channels are isolated and cancellation-safe.
- [ ] Shared `turn_id`, three-second degraded completion, and late paired
      system-audio no-retrigger behavior match the ingest/product contracts.
- [ ] ModelGateway is replaceable and domain-safe.
- [ ] AI SDK internal retries are disabled and each candidate stays within two
      physical Provider requests including transient retry/repair.
- [ ] The exact 120-second timeline, segment-reference/end-frame, trigger-frame,
      30-second direct-frame, and 15-frame uniform-sampling rules pass.
- [ ] Candidate selection is local, deterministic, and replayable.
- [ ] Each selected Viewer decides independently.
- [ ] Silence, multi-text barrage, pacing, and final fences match the spec.
- [ ] Property/race tests prove zero side effects for stale work.
- [ ] Memory/meme side effects are evidence-backed and nonblocking.
- [ ] Fake/recorded/live evidence is separately classified.
- [ ] `AGT-015` is `DONE`, or an authorized `ACCEPTED_LIMITATION` narrows the
      release claim; a plain `BLOCKED` status cannot pass this gate.
- [ ] Independent current-HEAD review is accepted.

## Rollback

Python remains the active runtime. Bun agent runtime runs through headless,
fixture, and compatibility paths until desktop Phase 05 explicitly selects it.

## Observations

To be filled during execution.
