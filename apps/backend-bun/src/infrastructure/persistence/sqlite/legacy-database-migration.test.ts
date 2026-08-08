import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  LEGACY_ALEMBIC_HEAD,
  LEGACY_MIGRATION_STRATEGY,
  LegacyDatabaseMigrationError,
  legacyMigrationRunDirectory,
  migrateLegacyDatabase,
  type LegacyBackupRestoreAdapter
} from './legacy-database-migration'
import { PythonSqliteOnlineBackupAdapter } from './python-online-backup-adapter'

const cleanups: (() => void | Promise<void>)[] = []
const repositoryRoot = resolve(import.meta.dir, '../../../../../..')
const backupScript = resolve(
  repositoryRoot,
  'apps/backend/scripts/sqlite_online_backup.py'
)
const fixtureScript = resolve(
  repositoryRoot,
  'apps/backend-bun/src/infrastructure/persistence/sqlite/legacy-database-fixture.py'
)
const pythonCommand = [
  'uv',
  'run',
  '--project',
  resolve(repositoryRoot, 'apps/backend'),
  'python'
] as const

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe('DAT-010 legacy Python database migration and rollback', () => {
  test('backs up a live Python owner, migrates a closed copy, starts Bun, and restores', async () => {
    const root = temporaryRoot()
    const sourceDirectory = join(root, 'source')
    mkdirSync(sourceDirectory)
    const fixture = await startLegacyFixture(sourceDirectory)
    cleanups.push(fixture.cleanup)
    expect(existsSync(`${fixture.databasePath}-wal`)).toBe(true)
    const workspace = join(root, 'migration-workspace')
    mkdirSync(workspace)
    const runId = 'dat-010-e2e'
    const runDirectory = legacyMigrationRunDirectory(workspace, runId)
    const adapter = backupAdapter(join(runDirectory, 'backups'))
    let stopCalls = 0

    const receipt = await migrateLegacyDatabase({
      runId,
      sourceDatabasePath: fixture.databasePath,
      workspaceDirectory: workspace,
      sourceAppVersion: 'python-legacy',
      targetAppVersion: 'bun-migration-test',
      backupAdapter: adapter,
      stopBackends: async () => {
        stopCalls += 1
        await fixture.stop()
        return {
          pythonStopped: true,
          bunStopped: true,
          stoppedAtMs: 100
        }
      },
      nowMs: () => 100
    })

    expect(stopCalls).toBe(1)
    expect(receipt.strategy).toBe(LEGACY_MIGRATION_STRATEGY)
    expect(receipt.sourceSchemaVersion).toBe(LEGACY_ALEMBIC_HEAD)
    expect(receipt.backup.method).toBe('sqlite-online-backup-api')
    expect(receipt.backup.quickCheck).toBe('ok')
    expect(receipt.backup.sha256).toHaveLength(64)
    expect(existsSync(`${receipt.backup.backupPath}-wal`)).toBe(false)
    expect(existsSync(`${receipt.backup.backupPath}-shm`)).toBe(false)
    expect(receipt.appliedMigrations).toEqual(['0006_durable_outbox'])
    expect(receipt.targetMigrationVersion).toBe(6)
    expect(receipt.preservedTables.length).toBeGreaterThanOrEqual(20)
    expect(
      receipt.preservedTables.find((table) => table.table === 'rooms')
    ).toMatchObject({ rowCount: 1 })
    expect(
      receipt.preservedTables.find((table) => table.table === 'room_events')
    ).toMatchObject({ rowCount: 1 })
    expect(
      receipt.preservedTables.find((table) => table.table === 'audience_profiles')
    ).toMatchObject({ rowCount: 1 })
    expect(receipt.smokeMarkerWorkId).toBe('legacy-migration:dat-010-e2e')
    expect(receipt.originalSourceUnchangedAfterStop).toBe(true)
    expect(receipt.copiedLiveMainOrSidecars).toBe(false)
    expect(receipt.bunOwnedOnlineBackupAvailable).toBe(false)
    expect(receipt.destructiveBunMigrationsAllowed).toBe(false)

    const working = new Database(receipt.workingDatabasePath, {
      readonly: true,
      strict: true
    })
    try {
      expect(
        (
          working
            .query('SELECT COUNT(*) AS count FROM advx_schema_migrations')
            .get() as { count: number }
        ).count
      ).toBe(6)
      expect(
        (
          working
            .query('SELECT COUNT(*) AS count FROM durable_outbox')
            .get() as { count: number }
        ).count
      ).toBe(1)
      expect(
        working
          .query('SELECT content_json FROM room_events WHERE event_id = ?')
          .get('event-legacy')
      ).toEqual({ content_json: '{"text":"legacy hello"}' })
    } finally {
      working.close()
    }

    const rollback = new Database(receipt.rollbackDatabasePath, {
      readonly: true,
      strict: true
    })
    try {
      expect(tableExists(rollback, 'advx_schema_migrations')).toBe(false)
      expect(tableExists(rollback, 'durable_outbox')).toBe(false)
      expect(
        rollback
          .query('SELECT display_name FROM rooms WHERE room_id = ?')
          .get('room-legacy')
      ).toEqual({ display_name: 'Legacy Room' })
      expect(
        rollback
          .query('SELECT display_name FROM audience_profiles WHERE audience_id = ?')
          .get('audience-legacy')
      ).toEqual({ display_name: 'Legacy Viewer' })
    } finally {
      rollback.close()
    }

    const source = new Database(fixture.databasePath, {
      readonly: true,
      strict: true
    })
    try {
      expect(tableExists(source, 'advx_schema_migrations')).toBe(false)
      expect(tableExists(source, 'durable_outbox')).toBe(false)
    } finally {
      source.close()
    }
  }, 120_000)

  test('fails closed when the source changes after backup but before stop', async () => {
    const root = temporaryRoot()
    const sourceDirectory = join(root, 'source')
    mkdirSync(sourceDirectory)
    const fixture = await startLegacyFixture(sourceDirectory)
    cleanups.push(fixture.cleanup)
    const workspace = join(root, 'migration-workspace')
    mkdirSync(workspace)
    const runId = 'dat-010-write-window'
    const runDirectory = legacyMigrationRunDirectory(workspace, runId)
    const delegate = backupAdapter(join(runDirectory, 'backups'))
    const adapter: LegacyBackupRestoreAdapter = {
      createVerifiedBackup: async (input) => {
        const receipt = await delegate.createVerifiedBackup(input)
        const source = new Database(fixture.databasePath, {
          readwrite: true,
          strict: true
        })
        try {
          source.run('PRAGMA busy_timeout = 5000')
          source.run(`
            INSERT INTO rooms (
              room_id, display_name, state, revision, created_at_ms, updated_at_ms
            ) VALUES (
              'room-after-backup', 'Written after backup', 'active', 0, 4, 4
            )
          `)
        } finally {
          source.close()
        }
        return receipt
      },
      restoreVerifiedBackup: async (input) =>
        await delegate.restoreVerifiedBackup(input)
    }
    let stopCalls = 0

    await expectMigrationCode(
      migrateLegacyDatabase({
        runId,
        sourceDatabasePath: fixture.databasePath,
        workspaceDirectory: workspace,
        sourceAppVersion: 'python-legacy',
        targetAppVersion: 'bun-migration-test',
        backupAdapter: adapter,
        stopBackends: async () => {
          stopCalls += 1
          await fixture.stop()
          return {
            pythonStopped: true,
            bunStopped: true,
            stoppedAtMs: 100
          }
        },
        nowMs: () => 100
      }),
      'comparison_failed'
    )

    expect(stopCalls).toBe(1)
    expect(existsSync(join(runDirectory, 'working', 'advx.sqlite3'))).toBe(false)
    const source = new Database(fixture.databasePath, {
      readonly: true,
      strict: true
    })
    try {
      expect(
        source
          .query('SELECT display_name FROM rooms WHERE room_id = ?')
          .get('room-after-backup')
      ).toEqual({ display_name: 'Written after backup' })
      expect(tableExists(source, 'advx_schema_migrations')).toBe(false)
      expect(tableExists(source, 'durable_outbox')).toBe(false)
    } finally {
      source.close()
    }
  }, 120_000)

  test('rejects an incomplete legacy schema before baseline adoption', async () => {
    const root = temporaryRoot()
    const sourceDirectory = join(root, 'source')
    const workspace = join(root, 'migration-workspace')
    mkdirSync(sourceDirectory)
    mkdirSync(workspace)
    const sourcePath = join(sourceDirectory, 'advx.sqlite3')
    const source = new Database(sourcePath, {
      create: true,
      readwrite: true,
      strict: true
    })
    source.exec(
      `CREATE TABLE alembic_version (version_num TEXT NOT NULL PRIMARY KEY);
       INSERT INTO alembic_version (version_num) VALUES ('0006_viewer_lifecycle');
       CREATE TABLE rooms (room_id TEXT NOT NULL PRIMARY KEY);`
    )
    source.close()
    const before = readFileSync(sourcePath)
    const runId = 'dat-010-incompatible'
    const runDirectory = legacyMigrationRunDirectory(workspace, runId)

    await expectMigrationCode(
      migrateLegacyDatabase({
        runId,
        sourceDatabasePath: sourcePath,
        workspaceDirectory: workspace,
        sourceAppVersion: 'python-legacy',
        targetAppVersion: 'bun-migration-test',
        backupAdapter: backupAdapter(join(runDirectory, 'backups')),
        stopBackends: async () => ({
          pythonStopped: true,
          bunStopped: true,
          stoppedAtMs: 100
        }),
        nowMs: () => 100
      }),
      'unsupported_legacy_schema'
    )
    expect(readFileSync(sourcePath)).toEqual(before)
    const sourceAfter = new Database(sourcePath, { readonly: true, strict: true })
    try {
      expect(tableExists(sourceAfter, 'advx_schema_migrations')).toBe(false)
      expect(tableExists(sourceAfter, 'durable_outbox')).toBe(false)
    } finally {
      sourceAfter.close()
    }
  }, 120_000)
})

function backupAdapter(backupDirectory: string) {
  return new PythonSqliteOnlineBackupAdapter({
    command: pythonCommand,
    scriptPath: backupScript,
    backupDirectory,
    sourceAppVersion: 'python-legacy',
    timeoutMs: 60_000,
    nowMs: () => 100
  })
}

async function startLegacyFixture(dataDirectory: string) {
  const process = Bun.spawn(
    [
      ...pythonCommand,
      fixtureScript,
      '--data-directory',
      dataDirectory
    ],
    {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      windowsHide: true
    }
  )
  const reader = process.stdout.getReader()
  const stderrPromise = new Response(process.stderr).text()
  let line: string
  try {
    line = await readLine(reader, 60_000)
  } catch (cause) {
    await process.exited
    throw new Error(`legacy fixture did not start: ${await stderrPromise}`, {
      cause
    })
  }
  let ready: unknown
  try {
    ready = JSON.parse(line)
  } catch {
    const stderr = await stderrPromise
    process.kill()
    throw new Error(`legacy fixture did not start: ${stderr}`)
  }
  if (
    typeof ready !== 'object' ||
    ready === null ||
    (ready as Record<string, unknown>).status !== 'ready' ||
    typeof (ready as Record<string, unknown>).databasePath !== 'string'
  ) {
    process.kill()
    throw new Error('legacy fixture returned an invalid ready record')
  }
  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    process.stdin.write('stop\n')
    process.stdin.end()
    const exitCode = await process.exited
    await reader.cancel()
    if (exitCode !== 0) {
      const stderr = await stderrPromise
      throw new Error(`legacy fixture exited with ${exitCode}: ${stderr}`)
    }
  }
  return {
    databasePath: (ready as { databasePath: string }).databasePath,
    stop,
    cleanup: stop
  }
}

async function readLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  const decoder = new TextDecoder()
  let value = ''
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('legacy fixture ready timeout'))
    }, timeoutMs)
  })
  try {
    return await Promise.race([
      (async () => {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) throw new Error('legacy fixture exited before ready')
          value += decoder.decode(chunk.value, { stream: true })
          const newline = value.indexOf('\n')
          if (newline >= 0) return value.slice(0, newline)
        }
      })(),
      timeout
    ])
  } finally {
    clearTimeout(timer!)
  }
}

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'advx-dat-010-'))
  cleanups.push(() => {
    Bun.gc(true)
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 100
    })
  })
  return root
}

function tableExists(database: Database, table: string): boolean {
  return (
    database
      .query("SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get(table) !== null
  )
}

async function expectMigrationCode(
  promise: Promise<unknown>,
  code: LegacyDatabaseMigrationError['code']
): Promise<void> {
  try {
    await promise
    throw new Error(`expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(LegacyDatabaseMigrationError)
    if ((error as LegacyDatabaseMigrationError).code !== code) throw error
  }
}
