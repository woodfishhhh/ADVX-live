import { afterAll, describe, expect, test } from 'bun:test'
import type {
  Epoch,
  Revision,
  RoomId,
  SessionId
} from '@advx/contracts'

import {
  durationMs,
  modelUsage,
  protocolRepairAttempt,
  providerRevision,
  wallClockTimestampMs,
  type ModeMemeCandidate,
  type ModelGenerationRequest,
  type ModelProvider,
  type RoomMemoryCandidate,
  type RoomRecord,
  type SessionRecord
} from '../ports'
import {
  ADVX_SQLITE_MIGRATIONS,
  createRoomEventRecord,
  createSqliteRepositories,
  createTemporaryAdvxSqliteDatabase,
  runSqliteMigrations,
  SqliteTransactionBoundary
} from '../../infrastructure/persistence/sqlite'
import type {
  AcceptedBarrageSideEffectSubmission,
  TrustedViewerBarrageEvent
} from './barrage-pipeline'
import {
  ModelRoomMemoryExtractor,
  ROOM_MEMORY_EXTRACTION_SCHEMA_NAME,
  type ExtractedRoomMemoryCandidate,
  type RoomMemoryExtractorPort
} from './memory-extraction'
import {
  MODE_MEME_ARCHIVE_AFTER_MS,
  SharedBrainSideEffectService,
  type SharedBrainSideEffectFailure
} from './shared-brain-side-effects'

const ROOM_ID = 'room-1' as RoomId
const SESSION_ID = 'session-1' as SessionId
const EPOCH = 1 as Epoch
const REVISION_ZERO = 0 as Revision
const cleanups: Array<() => void> = []

afterAll(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

describe('AGT-012 memory and meme side effects', () => {
  test('uses one bounded memory-role Provider call and accepts only owned evidence', async () => {
    let request: ModelGenerationRequest | null = null
    let calls = 0
    const provider: Pick<ModelProvider, 'generate'> = {
      async generate(input, _context, budget) {
        calls += 1
        request = input
        expect(budget.take()).toBeTrue()
        return {
          ok: true,
          value: {
            requestId: input.requestId,
            responseId: 'response-memory-1',
            provider: input.provider,
            roleModel: input.roleModel,
            protocolRepairAttempt: protocolRepairAttempt(0),
            output: {
              type: 'structured',
              schemaName: ROOM_MEMORY_EXTRACTION_SCHEMA_NAME,
              text: JSON.stringify({
                candidates: [
                  {
                    memory_type: 'room_lore',
                    content: '本房间喜欢逆风翻盘',
                    evidence_event_ids: ['barrage-1'],
                    tags: ['游戏'],
                    importance: 0.7,
                    confidence: 0.8
                  },
                  {
                    memory_type: 'room_lore',
                    content: '越权证据',
                    evidence_event_ids: ['outside-event'],
                    tags: [],
                    importance: 0.5,
                    confidence: 0.5
                  }
                ]
              })
            },
            finishReason: 'stop',
            usage: modelUsage({}),
            latency: { totalMs: durationMs(1) }
          }
        }
      }
    }
    const extractor = new ModelRoomMemoryExtractor({
      provider,
      providerIdentity: {
        kind: 'model',
        providerProfileId: 'profile-1',
        providerRevision: providerRevision('provider-revision-1')
      },
      roleModel: { role: 'memory', modelId: 'memory-model' },
      nextRequestId: () => 'memory-request-1',
      monotonicNow: () => 100,
      timeoutMs: 1_000
    })

    const candidates = await extractor.extract({
      scope: memoryScope('observation-1'),
      currentRevision: REVISION_ZERO,
      events: [{
        eventId: 'barrage-1',
        sourceType: 'audience_barrage',
        occurredAt: wallClockTimestampMs(10),
        summary: '公开弹幕'
      }]
    }, new AbortController().signal)

    expect(calls).toBe(1)
    expect(request).toMatchObject({
      purpose: 'memory',
      roleModel: { role: 'memory', modelId: 'memory-model' },
      output: { type: 'structured', schemaName: ROOM_MEMORY_EXTRACTION_SCHEMA_NAME },
      stream: false,
      maxOutputTokens: 4_096
    })
    expect(candidates).toEqual([{
      memoryType: 'room_lore',
      content: '本房间喜欢逆风翻盘',
      evidenceEventIds: ['barrage-1'],
      tags: ['游戏'],
      importance: 0.7,
      confidence: 0.8
    }])
  })

  test('bounds detached extraction and rejects a stale memory revision before write', async () => {
    const { repositories } = await migratedFixture()
    const started = deferred<void>()
    const release = deferred<readonly ExtractedRoomMemoryCandidate[]>()
    const service = sideEffects(repositories, {
      async extract() {
        started.resolve()
        return await release.promise
      }
    }, { maxOutstandingExtractions: 1 })

    expect(service.submitAcceptedPublication(submission('barrage-1', REVISION_ZERO))).toBeTrue()
    expect(service.submitAcceptedPublication(submission('barrage-1', REVISION_ZERO))).toBeFalse()
    await started.promise
    await repositories.transactions.run(async (transaction) => {
      await repositories.memories.commitCandidate(
        transaction,
        persistedCandidate('external-memory', REVISION_ZERO, 'external content'),
        wallClockTimestampMs(20)
      )
    })
    release.resolve([extractedCandidate('stale extracted content')])
    await service.idle()

    const active = await repositories.transactions.run(
      async (transaction) => await repositories.memories.listActive(
        transaction,
        ROOM_ID,
        wallClockTimestampMs(30),
        16
      )
    )
    expect(active.map((memory) => memory.content)).toEqual(['external content'])
    expect(service.snapshot()).toEqual({
      accepting: true,
      active: 0,
      queued: 0,
      capacity: 1
    })
  })

  test('stable extracted identity cannot recreate deleted or revoked memory', async () => {
    const { repositories } = await migratedFixture()
    const failures: SharedBrainSideEffectFailure[] = []
    let content = '不得复活的删除记忆'
    let now = 30
    const service = sideEffects(repositories, {
      async extract() {
        return [extractedCandidate(content)]
      }
    }, {
      wallClockNow: () => now,
      onFailure: (failure) => failures.push(failure)
    })

    await submitAtHead(service, repositories)
    let active = await listActive(repositories)
    expect(active).toHaveLength(1)
    now = 40
    await repositories.transactions.run(async (transaction) => {
      await repositories.memories.delete(
        transaction,
        ROOM_ID,
        active[0]!.memoryId,
        active[0]!.revision,
        wallClockTimestampMs(40)
      )
    })
    await submitAtHead(service, repositories)
    expect(await listActive(repositories)).toEqual([])

    content = '不得复活的撤销记忆'
    now = 50
    await submitAtHead(service, repositories)
    active = await listActive(repositories)
    expect(active).toHaveLength(1)
    now = 60
    await repositories.transactions.run(async (transaction) => {
      await repositories.memories.revoke(
        transaction,
        ROOM_ID,
        active[0]!.memoryId,
        active[0]!.revision,
        wallClockTimestampMs(50)
      )
    })
    await submitAtHead(service, repositories)
    expect(await listActive(repositories)).toEqual([])
    expect(failures).toEqual([])
  })

  test('keeps meme proposals mode-scoped and preserves source, undo, decay, and archive', async () => {
    const { repositories } = await migratedFixture()
    let provenanceValid = true
    const now = MODE_MEME_ARCHIVE_AFTER_MS + 1_000
    const service = sideEffects(repositories, {
      async extract() {
        throw new Error('memory extraction is not part of meme proposal')
      }
    }, {
      wallClockNow: () => now,
      provenance: async (_transaction, candidate) =>
        provenanceValid && candidate.namespaceId.startsWith('mode-')
    })
    await repositories.transactions.run(async (transaction) => {
      await repositories.modeMemes.setAutoIngest(
        transaction,
        'mode-pending',
        false,
        REVISION_ZERO,
        wallClockTimestampMs(2)
      )
    })

    expect(await service.proposeMeme(memeCandidate('pending', 'mode-pending', 10)))
      .toEqual({ status: 'pending', candidateId: 'candidate-pending' })
    expect(await service.proposeMeme(memeCandidate('live', 'mode-live', 11)))
      .toMatchObject({ status: 'committed', result: { created: true } })
    const live = await repositories.transactions.run(
      async (transaction) => await repositories.modeMemes.get(
        transaction,
        'mode-live',
        'meme:candidate-live'
      )
    )
    expect(live.source).toMatchObject({
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      audienceEpoch: EPOCH,
      observationId: 'observation-1',
      sourceCandidateId: 'candidate-live',
      evidenceEventIds: ['barrage-1']
    })
    expect((await service.undoMeme('mode-live', live.memeId, live.revision)).state)
      .toBe('revoked')

    provenanceValid = false
    expect(await service.proposeMeme(memeCandidate('invalid', 'mode-live', 12)))
      .toEqual({ status: 'rejected', reason: 'invalid_provenance' })
    provenanceValid = true
    await service.proposeMeme(memeCandidate('old', 'mode-maintenance', 13))
    await service.proposeMeme(memeCandidate('pinned', 'mode-maintenance', 14))
    let pinned = await repositories.transactions.run(
      async (transaction) => await repositories.modeMemes.get(
        transaction,
        'mode-maintenance',
        'meme:candidate-pinned'
      )
    )
    pinned = await repositories.transactions.run(
      async (transaction) => await repositories.modeMemes.setPinned(transaction, {
        namespaceId: pinned.namespaceId,
        memeId: pinned.memeId,
        expectedRevision: pinned.revision,
        pinned: true,
        updatedAt: wallClockTimestampMs(20)
      })
    )

    expect(await service.maintainMemes('mode-maintenance'))
      .toEqual(['meme:candidate-old'])
    await repositories.transactions.run(async (transaction) => {
      const archived = await repositories.modeMemes.get(
        transaction,
        'mode-maintenance',
        'meme:candidate-old'
      )
      const preservedPinned = await repositories.modeMemes.get(
        transaction,
        'mode-maintenance',
        pinned.memeId
      )
      expect(archived).toMatchObject({
        state: 'archived',
        intensity: 0.25,
        source: { sourceCandidateId: 'candidate-old' }
      })
      expect(preservedPinned).toMatchObject({
        state: 'active',
        source: { pinned: true, sourceCandidateId: 'candidate-pinned' }
      })
    })
  })
})

async function migratedFixture() {
  const fixture = createTemporaryAdvxSqliteDatabase('advx-agt-012-')
  cleanups.push(fixture.cleanup)
  await runSqliteMigrations({
    database: fixture.database.withWriteConnection((database) => database),
    databasePath: fixture.database.path,
    migrations: ADVX_SQLITE_MIGRATIONS,
    appVersion: 'agt-012-test',
    nowMs: () => 1
  })
  const transactions = new SqliteTransactionBoundary(fixture.database)
  const repositories = createSqliteRepositories(transactions)
  await transactions.run(async (transaction) => {
    await repositories.rooms.save(transaction, roomRecord(), null)
    await repositories.sessions.save(transaction, sessionRecord(), null)
    await repositories.roomEvents.append(transaction, createRoomEventRecord({
      eventId: 'barrage-1',
      roomId: ROOM_ID,
      sessionId: SESSION_ID,
      sequence: 1,
      sourceType: 'audience_barrage',
      sourceId: 'viewer-1',
      audienceEpoch: EPOCH,
      text: '公开弹幕',
      payload: {
        barrage_id: 'barrage-1',
        audience_epoch: EPOCH,
        observation_id: 'observation-1',
        generation_request_id: 'generation-1',
        viewer_instance_id: 'viewer-1',
        persona_id: 'persona-1',
        display_name: 'Viewer 1',
        viewer_sequence: 1,
        reaction_type: 'comment',
        intent: 'react_to_scene',
        target: null,
        evidence_refs: [],
        expires_at_ms: 10_000
      },
      occurredAt: wallClockTimestampMs(10)
    }))
  })
  return { fixture, repositories }
}

function sideEffects(
  repositories: Awaited<ReturnType<typeof migratedFixture>>['repositories'],
  memoryExtractor: RoomMemoryExtractorPort,
  options: Readonly<{
    maxOutstandingExtractions?: number
    wallClockNow?: () => number
    onFailure?: (failure: SharedBrainSideEffectFailure) => void
    provenance?: (
      transaction: Parameters<Parameters<typeof repositories.transactions.run>[0]>[0],
      candidate: ModeMemeCandidate
    ) => Promise<boolean>
  }> = {}
): SharedBrainSideEffectService {
  return new SharedBrainSideEffectService({
    transactions: repositories.transactions,
    memories: repositories.memories,
    modeMemes: repositories.modeMemes,
    sessionFence: {
      async isCurrent(_transaction, scope) {
        return scope.roomId === ROOM_ID &&
          scope.sessionId === SESSION_ID &&
          scope.audienceEpoch === EPOCH &&
          scope.observationId === 'observation-1'
      }
    },
    memeProvenance: {
      isValid: options.provenance ?? (async () => true)
    },
    memoryExtractor,
    ...(options.maxOutstandingExtractions === undefined
      ? {}
      : { maxOutstandingExtractions: options.maxOutstandingExtractions }),
    ...(options.wallClockNow === undefined ? {} : { wallClockNow: options.wallClockNow }),
    ...(options.onFailure === undefined ? {} : { onFailure: options.onFailure })
  })
}

async function submitAtHead(
  service: SharedBrainSideEffectService,
  repositories: Awaited<ReturnType<typeof migratedFixture>>['repositories']
): Promise<void> {
  const head = await repositories.transactions.run(
    async (transaction) => await repositories.memories.headRevision(transaction, ROOM_ID)
  )
  expect(service.submitAcceptedPublication(submission('barrage-1', head))).toBeTrue()
  await service.idle()
}

async function listActive(
  repositories: Awaited<ReturnType<typeof migratedFixture>>['repositories']
) {
  return await repositories.transactions.run(
    async (transaction) => await repositories.memories.listActive(
      transaction,
      ROOM_ID,
      wallClockTimestampMs(MODE_MEME_ARCHIVE_AFTER_MS + 2_000),
      16
    )
  )
}

function submission(
  eventId: string,
  memoryRevision: Revision
): AcceptedBarrageSideEffectSubmission {
  return {
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    audienceEpoch: EPOCH,
    observationId: 'observation-1',
    memoryRevision,
    event: trustedEvent(eventId)
  }
}

function trustedEvent(eventId: string): TrustedViewerBarrageEvent {
  return {
    type: 'barrage.event',
    publicationKey: 'generation-1:0',
    contextId: 'context-1',
    selectionId: 'selection-1',
    batchId: 'generation-1',
    batchIndex: 0,
    batchSize: 1,
    sourceTextIndex: 0,
    parentEventId: null,
    relatedInputEventIds: ['user-event-1'],
    barrage: {
      barrage_id: eventId,
      room_id: ROOM_ID,
      session_id: SESSION_ID,
      audience_epoch: EPOCH,
      observation_id: 'observation-1',
      generation_request_id: 'generation-1',
      viewer_instance_id: 'viewer-1',
      persona_id: 'persona-1',
      display_name: 'Viewer 1',
      viewer_sequence: 1,
      reaction_type: 'comment',
      intent: 'react_to_scene',
      target: null,
      evidence_refs: [],
      text: '公开弹幕',
      created_at_ms: 10,
      expires_at_ms: 10_000
    }
  }
}

function extractedCandidate(content: string): ExtractedRoomMemoryCandidate {
  return {
    memoryType: 'room_lore',
    content,
    evidenceEventIds: ['barrage-1'],
    tags: ['room'],
    importance: 0.7,
    confidence: 0.8
  }
}

function persistedCandidate(
  id: string,
  baseRevision: Revision,
  content: string
): RoomMemoryCandidate {
  return {
    candidateId: `candidate-${id}`,
    roomId: ROOM_ID,
    idempotencyKey: `idempotency-${id}`,
    baseRevision,
    memoryId: id,
    memoryType: 'room_lore',
    content,
    evidenceEventIds: ['barrage-1'],
    tags: [],
    origin: 'test',
    importance: 0.5,
    confidence: 0.5
  }
}

function memeCandidate(
  id: string,
  namespaceId: string,
  createdAt: number
): ModeMemeCandidate {
  return {
    candidateId: `candidate-${id}`,
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    audienceEpoch: EPOCH,
    observationId: 'observation-1',
    namespaceId,
    text: `meme ${id}`,
    idempotencyKey: `meme-idempotency-${id}`,
    evidenceEventIds: ['barrage-1'],
    evidenceFrameIndexes: [0],
    outcome: 'pending',
    createdAt: wallClockTimestampMs(createdAt)
  }
}

function memoryScope(observationId: string) {
  return {
    roomId: ROOM_ID,
    sessionId: SESSION_ID,
    audienceEpoch: EPOCH,
    observationId
  }
}

function roomRecord(): RoomRecord {
  return {
    roomId: ROOM_ID,
    displayName: 'Room',
    state: 'active',
    revision: REVISION_ZERO,
    createdAt: wallClockTimestampMs(1),
    updatedAt: wallClockTimestampMs(1)
  }
}

function sessionRecord(): SessionRecord {
  return {
    sessionId: SESSION_ID,
    roomId: ROOM_ID,
    state: 'running',
    revision: REVISION_ZERO,
    audienceEpoch: EPOCH,
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((next) => {
    resolve = next
  })
  return { promise, resolve }
}
