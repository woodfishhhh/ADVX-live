import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  atomicWriteJson,
  canonicalRecords,
  canonicalSha256,
  type CorpusRecord
} from './sb6657-corpus-common.ts'

const DEFAULT_DIRECTORY = resolve(import.meta.dir, '..', '.advx-data', 'sb6657')
type Metadata = Record<string, unknown>

function parseArgs(argv: readonly string[]): { input: string; output: string; metadata?: string; selfTest: boolean } {
  const values = new Map<string, string>()
  let selfTest = false
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (name === '--self-test') {
      selfTest = true
      continue
    }
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value === undefined) throw new Error('arguments must be --name value pairs')
    values.set(name, value)
    index += 1
  }
  return {
    input: resolve(values.get('--input') ?? join(DEFAULT_DIRECTORY, 'corpus.jsonl')),
    output: resolve(values.get('--output') ?? join(DEFAULT_DIRECTORY, 'profile.json')),
    metadata: values.has('--metadata') ? resolve(values.get('--metadata')!) : undefined,
    selfTest
  }
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

async function readRecords(path: string): Promise<CorpusRecord[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    throw new Error(`cannot read corpus ${path}: ${String(error)}`)
  }
  const records: CorpusRecord[] = []
  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue
    let value: unknown
    try {
      value = JSON.parse(line) as unknown
    } catch (error) {
      throw new Error(`line ${lineIndex + 1}: invalid JSON: ${String(error)}`)
    }
    const item = asObject(value, `line ${lineIndex + 1}`)
    if (typeof item.barrage !== 'string' || !item.barrage) throw new Error(`line ${lineIndex + 1}: expected non-empty string barrage`)
    const count = Number(item.cnt ?? 0)
    if (!Number.isInteger(count) || count < 0) throw new Error(`line ${lineIndex + 1}: cnt must be integer-like and non-negative`)
    records.push({ ...item, barrage: item.barrage, cnt: count })
  }
  if (!records.length) throw new Error('corpus is empty')
  return canonicalRecords(records)
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits
  return Math.round((value + Number.EPSILON) * factor) / factor
}

export function quantiles(values: readonly number[]): Record<string, number> {
  const ordered = [...values].sort((left, right) => left - right)
  if (!ordered.length) throw new Error('quantiles require values')
  const result: Record<string, number> = {}
  for (const [label, probability] of [['p10', 0.10], ['p25', 0.25], ['p50', 0.50], ['p75', 0.75], ['p90', 0.90], ['p95', 0.95], ['p99', 0.99]] as const) {
    const position = (ordered.length - 1) * probability
    const lower = Math.floor(position)
    const upper = Math.ceil(position)
    const value = ordered[lower]! + (ordered[upper]! - ordered[lower]!) * (position - lower)
    result[label] = Number.isInteger(value) ? value : round(value, 3)
  }
  return result
}

function ratio(texts: readonly string[], predicate: (text: string) => boolean): number {
  return round(texts.reduce((total, text) => total + (predicate(text) ? 1 : 0), 0) / texts.length, 6)
}

export function textRates(texts: readonly string[]): Record<string, number> {
  const totalCharacters = texts.reduce((total, text) => total + text.length, 0)
  return {
    short_le_5: ratio(texts, (text) => text.length <= 5),
    short_le_10: ratio(texts, (text) => text.length <= 10),
    short_le_20: ratio(texts, (text) => text.length <= 20),
    question_mark: ratio(texts, (text) => /[?？]/u.test(text)),
    exclamation_mark: ratio(texts, (text) => /[!！]/u.test(text)),
    repetition: ratio(texts, (text) => /([\s\S]{1,8})\1+/u.test(text)),
    mention: ratio(texts, (text) => /@[\p{L}\p{N}_]+/u.test(text)),
    newline: ratio(texts, (text) => text.includes('\n') || text.includes('\r')),
    contains_ascii: ratio(texts, (text) => /[\x00-\x7f]/u.test(text)),
    ascii_only: ratio(texts, (text) => text.length > 0 && [...text].every((character) => character.charCodeAt(0) < 128)),
    ascii_character: round(texts.reduce((total, text) => total + [...text].filter((character) => character.charCodeAt(0) < 128).length, 0) / totalCharacters, 6)
  }
}

export function rhetoricalSignals(texts: readonly string[]): Record<string, number> {
  return {
    rhetorical_question: ratio(texts, (text) => /(难道|怎么会|凭什么|谁能|谁懂|不是吧|吗[?？]|呢[?？])/u.test(text)),
    ellipsis: ratio(texts, (text) => text.includes('……') || text.includes('...')),
    repeated_punctuation: ratio(texts, (text) => /([!?！？。~～])\1+/u.test(text)),
    bracketed_aside: ratio(texts, (text) => /[（(【\[][^\n]*?[）)】\]]/u.test(text)),
    laughter_signal: ratio(texts, (text) => /(哈哈|笑死|hhh+|lol+)/iu.test(text)),
    imperative_signal: ratio(texts, (text) => /(快|别|不要|给我|赶紧|必须|建议)/u.test(text))
  }
}

async function loadMetadata(path: string, records: readonly CorpusRecord[]): Promise<Metadata | undefined> {
  try {
    await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new Error(`cannot read metadata ${path}: ${String(error)}`)
  }
  let metadata: unknown
  try {
    metadata = JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`cannot read metadata ${path}: ${String(error)}`)
  }
  const value = asObject(metadata, 'metadata')
  if (value.sha256 !== canonicalSha256(records)) throw new Error('metadata sha256 does not match the canonical corpus')
  if (value.unique_count !== records.length) throw new Error('metadata unique_count does not match the canonical corpus')
  if (value.complete !== true || value.termination_reason !== 'last_page') throw new Error('metadata must describe a complete last_page fetch')
  for (const field of ['source_url', 'fetched_at_utc']) if (typeof value[field] !== 'string' || !value[field]) throw new Error(`metadata ${field} must be a non-empty string`)
  for (const field of ['reported_total', 'fetched_count', 'page_count']) if (typeof value[field] !== 'number' || !Number.isInteger(value[field]) || value[field] < 0) throw new Error(`metadata ${field} must be a non-negative integer`)
  if (value.fetched_count !== value.reported_total) throw new Error('metadata fetched_count must match reported_total')
  if ((value.page_count as number) < 1) throw new Error('metadata page_count must be positive')
  if (!Array.isArray(value.observed_reported_totals) || !value.observed_reported_totals.length || value.observed_reported_totals.some((item) => item !== value.reported_total)) throw new Error('metadata observed totals must remain stable at reported_total')
  if (value.request_header_policy === null || typeof value.request_header_policy !== 'object' || Array.isArray(value.request_header_policy)) throw new Error('metadata request_header_policy must be an object')
  return value
}

export function buildProfile(records: readonly CorpusRecord[], metadata?: Metadata): Record<string, unknown> {
  const texts = records.map((record) => record.barrage)
  const lengths = texts.map((text) => text.length)
  const counts = records.map((record) => Number(record.cnt))
  const countQuantiles = quantiles(counts)
  const popularRecords = records.filter((record) => Number(record.cnt) >= countQuantiles.p75)
  const popularTexts = popularRecords.map((record) => record.barrage)
  const tagCounts = new Map<string, number>()
  for (const record of records) for (const tag of String(record.tags ?? '').split(',').map((item) => item.trim()).filter(Boolean)) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1)
  const source = {
    record_count: records.length,
    canonical_sha256: canonicalSha256(records),
    source_url: metadata?.source_url ?? null,
    fetched_at_utc: metadata?.fetched_at_utc ?? null,
    reported_total: metadata?.reported_total ?? null,
    fetched_count: metadata?.fetched_count ?? null,
    page_count: metadata?.page_count ?? null,
    termination_reason: metadata?.termination_reason ?? null,
    request_header_policy: metadata?.request_header_policy ?? null
  }
  return {
    schema_version: 1,
    source,
    length_characters: { minimum: Math.min(...lengths), maximum: Math.max(...lengths), mean: round(lengths.reduce((a, b) => a + b, 0) / lengths.length, 3), quantiles: quantiles(lengths) },
    copy_count: { minimum: Math.min(...counts), maximum: Math.max(...counts), mean: round(counts.reduce((a, b) => a + b, 0) / counts.length, 3), quantiles: countQuantiles },
    rates: textRates(texts),
    tag_distribution: Object.fromEntries([...tagCounts.entries()].sort(([leftTag, leftCount], [rightTag, rightCount]) => rightCount - leftCount || (leftTag < rightTag ? -1 : leftTag > rightTag ? 1 : 0)).map(([tag, count]) => [tag, { count, ratio: round(count / records.length, 6) }])),
    rhetorical_signals: rhetoricalSignals(texts),
    popular_slice: { record_count: popularRecords.length, min_copy_count: Math.min(...popularRecords.map((record) => Number(record.cnt))), length_quantiles: quantiles(popularTexts.map((text) => text.length)), rates: textRates(popularTexts), rhetorical_signals: rhetoricalSignals(popularTexts) },
    generation_instructions: [
      `默认保持短促，目标字符长度以中位数 ${quantiles(lengths).p50} 为中心，并参考长度分位数。`,
      '使用弹幕口吻直接回应当前画面或事件，避免解释背景、总结过程或写成完整文章。',
      '按统计概率混合问句、感叹、复读、@、换行与 ASCII 片段，不要每条都堆叠信号。',
      '标签仅用于采样分层；生成内容不得原样复述语料，也不得输出来源记录或标识符。',
      '一次生成多个候选时保持句式和情绪多样，过滤与输入语料完全相同的文本。'
    ]
  }
}

async function selfTest(): Promise<void> {
  const root = await mkdtemp(join(resolve(process.env.TEMP ?? '/tmp'), 'advx-tst-014-profile-'))
  const records: CorpusRecord[] = [
    { id: 1, barrage: '短句?', cnt: 2, tags: '01,02', submitTime: null },
    { id: 2, barrage: '哈哈哈哈！！', cnt: 8, tags: '02', submitTime: null },
    { id: 3, barrage: '@某人 别急...', cnt: 4, tags: '', submitTime: null }
  ]
  try {
    const metadata: Metadata = { source_url: 'https://example.invalid/machine/Page', fetched_at_utc: '2026-01-01T00:00:00Z', reported_total: 3, observed_reported_totals: [3], fetched_count: 3, unique_count: 3, page_count: 2, sha256: canonicalSha256(records), complete: true, termination_reason: 'last_page', request_header_policy: { site_attribution_headers_sent: false } }
    const output = join(root, 'profile.json')
    await atomicWriteJson(output, buildProfile(records, metadata))
    const loaded = asObject(JSON.parse(await readFile(output, 'utf8')), 'profile')
    if (Math.abs(Number(asObject(loaded.rates, 'rates').question_mark) - 0.333333) > 1e-9 || asObject(loaded.tag_distribution, 'tags')['02'] === undefined) throw new Error('profile self-test failed')
    const invalid = { ...metadata, sha256: '0'.repeat(64) }
    try {
      await loadMetadata(join(root, 'metadata.json'), records)
      void invalid
    } catch {
      // Missing metadata is optional by design.
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  try {
    const args = parseArgs(Bun.argv.slice(2))
    if (args.selfTest) { await selfTest(); console.log('profile-sb6657-corpus self-test: OK') }
    else {
      const records = await readRecords(args.input)
      const metadata = await loadMetadata(args.metadata ?? join(resolve(args.input, '..'), 'metadata.json'), records)
      const profile = buildProfile(records, metadata)
      await atomicWriteJson(args.output, profile)
      console.log(`wrote aggregate profile for ${records.length} records to ${args.output}`)
    }
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
