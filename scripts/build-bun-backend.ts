import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'

import {
  fileIdentity,
  parseNamedArguments,
  writeJsonAtomic
} from './evidence-script-runtime.ts'

const repositoryRoot = resolve(import.meta.dir, '..')
const entrypoint = join(repositoryRoot, 'apps', 'backend-bun', 'src', 'main.ts')
const backendPackage = join(repositoryRoot, 'apps', 'backend-bun', 'package.json')
const outputName = process.platform === 'win32' ? 'advx-backend-bun.exe' : 'advx-backend-bun'

const compileFlags = [
  'build',
  '--compile',
  '--target=bun',
  '--sourcemap=none',
  '--env=disable',
  '--no-compile-autoload-dotenv',
  '--no-compile-autoload-bunfig',
  '--no-compile-autoload-package-json',
  '--no-compile-autoload-tsconfig'
] as const

const args = parseNamedArguments(
  Bun.argv.slice(2),
  new Set(['--output-root', '--manifest', '--run-id'])
)
const outputRoot = resolve(
  repositoryRoot,
  args.get('--output-root') ?? join('apps', 'backend-bun', 'dist')
)
const outputPath = join(outputRoot, outputName)
const sourceMapSidecarPath = join(outputRoot, 'main.js.map')
const manifestPath = resolve(
  outputRoot,
  args.get('--manifest') ?? 'backend-manifest.json'
)
const runId = args.get('--run-id') ?? `pkg-001-${new Date().toISOString().replace(/[:.]/g, '-')}`

const embeddedAssetPaths = [
  'apps/backend-bun/package.json',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/0001_room_session_runtime.sql',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/0002_session_viewer_instances.sql',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/0003_room_events.sql',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/0004_room_long_term_memories.sql',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/0005_mode_memes.sql',
  'apps/backend-bun/src/infrastructure/persistence/sqlite/migrations/0006_durable_outbox.sql'
] as const

function commandOutput(command: string, commandArgs: readonly string[]): string {
  try {
    return execFileSync(command, [...commandArgs], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    }).trim()
  } catch {
    return 'unavailable'
  }
}

async function sourceAggregate(): Promise<{ readonly files: number; readonly sha256: string }> {
  const files: string[] = []
  async function visit(directory: string): Promise<void> {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules' && entry.name !== 'dist') await visit(path)
      } else if (/\.(?:ts|tsx|json|sql)$/.test(entry.name)) {
        files.push(path)
      }
    }
  }
  await visit(join(repositoryRoot, 'apps', 'backend-bun', 'src'))
  files.push(backendPackage)
  files.sort()
  const hash = createHash('sha256')
  for (const path of files) {
    hash.update(relative(repositoryRoot, path).replaceAll('\\', '/'))
    hash.update('\0')
    hash.update(await readFile(path))
    hash.update('\0')
  }
  return { files: files.length, sha256: hash.digest('hex') }
}

const embeddedAssets = await Promise.all(
  embeddedAssetPaths.map((path) => fileIdentity(join(repositoryRoot, path), path))
)

await mkdir(outputRoot, { recursive: true })
await rm(outputPath, { force: true })
await rm(manifestPath, { force: true })
await rm(sourceMapSidecarPath, { force: true })

const command = [...compileFlags, `--outfile=${outputPath}`, entrypoint]
const startedAt = Date.now()
const build = Bun.spawnSync([process.execPath, ...command], {
  cwd: repositoryRoot,
  stdout: 'pipe',
  stderr: 'pipe',
  windowsHide: true
})
const stdout = new TextDecoder().decode(build.stdout).trim()
const stderr = new TextDecoder().decode(build.stderr).trim()
if (build.exitCode !== 0) {
  throw new Error(`Bun compile failed with exit ${build.exitCode}: ${stderr || stdout}`)
}
// Bun 1.3.14 may leave the entrypoint sidecar beside a compiled output even
// when --sourcemap=none is requested. It is not a shipped runtime asset.
await rm(sourceMapSidecarPath, { force: true })

const source = await sourceAggregate()
const artifact = await fileIdentity(outputPath, relative(repositoryRoot, outputPath))
const packageIdentity = await fileIdentity(backendPackage, 'apps/backend-bun/package.json')
const manifest = {
  schemaVersion: 1,
  taskId: 'PKG-001',
  runId,
  entrypoint: relative(repositoryRoot, entrypoint).replaceAll('\\', '/'),
  target: {
    runtime: 'bun',
    bunVersion: Bun.version,
    platform: process.platform,
    arch: process.arch
  },
  compile: {
    command: ['bun', ...command.map((value) =>
      value === entrypoint ? relative(repositoryRoot, value).replaceAll('\\', '/') : value
    )],
    defines: [],
    externalModules: [],
    assetStrategy: 'embedded',
    embeddedAssets: [...embeddedAssetPaths],
    copiedAssets: [],
    sourceMap: 'none',
    sourceMapSidecar: null,
    envInlining: 'disabled',
    autoload: {
      dotenv: false,
      bunfig: false,
      packageJson: false,
      tsconfig: false
    }
  },
  runtimeAssets: {
    strategy: 'embedded',
    assets: embeddedAssets,
    copied: []
  },
  reproducibilityInputs: {
    gitHead: commandOutput('git', ['rev-parse', 'HEAD']),
    gitDirtyTrackedDiff: commandOutput('git', ['status', '--porcelain', '--untracked-files=no']),
    bunVersion: Bun.version,
    nodeVersion: process.version,
    packageManager: `bun@${Bun.version}`,
    sourceFileCount: source.files,
    sourceAggregateSha256: source.sha256,
    packageManifest: packageIdentity
  },
  output: {
    path: artifact.path,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
    buildDurationMs: Date.now() - startedAt
  },
  bunOutput: { stdout, stderr }
} as const

await writeJsonAtomic(manifestPath, manifest)
process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
