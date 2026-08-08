import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { SpawnedBackendProcessOptions } from "./backend-process";
import type {
  BackendProcessIdentitySpec,
  BackendProcessLogger
} from "./backend-supervisor";

const SAFE_PARENT_ENVIRONMENT_KEYS = [
  "APPDATA",
  "BUN_INSTALL",
  "COMSPEC",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "PROGRAMDATA",
  "SYSTEMROOT",
  "TEMP",
  "TERM",
  "TMP",
  "TZ",
  "USERPROFILE",
  "WINDIR"
] as const;

export type BunBackendProcessAdapterInput = Readonly<{
  repositoryRoot: string;
  backendBaseUrl: string;
  backendPort: string;
  dataDirectory: string;
  startupToken: string;
  expectedBackendVersion?: string;
  identity: BackendProcessIdentitySpec;
  logger?: BackendProcessLogger;
  bunExecutable?: string;
  parentEnvironment?: NodeJS.ProcessEnv;
}>;

/** Resolve Bun without allowing a shell or a parent-provided command alias. */
export function resolveBunExecutable(
  repositoryRoot: string,
  explicitPath?: string
): string {
  const candidate = explicitPath ?? process.env.ADVX_BUN_EXECUTABLE;
  if (candidate !== undefined && candidate.length > 0) {
    const resolvedPath = isAbsolute(candidate)
      ? candidate
      : resolve(repositoryRoot, candidate);
    if (!existsSync(resolvedPath)) {
      throw new Error(`Bun 可执行文件不存在：${resolvedPath}`);
    }
    return resolvedPath;
  }

  const resolver = process.platform === "win32" ? "where.exe" : "which";
  let output: string;
  try {
    output = execFileSync(resolver, ["bun"], {
      encoding: "utf8",
      windowsHide: true
    });
  } catch {
    throw new Error("无法解析 Bun 可执行文件，请设置 ADVX_BUN_EXECUTABLE。");
  }
  const resolvedPath = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (resolvedPath === undefined || !existsSync(resolvedPath)) {
    throw new Error("无法解析 Bun 可执行文件，请设置 ADVX_BUN_EXECUTABLE。");
  }
  return resolve(resolvedPath);
}

export function createBunDevelopmentEnvironment(
  input: Pick<
    BunBackendProcessAdapterInput,
    "backendPort" | "dataDirectory" | "parentEnvironment"
  > & { includeBunInstall?: boolean }
): NodeJS.ProcessEnv {
  const parentEnvironment = input.parentEnvironment ?? process.env;
  const environment: NodeJS.ProcessEnv = {};
  for (const key of SAFE_PARENT_ENVIRONMENT_KEYS) {
    if (key === "BUN_INSTALL" && input.includeBunInstall === false) continue;
    const value = parentEnvironment[key];
    if (value !== undefined) environment[key] = value;
  }

  // The token travels once over the child stdin pipe. Never copy ambient
  // ADVX_LOCAL_TOKEN or Provider credentials into the child environment.
  environment.ADVX_BACKEND_MODE = "development";
  environment.ADVX_BACKEND_HOST = "127.0.0.1";
  environment.ADVX_BACKEND_PORT = input.backendPort;
  environment.ADVX_DATA_DIR = input.dataDirectory;
  environment.ADVX_STARTUP_TOKEN_FD = "0";
  if (parentEnvironment.ADVX_RECORDED_PIPELINE === "1" || parentEnvironment.ADVX_RECORDED_PIPELINE === "true") {
    environment.ADVX_RECORDED_PIPELINE = "1";
  }
  return environment;
}

export function createBunBackendProcessOptions(
  input: BunBackendProcessAdapterInput
): SpawnedBackendProcessOptions {
  return {
    command: resolveBunExecutable(input.repositoryRoot, input.bunExecutable),
    args: ["run", "--no-env-file", "apps/backend-bun/src/main.ts"],
    cwd: input.repositoryRoot,
    env: createBunDevelopmentEnvironment(input),
    baseUrl: input.backendBaseUrl,
    healthToken: input.startupToken,
    compatibility: { backendVersion: input.expectedBackendVersion },
    startupToken: input.startupToken,
    ipcShutdown: true,
    windowsHide: true,
    identity: input.identity,
    logger: input.logger
  };
}
