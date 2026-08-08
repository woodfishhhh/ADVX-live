import { mkdir, writeFile } from 'node:fs/promises'
import { isAbsolute, dirname, resolve } from 'node:path'

import { canonicalJson } from '@advx/contracts'

export const RUNTIME_PROFILE_SCHEMA_VERSION = 1 as const
export const RUNTIME_PROFILE_MIN_DURATION_MS = 100
export const RUNTIME_PROFILE_MAX_DURATION_MS = 5 * 60 * 1000
export const RUNTIME_PROFILE_MIN_INTERVAL_MS = 50
export const RUNTIME_PROFILE_MAX_INTERVAL_MS = 60 * 1000
export const RUNTIME_PROFILE_MAX_SAMPLES = 6_000

export type RuntimeCpuUsage = Readonly<{ user: number; system: number }>

export type RuntimeMemoryUsage = Readonly<{
  rss: number
  heapTotal: number
  heapUsed: number
  external: number
  arrayBuffers?: number
}>

export type RuntimeProfileSample = Readonly<{
  schema_version: typeof RUNTIME_PROFILE_SCHEMA_VERSION
  timestamp: string
  elapsed_ms: number
  pid: number
  cpu: Readonly<{
    user_us: number
    system_us: number
    utilization_percent: number
  }>
  memory: RuntimeMemoryUsage
  queue_depth?: number
  provider_latency_ms?: number
}>

export type RuntimeProfileOptions = Readonly<{
  outputPath: string
  durationMs: number
  intervalMs?: number
  now?: () => Date
  monotonicNow?: () => number
  sleep?: (milliseconds: number) => Promise<void>
  cpuUsage?: (previous?: RuntimeCpuUsage) => RuntimeCpuUsage
  memoryUsage?: () => RuntimeMemoryUsage
  readQueueDepth?: () => number | undefined
  readProviderLatencyMs?: () => number | undefined
  pid?: number
}>

export type RuntimeProfileResult = Readonly<{
  schema_version: typeof RUNTIME_PROFILE_SCHEMA_VERSION
  output_path: string
  started_at: string
  finished_at: string
  duration_ms: number
  interval_ms: number
  sample_count: number
  samples: readonly RuntimeProfileSample[]
}>

export class RuntimeProfileError extends Error {
  readonly name = 'RuntimeProfileError'

  constructor(readonly code: RuntimeProfileErrorCode, message: string) {
    super(message)
  }
}

export type RuntimeProfileErrorCode =
  | 'invalid_request'
  | 'invalid_output_path'
  | 'sample_limit_exceeded'
  | 'invalid_reading'

export async function collectRuntimeProfile(
  options: RuntimeProfileOptions
): Promise<RuntimeProfileResult> {
  const normalized = normalizeOptions(options)
  const now = normalized.now
  const startedAt = now()
  const startedMonotonic = normalized.monotonicNow()
  const samples: RuntimeProfileSample[] = []
  let previousCpu = normalized.cpuUsage()

  const collect = (): void => {
    if (samples.length >= RUNTIME_PROFILE_MAX_SAMPLES) {
      throw new RuntimeProfileError('sample_limit_exceeded', 'runtime profile sample count is bounded')
    }
    const currentCpu = normalized.cpuUsage(previousCpu)
    const elapsedMs = Math.max(0, normalized.monotonicNow() - startedMonotonic)
    const sample = createRuntimeProfileSample({
      now: now(),
      elapsedMs,
      pid: normalized.pid,
      cpu: {
        user: currentCpu.user - previousCpu.user,
        system: currentCpu.system - previousCpu.system
      },
      intervalMs: normalized.intervalMs,
      memory: normalized.memoryUsage(),
      queueDepth: normalized.readQueueDepth?.(),
      providerLatencyMs: normalized.readProviderLatencyMs?.()
    })
    samples.push(sample)
    previousCpu = currentCpu
  }

  collect()
  while (normalized.monotonicNow() - startedMonotonic < normalized.durationMs) {
    const remaining = normalized.durationMs - (normalized.monotonicNow() - startedMonotonic)
    await normalized.sleep(Math.min(normalized.intervalMs, remaining))
    collect()
  }

  const finishedAt = now()
  const result: RuntimeProfileResult = Object.freeze({
    schema_version: RUNTIME_PROFILE_SCHEMA_VERSION,
    output_path: normalized.outputPath,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    duration_ms: Math.max(0, normalized.monotonicNow() - startedMonotonic),
    interval_ms: normalized.intervalMs,
    sample_count: samples.length,
    samples: Object.freeze(samples)
  })
  await mkdir(dirname(normalized.outputPath), { recursive: true })
  await writeFile(normalized.outputPath, `${canonicalJson(result)}\n`, 'utf8')
  return result
}

export function createRuntimeProfileSample(input: {
  now: Date
  elapsedMs: number
  pid: number
  cpu: RuntimeCpuUsage
  intervalMs: number
  memory: RuntimeMemoryUsage
  queueDepth?: number
  providerLatencyMs?: number
}): RuntimeProfileSample {
  if (!(input.now instanceof Date) || Number.isNaN(input.now.valueOf())) {
    throw new RuntimeProfileError('invalid_reading', 'runtime profile timestamp is invalid')
  }
  const elapsedMs = nonNegativeFinite(input.elapsedMs, 'elapsed time')
  const pid = safePositiveInteger(input.pid, 'pid')
  const user = nonNegativeFinite(input.cpu.user, 'CPU user time')
  const system = nonNegativeFinite(input.cpu.system, 'CPU system time')
  const intervalMs = positiveFinite(input.intervalMs, 'sample interval')
  const memory = normalizeMemory(input.memory)
  const queueDepth = optionalBoundedInteger(input.queueDepth, 'queue depth', 1_000_000)
  const providerLatencyMs = optionalBoundedFinite(input.providerLatencyMs, 'Provider latency', 86_400_000)
  const utilizationPercent = Math.min(100, Math.max(0, ((user + system) / (intervalMs * 1_000)) * 100))
  return Object.freeze({
    schema_version: RUNTIME_PROFILE_SCHEMA_VERSION,
    timestamp: input.now.toISOString(),
    elapsed_ms: elapsedMs,
    pid,
    cpu: Object.freeze({
      user_us: user,
      system_us: system,
      utilization_percent: Number(utilizationPercent.toFixed(3))
    }),
    memory,
    ...(queueDepth === undefined ? {} : { queue_depth: queueDepth }),
    ...(providerLatencyMs === undefined ? {} : { provider_latency_ms: providerLatencyMs })
  })
}

function normalizeOptions(options: RuntimeProfileOptions): Required<RuntimeProfileOptions> {
  if (options === null || typeof options !== 'object') {
    throw new RuntimeProfileError('invalid_request', 'runtime profile options must be an object')
  }
  if (typeof options.outputPath !== 'string' || !isAbsolute(options.outputPath)) {
    throw new RuntimeProfileError('invalid_output_path', 'runtime profile output path must be absolute')
  }
  const durationMs = boundedInteger(options.durationMs, RUNTIME_PROFILE_MIN_DURATION_MS, RUNTIME_PROFILE_MAX_DURATION_MS, 'duration')
  const intervalMs = boundedInteger(options.intervalMs ?? 1_000, RUNTIME_PROFILE_MIN_INTERVAL_MS, RUNTIME_PROFILE_MAX_INTERVAL_MS, 'interval')
  const expectedSamples = Math.ceil(durationMs / intervalMs) + 1
  if (expectedSamples > RUNTIME_PROFILE_MAX_SAMPLES) {
    throw new RuntimeProfileError('sample_limit_exceeded', 'runtime profile sample count would exceed the bound')
  }
  const now = options.now ?? (() => new Date())
  const monotonicNow = options.monotonicNow ?? (() => performance.now())
  const sleep = options.sleep ?? ((milliseconds) => new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds)))
  const cpuUsage = options.cpuUsage ?? (() => {
    const usage = process.cpuUsage()
    return { user: usage.user, system: usage.system }
  })
  const memoryUsage = options.memoryUsage ?? (() => {
    const usage = process.memoryUsage()
    return {
      rss: usage.rss,
      heapTotal: usage.heapTotal,
      heapUsed: usage.heapUsed,
      external: usage.external,
      arrayBuffers: usage.arrayBuffers
    }
  })
  const pid = options.pid ?? process.pid
  safePositiveInteger(pid, 'pid')
  return {
    outputPath: resolve(options.outputPath),
    durationMs,
    intervalMs,
    now,
    monotonicNow,
    sleep,
    cpuUsage,
    memoryUsage,
    readQueueDepth: options.readQueueDepth ?? (() => undefined),
    readProviderLatencyMs: options.readProviderLatencyMs ?? (() => undefined),
    pid
  }
}

function normalizeMemory(value: RuntimeMemoryUsage): RuntimeMemoryUsage {
  if (value === null || typeof value !== 'object') {
    throw new RuntimeProfileError('invalid_reading', 'runtime memory reading is invalid')
  }
  return Object.freeze({
    rss: nonNegativeFinite(value.rss, 'RSS'),
    heapTotal: nonNegativeFinite(value.heapTotal, 'heap total'),
    heapUsed: nonNegativeFinite(value.heapUsed, 'heap used'),
    external: nonNegativeFinite(value.external, 'external memory'),
    ...(value.arrayBuffers === undefined ? {} : { arrayBuffers: nonNegativeFinite(value.arrayBuffers, 'array buffers') })
  })
}

function boundedInteger(value: unknown, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) {
    throw new RuntimeProfileError('invalid_request', `${field} is out of bounds`)
  }
  return Number(value)
}

function safePositiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new RuntimeProfileError('invalid_reading', `${field} is invalid`)
  }
  return Number(value)
}

function nonNegativeFinite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new RuntimeProfileError('invalid_reading', `${field} is invalid`)
  }
  return value
}

function positiveFinite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RuntimeProfileError('invalid_reading', `${field} is invalid`)
  }
  return value
}

function optionalBoundedInteger(value: unknown, field: string, maximum: number): number | undefined {
  if (value === undefined) return undefined
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    throw new RuntimeProfileError('invalid_reading', `${field} is invalid`)
  }
  return Number(value)
}

function optionalBoundedFinite(value: unknown, field: string, maximum: number): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > maximum) {
    throw new RuntimeProfileError('invalid_reading', `${field} is invalid`)
  }
  return value
}
