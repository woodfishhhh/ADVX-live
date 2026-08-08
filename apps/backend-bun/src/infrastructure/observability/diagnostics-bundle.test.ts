import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, test } from 'bun:test'

import {
  createDiagnosticsBundle,
  createRuntimeVersionSnapshot,
  DiagnosticsBundleError,
  type DiagnosticsArtifactKind
} from './diagnostics-bundle'

const cleanupRoots: string[] = []

afterEach(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function temporaryDirectory(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `advx-diagnostics-${crypto.randomUUID()}-`))
  cleanupRoots.push(root)
  return root
}

describe('manifest-driven diagnostics bundles', () => {
  test('copies only requested redacted artifacts and records hashes, sizes, and missing reasons', async () => {
    const root = await temporaryDirectory()
    const source = join(root, 'backend.jsonl')
    await writeFile(source, '{"schemaVersion":1,"event":"backend.ready.v1"}\n', 'utf8')
    const screenshot = join(root, 'selected.png')
    await writeFile(screenshot, Buffer.from([1, 2, 3, 4]))
    const destination = join(root, 'bundle')
    const result = await createDiagnosticsBundle({
      destination,
      bundleId: 'bundle-1',
      now: () => new Date('2026-08-06T00:00:00.000Z'),
      requested: ['redacted-logs', 'health', 'debug-snapshot', 'configuration-names', 'screenshots'],
      files: [
        { kind: 'redacted-logs', name: 'backend.jsonl', sourcePath: source, redacted: true },
        { kind: 'screenshots', name: 'selected.png', sourcePath: screenshot, redacted: true },
        { kind: 'replay', name: 'not-requested.json', sourcePath: source, redacted: true }
      ],
      json: [
        {
          kind: 'health',
          name: 'health.json',
          value: { status: 'ready', api_key: 'never-persist-this', nested: { prompt: 'raw prompt' } },
          redacted: true
        },
        {
          kind: 'configuration-names',
          name: 'configuration.json',
          value: ['ADVX_LOG_LEVEL', 'ADVX_DATA_DIR'],
          redacted: true
        }
      ],
      missing: [{ kind: 'debug-snapshot', reason: 'debug endpoint was not available' }]
    })

    expect(result.manifest).toMatchObject({
      schema_version: 1,
      bundle_id: 'bundle-1',
      redacted: true,
      requested: ['redacted-logs', 'health', 'debug-snapshot', 'configuration-names', 'screenshots']
    })
    expect(result.manifest.files.map((file) => file.kind)).toEqual([
      'configuration-names',
      'health',
      'redacted-logs',
      'screenshots'
    ])
    expect(result.manifest.total_size_bytes).toBe(
      result.manifest.files.reduce((total, file) => total + file.size_bytes, 0)
    )
    expect(result.manifest.missing).toEqual([
      { kind: 'debug-snapshot', reason: 'debug endpoint was not available' }
    ])
    expect(result.manifest.excluded).toEqual([
      { kind: 'replay', name: 'not-requested.json', reason: 'not_requested' }
    ])
    for (const file of result.manifest.files) {
      const bytes = await readFile(join(destination, file.relative_path))
      expect(file.size_bytes).toBe(bytes.byteLength)
      expect(file.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    }
    const health = await readFile(join(destination, 'artifacts/health/health.json'), 'utf8')
    expect(health).not.toContain('never-persist-this')
    expect(health).not.toContain('raw prompt')
    expect(await stat(result.manifest_path)).toMatchObject({ size: result.manifest.manifest_size_bytes })
    expect(await readFile(join(destination, 'artifacts/replay/not-requested.json')).catch(() => null)).toBeNull()
  })

  test('makes every requested but unavailable kind explicit without collecting extra data', async () => {
    const root = await temporaryDirectory()
    const requested = [
      'versions',
      'viewer-traces',
      'replay',
      'eval',
      'content-trace',
      'bun-cpu-profile',
      'bun-heap-profile',
      'crash-metadata'
    ] as DiagnosticsArtifactKind[]
    const result = await createDiagnosticsBundle({ destination: join(root, 'bundle'), requested })

    expect(result.manifest.files).toEqual([])
    expect(result.manifest.missing.map((item) => item.kind)).toEqual(requested)
    expect(result.manifest.excluded).toEqual([])
    expect(await readFile(join(result.destination, 'manifest.json'), 'utf8')).toContain('no viewer trace artifact')
  })

  test('rejects unredacted sources, unsafe names, and oversized artifacts', async () => {
    const root = await temporaryDirectory()
    const source = join(root, 'secret.txt')
    await writeFile(source, 'secret', 'utf8')
    await expect(createDiagnosticsBundle({
      destination: join(root, 'unredacted'),
      requested: ['redacted-logs'],
      files: [{ kind: 'redacted-logs', name: 'log.txt', sourcePath: source, redacted: false as true }]
    })).rejects.toMatchObject({ code: 'unredacted_artifact' })
    await expect(createDiagnosticsBundle({
      destination: join(root, 'unsafe'),
      requested: ['redacted-logs'],
      files: [{ kind: 'redacted-logs', name: '../log.txt', sourcePath: source, redacted: true }]
    })).rejects.toMatchObject({ code: 'invalid_artifact' })
    await expect(createDiagnosticsBundle({
      destination: join(root, 'too-large'),
      maxFileBytes: 2,
      requested: ['redacted-logs'],
      files: [{ kind: 'redacted-logs', name: 'log.txt', sourcePath: source, redacted: true }]
    })).rejects.toMatchObject({ code: 'artifact_too_large' })
  })

  test('creates a bounded version snapshot with names but no credential values', () => {
    expect(createRuntimeVersionSnapshot({
      backendVersion: '0.1.0',
      buildId: 'build-1',
      bunVersion: '1.3.14',
      nodeVersion: 'v24.18.0',
      dependencyVersions: { ai: '7.0.42', '@ai-sdk/openai-compatible': '3.0.17' }
    })).toEqual({
      schema_version: 1,
      backend: { version: '0.1.0', build_id: 'build-1' },
      runtime: { bun: '1.3.14', node: 'v24.18.0', platform: process.platform, arch: process.arch },
      dependencies: { '@ai-sdk/openai-compatible': '3.0.17', ai: '7.0.42' }
    })
  })
})
