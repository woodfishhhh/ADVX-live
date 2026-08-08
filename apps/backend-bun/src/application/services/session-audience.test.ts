import { describe, expect, test } from 'bun:test'
import type {
  CanonicalRuntimeSpec,
  Epoch,
  Revision,
  RoomId,
  SessionId,
  ViewerId
} from '@advx/contracts'

import {
  transactionContext,
  type TransactionBoundary,
  type TransactionContext,
  type ViewerInstanceRecord,
  type ViewerInstanceRepository,
  type ViewerPoolRecord,
  type ViewerPoolUpdate,
  type ViewerRevisionFence
} from '../ports/repositories'
import { wallClockTimestampMs } from '../ports/time'
import {
  MAX_ACTIVE_SESSION_VIEWERS,
  SessionAudienceError,
  SessionAudienceService,
  type SessionAudienceDependencies
} from './session-audience'

describe('AGT-007 SessionAudience', () => {
  test('allocates exact deterministic Persona counts, identities, aliases, and microvariants', async () => {
    const first = await createAudience(memoryStore().dependencies, runtimeSpec())
    const replay = await createAudience(memoryStore().dependencies, runtimeSpec())
    const differentSeed = await createAudience(
      memoryStore().dependencies,
      runtimeSpec(),
      'seed-2'
    )

    expect(first.snapshot().targetConcurrentViewers).toBe(3)
    expect(first.snapshot().populationRevision).toBe(2)
    expect(first.snapshot().nextCreationOrdinal).toBe(4)
    expect(personaCounts(first.activeViewers())).toEqual({
      'persona-a': 2,
      'persona-b': 1
    })
    expect(first.activeViewers().map((viewer) => viewer.viewerInstanceId)).toEqual([
      'viewer-3bf7ce9ab2f8e9d472b64218',
      'viewer-2d5bbf66715ac4c12e5d8519',
      'viewer-eb5c4de4712b7805d4684baf'
    ])
    expect(first.activeViewers().map((viewer) => viewer.username)).toEqual([
      'mimi_03',
      '开麦玩家',
      '小年糕'
    ])
    expect(first.activeViewers()).toEqual(replay.activeViewers())
    expect(
      differentSeed.activeViewers().map((viewer) => viewer.viewerInstanceId)
    ).not.toEqual(first.activeViewers().map((viewer) => viewer.viewerInstanceId))
    expect(new Set(first.activeViewers().map((viewer) => viewer.username)).size).toBe(3)
    expect(
      first.activeViewers().filter((viewer) => viewer.personaId === 'persona-a')
        .map((viewer) => viewer.username)
    ).toHaveLength(2)
    expect(first.activeViewers().every((viewer) => viewer.username !== viewer.personaId)).toBe(
      true
    )
    expect(first.activeViewers()[1]?.variant).not.toEqual(
      first.activeViewers()[2]?.variant
    )

    const maximum = await createAudience(
      memoryStore().dependencies,
      runtimeSpec({ 'persona-a': MAX_ACTIVE_SESSION_VIEWERS })
    )
    expect(maximum.activeViewers()).toHaveLength(MAX_ACTIVE_SESSION_VIEWERS)
    await expect(
      createAudience(
        memoryStore().dependencies,
        runtimeSpec({ 'persona-a': 32, 'persona-b': 1 })
      )
    ).rejects.toMatchObject({ code: 'invalid_population' })
  })

  test('preserves private state across leave/rejoin and enforces latest-wins sequence plus cooldown', async () => {
    const audience = await createAudience(memoryStore().dependencies, runtimeSpec())
    const viewer = audience.activeViewers()[0]!
    const firstFence = sequenceFence(viewer, 1)
    const latestFence = sequenceFence(viewer, 2)

    expect(
      audience.claimViewerSequence(viewer.viewerInstanceId, 1, wallClockTimestampMs(1_500))
    ).toBe(true)
    expect(
      audience.claimViewerSequence(viewer.viewerInstanceId, 3, wallClockTimestampMs(1_500))
    ).toBe(false)
    expect(
      audience.claimViewerSequence(viewer.viewerInstanceId, 2, wallClockTimestampMs(1_500))
    ).toBe(true)
    expect(
      await audience.commitPrivateState({
        ...firstFence,
        privateState: nextPrivateState(viewer, 5_000),
        updatedAt: wallClockTimestampMs(2_000)
      })
    ).toBe(false)
    expect(
      await audience.commitPrivateState({
        ...latestFence,
        privateState: nextPrivateState(viewer, 5_000),
        updatedAt: wallClockTimestampMs(2_000)
      })
    ).toBe(true)
    expect(audience.eligibleViewers(wallClockTimestampMs(4_999))).not.toContainEqual(
      expect.objectContaining({ viewerInstanceId: viewer.viewerInstanceId })
    )
    expect(audience.eligibleViewers(wallClockTimestampMs(5_000))).toContainEqual(
      expect.objectContaining({ viewerInstanceId: viewer.viewerInstanceId })
    )

    const left = await audience.leave(
      viewer.viewerInstanceId,
      wallClockTimestampMs(6_000)
    )
    expect(left.lifecycleState).toBe('left')
    expect(left.privateState.current_thread_id).toBe('thread-1')
    expect(audience.activeViewers()).toHaveLength(2)
    const rejoined = await audience.rejoin(
      viewer.viewerInstanceId,
      wallClockTimestampMs(7_000)
    )
    expect(rejoined.lifecycleState).toBe('active')
    expect(rejoined.viewerInstanceId).toBe(viewer.viewerInstanceId)
    expect(rejoined.username).toBe(viewer.username)
    expect(rejoined.joinCount).toBe(2)
    expect(rejoined.privateState.current_thread_id).toBe('thread-1')
    expect(audience.snapshot().populationRevision).toBe(4)
    expect(
      audience.claimViewerSequence(viewer.viewerInstanceId, 3, wallClockTimestampMs(7_000))
    ).toBe(true)
  })

  test('tombstones kicked Viewer identity and fills the exact Persona deficit with a new ordinal', async () => {
    const store = memoryStore()
    const audience = await createAudience(store.dependencies, runtimeSpec())
    const kicked = audience.activeViewers().find(
      (viewer) => viewer.personaId === 'persona-a'
    )!
    const knownIds = new Set(audience.snapshot().viewers.map((viewer) => viewer.viewerInstanceId))

    const result = await audience.kickAndReplace(
      kicked.viewerInstanceId,
      wallClockTimestampMs(2_000),
      'moderation'
    )

    expect(result.removedViewer).toMatchObject({
      viewerInstanceId: kicked.viewerInstanceId,
      lifecycleState: 'removed',
      storageState: 'removed',
      kickReason: 'moderation'
    })
    expect(result.replacementViewer.personaId).toBe('persona-a')
    expect(result.replacementViewer.ordinal).toBe(4)
    expect(knownIds.has(result.replacementViewer.viewerInstanceId)).toBe(false)
    expect(result.replacementViewer.viewerInstanceId).not.toBe(kicked.viewerInstanceId)
    expect(audience.snapshot().nextCreationOrdinal).toBe(5)
    expect(audience.snapshot().populationRevision).toBe(3)
    expect(audience.activeViewers()).toHaveLength(3)
    expect(personaCounts(audience.activeViewers())).toEqual({
      'persona-a': 2,
      'persona-b': 1
    })
    expect(store.records.get(kicked.viewerInstanceId)?.storageState).toBe('removed')
  })

  test('reconciles runtime revision changes to exact counts while preserving identity and resetting changed Personas', async () => {
    const audience = await createAudience(memoryStore().dependencies, runtimeSpec())
    const beforeIds = audience.activeViewers().map((viewer) => viewer.viewerInstanceId)
    const result = await audience.reconcileRuntime(
      runtimeSpec(
        { 'persona-a': 1, 'persona-b': 0, 'persona-c': 2 },
        { personaARevision: 2 }
      ),
      2 as Epoch,
      wallClockTimestampMs(3_000)
    )

    expect(result.snapshot.audienceEpoch).toBe(2)
    expect(result.snapshot.populationRevision).toBe(3)
    expect(result.snapshot.targetConcurrentViewers).toBe(3)
    expect(result.addedViewerIds).toEqual([])
    expect(result.removedViewerIds).toEqual([])
    expect(result.resetViewerIds).toHaveLength(3)
    expect(audience.activeViewers().map((viewer) => viewer.viewerInstanceId)).toEqual(
      beforeIds
    )
    expect(personaCounts(audience.activeViewers())).toEqual({
      'persona-a': 1,
      'persona-c': 2
    })
    expect(audience.activeViewers().every((viewer) => viewer.audienceEpoch === 2)).toBe(
      true
    )
    expect(
      audience.activeViewers().find((viewer) => viewer.personaId === 'persona-a')
        ?.personaRevision
    ).toBe(2)
    expect(audience.activeViewers().every((viewer) => viewer.privateState.revision === 1)).toBe(
      true
    )
  })

  test('restores only an eligible persisted pool without reallocating identity', async () => {
    const store = memoryStore()
    const created = await createAudience(store.dependencies, runtimeSpec())
    store.recoveryEligible = true
    const restored = await SessionAudienceService.restoreEligible(store.dependencies, {
      sessionId: 'session-1' as SessionId,
      spec: runtimeSpec()
    })

    expect(restored).not.toBeNull()
    expect(restored?.snapshot()).toEqual(created.snapshot())
    expect(restored?.activeViewers().map((viewer) => viewer.viewerInstanceId)).toEqual(
      created.activeViewers().map((viewer) => viewer.viewerInstanceId)
    )
    expect(restored?.snapshot().nextCreationOrdinal).toBe(4)

    const ineligible = memoryStore()
    expect(
      await SessionAudienceService.restoreEligible(ineligible.dependencies, {
        sessionId: 'session-1' as SessionId,
        spec: runtimeSpec()
      })
    ).toBeNull()
  })
})

async function createAudience(
  dependencies: SessionAudienceDependencies,
  spec: CanonicalRuntimeSpec,
  sessionSeed = 'seed-1'
): Promise<SessionAudienceService> {
  return await SessionAudienceService.create(dependencies, {
    roomId: 'room-1' as RoomId,
    sessionId: 'session-1' as SessionId,
    audienceEpoch: 1 as Epoch,
    sessionSeed,
    spec,
    createdAt: wallClockTimestampMs(1_000),
    expectedPopulationRevision: 1 as Revision
  })
}

function runtimeSpec(
  personaCounts: Readonly<Record<string, number>> = {
    'persona-a': 2,
    'persona-b': 1
  },
  options: Readonly<{ personaARevision?: number }> = {}
): CanonicalRuntimeSpec {
  const personaARevision = options.personaARevision ?? 1
  return {
    protocol_version: 3,
    audience_contract_version: 3,
    config_revision: personaARevision,
    room: {
      room_id: 'room-1',
      display_name: 'Room',
      revision: 1,
      created_at_ms: 0,
      updated_at_ms: 1_000
    },
    active_mode_id: 'mode-1',
    personas: [
      persona('persona-a', 'Persona A', personaARevision),
      persona('persona-b', 'Persona B', 1),
      persona('persona-c', 'Persona C', 1)
    ],
    modes: [
      {
        mode_id: 'mode-1',
        namespace_id: 'namespace-1',
        revision: personaARevision,
        persona_counts: { ...personaCounts },
        persona_overrides: {},
        normal_response_range: { minimum: 0, maximum: 3 },
        highlight_response_range: { minimum: 1, maximum: 6 },
        ambience: 'natural'
      }
    ],
    provider: {} as CanonicalRuntimeSpec['provider'],
    settings: {}
  }
}

function persona(personaId: string, displayName: string, revision: number) {
  return {
    persona_id: personaId,
    document_version: 1,
    revision,
    content_hash: hashFor(`${personaId}:${revision}`),
    display_name: displayName,
    role: `${displayName} role`,
    traits: [`${displayName} focus`],
    speech_style: {},
    behavior: {},
    trigger_preferences: [],
    avoid_patterns: [],
    silence_bias: 0.5,
    burst_bias: 0.5,
    repetition_bias: 0.5,
    cooldown_ms: 15_000,
    content_flags: [],
    enabled: true
  }
}

function sequenceFence(
  viewer: ViewerInstanceRecord,
  viewerSequence: number
) {
  return {
    viewerInstanceId: viewer.viewerInstanceId,
    viewerSequence,
    presenceRevision: viewer.presenceRevision,
    moderationRevision: viewer.moderationRevision,
    behaviorRevision: viewer.behaviorRevision
  }
}

function nextPrivateState(viewer: ViewerInstanceRecord, cooldownUntil: number) {
  return {
    ...viewer.privateState,
    revision: viewer.privateState.revision + 1,
    cooldown_until_ms: cooldownUntil,
    current_thread_id: 'thread-1',
    attention: ['event-1']
  }
}

function personaCounts(viewers: readonly ViewerInstanceRecord[]) {
  return Object.fromEntries(
    [...new Set(viewers.map((viewer) => viewer.personaId))]
      .sort()
      .map((personaId) => [
        personaId,
        viewers.filter((viewer) => viewer.personaId === personaId).length
      ])
  )
}

function hashFor(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}

type MemoryStore = {
  dependencies: SessionAudienceDependencies
  records: Map<ViewerId, ViewerInstanceRecord>
  recoveryEligible: boolean
}

function memoryStore(): MemoryStore {
  const records = new Map<ViewerId, ViewerInstanceRecord>()
  let pool: ViewerPoolUpdate = {
    sessionId: 'session-1' as SessionId,
    audienceEpoch: 1 as Epoch,
    sessionSeed: 'seed-1',
    nextCreationOrdinal: 1,
    targetConcurrentViewers: 1,
    populationRevision: 1 as Revision
  }
  const state: MemoryStore = {
    records,
    recoveryEligible: false,
    dependencies: undefined as never
  }
  const transactions: TransactionBoundary = {
    run: async (work) => await work(transactionContext('agt-007-memory'))
  }
  const viewers: ViewerInstanceRepository = {
    get: async (_transaction, _sessionId, viewerId) => records.get(viewerId) ?? null,
    listActive: async () =>
      [...records.values()]
        .filter((viewer) => viewer.storageState === 'active')
        .sort(compareStoredViewers),
    restoreEligiblePool: async (_transaction, sessionId) => {
      if (!state.recoveryEligible || sessionId !== pool.sessionId) return null
      return Object.freeze({
        ...pool,
        roomId: 'room-1' as RoomId,
        viewers: Object.freeze(
          [...records.values()]
            .filter((viewer) => viewer.storageState === 'active')
            .sort(compareStoredViewers)
        )
      })
    },
    addAll: async (_transaction, additions) => {
      for (const viewer of additions) {
        if (records.has(viewer.viewerInstanceId)) {
          throw new Error('duplicate Viewer ID')
        }
        records.set(viewer.viewerInstanceId, viewer)
      }
    },
    save: async (_transaction, viewer, expected) => {
      const current = records.get(viewer.viewerInstanceId)
      if (current === undefined || !matchesFence(current, expected)) {
        throw new Error('stale Viewer revision')
      }
      records.set(viewer.viewerInstanceId, viewer)
    },
    remove: async (
      _transaction,
      _sessionId,
      viewerId,
      removedEpoch,
      updatedAt
    ) => {
      const current = records.get(viewerId)
      if (current === undefined || current.storageState === 'removed') {
        throw new Error('Viewer already removed')
      }
      records.set(viewerId, {
        ...current,
        lifecycleState: 'removed',
        removedEpoch,
        storageState: 'removed',
        updatedAt
      })
    },
    advancePool: async (_transaction, update, expectedRevision) => {
      if (pool.populationRevision !== expectedRevision) {
        throw new Error('stale population revision')
      }
      pool = update
    }
  }
  state.dependencies = { transactions, viewers }
  return state
}

function matchesFence(
  viewer: ViewerInstanceRecord,
  fence: ViewerRevisionFence
): boolean {
  return (
    viewer.presenceRevision === fence.presenceRevision &&
    viewer.moderationRevision === fence.moderationRevision &&
    viewer.behaviorRevision === fence.behaviorRevision
  )
}

function compareStoredViewers(
  left: ViewerInstanceRecord,
  right: ViewerInstanceRecord
): number {
  return (
    left.personaId.localeCompare(right.personaId) ||
    left.ordinal - right.ordinal ||
    left.viewerInstanceId.localeCompare(right.viewerInstanceId)
  )
}
