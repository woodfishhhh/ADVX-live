import { app, BrowserWindow, globalShortcut, screen } from "electron";
import { createServer, type Server } from "node:net";
import { join, resolve } from "node:path";
import type { BackendRuntimeStatus } from "../shared/contracts";
import {
  broadcastOverlaySettings,
  configureMediaAccess,
  registerDesktopIpc
} from "./ipc/register-desktop-ipc";
import { BackendClient } from "./backend/backend-client";
import { resolveBackendRuntime } from "./backend/backend-runtime";
import { createLocalBackendToken } from "./backend/backend-auth";
import { loadRuntimeSessionId } from "./backend/runtime-session-state";
import {
  ExternalBackendProcess,
  SpawnedBackendProcess,
  type BackendProcessController,
  type BackendProcessExit
} from "./backend/backend-process";
import { createBunBackendProcessOptions } from "./backend/backend-process-bun";
import { createBunCompiledBackendProcessOptions } from "./backend/backend-process-bun-compiled";
import {
  createApplicationTray,
  TRAY_MENU_ITEM_IDS,
  type ApplicationTray
} from "./application-tray";
import {
  getOverlaySettings,
  initializeOverlaySettings,
  reconcileOverlayTarget
} from "./overlay-settings";
import {
  backendLogger,
  initializeLogging,
  logger
} from "./logging";
import { restoreMacApplicationActivation } from "./mac-application-activation";
import { createControlWindow } from "./windows/control";
import { hideBarrageOutputs } from "./windows/barrage-outputs";
import {
  startContentTrace,
  type ContentTraceHandle
} from "./observability/content-tracing";

let controlWindow: BrowserWindow | null = null;
let applicationTray: ApplicationTray | null = null;
let allowControlWindowClose = false;
let controlWindowCloseRequested = false;
let controlWindowCloseFallback: NodeJS.Timeout | null = null;
let quitRequested = false;
let overlaySettingsReady = false;
let displaySyncPending = false;
let backendProcess: BackendProcessController | null = null;
let backendInitialization: Promise<BackendRuntimeStatus> | null = null;
let backendRestartTimer: NodeJS.Timeout | null = null;
let backendRestartAttempts = 0;
let appShutdownPromise: Promise<void> | null = null;
let appShutdownComplete = false;
let developmentShutdownServer: Server | null = null;
let contentTraceHandle: ContentTraceHandle | null = null;
const backendBaseUrl = process.env.ADVX_BACKEND_URL ?? "http://127.0.0.1:8765";
const backendRuntime = resolveBackendRuntime(process.env.ADVX_BACKEND_RUNTIME, {
  packaged: app.isPackaged
});
const localToken = createLocalBackendToken();
const backendClient = new BackendClient({
  baseUrl: backendBaseUrl,
  localToken,
  backendRuntime
});

function requestApplicationQuitFromSignal(signal: NodeJS.Signals): void {
  logger.info("app.shutdown.signal-requested", { signal });
  app.quit();
}

process.on("SIGINT", () => requestApplicationQuitFromSignal("SIGINT"));
process.on("SIGTERM", () => requestApplicationQuitFromSignal("SIGTERM"));

function startDevelopmentShutdownControl(): Promise<void> {
  const socketPath = process.env.ADVX_DESKTOP_SHUTDOWN_SOCKET;
  if (!socketPath) return Promise.resolve();

  return new Promise((resolveStart, rejectStart) => {
    const server = createServer((socket) => {
      socket.once("error", () => socket.destroy());
      socket.once("data", (data) => {
        if (data.toString("utf8").trim() !== "quit") {
          socket.end("invalid\n");
          return;
        }
        socket.end("ok\n", () => {
          logger.info("app.shutdown.control-requested");
          app.quit();
        });
      });
    });
    const onStartError = (error: Error) => {
      developmentShutdownServer = null;
      rejectStart(error);
    };
    server.once("error", onStartError);
    server.listen(socketPath, () => {
      server.removeListener("error", onStartError);
      server.on("error", (error) => logger.error("app.shutdown.control-failed", { error }));
      developmentShutdownServer = server;
      resolveStart();
    });
  });
}

function stopDevelopmentShutdownControl(): void {
  const server = developmentShutdownServer;
  developmentShutdownServer = null;
  server?.close();
}

type TraySmokeHandle = ApplicationTray & {
  quitMenuItemId: typeof TRAY_MENU_ITEM_IDS.quit;
};

function setTraySmokeHandle(handle: TraySmokeHandle | null): void {
  if (process.env.ADVX_TRAY_SMOKE !== "1") return;
  const testGlobal = globalThis as typeof globalThis & {
    __advxTraySmoke?: TraySmokeHandle;
  };
  if (handle) testGlobal.__advxTraySmoke = handle;
  else delete testGlobal.__advxTraySmoke;
}

function createBackendProcessController(): BackendProcessController {
  const externalOverride = process.env.ADVX_BACKEND_EXTERNAL;
  const externallyManaged =
    externalOverride === "1" ||
    (externalOverride !== "0" && process.env.ADVX_BACKEND_URL !== undefined);
  const backendPort = new URL(backendBaseUrl).port || "8765";
  const configuredDataDirectory = process.env.ADVX_BACKEND_DATA_DIR?.trim();
  const dataDirectory = configuredDataDirectory
    ? resolve(configuredDataDirectory)
    : backendRuntime === "bun-source"
      ? join(app.getPath("userData"), "backend", "bun-source")
      : join(app.getPath("userData"), "backend", "bun-compiled");
  const processIdentity = {
    version: `${backendRuntime}@${app.getVersion()}`,
    port: Number(backendPort),
    token: localToken,
    dataDirectory,
    logLocation: join(app.getPath("userData"), "logs", "advx.log")
  } as const;
  logger.info("backend.mode.selected", {
    runtime: backendRuntime,
    packaged: app.isPackaged,
    dataDirectory
  });
  if (externallyManaged) {
    logger.info("backend.mode.external", { baseUrl: backendBaseUrl });
    return new ExternalBackendProcess({
      baseUrl: backendBaseUrl,
      identity: processIdentity
    });
  }

  if (backendRuntime === "bun-source") {
    const bunIdentity = {
      ...processIdentity,
      dataDirectory
    } as const;
    const repositoryRoot = resolve(app.getAppPath(), "../..");
    logger.info("backend.mode.bun-source", {
      port: bunIdentity.port,
      dataDirectory
    });
    return new SpawnedBackendProcess(
      createBunBackendProcessOptions({
        repositoryRoot,
        backendPort,
        backendBaseUrl,
        dataDirectory,
        startupToken: localToken,
        expectedBackendVersion: app.getVersion(),
        bunExecutable: process.env.ADVX_BUN_EXECUTABLE,
        identity: bunIdentity,
        logger: backendLogger
      })
    );
  }

  const compiledIdentity = {
    ...processIdentity,
    dataDirectory
  } as const;
  const repositoryRoot = resolve(app.getAppPath(), "../..");
  logger.info("backend.mode.bun-compiled", {
    port: compiledIdentity.port,
    dataDirectory,
    packaged: app.isPackaged
  });
  return new SpawnedBackendProcess(
    createBunCompiledBackendProcessOptions({
      packaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      repositoryRoot,
      backendExecutable: process.env.ADVX_BACKEND_COMPILED_EXECUTABLE,
      workingDirectory: app.isPackaged ? process.resourcesPath : repositoryRoot,
      backendPort,
      backendBaseUrl,
      dataDirectory,
      startupToken: localToken,
      expectedBackendVersion: app.getVersion(),
      identity: compiledIdentity,
      logger: backendLogger
    })
  );
}

async function initializeBackend(restart = false): Promise<BackendRuntimeStatus> {
  if (backendInitialization) return backendInitialization;
  const controller = backendProcess;
  if (!controller) throw new Error("本地后端控制器尚未初始化。");
  if (restart && backendRestartTimer) {
    clearTimeout(backendRestartTimer);
    backendRestartTimer = null;
  }

  backendInitialization = (async () => {
    logger.info("backend.initialize.started", { restart });
    if (restart) await backendClient.stop();
    backendClient.beginStartup();
    try {
      if (restart) await controller.restart();
      else await controller.start();
      backendClient.setBackendStartId(controller.status().identity.id);
      await backendClient.start();
      backendRestartAttempts = 0;
      logger.info("backend.initialize.completed", { restart });
      return backendClient.currentStatus();
    } catch (error) {
      logger.error("backend.initialize.failed", { error, restart });
      backendClient.failStartup(error);
      throw error;
    }
  })().finally(() => {
    backendInitialization = null;
  });
  return backendInitialization;
}

function scheduleBackendRecovery(exit: BackendProcessExit): void {
  if (quitRequested || backendRestartTimer) return;
  backendRestartAttempts += 1;
  if (backendRestartAttempts > 3) {
    logger.error("backend.recovery.exhausted", {
      attempt: backendRestartAttempts,
      ...exit
    });
    backendClient.failStartup(
      new Error(
        `本地后端连续退出，已停止自动恢复（${exit.signal ?? `exit ${exit.code ?? "unknown"}`}）。`
      )
    );
    return;
  }
  backendClient.beginStartup();
  const delayMs = [500, 1_500, 3_000][backendRestartAttempts - 1] ?? 3_000;
  logger.warn("backend.recovery.scheduled", {
    attempt: backendRestartAttempts,
    delayMs,
    ...exit
  });
  backendRestartTimer = setTimeout(() => {
    backendRestartTimer = null;
    void initializeBackend().catch(() => scheduleBackendRecovery(exit));
  }, delayMs);
}

function openControlWindow(): BrowserWindow {
  const window = createControlWindow();
  logger.info("window.control.opened", { webContentsId: window.webContents.id });
  allowControlWindowClose = false;
  controlWindowCloseRequested = false;
  window.on("close", (event) => {
    if (allowControlWindowClose || window.webContents.isLoadingMainFrame()) return;
    event.preventDefault();
    if (controlWindowCloseRequested) return;
    controlWindowCloseRequested = true;
    window.webContents.send("app:request-close");
    controlWindowCloseFallback = setTimeout(() => {
      allowControlWindowClose = true;
      window.destroy();
      app.quit();
    }, 5_000);
  });
  window.on("closed", () => {
    logger.info("window.control.closed");
    if (controlWindowCloseFallback) clearTimeout(controlWindowCloseFallback);
    controlWindowCloseFallback = null;
    if (controlWindow === window) controlWindow = null;
    if (quitRequested && !appShutdownPromise) setImmediate(() => app.quit());
  });
  return window;
}

function showControlWindow(): void {
  if (quitRequested || appShutdownPromise) return;
  const window = controlWindow;
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function confirmControlWindowClose(): void {
  const window = controlWindow;
  if (!window || window.isDestroyed()) return;
  if (controlWindowCloseFallback) clearTimeout(controlWindowCloseFallback);
  controlWindowCloseFallback = null;
  allowControlWindowClose = true;
  window.close();
  setImmediate(() => app.quit());
}

function prepareApplicationShutdown(): void {
  if (hasSingleInstanceLock) logger.info("app.shutdown.started");
  quitRequested = true;
  stopDevelopmentShutdownControl();
  globalShortcut.unregisterAll();
  screen.removeListener("display-added", syncOverlayToDisplays);
  screen.removeListener("display-removed", syncOverlayToDisplays);
  screen.removeListener("display-metrics-changed", syncOverlayToDisplays);
  overlaySettingsReady = false;
  displaySyncPending = false;
  if (backendRestartTimer) clearTimeout(backendRestartTimer);
  backendRestartTimer = null;
}

async function stopApplicationResources(): Promise<void> {
  const trace = contentTraceHandle;
  contentTraceHandle = null;
  await trace?.stop("application_shutdown").catch((error: unknown) =>
    console.error("Failed to stop Electron content trace", error)
  );
  await backendClient.stop().catch((error: unknown) =>
    console.error("Failed to stop the backend client", error)
  );
  await backendProcess?.dispose().catch((error: unknown) =>
    console.error("Failed to dispose the backend process", error)
  );
}

function syncOverlayToDisplays(): void {
  if (!overlaySettingsReady) {
    displaySyncPending = true;
    return;
  }

  void reconcileOverlayTarget()
    .then((settings) => broadcastOverlaySettings(() => controlWindow, settings))
    .catch((error: unknown) => console.error("Failed to sync overlay display settings", error));
}

async function initializeApplication(): Promise<void> {
  logger.info("app.initialize.started");
  screen.on("display-added", syncOverlayToDisplays);
  screen.on("display-removed", syncOverlayToDisplays);
  screen.on("display-metrics-changed", syncOverlayToDisplays);

  await initializeOverlaySettings();
  overlaySettingsReady = true;
  await reconcileOverlayTarget();

  configureMediaAccess(() => controlWindow);
  const recoverableRuntimeSessionId = await loadRuntimeSessionId(app.getPath("userData"));
  if (recoverableRuntimeSessionId) {
    backendClient.restoreRecoverableRuntimeSession(recoverableRuntimeSessionId);
  }
  backendProcess = createBackendProcessController();
  backendProcess.onUnexpectedExit((exit) => {
    logger.warn("backend.process.unexpected-exit", exit);
    void backendClient.stop().finally(() => scheduleBackendRecovery(exit));
  });
  registerDesktopIpc(
    () => controlWindow,
    confirmControlWindowClose,
    backendClient,
    () => initializeBackend(true)
  );
  controlWindow = openControlWindow();
  const trayIcon = await app.getFileIcon(process.execPath, { size: "small" });
  if (trayIcon.isEmpty()) throw new Error("Windows system tray icon is empty.");
  applicationTray = createApplicationTray({
    icon: trayIcon,
    showControlWindow,
    quitApplication: () => app.quit()
  });
  setTraySmokeHandle({
    ...applicationTray,
    quitMenuItemId: TRAY_MENU_ITEM_IDS.quit
  });
  broadcastOverlaySettings(() => controlWindow, getOverlaySettings());
  void initializeBackend().catch((error: unknown) =>
    console.error("Failed to initialize backend", error)
  );

  if (displaySyncPending) {
    displaySyncPending = false;
    syncOverlayToDisplays();
  }

  const emergencyShortcutRegistered = globalShortcut.register("CommandOrControl+Shift+X", () => {
    logger.warn("action.emergency-stop");
    hideBarrageOutputs();
    controlWindow?.webContents.send("session:emergency-stop");
    controlWindow?.show();
    controlWindow?.focus();
  });
  if (!emergencyShortcutRegistered) {
    console.error("Failed to register the Overlay emergency shortcut");
  }
  logger.info("app.initialize.completed");
  void startOptionalContentTrace();

  app.on("activate", () => {
    if (quitRequested || appShutdownPromise) return;
    if (BrowserWindow.getAllWindows().length === 0) {
      controlWindow = openControlWindow();
      broadcastOverlaySettings(() => controlWindow, getOverlaySettings());
    }
    showControlWindow();
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  quitRequested = true;
  app.quit();
} else {
  initializeLogging();
  app.on("second-instance", () => {
    logger.info("app.second-instance.focus-requested");
    showControlWindow();
  });
  void app
    .whenReady()
    .then(async () => {
      restoreMacApplicationActivation();
      try {
        await startDevelopmentShutdownControl();
      } catch (error) {
        logger.warn("app.shutdown.control-unavailable", { error });
      }
      await initializeApplication();
    })
    .catch((error: unknown) => {
      console.error("Failed to initialize ADVX Live", error);
      app.quit();
    });
}

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", (event) => {
  quitRequested = true;
  if (appShutdownComplete) return;
  event.preventDefault();
  if (appShutdownPromise) return;
  if (controlWindow && !controlWindow.isDestroyed() && !allowControlWindowClose) {
    controlWindow.close();
    return;
  }

  prepareApplicationShutdown();
  appShutdownPromise = stopApplicationResources().finally(() => {
    if (hasSingleInstanceLock) logger.info("app.shutdown.completed");
    appShutdownComplete = true;
    allowControlWindowClose = true;
    if (controlWindow && !controlWindow.isDestroyed()) controlWindow.destroy();
    applicationTray?.tray.destroy();
    applicationTray = null;
    setTraySmokeHandle(null);
    app.quit();
  });
});

function parseBoundedDuration(value: string | undefined): number {
  const duration = value === undefined ? 10_000 : Number(value);
  return Number.isSafeInteger(duration) && duration >= 100 && duration <= 5 * 60 * 1000
    ? duration
    : 10_000;
}

async function startOptionalContentTrace(): Promise<void> {
  if (process.env.ADVX_ELECTRON_CONTENT_TRACE !== "1") return;
  const traceDirectory = process.env.ADVX_CONTENT_TRACE_DIR ??
    join(app.getPath("userData"), "diagnostics", "content-traces");
  try {
    contentTraceHandle = await startContentTrace({
      outputDirectory: resolve(traceDirectory),
      durationMs: parseBoundedDuration(process.env.ADVX_CONTENT_TRACE_DURATION_MS),
      traceName: process.env.ADVX_CONTENT_TRACE_NAME
    });
    logger.info("observability.content-trace.started", {
      outputDirectory: traceDirectory,
      durationMs: parseBoundedDuration(process.env.ADVX_CONTENT_TRACE_DURATION_MS)
    });
  } catch (error) {
    logger.warn("observability.content-trace.unavailable", { error });
  }
}
