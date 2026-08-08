import { afterEach, describe, expect, test } from 'bun:test'
import {
  type Epoch,
  type Revision,
  type RoomId,
  type SessionId
} from '@advx/contracts'
import { getTableName } from 'drizzle-orm'

import type {
  ModeMemeCandidate,
  RoomRecord,
  SessionRecord
} from '../../../application/ports/repositories'
import { wallClockTimestampMs } from '../../../application/ports/time'
import { createTemporaryAdvxSqliteDatabase } from './database-fixture'
import { SqlitePersistenceError } from './errors'
import { ADVX_SQLITE_MIGRATIONS } from './migrations'
import { calculateMigrationChecksum, runSqliteMigrations } from './migration-runner'
import { createSqliteRepositories } from './repositories'
import {
  modeMemeCandidates,
  modeMemeEvents,
  modeMemeSettings,
  modeMemes
} from './schema'
import { SqliteTransactionBoundary } from './transaction'

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

describe('DAT-008 Mode meme persistence', () => {
  test('migrates the exact four-table DAT-001 schema without inferred defaults', async () => {
    const fixture = createTemporaryAdvxSqliteDatabase('advx-dat-008-schema-')
    cleanups.push(fixture.cleanup)
    const database = fixture.database.withWriteConnection((connection) => connection)
    await runSqliteMigrations({
      database,
      databasePath: fixture.database.path,
      migrations: ADVX_SQLITE_MIGRATIONS,
      appVersion: 'dat-008-schema',
      nowMs: () => 1
    })

    expect(ADVX_SQLITE_MIGRATIONS).toHaveLength(6)
    expect(
      ADVX_SQLITE_MIGRATIONS.map((migration) =>
        calculateMigrationChecksum(migration.sql)
      )
    ).toEqual(ADVX_SQLITE_MIGRATIONS.map((migration) => migration.checksum))
    expect(getTableName(modeMemes)).toBe('mode_memes')
    expect(getTableName(modeMemeEvents)).toBe('mode_meme_events')
    expect(getTableName(modeMemeCandidates)).toBe('mode_meme_candidates')
    expect(getTableName(modeMemeSettings)).toBe('mode_meme_settings')

    const expectedColumns = {
      mode_memes: [
        'meme_id',
        'mode_namespace',
        'content',
        'intensity',
        'state',
        'source_json',
        'revision',
        'created_at_ms',
        'updated_at_ms'
      ],
      mode_meme_events: [
        'event_id',
        'meme_id',
        'action',
        'payload_json',
        'previous_revision',
        'new_revision',
        'created_at_ms'
      ],
      mode_meme_candidates: [
        'candidate_id',
        'room_id',
        'session_id',
        'audience_epoch',
        'observation_id',
        'mode_namespace',
        'idempotency_key',
        'text',
        'evidence_event_ids_json',
        'evidence_frame_indexes_json',
        'outcome',
        'result_meme_id',
        'created_at_ms',
        'updated_at_ms'
      ],
      mode_meme_settings: [
        'mode_namespace',
        'auto_ingest_enabled',
        'revision',
        'created_at_ms',
        'updated_at_ms'
      ]
    } as const
    const expectedChecks = {
      mode_memes: [
        'ck_mode_memes_created_at_nonnegative',
        'ck_mode_memes_intensity_range',
        'ck_mode_memes_revision_positive',
        'ck_mode_memes_state_allowed',
        'ck_mode_memes_updated_after_created'
      ],
      mode_meme_events: [
        'ck_mode_meme_events_action_allowed',
        'ck_mode_meme_events_created_at_nonnegative',
        'ck_mode_meme_events_new_revision_positive',
        'ck_mode_meme_events_previous_revision_nonnegative'
      ],
      mode_meme_candidates: [
        'ck_mode_meme_candidates_audience_epoch_positive',
        'ck_mode_meme_candidates_created_at_nonnegative',
        'ck_mode_meme_candidates_outcome_allowed',
        'ck_mode_meme_candidates_updated_after_created'
      ],
      mode_meme_settings: [
        'ck_mode_meme_settings_created_at_nonnegative',
        'ck_mode_meme_settings_revision_positive',
        'ck_mode_meme_settings_updated_after_created'
      ]
    } as const
    const expectedTypes = {
      mode_memes: [
        'TEXT',
        'TEXT',
        'TEXT',
        'FLOAT',
        'TEXT',
        'TEXT',
        'INTEGER',
        'INTEGER',
        'INTEGER'
      ],
      mode_meme_events: [
        'TEXT',
        'TEXT',
        'TEXT',
        'TEXT',
        'INTEGER',
        'INTEGER',
        'INTEGER'
      ],
      mode_meme_candidates: [
        'TEXT',
        'TEXT',
        'TEXT',
        'INTEGER',
        'TEXT',
        'TEXT',
        'TEXT',
        'TEXT',
        'TEXT',
        'TEXT',
        'TEXT',
        'TEXT',
        'INTEGER',
        'INTEGER'
      ],
      mode_meme_settings: ['TEXT', 'BOOLEAN', 'INTEGER', 'INTEGER', 'INTEGER']
    } as const
    for (const [table, expected] of Object.entries(expectedChecks)) {
      const columns = database.query(`PRAGMA table_info(${table})`).all() as Array<{
        name: string
        type: string
        dflt_value: string | number | null
      }>
      expect(columns.map((column) => column.name)).toEqual([
        ...expectedColumns[table as keyof typeof expectedColumns]
      ])
      expect(columns.map((column) => column.type)).toEqual([
        ...expectedTypes[table as keyof typeof expectedTypes]
      ])
      expect(columns.filter((column) => column.dflt_value !== null)).toEqual([])
      const row = database
        .query("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?")
        .get(table) as { sql: string }
      const actual = [...row.sql.matchAll(/CONSTRAINT\s+(ck_[a-z0-9_]+)/gi)]
        .map((match) => match[1]!.toLowerCase())
        .sort()
      expect(actual).toEqual([...expected].sort())
    }
    expect(
      (database.query('PRAGMA foreign_key_list(mode_meme_candidates)').all() as Array<{
        from: string
        table: string
        on_delete: string
      }>).map((foreignKey) => ({
        from: foreignKey.from,
        table: foreignKey.table,
        onDelete: foreignKey.on_delete
      }))
    ).toEqual(
      expect.arrayContaining([
        { from: 'room_id', table: 'rooms', onDelete: 'CASCADE' },
        { from: 'session_id', table: 'session_records', onDelete: 'CASCADE' },
        { from: 'result_meme_id', table: 'mode_memes', onDelete: 'SET NULL' }
      ])
    )
  })

  test('persists pending, accepted, and rejected candidates with exact idempotency', async () => {
    const { fixture, repositories } = await migratedFixture()
    await repositories.transactions.run(async (transaction) => {
      expect(await repositories.modeMemes.getAutoIngest(transaction, 'mode-a')).toEqual({
        namespaceId: 'mode-a',
        enabled: true,
        revision: 0
      })
      expect(
        await repositories.modeMemes.setAutoIngest(
          transaction,
          'mode-a',
          false,
          0 as Revision,
          wallClockTimestampMs(5)
        )
      ).toEqual({ namespaceId: 'mode-a', enabled: false, revision: 1 })
    })
    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.modeMemes.setAutoIngest(
          transaction,
          'mode-a',
          true,
          0 as Revision,
          wallClockTimestampMs(6)
        )
      }),
      'optimistic_conflict'
    )

    const pending = candidate('candidate-a', 'mode-a', 10)
    await repositories.transactions.run(async (transaction) => {
      await repositories.modeMemes.saveCandidate(transaction, pending)
      await repositories.modeMemes.saveCandidate(transaction, pending)
      expect(await repositories.modeMemes.listPending(transaction, 'mode-a')).toEqual([
        pending
      ])
    })
    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.modeMemes.saveCandidate(transaction, {
          ...pending,
          text: 'changed'
        })
      }),
      'optimistic_conflict'
    )

    const approved = await repositories.transactions.run(
      async (transaction) =>
        await repositories.modeMemes.approveCandidate(
          transaction,
          'mode-a',
          pending.candidateId,
          wallClockTimestampMs(20)
        )
    )
    expect(approved).toEqual({
      accepted: true,
      memeId: 'meme:candidate-a',
      created: true
    })
    await repositories.transactions.run(async (transaction) => {
      expect(await repositories.modeMemes.commitCandidate(transaction, pending)).toEqual({
        accepted: true,
        memeId: 'meme:candidate-a',
        created: false
      })
      const meme = await repositories.modeMemes.get(
        transaction,
        'mode-a',
        'meme:candidate-a'
      )
      expect(meme.source).toEqual({
        roomId: 'room-1',
        sessionId: 'session-1',
        audienceEpoch: 1,
        observationId: 'observation-candidate-a',
        sourceCandidateId: 'candidate-a',
        evidenceEventIds: ['event-1'],
        evidenceFrameIndexes: [0, 2],
        pinned: false,
        useCount: 0,
        lastUsedAt: null
      })
      expect(await repositories.modeMemes.listPending(transaction, 'mode-a')).toEqual([])
    })
    expect(
      fixture.database.withReadConnection(
        (database) =>
          (
            database
              .query('SELECT source_json FROM mode_memes WHERE meme_id = ?')
              .get('meme:candidate-a') as { source_json: string }
          ).source_json
      )
    ).toBe(
      '{"audience_epoch":1,"evidence_event_ids":["event-1"],"evidence_frame_indexes":[0,2],"last_used_at_ms":null,"observation_id":"observation-candidate-a","pinned":false,"room_id":"room-1","session_id":"session-1","source_candidate_id":"candidate-a","use_count":0}'
    )

    const rejected = candidate('candidate-b', 'mode-b', 30)
    await repositories.transactions.run(async (transaction) => {
      await repositories.modeMemes.saveCandidate(transaction, rejected)
      expect(
        await repositories.modeMemes.rejectCandidate(
          transaction,
          'mode-b',
          rejected.candidateId,
          wallClockTimestampMs(31)
        )
      ).toEqual({ ...rejected, outcome: 'rejected' })
    })
  })

  test('records revision-checked edits, undo, pinning, use, and lifecycle events', async () => {
    const { repositories } = await migratedFixture()
    await commit(repositories, candidate('candidate-life', 'mode-a', 10))
    let meme = await repositories.transactions.run(
      async (transaction) =>
        await repositories.modeMemes.edit(transaction, {
          namespaceId: 'mode-a',
          memeId: 'meme:candidate-life',
          expectedRevision: 1 as Revision,
          text: 'edited meme',
          intensity: 0.4,
          updatedAt: wallClockTimestampMs(20)
        })
    )
    expect(meme.revision).toBe(2)
    meme = await repositories.transactions.run(
      async (transaction) =>
        await repositories.modeMemes.setPinned(transaction, {
          namespaceId: 'mode-a',
          memeId: meme.memeId,
          expectedRevision: meme.revision,
          pinned: true,
          updatedAt: wallClockTimestampMs(30)
        })
    )
    meme = await repositories.transactions.run(
      async (transaction) =>
        await repositories.modeMemes.recordUse(transaction, {
          namespaceId: 'mode-a',
          memeId: meme.memeId,
          expectedRevision: meme.revision,
          usedAt: wallClockTimestampMs(40)
        })
    )
    expect(meme.source).toMatchObject({ pinned: true, useCount: 1, lastUsedAt: 40 })

    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.modeMemes.changeState(transaction, {
          namespaceId: 'mode-b',
          memeId: meme.memeId,
          expectedRevision: meme.revision,
          state: 'revoked',
          action: 'revoked',
          updatedAt: wallClockTimestampMs(41)
        })
      }),
      'optimistic_conflict'
    )
    meme = await repositories.transactions.run(
      async (transaction) =>
        await repositories.modeMemes.changeState(transaction, {
          namespaceId: 'mode-a',
          memeId: meme.memeId,
          expectedRevision: meme.revision,
          state: 'revoked',
          action: 'revoked',
          updatedAt: wallClockTimestampMs(50)
        })
    )
    expect(meme.state).toBe('revoked')
    await repositories.transactions.run(async (transaction) => {
      expect(await repositories.modeMemes.listActive(transaction, 'mode-a')).toEqual([])
      expect(await repositories.modeMemes.listActive(transaction, 'mode-b')).toEqual([])
    })
    meme = await changeState(repositories, meme, 'active', 'restored', 60)
    meme = await changeState(repositories, meme, 'disabled', 'disabled', 70)
    meme = await changeState(repositories, meme, 'active', 'restored', 80)
    meme = await changeState(repositories, meme, 'archived', 'archived', 90)
    expect(meme.state).toBe('archived')

    await repositories.transactions.run(async (transaction) => {
      const events = await repositories.modeMemes.listEvents(
        transaction,
        'mode-a',
        meme.memeId
      )
      expect(events.map((event) => event.action)).toEqual([
        'created',
        'edited',
        'edited',
        'edited',
        'revoked',
        'restored',
        'disabled',
        'restored',
        'archived'
      ])
      expect(events.map((event) => event.newRevision)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9
      ])
    })
  })

  test('supports decay/archive selection and rolls back candidate or state changes', async () => {
    const { fixture, repositories } = await migratedFixture()
    let low = await commit(repositories, candidate('candidate-low', 'mode-a', 10))
    let pinned = await commit(repositories, candidate('candidate-pinned', 'mode-a', 11))
    low = await repositories.transactions.run(
      async (transaction) =>
        await repositories.modeMemes.edit(transaction, {
          namespaceId: 'mode-a',
          memeId: low.memeId,
          expectedRevision: low.revision,
          text: low.text,
          intensity: 0.2,
          updatedAt: wallClockTimestampMs(20)
        })
    )
    pinned = await repositories.transactions.run(
      async (transaction) =>
        await repositories.modeMemes.setPinned(transaction, {
          namespaceId: 'mode-a',
          memeId: pinned.memeId,
          expectedRevision: pinned.revision,
          pinned: true,
          updatedAt: wallClockTimestampMs(21)
        })
    )

    const maintenanceAt = 31 * 24 * 60 * 60 * 1_000
    await repositories.transactions.run(async (transaction) => {
      const candidates = await repositories.modeMemes.listArchiveCandidates(
        transaction,
        'mode-a',
        wallClockTimestampMs(maintenanceAt - 30 * 24 * 60 * 60 * 1_000)
      )
      expect(candidates.map((meme) => meme.memeId)).toEqual([
        low.memeId,
        pinned.memeId
      ])
      for (const candidate of candidates) {
        if (candidate.source.pinned) continue
        const decayed = await repositories.modeMemes.edit(transaction, {
          namespaceId: 'mode-a',
          memeId: candidate.memeId,
          expectedRevision: candidate.revision,
          text: candidate.text,
          intensity: Math.max(0, candidate.intensity * 0.5),
          updatedAt: wallClockTimestampMs(maintenanceAt)
        })
        if (decayed.intensity <= 0.1 || decayed.source.useCount < 3) {
          await repositories.modeMemes.changeState(transaction, {
            namespaceId: 'mode-a',
            memeId: decayed.memeId,
            expectedRevision: decayed.revision,
            state: 'archived',
            action: 'archived',
            updatedAt: wallClockTimestampMs(maintenanceAt)
          })
        }
      }
    })
    await repositories.transactions.run(async (transaction) => {
      expect(
        (await repositories.modeMemes.get(transaction, 'mode-a', low.memeId)).state
      ).toBe('archived')
      expect(
        (await repositories.modeMemes.get(transaction, 'mode-a', pinned.memeId)).state
      ).toBe('active')
    })

    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.modeMemes.commitCandidate(
          transaction,
          candidate('candidate-rollback', 'mode-a', maintenanceAt + 1)
        )
        throw new Error('rollback candidate')
      }),
      'transaction_failed'
    )
    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.modeMemes.changeState(transaction, {
          namespaceId: 'mode-a',
          memeId: pinned.memeId,
          expectedRevision: pinned.revision,
          state: 'archived',
          action: 'archived',
          updatedAt: wallClockTimestampMs(maintenanceAt + 2)
        })
        throw new Error('rollback state')
      }),
      'transaction_failed'
    )
    expect(countRows(fixture, 'mode_memes')).toBe(2)
    expect(countRows(fixture, 'mode_meme_candidates')).toBe(2)
    await repositories.transactions.run(async (transaction) => {
      expect(
        (await repositories.modeMemes.get(transaction, 'mode-a', pinned.memeId)).state
      ).toBe('active')
    })
  })
})

async function migratedFixture() {
  const fixture = createTemporaryAdvxSqliteDatabase('advx-dat-008-')
  cleanups.push(fixture.cleanup)
  await runSqliteMigrations({
    database: fixture.database.withWriteConnection((database) => database),
    databasePath: fixture.database.path,
    migrations: ADVX_SQLITE_MIGRATIONS,
    appVersion: 'dat-008-test',
    nowMs: () => 1
  })
  const transactions = new SqliteTransactionBoundary(fixture.database)
  const repositories = createSqliteRepositories(transactions)
  await transactions.run(async (transaction) => {
    await repositories.rooms.save(transaction, roomRecord(), null)
    await repositories.sessions.save(transaction, sessionRecord(), null)
  })
  return { fixture, repositories }
}

function roomRecord(): RoomRecord {
  return {
    roomId: 'room-1' as RoomId,
    displayName: 'Room',
    state: 'active',
    revision: 0 as Revision,
    createdAt: wallClockTimestampMs(1),
    updatedAt: wallClockTimestampMs(1)
  }
}

function sessionRecord(): SessionRecord {
  return {
    sessionId: 'session-1' as SessionId,
    roomId: 'room-1' as RoomId,
    state: 'running',
    revision: 0 as Revision,
    audienceEpoch: 1 as Epoch,
    activeConfigHash: null,
    recoveryEligible: false,
    lastCleanShutdownAt: null,
    lastRecoveredAt: null,
    clientRequestId: 'start-1',
    clientRequestHash: 'a'.repeat(64),
    startedAt: wallClockTimestampMs(1),
    updatedAt: wallClockTimestampMs(1),
    endedAt: null,
    outcome: null,
    appVersion: '0.1.0'
  }
}

function candidate(
  candidateId: string,
  namespaceId: string,
  createdAt: number
): ModeMemeCandidate {
  return {
    candidateId,
    roomId: 'room-1' as RoomId,
    sessionId: 'session-1' as SessionId,
    audienceEpoch: 1 as Epoch,
    observationId: `observation-${candidateId}`,
    namespaceId,
    text: `meme text ${candidateId}`,
    idempotencyKey: null,
    evidenceEventIds: ['event-1'],
    evidenceFrameIndexes: [0, 2],
    outcome: 'pending',
    createdAt: wallClockTimestampMs(createdAt)
  }
}

async function commit(
  repositories: Awaited<ReturnType<typeof migratedFixture>>['repositories'],
  value: ModeMemeCandidate
) {
  await repositories.transactions.run(async (transaction) => {
    await repositories.modeMemes.commitCandidate(transaction, value)
  })
  return await repositories.transactions.run(
    async (transaction) =>
      await repositories.modeMemes.get(
        transaction,
        value.namespaceId,
        `meme:${value.candidateId}`
      )
  )
}

async function changeState(
  repositories: Awaited<ReturnType<typeof migratedFixture>>['repositories'],
  meme: Awaited<ReturnType<typeof commit>>,
  state: 'active' | 'disabled' | 'archived' | 'revoked',
  action: 'restored' | 'disabled' | 'archived' | 'revoked',
  updatedAt: number
) {
  return await repositories.transactions.run(
    async (transaction) =>
      await repositories.modeMemes.changeState(transaction, {
        namespaceId: meme.namespaceId,
        memeId: meme.memeId,
        expectedRevision: meme.revision,
        state,
        action,
        updatedAt: wallClockTimestampMs(updatedAt)
      })
  )
}

function countRows(
  fixture: Awaited<ReturnType<typeof migratedFixture>>['fixture'],
  table: string
): number {
  return fixture.database.withReadConnection(
    (database) =>
      (database.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
        count: number
      }).count
  )
}

async function expectPersistenceCode(
  promise: Promise<unknown>,
  code: SqlitePersistenceError['code']
): Promise<void> {
  try {
    await promise
    throw new Error(`expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(SqlitePersistenceError)
    expect((error as SqlitePersistenceError).code).toBe(code)
  }
}
