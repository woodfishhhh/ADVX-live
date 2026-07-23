# Desktop app

Electron owns operating-system capabilities and contains three isolated renderer entries:

- `control`: React control surface and user text input.
- `capture`: hidden screen and microphone capture context.
- `overlay`: transparent, click-through barrage renderer.

The Main Process owns windows, permissions, credentials and the FastAPI child-process lifecycle. Renderers must not call model providers or read stored secrets directly.

## MVP commands

Run from the repository root:

```bash
pnpm dev:desktop
pnpm --filter @advx/desktop typecheck
pnpm --filter @advx/desktop test
pnpm --filter @advx/desktop build
pnpm --filter @advx/desktop smoke
```

The smoke check runs Electron against the current desktop and microphone, so it requires an
interactive session with the relevant operating-system permissions already available.

The current control surface includes desktop-source selection, optional microphone metering, a
click-through barrage overlay, audience controls and securely stored provider settings. Each
compressed visual frame is sent to Electron Main immediately and acknowledged by the FastAPI
realtime connection; batching belongs exclusively to the backend. Screen/window capture uses real
system media streams. Pausing or stopping releases active tracks; visual sources are reacquired on
resume, while the optional microphone can be enabled again independently.
