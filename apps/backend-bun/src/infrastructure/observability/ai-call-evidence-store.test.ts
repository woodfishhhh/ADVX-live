import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'bun:test'
import { aiCallTraceSchema, type AiCallTrace } from '@advx/contracts'

import { AiCallEvidenceStore } from './ai-call-evidence-store'

const temporaryDirectories = new Set<string>()

afterEach(() => {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true })
  }
  temporaryDirectories.clear()
})

describe('TST-003 AI-call evidence store parity', () => {
  test('evicts in memory while appending the full history and reloads the retained tail', () => {
    const directory = mkdtempSync(join(tmpdir(), 'advx-ai-call-store-'))
    temporaryDirectories.add(directory)
    const path = join(directory, 'ai-calls.jsonl')
    const store = new AiCallEvidenceStore({ maxItems: 2, path })

    store.upsert(completedCall('call-1', 1))
    store.upsert(completedCall('call-2', 2))
    store.upsert(completedCall('call-3', 3))

    const persisted = readFileSync(path, 'utf8')
      .trim()
      .split(/\r?\n/u)
      .map((line) => aiCallTraceSchema.parse(JSON.parse(line) as unknown))
    expect(persisted.map((trace) => trace.call_id)).toEqual([
      'call-1',
      'call-2',
      'call-3'
    ])
    expect(store.query(10).map((trace) => trace.call_id)).toEqual(['call-3', 'call-2'])

    const reloaded = new AiCallEvidenceStore({ maxItems: 2, path })
    expect(reloaded.query(10).map((trace) => trace.call_id)).toEqual([
      'call-3',
      'call-2'
    ])
  })
})

function completedCall(callId: string, startedAtMs: number): AiCallTrace {
  return aiCallTraceSchema.parse({
    call_id: callId,
    correlation_id: `correlation-${callId}`,
    role: 'viewer',
    status: 'succeeded',
    provider: 'openai-compatible',
    model_id: 'model-1',
    endpoint: '/v1/chat/completions',
    session_id: 'session-1',
    started_at_ms: startedAtMs,
    updated_at_ms: startedAtMs + 1,
    completed_at_ms: startedAtMs + 1,
    duration_ms: 1,
    timeline: [{ stage: 'succeeded', at_ms: startedAtMs + 1, detail: {} }],
    redacted: true
  })
}
