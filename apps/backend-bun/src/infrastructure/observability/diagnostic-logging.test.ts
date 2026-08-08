import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'bun:test'

import {
  createDiagnosticLogger,
  isVersionedDiagnosticEventName,
  sanitizeDiagnosticValue
} from './diagnostic-logging'

const cleanupRoots: string[] = []

afterEach(() => {
  for (const root of cleanupRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function temporaryDirectory(): string {
  const root = join(tmpdir(), `advx-observability-${crypto.randomUUID()}`)
  cleanupRoots.push(root)
  return root
}

function readJsonl(root: string): Array<Record<string, unknown>> {
  return readdirSync(root)
    .filter((name) => name.startsWith('backend.jsonl'))
    .sort()
    .flatMap((name) =>
      readFileSync(join(root, name), 'utf8')
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>)
    )
}

describe('diagnostic JSONL logging', () => {
  test('writes a versioned common envelope as JSONL', async () => {
    const logger = createDiagnosticLogger({
      directory: temporaryDirectory(),
      process: 'backend',
      level: 'trace',
      now: () => new Date('2026-08-06T00:00:00.000Z')
    })

    const envelope = logger.emit({
      level: 'info',
      event: 'backend.ready.v1',
      process: 'backend',
      backendStartId: 'start-1',
      outcome: 'success',
      attributes: { queueDepth: 0 }
    })
    await logger.close()

    expect(envelope.schemaVersion).toBe(1)
    expect(envelope.timestamp).toBe('2026-08-06T00:00:00.000Z')
    const records = readJsonl(join(logger.filePath, '..'))
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      schemaVersion: 1,
      timestamp: '2026-08-06T00:00:00.000Z',
      level: 'info',
      event: 'backend.ready.v1',
      process: 'backend',
      backendStartId: 'start-1'
    })
    expect(readFileSync(logger.filePath, 'utf8').split('\n').filter(Boolean)).toHaveLength(1)
  })

  test('redacts authorization, startup tokens, provider headers, bodies, paths, safeStorage, and error causes', async () => {
    const logger = createDiagnosticLogger({ directory: temporaryDirectory(), process: 'backend' })
    const failure = new Error('provider failed: Bearer error-message-secret')
    Object.defineProperty(failure, 'cause', {
      value: new Error('api_key=cause-secret'),
      enumerable: true
    })
    logger.emit({
      level: 'error',
      event: 'error.reported.v1',
      process: 'backend',
      attributes: {
        authorization: 'Bearer authorization-secret',
        message: 'api_key=inline-secret sk-1234567890abcdef',
        startupToken: 'startup-token-secret',
        providerHeaders: {
          authorization: 'Bearer nested-provider-secret',
          'x-api-key': 'provider-key-secret'
        },
        prompt: 'complete prompt should not be persisted',
        responseBody: 'complete response should not be persisted',
        path: 'D:\\Users\\woodfish\\AppData\\Local\\ADVX\\secret.db',
        safeStorage: 'electron-encrypted-value-secret',
        error: failure
      }
    })
    await logger.close()

    const text = readFileSync(logger.filePath, 'utf8')
    for (const secret of [
      'authorization-secret',
      'inline-secret',
      '1234567890abcdef',
      'startup-token-secret',
      'nested-provider-secret',
      'provider-key-secret',
      'complete prompt should not be persisted',
      'complete response should not be persisted',
      'woodfish',
      'electron-encrypted-value-secret',
      'error-message-secret',
      'cause-secret'
    ]) {
      expect(text).not.toContain(secret)
    }
    expect(text).toContain('[REDACTED]')
    expect(text).toContain('[REDACTED_PATH]')
  })

  test('summarizes binary values without persisting bytes', () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    const sanitized = sanitizeDiagnosticValue({ frame: bytes }) as Record<string, unknown>
    expect(sanitized.frame).toEqual({
      type: 'binary',
      byteLength: 4,
      sha256: createHash('sha256').update(bytes).digest('hex')
    })
  })

  test('rotates before a line exceeds the configured file size', async () => {
    const root = temporaryDirectory()
    const logger = createDiagnosticLogger({
      directory: root,
      process: 'backend',
      level: 'info',
      maxBytes: 220,
      backupCount: 8
    })
    for (let index = 0; index < 6; index += 1) {
      logger.emit({
        level: 'info',
        event: 'trace.finished.v1',
        process: 'backend',
        sequence: index,
        attributes: { result: `bounded-${index}` }
      })
    }
    await logger.close()

    const names = readdirSync(root).filter((name) => name.startsWith('backend.jsonl'))
    expect(names).toContain('backend.jsonl.1')
    expect(readJsonl(root)).toHaveLength(6)
    for (const name of names) {
      expect(readFileSync(join(root, name), 'utf8')).not.toContain('undefined')
    }
  })

  test('rejects unversioned event names', () => {
    expect(isVersionedDiagnosticEventName('backend.ready')).toBe(false)
    expect(isVersionedDiagnosticEventName('backend.ready.v1')).toBe(true)
    const logger = createDiagnosticLogger({ directory: temporaryDirectory(), process: 'backend' })
    expect(() =>
      logger.emit({ level: 'info', event: 'backend.ready', process: 'backend' })
    ).toThrow('versioned')
  })
})
