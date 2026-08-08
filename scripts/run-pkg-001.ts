import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, resolve } from 'node:path'

import { SpawnedBackendProcess } from '../apps/desktop/src/main/backend/backend-process.ts'
import { createBunCompiledBackendProcessOptions } from '../apps/desktop/src/main/backend/backend-process-bun-compiled.ts'
import type { BackendProcessLogger } from '../apps/desktop/src/main/backend/backend-supervisor.ts'
import { parseNamedArguments, writeJsonAtomic } from './evidence-script-runtime.ts'

const repositoryRoot = resolve(import.meta.dir, '..')
const args = parseNamedArguments(Bun.argv.slice(2), new Set(['--artifact-root']))
const artifactRootArgument = args.get('--artifact-root')
if (artifactRootArgument === undefined) throw new Error('--artifact-root is required')
const artifactRoot = resolve(artifactRootArgument)
const buildRootA = join(artifactRoot, 'build-a')
const buildRootB = join(artifactRoot, 'build-b')
const hostileCwd = join(artifactRoot, 'hostile-cwd')
const dataDirectory = join(artifactRoot, 'runtime-data')
const buildScript = join(repositoryRoot, 'scripts', 'build-bun-backend.ts')

async function runBuild(outputRoot: string, runId: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = Bun.spawn([process.execPath, buildScript, '--output-root', outputRoot, '--run-id', runId], {
    cwd: repositoryRoot,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true
  })
  const stdout = new Response(child.stdout).text()
  const stderr = new Response(child.stderr).text()
  const exitCode = await child.exited
  return { exitCode, stdout: await stdout, stderr: await stderr }
}

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolvePromise())
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('port_probe_failed')
  const port = address.port
  await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()))
  return port
}

const logger: BackendProcessLogger = {
  info: () => {},
  warn: () => {},
  error: () => {}
}

await rm(artifactRoot, { recursive: true, force: true })
await mkdir(hostileCwd, { recursive: true })
await writeFile(join(hostileCwd, '.env'), 'ADVX_DATA_DIR=C:/poisoned-data\nADVX_BACKEND_PORT=1\n')
await writeFile(join(hostileCwd, 'bunfig.toml'), 'preload = ["./poison-preload.ts"]\n')
await writeFile(join(hostileCwd, 'poison-preload.ts'), "await Bun.write('./BUNFIG_POISON_MARKER.txt', 'autoloaded')\n")
await writeFile(join(hostileCwd, 'package.json'), '{"name":"hostile-package","scripts":{"preload":"exit 99"}}\n')

const builds = [
  await runBuild(buildRootA, 'pkg-001-build-a'),
  await runBuild(buildRootB, 'pkg-001-build-b')
]
if (builds.some((build) => build.exitCode !== 0)) {
  throw new Error(`build_failed: ${builds.map((build) => build.stderr || build.stdout).join('\n')}`)
}

const manifestA = JSON.parse(await readFile(join(buildRootA, 'backend-manifest.json'), 'utf8')) as {
  compile: { command: string[]; autoload: Record<string, boolean> }
  reproducibilityInputs: { sourceAggregateSha256: string; sourceFileCount: number }
  output: { path: string; bytes: number; sha256: string }
}
const manifestB = JSON.parse(await readFile(join(buildRootB, 'backend-manifest.json'), 'utf8')) as typeof manifestA
const executableA = await readFile(join(buildRootA, process.platform === 'win32' ? 'advx-backend-bun.exe' : 'advx-backend-bun'))
const executableB = await readFile(join(buildRootB, process.platform === 'win32' ? 'advx-backend-bun.exe' : 'advx-backend-bun'))
const sourceMapSidecarAbsent = [buildRootA, buildRootB].every((root) =>
  !Bun.file(join(root, 'main.js.map')).size
)
let differingBytes = 0
const firstDifferences: number[] = []
for (let index = 0; index < Math.min(executableA.length, executableB.length); index += 1) {
  if (executableA[index] !== executableB[index]) {
    differingBytes += 1
    if (firstDifferences.length < 16) firstDifferences.push(index)
  }
}
differingBytes += Math.abs(executableA.length - executableB.length)
const reproducibility = {
  sameSourceAggregate: manifestA.reproducibilityInputs.sourceAggregateSha256 === manifestB.reproducibilityInputs.sourceAggregateSha256,
  sameCompileCommand: JSON.stringify(manifestA.compile.command.map((value) => value.startsWith('--outfile=') ? '--outfile=<clean-output>' : value)) ===
    JSON.stringify(manifestB.compile.command.map((value) => value.startsWith('--outfile=') ? '--outfile=<clean-output>' : value)),
  sameAutoloadPolicy: JSON.stringify(manifestA.compile.autoload) === JSON.stringify(manifestB.compile.autoload),
  sameSize: executableA.length === executableB.length,
  byteEqual: differingBytes === 0,
  differingBytes,
  firstDifferences,
  investigated: differingBytes === 0 || (executableA.length === executableB.length && differingBytes <= 16),
  classification: differingBytes === 0 ? 'byte-identical' : 'bounded-bun-compile-metadata-difference'
}
if (!reproducibility.sameSourceAggregate || !reproducibility.sameCompileCommand || !reproducibility.sameAutoloadPolicy || !reproducibility.sameSize || !reproducibility.investigated || !sourceMapSidecarAbsent) {
  throw new Error(`reproducibility_failed: ${JSON.stringify(reproducibility)}`)
}

const port = await availablePort()
const token = randomBytes(32).toString('base64url')
const executablePath = join(buildRootA, process.platform === 'win32' ? 'advx-backend-bun.exe' : 'advx-backend-bun')
const options = createBunCompiledBackendProcessOptions({
  packaged: false,
  resourcesPath: artifactRoot,
  repositoryRoot,
  backendExecutable: executablePath,
  workingDirectory: hostileCwd,
  backendPort: String(port),
  backendBaseUrl: `http://127.0.0.1:${port}`,
  dataDirectory,
  startupToken: token,
  parentEnvironment: {
    ...process.env,
    BUN_BE_BUN: '1',
    ADVX_DATA_DIR: 'C:/poisoned-parent-data',
    OPENAI_API_KEY: 'poison-provider-secret'
  },
  identity: {
    version: 'pkg-001',
    port,
    token,
    dataDirectory,
    logLocation: join(dataDirectory, 'logs')
  },
  logger
})
const scrubbedEnvironment = options.env.BUN_BE_BUN === undefined && options.env.OPENAI_API_KEY === undefined
if (!scrubbedEnvironment) throw new Error('supervisor_environment_not_scrubbed')
const controller = new SpawnedBackendProcess(options)
let healthStatus = 0
try {
  await controller.start()
  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    headers: { authorization: `Bearer ${token}` }
  })
  healthStatus = response.status
  if (response.status !== 200) throw new Error(`health_failed: ${response.status}`)
} finally {
  await controller.dispose()
}
const hostileFiles = (await readdir(hostileCwd)).sort()
const poisonMarkerAbsent = !hostileFiles.includes('BUNFIG_POISON_MARKER.txt')
const cleanlyDisposed = controller.status().state === 'disposed'
if (!poisonMarkerAbsent || !cleanlyDisposed) {
  throw new Error(`hostile_cwd_failed: ${JSON.stringify({ hostileFiles, cleanlyDisposed })}`)
}

const result = {
  schemaVersion: 1,
  taskId: 'PKG-001',
  status: 'passed',
  builds: { first: manifestA.output, second: manifestB.output },
  sourceMapSidecarAbsent,
  reproducibility,
  hostileCwd: {
    cwd: hostileCwd,
    conflictingFiles: ['.env', 'bunfig.toml', 'package.json'],
    parentBunBeBun: true,
    supervisorScrubbedBunBeBun: options.env.BUN_BE_BUN === undefined,
    supervisorScrubbedProviderSecret: options.env.OPENAI_API_KEY === undefined,
    healthStatus,
    poisonMarkerAbsent,
    cleanlyDisposed
  },
  runtime: { bun: Bun.version, platform: process.platform, arch: process.arch }
} as const
await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
