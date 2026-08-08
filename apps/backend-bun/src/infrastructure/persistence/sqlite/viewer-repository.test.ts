import { afterEach, describe, expect, test } from 'bun:test'
import { getTableName } from 'drizzle-orm'
import type { Epoch, Revision } from '@advx/contracts'

import type {
  RoomRecord,
  SessionRecord,
  ViewerInstanceRecord,
  ViewerPrivateState
} from '../../../application/ports/repositories'
import { wallClockTimestampMs } from '../../../application/ports/time'
import { AdvxSqliteDatabase } from './database'
import { createTemporaryAdvxSqliteDatabase } from './database-fixture'
import { SqlitePersistenceError } from './errors'
import { ADVX_SQLITE_MIGRATIONS } from './migrations'
import { calculateMigrationChecksum, runSqliteMigrations } from './migration-runner'
import { createSqliteRepositories } from './repositories'
import { sessionViewerInstances } from './schema'
import { SqliteTransactionBoundary } from './transaction'

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

describe('DAT-005 Viewer state persistence', () => {
  test('restores an eligible crash pool in deterministic order after reopen', async () => {
    const { fixture, repositories } = await migratedFixture('advx-dat-005-restore-')
    await seedSession(repositories, true)
    const viewers = [
      viewerRecord({
        viewerInstanceId: 'viewer-b-2',
        personaId: 'persona-b',
        ordinal: 2,
        lifecycleState: 'left',
        lastLeftAtMs: 30
      }),
      viewerRecord({
        viewerInstanceId: 'viewer-a-1',
        personaId: 'persona-a',
        ordinal: 1,
        lifecycleState: 'active'
      }),
      viewerRecord({
        viewerInstanceId: 'viewer-b-3',
        personaId: 'persona-b',
        ordinal: 3,
        lifecycleState: 'kicked',
        kickedAtMs: 35
      })
    ]
    await repositories.transactions.run(async (transaction) => {
      await repositories.viewers.addAll(transaction, viewers)
      await repositories.viewers.advancePool(
        transaction,
        {
          sessionId: 'session-1',
          audienceEpoch: 2,
          sessionSeed: 'stable-session-seed',
          nextCreationOrdinal: 4,
          targetConcurrentViewers: 3,
          populationRevision: 2
        },
        1
      )
    })

    expect(ADVX_SQLITE_MIGRATIONS).toHaveLength(6)
    expect(
      ADVX_SQLITE_MIGRATIONS.map((migration) =>
        calculateMigrationChecksum(migration.sql)
      )
    ).toEqual(ADVX_SQLITE_MIGRATIONS.map((migration) => migration.checksum))
    expect(getTableName(sessionViewerInstances)).toBe('session_viewer_instances')
    const defaultColumns = fixture.database.withReadConnection((database) =>
      (database.query('PRAGMA table_info(session_viewer_instances)').all() as Array<{
        name: string
        dflt_value: string | number | null
      }>)
        .filter((column) => column.dflt_value !== null)
        .map((column) => column.name)
        .sort()
    )
    expect(defaultColumns).toEqual([
      'avatar_seed',
      'behavior_revision',
      'behavior_state_json',
      'color_seed',
      'created_at_ms',
      'join_count',
      'locale',
      'moderation_revision',
      'persona_content_hash',
      'presence_revision',
      'presence_state',
      'updated_at_ms',
      'username',
      'viewer_sequence'
    ])
    expect(() =>
      fixture.database.withWriteConnection((database) =>
        database.run(
          `INSERT INTO session_viewer_instances (
             session_id, viewer_instance_id, persona_id, persona_revision,
             ordinal, display_name, micro_variant_json, created_epoch
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            'session-1',
            'missing-state',
            'persona-a',
            1,
            4,
            'Missing state',
            JSON.stringify(baseVariant()),
            2
          ]
        )
      )
    ).toThrow()

    fixture.database.close()
    const reopened = new AdvxSqliteDatabase({ dataDirectory: fixture.dataDirectory })
    reopened.initialize()
    cleanups.push(() => reopened.close())
    const restoredRepositories = createSqliteRepositories(
      new SqliteTransactionBoundary(reopened)
    )
    const restored = await restoredRepositories.transactions.run(
      async (transaction) =>
        await restoredRepositories.viewers.restoreEligiblePool(transaction, 'session-1')
    )

    expect(restored).not.toBeNull()
    expect(restored).toMatchObject({
      sessionId: 'session-1',
      roomId: 'room-1',
      audienceEpoch: 2,
      sessionSeed: 'stable-session-seed',
      nextCreationOrdinal: 4,
      targetConcurrentViewers: 3,
      populationRevision: 2
    })
    expect(restored?.viewers.map((viewer) => viewer.viewerInstanceId)).toEqual([
      'viewer-a-1',
      'viewer-b-2',
      'viewer-b-3'
    ])
    expect(restored?.viewers.map((viewer) => viewer.lifecycleState)).toEqual([
      'active',
      'left',
      'kicked'
    ])
    expect(restored?.viewers[0]?.variant).toEqual(baseVariant())
    expect(restored?.viewers[0]?.privateState).toEqual(basePrivateState())
  })

  test('couples presence, moderation, private state, and population CAS', async () => {
    const { repositories } = await migratedFixture('advx-dat-005-cas-')
    await seedSession(repositories, false)
    const original = viewerRecord({ viewerInstanceId: 'viewer-1', ordinal: 1 })
    await repositories.transactions.run(async (transaction) => {
      await repositories.viewers.addAll(transaction, [original])
      await repositories.viewers.advancePool(
        transaction,
        poolUpdate(2, 2),
        1
      )
    })

    const changed: ViewerInstanceRecord = {
      ...original,
      lifecycleState: 'left',
      presenceRevision: 2,
      moderationRevision: 2,
      behaviorRevision: 2,
      lastLeftAt: wallClockTimestampMs(30),
      mutedUntil: wallClockTimestampMs(5_000),
      muteReason: 'cooldown',
      privateState: {
        ...original.privateState,
        revision: 2,
        cooldown_until_ms: 5_000,
        current_thread_id: 'thread-1'
      },
      viewerSequence: 1,
      updatedAt: wallClockTimestampMs(30)
    }
    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.viewers.save(transaction, changed, revisionFence(1))
        await repositories.viewers.advancePool(transaction, poolUpdate(3, 2), 2)
        throw new Error('force rollback')
      }),
      'transaction_failed'
    )
    const rolledBack = await repositories.transactions.run(async (transaction) => ({
      viewer: await repositories.viewers.get(transaction, 'session-1', 'viewer-1'),
      population: populationRevision(repositories, transaction)
    }))
    expect(rolledBack.viewer).toEqual(original)
    expect(rolledBack.population).toBe(2)

    await repositories.transactions.run(async (transaction) => {
      await repositories.viewers.save(transaction, changed, revisionFence(1))
      await repositories.viewers.advancePool(transaction, poolUpdate(3, 2), 2)
    })
    const committed = await repositories.transactions.run(async (transaction) => ({
      viewer: await repositories.viewers.get(transaction, 'session-1', 'viewer-1'),
      population: populationRevision(repositories, transaction)
    }))
    expect(committed.viewer).toEqual(changed)
    expect(committed.population).toBe(3)

    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.viewers.save(transaction, changed, revisionFence(1))
      }),
      'optimistic_conflict'
    )
  })

  test('tombstones removed Viewer IDs and rolls back attempted reuse', async () => {
    const { repositories } = await migratedFixture('advx-dat-005-remove-')
    await seedSession(repositories, false)
    const original = viewerRecord({ viewerInstanceId: 'viewer-1', ordinal: 1 })
    await repositories.transactions.run(async (transaction) => {
      await repositories.viewers.addAll(transaction, [original])
      await repositories.viewers.advancePool(transaction, poolUpdate(2, 2), 1)
    })
    await repositories.transactions.run(async (transaction) => {
      await repositories.viewers.remove(
        transaction,
        'session-1',
        'viewer-1',
        2,
        wallClockTimestampMs(40)
      )
      await repositories.viewers.advancePool(transaction, poolUpdate(3, 2), 2)
    })

    const removed = await repositories.transactions.run(async (transaction) => ({
      active: await repositories.viewers.listActive(transaction, 'session-1'),
      viewer: await repositories.viewers.get(transaction, 'session-1', 'viewer-1')
    }))
    expect(removed.active).toEqual([])
    expect(removed.viewer).toMatchObject({
      viewerInstanceId: 'viewer-1',
      lifecycleState: 'removed',
      storageState: 'removed',
      removedEpoch: 2
    })

    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.viewers.advancePool(transaction, poolUpdate(4, 2), 3)
        await repositories.viewers.addAll(transaction, [
          viewerRecord({ viewerInstanceId: 'viewer-1', ordinal: 2 })
        ])
      }),
      'optimistic_conflict'
    )
    const final = await repositories.transactions.run(async (transaction) => ({
      population: populationRevision(repositories, transaction),
      viewer: await repositories.viewers.get(transaction, 'session-1', 'viewer-1')
    }))
    expect(final.population).toBe(3)
    expect(final.viewer?.ordinal).toBe(1)
    expect(final.viewer?.storageState).toBe('removed')
  })
})

async function migratedFixture(prefix: string) {
  const fixture = createTemporaryAdvxSqliteDatabase(prefix)
  cleanups.push(fixture.cleanup)
  await runSqliteMigrations({
    database: fixture.database.withWriteConnection((database) => database),
    databasePath: fixture.database.path,
    migrations: ADVX_SQLITE_MIGRATIONS,
    appVersion: 'dat-005-test',
    nowMs: () => 1
  })
  const transactions = new SqliteTransactionBoundary(fixture.database)
  return {
    fixture,
    transactions,
    repositories: createSqliteRepositories(transactions)
  }
}

async function seedSession(
  repositories: ReturnType<typeof createSqliteRepositories>,
  eligible: boolean
): Promise<void> {
  await repositories.transactions.run(async (transaction) => {
    await repositories.rooms.save(transaction, roomRecord(), null)
    await repositories.sessions.save(transaction, sessionRecord(0), null)
    if (eligible) {
      await repositories.sessions.save(
        transaction,
        {
          ...sessionRecord(1),
          state: 'failed',
          recoveryEligible: true,
          endedAt: wallClockTimestampMs(40),
          outcome: 'interrupted',
          updatedAt: wallClockTimestampMs(40)
        },
        0
      )
    }
  })
}

function roomRecord(): RoomRecord {
  return {
    roomId: 'room-1',
    displayName: 'Room',
    state: 'active',
    revision: 0,
    createdAt: wallClockTimestampMs(10),
    updatedAt: wallClockTimestampMs(10)
  }
}

function sessionRecord(revision: Revision): SessionRecord {
  return {
    sessionId: 'session-1',
    roomId: 'room-1',
    state: 'starting',
    revision,
    audienceEpoch: 0,
    activeConfigHash: null,
    recoveryEligible: false,
    lastCleanShutdownAt: null,
    lastRecoveredAt: null,
    clientRequestId: 'start-1',
    clientRequestHash: 'b'.repeat(64),
    startedAt: wallClockTimestampMs(10),
    updatedAt: wallClockTimestampMs(10),
    endedAt: null,
    outcome: null,
    appVersion: '0.1.0'
  }
}

function viewerRecord(input: {
  viewerInstanceId: string
  ordinal: number
  personaId?: string
  lifecycleState?: ViewerInstanceRecord['lifecycleState']
  lastLeftAtMs?: number
  kickedAtMs?: number
}): ViewerInstanceRecord {
  const lifecycleState = input.lifecycleState ?? 'active'
  return {
    viewerInstanceId: input.viewerInstanceId,
    roomId: 'room-1',
    sessionId: 'session-1',
    audienceEpoch: 2,
    personaId: input.personaId ?? 'persona-a',
    personaRevision: 1,
    personaContentHash: 'a'.repeat(64),
    ordinal: input.ordinal,
    username: `viewer-${input.ordinal}`,
    displayName: `Viewer ${input.ordinal}`,
    avatarSeed: `avatar-${input.ordinal}`,
    colorSeed: `color-${input.ordinal}`,
    locale: 'zh-CN',
    variant: baseVariant(),
    privateState: basePrivateState(),
    viewerSequence: 0,
    lifecycleState,
    presenceRevision: 1,
    moderationRevision: 1,
    behaviorRevision: 1,
    joinedAt: wallClockTimestampMs(20),
    lastLeftAt:
      input.lastLeftAtMs === undefined
        ? null
        : wallClockTimestampMs(input.lastLeftAtMs),
    joinCount: 1,
    mutedUntil: null,
    muteReason: null,
    kickedAt:
      input.kickedAtMs === undefined
        ? null
        : wallClockTimestampMs(input.kickedAtMs),
    kickReason: lifecycleState === 'kicked' ? 'moderation' : null,
    createdAt: wallClockTimestampMs(10),
    updatedAt: wallClockTimestampMs(20),
    createdEpoch: 1,
    removedEpoch: null,
    storageState: 'active'
  }
}

function baseVariant() {
  return {
    activity_baseline: 0.5,
    attention_span: 0.5,
    social_initiative: 0.5,
    reply_affinity: 0.5,
    expression_length: 0.4,
    skepticism: 0.2,
    encouragement: 0.8,
    meme_affinity: 0.3,
    focus: 'gameplay',
    silence_tendency: 0.1,
    stay_duration_tendency: 0.5,
    rejoin_tendency: 0.5
  } as const
}

function basePrivateState(): ViewerPrivateState {
  return {
    revision: 1,
    published_event_ids: [],
    direct_interaction_event_ids: [],
    attention: [],
    mood: {},
    cooldown_until_ms: null,
    attention_strength: 0.5,
    arousal: 0,
    fatigue: 0,
    engagement: 0.5,
    last_spoke_at_ms: null,
    last_reacted_at_ms: null,
    current_thread_id: null,
    current_target_viewer_id: null,
    host_affinity: 0,
    peer_affinities: {},
    silence_streak: 0,
    speech_streak: 0
  }
}

function poolUpdate(populationRevision: Revision, nextCreationOrdinal: number) {
  return {
    sessionId: 'session-1',
    audienceEpoch: 2 as Epoch,
    sessionSeed: 'stable-session-seed',
    nextCreationOrdinal,
    targetConcurrentViewers: 1,
    populationRevision
  } as const
}

function revisionFence(revision: Revision) {
  return {
    presenceRevision: revision,
    moderationRevision: revision,
    behaviorRevision: revision
  } as const
}

function populationRevision(
  repositories: ReturnType<typeof createSqliteRepositories>,
  transaction: Parameters<
    Parameters<typeof repositories.transactions.run>[0]
  >[0]
): number {
  const row = repositories.transactions
    .connection(transaction)
    .query('SELECT population_revision FROM session_records WHERE session_id = ?')
    .get('session-1') as { population_revision: number } | null
  if (row === null) throw new Error('missing test Session')
  return row.population_revision
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
