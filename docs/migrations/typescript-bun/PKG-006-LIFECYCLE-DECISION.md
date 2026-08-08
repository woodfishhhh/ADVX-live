# PKG-006 Lifecycle Decision

## Scope

The Windows x64 packaged path uses the existing Electron supervisor and Bun
compiled backend. This task proves first start, bounded backend crash recovery,
graceful quit, forced process-tree termination, port release, and NSIS artifact
creation without changing the Python parity oracle.

## Shutdown and Recovery Contract

- A normal quit is requested through the existing local shutdown control used by
  the desktop process and must end with `app.shutdown.completed`.
- An unexpected Bun backend exit is recovered by the existing bounded supervisor
  schedule; the recovered process must receive a new PID and the final quit must
  release the port with no backend PID left alive.
- Forced Electron termination uses the Windows process-tree fallback and must not
  leave the supervised Bun child alive.
- NSIS is the declared Windows target. The install root contains only packaged
  application files; user data remains under the Electron user-data directory so
  uninstall does not delete user state. A future installed E2E task owns the
  interactive Provider/renderer crash matrix.

## Evidence Command

```text
pnpm check:pkg-006
```

The checker builds the Bun executable, Electron bundle, and NSIS installer,
launches the unpacked package in a hostile working directory, exercises the
first-start, backend-crash/restart, graceful-quit, and forced-termination paths,
checks port/PID cleanup, and writes `result.json` under the task artifact root.
