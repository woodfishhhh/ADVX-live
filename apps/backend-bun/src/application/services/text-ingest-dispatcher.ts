import type { SessionSnapshot } from '@advx/contracts'

import type {
  TextIngestCommand,
  TextIngestCommandSink,
  TextIngestPort,
  TextIngestReceipt,
  VoiceActivityCommand,
  VoiceActivityPort,
  VoiceActivitySink
} from '../ports/ingest'

export type TextIngestDispatchErrorCode =
  | 'capacity_exceeded'
  | 'pipeline_unavailable'
  | 'session_not_active'

export class TextIngestDispatchError extends Error {
  readonly name = 'TextIngestDispatchError'

  constructor(readonly code: TextIngestDispatchErrorCode) {
    super(code)
  }
}

export type TextIngestDispatcherOptions = Readonly<{
  sessions: TextIngestSessionReader
  sink: TextIngestCommandSink
  capacity: number
  now?: () => number
}>

export type TextIngestDispatcherSnapshot = Readonly<{
  capacity: number
  inFlight: number
}>

export interface TextIngestSessionReader {
  currentSession(): SessionSnapshot | Promise<SessionSnapshot>
}

export class TextIngestDispatcher implements TextIngestPort {
  readonly #now: () => number
  #inFlight = 0

  constructor(private readonly options: TextIngestDispatcherOptions) {
    requireCapacity(options.capacity)
    this.#now = options.now ?? Date.now
  }

  async submitText(command: TextIngestCommand): Promise<TextIngestReceipt> {
    if (this.#inFlight >= this.options.capacity) {
      throw new TextIngestDispatchError('capacity_exceeded')
    }
    this.#inFlight += 1
    try {
      let session: SessionSnapshot
      try {
        session = await this.options.sessions.currentSession()
      } catch {
        throw new TextIngestDispatchError('pipeline_unavailable')
      }
      if (session.session_id !== command.sessionId || session.state !== 'running') {
        throw new TextIngestDispatchError('session_not_active')
      }
      try {
        await this.options.sink.dispatch(command)
      } catch {
        throw new TextIngestDispatchError('pipeline_unavailable')
      }
      return Object.freeze({
        sessionId: command.sessionId,
        inputId: command.inputId,
        inputKind: 'text' as const,
        stage: 'received' as const,
        acceptedAtMs: this.#now()
      })
    } finally {
      this.#inFlight -= 1
    }
  }

  async clearConnection(connectionId: string): Promise<void> {
    await this.options.sink.clearConnection?.(connectionId)
  }

  snapshot(): TextIngestDispatcherSnapshot {
    return Object.freeze({
      capacity: this.options.capacity,
      inFlight: this.#inFlight
    })
  }
}

export type VoiceActivityDispatcherOptions = Readonly<{
  sessions: TextIngestSessionReader
  sink: VoiceActivitySink
}>

export class VoiceActivityDispatcher implements VoiceActivityPort {
  constructor(private readonly options: VoiceActivityDispatcherOptions) {}

  async notifyVoiceActivity(command: VoiceActivityCommand): Promise<void> {
    const session = await this.options.sessions.currentSession()
    if (session.session_id !== command.sessionId || session.state !== 'running') {
      throw new TextIngestDispatchError('session_not_active')
    }
    await this.options.sink.notify(command)
  }
}

export class UnavailableTextIngestSink implements TextIngestCommandSink {
  dispatch(_command: TextIngestCommand): never {
    throw new Error('text ingest sink unavailable')
  }
}

export class UnavailableVoiceActivitySink implements VoiceActivitySink {
  notify(_command: VoiceActivityCommand): never {
    throw new Error('voice activity sink unavailable')
  }
}

function requireCapacity(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_024) {
    throw new RangeError('text ingest capacity must be between 1 and 1024')
  }
}
