import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

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
    join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'cut-010'),
  repositoryRoot
)

const removedPaths = [
  'apps/backend-bun/src/infrastructure/persistence/sqlite/legacy-database-fixture.py',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/legacy-database-migration.test.ts',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/legacy-database-migration.ts',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/python-online-backup-adapter.ts',
  'packages/contracts/src/generated/openapi.ts',
  'packages/contracts/src/legacy.ts',
  'packages/contracts/test/binary-oracle.py',
  'packages/contracts/test/con-005-python-oracle.py',
  'packages/contracts/test/contract-parity-oracle.py',
  'packages/contracts/test/contract-parity.ts',
  'packages/contracts/test/protocol-compatibility-oracle.py',
  'packages/contracts/test/tsconfig.contract-parity.json',
  'packages/contracts/test/fixtures/realtime-python-v4.json',
  'scripts/check-cut-001.ts',
  'scripts/check-cut-003.ts',
  'scripts/run-tst-013.ts',
  'scripts/tsconfig.cut-001.json',
  'scripts/tsconfig.cut-003.json',
  'scripts/tsconfig.tst-013.json',
  'tests/parity/harness.test.ts',
  'tests/parity/harness.ts',
  'tests/parity/health-candidate.ts',
  'tests/parity/run-control-session-parity.ts',
  'tests/parity/run-health-parity.ts',
  'tests/parity/tsconfig.json'
] as const

const retainedPaths = [
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/index.ts',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migration-runner.ts',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migration-runner.test.ts',
  'apps/backend-bun/src/infrastructure/observability/trace-evidence.ts',
  'packages/contracts/src/compatibility.ts',
  'packages/contracts/src/realtime/legacy.ts',
  'packages/contracts/src/generated/bun-control-openapi.ts',
  'packages/contracts/test/fixtures/realtime-v4.json',
  'docs/migrations/typescript-bun/CUT-003-BACKUP-ROLLBACK-REHEARSAL.md',
  'docs/migrations/typescript-bun/DAT-001-PERSISTENCE-INVENTORY.md'
] as const

const sourcePaths = [
  'package.json',
  '.github/workflows/bun-ci.yml',
  'apps/desktop/src/main/backend/backend-runtime.ts',
  'apps/desktop/src/main/backend/backend-control-adapter.ts',
  'apps/desktop/src/main/backend/backend-realtime-adapter.ts',
  'apps/backend-bun/src/infrastructure/observability/trace-evidence.ts',
  'packages/contracts/package.json',
  'packages/contracts/src/index.ts',
  'packages/contracts/src/generated/index.ts',
  'docs/migrations/typescript-bun/PKG-012-SIGNED-UPDATE-ROLLBACK-RUNBOOK.md',
  'scripts/check-pkg-012.ts',
  'scripts/check-cut-010.ts',
  'scripts/tsconfig.cut-010.json',
  ...retainedPaths
] as const

function verify(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScriptError(SCRIPT_EXIT.verificationFailed, message)
}

async function exists(path: string): Promise<boolean> {
  return Bun.file(join(repositoryRoot, path)).exists()
}

function asRecord(value: unknown, label: string): JsonRecord {
  verify(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    `${label} is not an object`
  )
  return value as JsonRecord
}

async function activeTrackedPythonFiles(): Promise<string[]> {
  const child = Bun.spawn(['git', 'ls-files', '-z', '--', '*.py'], {
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
  const active = []
  for (const path of stdout.split('\0').filter(Boolean)) {
    const normalized = path.replace(/\\/g, '/')
    if (await exists(normalized)) active.push(normalized)
  }
  return active
}

await runMachineCli(async () => {
  verify(process.platform === 'win32' && process.arch === 'x64', 'CUT-010 requires Windows x64')
  verify(Bun.version === '1.3.14', `CUT-010 requires Bun 1.3.14, got ${Bun.version}`)
  await rm(artifactRoot, { recursive: true, force: true })

  const remainingRemovedPaths = []
  for (const path of removedPaths) if (await exists(path)) remainingRemovedPaths.push(path)
  verify(
    remainingRemovedPaths.length === 0,
    `migration-only shims remain: ${JSON.stringify(remainingRemovedPaths)}`
  )

  const missingRetainedPaths = []
  for (const path of retainedPaths) if (!(await exists(path))) missingRetainedPaths.push(path)
  verify(
    missingRetainedPaths.length === 0,
    `durable compatibility, migration, or diagnostic paths are missing: ${JSON.stringify(missingRetainedPaths)}`
  )

  const activePythonFiles = await activeTrackedPythonFiles()
  verify(
    activePythonFiles.length === 0,
    `tracked Python source remains active: ${JSON.stringify(activePythonFiles)}`
  )

  const runtimeText = await readFile(
    join(repositoryRoot, 'apps/desktop/src/main/backend/backend-runtime.ts'),
    'utf8'
  )
  verify(
    runtimeText.includes("'bun-source'") && runtimeText.includes("'bun-compiled'"),
    'Bun source/compiled runtime selection is missing'
  )
  verify(
    !/python-oracle|BackendKind|backendKindForRuntime|runtimeForBackendKind/.test(runtimeText),
    'dual-runtime selector remains active'
  )

  const desktopAdapterTexts = await Promise.all(
    [
      'apps/desktop/src/main/backend/backend-control-adapter.ts',
      'apps/desktop/src/main/backend/backend-client.ts',
      'apps/desktop/src/main/index.ts'
    ].map((path) => readFile(join(repositoryRoot, path), 'utf8'))
  )
  verify(
    !/PythonOpenApiControlTransport|python-oracle|backendKind/.test(desktopAdapterTexts.join('\n')),
    'Python control client or rollback adapter branch remains active'
  )

  const traceText = await readFile(
    join(repositoryRoot, 'apps/backend-bun/src/infrastructure/observability/trace-evidence.ts'),
    'utf8'
  )
  verify(
    traceText.includes("source_runtime: 'bun'"),
    'current trace diagnostics do not identify the Bun runtime'
  )
  verify(
    !/source_runtime:\s*runtime|runtime:\s*'python'|['\"]python['\"]\s*\|/.test(traceText),
    'cross-runtime trace normalization remains active'
  )

  const contractsPackage = asRecord(
    JSON.parse(await readFile(join(repositoryRoot, 'packages/contracts/package.json'), 'utf8')),
    'contracts package'
  )
  const contractExports = asRecord(contractsPackage.exports, 'contracts package exports')
  verify(!('./legacy' in contractExports), 'copied Python contract export remains active')

  const rootPackage = asRecord(
    JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8')),
    'root package'
  )
  const scripts = asRecord(rootPackage.scripts, 'root package scripts')
  for (const removedScript of [
    'check:cut-001',
    'typecheck:cut-001',
    'check:cut-003',
    'typecheck:cut-003',
    'test:tst-013',
    'typecheck:tst-013',
    'test:contract-parity',
    'test:dat-010'
  ]) {
    verify(!(removedScript in scripts), `migration-only package script remains: ${removedScript}`)
  }
  verify(typeof scripts['check:cut-010'] === 'string', 'CUT-010 focused check command is missing')
  verify(typeof scripts['typecheck:cut-010'] === 'string', 'CUT-010 strict check is missing')

  const workflowText = await readFile(join(repositoryRoot, '.github/workflows/bun-ci.yml'), 'utf8')
  verify(workflowText.includes('workflow_dispatch:'), 'manual CI trigger is missing')
  verify(
    !workflowText.split(/\r?\n/).some((line) => /^  (?:push|pull_request):/.test(line)),
    'CI/CD was enabled before migration completion'
  )

  const sourceIdentities = await Promise.all(
    sourcePaths.map((path) => fileIdentity(join(repositoryRoot, path), path))
  )
  const sourceAggregateSha256 = createHash('sha256')
    .update(sourceIdentities.map((identity) => `${identity.path}:${identity.sha256}`).join('\n'))
    .digest('hex')
  const result = {
    schemaVersion: 1,
    taskId: 'CUT-010',
    status: 'passed',
    removedPaths,
    retainedPaths,
    activeTrackedPythonFiles: activePythonFiles,
    ciTrigger: 'workflow_dispatch',
    sourceAggregateSha256,
    sourceIdentities
  }
  await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
  return result
})
