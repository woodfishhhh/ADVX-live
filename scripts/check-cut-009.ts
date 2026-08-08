import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import {
  fileIdentity,
  parseNamedArguments,
  requireSafeArtifactRoot,
  runMachineCli,
  SCRIPT_EXIT,
  ScriptError,
  writeJsonAtomic
} from './evidence-script-runtime.ts'

type JsonRecord = Record<string, unknown>

const repositoryRoot = resolve(import.meta.dir, '..')
const args = parseNamedArguments(Bun.argv.slice(2), new Set(['--artifact-root']))
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ??
    join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'cut-009'),
  repositoryRoot
)

const removedPaths = [
  'apps/backend/pyproject.toml',
  'apps/backend/uv.lock',
  'apps/backend/src/advx_backend/infrastructure/persistence/sqlite/migrations/__init__.py',
  'apps/backend/src/advx_backend/infrastructure/persistence/sqlite/migrations/env.py',
  'apps/backend/src/advx_backend/infrastructure/persistence/sqlite/migrations/versions/__init__.py',
  'apps/backend/src/advx_backend/infrastructure/persistence/sqlite/migrations/versions/0001_initial.py',
  'apps/backend/src/advx_backend/infrastructure/persistence/sqlite/migrations/versions/0002_room_runtime.py',
  'apps/backend/src/advx_backend/infrastructure/persistence/sqlite/migrations/versions/0003_mode_meme_candidates.py',
  'apps/backend/src/advx_backend/infrastructure/persistence/sqlite/migrations/versions/0004_shared_brain_controls.py',
  'apps/backend/src/advx_backend/infrastructure/persistence/sqlite/migrations/versions/0005_detach_memory_evidence_events.py',
  'apps/backend/src/advx_backend/infrastructure/persistence/sqlite/migrations/versions/0006_viewer_lifecycle.py'
] as const

const representedHistoryPaths = [
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/index.ts',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/0001_room_session_runtime.sql',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/0002_session_viewer_instances.sql',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/0003_room_events.sql',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/0004_room_long_term_memories.sql',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/0005_mode_memes.sql',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/0006_durable_outbox.sql',
  'docs/migrations/typescript-bun/dat-001-schema-inventory.json',
  'docs/migrations/typescript-bun/DAT-001-PERSISTENCE-INVENTORY.md',
  'docs/migrations/typescript-bun/CUT-003-BACKUP-ROLLBACK-REHEARSAL.md'
] as const

const cut010DeferredPaths = [
  'apps/backend-bun/src/infrastructure/persistence/sqlite/legacy-database-fixture.py',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/legacy-database-migration.test.ts',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/legacy-database-migration.ts',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/python-online-backup-adapter.ts'
] as const

const sourcePaths = [
  '.gitignore',
  '.github/workflows/bun-ci.yml',
  'AGENTS.md',
  'README.md',
  'apps/backend/README.md',
  'docs/README.md',
  'docs/ARCHITECTURE.md',
  'docs/BACKEND_DESIGN.md',
  'docs/OPERATIONS.md',
  'package.json',
  'scripts/check-cut-009.ts',
  'scripts/tsconfig.cut-009.json',
  ...representedHistoryPaths,
  ...cut010DeferredPaths
] as const

function verify(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScriptError(SCRIPT_EXIT.verificationFailed, message)
}

async function exists(path: string): Promise<boolean> {
  return Bun.file(join(repositoryRoot, path)).exists()
}

async function trackedPaths(pathspecs: readonly string[]): Promise<string[]> {
  const child = Bun.spawn(['git', 'ls-files', '-z', '--', ...pathspecs], {
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
  verify(exitCode === 0, `git ls-files failed: ${stderr}`)
  return stdout
    .split('\0')
    .filter(Boolean)
    .map((path) => path.replace(/\\/g, '/'))
}

function asRecord(value: unknown, label: string): JsonRecord {
  verify(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    `${label} is not an object`
  )
  return value as JsonRecord
}

await runMachineCli(async () => {
  verify(process.platform === 'win32' && process.arch === 'x64', 'CUT-009 requires Windows x64')
  verify(Bun.version === '1.3.14', `CUT-009 requires Bun 1.3.14, got ${Bun.version}`)
  await rm(artifactRoot, { recursive: true, force: true })

  const remainingRemovedPaths = []
  for (const path of removedPaths) if (await exists(path)) remainingRemovedPaths.push(path)
  verify(
    remainingRemovedPaths.length === 0,
    `CUT-009 toolchain paths remain: ${JSON.stringify(remainingRemovedPaths)}`
  )

  const backendTrackedPaths = []
  for (const path of await trackedPaths(['apps/backend']))
    if (await exists(path)) backendTrackedPaths.push(path)
  verify(
    backendTrackedPaths.length === 1 && backendTrackedPaths[0] === 'apps/backend/README.md',
    `unexpected active apps/backend files remain: ${JSON.stringify(backendTrackedPaths)}`
  )

  const trackedRootFiles = await trackedPaths(['.'])
  const activeTrackedFiles = []
  for (const path of trackedRootFiles) if (await exists(path)) activeTrackedFiles.push(path)
  const toolchainNamePattern =
    /(^|\/)(pyproject\.toml|uv\.lock|alembic\.ini|pytest\.ini|ruff\.toml|\.ruff\.toml|\.python-version|requirements(?:-[^/]*)?\.txt)$/i
  const activeToolchainFiles = activeTrackedFiles.filter((path) => toolchainNamePattern.test(path))
  verify(
    activeToolchainFiles.length === 0,
    `active Python toolchain files remain: ${JSON.stringify(activeToolchainFiles)}`
  )

  const ignoreText = await readFile(join(repositoryRoot, '.gitignore'), 'utf8')
  const ignoreLines = new Set(ignoreText.split(/\r?\n/).map((line) => line.trim()))
  const forbiddenIgnoreLines = [
    '# Python',
    '.venv/',
    '__pycache__/',
    '*.py[cod]',
    '.pytest_cache/',
    '.ruff_cache/',
    '.coverage',
    'htmlcov/',
    '*.egg-info/',
    'apps/backend/openapi.json'
  ]
  const remainingPythonIgnores = forbiddenIgnoreLines.filter((line) => ignoreLines.has(line))
  verify(
    remainingPythonIgnores.length === 0,
    `Python-specific ignores remain: ${JSON.stringify(remainingPythonIgnores)}`
  )

  const workflowPaths = activeTrackedFiles.filter((path) => path.startsWith('.github/workflows/'))
  const activeWorkflowViolations = []
  const workflowPattern =
    /actions\/setup-python|python-version:|\b(?:pytest|ruff)\b|\buv\s+(?:sync|run|lock|pip)|\.venv\/|__pycache__/i
  for (const path of workflowPaths) {
    const text = await readFile(join(repositoryRoot, path), 'utf8')
    if (workflowPattern.test(text)) activeWorkflowViolations.push(path)
  }
  verify(
    activeWorkflowViolations.length === 0,
    `active CI Python setup or cache remains: ${JSON.stringify(activeWorkflowViolations)}`
  )
  const bunCiText = await readFile(
    join(repositoryRoot, '.github', 'workflows', 'bun-ci.yml'),
    'utf8'
  )
  verify(bunCiText.includes('workflow_dispatch:'), 'manual CI trigger is missing')
  const automaticCiTriggers = bunCiText
    .split(/\r?\n/)
    .filter((line) => /^  (?:push|pull_request):/.test(line))
  verify(
    automaticCiTriggers.length === 0,
    `automatic CI triggers remain enabled: ${JSON.stringify(automaticCiTriggers)}`
  )

  const editorPaths = activeTrackedFiles.filter((path) => path.startsWith('.vscode/'))
  const editorViolations = []
  for (const path of editorPaths) {
    const text = await readFile(join(repositoryRoot, path), 'utf8')
    if (/\b(?:python3?|pytest|ruff|uv)\b|\.venv|__pycache__/i.test(text))
      editorViolations.push(path)
  }
  verify(
    editorViolations.length === 0,
    `tracked Python editor tasks remain: ${JSON.stringify(editorViolations)}`
  )

  const rootPackage = asRecord(
    JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')),
    'package'
  )
  const packageScripts = asRecord(rootPackage.scripts, 'package.scripts')
  const commandPattern = /(^|[\s"'=;&|])(?:python3?|pytest|ruff|uv)(?=$|[\s"'=;&|:])/i
  const activeScriptViolations = Object.entries(packageScripts)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .filter(([, command]) => commandPattern.test(command))
    .map(([name]) => name)
  verify(
    activeScriptViolations.length === 0,
    `active package scripts require Python tooling: ${JSON.stringify(activeScriptViolations)}`
  )

  const staleDocumentationMarkers = [
    ['AGENTS.md', 'retained historical Python parity oracle'],
    ['AGENTS.md', 'Retained Python tests are parity-oracle evidence only'],
    ['README.md', '迁移仍保留 Python parity oracle'],
    ['docs/README.md', 'Python 实现只作为迁移 parity oracle'],
    ['docs/ARCHITECTURE.md', '删除由后续人工门禁任务单独负责'],
    ['docs/BACKEND_DESIGN.md', '删除必须等待后续人工门禁'],
    ['docs/OPERATIONS.md', '删除 oracle、其测试和 toolchain 需要']
  ] as const
  const staleDocumentation = []
  for (const [path, marker] of staleDocumentationMarkers) {
    const text = await readFile(join(repositoryRoot, path), 'utf8')
    if (text.includes(marker)) staleDocumentation.push(`${path}:${marker}`)
  }
  verify(
    staleDocumentation.length === 0,
    `active documentation still requires the removed Python boundary: ${JSON.stringify(staleDocumentation)}`
  )

  const missingHistoryPaths = []
  for (const path of representedHistoryPaths)
    if (!(await exists(path))) missingHistoryPaths.push(path)
  verify(
    missingHistoryPaths.length === 0,
    `represented migration history is missing: ${JSON.stringify(missingHistoryPaths)}`
  )

  const missingCut010DeferredPaths = []
  for (const path of cut010DeferredPaths)
    if (!(await exists(path))) missingCut010DeferredPaths.push(path)
  verify(
    missingCut010DeferredPaths.length === 0,
    `CUT-010 migration shims were removed early: ${JSON.stringify(missingCut010DeferredPaths)}`
  )

  const sourceIdentities = await Promise.all(
    sourcePaths.map((path) => fileIdentity(join(repositoryRoot, path), path))
  )
  const sourceAggregateSha256 = createHash('sha256')
    .update(sourceIdentities.map((identity) => `${identity.path}:${identity.sha256}`).join('\n'))
    .digest('hex')
  const result = {
    schemaVersion: 1,
    taskId: 'CUT-009',
    status: 'passed',
    removedToolchainPaths: removedPaths,
    backendTrackedPaths,
    activeToolchainFiles,
    remainingPythonIgnores,
    activeWorkflowViolations,
    automaticCiTriggers,
    editorViolations,
    activeScriptViolations,
    representedHistoryPaths,
    cut010DeferredPaths,
    sourceAggregateSha256,
    sourceIdentities,
    limitations: [
      'Windows x64 only',
      'unsigned, unpublished, undeployed',
      'macOS unproven',
      'CUT-012 clean-clone verification pending'
    ]
  }
  await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
  return {
    artifact: relative(repositoryRoot, join(artifactRoot, 'result.json')).replace(/\\/g, '/'),
    removedToolchainPaths: removedPaths.length,
    backendTrackedPaths,
    representedHistoryPaths: representedHistoryPaths.length,
    sourceFiles: sourceIdentities.length,
    sourceAggregateSha256
  }
})
