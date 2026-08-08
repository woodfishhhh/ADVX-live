import { readFile, readdir } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import {
  fileIdentity,
  parseNamedArguments,
  requireSafeArtifactRoot,
  writeJsonAtomic
} from './evidence-script-runtime.ts'

const repositoryRoot = resolve(import.meta.dir, '..')
const runbookPath = join(
  repositoryRoot,
  'docs',
  'migrations',
  'typescript-bun',
  'PKG-012-SIGNED-UPDATE-ROLLBACK-RUNBOOK.md'
)
const limitationPath = join(
  repositoryRoot,
  'docs',
  'migrations',
  'typescript-bun',
  'PKG-011-MACOS-LIMITATION-DECISION.md'
)
const rootPackagePath = join(repositoryRoot, 'package.json')
const desktopPackagePath = join(repositoryRoot, 'apps', 'desktop', 'package.json')
const builderConfigPath = join(repositoryRoot, 'apps', 'desktop', 'electron-builder.yml')
const workflowPath = join(repositoryRoot, '.github', 'workflows', 'bun-ci.yml')
const desktopSourceRoot = join(repositoryRoot, 'apps', 'desktop', 'src')
const args = parseNamedArguments(Bun.argv.slice(2), new Set(['--artifact-root']))
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ??
    join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'pkg-012'),
  repositoryRoot
)

type PackageManifest = Readonly<{
  scripts?: Readonly<Record<string, string>>
  dependencies?: Readonly<Record<string, string>>
  devDependencies?: Readonly<Record<string, string>>
}>

const requiredRunbookText = [
  '> Status: `PLANNING ONLY - AUTO-UPDATE DISABLED`',
  '> Current release scope: Windows x64 only',
  '## Signing And Notarization Identities',
  '## Secret Custody',
  '## CI Authority',
  '## Artifact Promotion',
  '## Update Metadata And Channel Policy',
  '## Backend/Desktop Compatibility',
  '## Staged Rollout',
  '## Rollback And Database Compatibility',
  '## Incident Stop Switch',
  '## Evidence Required Before Publish',
  '## Non-Actions',
  '`PKG-011` is an authorized `ACCEPTED_LIMITATION`',
  'must not be used to claim, sign, notarize, upload, publish, or advertise a macOS artifact',
  'The Electron application and its bundled Bun backend are one atomic release unit',
  'Routine updater-driven downgrade is forbidden',
  'authenticated `/version` handshake',
  'HTTP v3, realtime v4 with negotiated v3/v4 support, and schema package v1',
  'SQLite Online Backup API evidence followed by stopped-backend copy-and-swap',
  'Never run an older binary against a newer, incompatible database',
  'After Python deletion, rollback uses the `TS_backend_refactor` branch history and the `CUT-003` restore-from-backup procedure',
  'server-side removal or freezing of the affected channel metadata pointer',
  'explicit human publish authorization',
  'does not add an updater library'
] as const

const updaterMarkers = [
  /\bautoUpdater\b/,
  /electron-updater/,
  /update-electron-app/,
  /\bcheckForUpdates\b/,
  /\bsetFeedURL\b/,
  /\bquitAndInstall\b/
] as const

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function packageDependencies(manifest: PackageManifest): ReadonlySet<string> {
  return new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {})
  ])
}

async function sourceFiles(root: string): Promise<string[]> {
  const files: string[] = []
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)))
    else if (entry.isFile() && /\.(?:cjs|js|jsx|mjs|ts|tsx)$/.test(entry.name)) files.push(path)
  }
  return files.sort()
}

function findUpdaterMarkers(path: string, contents: string): string[] {
  return updaterMarkers
    .filter((marker) => marker.test(contents))
    .map((marker) => `${relative(repositoryRoot, path).replaceAll('\\', '/')}: ${marker.source}`)
}

const failures: string[] = []
const runbook = await readFile(runbookPath, 'utf8')
const normalizedRunbook = normalizeWhitespace(runbook)
for (const requiredText of requiredRunbookText) {
  if (!normalizedRunbook.includes(normalizeWhitespace(requiredText))) {
    failures.push(`runbook missing ${JSON.stringify(requiredText)}`)
  }
}
if (/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(runbook)) {
  failures.push('runbook contains private-key material')
}

const limitation = await readFile(limitationPath, 'utf8')
if (!limitation.includes('> Status: `ACCEPTED_LIMITATION`')) {
  failures.push('PKG-011 is not recorded as ACCEPTED_LIMITATION')
}
if (!limitation.includes('> Current release scope: Windows x64 only')) {
  failures.push('PKG-011 does not retain the Windows x64-only release scope')
}

const rootPackage = JSON.parse(await readFile(rootPackagePath, 'utf8')) as PackageManifest
const desktopPackage = JSON.parse(await readFile(desktopPackagePath, 'utf8')) as PackageManifest
const packageCommand = rootPackage.scripts?.['package:desktop'] ?? ''
const desktopPackageCommand = desktopPackage.scripts?.['package:win:x64:dir'] ?? ''
if (
  !packageCommand.includes('package:win:x64:dir') ||
  !desktopPackageCommand.includes('electron-builder --win --x64 --dir')
) {
  failures.push('package:desktop must remain explicitly Windows x64')
}
if (/--(?:mac|publish)\b/.test(`${packageCommand}\n${desktopPackageCommand}`)) {
  failures.push('package:desktop must not build macOS or publish')
}
const desktopDependencies = packageDependencies(desktopPackage)
for (const forbiddenDependency of ['electron-updater', 'update-electron-app']) {
  if (desktopDependencies.has(forbiddenDependency)) {
    failures.push(`desktop package enables updater dependency ${forbiddenDependency}`)
  }
}

const builderConfig = await readFile(builderConfigPath, 'utf8')
if (/^publish\s*:/m.test(builderConfig)) {
  failures.push('electron-builder config enables publish metadata')
}

const workflow = await readFile(workflowPath, 'utf8')
if (!/^permissions:\s*\r?\n\s+contents:\s*read\s*$/m.test(workflow)) {
  failures.push('Bun CI must retain top-level contents: read authority')
}
if (/\b(?:contents|packages|id-token|attestations):\s*write\b/.test(workflow)) {
  failures.push('Bun CI has release-capable write authority')
}
if (/\b(?:action-gh-release|upload-release-asset|--publish)\b/.test(workflow)) {
  failures.push('Bun CI contains a release or publish action')
}

const sourceUpdaterFindings: string[] = []
for (const path of await sourceFiles(desktopSourceRoot)) {
  sourceUpdaterFindings.push(...findUpdaterMarkers(path, await readFile(path, 'utf8')))
}
failures.push(...sourceUpdaterFindings.map((finding) => `active updater marker: ${finding}`))

const reviewedFiles = await Promise.all([
  fileIdentity(
    runbookPath,
    'docs/migrations/typescript-bun/PKG-012-SIGNED-UPDATE-ROLLBACK-RUNBOOK.md'
  ),
  fileIdentity(
    limitationPath,
    'docs/migrations/typescript-bun/PKG-011-MACOS-LIMITATION-DECISION.md'
  ),
  fileIdentity(rootPackagePath, 'package.json'),
  fileIdentity(desktopPackagePath, 'apps/desktop/package.json'),
  fileIdentity(builderConfigPath, 'apps/desktop/electron-builder.yml'),
  fileIdentity(workflowPath, '.github/workflows/bun-ci.yml')
])
const result = {
  schemaVersion: 1,
  taskId: 'PKG-012',
  status: failures.length === 0 ? 'passed' : 'failed',
  evidenceClass: 'reviewed-inert-release-runbook',
  currentReleaseScope: 'Windows x64 only',
  autoUpdateEnabled: false,
  signingEnabled: false,
  publishEnabled: false,
  ciReleaseAuthority: false,
  productUpdaterMarkers: sourceUpdaterFindings,
  packageCommand,
  desktopPackageCommand,
  requiredRunbookClauses: requiredRunbookText.length,
  reviewedFiles,
  failures
}
await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
if (failures.length > 0) process.exit(1)
