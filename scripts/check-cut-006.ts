import { createHash } from 'node:crypto'
import { access, readFile, readdir, rm } from 'node:fs/promises'
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

const repositoryRoot = resolve(import.meta.dir, '..')
const args = parseNamedArguments(Bun.argv.slice(2), new Set(['--artifact-root']))
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ??
    join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'cut-006'),
  repositoryRoot
)
const workflowDirectory = join(repositoryRoot, '.github', 'workflows')
const workflowPath = join(workflowDirectory, 'bun-ci.yml')
const decisionPath = join(
  repositoryRoot,
  'docs',
  'migrations',
  'typescript-bun',
  'CUT-006-CI-AUTOMATION.md'
)
const activeHelperPaths = [
  'scripts/build-bun-backend.ts',
  'scripts/check-bun-control-openapi.ts',
  'scripts/check-tst-012-ci.ts',
  'scripts/write-ci-artifact-manifest.ts',
  'apps/desktop/scripts/run-tst-008.ts',
  'apps/desktop/scripts/bun-recorded-pipeline-smoke.ts',
  'tests/e2e/electron/run-recorded-smoke.ts'
] as const
const sourcePaths = [
  'package.json',
  'apps/desktop/package.json',
  'bun.lock',
  '.github/workflows/bun-ci.yml',
  ...activeHelperPaths,
  'docs/migrations/typescript-bun/CUT-006-CI-AUTOMATION.md',
  'scripts/check-cut-006.ts',
  'scripts/tsconfig.cut-006.json'
] as const

function verify(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScriptError(SCRIPT_EXIT.verificationFailed, message)
}

function asRecord(value: unknown, label: string): JsonRecord {
  verify(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} is not an object`)
  return value as JsonRecord
}

function stringScripts(value: unknown, label: string): Record<string, string> {
  const record = asRecord(value, label)
  for (const [name, script] of Object.entries(record)) {
    verify(typeof script === 'string', `${label}.${name} is not a string`)
  }
  return record as Record<string, string>
}

async function missingPath(path: string): Promise<boolean> {
  try {
    await access(path)
    return false
  } catch {
    return true
  }
}

await runMachineCli(async () => {
  verify(process.platform === 'win32' && process.arch === 'x64', 'CUT-006 requires Windows x64')
  verify(Bun.version === '1.3.14', `CUT-006 requires Bun 1.3.14, got ${Bun.version}`)
  await rm(artifactRoot, { recursive: true, force: true })

  const workflowFiles = (await readdir(workflowDirectory))
    .filter((path) => /\.ya?ml$/i.test(path))
    .sort()
  verify(JSON.stringify(workflowFiles) === JSON.stringify(['bun-ci.yml']), `unexpected workflow inventory: ${workflowFiles.join(', ')}`)

  const workflow = await readFile(workflowPath, 'utf8')
  for (const clause of [
    'oven-sh/setup-bun@v2',
    'bun-version: 1.3.14',
    'actions/setup-node@v4',
    'node-version: 24.18.0',
    'bun install --frozen-lockfile --ignore-scripts',
    'bun run contracts:bun-openapi:check',
    'bun run typecheck:cut-006',
    'bun run replay',
    'bun run eval',
    'bun run evidence',
    'test-matrix:',
    'lane: bun-unit-integration',
    'lane: windows-recorded-electron',
    'bun run test:tst-008',
    'package-matrix:',
    'runs-on: windows-latest',
    'bun run package:desktop',
    'scripts/write-ci-artifact-manifest.ts',
    'actions/upload-artifact@v4'
  ]) {
    verify(workflow.includes(clause), `workflow is missing: ${clause}`)
  }
  for (const pattern of [
    /\bpnpm\b/iu,
    /\buv\b/iu,
    /\bpython(?:3)?\b/iu,
    /\bpip(?:3)?\b/iu,
    /actions\/setup-python/iu,
    /continue-on-error:\s*true/iu
  ]) {
    verify(!pattern.test(workflow), `workflow contains forbidden automation: ${pattern.source}`)
  }
  verify(/permissions:\s*\r?\n\s+contents:\s+read/mu.test(workflow), 'workflow permissions are not read-only')

  const rootPackage = asRecord(await readJsonFile(join(repositoryRoot, 'package.json')), 'package.json')
  const rootScripts = stringScripts(rootPackage.scripts, 'package.json.scripts')
  verify(rootPackage.packageManager === 'bun@1.3.14', 'root package manager drifted')
  verify(rootScripts['check:cut-006']?.startsWith('bun run typecheck:cut-006'), 'CUT-006 command gate is missing')
  for (const [name, prefix] of Object.entries({
    contracts: 'bun run --filter @advx/backend-bun openapi:generate',
    replay: 'bun run --filter @advx/backend-bun test:obs-007',
    eval: 'bun run --filter @advx/backend-bun test:obs-008',
    evidence: 'bun run evidence:viewer-runtime',
    'debug:headless': 'bun run --filter @advx/backend-bun debug:headless',
    'build:bun-backend': 'bun run scripts/build-bun-backend.ts'
  })) {
    verify(rootScripts[name]?.startsWith(prefix), `active root helper drifted: ${name}`)
  }

  const desktopPackage = asRecord(
    await readJsonFile(join(repositoryRoot, 'apps', 'desktop', 'package.json')),
    'apps/desktop/package.json'
  )
  const desktopScripts = stringScripts(desktopPackage.scripts, 'apps/desktop/package.json.scripts')
  for (const name of ['smoke:runtime', 'smoke:ai-calls']) {
    const script = desktopScripts[name] ?? ''
    verify(script.includes('bun-recorded-pipeline-smoke.ts'), `${name} does not use the recorded Bun helper`)
    verify(!script.includes('scripts/runtime-smoke.mjs'), `${name} retains the legacy runtime smoke`)
    verify(!/\bpython(?:3)?\b|\buv\b|\bpnpm\b/iu.test(script), `${name} retains a legacy command`)
  }
  verify(
    await missingPath(join(repositoryRoot, 'apps', 'desktop', 'scripts', 'runtime-smoke.mjs')),
    'legacy FastAPI runtime smoke launcher still exists'
  )

  const helperTexts = await Promise.all(
    activeHelperPaths.map(async (path) => ({ path, text: await readFile(join(repositoryRoot, path), 'utf8') }))
  )
  const legacyHits: Array<{ path: string; pattern: string }> = []
  for (const helper of helperTexts.filter((entry) => entry.path !== 'scripts/check-tst-012-ci.ts')) {
    for (const pattern of [/\bpnpm\b/iu, /\bnpm_execpath\b/iu, /\buv\s+run\b/iu, /\bpython(?:3)?(?:\.exe)?\b/iu]) {
      if (pattern.test(helper.text)) legacyHits.push({ path: helper.path, pattern: pattern.source })
    }
  }
  verify(legacyHits.length === 0, `active helper legacy invocations: ${JSON.stringify(legacyHits)}`)

  const buildHelper = helperTexts.find((helper) => helper.path === 'scripts/build-bun-backend.ts')?.text ?? ''
  verify(buildHelper.includes('packageManager: `bun@${Bun.version}`'), 'backend manifest does not record Bun provenance')
  const contractHelper = helperTexts.find((helper) => helper.path === 'scripts/check-bun-control-openapi.ts')?.text ?? ''
  verify(contractHelper.includes('run bun run contracts:bun-openapi'), 'contract drift error does not name the Bun command')
  const tst008 = helperTexts.find((helper) => helper.path === 'apps/desktop/scripts/run-tst-008.ts')?.text ?? ''
  verify(tst008.includes("process.execPath, 'run', '--filter', '@advx/desktop'"), 'TST-008 does not use Bun workspace commands')
  const smokeHelper = helperTexts.find((helper) => helper.path === 'apps/desktop/scripts/bun-recorded-pipeline-smoke.ts')?.text ?? ''
  verify(smokeHelper.includes("Bun.spawn([process.env.ADVX_NODE_EXECUTABLE?.trim() || 'node', runnerPath]"), 'recorded smoke does not isolate Playwright in Node')
  verify(smokeHelper.includes("Bun.spawn(['taskkill.exe', '/pid', String(child.pid), '/t', '/f']"), 'recorded smoke has no bounded child-tree cleanup')
  const smokeRunner = helperTexts.find((helper) => helper.path === 'tests/e2e/electron/run-recorded-smoke.ts')?.text ?? ''
  verify(smokeRunner.includes("backendRuntime: 'bun-source'"), 'recorded smoke runner does not select the Bun backend')
  verify(smokeRunner.includes("scenario: 'full-pipeline'"), 'recorded smoke runner does not select the full pipeline')
  const manifestHelper = helperTexts.find((helper) => helper.path === 'scripts/write-ci-artifact-manifest.ts')?.text ?? ''
  for (const clause of ['backendIdentityPreserved: true', 'signed: false', 'published: false']) {
    verify(manifestHelper.includes(clause), `CI artifact manifest helper is missing: ${clause}`)
  }

  const decision = await readFile(decisionPath, 'utf8')
  for (const clause of [
    'one active GitHub Actions workflow',
    'No job sets up, caches, or invokes Python',
    'Windows x64',
    'Python parity suites are retained',
    'GitHub-hosted workflow is not executed'
  ]) {
    verify(decision.includes(clause), `CUT-006 decision is missing: ${clause}`)
  }

  for (const oraclePath of [
    'tests/parity/python_health_oracle.py',
    'tests/parity/python_control_session_server.py',
    'apps/backend/src/advx_backend/main.py'
  ]) {
    verify(!(await missingPath(join(repositoryRoot, oraclePath))), `Python parity oracle was removed: ${oraclePath}`)
  }

  const sourceIdentities = await Promise.all(
    sourcePaths.map((path) => fileIdentity(join(repositoryRoot, path), path))
  )
  const sourceAggregateSha256 = createHash('sha256')
    .update(sourceIdentities.map((identity) => `${identity.path}:${identity.sha256}`).join('\n'))
    .digest('hex')
  const result = {
    schemaVersion: 1,
    taskId: 'CUT-006',
    status: 'passed',
    workflowInventory: {
      workflows: workflowFiles,
      scheduled: [],
      release: [],
      reusableActions: [],
      hiddenExecutableHelpers: []
    },
    lanes: ['quality', 'bun-unit-integration', 'windows-recorded-electron', 'windows-x64-package'],
    activeHelpers: activeHelperPaths,
    legacyHits,
    packageManager: 'bun@1.3.14',
    installCommand: 'bun install --frozen-lockfile --ignore-scripts',
    nodeBoundary: 'Electron, Playwright, Vitest Browser Mode, and electron-builder only',
    pythonOraclePreserved: true,
    githubHostedRunPerformed: false,
    releaseSideEffects: { commit: false, push: false, publish: false, sign: false, deploy: false },
    sourceAggregateSha256,
    sourceIdentities
  }
  await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
  return {
    artifact: relative(repositoryRoot, join(artifactRoot, 'result.json')).replace(/\\/g, '/'),
    workflows: workflowFiles.length,
    activeHelpers: activeHelperPaths.length,
    legacyHits: legacyHits.length,
    sourceFiles: sourceIdentities.length,
    sourceAggregateSha256
  }
})
