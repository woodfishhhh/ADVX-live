import { afterEach, describe, expect, test } from 'bun:test'
import {
  canonicalJson,
  canonicalSha256,
  type CanonicalRuntimeSpec,
  type Revision
} from '@advx/contracts'
import { getTableName } from 'drizzle-orm'

import type {
  RoomRecord,
  RuntimeSpecRecord,
  SessionRecord
} from '../../../application/ports/repositories'
import { wallClockTimestampMs } from '../../../application/ports/time'
import { createTemporaryAdvxSqliteDatabase } from './database-fixture'
import { SqlitePersistenceError } from './errors'
import { ADVX_SQLITE_MIGRATIONS } from './migrations'
import { calculateMigrationChecksum, runSqliteMigrations } from './migration-runner'
import { createSqliteRepositories } from './repositories'
import { rooms } from './schema'
import { SqliteTransactionBoundary } from './transaction'

const cleanups: (() => void)[] = []

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup()
})

describe('DAT-004 Room, Session, and runtime persistence', () => {
  test('runs the immutable SQL manifest and exposes the Drizzle schema', async () => {
    const { fixture } = await migratedFixture()
    const tables = fixture.database.withReadConnection((database) =>
      database
        .query(
          `SELECT name FROM sqlite_schema
           WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
           ORDER BY name`
        )
        .all()
    ) as { name: string }[]

    expect(ADVX_SQLITE_MIGRATIONS).toHaveLength(6)
    expect(
      ADVX_SQLITE_MIGRATIONS.map((migration) =>
        calculateMigrationChecksum(migration.sql)
      )
    ).toEqual(ADVX_SQLITE_MIGRATIONS.map((migration) => migration.checksum))
    expect(tables.map((table) => table.name)).toEqual([
      'advx_schema_migrations',
      'durable_outbox',
      'mode_meme_candidates',
      'mode_meme_events',
      'mode_meme_settings',
      'mode_memes',
      'room_events',
      'room_long_term_memories',
      'room_memory_candidates',
      'room_memory_evidence',
      'room_memory_heads',
      'rooms',
      'session_records',
      'session_runtime_revisions',
      'session_viewer_instances'
    ])
    expect(getTableName(rooms)).toBe('rooms')
  })

  test('persists lifecycle markers and rejects stale writes without partial commits', async () => {
    const { fixture, repositories } = await migratedFixture()
    await repositories.transactions.run(async (transaction) => {
      await repositories.rooms.save(transaction, roomRecord(0), null)
      await repositories.sessions.save(transaction, sessionRecord(0), null)
    })

    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.rooms.save(
          transaction,
          { ...roomRecord(0), displayName: 'Not committed', revision: 1 },
          0
        )
        throw new Error('force rollback')
      }),
      'transaction_failed'
    )
    const unchanged = await repositories.transactions.run(
      async (transaction) => await repositories.rooms.get(transaction, 'room-1')
    )
    expect(unchanged?.displayName).toBe('Room')
    expect(unchanged?.revision).toBe(0)

    const stopped: SessionRecord = {
      ...sessionRecord(0),
      state: 'stopped',
      revision: 1,
      recoveryEligible: true,
      lastCleanShutdownAt: wallClockTimestampMs(40),
      lastRecoveredAt: wallClockTimestampMs(30),
      endedAt: wallClockTimestampMs(40),
      outcome: 'completed',
      updatedAt: wallClockTimestampMs(40)
    }
    await repositories.transactions.run(async (transaction) => {
      await repositories.sessions.save(transaction, stopped, 0)
    })
    const restored = await repositories.transactions.run(
      async (transaction) => await repositories.sessions.get(transaction, 'session-1')
    )
    expect(restored).toEqual(stopped)

    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.sessions.save(transaction, stopped, 0)
      }),
      'optimistic_conflict'
    )
    await repositories.transactions.run(async (transaction) => {
      await repositories.runtimeSpecs.addPending(transaction, {
        ...runtimeRecord({ revision: 1, configRevision: 1, audienceEpoch: 1 }),
        status: 'pending'
      })
    })

    const existing = await repositories.transactions.run(
      async (transaction) =>
        await repositories.sessions.getIdempotentStart(
          transaction,
          stopped.clientRequestId!,
          stopped.clientRequestHash!
        )
    )
    expect(existing).toEqual(stopped)

    await expectPersistenceCode(
      repositories.transactions.run(
        async (transaction) =>
          await repositories.sessions.getIdempotentStart(
            transaction,
            stopped.clientRequestId!,
            'c'.repeat(64)
          )
      ),
      'optimistic_conflict'
    )

    await repositories.transactions.run(async (transaction) => {
      await repositories.sessions.save(
        transaction,
        { ...sessionRecord(0), sessionId: 'session-retry' },
        null
      )
    })
    const retry = await repositories.transactions.run(async (transaction) => ({
      existing: await repositories.sessions.getIdempotentStart(
        transaction,
        stopped.clientRequestId!,
        stopped.clientRequestHash!
      ),
      duplicate: await repositories.sessions.get(transaction, 'session-retry')
    }))
    expect(retry.existing?.sessionId).toBe('session-1')
    expect(retry.duplicate).toBeNull()

    const clear = await repositories.transactions.run(async (transaction) => ({
      first: await repositories.rooms.clear(transaction, 'room-1'),
      second: await repositories.rooms.clear(transaction, 'room-1')
    }))
    expect(clear).toEqual({ first: true, second: false })

    const remaining = fixture.database.withReadConnection((database) => {
      const statement = database.prepare(
        `SELECT
           (SELECT COUNT(*) FROM rooms) AS rooms,
           (SELECT COUNT(*) FROM session_records) AS sessions,
           (SELECT COUNT(*) FROM session_runtime_revisions) AS revisions`
      )
      try {
        return statement.get() as { rooms: number; sessions: number; revisions: number }
      } finally {
        statement.finalize()
      }
    })
    expect(remaining).toEqual({ rooms: 0, sessions: 0, revisions: 0 })
  })

  test('commits pending runtime revisions and restores an earlier config by rollback', async () => {
    const { repositories } = await migratedFixture()
    await repositories.transactions.run(async (transaction) => {
      await repositories.rooms.save(transaction, roomRecord(0), null)
      await repositories.sessions.save(transaction, sessionRecord(0), null)
    })

    const bootstrap = runtimeRecord({ revision: 1, configRevision: 1, audienceEpoch: 1 })
    await repositories.transactions.run(async (transaction) => {
      await repositories.runtimeSpecs.addPending(transaction, {
        ...bootstrap,
        status: 'pending'
      })
      await repositories.runtimeSpecs.addPending(transaction, {
        ...bootstrap,
        status: 'pending'
      })
      const token = await repositories.runtimeSpecs.prepareCommit(transaction, bootstrap, 0)
      token.commit()
    })

    const applied = runtimeRecord({
      revision: 2,
      baseRevision: 1,
      configRevision: 2,
      audienceEpoch: 2,
      operation: 'apply',
      applyId: 'apply-2'
    })
    await repositories.transactions.run(async (transaction) => {
      await repositories.runtimeSpecs.addPending(transaction, {
        ...applied,
        status: 'pending'
      })
      await repositories.runtimeSpecs.prepareCommit(transaction, applied, 1)
    })

    const rollback = runtimeRecord({
      revision: 3,
      baseRevision: 2,
      configRevision: 1,
      audienceEpoch: 3,
      operation: 'rollback',
      rollbackTargetRevision: 1,
      applyId: 'rollback-1'
    })
    await repositories.transactions.run(async (transaction) => {
      await repositories.runtimeSpecs.addPending(transaction, {
        ...rollback,
        status: 'pending'
      })
      await repositories.runtimeSpecs.prepareCommit(transaction, rollback, 2, 2)
    })

    const persisted = await repositories.transactions.run(async (transaction) => ({
      active: await repositories.runtimeSpecs.getActive(transaction, 'session-1'),
      rolledBack: await repositories.runtimeSpecs.getRevision(transaction, 'session-1', 2),
      session: await repositories.sessions.get(transaction, 'session-1')
    }))
    expect(persisted.active).toEqual(rollback)
    expect(persisted.rolledBack?.status).toBe('rolled_back')
    expect(persisted.session?.audienceEpoch).toBe(3)
    expect(persisted.session?.activeConfigHash).toBe(rollback.configHash)

    const stale = runtimeRecord({
      revision: 4,
      baseRevision: 1,
      configRevision: 4,
      audienceEpoch: 4,
      operation: 'apply',
      applyId: 'stale-4'
    })
    await expectPersistenceCode(
      repositories.transactions.run(async (transaction) => {
        await repositories.runtimeSpecs.addPending(transaction, {
          ...stale,
          status: 'pending'
        })
      }),
      'optimistic_conflict'
    )
    const missing = await repositories.transactions.run(
      async (transaction) =>
        await repositories.runtimeSpecs.getByApplyId(transaction, 'session-1', 'stale-4')
    )
    expect(missing).toBeNull()
  })
})

async function migratedFixture() {
  const fixture = createTemporaryAdvxSqliteDatabase('advx-dat-004-')
  cleanups.push(fixture.cleanup)
  await runSqliteMigrations({
    database: fixture.database.withWriteConnection((database) => database),
    databasePath: fixture.database.path,
    migrations: ADVX_SQLITE_MIGRATIONS,
    appVersion: 'dat-004-test',
    nowMs: () => 1
  })
  const transactions = new SqliteTransactionBoundary(fixture.database)
  return {
    fixture,
    transactions,
    repositories: createSqliteRepositories(transactions)
  }
}

function roomRecord(revision: Revision): RoomRecord {
  return {
    roomId: 'room-1',
    displayName: 'Room',
    state: 'active',
    revision,
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

function runtimeRecord(input: {
  revision: Revision
  configRevision: Revision
  audienceEpoch: number
  baseRevision?: Revision
  operation?: RuntimeSpecRecord['operation']
  rollbackTargetRevision?: Revision | null
  applyId?: string
}): RuntimeSpecRecord {
  const spec = runtimeSpec(input.configRevision)
  return {
    sessionId: 'session-1',
    roomId: 'room-1',
    revision: input.revision,
    applyId: input.applyId ?? 'bootstrap-1',
    operation: input.operation ?? 'bootstrap',
    rollbackTargetRevision: input.rollbackTargetRevision ?? null,
    baseRevision: input.baseRevision ?? 0,
    status: 'committed',
    configRevision: input.configRevision,
    audienceEpoch: input.audienceEpoch,
    configHash: canonicalSha256(spec),
    canonicalSpecJson: canonicalJson(spec),
    spec,
    diffSummary: emptyDiff(),
    createdAt: wallClockTimestampMs(input.revision * 10),
    updatedAt: wallClockTimestampMs(input.revision * 10)
  }
}

function runtimeSpec(configRevision: Revision): CanonicalRuntimeSpec {
  return {
    protocol_version: 3,
    audience_contract_version: 3,
    config_revision: configRevision,
    room: {
      room_id: 'room-1',
      display_name: 'Room',
      created_at_ms: 1,
      updated_at_ms: configRevision
    },
    active_mode_id: 'mode-1',
    personas: [
      {
        persona_id: 'persona-1',
        document_version: 1,
        revision: 1,
        content_hash: 'a'.repeat(64),
        display_name: 'Viewer',
        role: 'viewer',
        silence_bias: 0,
        burst_bias: 0,
        repetition_bias: 0,
        cooldown_ms: 0,
        enabled: true
      }
    ],
    modes: [
      {
        mode_id: 'mode-1',
        namespace_id: 'namespace-1',
        revision: 1,
        persona_counts: { 'persona-1': 1 },
        normal_response_range: { minimum: 0, maximum: 1 },
        highlight_response_range: { minimum: 0, maximum: 1 }
      }
    ],
    provider: {
      provider_profile_id: 'profile-1',
      viewer_model: 'viewer-model',
      memory_model: 'memory-model',
      visual_summary_model: 'vision-model'
    }
  }
}

function emptyDiff() {
  const identity = {
    addedIds: [],
    removedIds: [],
    changedIds: [],
    previousCount: 1,
    nextCount: 1
  } as const
  return {
    changedSections: [],
    personas: identity,
    modes: identity,
    providerChanged: false,
    settingsChanged: false
  } as const
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
