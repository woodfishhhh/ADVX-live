import { afterEach, describe, expect, test } from 'bun:test'
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { checkMigrationPlan } from './migration-plan-check'

const liveRoot = join(
  process.cwd(),
  'docs',
  'migrations',
  'typescript-bun'
)
const temporaryRoots: string[] = []
const externalDocs = [
  'ARCHITECTURE.md',
  'BACKEND_DESIGN.md',
  'INGEST_PROTOCOL.md',
  'AUDIENCE_SPEAKING_PRODUCT_SPEC.md',
  'VIEWER_RUNTIME_REQUIREMENTS_LOG.md',
  'REAL_PIPELINE.md'
]
const compatibilityArtifacts = [
  'compatibility-matrix.json',
  'current-toolchain.json',
  'lifecycle-script-audit.json',
  'official-sources.json'
]

async function mutate(
  file: string,
  transform: (contents: string) => string
): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), 'advx-plan-check-'))
  temporaryRoots.push(parent)
  const repository = join(parent, 'repo')
  const root = join(repository, 'docs', 'migrations', 'typescript-bun')
  await cp(liveRoot, root, { recursive: true })
  await mkdir(join(repository, 'docs'), { recursive: true })
  await Promise.all(
    externalDocs.map((name) =>
      cp(join(process.cwd(), 'docs', name), join(repository, 'docs', name))
    )
  )
  const artifactSource = join(
    process.cwd(),
    '.omx',
    'artifacts',
    'typescript-bun',
    'FND-003',
    'fnd-003-maker-20260730-001'
  )
  const artifactTarget = join(
    repository,
    '.omx',
    'artifacts',
    'typescript-bun',
    'FND-003',
    'fnd-003-maker-20260730-001'
  )
  await mkdir(artifactTarget, { recursive: true })
  await Promise.all(
    compatibilityArtifacts.map((name) =>
      cp(join(artifactSource, name), join(artifactTarget, name))
    )
  )
  const path = join(root, file)
  await writeFile(path, transform(await readFile(path, 'utf8')))
  return root
}

async function expectCodes(
  root: string,
  expected: string[]
): Promise<void> {
  const report = await checkMigrationPlan(root)
  expect(report.status).toBe('failed')
  expect(report.documentsUnchanged).toBe(true)
  expect([...new Set(report.errors.map(({ code }) => code))].sort())
    .toEqual([...expected].sort())
}

async function expectHasCodes(
  root: string,
  expected: string[]
): Promise<void> {
  const report = await checkMigrationPlan(root)
  const codes = new Set(report.errors.map(({ code }) => code))
  expect(report.status).toBe('failed')
  expect(report.documentsUnchanged).toBe(true)
  for (const code of expected) {
    expect(codes.has(code)).toBe(true)
  }
}

function replaceTaskStatus(
  contents: string,
  taskId: string,
  status: string
): string {
  return contents.replace(
    new RegExp(
      '^(\\| `' +
      taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '` \\| )`[^`]+`',
      'm'
    ),
    `$1\`${status}\``
  )
}

function presentFnd012AsVerify(contents: string): string {
  return contents
    .replace(/^current_task:.*$/m, 'current_task: "FND-012"')
    .replace(/^next_task:.*$/m, 'next_task: null')
    .replace(
      /^\| Current phase \|.*$/m,
      '| Current phase | Phase 00: `VERIFY` |'
    )
    .replace(
      /^\| Current task \|.*$/m,
      '| Current task | `FND-012` (`VERIFY`) |'
    )
    .replace(/^\| Next task \|.*$/m, '| Next task | None |')
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  )
})

describe('migration plan drift checker', () => {
  test('accepts the complete live control plane without rewriting it', async () => {
    const report = await checkMigrationPlan(liveRoot)
    expect(report.status).toBe('passed')
    expect(report.documentsUnchanged).toBe(true)
    expect(report.summary.taskCount).toBeGreaterThan(100)
    expect(report.summary.errorCount).toBe(0)
  })

  test('rejects a missing relative link target', async () => {
    const root = await mutate(
      'README.md',
      (contents) => `${contents}\n[broken](./missing.md#required)\n`
    )
    await expectCodes(root, ['BROKEN_RELATIVE_LINK'])
  })

  test('rejects a missing required link fragment', async () => {
    const root = await mutate(
      'README.md',
      (contents) => `${contents}\n[broken](./STATE.md#missing-required-fragment)\n`
    )
    await expectCodes(root, ['BROKEN_LINK_FRAGMENT'])
  })

  test('rejects a master task removed from a dependency range', async () => {
    const root = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => contents.replace(
        /^\| `FND-012` \|.*\r?\n/m,
        ''
      )
    )
    await expectCodes(root, [
      'MASTER_TASK_MISSING',
      'STATE_CONTROL_TABLE_MISMATCH',
      'STATE_CURRENT_STATUS_MISMATCH',
      'STATE_PHASE_STATUS_MISMATCH',
      'STATE_TASK_UNKNOWN'
    ])
  })

  test('rejects a duplicate master task', async () => {
    const root = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => {
        const row = contents.match(/^\| `FND-012` \|.*$/m)?.[0]
        return contents.replace(row!, `${row}\n${row}`)
      }
    )
    await expectCodes(root, ['MASTER_TASK_DUPLICATE'])
  })

  test('rejects an unknown task reference without confusing ADR IDs', async () => {
    const root = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => `${contents}\nUnknown task: \`FND-999\`.\n`
    )
    await expectCodes(root, ['UNKNOWN_TASK_REFERENCE'])
  })

  test('rejects an explicit missing dependency', async () => {
    const root = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => contents.replace(
        /(\| `FND-012` \| `[^`]+` \| [^|]+ \| )`FND-010`/,
        '$1`FND-999`'
      )
    )
    await expectCodes(root, ['DEPENDENCY_MISSING', 'UNKNOWN_TASK_REFERENCE'])
  })

  test('expands dependency ranges and rejects cycles', async () => {
    const root = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => contents.replace(
        /(\| `FND-001` \| `DONE` \| [^|]+ \| )none/,
        '$1`FND-012`'
      )
    )
    await expectCodes(root, [
      'DEPENDENCY_CYCLE',
      'DEPENDENCY_STATUS_UNSATISFIED'
    ])
  })

  test('rejects malformed dependency syntax instead of ignoring it', async () => {
    const root = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => contents.replace(
        /(\| `FND-012` \| `[^`]+` \| [^|]+ \| )`FND-010`/,
        '$1`ADR-MIG-001`'
      )
    )
    await expectCodes(root, ['DEPENDENCY_SYNTAX_INVALID'])
  })

  test('rejects descending, empty, malformed-width and unknown-prefix ranges', async () => {
    for (const invalidRange of [
      'FND-012..010',
      'FND-012..',
      'FND-001..12',
      'FND-01..012',
      'ZZZ-001..003'
    ]) {
      const root = await mutate(
        '00-MASTER-PLAN.md',
        (contents) => contents.replace(
          /(\| `FND-012` \| `[^`]+` \| [^|]+ \| )`FND-010`/,
          `$1\`${invalidRange}\``
        )
      )
      await expectHasCodes(root, ['DEPENDENCY_SYNTAX_INVALID'])
    }
  })

  test('requires every advanced task status to have DONE dependencies', async () => {
    for (const status of [
      'READY',
      'IN_PROGRESS',
      'VERIFY',
      'DONE',
      'BLOCKED'
    ]) {
      const root = await mutate(
        '00-MASTER-PLAN.md',
        (contents) => replaceTaskStatus(
          replaceTaskStatus(contents, 'FND-010', 'TODO'),
          'FND-012',
          status
        )
      )
      await expectHasCodes(root, ['DEPENDENCY_STATUS_UNSATISFIED'])
    }
  })

  test('rejects a READY gate with a non-DONE dependency range member', async () => {
    const root = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => replaceTaskStatus(contents, 'GATE-00', 'READY')
    )
    const report = await checkMigrationPlan(root)
    expect(
      report.errors.some(
        ({ code, subject, message }) =>
          code === 'DEPENDENCY_STATUS_UNSATISFIED' &&
          subject === 'GATE-00' &&
          message.includes('FND-012')
      )
    ).toBe(true)
  })

  test('permits only the exact accepted-limitation dependency declared for a gate', async () => {
    const allowedRoot = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => replaceTaskStatus(
        replaceTaskStatus(
          contents.replace(
            /(\| `GATE-08` \| `[^`]+` \| [^|]+ \| )[^|]+(?= \| [^|]+ \|$)/m,
            '$1`PKG-011`'
          ),
          'PKG-011',
          'ACCEPTED_LIMITATION'
        ),
        'GATE-08',
        'READY'
      )
    )
    const allowedReport = await checkMigrationPlan(allowedRoot)
    expect(
      allowedReport.errors.some(
        ({ code, subject }) =>
          code === 'DEPENDENCY_STATUS_UNSATISFIED' && subject === 'GATE-08'
      )
    ).toBe(false)

    const rejectedRoot = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => replaceTaskStatus(
        replaceTaskStatus(
          contents.replace(
            /(\| `PKG-012` \| `[^`]+` \| [^|]+ \| )`PKG-010`/,
            '$1`PKG-011`'
          ),
          'PKG-011',
          'ACCEPTED_LIMITATION'
        ),
        'PKG-012',
        'READY'
      )
    )
    const rejectedReport = await checkMigrationPlan(rejectedRoot)
    expect(
      rejectedReport.errors.some(
        ({ code, subject, message }) =>
          code === 'DEPENDENCY_STATUS_UNSATISFIED' &&
          subject === 'PKG-012' &&
          message.includes('PKG-011')
      )
    ).toBe(true)
  })

  test('rejects malformed master task rows', async () => {
    const root = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => contents.replace(
        /^(\| `FND-012` \|.*) \|$/m,
        '$1'
      )
    )
    await expectCodes(root, [
      'MASTER_TASK_MISSING',
      'MASTER_TASK_ROW_MALFORMED',
      'STATE_CONTROL_TABLE_MISMATCH',
      'STATE_CURRENT_STATUS_MISMATCH',
      'STATE_PHASE_STATUS_MISMATCH',
      'STATE_TASK_UNKNOWN',
      'UNKNOWN_TASK_REFERENCE'
    ])
  })

  test('rejects more than one IN_PROGRESS task', async () => {
    const root = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => replaceTaskStatus(
        replaceTaskStatus(contents, 'CON-001', 'IN_PROGRESS'),
        'CON-002',
        'IN_PROGRESS'
      )
    )
    await expectCodes(root, [
      'DEPENDENCY_STATUS_UNSATISFIED',
      'MULTIPLE_IN_PROGRESS',
      'PHASE_ENTRY_GATE_UNSATISFIED'
    ])
  })

  test('rejects STATE current, next, status and table disagreement', async () => {
    const root = await mutate(
      'STATE.md',
      (contents) => contents
        .replace(/^current_task:.*$/m, 'current_task: "FND-011"')
        .replace(/^next_task:.*$/m, 'next_task: null')
    )
    await expectCodes(root, [
      'STATE_CONTROL_TABLE_MISMATCH',
      'STATE_CURRENT_STATUS_MISMATCH',
      'STATE_PHASE_STATUS_MISMATCH'
    ])
  })

  test('rejects DONE without accepted evidence', async () => {
    const root = await mutate(
      'EVIDENCE.md',
      (contents) => contents.replace(
        '### FND-011 / fnd-011-checker-20260730-001',
        '### ARCHIVED-FND-011 / fnd-011-checker-20260730-001'
      )
    )
    await expectCodes(root, ['DONE_WITHOUT_ACCEPTED_EVIDENCE'])
  })

  test('rejects VERIFY evidence presented as complete', async () => {
    const root = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => replaceTaskStatus(contents, 'FND-012', 'VERIFY')
    )
    await writeFile(
      join(root, 'STATE.md'),
      presentFnd012AsVerify(await readFile(join(root, 'STATE.md'), 'utf8'))
    )
    await writeFile(
      join(root, 'EVIDENCE.md'),
      `${await readFile(join(root, 'EVIDENCE.md'), 'utf8')}\n` +
      '### FND-012 / synthetic-checker\n\n- Status: `DONE`\n'
    )
    await expectHasCodes(root, ['VERIFY_PRESENTED_COMPLETE'])
  })

  test('rejects DONE with missing maker/checker identity', async () => {
    const root = await mutate(
      'EVIDENCE.md',
      (contents) => contents.replace(
        /- Maker run\/context ID:\r?\n  `fnd-011-maker-/,
        '- Maker identity:\n  `fnd-011-maker-'
      )
    )
    await expectCodes(root, ['DONE_IDENTITY_MISSING'])
  })

  test('rejects identical maker and checker identities', async () => {
    const root = await mutate(
      'EVIDENCE.md',
      (contents) => contents.replace(
        /- Checker run\/context ID:\r?\n  `fnd-011-checker-20260730-001` \/\r?\n  `fnd-011-checker-context-20260730-001`/,
        '- Checker run/context ID:\n' +
        '  `fnd-011-maker-20260730-001` /\n' +
        '  `fnd-011-maker-context-20260730-001`'
      )
    )
    await expectCodes(root, ['DONE_IDENTITY_NOT_INDEPENDENT'])
  })

  test('rejects a checker recorded as implementation owner', async () => {
    const root = await mutate(
      'EVIDENCE.md',
      (contents) => contents.replace(
        /(- Checker participated in Maker implementation: )`false`(?=[\s\S]*?### FND-011)/,
        '$1`true`'
      )
    )
    await expectCodes(root, ['CHECKER_IMPLEMENTATION_OWNER'])
  })

  test('rejects unknown and duplicate accepted evidence records', async () => {
    const unknownRoot = await mutate(
      'EVIDENCE.md',
      (contents) => `${contents}\n### FND-999 / synthetic\n\n- Status: \`DONE\`\n`
    )
    await expectCodes(unknownRoot, ['EVIDENCE_TASK_UNKNOWN'])

    const duplicateRoot = await mutate(
      'EVIDENCE.md',
      (contents) => `${contents}\n### FND-011 / duplicate\n\n- Status: \`DONE\`\n`
    )
    await expectCodes(duplicateRoot, ['EVIDENCE_TASK_DUPLICATE'])
  })

  test('rejects missing reviewed source-state identity', async () => {
    const root = await mutate(
      'EVIDENCE.md',
      (contents) => contents.replace(
        '- Reviewed source state:\n' +
        '  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;\n' +
        '  exact Maker/Checker source hashes are sealed in the Checker artifact.',
        '- Source receipt: sealed in the Checker artifact.'
      )
    )
    await expectCodes(root, ['REVIEWED_SOURCE_STATE_MISSING'])
  })

  test('rejects a reviewed source-state label without a real hash', async () => {
    const root = await mutate(
      'EVIDENCE.md',
      (contents) => contents.replace(
        '- Reviewed source state:\n' +
        '  `TS_backend_refactor@41665a96cf67eb82cbe02f83abbbe2b79b100e48`;\n' +
        '  exact Maker/Checker source hashes are sealed in the Checker artifact.',
        '- Reviewed source state: `not-a-source-hash`.'
      )
    )
    await expectCodes(root, ['REVIEWED_SOURCE_STATE_MISSING'])
  })

  test('rejects a current blocker without an ACTIVE record', async () => {
    const root = await mutate(
      'BLOCKERS.md',
      (contents) => contents.replace(
        /^> Current blockers:.*$/m,
        '> Current blockers: FND-012-SYNTHETIC'
      )
    )
    await expectHasCodes(root, ['ACTIVE_BLOCKER_MISSING'])
  })

  test('rejects BLOCKED task state without a current blocker', async () => {
    const root = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => replaceTaskStatus(contents, 'FND-012', 'BLOCKED')
    )
    await writeFile(
      join(root, 'STATE.md'),
      (await readFile(join(root, 'STATE.md'), 'utf8'))
        .replace(/^current_task:.*$/m, 'current_task: "FND-012"')
        .replace(/^next_task:.*$/m, 'next_task: null')
        .replace(
          /^\| Current phase \|.*$/m,
          '| Current phase | Phase 00: `BLOCKED` |'
        )
        .replace(
          /^\| Current task \|.*$/m,
          '| Current task | `FND-012` (`BLOCKED`) |'
        )
        .replace(/^\| Next task \|.*$/m, '| Next task | None |')
    )
    await writeFile(
      join(root, 'RUN-LOG.md'),
      `${await readFile(join(root, 'RUN-LOG.md'), 'utf8')}\n` +
        '- State transition: `FND-012` `VERIFY` -> `BLOCKED`.\n'
    )
    await writeFile(
      join(root, 'BLOCKERS.md'),
      (await readFile(join(root, 'BLOCKERS.md'), 'utf8'))
        .replace(/^> Current blockers:.*$/m, '> Current blockers: none')
    )
    await expectCodes(root, ['BLOCKED_TASK_WITHOUT_ACTIVE_BLOCKER'])
  })

  test('rejects an active blocker owned by an unknown task', async () => {
    const root = await mutate(
      'BLOCKERS.md',
      (contents) => contents
        .replace(
          /^> Current blockers:.*$/m,
          '> Current blockers: ZZZ-999-SYNTHETIC'
        )
        .replace(
          '## Resolved Blockers',
          '## `ZZZ-999-SYNTHETIC` - `ZZZ-999` - synthetic\n\n' +
          '- Status: `ACTIVE`\n\n## Resolved Blockers'
        )
    )
    await expectHasCodes(root, ['BLOCKER_TASK_UNKNOWN'])
  })

  test('rejects a phase marked DONE before its gate', async () => {
    const root = await mutate(
      'STATE.md',
      (contents) => contents.replace(
        /^(\| 00 Foundation and spikes \| )`[^`]+`/m,
        '$1`DONE`'
      )
    )
    await expectCodes(root, ['PHASE_DONE_GATE_NOT_DONE'])
  })

  test('rejects unsatisfied external conditions when a gate advances', async () => {
    const root = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => replaceTaskStatus(contents, 'GATE-04', 'VERIFY')
    )
    await expectCodes(root, [
      'DEPENDENCY_STATUS_UNSATISFIED',
      'GATE_EXTERNAL_CONDITION_UNSATISFIED',
      'PHASE_ENTRY_GATE_UNSATISFIED'
    ])
  })

  test('enforces both Phase 04 entry gates', async () => {
    const root = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => replaceTaskStatus(
        replaceTaskStatus(contents, 'GATE-02', 'DONE'),
        'AGT-001',
        'READY'
      )
    )
    await expectCodes(root, [
      'DEPENDENCY_STATUS_UNSATISFIED',
      'DONE_WITHOUT_ACCEPTED_EVIDENCE',
      'PHASE_ENTRY_GATE_UNSATISFIED'
    ])
  })

  test('enforces both Phase 07 entry gates', async () => {
    const root = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => replaceTaskStatus(
        replaceTaskStatus(contents, 'GATE-05', 'DONE'),
        'TST-000',
        'READY'
      )
    )
    await expectCodes(root, [
      'DEPENDENCY_STATUS_UNSATISFIED',
      'DONE_WITHOUT_ACCEPTED_EVIDENCE',
      'PHASE_ENTRY_GATE_UNSATISFIED'
    ])
  })

  test('rejects downstream work before its phase entry gate', async () => {
    const root = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => replaceTaskStatus(contents, 'CON-001', 'READY')
    )
    await expectCodes(root, [
      'DEPENDENCY_STATUS_UNSATISFIED',
      'PHASE_ENTRY_GATE_UNSATISFIED'
    ])
  })

  test('rejects an invalid terminal transition chain', async () => {
    const root = await mutate(
      'RUN-LOG.md',
      (contents) => `${contents}\n- State transition: \`FND-011\` \`DONE\` -> \`READY\`.\n`
    )
    await expectCodes(root, [
      'INVALID_TRANSITION_CHAIN',
      'TRANSITION_FINAL_STATUS_MISMATCH'
    ])
  })

  test('rejects a missing latest run-log entry', async () => {
    const root = await mutate(
      'STATE.md',
      (contents) => contents.replace(
        /^last_run_id:.*$/m,
        'last_run_id: "fnd-012-checker-missing"'
      )
    )
    await expectCodes(root, ['RUN_LOG_ENTRY_MISSING'])
  })

  test('rejects malformed STATE frontmatter', async () => {
    const root = await mutate(
      'STATE.md',
      (contents) => contents.replace(/^---\r?\n/, '')
    )
    await expectCodes(root, ['STATE_FRONTMATTER_MALFORMED'])
  })

  test('rejects missing STATE frontmatter fields', async () => {
    const root = await mutate(
      'STATE.md',
      (contents) => contents.replace('migration_id:', 'migration_identifier:')
    )
    await expectCodes(root, ['STATE_FRONTMATTER_FIELD_MISSING'])
  })

  test('requires the full budget and source identity frontmatter schema', async () => {
    const root = await mutate(
      'STATE.md',
      (contents) => contents.replace(/^token_budget:.*\r?\n/m, '')
    )
    await expectCodes(root, ['STATE_FRONTMATTER_FIELD_MISSING'])
  })

  test('rejects incorrect STATE frontmatter field types', async () => {
    const root = await mutate(
      'STATE.md',
      (contents) => contents.replace(/^pause: false$/m, 'pause: "false"')
    )
    await expectCodes(root, ['STATE_FRONTMATTER_FIELD_TYPE'])
  })

  test('rejects invalid STATE frontmatter values', async () => {
    const root = await mutate(
      'STATE.md',
      (contents) => contents.replace(
        /^schema_version: 1$/m,
        'schema_version: 2'
      )
    )
    await expectCodes(root, ['STATE_FRONTMATTER_VALUE_INVALID'])
  })

  test('rejects a well-formed non-canonical master task row', async () => {
    const root = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => {
        const row = contents.match(/^\| `FND-012` \|.*$/m)?.[0]
        return contents.replace(
          row!,
          `${row}\n| \`FND-999\` | \`TODO\` | Synthetic | none | Synthetic |`
        )
      }
    )
    await expectHasCodes(root, ['MASTER_TASK_UNKNOWN'])
  })

  test('rejects a removed canonical leaf even when its gate range is narrowed', async () => {
    const root = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => contents
        .replace(/^\| `CUT-014` \|.*\r?\n/m, '')
        .replace('`CUT-001..014`', '`CUT-001..013`')
    )
    await expectHasCodes(root, ['MASTER_TASK_MISSING'])
  })

  test('rejects unknown, missing, duplicate, misplaced and malformed phase headings', async () => {
    const unknown = await mutate(
      '01-FOUNDATION-TOOLCHAIN.md',
      (contents) => `${contents}\n### \`FND-999\` Synthetic\n`
    )
    await expectHasCodes(unknown, ['PHASE_TASK_UNKNOWN'])

    const missing = await mutate(
      '10-CUTOVER-CLEANUP.md',
      (contents) => contents.replace(
        /^### `CUT-014`/m,
        '### CUT-014'
      )
    )
    await expectHasCodes(missing, [
      'PHASE_TASK_HEADING_MALFORMED',
      'PHASE_TASK_MISSING'
    ])

    const duplicate = await mutate(
      '01-FOUNDATION-TOOLCHAIN.md',
      (contents) => {
        const heading = contents.match(/^### `FND-012`.*$/m)?.[0]
        return contents.replace(heading!, `${heading}\n${heading}`)
      }
    )
    await expectHasCodes(duplicate, ['PHASE_TASK_DUPLICATE'])

    const misplaced = await mutate(
      '01-FOUNDATION-TOOLCHAIN.md',
      (contents) => contents.replace(
        /^### `FND-001`/m,
        '### `CON-001`'
      )
    )
    await expectHasCodes(misplaced, [
      'PHASE_TASK_MISPLACED',
      'PHASE_TASK_MISSING'
    ])
  })

  test('rejects a generic unknown task-like phase heading', async () => {
    const root = await mutate(
      '01-FOUNDATION-TOOLCHAIN.md',
      (contents) => `${contents}\n### \`ZZZ-999\` Synthetic\n`
    )
    await expectHasCodes(root, ['PHASE_TASK_UNKNOWN'])
  })

  test('rejects task and gate headings at the wrong schema level', async () => {
    const taskRoot = await mutate(
      '01-FOUNDATION-TOOLCHAIN.md',
      (contents) => contents.replace(
        /^### `FND-012`/m,
        '## `FND-012`'
      )
    )
    await expectHasCodes(taskRoot, [
      'PHASE_TASK_HEADING_LEVEL',
      'PHASE_TASK_MISSING'
    ])

    const gateRoot = await mutate(
      '01-FOUNDATION-TOOLCHAIN.md',
      (contents) => contents.replace(
        /^## `GATE-00`/m,
        '### `GATE-00`'
      )
    )
    await expectHasCodes(gateRoot, [
      'PHASE_TASK_HEADING_LEVEL',
      'PHASE_TASK_MISSING'
    ])
  })

  test('rejects an unknown task-like master prefix', async () => {
    const root = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => {
        const row = contents.match(/^\| `FND-012` \|.*$/m)?.[0]
        return contents.replace(
          row!,
          `${row}\n| \`ZZZ-999\` | \`TODO\` | Synthetic | none | Synthetic |`
        )
      }
    )
    await expectHasCodes(root, ['MASTER_TASK_UNKNOWN'])
  })

  test('rejects a duplicate ACTIVE blocker heading', async () => {
    const root = await mutate(
      'BLOCKERS.md',
      (contents) => {
        const blockerId = contents.match(/^> Current blockers: ([^\r\n]+)$/m)?.[1]
        const record = contents.match(
          new RegExp(
            '^## `' +
            blockerId!.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
            '`[^\\r\\n]*\\r?\\n[\\s\\S]*?(?=^## )',
            'm'
          )
        )?.[0]
        return contents.replace(record!, `${record}\n${record}\n`)
      }
    )
    await expectHasCodes(root, ['ACTIVE_BLOCKER_DUPLICATE'])
  })

  test('does not confuse ADR, invariant or gap identifiers with tasks', async () => {
    const root = await mutate(
      '01-FOUNDATION-TOOLCHAIN.md',
      (contents) => `${contents}\n### \`ADR-MIG-999\` Synthetic\n` +
        '### `INV-999` Synthetic\n### `GAP-PRIV-999` Synthetic\n'
    )
    const report = await checkMigrationPlan(root)
    expect(report.status).toBe('passed')
    expect(report.documentsUnchanged).toBe(true)
  })

  test('preserves CLI JSON, report path and exit 0/1/2 semantics', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'advx-plan-check-cli-'))
    temporaryRoots.push(parent)
    const reportPath = join(parent, 'clean-report.json')
    const command = join(process.cwd(), 'scripts', 'migration-plan-check.ts')
    const clean = Bun.spawnSync([
      process.execPath,
      command,
      '--root',
      liveRoot,
      '--report',
      reportPath
    ])
    expect(clean.exitCode).toBe(0)
    expect(JSON.parse(clean.stdout.toString()).status).toBe('passed')
    expect(await readFile(reportPath, 'utf8')).toBe(clean.stdout.toString())

    const driftRoot = await mutate(
      '00-MASTER-PLAN.md',
      (contents) => {
        const row = contents.match(/^\| `FND-012` \|.*$/m)?.[0]
        return contents.replace(
          row!,
          `${row}\n| \`FND-999\` | \`TODO\` | Synthetic | none | Synthetic |`
        )
      }
    )
    const drift = Bun.spawnSync([
      process.execPath,
      command,
      '--root',
      driftRoot
    ])
    expect(drift.exitCode).toBe(1)
    expect(JSON.parse(drift.stdout.toString()).status).toBe('failed')

    const failure = Bun.spawnSync([
      process.execPath,
      command,
      '--root',
      join(parent, 'missing')
    ])
    expect(failure.exitCode).toBe(2)
    expect(failure.stderr.length).toBeGreaterThan(0)
  }, 15_000)
})
