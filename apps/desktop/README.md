# Desktop app

Electron owns operating-system capabilities and supervises the current Bun
backend process. Renderer code never launches the backend, calls Providers, or
reads stored secrets directly.

## Process boundaries

- `main`: windows, permissions, `safeStorage`, backend process lifecycle,
  authenticated HTTP/WebSocket adapters, tray, diagnostics, and shutdown.
- `preload`: narrow typed IPC bridges with sender and payload validation.
- `control`: React control surface, Provider settings, audience controls, and
  user text.
- `capture`: hidden screen, microphone, and Windows system-audio capture.
- `overlay`: transparent click-through barrage renderer.
- `floating-chat`: optional focused conversation surface.

Electron starts either the Bun source backend in development or the packaged
compiled Bun executable in distribution. It waits for the authenticated
`/health` response and version handshake before reporting the backend ready.
Normal quit requests graceful backend shutdown and falls back to bounded tree
termination; stopping must leave port 8765 free and no child process orphaned.

## Commands

Run from the repository root:

```powershell
bun run dev:desktop
bun run --filter @advx/desktop typecheck
bun run --filter @advx/desktop test
bun run --filter @advx/desktop build
bun run smoke:desktop-runtime
bun run package:desktop
```

The recorded runtime smoke uses a Bun orchestrator and Bun backend. Node hosts
only the Playwright Electron launcher because that tooling boundary is not run
inside Bun. Interactive capture smokes require an unlocked Windows desktop and
the relevant operating-system permissions.
