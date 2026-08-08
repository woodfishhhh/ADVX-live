import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  requestShutdownViaSocket,
  terminateWithFallback,
  waitForCompletionOrTimeout
} from "./process-lifecycle.ts";

const useProcessGroups = process.platform !== "win32";
const shutdownGraceMs = 5_000;
const configuredBackendUrl = process.env.ADVX_BACKEND_URL;
const desktopShutdownSocket =
  process.platform === "win32"
    ? `\\\\.\\pipe\\advx-live-${randomBytes(12).toString("hex")}`
    : `/tmp/advx-live-${randomBytes(12).toString("hex")}.sock`;
const {
  ELECTRON_RUN_AS_NODE: _electronRunAsNode,
  ...inheritedEnvironment
} = process.env;
const childEnvironment = {
  ...inheritedEnvironment,
  ADVX_BACKEND_EXTERNAL: configuredBackendUrl === undefined ? "0" : "1",
  ADVX_DESKTOP_SHUTDOWN_SOCKET: desktopShutdownSocket
};
let desktopChild = null;
let shuttingDown = false;
let shutdownPromise = null;

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

try {
  console.log(
    configuredBackendUrl === undefined
      ? "Starting Electron with its supervised Bun backend."
      : `Starting Electron with the explicit external backend at ${configuredBackendUrl}.`
  );

  const desktop = spawn(process.execPath, ["run", "--filter", "@advx/desktop", "dev"], {
    stdio: ["ignore", "inherit", "inherit"],
    shell: false,
    detached: useProcessGroups,
    env: childEnvironment
  });
  desktopChild = desktop;
  observeChild(desktop, "Desktop");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  void shutdown(1);
}

function observeChild(child, label) {
  child.on("error", (error) => {
    console.error(`${label}: ${error.message}`);
    void shutdown(1);
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    if (signal) console.error(`${label} stopped by ${signal}.`);
    void shutdown(code ?? 1);
  });
}

function shutdown(exitCode = 0) {
  if (shutdownPromise) return shutdownPromise;
  shuttingDown = true;
  shutdownPromise = (async () => {
    await stopDesktopChild();
    process.exitCode = exitCode;
  })();
  return shutdownPromise;
}

async function stopDesktopChild() {
  const child = desktopChild;
  if (!child || !isChildTreeRunning(child)) return;

  console.log("Requesting graceful Desktop shutdown...");
  const accepted = await requestShutdownViaSocket(desktopShutdownSocket);
  if (!accepted) {
    console.warn("Desktop shutdown control was unavailable; falling back to SIGTERM.");
    await stopChildTree(child, "Desktop");
    return;
  }

  await waitForCompletionOrTimeout(waitForChildTreeExit(child), shutdownGraceMs);
  if (!isChildTreeRunning(child)) return;

  console.error(`Desktop did not exit within ${shutdownGraceMs}ms; falling back to SIGTERM.`);
  await stopChildTree(child, "Desktop", 1_000);
}

async function stopChildTree(child, label, gracefulTimeoutMs = shutdownGraceMs) {
  if (!child || !isChildTreeRunning(child)) return;
  console.log(`Requesting graceful ${label} shutdown...`);
  await terminateWithFallback({
    isRunning: () => isChildTreeRunning(child),
    requestTermination: (signal) => terminateChildTree(child, signal),
    waitForExit: () => waitForChildTreeExit(child),
    gracefulTimeoutMs,
    forceTimeoutMs: 1_000,
    onForce: () =>
      console.error(`${label} did not exit within ${shutdownGraceMs}ms; forcing termination.`)
  });
}

function isRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

function isChildTreeRunning(child) {
  if (!useProcessGroups || child.pid === undefined) return isRunning(child);
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function terminateChildTree(child, signal) {
  if (!isChildTreeRunning(child) || child.pid === undefined) return;
  try {
    if (useProcessGroups) {
      process.kill(-child.pid, signal);
      return;
    }
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true
    });
    killer.unref();
  } catch (error) {
    if (error?.code !== "ESRCH") {
      console.error(`Failed to stop child process ${child.pid}: ${error}`);
    }
  }
}

async function waitForChildTreeExit(child) {
  while (isChildTreeRunning(child)) await delay(50);
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
