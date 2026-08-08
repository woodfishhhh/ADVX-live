import { afterEach, describe, expect, test } from 'bun:test'
import {
  type Epoch,
  type Revision,
  type RoomEventSource,
  type RoomId,
  type SessionId
} from '@advx/contracts'
import { getTableName } from 'drizzle-orm'

import type {
  RoomEventPayload,
  RoomMemoryCandidate,
  RoomRecord,
  SessionRecord
} from '../../../application/ports/repositories'
import { wallClockTimestampMs } from '../../../application/ports/time'
import { createTemporaryAdvxSqliteDatabase } from './database-fixture'
import { SqlitePersistenceError } from './errors'
import { ADVX_SQLITE_MIGRATIONS } from './migrations'
import { calculateMigrationChecksum, runSqliteMigrations } from './migration-runner'
import { createSqliteRepositories } from './repositories'
import { createRoomEventRecord } from './room-event-repository'
import {
  roomLongTermMemories,
  roomMemoryCandidates,
  roomMemoryEvidence,
  roomMemoryHeads
} from './schema'
import { SqliteTransactionBoundary } from './transaction'

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

describe('DAT-007 Room long-term memory persistence', () => {
  test('migrates the four parity tables and initializes memory heads', async () => {
    const fixture = createTemporaryAdvxSqliteDatabase('advx-dat-007-schema-')
    cleanups.push(fixture.cleanup)
    const database = fixture.database.withWriteConnection((connection) => connection)
    await runSqliteMigrations({
      database,
      databasePath: fixture.database.path,
      migrations: ADVX_SQLITE_MIGRATIONS.slice(0, 3),
      appVersion: 'dat-007-before-memory',
      nowMs: () => 1
    })
    database.run(
      `INSERT INTO rooms (
         room_id, display_name, state, revision, created_at_ms, updated_at_ms
       ) VALUES ('existing-room', 'Existing', 'active', 7, 10, 20)`
    )
    await runSqliteMigrations({
      database,
      databasePath: fixture.database.path,
      migrations: ADVX_SQLITE_MIGRATIONS,
      appVersion: 'dat-007-memory',
      nowMs: () => 2
    })

    expect(ADVX_SQLITE_MIGRATIONS).toHaveLength(6)
    expect(
      ADVX_SQLITE_MIGRATIONS.map((migration) =>
        calculateMigrationChecksum(migration.sql)
      )
    ).toEqual(ADVX_SQLITE_MIGRATIONS.map((migration) => migration.checksum))
    expect(getTableName(roomLongTermMemories)).toBe('room_long_term_memories')
    expect(getTableName(roomMemoryHeads)).toBe('room_memory_heads')
    expect(getTableName(roomMemoryEvidence)).toBe('room_memory_evidence')
    expect(getTableName(roomMemoryCandidates)).toBe('room_memory_candidates')

    const expectedColumns = {
      room_long_term_memories: [
        'memory_id',
        'room_id',
        'memory_type',
        'content',
        'tags_json',
        'importance',
        'confidence',
        'origin',
        'state',
        'superseded_by',
        'last_recalled_at_ms',
        'expires_at_ms',
        'revision',
        'created_at_ms',
        'updated_at_ms'
      ],
      room_memory_heads: ['room_id', 'revision', 'updated_at_ms'],
      room_memory_evidence: [
        'memory_id',
        'event_id',
        'source_type',
        'occurred_at_ms',
        'evidence_summary'
      ],
      room_memory_candidates: [
        'candidate_id',
        'room_id',
        'idempotency_key',
        'base_revision',
        'candidate_type',
        'content',
        'tags_json',
        'evidence_event_ids_json',
        'outcome',
        'result_memory_id',
        'decision_json',
        'created_at_ms',
        'updated_at_ms'
      ]
    } as const
    const expectedChecks = {
      room_long_term_memories: [
        'ck_room_long_term_memories_confidence_range',
        'ck_room_long_term_memories_created_at_nonnegative',
        'ck_room_long_term_memories_importance_range',
        'ck_room_long_term_memories_not_self_superseded',
        'ck_room_long_term_memories_revision_positive',
        'ck_room_long_term_memories_state_allowed',
        'ck_room_long_term_memories_updated_after_created'
      ],
      room_memory_heads: [
        'ck_room_memory_heads_revision_nonnegative',
        'ck_room_memory_heads_updated_at_nonnegative'
      ],
      room_memory_evidence: [
        'ck_room_memory_evidence_occurred_at_nonnegative'
      ],
      room_memory_candidates: [
        'ck_room_memory_candidates_base_revision_nonnegative',
        'ck_room_memory_candidates_created_at_nonnegative',
        'ck_room_memory_candidates_outcome_allowed',
        'ck_room_memory_candidates_updated_after_created'
      ]
    } as const satisfies Readonly<
      Record<keyof typeof expectedColumns, readonly string[]>
    >
    for (const [table, names] of Object.entries(expectedColumns)) {
      const columns = database.query(`PRAGMA table_info(${table})`).all() as Array<{
        name: string
        dflt_value: string | number | null
      }>
      expect(columns.map((column) => column.name)).toEqual([...names])
      expect(columns.filter((column) => column.dflt_value !== null)).toEqual([])
      const row = database
        .query("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?")
        .get(table) as { sql: string }
      const checks = [...row.sql.matchAll(/CONSTRAINT\s+(ck_[a-z0-9_]+)/gi)]
        .map((match) => match[1]!.toLowerCase())
        .sort()
      expect(checks).toEqual(
        [...expectedChecks[table as keyof typeof expectedChecks]].sort()
      )
    }
    const evidenceForeignKeys = database
      .query('PRAGMA foreign_key_list(room_memory_evidence)')
      .all() as Array<{ from: string; table: string; on_delete: string }>
    expect(
      evidenceForeignKeys.map((foreignKey) => ({
        from: foreignKey.from,
        table: foreignKey.table,
        onDelete: foreignKey.on_delete
      }))
    ).toEqual([
      {
        table: 'room_long_term_memories',
        from: 'memory_id',
        onDelete: 'CASCADE'
      }
    ])
    expect(
      (database.query('PRAGMA index_list(room_long_term_memories)').all() as Array<{
        name: string
      }>).map((index) => index.name)
    ).toEqual(
      expect.arrayContaining([
        'ix_room_long_term_memories_retrieval',
        'ix_room_long_term_memories_room_state_updated'
      ])
    )
    expect(
      database
        .query('SELECT revision, updated_at_ms FROM room_memory_heads WHERE room_id = ?')
        .get('existing-room')
    ).toEqual({ revision: 0, updated_at_ms: 20 })
  })

  test('commits evidence-backed candidates with exact idempotency and durable snapshots', async () => {
    const { fixture, repositories } = await migratedFixture()
    await appendEvents(repositories, [
      roomEvent(1, 'user_text', { text: 'likes tea' }),
      roomEvent(2, 'audience_barrage', { text: 'generated claim' })
    ])
    const created = await repositories.transactions.run(
      async (transaction) =>
        await repositories.memories.commitCandidate(
          transaction,
          candidate('memory-1', 0, ['event-1']),
          wallClockTimestampMs(20)
        )
    )
    expect(created).toEqual({
      accepted: true,
      memoryId: 'memory-1',
      memoryRevision: 1,
      headRevision: 1,
      created: true
    })

    const replayed = await repositories.transactions.run(
      async (transaction) =>
        await repositories.memories.commitCandidate(
          transaction,
          { ...candidate('memory-1', 0, ['event-1']), baseRevision: 99 as Revision },
          wallClockTimestampMs(30)
        )
    )
    expect(replayed).toEqual({ ...created, created: false })
    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.memories.commitCandidate(
          transaction,
          { ...candidate('memory-1', 0, ['event-1']), content: 'changed retry' },
          wallClockTimestampMs(30)
        )
      }),
      'optimistic_conflict'
    )
    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.memories.commitCandidate(
          transaction,
          candidate('memory-ai-only', 1, ['event-2']),
          wallClockTimestampMs(30)
        )
      }),
      'invalid_record'
    )
    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.memories.commitCandidate(
          transaction,
          candidate('memory-stale', 0, ['event-1']),
          wallClockTimestampMs(30)
        )
      }),
      'optimistic_conflict'
    )

    await repositories.transactions.run(async (transaction) => {
      repositories.transactions.connection(transaction).run(
        'DELETE FROM room_events WHERE event_id = ?',
        ['event-1']
      )
    })
    const restored = await repositories.transactions.run(
      async (transaction) =>
        await repositories.memories.get(transaction, 'room-1', 'memory-1')
    )
    expect(restored.evidence.map((item) => item.eventId)).toEqual(['event-1'])
    expect(restored.evidence[0]?.summary).toContain('likes tea')
    expect(countRows(fixture, 'room_memory_candidates')).toBe(1)
  })

  test('edits, merges, and replaces memories without reselecting superseded values', async () => {
    const { repositories } = await migratedFixture()
    await appendEvents(repositories, [
      roomEvent(1, 'user_text', { text: 'first' }),
      roomEvent(2, 'user_voice', { text: 'second' })
    ])
    await commit(repositories, candidate('memory-1', 0, ['event-1']), 20)
    await commit(repositories, candidate('memory-2', 1, ['event-2']), 30)

    const edited = await repositories.transactions.run(
      async (transaction) =>
        await repositories.memories.edit(transaction, {
          roomId: 'room-1',
          memoryId: 'memory-1',
          expectedRevision: 1 as Revision,
          content: 'edited first',
          confidence: 0.9,
          evidenceEventIds: ['event-1'],
          updatedAt: wallClockTimestampMs(40)
        })
    )
    expect(edited.revision).toBe(2)
    expect(edited.evidence.map((item) => item.eventId)).toEqual(['event-1'])

    const merged = await repositories.transactions.run(
      async (transaction) =>
        await repositories.memories.merge(transaction, {
          roomId: 'room-1',
          memoryId: 'memory-1',
          sourceMemoryId: 'memory-2',
          expectedRevision: 2 as Revision,
          sourceExpectedRevision: 1 as Revision,
          content: 'merged memory',
          updatedAt: wallClockTimestampMs(50)
        })
    )
    expect(merged.revision).toBe(3)
    expect(merged.evidence.map((item) => item.eventId)).toEqual([
      'event-1',
      'event-2'
    ])
    const source = await repositories.transactions.run(
      async (transaction) =>
        await repositories.memories.get(transaction, 'room-1', 'memory-2')
    )
    expect(source.state).toBe('superseded')
    expect(source.supersededBy).toBe('memory-1')

    const replacement = await repositories.transactions.run(
      async (transaction) =>
        await repositories.memories.replace(transaction, {
          roomId: 'room-1',
          memoryId: 'memory-1',
          replacementMemoryId: 'memory-3',
          expectedRevision: 3 as Revision,
          content: 'replacement',
          evidenceEventIds: ['event-1', 'event-2'],
          updatedAt: wallClockTimestampMs(60)
        })
    )
    expect(replacement).toMatchObject({
      memoryId: 'memory-3',
      state: 'active',
      revision: 1,
      origin: 'manual_replace'
    })
    const slice = await repositories.transactions.run(
      async (transaction) =>
        await repositories.memories.readSlice(transaction, {
          roomId: 'room-1',
          evidenceEventIds: ['event-1'],
          observedAt: wallClockTimestampMs(100),
          limit: 10
        })
    )
    expect(slice.memoryRevision).toBe(5)
    expect(slice.memoryIds).toEqual(['memory-3'])
  })

  test('revokes, deletes, resets, and rolls back without leaked memory state', async () => {
    const { fixture, repositories } = await migratedFixture()
    await appendEvents(repositories, [roomEvent(1, 'user_text', { text: 'fact' })])
    await commit(repositories, candidate('memory-1', 0, ['event-1']), 20)
    const revoked = await repositories.transactions.run(
      async (transaction) =>
        await repositories.memories.revoke(
          transaction,
          'room-1',
          'memory-1',
          1 as Revision,
          wallClockTimestampMs(30)
        )
    )
    expect(revoked).toMatchObject({ state: 'revoked', revision: 2 })
    expect(await activeIds(repositories, 40)).toEqual([])
    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.memories.delete(
          transaction,
          'room-1',
          'memory-1',
          1 as Revision,
          wallClockTimestampMs(40)
        )
      }),
      'optimistic_conflict'
    )
    expect(
      await repositories.transactions.run(
        async (transaction) =>
          await repositories.memories.delete(
            transaction,
            'room-1',
            'memory-1',
            2 as Revision,
            wallClockTimestampMs(40)
          )
      )
    ).toBe(true)
    expect(await head(repositories)).toBe(3)

    await commit(repositories, candidate('memory-2', 3, ['event-1']), 50)
    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.memories.reset(
          transaction,
          'room-1',
          3 as Revision,
          wallClockTimestampMs(60)
        )
      }),
      'optimistic_conflict'
    )
    expect(
      await repositories.transactions.run(
        async (transaction) =>
          await repositories.memories.reset(
            transaction,
            'room-1',
            4 as Revision,
            wallClockTimestampMs(60)
          )
      )
    ).toBe(1)
    expect(await head(repositories)).toBe(5)
    expect(await activeIds(repositories, 70)).toEqual([])

    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.memories.commitCandidate(
          transaction,
          candidate('memory-rollback', 5, ['event-1']),
          wallClockTimestampMs(70)
        )
        throw new Error('force rollback')
      }),
      'transaction_failed'
    )
    expect(await head(repositories)).toBe(5)
    expect(countRows(fixture, 'room_long_term_memories')).toBe(0)
    expect(countRows(fixture, 'room_memory_candidates')).toBe(2)
  })
})

async function migratedFixture() {
  const fixture = createTemporaryAdvxSqliteDatabase('advx-dat-007-')
  cleanups.push(fixture.cleanup)
  await runSqliteMigrations({
    database: fixture.database.withWriteConnection((database) => database),
    databasePath: fixture.database.path,
    migrations: ADVX_SQLITE_MIGRATIONS,
    appVersion: 'dat-007-test',
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
    roomId: 'room-1',
    displayName: 'Room',
    state: 'active',
    revision: 0 as Revision,
    createdAt: wallClockTimestampMs(1),
    updatedAt: wallClockTimestampMs(1)
  }
}

function sessionRecord(): SessionRecord {
  return {
    sessionId: 'session-1',
    roomId: 'room-1',
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

function roomEvent(
  sequence: number,
  sourceType: RoomEventSource,
  options: Readonly<{
    text?: string | null
    payload?: RoomEventPayload
  }> = {}
) {
  return createRoomEventRecord({
    eventId: `event-${sequence}`,
    roomId: 'room-1' as RoomId,
    sessionId: 'session-1' as SessionId,
    sequence,
    sourceType,
    sourceId: null,
    audienceEpoch: 1 as Epoch,
    text: options.text ?? null,
    payload: options.payload ?? {},
    occurredAt: wallClockTimestampMs(sequence * 10)
  })
}

function candidate(
  memoryId: string,
  baseRevision: Revision,
  evidenceEventIds: readonly string[]
): RoomMemoryCandidate {
  return {
    candidateId: `candidate-${memoryId}`,
    roomId: 'room-1',
    idempotencyKey: `key-${memoryId}`,
    baseRevision,
    memoryId,
    memoryType: 'real_world_fact',
    content: `content for ${memoryId}`,
    evidenceEventIds,
    tags: ['test'],
    origin: 'extracted',
    importance: 0.5,
    confidence: 0.75
  }
}

async function appendEvents(
  repositories: Awaited<ReturnType<typeof migratedFixture>>['repositories'],
  events: readonly ReturnType<typeof roomEvent>[]
) {
  await repositories.transactions.run(async (transaction) => {
    for (const event of events) await repositories.roomEvents.append(transaction, event)
  })
}

async function commit(
  repositories: Awaited<ReturnType<typeof migratedFixture>>['repositories'],
  memory: RoomMemoryCandidate,
  timestamp: number
) {
  return await repositories.transactions.run(
    async (transaction) =>
      await repositories.memories.commitCandidate(
        transaction,
        memory,
        wallClockTimestampMs(timestamp)
      )
  )
}

async function activeIds(
  repositories: Awaited<ReturnType<typeof migratedFixture>>['repositories'],
  timestamp: number
) {
  return await repositories.transactions.run(async (transaction) => {
    const values = await repositories.memories.listActive(
      transaction,
      'room-1',
      wallClockTimestampMs(timestamp),
      10
    )
    return values.map((item) => item.memoryId)
  })
}

async function head(
  repositories: Awaited<ReturnType<typeof migratedFixture>>['repositories']
) {
  return await repositories.transactions.run(
    async (transaction) => await repositories.memories.headRevision(transaction, 'room-1')
  )
}

function countRows(
  fixture: Awaited<ReturnType<typeof migratedFixture>>['fixture'],
  table: 'room_long_term_memories' | 'room_memory_candidates'
) {
  return fixture.database.withReadConnection((database) => {
    const row = database.query(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number
    }
    return row.count
  })
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
