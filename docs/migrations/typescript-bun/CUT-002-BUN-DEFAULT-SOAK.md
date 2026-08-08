# CUT-002 Bun-Default Soak Contract

## Scope

This soak exercises the development default selected by `CUT-001`: Electron
supervises `bun-source` without setting `ADVX_BACKEND_RUNTIME`. The accepted
release scope remains Windows x64. Python is not started, modified, or removed.

## Bounds

| Control | Value |
| --- | --- |
| Overall runner deadline | 180 seconds |
| Electron startup/action/shutdown deadline | 30/20/20 seconds |
| Clean Session cycles | 3 |
| In-flight quit cycle | 1 |
| Post-stop stale-output observation | 300 milliseconds per clean cycle |
| Resource samples | after cycle 1, after backend restart, after cycle 3 |
| Electron main working-set ceiling | 1 GiB |
| Bun backend working-set ceiling | 512 MiB |
| Process database size ceiling | 32 MiB in this synthetic run |

The fixture is the existing privacy-safe recorded pipeline. Cycle 1 submits
text, frame, microphone, system audio, and voice activity and requires a
barrage. Cycle 2 submits frame and system audio without text and requires a
silence trace. Electron explicitly restarts the supervised backend between
cycles 2 and 3; cycle 3 submits microphone plus text and requires a new-session
barrage after WebSocket reconnection. Cycle 4 starts a Session, dispatches text
and frame work without awaiting completion, and immediately closes Electron.

Provider timeout, rate-limit, retry recovery, and bounded reconnect reuse the
small existing adapter/scheduler tests that own those contracts. SQLite writes,
all six migrations, rollback, and retention reuse only the source-specific
append-transaction test. The current process composition still owns transient
Session control, so the Electron cycles do not claim durable Session rows.
Runtime compaction is not exposed as a product operation, so this task does not
invent or invoke one.

## Acceptance Thresholds

- all four cycles start and the first three stop cleanly;
- barrage output belongs only to the active Session and no output arrives after
  that Session's stop timestamp;
- the silence cycle emits no barrage and records `response_status=silence`;
- explicit restart produces a new Bun PID, a non-connected status transition,
  a connected final status, and no surviving old process;
- every resource sample is below its declared ceiling;
- the process SQLite file passes `quick_check`, closes with an empty WAL, and
  stays below 32 MiB; the targeted repository scenario proves schema version 6,
  transactional writes, rollback, and source-specific retention;
- the diagnostics bundle is redacted and contains versions, health, debug,
  Viewer trace, and runtime diagnostics artifacts;
- no unhandled rejection, page crash, process error, fixture secret, stale
  output, Electron descendant, Bun process, or bound port remains;
- any failed assertion or deadline stops the run immediately and preserves the
  bounded artifact directory for diagnosis.

## Limitations

This is a deterministic local soak, not a credentialed Provider run, long-haul
production soak, macOS claim, signed-package claim, or legacy-data rollback
rehearsal. Those remain owned by their later plan tasks.
