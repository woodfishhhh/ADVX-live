import { lstat, mkdir, writeFile } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'

import { canonicalJson } from '@advx/contracts'

type BunSpawnOptions = Parameters<typeof Bun.spawn>[1]

export const BUN_PROFILE_SCHEMA_VERSION = 1 as const
export const BUN_PROFILE_MIN_DURATION_MS = 100
export const BUN_PROFILE_MAX_DURATION_MS = 5 * 60 * 1000
export const BUN_PROFILE_STOP_GRACE_MS = 2_000

export type BunProfileKind = 'cpu' | 'heap'

export type BunProfileInvocation = Readonly<{
  kind: BunProfileKind
  outputDirectory: string
  profilePath: string
  metadataPath: string
  durationMs: number
  command: readonly string[]
  args: readonly string[]
}>

export type BunProfileRunOptions = Readonly<{
  kind: BunProfileKind
  outputDirectory: string
  durationMs: number
  command: readonly string[]
  profileName?: string
  cwd?: string
  env?: Readonly<Record<string, string>>
  bunExecutable?: string
  now?: () => Date
  spawn?: (args: string[], options: BunSpawnOptions) => Bun.Subprocess
}>

export type BunProfileResult = Readonly<{
  schema_version: typeof BUN_PROFILE_SCHEMA_VERSION
  kind: BunProfileKind
  profile_path: string
  metadata_path: string
  started_at: string
  finished_at: string
  duration_ms: number
  requested_duration_ms: number
  command: readonly string[]
  exit_code: number
  timed_out: boolean
  forced: boolean
}>

export class BunProfileError extends Error {
  readonly name = 'BunProfileError'

  constructor(readonly code: BunProfileErrorCode, message: string) {
    super(message)
  }
}

export type BunProfileErrorCode =
  | 'invalid_request'
  | 'invalid_output_path'
  | 'invalid_profile_name'
  | 'profile_failed'

export function createBunProfileInvocation(
  options: Pick<BunProfileRunOptions, 'kind' | 'outputDirectory' | 'durationMs' | 'command' | 'profileName'>
): BunProfileInvocation {
  const kind = validateKind(options.kind)
  const outputDirectory = validateOutputDirectory(options.outputDirectory)
  const durationMs = boundedDuration(options.durationMs)
  const command = validateCommand(options.command)
  const baseName = validateProfileName(options.profileName ?? `advx-${kind}-${Date.now()}`)
  const extension = kind === 'cpu' ? '.cpuprofile' : '.heapsnapshot'
  const profilePath = join(outputDirectory, `${baseName}${extension}`)
  const metadataPath = join(outputDirectory, `${baseName}.metadata.json`)
  const profilerArgs = kind === 'cpu'
    ? [`--cpu-prof`, `--cpu-prof-dir=${outputDirectory}`, `--cpu-prof-name=${basename(profilePath)}`]
    : [`--preload=${join(import.meta.dir, '../../profiling/heap-snapshot-preload.ts')}`]
  return Object.freeze({
    kind,
    outputDirectory,
    profilePath,
    metadataPath,
    durationMs,
    command: Object.freeze([...command]),
    args: Object.freeze([...profilerArgs, ...command])
  })
}

export async function runBunProfile(options: BunProfileRunOptions): Promise<BunProfileResult> {
  const invocation = createBunProfileInvocation(options)
  const now = options.now ?? (() => new Date())
  const startedAt = now()
  if (Number.isNaN(startedAt.valueOf())) throw new BunProfileError('invalid_request', 'profile clock returned an invalid date')
  await mkdir(invocation.outputDirectory, { recursive: true })
  const spawn = options.spawn ?? ((args, spawnOptions) => Bun.spawn(args, spawnOptions))
  const child = spawn([options.bunExecutable ?? process.execPath, ...invocation.args], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...options.env,
      ...(invocation.kind === 'heap' ? { ADVX_HEAP_PROFILE_PATH: invocation.profilePath } : {})
    },
    stdout: 'inherit',
    stderr: 'inherit'
  })
  let timedOut = false
  let forced = false
  const timer = setTimeout(() => {
    timedOut = true
    child.kill('SIGTERM')
    setTimeout(() => {
      if (child.exitCode === null) {
        forced = true
        child.kill('SIGKILL')
      }
    }, BUN_PROFILE_STOP_GRACE_MS)
  }, invocation.durationMs)
  const exitCode = await child.exited
  clearTimeout(timer)
  const finishedAt = now()
  if (exitCode !== 0 && !timedOut) {
    throw new BunProfileError('profile_failed', `profiled command exited with code ${exitCode}`)
  }
  try {
    if (!(await lstat(invocation.profilePath)).isFile()) throw new Error('profile path is not a file')
  } catch {
    throw new BunProfileError('profile_failed', `profile artifact was not produced: ${invocation.profilePath}`)
  }
  const result: BunProfileResult = Object.freeze({
    schema_version: BUN_PROFILE_SCHEMA_VERSION,
    kind: invocation.kind,
    profile_path: invocation.profilePath,
    metadata_path: invocation.metadataPath,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: Math.max(0, finishedAt.valueOf() - startedAt.valueOf()),
    requested_duration_ms: invocation.durationMs,
    command: invocation.command,
    exit_code: exitCode,
    timed_out: timedOut,
    forced
  })
  await writeFile(invocation.metadataPath, `${canonicalJson(result)}\n`, 'utf8')
  return result
}

function validateKind(value: unknown): BunProfileKind {
  if (value !== 'cpu' && value !== 'heap') throw new BunProfileError('invalid_request', 'profile kind must be cpu or heap')
  return value
}

function validateOutputDirectory(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value) || value.length > 4096) {
    throw new BunProfileError('invalid_output_path', 'profile output directory must be an absolute path')
  }
  return resolve(value)
}

function boundedDuration(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < BUN_PROFILE_MIN_DURATION_MS || Number(value) > BUN_PROFILE_MAX_DURATION_MS) {
    throw new BunProfileError('invalid_request', 'profile duration is out of bounds')
  }
  return Number(value)
}

function validateCommand(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((part) => typeof part !== 'string' || part.length === 0 || part.length > 4096)) {
    throw new BunProfileError('invalid_request', 'profile command is required and bounded')
  }
  return value
}

function validateProfileName(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value)) {
    throw new BunProfileError('invalid_profile_name', 'profile name must be a safe basename')
  }
  return value
}
