import { access, mkdir, stat, writeFile } from 'node:fs/promises'
import { release } from 'node:os'
import { join, relative, resolve } from 'node:path'

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
    join(repositoryRoot, '.omx', 'artifacts', 'typescript-bun', 'CUT-012', 'clean-clone'),
  repositoryRoot
)
const securityRoot = join(artifactRoot, 'security')

type CommandResult = Readonly<{
  id: string
  command: readonly string[]
  exitCode: number
  durationMs: number
  stdout: Awaited<ReturnType<typeof fileIdentity>>
  stderr: Awaited<ReturnType<typeof fileIdentity>>
}>

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScriptError(SCRIPT_EXIT.verificationFailed, message)
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function capture(command: string, commandArgs: readonly string[]): Promise<string> {
  const child = Bun.spawn([command, ...commandArgs], {
    cwd: repositoryRoot,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true
  })
  const stdout = new Response(child.stdout).text()
  const stderr = new Response(child.stderr).text()
  const exitCode = await child.exited
  const output = (await stdout).trim()
  const error = (await stderr).trim()
  assertCondition(exitCode === 0, `${command} ${commandArgs.join(' ')} failed: ${error || output}`)
  return output
}

const forbiddenInitialPaths = [
  '.omx',
  '.cache',
  'node_modules',
  'apps/backend-bun/node_modules',
  'apps/backend-bun/dist',
  'apps/desktop/node_modules',
  'apps/desktop/out',
  'apps/desktop/release',
  'packages/contracts/node_modules'
] as const
for (const path of forbiddenInitialPaths) {
  assertCondition(
    !(await exists(join(repositoryRoot, path))),
    `clean-clone precondition failed: ${path} exists`
  )
}

const [head, branch, upstreamHead, origin, initialStatus, bunVersion, nodeVersion, gitVersion] =
  await Promise.all([
    capture('git', ['rev-parse', 'HEAD']),
    capture('git', ['branch', '--show-current']),
    capture('git', ['rev-parse', 'origin/TS_backend_refactor']),
    capture('git', ['remote', 'get-url', 'origin']),
    capture('git', ['status', '--porcelain=v1', '--untracked-files=all']),
    capture(process.execPath, ['--version']),
    capture('node', ['--version']),
    capture('git', ['--version'])
  ])
assertCondition(branch === 'TS_backend_refactor', `unexpected branch: ${branch}`)
assertCondition(
  head === upstreamHead,
  `HEAD ${head} does not match origin/TS_backend_refactor ${upstreamHead}`
)
assertCondition(initialStatus === '', `clean-clone source is dirty before proof: ${initialStatus}`)
assertCondition(bunVersion === '1.3.14', `unexpected Bun version: ${bunVersion}`)
assertCondition(nodeVersion === 'v24.18.0', `unexpected Node version: ${nodeVersion}`)
assertCondition(
  process.platform === 'win32' && process.arch === 'x64',
  'CUT-012 requires Windows x64'
)

const cacheRoot = join(artifactRoot, 'fresh-cache')
const environment = {
  ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)),
  BUN_INSTALL_CACHE_DIR: join(cacheRoot, 'bun'),
  ELECTRON_CACHE: join(cacheRoot, 'electron'),
  ELECTRON_BUILDER_CACHE: join(cacheRoot, 'electron-builder')
}
assertCondition(!(await exists(cacheRoot)), 'CUT-012 cache root already exists')

const commands = [
  { id: '01-install', args: ['install', '--frozen-lockfile'] },
  { id: '02-cut-012-typecheck', args: ['run', 'typecheck:cut-012'] },
  { id: '03-contract-drift', args: ['run', 'contracts:bun-openapi:check'] },
  { id: '04-typecheck', args: ['run', 'typecheck'] },
  { id: '05-lint', args: ['run', 'lint'] },
  { id: '06-format-check', args: ['run', 'format:check'] },
  { id: '07-unit-integration', args: ['run', 'test'] },
  { id: '08-property', args: ['run', 'test:tst-004'] },
  { id: '09-fault', args: ['run', 'test:tst-006'] },
  { id: '10-recorded-replay', args: ['run', 'replay'] },
  { id: '11-recorded-eval', args: ['run', 'eval'] },
  { id: '12-desktop-build', args: ['run', '--filter', '@advx/desktop', 'build'] },
  { id: '13-backend-compile', args: ['run', 'build:bun-backend'] },
  { id: '14-package', args: ['run', 'package:desktop'] },
  { id: '15-installed-e2e', args: ['run', 'check:pkg-010'] },
  { id: '16-runtime-scan', args: ['run', 'check:cut-011'] },
  { id: '17-fuse-integrity', args: ['run', 'check:pkg-007'] },
  { id: '18-crash-evidence', args: ['run', 'check:pkg-008'] },
  { id: '19-release-inertness', args: ['run', 'check:pkg-012'] },
  {
    id: '20-security-sbom-artifacts',
    args: ['scripts/check-cut-012-security.ts', '--artifact-root', securityRoot]
  },
  { id: '21-live-plan-check', args: ['run', 'migration:plan-check'] }
] as const

await mkdir(artifactRoot, { recursive: true })
await Bun.write(join(artifactRoot, '.initialized'), '')
const commandResults: CommandResult[] = []
let failure: string | null = null
for (const command of commands) {
  const startedAt = Date.now()
  process.stdout.write(`[CUT-012] ${command.id}: bun ${command.args.join(' ')}\n`)
  const child = Bun.spawn([process.execPath, ...command.args], {
    cwd: repositoryRoot,
    env: environment,
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
  const stdoutPath = join(artifactRoot, `${command.id}.stdout.log`)
  const stderrPath = join(artifactRoot, `${command.id}.stderr.log`)
  await Promise.all([writeFile(stdoutPath, stdout), writeFile(stderrPath, stderr)])
  commandResults.push({
    id: command.id,
    command: ['bun', ...command.args],
    exitCode,
    durationMs: Date.now() - startedAt,
    stdout: await fileIdentity(
      stdoutPath,
      relative(repositoryRoot, stdoutPath).replaceAll('\\', '/')
    ),
    stderr: await fileIdentity(
      stderrPath,
      relative(repositoryRoot, stderrPath).replaceAll('\\', '/')
    )
  })
  process.stdout.write(`[CUT-012] ${command.id}: exit ${exitCode}\n`)
  if (exitCode !== 0) {
    failure = `${command.id} exited with ${exitCode}: ${(stderr || stdout).slice(-4000)}`
    break
  }
  if (command.id === '01-install') {
    await access(
      join(repositoryRoot, 'apps', 'desktop', 'node_modules', 'electron', 'dist', 'electron.exe')
    )
  }
}

const trackedStatus = await capture('git', ['status', '--porcelain=v1', '--untracked-files=no'])
if (trackedStatus !== '') failure ??= `tracked files changed during proof: ${trackedStatus}`
const expectedArtifacts = [
  'apps/backend-bun/dist/advx-backend-bun.exe',
  'apps/desktop/release/win-unpacked/ADVX Live.exe',
  '.omx/artifacts/test-results/pkg-010/electron-package/ADVX Live Setup 0.1.0.exe',
  '.omx/artifacts/test-results/pkg-010/result.json',
  '.omx/artifacts/test-results/cut-011/result.json',
  '.omx/artifacts/test-results/pkg-007/result.json',
  '.omx/artifacts/test-results/pkg-008/result.json',
  '.omx/artifacts/test-results/pkg-012/result.json',
  relative(repositoryRoot, join(securityRoot, 'sbom.cdx.json')).replaceAll('\\', '/'),
  relative(repositoryRoot, join(securityRoot, 'artifact-manifest.json')).replaceAll('\\', '/'),
  relative(repositoryRoot, join(securityRoot, 'result.json')).replaceAll('\\', '/')
] as const
const artifactIdentities = []
if (failure === null) {
  for (const path of expectedArtifacts) {
    try {
      artifactIdentities.push(await fileIdentity(join(repositoryRoot, path), path))
    } catch (error) {
      failure = `required artifact is missing or unreadable: ${path}: ${String(error)}`
      break
    }
  }
}
const result = {
  schemaVersion: 1,
  taskId: 'CUT-012',
  evidenceClass: 'fresh-remote-checkout-no-existing-dependency-cache',
  status: failure === null ? 'passed' : 'failed',
  source: { head, branch, upstreamHead, origin, initialStatus, trackedStatus },
  environment: {
    platform: process.platform,
    arch: process.arch,
    osVersion: release(),
    bun: bunVersion,
    node: nodeVersion,
    git: gitVersion
  },
  freshPreconditions: {
    absentPaths: forbiddenInitialPaths,
    dependencyCacheRootInitiallyAbsent: true,
    cacheEnvironment: {
      BUN_INSTALL_CACHE_DIR: environment.BUN_INSTALL_CACHE_DIR,
      ELECTRON_CACHE: environment.ELECTRON_CACHE,
      ELECTRON_BUILDER_CACHE: environment.ELECTRON_BUILDER_CACHE
    }
  },
  commands: commandResults,
  artifacts: artifactIdentities,
  automaticCiEnabled: false,
  failure
}
await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
await writeFile(
  join(artifactRoot, 'result.sha256'),
  `${(await fileIdentity(join(artifactRoot, 'result.json'), 'result.json')).sha256}  result.json\n`
)
process.stdout.write(
  `${JSON.stringify({ status: result.status, head, commands: commandResults.length, failure }, null, 2)}\n`
)
if (failure !== null) process.exit(1)
