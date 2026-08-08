import { createRequire } from "node:module";
import { connect } from "node:net";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);
const electron = require("electron");
const desktopDirectory = fileURLToPath(new URL("..", import.meta.url));
const durationMs = boundedDuration(process.env.ADVX_CONTENT_TRACE_DURATION_MS);
const traceDirectory = resolve(
  process.env.ADVX_CONTENT_TRACE_DIR ?? join(desktopDirectory, ".advx-data", "diagnostics", "content-traces")
);
const shutdownSocket = process.platform === "win32"
  ? `\\\\.\\pipe\\advx-content-trace-${process.pid}`
  : join(tmpdir(), `advx-content-trace-${process.pid}.sock`);

await mkdir(traceDirectory, { recursive: true });
const child = spawn(electron, ["out/main/index.js"], {
  cwd: desktopDirectory,
  env: {
    ...process.env,
    ADVX_ELECTRON_CONTENT_TRACE: "1",
    ADVX_CONTENT_TRACE_DIR: traceDirectory,
    ADVX_CONTENT_TRACE_DURATION_MS: String(durationMs),
    ADVX_DESKTOP_SHUTDOWN_SOCKET: shutdownSocket
  },
  stdio: "inherit"
});

await delay(durationMs + 7_000);
await requestQuit(shutdownSocket);
const exitCode = await waitForExit(child, 10_000);
if (exitCode === null) {
  child.kill("SIGTERM");
  await waitForExit(child, 2_000);
}

const entries = await readdir(traceDirectory);
const metadata = entries.find((entry) => entry.endsWith(".metadata.json"));
if (metadata === undefined) {
  throw new Error(`content trace metadata was not produced in ${traceDirectory}`);
}
const result = JSON.parse(await readFile(join(traceDirectory, metadata), "utf8"));
if (result.redacted !== true || result.category_filter === undefined) {
  throw new Error("content trace metadata failed its bounded contract");
}
console.log(JSON.stringify({ ok: true, traceDirectory, metadata, exitCode }));

function boundedDuration(value) {
  const duration = value === undefined ? 10_000 : Number(value);
  if (!Number.isSafeInteger(duration) || duration < 100 || duration > 5 * 60 * 1000) {
    throw new Error("ADVX_CONTENT_TRACE_DURATION_MS must be between 100 and 300000");
  }
  return duration;
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function requestQuit(socketPath) {
  return new Promise((resolveRequest) => {
    const socket = connect(socketPath);
    const finish = () => {
      socket.destroy();
      resolveRequest();
    };
    socket.once("connect", () => socket.end("quit\n", finish));
    socket.once("error", finish);
  });
}

function waitForExit(processHandle, timeoutMs) {
  if (processHandle.exitCode !== null) return Promise.resolve(processHandle.exitCode);
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => resolveExit(null), timeoutMs);
    processHandle.once("exit", (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });
}
