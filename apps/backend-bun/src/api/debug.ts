import { Elysia } from 'elysia'

import type { BackendApplication } from '../application'
import type { BinaryIngestDispatcher, BinaryIngestDispatcherSnapshot } from '../application/services/binary-ingest-dispatcher'
import type { RealtimeHub, RealtimeHubSnapshot } from '../application/services/realtime-hub'
import type { TextIngestDispatcher, TextIngestDispatcherSnapshot } from '../application/services/text-ingest-dispatcher'
import { traceContextFromRequest } from '../application/ports/observability'
import {
  ADVX_HTTP_PROTOCOL_VERSION,
  replayRequestSchema,
  replayResultSchema,
  type SessionSnapshot
} from '@advx/contracts'
import {
  ReplayService,
  ReplayServiceError
} from '../application/services/replay-service'

type ResponseSet = {
  status?: number | string
  headers: Record<string, string | number>
}

type DatabaseHealth = Readonly<{
  status: string
  ready: boolean
  writableOwnerHeld: boolean
  journalMode: string | null
  busyTimeoutMs: number | null
  foreignKeys: boolean
  synchronous: string | null
  quickCheck: string | null
  failureCode: string | null
}>

export type DebugEventSummary = Readonly<{
  timestamp: string
  level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  event: string
  session_id?: string
  epoch?: number
  outcome?: 'success' | 'failure' | 'cancelled' | 'discarded'
  reason?: string
}>

export type DebugEventStore = Readonly<{
  query(input: { limit: number; cursor: string | null }): {
    items: readonly DebugEventSummary[]
    next_cursor: string | null
    last_fatal_or_degraded_reason: string | null
  }
}>

export type DebugCaptureSource = Readonly<{
  source: string
  status: 'active' | 'inactive' | 'unknown'
  reason?: string
}>

export type DebugProvider = Readonly<{
  id: string
  model: string
  base_url: string
  availability: 'configured' | 'unconfigured' | 'unknown'
  circuit: 'closed' | 'open' | 'half_open' | 'unknown'
}>

export type DebugApiOptions = Readonly<{
  application: BackendApplication
  authorize: (authorization: string | null) => boolean
  backendVersion: string
  buildId: string
  backendStartId: string
  binaryIngest?: BinaryIngestDispatcher
  textIngest?: TextIngestDispatcher
  realtime?: RealtimeHub
  database?: { health(): DatabaseHealth }
  databaseSchemaVersion?: number
  providers?: readonly Readonly<{ id: string; model: string; baseUrl: string }>[]
  captureSources?: () => readonly DebugCaptureSource[]
  events?: DebugEventStore
  replay?: ReplayService
}>

const DEFAULT_EVENT_STORE: DebugEventStore = Object.freeze({
  query: () => ({
    items: Object.freeze([]),
    next_cursor: null,
    last_fatal_or_degraded_reason: null
  })
})

export class BoundedDebugEventStore implements DebugEventStore {
  readonly #capacity: number
  readonly #items: DebugEventSummary[] = []
  #lastFatalOrDegradedReason: string | null = null

  constructor(capacity = 128) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1_024) {
      throw new RangeError('debug event capacity must be between 1 and 1024')
    }
    this.#capacity = capacity
  }

  append(event: DebugEventSummary): void {
    this.#items.push(Object.freeze({ ...event }))
    while (this.#items.length > this.#capacity) this.#items.shift()
    if (event.level === 'fatal' || event.level === 'error' || event.reason !== undefined) {
      this.#lastFatalOrDegradedReason = event.reason ?? event.event
    }
  }

  query(input: { limit: number; cursor: string | null }) {
    const start = input.cursor === null ? 0 : parseCursor(input.cursor)
    const end = Math.min(start + input.limit, this.#items.length)
    return {
      items: Object.freeze(this.#items.slice(start, end)),
      next_cursor: end < this.#items.length ? String(end) : null,
      last_fatal_or_degraded_reason: this.#lastFatalOrDegradedReason
    }
  }
}

export function createDebugApi(options: DebugApiOptions) {
  return new Elysia({ name: 'advx-debug-api' })
    .onRequest(({ request, set }) => {
      if (new URL(request.url).pathname.startsWith('/debug/')) {
        return guardRequest(request, set, options.authorize)
      }
    })
    .get('/debug/snapshot', async ({ query, set }) => {
      const parsed = parseQuery(query, set)
      if (parsed === undefined) return error('invalid_debug_query')
      return buildSnapshot(options, parsed)
    })
    .post('/debug/replay', async ({ body, set }) => {
      if (options.replay === undefined) {
        set.status = 503
        return error('replay_service_unavailable')
      }
      try {
        const request = replayRequestSchema.parse(body)
        return replayResultSchema.parse(await options.replay.replay(request))
      } catch (caught) {
        const code = caught instanceof ReplayServiceError
          ? caught.code
          : 'invalid_replay_request'
        set.status = code === 'live_replay_unavailable' ? 503 : 422
        return error(code)
      }
    })
}

async function buildSnapshot(
  options: DebugApiOptions,
  query: { limit: number; cursor: string | null }
) {
  const session = readSession(options.application)
  const runtime = session.session_id === null
    ? null
    : await readRuntime(options.application, session.session_id)
  const binary = options.binaryIngest?.snapshot() as BinaryIngestDispatcherSnapshot | undefined
  const text = options.textIngest?.snapshot() as TextIngestDispatcherSnapshot | undefined
  const realtime = options.realtime?.snapshot() as RealtimeHubSnapshot | undefined
  const events = (options.events ?? DEFAULT_EVENT_STORE).query(query)
  const unavailable: string[] = []

  if (binary === undefined) unavailable.push('queue.binary_ingest')
  if (text === undefined) unavailable.push('queue.text_ingest')
  if (realtime === undefined) unavailable.push('queue.realtime')
  unavailable.push('queue.model')
  if (runtime === null && session.session_id !== null) unavailable.push('session.runtime')
  if (options.database === undefined) unavailable.push('database')
  if (options.providers === undefined) unavailable.push('providers.circuit_state')
  if (options.captureSources === undefined) unavailable.push('capture_sources')

  const database = options.database?.health()
  const providerInput = options.providers ?? []
  const providers = providerInput.slice(0, 64).map<DebugProvider>((provider) => ({
    id: provider.id,
    model: provider.model,
    base_url: safeBaseUrl(provider.baseUrl),
    availability: 'configured',
    circuit: 'unknown'
  }))
  if (providerInput.length > providers.length) unavailable.push('providers.truncated')
  if (providers.some((provider) => provider.circuit === 'unknown')) {
    unavailable.push('providers.circuit_state')
  }
  if (options.providers !== undefined && providers.length === 0) {
    unavailable.push('providers')
  }

  let captureSources: readonly DebugCaptureSource[] = []
  if (options.captureSources !== undefined) {
    try {
      captureSources = options.captureSources()
    } catch {
      unavailable.push('capture_sources')
    }
  }

  return {
    schema_version: 1,
    redacted: true,
    backend: {
      backend_version: options.backendVersion,
      build_id: options.buildId,
      backend_start_id: options.backendStartId
    },
    session: {
      ...session,
      audience_epoch: runtime?.audience_epoch ?? null
    },
    queue: {
      binary_ingest: binary === undefined ? null : {
        capacity: binary.capacity,
        depth: binary.inFlight,
        in_flight: binary.inFlight,
        stopped_audio_sources: binary.stoppedAudioSources,
        ended_capture_sources: binary.endedCaptureSources
      },
      text_ingest: text === undefined ? null : {
        capacity: text.capacity,
        depth: text.inFlight,
        in_flight: text.inFlight
      },
      realtime: realtime === undefined ? null : {
        active: realtime.active,
        connection_count: realtime.connectionCount,
        ready_connection_count: realtime.readyConnectionCount
      },
      model: null
    },
    providers: {
      items: providers,
      unavailable: providers.some((provider) => provider.circuit === 'unknown')
        ? ['circuit_state']
        : []
    },
    events,
    database: database === undefined ? null : {
      schema_version: options.databaseSchemaVersion ?? 1,
      ...database
    },
    capture_sources: options.captureSources === undefined
      ? { items: [], unavailable: ['electron_report'] }
      : { items: captureSources.slice(0, 64), unavailable: captureSources.length === 0 ? ['electron_report'] : [] },
    last_fatal_or_degraded_reason: events.last_fatal_or_degraded_reason,
    unavailable: Object.freeze(unavailable)
  }
}

function readSession(application: BackendApplication): SessionSnapshot {
  try {
    return application.currentSession()
  } catch {
    return {
      session_id: null,
      state: 'idle',
      started_at_ms: null,
      updated_at_ms: Date.now(),
      revision: 0
    }
  }
}

async function readRuntime(application: BackendApplication, sessionId: string): Promise<{ audience_epoch?: number } | null> {
  try {
    return await application.currentRuntimeSession(sessionId) as unknown as { audience_epoch?: number }
  } catch {
    return null
  }
}

function parseQuery(query: Record<string, unknown>, set: ResponseSet): { limit: number; cursor: string | null } | undefined {
  const rawLimit = query.limit
  const limit = rawLimit === undefined || rawLimit === '' ? 50 : Number(rawLimit)
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    set.status = 422
    return undefined
  }
  const rawCursor = query.cursor
  if (rawCursor !== undefined && rawCursor !== '' && (typeof rawCursor !== 'string' || !/^\d+$/.test(rawCursor))) {
    set.status = 422
    return undefined
  }
  if (typeof rawCursor === 'string') {
    try {
      parseCursor(rawCursor)
    } catch {
      set.status = 422
      return undefined
    }
  }
  return { limit, cursor: rawCursor === undefined || rawCursor === '' ? null : String(rawCursor) }
}

function parseCursor(value: string): number {
  const cursor = Number(value)
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw new Error('invalid cursor')
  return cursor
}

function safeBaseUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  } catch {
    return 'invalid'
  }
}

function guardRequest(
  request: Request,
  set: ResponseSet,
  authorize: (authorization: string | null) => boolean
): undefined | ReturnType<typeof error> {
  const trace = traceContextFromRequest(request, 'debug')
  set.headers['x-request-id'] = trace.correlation.requestId ?? crypto.randomUUID()
  set.headers['x-advx-trace-id'] = trace.traceId
  if (!authorize(request.headers.get('authorization'))) {
    set.status = 401
    set.headers['www-authenticate'] = 'Bearer'
    return error('invalid_local_token')
  }
  const version = request.headers.get('x-advx-protocol-version')
  if (version === String(ADVX_HTTP_PROTOCOL_VERSION)) return undefined
  set.status = 422
  set.headers['x-advx-protocol-version'] = ADVX_HTTP_PROTOCOL_VERSION
  return error('unsupported_protocol_version')
}

function error(code: string) {
  return {
    code,
    retryable: false,
    safe_detail: 'The debug snapshot rejected this request.'
  } as const
}
