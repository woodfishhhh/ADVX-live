import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import {
  ADVX_HTTP_PROTOCOL_VERSION,
  ADVX_REALTIME_PROTOCOL_VERSION,
  ADVX_SCHEMA_PACKAGE_VERSION
} from "@advx/contracts";
import { redactLogText } from "../logging-redaction";
import type {
  BackendProcessExit,
  BackendProcessIdentity,
  BackendProcessIdentitySpec,
  BackendProcessLogger,
  BackendProcessStatus,
  BackendSupervisor,
  BackendSupervisorState
} from "./backend-supervisor";

export type {
  BackendProcessExit,
  BackendProcessIdentity,
  BackendProcessIdentitySpec,
  BackendProcessLogger,
  BackendProcessStatus,
  BackendSupervisor,
  BackendSupervisorState
} from "./backend-supervisor";

const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_HEALTH_INTERVAL_MS = 100;
const STOP_TIMEOUT_MS = 3_000;
const BACKEND_PROTOCOL_VERSION = ADVX_HTTP_PROTOCOL_VERSION;
const MAX_BACKEND_OUTPUT_LINE_BYTES = 64 * 1024;

export interface BackendProcessController extends BackendSupervisor {}

export type BackendHealthOptions = {
  baseUrl: string;
  healthToken?: string;
  compatibility?: BackendCompatibilityExpectation;
  timeoutMs?: number;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  getStartupError?: () => Error | null;
};

export type BackendCompatibilityExpectation = {
  backendVersion?: string;
};

export type BackendHealthProbe = (
  options: BackendHealthOptions
) => Promise<void>;

const DEFAULT_RESTART_BUDGET = 3;

function defaultIdentity(baseUrl: string): BackendProcessIdentitySpec {
  let port = 0;
  try {
    port = Number(new URL(baseUrl).port || 0);
  } catch {
    // The health probe owns URL validation and will report malformed URLs.
  }
  return {
    version: "unknown",
    port,
    token: "",
    dataDirectory: "",
    logLocation: ""
  };
}

function createIdentity(
  spec: BackendProcessIdentitySpec,
  pid: number | null
): BackendProcessIdentity {
  return {
    ...spec,
    id: randomUUID(),
    pid
  };
}

export async function waitForBackendHealth(options: BackendHealthOptions): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_HEALTH_INTERVAL_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds) => delay(milliseconds));
  const deadline = now() + timeoutMs;
  let lastError: unknown = null;

  while (now() < deadline) {
    const startupError = options.getStartupError?.();
    if (startupError) throw startupError;
    try {
      const response = await fetchImpl(`${options.baseUrl.replace(/\/$/, "")}/health`, {
        headers:
          options.healthToken === undefined
            ? undefined
            : { authorization: `Bearer ${options.healthToken}` },
        signal: AbortSignal.timeout(Math.min(1_000, Math.max(100, timeoutMs)))
      });
      if (response.ok) {
        const payload = (await response.json()) as {
          status?: unknown;
          protocol_version?: unknown;
        };
        if (
          payload.status === "ok" &&
          payload.protocol_version === BACKEND_PROTOCOL_VERSION
        ) {
          if (options.compatibility === undefined) return;
          await assertBackendCompatibility({
            baseUrl: options.baseUrl,
            healthToken: options.healthToken,
            expectation: options.compatibility,
            fetchImpl,
            timeoutMs
          });
          return;
        }
        lastError = new Error("本地后端返回了不兼容的健康状态。");
      } else {
        lastError = new Error(`本地后端健康检查返回 HTTP ${response.status}。`);
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(intervalMs);
  }

  const suffix = lastError instanceof Error && lastError.message ? ` ${lastError.message}` : "";
  throw new Error(`本地后端没有在 ${Math.ceil(timeoutMs / 1_000)} 秒内启动。${suffix}`);
}

export class ExternalBackendProcess implements BackendProcessController {
  readonly process = null;
  private readonly baseUrl: string;
  private readonly startupTimeoutMs: number;
  private readonly healthProbe: BackendHealthProbe;
  private readonly identitySpec: BackendProcessIdentitySpec;
  private readonly restartBudget: number;
  private identity: BackendProcessIdentity;
  private state: BackendSupervisorState = "idle";
  private ready = false;
  private startPromise: Promise<void> | null = null;
  private restartCount = 0;
  private lastExit: BackendProcessExit | null = null;
  private disposed = false;

  constructor(options: {
    baseUrl: string;
    startupTimeoutMs?: number;
    identity?: BackendProcessIdentitySpec;
    restartBudget?: number;
    healthProbe?: BackendHealthProbe;
  }) {
    this.baseUrl = options.baseUrl;
    this.startupTimeoutMs = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
    this.healthProbe = options.healthProbe ?? waitForBackendHealth;
    this.identitySpec = options.identity ?? defaultIdentity(options.baseUrl);
    this.restartBudget = normalizeRestartBudget(options.restartBudget);
    this.identity = createIdentity(this.identitySpec, null);
  }

  async prepare(): Promise<void> {
    this.assertUsable();
    if (this.state === "idle" || this.state === "exited" || this.state === "failed") {
      this.state = "prepared";
    }
  }

  start(): Promise<void> {
    this.assertUsable();
    if (this.ready) return Promise.resolve();
    if (this.startPromise) {
      return Promise.reject(new Error("后端启动已在进行中。"));
    }
    this.startPromise = this.startInternal().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async waitReady(): Promise<void> {
    this.assertUsable();
    if (this.ready) return;
    this.state = "starting";
    await this.healthProbe({
      baseUrl: this.baseUrl,
      timeoutMs: this.startupTimeoutMs
    });
    this.ready = true;
    this.state = "ready";
  }

  status(): BackendProcessStatus {
    return {
      state: this.state,
      ready: this.ready,
      identity: { ...this.identity },
      lastExit: this.lastExit ? { ...this.lastExit } : null,
      restartCount: this.restartCount,
      restartBudget: this.restartBudget
    };
  }

  async restart(): Promise<void> {
    this.assertUsable();
    if (this.restartCount >= this.restartBudget) {
      throw new Error("本地后端重启次数已达到上限。");
    }
    this.restartCount += 1;
    await this.stop();
    await this.start();
  }

  async stop(): Promise<void> {
    if (this.disposed) return;
    this.ready = false;
    this.state = "idle";
  }

  async forceStop(): Promise<void> {
    await this.stop();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.forceStop();
    this.disposed = true;
    this.state = "disposed";
  }

  onUnexpectedExit(_listener: (exit: BackendProcessExit) => void): () => void {
    return () => undefined;
  }

  private async startInternal(): Promise<void> {
    await this.prepare();
    await this.waitReady();
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error("后端监督器已经释放。");
  }
}

async function assertBackendCompatibility(input: {
  baseUrl: string;
  healthToken?: string;
  expectation: BackendCompatibilityExpectation;
  fetchImpl: typeof fetch;
  timeoutMs: number;
}): Promise<void> {
  const response = await input.fetchImpl(`${input.baseUrl.replace(/\/$/, "")}/version`, {
    headers:
      input.healthToken === undefined
        ? undefined
        : { authorization: `Bearer ${input.healthToken}` },
    signal: AbortSignal.timeout(Math.min(1_000, Math.max(100, input.timeoutMs)))
  });
  if (!response.ok) {
    throw new Error(`本地后端版本检查返回 HTTP ${response.status}。`);
  }
  const payload = (await response.json()) as {
    backend_version?: unknown;
    build_id?: unknown;
    http_protocol_version?: unknown;
    realtime_protocol_version?: unknown;
    schema_package_version?: unknown;
  };
  const backendVersionMatches =
    typeof payload.backend_version === "string" &&
    payload.backend_version.length > 0 &&
    (input.expectation.backendVersion === undefined ||
      payload.backend_version === input.expectation.backendVersion);
  if (
    !backendVersionMatches ||
    typeof payload.build_id !== "string" ||
    payload.build_id.length === 0 ||
    payload.http_protocol_version !== ADVX_HTTP_PROTOCOL_VERSION ||
    payload.realtime_protocol_version !== ADVX_REALTIME_PROTOCOL_VERSION ||
    payload.schema_package_version !== ADVX_SCHEMA_PACKAGE_VERSION
  ) {
    throw new Error("本地后端返回了不兼容的版本或契约 schema。");
  }
}

export type SpawnedBackendProcessOptions = {
  command: string;
  args?: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  baseUrl: string;
  healthToken?: string;
  compatibility?: BackendCompatibilityExpectation;
  startupToken?: string;
  ipcShutdown?: boolean;
  windowsHide?: boolean;
  identity?: BackendProcessIdentitySpec;
  logger?: BackendProcessLogger;
  startupTimeoutMs?: number;
  restartBudget?: number;
  healthProbe?: BackendHealthProbe;
};

export class SpawnedBackendProcess implements BackendProcessController {
  private readonly options: SpawnedBackendProcessOptions;
  private readonly healthProbe: BackendHealthProbe;
  private readonly identitySpec: BackendProcessIdentitySpec;
  private readonly restartBudget: number;
  private child: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private readyPromise: Promise<void> | null = null;
  private stopping = false;
  private ready = false;
  private startupError: Error | null = null;
  private state: BackendSupervisorState = "idle";
  private identity: BackendProcessIdentity;
  private lastExit: BackendProcessExit | null = null;
  private restartCount = 0;
  private disposed = false;
  private readonly exitListeners = new Set<(exit: BackendProcessExit) => void>();

  constructor(options: SpawnedBackendProcessOptions) {
    this.options = options;
    this.healthProbe = options.healthProbe ?? waitForBackendHealth;
    this.identitySpec = options.identity ?? defaultIdentity(options.baseUrl);
    this.restartBudget = normalizeRestartBudget(options.restartBudget);
    this.identity = createIdentity(this.identitySpec, null);
  }

  get process(): ChildProcessWithoutNullStreams | null {
    return this.child;
  }

  async prepare(): Promise<void> {
    this.assertUsable();
    if (this.state === "idle" || this.state === "exited" || this.state === "failed") {
      this.state = "prepared";
    }
  }

  start(): Promise<void> {
    this.assertUsable();
    if (this.ready && this.child && this.child.exitCode === null) return Promise.resolve();
    if (this.startPromise) {
      return Promise.reject(new Error("后端启动已在进行中。"));
    }
    this.startPromise = this.startChild().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async waitReady(): Promise<void> {
    this.assertUsable();
    if (this.ready) return;
    const child = this.child;
    if (!child) {
      throw this.startupError ?? new Error("本地后端进程尚未启动。");
    }
    if (this.readyPromise) return this.readyPromise;

    this.state = "starting";
    this.readyPromise = this.healthProbe({
      baseUrl: this.options.baseUrl,
      healthToken: this.options.healthToken,
      compatibility: this.options.compatibility,
      timeoutMs: this.options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS,
      getStartupError: () => this.startupError
    })
      .then(() => {
        if (this.child !== child || child.exitCode !== null || child.signalCode !== null) {
          throw this.startupError ?? new Error("本地后端在健康检查后退出。");
        }
        this.ready = true;
        this.state = "ready";
        this.options.logger?.info("backend.ready", {
          baseUrl: this.options.baseUrl,
          pid: child.pid
        });
      })
      .finally(() => {
        this.readyPromise = null;
      });
    return this.readyPromise;
  }

  status(): BackendProcessStatus {
    return {
      state: this.state,
      ready: this.ready,
      identity: { ...this.identity },
      lastExit: this.lastExit ? { ...this.lastExit } : null,
      restartCount: this.restartCount,
      restartBudget: this.restartBudget
    };
  }

  async restart(): Promise<void> {
    this.assertUsable();
    if (this.restartCount >= this.restartBudget) {
      throw new Error("本地后端重启次数已达到上限。");
    }
    this.restartCount += 1;
    await this.stopChild("restart");
    await this.start();
  }

  stop(): Promise<void> {
    return this.stopChild("requested");
  }

  private async stopChild(reason: "requested" | "restart"): Promise<void> {
    if (this.disposed) return;
    this.stopping = true;
    this.ready = false;
    this.readyPromise = null;
    this.state = "stopping";
    const child = this.child;
    this.child = null;
    if (
      !child ||
      child.exitCode !== null ||
      child.signalCode !== null ||
      child.pid === undefined
    ) {
      this.stopping = false;
      if (!this.disposed) this.state = "idle";
      return;
    }

    this.options.logger?.info("backend.stop.requested", { pid: child.pid, reason });
    const exited = onceTermination(child);
    const ipcRequested = this.options.ipcShutdown === true &&
      await requestIpcShutdown(child, reason);
    if (!ipcRequested) await terminateChildProcess(child, false);
    await Promise.race([exited, delay(STOP_TIMEOUT_MS)]);
    if (child.exitCode === null && child.signalCode === null) {
      this.options.logger?.warn("backend.stop.forced", { pid: child.pid });
      await terminateChildProcess(child, true);
      await Promise.race([exited, delay(500)]);
    }
    this.stopping = false;
    if (!this.disposed) this.state = "idle";
  }

  async forceStop(): Promise<void> {
    if (this.disposed) return;
    this.stopping = true;
    this.ready = false;
    this.readyPromise = null;
    this.state = "stopping";
    const child = this.child;
    this.child = null;
    if (
      !child ||
      child.exitCode !== null ||
      child.signalCode !== null ||
      child.pid === undefined
    ) {
      this.stopping = false;
      this.state = "idle";
      return;
    }

    this.options.logger?.warn("backend.stop.forced", { pid: child.pid });
    const exited = onceTermination(child);
    await terminateChildProcess(child, true);
    await Promise.race([exited, delay(500)]);
    this.stopping = false;
    if (!this.disposed) this.state = "idle";
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    await this.stop();
    this.disposed = true;
    this.state = "disposed";
    this.exitListeners.clear();
  }

  onUnexpectedExit(listener: (exit: BackendProcessExit) => void): () => void {
    this.assertUsable();
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  private async startChild(): Promise<void> {
    await this.prepare();
    this.stopping = false;
    this.ready = false;
    this.startupError = null;
    this.lastExit = null;
    this.state = "starting";
    const child = spawn(this.options.command, [...(this.options.args ?? [])], {
      cwd: this.options.cwd,
      env: this.options.env,
      stdio: this.options.ipcShutdown
        ? ["pipe", "pipe", "pipe", "ipc"]
        : ["pipe", "pipe", "pipe"],
      windowsHide: this.options.windowsHide ?? true
    }) as ChildProcessWithoutNullStreams;
    this.child = child;
    this.identity = {
      ...this.identitySpec,
      id: randomUUID(),
      pid: child.pid ?? null
    };
    this.options.logger?.info("backend.spawn.requested", {
      args: this.options.args ?? [],
      command: this.options.command,
      cwd: this.options.cwd
    });
    child.once("spawn", () => {
      this.options.logger?.info("backend.spawned", { pid: child.pid });
    });
    const stdoutForwarder = createBackendOutputForwarder(this.options.logger, "stdout");
    const stderrForwarder = createBackendOutputForwarder(this.options.logger, "stderr");
    child.stdout.on("data", stdoutForwarder.write);
    child.stdout.once("end", stdoutForwarder.flush);
    child.stderr.on("data", stderrForwarder.write);
    child.stderr.once("end", stderrForwarder.flush);
    if (this.options.startupToken !== undefined) {
      const token = Buffer.from(this.options.startupToken, "utf8");
      const clearToken = (): void => {
        token.fill(0);
      };
      child.stdin.once("error", clearToken);
      child.stdin.end(token, clearToken);
    }
    child.once("error", (error) => {
      this.options.logger?.error("backend.spawn.failed", error);
      this.startupError = new Error(`无法启动本地后端进程：${error.message}`);
      this.state = "failed";
    });
    child.once("exit", (code, signal) => {
      if (this.child === child) this.child = null;
      const wasReady = this.ready;
      this.ready = false;
      const exit: BackendProcessExit = {
        code,
        signal,
        pid: child.pid ?? null,
        instanceId: this.identity.id,
        exitedAtMs: Date.now(),
        expected: this.stopping
      };
      this.lastExit = exit;
      if (this.stopping) this.options.logger?.info("backend.exit.expected", exit);
      else this.options.logger?.warn("backend.exit.unexpected", exit);
      if (!wasReady && !this.stopping) {
        this.startupError = new Error(
          `本地后端在启动期间退出（${describeExit(exit)}）。`
        );
        this.state = "failed";
      } else if (!this.stopping) {
        this.state = "exited";
      }
      if (wasReady && !this.stopping) {
        for (const listener of this.exitListeners) listener(exit);
      }
    });

    try {
      await this.waitReady();
    } catch (error) {
      this.options.logger?.error("backend.start.failed", error);
      await this.stop();
      throw error;
    }
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error("后端监督器已经释放。");
  }
}

export function forwardBackendOutput(
  logger: BackendProcessLogger | undefined,
  stream: "stdout" | "stderr",
  chunk: Buffer
): void {
  const forwarder = createBackendOutputForwarder(logger, stream);
  forwarder.write(chunk);
  forwarder.flush();
}

export function createBackendOutputForwarder(
  logger: BackendProcessLogger | undefined,
  stream: "stdout" | "stderr"
): { write(chunk: Buffer): void; flush(): void } {
  const decoder = new StringDecoder("utf8");
  let buffered = "";
  let droppingOversizedLine = false;

  const reportOversizedLine = (byteLength: number): void => {
    if (logger) {
      logger.warn("backend.output.omitted", {
        byteLength,
        reason: "line-too-long",
        stream
      });
      return;
    }
    process.stderr.write(
      `[backend] output omitted (${stream} line exceeded ${MAX_BACKEND_OUTPUT_LINE_BYTES} bytes)\n`
    );
  };

  const emitLine = (line: string): void => {
    const text = line.trimEnd();
    if (!text) return;
    const byteLength = Buffer.byteLength(text);
    if (byteLength > MAX_BACKEND_OUTPUT_LINE_BYTES) {
      reportOversizedLine(byteLength);
      return;
    }

    const redactedText = redactLogText(text);
    if (!logger) {
      const output = stream === "stdout" ? process.stdout : process.stderr;
      output.write(`[backend] ${redactedText}\n`);
      return;
    }
    const isError =
      stream === "stderr" && /\b(ERROR|CRITICAL)\b|Traceback|Exception/.test(redactedText);
    const write = isError ? logger.error.bind(logger) : logger.info.bind(logger);
    write("backend.output", { stream, text: redactedText });
  };

  const append = (decoded: string): void => {
    let incoming = decoded;
    if (droppingOversizedLine) {
      const lineEnd = /\r?\n/.exec(incoming);
      if (!lineEnd) return;
      incoming = incoming.slice(lineEnd.index + lineEnd[0].length);
      droppingOversizedLine = false;
    }

    buffered += incoming;
    const lines = buffered.split(/\r?\n/);
    buffered = lines.pop() ?? "";
    for (const line of lines) emitLine(line);
    if (Buffer.byteLength(buffered) > MAX_BACKEND_OUTPUT_LINE_BYTES) {
      reportOversizedLine(Buffer.byteLength(buffered));
      buffered = "";
      droppingOversizedLine = true;
    }
  };

  return {
    write: (chunk) => append(decoder.write(chunk)),
    flush: () => {
      append(decoder.end());
      if (!droppingOversizedLine && buffered) emitLine(buffered);
      buffered = "";
      droppingOversizedLine = false;
    }
  };
}

function describeExit(exit: BackendProcessExit): string {
  if (exit.signal) return `signal ${exit.signal}`;
  return `exit ${exit.code ?? "unknown"}`;
}

function normalizeRestartBudget(value: number | undefined): number {
  if (value === undefined) return DEFAULT_RESTART_BUDGET;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("后端重启预算必须是非负整数。");
  }
  return value;
}

function onceTermination(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.once("close", () => resolve());
  });
}

async function terminateChildProcess(
  child: ChildProcessWithoutNullStreams,
  force: boolean
): Promise<void> {
  if (process.platform !== "win32" || child.pid === undefined) {
    child.kill(force ? "SIGKILL" : "SIGTERM");
    return;
  }

  await new Promise<void>((resolve) => {
    const taskkill = spawn(
      "taskkill.exe",
      ["/pid", String(child.pid), "/t", ...(force ? ["/f"] : [])],
      { stdio: "ignore", windowsHide: true }
    );
    taskkill.once("error", () => {
      child.kill(force ? "SIGKILL" : "SIGTERM");
      resolve();
    });
    taskkill.once("exit", () => resolve());
  });
}

async function requestIpcShutdown(
  child: ChildProcessWithoutNullStreams,
  reason: "requested" | "restart"
): Promise<boolean> {
  if (!child.connected || typeof child.send !== "function") return false;
  return new Promise((resolve) => {
    try {
      child.send({ type: "advx.backend.shutdown", reason }, (error) => resolve(!error));
    } catch {
      resolve(false);
    }
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
