import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, readdir, stat } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'

import {
  fileIdentity,
  parseNamedArguments,
  requireSafeArtifactRoot,
  SCRIPT_EXIT,
  ScriptError,
  writeJsonAtomic
} from './evidence-script-runtime.ts'

const repositoryRoot = resolve(import.meta.dir, '..')
const args = parseNamedArguments(Bun.argv.slice(2), new Set(['--artifact-root']))
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ??
    join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'cut-012-security'),
  repositoryRoot
)

type JsonRecord = Record<string, unknown>
type InstalledPackage = Readonly<{
  name: string
  version: string
  license: string
  path: string
}>

const licenseAllowlist = new Set([
  '0BSD',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MPL-2.0',
  'Python-2.0',
  'Unlicense',
  'WTFPL',
  'WTFPL OR ISC',
  '(AFL-2.1 OR BSD-3-Clause)',
  '(MIT OR Apache-2.0)',
  '(MIT OR CC0-1.0)',
  '(WTFPL OR MIT)'
])
const directLicenseAllowlist = new Set(['Apache-2.0', 'BSD-3-Clause', 'ISC', 'MIT'])
const lifecycleKeys = [
  'preinstall',
  'install',
  'postinstall',
  'prepare',
  'prepublish',
  'prepublishOnly'
] as const
const textExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.lock',
  '.mjs',
  '.md',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml'
])

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScriptError(SCRIPT_EXIT.verificationFailed, message)
}

async function runCommand(
  command: string,
  commandArgs: readonly string[]
): Promise<Readonly<{ exitCode: number; stdout: string; stderr: string }>> {
  const child = Bun.spawn([command, ...commandArgs], {
    cwd: repositoryRoot,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true
  })
  const stdout = new Response(child.stdout).text()
  const stderr = new Response(child.stderr).text()
  return { exitCode: await child.exited, stdout: await stdout, stderr: await stderr }
}

function packageLicense(manifest: JsonRecord): string {
  if (typeof manifest.license === 'string') return manifest.license.trim()
  if (manifest.license && typeof manifest.license === 'object') {
    const type = (manifest.license as JsonRecord).type
    if (typeof type === 'string') return type.trim()
  }
  if (Array.isArray(manifest.licenses)) {
    const licenses = manifest.licenses
      .map((entry) =>
        typeof entry === 'string'
          ? entry
          : entry && typeof entry === 'object' && typeof (entry as JsonRecord).type === 'string'
            ? String((entry as JsonRecord).type)
            : ''
      )
      .filter(Boolean)
    if (licenses.length > 0) return licenses.join(' OR ')
  }
  return 'UNKNOWN'
}

async function collectInstalledPackages(): Promise<readonly InstalledPackage[]> {
  const packages = new Map<string, InstalledPackage>()
  const visitedModuleRoots = new Set<string>()

  async function collectPackage(packageRoot: string): Promise<void> {
    try {
      const manifest = JSON.parse(
        await readFile(join(packageRoot, 'package.json'), 'utf8')
      ) as JsonRecord
      if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') return
      const record = {
        name: manifest.name,
        version: manifest.version,
        license: packageLicense(manifest),
        path: relative(repositoryRoot, packageRoot).replaceAll('\\', '/')
      }
      packages.set(`${record.name}@${record.version}`, record)
      if (!(await lstat(packageRoot)).isSymbolicLink()) {
        await visitNodeModules(join(packageRoot, 'node_modules'))
      }
    } catch {
      // Optional packages and workspace links may not expose a package manifest on this platform.
    }
  }

  async function visitNodeModules(moduleRoot: string): Promise<void> {
    const canonical = resolve(moduleRoot)
    if (visitedModuleRoots.has(canonical)) return
    visitedModuleRoots.add(canonical)
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(moduleRoot, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === '.bin' || entry.name === '.bun' || entry.name.startsWith('.cache'))
        continue
      const entryPath = join(moduleRoot, entry.name)
      if (entry.name.startsWith('@') && entry.isDirectory()) {
        for (const scoped of await readdir(entryPath, { withFileTypes: true })) {
          if (scoped.isDirectory() || scoped.isSymbolicLink()) {
            await collectPackage(join(entryPath, scoped.name))
          }
        }
      } else if (entry.isDirectory() || entry.isSymbolicLink()) {
        await collectPackage(entryPath)
      }
    }
  }

  for (const moduleRoot of [
    'node_modules',
    'apps/backend-bun/node_modules',
    'apps/desktop/node_modules',
    'packages/contracts/node_modules'
  ]) {
    await visitNodeModules(join(repositoryRoot, moduleRoot))
  }
  try {
    for (const storeEntry of await readdir(join(repositoryRoot, 'node_modules', '.bun'), {
      withFileTypes: true
    })) {
      if (storeEntry.isDirectory()) {
        await visitNodeModules(
          join(repositoryRoot, 'node_modules', '.bun', storeEntry.name, 'node_modules')
        )
      }
    }
  } catch {
    // A missing Bun install store is reported by the empty dependency assertion below.
  }
  return [...packages.values()].sort((left, right) =>
    `${left.name}@${left.version}:${left.path}`.localeCompare(
      `${right.name}@${right.version}:${right.path}`
    )
  )
}

async function trackedSecretScan(): Promise<
  Readonly<{
    filesScanned: number
    findings: readonly JsonRecord[]
  }>
> {
  const tracked = await runCommand('git', ['ls-files', '-z'])
  assertCondition(tracked.exitCode === 0, `git ls-files failed: ${tracked.stderr}`)
  const patterns = [
    { id: 'private-key', expression: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
    { id: 'aws-access-key', expression: /\bAKIA[0-9A-Z]{16}\b/g },
    { id: 'github-token', expression: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
    { id: 'openai-token', expression: /\b(?:sk|rk)-[A-Za-z0-9]{20,}\b/g },
    { id: 'slack-token', expression: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g }
  ] as const
  let filesScanned = 0
  const findings: JsonRecord[] = []
  for (const trackedPath of tracked.stdout.split('\0').filter(Boolean)) {
    if (!textExtensions.has(extname(trackedPath).toLowerCase())) continue
    const path = join(repositoryRoot, trackedPath)
    const metadata = await stat(path)
    if (metadata.size > 8 * 1024 * 1024) continue
    const bytes = await readFile(path)
    if (bytes.includes(0)) continue
    filesScanned += 1
    const text = bytes.toString('utf8')
    for (const pattern of patterns) {
      pattern.expression.lastIndex = 0
      for (const match of text.matchAll(pattern.expression)) {
        const offset = match.index ?? 0
        findings.push({
          pattern: pattern.id,
          path: trackedPath.replaceAll('\\', '/'),
          line: text.slice(0, offset).split('\n').length
        })
      }
    }
  }
  return { filesScanned, findings }
}

async function treeSummary(
  root: string,
  displayRoot: string
): Promise<Readonly<{ root: string; fileCount: number; bytes: number; aggregateSha256: string }>> {
  const identities: Array<Awaited<ReturnType<typeof fileIdentity>>> = []
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name)
    )) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) {
        identities.push(await fileIdentity(path, relative(root, path).replaceAll('\\', '/')))
      }
    }
  }
  await visit(root)
  const aggregate = createHash('sha256')
  for (const identity of identities) {
    aggregate.update(`${identity.path}\0${identity.sha256}\0${identity.bytes}\0`)
  }
  return {
    root: displayRoot,
    fileCount: identities.length,
    bytes: identities.reduce((total, identity) => total + identity.bytes, 0),
    aggregateSha256: aggregate.digest('hex')
  }
}

function lockIdentity(value: unknown): Readonly<{ name: string; version: string }> | null {
  if (!Array.isArray(value) || typeof value[0] !== 'string') return null
  const identity = value[0]
  const separator = identity.lastIndexOf('@')
  if (separator <= 0) return null
  const name = identity.slice(0, separator)
  const version = identity.slice(separator + 1)
  if (!name || !version || version.startsWith('workspace:')) return null
  return { name, version }
}

const rootManifest = JSON.parse(
  await readFile(join(repositoryRoot, 'package.json'), 'utf8')
) as JsonRecord
const lock = Bun.JSONC.parse(await readFile(join(repositoryRoot, 'bun.lock'), 'utf8')) as JsonRecord
const lockPackages = (lock.packages ?? {}) as JsonRecord
const lockComponents = Array.from(
  new Map(
    Object.values(lockPackages)
      .map(lockIdentity)
      .filter(
        (identity): identity is Readonly<{ name: string; version: string }> => identity !== null
      )
      .map((identity) => [`${identity.name}@${identity.version}`, identity])
  ).values()
).sort((left, right) =>
  `${left.name}@${left.version}`.localeCompare(`${right.name}@${right.version}`)
)
assertCondition(lockComponents.length > 0, 'bun.lock did not yield resolved components')

const installedPackages = await collectInstalledPackages()
assertCondition(installedPackages.length > 0, 'installed Bun dependency graph is empty')
const externalInstalledPackages = installedPackages.filter(
  (entry) => !entry.name.startsWith('@advx/')
)
const licenseExpressions = Array.from(
  new Set(externalInstalledPackages.map((entry) => entry.license))
).sort()
const unreviewedLicenses = licenseExpressions.filter((license) => !licenseAllowlist.has(license))
assertCondition(
  unreviewedLicenses.length === 0,
  `unreviewed installed license expressions: ${unreviewedLicenses.join(', ')}; packages: ${externalInstalledPackages
    .filter((entry) => unreviewedLicenses.includes(entry.license))
    .map((entry) => `${entry.name}@${entry.version}`)
    .join(', ')}`
)

const workspaceManifests = await Promise.all(
  [
    'package.json',
    'apps/backend-bun/package.json',
    'apps/desktop/package.json',
    'packages/contracts/package.json'
  ].map(
    async (path) => JSON.parse(await readFile(join(repositoryRoot, path), 'utf8')) as JsonRecord
  )
)
const directNames = new Set<string>()
for (const manifest of workspaceManifests) {
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const name of Object.keys((manifest[section] as JsonRecord | undefined) ?? {})) {
      if (!name.startsWith('@advx/')) directNames.add(name)
    }
  }
}
const directPackages = installedPackages.filter((entry) => directNames.has(entry.name))
const missingDirectPackages = [...directNames].filter(
  (name) => !directPackages.some((entry) => entry.name === name)
)
const directPolicyFailures = directPackages.filter(
  (entry) => !directLicenseAllowlist.has(entry.license)
)
assertCondition(
  missingDirectPackages.length === 0,
  `direct packages missing: ${missingDirectPackages.join(', ')}`
)
assertCondition(
  directPolicyFailures.length === 0,
  `direct dependency license policy failed: ${directPolicyFailures.map((entry) => `${entry.name}:${entry.license}`).join(', ')}`
)

const secretScan = await trackedSecretScan()
assertCondition(
  secretScan.findings.length === 0,
  `tracked secret scan found token-shaped values: ${JSON.stringify(secretScan.findings)}`
)
const audit = await runCommand(process.execPath, ['audit', '--json'])
assertCondition(audit.exitCode === 0, `bun audit failed: ${audit.stderr || audit.stdout}`)
const auditJson = JSON.parse(audit.stdout.trim() || '{}') as JsonRecord
assertCondition(Object.keys(auditJson).length === 0, 'bun audit returned advisories')
const untrusted = await runCommand(process.execPath, ['pm', 'untrusted'])
assertCondition(
  untrusted.exitCode === 0,
  `bun pm untrusted failed: ${untrusted.stderr || untrusted.stdout}`
)
assertCondition(
  /Found 0 untrusted dependencies with scripts\./.test(`${untrusted.stdout}\n${untrusted.stderr}`),
  'Bun reports untrusted dependency lifecycle scripts'
)
const trustedDependencies =
  (rootManifest.trustedDependencies as readonly string[] | undefined) ?? []
assertCondition(trustedDependencies.length === 0, 'root trustedDependencies must remain empty')

const workflowPath = join(repositoryRoot, '.github', 'workflows', 'bun-ci.yml')
const workflow = await readFile(workflowPath, 'utf8')
assertCondition(
  /^on:\r?\n  workflow_dispatch:\s*$/m.test(workflow),
  'CI must remain workflow_dispatch-only'
)
assertCondition(
  !/^  (?:push|pull_request|pull_request_target|schedule):/m.test(workflow),
  'automatic CI trigger is enabled before migration completion'
)

const installedByIdentity = new Map(
  installedPackages.map((entry) => [`${entry.name}@${entry.version}`, entry] as const)
)
const sbom = {
  bomFormat: 'CycloneDX',
  specVersion: '1.5',
  serialNumber: `urn:uuid:${randomUUID()}`,
  version: 1,
  metadata: {
    timestamp: new Date().toISOString(),
    component: { type: 'application', name: 'advx-live', version: rootManifest.version }
  },
  components: lockComponents.map((component) => {
    const installed = installedByIdentity.get(`${component.name}@${component.version}`)
    return {
      type: 'library',
      name: component.name,
      version: component.version,
      'bom-ref': `pkg:npm/${encodeURIComponent(component.name)}@${encodeURIComponent(component.version)}`,
      ...(installed ? { licenses: [{ expression: installed.license }] } : {})
    }
  })
}

const generatedRoots = [
  { root: join(repositoryRoot, 'apps', 'backend-bun', 'dist'), display: 'apps/backend-bun/dist' },
  { root: join(repositoryRoot, 'apps', 'desktop', 'out'), display: 'apps/desktop/out' },
  {
    root: join(repositoryRoot, 'apps', 'desktop', 'release', 'win-unpacked'),
    display: 'apps/desktop/release/win-unpacked'
  }
] as const
const generatedTrees = []
for (const generated of generatedRoots) {
  generatedTrees.push(await treeSummary(generated.root, generated.display))
}
const criticalPaths = [
  'bun.lock',
  'package.json',
  'apps/backend-bun/dist/advx-backend-bun.exe',
  'apps/desktop/release/win-unpacked/ADVX Live.exe',
  'apps/desktop/release/win-unpacked/resources/app.asar',
  'apps/desktop/release/win-unpacked/resources/backend/advx-backend-bun.exe'
] as const
const criticalArtifacts = await Promise.all(
  criticalPaths.map((path) => fileIdentity(join(repositoryRoot, path), path))
)

await writeJsonAtomic(join(artifactRoot, 'secret-scan.json'), {
  schemaVersion: 1,
  status: 'passed',
  scanner: 'tracked-high-confidence-token-scan',
  ...secretScan
})
await writeJsonAtomic(join(artifactRoot, 'bun-audit.json'), {
  schemaVersion: 1,
  status: 'passed',
  command: 'bun audit --json',
  advisories: auditJson
})
await writeJsonAtomic(join(artifactRoot, 'license-report.json'), {
  schemaVersion: 1,
  status: 'passed',
  policy: {
    directAllowlist: [...directLicenseAllowlist].sort(),
    transitiveAllowlist: [...licenseAllowlist].sort()
  },
  installedPackageCount: installedPackages.length,
  licenseExpressions,
  directPackages,
  missingDirectPackages,
  directPolicyFailures,
  packages: installedPackages
})
await writeJsonAtomic(join(artifactRoot, 'sbom.cdx.json'), sbom)
await writeJsonAtomic(join(artifactRoot, 'lifecycle-review.json'), {
  schemaVersion: 1,
  status: 'passed',
  trustedDependencies,
  command: 'bun pm untrusted',
  output: `${untrusted.stdout}\n${untrusted.stderr}`.trim(),
  lifecycleKeys
})
const reportPaths = [
  'secret-scan.json',
  'bun-audit.json',
  'license-report.json',
  'sbom.cdx.json',
  'lifecycle-review.json'
] as const
const reportIdentities = await Promise.all(
  reportPaths.map((path) => fileIdentity(join(artifactRoot, path), path))
)
await writeJsonAtomic(join(artifactRoot, 'artifact-manifest.json'), {
  schemaVersion: 1,
  taskId: 'CUT-012',
  status: 'passed',
  target: { platform: process.platform, arch: process.arch, signing: 'unsigned local evidence' },
  ci: { automaticTriggersEnabled: false, trigger: 'workflow_dispatch' },
  sourceInputs: await Promise.all(
    [
      '.gitattributes',
      'bun.lock',
      'package.json',
      'apps/backend-bun/package.json',
      'apps/desktop/package.json',
      'packages/contracts/package.json',
      'apps/desktop/electron-builder.yml'
    ].map((path) => fileIdentity(join(repositoryRoot, path), path))
  ),
  criticalArtifacts,
  generatedTrees,
  securityReports: reportIdentities,
  manifestSelfHashExcluded: true
})
const artifactManifestIdentity = await fileIdentity(
  join(artifactRoot, 'artifact-manifest.json'),
  'artifact-manifest.json'
)
const result = {
  schemaVersion: 1,
  taskId: 'CUT-012',
  evidenceClass: 'clean-clone-security-sbom-artifact',
  status: 'passed',
  target: { platform: process.platform, arch: process.arch },
  secretScan: { status: 'passed', filesScanned: secretScan.filesScanned, findings: 0 },
  bunAudit: { status: 'passed', advisoryCount: 0 },
  licenses: {
    status: 'passed',
    installedPackageCount: installedPackages.length,
    expressionCount: licenseExpressions.length,
    directPolicyFailures: 0
  },
  sbom: { format: 'CycloneDX', specVersion: '1.5', componentCount: lockComponents.length },
  lifecycle: { status: 'passed', trustedDependencies: 0, untrustedDependencies: 0 },
  ci: { automaticTriggersEnabled: false, trigger: 'workflow_dispatch' },
  generatedTrees,
  artifactManifest: artifactManifestIdentity
}
await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
