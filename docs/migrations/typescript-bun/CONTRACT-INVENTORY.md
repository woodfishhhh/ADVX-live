# Contract Inventory

> Canonical machine-readable source: [contract-inventory.json](./contract-inventory.json)
>
> Scope: `CON-001`; accepted route baseline: 47 HTTP routes and one WebSocket endpoint.

## Ownership Rules

- A public contract crosses HTTP, WebSocket JSON, WebSocket binary, Electron backend-client, debug export, or replay boundaries.
- Every entry names its Python model/codec, surface, current generated or handwritten TypeScript consumer, fixture/test, compatibility version, and future migration owner.
- `ts_consumer.kind=none` is explicit: its `owner` names the future task or Python parity oracle.
- Provider wire payloads, SQLite rows, application-port objects, raw media bodies, and resolved frames are not public ADVX contracts.
- Dispositions are limited to `canonical-schema`, `protocol-envelope`, `binary-codec`, and `oracle-only/internal`. This inventory implements none of `CON-002..CON-007`.

## Coverage Summary

| Item | Count |
| --- | ---: |
| Model/codec ownership rows | 126 |
| Route/event/codec bindings | 73 |
| Accepted HTTP route bindings | 47 |
| Accepted WebSocket endpoint bindings | 1 |
| WebSocket JSON message families | 19 |
| Binary version/media bindings | 6 |
| Scoped contract symbols classified | 121 |

- `barrage-event`: 6
- `binary-audio`: 7
- `binary-frame`: 4
- `debug-replay`: 37
- `error-body`: 11
- `http-control`: 58
- `mode`: 8
- `persona`: 1
- `room-event`: 2
- `runtime-spec`: 30
- `session-snapshot`: 3
- `ws-json`: 32

## HTTP Route Bindings

| Stable ID | Surface | Python owner / codec | Current TS consumer | Future owner |
| --- | --- | --- | --- | --- |
| `HTTP-GET-CONFIGURATION-PROVIDERS` | `GET /configuration/providers` | `provider_status: ProviderConfigurationStatus` | `generated` | `CON-004` |
| `HTTP-GET-CONFIGURATION-PROVIDERS-MODELS` | `GET /configuration/providers/models` | `discover_provider_models: ProviderModelDiscovery` | `generated` | `CON-004` |
| `HTTP-POST-CONFIGURATION-PROVIDERS-PROBE` | `POST /configuration/providers/probe` | `probe_provider_capabilities: ProviderConfigurationRequest? -> ProviderCapabilityProbeResult` | `generated` | `CON-004` |
| `HTTP-PUT-CONFIGURATION-PROVIDERS` | `PUT /configuration/providers` | `configure_providers: ProviderConfigurationRequest -> ProviderConfigurationStatus` | `generated` | `CON-004` |
| `HTTP-GET-DEBUG-TRACES` | `GET /debug/traces` | `query_traces: TraceQuery -> TraceQueryResponse` | `generated` | `CON-004` |
| `HTTP-POST-DEBUG-TRACES-EXPORT` | `POST /debug/traces/export` | `export_traces: TraceQuery -> sanitized dict[str, object]` | `generated` | `CON-004` |
| `HTTP-GET-DEBUG-AI-CALLS` | `GET /debug/ai-calls` | `query_ai_calls: AiCallQuery -> AiCallQueryResponse` | `generated` | `CON-004` |
| `HTTP-GET-DEBUG-AI-CALLS-IMAGES-PREVIEW-ID` | `GET /debug/ai-calls/images/{preview_id}` | `query_ai_call_image: AiCallImagePreview` | `generated` | `CON-004` |
| `HTTP-GET-DEBUG-AI-CALLS-CALL-ID` | `GET /debug/ai-calls/{call_id}` | `query_ai_call: AiCallTrace` | `generated` | `CON-004` |
| `HTTP-GET-DEBUG-RUNTIME-SESSION-ID` | `GET /debug/runtime/{session_id}` | `runtime_snapshot: DebugRuntimeSnapshot` | `generated` | `CON-004` |
| `HTTP-POST-DEBUG-REPLAY` | `POST /debug/replay` | `replay: ReplayRequest -> ReplayResult` | `generated` | `CON-004` |
| `HTTP-GET-HEALTH` | `GET /health` | `health: HealthResponse` | `generated` | `CON-004` |
| `HTTP-POST-RUNTIME-SESSIONS` | `POST /runtime/sessions` | `start_runtime_session: RuntimeSessionStartRequest -> RuntimeSessionSnapshot` | `generated` | `CON-004` |
| `HTTP-GET-RUNTIME-SESSIONS-SESSION-ID` | `GET /runtime/sessions/{session_id}` | `current_runtime_session: RuntimeSessionSnapshot` | `generated` | `CON-004` |
| `HTTP-POST-RUNTIME-SESSIONS-SESSION-ID-APPLY` | `POST /runtime/sessions/{session_id}/apply` | `apply_runtime: RuntimeApplyRequest -> RuntimeSessionSnapshot` | `generated` | `CON-004` |
| `HTTP-POST-RUNTIME-SESSIONS-SESSION-ID-ROLLBACK` | `POST /runtime/sessions/{session_id}/rollback` | `rollback_runtime: RuntimeRollbackRequest -> RuntimeSessionSnapshot` | `generated` | `CON-004` |
| `HTTP-POST-RUNTIME-SESSIONS-SESSION-ID-RECOVER` | `POST /runtime/sessions/{session_id}/recover` | `recover_runtime: RuntimeSessionSnapshot` | `generated` | `CON-004` |
| `HTTP-GET-RUNTIME-SESSIONS-SESSION-ID-AUDIENCE` | `GET /runtime/sessions/{session_id}/audience` | `current_audience: SessionAudienceSnapshot` | `generated` | `CON-004` |
| `HTTP-POST-RUNTIME-SESSIONS-SESSION-ID-VIEWERS-VIEWER-ID-MUTE` | `POST /runtime/sessions/{session_id}/viewers/{viewer_id}/mute` | `mute_viewer: MuteViewerRequest -> ViewerSnapshot` | `generated` | `CON-004` |
| `HTTP-POST-RUNTIME-SESSIONS-SESSION-ID-VIEWERS-VIEWER-ID-UNMUTE` | `POST /runtime/sessions/{session_id}/viewers/{viewer_id}/unmute` | `unmute_viewer: ViewerCommandRequest -> ViewerSnapshot` | `generated` | `CON-004` |
| `HTTP-POST-RUNTIME-SESSIONS-SESSION-ID-VIEWERS-VIEWER-ID-KICK` | `POST /runtime/sessions/{session_id}/viewers/{viewer_id}/kick` | `kick_viewer: ViewerCommandRequest -> ViewerSnapshot` | `generated` | `CON-004` |
| `HTTP-GET-SESSIONS-CURRENT` | `GET /sessions/current` | `current_session: SessionSnapshot` | `generated` | `CON-004` |
| `HTTP-POST-SESSIONS` | `POST /sessions` | `start_session: empty body -> 201 Location` | `generated` | `CON-004` |
| `HTTP-POST-SESSIONS-SESSION-ID-PAUSE` | `POST /sessions/{session_id}/pause` | `pause_session: SessionSnapshot` | `generated` | `CON-004` |
| `HTTP-POST-SESSIONS-SESSION-ID-RESUME` | `POST /sessions/{session_id}/resume` | `resume_session: SessionSnapshot` | `generated` | `CON-004` |
| `HTTP-POST-SESSIONS-SESSION-ID-STOP` | `POST /sessions/{session_id}/stop` | `stop_session: SessionSnapshot` | `generated` | `CON-004` |
| `HTTP-GET-SHARED-BRAIN-ROOMS-ROOM-ID-MEMORIES` | `GET /shared-brain/rooms/{room_id}/memories` | `list_memories: route-local request/response model` | `generated` | `CON-004` |
| `HTTP-GET-SHARED-BRAIN-ROOMS-ROOM-ID-MEMORY-HEAD` | `GET /shared-brain/rooms/{room_id}/memory-head` | `get_memory_head: route-local request/response model` | `generated` | `CON-004` |
| `HTTP-GET-SHARED-BRAIN-ROOMS-ROOM-ID-MEMORIES-MEMORY-ID` | `GET /shared-brain/rooms/{room_id}/memories/{memory_id}` | `get_memory: route-local request/response model` | `generated` | `CON-004` |
| `HTTP-PUT-SHARED-BRAIN-ROOMS-ROOM-ID-MEMORIES-MEMORY-ID` | `PUT /shared-brain/rooms/{room_id}/memories/{memory_id}` | `edit_memory: route-local request/response model` | `generated` | `CON-004` |
| `HTTP-POST-SHARED-BRAIN-MODES-NAMESPACE-ID-MEMES-MAINTENANCE` | `POST /shared-brain/modes/{namespace_id}/memes/maintenance` | `maintain_memes: route-local request/response model` | `generated` | `CON-004` |
| `HTTP-POST-SHARED-BRAIN-ROOMS-ROOM-ID-MEMORIES-MEMORY-ID-MERGE` | `POST /shared-brain/rooms/{room_id}/memories/{memory_id}/merge` | `merge_memory: route-local request/response model` | `generated` | `CON-004` |
| `HTTP-POST-SHARED-BRAIN-ROOMS-ROOM-ID-MEMORIES-MEMORY-ID-REPLACE` | `POST /shared-brain/rooms/{room_id}/memories/{memory_id}/replace` | `replace_memory: route-local request/response model` | `generated` | `CON-004` |
| `HTTP-POST-SHARED-BRAIN-MEMORY-CANDIDATES` | `POST /shared-brain/memory-candidates` | `commit_memory_candidate: route-local request/response model` | `generated` | `CON-004` |
| `HTTP-POST-SHARED-BRAIN-ROOMS-ROOM-ID-MEMORIES-MEMORY-ID-REVOKE` | `POST /shared-brain/rooms/{room_id}/memories/{memory_id}/revoke` | `revoke_memory: route-local request/response model` | `generated` | `CON-004` |
| `HTTP-DELETE-SHARED-BRAIN-ROOMS-ROOM-ID-MEMORIES-MEMORY-ID` | `DELETE /shared-brain/rooms/{room_id}/memories/{memory_id}` | `delete_memory: route-local request/response model` | `generated` | `CON-004` |
| `HTTP-POST-SHARED-BRAIN-ROOMS-ROOM-ID-MEMORIES-RESET` | `POST /shared-brain/rooms/{room_id}/memories/reset` | `reset_memories: route-local request/response model` | `generated` | `CON-004` |
| `HTTP-GET-SHARED-BRAIN-MODES-NAMESPACE-ID-MEMES` | `GET /shared-brain/modes/{namespace_id}/memes` | `list_memes: route-local request/response model` | `generated` | `CON-004` |
| `HTTP-GET-SHARED-BRAIN-MODES-NAMESPACE-ID-MEMES-ACTIVE` | `GET /shared-brain/modes/{namespace_id}/memes/active` | `list_active_memes: route-local request/response model` | `generated` | `CON-004` |
| `HTTP-GET-SHARED-BRAIN-MODES-NAMESPACE-ID-MEME-CANDIDATES-PENDING` | `GET /shared-brain/modes/{namespace_id}/meme-candidates/pending` | `list_pending_candidates: route-local request/response model` | `generated` | `CON-004` |
| `HTTP-GET-SHARED-BRAIN-MODES-NAMESPACE-ID-AUTO-INGEST` | `GET /shared-brain/modes/{namespace_id}/auto-ingest` | `get_auto_ingest: route-local request/response model` | `generated` | `CON-004` |
| `HTTP-PUT-SHARED-BRAIN-MODES-NAMESPACE-ID-AUTO-INGEST` | `PUT /shared-brain/modes/{namespace_id}/auto-ingest` | `set_auto_ingest: route-local request/response model` | `generated` | `CON-004` |
| `HTTP-POST-SHARED-BRAIN-MEME-CANDIDATES` | `POST /shared-brain/meme-candidates` | `commit_meme_candidate: route-local request/response model` | `generated` | `CON-004` |
| `HTTP-POST-SHARED-BRAIN-MODES-NAMESPACE-ID-LEGACY-MEMES-IMPORT` | `POST /shared-brain/modes/{namespace_id}/legacy-memes/import` | `import_legacy_meme: route-local request/response model` | `generated` | `CON-004` |
| `HTTP-POST-SHARED-BRAIN-MODES-NAMESPACE-ID-MEME-CANDIDATES-CANDIDATE-ID-APPROVE` | `POST /shared-brain/modes/{namespace_id}/meme-candidates/{candidate_id}/approve` | `approve_meme_candidate: route-local request/response model` | `generated` | `CON-004` |
| `HTTP-POST-SHARED-BRAIN-MODES-NAMESPACE-ID-MEME-CANDIDATES-CANDIDATE-ID-REJECT` | `POST /shared-brain/modes/{namespace_id}/meme-candidates/{candidate_id}/reject` | `reject_meme_candidate: route-local request/response model` | `generated` | `CON-004` |
| `HTTP-PUT-SHARED-BRAIN-MODES-NAMESPACE-ID-MEMES-MEME-ID` | `PUT /shared-brain/modes/{namespace_id}/memes/{meme_id}` | `edit_meme: route-local request/response model` | `generated` | `CON-004` |

## Realtime And Binary

- JSON message bindings enumerate five client messages, eight named backend messages, and six Viewer presence event discriminators.
- Binary bindings enumerate audio and frame envelopes for readable `ADVX-BIN/1`, `/2`, and current `/3`.
- Current realtime JSON is protocol v4 with v3 readability. Current binary output is v3; v1/v2 are compatibility readers.
- Room events remain persisted/internal domain inputs unless wrapped by an explicitly public payload. Barrage and Viewer presence events are public WS families.

## Category Owners

| Category | Disposition | Next task |
| --- | --- | --- |
| Common errors/scalars | `canonical-schema` | `CON-003` |
| HTTP control, debug, replay | `canonical-schema` | `CON-004` |
| WS JSON messages | `protocol-envelope` | `CON-005` |
| Binary audio/frame | `binary-codec` | `CON-006` |
| Generated OpenAPI surface | retained input only | `CON-007` |
| Non-public helpers | `oracle-only/internal` | Python oracle until their owning migration phase |
