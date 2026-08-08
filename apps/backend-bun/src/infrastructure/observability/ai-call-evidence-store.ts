import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync
} from 'node:fs'
import { dirname } from 'node:path'

import { type AiCallTrace } from '@advx/contracts'

import { normalizeAiCallTrace } from './trace-evidence'

export type AiCallEvidenceStoreOptions = Readonly<{
  maxItems?: number
  path?: string
}>

export class AiCallEvidenceStore {
  readonly #maxItems: number
  readonly #path: string | undefined
  readonly #items = new Map<string, AiCallTrace>()

  constructor(options: AiCallEvidenceStoreOptions = {}) {
    const maxItems = options.maxItems ?? 1_000
    if (!Number.isSafeInteger(maxItems) || maxItems < 1) {
      throw new RangeError('AI-call evidence maxItems must be at least one')
    }
    this.#maxItems = maxItems
    this.#path = options.path
    this.#load()
  }

  upsert(input: AiCallTrace): void {
    const trace = normalizeAiCallTrace(input).trace
    if (!this.#items.has(trace.call_id) && this.#items.size >= this.#maxItems) {
      const oldest = this.#items.keys().next().value
      if (oldest !== undefined) this.#items.delete(oldest)
    }
    this.#items.set(trace.call_id, trace)
    if (this.#path === undefined) return
    mkdirSync(dirname(this.#path), { recursive: true })
    appendFileSync(this.#path, `${JSON.stringify(trace)}\n`, 'utf8')
  }

  query(limit = this.#maxItems): readonly AiCallTrace[] {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new RangeError('AI-call evidence query limit must be at least one')
    }
    return Object.freeze(
      [...this.#items.values()]
        .sort((left, right) =>
          right.started_at_ms - left.started_at_ms ||
          right.call_id.localeCompare(left.call_id)
        )
        .slice(0, limit)
    )
  }

  get(callId: string): AiCallTrace | null {
    return this.#items.get(callId) ?? null
  }

  #load(): void {
    if (this.#path === undefined || !existsSync(this.#path)) return
    const lines = readFileSync(this.#path, 'utf8').split(/\r?\n/u)
    for (const [index, line] of lines.entries()) {
      if (line.trim().length === 0) continue
      let value: unknown
      try {
        value = JSON.parse(line) as unknown
      } catch (error) {
        if (index === lines.length - 1) break
        throw error
      }
      const trace = normalizeAiCallTrace(value as AiCallTrace).trace
      if (!this.#items.has(trace.call_id) && this.#items.size >= this.#maxItems) {
        const oldest = this.#items.keys().next().value
        if (oldest !== undefined) this.#items.delete(oldest)
      }
      this.#items.set(trace.call_id, trace)
    }
  }
}
