import {
  monotonicDeadline,
  wallClockTimestampMs,
  type AsrProvider,
  type AsrRequest,
  type AsrTranscript,
  type AudioFormat,
  type AudioSource,
  type ProviderCallContext,
  type ProviderFailure,
  type ProviderIdentity,
  type ProviderRoleModel
} from '../../application/ports'
import {
  AsrTurnCoordinator,
  type AsrScheduler,
  type CoordinatedAsrTranscript
} from '../../application/services/asr-turn-coordinator'

export type AsrAudioChunk = {
  readonly sessionId: AsrRequest['sessionId']
  readonly source: AudioSource
  readonly startedAt: AsrRequest['startedAt']
  readonly endedAt: AsrRequest['endedAt']
  readonly format: AudioFormat
  readonly pcm: Readonly<Uint8Array>
  readonly language?: string
  readonly turnId?: string
  readonly systemAudioRequired?: boolean
}

export type AsrChannelPhase =
  | 'idle'
  | 'buffering'
  | 'streaming'
  | 'error'
  | 'stopped'

export type AsrChannelStatus = {
  readonly source: AudioSource
  readonly phase: AsrChannelPhase
  readonly bufferedBytes: number
  readonly pendingSegments: number
  readonly reconnectCount: number
  readonly lastPartial?: AsrTranscript
  readonly lastFinal?: AsrTranscript
  readonly lastFailure?: ProviderFailure
}

export type DualChannelAsrConfig = {
  readonly provider: ProviderIdentity<'asr'>
  readonly roleModel: ProviderRoleModel<'asr'>
  readonly requestDeadlineMs?: number
}

export type DualChannelAsrDependencies = {
  readonly providers: Readonly<Record<AudioSource, AsrProvider>>
  readonly coordinator: AsrTurnCoordinator
  readonly scheduler?: AsrScheduler
  readonly requestId?: (source: AudioSource) => string
  readonly monotonicNow?: () => number
}

type BufferedSegment = {
  readonly sessionId: AsrRequest['sessionId']
  readonly source: AudioSource
  readonly startedAt: AsrRequest['startedAt']
  readonly endedAt: AsrRequest['endedAt']
  readonly format: AudioFormat
  readonly pcm: Uint8Array
  readonly language?: string
  readonly turnId?: string
  readonly systemAudioRequired?: boolean
}

const SENTENCE_SILENCE_MS = 800
const SYSTEM_AUDIO_MAXIMUM_MS = 8_000

export class DualChannelAsr {
  readonly #channels: Readonly<Record<AudioSource, AsrChannel>>
  readonly #coordinator: AsrTurnCoordinator

  constructor(config: DualChannelAsrConfig, dependencies: DualChannelAsrDependencies) {
    if (dependencies.providers.microphone === dependencies.providers.system_audio) {
      throw new Error('ASR channels require independent Provider instances')
    }
    this.#coordinator = dependencies.coordinator
    const scheduler = dependencies.scheduler ?? realScheduler()
    const shared = {
      config,
      coordinator: dependencies.coordinator,
      scheduler,
      requestId: dependencies.requestId ?? ((source: AudioSource) => `${source}-${crypto.randomUUID()}`),
      monotonicNow: dependencies.monotonicNow ?? (() => performance.now())
    }
    this.#channels = {
      microphone: new AsrChannel('microphone', dependencies.providers.microphone, shared),
      system_audio: new AsrChannel('system_audio', dependencies.providers.system_audio, shared)
    }
  }

  async push(chunk: AsrAudioChunk): Promise<void> {
    if (chunk.source === 'microphone') {
      this.#channels.microphone.notifyVoiceActivity(chunk.sessionId)
    }
    await this.#channels[chunk.source].push(chunk)
  }

  async flush(source: AudioSource): Promise<void> {
    await this.#channels[source].flush()
  }

  async reconnect(source: AudioSource): Promise<void> {
    await this.#channels[source].reconnect()
  }

  status(source: AudioSource): AsrChannelStatus {
    return this.#channels[source].status()
  }

  async stop(): Promise<void> {
    this.#channels.microphone.beginStop()
    this.#channels.system_audio.beginStop()
    this.#coordinator.stop()
    this.#channels.microphone.cancelBuffer()
    this.#channels.system_audio.cancelBuffer()
    await Promise.all([
      this.#channels.microphone.drain(),
      this.#channels.system_audio.drain()
    ])
  }
}

type AsrChannelShared = {
  readonly config: DualChannelAsrConfig
  readonly coordinator: AsrTurnCoordinator
  readonly scheduler: AsrScheduler
  readonly requestId: (source: AudioSource) => string
  readonly monotonicNow: () => number
}

class AsrChannel {
  readonly #source: AudioSource
  readonly #provider: AsrProvider
  readonly #shared: AsrChannelShared
  #buffer: AsrAudioChunk[] = []
  #silenceTimer: ReturnType<AsrScheduler['schedule']> | undefined
  #maximumTimer: ReturnType<AsrScheduler['schedule']> | undefined
  #controller = new AbortController()
  #generation = 0
  #phase: AsrChannelPhase = 'idle'
  #pendingSegments = 0
  #reconnectCount = 0
  #lastPartial: AsrTranscript | undefined
  #lastFinal: AsrTranscript | undefined
  #lastFailure: ProviderFailure | undefined
  #queue: Promise<void> = Promise.resolve()

  constructor(source: AudioSource, provider: AsrProvider, shared: AsrChannelShared) {
    this.#source = source
    this.#provider = provider
    this.#shared = shared
  }

  async push(chunk: AsrAudioChunk): Promise<void> {
    if (this.#phase === 'stopped') throw new Error(`ASR channel is stopped: ${this.#source}`)
    validateChunk(chunk, this.#source)
    const last = this.#buffer.at(-1)
    if (last && chunk.startedAt < last.endedAt) {
      throw new RangeError('ASR audio chunks must be ordered and non-overlapping')
    }
    if (last && !sameSegmentIdentity(last, chunk)) {
      await this.flush()
    } else if (last && chunk.startedAt >= last.endedAt + SENTENCE_SILENCE_MS) {
      await this.flush()
    }

    if (this.#source === 'system_audio') {
      await this.#appendSystemAudio(chunk)
    } else {
      this.#buffer.push(chunk)
    }
    this.#scheduleBoundaries()
    if (this.#phase !== 'streaming') this.#phase = 'buffering'
  }

  notifyVoiceActivity(sessionId: AsrRequest['sessionId']): void {
    this.#shared.coordinator.notifyVoiceActivity(sessionId)
  }

  async #appendSystemAudio(chunk: AsrAudioChunk): Promise<void> {
    let remaining: AsrAudioChunk | undefined = chunk
    while (remaining) {
      const first = this.#buffer[0]
      const cutoff = first === undefined
        ? remaining.startedAt + SYSTEM_AUDIO_MAXIMUM_MS
        : first.startedAt + SYSTEM_AUDIO_MAXIMUM_MS
      if (remaining.endedAt <= cutoff) {
        this.#buffer.push(remaining)
        return
      }
      const [before, after] = splitChunk(remaining, cutoff)
      if (before) this.#buffer.push(before)
      await this.flush()
      remaining = after
    }
  }

  async flush(): Promise<void> {
    this.#cancelTimers()
    if (this.#buffer.length === 0) return this.#queue
    const segment = mergeChunks(this.#buffer)
    this.#buffer = []
    const generation = this.#generation
    this.#pendingSegments += 1
    this.#queue = this.#queue.then(async () => {
      try {
        await this.#transcribe(segment, generation)
      } finally {
        this.#pendingSegments -= 1
        if (
          this.#phase !== 'stopped' &&
          this.#phase !== 'error' &&
          this.#pendingSegments === 0
        ) {
          this.#phase = this.#buffer.length > 0 ? 'buffering' : 'idle'
        }
      }
    })
    await this.#queue
  }

  async #transcribe(segment: BufferedSegment, generation: number): Promise<void> {
    if (generation !== this.#generation || this.#phase === 'stopped') return
    this.#phase = 'streaming'
    this.#lastFailure = undefined
    const request: AsrRequest = {
      requestId: this.#shared.requestId(this.#source),
      provider: this.#shared.config.provider,
      roleModel: this.#shared.config.roleModel,
      sessionId: segment.sessionId,
      source: segment.source,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
      format: segment.format,
      pcm: segment.pcm,
      ...(segment.language === undefined ? {} : { language: segment.language })
    }
    const context = callContext(
      this.#controller.signal,
      this.#shared.monotonicNow,
      this.#shared.config.requestDeadlineMs ?? 30_000
    )
    for await (const event of this.#provider.transcribe(request, context)) {
      if (generation !== this.#generation) return
      if (event.type === 'failed') {
        this.#lastFailure = event.error
        this.#phase = 'error'
        return
      }
      const coordinated: CoordinatedAsrTranscript = {
        transcript: event.transcript,
        ...(segment.turnId === undefined ? {} : { turnId: segment.turnId }),
        ...(segment.systemAudioRequired === undefined
          ? {}
          : { systemAudioRequired: segment.systemAudioRequired })
      }
      if (event.transcript.final) this.#lastFinal = event.transcript
      else this.#lastPartial = event.transcript
      await this.#shared.coordinator.accept(coordinated)
    }
  }

  async reconnect(): Promise<void> {
    if (this.#phase === 'stopped') throw new Error(`ASR channel is stopped: ${this.#source}`)
    this.#cancelTimers()
    this.#buffer = []
    this.#controller.abort('reconnect')
    this.#controller = new AbortController()
    this.#generation += 1
    this.#reconnectCount += 1
    this.#lastFailure = undefined
    await this.#queue
    this.#phase = 'idle'
  }

  beginStop(): void {
    if (this.#phase === 'stopped') return
    this.#phase = 'stopped'
    this.#generation += 1
    this.#controller.abort('stopped')
    this.#cancelTimers()
  }

  cancelBuffer(): void {
    this.#buffer = []
  }

  async drain(): Promise<void> {
    await this.#queue
  }

  status(): AsrChannelStatus {
    return {
      source: this.#source,
      phase: this.#phase,
      bufferedBytes: this.#buffer.reduce((total, chunk) => total + chunk.pcm.byteLength, 0),
      pendingSegments: this.#pendingSegments,
      reconnectCount: this.#reconnectCount,
      ...(this.#lastPartial === undefined ? {} : { lastPartial: this.#lastPartial }),
      ...(this.#lastFinal === undefined ? {} : { lastFinal: this.#lastFinal }),
      ...(this.#lastFailure === undefined ? {} : { lastFailure: this.#lastFailure })
    }
  }

  #scheduleBoundaries(): void {
    this.#cancelTimers()
    const first = this.#buffer[0]
    const last = this.#buffer.at(-1)
    if (!first || !last) return
    this.#silenceTimer = this.#shared.scheduler.schedule(
      Math.max(0, last.endedAt + SENTENCE_SILENCE_MS - this.#shared.scheduler.now()),
      async () => this.flush()
    )
    if (this.#source === 'system_audio') {
      this.#maximumTimer = this.#shared.scheduler.schedule(
        Math.max(0, first.startedAt + SYSTEM_AUDIO_MAXIMUM_MS - this.#shared.scheduler.now()),
        async () => this.flush()
      )
    }
  }

  #cancelTimers(): void {
    this.#silenceTimer?.cancel()
    this.#maximumTimer?.cancel()
    this.#silenceTimer = undefined
    this.#maximumTimer = undefined
  }
}

function validateChunk(chunk: AsrAudioChunk, source: AudioSource): void {
  if (chunk.source !== source) throw new Error('ASR chunk source does not match channel')
  if (chunk.endedAt < chunk.startedAt) throw new RangeError('ASR chunk time range is reversed')
  if (
    chunk.format.sampleRateHz !== 16_000 ||
    chunk.format.channels !== 1 ||
    chunk.format.sampleWidthBits !== 16
  ) {
    throw new RangeError('StepFun ASR requires 16000 Hz mono 16-bit PCM')
  }
  if (chunk.pcm.byteLength % 2 !== 0) throw new RangeError('PCM must contain complete samples')
}

function sameSegmentIdentity(left: AsrAudioChunk, right: AsrAudioChunk): boolean {
  return left.sessionId === right.sessionId &&
    left.turnId === right.turnId &&
    left.systemAudioRequired === right.systemAudioRequired &&
    left.language === right.language &&
    left.format.sampleRateHz === right.format.sampleRateHz &&
    left.format.channels === right.format.channels &&
    left.format.sampleWidthBits === right.format.sampleWidthBits
}

function splitChunk(
  chunk: AsrAudioChunk,
  cutoff: number
): readonly [AsrAudioChunk | undefined, AsrAudioChunk | undefined] {
  if (cutoff <= chunk.startedAt) return [undefined, chunk]
  if (cutoff >= chunk.endedAt) return [chunk, undefined]
  const frameBytes = chunk.format.channels * (chunk.format.sampleWidthBits / 8)
  const framesBefore = Math.floor(
    ((cutoff - chunk.startedAt) * chunk.format.sampleRateHz) / 1_000
  )
  const byteOffset = Math.min(
    chunk.pcm.byteLength,
    Math.max(frameBytes, framesBefore * frameBytes)
  )
  const shared = {
    sessionId: chunk.sessionId,
    source: chunk.source,
    format: chunk.format,
    language: chunk.language,
    turnId: chunk.turnId,
    systemAudioRequired: chunk.systemAudioRequired
  }
  return [
    {
      ...shared,
      startedAt: chunk.startedAt,
      endedAt: wallClockTimestampMs(cutoff),
      pcm: chunk.pcm.slice(0, byteOffset)
    },
    {
      ...shared,
      startedAt: wallClockTimestampMs(cutoff),
      endedAt: chunk.endedAt,
      pcm: chunk.pcm.slice(byteOffset)
    }
  ]
}

function mergeChunks(chunks: readonly AsrAudioChunk[]): BufferedSegment {
  const first = chunks[0]
  const last = chunks.at(-1)
  if (!first || !last) throw new Error('cannot merge an empty ASR buffer')
  const byteLength = chunks.reduce((total, chunk) => total + chunk.pcm.byteLength, 0)
  const pcm = new Uint8Array(byteLength)
  let offset = 0
  for (const chunk of chunks) {
    pcm.set(chunk.pcm, offset)
    offset += chunk.pcm.byteLength
  }
  return {
    sessionId: first.sessionId,
    source: first.source,
    startedAt: first.startedAt,
    endedAt: last.endedAt,
    format: first.format,
    pcm,
    ...(first.language === undefined ? {} : { language: first.language }),
    ...(first.turnId === undefined ? {} : { turnId: first.turnId }),
    ...(first.systemAudioRequired === undefined
      ? {}
      : { systemAudioRequired: first.systemAudioRequired })
  }
}

function callContext(
  signal: AbortSignal,
  monotonicNow: () => number,
  requestDeadlineMs: number
): ProviderCallContext {
  return {
    callerSignal: signal,
    deadline: monotonicDeadline(monotonicNow() + requestDeadlineMs),
    cancellationReason: () => signal.aborted
      ? { code: 'caller_cancelled', messageCode: 'provider.aborted' }
      : undefined
  }
}

function realScheduler(): AsrScheduler {
  return {
    now: () => Date.now(),
    schedule: (delayMs, callback) => {
      const timeout = setTimeout(() => void callback(), delayMs)
      return { cancel: () => clearTimeout(timeout) }
    }
  }
}
