import { Database } from 'bun:sqlite'
import {
  existsSync,
  mkdirSync,
  realpathSync,
  statSync
} from 'node:fs'
import {
  isAbsolute,
  relative,
  resolve
} from 'node:path'

import type {
  OnlineBackupReceipt,
  SqliteOnlineBackupAdapter
} from './migration-runner'

export type PythonOnlineBackupErrorCode =
  | 'invalid_configuration'
  | 'process_failed'
  | 'invalid_receipt'
  | 'integrity_failed'

export class PythonOnlineBackupError extends Error {
  constructor(
    readonly code: PythonOnlineBackupErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'PythonOnlineBackupError'
  }
}

export type PythonOnlineBackupAdapterOptions = Readonly<{
  command: readonly string[]
  scriptPath: string
  backupDirectory: string
  sourceAppVersion: string
  timeoutMs?: number
  nowMs?: () => number
}>

export type OnlineRestoreReceipt = OnlineBackupReceipt &
  Readonly<{
    restoredPath: string
  }>

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const DEFAULT_TIMEOUT_MS = 60_000

export class PythonSqliteOnlineBackupAdapter
  implements SqliteOnlineBackupAdapter
{
  readonly #command: readonly string[]
  readonly #scriptPath: string
  readonly #backupDirectory: string
  readonly #sourceAppVersion: string
  readonly #timeoutMs: number
  readonly #nowMs: () => number

  constructor(options: PythonOnlineBackupAdapterOptions) {
    if (
      options.command.length === 0 ||
      options.command.some((part) => part.trim().length === 0) ||
      !isAbsolute(options.scriptPath) ||
      !isAbsolute(options.backupDirectory) ||
      options.sourceAppVersion.trim().length === 0
    ) {
      throw configurationError()
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
      throw configurationError()
    }
    this.#command = Object.freeze([...options.command])
    this.#scriptPath = resolve(options.scriptPath)
    this.#backupDirectory = resolve(options.backupDirectory)
    this.#sourceAppVersion = options.sourceAppVersion
    this.#timeoutMs = timeoutMs
    this.#nowMs = options.nowMs ?? Date.now
  }

  async createVerifiedBackup(input: Readonly<{
    databasePath: string
    pendingMigrationNames: readonly string[]
    currentVersion: number
    targetVersion: number
    appVersion: string
  }>): Promise<OnlineBackupReceipt> {
    validateMigrationInput(input)
    const databasePath = requiredExistingFile(input.databasePath)
    mkdirSync(this.#backupDirectory, { recursive: true, mode: 0o700 })
    const backupDirectory = realpathSync.native(this.#backupDirectory)
    const receipt = await this.#run([
      'backup',
      '--source',
      databasePath,
      '--destination-directory',
      backupDirectory,
      '--source-app-version',
      this.#sourceAppVersion,
      '--created-at-ms',
      String(this.#timestamp())
    ])
    await validateReceipt(receipt, {
      expectedAppVersion: this.#sourceAppVersion,
      requiredRoot: backupDirectory,
      forbiddenPath: databasePath
    })
    return receipt
  }

  async restoreVerifiedBackup(input: Readonly<{
    backupPath: string
    backupSha256: string
    destinationPath: string
  }>): Promise<OnlineRestoreReceipt> {
    const backupPath = requiredExistingFile(input.backupPath)
    if (!SHA256_PATTERN.test(input.backupSha256)) {
      throw configurationError()
    }
    if ((await sha256File(backupPath)) !== input.backupSha256) {
      throw new PythonOnlineBackupError(
        'integrity_failed',
        'online backup artifact changed before restore'
      )
    }
    if (!isAbsolute(input.destinationPath)) throw configurationError()
    const destinationPath = resolve(input.destinationPath)
    if (existsSync(destinationPath)) {
      throw new PythonOnlineBackupError(
        'invalid_configuration',
        'restore destination must not exist'
      )
    }
    mkdirSync(resolve(destinationPath, '..'), {
      recursive: true,
      mode: 0o700
    })
    const receipt = await this.#run([
      'restore',
      '--backup',
      backupPath,
      '--destination',
      destinationPath,
      '--source-app-version',
      this.#sourceAppVersion,
      '--created-at-ms',
      String(this.#timestamp())
    ])
    await validateReceipt(receipt, {
      expectedAppVersion: this.#sourceAppVersion,
      exactPath: destinationPath,
      forbiddenPath: backupPath
    })
    return Object.freeze({ ...receipt, restoredPath: receipt.backupPath })
  }

  async #run(arguments_: readonly string[]): Promise<OnlineBackupReceipt> {
    const subprocess = Bun.spawn(
      [...this.#command, this.#scriptPath, ...arguments_],
      {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        windowsHide: true
      }
    )
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      subprocess.kill()
    }, this.#timeoutMs)
    try {
      const [exitCode, stdout, stderr] = await Promise.all([
        subprocess.exited,
        new Response(subprocess.stdout).text(),
        new Response(subprocess.stderr).text()
      ])
      if (timedOut || exitCode !== 0) {
        throw new PythonOnlineBackupError(
          'process_failed',
          timedOut
            ? 'Python SQLite Online Backup API timed out'
            : `Python SQLite Online Backup API exited with code ${exitCode}: ${bounded(stderr)}`
        )
      }
      return parseReceipt(stdout)
    } finally {
      clearTimeout(timeout)
    }
  }

  #timestamp(): number {
    const value = this.#nowMs()
    if (!Number.isSafeInteger(value) || value < 0) throw configurationError()
    return value
  }
}

function validateMigrationInput(input: Readonly<{
  databasePath: string
  pendingMigrationNames: readonly string[]
  currentVersion: number
  targetVersion: number
  appVersion: string
}>): void {
  if (
    input.pendingMigrationNames.length === 0 ||
    input.pendingMigrationNames.some((name) => name.trim().length === 0) ||
    !Number.isSafeInteger(input.currentVersion) ||
    input.currentVersion < 0 ||
    !Number.isSafeInteger(input.targetVersion) ||
    input.targetVersion <= input.currentVersion ||
    input.appVersion.trim().length === 0
  ) {
    throw configurationError()
  }
}

function parseReceipt(stdout: string): OnlineBackupReceipt {
  let value: unknown
  try {
    value = JSON.parse(stdout.trim())
  } catch (cause) {
    throw new PythonOnlineBackupError(
      'invalid_receipt',
      'Python SQLite Online Backup API returned invalid JSON',
      { cause }
    )
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidReceipt()
  }
  const record = value as Record<string, unknown>
  if (
    record.method !== 'sqlite-online-backup-api' ||
    typeof record.backupPath !== 'string' ||
    typeof record.sha256 !== 'string' ||
    record.quickCheck !== 'ok' ||
    typeof record.createdAtMs !== 'number' ||
    typeof record.sourceSchemaVersion !== 'string' ||
    typeof record.sourceAppVersion !== 'string'
  ) {
    throw invalidReceipt()
  }
  return Object.freeze({
    method: record.method,
    backupPath: record.backupPath,
    sha256: record.sha256,
    quickCheck: record.quickCheck,
    createdAtMs: record.createdAtMs,
    sourceSchemaVersion: record.sourceSchemaVersion,
    sourceAppVersion: record.sourceAppVersion
  })
}

async function validateReceipt(
  receipt: OnlineBackupReceipt,
  expected: Readonly<{
    expectedAppVersion: string
    requiredRoot?: string
    exactPath?: string
    forbiddenPath: string
  }>
): Promise<void> {
  if (
    !isAbsolute(receipt.backupPath) ||
    !SHA256_PATTERN.test(receipt.sha256) ||
    !Number.isSafeInteger(receipt.createdAtMs) ||
    receipt.createdAtMs < 0 ||
    receipt.sourceSchemaVersion.trim().length === 0 ||
    receipt.sourceAppVersion !== expected.expectedAppVersion
  ) {
    throw invalidReceipt()
  }
  const artifactPath = requiredExistingFile(receipt.backupPath)
  if (
    artifactPath === resolve(expected.forbiddenPath) ||
    (expected.exactPath !== undefined &&
      artifactPath !== resolve(expected.exactPath)) ||
    (expected.requiredRoot !== undefined &&
      !within(resolve(expected.requiredRoot), artifactPath))
  ) {
    throw invalidReceipt()
  }
  if (
    existsSync(artifactPath + '-wal') ||
    existsSync(artifactPath + '-shm') ||
    (await sha256File(artifactPath)) !== receipt.sha256
  ) {
    throw new PythonOnlineBackupError(
      'integrity_failed',
      'online backup artifact hash or sidecar boundary is invalid'
    )
  }
  const database = new Database(artifactPath, {
    readonly: true,
    strict: true
  })
  try {
    const quickCheck = database.query('PRAGMA quick_check').get()
    if (
      quickCheck === null ||
      Object.values(quickCheck as Record<string, unknown>)[0] !== 'ok'
    ) {
      throw new PythonOnlineBackupError(
        'integrity_failed',
        'online backup artifact failed quick_check'
      )
    }
    const revision = database
      .query('SELECT version_num FROM alembic_version')
      .all() as Array<{ version_num: string }>
    if (
      revision.length !== 1 ||
      revision[0]?.version_num !== receipt.sourceSchemaVersion
    ) {
      throw new PythonOnlineBackupError(
        'integrity_failed',
        'online backup schema version receipt does not match the artifact'
      )
    }
  } finally {
    database.close()
  }
}

async function sha256File(path: string): Promise<string> {
  const hasher = new Bun.CryptoHasher('sha256')
  for await (const chunk of Bun.file(path).stream()) hasher.update(chunk)
  return hasher.digest('hex')
}

function requiredExistingFile(path: string): string {
  if (!isAbsolute(path)) throw configurationError()
  let resolved: string
  try {
    resolved = realpathSync.native(path)
  } catch (cause) {
    throw new PythonOnlineBackupError(
      'invalid_configuration',
      'SQLite path does not exist',
      { cause }
    )
  }
  if (!statSync(resolved).isFile() || statSync(resolved).size === 0) {
    throw configurationError()
  }
  return resolved
}

function within(root: string, child: string): boolean {
  const path = relative(root, child)
  return path.length > 0 && !path.startsWith('..') && !isAbsolute(path)
}

function bounded(value: string): string {
  const normalized = value.trim().replace(/\s+/g, ' ')
  return normalized.slice(0, 1_000)
}

function configurationError(): PythonOnlineBackupError {
  return new PythonOnlineBackupError(
    'invalid_configuration',
    'Python SQLite Online Backup API configuration is invalid'
  )
}

function invalidReceipt(): PythonOnlineBackupError {
  return new PythonOnlineBackupError(
    'invalid_receipt',
    'Python SQLite Online Backup API receipt is invalid'
  )
}
