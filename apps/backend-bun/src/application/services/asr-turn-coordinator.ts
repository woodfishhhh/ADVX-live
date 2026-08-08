import type { AsrTranscript, AudioSource } from '../ports/providers'

export type CoordinatedAsrTranscript = {
  readonly transcript: AsrTranscript
  readonly turnId?: string
  readonly systemAudioRequired?: boolean
}

export type PersistedAsrFinal = CoordinatedAsrTranscript & {
  readonly eventId: string
}

export type AsrObservation = {
  readonly sessionId: AsrTranscript['sessionId']
  readonly triggerEventIds: readonly string[]
  readonly turnId?: string
  readonly systemAudioDegraded?: true
}

export interface AsrRuntimeSink {
  publishPartial(input: CoordinatedAsrTranscript): Promise<void>
  persistFinal(input: CoordinatedAsrTranscript): Promise<{ readonly eventId: string }>
  createObservation(input: AsrObservation): Promise<void>
}

export interface AsrTimerHandle {
  cancel(): void
}

export interface AsrScheduler {
  now(): number
  schedule(delayMs: number, callback: () => Promise<void>): AsrTimerHandle
}

type VoicePause = {
  readonly eventIds: string[]
  endedAt: number
  timer?: AsrTimerHandle
}

type CoordinatedTurn = {
  readonly sessionId: AsrTranscript['sessionId']
  readonly turnId: string
  readonly eventIds: string[]
  readonly sources: Set<AudioSource>
  readonly pendingSources: Set<AudioSource>
  microphoneEndedAt?: number
  systemAudioRequired?: boolean
  timer?: AsrTimerHandle
  degradedTimer?: AsrTimerHandle
}

type CoordinatedTurnClosure = {
  readonly reason: 'cancelled' | 'completed' | 'degraded'
  readonly persistedSources: Set<AudioSource>
  readonly pendingSources: Set<AudioSource>
}

const MICROPHONE_OBSERVATION_PAUSE_MS = 1_500
const REQUIRED_SYSTEM_AUDIO_TIMEOUT_MS = 3_000

export class AsrTurnCoordinator {
  readonly #sink: AsrRuntimeSink
  readonly #scheduler: AsrScheduler
  readonly #seenFinals = new Set<string>()
  readonly #voicePauses = new Map<string, VoicePause>()
  readonly #turns = new Map<string, CoordinatedTurn>()
  readonly #closedTurns = new Map<string, CoordinatedTurnClosure>()
  #stopped = false

  constructor(sink: AsrRuntimeSink, scheduler: AsrScheduler = realAsrScheduler()) {
    this.#sink = sink
    this.#scheduler = scheduler
  }

  async accept(input: CoordinatedAsrTranscript): Promise<void> {
    if (this.#stopped) return
    const { transcript } = input
    if (!transcript.final) {
      await this.#sink.publishPartial(input)
      return
    }

    const finalKey = finalIdentity(transcript)
    if (this.#seenFinals.has(finalKey)) return
    this.#seenFinals.add(finalKey)
    try {
      if (input.turnId !== undefined) {
        await this.#acceptCoordinatedFinal(input, input.turnId)
        return
      }
      const persisted = await this.#sink.persistFinal(input)
      if (this.#stopped) return
      await this.#acceptStandalone(transcript, persisted.eventId)
    } catch (error) {
      this.#seenFinals.delete(finalKey)
      throw error
    }
  }

  cancelTurn(sessionId: AsrTranscript['sessionId'], turnId: string): void {
    const key = turnKey(sessionId, turnId)
    const turn = this.#turns.get(key)
    turn?.timer?.cancel()
    turn?.degradedTimer?.cancel()
    this.#turns.delete(key)
    this.#closedTurns.set(key, {
      reason: 'cancelled',
      persistedSources: new Set(turn?.sources),
      pendingSources: new Set()
    })
  }

  notifyVoiceActivity(sessionId: AsrTranscript['sessionId']): void {
    const pause = this.#voicePauses.get(sessionId)
    pause?.timer?.cancel()
    if (pause) pause.timer = undefined
  }

  stop(): void {
    if (this.#stopped) return
    this.#stopped = true
    for (const pause of this.#voicePauses.values()) pause.timer?.cancel()
    for (const turn of this.#turns.values()) {
      turn.timer?.cancel()
      turn.degradedTimer?.cancel()
    }
    this.#voicePauses.clear()
    this.#turns.clear()
    this.#closedTurns.clear()
  }

  async #acceptStandalone(
    transcript: AsrTranscript,
    eventId: string
  ): Promise<void> {
    if (transcript.source === 'system_audio') {
      await this.#sink.createObservation({
        sessionId: transcript.sessionId,
        triggerEventIds: [eventId]
      })
      return
    }

    const key = transcript.sessionId
    let pause = this.#voicePauses.get(key)
    if (!pause) {
      pause = { eventIds: [], endedAt: transcript.endedAt }
      this.#voicePauses.set(key, pause)
    }
    pause.eventIds.push(eventId)
    pause.endedAt = Math.max(pause.endedAt, transcript.endedAt)
    pause.timer?.cancel()
    const expected = pause
    pause.timer = this.#scheduler.schedule(
      Math.max(0, pause.endedAt + MICROPHONE_OBSERVATION_PAUSE_MS - this.#scheduler.now()),
      async () => {
        if (this.#stopped || this.#voicePauses.get(key) !== expected) return
        this.#voicePauses.delete(key)
        await this.#sink.createObservation({
          sessionId: transcript.sessionId,
          triggerEventIds: [...expected.eventIds]
        })
      }
    )
  }

  async #acceptCoordinatedFinal(
    input: CoordinatedAsrTranscript,
    turnId: string
  ): Promise<void> {
    const { transcript } = input
    const key = turnKey(transcript.sessionId, turnId)
    const closed = this.#closedTurns.get(key)
    if (closed) {
      if (
        closed.reason === 'cancelled' ||
        closed.persistedSources.has(transcript.source) ||
        closed.pendingSources.has(transcript.source)
      ) {
        return
      }
      closed.pendingSources.add(transcript.source)
      try {
        await this.#sink.persistFinal(input)
        closed.pendingSources.delete(transcript.source)
        closed.persistedSources.add(transcript.source)
      } catch (error) {
        closed.pendingSources.delete(transcript.source)
        throw error
      }
      return
    }

    let turn = this.#turns.get(key)
    if (!turn) {
      turn = {
        sessionId: transcript.sessionId,
        turnId,
        eventIds: [],
        sources: new Set(),
        pendingSources: new Set()
      }
      this.#turns.set(key, turn)
    }
    if (
      turn.sources.has(transcript.source) ||
      turn.pendingSources.has(transcript.source)
    ) {
      return
    }
    turn.pendingSources.add(transcript.source)
    let persisted: { readonly eventId: string }
    try {
      persisted = await this.#sink.persistFinal(input)
    } catch (error) {
      turn.pendingSources.delete(transcript.source)
      this.#closedTurns.get(key)?.pendingSources.delete(transcript.source)
      if (
        this.#turns.get(key) === turn &&
        turn.sources.size === 0 &&
        turn.pendingSources.size === 0 &&
        turn.eventIds.length === 0
      ) {
        this.#turns.delete(key)
      }
      throw error
    }
    turn.pendingSources.delete(transcript.source)
    if (this.#stopped) return
    if (this.#turns.get(key) !== turn) {
      const closedAfterPersist = this.#closedTurns.get(key)
      if (
        closedAfterPersist?.reason !== 'cancelled' &&
        closedAfterPersist?.pendingSources.delete(transcript.source)
      ) {
        closedAfterPersist.persistedSources.add(transcript.source)
      }
      return
    }
    turn.sources.add(transcript.source)
    turn.eventIds.push(persisted.eventId)

    if (transcript.source === 'microphone') {
      turn.microphoneEndedAt = transcript.endedAt
      turn.systemAudioRequired = input.systemAudioRequired ?? false
    }

    if (
      turn.sources.has('microphone') &&
      turn.systemAudioRequired &&
      !turn.sources.has('system_audio') &&
      turn.degradedTimer === undefined
    ) {
      const expected = turn
      turn.degradedTimer = this.#scheduler.schedule(
        REQUIRED_SYSTEM_AUDIO_TIMEOUT_MS,
        async () => {
          if (this.#stopped || this.#turns.get(key) !== expected) return
          this.#closeTurn(key, expected, 'degraded')
          await this.#sink.createObservation({
            sessionId: expected.sessionId,
            triggerEventIds: [...expected.eventIds],
            turnId: expected.turnId,
            systemAudioDegraded: true
          })
        }
      )
    }

    if (!coordinatedReady(turn)) return
    turn.degradedTimer?.cancel()
    turn.degradedTimer = undefined
    if (turn.timer !== undefined) return
    const expected = turn
    turn.timer = this.#scheduler.schedule(
      Math.max(
        0,
        (turn.microphoneEndedAt ?? this.#scheduler.now()) +
          MICROPHONE_OBSERVATION_PAUSE_MS -
          this.#scheduler.now()
      ),
      async () => {
        if (this.#stopped || this.#turns.get(key) !== expected) return
        this.#closeTurn(key, expected, 'completed')
        await this.#sink.createObservation({
          sessionId: expected.sessionId,
          triggerEventIds: [...expected.eventIds],
          turnId: expected.turnId
        })
      }
    )
  }

  #closeTurn(
    key: string,
    turn: CoordinatedTurn,
    reason: CoordinatedTurnClosure['reason']
  ): void {
    turn.timer?.cancel()
    turn.degradedTimer?.cancel()
    this.#turns.delete(key)
    this.#closedTurns.set(key, {
      reason,
      persistedSources: new Set(turn.sources),
      pendingSources: new Set(turn.pendingSources)
    })
  }
}

function coordinatedReady(turn: CoordinatedTurn): boolean {
  if (!turn.sources.has('microphone') || turn.microphoneEndedAt === undefined) return false
  return !turn.systemAudioRequired || turn.sources.has('system_audio')
}

function finalIdentity(transcript: AsrTranscript): string {
  return [
    transcript.sessionId,
    transcript.source,
    transcript.utteranceId ?? transcript.responseId
  ].join('\0')
}

function turnKey(sessionId: AsrTranscript['sessionId'], turnId: string): string {
  return `${sessionId}\0${turnId}`
}

function realAsrScheduler(): AsrScheduler {
  return {
    now: () => Date.now(),
    schedule: (delayMs, callback) => {
      const timeout = setTimeout(() => void callback(), delayMs)
      return { cancel: () => clearTimeout(timeout) }
    }
  }
}
