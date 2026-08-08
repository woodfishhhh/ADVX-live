import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dir, '..')
const workflowPath = resolve(repositoryRoot, '.github', 'workflows', 'bun-ci.yml')
const workspacePath = resolve(repositoryRoot, 'pnpm-workspace.yaml')

const requiredWorkflowText = [
  'actions/checkout@v4',
  'oven-sh/setup-bun@v2',
  'bun-version: 1.3.14',
  'actions/setup-node@v4',
  'node-version: 24.18.0',
  'bun install --frozen-lockfile --ignore-scripts',
  'bun run contracts:bun-openapi:check',
  'bun run typecheck',
  'bun run typecheck:cut-006',
  'bun run lint',
  'bun run format:check',
  'bun run replay',
  'bun run eval',
  'bun run evidence',
  'bun run build',
  'bun run audit',
  'test-matrix:',
  "lane: bun-unit-integration",
  "lane: windows-recorded-electron",
  'bun run test:tst-008',
  'package-matrix:',
  'runs-on: windows-latest',
  'bun run package:desktop',
  'scripts/write-ci-artifact-manifest.ts',
  'actions/upload-artifact@v4',
  'if-no-files-found: error'
] as const

const forbiddenWorkflowPatterns = [
  /\bpnpm\b/iu,
  /\buv\b/iu,
  /\bpython(?:3)?\b/iu,
  /\bpip(?:3)?\b/iu,
  /actions\/setup-python/iu,
  /continue-on-error:\s*true/iu,
  /bun audit --json\s*(?:\|\||2>)/iu
] as const

const workflow = await readFile(workflowPath, 'utf8')
const workspace = await readFile(workspacePath, 'utf8')
const missing = requiredWorkflowText.filter((value) => !workflow.includes(value))
const forbidden = forbiddenWorkflowPatterns
  .filter((pattern) => pattern.test(workflow))
  .map((pattern) => pattern.source)
const hasFrozenTrigger = /^\s+pull_request:\s*$/mu.test(workflow) && /^\s+push:\s*$/mu.test(workflow)
const hasReadOnlyPermissions = /permissions:\s*\r?\n\s+contents:\s+read/mu.test(workflow)
const minimumReleaseAgeDisabled = /^minimumReleaseAge:\s*0\s*$/mu.test(workspace)
const ageExceptionListPresent = /^minimumReleaseAgeExclude:/mu.test(workspace)
const workflowCount = 1

const result = {
  schema_version: 2,
  task_id: 'TST-012',
  workflow: '.github/workflows/bun-ci.yml',
  workflow_count: workflowCount,
  required_steps: requiredWorkflowText.length,
  missing,
  forbidden,
  has_frozen_push_and_pull_request_triggers: hasFrozenTrigger,
  has_read_only_permissions: hasReadOnlyPermissions,
  has_test_matrix: workflow.includes('test-matrix:'),
  has_windows_package_matrix: workflow.includes('package-matrix:'),
  has_artifact_manifest: workflow.includes('scripts/write-ci-artifact-manifest.ts'),
  minimum_release_age_disabled: minimumReleaseAgeDisabled,
  minimum_release_age_exception_list_present: ageExceptionListPresent,
  status:
    missing.length === 0 &&
    forbidden.length === 0 &&
    hasFrozenTrigger &&
    hasReadOnlyPermissions &&
    minimumReleaseAgeDisabled &&
    !ageExceptionListPresent
      ? 'passed'
      : 'failed'
} as const

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
if (result.status !== 'passed') process.exit(1)
