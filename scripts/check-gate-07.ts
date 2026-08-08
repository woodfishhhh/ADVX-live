import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

type JsonRecord = Record<string, unknown>
type Criterion = Readonly<{
  id: string
  claim: string
  passed: boolean
  evidence: readonly string[]
  detail: string
}>

const repositoryRoot = resolve(import.meta.dir, '..')
const artifactRoot = resolve(
  argument('--artifact-root') ??
    join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'gate-07')
)
const master = await readText('docs/migrations/typescript-bun/00-MASTER-PLAN.md')
const evidence = await readText('docs/migrations/typescript-bun/EVIDENCE.md')
const workspace = await readText('pnpm-workspace.yaml')
const packageJson = await readJson('package.json')
const workflow = await readText('.github/workflows/bun-ci.yml')
const coverageLedger = await readJson(
  'docs/migrations/typescript-bun/tst-002-test-coverage-ledger.json'
)

const criteria: Criterion[] = [
  criterion(
    'phase-entry',
    'TST-000 binds Phase 07 to accepted GATE-05 and GATE-06 evidence',
    allDone(master, ['TST-000', 'GATE-05', 'GATE-06']) && evidenceDone(evidence, 'TST-000'),
    ['00-MASTER-PLAN.md', 'EVIDENCE.md']
  ),
  criterion(
    'vitest-boundaries',
    'Vitest projects reflect process and runtime boundaries',
    taskDone(master, 'TST-001') && evidenceDone(evidence, 'TST-001'),
    ['TST-001 accepted evidence']
  ),
  criterion(
    'coverage-ledger',
    'Every retained Python test behavior has a reviewed ledger row',
    taskDone(master, 'TST-002') &&
      evidenceDone(evidence, 'TST-002') &&
      coverageLedgerRows(coverageLedger) > 0 &&
      coverageLedgerHasNoUnmapped(coverageLedger),
    ['tst-002-test-coverage-ledger.json', 'TST-002 accepted evidence']
  ),
  criterion(
    'critical-regressions',
    'Protocol, persistence, resource, security, and concurrency regressions have proof',
    allDone(master, ['TST-003', 'TST-004', 'TST-005', 'TST-006']) &&
      ['TST-003', 'TST-004', 'TST-005', 'TST-006'].every((id) => evidenceDone(evidence, id)),
    ['TST-003..006 accepted evidence']
  ),
  criterion(
    'browser-electron-roles',
    'Browser Mode and Electron E2E have explicit non-overlapping roles',
    allDone(master, ['TST-007', 'TST-008']) &&
      evidenceDone(evidence, 'TST-007') &&
      evidenceDone(evidence, 'TST-008'),
    ['TST-007/008 accepted evidence']
  ),
  criterion(
    'bun-evidence-scripts',
    'Evidence scripts run through Bun with structured results',
    allDone(master, ['TST-009', 'TST-014']) &&
      evidenceDone(evidence, 'TST-009') &&
      evidenceDone(evidence, 'TST-014') &&
      scriptValue(packageJson, 'evidence:viewer-runtime')?.startsWith('bun ') === true,
    ['package.json', 'TST-009/014 accepted evidence']
  ),
  criterion(
    'lint-format',
    'Oxlint and Oxfmt have reviewed rules with one formatter boundary',
    taskDone(master, 'TST-010') && evidenceDone(evidence, 'TST-010'),
    ['TST-010 accepted evidence']
  ),
  criterion(
    'knip',
    'Knip output is classified rather than blanket-suppressed',
    taskDone(master, 'TST-011') && evidenceDone(evidence, 'TST-011'),
    ['TST-011 accepted evidence']
  ),
  criterion(
    'ci-audit-parity',
    'Frozen install, audit, typecheck, tests, build, and recorded parity pass',
    allDone(master, ['TST-012', 'TST-013']) &&
      evidenceDone(evidence, 'TST-012') &&
      evidenceDone(evidence, 'TST-013') &&
      workflow.includes('bun install --frozen-lockfile') &&
      workflow.includes('bun audit --json') &&
      scriptValue(packageJson, 'test:tst-013')?.startsWith('bun run typecheck:tst-013') === true,
    ['.github/workflows/bun-ci.yml', 'TST-012/013 accepted evidence']
  ),
  criterion(
    'python-tool-inventory',
    'Active non-backend Python scripts are ported or explicitly retired',
    taskDone(master, 'TST-014') && evidenceDone(evidence, 'TST-014'),
    ['TST-014 accepted evidence']
  ),
  criterion(
    'independent-review',
    'Every TST task has independent accepted evidence with non-participating Checker',
    allDone(
      master,
      Array.from({ length: 15 }, (_, index) => `TST-${String(index).padStart(3, '0')}`)
    ) &&
      Array.from({ length: 15 }, (_, index) => `TST-${String(index).padStart(3, '0')}`).every(
        (id) => checkerAccepted(evidence, id)
      ),
    ['EVIDENCE.md', 'TST-000..014 Checker records']
  )
]

const report = {
  schema_version: 1,
  task_id: 'GATE-07',
  status: criteria.every((item) => item.passed) ? 'passed' : 'failed',
  branch: 'TS_backend_refactor',
  head: await gitHead(),
  criteria,
  summary: {
    total: criteria.length,
    passed: criteria.filter((item) => item.passed).length,
    failed: criteria.filter((item) => !item.passed).length
  },
  limitations: [
    'Node 22.23.1 emits the existing Node 24 engine warning.',
    'Credentialed-live Provider interoperability is not claimed by recorded evidence.',
    'TST-013 retains the classified Python debug-route unavailability boundary.'
  ]
}
await mkdir(artifactRoot, { recursive: true })
await writeFile(
  join(artifactRoot, 'gate-07-review.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8'
)
console.log(JSON.stringify({ artifactRoot, status: report.status, summary: report.summary }))
if (report.status !== 'passed') process.exitCode = 1

function argument(name: string): string | undefined {
  const index = Bun.argv.indexOf(name)
  return index === -1 ? undefined : Bun.argv[index + 1]
}

async function readText(relativePath: string): Promise<string> {
  return readFile(resolve(repositoryRoot, relativePath), 'utf8')
}

async function readJson(relativePath: string): Promise<JsonRecord> {
  return asRecord(JSON.parse(await readText(relativePath)))
}

function criterion(
  id: string,
  claim: string,
  passed: boolean,
  evidence: readonly string[]
): Criterion {
  return {
    id,
    claim,
    passed,
    evidence,
    detail: passed ? 'accepted evidence present' : 'required evidence is missing or not accepted'
  }
}

function taskDone(masterText: string, id: string): boolean {
  return new RegExp('\\\\| \\`' + id + '\\` \\\\| \\`DONE\\` \\\\|').test(masterText)
}

function allDone(masterText: string, ids: readonly string[]): boolean {
  return ids.every((id) => taskDone(masterText, id))
}

function evidenceSections(evidenceText: string, id: string): string[] {
  const heading = new RegExp(`^### ${id} /[^\\n]*\\n`, 'gm')
  const sections: string[] = []
  for (const match of evidenceText.matchAll(heading)) {
    const start = (match.index ?? 0) + match[0].length
    const remainder = evidenceText.slice(start)
    const nextHeading = remainder.search(/^### /m)
    sections.push(nextHeading === -1 ? remainder : remainder.slice(0, nextHeading))
  }
  return sections
}

function evidenceDone(evidenceText: string, id: string): boolean {
  return evidenceSections(evidenceText, id).some((section) => section.includes('- Status: `DONE`'))
}

function checkerAccepted(evidenceText: string, id: string): boolean {
  return evidenceSections(evidenceText, id).some(
    (section) =>
      section.includes('- Status: `DONE`') &&
      section.includes('- Checker participated in implementation: `false`') &&
      section.includes('- Checker run/context ID:')
  )
}

function scriptValue(packageRecord: JsonRecord, name: string): string | undefined {
  const scripts = asRecord(packageRecord.scripts)
  const value = scripts[name]
  return typeof value === 'string' ? value : undefined
}

function coverageLedgerRows(value: JsonRecord): number {
  return Array.isArray(value.rows)
    ? value.rows.length
    : Array.isArray(value.modules)
      ? value.modules.length
      : 0
}

function coverageLedgerHasNoUnmapped(value: JsonRecord): boolean {
  const text = JSON.stringify(value)
  return !/"status"\s*:\s*"unmapped"/.test(text)
}

function asRecord(value: unknown): JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {}
}

async function gitHead(): Promise<string> {
  const child = Bun.spawn(['git', 'rev-parse', 'HEAD'], { stdout: 'pipe', stderr: 'ignore' })
  return (await new Response(child.stdout).text()).trim()
}
