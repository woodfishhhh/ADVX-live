import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import {
  ADVX_SQLITE_DATABASE_FILENAME,
  AdvxSqliteDatabase
} from './database'
import {
  runWithSqliteFaultStatus,
  sqliteCrashRecoveryStatus,
  type SqliteFaultKind,
  type SqliteFaultResult,
  type SqliteFaultStatus
} from './fault-status'
import {
  ADVX_MIGRATION_JOURNAL_TABLE,
  calculateMigrationChecksum,
  runSqliteMigrations,
  type SqliteMigration
} from './migration-runner'
import { SqliteTransactionBoundary } from './transaction'

const cleanups: (() => void)[] = []
const crashFixture = resolve(import.meta.dir, 'persistence-crash-fixture.ts')

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

describe('DAT-011 persistence fault matrix', () => {
  test('classifies real locks, busy timeouts, read-only storage, and full writes', async () => {
    const root = temporaryRoot()
    const databasePath = join(root, 'contention.sqlite3')
    const owner = new Database(databasePath, { create: true, readwrite: true })
    owner.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE fault_probe (id INTEGER PRIMARY KEY, value BLOB NOT NULL);
      INSERT INTO fault_probe (value) VALUES ('preserved');
      BEGIN EXCLUSIVE;
    `)
    const contender = new Database(databasePath, { readwrite: true, strict: true })
    try {
      contender.run('PRAGMA busy_timeout = 0')
      const locked = await runWithSqliteFaultStatus(
        { operation: 'lock_acquire', priorCopyPreserved: true },
        () => contender.run("INSERT INTO fault_probe (value) VALUES ('locked')")
      )
      expectFault(locked, 'locked', 'retryable')

      contender.run('PRAGMA busy_timeout = 5')
      const timedOut = await runWithSqliteFaultStatus(
        { operation: 'busy_timeout', priorCopyPreserved: true },
        () => contender.run("INSERT INTO fault_probe (value) VALUES ('timed-out')")
      )
      expectFault(timedOut, 'busy_timeout', 'retryable')
    } finally {
      contender.close()
      owner.run('ROLLBACK')
      owner.close()
    }

    const readonly = new Database(databasePath, { readonly: true, strict: true })
    try {
      const readOnlyWrite = await runWithSqliteFaultStatus(
        { operation: 'write', priorCopyPreserved: true },
        () => readonly.run("INSERT INTO fault_probe (value) VALUES ('readonly')")
      )
      expectFault(readOnlyWrite, 'read_only', 'failed_closed')
    } finally {
      readonly.close()
    }

    const readOnlyDirectory = await runWithSqliteFaultStatus(
      { operation: 'startup', priorCopyPreserved: true },
      () => {
        throw Object.assign(new Error('read-only directory'), { code: 'EACCES' })
      }
    )
    expectFault(readOnlyDirectory, 'read_only', 'failed_closed')

    const fullPath = join(root, 'full.sqlite3')
    const full = new Database(fullPath, { create: true, readwrite: true })
    try {
      full.exec(`
        PRAGMA journal_mode = DELETE;
        CREATE TABLE full_probe (id INTEGER PRIMARY KEY, value BLOB NOT NULL);
        INSERT INTO full_probe (value) VALUES ('preserved');
      `)
      const pageCount = firstNumber(full.query('PRAGMA page_count').get())
      full.run(`PRAGMA max_page_count = ${pageCount}`)
      const writeFailed = await runWithSqliteFaultStatus(
        { operation: 'write', priorCopyPreserved: true },
        () =>
          full
            .query('INSERT INTO full_probe (value) VALUES (?)')
            .run(new Uint8Array(1024 * 1024))
      )
      expectFault(writeFailed, 'write_failed', 'failed_closed')
      expect(
        firstNumber(full.query('SELECT COUNT(*) AS count FROM full_probe').get())
      ).toBe(1)
    } finally {
      full.close()
    }

    const preserved = new Database(databasePath, { readonly: true, strict: true })
    try {
      expect(
        firstNumber(
          preserved.query('SELECT COUNT(*) AS count FROM fault_probe').get()
        )
      ).toBe(1)
    } finally {
      preserved.close()
    }
  })

  test('fails closed for a corrupt copy, missing target, and orphan sidecar', async () => {
    const root = temporaryRoot()
    const healthyDirectory = join(root, 'healthy')
    const corruptDirectory = join(root, 'corrupt-copy')
    mkdirSync(healthyDirectory)
    mkdirSync(corruptDirectory)
    const healthyPath = join(healthyDirectory, ADVX_SQLITE_DATABASE_FILENAME)
    const healthy = new Database(healthyPath, { create: true, readwrite: true })
    healthy.exec(
      "CREATE TABLE preserved (value TEXT NOT NULL); INSERT INTO preserved VALUES ('ok')"
    )
    healthy.close()

    const corruptPath = join(corruptDirectory, ADVX_SQLITE_DATABASE_FILENAME)
    copyFileSync(healthyPath, corruptPath)
    writeFileSync(corruptPath, 'not a sqlite database')
    const corrupt = new AdvxSqliteDatabase({
      dataDirectory: corruptDirectory,
      openMode: 'existing-only'
    })
    const corruptStatus = await runWithSqliteFaultStatus(
      { operation: 'open_existing', priorCopyPreserved: true },
      () => corrupt.initialize()
    )
    expectFault(corruptStatus, 'corrupted', 'failed_closed')
    expect(corrupt.health()).toMatchObject({ status: 'failed', ready: false })

    const source = new Database(healthyPath, { readonly: true, strict: true })
    try {
      expect(source.query('SELECT value FROM preserved').get()).toEqual({ value: 'ok' })
    } finally {
      source.close()
    }

    const missingDirectory = join(root, 'wrong-recovery-directory')
    const missing = new AdvxSqliteDatabase({
      dataDirectory: missingDirectory,
      openMode: 'existing-only'
    })
    const missingStatus = await runWithSqliteFaultStatus(
      { operation: 'open_existing', priorCopyPreserved: true },
      () => missing.initialize()
    )
    expectFault(missingStatus, 'missing_database', 'failed_closed')
    expect(existsSync(missingDirectory)).toBe(false)

    const sidecarDirectory = join(root, 'orphan-sidecar')
    mkdirSync(sidecarDirectory)
    const sidecarMain = join(sidecarDirectory, ADVX_SQLITE_DATABASE_FILENAME)
    writeFileSync(`${sidecarMain}-wal`, 'orphan')
    const sidecar = new AdvxSqliteDatabase({
      dataDirectory: sidecarDirectory,
      openMode: 'existing-only'
    })
    const sidecarStatus = await runWithSqliteFaultStatus(
      { operation: 'open_existing', priorCopyPreserved: true },
      () => sidecar.initialize()
    )
    expectFault(sidecarStatus, 'sidecar_mismatch', 'failed_closed')
    expect(existsSync(sidecarMain)).toBe(false)
  })

  test('rejects future schemas and rolls back interrupted migrations', async () => {
    const future = new Database(':memory:', { strict: true })
    try {
      createMigrationJournal(future)
      future.query(
        `INSERT INTO ${ADVX_MIGRATION_JOURNAL_TABLE}
          (version, name, checksum, destructive, applied_at_ms, app_version)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(99, '0099_future', 'f'.repeat(64), 0, 1, 'future')
      const futureStatus = await runWithSqliteFaultStatus(
        { operation: 'migration', priorCopyPreserved: true },
        () =>
          runSqliteMigrations({
            database: future,
            databasePath: 'memory',
            migrations: [migration(1, '0001_current', 'CREATE TABLE current (id INTEGER)')],
            appVersion: 'current'
          })
      )
      expectFault(futureStatus, 'future_schema', 'failed_closed')
    } finally {
      future.close()
    }

    const root = temporaryRoot()
    const interruptedPath = join(root, 'interrupted.sqlite3')
    let interrupted = new Database(interruptedPath, {
      create: true,
      readwrite: true,
      strict: true
    })
    interrupted.exec(
      "CREATE TABLE preserved (value TEXT NOT NULL); INSERT INTO preserved VALUES ('before')"
    )
    const brokenSql = `
      CREATE TABLE partial (value TEXT NOT NULL);
      INSERT INTO partial VALUES ('not committed');
      THIS IS NOT SQL;
    `
    const interruptedStatus = await runWithSqliteFaultStatus(
      { operation: 'migration', priorCopyPreserved: true },
      () =>
        runSqliteMigrations({
          database: interrupted,
          databasePath: interruptedPath,
          migrations: [migration(1, '0001_interrupted', brokenSql)],
          appVersion: 'fault-test'
        })
    )
    expectFault(interruptedStatus, 'interrupted_migration', 'rolled_back')
    expect(tableExists(interrupted, 'partial')).toBe(false)
    expect(tableExists(interrupted, ADVX_MIGRATION_JOURNAL_TABLE)).toBe(false)
    interrupted.close()

    interrupted = new Database(interruptedPath, { readonly: true, strict: true })
    try {
      expect(interrupted.query('SELECT value FROM preserved').get()).toEqual({
        value: 'before'
      })
    } finally {
      interrupted.close()
    }
  })

  test('rolls back transaction exceptions without dropping the prior state', async () => {
    const root = temporaryRoot()
    const owner = new AdvxSqliteDatabase({ dataDirectory: root })
    owner.initialize()
    try {
      owner.withWriteConnection((database) =>
        database.exec(
          "CREATE TABLE transaction_probe (value TEXT NOT NULL); INSERT INTO transaction_probe VALUES ('before')"
        )
      )
      const transactions = new SqliteTransactionBoundary(owner)
      const status = await runWithSqliteFaultStatus(
        { operation: 'transaction', priorCopyPreserved: true },
        () =>
          transactions.run(async (transaction) => {
            transactions
              .connection(transaction)
              .run("INSERT INTO transaction_probe VALUES ('not committed')")
            throw new Error('injected transaction exception')
          })
      )
      expectFault(status, 'transaction_exception', 'rolled_back')
      expect(
        owner.withReadConnection((database) =>
          firstNumber(
            database.query('SELECT COUNT(*) AS count FROM transaction_probe').get()
          )
        )
      ).toBe(1)
    } finally {
      owner.close()
    }
  })

  test('recovers crash-before-commit and retains crash-after-commit exactly once', async () => {
    const root = temporaryRoot()
    const databasePath = join(root, 'crash.sqlite3')
    const database = new Database(databasePath, {
      create: true,
      readwrite: true,
      strict: true
    })
    database.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE crash_probe (
        id INTEGER PRIMARY KEY,
        phase TEXT NOT NULL UNIQUE
      );
    `)
    database.close()

    expect(await runCrash(databasePath, 'before-commit')).toBe(31)
    expect(crashRowCount(databasePath, 'before-commit')).toBe(0)
    const before = sqliteCrashRecoveryStatus({
      commitAttempted: false,
      durableRowPresent: false,
      priorCopyPreserved: true
    })
    expect(before).toMatchObject({
      kind: 'crash_before_commit',
      disposition: 'rolled_back',
      safe: true,
      commitState: 'rolled_back'
    })

    expect(await runCrash(databasePath, 'after-commit')).toBe(32)
    expect(crashRowCount(databasePath, 'after-commit')).toBe(1)
    const after = sqliteCrashRecoveryStatus({
      commitAttempted: true,
      durableRowPresent: true,
      priorCopyPreserved: true
    })
    expect(after).toMatchObject({
      kind: 'crash_after_commit',
      disposition: 'committed',
      safe: true,
      commitState: 'committed'
    })
    const reopened = new Database(databasePath, { readonly: true, strict: true })
    try {
      expect(firstValue(reopened.query('PRAGMA quick_check').get())).toBe('ok')
      expect(
        firstNumber(reopened.query('SELECT COUNT(*) AS count FROM crash_probe').get())
      ).toBe(1)
    } finally {
      reopened.close()
    }
  }, 30_000)
})

function expectFault<T>(
  result: SqliteFaultResult<T>,
  kind: SqliteFaultKind,
  disposition: SqliteFaultStatus['disposition']
): SqliteFaultStatus {
  expect(result.ok).toBe(false)
  if (result.ok) throw new Error(`expected ${kind}`)
  expect(result.fault).toMatchObject({
    kind,
    disposition,
    safe: true,
    priorCopyPreserved: true
  })
  return result.fault
}

function migration(version: number, name: string, sql: string): SqliteMigration {
  return Object.freeze({
    version,
    name,
    sql,
    checksum: calculateMigrationChecksum(sql),
    destructive: false
  })
}

function createMigrationJournal(database: Database): void {
  database.run(`
    CREATE TABLE ${ADVX_MIGRATION_JOURNAL_TABLE} (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      destructive INTEGER NOT NULL,
      applied_at_ms INTEGER NOT NULL,
      app_version TEXT NOT NULL
    ) STRICT
  `)
}

function tableExists(database: Database, table: string): boolean {
  return (
    database
      .query("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get(table) !== null
  )
}

function firstNumber(row: unknown): number {
  const value = firstValue(row)
  if (typeof value !== 'number') throw new Error('expected numeric SQLite value')
  return value
}

function firstValue(row: unknown): unknown {
  if (typeof row !== 'object' || row === null) {
    throw new Error('expected SQLite row')
  }
  return Object.values(row)[0]
}

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'advx-dat-011-'))
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

async function runCrash(
  databasePath: string,
  phase: 'before-commit' | 'after-commit'
): Promise<number> {
  const subprocess = Bun.spawn([process.execPath, crashFixture, databasePath, phase], {
    stdin: 'ignore',
    stdout: 'ignore',
    stderr: 'pipe',
    windowsHide: true
  })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    subprocess.kill()
  }, 10_000)
  const [exitCode, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stderr).text()
  ])
  clearTimeout(timeout)
  if (timedOut) throw new Error(`${phase} fixture timed out`)
  if (stderr.trim().length > 0) throw new Error(`${phase} fixture failed: ${stderr}`)
  return exitCode
}

function crashRowCount(databasePath: string, phase: string): number {
  const database = new Database(databasePath, { readonly: true, strict: true })
  try {
    return firstNumber(
      database
        .query('SELECT COUNT(*) AS count FROM crash_probe WHERE phase = ?')
        .get(phase)
    )
  } finally {
    database.close()
  }
}
