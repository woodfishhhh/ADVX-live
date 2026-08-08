export type SqliteFaultKind =
  | 'locked'
  | 'busy_timeout'
  | 'read_only'
  | 'write_failed'
  | 'corrupted'
  | 'future_schema'
  | 'interrupted_migration'
  | 'transaction_exception'
  | 'crash_before_commit'
  | 'crash_after_commit'
  | 'sidecar_mismatch'
  | 'missing_database'
  | 'unknown'

export type SqliteFaultDisposition =
  | 'retryable'
  | 'failed_closed'
  | 'rolled_back'
  | 'committed'

export type SqliteCommitState =
  | 'not_started'
  | 'rolled_back'
  | 'committed'
  | 'unknown'

export type SqliteFaultOperation =
  | 'startup'
  | 'open_existing'
  | 'lock_acquire'
  | 'busy_timeout'
  | 'write'
  | 'migration'
  | 'transaction'
  | 'checkpoint'

export type SqliteFaultContext = Readonly<{
  operation: SqliteFaultOperation
  priorCopyPreserved?: boolean
}>

export type SqliteFaultStatus = Readonly<{
  schemaVersion: 1
  kind: SqliteFaultKind
  disposition: SqliteFaultDisposition
  safe: boolean
  retryable: boolean
  priorCopyPreserved: boolean
  databaseUsable: boolean
  commitState: SqliteCommitState
  recoveryAction:
    | 'retry_after_lock'
    | 'select_writable_storage'
    | 'restore_verified_backup'
    | 'reject_future_schema'
    | 'discard_working_copy'
    | 'rollback_transaction'
    | 'reopen_and_reconcile'
    | 'repair_sidecar_set'
    | 'fix_data_directory'
    | 'operator_review'
  sqliteCode: string | null
}>

export type SqliteFaultResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; fault: SqliteFaultStatus }>

export async function runWithSqliteFaultStatus<T>(
  context: SqliteFaultContext,
  operation: () => T | Promise<T>
): Promise<SqliteFaultResult<T>> {
  try {
    return Object.freeze({ ok: true, value: await operation() })
  } catch (error) {
    return Object.freeze({
      ok: false,
      fault: classifySqliteFault(error, context)
    })
  }
}

export function classifySqliteFault(
  error: unknown,
  context: SqliteFaultContext
): SqliteFaultStatus {
  const codes = errorCodes(error)
  const sqliteCode = codes.find((code) => code.startsWith('SQLITE_')) ?? null
  const has = (...expected: readonly string[]) =>
    expected.some((code) => codes.includes(code))

  let kind: SqliteFaultKind
  if (has('sidecar_mismatch')) {
    kind = 'sidecar_mismatch'
  } else if (has('database_missing')) {
    kind = 'missing_database'
  } else if (has('future_schema')) {
    kind = 'future_schema'
  } else if (has('migration_failed')) {
    kind = 'interrupted_migration'
  } else if (has('transaction_failed')) {
    kind = 'transaction_exception'
  } else if (
    has('SQLITE_BUSY', 'SQLITE_LOCKED', 'writable_owner_exists')
  ) {
    kind = context.operation === 'busy_timeout' ? 'busy_timeout' : 'locked'
  } else if (
    has(
      'SQLITE_READONLY',
      'SQLITE_PERM',
      'SQLITE_CANTOPEN',
      'EACCES',
      'EPERM',
      'permission_failed'
    )
  ) {
    kind = 'read_only'
  } else if (
    has(
      'SQLITE_FULL',
      'SQLITE_IOERR',
      'SQLITE_NOMEM',
      'ENOSPC',
      'checkpoint_failed'
    )
  ) {
    kind = 'write_failed'
  } else if (
    has(
      'SQLITE_CORRUPT',
      'SQLITE_NOTADB',
      'integrity_check_failed'
    )
  ) {
    kind = 'corrupted'
  } else {
    kind = 'unknown'
  }
  return statusFor(kind, sqliteCode, context.priorCopyPreserved ?? true)
}

export function sqliteCrashRecoveryStatus(input: Readonly<{
  commitAttempted: boolean
  durableRowPresent: boolean
  priorCopyPreserved?: boolean
}>): SqliteFaultStatus {
  const priorCopyPreserved = input.priorCopyPreserved ?? true
  if (!input.commitAttempted && !input.durableRowPresent) {
    return statusFor('crash_before_commit', null, priorCopyPreserved)
  }
  if (input.commitAttempted && input.durableRowPresent) {
    return statusFor('crash_after_commit', null, priorCopyPreserved)
  }
  return statusFor('unknown', null, priorCopyPreserved)
}

function statusFor(
  kind: SqliteFaultKind,
  sqliteCode: string | null,
  priorCopyPreserved: boolean
): SqliteFaultStatus {
  const retryable = kind === 'locked' || kind === 'busy_timeout'
  const rolledBack =
    kind === 'interrupted_migration' ||
    kind === 'transaction_exception' ||
    kind === 'crash_before_commit'
  const committed = kind === 'crash_after_commit'
  const disposition: SqliteFaultDisposition = retryable
    ? 'retryable'
    : rolledBack
      ? 'rolled_back'
      : committed
        ? 'committed'
        : 'failed_closed'
  const commitState: SqliteCommitState = committed
    ? 'committed'
    : rolledBack
      ? 'rolled_back'
      : kind === 'unknown'
        ? 'unknown'
        : 'not_started'
  const databaseUsable = ![
    'corrupted',
    'sidecar_mismatch',
    'missing_database',
    'unknown'
  ].includes(kind)

  return Object.freeze({
    schemaVersion: 1,
    kind,
    disposition,
    safe: kind !== 'unknown',
    retryable,
    priorCopyPreserved,
    databaseUsable,
    commitState,
    recoveryAction: recoveryAction(kind),
    sqliteCode
  })
}

function recoveryAction(kind: SqliteFaultKind): SqliteFaultStatus['recoveryAction'] {
  switch (kind) {
    case 'locked':
    case 'busy_timeout':
      return 'retry_after_lock'
    case 'read_only':
      return 'select_writable_storage'
    case 'write_failed':
    case 'corrupted':
      return 'restore_verified_backup'
    case 'future_schema':
      return 'reject_future_schema'
    case 'interrupted_migration':
      return 'discard_working_copy'
    case 'transaction_exception':
      return 'rollback_transaction'
    case 'crash_before_commit':
    case 'crash_after_commit':
      return 'reopen_and_reconcile'
    case 'sidecar_mismatch':
      return 'repair_sidecar_set'
    case 'missing_database':
      return 'fix_data_directory'
    case 'unknown':
      return 'operator_review'
  }
}

function errorCodes(error: unknown): readonly string[] {
  const codes: string[] = []
  const seen = new Set<object>()
  let current = error
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof current !== 'object' || current === null || seen.has(current)) break
    seen.add(current)
    const record = current as Record<string, unknown>
    if (typeof record.code === 'string') codes.push(record.code)
    current = record.cause
  }
  return Object.freeze(codes)
}
