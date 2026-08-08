import { afterEach, describe, expect, test } from 'bun:test'
import {
  type Epoch,
  type RoomId,
  type SessionId,
  type ViewerId
} from '@advx/contracts'
import { getTableName } from 'drizzle-orm'

import type {
  DurableOutboxEnqueue,
  DurableOutboxFence,
  DurableOutboxKind,
  RoomRecord,
  SessionRecord
} from '../../../application/ports/repositories'
import { wallClockTimestampMs } from '../../../application/ports/time'
import { AdvxSqliteDatabase } from './database'
import {
  createTemporaryAdvxSqliteDatabase,
  type TemporaryAdvxSqliteDatabase
} from './database-fixture'
import { SqlitePersistenceError } from './errors'
import { calculateMigrationChecksum, runSqliteMigrations } from './migration-runner'
import { ADVX_SQLITE_MIGRATIONS } from './migrations'
import { createSqliteRepositories } from './repositories'
import { durableOutbox } from './schema'
import { SqliteTransactionBoundary } from './transaction'

const cleanups: (() => void)[] = []
const allKinds = [
  'domain_event',
  'memory_side_effect',
  'meme_side_effect',
  'migration_marker',
  'recovery_marker'
] as const satisfies readonly DurableOutboxKind[]

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

describe('DAT-009 durable outbox and restart-surviving jobs', () => {
  test('declares one immutable outbox schema without cascading lifecycle ownership', async () => {
    const { fixture } = await migratedFixture()
    const database = fixture.database.withReadConnection((connection) => connection)
    const columns = database.query('PRAGMA table_info(durable_outbox)').all() as Array<{
      name: string
      dflt_value: string | number | null
    }>
    const table = database
      .query("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get('durable_outbox') as { sql: string }
    const checks = [...table.sql.matchAll(/CONSTRAINT\s+(ck_[a-z0-9_]+)/gi)]
      .map((match) => match[1]!.toLowerCase())
      .sort()
    const indexes = database.query('PRAGMA index_list(durable_outbox)').all() as Array<{
      name: string
      unique: number
    }>

    expect(ADVX_SQLITE_MIGRATIONS).toHaveLength(6)
    expect(
      ADVX_SQLITE_MIGRATIONS.map((migration) =>
        calculateMigrationChecksum(migration.sql)
      )
    ).toEqual(ADVX_SQLITE_MIGRATIONS.map((migration) => migration.checksum))
    expect(getTableName(durableOutbox)).toBe('durable_outbox')
    expect(columns.map((column) => column.name)).toEqual([
      'work_id',
      'idempotency_key',
      'kind',
      'topic',
      'fence_kind',
      'room_id',
      'session_id',
      'audience_epoch',
      'observation_id',
      'viewer_instance_id',
      'viewer_sequence',
      'payload_json',
      'status',
      'attempt_count',
      'available_at_ms',
      'lease_owner',
      'lease_expires_at_ms',
      'last_error_code',
      'created_at_ms',
      'updated_at_ms',
      'settled_at_ms'
    ])
    expect(columns.filter((column) => column.dflt_value !== null)).toEqual([])
    expect(checks).toEqual(
      [
        'ck_durable_outbox_attempt_count_nonnegative',
        'ck_durable_outbox_audience_epoch_positive',
        'ck_durable_outbox_available_after_created',
        'ck_durable_outbox_available_at_nonnegative',
        'ck_durable_outbox_created_at_nonnegative',
        'ck_durable_outbox_fence_consistent',
        'ck_durable_outbox_fence_kind_allowed',
        'ck_durable_outbox_kind_allowed',
        'ck_durable_outbox_lease_expires_nonnegative',
        'ck_durable_outbox_lease_state_consistent',
        'ck_durable_outbox_settled_after_created',
        'ck_durable_outbox_settlement_consistent',
        'ck_durable_outbox_status_allowed',
        'ck_durable_outbox_updated_after_created',
        'ck_durable_outbox_viewer_sequence_nonnegative'
      ].sort()
    )
    expect(indexes.map((index) => index.name)).toContain('ix_durable_outbox_ready')
    expect(indexes.map((index) => index.name)).toContain(
      'ix_durable_outbox_expired_lease'
    )
    expect(table.sql).toContain('CONSTRAINT uq_durable_outbox_idempotency UNIQUE')
    expect(database.query('PRAGMA foreign_key_list(durable_outbox)').all()).toEqual([])
  })

  test('enqueues atomically and enforces exact idempotency without transient payloads', async () => {
    const { repositories } = await migratedFixture()
    const command = outboxCommand({
      workId: 'work-event-1',
      idempotencyKey: 'event:1',
      kind: 'domain_event',
      topic: 'room.event.committed',
      fence: sessionFence(),
      payload: { event_id: 'event-1', sequence: 1 }
    })

    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.rooms.save(
          transaction,
          { ...roomRecord(), revision: 1, updatedAt: wallClockTimestampMs(10) },
          0
        )
        await repositories.outbox.enqueue(transaction, command)
        throw new Error('rollback command')
      }),
      'transaction_failed'
    )
    await repositories.transactions.run(async (transaction) => {
      expect((await repositories.rooms.get(transaction, 'room-1'))?.revision).toBe(0)
      expect(await repositories.outbox.get(transaction, command.workId)).toBeNull()

      expect(await repositories.outbox.enqueue(transaction, command)).toEqual({
        workId: command.workId,
        created: true
      })
      expect(await repositories.outbox.enqueue(transaction, command)).toEqual({
        workId: command.workId,
        created: false
      })
    })

    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.outbox.enqueue(transaction, {
          ...command,
          payload: { event_id: 'event-2', sequence: 2 }
        })
      }),
      'optimistic_conflict'
    )
    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.outbox.enqueue(
          transaction,
          outboxCommand({
            workId: 'work-invalid',
            idempotencyKey: 'invalid:1',
            kind: 'memory_side_effect',
            topic: 'memory.commit',
            fence: sessionFence(),
            payload: { nested: { provider_stream: 'must-not-survive' } }
          })
        )
      }),
      'invalid_record'
    )
  })

  test('reclaims leases after restart and fences stale viewer side effects', async () => {
    const { fixture, repositories } = await migratedFixture()
    await repositories.transactions.run(async (transaction) => {
      repositories.transactions.connection(transaction).run(
        `INSERT INTO session_viewer_instances (
           session_id, viewer_instance_id, persona_id, persona_revision, ordinal,
           display_name, micro_variant_json, viewer_sequence, presence_state,
           created_epoch, state
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'session-1',
          'viewer-1',
          'persona-1',
          1,
          0,
          'Viewer',
          '{}',
          7,
          'active',
          1,
          'active'
        ]
      )
      await repositories.outbox.enqueue(
        transaction,
        outboxCommand({
          workId: 'work-event',
          idempotencyKey: 'event:restart',
          kind: 'domain_event',
          topic: 'room.event.publish',
          fence: sessionFence(),
          payload: { event_id: 'event-restart' },
          createdAt: 10
        })
      )
      await repositories.outbox.enqueue(
        transaction,
        outboxCommand({
          workId: 'work-meme',
          idempotencyKey: 'meme:restart',
          kind: 'meme_side_effect',
          topic: 'meme.commit',
          fence: viewerFence(),
          payload: { candidate_id: 'candidate-1' },
          createdAt: 11
        })
      )
      await repositories.outbox.enqueue(
        transaction,
        outboxCommand({
          workId: 'work-recovery',
          idempotencyKey: 'recovery:restart',
          kind: 'recovery_marker',
          topic: 'recovery.marker',
          fence: noneFence(),
          payload: { schema_version: 1 },
          createdAt: 12
        })
      )
    })

    await repositories.transactions.run(async (transaction) => {
      const first = await repositories.outbox.claim(transaction, {
        workerId: 'worker-before-crash',
        kinds: allKinds,
        now: wallClockTimestampMs(20),
        leaseExpiresAt: wallClockTimestampMs(30),
        limit: 2
      })
      const second = await repositories.outbox.claim(transaction, {
        workerId: 'worker-before-crash',
        kinds: allKinds,
        now: wallClockTimestampMs(20),
        leaseExpiresAt: wallClockTimestampMs(30),
        limit: 2
      })
      expect([...first, ...second]).toHaveLength(3)
      expect([...first, ...second].every((record) => record.attemptCount === 1)).toBe(
        true
      )
    })

    const reopened = reopen(fixture)
    const claimed = await reopened.repositories.transactions.run(
      async (transaction) =>
        await reopened.repositories.outbox.claim(transaction, {
          workerId: 'worker-after-crash',
          kinds: allKinds,
          now: wallClockTimestampMs(31),
          leaseExpiresAt: wallClockTimestampMs(40),
          limit: 100
        })
    )
    expect(claimed).toHaveLength(3)
    expect(claimed.every((record) => record.attemptCount === 2)).toBe(true)

    await reopened.repositories.transactions.run(async (transaction) => {
      for (const record of claimed) {
        expect(
          await reopened.repositories.outbox.fenceCurrent(transaction, {
            workId: record.workId,
            workerId: 'worker-after-crash',
            expectedAttempt: 2
          })
        ).toBe(true)
      }
      reopened.repositories.transactions.connection(transaction).run(
        `UPDATE session_viewer_instances
         SET viewer_sequence = 8
         WHERE session_id = ? AND viewer_instance_id = ?`,
        ['session-1', 'viewer-1']
      )
      const meme = claimed.find((record) => record.kind === 'meme_side_effect')!
      expect(
        await reopened.repositories.outbox.fenceCurrent(transaction, {
          workId: meme.workId,
          workerId: 'worker-after-crash',
          expectedAttempt: 2
        })
      ).toBe(false)
      for (const record of claimed) {
        const cancelled = record.kind === 'meme_side_effect'
        await reopened.repositories.outbox.settle(transaction, {
          workId: record.workId,
          workerId: 'worker-after-crash',
          expectedAttempt: 2,
          status: cancelled ? 'cancelled' : 'completed',
          errorCode: cancelled ? 'stale.viewer_sequence' : null,
          settledAt: wallClockTimestampMs(32)
        })
      }
    })

    const final = reopenDatabase(reopened.database, fixture.dataDirectory)
    await final.repositories.transactions.run(async (transaction) => {
      expect(
        await final.repositories.outbox.claim(transaction, {
          workerId: 'worker-final',
          kinds: allKinds,
          now: wallClockTimestampMs(100),
          leaseExpiresAt: wallClockTimestampMs(110),
          limit: 100
        })
      ).toEqual([])
      expect((await final.repositories.outbox.get(transaction, 'work-event'))?.status)
        .toBe('completed')
      expect((await final.repositories.outbox.get(transaction, 'work-meme'))?.status)
        .toBe('cancelled')
      expect(
        (await final.repositories.outbox.get(transaction, 'work-recovery'))?.status
      ).toBe('completed')
    })
  })

  test('persists retry availability and terminal dead-letter state across restart', async () => {
    const { fixture, repositories } = await migratedFixture()
    await repositories.transactions.run(async (transaction) => {
      await repositories.outbox.enqueue(
        transaction,
        outboxCommand({
          workId: 'work-memory',
          idempotencyKey: 'memory:retry',
          kind: 'memory_side_effect',
          topic: 'memory.commit',
          fence: sessionFence(),
          payload: { candidate_id: 'memory-candidate-1' }
        })
      )
      const [claimed] = await repositories.outbox.claim(transaction, {
        workerId: 'worker-retry',
        kinds: ['memory_side_effect'],
        now: wallClockTimestampMs(10),
        leaseExpiresAt: wallClockTimestampMs(20),
        limit: 1
      })
      expect(claimed?.attemptCount).toBe(1)
      await repositories.outbox.retry(transaction, {
        workId: 'work-memory',
        workerId: 'worker-retry',
        expectedAttempt: 1,
        errorCode: 'provider.unavailable',
        retriedAt: wallClockTimestampMs(11),
        availableAt: wallClockTimestampMs(50)
      })
    })

    const reopened = reopen(fixture)
    await reopened.repositories.transactions.run(async (transaction) => {
      expect(
        await reopened.repositories.outbox.claim(transaction, {
          workerId: 'worker-retry-2',
          kinds: ['memory_side_effect'],
          now: wallClockTimestampMs(49),
          leaseExpiresAt: wallClockTimestampMs(59),
          limit: 1
        })
      ).toEqual([])
      const [claimed] = await reopened.repositories.outbox.claim(transaction, {
        workerId: 'worker-retry-2',
        kinds: ['memory_side_effect'],
        now: wallClockTimestampMs(50),
        leaseExpiresAt: wallClockTimestampMs(60),
        limit: 1
      })
      expect(claimed?.attemptCount).toBe(2)
      const settled = await reopened.repositories.outbox.settle(transaction, {
        workId: 'work-memory',
        workerId: 'worker-retry-2',
        expectedAttempt: 2,
        status: 'dead_letter',
        errorCode: 'retry.exhausted',
        settledAt: wallClockTimestampMs(51)
      })
      expect(settled.status).toBe('dead_letter')
      expect(settled.lastErrorCode).toBe('retry.exhausted')
    })

    const final = reopenDatabase(reopened.database, fixture.dataDirectory)
    await final.repositories.transactions.run(async (transaction) => {
      expect(
        await final.repositories.outbox.claim(transaction, {
          workerId: 'worker-never',
          kinds: ['memory_side_effect'],
          now: wallClockTimestampMs(100),
          leaseExpiresAt: wallClockTimestampMs(110),
          limit: 1
        })
      ).toEqual([])
      expect(
        (await final.repositories.outbox.get(transaction, 'work-memory'))?.status
      ).toBe('dead_letter')
    })
  })
})

async function migratedFixture() {
  const fixture = createTemporaryAdvxSqliteDatabase('advx-dat-009-')
  cleanups.push(fixture.cleanup)
  await runSqliteMigrations({
    database: fixture.database.withWriteConnection((database) => database),
    databasePath: fixture.database.path,
    migrations: ADVX_SQLITE_MIGRATIONS,
    appVersion: 'dat-009-test',
    nowMs: () => 1
  })
  const repositories = repositoriesFor(fixture.database)
  await repositories.transactions.run(async (transaction) => {
    await repositories.rooms.save(transaction, roomRecord(), null)
    await repositories.sessions.save(transaction, sessionRecord(), null)
  })
  return { fixture, repositories }
}

function reopen(fixture: TemporaryAdvxSqliteDatabase) {
  return reopenDatabase(fixture.database, fixture.dataDirectory)
}

function reopenDatabase(database: AdvxSqliteDatabase, dataDirectory: string) {
  database.close()
  const reopened = new AdvxSqliteDatabase({ dataDirectory })
  reopened.initialize()
  cleanups.push(() => reopened.close())
  return { database: reopened, repositories: repositoriesFor(reopened) }
}

function repositoriesFor(database: AdvxSqliteDatabase) {
  return createSqliteRepositories(new SqliteTransactionBoundary(database))
}

function roomRecord(): RoomRecord {
  return {
    roomId: 'room-1' as RoomId,
    displayName: 'Room',
    state: 'active',
    revision: 0,
    createdAt: wallClockTimestampMs(1),
    updatedAt: wallClockTimestampMs(1)
  }
}

function sessionRecord(): SessionRecord {
  return {
    sessionId: 'session-1' as SessionId,
    roomId: 'room-1' as RoomId,
    state: 'running',
    revision: 0,
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

function outboxCommand(
  input: Readonly<{
    workId: string
    idempotencyKey: string
    kind: DurableOutboxKind
    topic: string
    fence: DurableOutboxFence
    payload: DurableOutboxEnqueue['payload']
    createdAt?: number
  }>
): DurableOutboxEnqueue {
  const createdAt = input.createdAt ?? 10
  return {
    ...input,
    createdAt: wallClockTimestampMs(createdAt),
    availableAt: wallClockTimestampMs(createdAt)
  }
}

function noneFence(): DurableOutboxFence {
  return {
    kind: 'none',
    roomId: null,
    sessionId: null,
    audienceEpoch: null,
    observationId: null,
    viewerId: null,
    viewerSequence: null
  }
}

function sessionFence(): DurableOutboxFence {
  return {
    kind: 'session_epoch',
    roomId: 'room-1' as RoomId,
    sessionId: 'session-1' as SessionId,
    audienceEpoch: 1 as Epoch,
    observationId: 'observation-1',
    viewerId: null,
    viewerSequence: null
  }
}

function viewerFence(): DurableOutboxFence {
  return {
    kind: 'viewer_sequence',
    roomId: 'room-1' as RoomId,
    sessionId: 'session-1' as SessionId,
    audienceEpoch: 1 as Epoch,
    observationId: 'observation-1',
    viewerId: 'viewer-1' as ViewerId,
    viewerSequence: 7
  }
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
