# TST-013 Dual-Runtime Parity Decision

## Scope

TST-013 adds one bounded parity entry point that runs the existing Python
control/session oracle and the Bun backend against the same privacy-safe
scenario, then combines that result with the health parity harness and the
recorded viewer replay fixture. The aggregate report covers the required
HTTP, WebSocket, barrage/silence, persistence, debug, shutdown/resource, and
redacted-trace categories without expanding into a broad matrix.

The Python recorded E2E test remains the oracle. The Bun verifier runs with
recorded Provider outputs and zero external transport calls; no Python oracle
source or fixture is removed.

## Implementation

`scripts/run-tst-013.ts` owns the aggregate command and writes a structured
report under the caller-provided artifact root. It invokes:

- `tests/parity/run-control-session-parity.ts` with the authenticated debug
  snapshot stage enabled;
- `tests/parity/run-health-parity.ts`;
- the focused Python recorded viewer test; and
- `scripts/verify-viewer-runtime-evidence.ts` under Bun.

The control/session harness now has an opt-in debug stage. Its default BCK-011
behavior is unchanged. When the parity fixture returns the known Python
debug-route internal 500 while Bun returns a redacted snapshot, every affected
field and the emitted traceback are retained in `classifiedDifferences` with
the classification `python-debug-snapshot-unavailable`; they are not silently
dropped. The Bun snapshot must still advertise `redacted: true`.

## Verification boundary

The Maker aggregate passed all seven categories. The only classified
difference is the Python fixture's unavailable debug endpoint; it is recorded
as a follow-up boundary rather than treated as a new task blocker under the
current fast-delivery instruction. Process cleanup remains decisive: both
ports are released, both temporary data directories are removed, and no child
process remains after stop.

`minimumReleaseAge: 0` remains explicit and pnpm's built-in seven-day release
policy remains disabled; no exception list was added.
