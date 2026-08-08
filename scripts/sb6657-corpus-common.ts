import { createHash } from 'node:crypto'
import { mkdir, open, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

export type CorpusRecord = Record<string, unknown> & {
  barrage: string
  cnt: number | string
  id?: number
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonValue)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => compareText(left, right))
        .map(([key, child]) => [key, sortJsonValue(child)])
    )
  }
  return value
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJsonValue(value))
}

function stableId(record: CorpusRecord): number {
  return typeof record.id === 'number' && Number.isInteger(record.id) && record.id >= 0
    ? record.id
    : Number.MAX_SAFE_INTEGER
}

function count(record: CorpusRecord): number {
  const value = Number(record.cnt ?? 0)
  return Number.isFinite(value) && Number.isInteger(value) ? Math.max(0, value) : 0
}

function recordChoiceKey(record: CorpusRecord): [number, number, string] {
  return [-count(record), stableId(record), canonicalJson(record)]
}

function compareChoice(left: CorpusRecord, right: CorpusRecord): number {
  const a = recordChoiceKey(left)
  const b = recordChoiceKey(right)
  return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2])
}

export function canonicalRecords(records: Iterable<CorpusRecord>): CorpusRecord[] {
  const byBarrage = new Map<string, CorpusRecord>()
  for (const record of records) {
    const current = byBarrage.get(record.barrage)
    if (!current || compareChoice(record, current) < 0) byBarrage.set(record.barrage, { ...record })
  }
  return [...byBarrage.values()].sort((left, right) =>
    compareText(left.barrage, right.barrage) || stableId(left) - stableId(right)
  )
}

export function jsonlBytes(records: Iterable<CorpusRecord>): Uint8Array {
  const lines = [...records].map((record) => canonicalJson(record))
  return Buffer.from(lines.length ? `${lines.join('\n')}\n` : '', 'utf8')
}

export function canonicalSha256(records: Iterable<CorpusRecord>): string {
  return createHash('sha256').update(jsonlBytes(canonicalRecords(records))).digest('hex')
}

export async function atomicWriteBytes(path: string, content: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    const handle = await open(temporary, 'w')
    try {
      await handle.writeFile(content)
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true })
  }
}

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await atomicWriteBytes(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'))
}
