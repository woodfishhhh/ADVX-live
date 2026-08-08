import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import {
  parseNamedArguments,
  requireSafeArtifactRoot,
  runMachineCli,
  SCRIPT_EXIT,
  ScriptError,
  writeJsonAtomic
} from './evidence-script-runtime.ts'

type MatchCategory =
  | 'active_violation'
  | 'historical_migration_documentation'
  | 'fixture_or_test_string'
  | 'third_party_or_generated_artifact'
  | 'explicitly_retained_non_product_example'

type ScanMatch = Readonly<{
  path: string
  line: number
  column: number
  term: string
  text: string
  category: MatchCategory
}>

const matchCategories: readonly MatchCategory[] = [
  'active_violation',
  'historical_migration_documentation',
  'fixture_or_test_string',
  'third_party_or_generated_artifact',
  'explicitly_retained_non_product_example'
]

const repositoryRoot = resolve(import.meta.dir, '..')
const args = parseNamedArguments(Bun.argv.slice(2), new Set(['--artifact-root']))
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ??
    join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'cut-011'),
  repositoryRoot
)

const scanTerms = [
  { name: 'python', source: '\\bpython\\b' },
  { name: 'python3', source: '\\bpython3\\b' },
  { name: 'pytest', source: '\\bpytest\\b' },
  { name: 'ruff', source: '\\bruff\\b' },
  { name: 'uv', source: '\\buv\\b' },
  { name: 'fastapi', source: '\\bfastapi\\b' },
  { name: 'pydantic', source: '\\bpydantic\\b' },
  { name: 'alembic-runtime', source: '\\balembic\\b' },
  { name: 'pnpm', source: '\\bpnpm\\b' },
  { name: 'package-lock', source: 'package-lock(?:\\.json)?' },
  { name: 'yarn-lock', source: 'yarn(?:\\.lock|\\s+lock)' }
] as const

const historicalDocuments = new Set([
  'apps/backend/README.md',
  'docs/DECISIONS.md',
  'docs/SB6657_STYLE_TUNING.md',
  'docs/VIEWER_BEHAVIOR_REDESIGN.md',
  'docs/VIEWER_RUNTIME_INTEGRATION_PLAN.md',
  'docs/VIEWER_RUNTIME_REQUIREMENTS_LOG.md'
])

const retainedNonProductExamples = new Map([
  [
    'scripts/run-room-6657-skillopt.ts',
    'optional local optimizer wrapper; not imported by product, build, package, or release paths'
  ]
])

const historicalLineMarker =
  /historical|superseded|removed|retained|migration|oracle|parity|rollback|cutover|legacy|tombstone|历史|迁移|删除|移除|回滚|兼容|旧|保留/iu

const toolchainPathPattern =
  /(^|\/)(?:[^/]+\.py|pyproject\.toml|uv\.lock|alembic\.ini|pytest\.ini|ruff\.toml|\.ruff\.toml|requirements(?:-[^/]*)?\.txt|pnpm-lock\.ya?ml|pnpm-workspace\.ya?ml|package-lock\.json|yarn\.lock)$/iu

function verify(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScriptError(SCRIPT_EXIT.verificationFailed, message)
}

async function runGit(args: string[]): Promise<string> {
  const child = Bun.spawn(['git', ...args], {
    cwd: repositoryRoot,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true
  })
  const stdoutPromise = new Response(child.stdout).text()
  const stderrPromise = new Response(child.stderr).text()
  const exitCode = await child.exited
  const stdout = await stdoutPromise
  const stderr = await stderrPromise
  verify(exitCode === 0, `git ${args.join(' ')} failed: ${stderr}`)
  return stdout
}

async function exists(path: string): Promise<boolean> {
  return Bun.file(join(repositoryRoot, path)).exists()
}

function isFixtureOrTest(path: string): boolean {
  return (
    /(^|\/)(?:test|tests|fixtures)(?:\/|$)/u.test(path) ||
    /\.(?:test|spec)\.[^/]+$/u.test(path) ||
    path.startsWith('scripts/check-')
  )
}

function isGenerated(path: string): boolean {
  return path === 'bun.lock' || /(^|\/)(?:generated|third_party|vendor)(?:\/|$)/u.test(path)
}

function classify(path: string, line: string): MatchCategory {
  if (path.startsWith('docs/migrations/typescript-bun/')) {
    return 'historical_migration_documentation'
  }
  if (historicalDocuments.has(path)) return 'historical_migration_documentation'
  if (isFixtureOrTest(path)) return 'fixture_or_test_string'
  if (isGenerated(path)) return 'third_party_or_generated_artifact'
  if (retainedNonProductExamples.has(path)) {
    return 'explicitly_retained_non_product_example'
  }
  if (/\.md$/iu.test(path) && historicalLineMarker.test(line)) {
    return 'historical_migration_documentation'
  }
  return 'active_violation'
}

function matchLine(path: string, line: string, lineNumber: number): ScanMatch[] {
  const matches: ScanMatch[] = []
  for (const term of scanTerms) {
    const expression = new RegExp(term.source, 'giu')
    for (const match of line.matchAll(expression)) {
      matches.push({
        path,
        line: lineNumber,
        column: (match.index ?? 0) + 1,
        term: term.name,
        text: match[0],
        category: classify(path, line)
      })
    }
  }
  return matches
}

function countBy<T extends string>(keys: readonly T[], values: readonly T[]): Record<T, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1
  return counts
}

await runMachineCli(async () => {
  verify(process.platform === 'win32' && process.arch === 'x64', 'CUT-011 requires Windows x64')
  verify(Bun.version === '1.3.14', `CUT-011 requires Bun 1.3.14, got ${Bun.version}`)
  await rm(artifactRoot, { recursive: true, force: true })

  const tracked = (await runGit(['ls-files', '-z']))
    .split('\0')
    .filter(Boolean)
    .map((path) => path.replace(/\\/gu, '/'))
  for (const taskPath of ['scripts/check-cut-011.ts', 'scripts/tsconfig.cut-011.json']) {
    if (!tracked.includes(taskPath) && (await exists(taskPath))) tracked.push(taskPath)
  }
  tracked.sort()

  const activeTrackedPaths = []
  for (const path of tracked) if (await exists(path)) activeTrackedPaths.push(path)

  const toolchainPathViolations = activeTrackedPaths.filter((path) =>
    toolchainPathPattern.test(path)
  )

  const matches: ScanMatch[] = []
  const binaryPaths: string[] = []
  const activeSurfaceIdentities: Array<Readonly<{ path: string; sha256: string }>> = []
  let scannedTextFileCount = 0
  for (const path of activeTrackedPaths) {
    const bytes = await readFile(join(repositoryRoot, path))
    if (bytes.includes(0)) {
      binaryPaths.push(path)
      continue
    }
    const text = bytes.toString('utf8')
    scannedTextFileCount += 1
    if (!path.startsWith('docs/migrations/typescript-bun/')) {
      activeSurfaceIdentities.push({
        path,
        sha256: createHash('sha256').update(bytes).digest('hex')
      })
    }
    for (const [index, line] of text.split(/\r?\n/u).entries()) {
      matches.push(...matchLine(path, line, index + 1))
    }
  }

  const activeScriptViolations: Array<
    Readonly<{
      path: string
      script: string
      command: string
    }>
  > = []
  for (const path of activeTrackedPaths.filter((entry) => /(^|\/)package\.json$/u.test(entry))) {
    const parsed = JSON.parse(await readFile(join(repositoryRoot, path), 'utf8')) as {
      scripts?: Record<string, unknown>
    }
    for (const [script, command] of Object.entries(parsed.scripts ?? {})) {
      if (
        typeof command === 'string' &&
        /(^|[\s"'=;&|])(?:python3?|pytest|ruff|uv|pnpm)(?=$|[\s"'=;&|:])/iu.test(command)
      ) {
        activeScriptViolations.push({ path, script, command })
      }
    }
  }

  const activeViolations = matches.filter((match) => match.category === 'active_violation')
  verify(
    toolchainPathViolations.length === 0,
    `active legacy toolchain paths remain: ${JSON.stringify(toolchainPathViolations)}`
  )
  verify(
    activeScriptViolations.length === 0,
    `package scripts still invoke a legacy toolchain: ${JSON.stringify(activeScriptViolations)}`
  )
  verify(
    activeViolations.length === 0,
    `active runtime scan violations remain: ${JSON.stringify(activeViolations.slice(0, 20))}`
  )

  const workflowText = await readFile(
    join(repositoryRoot, '.github', 'workflows', 'bun-ci.yml'),
    'utf8'
  )
  verify(workflowText.includes('workflow_dispatch:'), 'manual CI trigger is missing')
  verify(
    !workflowText.split(/\r?\n/u).some((line) => /^  (?:push|pull_request|schedule):/u.test(line)),
    'CI/CD was enabled before migration completion'
  )

  const untrackedWorktreePaths = (
    await runGit(['status', '--porcelain=v1', '--untracked-files=normal'])
  )
    .split(/\r?\n/u)
    .filter((line) => line.startsWith('?? '))
    .map((line) => line.slice(3).replace(/\\/gu, '/'))

  const activeSurfaceAggregateSha256 = createHash('sha256')
    .update(
      activeSurfaceIdentities.map((identity) => `${identity.path}:${identity.sha256}`).join('\n')
    )
    .digest('hex')
  const classificationCounts = countBy(
    matchCategories,
    matches.map((match) => match.category)
  )
  const termCounts = countBy(
    scanTerms.map((term) => term.name),
    matches.map((match) => match.term)
  )
  const result = {
    schemaVersion: 1,
    taskId: 'CUT-011',
    status: 'passed',
    scope:
      'tracked repository files and package scripts; untracked owner files reported but excluded',
    claim: 'no active project dependency or release artifact',
    scanTerms: scanTerms.map((term) => term.name),
    scannedTrackedFileCount: activeTrackedPaths.length,
    scannedTextFileCount,
    skippedBinaryFileCount: binaryPaths.length,
    skippedBinaryPaths: binaryPaths,
    matchCount: matches.length,
    classificationCounts,
    termCounts,
    matches,
    toolchainPathViolations,
    activeScriptViolations,
    activeViolations,
    retainedNonProductExamples: Object.fromEntries(retainedNonProductExamples),
    untrackedWorktreePaths,
    ciTrigger: 'workflow_dispatch',
    activeSurfaceFileCount: activeSurfaceIdentities.length,
    activeSurfaceAggregateSha256,
    limitations: [
      'Windows x64 only',
      'unsigned, unpublished, undeployed',
      'macOS unproven',
      'CUT-012 clean-clone verification pending'
    ]
  }
  await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
  return {
    artifact: relative(repositoryRoot, join(artifactRoot, 'result.json')).replace(/\\/gu, '/'),
    claim: result.claim,
    scannedTrackedFileCount: result.scannedTrackedFileCount,
    matchCount: result.matchCount,
    classificationCounts,
    toolchainPathViolations: result.toolchainPathViolations.length,
    activeScriptViolations: result.activeScriptViolations.length,
    activeViolations: result.activeViolations.length,
    ciTrigger: result.ciTrigger,
    activeSurfaceAggregateSha256
  }
})
