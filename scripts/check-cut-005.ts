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
type PackageManifest = Readonly<{
  name: string
  scripts: Readonly<Record<string, string>>
}>

const repositoryRoot = resolve(import.meta.dir, '..')
const args = parseNamedArguments(Bun.argv.slice(2), new Set(['--artifact-root']))
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ??
    join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'cut-005'),
  repositoryRoot
)
const decisionPath = join(
  repositoryRoot,
  'docs',
  'migrations',
  'typescript-bun',
  'CUT-005-BUN-WORKSPACE-COMMANDS.md'
)
const packagePaths = [
  'package.json',
  'apps/backend-bun/package.json',
  'apps/desktop/package.json',
  'packages/contracts/package.json'
] as const
const sourcePaths = [
  ...packagePaths,
  'bun.lock',
  'scripts/dev.mjs',
  'vitest.config.ts',
  'pnpm-workspace.yaml',
  'apps/backend-bun/scripts/check-import-boundaries.ts',
  'apps/backend-bun/src/api/app.ts',
  'apps/backend-bun/src/api/recorded-pipeline.ts',
  'apps/backend-bun/src/application/services/provider-configuration.ts',
  'docs/migrations/typescript-bun/CUT-005-BUN-WORKSPACE-COMMANDS.md',
  'scripts/check-cut-005.ts',
  'scripts/tsconfig.cut-005.json'
] as const
const forbiddenCommandNames = new Set([
  'npm',
  'npx',
  'pip',
  'pip3',
  'pnpm',
  'python',
  'python3',
  'uv',
  'yarn'
])

function verify(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScriptError(SCRIPT_EXIT.verificationFailed, message)
}

function asRecord(value: unknown, label: string): JsonRecord {
  verify(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} is not an object`)
  return value as JsonRecord
}

function asStringRecord(value: unknown, label: string): Readonly<Record<string, string>> {
  const record = asRecord(value, label)
  for (const [key, entry] of Object.entries(record)) {
    verify(typeof entry === 'string', `${label}.${key} is not a string`)
  }
  return record as Record<string, string>
}

async function readManifest(path: string): Promise<PackageManifest> {
  const manifest = asRecord(await readJsonFile(join(repositoryRoot, path)), path)
  verify(typeof manifest.name === 'string', `${path}.name is missing`)
  return {
    name: manifest.name,
    scripts: asStringRecord(manifest.scripts, `${path}.scripts`)
  }
}

function commandName(fragment: string): string | undefined {
  const token = fragment.trim().split(/\s+/, 1)[0]
  if (token === undefined || token === '') return undefined
  const normalized = token.replace(/^['"]|['"]$/g, '').replace(/\\/g, '/')
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1).toLowerCase()
  return basename.replace(/\.(?:cmd|exe|ps1)$/i, '')
}

function commandFragments(script: string): readonly string[] {
  return script.split(/\s*(?:&&|\|\||;|\|)\s*/).filter((fragment) => fragment.trim() !== '')
}

await runMachineCli(async () => {
  verify(process.platform === 'win32' && process.arch === 'x64', 'CUT-005 requires Windows x64')
  verify(Bun.version === '1.3.14', `CUT-005 requires Bun 1.3.14, got ${Bun.version}`)
  await rm(artifactRoot, { recursive: true, force: true })

  const rootJson = asRecord(await readJsonFile(join(repositoryRoot, 'package.json')), 'package.json')
  verify(rootJson.packageManager === 'bun@1.3.14', 'packageManager must be bun@1.3.14')
  const engines = asRecord(rootJson.engines, 'package.json.engines')
  verify(engines.bun === '1.3.14', 'Bun engine must be pinned to 1.3.14')
  verify(
    JSON.stringify(rootJson.workspaces) ===
      JSON.stringify(['apps/backend-bun', 'apps/desktop', 'packages/*']),
    'root workspaces drifted'
  )
  verify(
    Array.isArray(rootJson.trustedDependencies) && rootJson.trustedDependencies.length === 0,
    'trustedDependencies must remain empty'
  )

  const manifests = await Promise.all(packagePaths.map((path) => readManifest(path)))
  const rootScripts = manifests[0]?.scripts
  verify(rootScripts !== undefined, 'root scripts are missing')
  const requiredRootScripts = {
    dev: 'bun scripts/dev.mjs',
    'dev:desktop': 'bun run --filter @advx/desktop dev',
    'dev:backend': 'bun run --filter @advx/backend-bun start',
    typecheck: 'bun run --filter @advx/contracts typecheck',
    test: 'bun test scripts/process-lifecycle.test.ts',
    contracts: 'bun run --filter @advx/backend-bun openapi:generate',
    replay: 'bun run --filter @advx/backend-bun test:obs-007',
    eval: 'bun run --filter @advx/backend-bun test:obs-008',
    evidence: 'bun run evidence:viewer-runtime',
    build: 'bun run --filter @advx/backend-bun build',
    'package:desktop': 'bun run build:bun-backend',
    audit: 'bun audit --json'
  } as const
  for (const [name, prefix] of Object.entries(requiredRootScripts)) {
    verify(rootScripts[name]?.startsWith(prefix), `root script ${name} must start with ${prefix}`)
  }
  for (const name of [
    'contracts:bun-openapi:check',
    'lint',
    'format',
    'format:check',
    'test:projects',
    'test:projects:browser',
    'test:e2e:viewer-runtime'
  ]) {
    verify(typeof rootScripts[name] === 'string' && rootScripts[name].length > 0, `root script ${name} is missing`)
  }

  const forbiddenInvocations: Array<Readonly<{
    package: string
    script: string
    command: string
  }>> = []
  const nodeInvocations: Array<Readonly<{
    package: string
    script: string
    command: string
  }>> = []
  for (const manifest of manifests) {
    for (const [scriptName, script] of Object.entries(manifest.scripts)) {
      for (const fragment of commandFragments(script)) {
        const command = commandName(fragment)
        if (command === undefined) continue
        if (forbiddenCommandNames.has(command)) {
          forbiddenInvocations.push({ package: manifest.name, script: scriptName, command })
        }
        if (command === 'node') {
          nodeInvocations.push({ package: manifest.name, script: scriptName, command })
          verify(manifest.name === '@advx/desktop', `Node invocation escaped Electron workspace: ${scriptName}`)
        }
      }
    }
  }
  verify(forbiddenInvocations.length === 0, `forbidden package/runtime commands: ${JSON.stringify(forbiddenInvocations)}`)

  const desktopScripts = manifests.find((manifest) => manifest.name === '@advx/desktop')?.scripts
  verify(desktopScripts !== undefined, 'desktop scripts are missing')
  verify(
    desktopScripts.test ===
      'vitest run --config ../../vitest.config.ts --project desktop-main --project desktop-preload --project desktop-renderer',
    'desktop test command must be bounded to desktop projects'
  )
  verify(
    desktopScripts['package:win:x64:dir'] === 'electron-builder --win --x64 --dir',
    'desktop Windows x64 package command drifted'
  )

  const devLauncher = await readFile(join(repositoryRoot, 'scripts', 'dev.mjs'), 'utf8')
  verify(devLauncher.includes('spawn(process.execPath, ["run", "--filter", "@advx/desktop", "dev"]'), 'dev launcher must spawn Bun workspace development')
  verify(!/\b(?:pnpm|npm_execpath|uv|python3?)\b/i.test(devLauncher), 'dev launcher retains a legacy command')

  const vitestConfig = await readFile(join(repositoryRoot, 'vitest.config.ts'), 'utf8')
  verify(vitestConfig.includes("exclude: ['apps/desktop/src/**/*.browser.test.{ts,tsx}']"), 'renderer tests must exclude browser projects')

  const pnpmWorkspace = await readFile(join(repositoryRoot, 'pnpm-workspace.yaml'), 'utf8')
  verify(/(?:^|\n)minimumReleaseAge:\s*0(?:\r?\n|$)/.test(pnpmWorkspace), 'pnpm dependency-age policy must be explicitly disabled')

  const decision = await readFile(decisionPath, 'utf8')
  for (const clause of [
    'Bun `1.3.14` is the single supported package manager',
    'Windows x64 is the only release',
    'minimumReleaseAge: 0',
    'Python backend remains the migration parity oracle',
    'owned by CUT-006'
  ]) {
    verify(decision.includes(clause), `CUT-005 decision is missing: ${clause}`)
  }

  const sourceIdentities = await Promise.all(
    sourcePaths.map((path) => fileIdentity(join(repositoryRoot, path), path))
  )
  const sourceAggregateSha256 = createHash('sha256')
    .update(sourceIdentities.map((identity) => `${identity.path}:${identity.sha256}`).join('\n'))
    .digest('hex')
  const result = {
    schemaVersion: 1,
    taskId: 'CUT-005',
    status: 'passed',
    platform: { os: process.platform, arch: process.arch },
    bunVersion: Bun.version,
    packageManager: rootJson.packageManager,
    installCommand: 'bun install --frozen-lockfile --ignore-scripts',
    workspacePackages: manifests.map((manifest) => manifest.name),
    requiredRootScripts: Object.keys(requiredRootScripts),
    forbiddenInvocations,
    nodeInvocations,
    dependencyAgePolicy: { pnpmMinimumReleaseAge: 0, enabled: false },
    pythonOraclePreserved: true,
    deferredToCut006: ['CI', 'scheduled workflows', 'hidden automation', 'helper scripts'],
    releaseSideEffects: { commit: false, push: false, publish: false, deploy: false },
    sourceAggregateSha256,
    sourceIdentities
  }
  await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
  return {
    artifact: relative(repositoryRoot, join(artifactRoot, 'result.json')).replace(/\\/g, '/'),
    criteria: 15,
    forbiddenInvocations: forbiddenInvocations.length,
    nodeInvocations: nodeInvocations.length,
    sourceFiles: sourceIdentities.length,
    sourceAggregateSha256
  }
})
