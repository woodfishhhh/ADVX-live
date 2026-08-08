import { describe, test } from 'bun:test'
import * as fc from 'fast-check'

import type {
  Epoch,
  Revision,
  RoomId,
  SessionId
} from '@advx/contracts'

import {
  transactionContext,
  wallClockTimestampMs,
  type RoomRecord,
  type SessionRecord
} from '../application'
import {
  ADVX_SQLITE_MIGRATIONS,
  createRoomEventRecord,
  createSqliteRepositories,
  createTemporaryAdvxSqliteDatabase,
  runSqliteMigrations,
  SqliteTransactionBoundary
} from '../infrastructure'
import { assertSeededProperty } from './fast-check-evidence'

const ROOM_ID = 'room-tst-004' as RoomId
const SESSION_ID = 'session-tst-004' as SessionId

describe('TST-004 seeded persistence properties', () => {
  test('[database-event-ordering] restores the bounded ascending event tail', async () => {
    await assertSeededProperty(
      'database-event-ordering',
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 1, max: 10_000 }), {
          minLength: 1,
          maxLength: 16
        }),
        fc.integer({ min: 1, max: 16 }),
        async (sequences, requestedLimit) => {
          const fixture = createTemporaryAdvxSqliteDatabase('advx-tst-004-events-')
          try {
            await runSqliteMigrations({
              database: fixture.database.withWriteConnection((database) => database),
              databasePath: fixture.database.path,
              migrations: ADVX_SQLITE_MIGRATIONS,
              appVersion: 'tst-004-property',
              nowMs: () => 1
            })
            const transactions = new SqliteTransactionBoundary(fixture.database)
            const repositories = createSqliteRepositories(transactions)
            await transactions.run(async (transaction) => {
              await repositories.rooms.save(transaction, roomRecord(), null)
              await repositories.sessions.save(transaction, sessionRecord(), null)
              for (const sequence of sequences) {
                await repositories.roomEvents.append(
                  transaction,
                  createRoomEventRecord({
                    eventId: `event-${sequence}`,
                    roomId: ROOM_ID,
                    sessionId: SESSION_ID,
                    sequence,
                    sourceType: 'user_text',
                    sourceId: null,
                    audienceEpoch: 1 as Epoch,
                    text: `event ${sequence}`,
                    payload: { input_id: `input-${sequence}` },
                    occurredAt: wallClockTimestampMs(sequence)
                  })
                )
              }
            })
            const limit = Math.min(requestedLimit, sequences.length)
            const restored = await transactions.run(
              async (transaction) => await repositories.roomEvents.listForRecovery(
                transaction,
                ROOM_ID,
                SESSION_ID,
                1 as Epoch,
                limit
              )
            )
            const expected = [...sequences]
              .sort((left, right) => left - right)
              .slice(-limit)
            invariant(
              JSON.stringify(restored.map((event) => event.sequence)) ===
                JSON.stringify(expected),
              'database recovery order diverged from ascending bounded tail'
            )
          } finally {
            fixture.cleanup()
          }
        }
      ),
      { numRuns: 30 }
    )
  })
})

function roomRecord(): RoomRecord {
  return {
    roomId: ROOM_ID,
    displayName: 'TST-004 Room',
    state: 'active',
    revision: 0 as Revision,
    createdAt: wallClockTimestampMs(1),
    updatedAt: wallClockTimestampMs(1)
  }
}

function sessionRecord(): SessionRecord {
  return {
    sessionId: SESSION_ID,
    roomId: ROOM_ID,
    state: 'running',
    revision: 0 as Revision,
    audienceEpoch: 1 as Epoch,
    activeConfigHash: null,
    recoveryEligible: false,
    lastCleanShutdownAt: null,
    lastRecoveredAt: null,
    clientRequestId: 'tst-004-start',
    clientRequestHash: 'a'.repeat(64),
    startedAt: wallClockTimestampMs(1),
    updatedAt: wallClockTimestampMs(1),
    endedAt: null,
    outcome: null,
    appVersion: '0.1.0'
  }
}

function invariant(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message)
}
