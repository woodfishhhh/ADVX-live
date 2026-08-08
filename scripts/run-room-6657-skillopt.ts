import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { atomicWriteBytes, atomicWriteJson } from './sb6657-corpus-common.ts'
import { compileSkill, DEFAULT_INPUT, DEFAULT_OUTPUT, MODE_ID, PERSONA_IDS } from './sync-room-6657-skill.ts'

const repoRoot = resolve(import.meta.dir, '..')
const lockPath = resolve(repoRoot, 'resources', 'skillopt', 'skillopt.lock.json')
const tasksPath = resolve(repoRoot, 'tests', 'fixtures', 'room-6657', 'skillopt-reviewed-tasks.json')
const stagingRoot = resolve(repoRoot, '.skillopt-sleep', 'staging')
const mutationLock = resolve(repoRoot, '.advx-data', 'locks', 'room-6657-skillopt.lock')
const expectedHeadings = ['Runtime Directives', 'Persona Lenses', 'Output Contract', 'Safety Boundary', 'Optimization Contract'] as const
const learnedHeading = 'Learned preferences & procedures'
const safetyAnchors = ['current scene', 'never reproduce source-corpus wording', 'aggregate style evidence', 'verbatim retrieval', 'unsupported factual accusations'] as const
const preferences = 'Treat these as hard constraints: preserve every existing second-level heading and all 14 Persona identifiers; make at most two bounded edits; never add examples, source-corpus phrases, or stored response candidates; never modify memory, AGENTS.md, corpus data, generated runtime JSON, or production configuration; improve only scene relevance, persona separation, brevity, originality, and safety.'

export class SkillOptError extends Error {}
type JsonObject = Record<string, any>

async function scan(pattern: string, cwd: string): Promise<string[]> {
  const entries: string[] = []
  for await (const entry of new Bun.Glob(pattern).scan({ cwd })) entries.push(entry)
  return entries
}

async function readJson(path: string): Promise<JsonObject> {
  try {
    const value = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('root must be an object')
    return value as JsonObject
  } catch (error) {
    throw new SkillOptError(`cannot read JSON ${path}: ${String(error)}`)
  }
}

async function sha256(path: string): Promise<string> {
  return createHash('sha256').update(await readFile(path)).digest('hex')
}

async function runCommand(command: string[], cwd: string, env?: Record<string, string>): Promise<{ code: number; stdout: string; stderr: string }> {
  const processHandle = Bun.spawn({ cmd: command, cwd, env, stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, code] = await Promise.all([new Response(processHandle.stdout).text(), new Response(processHandle.stderr).text(), processHandle.exited])
  return { code, stdout, stderr }
}

async function lock(): Promise<JsonObject> {
  const value = await readJson(lockPath)
  for (const field of ['repository', 'commit', 'local_path', 'license']) if (typeof value[field] !== 'string' || !value[field]) throw new SkillOptError(`lock field ${field} must be a non-empty string`)
  if (!/^[0-9a-f]{40}$/u.test(value.commit)) throw new SkillOptError('lock commit must be a full lowercase Git SHA')
  if (value.license !== 'MIT') throw new SkillOptError('unexpected SkillOpt license in lock file')
  return value
}

async function toolDirectory(value: JsonObject): Promise<string> {
  const tool = resolve(repoRoot, value.local_path)
  const privateRoot = resolve(repoRoot, '.advx-data', 'tools')
  if (!tool.startsWith(`${privateRoot}${process.platform === 'win32' ? '\\' : '/'}`)) throw new SkillOptError('locked tool path must stay under .advx-data/tools')
  return tool
}

async function git(tool: string, args: string[]): Promise<string> {
  const result = await runCommand(['git', ...args], tool)
  if (result.code !== 0) throw new SkillOptError(`git ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`)
  return result.stdout.trim()
}

async function verifyTool(tool: string, pinned: JsonObject): Promise<void> {
  if (await git(tool, ['rev-parse', 'HEAD']) !== pinned.commit) throw new SkillOptError('SkillOpt checkout does not match the locked commit')
  if (await git(tool, ['status', '--porcelain'])) throw new SkillOptError('SkillOpt checkout has local modifications')
  const remote = (await git(tool, ['remote', 'get-url', 'origin'])).replace(/\.git$/u, '').toLowerCase()
  if (remote !== String(pinned.repository).replace(/\.git$/u, '').toLowerCase()) throw new SkillOptError(`unexpected SkillOpt origin: ${remote}`)
  if (!await Bun.file(join(tool, 'LICENSE')).exists() || !await Bun.file(join(tool, 'skillopt_sleep', '__main__.py')).exists()) throw new SkillOptError('SkillOpt checkout is missing its MIT license or entrypoint')
}

async function bootstrap(): Promise<void> {
  const pinned = await lock()
  const tool = await toolDirectory(pinned)
  if (!await Bun.file(join(tool, '.git', 'HEAD')).exists()) {
    await mkdir(dirname(tool), { recursive: true })
    const clone = await runCommand(['git', 'clone', pinned.repository, tool], repoRoot)
    if (clone.code !== 0) throw new SkillOptError(`failed to clone Microsoft SkillOpt: ${clone.stderr}`)
  }
  await verifyTool(tool, pinned)
  console.log(`SkillOpt ready: ${tool} @ ${pinned.commit}`)
}

async function validateTasks(): Promise<void> {
  const payload = await readJson(tasksPath)
  if (payload.format !== 'skillopt_sleep.tasks.v1' || payload.reviewed !== true || payload.target_skill_path !== '.codex/skills/room-6657-style/SKILL.md') throw new SkillOptError('reviewed tasks metadata is invalid')
  if (!Array.isArray(payload.tasks) || payload.tasks.length !== 12) throw new SkillOptError('reviewed tasks must contain exactly twelve bounded cases')
  const seen = new Set<string>(); const splits = { train: 0, val: 0, test: 0 }
  for (const task of payload.tasks as JsonObject[]) {
    if (!task || typeof task.id !== 'string' || seen.has(task.id)) throw new SkillOptError('reviewed task IDs must be unique non-empty strings')
    seen.add(task.id)
    if (!(task.split in splits)) throw new SkillOptError(`task ${task.id} has an unsupported split`)
    splits[task.split as keyof typeof splits] += 1
    if (task.origin !== 'real' || task.reference_kind !== 'rubric' || JSON.stringify(task.source_sessions) !== '[]') throw new SkillOptError(`task ${task.id} violates review provenance`)
    for (const field of ['intent', 'context_excerpt', 'reference']) if (typeof task[field] !== 'string' || !task[field].trim()) throw new SkillOptError(`task ${task.id} field ${field} must be non-empty`)
  }
  if (splits.train !== 5 || splits.val !== 4 || splits.test !== 3) throw new SkillOptError(`unexpected reviewed task split: ${JSON.stringify(splits)}`)
}

function headingNames(text: string): string[] {
  return [...text.matchAll(/^## (.+?)\s*$/gmu)].map((match) => match[1]!)
}

async function validateCandidate(path: string, reference = DEFAULT_INPUT): Promise<void> {
  if (!await Bun.file(path).exists()) throw new SkillOptError(`candidate skill does not exist: ${path}`)
  const text = await readFile(path, 'utf8')
  const headings = headingNames(text)
  if (JSON.stringify(headings) !== JSON.stringify(expectedHeadings) && JSON.stringify(headings) !== JSON.stringify([...expectedHeadings, learnedHeading])) throw new SkillOptError('candidate must preserve the second-level heading sequence')
  for (const anchor of safetyAnchors) if (!text.includes(anchor)) throw new SkillOptError(`candidate removed required safety anchor: ${anchor}`)
  const referenceBytes = (await stat(reference)).size
  if ((await stat(path)).size > referenceBytes * 1.35) throw new SkillOptError('candidate exceeds the 35% bounded-growth limit')
  const generated = await compileSkill(path)
  const parsed = JSON.parse(new TextDecoder().decode(generated)) as JsonObject
  const learned = parsed.learned_directives
  if (!Array.isArray(learned) || learned.length > 6 || learned.some((item) => typeof item !== 'string' || item.length > 500) || learned.reduce((sum, item) => sum + item.length, 0) > 1200) throw new SkillOptError('candidate learned directives exceed the retained-learning budget')
}

async function validateProject(): Promise<{ pinned: JsonObject; tool: string }> {
  const pinned = await lock(); const tool = await toolDirectory(pinned)
  if (!await Bun.file(join(tool, '.git', 'HEAD')).exists()) throw new SkillOptError('SkillOpt is not downloaded; run bootstrap first')
  await verifyTool(tool, pinned)
  await validateTasks(); await validateCandidate(DEFAULT_INPUT)
  const current = await compileSkill(DEFAULT_INPUT)
  if (!await Bun.file(DEFAULT_OUTPUT).exists() || !Buffer.from(await Bun.file(DEFAULT_OUTPUT).bytes()).equals(Buffer.from(current))) throw new SkillOptError('generated runtime skill is stale')
  return { pinned, tool }
}

async function withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  await mkdir(dirname(mutationLock), { recursive: true })
  let acquired = false
  try {
    const fileHandle = await open(mutationLock, 'wx')
    await fileHandle.writeFile(JSON.stringify({ pid: process.pid, created_at_utc: new Date().toISOString() }))
    await fileHandle.close()
    acquired = true
    return await operation()
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST') throw new SkillOptError(`another room-6657 mutation is active or left a stale lock: ${mutationLock}`)
    throw error
  } finally {
    if (acquired) await rm(mutationLock, { force: true })
  }
}

async function runCycle(action: 'dry-run' | 'run', backend: string, model: string, maxTasks: number, editBudget: number): Promise<void> {
  const { pinned, tool } = await validateProject()
  const root = await mkdtemp(join(tmpdir(), 'advx-room-6657-skillopt-'))
  const project = join(root, 'project'); const home = join(root, 'home'); const codexHome = join(root, 'codex-home')
  await mkdir(project, { recursive: true }); await mkdir(home, { recursive: true }); await mkdir(codexHome, { recursive: true })
  await writeFile(join(project, 'AGENTS.md'), '# Isolated Skill Evaluation Workspace\n', 'utf8')
  const env: Record<string, string> = { ...process.env as Record<string, string>, HOME: home, USERPROFILE: home, CODEX_HOME: codexHome, SKILLOPT_SLEEP_WORKERS: '2', PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
  const command = ['uv', 'run', '--project', tool, 'python', '-m', 'skillopt_sleep', action, '--project', project, '--claude-home', join(home, '.claude'), '--codex-home', join(home, '.codex-transcripts'), '--target-skill-path', DEFAULT_INPUT, '--json', '--backend', backend, '--tasks-file', tasksPath, '--edit-budget', String(editBudget), '--max-tasks', String(maxTasks), '--preferences', preferences, '--progress']
  if (model) command.push('--model', model)
  const result = await runCommand(command, tool, env)
  try {
    process.stdout.write(result.stdout)
    process.stderr.write(result.stderr)
    if (result.code !== 0 || action === 'dry-run') {
      if (result.code !== 0) throw new SkillOptError(`SkillOpt ${action} failed with exit ${result.code}`)
      return
    }
    const sourceRoot = join(project, '.skillopt-sleep', 'staging')
    let candidates: string[] = []
    try { if ((await stat(sourceRoot)).isDirectory()) candidates = (await scan('*/manifest.json', sourceRoot)).map((entry) => join(sourceRoot, entry.replace(/[/\\]manifest\.json$/u, ''))) } catch { candidates = [] }
    if (candidates.length !== 1) throw new SkillOptError(`expected exactly one isolated staging directory, found ${candidates.length}`)
    await mkdir(stagingRoot, { recursive: true })
    const name = (await stat(candidates[0]!)).isDirectory() ? candidates[0]!.split(/[\\/]/u).pop()! : 'candidate'
    let destination = join(stagingRoot, name); let index = 2
    while (await Bun.file(destination).exists()) destination = join(stagingRoot, `${name}-${index++}`)
    await rename(candidates[0]!, destination)
    const provenance = { schema_version: 1, baseline_skill_sha256: await sha256(DEFAULT_INPUT), candidate_skill_sha256: await sha256(join(destination, 'proposed_SKILL.md')), report_sha256: await sha256(join(destination, 'report.json')), manifest_sha256: await sha256(join(destination, 'manifest.json')), reviewed_tasks_sha256: await sha256(tasksPath), upstream_commit: pinned.commit, sealed_at_utc: new Date().toISOString() }
    await atomicWriteJson(join(destination, 'provenance.json'), provenance)
    console.log(JSON.stringify({ staging: destination, candidate_sha256: provenance.candidate_skill_sha256, provenance: join(destination, 'provenance.json') }, null, 2))
  } finally { await rm(root, { recursive: true, force: true }) }
}

async function evaluate(backend: string, model: string, skillArgument: string): Promise<void> {
  const { tool } = await validateProject()
  const root = await mkdtemp(join(tmpdir(), 'advx-room-6657-evaluate-'))
  const project = join(root, 'project'); const home = join(root, 'home')
  await mkdir(project, { recursive: true }); await mkdir(home, { recursive: true })
  const skill = skillArgument ? resolve(repoRoot, skillArgument) : DEFAULT_INPUT
  await validateCandidate(skill)
  const evaluator = join(root, 'evaluate.py')
  await writeFile(evaluator, `import json, sys\nfrom skillopt_sleep.backend import build_backend\nfrom skillopt_sleep.replay import replay_batch\nfrom skillopt_sleep.types import TaskRecord\nbackend_name, model, skill_path, tasks_path, project = sys.argv[1:]\npayload = json.loads(open(tasks_path, encoding='utf-8').read())\nitems = [item for item in payload['tasks'] if item.get('split') == 'test']\nbackend = build_backend(backend=backend_name, model=model, preferences='', project_dir=project)\npairs = replay_batch(backend, [TaskRecord.from_dict(item) for item in items], open(skill_path, encoding='utf-8').read(), '')\nresults = [{'task_id': result.id, 'hard': result.hard, 'soft': result.soft, 'response': result.response, 'passed': result.hard >= 1.0 and result.soft >= 0.8} for _, result in pairs]\nprint(json.dumps({'backend': backend_name, 'model': model, 'skill': skill_path, 'passed': all(item['passed'] for item in results), 'results': results, 'qualifying_evidence_written': False}, ensure_ascii=False))\n`, 'utf8')
  try {
    const env: Record<string, string> = { ...process.env as Record<string, string>, HOME: home, USERPROFILE: home, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' }
    const result = await runCommand(['uv', 'run', '--project', tool, 'python', evaluator, backend, model, skill, tasksPath, project], tool, env)
    process.stdout.write(result.stdout); process.stderr.write(result.stderr)
    if (result.code !== 0) throw new SkillOptError(`SkillOpt evaluation failed with exit ${result.code}`)
    const parsed = JSON.parse(result.stdout.trim().split(/\r?\n/u).at(-1) ?? '{}') as JsonObject
    if (parsed.passed !== true) throw new SkillOptError('SkillOpt final evaluation did not pass')
  } finally { await rm(root, { recursive: true, force: true }) }
}

async function stagingPath(raw: string): Promise<string> {
  const path = resolve(repoRoot, raw); const root = resolve(stagingRoot)
  if (path === root || !path.startsWith(`${root}${process.platform === 'win32' ? '\\' : '/'}`)) throw new SkillOptError('staging path must stay under .skillopt-sleep/staging')
  return path
}

async function status(): Promise<void> {
  await validateProject()
  const entries = await scan('*/manifest.json', stagingRoot).catch(() => [] as string[])
  const latest = entries.length ? join(stagingRoot, entries.sort().at(-1)!.replace(/[/\\]manifest\.json$/u, '')) : null
  const output: JsonObject = { upstream_commit: (await lock()).commit, live_skill_sha256: await sha256(DEFAULT_INPUT), latest_staging: latest }
  if (latest) output.latest = { candidate: await Bun.file(join(latest, 'proposed_SKILL.md')).exists(), provenance: await Bun.file(join(latest, 'provenance.json')).exists(), evaluation: await Bun.file(join(latest, 'evaluation.json')).exists(), review: await Bun.file(join(latest, 'review.json')).exists() ? (await readJson(join(latest, 'review.json'))).status : null, adopted: await Bun.file(join(latest, 'adoption.json')).exists(), rolled_back: await Bun.file(join(latest, 'rollback.json')).exists() }
  console.log(JSON.stringify(output, null, 2))
}

async function validateStaging(path: string, requireBaseline: boolean): Promise<JsonObject> {
  const provenance = await readJson(join(path, 'provenance.json')); const pinned = await lock()
  for (const [field, expected] of Object.entries({ report_sha256: await sha256(join(path, 'report.json')), manifest_sha256: await sha256(join(path, 'manifest.json')), reviewed_tasks_sha256: await sha256(tasksPath), upstream_commit: pinned.commit })) if (provenance[field] !== expected) throw new SkillOptError(`staging provenance mismatch: ${field}`)
  if (await sha256(join(path, 'proposed_SKILL.md')) !== provenance.candidate_skill_sha256) throw new SkillOptError('staged candidate bytes do not match provenance')
  if (requireBaseline && await sha256(DEFAULT_INPUT) !== provenance.baseline_skill_sha256) throw new SkillOptError('live skill no longer matches staged baseline')
  const manifest = await readJson(join(path, 'manifest.json')); const report = await readJson(join(path, 'report.json'))
  if (manifest.accepted !== true || report.accepted !== true || manifest.has_skill !== true || manifest.has_memory !== false) throw new SkillOptError('proposal is not accepted by the held-out gate')
  await validateCandidate(join(path, 'proposed_SKILL.md'))
  return provenance
}

async function review(action: 'approve' | 'reject', pathRaw: string, reason: string): Promise<void> {
  await withMutationLock(async () => {
    await validateProject(); if (!reason.trim()) throw new SkillOptError('review reason must not be empty')
    const path = await stagingPath(pathRaw); const provenance = await validateStaging(path, action === 'approve')
    if (action === 'approve') {
      const evaluation = await readJson(join(path, 'evaluation.json'))
      if (evaluation.passed !== true || evaluation.backend !== 'codex') throw new SkillOptError('final evaluation is not adoptable')
    }
    await atomicWriteJson(join(path, 'review.json'), { schema_version: 1, status: action === 'approve' ? 'approved' : 'rejected', candidate_skill_sha256: provenance.candidate_skill_sha256, provenance_sha256: await sha256(join(path, 'provenance.json')), ...(action === 'approve' ? { evaluation_sha256: await sha256(join(path, 'evaluation.json')) } : {}), reviewed_at_utc: new Date().toISOString(), reason: reason.trim() })
  })
}

async function adopt(pathRaw: string): Promise<void> {
  await withMutationLock(async () => {
    await validateProject(); const path = await stagingPath(pathRaw); const provenance = await validateStaging(path, true); const reviewRecord = await readJson(join(path, 'review.json'))
    if (reviewRecord.status !== 'approved' || !await Bun.file(join(path, 'evaluation.json')).exists()) throw new SkillOptError('proposal has not passed final evaluation and approval')
    const backup = join(path, 'backup', 'SKILL.md'); if (await Bun.file(backup).exists()) throw new SkillOptError('staging already contains a backup')
    await mkdir(dirname(backup), { recursive: true }); await cp(DEFAULT_INPUT, backup); await cp(join(path, 'proposed_SKILL.md'), DEFAULT_INPUT)
    try { await atomicWriteBytes(DEFAULT_OUTPUT, await compileSkill(DEFAULT_INPUT)); await validateProject() } catch (error) { await cp(backup, DEFAULT_INPUT); throw error }
    await atomicWriteJson(join(path, 'adoption.json'), { schema_version: 1, candidate_skill_sha256: provenance.candidate_skill_sha256, baseline_skill_sha256: provenance.baseline_skill_sha256, generated_runtime_sha256: await sha256(DEFAULT_OUTPUT), provenance_sha256: await sha256(join(path, 'provenance.json')), evaluation_sha256: await sha256(join(path, 'evaluation.json')), review_sha256: await sha256(join(path, 'review.json')), adopted_at_utc: new Date().toISOString(), review_reason: reviewRecord.reason })
  })
}

async function rollback(pathRaw: string): Promise<void> {
  await withMutationLock(async () => {
    const path = await stagingPath(pathRaw); const provenance = await validateStaging(path, false); const adoption = await readJson(join(path, 'adoption.json')); const backup = join(path, 'backup', 'SKILL.md')
    if (await sha256(DEFAULT_INPUT) !== adoption.candidate_skill_sha256 || await sha256(DEFAULT_OUTPUT) !== adoption.generated_runtime_sha256 || await sha256(backup) !== adoption.baseline_skill_sha256 || provenance.candidate_skill_sha256 !== adoption.candidate_skill_sha256) throw new SkillOptError('rollback compare-and-swap check failed')
    await cp(backup, DEFAULT_INPUT); await atomicWriteBytes(DEFAULT_OUTPUT, await compileSkill(DEFAULT_INPUT)); await atomicWriteJson(join(path, 'rollback.json'), { schema_version: 1, from_candidate_sha256: adoption.candidate_skill_sha256, to_baseline_sha256: adoption.baseline_skill_sha256, adoption_sha256: await sha256(join(path, 'adoption.json')), rolled_back_at_utc: new Date().toISOString() })
  })
}

async function selfTest(): Promise<void> {
  await validateTasks(); const compiled = await compileSkill(DEFAULT_INPUT); const payload = JSON.parse(new TextDecoder().decode(compiled)) as JsonObject
  if (payload.mode_id !== MODE_ID || payload.persona_lenses && Object.keys(payload.persona_lenses).length !== PERSONA_IDS.length) throw new SkillOptError('SkillOpt wrapper self-test failed')
}

if (import.meta.main) {
  try {
    const argv = Bun.argv.slice(2); const action = argv[0]
    if (action === 'self-test') { await selfTest(); console.log('run-room-6657-skillopt self-test: OK') }
    else if (action === 'bootstrap') await bootstrap()
    else if (action === 'validate') { await validateProject(); console.log('room-6657 SkillOpt validation passed') }
    else if (action === 'status') await status()
    else if (action === 'evaluate') await evaluate(argv.includes('--backend') ? argv[argv.indexOf('--backend') + 1]! : 'codex', argv.includes('--model') ? argv[argv.indexOf('--model') + 1]! : '', argv.includes('--skill') ? argv[argv.indexOf('--skill') + 1]! : '')
    else if (action === 'dry-run' || action === 'run') await runCycle(action, argv.includes('--backend') ? argv[argv.indexOf('--backend') + 1]! : action === 'dry-run' ? 'mock' : 'codex', argv.includes('--model') ? argv[argv.indexOf('--model') + 1]! : '', Number(argv.includes('--max-tasks') ? argv[argv.indexOf('--max-tasks') + 1] : 12), Number(argv.includes('--edit-budget') ? argv[argv.indexOf('--edit-budget') + 1] : 2))
    else if (action === 'approve' || action === 'reject') await review(action, argv[argv.indexOf('--staging') + 1]!, argv[argv.indexOf('--reason') + 1]!)
    else if (action === 'adopt') await adopt(argv[argv.indexOf('--staging') + 1]!)
    else if (action === 'rollback') await rollback(argv[argv.indexOf('--staging') + 1]!)
    else throw new SkillOptError('usage: bun scripts/run-room-6657-skillopt.ts <bootstrap|validate|status|dry-run|run|approve|reject|adopt|rollback|self-test>')
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
