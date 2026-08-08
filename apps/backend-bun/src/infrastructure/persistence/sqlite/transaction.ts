import { drizzle, type BunSQLiteDatabase } from 'drizzle-orm/bun-sqlite'
import type { Database } from 'bun:sqlite'

import {
  transactionContext,
  type TransactionBoundary,
  type TransactionContext
} from '../../../application/ports/repositories'
import type { TraceContext } from '../../../application/ports/observability'
import { AdvxSqliteDatabase } from './database'
import { SqlitePersistenceError } from './errors'
import { advxPersistenceSchema } from './schema'

export class SqliteTransactionBoundary implements TransactionBoundary {
  readonly orm: BunSQLiteDatabase<typeof advxPersistenceSchema>
  #active: TransactionContext | null = null
  #nextTransactionId = 1
  #tail: Promise<void> = Promise.resolve()
  readonly #database: AdvxSqliteDatabase

  constructor(database: AdvxSqliteDatabase) {
    this.#database = database
    this.orm = database.withReadConnection((connection) =>
      drizzle(connection, { schema: advxPersistenceSchema })
    )
  }

  async run<TResult>(
    work: (transaction: TransactionContext) => Promise<TResult>,
    traceContext?: TraceContext
  ): Promise<TResult> {
    let release!: () => void
    const previous = this.#tail
    this.#tail = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous

    const context = transactionContext(`sqlite-${this.#nextTransactionId++}`, traceContext)
    this.#active = context
    const database = this.#database.withWriteConnection((connection) => connection)
    let began = false
    try {
      database.run('BEGIN IMMEDIATE')
      began = true
      const result = await work(context)
      database.run('COMMIT')
      return result
    } catch (error) {
      if (began) {
        try {
          database.run('ROLLBACK')
        } catch {
          // Preserve the application or SQLite failure that caused rollback.
        }
      }
      if (error instanceof SqlitePersistenceError) throw error
      throw new SqlitePersistenceError(
        'transaction_failed',
        'SQLite repository transaction failed',
        { cause: error }
      )
    } finally {
      this.#active = null
      release()
    }
  }

  connection(transaction: TransactionContext): Database {
    if (this.#active !== transaction) {
      throw new SqlitePersistenceError(
        'transaction_context_invalid',
        'repository operation requires the active SQLite transaction context'
      )
    }
    return this.#database.withWriteConnection((connection) => connection)
  }
}
