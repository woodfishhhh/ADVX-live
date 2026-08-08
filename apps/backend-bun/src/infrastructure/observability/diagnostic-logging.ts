import { createHash } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync
} from 'node:fs'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import pino from 'pino'

export type DiagnosticLevel =
  | 'trace'
  | 'debug'
  | 'info'
  | 'warn'
  | 'error'
  | 'fatal'

export type DiagnosticProcess = 'desktop-main' | 'backend' | 'renderer' | 'overlay'
export type DiagnosticSource = 'text' | 'frame' | 'microphone' | 'system-audio'
export type DiagnosticOutcome = 'success' | 'failure' | 'cancelled' | 'discarded'

export const DIAGNOSTIC_EVENT_NAMES = Object.freeze([
  'backend.start.v1',
  'backend.ready.v1',
  'backend.stop.v1',
  'backend.failure.v1',
  'http.request.v1',
  'ws.connection.v1',
  'ingest.accepted.v1',
  'ingest.discarded.v1',
  'provider.request.v1',
  'provider.result.v1',
  'trace.started.v1',
  'trace.finished.v1',
  'error.reported.v1'
] as const)

export type DiagnosticEventName = (typeof DIAGNOSTIC_EVENT_NAMES)[number]

const VERSIONED_EVENT_NAME = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*\.v[1-9][0-9]*$/
const WINDOWS_USER_PATH = /([A-Za-z]:[\\/]+Users[\\/]+)[^\\/\s]+/gi
const UNIX_USER_PATH = /(\/Users\/)[^\/\s]+/g
const INLINE_SECRET_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+\-/=]+/gi,
  /\b(?:api[-_]?key|authorization|cookie|local[-_]?token|startup[-_]?token|password|secret|token)\s*[:=]\s*["']?[^,\s"'&]+/gi,
  /\bsk-[A-Za-z0-9_-]{8,}/g
]
const SENSITIVE_KEY_PATTERN =
  /(?:api[-_]?key|authorization|cookie|credential|local[-_]?token|startup[-_]?token|password|prompt|response|request[-_]?body|provider[-_]?.*(?:header|request|response|raw)|messages|safe[-_]?storage|encrypted|secret|token|raw[-_]?(?:image|audio|media|prompt|response)|input[-_]?text)/i
const MAX_DEPTH = 6
const DEFAULT_MAX_TEXT = 512

export type DiagnosticEnvelope = Readonly<{
  schemaVersion: 1
  timestamp: string
  level: DiagnosticLevel
  event: string
  process: DiagnosticProcess
  backendStartId?: string
  sessionId?: string
  epoch?: number
  sequence?: number
  traceId?: string
  spanId?: string
  source?: DiagnosticSource
  viewerId?: string
  providerKind?: string
  outcome?: DiagnosticOutcome
  durationMs?: number
  attributes?: Readonly<Record<string, unknown>>
}>

export type DiagnosticEventInput = Readonly<{
  level: DiagnosticLevel
  event: string
  process: DiagnosticProcess
  backendStartId?: string
  sessionId?: string
  epoch?: number
  sequence?: number
  traceId?: string
  spanId?: string
  source?: DiagnosticSource
  viewerId?: string
  providerKind?: string
  outcome?: DiagnosticOutcome
  durationMs?: number
  attributes?: Record<string, unknown>
}>

export type DiagnosticLoggerOptions = Readonly<{
  directory: string
  process: DiagnosticProcess
  level?: DiagnosticLevel
  maxBytes?: number
  backupCount?: number
  fileName?: string
  allowTextExcerpts?: boolean
  now?: () => Date
}>

export type DiagnosticLogger = Readonly<{
  readonly filePath: string
  emit(input: DiagnosticEventInput): DiagnosticEnvelope
  flush(): Promise<void>
  close(): Promise<void>
}>

export function isVersionedDiagnosticEventName(value: string): boolean {
  return VERSIONED_EVENT_NAME.test(value)
}

export function sanitizeDiagnosticValue(
  value: unknown,
  options: Pick<DiagnosticLoggerOptions, 'allowTextExcerpts'> = {}
): unknown {
  return sanitizeValue(value, options.allowTextExcerpts === true, new WeakSet<object>(), 0)
}

export class RotatingJsonlStream extends Writable {
  readonly #filePath: string
  readonly #maxBytes: number
  readonly #backupCount: number
  #bytes: number

  constructor(filePath: string, maxBytes: number, backupCount: number) {
    super()
    this.#filePath = filePath
    this.#maxBytes = maxBytes
    this.#backupCount = backupCount
    this.#bytes = existingBytes(filePath)
  }

  flushSync(): void {}

  get filePath(): string {
    return this.#filePath
  }

  _write(
    chunk: string | Uint8Array,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    try {
      const bytes = Buffer.isBuffer(chunk)
        ? chunk
        : typeof chunk === 'string'
        ? Buffer.from(chunk, encoding)
        : Buffer.from(chunk)
      if (this.#bytes > 0 && this.#bytes + bytes.byteLength > this.#maxBytes) {
        this.rotate()
      }
      appendFileSync(this.#filePath, bytes)
      this.#bytes += bytes.byteLength
      callback()
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private rotate(): void {
    for (let index = this.#backupCount; index >= 1; index -= 1) {
      const source = index === 1 ? this.#filePath : `${this.#filePath}.${index - 1}`
      const target = `${this.#filePath}.${index}`
      if (!existsSync(source)) continue
      if (existsSync(target)) {
        try {
          // Windows does not replace an existing file with renameSync.
          unlinkSync(target)
        } catch {
          continue
        }
      }
      renameSync(source, target)
    }
    this.#bytes = 0
  }
}

export function createDiagnosticLogger(options: DiagnosticLoggerOptions): DiagnosticLogger {
  const fileName = options.fileName ?? 'backend.jsonl'
  if (!/^[A-Za-z0-9._-]+$/.test(fileName)) {
    throw new Error('diagnostic log file name is invalid')
  }
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024
  const backupCount = options.backupCount ?? 5
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new RangeError('diagnostic log maxBytes must be positive')
  }
  if (!Number.isSafeInteger(backupCount) || backupCount < 1 || backupCount > 20) {
    throw new RangeError('diagnostic log backupCount must be between 1 and 20')
  }
  mkdirSync(options.directory, { recursive: true })
  const stream = new RotatingJsonlStream(
    join(options.directory, fileName),
    maxBytes,
    backupCount
  )
  const logger = pino(
    {
      level: options.level ?? 'info',
      timestamp: false,
      formatters: {
        level: (label) => ({ level: label })
      }
    },
    stream
  )
  let closed = false

  return {
    filePath: stream.filePath,
    emit(input) {
      if (closed) throw new Error('diagnostic logger is closed')
      const envelope = normalizeEnvelope(input, options)
      const { level: _level, ...record } = envelope
      const write = logger[envelope.level].bind(logger) as pino.LogFn
      write(record)
      return envelope
    },
    flush() {
      // RotatingJsonlStream appends synchronously, so no buffered bytes remain.
      stream.flushSync()
      return Promise.resolve()
    },
    async close() {
      if (closed) return
      await this.flush()
      // Writes are synchronous and do not hold a file descriptor; destroy the
      // stream without waiting for a platform-specific end callback.
      stream.destroy()
      closed = true
    }
  }
}

function normalizeEnvelope(
  input: DiagnosticEventInput,
  options: DiagnosticLoggerOptions
): DiagnosticEnvelope {
  if (!isVersionedDiagnosticEventName(input.event)) {
    throw new Error(`diagnostic event must be versioned: ${input.event}`)
  }
  if (!isDiagnosticLevel(input.level)) throw new Error('diagnostic level is invalid')
  if (!isDiagnosticProcess(input.process)) throw new Error('diagnostic process is invalid')
  const envelope: DiagnosticEnvelope = {
    schemaVersion: 1,
    timestamp: (options.now ?? (() => new Date()))().toISOString(),
    level: input.level,
    event: input.event,
    process: input.process,
    ...(input.backendStartId === undefined
      ? {}
      : { backendStartId: boundedIdentity(input.backendStartId) }),
    ...(input.sessionId === undefined ? {} : { sessionId: boundedIdentity(input.sessionId) }),
    ...(input.epoch === undefined ? {} : { epoch: boundedCounter(input.epoch, 'epoch') }),
    ...(input.sequence === undefined
      ? {}
      : { sequence: boundedCounter(input.sequence, 'sequence') }),
    ...(input.traceId === undefined ? {} : { traceId: boundedIdentity(input.traceId) }),
    ...(input.spanId === undefined ? {} : { spanId: boundedIdentity(input.spanId) }),
    ...(input.source === undefined ? {} : { source: boundedSource(input.source) }),
    ...(input.viewerId === undefined ? {} : { viewerId: boundedIdentity(input.viewerId) }),
    ...(input.providerKind === undefined
      ? {}
      : { providerKind: boundedIdentity(input.providerKind) }),
    ...(input.outcome === undefined ? {} : { outcome: boundedOutcome(input.outcome) }),
    ...(input.durationMs === undefined
      ? {}
      : { durationMs: boundedDuration(input.durationMs) }),
    ...(input.attributes === undefined
      ? {}
      : {
          attributes: sanitizeDiagnosticRecord(
            input.attributes,
            options.allowTextExcerpts === true
          )
        })
  }
  return Object.freeze(envelope)
}

function sanitizeDiagnosticRecord(
  value: Record<string, unknown>,
  allowTextExcerpts: boolean
): Readonly<Record<string, unknown>> {
  const sanitized = sanitizeValue(value, allowTextExcerpts, new WeakSet<object>(), 0)
  if (sanitized === null || typeof sanitized !== 'object' || Array.isArray(sanitized)) {
    throw new TypeError('diagnostic attributes must be an object')
  }
  return Object.freeze(sanitized as Record<string, unknown>)
}

function sanitizeValue(
  value: unknown,
  allowTextExcerpts: boolean,
  seen: WeakSet<object>,
  depth: number,
  key?: string
): unknown {
  if (key !== undefined && SENSITIVE_KEY_PATTERN.test(key)) return '[REDACTED]'
  if (value === null || value === undefined) return value
  if (typeof value === 'string') return sanitizeText(value, allowTextExcerpts)
  if (typeof value === 'number' || typeof value === 'boolean') {
    return Number.isFinite(value) ? value : String(value)
  }
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'function' || typeof value === 'symbol') return `[${typeof value}]`
  if (depth >= MAX_DEPTH) return '[DEPTH_LIMIT]'

  if (value instanceof Error) {
    if (seen.has(value)) return '[CIRCULAR]'
    seen.add(value)
    return {
      name: sanitizeText(value.name, allowTextExcerpts),
      message: sanitizeText(value.message, allowTextExcerpts),
      ...(value.stack === undefined
        ? {}
        : { stack: sanitizeText(value.stack, allowTextExcerpts) }),
      ...(value.cause === undefined
        ? {}
        : { cause: sanitizeValue(value.cause, allowTextExcerpts, seen, depth + 1, 'cause') })
    }
  }

  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const bytes = Buffer.from(value)
    return {
      type: 'binary',
      byteLength: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex')
    }
  }

  if (typeof value === 'object') {
    if (seen.has(value)) return '[CIRCULAR]'
    seen.add(value)
    if (Array.isArray(value)) {
      return value.map((item) => sanitizeValue(item, allowTextExcerpts, seen, depth + 1))
    }
    const result: Record<string, unknown> = {}
    for (const [childKey, childValue] of Object.entries(value)) {
      result[childKey] = sanitizeValue(
        childValue,
        allowTextExcerpts,
        seen,
        depth + 1,
        childKey
      )
    }
    return result
  }
  return sanitizeText(String(value), allowTextExcerpts)
}

function sanitizeText(value: string, allowTextExcerpts: boolean): string {
  let sanitized = value
  for (const pattern of INLINE_SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      if (/^Bearer\s/i.test(match)) return 'Bearer [REDACTED]'
      if (/^sk-/i.test(match)) return '[REDACTED_KEY]'
      const separator = match.includes('=') ? '=' : ':'
      const key = match.split(/[\s:=]/, 1)[0]
      return `${key}${separator}[REDACTED]`
    })
  }
  sanitized = sanitized
    .replace(WINDOWS_USER_PATH, '$1[REDACTED_PATH]')
    .replace(UNIX_USER_PATH, '$1[REDACTED_PATH]')
  if (sanitized.length <= DEFAULT_MAX_TEXT) return sanitized
  if (allowTextExcerpts) return `${sanitized.slice(0, DEFAULT_MAX_TEXT)}...`
  return `[TEXT_HASH sha256=${createHash('sha256').update(sanitized).digest('hex')} length=${sanitized.length}]`
}

function boundedIdentity(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
    throw new Error('diagnostic identity is invalid')
  }
  return sanitizeText(value, false)
}

function boundedCounter(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} is invalid`)
  return value
}

function boundedDuration(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 86_400_000) {
    throw new Error('diagnostic duration is invalid')
  }
  return value
}

function boundedSource(value: DiagnosticSource): DiagnosticSource {
  if (!['text', 'frame', 'microphone', 'system-audio'].includes(value)) {
    throw new Error('diagnostic source is invalid')
  }
  return value
}

function boundedOutcome(value: DiagnosticOutcome): DiagnosticOutcome {
  if (!['success', 'failure', 'cancelled', 'discarded'].includes(value)) {
    throw new Error('diagnostic outcome is invalid')
  }
  return value
}

function isDiagnosticLevel(value: string): value is DiagnosticLevel {
  return ['trace', 'debug', 'info', 'warn', 'error', 'fatal'].includes(value)
}

function isDiagnosticProcess(value: string): value is DiagnosticProcess {
  return ['desktop-main', 'backend', 'renderer', 'overlay'].includes(value)
}

function existingBytes(filePath: string): number {
  try {
    return statSync(filePath).size
  } catch {
    return 0
  }
}
