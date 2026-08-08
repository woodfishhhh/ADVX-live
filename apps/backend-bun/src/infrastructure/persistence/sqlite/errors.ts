import {
  classifySqliteFault,
  type SqliteFaultStatus
} from './fault-status'

export type SqlitePersistenceErrorCode =
  | 'transaction_context_invalid'
  | 'transaction_failed'
  | 'optimistic_conflict'
  | 'not_found'
  | 'invalid_record'
  | 'invariant_violation'

export class SqlitePersistenceError extends Error {
  readonly fault: SqliteFaultStatus

  constructor(
    readonly code: SqlitePersistenceErrorCode,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'SqlitePersistenceError'
    this.fault = classifySqliteFault(this, {
      operation: 'transaction',
      priorCopyPreserved: true
    })
  }
}
