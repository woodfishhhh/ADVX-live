import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BackendClientError,
  BunGeneratedControlTransport,
  createBackendControlTransport,
  resolveBackendRuntime
} from "./backend-control-adapter";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("desktop Bun control adapter", () => {
  it("selects only Bun source or compiled runtimes", () => {
    expect(resolveBackendRuntime(undefined)).toBe("bun-source");
    expect(resolveBackendRuntime("python-oracle")).toBe("bun-source");
    expect(resolveBackendRuntime("unknown-runtime")).toBe("bun-source");
    expect(resolveBackendRuntime("bun-source")).toBe("bun-source");
    expect(resolveBackendRuntime("bun-compiled")).toBe("bun-compiled");
    expect(resolveBackendRuntime(undefined, { packaged: true })).toBe("bun-compiled");
    expect(resolveBackendRuntime("bun-source", { packaged: true })).toBe("bun-compiled");
    expect(resolveBackendRuntime("python-oracle", { packaged: true })).toBe("bun-compiled");
    expect(createBackendControlTransport({ baseUrl: "http://127.0.0.1:8765", localToken: "token" }))
      .toBeInstanceOf(BunGeneratedControlTransport);
  });

  it("uses authenticated generated operation bindings and validates health responses", async () => {
    const request = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe("GET");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer secret-token");
      expect(new Headers(init?.headers).get("X-ADVX-Protocol-Version")).toBe("3");
      return new Response(JSON.stringify({ status: "ok", protocol_version: 3 }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    globalThis.fetch = request;

    const transport = new BunGeneratedControlTransport({
      baseUrl: "http://127.0.0.1:8765/",
      localToken: "secret-token"
    });
    await expect(transport.request({ path: "/health", method: "GET" })).resolves.toEqual({
      status: "ok",
      protocol_version: 3
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("normalizes Bun errors without retrying", async () => {
    const request = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "invalid_local_token", safe_detail: "safe" }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      })
    );
    globalThis.fetch = request;
    const bun = new BunGeneratedControlTransport({
      baseUrl: "http://127.0.0.1:8765",
      localToken: "token"
    });

    await expect(bun.request({ path: "/health", method: "GET" })).rejects.toMatchObject({
      code: "invalid_local_token",
      message: "safe"
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("distinguishes caller cancellation from deadline expiry", async () => {
    const caller = new AbortController();
    caller.abort();
    globalThis.fetch = vi.fn((_input, init?: RequestInit) => {
      expect(init?.signal?.aborted).toBe(true);
      return Promise.reject(new DOMException("aborted", "AbortError"));
    });
    const transport = new BunGeneratedControlTransport({
      baseUrl: "http://127.0.0.1:8765",
      localToken: "token"
    });

    await expect(
      transport.request({ path: "/health", method: "GET", signal: caller.signal })
    ).rejects.toEqual(expect.objectContaining<Partial<BackendClientError>>({ code: "request_aborted" }));
  });

  it("uses a bounded status fallback for malformed error bodies", async () => {
    globalThis.fetch = vi.fn(async () => new Response("not-json", { status: 503 }));
    const transport = new BunGeneratedControlTransport({
      baseUrl: "http://127.0.0.1:8765",
      localToken: "token"
    });

    await expect(transport.request({ path: "/health", method: "GET" })).rejects.toMatchObject({
      code: "http_503",
      message: "后端请求失败。"
    });
  });
});
