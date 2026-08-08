import { Database } from 'bun:sqlite'
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  statSync
} from 'node:fs'
import {
  isAbsolute,
  join,
  relative,
  resolve
} from 'node:path'

import { wallClockTimestampMs } from '../../../application/ports/time'
import { AdvxSqliteDatabase } from './database'
import {
  ADVX_MIGRATION_JOURNAL_TABLE,
  runSqliteMigrations,
  type OnlineBackupReceipt,
  type SqliteMigration,
  type SqliteOnlineBackupAdapter
} from './migration-runner'
import { ADVX_SQLITE_MIGRATIONS } from './migrations'
import { createSqliteRepositories } from './repositories'
import { SqliteTransactionBoundary } from './transaction'

export const LEGACY_ALEMBIC_HEAD = '0006_viewer_lifecycle'
export const LEGACY_MIGRATION_BASELINE_VERSION = 5
export const LEGACY_MIGRATION_STRATEGY = 'copy-and-swap'

export type LegacyDatabaseMigrationErrorCode =
  | 'invalid_input'
  | 'backup_failed'
  | 'stop_failed'
  | 'unsupported_legacy_schema'
  | 'working_copy_failed'
  | 'comparison_failed'
  | 'smoke_failed'
  | 'rollback_failed'

export class LegacyDatabaseMigrationError extends Error {
  constructor(
    readonly code: LegacyDatabaseMigrationErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'LegacyDatabaseMigrationError'
  }
}

export type BackendStopReceipt = Readonly<{
  pythonStopped: boolean
  bunStopped: boolean
  stoppedAtMs: number
}>

export interface LegacyBackupRestoreAdapter extends SqliteOnlineBackupAdapter {
  restoreVerifiedBackup(input: Readonly<{
    backupPath: string
    backupSha256: string
    destinationPath: string
  }>): Promise<OnlineBackupReceipt & Readonly<{ restoredPath: string }>>
}

export type LegacyTableComparison = Readonly<{
  table: string
  rowCount: number
  semanticSha256: string
}>

export type LegacyDatabaseMigrationReceipt = Readonly<{
  schemaVersion: 1
  runId: string
  strategy: typeof LEGACY_MIGRATION_STRATEGY
  sourceDatabasePath: string
  sourceClosedSha256: string
  sourceSchemaVersion: typeof LEGACY_ALEMBIC_HEAD
  sourceAppVersion: string
  backup: OnlineBackupReceipt
  workingDataDirectory: string
  workingDatabasePath: string
  workingDatabaseSha256: string
  targetMigrationVersion: number
  appliedMigrations: readonly string[]
  preservedTables: readonly LegacyTableComparison[]
  smokeMarkerWorkId: string
  rollbackDatabasePath: string
  rollbackDatabaseSha256: string
  rollbackTables: readonly LegacyTableComparison[]
  originalSourceUnchangedAfterStop: true
  copiedLiveMainOrSidecars: false
  bunOwnedOnlineBackupAvailable: false
  destructiveBunMigrationsAllowed: false
  completedAtMs: number
}>

export type LegacyDatabaseMigrationOptions = Readonly<{
  runId: string
  sourceDatabasePath: string
  workspaceDirectory: string
  sourceAppVersion: string
  targetAppVersion: string
  backupAdapter: LegacyBackupRestoreAdapter
  stopBackends(): Promise<BackendStopReceipt>
  migrations?: readonly SqliteMigration[]
  nowMs?: () => number
}>

type DatabaseSnapshot = Readonly<{
  schemaVersion: string
  tables: Readonly<Record<string, LegacyTableComparison>>
}>

type ColumnInfo = Readonly<{
  name: string
  type: string
  notnull: number
  dflt_value: string | number | null
  pk: number
}>

type ForeignKeyInfo = Readonly<{
  table: string
  from: string
  to: string
  on_update: string
  on_delete: string
  match: string
}>

type IndexInfo = Readonly<{
  name: string
  unique: number
  origin: string
  partial: number
}>

const RUN_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/

export function legacyMigrationRunDirectory(
  workspaceDirectory: string,
  runId: string
): string {
  if (!isAbsolute(workspaceDirectory) || !RUN_ID_PATTERN.test(runId)) {
    throw invalidInput()
  }
  return resolve(workspaceDirectory, runId)
}

export async function migrateLegacyDatabase(
  options: LegacyDatabaseMigrationOptions
): Promise<LegacyDatabaseMigrationReceipt> {
  const sourceDatabasePath = existingFile(options.sourceDatabasePath)
  if (
    !isAbsolute(options.workspaceDirectory) ||
    options.sourceAppVersion.trim().length === 0 ||
    options.targetAppVersion.trim().length === 0
  ) {
    throw invalidInput()
  }
  const migrations = options.migrations ?? ADVX_SQLITE_MIGRATIONS
  if (
    migrations.length <= LEGACY_MIGRATION_BASELINE_VERSION ||
    migrations.at(-1)?.version !== migrations.length
  ) {
    throw invalidInput()
  }
  const nowMs = options.nowMs ?? Date.now
  const runDirectory = legacyMigrationRunDirectory(
    options.workspaceDirectory,
    options.runId
  )
  if (
    sourceDatabasePath === runDirectory ||
    within(runDirectory, sourceDatabasePath) ||
    existsSync(runDirectory)
  ) {
    throw invalidInput()
  }
  mkdirSync(runDirectory, { recursive: true, mode: 0o700 })

  let backup: OnlineBackupReceipt
  try {
    backup = await options.backupAdapter.createVerifiedBackup({
      databasePath: sourceDatabasePath,
      pendingMigrationNames: migrations.map((migration) => migration.name),
      currentVersion: 0,
      targetVersion: migrations.length,
      appVersion: options.targetAppVersion
    })
  } catch (cause) {
    throw new LegacyDatabaseMigrationError(
      'backup_failed',
      'legacy SQLite Online Backup API step failed',
      { cause }
    )
  }
  const backupPath = existingFile(backup.backupPath)
  if (
    !within(runDirectory, backupPath) ||
    backup.sourceSchemaVersion !== LEGACY_ALEMBIC_HEAD ||
    backup.sourceAppVersion !== options.sourceAppVersion ||
    backup.quickCheck !== 'ok' ||
    (await sha256File(backupPath)) !== backup.sha256 ||
    hasSidecars(backupPath)
  ) {
    throw new LegacyDatabaseMigrationError(
      'backup_failed',
      'legacy SQLite Online Backup API receipt does not match the closed artifact'
    )
  }

  let stopped: BackendStopReceipt
  try {
    stopped = await options.stopBackends()
  } catch (cause) {
    throw new LegacyDatabaseMigrationError(
      'stop_failed',
      'both backends must stop after online backup and before migration',
      { cause }
    )
  }
  if (
    stopped.pythonStopped !== true ||
    stopped.bunStopped !== true ||
    !validTimestamp(stopped.stoppedAtMs)
  ) {
    throw new LegacyDatabaseMigrationError(
      'stop_failed',
      'both backends must report a valid stopped state'
    )
  }
  const sourceClosedSha256 = await sha256File(sourceDatabasePath)
  const backupSnapshot = inspectDatabase(backupPath)
  try {
    const sourceClosedSnapshot = inspectDatabase(sourceDatabasePath)
    compareSnapshots(backupSnapshot, sourceClosedSnapshot)
  } catch (cause) {
    throw new LegacyDatabaseMigrationError(
      'comparison_failed',
      'legacy source changed between online backup and backend stop',
      { cause }
    )
  }

  const workingDataDirectory = join(runDirectory, 'working')
  const workingDatabasePath = join(workingDataDirectory, 'advx.sqlite3')
  mkdirSync(workingDataDirectory, { mode: 0o700 })
  copyFileSync(backupPath, workingDatabasePath, constants.COPYFILE_EXCL)
  if ((await sha256File(workingDatabasePath)) !== backup.sha256) {
    throw new LegacyDatabaseMigrationError(
      'working_copy_failed',
      'isolated working copy differs from the closed backup artifact'
    )
  }

  const referenceDirectory = join(runDirectory, 'reference')
  mkdirSync(referenceDirectory, { mode: 0o700 })
  await validateAndMigrateWorkingCopy({
    workingDatabasePath,
    referenceDatabasePath: join(referenceDirectory, 'advx.sqlite3'),
    migrations,
    targetAppVersion: options.targetAppVersion,
    nowMs
  })
  const migratedSnapshot = inspectDatabase(workingDatabasePath)
  const preservedTables = compareSnapshots(backupSnapshot, migratedSnapshot)

  const smokeMarkerWorkId = await runBunReadWriteRestartSmoke({
    runId: options.runId,
    workingDataDirectory,
    backup,
    nowMs
  })
  const smokedSnapshot = inspectDatabase(workingDatabasePath)
  compareSnapshots(backupSnapshot, smokedSnapshot)

  const rollbackDatabasePath = join(
    runDirectory,
    'rollback-rehearsal',
    'advx.sqlite3'
  )
  let restore: OnlineBackupReceipt & Readonly<{ restoredPath: string }>
  try {
    restore = await options.backupAdapter.restoreVerifiedBackup({
      backupPath,
      backupSha256: backup.sha256,
      destinationPath: rollbackDatabasePath
    })
  } catch (cause) {
    throw new LegacyDatabaseMigrationError(
      'rollback_failed',
      'restore rehearsal from the untouched online backup artifact failed',
      { cause }
    )
  }
  if (
    resolve(restore.restoredPath) !== resolve(rollbackDatabasePath) ||
    restore.sourceSchemaVersion !== LEGACY_ALEMBIC_HEAD ||
    hasSidecars(rollbackDatabasePath)
  ) {
    throw new LegacyDatabaseMigrationError(
      'rollback_failed',
      'restored database receipt is invalid'
    )
  }
  const rollbackSnapshot = inspectDatabase(rollbackDatabasePath)
  const rollbackTables = compareSnapshots(backupSnapshot, rollbackSnapshot)
  if ((await sha256File(sourceDatabasePath)) !== sourceClosedSha256) {
    throw new LegacyDatabaseMigrationError(
      'comparison_failed',
      'legacy source database changed after both backends stopped'
    )
  }

  return Object.freeze({
    schemaVersion: 1,
    runId: options.runId,
    strategy: LEGACY_MIGRATION_STRATEGY,
    sourceDatabasePath,
    sourceClosedSha256,
    sourceSchemaVersion: LEGACY_ALEMBIC_HEAD,
    sourceAppVersion: options.sourceAppVersion,
    backup,
    workingDataDirectory,
    workingDatabasePath,
    workingDatabaseSha256: await sha256File(workingDatabasePath),
    targetMigrationVersion: migrations.length,
    appliedMigrations: Object.freeze(
      migrations
        .slice(LEGACY_MIGRATION_BASELINE_VERSION)
        .map((migration) => migration.name)
    ),
    preservedTables,
    smokeMarkerWorkId,
    rollbackDatabasePath,
    rollbackDatabaseSha256: await sha256File(rollbackDatabasePath),
    rollbackTables,
    originalSourceUnchangedAfterStop: true,
    copiedLiveMainOrSidecars: false,
    bunOwnedOnlineBackupAvailable: false,
    destructiveBunMigrationsAllowed: false,
    completedAtMs: timestamp(nowMs)
  })
}

async function validateAndMigrateWorkingCopy(input: Readonly<{
  workingDatabasePath: string
  referenceDatabasePath: string
  migrations: readonly SqliteMigration[]
  targetAppVersion: string
  nowMs: () => number
}>): Promise<void> {
  const working = openWritable(input.workingDatabasePath)
  const reference = openWritable(input.referenceDatabasePath)
  try {
    await runSqliteMigrations({
      database: reference,
      databasePath: input.referenceDatabasePath,
      migrations: input.migrations.slice(0, LEGACY_MIGRATION_BASELINE_VERSION),
      appVersion: input.targetAppVersion,
      nowMs: input.nowMs
    })
    const expectedTables = userTables(reference).filter(
      (table) => table !== ADVX_MIGRATION_JOURNAL_TABLE
    )
    const actualTables = new Set(userTables(working))
    if (
      actualTables.has(ADVX_MIGRATION_JOURNAL_TABLE) ||
      expectedTables.some((table) => !actualTables.has(table))
    ) {
      throw unsupportedSchema()
    }
    for (const table of expectedTables) {
      const actualSignature = JSON.stringify(schemaSignature(working, table))
      const expectedSignature = JSON.stringify(schemaSignature(reference, table))
      if (
        actualSignature !== expectedSignature
      ) {
        throw unsupportedSchema(`table ${table} differs`)
      }
    }
    adoptMigrationBaseline(
      working,
      input.migrations.slice(0, LEGACY_MIGRATION_BASELINE_VERSION),
      input.targetAppVersion,
      timestamp(input.nowMs)
    )
    const result = await runSqliteMigrations({
      database: working,
      databasePath: input.workingDatabasePath,
      migrations: input.migrations,
      appVersion: input.targetAppVersion,
      nowMs: input.nowMs
    })
    if (
      result.currentVersion !== input.migrations.length ||
      result.applied.length !==
        input.migrations.length - LEGACY_MIGRATION_BASELINE_VERSION
    ) {
      throw new LegacyDatabaseMigrationError(
        'working_copy_failed',
        'working copy did not reach the complete Bun migration manifest'
      )
    }
    requireQuickCheck(working)
  } catch (cause) {
    if (cause instanceof LegacyDatabaseMigrationError) throw cause
    throw new LegacyDatabaseMigrationError(
      'working_copy_failed',
      'isolated legacy working-copy migration failed',
      { cause }
    )
  } finally {
    reference.close()
    working.close()
  }
}

function adoptMigrationBaseline(
  database: Database,
  migrations: readonly SqliteMigration[],
  appVersion: string,
  appliedAtMs: number
): void {
  database.run('BEGIN IMMEDIATE')
  try {
    database.run(`
      CREATE TABLE ${ADVX_MIGRATION_JOURNAL_TABLE} (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        checksum TEXT NOT NULL CHECK (length(checksum) = 64),
        destructive INTEGER NOT NULL CHECK (destructive IN (0, 1)),
        applied_at_ms INTEGER NOT NULL,
        app_version TEXT NOT NULL
      ) STRICT
    `)
    const insert = database.query(`
      INSERT INTO ${ADVX_MIGRATION_JOURNAL_TABLE}
        (version, name, checksum, destructive, applied_at_ms, app_version)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    for (const migration of migrations) {
      insert.run(
        migration.version,
        migration.name,
        migration.checksum,
        migration.destructive ? 1 : 0,
        appliedAtMs,
        appVersion
      )
    }
    database.run('COMMIT')
  } catch (cause) {
    try {
      database.run('ROLLBACK')
    } catch {
      // Preserve the baseline-adoption failure.
    }
    throw new LegacyDatabaseMigrationError(
      'working_copy_failed',
      'validated legacy migration baseline adoption failed',
      { cause }
    )
  }
}

async function runBunReadWriteRestartSmoke(input: Readonly<{
  runId: string
  workingDataDirectory: string
  backup: OnlineBackupReceipt
  nowMs: () => number
}>): Promise<string> {
  const workId = `legacy-migration:${input.runId}`
  let database = new AdvxSqliteDatabase({
    dataDirectory: input.workingDataDirectory,
    openMode: 'existing-only'
  })
  try {
    database.initialize()
    let repositories = createSqliteRepositories(
      new SqliteTransactionBoundary(database)
    )
    const now = timestamp(input.nowMs)
    await repositories.transactions.run(async (transaction) => {
      await repositories.outbox.enqueue(transaction, {
        workId,
        idempotencyKey: workId,
        kind: 'migration_marker',
        topic: 'migration.legacy.completed',
        fence: {
          kind: 'none',
          roomId: null,
          sessionId: null,
          audienceEpoch: null,
          observationId: null,
          viewerId: null,
          viewerSequence: null
        },
        payload: {
          backup_sha256: input.backup.sha256,
          source_schema_version: input.backup.sourceSchemaVersion,
          target_migration_version: ADVX_SQLITE_MIGRATIONS.length
        },
        availableAt: wallClockTimestampMs(now),
        createdAt: wallClockTimestampMs(now)
      })
    })
    database.close()

    database = new AdvxSqliteDatabase({
      dataDirectory: input.workingDataDirectory,
      openMode: 'existing-only'
    })
    database.initialize()
    repositories = createSqliteRepositories(
      new SqliteTransactionBoundary(database)
    )
    const record = await repositories.transactions.run(
      async (transaction) => await repositories.outbox.get(transaction, workId)
    )
    if (
      record?.kind !== 'migration_marker' ||
      record.status !== 'pending' ||
      record.payload === null ||
      typeof record.payload !== 'object'
    ) {
      throw new LegacyDatabaseMigrationError(
        'smoke_failed',
        'Bun read/write/restart smoke did not restore the migration marker'
      )
    }
    return workId
  } catch (cause) {
    if (cause instanceof LegacyDatabaseMigrationError) throw cause
    throw new LegacyDatabaseMigrationError(
      'smoke_failed',
      'Bun failed to open, write, and reopen the migrated working copy',
      { cause }
    )
  } finally {
    database.close()
  }
}

function inspectDatabase(path: string): DatabaseSnapshot {
  const database = new Database(path, { readonly: true, strict: true })
  try {
    requireQuickCheck(database)
    const revisions = database
      .query('SELECT version_num FROM alembic_version')
      .all() as Array<{ version_num: string }>
    if (revisions.length !== 1 || revisions[0]?.version_num !== LEGACY_ALEMBIC_HEAD) {
      throw unsupportedSchema()
    }
    const tables = Object.fromEntries(
      userTables(database)
        .filter(
          (table) =>
            table !== ADVX_MIGRATION_JOURNAL_TABLE &&
            table !== 'durable_outbox'
        )
        .map((table) => [table, tableComparison(database, table)])
    )
    return Object.freeze({
      schemaVersion: revisions[0].version_num,
      tables: Object.freeze(tables)
    })
  } finally {
    database.close()
  }
}

function compareSnapshots(
  expected: DatabaseSnapshot,
  actual: DatabaseSnapshot
): readonly LegacyTableComparison[] {
  if (actual.schemaVersion !== expected.schemaVersion) {
    throw comparisonError()
  }
  const expectedTables = Object.keys(expected.tables).sort()
  const actualTables = Object.keys(actual.tables).sort()
  if (
    expectedTables.length !== actualTables.length ||
    expectedTables.some((table, index) => table !== actualTables[index])
  ) {
    throw comparisonError()
  }
  for (const table of expectedTables) {
    const left = expected.tables[table]!
    const right = actual.tables[table]!
    if (
      left.rowCount !== right.rowCount ||
      left.semanticSha256 !== right.semanticSha256
    ) {
      throw comparisonError()
    }
  }
  return Object.freeze(expectedTables.map((table) => actual.tables[table]!))
}

function tableComparison(
  database: Database,
  table: string
): LegacyTableComparison {
  const columns = tableColumns(database, table).map((column) => column.name)
  if (columns.length === 0) throw unsupportedSchema()
  const rows = database
    .query(
      `SELECT * FROM ${quoteIdentifier(table)}
       ORDER BY ${columns.map(quoteIdentifier).join(', ')}`
    )
    .all() as Array<Record<string, unknown>>
  const normalized = rows.map((row) =>
    Object.fromEntries(columns.map((column) => [column, jsonValue(row[column])]))
  )
  return Object.freeze({
    table,
    rowCount: rows.length,
    semanticSha256: sha256Text(JSON.stringify(normalized))
  })
}

function schemaSignature(database: Database, table: string): unknown {
  const columns = tableColumns(database, table)
    .map((column) => ({
      name: column.name,
      type: sqliteTypeAffinity(column.type),
      notNull: column.notnull === 1 || column.pk > 0 ? 1 : 0,
      primaryKeyOrdinal: column.pk
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
  const foreignKeys = (
    database
      .query(`PRAGMA foreign_key_list(${quoteIdentifier(table)})`)
      .all() as ForeignKeyInfo[]
  )
    .map((item) => ({
      table: item.table,
      from: item.from,
      to: item.to,
      onUpdate: item.on_update.toUpperCase(),
      onDelete: item.on_delete.toUpperCase(),
      match: item.match.toUpperCase()
    }))
    .sort(compareJson)
  const indexes = (
    database
      .query(`PRAGMA index_list(${quoteIdentifier(table)})`)
      .all() as IndexInfo[]
  )
    .map((index) => ({
      unique: index.unique,
      origin: index.origin,
      partial: index.partial,
      columns: (
        database
          .query(`PRAGMA index_info(${quoteIdentifier(index.name)})`)
          .all() as Array<{ seqno: number; name: string }>
      )
        .sort((left, right) => left.seqno - right.seqno)
        .map((column) => column.name)
    }))
    .sort(compareJson)
  const row = database
    .query("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?")
    .get(table) as { sql: string } | null
  if (row === null) throw unsupportedSchema()
  return {
    columns,
    foreignKeys,
    indexes,
    checks: extractCheckExpressions(row.sql)
  }
}

function extractCheckExpressions(sql: string): readonly string[] {
  const checks: string[] = []
  const lower = sql.toLowerCase()
  let offset = 0
  while (offset < sql.length) {
    const index = lower.indexOf('check', offset)
    if (index < 0) break
    let start = index + 5
    while (/\s/.test(sql[start] ?? '')) start += 1
    if (sql[start] !== '(') {
      offset = start
      continue
    }
    let depth = 0
    let quote: "'" | '"' | null = null
    let end = start
    for (; end < sql.length; end += 1) {
      const character = sql[end]!
      if (quote !== null) {
        if (character === quote && sql[end + 1] === quote) {
          end += 1
        } else if (character === quote) {
          quote = null
        }
        continue
      }
      if (character === "'" || character === '"') {
        quote = character
      } else if (character === '(') {
        depth += 1
      } else if (character === ')') {
        depth -= 1
        if (depth === 0) break
      }
    }
    if (depth !== 0) throw unsupportedSchema()
    checks.push(normalizeSql(sql.slice(start + 1, end)))
    offset = end + 1
  }
  return Object.freeze(checks.sort())
}

function tableColumns(database: Database, table: string): readonly ColumnInfo[] {
  return database
    .query(`PRAGMA table_info(${quoteIdentifier(table)})`)
    .all() as ColumnInfo[]
}

function userTables(database: Database): string[] {
  return (
    database
      .query(
        `SELECT name FROM sqlite_schema
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name)
}

function openWritable(path: string): Database {
  const database = new Database(path, {
    create: true,
    readwrite: true,
    strict: true
  })
  database.run('PRAGMA foreign_keys = ON')
  database.run('PRAGMA busy_timeout = 5000')
  database.run('PRAGMA synchronous = NORMAL')
  return database
}

function requireQuickCheck(database: Database): void {
  const row = database.query('PRAGMA quick_check').get()
  if (row === null || Object.values(row as Record<string, unknown>)[0] !== 'ok') {
    throw new LegacyDatabaseMigrationError(
      'comparison_failed',
      'SQLite quick_check failed during legacy migration'
    )
  }
}

async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256')
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk)
  return hasher.digest('hex')
}

function sha256Text(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

function existingFile(path: string): string {
  if (!isAbsolute(path)) throw invalidInput()
  let canonical: string
  try {
    canonical = realpathSync.native(path)
  } catch (cause) {
    throw new LegacyDatabaseMigrationError(
      'invalid_input',
      'legacy source database does not exist',
      { cause }
    )
  }
  if (!statSync(canonical).isFile() || statSync(canonical).size === 0) {
    throw invalidInput()
  }
  return canonical
}

function hasSidecars(path: string): boolean {
  return existsSync(path + '-wal') || existsSync(path + '-shm')
}

function within(root: string, child: string): boolean {
  const path = relative(resolve(root), resolve(child))
  return path.length > 0 && !path.startsWith('..') && !isAbsolute(path)
}

function quoteIdentifier(value: string): string {
  return '"' + value.replaceAll('"', '""') + '"'
}

function normalizeSql(value: string): string {
  return value
    .replace(/["\x60\[\]]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}

function sqliteTypeAffinity(value: string): string {
  const type = value.toUpperCase()
  if (type.includes('INT')) return 'INTEGER'
  if (type.includes('CHAR') || type.includes('CLOB') || type.includes('TEXT')) {
    return 'TEXT'
  }
  if (type.length === 0 || type.includes('BLOB')) return 'BLOB'
  if (type.includes('REAL') || type.includes('FLOA') || type.includes('DOUB')) {
    return 'REAL'
  }
  return 'NUMERIC'
}

function compareJson(left: unknown, right: unknown): number {
  return JSON.stringify(left).localeCompare(JSON.stringify(right))
}

function jsonValue(value: unknown): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value
  }
  if (value instanceof Uint8Array) {
    return { binaryHex: Buffer.from(value).toString('hex') }
  }
  throw new LegacyDatabaseMigrationError(
    'comparison_failed',
    'legacy semantic comparison encountered an unsupported SQLite value'
  )
}

function validTimestamp(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0
}

function timestamp(nowMs: () => number): number {
  const value = nowMs()
  if (!validTimestamp(value)) throw invalidInput()
  return value
}

function invalidInput(): LegacyDatabaseMigrationError {
  return new LegacyDatabaseMigrationError(
    'invalid_input',
    'legacy database migration input is invalid'
  )
}

function unsupportedSchema(detail?: string): LegacyDatabaseMigrationError {
  return new LegacyDatabaseMigrationError(
    'unsupported_legacy_schema',
    detail === undefined
      ? 'legacy database does not match the accepted Python/Alembic baseline'
      : `legacy database does not match the accepted Python/Alembic baseline: ${detail}`
  )
}

function comparisonError(): LegacyDatabaseMigrationError {
  return new LegacyDatabaseMigrationError(
    'comparison_failed',
    'legacy row counts or semantic table digests changed during migration'
  )
}
