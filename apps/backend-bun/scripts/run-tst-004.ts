import {
  readFileSync,
  renameSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  TST_004_ARTIFACT_ROOT,
  TST_004_PROPERTY_IDS
} from '../src/testing/fast-check-evidence'

type Options = Readonly<{
  property?: string
  seed?: string
  path?: string
  numRuns?: string
}>

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const testFiles = [
  'src/testing/tst-004-runtime-invariants.test.ts',
  'src/testing/tst-004-scheduling-invariants.test.ts',
  'src/testing/tst-004-persistence-invariants.test.ts'
]

const options = parseOptions(process.argv.slice(2))
const command = [process.execPath, 'test', ...testFiles]
if (options.property !== undefined) {
  if (!TST_004_PROPERTY_IDS.includes(options.property as never)) {
    throw new RangeError(`unknown TST-004 property: ${options.property}`)
  }
  command.push('--test-name-pattern', `\\[${escapePattern(options.property)}\\]`)
}

const child = Bun.spawn(command, {
  cwd: packageRoot,
  env: {
    ...process.env,
    ...(options.seed === undefined ? {} : { ADVX_TST004_SEED: options.seed }),
    ...(options.path === undefined ? {} : { ADVX_TST004_PATH: options.path }),
    ...(options.numRuns === undefined
      ? {}
      : { ADVX_TST004_NUM_RUNS: options.numRuns })
  },
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit'
})

const exitCode = await child.exited
if (exitCode !== 0) {
  process.exitCode = exitCode
} else if (options.property === undefined) {
  writePassingManifest()
}

function parseOptions(args: readonly string[]): Options {
  const parsed: {
    property?: string
    seed?: string
    path?: string
    numRuns?: string
  } = {}
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index]
    const value = args[index + 1]
    if (
      flag !== '--property' &&
      flag !== '--seed' &&
      flag !== '--path' &&
      flag !== '--num-runs'
    ) {
      throw new RangeError(`unknown TST-004 argument: ${flag}`)
    }
    if (value === undefined || value.startsWith('--')) {
      throw new RangeError(`${flag} requires a value`)
    }
    const key = flag === '--num-runs'
      ? 'numRuns'
      : flag.slice(2) as 'property' | 'seed' | 'path'
    if (parsed[key] !== undefined) throw new RangeError(`${flag} was repeated`)
    parsed[key] = value
    index += 1
  }
  if (parsed.path !== undefined && parsed.seed === undefined) {
    throw new RangeError('--path requires --seed')
  }
  if (parsed.path !== undefined && parsed.property === undefined) {
    throw new RangeError('--path requires --property')
  }
  return parsed
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function writePassingManifest(): void {
  const properties = TST_004_PROPERTY_IDS.map((propertyId) => {
    const path = join(TST_004_ARTIFACT_ROOT, `${propertyId}.json`)
    const value = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    if (
      value.schema_version !== 1 ||
      value.task !== 'TST-004' ||
      value.property_id !== propertyId ||
      value.status !== 'passed' ||
      !Number.isSafeInteger(value.seed) ||
      !Number.isSafeInteger(value.num_runs) ||
      Number(value.num_runs) < 1 ||
      typeof value.replay_command !== 'string' ||
      value.replay_command.length === 0 ||
      value.runtime === null ||
      typeof value.runtime !== 'object'
    ) {
      throw new Error(`invalid TST-004 property artifact: ${propertyId}`)
    }
    return {
      property_id: propertyId,
      seed: value.seed,
      path: value.path ?? null,
      num_runs: value.num_runs,
      replay_command: value.replay_command,
      runtime: value.runtime
    }
  })
  const manifest = {
    schema_version: 1,
    task: 'TST-004',
    status: 'passed',
    property_count: properties.length,
    total_runs: properties.reduce(
      (total, property) => total + Number(property.num_runs),
      0
    ),
    properties
  }
  const path = join(TST_004_ARTIFACT_ROOT, 'manifest.json')
  const temporaryPath = `${path}.${process.pid}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  renameSync(temporaryPath, path)
}
