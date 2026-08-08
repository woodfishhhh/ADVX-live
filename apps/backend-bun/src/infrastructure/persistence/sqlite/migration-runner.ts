import { Database } from 'bun:sqlite'

import {
  classifySqliteFault,
  type SqliteFaultStatus
} from './fault-status'

export const ADVX_MIGRATION_JOURNAL_TABLE = 'advx_schema_migrations'

export type SqliteMigration = Readonly<{
  version: number
  name: string
  sql: string
  checksum: string
  destructive: boolean
}>

export type OnlineBackupReceipt = Readonly<{
  method: 'sqlite-online-backup-api'
  backupPath: string
  sha256: string
  quickCheck: 'ok'
  createdAtMs: number
  sourceSchemaVersion: string
  sourceAppVersion: string
}>

export interface SqliteOnlineBackupAdapter {
  createVerifiedBackup(input: Readonly<{
    databasePath: string
    pendingMigrationNames: readonly string[]
    currentVersion: number
    targetVersion: number
    appVersion: string
  }>): Promise<OnlineBackupReceipt>
}

export type SqliteMigrationErrorCode =
  | 'invalid_manifest'
  | 'journal_mismatch'
  | 'future_schema'
  | 'backup_required'
  | 'backup_failed'
  | 'migration_failed'

export class SqliteMigrationError extends Error {
  readonly fault: SqliteFaultStatus

  constructor(
    readonly code: SqliteMigrationErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'SqliteMigrationError'
    this.fault = classifySqliteFault(this, {
      operation: 'migration',
      priorCopyPreserved: true
    })
  }
}

export type SqliteMigrationResult = Readonly<{
  applied: readonly string[]
  currentVersion: number
  backup: OnlineBackupReceipt | null
}>

type MigrationJournalRow = Readonly<{
  version: number
  name: string
  checksum: string
  destructive: number
}>

const migrationNamePattern = /^(\d{4})_[a-z][a-z0-9_]*$/
const sha256Pattern = /^[a-f0-9]{64}$/
const forbiddenSqlPattern = new RegExp(
  `\\b(?:begin|commit|rollback|savepoint|release)\\b|\\b${ADVX_MIGRATION_JOURNAL_TABLE}\\b`,
  'i'
)

export function calculateMigrationChecksum(sql: string): string {
  return new Bun.CryptoHasher('sha256').update(sql).digest('hex')
}

export async function runSqliteMigrations(options: Readonly<{
  database: Database
  databasePath: string
  migrations: readonly SqliteMigration[]
  appVersion: string
  nowMs?: () => number
  backupAdapter?: SqliteOnlineBackupAdapter
}>): Promise<SqliteMigrationResult> {
  const migrations = validateManifest(options.migrations)
  const appliedRows = readJournal(options.database)
  validateJournal(appliedRows, migrations)

  const pending = migrations.slice(appliedRows.length)
  if (pending.length === 0) {
    return {
      applied: [],
      currentVersion: appliedRows.at(-1)?.version ?? 0,
      backup: null
    }
  }

  if (options.appVersion.trim().length === 0) {
    throw new SqliteMigrationError('invalid_manifest', 'application version must not be empty')
  }
  if (options.databasePath.trim().length === 0) {
    throw new SqliteMigrationError('invalid_manifest', 'database path must not be empty')
  }

  const destructive = pending.filter((migration) => migration.destructive)
  const backup =
    destructive.length === 0
      ? null
      : await createRequiredBackup(
          options.backupAdapter,
          options.databasePath,
          pending.map((migration) => migration.name),
          appliedRows.at(-1)?.version ?? 0,
          pending.at(-1)!.version,
          options.appVersion
        )

  const appliedAtMs = options.nowMs?.() ?? Date.now()
  if (!Number.isSafeInteger(appliedAtMs) || appliedAtMs < 0) {
    throw new SqliteMigrationError('invalid_manifest', 'migration timestamp must be a non-negative integer')
  }
  options.database.run('BEGIN IMMEDIATE')
  try {
    createJournal(options.database)
    const insert = options.database.query(
      `INSERT INTO ${ADVX_MIGRATION_JOURNAL_TABLE}
        (version, name, checksum, destructive, applied_at_ms, app_version)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    for (const migration of pending) {
      options.database.exec(migration.sql)
      insert.run(
        migration.version,
        migration.name,
        migration.checksum,
        migration.destructive ? 1 : 0,
        appliedAtMs,
        options.appVersion
      )
    }
    options.database.run('COMMIT')
  } catch (error) {
    try {
      options.database.run('ROLLBACK')
    } catch {
      // Preserve the original migration failure.
    }
    throw new SqliteMigrationError('migration_failed', 'SQLite migration transaction failed', {
      cause: error
    })
  }

  return {
    applied: pending.map((migration) => migration.name),
    currentVersion: pending.at(-1)!.version,
    backup
  }
}

function validateManifest(migrations: readonly SqliteMigration[]): readonly SqliteMigration[] {
  for (const [index, migration] of migrations.entries()) {
    const expectedVersion = index + 1
    const match = migrationNamePattern.exec(migration.name)
    if (
      migration.version !== expectedVersion ||
      !Number.isSafeInteger(migration.version) ||
      match === null ||
      Number(match[1]) !== migration.version
    ) {
      throw new SqliteMigrationError(
        'invalid_manifest',
        `migration ${migration.name} must use the next four-digit version ${String(expectedVersion).padStart(4, '0')}`
      )
    }
    if (migration.sql.trim().length === 0 || forbiddenSqlPattern.test(migration.sql)) {
      throw new SqliteMigrationError(
        'invalid_manifest',
        `migration ${migration.name} contains empty or runner-owned SQL`
      )
    }
    if (
      !sha256Pattern.test(migration.checksum) ||
      calculateMigrationChecksum(migration.sql) !== migration.checksum
    ) {
      throw new SqliteMigrationError(
        'invalid_manifest',
        `migration ${migration.name} checksum does not match its exact SQL bytes`
      )
    }
  }
  return migrations
}

function readJournal(database: Database): readonly MigrationJournalRow[] {
  try {
    const exists = database
      .query("SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get(ADVX_MIGRATION_JOURNAL_TABLE)
    if (exists === null) {
      return []
    }
    return database
      .query(
        `SELECT version, name, checksum, destructive
         FROM ${ADVX_MIGRATION_JOURNAL_TABLE}
         ORDER BY version`
      )
      .all() as MigrationJournalRow[]
  } catch (error) {
    throw new SqliteMigrationError('journal_mismatch', 'migration journal is unreadable', {
      cause: error
    })
  }
}

function validateJournal(
  appliedRows: readonly MigrationJournalRow[],
  migrations: readonly SqliteMigration[]
): void {
  const future = appliedRows.find((row) => row.version > migrations.length)
  if (future !== undefined) {
    throw new SqliteMigrationError(
      'future_schema',
      `database schema version ${future.version} is newer than this application`
    )
  }
  for (const [index, row] of appliedRows.entries()) {
    const migration = migrations[index]
    if (
      migration === undefined ||
      row.version !== migration.version ||
      row.name !== migration.name ||
      row.checksum !== migration.checksum ||
      row.destructive !== (migration.destructive ? 1 : 0)
    ) {
      throw new SqliteMigrationError(
        'journal_mismatch',
        `applied migration ${row.name} is missing or differs from the immutable manifest`
      )
    }
  }
}

async function createRequiredBackup(
  adapter: SqliteOnlineBackupAdapter | undefined,
  databasePath: string,
  pendingMigrationNames: readonly string[],
  currentVersion: number,
  targetVersion: number,
  appVersion: string
): Promise<OnlineBackupReceipt> {
  if (adapter === undefined) {
    throw new SqliteMigrationError(
      'backup_required',
      'destructive migrations require a verified SQLite Online Backup API adapter'
    )
  }
  let receipt: OnlineBackupReceipt
  try {
    receipt = await adapter.createVerifiedBackup({
      databasePath,
      pendingMigrationNames,
      currentVersion,
      targetVersion,
      appVersion
    })
  } catch (error) {
    throw new SqliteMigrationError('backup_failed', 'SQLite online backup failed', { cause: error })
  }
  if (
    receipt.method !== 'sqlite-online-backup-api' ||
    receipt.backupPath.trim().length === 0 ||
    !sha256Pattern.test(receipt.sha256) ||
    receipt.quickCheck !== 'ok' ||
    !Number.isSafeInteger(receipt.createdAtMs) ||
    receipt.createdAtMs < 0 ||
    receipt.sourceSchemaVersion.trim().length === 0 ||
    receipt.sourceAppVersion.trim().length === 0
  ) {
    throw new SqliteMigrationError('backup_failed', 'SQLite online backup receipt is invalid')
  }
  return receipt
}

function createJournal(database: Database): void {
  database.run(`
    CREATE TABLE IF NOT EXISTS ${ADVX_MIGRATION_JOURNAL_TABLE} (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL CHECK (length(checksum) = 64),
      destructive INTEGER NOT NULL CHECK (destructive IN (0, 1)),
      applied_at_ms INTEGER NOT NULL,
      app_version TEXT NOT NULL
    ) STRICT
  `)
}
