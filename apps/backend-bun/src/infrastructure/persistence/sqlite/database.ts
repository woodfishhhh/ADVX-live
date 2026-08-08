import { Database } from 'bun:sqlite'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  realpathSync,
  statSync
} from 'node:fs'
import { isAbsolute, join, normalize } from 'node:path'

import {
  classifySqliteFault,
  type SqliteFaultStatus
} from './fault-status'

export const ADVX_SQLITE_DATABASE_FILENAME = 'advx.sqlite3'
export const ADVX_SQLITE_BUSY_TIMEOUT_MS = 5_000

export type AdvxSqliteDatabaseErrorCode =
  | 'invalid_data_directory'
  | 'database_missing'
  | 'sidecar_mismatch'
  | 'permission_failed'
  | 'writable_owner_exists'
  | 'initialization_cancelled'
  | 'open_failed'
  | 'pragma_failed'
  | 'integrity_check_failed'
  | 'checkpoint_failed'
  | 'database_not_ready'

export class AdvxSqliteDatabaseError extends Error {
  readonly fault: SqliteFaultStatus

  constructor(
    readonly code: AdvxSqliteDatabaseErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'AdvxSqliteDatabaseError'
    this.fault = classifySqliteFault(this, {
      operation: 'startup',
      priorCopyPreserved: true
    })
  }
}

export type AdvxSqliteOpenMode = 'create-or-open' | 'existing-only'

export type AdvxSqliteDatabaseOptions = Readonly<{
  dataDirectory: string
  openMode?: AdvxSqliteOpenMode
}>

export type AdvxSqliteDatabaseHealth = Readonly<{
  status: 'new' | 'starting' | 'ready' | 'failed' | 'closed'
  ready: boolean
  writableOwnerHeld: boolean
  journalMode: 'wal' | null
  busyTimeoutMs: number | null
  foreignKeys: boolean
  synchronous: 'normal' | null
  quickCheck: 'ok' | null
  failureCode: AdvxSqliteDatabaseErrorCode | null
}>

export type AdvxSqliteCheckpoint = Readonly<{
  busy: number
  logFrames: number
  checkpointedFrames: number
}>

type DatabaseState = AdvxSqliteDatabaseHealth['status']

type CheckpointRow = Readonly<{
  busy: number
  log: number
  checkpointed: number
}>

const writableOwners = new Set<string>()

export class AdvxSqliteDatabase {
  readonly dataDirectory: string
  readonly openMode: AdvxSqliteOpenMode
  #databasePath: string
  #database: Database | undefined
  #ownerKey: string | undefined
  #state: DatabaseState = 'new'
  #failureCode: AdvxSqliteDatabaseErrorCode | null = null
  #journalMode: 'wal' | null = null
  #busyTimeoutMs: number | null = null
  #foreignKeys = false
  #synchronous: 'normal' | null = null
  #quickCheck: 'ok' | null = null
  #lastCheckpoint: AdvxSqliteCheckpoint | null = null

  constructor(options: AdvxSqliteDatabaseOptions) {
    if (!isAbsolute(options.dataDirectory)) {
      throw configurationError()
    }
    this.dataDirectory = normalize(options.dataDirectory)
    this.openMode = options.openMode ?? 'create-or-open'
    assertWritableDataLocation(this.dataDirectory)
    this.#databasePath = join(this.dataDirectory, ADVX_SQLITE_DATABASE_FILENAME)
  }

  get path(): string {
    return this.#databasePath
  }

  get lastCheckpoint(): AdvxSqliteCheckpoint | null {
    return this.#lastCheckpoint
  }

  initialize(signal: AbortSignal = new AbortController().signal): void {
    if (this.#state === 'ready') return
    if (this.#state === 'closed') {
      throw new AdvxSqliteDatabaseError(
        'database_not_ready',
        'SQLite database resource cannot be reopened after close'
      )
    }
    this.#state = 'starting'
    let stage: 'directory' | 'open' | 'pragmas' | 'integrity' = 'directory'

    try {
      requireNotAborted(signal)
      if (this.openMode === 'create-or-open') {
        mkdirSync(this.dataDirectory, { recursive: true, mode: 0o700 })
      } else if (!existsSync(this.dataDirectory)) {
        throw missingDatabase()
      }
      restrictPermissions(this.dataDirectory, 0o700)
      const canonicalDirectory = realpathSync.native(this.dataDirectory)
      assertWritableDataLocation(canonicalDirectory)
      this.#databasePath = join(canonicalDirectory, ADVX_SQLITE_DATABASE_FILENAME)
      if (this.openMode === 'existing-only') {
        assertExistingDatabase(this.#databasePath)
      }
      const candidateOwnerKey = ownerKey(this.#databasePath)
      if (writableOwners.has(candidateOwnerKey)) {
        throw new AdvxSqliteDatabaseError(
          'writable_owner_exists',
          'SQLite database already has a writable owner in this backend process'
        )
      }
      writableOwners.add(candidateOwnerKey)
      this.#ownerKey = candidateOwnerKey

      requireNotAborted(signal)
      stage = 'open'
      this.#database = new Database(this.#databasePath, {
        create: this.openMode === 'create-or-open',
        readwrite: true,
        strict: true
      })
      restrictPermissions(this.#databasePath, 0o600)

      stage = 'pragmas'
      configurePragmas(this.#database)
      const pragmas = readRequiredPragmas(this.#database)
      this.#journalMode = pragmas.journalMode
      this.#busyTimeoutMs = pragmas.busyTimeoutMs
      this.#foreignKeys = pragmas.foreignKeys
      this.#synchronous = pragmas.synchronous

      stage = 'integrity'
      if (readPragma(this.#database, 'PRAGMA quick_check') !== 'ok') {
        throw new AdvxSqliteDatabaseError(
          'integrity_check_failed',
          'SQLite quick_check failed during startup'
        )
      }
      this.#quickCheck = 'ok'
      requireNotAborted(signal)
      this.#failureCode = null
      this.#state = 'ready'
    } catch (error) {
      this.#releaseFailedInitialization()
      const failure = normalizeInitializationError(error, stage)
      this.#failureCode = failure.code
      this.#state = 'failed'
      throw failure
    }
  }

  health(): AdvxSqliteDatabaseHealth {
    return Object.freeze({
      status: this.#state,
      ready: this.#state === 'ready',
      writableOwnerHeld: this.#ownerKey !== undefined,
      journalMode: this.#journalMode,
      busyTimeoutMs: this.#busyTimeoutMs,
      foreignKeys: this.#foreignKeys,
      synchronous: this.#synchronous,
      quickCheck: this.#quickCheck,
      failureCode: this.#failureCode
    })
  }

  isReady(): boolean {
    return this.#state === 'ready'
  }

  // All repository reads and writes share this owned synchronous connection.
  withReadConnection<T>(operation: (database: Database) => T): T {
    return operation(this.#requireReadyDatabase())
  }

  withWriteConnection<T>(operation: (database: Database) => T): T {
    return operation(this.#requireReadyDatabase())
  }

  flush(): void {
    if (this.#database === undefined) return
    this.#lastCheckpoint = checkpoint(this.#database)
    restrictDatabaseFiles(this.#databasePath)
  }

  close(): void {
    const database = this.#database
    if (database === undefined) {
      if (this.#state !== 'failed') this.#state = 'closed'
      this.#releaseOwner()
      return
    }

    let checkpointFailure: unknown
    try {
      this.#lastCheckpoint = checkpoint(database)
      restrictDatabaseFiles(this.#databasePath)
    } catch (error) {
      checkpointFailure = error
    }
    try {
      database.close()
    } finally {
      this.#database = undefined
      this.#releaseOwner()
      this.#state = 'closed'
    }
    if (checkpointFailure !== undefined) throw checkpointFailure
  }

  #requireReadyDatabase(): Database {
    if (this.#state !== 'ready' || this.#database === undefined) {
      throw new AdvxSqliteDatabaseError(
        'database_not_ready',
        'SQLite database is not ready for queries'
      )
    }
    return this.#database
  }

  #releaseFailedInitialization(): void {
    try {
      this.#database?.close(false)
    } catch {
      // Preserve the stable startup error.
    }
    this.#database = undefined
    this.#releaseOwner()
  }

  #releaseOwner(): void {
    if (this.#ownerKey === undefined) return
    writableOwners.delete(this.#ownerKey)
    this.#ownerKey = undefined
  }
}

function configurePragmas(database: Database): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = ${ADVX_SQLITE_BUSY_TIMEOUT_MS};
    PRAGMA synchronous = NORMAL;
  `)
}

function readRequiredPragmas(database: Database): Readonly<{
  journalMode: 'wal'
  busyTimeoutMs: number
  foreignKeys: true
  synchronous: 'normal'
}> {
  const foreignKeys = readPragma(database, 'PRAGMA foreign_keys')
  const journalMode = readPragma(database, 'PRAGMA journal_mode')
  const busyTimeoutMs = readPragma(database, 'PRAGMA busy_timeout')
  const synchronous = readPragma(database, 'PRAGMA synchronous')
  if (
    foreignKeys !== 1 ||
    journalMode !== 'wal' ||
    busyTimeoutMs !== ADVX_SQLITE_BUSY_TIMEOUT_MS ||
    synchronous !== 1
  ) {
    throw new AdvxSqliteDatabaseError(
      'pragma_failed',
      'SQLite connection did not retain the required pragmas'
    )
  }
  return {
    journalMode,
    busyTimeoutMs,
    foreignKeys: true,
    synchronous: 'normal'
  }
}

function readPragma(database: Database, sql: string): unknown {
  const row = database.query(sql).get()
  if (row === null || typeof row !== 'object') return null
  return Object.values(row)[0]
}

function checkpoint(database: Database): AdvxSqliteCheckpoint {
  let row: CheckpointRow | null
  try {
    row = database.query('PRAGMA wal_checkpoint(TRUNCATE)').get() as CheckpointRow | null
  } catch (error) {
    throw new AdvxSqliteDatabaseError(
      'checkpoint_failed',
      'SQLite WAL checkpoint failed during cleanup',
      { cause: error }
    )
  }
  if (
    row === null ||
    !Number.isSafeInteger(row.busy) ||
    !Number.isSafeInteger(row.log) ||
    !Number.isSafeInteger(row.checkpointed) ||
    row.busy !== 0
  ) {
    throw new AdvxSqliteDatabaseError(
      'checkpoint_failed',
      'SQLite WAL checkpoint did not complete cleanly'
    )
  }
  return Object.freeze({
    busy: row.busy,
    logFrames: row.log,
    checkpointedFrames: row.checkpointed
  })
}

function assertWritableDataLocation(path: string): void {
  const segments = normalize(path)
    .split(/[\\/]+/)
    .filter(Boolean)
    .map((segment) => segment.toLowerCase())
  if (
    segments.some(
      (segment) => segment === 'resources' || segment.includes('.asar')
    )
  ) {
    throw configurationError()
  }
}

function assertExistingDatabase(databasePath: string): void {
  const walExists = existsSync(`${databasePath}-wal`)
  const shmExists = existsSync(`${databasePath}-shm`)
  if (!existsSync(databasePath)) {
    if (walExists || shmExists) {
      throw new AdvxSqliteDatabaseError(
        'sidecar_mismatch',
        'SQLite recovery found WAL/SHM sidecars without the main database'
      )
    }
    throw missingDatabase()
  }
  const metadata = statSync(databasePath)
  if (!metadata.isFile() || metadata.size === 0) {
    throw new AdvxSqliteDatabaseError(
      'open_failed',
      'existing SQLite recovery target is not a non-empty database file'
    )
  }
  if (shmExists && !walExists) {
    throw new AdvxSqliteDatabaseError(
      'sidecar_mismatch',
      'SQLite recovery found an SHM sidecar without its WAL'
    )
  }
}

function missingDatabase(): AdvxSqliteDatabaseError {
  return new AdvxSqliteDatabaseError(
    'database_missing',
    'existing SQLite recovery target is missing; no empty database was created'
  )
}

function configurationError(): AdvxSqliteDatabaseError {
  return new AdvxSqliteDatabaseError(
    'invalid_data_directory',
    'ADVX_DATA_DIR must be an absolute writable user-data directory outside packaged resources and ASAR'
  )
}

function requireNotAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new AdvxSqliteDatabaseError(
      'initialization_cancelled',
      'SQLite initialization was cancelled'
    )
  }
}

function restrictDatabaseFiles(databasePath: string): void {
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    if (existsSync(path)) restrictPermissions(path, 0o600)
  }
}

function restrictPermissions(path: string, mode: number): void {
  try {
    chmodSync(path, mode)
  } catch (error) {
    if (process.platform === 'win32') return
    throw new AdvxSqliteDatabaseError(
      'permission_failed',
      'SQLite data permissions could not be restricted to the current user',
      { cause: error }
    )
  }
}

function normalizeInitializationError(
  error: unknown,
  stage: 'directory' | 'open' | 'pragmas' | 'integrity'
): AdvxSqliteDatabaseError {
  if (error instanceof AdvxSqliteDatabaseError) return error
  const code =
    stage === 'pragmas'
      ? 'pragma_failed'
      : stage === 'integrity'
      ? 'integrity_check_failed'
      : 'open_failed'
  const message =
    stage === 'directory'
      ? 'SQLite data directory preparation failed'
      : stage === 'open'
      ? 'SQLite database open failed'
      : stage === 'pragmas'
      ? 'SQLite pragma configuration failed'
      : 'SQLite quick_check failed during startup'
  return new AdvxSqliteDatabaseError(code, message, { cause: error })
}

function ownerKey(path: string): string {
  const normalized = normalize(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}
