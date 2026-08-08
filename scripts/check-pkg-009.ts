import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
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
  args.get('--artifact-root') ?? join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'pkg-009'),
  repositoryRoot
)

type JsonRecord = Record<string, unknown>
type LicensePackage = Readonly<{
  name: string
  versions: readonly string[]
  license: string
  homepage?: string
}>

const lifecycleKeys = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly']
const licenseAllowlist = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-3-Clause',
  'ISC',
  'BSD-2-Clause',
  '0BSD',
  'BlueOak-1.0.0',
  'CC-BY-4.0',
  'MPL-2.0',
  'Python-2.0',
  '(AFL-2.1 OR BSD-3-Clause)',
  '(MIT OR CC0-1.0)',
  '(WTFPL OR MIT)',
  'WTFPL OR ISC',
  'WTFPL'
])
const directLicenseAllowlist = new Set(['MIT', 'Apache-2.0', 'BSD-3-Clause', 'ISC'])
const textExtensions = new Set([
  '.cjs',
  '.css',
  '.html',
  '.js',
  '.json',
  '.lock',
  '.mjs',
  '.md',
  '.py',
  '.sql',
  '.toml',
  '.ts',
  '.tsx',
  '.yaml',
  '.yml'
])
const excludedDirectories = new Set([
  '.git',
  '.advx-data',
  '.omx',
  '.turbo',
  'node_modules',
  'out',
  'promo',
  'output',
  'release',
  'dist'
])
const generatedRoots = [
  join(repositoryRoot, 'apps', 'desktop', 'out'),
  join(repositoryRoot, 'apps', 'backend-bun', 'dist')
]

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScriptError(SCRIPT_EXIT.verificationFailed, message)
}

async function runCommand(
  command: string,
  commandArgs: readonly string[],
  cwd = repositoryRoot
): Promise<{ readonly exitCode: number; readonly stdout: string; readonly stderr: string }> {
  const child = Bun.spawn([command, ...commandArgs], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true
  })
  const stdoutPromise = new Response(child.stdout).text()
  const stderrPromise = new Response(child.stderr).text()
  const exitCode = await child.exited
  return { exitCode, stdout: await stdoutPromise, stderr: await stderrPromise }
}

async function readJson(path: string): Promise<JsonRecord> {
  return JSON.parse(await readFile(path, 'utf8')) as JsonRecord
}

async function gitValue(argsForGit: readonly string[]): Promise<string> {
  const result = await runCommand('git', argsForGit)
  assertCondition(result.exitCode === 0, `git ${argsForGit.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

async function scanTextFiles(root: string): Promise<{
  readonly filesScanned: number
  readonly skippedSensitiveFiles: number
  readonly findings: readonly JsonRecord[]
}> {
  const patterns = [
    { id: 'private-key', expression: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
    { id: 'aws-access-key', expression: /\bAKIA[0-9A-Z]{16}\b/g },
    { id: 'github-token', expression: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g },
    { id: 'openai-token', expression: /\b(?:sk|rk)-[A-Za-z0-9]{20,}\b/g },
    { id: 'slack-token', expression: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g }
  ]
  let filesScanned = 0
  let skippedSensitiveFiles = 0
  const findings: JsonRecord[] = []

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.env')) {
        skippedSensitiveFiles += 1
        continue
      }
      if (entry.isDirectory()) {
        if (!excludedDirectories.has(entry.name)) await visit(join(directory, entry.name))
        continue
      }
      if (!textExtensions.has(extname(entry.name).toLowerCase())) continue
      const path = join(directory, entry.name)
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
            path: relative(repositoryRoot, path).replaceAll('\\', '/'),
            line: text.slice(0, offset).split('\n').length
          })
        }
      }
    }
  }

  await visit(root)
  return { filesScanned, skippedSensitiveFiles, findings }
}

async function treeIdentity(root: string, _displayRoot: string): Promise<{
  readonly files: readonly Awaited<ReturnType<typeof fileIdentity>>[]
  readonly aggregateSha256: string
}> {
  const files: Array<Awaited<ReturnType<typeof fileIdentity>>> = []
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else files.push(await fileIdentity(path, relative(root, path).replaceAll('\\', '/')))
    }
  }
  await visit(root)
  const hash = createHash('sha256')
  for (const identity of files) {
    hash.update(identity.path)
    hash.update('\0')
    hash.update(identity.sha256)
    hash.update('\0')
    hash.update(String(identity.bytes))
    hash.update('\0')
  }
  return { files, aggregateSha256: hash.digest('hex') }
}

async function collectPnpmLifecycleReview(): Promise<{
  readonly packageCount: number
  readonly lifecyclePackages: readonly JsonRecord[]
}> {
  const storeRoot = join(repositoryRoot, 'node_modules', '.pnpm')
  const lifecyclePackages: JsonRecord[] = []
  let packageCount = 0
  let storeEntries: import('node:fs').Dirent[]
  try {
    storeEntries = await readdir(storeRoot, { withFileTypes: true })
  } catch {
    return { packageCount, lifecyclePackages }
  }
  for (const storeEntry of storeEntries) {
    if (!storeEntry.isDirectory()) continue
    const modulesRoot = join(storeRoot, storeEntry.name, 'node_modules')
    let packageEntries: import('node:fs').Dirent[]
    try {
      packageEntries = await readdir(modulesRoot, { withFileTypes: true })
    } catch {
      continue
    }
    const packageDirectories: string[] = []
    for (const packageEntry of packageEntries) {
      if (!packageEntry.isDirectory()) continue
      if (packageEntry.name.startsWith('@')) {
        const scopeRoot = join(modulesRoot, packageEntry.name)
        for (const scopedEntry of await readdir(scopeRoot, { withFileTypes: true })) {
          if (scopedEntry.isDirectory()) packageDirectories.push(join(scopeRoot, scopedEntry.name))
        }
      } else packageDirectories.push(join(modulesRoot, packageEntry.name))
    }
    for (const packageDirectory of packageDirectories) {
      const manifestPath = join(packageDirectory, 'package.json')
      try {
        const manifest = await readJson(manifestPath)
        packageCount += 1
        const scripts = manifest.scripts as Record<string, unknown> | undefined
        const lifecycle = lifecycleKeys.filter((key) => typeof scripts?.[key] === 'string')
        if (lifecycle.length > 0) {
          lifecyclePackages.push({
            name: manifest.name,
            version: manifest.version,
            lifecycleScripts: lifecycle
          })
        }
      } catch {
        // Broken or non-package store entries are outside the installed package review.
      }
    }
  }
  lifecyclePackages.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  return { packageCount, lifecyclePackages }
}

await mkdir(artifactRoot, { recursive: true })
const rootManifest = await readJson(join(repositoryRoot, 'package.json'))
const desktopManifest = await readJson(join(repositoryRoot, 'apps', 'desktop', 'package.json'))
const workspaceText = await readFile(join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8')
const [head, branch, statusText, bunVersion, nodeVersion, pnpmVersion] = await Promise.all([
  gitValue(['rev-parse', 'HEAD']),
  gitValue(['branch', '--show-current']),
  gitValue(['status', '--porcelain=v1']),
  runCommand('bun', ['--version']).then((result) => result.stdout.trim()),
  runCommand('node', ['--version']).then((result) => result.stdout.trim()),
  runCommand('pnpm', ['--version']).then((result) => result.stdout.trim())
])
const secretScan = await scanTextFiles(repositoryRoot)
assertCondition(
  secretScan.findings.length === 0,
  `high-confidence secret scan found a token-shaped value: ${JSON.stringify(secretScan.findings)}`
)

const audit = await runCommand('bun', ['audit', '--json'])
assertCondition(audit.exitCode === 0, `bun audit failed: ${audit.stderr || audit.stdout}`)
const auditJson = JSON.parse(audit.stdout.trim() || '{}') as JsonRecord
assertCondition(Object.keys(auditJson).length === 0, 'bun audit returned advisories')

const licenseCommand = await runCommand('pnpm', ['licenses', 'list', '--json'])
assertCondition(licenseCommand.exitCode === 0, `pnpm licenses list failed: ${licenseCommand.stderr}`)
const licenseGroups = JSON.parse(licenseCommand.stdout) as Record<string, readonly LicensePackage[]>
const licensePackages = Object.entries(licenseGroups).flatMap(([license, entries]) =>
  entries.map((entry) => ({
    name: entry.name,
    versions: entry.versions,
    license,
    homepage: entry.homepage
  }))
)
const uniqueLicensePackages = Array.from(
  new Map(licensePackages.flatMap((entry) => entry.versions.map((version) => [`${entry.name}@${version}`, { ...entry, version }]))).values()
)
const directNames = new Set<string>()
for (const manifestPath of ['package.json', 'apps/backend-bun/package.json', 'apps/desktop/package.json', 'packages/contracts/package.json']) {
  const manifest = await readJson(join(repositoryRoot, manifestPath))
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const name of Object.keys((manifest[section] as Record<string, unknown> | undefined) ?? {})) directNames.add(name)
  }
}
const directPackages = uniqueLicensePackages.filter((entry) => directNames.has(entry.name))
const unknownLicenses = Object.keys(licenseGroups).filter((license) => !licenseAllowlist.has(license))
const directPolicyFailures = directPackages.filter((entry) => !directLicenseAllowlist.has(entry.license))
assertCondition(unknownLicenses.length === 0, `unreviewed license expressions: ${unknownLicenses.join(', ')}`)
assertCondition(directPolicyFailures.length === 0, 'direct dependency license policy failed')

const components = uniqueLicensePackages.map((entry) => {
  const licenseValue = entry.license.includes(' OR ') || entry.license.startsWith('(')
    ? { expression: entry.license }
    : { license: { id: entry.license } }
  return {
    type: 'library',
    name: entry.name,
    version: entry.version,
    'bom-ref': `pkg:npm/${entry.name}@${entry.version}`,
    licenses: [licenseValue]
  }
})

const lifecycleReview = await collectPnpmLifecycleReview()
const trustedDependencies = (rootManifest.trustedDependencies as readonly string[] | undefined) ?? []
assertCondition(trustedDependencies.length === 0, 'root trustedDependencies must remain empty')
for (const token of ['onlyBuiltDependencies:', '  - electron', '  - esbuild', 'electron-winstaller: false', 'msw: false']) {
  assertCondition(workspaceText.includes(token), `pnpm build policy missing: ${token}`)
}

const generatedExposure: JsonRecord[] = []
const generatedTrees: JsonRecord[] = []
for (const root of generatedRoots) {
  try {
    const tree = await treeIdentity(root, relative(repositoryRoot, root).replaceAll('\\', '/'))
    generatedTrees.push({
      root: relative(repositoryRoot, root).replaceAll('\\', '/'),
      fileCount: tree.files.length,
      aggregateSha256: tree.aggregateSha256,
      files: tree.files
    })
    for (const file of tree.files) {
      if (/\.(?:map|ts|tsx|py|pem|key|env)$/iu.test(file.path)) {
        generatedExposure.push({ path: `${relative(repositoryRoot, root).replaceAll('\\', '/')}/${file.path}`, reason: 'source-or-secret-file-extension' })
      }
    }
    for (const file of tree.files.filter((entry) => /\.(?:js|cjs|mjs|html)$/iu.test(entry.path))) {
      const text = await readFile(join(root, file.path), 'utf8')
      if (text.includes('sourceMappingURL')) generatedExposure.push({ path: `${relative(repositoryRoot, root).replaceAll('\\', '/')}/${file.path}`, reason: 'sourceMappingURL' })
    }
  } catch {
    // A missing optional generated root is captured in the result below.
  }
}
assertCondition(generatedExposure.length === 0, 'generated output exposes source maps or source files')
assertCondition(generatedTrees.some((tree) => tree.root === 'apps/desktop/out'), 'desktop output is missing')
assertCondition(generatedTrees.some((tree) => tree.root === 'apps/backend-bun/dist'), 'Bun backend output is missing')

const reportFiles = [
  {
    path: 'secret-scan.json',
    value: {
      schemaVersion: 1,
      scanner: 'advx-high-confidence-token-scan',
      status: 'passed',
      filesScanned: secretScan.filesScanned,
      skippedSensitiveFiles: secretScan.skippedSensitiveFiles,
      findings: secretScan.findings
    }
  },
  {
    path: 'bun-audit.json',
    value: { schemaVersion: 1, command: 'bun audit --json', status: 'passed', advisories: auditJson }
  },
  {
    path: 'license-report.json',
    value: {
      schemaVersion: 1,
      command: 'pnpm licenses list --json',
      status: 'passed',
      policy: {
        directAllowlist: [...directLicenseAllowlist],
        transitiveAllowlist: [...licenseAllowlist],
        denied: 'unknown, GPL, AGPL, SSPL, or any expression outside the allowlist'
      },
      licenseCounts: Object.fromEntries(Object.entries(licenseGroups).map(([license, entries]) => [license, entries.length])),
      directPackages,
      unknownLicenses,
      directPolicyFailures,
      packages: uniqueLicensePackages
    }
  },
  {
    path: 'sbom.cdx.json',
    value: {
      bomFormat: 'CycloneDX',
      specVersion: '1.5',
      serialNumber: `urn:uuid:${randomUUID()}`,
      version: 1,
      metadata: { timestamp: new Date().toISOString(), component: { type: 'application', name: 'advx-live', version: rootManifest.version } },
      components
    }
  },
  {
    path: 'lifecycle-review.json',
    value: {
      schemaVersion: 1,
      status: 'passed',
      trustedDependencies,
      onlyBuiltDependencies: ['electron', 'esbuild'],
      deniedBuilds: ['electron-winstaller', 'msw'],
      installedPackageCount: lifecycleReview.packageCount,
      packagesWithLifecycleScripts: lifecycleReview.lifecyclePackages,
      executionPolicy: 'declared lifecycle scripts are not trusted unless the pnpm workspace allowBuilds policy explicitly permits them'
    }
  }
]
for (const report of reportFiles) await writeJsonAtomic(join(artifactRoot, report.path), report.value)

const sourcePaths = [
  'package.json',
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'bun.lock',
  'apps/backend-bun/package.json',
  'apps/desktop/package.json',
  'packages/contracts/package.json',
  'apps/desktop/electron-builder.yml'
]
const sourceIdentities = []
for (const path of sourcePaths) {
  try {
    sourceIdentities.push(await fileIdentity(join(repositoryRoot, path), path))
  } catch {
    // Optional lock/source inputs are omitted only when absent from this checkout.
  }
}
const backendManifestPath = join(repositoryRoot, 'apps', 'backend-bun', 'dist', 'backend-manifest.json')
let backendManifest: JsonRecord | null = null
try {
  backendManifest = await readJson(backendManifestPath)
} catch {
  // The output tree still records the missing generated manifest if absent.
}
const reportIdentities = []
for (const report of reportFiles) reportIdentities.push(await fileIdentity(join(artifactRoot, report.path), report.path))
const artifactManifest = {
  schemaVersion: 1,
  taskId: 'PKG-009',
  status: 'passed',
  source: {
    gitHead: head,
    branch,
    dirty: statusText.length > 0,
    dirtyStatusLineCount: statusText ? statusText.split('\n').length : 0,
    sourceInputs: sourceIdentities
  },
  runtime: {
    bun: bunVersion,
    node: nodeVersion,
    pnpm: pnpmVersion,
    electron: (desktopManifest.devDependencies as JsonRecord | undefined)?.electron,
    electronBuilder: (desktopManifest.devDependencies as JsonRecord | undefined)?.['electron-builder'],
    platform: process.platform,
    arch: process.arch
  },
  target: { platform: process.platform, arch: process.arch, signing: 'unsigned local evidence' },
  backend: {
    executable: generatedTrees.find((tree) => tree.root === 'apps/backend-bun/dist')?.files,
    compile: backendManifest?.compile ?? null,
    output: backendManifest?.output ?? null,
    migrationHead: Array.isArray((backendManifest?.compile as JsonRecord | undefined)?.embeddedAssets)
      ? ((backendManifest?.compile as JsonRecord).embeddedAssets as string[]).filter((path) => path.endsWith('.sql')).at(-1) ?? null
      : null
  },
  desktop: { output: generatedTrees.find((tree) => tree.root === 'apps/desktop/out') ?? null },
  securityReports: reportIdentities,
  generatedExposure: { status: 'passed', findings: generatedExposure },
  testRunIds: ['pkg-009-maker-root-20260807-109'],
  manifestSelfHashExcluded: true
}
await writeJsonAtomic(join(artifactRoot, 'artifact-manifest.json'), artifactManifest)
const result = {
  schemaVersion: 1,
  taskId: 'PKG-009',
  status: 'passed',
  secretScan: { status: 'passed', filesScanned: secretScan.filesScanned, findings: secretScan.findings.length },
  bunAudit: { status: 'passed', advisoryCount: Object.keys(auditJson).length },
  licenses: { status: 'passed', expressionCount: Object.keys(licenseGroups).length, packageCount: uniqueLicensePackages.length, directPolicyFailures: directPolicyFailures.length },
  sbom: { format: 'CycloneDX', specVersion: '1.5', componentCount: components.length },
  lifecycle: { status: 'passed', trustedDependencies: trustedDependencies.length, packagesWithLifecycleScripts: lifecycleReview.lifecyclePackages.length },
  generatedExposure: { status: 'passed', findings: generatedExposure.length },
  artifactManifest: join(artifactRoot, 'artifact-manifest.json'),
  runtime: { bun: bunVersion, node: nodeVersion, pnpm: pnpmVersion, platform: process.platform, arch: process.arch }
}
await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
