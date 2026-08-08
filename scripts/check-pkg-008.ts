import { readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  parseNamedArguments,
  requireSafeArtifactRoot,
  SCRIPT_EXIT,
  ScriptError,
  writeJsonAtomic
} from './evidence-script-runtime.ts'

const repositoryRoot = resolve(import.meta.dir, '..')
const desktopRoot = join(repositoryRoot, 'apps', 'desktop')
const electronViteCli = join(desktopRoot, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')
const args = parseNamedArguments(Bun.argv.slice(2), new Set(['--artifact-root']))
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ?? join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'pkg-008'),
  repositoryRoot
)

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScriptError(SCRIPT_EXIT.verificationFailed, message)
}

async function run(
  command: string,
  commandArgs: readonly string[],
  cwd: string,
  environment?: Record<string, string>
) {
  const child = Bun.spawn([command, ...commandArgs], {
    cwd,
    env: environment,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true
  })
  const stdout = await new Response(child.stdout).text()
  const stderr = await new Response(child.stderr).text()
  return { exitCode: await child.exited, stdout, stderr }
}

await rm(artifactRoot, { recursive: true, force: true })
const loggingSource = await readFile(join(desktopRoot, 'src', 'main', 'logging.ts'), 'utf8')
const decision = await readFile(join(repositoryRoot, 'docs', 'migrations', 'typescript-bun', 'PKG-008-CRASH-EVIDENCE-DECISION.md'), 'utf8')
for (const token of ["crashReporter.start", 'uploadToServer: false', "submitURL: ''", 'globalExtra', 'app_version', 'electron_version', 'session_id']) {
  assertCondition(loggingSource.includes(token), `logging crash evidence configuration missing: ${token}`)
}
for (const token of ['64 MiB', 'retained only', 'embedded: false', 'human decision']) {
  assertCondition(decision.includes(token), `PKG-008 retention/consent decision missing: ${token}`)
}

const nodeExecutable = process.env.npm_node_execpath ?? 'node'
const desktopBuild = await run(nodeExecutable, [electronViteCli, 'build'], desktopRoot)
assertCondition(
  desktopBuild.exitCode === 0,
  `Electron Vite build failed: ${(desktopBuild.stderr || desktopBuild.stdout).slice(-6000)}`
)
const smoke = await run(
  nodeExecutable,
  [join(desktopRoot, 'scripts', 'pkg-008-crash-smoke.mjs')],
  desktopRoot,
  {
    ...Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)),
    ADVX_PKG_008_ARTIFACT_ROOT: artifactRoot
  }
)
assertCondition(smoke.exitCode === 0, `PKG-008 crash smoke failed: ${(smoke.stderr || smoke.stdout).slice(-6000)}`)
const resultPath = join(artifactRoot, 'result.json')
const result = JSON.parse(await readFile(resultPath, 'utf8')) as Record<string, unknown>
assertCondition(result.taskId === 'PKG-008', 'PKG-008 result task id mismatch')
assertCondition(result.status === 'passed', 'PKG-008 result is not passed')
assertCondition(result.uploadToServer === false, 'crash upload is not disabled in runtime evidence')
const dump = result.dump as Record<string, unknown>
assertCondition(dump.embedded === false, 'diagnostics manifest embedded the dump')
assertCondition(typeof dump.bytes === 'number' && dump.bytes > 0 && dump.bytes <= 64 * 1024 * 1024, 'crash dump is not bounded')
await writeJsonAtomic(join(artifactRoot, 'checker-receipt.json'), {
  schemaVersion: 1,
  taskId: 'PKG-008',
  status: 'passed',
  sourceChecks: ['local crashReporter', 'upload disabled', 'version/id-only annotations', 'documented retention'],
  runtimeResult: resultPath,
  smokeExitCode: smoke.exitCode
})
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
