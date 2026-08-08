import type { AdvxBinaryAudioSource } from '@advx/contracts'

import type {
  BinaryIngestCommand,
  BinaryIngestCommandSink,
  BinaryIngestPort,
  BinaryIngestReceipt,
  BinaryIngestSessionReader
} from '../ports/ingest'

export type BinaryIngestDispatchErrorCode =
  | 'audio_source_stopped'
  | 'capacity_exceeded'
  | 'capture_source_ended'
  | 'pipeline_unavailable'
  | 'session_not_active'

export class BinaryIngestDispatchError extends Error {
  readonly name = 'BinaryIngestDispatchError'

  constructor(readonly code: BinaryIngestDispatchErrorCode) {
    super(code)
  }
}

export type BinaryIngestDispatcherOptions = Readonly<{
  sessions: BinaryIngestSessionReader
  sink: BinaryIngestCommandSink
  capacity: number
  now?: () => number
}>

export type BinaryIngestDispatcherSnapshot = Readonly<{
  capacity: number
  inFlight: number
  stoppedAudioSources: number
  endedCaptureSources: number
}>

export class BinaryIngestDispatcher implements BinaryIngestPort {
  readonly #stoppedAudioSources = new Set<string>()
  readonly #endedCaptureSources = new Set<string>()
  readonly #now: () => number
  #inFlight = 0

  constructor(private readonly options: BinaryIngestDispatcherOptions) {
    requireCapacity(options.capacity)
    this.#now = options.now ?? Date.now
  }

  async dispatch(command: BinaryIngestCommand): Promise<BinaryIngestReceipt> {
    if (this.#inFlight >= this.options.capacity) {
      throw new BinaryIngestDispatchError('capacity_exceeded')
    }
    this.#inFlight += 1
    try {
      let session
      try {
        session = await this.options.sessions.currentSession()
      } catch {
        throw new BinaryIngestDispatchError('pipeline_unavailable')
      }
      if (
        session.session_id !== command.sessionId ||
        session.state !== 'running'
      ) {
        throw new BinaryIngestDispatchError('session_not_active')
      }
      if (
        command.kind === 'audio' &&
        this.#stoppedAudioSources.has(audioSourceKey(command.sessionId, command.source))
      ) {
        throw new BinaryIngestDispatchError('audio_source_stopped')
      }
      if (
        command.kind === 'frame' &&
        this.#endedCaptureSources.has(command.sessionId)
      ) {
        throw new BinaryIngestDispatchError('capture_source_ended')
      }
      try {
        await this.options.sink.dispatch(command)
      } catch (error) {
        if (error instanceof BinaryIngestDispatchError) throw error
        throw new BinaryIngestDispatchError('pipeline_unavailable')
      }
      return Object.freeze({
        sessionId: command.sessionId,
        inputId: command.inputId,
        inputKind: command.kind,
        stage: command.kind === 'audio' && command.binaryVersion === 3
          ? 'committed'
          : 'received',
        acceptedAtMs: this.#now()
      })
    } finally {
      this.#inFlight -= 1
    }
  }

  async clearConnection(connectionId: string): Promise<void> {
    await this.options.sink.clearConnection?.(connectionId)
  }

  stopAudioSource(sessionId: string, source: AdvxBinaryAudioSource): void {
    this.#stoppedAudioSources.add(audioSourceKey(sessionId, source))
  }

  startAudioSource(sessionId: string, source: AdvxBinaryAudioSource): void {
    this.#stoppedAudioSources.delete(audioSourceKey(sessionId, source))
  }

  endCaptureSource(sessionId: string): void {
    this.#endedCaptureSources.add(sessionId)
  }

  startCaptureSource(sessionId: string): void {
    this.#endedCaptureSources.delete(sessionId)
  }

  clearSession(sessionId: string): void {
    this.#endedCaptureSources.delete(sessionId)
    this.#stoppedAudioSources.delete(audioSourceKey(sessionId, 'microphone'))
    this.#stoppedAudioSources.delete(audioSourceKey(sessionId, 'system_audio'))
  }

  snapshot(): BinaryIngestDispatcherSnapshot {
    return Object.freeze({
      capacity: this.options.capacity,
      inFlight: this.#inFlight,
      stoppedAudioSources: this.#stoppedAudioSources.size,
      endedCaptureSources: this.#endedCaptureSources.size
    })
  }
}

export class UnavailableBinaryIngestSink implements BinaryIngestCommandSink {
  dispatch(_command: BinaryIngestCommand): never {
    throw new Error('binary ingest sink unavailable')
  }
}

function audioSourceKey(sessionId: string, source: AdvxBinaryAudioSource): string {
  return `${sessionId}\u0000${source}`
}

function requireCapacity(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_024) {
    throw new RangeError('binary ingest capacity must be between 1 and 1024')
  }
}
