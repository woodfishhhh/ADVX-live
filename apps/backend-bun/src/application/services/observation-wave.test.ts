import { describe, expect, test } from 'bun:test'
import type {
  Epoch,
  Revision,
  RoomId,
  SessionId
} from '@advx/contracts'

import {
  wallClockTimestampMs,
  type RoomEventContextQuery,
  type RoomEventContextWindow,
  type RoomEventRecord,
  type RoomMemorySlice
} from '../ports'
import {
  DIRECT_FRAME_WINDOW_MS,
  FRAME_BUNDLE_LIMIT,
  FRAME_SEGMENT_ANCHOR_MS,
  FRAME_SIMILARITY_THRESHOLD,
  FRAME_TIMELINE_WINDOW_MS,
  OBSERVATION_MERGE_WINDOW_MS,
  OBSERVATION_PUBLIC_LIMIT,
  OBSERVATION_PUBLIC_WINDOW_MS,
  OBSERVATION_REPLY_LIMIT,
  OBSERVATION_REPLY_WINDOW_MS,
  OBSERVATION_REQUEST_TTL_MS,
  ObservationWaveService,
  SCREEN_CHANGE_THRESHOLD,
  SCREEN_TRIGGER_COOLDOWN_MS,
  selectObservationFrames,
  type ObservationFrame,
  type ObservationWaveDependencies
} from './observation-wave'

describe('AGT-006 ObservationWave', () => {
  test('freezes a non-extending one-second input wave with exact context and memory bounds', async () => {
    const contextQueries: RoomEventContextQuery[] = []
    const memoryQueries: Parameters<ObservationWaveDependencies['readRoomMemory']>[0][] = []
    const recent = roomEvent('recent-user', 500)
    const future = roomEvent('future-user', 1_001)
    const dependencies = observationDependencies({
      readContext: async (query) => {
        contextQueries.push(query)
        return contextWindow([recent, future], [], ['text-1', 'voice-1'])
      },
      readRoomMemory: async (query) => {
        memoryQueries.push(query)
        return roomMemory(7, ['memory-7'])
      }
    })
    const service = observationService(dependencies)

    expect((await service.submit(input('text-1', 'user_text', 0))).status).toBe(
      'buffered'
    )
    expect((await service.submit(input('system-1', 'system_audio', 500))).status).toBe(
      'dropped_lower_priority'
    )
    expect((await service.submit(input('voice-1', 'final_voice', 999))).status).toBe(
      'buffered'
    )
    expect(await service.flush(wallClockTimestampMs(999))).toBeNull()

    const wave = await service.flush(wallClockTimestampMs(1_000))
    expect(wave).not.toBeNull()
    expect(wave?.createdAt).toBe(wallClockTimestampMs(0))
    expect(wave?.frozenAt).toBe(wallClockTimestampMs(OBSERVATION_MERGE_WINDOW_MS))
    expect(wave?.mergeWindowEndsAt).toBe(
      wallClockTimestampMs(OBSERVATION_MERGE_WINDOW_MS)
    )
    expect(wave?.deadlineAt).toBe(wallClockTimestampMs(OBSERVATION_REQUEST_TTL_MS))
    expect(wave?.priority).toBe(50)
    expect(wave?.triggers).toEqual(['user_text', 'final_voice'])
    expect(wave?.triggerEvents.map((event) => event.source)).toEqual([
      'user_text',
      'final_voice'
    ])
    expect(wave?.inputEventIds).toEqual(['text-1', 'voice-1'])
    expect(wave?.context.publicContext.map((event) => event.eventId)).toEqual([
      'recent-user'
    ])
    expect(wave?.roomMemory.memoryRevision).toBe(7)
    expect(Object.isFrozen(wave)).toBe(true)
    expect(Object.isFrozen(wave?.context.publicContext)).toBe(true)
    expect(Object.isFrozen(wave?.roomMemory.items)).toBe(true)

    expect(contextQueries).toEqual([
      {
        roomId: 'room-1',
        sessionId: 'session-1',
        observedAt: wallClockTimestampMs(1_000),
        publicWindowMs: OBSERVATION_PUBLIC_WINDOW_MS,
        replyWindowMs: OBSERVATION_REPLY_WINDOW_MS,
        publicLimit: OBSERVATION_PUBLIC_LIMIT,
        replyLimit: OBSERVATION_REPLY_LIMIT,
        triggerEventIds: ['text-1', 'voice-1']
      }
    ])
    expect(memoryQueries).toEqual([
      {
        roomId: 'room-1',
        evidenceEventIds: ['text-1', 'voice-1'],
        observedAt: wallClockTimestampMs(1_000),
        limit: 16
      }
    ])

    const replay = observationService(dependencies)
    await replay.submit(input('text-1', 'user_text', 0))
    await replay.submit(input('voice-1', 'final_voice', 999))
    const replayedWave = await replay.flush(wallClockTimestampMs(1_000))
    expect(replayedWave?.replayIdentity).toBe(wave?.replayIdentity)
    expect(replayedWave?.observationId).toBe(wave?.observationId)
  })

  test('blocks recursive barrage and admits screen triggers only at the exact cooldown while idle', async () => {
    const service = observationService(observationDependencies())

    expect(
      (await service.submit(input('barrage-1', 'audience_barrage', 0))).status
    ).toBe('ignored_recursive_barrage')
    expect(
      (
        await service.submit(
          frameInput('frame-repeat', 0, SCREEN_CHANGE_THRESHOLD - 0.01)
        )
      ).status
    ).toBe('ignored_repeated_frame')

    const ambient = await service.submit(input('ambient-1', 'ambient_tick', 1_000))
    expect(ambient.status).toBe('emitted')
    expect(ambient.waves[0]?.priority).toBe(10)
    expect(service.completeWave(ambient.waves[0]!.observationId)).toBe(true)

    expect(
      (
        await service.submit(
          frameInput(
            'frame-cooldown',
            1_000 + SCREEN_TRIGGER_COOLDOWN_MS - 1,
            SCREEN_CHANGE_THRESHOLD
          )
        )
      ).status
    ).toBe('dropped_screen_cooldown')

    const screen = await service.submit(
      frameInput(
        'frame-trigger',
        1_000 + SCREEN_TRIGGER_COOLDOWN_MS,
        SCREEN_CHANGE_THRESHOLD
      )
    )
    expect(screen.status).toBe('emitted')
    expect(screen.waves[0]?.priority).toBe(30)
    expect(screen.waves[0]?.triggers).toEqual(['screen_change'])
    expect(screen.waves[0]?.triggerFrameIds).toEqual(['frame-trigger'])
    expect(
      (
        await service.submit(
          frameInput('frame-processing', 12_000, SCREEN_CHANGE_THRESHOLD)
        )
      ).status
    ).toBe('dropped_screen_busy')
    expect(service.completeWave(screen.waves[0]!.observationId)).toBe(true)

    await service.submit(input('text-pending', 'user_text', 13_000))
    expect(
      (
        await service.submit(
          frameInput('frame-pending', 13_500, SCREEN_CHANGE_THRESHOLD)
        )
      ).status
    ).toBe('dropped_screen_busy')
  })

  test('compares every segment frame to its first reference and keeps segment ends', () => {
    const comparisons = new Map([
      ['f0:f1', 0.95],
      ['f0:f2', 0.89],
      ['f1:f2', 0.99],
      ['f2:f3', 0.95]
    ])
    const bundle = selectObservationFrames({
      frames: [frame('f0', 0), frame('f1', 1_000), frame('f2', 2_000), frame('f3', 3_000)],
      triggerFrameIds: [],
      observedAt: wallClockTimestampMs(3_000),
      sessionStartedAt: wallClockTimestampMs(0),
      visualMode: 'shared_summary',
      compareFrames: (reference, candidate) =>
        comparisons.get(`${reference.frameId}:${candidate.frameId}`) ?? 0
    })
    expect(bundle.frames.map((item) => item.frameId)).toEqual(['f1', 'f3'])
    expect(bundle.similarityThreshold).toBe(FRAME_SIMILARITY_THRESHOLD)

    const anchored = selectObservationFrames({
      frames: Array.from({ length: 7 }, (_, index) =>
        frame(`static-${index}`, index * 1_000)
      ),
      triggerFrameIds: [],
      observedAt: wallClockTimestampMs(6_000),
      sessionStartedAt: wallClockTimestampMs(0),
      visualMode: 'shared_summary',
      compareFrames: () => 1
    })
    expect(anchored.frames.map((item) => item.frameId)).toEqual([
      'static-5',
      'static-6'
    ])
    expect(anchored.anchorIntervalMs).toBe(FRAME_SEGMENT_ANCHOR_MS)
  })

  test('uses 120 seconds, preserves an old trigger in direct mode, and samples at most 15 in time order', () => {
    const observedAt = 120_000
    const triggerFrameId = 'frame-80'
    const bundle = selectObservationFrames({
      frames: Array.from({ length: 121 }, (_, second) =>
        frame(`frame-${second}`, second * 1_000)
      ),
      triggerFrameIds: [triggerFrameId],
      observedAt: wallClockTimestampMs(observedAt),
      sessionStartedAt: wallClockTimestampMs(0),
      visualMode: 'direct_frames',
      compareFrames: () => 0
    })

    expect(bundle.timelineWindowMs).toBe(FRAME_TIMELINE_WINDOW_MS)
    expect(bundle.maximumFrames).toBe(FRAME_BUNDLE_LIMIT)
    expect(bundle.frames).toHaveLength(FRAME_BUNDLE_LIMIT)
    expect(bundle.frames.some((item) => item.frameId === triggerFrameId)).toBe(true)
    expect(
      bundle.frames.every(
        (item) =>
          item.frameId === triggerFrameId ||
          item.capturedAt >= observedAt - DIRECT_FRAME_WINDOW_MS
      )
    ).toBe(true)
    expect(bundle.frames.map((item) => item.frameIndex)).toEqual(
      Array.from({ length: FRAME_BUNDLE_LIMIT }, (_, index) => index)
    )
    expect(bundle.frames.map((item) => item.capturedAt)).toEqual(
      [...bundle.frames.map((item) => item.capturedAt)].sort((left, right) => left - right)
    )
  })

  test('samples irregular representatives uniformly by timestamp', () => {
    const candidateSeconds = [
      ...Array.from({ length: 60 }, (_, second) => second),
      ...Array.from({ length: 15 }, (_, index) => 63 + index * 4)
    ]
    const bundle = selectObservationFrames({
      frames: candidateSeconds.map((second) =>
        frame(`frame-${second}`, second * 1_000)
      ),
      triggerFrameIds: [],
      observedAt: wallClockTimestampMs(119_000),
      sessionStartedAt: wallClockTimestampMs(0),
      visualMode: 'shared_summary',
      compareFrames: () => 0
    })

    expect(bundle.frames.map((item) => item.capturedAt / 1_000)).toEqual([
      0, 8, 17, 25, 34, 42, 51, 59, 67, 75, 83, 95, 103, 111, 119
    ])
  })

  test('uses every available young-session second and keeps the latest frame in a second', () => {
    const bundle = selectObservationFrames({
      frames: [
        frame('frame-0', 0),
        frame('frame-1-early', 1_000),
        frame('frame-1-late', 1_500),
        frame('frame-2', 2_000),
        frame('frame-3', 3_000),
        frame('frame-4', 4_000)
      ],
      triggerFrameIds: [],
      observedAt: wallClockTimestampMs(4_000),
      sessionStartedAt: wallClockTimestampMs(0),
      visualMode: 'direct_frames',
      compareFrames: () => 0
    })
    expect(bundle.frames.map((item) => item.frameId)).toEqual([
      'frame-0',
      'frame-1-late',
      'frame-2',
      'frame-3',
      'frame-4'
    ])
  })
})

function observationService(
  dependencies: ObservationWaveDependencies
): ObservationWaveService {
  return new ObservationWaveService(
    {
      roomId: 'room-1' as RoomId,
      sessionId: 'session-1' as SessionId,
      audienceEpoch: 1 as Epoch,
      runtimeRevision: 1 as Revision,
      sessionStartedAt: wallClockTimestampMs(0)
    },
    dependencies
  )
}

function observationDependencies(
  overrides: Partial<ObservationWaveDependencies> = {}
): ObservationWaveDependencies {
  return {
    readContext: async () => contextWindow(),
    readRoomMemory: async () => roomMemory(1),
    compareFrames: () => 0,
    createReplayIdentity: (input) =>
      new Bun.CryptoHasher('sha256').update(input).digest('hex'),
    ...overrides
  }
}

function input(
  eventId: string,
  source: 'user_text' | 'final_voice' | 'system_audio' | 'ambient_tick' | 'audience_barrage',
  occurredAt: number
) {
  return {
    eventId,
    source,
    occurredAt: wallClockTimestampMs(occurredAt)
  } as const
}

function frameInput(eventId: string, occurredAt: number, screenChangeScore: number) {
  return {
    eventId,
    source: 'frame',
    occurredAt: wallClockTimestampMs(occurredAt),
    frame: frame(eventId, occurredAt, screenChangeScore),
    screenChangeScore
  } as const
}

function frame(
  frameId: string,
  capturedAt: number,
  changeScore = 0
): ObservationFrame {
  return {
    frameId,
    capturedAt: wallClockTimestampMs(capturedAt),
    width: 1_280,
    height: 720,
    encoding: 'image/jpeg',
    contentHash: hashFor(frameId),
    dataRef: `frame://${frameId}`,
    changeScore
  }
}

function contextWindow(
  publicContext: readonly RoomEventRecord[] = [],
  replyContext: readonly RoomEventRecord[] = [],
  observationTriggerEventIds: readonly string[] = []
): RoomEventContextWindow {
  return { publicContext, replyContext, observationTriggerEventIds }
}

function roomEvent(eventId: string, occurredAt: number): RoomEventRecord {
  return {
    eventId,
    roomId: 'room-1' as RoomId,
    sessionId: 'session-1' as SessionId,
    sequence: occurredAt + 1,
    sourceType: 'user_text',
    sourceId: null,
    audienceEpoch: 1 as Epoch,
    text: eventId,
    payload: {},
    evidenceEventIds: [],
    contentJson: '{}',
    contentHash: hashFor(eventId),
    occurredAt: wallClockTimestampMs(occurredAt)
  }
}

function roomMemory(revision: number, memoryIds: readonly string[] = []): RoomMemorySlice {
  return {
    roomId: 'room-1' as RoomId,
    memoryRevision: revision as Revision,
    memoryIds,
    items: []
  }
}

function hashFor(value: string): string {
  return new Bun.CryptoHasher('sha256').update(value).digest('hex')
}
