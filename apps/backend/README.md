# Local backend

The FastAPI backend follows this dependency direction:

```text
api -> application -> domain
                \--> application ports

providers -------> application ports
infrastructure ---> application ports
```

`bootstrap` creates concrete adapters and injects them into the application layer. Keep provider wire formats and SQLAlchemy models inside their adapters. Audience selection, speaking timing, model-call grouping and memory extraction remain replaceable algorithms and must not be embedded in transport handlers.

See [Backend design](../../docs/BACKEND_DESIGN.md) for module responsibilities, the realtime data lifecycle, SQLite schema, transaction boundaries and migration rules.

## Implemented control protocol

- `GET /health` is public so Electron Main can supervise the process.
- Session control uses `POST /sessions`, `GET /sessions/current`, and the `pause`, `resume`, and `stop` commands under `/sessions/{session_id}`.
- Session HTTP requests require `Authorization: Bearer <local-token>` and `X-ADVX-Protocol-Version: 1`.
- `/ws` accepts JSON control/ingest messages and versioned binary audio/image envelopes. The first message must be `client.hello` with the same local token and protocol version; the connection then receives ordered session status, barrage, generation failure and ingest acknowledgement/rejection events.

The realtime ingest contract, including binary audio/image envelopes and privacy boundaries, is defined in [Ingest protocol](../../docs/INGEST_PROTOCOL.md). `BackendRuntime.configure_ingest_pipeline` injects the real ASR and model providers before a Session starts; the stable gateway allows this configuration after the FastAPI app has been created.

`scripts/dev.mjs` creates one random token per development launch and injects it into the backend and Electron Main process without printing it. The production launcher must provide the same value through its protected bootstrap channel before building `BackendRuntime`; it must not be written to ordinary configuration or logs.

## Local persistence

The backend applies Alembic migrations before accepting a session and owns the SQLite connection lifecycle. The launcher supplies `ADVX_DATA_DIR`; the database is created as `advx.sqlite3` inside that directory. Production should pass Electron's `userData/data` directory. Development uses the ignored repository-local `.advx-data` directory.

SQLite runs with foreign keys, WAL and a bounded busy timeout enabled. Repositories and the Unit of Work live under `infrastructure/persistence/sqlite`; application code depends only on the persistence Ports. Audio, frames, full room events, prompts, credentials and raw provider responses are never stored in this schema.

## Bounded reaction pipeline

`BackendRuntime` owns the active Room buffer, Context Builder, Audience snapshot, Frame Store and Barrage Pipeline so their bounded state starts and stops with the session. Runtime startup initializes missing built-in audiences idempotently. Frames are accepted individually, then a fixed five-second task submits one chronological 7-15-frame Observation with synchronized room context. Default planning keeps the built-in audience set in one model request. The model adapter resolves frame bytes only at request time; accepted output is validated, written back to Room and published as `barrage.event`. Provider failures are sanitized and published as `generation.error`.

The model provider is required; ASR is optional. Without an ASR key, a disabled adapter keeps the visual and text pipeline available while rejecting accidental audio input.
