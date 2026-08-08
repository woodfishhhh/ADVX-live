import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'

import {
  replayRequestSchema,
  type ReplayRequest,
} from '@advx/contracts'
import { ReplayService } from '../application/services/replay-service'

export const HEADLESS_EXIT_CODES = Object.freeze({
  ok: 0,
  invalidInput: 2,
  deadlineExceeded: 3,
  executionFailed: 4,
  cleanupFailed: 5
} as const)

export type HeadlessExitCode =
  (typeof HEADLESS_EXIT_CODES)[keyof typeof HEADLESS_EXIT_CODES]

export type HeadlessCommand = 'replay' | 'scenario'
export type HeadlessProviderMode = 'recorded' | 'fake' | 'live'
export type HeadlessResourceKind =
  | 'backend'
  | 'socket'
  | 'task'
  | 'database'
  | 'capture_producer'

export type HeadlessInput = Readonly<{
  command: HeadlessCommand
  fixture?: string
  provider_mode?: HeadlessProviderMode
  seed?: number
  virtual_clock_start_ms?: number
  deadline_ms?: number
  artifact_root?: string
  request?: unknown
}>

export type HeadlessResource = Readonly<{
  kind: HeadlessResourceKind
  label: string
  cleanup: () => void | Promise<void>
}>

export type HeadlessCleanupReport = Readonly<{
  attempted: boolean
  failures: readonly string[]
  remaining: Readonly<Record<HeadlessResourceKind, number>>
}>

export type HeadlessVirtualClock = Readonly<{
  readonly current_ms: number
  now(): number
  advanceTo(timestampMs: number): void
}>

export type HeadlessRunContext = Readonly<{
  run_id: string
  command: HeadlessCommand
  fixture: string | null
  provider_mode: HeadlessProviderMode
  seed: number
  clock: HeadlessVirtualClock
  random(): number
  signal: AbortSignal
  data_directory: string
  diagnostics_artifact_root: string
  request: ReplayRequest | null
  register(resource: HeadlessResource): void
  writeArtifact(name: string, value: unknown): Promise<string>
}>

export type HeadlessRunnerResult = Readonly<{
  result: unknown
  digest?: string
}>

export type HeadlessRunner = (
  context: HeadlessRunContext
) => HeadlessRunnerResult | Promise<HeadlessRunnerResult>

export type HeadlessResultEnvelope = Readonly<{
  schema_version: 1
  ok: boolean
  exit_code: HeadlessExitCode
  result?: unknown
  error?: Readonly<{ code: string; detail?: string }>
  metadata: Readonly<{
    run_id: string
    command: HeadlessCommand | null
    fixture: string | null
    provider_mode: HeadlessProviderMode | null
    seed: number | null
    virtual_clock_start_ms: number | null
    deadline_ms: number | null
    data_directory: string
    isolated_data_directory: true
    diagnostics_artifact_root: string
    forced_cleanup: boolean
    timed_out: boolean
    temporary_directory_cleaned: boolean
    cleanup: HeadlessCleanupReport
    proof_scope: 'typescript-headless-fixture' | 'typescript-recorded-replay'
  }>
}>

type NormalizedInput = Readonly<{
  command: HeadlessCommand
  fixture: string | null
  providerMode: HeadlessProviderMode
  seed: number
  virtualClockStartMs: number
  deadlineMs: number
  artifactRoot: string | null
  request: ReplayRequest | null
}>

const DEFAULT_DEADLINE_MS = 30_000
const MAX_DEADLINE_MS = 120_000
const CLEANUP_GRACE_MS = 100
const RESOURCE_KINDS: readonly HeadlessResourceKind[] = [
  'backend',
  'socket',
  'task',
  'database',
  'capture_producer'
]

export class HeadlessInputError extends Error {
  readonly name = 'HeadlessInputError'

  constructor(readonly code: 'invalid_input' | 'live_provider_unavailable') {
    super(code)
  }
}

export class HeadlessResourceTracker {
  readonly #resources = new Map<string, HeadlessResource>()

  register(resource: HeadlessResource): void {
    if (!RESOURCE_KINDS.includes(resource.kind)) {
      throw new TypeError(`unsupported headless resource kind: ${resource.kind}`)
    }
    if (resource.label.length < 1 || resource.label.length > 128) {
      throw new RangeError('headless resource labels must contain 1 to 128 characters')
    }
    const key = `${resource.kind}:${resource.label}`
    if (this.#resources.has(key)) throw new Error(`duplicate headless resource: ${key}`)
    this.#resources.set(key, resource)
  }

  async cleanup(): Promise<HeadlessCleanupReport> {
    const failures: string[] = []
    const resources = [...this.#resources.entries()].reverse()
    for (const [key, resource] of resources) {
      try {
        await resource.cleanup()
        this.#resources.delete(key)
      } catch (error) {
        failures.push(`${key}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return Object.freeze({
      attempted: true,
      failures: Object.freeze(failures),
      remaining: this.counts()
    })
  }

  counts(): Readonly<Record<HeadlessResourceKind, number>> {
    const counts: Record<HeadlessResourceKind, number> = {
      backend: 0,
      socket: 0,
      task: 0,
      database: 0,
      capture_producer: 0
    }
    for (const resource of this.#resources.values()) counts[resource.kind] += 1
    return Object.freeze(counts)
  }
}

export class HeadlessVirtualClockImpl implements HeadlessVirtualClock {
  #currentMs: number

  constructor(startMs: number) {
    if (!Number.isSafeInteger(startMs) || startMs < 0) {
      throw new RangeError('virtual clock start must be a non-negative safe integer')
    }
    this.#currentMs = startMs
  }

  get current_ms(): number {
    return this.#currentMs
  }

  now(): number {
    return this.#currentMs
  }

  advanceTo(timestampMs: number): void {
    if (!Number.isSafeInteger(timestampMs) || timestampMs < this.#currentMs) {
      throw new RangeError('virtual clock cannot move backwards')
    }
    this.#currentMs = timestampMs
  }
}

export type HeadlessHarnessOptions = Readonly<{
  runner?: HeadlessRunner
  tempRoot?: string
  now?: () => number
  cleanupGraceMs?: number
}>

export class HeadlessHarness {
  readonly #runner: HeadlessRunner
  readonly #tempRoot: string | undefined
  readonly #now: () => number
  readonly #cleanupGraceMs: number

  constructor(options: HeadlessHarnessOptions = {}) {
    this.#runner = options.runner ?? defaultHeadlessRunner
    this.#tempRoot = options.tempRoot
    this.#now = options.now ?? Date.now
    this.#cleanupGraceMs = options.cleanupGraceMs ?? CLEANUP_GRACE_MS
    if (!Number.isSafeInteger(this.#cleanupGraceMs) || this.#cleanupGraceMs < 1 || this.#cleanupGraceMs > 5_000) {
      throw new RangeError('headless cleanup grace must be between 1 and 5000 ms')
    }
  }

  async execute(input: unknown): Promise<HeadlessResultEnvelope> {
    let normalized: NormalizedInput
    try {
      normalized = normalizeInput(input)
    } catch (error) {
      const code = error instanceof HeadlessInputError ? error.code : 'invalid_input'
      return invalidEnvelope(code, error instanceof Error ? error.message : String(error))
    }

    const runId = randomUUID()
    const dataDirectory = await mkdtemp(join(this.#tempRoot ?? tmpdir(), 'advx-bun-headless-'))
    const diagnosticsRoot = normalized.artifactRoot ??
      await mkdtemp(join(tmpdir(), `advx-bun-headless-artifacts-${runId.slice(0, 8)}-`))
    await mkdir(diagnosticsRoot, { recursive: true })
    const clock = new HeadlessVirtualClockImpl(normalized.virtualClockStartMs)
    const random = seededRandom(normalized.seed)
    const controller = new AbortController()
    const tracker = new HeadlessResourceTracker()
    let timedOut = false
    let forcedCleanup = false
    let result: unknown
    let failure: { code: string; detail?: string } | undefined
    let exitCode: HeadlessExitCode = HEADLESS_EXIT_CODES.ok

    const context: HeadlessRunContext = {
      run_id: runId,
      command: normalized.command,
      fixture: normalized.fixture,
      provider_mode: normalized.providerMode,
      seed: normalized.seed,
      clock,
      random,
      signal: controller.signal,
      data_directory: dataDirectory,
      diagnostics_artifact_root: diagnosticsRoot,
      request: normalized.request,
      register: (resource) => tracker.register(resource),
      writeArtifact: async (name, value) => writeHeadlessArtifact(diagnosticsRoot, name, value)
    }

    const runPromise = Promise.resolve().then(() => this.#runner(context))
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    try {
      const timeoutPromise = new Promise<'timeout'>((resolveTimeout) => {
        timeoutHandle = setTimeout(() => resolveTimeout('timeout'), normalized.deadlineMs)
      })
      const outcome = await Promise.race([
        runPromise.then((value) => ({ kind: 'result' as const, value })),
        timeoutPromise.then((value) => ({ kind: value }))
      ])
      if (outcome.kind === 'timeout') {
        timedOut = true
        forcedCleanup = true
        exitCode = HEADLESS_EXIT_CODES.deadlineExceeded
        failure = { code: 'deadline_exceeded', detail: `headless run exceeded ${normalized.deadlineMs}ms` }
        controller.abort()
        await Promise.race([runPromise.catch(() => undefined), delay(this.#cleanupGraceMs)])
      } else {
        result = outcome.value.result
        if (outcome.value.digest !== undefined) {
          result = { ...(isRecord(result) ? result : { value: result }), replay_digest: outcome.value.digest }
        }
      }
    } catch (error) {
      exitCode = error instanceof HeadlessInputError
        ? HEADLESS_EXIT_CODES.invalidInput
        : HEADLESS_EXIT_CODES.executionFailed
      failure = {
        code: error instanceof HeadlessInputError ? error.code : 'execution_failed',
        detail: error instanceof Error ? error.message : String(error)
      }
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
    }

    const cleanup = await tracker.cleanup()
    if (cleanup.failures.length > 0 || Object.values(cleanup.remaining).some((count) => count > 0)) {
      exitCode = HEADLESS_EXIT_CODES.cleanupFailed
      failure = { code: 'cleanup_failed', detail: cleanup.failures.join('; ') || 'headless resources remained active' }
    }
    const temporaryDirectoryCleaned = await removeDirectory(dataDirectory)
    const metadata = {
      run_id: runId,
      command: normalized.command,
      fixture: normalized.fixture,
      provider_mode: normalized.providerMode,
      seed: normalized.seed,
      virtual_clock_start_ms: normalized.virtualClockStartMs,
      deadline_ms: normalized.deadlineMs,
      data_directory: dataDirectory,
      isolated_data_directory: true as const,
      diagnostics_artifact_root: diagnosticsRoot,
      forced_cleanup: forcedCleanup,
      timed_out: timedOut,
      temporary_directory_cleaned: temporaryDirectoryCleaned,
      cleanup,
      proof_scope: normalized.request === null
        ? 'typescript-headless-fixture' as const
        : 'typescript-recorded-replay' as const
    }
    const envelope: HeadlessResultEnvelope = {
      schema_version: 1,
      ok: exitCode === HEADLESS_EXIT_CODES.ok,
      exit_code: exitCode,
      ...(result === undefined ? {} : { result }),
      ...(failure === undefined ? {} : { error: Object.freeze(failure) }),
      metadata: Object.freeze(metadata)
    }
    await writeHeadlessArtifact(diagnosticsRoot, 'result.json', envelope)
    await writeHeadlessArtifact(diagnosticsRoot, 'lifecycle.json', {
      schema_version: 1,
      run_id: runId,
      started_at_ms: this.#now(),
      timed_out: timedOut,
      forced_cleanup: forcedCleanup,
      cleanup,
      temporary_directory_cleaned: temporaryDirectoryCleaned
    })
    return Object.freeze(envelope)
  }
}

export function parseHeadlessInput(input: unknown): HeadlessInput {
  const normalized = normalizeInput(input)
  return {
    command: normalized.command,
    ...(normalized.fixture === null ? {} : { fixture: normalized.fixture }),
    provider_mode: normalized.providerMode,
    seed: normalized.seed,
    virtual_clock_start_ms: normalized.virtualClockStartMs,
    deadline_ms: normalized.deadlineMs,
    ...(normalized.artifactRoot === null ? {} : { artifact_root: normalized.artifactRoot }),
    ...(normalized.request === null ? {} : { request: normalized.request })
  }
}

function normalizeInput(input: unknown): NormalizedInput {
  if (!isRecord(input)) throw new HeadlessInputError('invalid_input')
  const command = input.command
  if (command !== 'replay' && command !== 'scenario') {
    throw new HeadlessInputError('invalid_input')
  }
  const fixture = optionalString(input.fixture, 'fixture', 2_048)
  const providerMode = input.provider_mode === undefined ? 'recorded' : input.provider_mode
  if (providerMode !== 'recorded' && providerMode !== 'fake' && providerMode !== 'live') {
    throw new HeadlessInputError('invalid_input')
  }
  if (providerMode === 'live') throw new HeadlessInputError('live_provider_unavailable')
  const seed = integerValue(input.seed, 0, Number.MAX_SAFE_INTEGER, 0)
  const virtualClockStartMs = integerValue(input.virtual_clock_start_ms, 0, Number.MAX_SAFE_INTEGER, 0)
  const deadlineMs = integerValue(input.deadline_ms, 1, MAX_DEADLINE_MS, DEFAULT_DEADLINE_MS)
  const artifactRoot = optionalString(input.artifact_root, 'artifact_root', 4_096)
  if (artifactRoot !== null && !isAbsolute(resolve(artifactRoot))) {
    throw new HeadlessInputError('invalid_input')
  }
  let request: ReplayRequest | null = null
  if (command === 'replay') {
    try {
      request = replayRequestSchema.parse(input.request)
    } catch (error) {
      throw new HeadlessInputError('invalid_input')
    }
  }
  return {
    command,
    fixture,
    providerMode,
    seed,
    virtualClockStartMs,
    deadlineMs,
    artifactRoot: artifactRoot === null ? null : resolve(artifactRoot),
    request
  }
}

async function defaultHeadlessRunner(context: HeadlessRunContext): Promise<HeadlessRunnerResult> {
  if (context.request === null) {
    const result = {
      command: context.command,
      fixture: context.fixture,
      provider_mode: context.provider_mode,
      seed: context.seed,
      virtual_clock_start_ms: context.clock.current_ms,
      event_count: 0,
      deterministic_proof: true,
      external_transport_call_count: 0
    }
    return { result, digest: digest(result) }
  }
  const result = await new ReplayService({
    recordedDataDirectory: context.data_directory
  }).replay(context.request)
  await context.writeArtifact('recorded-replay.json', result)
  return { result, digest: result.replay_digest ?? digest(result) }
}

function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function digest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex')
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  const record = value as Record<string, unknown>
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
}

function invalidEnvelope(code: string, detail: string): HeadlessResultEnvelope {
  return Object.freeze({
    schema_version: 1,
    ok: false,
    exit_code: HEADLESS_EXIT_CODES.invalidInput,
    error: { code, detail },
    metadata: Object.freeze({
      run_id: 'not-started',
      command: null,
      fixture: null,
      provider_mode: null,
      seed: null,
      virtual_clock_start_ms: null,
      deadline_ms: null,
      data_directory: '',
      isolated_data_directory: true,
      diagnostics_artifact_root: '',
      forced_cleanup: false,
      timed_out: false,
      temporary_directory_cleaned: true,
      cleanup: {
        attempted: false,
        failures: Object.freeze([]),
        remaining: {
          backend: 0,
          socket: 0,
          task: 0,
          database: 0,
          capture_producer: 0
        }
      },
      proof_scope: 'typescript-headless-fixture'
    })
  })
}

function optionalString(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength) {
    throw new HeadlessInputError('invalid_input')
  }
  return value
}

function integerValue(value: unknown, minimum: number, maximum: number, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new HeadlessInputError('invalid_input')
  }
  return Number(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function writeHeadlessArtifact(root: string, name: string, value: unknown): Promise<string> {
  if (!/^[A-Za-z0-9._-]+\.json$/.test(name)) throw new Error('headless artifact name is invalid')
  const path = join(root, name)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  return path
}

async function removeDirectory(path: string): Promise<boolean> {
  await rm(path, { recursive: true, force: true })
  try {
    await access(path)
    return false
  } catch {
    return true
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds))
}
