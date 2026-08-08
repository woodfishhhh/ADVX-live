import { closeSync, existsSync, openSync, readSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { SpawnedBackendProcessOptions } from "./backend-process";
import {
  createBunDevelopmentEnvironment,
  type BunBackendProcessAdapterInput
} from "./backend-process-bun";

const COMPILED_BACKEND_FILENAME =
  process.platform === "win32" ? "advx-backend-bun.exe" : "advx-backend-bun";
const PE_SIGNATURE = 0x00004550;
const PE_MACHINE_X86 = 0x014c;
const PE_MACHINE_X64 = 0x8664;
const PE_MACHINE_ARM64 = 0xaa64;

export type BunCompiledBackendProcessAdapterInput = Readonly<
  BunBackendProcessAdapterInput & {
    packaged: boolean;
    resourcesPath: string;
    backendExecutable?: string;
    workingDirectory?: string;
    requireCodeSignature?: boolean;
    signatureVerifier?: (executablePath: string) => boolean;
  }
>;

export function resolveCompiledBunExecutable(
  input: Pick<
    BunCompiledBackendProcessAdapterInput,
    | "packaged"
    | "resourcesPath"
    | "repositoryRoot"
    | "backendExecutable"
    | "requireCodeSignature"
    | "signatureVerifier"
  >
): string {
  const fallback = input.packaged
    ? join(input.resourcesPath, "backend", COMPILED_BACKEND_FILENAME)
    : join(input.repositoryRoot, "apps", "backend-bun", "dist", COMPILED_BACKEND_FILENAME);
  const candidate = input.backendExecutable ?? fallback;
  const executablePath = isAbsolute(candidate)
    ? candidate
    : resolve(input.packaged ? input.resourcesPath : input.repositoryRoot, candidate);

  if (!existsSync(executablePath)) {
    throw new Error(`compiled_backend_missing: ${executablePath}`);
  }
  if (!statSync(executablePath).isFile()) {
    throw new Error(`compiled_backend_not_file: ${executablePath}`);
  }
  if (process.platform !== "win32" && (statSync(executablePath).mode & 0o111) === 0) {
    throw new Error(`compiled_backend_not_executable: ${executablePath}`);
  }
  if (process.platform === "win32") {
    if (existsSync(`${executablePath}:Zone.Identifier`)) {
      throw new Error(`compiled_backend_quarantined: ${executablePath}`);
    }
    assertWindowsArchitecture(executablePath);
  }
  if (input.requireCodeSignature) {
    if (input.signatureVerifier === undefined || !input.signatureVerifier(executablePath)) {
      throw new Error(`compiled_backend_unsigned: ${executablePath}`);
    }
  }
  return executablePath;
}

export function createBunCompiledBackendProcessOptions(
  input: BunCompiledBackendProcessAdapterInput
): SpawnedBackendProcessOptions {
  const executablePath = resolveCompiledBunExecutable(input);
  const workingDirectory = input.workingDirectory ??
    (input.packaged ? input.resourcesPath : input.repositoryRoot);
  return {
    command: executablePath,
    args: [],
    cwd: workingDirectory,
    env: createBunDevelopmentEnvironment({
      backendPort: input.backendPort,
      dataDirectory: input.dataDirectory,
      parentEnvironment: input.parentEnvironment,
      includeBunInstall: false
    }),
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

function assertWindowsArchitecture(executablePath: string): void {
  const machine = readWindowsPeMachine(executablePath);
  const expected =
    process.arch === "x64"
      ? PE_MACHINE_X64
      : process.arch === "arm64"
        ? PE_MACHINE_ARM64
        : PE_MACHINE_X86;
  if (machine !== expected) {
    throw new Error(
      `compiled_backend_wrong_architecture: expected ${machineName(expected)}, got ${machineName(machine)}`
    );
  }
}

function readWindowsPeMachine(executablePath: string): number {
  const descriptor = openSync(executablePath, "r");
  try {
    const initial = Buffer.alloc(4096);
    const initialBytes = readSync(descriptor, initial, 0, initial.byteLength, 0);
    if (initialBytes < 64 || initial.subarray(0, 2).toString("ascii") !== "MZ") {
      throw new Error(`compiled_backend_invalid_format: ${executablePath}`);
    }
    const peOffset = initial.readUInt32LE(0x3c);
    const requiredBytes = peOffset + 6;
    if (requiredBytes <= initialBytes) {
      return readMachine(initial, peOffset, executablePath);
    }

    const header = Buffer.alloc(requiredBytes);
    const bytesRead = readSync(descriptor, header, 0, header.byteLength, 0);
    if (bytesRead < requiredBytes) {
      throw new Error(`compiled_backend_invalid_format: ${executablePath}`);
    }
    return readMachine(header, peOffset, executablePath);
  } finally {
    closeSync(descriptor);
  }
}

function readMachine(header: Buffer, peOffset: number, executablePath: string): number {
  if (header.readUInt32LE(peOffset) !== PE_SIGNATURE) {
    throw new Error(`compiled_backend_invalid_format: ${executablePath}`);
  }
  return header.readUInt16LE(peOffset + 4);
}

function machineName(machine: number): string {
  if (machine === PE_MACHINE_X86) return "x86";
  if (machine === PE_MACHINE_X64) return "x64";
  if (machine === PE_MACHINE_ARM64) return "arm64";
  return `0x${machine.toString(16)}`;
}
