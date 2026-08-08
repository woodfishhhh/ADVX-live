import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AdvxSqliteDatabase } from './database'

export type TemporaryAdvxSqliteDatabase = Readonly<{
  dataDirectory: string
  database: AdvxSqliteDatabase
  cleanup(): void
}>

export function createTemporaryAdvxSqliteDatabase(
  prefix = 'advx-sqlite-fixture-'
): TemporaryAdvxSqliteDatabase {
  const dataDirectory = mkdtempSync(join(tmpdir(), prefix))
  const database = new AdvxSqliteDatabase({ dataDirectory })
  try {
    database.initialize()
  } catch (error) {
    rmSync(dataDirectory, { recursive: true, force: true })
    throw error
  }

  let cleaned = false
  return Object.freeze({
    dataDirectory,
    database,
    cleanup() {
      if (cleaned) return
      cleaned = true
      try {
        database.close()
        Bun.gc(true)
      } finally {
        rmSync(dataDirectory, { recursive: true, force: true })
      }
    }
  })
}
