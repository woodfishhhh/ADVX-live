import { lstat, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, test } from 'bun:test'

import {
  createBunProfileInvocation,
  runBunProfile,
  BunProfileError
} from './bun-profile-runner'
import { createDiagnosticsBundle } from './diagnostics-bundle'

describe('bounded Bun profiling commands', () => {
  test('builds explicit CPU and heap invocations without broad flags', () => {
    const root = 'C:/advx-profile-output'
    const cpu = createBunProfileInvocation({
      kind: 'cpu',
      outputDirectory: root,
      durationMs: 100,
      profileName: 'cpu-smoke',
      command: ['run', 'src/main.ts']
    })
    const heap = createBunProfileInvocation({
      kind: 'heap',
      outputDirectory: root,
      durationMs: 100,
      profileName: 'heap-smoke',
      command: ['run', 'src/main.ts']
    })
    expect(cpu.args).toContain('--cpu-prof')
    expect(cpu.args.find((argument) => argument.startsWith('--cpu-prof-dir='))).toContain('advx-profile-output')
    expect(heap.args.some((argument) => argument.startsWith('--preload='))).toBe(true)
    expect(heap.args).not.toContain('--heap-prof')
  })

  test('runs CPU and Bun API heap profiles with bounded metadata', async () => {
    const root = await mkdtemp(join(tmpdir(), 'advx-bun-profile-'))
    try {
      const cpu = await runBunProfile({
        kind: 'cpu',
        outputDirectory: root,
        durationMs: 100,
        profileName: 'cpu-smoke',
        command: ['-e', 'for (let i = 0; i < 10000; i += 1) Math.sqrt(i)']
      })
      const heap = await runBunProfile({
        kind: 'heap',
        outputDirectory: root,
        durationMs: 5_000,
        profileName: 'heap-smoke',
        command: ['-e', 'const values = []; for (let i = 0; i < 1000; i += 1) values.push({ i })']
      })
      expect(cpu.exit_code).toBe(0)
      expect(heap.exit_code).toBe(0)
      expect((await lstat(cpu.profile_path)).isFile()).toBe(true)
      expect((await lstat(heap.profile_path)).isFile()).toBe(true)
      expect(JSON.parse(await readFile(cpu.metadata_path, 'utf8')).kind).toBe('cpu')
      expect(JSON.parse(await readFile(heap.profile_path, 'utf8')).version).toBe(3)
      const bundle = await createDiagnosticsBundle({
        destination: join(root, 'bundle'),
        requested: ['bun-cpu-profile', 'bun-heap-profile'],
        files: [
          { kind: 'bun-cpu-profile', name: 'cpu.cpuprofile', sourcePath: cpu.profile_path, redacted: true },
          { kind: 'bun-heap-profile', name: 'heap.heapsnapshot', sourcePath: heap.profile_path, redacted: true }
        ]
      })
      expect(bundle.manifest.files.map((file) => file.kind)).toEqual(['bun-cpu-profile', 'bun-heap-profile'])
      expect(bundle.manifest.files.every((file) => file.sha256.length === 64)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  test('rejects a missing command and unbounded duration', () => {
    expect(() => createBunProfileInvocation({
      kind: 'cpu',
      outputDirectory: 'C:/advx-profile-output',
      durationMs: 100,
      command: []
    })).toThrow(BunProfileError)
    expect(() => createBunProfileInvocation({
      kind: 'heap',
      outputDirectory: 'C:/advx-profile-output',
      durationMs: 0,
      command: ['run', 'src/main.ts']
    })).toThrow(BunProfileError)
  })
})
