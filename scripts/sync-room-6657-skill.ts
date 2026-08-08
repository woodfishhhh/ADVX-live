import { createHash } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import { atomicWriteBytes } from './sb6657-corpus-common.ts'

export const MODE_ID = 'room-6657'
export const PERSONA_IDS = ['reaction_qmark', 'hardmouth_antifan', 'instigator', 'fun_seeker', 'meme_archivist', 'abstract_radio', 'parrot_unit', 'jinx_machine', 'grudge_keeper', 'cheat_suspector', 'praise_then_bite', 'clip_alarm', 'room_historian', 'longtime_fan'] as const
const repoRoot = resolve(import.meta.dir, '..')
export const DEFAULT_INPUT = resolve(repoRoot, '.codex', 'skills', 'room-6657-style', 'SKILL.md')
export const DEFAULT_OUTPUT = resolve(repoRoot, 'resources', 'audience-presets', 'room-6657', 'room_6657_generation_skill.json')
const learnedStart = '<!-- SKILLOPT-SLEEP:LEARNED START -->'
const learnedEnd = '<!-- SKILLOPT-SLEEP:LEARNED END -->'
const learnedHeading = '## Learned preferences & procedures'

export class SkillSyncError extends Error {}

function secondLevelHeading(line: string): string | undefined {
  const match = /^## (.+?)\s*$/u.exec(line)
  return match?.[1]
}

export async function compileSkill(path: string): Promise<Uint8Array> {
  let raw: Uint8Array
  try {
    raw = await Bun.file(path).bytes()
  } catch (error) {
    throw new SkillSyncError(`${path} cannot be read: ${String(error)}`)
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(raw)
  validateNoExamplesOrPlaceholders(text)
  const sections = secondLevelSections(text)
  const payload = {
    schema_version: 1,
    mode_id: MODE_ID,
    source_skill_sha256: createHash('sha256').update(raw).digest('hex'),
    directives: parseDirectives(sections),
    learned_directives: parseLearnedDirectives(text),
    persona_lenses: parsePersonaLenses(sections)
  }
  return Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function validateNoExamplesOrPlaceholders(text: string): void {
  if (/\b(?:TODO|TBD|FIXME)\b/iu.test(text)) throw new SkillSyncError('skill contains TODO, TBD, or FIXME')
  if (text.includes('```') || text.includes('~~~')) throw new SkillSyncError('skill must not contain fenced examples')
  for (const line of text.split(/\r?\n/u)) {
    const stripped = line.trim()
    if (stripped.startsWith('>')) throw new SkillSyncError('skill must not contain quoted barrage examples')
    const heading = secondLevelHeading(stripped)
    if (heading && /\b(?:examples?|samples?)\b|示例|样例/iu.test(heading)) throw new SkillSyncError('skill must not contain an examples section')
  }
}

function secondLevelSections(text: string): Map<string, string[]> {
  const sections = new Map<string, string[]>()
  let current: string | undefined
  for (const line of text.split(/\r?\n/u)) {
    const heading = secondLevelHeading(line)
    if (heading) {
      if (sections.has(heading)) throw new SkillSyncError(`duplicate second-level heading: ${heading}`)
      current = heading
      sections.set(heading, [])
    } else if (current) sections.get(current)!.push(line)
  }
  for (const required of ['Runtime Directives', 'Persona Lenses']) if (!sections.has(required)) throw new SkillSyncError(`missing required heading: ## ${required}`)
  return sections
}

function parseDirectives(sections: Map<string, string[]>): string[] {
  const directives: string[] = []
  for (const line of sections.get('Runtime Directives')!) {
    if (!line.trim()) continue
    const match = /^- (.+?)\s*$/u.exec(line)
    if (!match) throw new SkillSyncError('Runtime Directives may contain only non-empty bullet items')
    directives.push(match[1]!)
  }
  if (!directives.length) throw new SkillSyncError('Runtime Directives must contain at least one item')
  if (new Set(directives).size !== directives.length) throw new SkillSyncError('Runtime Directives contains duplicate items')
  return directives
}

function parsePersonaLenses(sections: Map<string, string[]>): Record<string, string> {
  const lenses = new Map<string, string[]>()
  let current: string | undefined
  for (const line of sections.get('Persona Lenses')!) {
    const heading = /^### ([a-z0-9_]+)\s*$/u.exec(line)
    if (heading) {
      current = heading[1]
      if (lenses.has(current)) throw new SkillSyncError(`duplicate Persona lens: ${current}`)
      lenses.set(current, [])
      continue
    }
    if (!line.trim()) continue
    if (!current) throw new SkillSyncError('Persona Lenses must begin with a Persona heading')
    if (line.startsWith('#') || line.trimStart().startsWith('- ')) throw new SkillSyncError(`Persona lens ${current} must be prose, not nested Markdown`)
    lenses.get(current)!.push(line.trim())
  }
  const actual = new Set(lenses.keys())
  const expected = new Set<string>(PERSONA_IDS)
  const missing = PERSONA_IDS.filter((id) => !actual.has(id))
  const extra = [...actual].filter((id) => !expected.has(id))
  if (missing.length || extra.length) throw new SkillSyncError(`Persona set mismatch; missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`)
  return Object.fromEntries(PERSONA_IDS.map((id) => {
    const value = lenses.get(id)!.join(' ')
    if (!value) throw new SkillSyncError(`Persona lens ${id} must not be empty`)
    return [id, value]
  }))
}

function parseLearnedDirectives(text: string): string[] {
  const starts = text.split(learnedStart).length - 1
  const ends = text.split(learnedEnd).length - 1
  if (!starts && !ends) return []
  if (starts !== 1 || ends !== 1) throw new SkillSyncError('skill must contain one complete SkillOpt learned block')
  const start = text.indexOf(learnedStart)
  const end = text.indexOf(learnedEnd)
  if (end <= start) throw new SkillSyncError('SkillOpt learned block markers are out of order')
  const directives: string[] = []
  let headingSeen = false
  for (const line of text.slice(start + learnedStart.length, end).split(/\r?\n/u)) {
    const stripped = line.trim()
    if (!stripped) continue
    if (stripped === learnedHeading) {
      if (headingSeen) throw new SkillSyncError('SkillOpt learned block has a duplicate heading')
      headingSeen = true
      continue
    }
    if (stripped.startsWith('_') && stripped.endsWith('_')) continue
    const match = /^- (.+?)\s*$/u.exec(stripped)
    if (!match) throw new SkillSyncError('SkillOpt learned block may contain only its banner and bullets')
    directives.push(match[1]!)
  }
  if (!headingSeen) throw new SkillSyncError('SkillOpt learned block is missing its heading')
  if (!directives.length) throw new SkillSyncError('SkillOpt learned block must contain at least one directive')
  if (new Set(directives).size !== directives.length) throw new SkillSyncError('SkillOpt learned block contains duplicate directives')
  return directives
}

async function selfTest(): Promise<void> {
  const path = `${process.env.TEMP ?? process.env.TMP ?? '/tmp'}\\advx-tst-014-skill-${process.pid}.md`
  const source = `# Room 6657 Style\n\n## Runtime Directives\n\n- React to the current scene.\n\n## Persona Lenses\n\n${PERSONA_IDS.map((id) => `### ${id}\n\nLens for ${id}.`).join('\n\n')}\n`
  await Bun.write(path, source)
  try {
    const payload = JSON.parse(new TextDecoder().decode(await compileSkill(path))) as Record<string, unknown>
    if (payload.mode_id !== MODE_ID || JSON.stringify(payload.directives) !== JSON.stringify(['React to the current scene.'])) throw new SkillSyncError('sync self-test failed')
    await Bun.write(path, `${source}\n## Examples\n\n> copied line\n`)
    try {
      await compileSkill(path)
      throw new SkillSyncError('example validation unexpectedly passed')
    } catch (error) {
      if (error instanceof SkillSyncError && error.message.includes('unexpectedly passed')) throw error
    }
  } finally {
    if (await Bun.file(path).exists()) await rm(path, { force: true })
  }
}

if (import.meta.main) {
  try {
    const argv = Bun.argv.slice(2)
    const selfTestRequested = argv.includes('--self-test')
    if (selfTestRequested) {
      await selfTest()
      console.log('sync-room-6657-skill self-test: OK')
    } else {
      const optionValue = (name: string, fallback: string): string => {
        const index = argv.indexOf(name)
        return index >= 0 && argv[index + 1] ? argv[index + 1]! : fallback
      }
      const input = resolve(optionValue('--input', DEFAULT_INPUT))
      const output = resolve(optionValue('--output', DEFAULT_OUTPUT))
      const check = argv.includes('--check')
      const generated = await compileSkill(input)
      if (check) {
        if (!await Bun.file(output).exists() || !Buffer.from(await Bun.file(output).bytes()).equals(Buffer.from(generated))) throw new SkillSyncError(`generated output is stale; run ${resolve(import.meta.dir, 'sync-room-6657-skill.ts')}`)
        console.log(`room-6657 generation skill is current: ${output}`)
      } else {
        await atomicWriteBytes(output, generated)
        console.log(`wrote room-6657 generation skill: ${output}`)
      }
    }
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
