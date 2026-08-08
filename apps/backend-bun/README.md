# Bun backend

`@advx/backend-bun` is the current local product backend. Electron supervises
it as a child process in both source and compiled modes.

## Boundaries

```text
api -> application -> domain
          |             ^
          v             |
        ports <--- infrastructure / providers
```

- `api`: Elysia HTTP, WebSocket, binary ingest, error mapping, and protocol
  validation. It does not own business state or Provider wire formats.
- `application`: session lifecycle, observation scheduling, individual Viewer
  decisions, barrage publication, replay/evaluation, and Ports.
- `domain`: framework-free identities, events, state machines, and invariants.
- `infrastructure`: configuration, `bun:sqlite`, Drizzle repositories,
  migrations, observability, transient runtime control, and process support.
- `providers`: StepFun ASR and OpenAI-compatible model adapters.

The server binds only to loopback port `8765`. A one-time token arrives through
the inherited startup descriptor. HTTP protocol v3 requests, including
`/health`, require Bearer authentication and the protocol header. Realtime v4
negotiates over `/ws`; v3 remains a compatibility reader.

## Commands

Run from the repository root:

```powershell
bun run dev:backend
bun run --filter @advx/backend-bun typecheck
bun run --filter @advx/backend-bun test
bun run --filter @advx/backend-bun build
bun run build:bun-backend
bun run contracts
bun run contracts:bun-openapi:check
```

`bun run build:bun-backend` produces the Windows x64 compiled executable and a
manifest. Runtime data belongs under the Electron-provided user-data directory;
source and packaged execution must not depend on the current working directory.
