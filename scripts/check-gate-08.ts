import { join, resolve } from 'node:path'

import {
  fileIdentity,
  parseNamedArguments,
  readJsonFile,
  requireSafeArtifactRoot,
  writeJsonAtomic
} from './evidence-script-runtime.ts'

type JsonRecord = Record<string, unknown>
type ArtifactExpectation = Readonly<{
  taskId: string
  relativePath: string
  expectedStatus: 'passed' | 'accepted_limitation'
}>
type Criterion = Readonly<{
  id: string
  claim: string
  passed: boolean
  evidence: readonly string[]
  detail: string
}>
type ReviewedFile = Readonly<{
  path: string
  sha256: string
  bytes: number
}>

const repositoryRoot = resolve(import.meta.dir, '..')
const args = parseNamedArguments(Bun.argv.slice(2), new Set(['--artifact-root']))
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ??
    join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'gate-08'),
  repositoryRoot
)
const master = await Bun.file(
  join(repositoryRoot, 'docs', 'migrations', 'typescript-bun', '00-MASTER-PLAN.md')
).text()
const evidence = await Bun.file(
  join(repositoryRoot, 'docs', 'migrations', 'typescript-bun', 'EVIDENCE.md')
).text()
const decisionPath = join(
  repositoryRoot,
  'docs',
  'migrations',
  'typescript-bun',
  'GATE-08-PACKAGING-SECURITY-DECISION.md'
)
const decision = await Bun.file(decisionPath).text()

const artifactExpectations: readonly ArtifactExpectation[] = [
  expectation('PKG-001', 'PKG-001/pkg-001-checker-root-20260807-093/result.json'),
  expectation('PKG-002', 'PKG-002/pkg-002-checker-root-20260807-095/result.json'),
  expectation('PKG-003', 'PKG-003/pkg-003-checker-root-20260807-097/result.json'),
  expectation('PKG-004', 'PKG-004/pkg-004-checker-root-20260807-099/result.json'),
  expectation('PKG-005', 'PKG-005/pkg-005-checker-root-20260807-101/result.json'),
  expectation('PKG-006', 'PKG-006/pkg-006-checker-root-20260807-103/result.json'),
  expectation('PKG-007', 'PKG-007/pkg-007-checker-root-20260807-106/result.json'),
  expectation('PKG-008', 'PKG-008/pkg-008-checker-root-20260807-108/result.json'),
  expectation('PKG-009', 'PKG-009/pkg-009-checker-root-20260807-110/result.json'),
  expectation('PKG-010', 'PKG-010/pkg-010-checker-root-20260807-112/result.json'),
  expectation(
    'PKG-011',
    'PKG-011/pkg-011-limitation-checker-root-20260808-116/result.json',
    'accepted_limitation'
  ),
  expectation('PKG-012', 'PKG-012/pkg-012-checker-root-20260808-118/result.json')
]

const artifactResults = new Map<string, JsonRecord>()
const artifactFailures: string[] = []
const artifactIdentities = []
for (const expectation of artifactExpectations) {
  const path = join(repositoryRoot, '.omx', 'artifacts', 'typescript-bun', expectation.relativePath)
  const result = asRecord(await readJsonFile(path))
  artifactResults.set(expectation.taskId, result)
  if (result.taskId !== expectation.taskId && result.task_id !== expectation.taskId) {
    artifactFailures.push(`${expectation.taskId}: artifact task identity mismatch`)
  }
  if (result.status !== expectation.expectedStatus) {
    artifactFailures.push(
      `${expectation.taskId}: expected ${expectation.expectedStatus}, received ${String(result.status)}`
    )
  }
  artifactIdentities.push(
    await fileIdentity(path, `.omx/artifacts/typescript-bun/${expectation.relativePath}`)
  )
}

const allowedSemanticDriftPaths = new Set(['package.json'])
const boundaryFailures = [
  ...(await reviewedFileFailures(
    artifactResults.get('PKG-011'),
    'PKG-011',
    allowedSemanticDriftPaths
  )),
  ...(await reviewedFileFailures(
    artifactResults.get('PKG-012'),
    'PKG-012',
    allowedSemanticDriftPaths
  ))
]
const rootPackage = asRecord(await readJsonFile(join(repositoryRoot, 'package.json')))
const rootScripts = asRecord(rootPackage.scripts)
const currentPackageCommand =
  typeof rootScripts['package:desktop'] === 'string' ? rootScripts['package:desktop'] : ''
const packageBoundaryFailures: string[] = []
if (currentPackageCommand !== artifactResults.get('PKG-012')?.packageCommand) {
  packageBoundaryFailures.push('package.json: package:desktop drifted from PKG-012')
}
if (currentPackageCommand !== artifactResults.get('PKG-011')?.currentReleaseCommand) {
  packageBoundaryFailures.push('package.json: package:desktop drifted from PKG-011')
}
if (
  !currentPackageCommand.includes('electron-builder --win --x64 --dir') ||
  /--(?:mac|publish)\b/.test(currentPackageCommand)
) {
  packageBoundaryFailures.push('package.json: release command is not inert Windows x64')
}
if (/"(?:electron-updater|update-electron-app)"\s*:/.test(JSON.stringify(rootPackage))) {
  packageBoundaryFailures.push('package.json: updater dependency is enabled')
}
const decisionCriteria = [
  'compile-manifest',
  'autoload-isolation',
  'platform-matrix',
  'packaged-assets',
  'installed-data',
  'lifecycle-orphans',
  'fuses-integrity',
  'crash-boundary',
  'security-reports',
  'installed-pipeline',
  'external-platform-condition',
  'signed-update-inert',
  'independent-review'
] as const
const decisionFailures = decisionCriteria
  .filter((id) => !decision.includes(`| \`${id}\` |`))
  .map((id) => `decision is missing criterion ${id}`)

const pkgDone = [
  'PKG-001',
  'PKG-002',
  'PKG-003',
  'PKG-004',
  'PKG-005',
  'PKG-006',
  'PKG-007',
  'PKG-008',
  'PKG-009',
  'PKG-010',
  'PKG-012'
] as const
const terminalTasksPassed =
  pkgDone.every((taskId) => taskStatus(master, taskId) === 'DONE') &&
  taskStatus(master, 'PKG-011') === 'ACCEPTED_LIMITATION'
const artifactsPassed = artifactFailures.length === 0
const acceptedBoundariesCurrent =
  boundaryFailures.length === 0 && packageBoundaryFailures.length === 0
const allTaskEvidenceIndependent = artifactExpectations.every((item) =>
  item.taskId === 'PKG-011'
    ? checkerAccepted(evidence, item.taskId, 'ACCEPTED_LIMITATION')
    : checkerAccepted(evidence, item.taskId, 'DONE')
)
const externalConditionPassed =
  /\| `GATE-08` \| `PKG-011` \| `DONE` or `ACCEPTED_LIMITATION` \|/.test(master) &&
  taskStatus(master, 'PKG-011') === 'ACCEPTED_LIMITATION' &&
  artifactResults.get('PKG-011')?.status === 'accepted_limitation' &&
  artifactResults.get('PKG-011')?.authorization !== undefined
const pkg012Inert =
  artifactResults.get('PKG-012')?.status === 'passed' &&
  artifactResults.get('PKG-012')?.autoUpdateEnabled === false &&
  artifactResults.get('PKG-012')?.signingEnabled === false &&
  artifactResults.get('PKG-012')?.publishEnabled === false &&
  artifactResults.get('PKG-012')?.ciReleaseAuthority === false

const criteria: Criterion[] = [
  criterion(
    'compile-manifest',
    'Compile manifest is reproducible and diagnosable',
    taskAccepted('PKG-001'),
    ['PKG-001']
  ),
  criterion(
    'autoload-isolation',
    'Compiled Bun rejects ambient startup inputs',
    taskAccepted('PKG-001'),
    ['PKG-001']
  ),
  criterion(
    'platform-matrix',
    'Current platform claims are locked and narrowed',
    taskAccepted('PKG-002') && externalConditionPassed,
    ['PKG-002', 'PKG-011']
  ),
  criterion(
    'packaged-assets',
    'Packaged assets resolve from read-only resources',
    taskAccepted('PKG-003') && taskAccepted('PKG-004'),
    ['PKG-003', 'PKG-004']
  ),
  criterion(
    'installed-data',
    'Installed writes stay under user-data paths',
    taskAccepted('PKG-005'),
    ['PKG-005']
  ),
  criterion(
    'lifecycle-orphans',
    'Lifecycle and uninstall leave no backend orphan',
    taskAccepted('PKG-006') && taskAccepted('PKG-010'),
    ['PKG-006', 'PKG-010']
  ),
  criterion(
    'fuses-integrity',
    'Electron fuses and resource integrity pass',
    taskAccepted('PKG-007'),
    ['PKG-007']
  ),
  criterion(
    'crash-boundary',
    'Crash evidence is local, bounded, and upload-disabled',
    taskAccepted('PKG-008'),
    ['PKG-008']
  ),
  criterion(
    'security-reports',
    'Security, dependency, license, SBOM, and artifact reports pass',
    taskAccepted('PKG-009'),
    ['PKG-009']
  ),
  criterion(
    'installed-pipeline',
    'Installed Windows recorded pipeline passes',
    taskAccepted('PKG-010'),
    ['PKG-010']
  ),
  criterion(
    'external-platform-condition',
    'Windows-only accepted limitation satisfies the exact external condition',
    externalConditionPassed,
    ['PKG-011', 'Gate external-condition table']
  ),
  criterion(
    'signed-update-inert',
    'Signed-update work remains an inert reviewed runbook',
    pkg012Inert && acceptedBoundariesCurrent,
    ['PKG-012 current reviewed identities']
  ),
  criterion(
    'independent-review',
    'All Phase 08 task evidence is terminal and independently accepted',
    terminalTasksPassed &&
      artifactsPassed &&
      allTaskEvidenceIndependent &&
      decisionFailures.length === 0,
    ['PKG-001..012', 'EVIDENCE.md']
  )
]
const failures = [
  ...artifactFailures,
  ...boundaryFailures,
  ...packageBoundaryFailures,
  ...decisionFailures
]
const status = criteria.every((item) => item.passed) && failures.length === 0 ? 'passed' : 'failed'
const report = {
  schemaVersion: 1,
  taskId: 'GATE-08',
  status,
  evidenceClass: 'accepted-phase-evidence-aggregate',
  branch: await gitOutput(['branch', '--show-current']),
  head: await gitOutput(['rev-parse', 'HEAD']),
  currentReleaseScope: 'Windows x64 only',
  criteria,
  acceptedArtifacts: artifactIdentities,
  boundaryIdentityMismatches: boundaryFailures,
  allowedSemanticDrift: {
    path: 'package.json',
    reason: 'GATE-08 check command registration',
    packageCommand: currentPackageCommand,
    failures: packageBoundaryFailures
  },
  externalCondition: {
    taskId: 'PKG-011',
    allowedTerminalStatuses: ['DONE', 'ACCEPTED_LIMITATION'],
    actualTerminalStatus: taskStatus(master, 'PKG-011'),
    passed: externalConditionPassed
  },
  releaseSideEffects: {
    autoUpdateEnabled: false,
    signingEnabled: false,
    notarizationEnabled: false,
    publishingEnabled: false,
    deploymentEnabled: false
  },
  summary: {
    total: criteria.length,
    passed: criteria.filter((item) => item.passed).length,
    failed: criteria.filter((item) => !item.passed).length,
    acceptedArtifacts: artifactIdentities.length,
    failures: failures.length
  },
  limitations: [
    'Current release and installed-platform proof is Windows x64 only.',
    'The release artifact remains unsigned and automatic updates remain disabled.',
    'Python remains the local parity oracle for Phase 09 rollback.'
  ],
  failures
}
await writeJsonAtomic(join(artifactRoot, 'gate-08-review.json'), report)
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
if (status !== 'passed') process.exit(1)

function expectation(
  taskId: string,
  relativePath: string,
  expectedStatus: ArtifactExpectation['expectedStatus'] = 'passed'
): ArtifactExpectation {
  return { taskId, relativePath, expectedStatus }
}

function criterion(
  id: string,
  claim: string,
  passed: boolean,
  evidence: readonly string[]
): Criterion {
  return {
    id,
    claim,
    passed,
    evidence,
    detail: passed ? 'accepted evidence present and current' : 'required gate evidence failed'
  }
}

function taskStatus(masterText: string, taskId: string): string | null {
  const match = masterText.match(new RegExp('^\\| `' + taskId + '` \\| `([^`]+)` \\|', 'm'))
  return match?.[1] ?? null
}

function taskAccepted(taskId: string): boolean {
  return (
    taskStatus(master, taskId) === 'DONE' &&
    artifactResults.get(taskId)?.status === 'passed' &&
    checkerAccepted(evidence, taskId, 'DONE')
  )
}

function evidenceSections(evidenceText: string, taskId: string): string[] {
  const heading = new RegExp(`^### ${taskId} /[^\\n]*\\n`, 'gm')
  const sections: string[] = []
  for (const match of evidenceText.matchAll(heading)) {
    const start = (match.index ?? 0) + match[0].length
    const remainder = evidenceText.slice(start)
    const nextHeading = remainder.search(/^### /m)
    sections.push(nextHeading === -1 ? remainder : remainder.slice(0, nextHeading))
  }
  return sections
}

function checkerAccepted(
  evidenceText: string,
  taskId: string,
  terminalStatus: 'DONE' | 'ACCEPTED_LIMITATION'
): boolean {
  return evidenceSections(evidenceText, taskId).some(
    (section) =>
      section.includes(`- Status: \`${terminalStatus}\``) &&
      section.includes('- Checker participated in implementation: `false`') &&
      section.includes('- Checker run/context ID:')
  )
}

async function reviewedFileFailures(
  result: JsonRecord | undefined,
  taskId: string,
  ignoredPaths: ReadonlySet<string> = new Set()
): Promise<string[]> {
  const reviewedFiles = Array.isArray(result?.reviewedFiles) ? result.reviewedFiles : []
  if (reviewedFiles.length === 0) return [`${taskId}: reviewed file identities are missing`]
  const failures: string[] = []
  for (const value of reviewedFiles) {
    const expected = reviewedFile(value)
    if (expected === null) {
      failures.push(`${taskId}: reviewed file identity is invalid`)
      continue
    }
    if (ignoredPaths.has(expected.path)) continue
    const actual = await fileIdentity(resolve(repositoryRoot, expected.path), expected.path)
    if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) {
      failures.push(`${taskId}: reviewed source drifted: ${expected.path}`)
    }
  }
  return failures
}

function reviewedFile(value: unknown): ReviewedFile | null {
  const record = asRecord(value)
  return typeof record.path === 'string' &&
    typeof record.sha256 === 'string' &&
    typeof record.bytes === 'number'
    ? { path: record.path, sha256: record.sha256, bytes: record.bytes }
    : null
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}
}

async function gitOutput(args: readonly string[]): Promise<string> {
  const child = Bun.spawn(['git', ...args], {
    cwd: repositoryRoot,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'ignore',
    windowsHide: true
  })
  const output = await new Response(child.stdout).text()
  if ((await child.exited) !== 0) throw new Error(`git ${args.join(' ')} failed`)
  return output.trim()
}
