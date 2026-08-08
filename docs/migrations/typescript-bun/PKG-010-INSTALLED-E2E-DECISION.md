# PKG-010 Installed Windows Pipeline Decision

## Evidence Boundary

The installed-E2E checker builds the Bun backend, builds Electron, creates the
NSIS installer, installs it into a fresh temporary root, and executes the
installed `ADVX Live.exe` on Windows x64. The packaged process is observed over
the real renderer via Chromium CDP; no renderer or backend implementation is
mocked. The backend runs the existing recorded pipeline fixture so the proof is
deterministic and contains no provider credentials or external transport.

The flow proves:

```text
install -> launch -> Bun backend ready/version handshake -> start Session
-> recorded text/frame/microphone/system-audio/voice activity
-> recorded barrage reaches the real overlay -> diagnostics bundle -> stop
-> restart -> uninstall -> orphan/path audit
```

The runner records the installed path, user-data path, runtime status, session
identity, input kinds, overlay screenshot, diagnostics input, and application
log. The checker additionally records installer/application/backend hashes,
Windows x64 target, NSIS install/uninstall exit codes, diagnostics manifest
hash, restart readiness, and a post-uninstall `tasklist` orphan audit.

## Diagnostics And Retention

The diagnostics bundle is created by the Bun diagnostics CLI from redacted JSON
artifacts: versions, health, debug snapshot, and viewer traces. The manifest is
bounded and must be marked `redacted: true`. The installed user-data directory
is outside the install root and is retained as evidence; the NSIS uninstall
removes the install root without deleting that evidence directory.

## Non-Claims

This deterministic run does not claim live Provider availability, microphone or
system-audio hardware quality, code signing, or production update behavior.
The Python parity oracle remains untouched and is not replaced by this fixture.
