import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  atomicWriteBytes,
  atomicWriteJson,
  canonicalRecords,
  jsonlBytes,
  type CorpusRecord
} from './sb6657-corpus-common.ts'

export const DEFAULT_ENDPOINT = 'https://hguofichp.cn:10086/machine/Page'
export const DEFAULT_DIRECTORY = resolve(import.meta.dir, '..', '.advx-data', 'sb6657')
export const FORBIDDEN_HEADERS = ['dpahjdoiaw', 'siteToken'] as const

export class CorpusError extends Error {}

type Page = { list: CorpusRecord[]; total: number; lastPage: boolean }
type FetchOptions = {
  endpoint: string
  pageSize: number
  maxPages?: number
  delay: number
  timeout: number
  retries: number
  output: string
  metadata: string
  userAgent: string
}

function parseArgs(argv: readonly string[]): FetchOptions & { selfTest: boolean } {
  const values = new Map<string, string>()
  let selfTest = false
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (name === '--self-test') {
      selfTest = true
      continue
    }
    const value = argv[index + 1]
    if (!name?.startsWith('--') || value === undefined) throw new CorpusError('arguments must be --name value pairs')
    values.set(name, value)
    index += 1
  }
  const number = (name: string, fallback: number, minimum: number, maximum?: number) => {
    const parsed = Number(values.get(name) ?? fallback)
    if (!Number.isFinite(parsed) || parsed < minimum || (maximum !== undefined && parsed > maximum)) {
      throw new CorpusError(`${name} has an invalid value`)
    }
    return parsed
  }
  const pageSize = number('--page-size', 100, 1, 1000)
  const maxPagesValue = values.get('--max-pages')
  const maxPages = maxPagesValue === undefined ? undefined : number('--max-pages', 0, 1)
  const delay = number('--delay', 0.35, 0)
  const timeout = number('--timeout', 20, Number.MIN_VALUE)
  const retries = number('--retries', 4, 0)
  if (![pageSize, retries, maxPages].every((value) => value === undefined || Number.isInteger(value))) {
    throw new CorpusError('page and retry limits must be integers')
  }
  const output = resolve(values.get('--output') ?? join(DEFAULT_DIRECTORY, 'corpus.jsonl'))
  return {
    endpoint: values.get('--endpoint') ?? DEFAULT_ENDPOINT,
    pageSize,
    maxPages,
    delay,
    timeout,
    retries,
    output,
    metadata: resolve(values.get('--metadata') ?? join(DEFAULT_DIRECTORY, 'metadata.json')),
    userAgent: values.get('--user-agent') ?? 'ADVX-sb6657-corpus/1.0',
    selfTest
  }
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && !Number.isNaN(value)
}

function validateRecord(value: unknown, page: number, index: number): CorpusRecord {
  const location = `page ${page} item ${index}`
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new CorpusError(`${location}: record must be an object`)
  const item = value as Record<string, unknown>
  if (typeof item.barrage !== 'string' || !item.barrage.trim()) throw new CorpusError(`${location}: barrage must be a non-empty string`)
  if (!integer(item.id)) throw new CorpusError(`${location}: id must be an integer`)
  const count = Number(item.cnt)
  if (!Number.isInteger(count) || count < 0) throw new CorpusError(`${location}: cnt must be integer-like and non-negative`)
  if (item.tags !== undefined && item.tags !== null && typeof item.tags !== 'string') throw new CorpusError(`${location}: tags must be a string or null`)
  if (item.submitTime !== undefined && item.submitTime !== null && typeof item.submitTime !== 'string') throw new CorpusError(`${location}: submitTime must be a string or null`)
  return { id: item.id, barrage: item.barrage, cnt: count, tags: item.tags || '', submitTime: item.submitTime ?? null }
}

function validatePage(value: unknown, page: number): Page {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new CorpusError(`page ${page}: expected response object`)
  const payload = value as Record<string, unknown>
  if (payload.code !== 200) throw new CorpusError(`page ${page}: expected response code 200`)
  const data = payload.data
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new CorpusError(`page ${page}: data must be an object`)
  const record = data as Record<string, unknown>
  if (!Array.isArray(record.list)) throw new CorpusError(`page ${page}: data.list must be an array`)
  if (!integer(record.total) || record.total < 0) throw new CorpusError(`page ${page}: data.total must be a non-negative integer`)
  if (typeof record.lastPage !== 'boolean') throw new CorpusError(`page ${page}: data.lastPage must be boolean`)
  return { list: record.list.map((item, index) => validateRecord(item, page, index)), total: record.total, lastPage: record.lastPage }
}

async function fetchPage(options: FetchOptions, page: number): Promise<Page> {
  const url = new URL(options.endpoint)
  url.searchParams.set('pageNum', String(page))
  url.searchParams.set('pageSize', String(options.pageSize))
  let lastError: unknown = new CorpusError('request failed')
  for (let attempt = 0; attempt <= options.retries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), options.timeout * 1000)
    try {
      const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': options.userAgent }, signal: controller.signal })
      if (!response.ok) throw new CorpusError(`page ${page}: HTTP ${response.status}`)
      return validatePage(await response.json(), page)
    } catch (error) {
      lastError = error
      if (attempt >= options.retries) break
      await new Promise((resolvePromise) => setTimeout(resolvePromise, Math.min(8_000, 500 * 2 ** attempt) + Math.random() * 100))
    } finally {
      clearTimeout(timer)
    }
  }
  throw new CorpusError(`page ${page} failed after ${options.retries + 1} attempts: ${String(lastError)}`)
}

export async function runFetch(options: FetchOptions): Promise<Record<string, unknown>> {
  const records: CorpusRecord[] = []
  let reportedTotal: number | undefined
  const observedTotals = new Set<number>()
  let pageNumber = 1
  let terminationReason = 'unknown'
  while (true) {
    const page = await fetchPage(options, pageNumber)
    reportedTotal ??= page.total
    observedTotals.add(page.total)
    records.push(...page.list)
    if (page.lastPage) {
      terminationReason = 'last_page'
      break
    }
    if (page.list.length === 0) throw new CorpusError(`page ${pageNumber}: received an empty page before lastPage=true`)
    if (options.maxPages !== undefined && pageNumber >= options.maxPages) {
      terminationReason = 'max_pages'
      break
    }
    pageNumber += 1
    if (options.delay) await new Promise((resolvePromise) => setTimeout(resolvePromise, options.delay * 1000))
  }
  const canonical = canonicalRecords(records)
  const bytes = jsonlBytes(canonical)
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  await atomicWriteBytes(options.output, bytes)
  const metadata = {
    schema_version: 1,
    source_url: options.endpoint,
    fetched_at_utc: new Date().toISOString(),
    page_size: options.pageSize,
    page_count: pageNumber,
    reported_total: reportedTotal ?? 0,
    observed_reported_totals: [...observedTotals].sort((left, right) => left - right),
    fetched_count: records.length,
    unique_count: canonical.length,
    sha256,
    complete: terminationReason === 'last_page',
    termination_reason: terminationReason,
    request_header_policy: {
      sent: ['Accept', 'User-Agent'],
      forbidden: [...FORBIDDEN_HEADERS],
      site_attribution_headers_sent: false
    }
  }
  await atomicWriteJson(options.metadata, metadata)
  return metadata
}

async function selfTest(): Promise<void> {
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      const page = Number(url.searchParams.get('pageNum'))
      const empty = url.searchParams.get('empty') === '1'
      const list = empty ? [] : page === 1
        ? [{ id: 2, barrage: '重复！', cnt: '2', tags: '01', submitTime: null }, { id: 1, barrage: '短句?', cnt: '4', tags: '02', submitTime: null }]
        : [{ id: 3, barrage: '重复！', cnt: '5', tags: '03', submitTime: null }]
      return Response.json({ code: 200, data: { list, total: 3, lastPage: !empty && page === 2 } })
    }
  })
  const root = await mkdtemp(join(tmpdir(), 'advx-tst-014-fetch-'))
  try {
    const options: FetchOptions = { endpoint: `${server.url}machine/Page`, pageSize: 2, delay: 0, timeout: 2, retries: 0, output: join(root, 'corpus.jsonl'), metadata: join(root, 'metadata.json'), userAgent: 'test' }
    const metadata = await runFetch(options)
    if (metadata.unique_count !== 2 || metadata.complete !== true) throw new CorpusError('fetch self-test dedupe failed')
    await expectReject(runFetch({ ...options, endpoint: `${server.url}machine/Page?empty=1` }), 'empty page')
  } finally {
    server.stop()
    await rm(root, { recursive: true, force: true })
  }
}

async function expectReject(operation: Promise<unknown>, label: string): Promise<void> {
  try {
    await operation
    throw new CorpusError(`${label} validation unexpectedly passed`)
  } catch (error) {
    if (error instanceof CorpusError && error.message.includes('unexpectedly passed')) throw error
  }
}

if (import.meta.main) {
  try {
    const args = parseArgs(Bun.argv.slice(2))
    if (args.selfTest) {
      await selfTest()
      console.log('fetch-sb6657-corpus self-test: OK')
    } else {
      const metadata = await runFetch(args)
      console.log(`wrote ${metadata.unique_count} canonical records to ${args.output}`)
    }
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}
