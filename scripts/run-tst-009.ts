import assert from 'node:assert/strict'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  ExecutionGuard,
  fileIdentity,
  requireSafeArtifactRoot,
  SCRIPT_EXIT,
  ScriptError,
  writeJsonAtomic
} from './evidence-script-runtime.ts'

type ViewerManifest = Readonly<{
  status: 'passed'
  fixture: Readonly<{ unchanged: true }>
  replay: Readonly<{
    deterministic_proof: true
    credentialed_provider_proof: false
    external_transport_call_count: 0
    event_count: number
    consumed_provider_roles: readonly string[]
  }>
  artifact_hashes_verified: true
  product_data_mutated: false
  redaction_verified: true
}>

type OpenApiResult = Readonly<{
  status: 'passed'
  byte_equal: true
  product_data_mutated: false
}>

const repositoryRoot = resolve(import.meta.dir, '..')
const artifactRoot = requireSafeArtifactRoot(
  process.env.ADVX_TST009_ARTIFACT_ROOT ?? join(
    repositoryRoot,
    '.omx',
    'artifacts',
    'test-results',
    'tst-009'
  ),
  repositoryRoot
)
const viewerRoot = join(artifactRoot, 'viewer-runtime')
const openApiRoot = join(artifactRoot, 'openapi')
const guard = new ExecutionGuard(90_000)
const startedAt = Date.now()

try {
  await rm(artifactRoot, { recursive: true, force: true })
  await mkdir(artifactRoot, { recursive: true })

  await runCommand([
    process.execPath,
    'test',
    'scripts/process-lifecycle.test.ts',
    'scripts/viewer-runtime-evidence.test.ts'
  ])
  await runCommand([
    process.execPath,
    'scripts/verify-viewer-runtime-evidence.ts',
    '--fixture',
    'tests/fixtures/cs2/viewer_runtime_recorded.json',
    '--artifact-root',
    viewerRoot,
    '--timeout-ms',
    '15000'
  ])
  await runCommand([
    process.execPath,
    'scripts/check-bun-control-openapi.ts',
    '--artifact-root',
    openApiRoot,
    '--timeout-ms',
    '30000'
  ])
  const usageProbe = await runCommand([
    process.execPath,
    'scripts/verify-viewer-runtime-evidence.ts',
    '--artifact-root',
    viewerRoot
  ], SCRIPT_EXIT.usage)
  const usageResult = parseObject(usageProbe.stdout)
  assert.equal(usageResult.status, 'failed')
  assert.equal(usageResult.exit_code, SCRIPT_EXIT.usage)

  const viewerManifest = await readJson<ViewerManifest>(join(viewerRoot, 'manifest.json'))
  const openApiResult = await readJson<OpenApiResult>(join(openApiRoot, 'result.json'))
  assert.equal(viewerManifest.status, 'passed')
  assert.equal(viewerManifest.fixture.unchanged, true)
  assert.equal(viewerManifest.replay.deterministic_proof, true)
  assert.equal(viewerManifest.replay.credentialed_provider_proof, false)
  assert.equal(viewerManifest.replay.external_transport_call_count, 0)
  assert.equal(viewerManifest.replay.event_count, 6)
  assert.deepEqual(viewerManifest.replay.consumed_provider_roles, [
    'viewer',
    'visual_summary',
    'memory',
    'asr'
  ])
  assert.equal(viewerManifest.artifact_hashes_verified, true)
  assert.equal(viewerManifest.product_data_mutated, false)
  assert.equal(viewerManifest.redaction_verified, true)
  assert.equal(openApiResult.status, 'passed')
  assert.equal(openApiResult.byte_equal, true)
  assert.equal(openApiResult.product_data_mutated, false)

  const [viewerIdentity, openApiIdentity] = await Promise.all([
    fileIdentity(join(viewerRoot, 'manifest.json'), 'viewer-runtime/manifest.json'),
    fileIdentity(join(openApiRoot, 'result.json'), 'openapi/result.json')
  ])
  const manifest = {
    schema_version: 1,
    task_id: 'TST-009',
    status: 'passed',
    coverage: {
      process_lifecycle: true,
      structured_replay_fixture: true,
      artifact_hashes: true,
      redaction: true,
      machine_output: true,
      stable_exit_codes: true,
      explicit_artifact_roots: true,
      signal_and_timeout_cleanup: true,
      product_data_mutated: false,
      bun_windows_runtime: process.platform === 'win32'
    },
    artifacts: [viewerIdentity, openApiIdentity],
    runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
    duration_ms: Date.now() - startedAt
  } as const
  await writeJsonAtomic(join(artifactRoot, 'manifest.json'), manifest)
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`)
} finally {
  await guard.close()
}

async function runCommand(
  command: readonly string[],
  expectedExitCode = 0
): Promise<Readonly<{ stdout: string; stderr: string }>> {
  const child = Bun.spawn([...command], {
    cwd: repositoryRoot,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true
  })
  guard.addCleanup(async () => {
    if (child.exitCode === null) child.kill('SIGKILL')
    await child.exited
  })
  const stdoutPromise = new Response(child.stdout).text()
  const stderrPromise = new Response(child.stderr).text()
  const exitCode = await guard.race(child.exited)
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
  if (exitCode !== expectedExitCode) {
    throw new ScriptError(
      SCRIPT_EXIT.verificationFailed,
      `command exited ${exitCode}, expected ${expectedExitCode}: ${command.slice(0, 3).join(' ')}\n${stderr || stdout}`
    )
  }
  if (expectedExitCode === 0) {
    process.stdout.write(stdout)
    process.stderr.write(stderr)
  }
  return { stdout, stderr }
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

function parseObject(line: string): Record<string, unknown> {
  const value = JSON.parse(line.trim()) as unknown
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value))
  return value as Record<string, unknown>
}
