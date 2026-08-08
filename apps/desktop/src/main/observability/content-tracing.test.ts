import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  CONTENT_TRACE_CATEGORY_FILTER,
  ContentTraceError,
  startContentTrace
} from "./content-tracing";

describe("bounded Electron content tracing", () => {
  test("starts with an allowlisted category filter and writes local metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "advx-content-trace-"));
    const calls: Array<unknown> = [];
    const tracing = {
      startRecording: async (options: unknown) => {
        calls.push(options);
      },
      stopRecording: async (path: string) => path
    };
    try {
      const handle = await startContentTrace({
        outputDirectory: root,
        durationMs: 100,
        traceName: "smoke",
        now: () => new Date("2026-08-06T00:00:00.000Z"),
        tracing
      });
      const result = await handle.stop("requested");
      expect(calls).toEqual([{
        categoryFilter: CONTENT_TRACE_CATEGORY_FILTER,
        traceOptions: "record-until-full,enable-sampling"
      }]);
      expect(result.redacted).toBe(true);
      expect(JSON.parse(await readFile(handle.metadataPath, "utf8")).trace_path).toBe(handle.tracePath);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("rejects unbounded duration and relative output paths", async () => {
    await expect(startContentTrace({
      outputDirectory: "relative-output",
      durationMs: 100,
      tracing: { startRecording: async () => {}, stopRecording: async () => "" }
    })).rejects.toBeInstanceOf(ContentTraceError);
    await expect(startContentTrace({
      outputDirectory: "C:/advx-content-trace",
      durationMs: 5 * 60 * 1000 + 1,
      tracing: { startRecording: async () => {}, stopRecording: async () => "" }
    })).rejects.toBeInstanceOf(ContentTraceError);
  });
});
