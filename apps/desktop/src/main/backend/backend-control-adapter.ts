import type { bunOperations as BunOperations } from "@advx/contracts/generated";
import {
  httpOperations,
  httpOperationRegistry,
  type HttpMethod,
  type HttpOperation
} from "@advx/contracts/http";
export { BACKEND_RUNTIMES, resolveBackendRuntime } from "./backend-runtime";

const PROTOCOL_VERSION = 3;
const PROTOCOL_HEADER = "X-ADVX-Protocol-Version";
const DEFAULT_TIMEOUT_MS = 8_000;

export type ControlRequestOptions = {
  timeoutMs?: number;
  timeoutCode?: string;
  timeoutMessage?: string;
  signal?: AbortSignal;
};

export type ControlRequest = ControlRequestOptions & {
  path: string;
  method: HttpMethod;
  body?: object;
};

export class BackendClientError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "BackendClientError";
    this.code = code;
  }
}

export interface BackendControlTransport {
  request<T>(request: ControlRequest): Promise<T>;
}

export function createBackendControlTransport(options: {
  baseUrl: string;
  localToken: string;
}): BackendControlTransport {
  return new BunGeneratedControlTransport(options);
}

abstract class FetchControlTransport implements BackendControlTransport {
  private readonly baseUrl: string;
  private readonly localToken: string;

  constructor(options: { baseUrl: string; localToken: string }) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.localToken = options.localToken;
  }

  async request<T>(request: ControlRequest): Promise<T> {
    return this.requestWithOperation<T>(request);
  }

  protected async requestWithOperation<T>(
    request: ControlRequest,
    operationId?: string
  ): Promise<T> {
    const operation = resolveOperation(request.method, request.path);
    if (!operation || (operationId !== undefined && operation.operationId !== operationId)) {
      throw new BackendClientError(
        "protocol_error",
        `未注册的后端 HTTP 操作：${request.method} ${request.path.split("?")[0]}`
      );
    }
    if (!this.localToken.trim()) {
      throw new BackendClientError("local_token_missing", "桌面端没有收到本地后端令牌。");
    }

    const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const { signal, timedOut, dispose } = composeAbortSignal(timeoutMs, request.signal);
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${request.path}`, {
        method: request.method,
        headers: {
          Authorization: `Bearer ${this.localToken}`,
          [PROTOCOL_HEADER]: String(PROTOCOL_VERSION),
          ...(request.body === undefined ? {} : { "Content-Type": "application/json" })
        },
        body: request.body === undefined ? undefined : JSON.stringify(request.body),
        signal
      });
    } catch (error) {
      if (timedOut()) {
        dispose();
        throw new BackendClientError(
          request.timeoutCode ?? "backend_timeout",
          request.timeoutMessage ?? "本地后端响应超时。"
        );
      }
      if (request.signal?.aborted || (error instanceof Error && error.name === "AbortError")) {
        dispose();
        throw new BackendClientError("request_aborted", "后端请求已取消。");
      }
      dispose();
      throw new BackendClientError("backend_unavailable", "本地后端暂时不可用。");
    }

    try {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        if (!response.ok) throw normalizeHttpError(response.status, null);
        throw new BackendClientError("protocol_error", "后端返回了无效 JSON。");
      }
      if (!response.ok) throw normalizeHttpError(response.status, payload);
      const responseSchema = operation.responses[response.status];
      if (!responseSchema) {
        throw new BackendClientError(
          "protocol_error",
          `后端返回未声明的状态码：${response.status}`
        );
      }
      try {
        return responseSchema.parse(payload) as T;
      } catch {
        throw new BackendClientError("protocol_error", "后端响应不符合声明的控制协议。");
      }
    } finally {
      dispose();
    }
  }
}

export class BunGeneratedControlTransport extends FetchControlTransport {
  override async request<T>(request: ControlRequest): Promise<T> {
    const operation = resolveOperation(request.method, request.path);
    if (!operation) {
      throw new BackendClientError(
        "protocol_error",
        `未注册的后端 HTTP 操作：${request.method} ${request.path.split("?")[0]}`
      );
    }
    // This witness keeps the checked-in generated operation IDs on the Bun path.
    // The runtime response still goes through the canonical schema validator.
    const generatedOperation = asGeneratedOperation(operation.operationId);
    return this.requestGenerated(generatedOperation.id, request) as Promise<T>;
  }

  private requestGenerated<OperationId extends GeneratedOperationId>(
    operationId: OperationId,
    request: ControlRequest
  ): Promise<GeneratedSuccessResponse<OperationId>> {
    return super.requestWithOperation<GeneratedSuccessResponse<OperationId>>(
      request,
      operationId
    );
  }
}

type GeneratedOperationId = keyof BunOperations & string;

type GeneratedSuccessResponse<OperationId extends GeneratedOperationId> =
  BunOperations[OperationId] extends {
    responses: { 200: infer Response };
  }
    ? Response extends { content: { "application/json": infer Payload } }
      ? Payload
      : never
    : never;

function asGeneratedOperation(operationId: string): { id: GeneratedOperationId } {
  return { id: operationId as GeneratedOperationId };
}

function resolveOperation(method: HttpMethod, path: string): HttpOperation | null {
  const pathname = path.split("?", 1)[0];
  const exact = httpOperationRegistry[`${method} ${pathname}`];
  if (exact) return exact;
  return (
    httpOperations.find((operation) => {
      if (operation.method !== method) return false;
      const pattern = operation.path
        .split("/")
        .map((segment) => (segment.startsWith("{") ? "[^/]+" : escapeRegExp(segment)))
        .join("/");
      return new RegExp(`^${pattern}$`).test(pathname);
    }) ?? null
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function composeAbortSignal(timeoutMs: number, callerSignal?: AbortSignal): {
  signal: AbortSignal;
  timedOut: () => boolean;
  dispose: () => void;
} {
  const controller = new AbortController();
  let didTimeout = false;
  const timeout = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) controller.abort(callerSignal.reason);
  callerSignal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => didTimeout,
    dispose: () => {
      clearTimeout(timeout);
      callerSignal?.removeEventListener("abort", onAbort);
    }
  };
}

function normalizeHttpError(status: number, payload: unknown): BackendClientError {
  const detail = isRecord(payload) ? payload : null;
  const code = detail && typeof detail.code === "string" ? detail.code : `http_${status}`;
  const message =
    detail && typeof detail.safe_detail === "string"
      ? detail.safe_detail
      : detail && typeof detail.message === "string"
        ? detail.message
        : "后端请求失败。";
  return new BackendClientError(code, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
