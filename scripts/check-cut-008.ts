import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import {
  fileIdentity,
  parseNamedArguments,
  readJsonFile,
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
    join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'cut-008'),
  repositoryRoot
)
const readinessPath = join(
  repositoryRoot,
  '.omx',
  'artifacts',
  'typescript-bun',
  'CUT-008',
  'cut-008-readiness-maker-root-20260808-137',
  'readiness.json'
)
const expectedReadinessSha256 = 'f04b46821dbdfac632dd629dc5f042243662e043d62bfa34dd4fef1b2a05d46d'
const expectedCandidateAggregate =
  '8d569d471e1ce62e09a43608d63b36165ca9b3362d8043076e89a690839a2ed4'

const sourcePaths = [
  'package.json',
  'apps/backend/README.md',
  'apps/desktop/src/main/index.ts',
  'apps/desktop/src/main/backend/backend-process.test.ts',
  'docs/SB6657_STYLE_TUNING.md',
  'docs/migrations/typescript-bun/CUT-008-PYTHON-DELETION-AUTHORIZATION.md',
  'resources/audience-presets/README.md',
  'resources/audience-presets/room-6657/room_6657_generation_skill.json',
  'resources/audience-presets/room-6657/room_6657_style_profile.json',
  'scripts/sync-room-6657-skill.ts',
  'scripts/check-cut-008.ts',
  'scripts/tsconfig.cut-008.json'
] as const

function verify(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScriptError(SCRIPT_EXIT.verificationFailed, message)
}

function asRecord(value: unknown, label: string): JsonRecord {
  verify(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    `${label} is not an object`
  )
  return value as JsonRecord
}

function stringArray(value: unknown, label: string): string[] {
  verify(Array.isArray(value), `${label} is not an array`)
  verify(
    value.every((item) => typeof item === 'string'),
    `${label} contains a non-string`
  )
  return value as string[]
}

async function exists(path: string): Promise<boolean> {
  return Bun.file(join(repositoryRoot, path)).exists()
}

await runMachineCli(async () => {
  verify(process.platform === 'win32' && process.arch === 'x64', 'CUT-008 requires Windows x64')
  verify(Bun.version === '1.3.14', `CUT-008 requires Bun 1.3.14, got ${Bun.version}`)
  await rm(artifactRoot, { recursive: true, force: true })

  const readinessIdentity = await fileIdentity(
    readinessPath,
    '.omx/artifacts/typescript-bun/CUT-008/cut-008-readiness-maker-root-20260808-137/readiness.json'
  )
  verify(
    readinessIdentity.sha256 === expectedReadinessSha256,
    'accepted CUT-008 readiness artifact identity changed'
  )
  const readiness = asRecord(await readJsonFile(readinessPath), 'readiness')
  const inventory = asRecord(readiness.inventory, 'readiness.inventory')
  verify(
    readiness.candidateAggregateSha256 === expectedCandidateAggregate,
    'accepted CUT-008 candidate aggregate changed'
  )

  const trackedCandidatePaths = [
    ...stringArray(inventory.trackedCut008Source, 'trackedCut008Source'),
    ...stringArray(inventory.trackedCut008TestsAndOracles, 'trackedCut008TestsAndOracles'),
    ...stringArray(inventory.trackedCut008Scripts, 'trackedCut008Scripts'),
    ...stringArray(inventory.trackedCut008Adapters, 'trackedCut008Adapters')
  ]
  verify(trackedCandidatePaths.length === 149, 'CUT-008 tracked candidate count changed')
  const remainingTrackedCandidates = []
  for (const path of trackedCandidatePaths)
    if (await exists(path)) remainingTrackedCandidates.push(path)
  verify(
    remainingTrackedCandidates.length === 0,
    `tracked CUT-008 candidates remain: ${JSON.stringify(remainingTrackedCandidates)}`
  )

  const worktreeOnlyCandidates = stringArray(
    inventory.worktreeOnlyRequiresOwnershipReview,
    'worktreeOnlyRequiresOwnershipReview'
  )
  verify(worktreeOnlyCandidates.length === 6, 'CUT-008 worktree-only candidate count changed')
  const remainingWorktreeCandidates = []
  for (const path of worktreeOnlyCandidates)
    if (await exists(path)) remainingWorktreeCandidates.push(path)
  verify(
    remainingWorktreeCandidates.length === 0,
    `worktree-only CUT-008 candidates remain: ${JSON.stringify(remainingWorktreeCandidates)}`
  )

  const cut009Holds = stringArray(inventory.cut009Hold, 'cut009Hold')
  verify(cut009Holds.length === 11, 'CUT-009 hold count changed')
  const missingCut009Holds = []
  for (const path of cut009Holds) if (!(await exists(path))) missingCut009Holds.push(path)
  verify(
    missingCut009Holds.length === 0,
    `CUT-009 holds were removed early: ${JSON.stringify(missingCut009Holds)}`
  )

  const authorization = await readFile(
    join(repositoryRoot, 'docs/migrations/typescript-bun/CUT-008-PYTHON-DELETION-AUTHORIZATION.md'),
    'utf8'
  )
  for (const statement of [
    'Python parity oracle may be deleted.',
    'The accepted evidence is bound to commit 41665a96cf67eb82cbe02f83abbbe2b79b100e48.',
    'The rollback path is TS_backend_refactor plus CUT-003 restore-from-backup evidence.',
    'Known limitations: Windows x64 only; unsigned, unpublished, undeployed; macOS unproven; CUT-012 clean-clone verification pending.'
  ]) {
    verify(authorization.includes(statement), `authorization statement missing: ${statement}`)
  }

  const movedAssets = [
    {
      path: 'resources/audience-presets/room-6657/room_6657_generation_skill.json',
      sha256: '736d058f0be4caf5d8733a65a1d3f543731e761083f55eabab756af8c5b60d8f'
    },
    {
      path: 'resources/audience-presets/room-6657/room_6657_style_profile.json',
      sha256: '9b24082c180a263d55aa90ca0796b9634b41ebe40bc1f8fe4700d5b6952f7043'
    }
  ] as const
  const movedAssetIdentities = await Promise.all(
    movedAssets.map((asset) => fileIdentity(join(repositoryRoot, asset.path), asset.path))
  )
  for (const [index, identity] of movedAssetIdentities.entries()) {
    verify(
      identity.sha256 === movedAssets[index]!.sha256,
      `retained asset changed: ${identity.path}`
    )
  }
  for (const oldPath of [
    'apps/backend/src/advx_backend/providers/model/room_6657_generation_skill.json',
    'apps/backend/src/advx_backend/providers/model/room_6657_style_profile.json'
  ]) {
    verify(
      !(await exists(oldPath)),
      `retained asset was not moved out of Python source: ${oldPath}`
    )
  }
  for (const retainedPath of [
    'apps/backend/README.md',
    'tests/e2e/cs2_viewer_runtime_recorded_evidence.json'
  ]) {
    verify(
      await exists(retainedPath),
      `language-neutral retained asset is missing: ${retainedPath}`
    )
  }

  const rootPackage = asRecord(await readJsonFile(join(repositoryRoot, 'package.json')), 'package')
  const scripts = asRecord(rootPackage.scripts, 'package.scripts')
  verify(!('test:migration-parity' in scripts), 'removed Python parity command remains active')
  verify(!('test:bck-011' in scripts), 'removed Python BCK-011 parity command remains active')

  const mainText = await readFile(join(repositoryRoot, 'apps/desktop/src/main/index.ts'), 'utf8')
  verify(
    !mainText.includes('createPythonBackendProcessOptions'),
    'Electron Main still imports or constructs the Python supervisor adapter'
  )
  verify(
    mainText.includes('Python parity oracle 已移除'),
    'legacy runtime selection does not fail clearly after Python removal'
  )
  verify(
    !(await exists('apps/desktop/src/main/backend/backend-process-python.ts')),
    'Python supervisor adapter still exists'
  )

  const acceptedEvidence = asRecord(readiness.acceptedEvidence, 'acceptedEvidence')
  const tst002 = asRecord(acceptedEvidence.tst002, 'acceptedEvidence.tst002')
  verify(
    tst002.rows === 47 && tst002.currentTestModules === 14,
    'accepted TST-002 coverage changed'
  )
  verify(tst002.unmapped === 0, 'accepted TST-002 evidence contains unmapped behavior')
  verify(
    Array.isArray(tst002.missingTestModules) && tst002.missingTestModules.length === 0,
    'accepted TST-002 evidence contains missing test modules'
  )
  verify(
    Array.isArray(tst002.staleLedgerModules) && tst002.staleLedgerModules.length === 0,
    'accepted TST-002 evidence contains stale test modules'
  )

  const sourceIdentities = await Promise.all(
    sourcePaths.map((path) => fileIdentity(join(repositoryRoot, path), path))
  )
  const sourceAggregateSha256 = createHash('sha256')
    .update(sourceIdentities.map((identity) => `${identity.path}:${identity.sha256}`).join('\n'))
    .digest('hex')
  const result = {
    schemaVersion: 1,
    taskId: 'CUT-008',
    status: 'passed',
    authorizationCommit: '41665a96cf67eb82cbe02f83abbbe2b79b100e48',
    trackedCandidatesRemoved: trackedCandidatePaths.length,
    worktreeOnlyCandidatesRemoved: worktreeOnlyCandidates.length,
    cut009HoldsPreserved: cut009Holds.length,
    tst002: {
      rows: tst002.rows,
      currentTestModules: tst002.currentTestModules,
      unmapped: tst002.unmapped
    },
    retainedAssets: movedAssetIdentities,
    readinessIdentity,
    rollback: 'TS_backend_refactor plus CUT-003 restore-from-backup evidence',
    limitations: [
      'Windows x64 only',
      'unsigned, unpublished, undeployed',
      'macOS unproven',
      'CUT-012 clean-clone verification pending'
    ],
    sourceAggregateSha256,
    sourceIdentities
  }
  await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
  return {
    artifact: relative(repositoryRoot, join(artifactRoot, 'result.json')).replace(/\\/g, '/'),
    trackedCandidatesRemoved: trackedCandidatePaths.length,
    worktreeOnlyCandidatesRemoved: worktreeOnlyCandidates.length,
    cut009HoldsPreserved: cut009Holds.length,
    sourceFiles: sourceIdentities.length,
    sourceAggregateSha256
  }
})
