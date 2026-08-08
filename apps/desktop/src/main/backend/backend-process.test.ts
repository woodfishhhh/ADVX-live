import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  createBackendOutputForwarder,
  ExternalBackendProcess,
  SpawnedBackendProcess,
  forwardBackendOutput,
  waitForBackendHealth
} from "./backend-process";
import {
  createBunBackendProcessOptions,
  resolveBunExecutable
} from "./backend-process-bun";
import {
  createBunCompiledBackendProcessOptions,
  resolveCompiledBunExecutable
} from "./backend-process-bun-compiled";
import type { BackendProcessExit } from "./backend-supervisor";

const TEST_IDENTITY = {
  version: "test-backend",
  port: 8765,
  token: "test-token",
  dataDirectory: "D:/test-data",
  logLocation: "D:/test-logs/advx.log"
} as const;

async function availableLoopbackPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveStart, rejectStart) => {
    server.once("error", rejectStart);
    server.listen(0, "127.0.0.1", () => resolveStart());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new Error("failed to allocate loopback port");
  }
  const port = address.port;
  await new Promise<void>((resolveClose, rejectClose) =>
    server.close((error) => (error ? rejectClose(error) : resolveClose()))
  );
  return port;
}

function repositoryRoot(): string {
  let directory = resolve(process.cwd());
  while (!existsBackendSource(directory)) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error("repository root was not found");
    directory = parent;
  }
  return directory;
}

function existsBackendSource(directory: string): boolean {
  return existsSync(join(directory, "apps/backend-bun/src/main.ts"));
}

function healthResponse(payload: object, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => payload
  } as Response;
}

describe("backend process readiness", () => {
  it("waits until the protocol v3 health endpoint is ready", async () => {
    let now = 0;
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("connection refused"))
      .mockResolvedValueOnce(healthResponse({ status: "ok", protocol_version: 3 }));

    await waitForBackendHealth({
      baseUrl: "http://127.0.0.1:8765/",
      timeoutMs: 1_000,
      intervalMs: 25,
      fetchImpl,
      now: () => now,
      sleep: async (milliseconds) => {
        now += milliseconds;
      }
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toBe("http://127.0.0.1:8765/health");
  });

  it("checks Bun version and schema compatibility before reporting ready", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(healthResponse({ status: "ok", protocol_version: 3 }))
      .mockResolvedValueOnce(
        healthResponse({
          backend_version: "0.1.0",
          build_id: "@advx/backend-bun@0.1.0+source",
          http_protocol_version: 3,
          realtime_protocol_version: 4,
          schema_package_version: 1
        })
      );

    await waitForBackendHealth({
      baseUrl: "http://127.0.0.1:8765",
      healthToken: "cutover-token",
      compatibility: { backendVersion: "0.1.0" },
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][0]).toBe("http://127.0.0.1:8765/version");
    expect(new Headers(fetchImpl.mock.calls[1][1]?.headers).get("authorization"))
      .toBe("Bearer cutover-token");
  });

  it("rejects an incompatible Bun schema", async () => {
    let now = 0;
    await expect(
      waitForBackendHealth({
        baseUrl: "http://127.0.0.1:8765",
        healthToken: "cutover-token",
        compatibility: { backendVersion: "0.1.0" },
        timeoutMs: 25,
        intervalMs: 25,
        fetchImpl: vi.fn<typeof fetch>()
          .mockResolvedValueOnce(healthResponse({ status: "ok", protocol_version: 3 }))
          .mockResolvedValueOnce(
            healthResponse({
              backend_version: "0.1.0",
              build_id: "test-build",
              http_protocol_version: 3,
              realtime_protocol_version: 4,
              schema_package_version: 99
            })
          ),
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds;
        }
      })
    ).rejects.toThrow("不兼容的版本或契约 schema");
  });

  it("rejects protocol v1 health responses at the deadline", async () => {
    let now = 0;
    await expect(
      waitForBackendHealth({
        baseUrl: "http://127.0.0.1:8765",
        timeoutMs: 50,
        intervalMs: 25,
        fetchImpl: vi
          .fn<typeof fetch>()
          .mockResolvedValue(healthResponse({ status: "ok", protocol_version: 1 })),
        now: () => now,
        sleep: async (milliseconds) => {
          now += milliseconds;
        }
      })
    ).rejects.toThrow("不兼容")
  });

  it("surfaces a child startup error without waiting for timeout", async () => {
    await expect(
      waitForBackendHealth({
        baseUrl: "http://127.0.0.1:8765",
        getStartupError: () => new Error("backend exited")
      })
    ).rejects.toThrow("backend exited")
  });

  it("uses health readiness for externally managed backends", async () => {
    const controller = new ExternalBackendProcess({
      baseUrl: "http://127.0.0.1:8765",
      startupTimeoutMs: 1,
      identity: TEST_IDENTITY,
      healthProbe: async () => undefined
    });
    expect(controller.process).toBeNull();
    expect(controller.onUnexpectedExit(() => undefined)).toBeTypeOf("function");
    await controller.prepare();
    expect(controller.status()).toMatchObject({
      state: "prepared",
      identity: { version: "test-backend", port: 8765, token: "test-token" }
    });
    await controller.start();
    expect(controller.status()).toMatchObject({ state: "ready", ready: true });
    await controller.stop();
    await controller.forceStop();
    await controller.dispose();
    await controller.dispose();
    expect(controller.status().state).toBe("disposed");
  });

  it("rejects a concurrent start instead of sharing an in-flight operation", async () => {
    let releaseHealth!: () => void;
    const healthGate = new Promise<void>((resolve) => {
      releaseHealth = resolve;
    });
    const controller = new SpawnedBackendProcess({
      command: process.execPath,
      args: ["-e", "setInterval(() => undefined, 1000)"],
      cwd: process.cwd(),
      env: process.env,
      baseUrl: "http://127.0.0.1:8765",
      identity: TEST_IDENTITY,
      healthProbe: async () => healthGate
    });

    const firstStart = controller.start();
    await expect(controller.start()).rejects.toThrow("启动已在进行中");
    releaseHealth();
    await firstStart;
    await controller.dispose();
  });

  it("enforces the configured restart budget", async () => {
    const controller = new SpawnedBackendProcess({
      command: process.execPath,
      args: ["-e", "setInterval(() => undefined, 1000)"],
      cwd: process.cwd(),
      env: process.env,
      baseUrl: "http://127.0.0.1:8765",
      identity: TEST_IDENTITY,
      restartBudget: 2,
      healthProbe: async () => undefined
    });

    await controller.start();
    await controller.restart();
    await controller.restart();
    expect(controller.status()).toMatchObject({ restartCount: 2, restartBudget: 2 });
    await expect(controller.restart()).rejects.toThrow("重启次数已达到上限");
    await controller.dispose();
  }, 30_000);

  it("reports unexpected exits with identity and exit metadata", async () => {
    const controller = new SpawnedBackendProcess({
      command: process.execPath,
      args: ["-e", "setTimeout(() => process.exit(7), 40)"],
      cwd: process.cwd(),
      env: process.env,
      baseUrl: "http://127.0.0.1:8765",
      identity: TEST_IDENTITY,
      healthProbe: async () => undefined
    });
    const unexpectedExit = new Promise<BackendProcessExit>((resolve) =>
      controller.onUnexpectedExit(resolve)
    );

    await controller.start();
    const exit = await unexpectedExit;
    expect(exit).toMatchObject({ code: 7, signal: null, expected: false });
    expect(exit.instanceId).toBe(controller.status().identity.id);
    expect(controller.status().state).toBe("exited");
    await controller.dispose();
  });

  it("builds a Bun source child with an allowlisted environment and stdin secret", () => {
    const token = "a".repeat(43);
    const options = createBunBackendProcessOptions({
      repositoryRoot: "D:/repo",
      backendPort: "18765",
      backendBaseUrl: "http://127.0.0.1:18765",
      dataDirectory: "D:/isolated/bun-source",
      startupToken: token,
      bunExecutable: process.execPath,
      parentEnvironment: {
        PATH: "D:/tools",
        ADVX_LOCAL_TOKEN: token,
        OPENAI_API_KEY: "provider-secret",
        ADVX_PROVIDER_PROFILES_JSON: "should-not-inherit"
      },
      identity: { ...TEST_IDENTITY, port: 18765 }
    });

    expect(options.command).toBe(resolve(process.execPath));
    expect(options.args).toEqual(["run", "--no-env-file", "apps/backend-bun/src/main.ts"]);
    expect(options.cwd).toBe("D:/repo");
    expect(options.startupToken).toBe(token);
    expect(options.healthToken).toBe(token);
    expect(options.windowsHide).toBe(true);
    expect(options.env).toMatchObject({
      PATH: "D:/tools",
      ADVX_BACKEND_MODE: "development",
      ADVX_BACKEND_HOST: "127.0.0.1",
      ADVX_BACKEND_PORT: "18765",
      ADVX_DATA_DIR: "D:/isolated/bun-source",
      ADVX_STARTUP_TOKEN_FD: "0"
    });
    expect(options.env).not.toHaveProperty("ADVX_LOCAL_TOKEN");
    expect(options.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(options.env).not.toHaveProperty("ADVX_PROVIDER_PROFILES_JSON");
    expect(options.args?.join(" ")).not.toContain(token);
  });

  it("supervises a real Bun source child through authenticated readiness", async () => {
    const root = repositoryRoot();
    const bunExecutable = resolveBunExecutable(root);
    const port = await availableLoopbackPort();
    const dataDirectory = await mkdtemp(join(tmpdir(), "advx-des002-"));
    const token = "b".repeat(43);
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const controller = new SpawnedBackendProcess(
      createBunBackendProcessOptions({
        repositoryRoot: root,
        backendPort: String(port),
        backendBaseUrl: `http://127.0.0.1:${port}`,
        dataDirectory,
        startupToken: token,
        bunExecutable,
        identity: { ...TEST_IDENTITY, port, token, dataDirectory },
        logger
      })
    );

    try {
      await controller.start();
      expect(controller.status()).toMatchObject({ state: "ready", ready: true });
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { authorization: `Bearer ${token}` }
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "ok", protocol_version: 3 });
    } finally {
      await controller.dispose();
      expect(controller.status().lastExit).toMatchObject({ code: 0, expected: true });
      expect(logger.warn).not.toHaveBeenCalledWith(
        "backend.stop.forced",
        expect.anything()
      );
      await rm(dataDirectory, { recursive: true, force: true });
    }
    expect(controller.status().state).toBe("disposed");
  }, 30_000);

  it("builds a compiled Bun child without Bun CLI or ambient runtime config", () => {
    const token = "d".repeat(43);
    const options = createBunCompiledBackendProcessOptions({
      packaged: false,
      resourcesPath: "D:/resources",
      repositoryRoot: "D:/repo",
      backendExecutable: process.execPath,
      workingDirectory: "D:/hostile-cwd",
      backendPort: "18766",
      backendBaseUrl: "http://127.0.0.1:18766",
      dataDirectory: "D:/isolated/bun-compiled",
      startupToken: token,
      parentEnvironment: {
        PATH: "D:/tools",
        BUN_BE_BUN: "1",
        BUN_INSTALL: "D:/bun",
        BUN_CONFIG_VERBOSE: "1",
        OPENAI_API_KEY: "provider-secret"
      },
      identity: { ...TEST_IDENTITY, port: 18766 }
    });

    expect(options.command).toBe(resolve(process.execPath));
    expect(options.args).toEqual([]);
    expect(options.cwd).toBe("D:/hostile-cwd");
    expect(options.startupToken).toBe(token);
    expect(options.env).toMatchObject({
      PATH: "D:/tools",
      ADVX_BACKEND_MODE: "development",
      ADVX_BACKEND_HOST: "127.0.0.1",
      ADVX_BACKEND_PORT: "18766",
      ADVX_DATA_DIR: "D:/isolated/bun-compiled",
      ADVX_STARTUP_TOKEN_FD: "0"
    });
    expect(options.env).not.toHaveProperty("BUN_BE_BUN");
    expect(options.env).not.toHaveProperty("BUN_INSTALL");
    expect(options.env).not.toHaveProperty("BUN_CONFIG_VERBOSE");
    expect(options.env).not.toHaveProperty("OPENAI_API_KEY");
    expect(options.args?.join(" ")).not.toContain(token);

    const packaged = createBunCompiledBackendProcessOptions({
      packaged: true,
      resourcesPath: "D:/resources",
      repositoryRoot: "D:/repo",
      backendExecutable: process.execPath,
      backendPort: "18766",
      backendBaseUrl: "http://127.0.0.1:18766",
      dataDirectory: "D:/isolated/packaged-bun",
      startupToken: token,
      identity: { ...TEST_IDENTITY, port: 18766 }
    });
    expect(packaged.command).toBe(resolve(process.execPath));
    expect(packaged.cwd).toBe("D:/resources");
    expect(packaged.args).toEqual([]);
  });

  it("fails clearly for missing or unsigned compiled artifacts", () => {
    expect(() =>
      resolveCompiledBunExecutable({
        packaged: false,
        resourcesPath: "D:/resources",
        repositoryRoot: "D:/repo",
        backendExecutable: "D:/missing/advx-backend-bun.exe"
      })
    ).toThrow("compiled_backend_missing");

    expect(() =>
      resolveCompiledBunExecutable({
        packaged: false,
        resourcesPath: "D:/resources",
        repositoryRoot: "D:/repo",
        backendExecutable: process.execPath,
        requireCodeSignature: true,
        signatureVerifier: () => false
      })
    ).toThrow("compiled_backend_unsigned");
  });

  it("surfaces a missing managed backend executable", async () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const controller = new SpawnedBackendProcess({
      command: "advx-definitely-missing-backend-executable",
      cwd: process.cwd(),
      env: process.env,
      baseUrl: "http://127.0.0.1:9",
      logger,
      startupTimeoutMs: 1_000
    });

    await expect(controller.start()).rejects.toThrow("无法启动本地后端进程");
    expect(controller.process).toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      "backend.spawn.failed",
      expect.any(Error)
    );
  });

  it("routes backend output through the injected logger", () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    forwardBackendOutput(logger, "stdout", Buffer.from("server ready\n"));
    forwardBackendOutput(logger, "stderr", Buffer.from("INFO: request complete\n"));
    forwardBackendOutput(logger, "stderr", Buffer.from("ERROR: worker crashed\n"));

    expect(logger.info).toHaveBeenCalledWith("backend.output", {
      stream: "stdout",
      text: "server ready"
    });
    expect(logger.info).toHaveBeenCalledWith("backend.output", {
      stream: "stderr",
      text: "INFO: request complete"
    });
    expect(logger.error).toHaveBeenCalledWith("backend.output", {
      stream: "stderr",
      text: "ERROR: worker crashed"
    });
  });

  it("buffers split lines before redacting backend secrets", () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const forwarder = createBackendOutputForwarder(logger, "stderr");

    forwarder.write(Buffer.from('ERROR: provider failed {"api_key":"plain-'));
    forwarder.write(Buffer.from('provider-secret"}\n'));
    forwarder.flush();

    expect(logger.error).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledWith("backend.output", {
      stream: "stderr",
      text: 'ERROR: provider failed {"api_key":[REDACTED]}'
    });
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("plain-provider-secret");
  });

  it("redacts bearer startup credentials before ordinary output reaches logs", () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };
    const token = "e".repeat(43);

    forwardBackendOutput(logger, "stderr", Buffer.from(`request Authorization: Bearer ${token}\n`));

    expect(JSON.stringify(logger.info.mock.calls)).not.toContain(token);
    expect(logger.info).toHaveBeenCalledWith("backend.output", {
      stream: "stderr",
      text: "request Authorization: [REDACTED]"
    });
  });
});
