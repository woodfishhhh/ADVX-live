import {
  mkdirSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as fc from 'fast-check'

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
export const TST_004_ARTIFACT_ROOT = join(
  repositoryRoot,
  '.omx',
  'artifacts',
  'test-results',
  'tst-004'
)
const defaultBaseSeed = 6_657_004

export const TST_004_PROPERTY_IDS = Object.freeze([
  'monotonic-sequence-fences',
  'epoch-invalidation',
  'stop-dispose-idempotence',
  'cancellation-dominates-late-completion',
  'bounded-queue-concurrency',
  'candidate-budget-rotation',
  'database-event-ordering',
  'retry-backoff-caps'
] as const)

export type Tst004PropertyId = (typeof TST_004_PROPERTY_IDS)[number]

export type SeededPropertyOptions = Readonly<{
  numRuns: number
}>

export async function assertSeededProperty<Ts>(
  propertyId: Tst004PropertyId,
  property: fc.IProperty<Ts> | fc.IAsyncProperty<Ts>,
  options: SeededPropertyOptions
): Promise<void> {
  if (!Number.isSafeInteger(options.numRuns) || options.numRuns < 1) {
    throw new RangeError('fast-check numRuns must be a positive integer')
  }
  const configuredSeed = optionalIntegerEnvironment('ADVX_TST004_SEED')
  const configuredPath = optionalEnvironment('ADVX_TST004_PATH')
  const configuredRuns = optionalIntegerEnvironment('ADVX_TST004_NUM_RUNS')
  const seed = configuredSeed ?? derivedSeed(propertyId)
  const numRuns = configuredRuns ?? options.numRuns
  if (numRuns < 1) throw new RangeError('ADVX_TST004_NUM_RUNS must be positive')

  const details = await fc.check(
    property as fc.IAsyncProperty<Ts>,
    {
      seed,
      numRuns,
      endOnFailure: false,
      ...(configuredPath === undefined ? {} : { path: configuredPath })
    }
  )
  const replayPath = details.counterexamplePath ?? configuredPath ?? null
  const evidence = {
    schema_version: 1,
    task: 'TST-004',
    property_id: propertyId,
    status: details.failed ? 'failed' : 'passed',
    seed: details.seed,
    path: replayPath,
    num_runs: details.numRuns,
    num_skips: details.numSkips,
    num_shrinks: details.numShrinks,
    counterexample: jsonSafe(details.counterexample),
    error: errorMessage(details.errorInstance),
    runtime: {
      bun: Bun.version,
      node: process.version,
      fast_check: fc.__version,
      platform: process.platform,
      arch: process.arch
    },
    replay_command:
      `bun run --filter @advx/backend-bun test:tst-004:replay -- ` +
      `--property ${propertyId} --seed ${details.seed}` +
      (replayPath === null ? '' : ` --path ${replayPath}`)
  }
  writeJsonAtomically(join(TST_004_ARTIFACT_ROOT, `${propertyId}.json`), evidence)

  if (details.failed) {
    throw new Error(
      `TST-004 property ${propertyId} failed; seed=${details.seed}; ` +
      `path=${replayPath ?? '<none>'}; ${errorMessage(details.errorInstance) ?? 'no error'}`
    )
  }
}

function derivedSeed(propertyId: Tst004PropertyId): number {
  const digest = new Bun.CryptoHasher('sha256')
    .update(`${defaultBaseSeed}\0${propertyId}`)
    .digest()
  return new DataView(digest.buffer, digest.byteOffset, digest.byteLength).getInt32(0)
}

function optionalEnvironment(name: string): string | undefined {
  const value = process.env[name]
  if (value === undefined) return undefined
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > 4_096) {
    throw new RangeError(`${name} must contain 1 to 4096 characters`)
  }
  return normalized
}

function optionalIntegerEnvironment(name: string): number | undefined {
  const value = optionalEnvironment(name)
  if (value === undefined) return undefined
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`${name} must be a safe integer`)
  }
  return parsed
}

function jsonSafe(value: unknown): unknown {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value, (_key, item) =>
    typeof item === 'bigint' ? item.toString() : item
  )) as unknown
}

function errorMessage(error: unknown): string | null {
  if (error === null || error === undefined) return null
  if (error instanceof Error) return error.message.slice(0, 8_192)
  return String(error).slice(0, 8_192)
}

function writeJsonAtomically(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  renameSync(temporaryPath, path)
}
