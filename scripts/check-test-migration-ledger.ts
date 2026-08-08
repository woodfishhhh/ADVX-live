import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const risks = new Set(['low', 'medium', 'high', 'critical'])
const statuses = new Set(['unmapped', 'ported', 'superseded', 'approved-delete'])
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ledgerPath = resolve(
  repositoryRoot,
  'docs/migrations/typescript-bun/tst-002-test-coverage-ledger.json'
)
const inventoryPath = resolve(
  repositoryRoot,
  '.omx/artifacts/typescript-bun/TST-000/tst-000-maker-root-20260806-053/python-test-inventory.json'
)

type JsonObject = Record<string, unknown>

function object(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(nonEmptyString)
}

function parseJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8')) as unknown
}

const errors: string[] = []
const ledger = parseJson(ledgerPath)
const inventory = parseJson(inventoryPath)

if (!object(ledger)) throw new TypeError('ledger root must be an object')
if (ledger.schema_version !== 1) errors.push('ledger schema_version must be 1')
if (ledger.task !== 'TST-002') errors.push('ledger task must be TST-002')
if (!Array.isArray(ledger.rows)) errors.push('ledger rows must be an array')

if (!object(inventory) || !Array.isArray(inventory.tests)) {
  throw new TypeError('TST-000 inventory must contain a tests array')
}

const inventoryModules = inventory.tests.flatMap((entry) => {
  if (!object(entry) || !nonEmptyString(entry.python_test)) return []
  return [entry.python_test.replaceAll('\\', '/')]
})
if (inventoryModules.length !== inventory.tests.length) {
  errors.push('every TST-000 inventory entry must name python_test')
}

const rows = Array.isArray(ledger.rows) ? ledger.rows : []
const ledgerTests = new Set<string>()
const statusCounts: Record<string, number> = Object.fromEntries(
  [...statuses].map((status) => [status, 0])
)

for (const [index, value] of rows.entries()) {
  const label = `rows[${index}]`
  if (!object(value)) {
    errors.push(`${label} must be an object`)
    continue
  }

  const pythonTest = value.pythonTest
  const replacement = value.replacement
  const status = value.status
  if (!nonEmptyString(pythonTest)) {
    errors.push(`${label}.pythonTest must be a non-empty string`)
  } else if (ledgerTests.has(pythonTest)) {
    errors.push(`${label}.pythonTest is duplicated: ${pythonTest}`)
  } else {
    ledgerTests.add(pythonTest)
  }
  if (!nonEmptyString(value.behavior)) errors.push(`${label}.behavior is required`)
  if (!nonEmptyString(value.proofClass)) errors.push(`${label}.proofClass is required`)
  if (!nonEmptyString(value.risk) || !risks.has(value.risk)) {
    errors.push(`${label}.risk is invalid`)
  }
  if (!nonEmptyString(status) || !statuses.has(status)) {
    errors.push(`${label}.status is invalid`)
    continue
  }
  statusCounts[status] = (statusCounts[status] ?? 0) + 1
  if (!Array.isArray(replacement) || !replacement.every(nonEmptyString)) {
    errors.push(`${label}.replacement must be a string array`)
    continue
  }

  if (status === 'ported' || status === 'superseded') {
    if (replacement.length === 0) {
      errors.push(`${label} ${status} row requires replacement proof`)
    }
    for (const path of replacement) {
      if (!existsSync(resolve(repositoryRoot, path))) {
        errors.push(`${label} replacement does not exist: ${path}`)
      }
    }
  }
  if (status === 'unmapped') {
    if (replacement.length !== 0) errors.push(`${label} unmapped row cannot claim replacement proof`)
    if (!nonEmptyString(value.rationale) || !value.rationale.includes('TST-003')) {
      errors.push(`${label} unmapped row must assign its exact behavior to TST-003`)
    }
  }
  if (status === 'approved-delete') {
    if (!nonEmptyString(value.rationale) || !nonEmptyString(value.verifier)) {
      errors.push(`${label} approved-delete row requires rationale and verifier`)
    }
  }
}

for (const module of inventoryModules) {
  if (![...ledgerTests].some((test) => test.startsWith(`${module}::`))) {
    errors.push(`TST-000 module has no behavior row: ${module}`)
  }
}
for (const test of ledgerTests) {
  if (!inventoryModules.some((module) => test.startsWith(`${module}::`))) {
    errors.push(`ledger row is outside the TST-000 inventory: ${test}`)
  }
}

const collection = spawnSync(
  'uv',
  [
    'run',
    '--project',
    'apps/backend',
    'pytest',
    'apps/backend/tests',
    'tests/e2e',
    '--collect-only',
    '-q'
  ],
  {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 120_000
  }
)

if (collection.error) errors.push(`pytest collection failed: ${collection.error.message}`)
if (collection.status !== 0) {
  errors.push(`pytest collection exited ${collection.status}: ${collection.stderr.trim()}`)
}

const collectedTests = new Set(
  collection.stdout
    .split(/\r?\n/u)
    .filter((line) => line.includes('.py::'))
    .map((line) => normalizeNodeId(line.trim(), inventoryModules, errors))
)

for (const test of collectedTests) {
  if (!ledgerTests.has(test)) errors.push(`collected Python behavior is missing from ledger: ${test}`)
}
for (const test of ledgerTests) {
  if (!collectedTests.has(test)) errors.push(`ledger behavior was not collected by pytest: ${test}`)
}

if (object(ledger.summary)) {
  if (ledger.summary.total !== rows.length) errors.push('summary.total does not match row count')
  for (const status of statuses) {
    if (ledger.summary[status] !== statusCounts[status]) {
      errors.push(`summary.${status} does not match row count`)
    }
  }
} else {
  errors.push('ledger summary must be an object')
}

const result = {
  task: 'TST-002',
  ledger: ledgerPath.replace(`${repositoryRoot}\\`, '').replaceAll('\\', '/'),
  inventoryModules: inventoryModules.length,
  collectedTests: collectedTests.size,
  ledgerRows: rows.length,
  statusCounts,
  errors
}
console.log(JSON.stringify(result, null, 2))
if (errors.length > 0) process.exitCode = 1

function normalizeNodeId(
  raw: string,
  modules: string[],
  targetErrors: string[]
): string {
  const separator = raw.indexOf('::')
  const rawModule = raw.slice(0, separator).replaceAll('\\', '/')
  const behavior = raw.slice(separator + 2)
  const matches = modules.filter(
    (module) => module === rawModule || module.endsWith(`/${rawModule}`)
  )
  if (matches.length !== 1) {
    targetErrors.push(`cannot uniquely normalize collected node: ${raw}`)
    return `${rawModule}::${behavior}`
  }
  return `${matches[0]}::${behavior}`
}
