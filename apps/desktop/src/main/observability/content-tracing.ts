import { contentTracing } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { canonicalJson } from "@advx/contracts";

export const CONTENT_TRACE_SCHEMA_VERSION = 1 as const;
export const CONTENT_TRACE_MIN_DURATION_MS = 100;
export const CONTENT_TRACE_MAX_DURATION_MS = 5 * 60 * 1000;
export const CONTENT_TRACE_CATEGORY_FILTER =
  "toplevel,blink,renderer.scheduler,disabled-by-default-devtools.timeline";

type ContentTracingApi = Pick<typeof contentTracing, "startRecording" | "stopRecording">;

export type ContentTraceOptions = Readonly<{
  outputDirectory: string;
  durationMs: number;
  traceName?: string;
  now?: () => Date;
  tracing?: ContentTracingApi;
}>;

export type ContentTraceResult = Readonly<{
  schema_version: typeof CONTENT_TRACE_SCHEMA_VERSION;
  trace_path: string;
  metadata_path: string;
  started_at: string;
  finished_at: string;
  duration_ms: number;
  requested_duration_ms: number;
  stop_reason: "deadline" | "application_shutdown" | "requested";
  category_filter: string;
  redacted: true;
}>;

export type ContentTraceHandle = Readonly<{
  tracePath: string;
  metadataPath: string;
  stop: (
    reason?: ContentTraceResult["stop_reason"]
  ) => Promise<ContentTraceResult>;
}>;

export class ContentTraceError extends Error {
  readonly name = "ContentTraceError";

  constructor(readonly code: ContentTraceErrorCode, message: string) {
    super(message);
  }
}

export type ContentTraceErrorCode =
  | "invalid_request"
  | "invalid_output_path"
  | "invalid_trace_name"
  | "start_failed";

export async function startContentTrace(
  options: ContentTraceOptions
): Promise<ContentTraceHandle> {
  const normalized = normalizeOptions(options);
  const now = normalized.now;
  const startedAt = now();
  if (Number.isNaN(startedAt.valueOf())) {
    throw new ContentTraceError("invalid_request", "content trace clock returned an invalid date");
  }
  await mkdir(normalized.outputDirectory, { recursive: true });
  try {
    await normalized.tracing.startRecording({
      categoryFilter: CONTENT_TRACE_CATEGORY_FILTER,
      traceOptions: "record-until-full,enable-sampling"
    });
  } catch (error) {
    throw new ContentTraceError(
      "start_failed",
      error instanceof Error ? error.message : String(error)
    );
  }

  let settled: Promise<ContentTraceResult> | undefined;
  const stop = (
    reason: ContentTraceResult["stop_reason"] = "requested"
  ): Promise<ContentTraceResult> => {
    settled ??= stopContentTrace(normalized, startedAt, reason);
    return settled;
  };
  const timer = setTimeout(() => {
    void stop("deadline");
  }, normalized.durationMs);
  const originalStop = stop;
  return Object.freeze({
    tracePath: normalized.tracePath,
    metadataPath: normalized.metadataPath,
    stop: (reason) => {
      clearTimeout(timer);
      return originalStop(reason);
    }
  });
}

async function stopContentTrace(
  options: NormalizedContentTraceOptions,
  startedAt: Date,
  reason: ContentTraceResult["stop_reason"]
): Promise<ContentTraceResult> {
  const stoppedPath = await options.tracing.stopRecording(options.tracePath);
  const finishedAt = options.now();
  if (Number.isNaN(finishedAt.valueOf())) {
    throw new ContentTraceError("invalid_request", "content trace clock returned an invalid date");
  }
  const result: ContentTraceResult = Object.freeze({
    schema_version: CONTENT_TRACE_SCHEMA_VERSION,
    trace_path: stoppedPath || options.tracePath,
    metadata_path: options.metadataPath,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: Math.max(0, finishedAt.valueOf() - startedAt.valueOf()),
    requested_duration_ms: options.durationMs,
    stop_reason: reason,
    category_filter: CONTENT_TRACE_CATEGORY_FILTER,
    redacted: true
  });
  await writeFile(options.metadataPath, `${canonicalJson(result)}\n`, "utf8");
  return result;
}

type NormalizedContentTraceOptions = {
  outputDirectory: string;
  durationMs: number;
  traceName: string;
  tracePath: string;
  metadataPath: string;
  now: () => Date;
  tracing: ContentTracingApi;
};

function normalizeOptions(options: ContentTraceOptions): NormalizedContentTraceOptions {
  if (options === null || typeof options !== "object") {
    throw new ContentTraceError("invalid_request", "content trace options must be an object");
  }
  if (
    typeof options.outputDirectory !== "string" ||
    !isAbsolute(options.outputDirectory) ||
    options.outputDirectory.length > 4096
  ) {
    throw new ContentTraceError(
      "invalid_output_path",
      "content trace output directory must be an absolute path"
    );
  }
  if (
    !Number.isSafeInteger(options.durationMs) ||
    options.durationMs < CONTENT_TRACE_MIN_DURATION_MS ||
    options.durationMs > CONTENT_TRACE_MAX_DURATION_MS
  ) {
    throw new ContentTraceError("invalid_request", "content trace duration is out of bounds");
  }
  const traceName = options.traceName ?? `advx-content-${Date.now()}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(traceName)) {
    throw new ContentTraceError("invalid_trace_name", "content trace name must be a safe basename");
  }
  const outputDirectory = resolve(options.outputDirectory);
  return {
    outputDirectory,
    durationMs: options.durationMs,
    traceName,
    tracePath: join(outputDirectory, `${traceName}.json`),
    metadataPath: join(outputDirectory, `${traceName}.metadata.json`),
    now: options.now ?? (() => new Date()),
    tracing: options.tracing ?? contentTracing
  };
}
