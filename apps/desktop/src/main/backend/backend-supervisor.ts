import type { ChildProcessWithoutNullStreams } from "node:child_process";

/**
 * Runtime-neutral metadata owned by Electron Main. The token is never sent to
 * preload/renderer and is intentionally absent from supervisor log payloads.
 */
export type BackendProcessIdentitySpec = Readonly<{
  version: string;
  port: number;
  token: string;
  dataDirectory: string;
  logLocation: string;
}>;

export type BackendProcessIdentity = BackendProcessIdentitySpec &
  Readonly<{
    id: string;
    pid: number | null;
  }>;

export type BackendProcessExit = Readonly<{
  code: number | null;
  signal: NodeJS.Signals | null;
  pid: number | null;
  instanceId: string;
  exitedAtMs: number;
  expected: boolean;
}>;

export type BackendSupervisorState =
  | "idle"
  | "prepared"
  | "starting"
  | "ready"
  | "stopping"
  | "exited"
  | "failed"
  | "disposed";

export type BackendProcessStatus = Readonly<{
  state: BackendSupervisorState;
  ready: boolean;
  identity: BackendProcessIdentity;
  lastExit: BackendProcessExit | null;
  restartCount: number;
  restartBudget: number;
}>;

export interface BackendProcessLogger {
  info(message: string, ...data: unknown[]): void;
  warn(message: string, ...data: unknown[]): void;
  error(message: string, ...data: unknown[]): void;
}

export interface BackendSupervisor {
  readonly process: ChildProcessWithoutNullStreams | null;
  prepare(): Promise<void>;
  start(): Promise<void>;
  waitReady(): Promise<void>;
  status(): BackendProcessStatus;
  restart(): Promise<void>;
  stop(): Promise<void>;
  forceStop(): Promise<void>;
  dispose(): Promise<void>;
  onUnexpectedExit(listener: (exit: BackendProcessExit) => void): () => void;
}
