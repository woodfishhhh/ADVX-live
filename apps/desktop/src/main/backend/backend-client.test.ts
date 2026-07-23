import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BackendFailure } from "../../shared/contracts";
import { BackendClient } from "./backend-client";

type SocketListener = (event: { data?: unknown }) => void;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  readonly sent: unknown[] = [];
  private readonly listeners = new Map<string, Set<SocketListener>>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: SocketListener): void {
    const listeners = this.listeners.get(type) ?? new Set<SocketListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  send(message: unknown): void {
    this.sent.push(message);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.emit("open", {});
  }

  message(message: object): void {
    this.emit("message", { data: JSON.stringify(message) });
  }

  private emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

function sessionSnapshot(state: "idle" | "running" = "idle"): object {
  return {
    session_id: state === "running" ? "session-1" : null,
    state,
    started_at_ms: state === "running" ? 1_000 : null,
    updated_at_ms: 1_000,
    revision: 1
  };
}

async function startConnectedClient(state: "idle" | "running" = "idle"): Promise<{
  client: BackendClient;
  socket: FakeWebSocket;
}> {
  const client = new BackendClient({ localToken: "token" });
  const started = client.start();
  const socket = FakeWebSocket.instances.at(-1);
  if (!socket) throw new Error("Expected BackendClient to create a WebSocket.");
  socket.open();
  socket.message({
    type: "backend.ready",
    protocol_version: 1,
    session: sessionSnapshot(state)
  });
  await started;
  return { client, socket };
}

beforeEach(() => {
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ configured: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    )
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BackendClient startup state", () => {
  it("reports startup before the process is ready", async () => {
    const client = new BackendClient({ localToken: "token" });
    expect(await client.status()).toMatchObject({
      connection: "starting",
      startupError: null
    });
  });

  it("reports a user-facing startup failure and can return to startup", () => {
    const client = new BackendClient({ localToken: "token" });
    client.failStartup(new Error("后端文件缺失"));
    expect(client.currentStatus()).toMatchObject({
      connection: "failed",
      startupError: "后端文件缺失"
    });

    client.beginStartup();
    expect(client.currentStatus()).toMatchObject({
      connection: "starting",
      startupError: null
    });
  });

  it("rejects promptly and does not reconnect after startup fails", async () => {
    vi.useFakeTimers();
    const client = new BackendClient({ localToken: "token" });
    const started = client.start();
    const socket = FakeWebSocket.instances.at(-1);
    if (!socket) throw new Error("Expected BackendClient to create a WebSocket.");
    socket.close();

    await expect(started).rejects.toMatchObject({
      code: "connection_closed"
    });
    client.failStartup(new Error("后端进程启动失败"));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(client.currentStatus()).toMatchObject({
      connection: "failed",
      startupError: "后端进程启动失败"
    });
  });
});

describe("BackendClient realtime transport", () => {
  it("sends and acknowledges each completed frame independently", async () => {
    const { client, socket } = await startConnectedClient("running");

    for (const inputId of ["frame-1", "frame-2"]) {
      const submitted = client.submitFrame({
        inputId,
        capturedAtMs: 1_000,
        mimeType: "image/jpeg",
        body: new Uint8Array([1, 2, 3])
      });
      expect(socket.sent.filter((message) => message instanceof Uint8Array)).toHaveLength(
        inputId === "frame-1" ? 1 : 2
      );
      socket.message({
        type: "ingest.ack",
        protocol_version: 1,
        session_id: "session-1",
        input_id: inputId,
        input_kind: "frame",
        stage: "received",
        accepted_at_ms: 1_001
      });
      await submitted;
    }

    await client.stop();
  });

  it("rejects a pending frame when the backend rejects that input", async () => {
    const { client, socket } = await startConnectedClient("running");
    const submitted = client.submitFrame({
      inputId: "frame-rejected",
      capturedAtMs: 1_000,
      mimeType: "image/jpeg",
      body: new Uint8Array([1])
    });
    socket.message({
      type: "ingest.rejected",
      protocol_version: 1,
      code: "payload_too_large",
      message: "Frame is too large.",
      session_id: "session-1",
      input_id: "frame-rejected",
      input_kind: "frame"
    });

    await expect(submitted).rejects.toMatchObject({
      code: "payload_too_large"
    });
    await client.stop();
  });

  it("publishes model generation failures to renderer listeners", async () => {
    const { client, socket } = await startConnectedClient("running");
    const failures: BackendFailure[] = [];
    client.onFailure((failure) => failures.push(failure));
    socket.message({
      type: "generation.error",
      protocol_version: 1,
      session_id: "session-1",
      observation_id: "observation-1",
      request_id: "request-1",
      code: "model_generation_failed",
      message: "模型生成失败，请检查配置。"
    });

    expect(failures).toEqual([
      {
        code: "model_generation_failed",
        message: "模型生成失败，请检查配置。"
      }
    ]);
    await client.stop();
  });
});
