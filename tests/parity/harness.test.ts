import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  compareParity,
  runParityCase,
  type NondeterminismRule,
  type ParityOutput
} from './harness'

const temporaryDirectories: string[] = []

function output(json: unknown, binary = 'same'): ParityOutput {
  return {
    json,
    binary: new TextEncoder().encode(binary)
  }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true })
    )
  )
})

describe('migration parity harness', () => {
  test('normalizes classified volatile IDs and timestamps', () => {
    const rules: NondeterminismRule[] = [
      { path: 'metadata.id', kind: 'volatile-id' },
      { path: 'metadata.at', kind: 'timestamp' }
    ]
    expect(compareParity(
      output({ value: 3, metadata: { id: 'python', at: 100 } }),
      output({ value: 3, metadata: { id: 'typescript', at: 200 } }),
      rules
    )).toEqual([])
  })

  test('rejects JSON mismatches and unexpected nondeterminism', () => {
    const diffs = compareParity(
      output({ status: 'ok', request_id: 'python' }),
      output({ status: 'degraded', request_id: 'typescript' }),
      []
    )
    expect(diffs.map((diff) => diff.path)).toEqual([
      '$.request_id',
      '$.status'
    ])
  })

  test('rejects binary mismatches', () => {
    const diffs = compareParity(
      output({ status: 'ok' }, 'oracle'),
      output({ status: 'ok' }, 'candidate'),
      []
    )
    expect(diffs).toHaveLength(1)
    expect(diffs[0]?.channel).toBe('binary')
  })

  test('rejects invalid or missing nondeterminism classifications', () => {
    const invalid = compareParity(
      output({ metadata: { id: 'python' } }),
      output({ metadata: { id: 'typescript' } }),
      [{ path: 'metadata.id', kind: 'random' } as unknown as NondeterminismRule]
    )
    const missing = compareParity(
      output({ metadata: {} }),
      output({ metadata: {} }),
      [{ path: 'metadata.id', kind: 'volatile-id' }]
    )
    expect(invalid[0]?.channel).toBe('nondeterminism')
    expect(missing[0]?.channel).toBe('nondeterminism')
  })

  test('writes a report and cleans the isolated data directory', async () => {
    const resultDirectory = await mkdtemp(join(tmpdir(), 'advx-parity-test-'))
    temporaryDirectories.push(resultDirectory)
    const reportPath = join(resultDirectory, 'report.json')
    const oraclePayload = JSON.stringify({
      json: { status: 'ok' },
      binary: 'c2FtZQ=='
    })
    const report = await runParityCase({
      caseId: 'report-and-cleanup',
      oracleCommand: [
        process.execPath,
        '-e',
        `console.log(${JSON.stringify(oraclePayload)})`
      ],
      candidateCommand: 'typescript:test-fixture',
      candidate: () => output({ status: 'ok' }),
      decodeOracle: (stdout) => {
        const parsed = JSON.parse(stdout) as {
          json: unknown
          binary: string
        }
        return {
          json: parsed.json,
          binary: Uint8Array.from(Buffer.from(parsed.binary, 'base64'))
        }
      },
      nondeterminism: [],
      reportPath
    })
    expect(report.status).toBe('passed')
    expect(report.temporaryDataDirectory.cleanupAttempted).toBe(true)
    expect(report.temporaryDataDirectory.existsAfterCleanup).toBe(false)
    expect(JSON.parse(await readFile(reportPath, 'utf8'))).toEqual(report)
  }, 15_000)

  test('writes a failed report when the candidate throws', async () => {
    const resultDirectory = await mkdtemp(join(tmpdir(), 'advx-parity-test-'))
    temporaryDirectories.push(resultDirectory)
    const reportPath = join(resultDirectory, 'candidate-failure.json')
    const report = await runParityCase({
      caseId: 'candidate-failure',
      oracleCommand: [
        process.execPath,
        '-e',
        'console.log(JSON.stringify({json:{status:"ok"},binary:"c2FtZQ=="}))'
      ],
      candidateCommand: 'typescript:throwing-fixture',
      candidate: () => {
        throw new Error('synthetic candidate failure')
      },
      decodeOracle: (stdout) => {
        const parsed = JSON.parse(stdout) as {
          json: unknown
          binary: string
        }
        return {
          json: parsed.json,
          binary: Uint8Array.from(Buffer.from(parsed.binary, 'base64'))
        }
      },
      nondeterminism: [],
      reportPath
    })
    expect(report.status).toBe('failed')
    expect(report.commands.find(({ role }) => role === 'candidate')).toMatchObject({
      exitCode: -1,
      status: 'failed',
      stderr: 'synthetic candidate failure'
    })
    expect(report.diffs[0]?.path).toBe('$candidate')
    expect(JSON.parse(await readFile(reportPath, 'utf8'))).toEqual(report)
  }, 15_000)

  test('writes a failed report when oracle decoding throws', async () => {
    const resultDirectory = await mkdtemp(join(tmpdir(), 'advx-parity-test-'))
    temporaryDirectories.push(resultDirectory)
    const reportPath = join(resultDirectory, 'decode-failure.json')
    const report = await runParityCase({
      caseId: 'decode-failure',
      oracleCommand: [
        process.execPath,
        '-e',
        'console.log("not-json")'
      ],
      candidateCommand: 'typescript:test-fixture',
      candidate: () => output({ status: 'ok' }),
      decodeOracle: (stdout) => JSON.parse(stdout) as ParityOutput,
      nondeterminism: [],
      reportPath
    })
    expect(report.status).toBe('failed')
    expect(report.commands.find(({ role }) => role === 'decode')).toMatchObject({
      exitCode: -1,
      status: 'failed'
    })
    expect(report.diffs[0]?.path).toBe('$decode')
    expect(JSON.parse(await readFile(reportPath, 'utf8'))).toEqual(report)
  }, 15_000)
})
