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
  RoomEventRetentionPolicy,
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
import { roomEvents } from './schema'
import { SqliteTransactionBoundary } from './transaction'

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

describe('DAT-006 Room event persistence', () => {
  test('migrates source-tagged events with ordered recovery and exact idempotency', async () => {
    const { fixture, repositories } = await migratedFixture()
    expect(ADVX_SQLITE_MIGRATIONS).toHaveLength(6)
    expect(
      ADVX_SQLITE_MIGRATIONS.map((migration) =>
        calculateMigrationChecksum(migration.sql)
      )
    ).toEqual(ADVX_SQLITE_MIGRATIONS.map((migration) => migration.checksum))
    expect(getTableName(roomEvents)).toBe('room_events')
    const schema = fixture.database.withReadConnection((database) => ({
      columns: (database.query('PRAGMA table_info(room_events)').all() as Array<{
        name: string
        dflt_value: string | number | null
      }>),
      indexes: (database.query('PRAGMA index_list(room_events)').all() as Array<{
        name: string
      }>).map((index) => index.name),
      foreignKeys: (database.query('PRAGMA foreign_key_list(room_events)').all() as Array<{
        from: string
        table: string
        to: string
        on_delete: string
      }>).map((foreignKey) => ({
        from: foreignKey.from,
        table: foreignKey.table,
        to: foreignKey.to,
        onDelete: foreignKey.on_delete
      }))
    }))
    expect(schema.columns.map((column) => column.name)).toEqual([
      'event_id',
      'room_id',
      'session_id',
      'sequence',
      'source_type',
      'source_id',
      'audience_epoch',
      'content_json',
      'content_hash',
      'occurred_at_ms'
    ])
    expect(schema.columns.filter((column) => column.dflt_value !== null)).toEqual([])
    expect(schema.indexes).toContain('ix_room_events_room_occurred_at_ms')
    expect(schema.foreignKeys).toEqual([
      {
        from: 'session_id',
        table: 'session_records',
        to: 'session_id',
        onDelete: 'CASCADE'
      },
      { from: 'room_id', table: 'rooms', to: 'room_id', onDelete: 'CASCADE' }
    ])

    const events = [
      roomEvent(1, 'user_text', {
        text: 'hello',
        payload: { input_id: 'text-1', target_persona_id: 'persona-1' }
      }),
      roomEvent(2, 'user_voice', {
        text: 'final voice',
        payload: {
          audio_source: 'microphone',
          final: true,
          utterance_id: 'utterance-1',
          started_at_ms: 15,
          ended_at_ms: 20
        }
      }),
      roomEvent(3, 'system_event', {
        text: 'final system transcript',
        payload: {
          event: 'system_audio_transcript',
          audio_source: 'system_audio',
          final: true,
          turn_id: 'turn-1'
        }
      }),
      roomEvent(4, 'system_event', {
        payload: { event: 'session_started', revision: 1 }
      }),
      roomEvent(5, 'audience_barrage', {
        sourceId: 'viewer-1',
        text: 'accepted barrage',
        payload: {
          barrage_id: 'barrage-1',
          audience_epoch: 1,
          viewer_instance_id: 'viewer-1',
          target: { kind: 'event', event_id: 'event-1' },
          evidence_refs: [
            { source: 'event', event_id: 'event-1', frame_index: null },
            { source: 'frame', event_id: null, frame_index: 0 }
          ]
        }
      })
    ]
    await repositories.transactions.run(async (transaction) => {
      for (const event of events) {
        expect(await repositories.roomEvents.append(transaction, event)).toBe(true)
      }
      expect(await repositories.roomEvents.append(transaction, events[0]!)).toBe(false)
    })

    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.roomEvents.append(
          transaction,
          roomEvent(1, 'user_text', {
            eventId: 'event-1',
            text: 'changed',
            payload: { input_id: 'text-1' }
          })
        )
      }),
      'optimistic_conflict'
    )
    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.roomEvents.append(
          transaction,
          roomEvent(1, 'user_text', { eventId: 'sequence-collision' })
        )
      }),
      'optimistic_conflict'
    )

    const restored = await repositories.transactions.run(
      async (transaction) =>
        await repositories.roomEvents.listForRecovery(
          transaction,
          'room-1',
          'session-1',
          1 as Epoch,
          16
        )
    )
    expect(restored.map((event) => event.eventId)).toEqual(
      events.map((event) => event.eventId)
    )
    expect(restored.at(-1)?.evidenceEventIds).toEqual(['event-1'])
    expect(restored.at(-1)?.contentHash).toHaveLength(64)
  })

  test('builds bounded public and reply windows without barrage trigger recursion', async () => {
    const { repositories } = await migratedFixture()
    const events = [
      roomEvent(1, 'user_text', {
        eventId: 'old-user',
        occurredAt: 10,
        text: 'forced old input'
      }),
      roomEvent(2, 'user_text', { occurredAt: 95, text: 'recent text' }),
      roomEvent(3, 'user_voice', {
        occurredAt: 96,
        text: 'recent voice',
        payload: { final: true }
      }),
      roomEvent(4, 'screen_observation', {
        occurredAt: 97,
        payload: { summary: 'screen changed' }
      }),
      roomEvent(5, 'system_event', {
        occurredAt: 98,
        payload: { event: 'session_paused' }
      }),
      roomEvent(6, 'system_event', {
        occurredAt: 99,
        text: 'system transcript',
        payload: {
          event: 'system_audio_transcript',
          audio_source: 'system_audio',
          final: true
        }
      }),
      roomEvent(7, 'audience_barrage', {
        eventId: 'parent-barrage',
        occurredAt: 90,
        sourceId: 'viewer-1',
        payload: { barrage_id: 'parent-barrage' }
      }),
      roomEvent(8, 'audience_barrage', {
        eventId: 'child-barrage',
        occurredAt: 100,
        sourceId: 'viewer-2',
        payload: {
          barrage_id: 'child-barrage',
          target: { kind: 'event', event_id: 'parent-barrage' },
          evidence_refs: [{ source: 'event', event_id: 'parent-barrage' }]
        }
      }),
      roomEvent(9, 'user_text', {
        eventId: 'future-user',
        occurredAt: 101,
        text: 'must not enter a context frozen at 100'
      })
    ]
    await repositories.transactions.run(async (transaction) => {
      for (const event of events) await repositories.roomEvents.append(transaction, event)
    })

    const window = await repositories.transactions.run(
      async (transaction) =>
        await repositories.roomEvents.readContextWindow(transaction, {
          roomId: 'room-1' as RoomId,
          sessionId: 'session-1' as SessionId,
          observedAt: wallClockTimestampMs(100),
          publicWindowMs: 10,
          replyWindowMs: 20,
          publicLimit: 3,
          replyLimit: 2,
          triggerEventIds: ['old-user', 'child-barrage']
        })
    )
    expect(window.publicContext.map((event) => event.eventId)).toEqual([
      'old-user',
      'event-4',
      'event-6'
    ])
    expect(window.publicContext.every((event) => event.sourceType !== 'audience_barrage'))
      .toBe(true)
    expect(window.publicContext.some((event) => event.eventId === 'event-5')).toBe(false)
    expect(window.publicContext.some((event) => event.eventId === 'future-user')).toBe(false)
    expect(window.replyContext.map((event) => event.eventId)).toEqual([
      'parent-barrage',
      'child-barrage'
    ])
    expect(window.replyContext.at(-1)?.evidenceEventIds).toEqual(['parent-barrage'])
    expect(window.observationTriggerEventIds).toEqual(['old-user'])
  })

  test('applies source-specific retention in the append transaction', async () => {
    const { fixture, repositories } = await migratedFixture()
    const initial = [
      roomEvent(1, 'user_text', { occurredAt: 10 }),
      roomEvent(2, 'user_text', { occurredAt: 20 }),
      roomEvent(3, 'audience_barrage', { occurredAt: 30 }),
      roomEvent(4, 'audience_barrage', { occurredAt: 40 })
    ]
    await repositories.transactions.run(async (transaction) => {
      for (const event of initial) await repositories.roomEvents.append(transaction, event)
    })

    const policy = retentionPolicy({ user_text: 1, audience_barrage: 2 })
    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        const result = await repositories.roomEvents.appendWithRetention(
          transaction,
          roomEvent(5, 'user_text', { occurredAt: 50 }),
          policy
        )
        expect(result).toEqual({ inserted: true, pruned: 2 })
        throw new Error('force append/prune rollback')
      }),
      'transaction_failed'
    )
    expect(countEvents(fixture)).toBe(4)

    const committed = await repositories.transactions.run(
      async (transaction) =>
        await repositories.roomEvents.appendWithRetention(
          transaction,
          roomEvent(5, 'user_text', { occurredAt: 50 }),
          policy
        )
    )
    expect(committed).toEqual({ inserted: true, pruned: 2 })
    expect(countEvents(fixture)).toBe(3)

    const latest = await repositories.transactions.run(
      async (transaction) =>
        await repositories.roomEvents.listForRecovery(
          transaction,
          'room-1',
          'session-1',
          1 as Epoch,
          2
        )
    )
    expect(latest.map((event) => event.eventId)).toEqual(['event-4', 'event-5'])
  })
})

async function migratedFixture() {
  const fixture = createTemporaryAdvxSqliteDatabase('advx-dat-006-')
  cleanups.push(fixture.cleanup)
  await runSqliteMigrations({
    database: fixture.database.withWriteConnection((database) => database),
    databasePath: fixture.database.path,
    migrations: ADVX_SQLITE_MIGRATIONS,
    appVersion: 'dat-006-test',
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
    eventId?: string
    sourceId?: string | null
    occurredAt?: number
    text?: string | null
    payload?: RoomEventPayload
  }> = {}
) {
  return createRoomEventRecord({
    eventId: options.eventId ?? `event-${sequence}`,
    roomId: 'room-1' as RoomId,
    sessionId: 'session-1' as SessionId,
    sequence,
    sourceType,
    sourceId: options.sourceId ?? null,
    audienceEpoch: 1 as Epoch,
    text: options.text ?? null,
    payload: options.payload ?? {},
    occurredAt: wallClockTimestampMs(options.occurredAt ?? sequence * 10)
  })
}

function retentionPolicy(
  maximums: Partial<Record<RoomEventSource, number>>
): RoomEventRetentionPolicy {
  return {
    user_text: retentionRule(maximums.user_text),
    user_voice: retentionRule(maximums.user_voice),
    audience_barrage: retentionRule(maximums.audience_barrage),
    screen_observation: retentionRule(maximums.screen_observation),
    system_event: retentionRule(maximums.system_event)
  }
}

function retentionRule(maxEvents = 16) {
  return { keepAfter: wallClockTimestampMs(0), maxEvents }
}

function countEvents(fixture: Awaited<ReturnType<typeof migratedFixture>>['fixture']) {
  return fixture.database.withReadConnection((database) => {
    const row = database.query('SELECT COUNT(*) AS count FROM room_events').get() as {
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
