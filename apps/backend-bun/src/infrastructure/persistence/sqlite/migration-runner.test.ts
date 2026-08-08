import { afterEach, describe, expect, test } from 'bun:test'
import { Database } from 'bun:sqlite'
import {
  ADVX_MIGRATION_JOURNAL_TABLE,
  SqliteMigrationError,
  calculateMigrationChecksum,
  runSqliteMigrations,
  type SqliteMigration
} from './migration-runner'

const databases: Database[] = []

afterEach(() => {
  for (const database of databases.splice(0)) {
    database.close()
  }
})

describe('runSqliteMigrations', () => {
  test('applies exact plain SQL once and records the immutable ADVX journal', async () => {
    const database = openDatabase()
    const migrations = [
      migration(1, 'create_notes', 'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL);'),
      migration(2, 'index_notes', 'CREATE INDEX notes_body_idx ON notes (body);')
    ]

    const first = await runSqliteMigrations({
      database,
      databasePath: ':memory:',
      migrations,
      appVersion: '0.1.0',
      nowMs: () => 42
    })
    const second = await runSqliteMigrations({
      database,
      databasePath: ':memory:',
      migrations,
      appVersion: '0.1.0'
    })

    expect(first).toEqual({
      applied: ['0001_create_notes', '0002_index_notes'],
      currentVersion: 2,
      backup: null
    })
    expect(second.applied).toEqual([])
    expect(second.currentVersion).toBe(2)
    expect(
      database.query(`SELECT version, name, checksum FROM ${ADVX_MIGRATION_JOURNAL_TABLE} ORDER BY version`).all()
    ).toEqual([
      { version: 1, name: migrations[0]!.name, checksum: migrations[0]!.checksum },
      { version: 2, name: migrations[1]!.name, checksum: migrations[1]!.checksum }
    ])
  })

  test('fails closed when an applied SQL file is changed', async () => {
    const database = openDatabase()
    const original = migration(1, 'create_notes', 'CREATE TABLE notes (id INTEGER PRIMARY KEY);')
    await runSqliteMigrations({
      database,
      databasePath: ':memory:',
      migrations: [original],
      appVersion: '0.1.0'
    })
    const changed = migration(
      1,
      'create_notes',
      'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT);'
    )

    await expect(
      runSqliteMigrations({
        database,
        databasePath: ':memory:',
        migrations: [changed],
        appVersion: '0.1.0'
      })
    ).rejects.toMatchObject({ code: 'journal_mismatch' })
  })

  test('requires and records a verified online backup before destructive SQL', async () => {
    const database = openDatabase()
    const migrations = [
      migration(1, 'create_notes', 'CREATE TABLE notes (id INTEGER PRIMARY KEY);', true)
    ]

    await expect(
      runSqliteMigrations({
        database,
        databasePath: 'synthetic.sqlite3',
        migrations,
        appVersion: '0.1.0'
      })
    ).rejects.toMatchObject({ code: 'backup_required' })
    expect(tableExists(database, 'notes')).toBe(false)
    expect(tableExists(database, ADVX_MIGRATION_JOURNAL_TABLE)).toBe(false)

    const order: string[] = []
    const result = await runSqliteMigrations({
      database,
      databasePath: 'synthetic.sqlite3',
      migrations,
      appVersion: '0.1.0',
      backupAdapter: {
        async createVerifiedBackup(input) {
          order.push(`backup:${input.pendingMigrationNames.join(',')}`)
          expect(tableExists(database, 'notes')).toBe(false)
          return {
            method: 'sqlite-online-backup-api',
            backupPath: 'synthetic.sqlite3.42.bak',
            sha256: 'a'.repeat(64),
            quickCheck: 'ok',
            createdAtMs: 42,
            sourceSchemaVersion: 'advx-journal:0',
            sourceAppVersion: input.appVersion
          }
        }
      }
    })
    order.push('migration-complete')

    expect(order).toEqual(['backup:0001_create_notes', 'migration-complete'])
    expect(result.backup?.method).toBe('sqlite-online-backup-api')
    expect(tableExists(database, 'notes')).toBe(true)
  })

  test('rolls back every pending migration and journal row on SQL failure', async () => {
    const database = openDatabase()
    const migrations = [
      migration(1, 'create_notes', 'CREATE TABLE notes (id INTEGER PRIMARY KEY);'),
      migration(2, 'broken_sql', 'THIS IS NOT SQLITE;')
    ]

    await expect(
      runSqliteMigrations({
        database,
        databasePath: ':memory:',
        migrations,
        appVersion: '0.1.0'
      })
    ).rejects.toBeInstanceOf(SqliteMigrationError)
    expect(tableExists(database, 'notes')).toBe(false)
    expect(tableExists(database, ADVX_MIGRATION_JOURNAL_TABLE)).toBe(false)
  })

  test('rejects runner-owned transaction or journal SQL before touching the database', async () => {
    const database = openDatabase()
    const migrationWithTransaction = migration(
      1,
      'manual_transaction',
      'BEGIN; CREATE TABLE notes (id INTEGER PRIMARY KEY); COMMIT;'
    )

    await expect(
      runSqliteMigrations({
        database,
        databasePath: ':memory:',
        migrations: [migrationWithTransaction],
        appVersion: '0.1.0'
      })
    ).rejects.toMatchObject({ code: 'invalid_manifest' })
    expect(tableExists(database, 'notes')).toBe(false)
  })
})

function openDatabase(): Database {
  const database = new Database(':memory:')
  databases.push(database)
  return database
}

function migration(
  version: number,
  slug: string,
  sql: string,
  destructive = false
): SqliteMigration {
  const name = `${String(version).padStart(4, '0')}_${slug}`
  return {
    version,
    name,
    sql,
    checksum: calculateMigrationChecksum(sql),
    destructive
  }
}

function tableExists(database: Database, name: string): boolean {
  return (
    database.query("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(name) !==
    null
  )
}
