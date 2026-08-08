import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

type TaskStatus =
  | 'TODO'
  | 'READY'
  | 'IN_PROGRESS'
  | 'VERIFY'
  | 'DONE'
  | 'BLOCKED'
  | 'DEFERRED'
  | 'ACCEPTED_LIMITATION'
  | 'SUPERSEDED'

interface Task {
  id: string
  status: TaskStatus
  dependencies: string[]
  dependencyRanges: string[]
  phase: number
}

interface StateFrontmatter {
  schema_version: number
  migration_id: string
  status: string
  pause: boolean
  pause_reason: string | null
  unattended: boolean
  iteration_budget: number | null
  wall_clock_budget_minutes: number | null
  token_budget: number | null
  cost_budget_usd: number | null
  current_phase: string
  current_task: string | null
  next_task: string | null
  baseline_commit: string
  last_verified_commit: string
  current_head: string
  current_branch: string
  worktree_root: string
  worktree_dirty: boolean
  last_run_id: string
  last_context_id: string
  maker_run_id: string
  maker_context_id: string
  checker_run_id: string | null
  checker_context_id: string | null
  same_blocker_attempts: number
}

export interface PlanCheckError {
  code: string
  file: string
  message: string
  subject?: string
}

export interface PlanCheckReport {
  schemaVersion: 1
  status: 'passed' | 'failed'
  root: string
  checkedFiles: string[]
  inputHashes: Record<string, string>
  documentsUnchanged: boolean
  summary: {
    taskCount: number
    linkCount: number
    acceptedEvidenceCount: number
    errorCount: number
  }
  errors: PlanCheckError[]
}

const taskIdPattern =
  /^(?:FND|CON|BCK|DAT|AGT|DES|OBS|TST|PKG|CUT)-\d{3}$|^GATE-\d{2}$/
const taskReferencePattern =
  /\b(?:FND|CON|BCK|DAT|AGT|DES|OBS|TST|PKG|CUT)-\d{3}\b|\bGATE-\d{2}\b/g
const statuses = new Set<TaskStatus>([
  'TODO',
  'READY',
  'IN_PROGRESS',
  'VERIFY',
  'DONE',
  'BLOCKED',
  'DEFERRED',
  'ACCEPTED_LIMITATION',
  'SUPERSEDED'
])
const phasePrefixes = [
  'FND',
  'CON',
  'BCK',
  'DAT',
  'AGT',
  'DES',
  'OBS',
  'TST',
  'PKG',
  'CUT'
]
const phaseFiles = [
  '01-FOUNDATION-TOOLCHAIN.md',
  '02-CONTRACTS-PROTOCOL.md',
  '03-BUN-BACKEND.md',
  '04-DATA-PERSISTENCE.md',
  '05-AGENT-RUNTIME.md',
  '06-DESKTOP-INTEGRATION.md',
  '07-OBSERVABILITY-REPLAY.md',
  '08-TEST-TOOLING.md',
  '09-PACKAGING-SECURITY.md',
  '10-CUTOVER-CLEANUP.md'
]
const phaseTaskBounds = [
  ['FND', 1, 12],
  ['CON', 1, 10],
  ['BCK', 1, 11],
  ['DAT', 1, 11],
  ['AGT', 1, 15],
  ['DES', 1, 11],
  ['OBS', 1, 12],
  ['TST', 0, 14],
  ['PKG', 1, 12],
  ['CUT', 1, 14]
] as const
const canonicalTasksByPhase = phaseTaskBounds.map(
  ([prefix, start, end], phase) => {
    const ids = Array.from(
      { length: end - start + 1 },
      (_, index) => `${prefix}-${String(start + index).padStart(3, '0')}`
    )
    return [...ids, `GATE-${String(phase).padStart(2, '0')}`]
  }
)
const canonicalTaskPhases = new Map(
  canonicalTasksByPhase.flatMap((ids, phase) =>
    ids.map((id) => [id, phase] as const)
  )
)
const phaseEntryGates: string[][] = [
  [],
  ['GATE-00'],
  ['GATE-01'],
  ['GATE-01'],
  ['GATE-02', 'GATE-03'],
  ['GATE-04'],
  ['GATE-05'],
  ['GATE-05', 'GATE-06'],
  ['GATE-07'],
  ['GATE-08']
]
const requiredStateFields: Record<
  keyof StateFrontmatter,
  'string' | 'number' | 'boolean' | 'nullable-string' | 'nullable-number'
> = {
  schema_version: 'number',
  migration_id: 'string',
  status: 'string',
  pause: 'boolean',
  pause_reason: 'nullable-string',
  unattended: 'boolean',
  iteration_budget: 'nullable-number',
  wall_clock_budget_minutes: 'nullable-number',
  token_budget: 'nullable-number',
  cost_budget_usd: 'nullable-number',
  current_phase: 'string',
  current_task: 'nullable-string',
  next_task: 'nullable-string',
  baseline_commit: 'string',
  last_verified_commit: 'string',
  current_head: 'string',
  current_branch: 'string',
  worktree_root: 'string',
  worktree_dirty: 'boolean',
  last_run_id: 'string',
  last_context_id: 'string',
  maker_run_id: 'string',
  maker_context_id: 'string',
  checker_run_id: 'nullable-string',
  checker_context_id: 'nullable-string',
  same_blocker_attempts: 'number'
}

function error(
  errors: PlanCheckError[],
  code: string,
  file: string,
  message: string,
  subject?: string
): void {
  errors.push({ code, file, message, ...(subject ? { subject } : {}) })
}

function hash(contents: string): string {
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(contents)
  return hasher.digest('hex')
}

function parseFrontmatter(
  contents: string,
  errors: PlanCheckError[]
): StateFrontmatter | undefined {
  const match = contents.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (!match) {
    error(
      errors,
      'STATE_FRONTMATTER_MALFORMED',
      'STATE.md',
      'STATE.md must begin with a closed YAML frontmatter block'
    )
    return undefined
  }

  let parsed: unknown
  try {
    parsed = Bun.YAML.parse(match[1]!)
  } catch (cause) {
    error(
      errors,
      'STATE_FRONTMATTER_MALFORMED',
      'STATE.md',
      cause instanceof Error ? cause.message : String(cause)
    )
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    error(
      errors,
      'STATE_FRONTMATTER_TYPE',
      'STATE.md',
      'Frontmatter root must be a mapping'
    )
    return undefined
  }

  const record = parsed as Record<string, unknown>
  for (const [field, expectedType] of Object.entries(requiredStateFields)) {
    if (!(field in record)) {
      error(
        errors,
        'STATE_FRONTMATTER_FIELD_MISSING',
        'STATE.md',
        `Required field ${field} is missing`,
        field
      )
      continue
    }
    const value = record[field]
    const valid =
      expectedType === 'nullable-string'
        ? value === null || typeof value === 'string'
        : expectedType === 'nullable-number'
          ? value === null || typeof value === 'number'
        : typeof value === expectedType
    if (!valid) {
      error(
        errors,
        'STATE_FRONTMATTER_FIELD_TYPE',
        'STATE.md',
        `${field} must be ${expectedType}`,
        field
      )
    }
  }
  if (errors.some(({ code }) => code.startsWith('STATE_FRONTMATTER_'))) {
    return undefined
  }
  if (record.schema_version !== 1) {
    error(
      errors,
      'STATE_FRONTMATTER_VALUE_INVALID',
      'STATE.md',
      'schema_version must equal 1',
      'schema_version'
    )
  }
  if (!['ACTIVE', 'PAUSED'].includes(String(record.status))) {
    error(
      errors,
      'STATE_FRONTMATTER_VALUE_INVALID',
      'STATE.md',
      'status must be ACTIVE or PAUSED',
      'status'
    )
  }
  if (!Number.isInteger(record.same_blocker_attempts) ||
      Number(record.same_blocker_attempts) < 0) {
    error(
      errors,
      'STATE_FRONTMATTER_VALUE_INVALID',
      'STATE.md',
      'same_blocker_attempts must be a non-negative integer',
      'same_blocker_attempts'
    )
  }
  for (const field of [
    'baseline_commit',
    'last_verified_commit',
    'current_head'
  ]) {
    if (!/^[0-9a-f]{40}$/i.test(String(record[field]))) {
      error(
        errors,
        'STATE_FRONTMATTER_VALUE_INVALID',
        'STATE.md',
        `${field} must be a 40-character Git identity`,
        field
      )
    }
  }
  if (errors.some(({ code }) => code.startsWith('STATE_FRONTMATTER_'))) {
    return undefined
  }
  return record as unknown as StateFrontmatter
}

function expandDependencies(
  raw: string
): { dependencies: string[]; ranges: string[]; invalid: string[] } {
  const normalized = raw.replaceAll('`', '').trim()
  if (normalized.toLowerCase() === 'none') {
    return { dependencies: [], ranges: [], invalid: [] }
  }
  const dependencies: string[] = []
  const ranges: string[] = []
  const invalid: string[] = []
  for (const part of normalized.split(',').map((value) => value.trim())) {
    const range = part.match(/^([A-Z]+)-(\d{2,3})\.\.(\d{2,3})$/)
    if (range) {
      const [, prefix, startText, endText] = range
      const start = Number(startText)
      const end = Number(endText)
      const expectedWidth = prefix === 'GATE' ? 2 : 3
      if (
        ![...phasePrefixes, 'GATE'].includes(prefix!) ||
        startText!.length !== expectedWidth ||
        endText!.length !== expectedWidth ||
        start > end
      ) {
        invalid.push(part)
        continue
      }
      ranges.push(part)
      for (let value = start; value <= end; value += 1) {
        dependencies.push(`${prefix}-${String(value).padStart(expectedWidth, '0')}`)
      }
      continue
    }
    if (taskIdPattern.test(part)) {
      dependencies.push(part)
    } else {
      invalid.push(part)
    }
  }
  return { dependencies, ranges, invalid }
}

function acceptedLimitationDependencies(master: string): Map<string, Set<string>> {
  const permitted = new Map<string, Set<string>>()
  const externalSection = master.match(
    /## Gate External Conditions([\s\S]*?)(?=^## Global Verification Matrix)/m
  )?.[1] ?? ''
  for (const row of externalSection.matchAll(
    /^\| `(GATE-\d{2})` \| `([^`]+)` \| (.+?) \| [^|]+ \|$/gm
  )) {
    const [, downstream, dependency, allowedRaw] = row
    const allowed: string[] = allowedRaw!.match(/[A-Z_]+/g) ?? []
    if (allowed.includes('ACCEPTED_LIMITATION')) {
      const dependencies = permitted.get(downstream!) ?? new Set<string>()
      dependencies.add(dependency!)
      permitted.set(downstream!, dependencies)
    }
  }
  return permitted
}

function parseMaster(
  contents: string,
  errors: PlanCheckError[]
): Map<string, Task> {
  const tasks = new Map<string, Task>()
  let phase = -1
  let inTaskTable = false
  for (const line of contents.split(/\r?\n/)) {
    const phaseMatch = line.match(/^### Phase (\d{2}):/)
    if (phaseMatch) {
      phase = Number(phaseMatch[1])
      inTaskTable = true
      continue
    }
    if (line.startsWith('## Gate External Conditions')) {
      inTaskTable = false
    }
    const row = line.match(
      /^\| `([^`]+)` \| `([^`]+)` \| [^|]* \| ([^|]+) \| [^|]* \|$/
    )
    if (!row || phase < 0 || !inTaskTable) {
      if (
        inTaskTable &&
        /^\| `[A-Z]+-\d{2,3}`/.test(line) &&
        !/^\| `[^`]+` \| `[^`]+` \| [^|]* \| [^|]+ \| [^|]* \|$/.test(line)
      ) {
        error(
          errors,
          'MASTER_TASK_ROW_MALFORMED',
          '00-MASTER-PLAN.md',
          `Malformed task row: ${line}`
        )
      }
      continue
    }
    const [, id, status, rawDependencies] = row
    if (!taskIdPattern.test(id!)) {
      continue
    }
    if (!statuses.has(status as TaskStatus)) {
      error(
        errors,
        'MASTER_STATUS_INVALID',
        '00-MASTER-PLAN.md',
        `Task ${id} has unsupported status ${status}`,
        id
      )
      continue
    }
    if (tasks.has(id!)) {
      error(
        errors,
        'MASTER_TASK_DUPLICATE',
        '00-MASTER-PLAN.md',
        `Task ${id} appears more than once`,
        id
      )
      continue
    }
    const parsedDependencies = expandDependencies(rawDependencies!)
    for (const invalid of parsedDependencies.invalid) {
      error(
        errors,
        'DEPENDENCY_SYNTAX_INVALID',
        '00-MASTER-PLAN.md',
        `${id} has invalid dependency syntax ${invalid}`,
        invalid
      )
    }
    tasks.set(id!, {
      id: id!,
      status: status as TaskStatus,
      dependencies: parsedDependencies.dependencies,
      dependencyRanges: parsedDependencies.ranges,
      phase
    })
  }
  return tasks
}

function validateCanonicalTaskInventory(
  master: string,
  tasks: Map<string, Task>,
  files: Map<string, string>,
  errors: PlanCheckError[]
): void {
  for (const [id, expectedPhase] of canonicalTaskPhases) {
    const task = tasks.get(id)
    if (!task) {
      error(
        errors,
        'MASTER_TASK_MISSING',
        '00-MASTER-PLAN.md',
        `Canonical task ${id} is missing from the master table`,
        id
      )
    } else if (task.phase !== expectedPhase) {
      error(
        errors,
        'MASTER_TASK_PHASE_MISMATCH',
        '00-MASTER-PLAN.md',
        `${id} belongs to phase ${expectedPhase}, not phase ${task.phase}`,
        id
      )
    }
  }
  for (const task of tasks.values()) {
    if (!canonicalTaskPhases.has(task.id)) {
      error(
        errors,
        'MASTER_TASK_UNKNOWN',
        '00-MASTER-PLAN.md',
        `Master table contains non-canonical task ${task.id}`,
        task.id
      )
    }
  }

  let inTaskTable = false
  for (const line of master.split(/\r?\n/)) {
    if (/^### Phase \d{2}:/.test(line)) {
      inTaskTable = true
      continue
    }
    if (line.startsWith('## Gate External Conditions')) {
      inTaskTable = false
    }
    if (!inTaskTable) {
      continue
    }
    const rowId = line.match(/^\| `([A-Z]+-\d{2,3})`/)?.[1]
    if (rowId && !canonicalTaskPhases.has(rowId)) {
      error(
        errors,
        'MASTER_TASK_UNKNOWN',
        '00-MASTER-PLAN.md',
        `Master table contains unknown task-like row ${rowId}`,
        rowId
      )
    }
  }

  const canonicalPrefixPattern = phasePrefixes.join('|')
  for (let phase = 0; phase < phaseFiles.length; phase += 1) {
    const file = phaseFiles[phase]!
    const contents = files.get(file) ?? ''
    const expected = new Set(canonicalTasksByPhase[phase])
    const found = new Map<string, number>()
    for (const line of contents.split(/\r?\n/)) {
      const heading = line.match(
        /^(#+) `([A-Z]+-\d{2,3})`(?:\s|$)/
      )
      if (heading) {
        const level = heading[1]!
        const id = heading[2]!
        if (id.startsWith('INV-')) {
          continue
        }
        const expectedLevel = id.startsWith('GATE-') ? '##' : '###'
        if (canonicalTaskPhases.has(id) && level !== expectedLevel) {
          error(
            errors,
            'PHASE_TASK_HEADING_LEVEL',
            file,
            `${id} must use ${expectedLevel}, not ${level}`,
            id
          )
          continue
        }
        found.set(id, (found.get(id) ?? 0) + 1)
        if (!canonicalTaskPhases.has(id)) {
          error(
            errors,
            'PHASE_TASK_UNKNOWN',
            file,
            `Phase document contains non-canonical task heading ${id}`,
            id
          )
        } else if (!expected.has(id)) {
          error(
            errors,
            'PHASE_TASK_MISPLACED',
            file,
            `${id} belongs in ${phaseFiles[canonicalTaskPhases.get(id)!]}`,
            id
          )
        }
        continue
      }
      const malformed = line.match(
        new RegExp(`^#+\\s+.*\\b((?:${canonicalPrefixPattern})-\\d{3}|GATE-\\d{2})\\b`)
      )
      if (malformed) {
        error(
          errors,
          'PHASE_TASK_HEADING_MALFORMED',
          file,
          `Malformed task heading for ${malformed[1]}`,
          malformed[1]
        )
      }
    }
    for (const id of expected) {
      const count = found.get(id) ?? 0
      if (count === 0) {
        error(
          errors,
          'PHASE_TASK_MISSING',
          file,
          `Canonical task heading ${id} is missing`,
          id
        )
      } else if (count > 1) {
        error(
          errors,
          'PHASE_TASK_DUPLICATE',
          file,
          `Canonical task heading ${id} appears ${count} times`,
          id
        )
      }
    }
  }
}

function validateDependencies(
  tasks: Map<string, Task>,
  master: string,
  errors: PlanCheckError[]
): void {
  for (const task of tasks.values()) {
    for (const dependency of task.dependencies) {
      if (tasks.has(dependency)) {
        continue
      }
      const fromRange = task.dependencyRanges.some((range) => {
        const { dependencies } = expandDependencies(range)
        return dependencies.includes(dependency)
      })
      error(
        errors,
        fromRange ? 'MASTER_TASK_MISSING' : 'DEPENDENCY_MISSING',
        '00-MASTER-PLAN.md',
        `${task.id} depends on missing task ${dependency}`,
        dependency
      )
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const visit = (id: string, path: string[]): void => {
    if (visiting.has(id)) {
      error(
        errors,
        'DEPENDENCY_CYCLE',
        '00-MASTER-PLAN.md',
        `Dependency cycle: ${[...path, id].join(' -> ')}`,
        id
      )
      return
    }
    if (visited.has(id)) {
      return
    }
    visiting.add(id)
    const task = tasks.get(id)
    for (const dependency of task?.dependencies ?? []) {
      if (tasks.has(dependency)) {
        visit(dependency, [...path, id])
      }
    }
    visiting.delete(id)
    visited.add(id)
  }
  for (const id of tasks.keys()) {
    visit(id, [])
  }

  const advancedStatuses = new Set<TaskStatus>([
    'READY',
    'IN_PROGRESS',
    'VERIFY',
    'DONE',
    'BLOCKED'
  ])
  const acceptedLimitations = acceptedLimitationDependencies(master)
  for (const task of tasks.values()) {
    if (!advancedStatuses.has(task.status)) {
      continue
    }
    for (const dependencyId of task.dependencies) {
      const dependencyStatus = tasks.get(dependencyId)?.status
      const exactLimitationPermitted =
        dependencyStatus === 'ACCEPTED_LIMITATION' &&
        acceptedLimitations.get(task.id)?.has(dependencyId) === true
      if (
        dependencyStatus !== undefined &&
        dependencyStatus !== 'DONE' &&
        !exactLimitationPermitted
      ) {
        error(
          errors,
          'DEPENDENCY_STATUS_UNSATISFIED',
          '00-MASTER-PLAN.md',
          `${task.id} is ${task.status} while dependency ${dependencyId} is ${dependencyStatus}`,
          task.id
        )
      }
    }
  }
}

function parseEvidence(
  contents: string,
  tasks: Map<string, Task>,
  errors: PlanCheckError[]
): Map<string, string> {
  const records = new Map<string, string>()
  const matches = [...contents.matchAll(
    /^### ((?:FND|CON|BCK|DAT|AGT|DES|OBS|TST|PKG|CUT)-\d{3}|GATE-\d{2}) \/ [^\r\n]+$(.*?)(?=^### |(?![\s\S]))/gms
  )]
  for (const match of matches) {
    if (!tasks.has(match[1]!)) {
      error(
        errors,
        'EVIDENCE_TASK_UNKNOWN',
        'EVIDENCE.md',
        `Evidence references unknown task ${match[1]}`,
        match[1]
      )
      continue
    }
    if (records.has(match[1]!)) {
      error(
        errors,
        'EVIDENCE_TASK_DUPLICATE',
        'EVIDENCE.md',
        `Task ${match[1]} has multiple accepted evidence records`,
        match[1]
      )
      continue
    }
    records.set(match[1]!, match[2]!)
  }
  return records
}

function parseRunContext(
  value: string | undefined
): { run: string; context: string } | undefined {
  const identities = value?.match(/`([^`]+)`/g)
    ?.map((entry) => entry.slice(1, -1))
  if (!identities || identities.length !== 2) {
    return undefined
  }
  const [run, context] = identities
  if (!run || !context || !run.includes('-') || !context.includes('-context-')) {
    return undefined
  }
  return { run, context }
}

function fieldValue(record: string, label: string): string | undefined {
  const lines = record.split(/\r?\n/)
  const prefix = `- ${label}:`
  const index = lines.findIndex((line) => line.startsWith(prefix))
  if (index < 0) {
    return undefined
  }
  const values = [lines[index]!.slice(prefix.length).trim()]
  for (const line of lines.slice(index + 1)) {
    if (!line.startsWith('  ')) {
      break
    }
    values.push(line.trim())
  }
  const value = values.filter(Boolean).join(' ')
  return value || undefined
}

function validateEvidence(
  tasks: Map<string, Task>,
  evidence: string,
  stateContents: string,
  errors: PlanCheckError[]
): number {
  const records = parseEvidence(evidence, tasks, errors)
  for (const task of tasks.values()) {
    const record = records.get(task.id)
    if (task.status === 'DONE') {
      if (!record || !record.includes('- Status: `DONE`')) {
        error(
          errors,
          'DONE_WITHOUT_ACCEPTED_EVIDENCE',
          'EVIDENCE.md',
          `${task.id} is DONE without an accepted evidence record`,
          task.id
        )
        continue
      }
      const maker = parseRunContext(fieldValue(record, 'Maker run/context ID'))
      const checker = parseRunContext(fieldValue(record, 'Checker run/context ID'))
      if (!maker || !checker) {
        error(
          errors,
          'DONE_IDENTITY_MISSING',
          'EVIDENCE.md',
          `${task.id} is missing maker or checker run/context identity`,
          task.id
        )
      } else if (
        maker.run === checker.run ||
        maker.context === checker.context ||
        maker.run === checker.context ||
        maker.context === checker.run
      ) {
        error(
          errors,
          'DONE_IDENTITY_NOT_INDEPENDENT',
          'EVIDENCE.md',
          `${task.id} maker and checker identities are identical`,
          task.id
        )
      }
      const participation =
        fieldValue(record, 'Checker participated in implementation') ??
        fieldValue(record, 'Checker participated in Maker implementation')
      if (participation !== '`false`') {
        error(
          errors,
          'CHECKER_IMPLEMENTATION_OWNER',
          'EVIDENCE.md',
          `${task.id} checker independence is missing or false`,
          task.id
        )
      }
      const reviewed =
        fieldValue(record, 'Reviewed source-state hash') ??
        fieldValue(record, 'Reviewed source state')
      const dirtyIdentity =
        fieldValue(record, 'Dirty source identity') ??
        fieldValue(record, 'Dirty diff identity')
      const concreteIdentity = /\b[0-9a-f]{40}(?:[0-9a-f]{24})?\b/i
      const reviewedValid = Boolean(reviewed && concreteIdentity.test(reviewed))
      const dirtyValid = Boolean(
        dirtyIdentity && concreteIdentity.test(dirtyIdentity)
      )
      const artifactReviewed = /source-state[^`\s]*\.json/i.test(record) &&
        concreteIdentity.test(record)
      if (!reviewedValid && !dirtyValid && !artifactReviewed) {
        error(
          errors,
          'REVIEWED_SOURCE_STATE_MISSING',
          'EVIDENCE.md',
          `${task.id} lacks reviewed source-state identity`,
          task.id
        )
      }
    }
    if (task.status === 'VERIFY') {
      if (record?.includes('- Status: `DONE`')) {
        error(
          errors,
          'VERIFY_PRESENTED_COMPLETE',
          'EVIDENCE.md',
          `${task.id} is VERIFY but has DONE evidence`,
          task.id
        )
      }
      const completePattern = new RegExp(
        `\\\`${task.id}\\\`\\s+(?:is|becomes)\\s+\\\`DONE\\\``
      )
      if (completePattern.test(stateContents)) {
        error(
          errors,
          'VERIFY_PRESENTED_COMPLETE',
          'STATE.md',
          `${task.id} is VERIFY but STATE presents it as DONE`,
          task.id
        )
      }
    }
  }
  return records.size
}

function stateTableValue(contents: string, field: string): string | undefined {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return contents.match(
    new RegExp(`^\\| ${escaped} \\| (.+) \\|$`, 'm')
  )?.[1]
}

function validateState(
  state: StateFrontmatter | undefined,
  contents: string,
  tasks: Map<string, Task>,
  errors: PlanCheckError[]
): void {
  if (!state) {
    return
  }
  if (!/^\d{2}$/.test(state.current_phase)) {
    error(
      errors,
      'STATE_CURRENT_PHASE_INVALID',
      'STATE.md',
      'current_phase must be a two-digit phase number'
    )
  }
  for (const [field, taskId] of [
    ['current_task', state.current_task],
    ['next_task', state.next_task]
  ] as const) {
    if (taskId && !tasks.has(taskId)) {
      error(
        errors,
        'STATE_TASK_UNKNOWN',
        'STATE.md',
        `${field} references unknown task ${taskId}`,
        taskId
      )
    }
  }
  if (state.current_task && state.next_task) {
    error(
      errors,
      'STATE_CURSOR_CONFLICT',
      'STATE.md',
      'current_task and next_task cannot both be set'
    )
  }
  if (state.current_task) {
    const current = tasks.get(state.current_task)
    const status = current?.status
    if (current && current.phase !== Number(state.current_phase)) {
      error(
        errors,
        'STATE_TASK_PHASE_MISMATCH',
        'STATE.md',
        `${state.current_task} belongs to phase ${current.phase}`,
        state.current_task
      )
    }
    if (!['IN_PROGRESS', 'VERIFY', 'BLOCKED'].includes(status ?? '')) {
      error(
        errors,
        'STATE_CURRENT_STATUS_MISMATCH',
        'STATE.md',
        `current_task ${state.current_task} has master status ${status}`,
        state.current_task
      )
    }
    const table = stateTableValue(contents, 'Current task') ?? ''
    if (!table.includes(`\`${state.current_task}\``) || !table.includes(`\`${status}\``)) {
      error(
        errors,
        'STATE_CONTROL_TABLE_MISMATCH',
        'STATE.md',
        'Current task table does not match frontmatter/master status',
        state.current_task
      )
    }
  } else if (stateTableValue(contents, 'Current task') !== 'None') {
    error(
      errors,
      'STATE_CONTROL_TABLE_MISMATCH',
      'STATE.md',
      'Current task table must be None'
    )
  }
  if (state.next_task) {
    const next = tasks.get(state.next_task)
    const status = next?.status
    if (next && next.phase !== Number(state.current_phase)) {
      error(
        errors,
        'STATE_TASK_PHASE_MISMATCH',
        'STATE.md',
        `${state.next_task} belongs to phase ${next.phase}`,
        state.next_task
      )
    }
    if (status !== 'READY') {
      error(
        errors,
        'STATE_NEXT_STATUS_MISMATCH',
        'STATE.md',
        `next_task ${state.next_task} has master status ${status}`,
        state.next_task
      )
    }
    const table = stateTableValue(contents, 'Next task') ?? ''
    if (!table.includes(`\`${state.next_task}\``) || !table.includes('`READY`')) {
      error(
        errors,
        'STATE_CONTROL_TABLE_MISMATCH',
        'STATE.md',
        'Next task table does not match frontmatter/master status',
        state.next_task
      )
    }
  } else if (stateTableValue(contents, 'Next task') !== 'None') {
    error(
      errors,
      'STATE_CONTROL_TABLE_MISMATCH',
      'STATE.md',
      'Next task table must be None'
    )
  }

  const phaseTable = stateTableValue(contents, 'Current phase') ?? ''
  const expectedPhaseStatus = state.current_task
    ? tasks.get(state.current_task)?.status
    : state.next_task
      ? 'READY'
      : tasks.get(`GATE-${state.current_phase}`)?.status
  if (!phaseTable.includes(`Phase ${state.current_phase}: \`${expectedPhaseStatus}\``)) {
    error(
      errors,
      'STATE_PHASE_STATUS_MISMATCH',
      'STATE.md',
      `Current phase table must present ${expectedPhaseStatus}`
    )
  }
}

function validateExecutionRules(
  tasks: Map<string, Task>,
  parsedState: StateFrontmatter | undefined,
  master: string,
  state: string,
  blockers: string,
  runLog: string,
  errors: PlanCheckError[]
): void {
  const inProgress = [...tasks.values()].filter(
    ({ status }) => status === 'IN_PROGRESS'
  )
  if (inProgress.length > 1) {
    error(
      errors,
      'MULTIPLE_IN_PROGRESS',
      '00-MASTER-PLAN.md',
      `More than one task is IN_PROGRESS: ${inProgress.map(({ id }) => id).join(', ')}`
    )
  }

  const known = new Set(tasks.keys())
  for (const reference of master.match(taskReferencePattern) ?? []) {
    if (!known.has(reference)) {
      error(
        errors,
        'UNKNOWN_TASK_REFERENCE',
        '00-MASTER-PLAN.md',
        `Unknown task reference ${reference}`,
        reference
      )
    }
  }

  for (const task of tasks.values()) {
    if (task.phase === 0 || ['TODO', 'DEFERRED'].includes(task.status)) {
      continue
    }
    for (const entryGate of phaseEntryGates[task.phase] ?? []) {
      if (tasks.get(entryGate)?.status !== 'DONE') {
        error(
          errors,
          'PHASE_ENTRY_GATE_UNSATISFIED',
          '00-MASTER-PLAN.md',
          `${task.id} advanced before ${entryGate} is DONE`,
          task.id
        )
      }
    }
  }

  for (let phase = 0; phase <= 9; phase += 1) {
    const phaseStatus = state.match(
      new RegExp(
        '^\\| ' +
        String(phase).padStart(2, '0') +
        ' [^|]+ \\| `([^`]+)`',
        'm'
      )
    )?.[1]
    const gate = tasks.get(`GATE-${String(phase).padStart(2, '0')}`)
    if (phaseStatus === 'DONE' && gate?.status !== 'DONE') {
      error(
        errors,
        'PHASE_DONE_GATE_NOT_DONE',
        'STATE.md',
        `Phase ${phase} is DONE while its gate is ${gate?.status}`
      )
    }
  }

  const externalSection = master.match(
    /## Gate External Conditions([\s\S]*?)(?=^## Global Verification Matrix)/m
  )?.[1] ?? ''
  const externalRows = [...externalSection.matchAll(
    /^\| `(GATE-\d{2})` \| `([^`]+)` \| (.+?) \| [^|]+ \|$/gm
  )]
  for (const [, gateId, externalTask, allowedRaw] of externalRows) {
    const gateStatus = tasks.get(gateId!)?.status
    if (!gateStatus || gateStatus === 'TODO') {
      continue
    }
    const allowed: string[] = allowedRaw!.match(/[A-Z_]+/g) ?? []
    const externalStatus = tasks.get(externalTask!)?.status
    if (!externalStatus || !allowed.includes(externalStatus)) {
      error(
        errors,
        'GATE_EXTERNAL_CONDITION_UNSATISFIED',
        '00-MASTER-PLAN.md',
        `${gateId} advanced while ${externalTask} is ${externalStatus}`,
        gateId
      )
    }
  }

  const blockerSummary = blockers.match(/^> Current blockers: (.+)$/m)?.[1]?.trim()
  const activeBlockerTasks = new Set<string>()
  const activeBlockerRecords = new Map<string, number>()
  for (const record of blockers.matchAll(
    /^## `([^`]+)`[^\r\n]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/gm
  )) {
    if (record[2]?.includes('- Status: `ACTIVE`')) {
      const blockerId = record[1]!
      activeBlockerRecords.set(
        blockerId,
        (activeBlockerRecords.get(blockerId) ?? 0) + 1
      )
    }
  }
  for (const [blockerId, count] of activeBlockerRecords) {
    if (count > 1) {
      error(
        errors,
        'ACTIVE_BLOCKER_DUPLICATE',
        'BLOCKERS.md',
        `Active blocker ${blockerId} has ${count} records`,
        blockerId
      )
    }
  }
  if (blockerSummary && blockerSummary.toLowerCase() !== 'none') {
    for (const blockerId of blockerSummary.split(',').map((value) => value.trim())) {
      const escaped = blockerId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const record = blockers.match(
        new RegExp(
          `^## \\\`${escaped}\\\`[^\\n]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`,
          'm'
        )
      )?.[1]
      if (!record?.includes('- Status: `ACTIVE`')) {
        error(
          errors,
          'ACTIVE_BLOCKER_MISSING',
          'BLOCKERS.md',
          `Active blocker ${blockerId} lacks an ACTIVE record`,
          blockerId
        )
        continue
      }
      const taskId = record.match(/- Task claim blocked:[^\r\n]*\b([A-Z]+-\d{2,3})\b/)?.[1] ??
        blockerId.match(/^([A-Z]+-\d{2,3})-/)?.[1]
      if (!taskId || !canonicalTaskPhases.has(taskId)) {
        error(
          errors,
          'BLOCKER_TASK_UNKNOWN',
          'BLOCKERS.md',
          `Active blocker ${blockerId} has no known task owner`,
          blockerId
        )
      } else {
        activeBlockerTasks.add(taskId)
      }
    }
  }
  for (const task of tasks.values()) {
    if (task.status === 'BLOCKED' && !activeBlockerTasks.has(task.id)) {
      error(
        errors,
        'BLOCKED_TASK_WITHOUT_ACTIVE_BLOCKER',
        'BLOCKERS.md',
        `${task.id} is BLOCKED without an active blocker record`,
        task.id
      )
    }
  }

  const lastRunBlock = parsedState
    ? runLog.match(
      new RegExp(
        `^## \\\`${parsedState.last_run_id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\\`[^\\n]*\\n` +
        '([\\s\\S]*?)(?=^## |(?![\\s\\S]))',
        'm'
      )
    )?.[1]
    : undefined
  if (parsedState && !lastRunBlock) {
    error(
      errors,
      'RUN_LOG_ENTRY_MISSING',
      'RUN-LOG.md',
      `last_run_id ${parsedState.last_run_id} has no run-log entry`,
      parsedState.last_run_id
    )
  }
  const statusPattern =
    'TODO|READY|IN_PROGRESS|VERIFY|DONE|BLOCKED|DEFERRED|ACCEPTED_LIMITATION|SUPERSEDED'
  const transitionChains = [...(lastRunBlock ?? '').matchAll(
    new RegExp(
      `\`([A-Z]+-\\d{2,3})\`\\s+((?:\`?(?:${statusPattern})\`?\\s*->\\s*)+\`?(?:${statusPattern})\`?)`,
      'g'
    )
  )]
  const allowedTransitions: Record<string, string[]> = {
    TODO: ['READY', 'DEFERRED'],
    READY: ['IN_PROGRESS'],
    IN_PROGRESS: ['VERIFY', 'BLOCKED'],
    VERIFY: ['DONE', 'BLOCKED'],
    BLOCKED: ['READY', 'DEFERRED', 'ACCEPTED_LIMITATION'],
    DEFERRED: ['READY'],
    DONE: [],
    ACCEPTED_LIMITATION: [],
    SUPERSEDED: []
  }
  const finalTransitionStatus = new Map<string, string>()
  for (const [, taskId, chain] of transitionChains) {
    const statuses = [...chain!.matchAll(new RegExp(statusPattern, 'g'))].map(
      match => match[0]
    )
    for (let index = 0; index < statuses.length - 1; index += 1) {
      const from = statuses[index]!
      const to = statuses[index + 1]!
      if (!(allowedTransitions[from]?.includes(to))) {
        error(
          errors,
          'INVALID_TRANSITION_CHAIN',
          'RUN-LOG.md',
          `Invalid transition ${taskId}: ${from} -> ${to}`,
          taskId
        )
      }
    }
    finalTransitionStatus.set(taskId!, statuses.at(-1)!)
  }
  for (const [taskId, finalStatus] of finalTransitionStatus) {
    const masterStatus = tasks.get(taskId)?.status
    if (masterStatus && masterStatus !== finalStatus) {
      error(
        errors,
        'TRANSITION_FINAL_STATUS_MISMATCH',
        'RUN-LOG.md',
        `${taskId} latest transition ends at ${finalStatus}, master is ${masterStatus}`,
        taskId
      )
    }
  }
}

function slugifyHeading(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[`_*[\]()]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

async function validateLinks(
  root: string,
  files: Map<string, string>,
  errors: PlanCheckError[]
): Promise<number> {
  let count = 0
  for (const [file, contents] of files) {
    for (const match of contents.matchAll(/\[[^\]]*]\(([^)]+)\)/g)) {
      const target = match[1]!
      if (/^(?:https?:|mailto:)/.test(target)) {
        continue
      }
      count += 1
      const [relativePath, fragment] = target.split('#', 2)
      const targetPath = relativePath
        ? resolve(root, dirname(file), decodeURIComponent(relativePath))
        : resolve(root, file)
      let targetStat
      try {
        targetStat = await stat(targetPath)
      } catch {
        error(
          errors,
          'BROKEN_RELATIVE_LINK',
          file,
          `Missing link target ${target}`,
          target
        )
        continue
      }
      if (targetStat.isDirectory() || !fragment) {
        continue
      }
      const targetContents = await readFile(targetPath, 'utf8')
      const fragments = new Set(
        [...targetContents.matchAll(/^#{1,6}\s+(.+)$/gm)]
          .map((heading) => slugifyHeading(heading[1]!))
      )
      if (!fragments.has(decodeURIComponent(fragment).toLowerCase())) {
        error(
          errors,
          'BROKEN_LINK_FRAGMENT',
          file,
          `Missing fragment #${fragment} in ${relativePath || basename(file)}`,
          target
        )
      }
    }
  }
  return count
}

async function readControlFiles(root: string): Promise<Map<string, string>> {
  const names = (await readdir(root))
    .filter((name) => name.endsWith('.md'))
    .sort()
  return new Map(
    await Promise.all(
      names.map(async (name) => [name, await readFile(join(root, name), 'utf8')] as const)
    )
  )
}

export async function checkMigrationPlan(root: string): Promise<PlanCheckReport> {
  const resolvedRoot = resolve(root)
  const files = await readControlFiles(resolvedRoot)
  const required = [
    '00-MASTER-PLAN.md',
    'STATE.md',
    'EVIDENCE.md',
    'BLOCKERS.md',
    'RUN-LOG.md'
  ]
  const errors: PlanCheckError[] = []
  for (const file of required) {
    if (!files.has(file)) {
      error(errors, 'CONTROL_FILE_MISSING', file, `Required control file ${file} is missing`)
    }
  }
  if (errors.length > 0) {
    return {
      schemaVersion: 1,
      status: 'failed',
      root: resolvedRoot,
      checkedFiles: [...files.keys()],
      inputHashes: Object.fromEntries(
        [...files].map(([file, contents]) => [file, hash(contents)])
      ),
      documentsUnchanged: true,
      summary: {
        taskCount: 0,
        linkCount: 0,
        acceptedEvidenceCount: 0,
        errorCount: errors.length
      },
      errors
    }
  }

  const beforeHashes = Object.fromEntries(
    [...files].map(([file, contents]) => [file, hash(contents)])
  )
  const master = files.get('00-MASTER-PLAN.md')!
  const stateContents = files.get('STATE.md')!
  const evidence = files.get('EVIDENCE.md')!
  const blockers = files.get('BLOCKERS.md')!
  const runLog = files.get('RUN-LOG.md')!
  const state = parseFrontmatter(stateContents, errors)
  const tasks = parseMaster(master, errors)
  validateCanonicalTaskInventory(master, tasks, files, errors)
  validateDependencies(tasks, master, errors)
  validateState(state, stateContents, tasks, errors)
  const acceptedEvidenceCount = validateEvidence(
    tasks,
    evidence,
    stateContents,
    errors
  )
  validateExecutionRules(
    tasks,
    state,
    master,
    stateContents,
    blockers,
    runLog,
    errors
  )
  const linkCount = await validateLinks(resolvedRoot, files, errors)
  const after = await readControlFiles(resolvedRoot)
  const afterHashes = Object.fromEntries(
    [...after].map(([file, contents]) => [file, hash(contents)])
  )
  const documentsUnchanged =
    JSON.stringify(beforeHashes) === JSON.stringify(afterHashes)
  if (!documentsUnchanged) {
    error(
      errors,
      'CONTROL_DOCUMENT_REWRITTEN',
      resolvedRoot,
      'Checker modified a control document'
    )
  }
  errors.sort((left, right) =>
    left.code.localeCompare(right.code) ||
    left.file.localeCompare(right.file) ||
    (left.subject ?? '').localeCompare(right.subject ?? '')
  )
  return {
    schemaVersion: 1,
    status: errors.length === 0 ? 'passed' : 'failed',
    root: resolvedRoot,
    checkedFiles: [...files.keys()],
    inputHashes: beforeHashes,
    documentsUnchanged,
    summary: {
      taskCount: tasks.size,
      linkCount,
      acceptedEvidenceCount,
      errorCount: errors.length
    },
    errors
  }
}

function argument(name: string): string | undefined {
  const index = Bun.argv.indexOf(name)
  return index >= 0 ? Bun.argv[index + 1] : undefined
}

if (import.meta.main) {
  const root = argument('--root') ??
    join(process.cwd(), 'docs', 'migrations', 'typescript-bun')
  const reportPath = argument('--report')
  try {
    const report = await checkMigrationPlan(root)
    const output = `${JSON.stringify(report, null, 2)}\n`
    if (reportPath) {
      await writeFile(resolve(reportPath), output)
    }
    process.stdout.write(output)
    process.exitCode = report.status === 'passed' ? 0 : 1
  } catch (cause) {
    console.error(cause instanceof Error ? cause.stack : String(cause))
    process.exitCode = 2
  }
}
