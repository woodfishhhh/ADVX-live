import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  canonicalSha256,
  replayRequestSchema,
  replayResultSchema,
  type ReplayRequest,
  type ReplayResult
} from '@advx/contracts'

export type RecordedReplayRunContext = Readonly<{
  run_number: 1 | 2
  data_directory: string
  seed: number
  virtual_clock_start_ms: number
  random(): number
  advanceTo(timestampMs: number): void
}>

export type RecordedReplayRunner = (
  bundle: ReplayRequest['bundle'],
  context: RecordedReplayRunContext
) => ReplayResult['recorded_evidence'] | Promise<ReplayResult['recorded_evidence']>

export type LiveReplayEvidence = Readonly<{
  provider_profile_id: string
  credentialed: true
  external_transport_verified: true
  external_transport_call_count: number
  fake_fallback_used: false
}>

export type LiveReplayProvider = (
  bundle: ReplayRequest['bundle']
) => LiveReplayEvidence | Promise<LiveReplayEvidence>

export type ReplayServiceOptions = Readonly<{
  recordedRunner?: RecordedReplayRunner
  liveProvider?: LiveReplayProvider
  recordedDataDirectory?: string
}>

export type ReplayServiceErrorCode =
  | 'invalid_replay_request'
  | 'unsafe_replay_bundle'
  | 'live_replay_unavailable'
  | 'replay_failed'

export class ReplayServiceError extends Error {
  readonly name = 'ReplayServiceError'

  constructor(readonly code: ReplayServiceErrorCode, message: string) {
    super(message)
  }
}

export class ReplayService {
  readonly #recordedRunner: RecordedReplayRunner
  readonly #liveProvider: LiveReplayProvider | undefined
  readonly #recordedDataDirectory: string | undefined

  constructor(options: ReplayServiceOptions = {}) {
    this.#recordedRunner = options.recordedRunner ?? defaultRecordedReplayRunner
    this.#liveProvider = options.liveProvider
    this.#recordedDataDirectory = options.recordedDataDirectory
  }

  async replay(input: unknown): Promise<ReplayResult> {
    let request: ReplayRequest
    try {
      request = replayRequestSchema.parse(input)
    } catch (error) {
      throw new ReplayServiceError(
        'invalid_replay_request',
        error instanceof Error ? error.message : 'replay request is invalid'
      )
    }

    const mode = request.mode ?? 'recorded'
    if (mode === 'live') return this.#replayLive(request)
    return this.#replayRecorded(request)
  }

  async #replayRecorded(request: ReplayRequest): Promise<ReplayResult> {
    const bundle = request.bundle
    assertRecordedBundleIntegrity(bundle)
    const first = await this.#runRecorded(bundle, 1)
    const second = await this.#runRecorded(bundle, 2)
    const firstDigest = canonicalSha256({
      bundle_id: bundle.bundle_id,
      seed: bundle.seed,
      virtual_clock_start_ms: bundle.virtual_clock_start_ms,
      config_hash: bundle.config_hash,
      recorded_evidence: first
    })
    const secondDigest = canonicalSha256({
      bundle_id: bundle.bundle_id,
      seed: bundle.seed,
      virtual_clock_start_ms: bundle.virtual_clock_start_ms,
      config_hash: bundle.config_hash,
      recorded_evidence: second
    })
    if (firstDigest !== secondDigest) {
      throw new ReplayServiceError(
        'replay_failed',
        'recorded runtime replay produced nondeterministic evidence'
      )
    }
    return replayResultSchema.parse({
      bundle_id: bundle.bundle_id,
      mode: 'recorded',
      deterministic_proof: true,
      credentialed_provider_proof: false,
      event_count: bundle.events.length,
      trace_count: bundle.traces?.length ?? 0,
      completed_at_ms: completionTime(bundle),
      replay_digest: firstDigest,
      recorded_evidence: first,
      external_transport_call_count: 0
    })
  }

  async #replayLive(request: ReplayRequest): Promise<ReplayResult> {
    if (!request.allow_external_provider_calls || this.#liveProvider === undefined) {
      throw new ReplayServiceError(
        'live_replay_unavailable',
        'live replay requires an explicitly configured credentialed Provider'
      )
    }
    const evidence = await this.#liveProvider(request.bundle)
    if (
      evidence.credentialed !== true ||
      evidence.external_transport_verified !== true ||
      evidence.fake_fallback_used !== false ||
      evidence.external_transport_call_count < 1 ||
      evidence.provider_profile_id.length < 1
    ) {
      throw new ReplayServiceError(
        'replay_failed',
        'live replay Provider did not return verified provenance'
      )
    }
    return replayResultSchema.parse({
      bundle_id: request.bundle.bundle_id,
      mode: 'live',
      deterministic_proof: false,
      credentialed_provider_proof: true,
      event_count: request.bundle.events.length,
      trace_count: request.bundle.traces?.length ?? 0,
      completed_at_ms: completionTime(request.bundle),
      provider_profile_id: evidence.provider_profile_id,
      external_transport_call_count: evidence.external_transport_call_count
    })
  }

  async #runRecorded(
    bundle: ReplayRequest['bundle'],
    runNumber: 1 | 2
  ): Promise<NonNullable<ReplayResult['recorded_evidence']>> {
    const root = this.#recordedDataDirectory ?? tmpdir()
    await mkdir(root, { recursive: true })
    const dataDirectory = await mkdtemp(join(root, `advx-recorded-replay-${runNumber}-`))
    const context: RecordedReplayRunContext = {
      run_number: runNumber,
      data_directory: dataDirectory,
      seed: bundle.seed,
      virtual_clock_start_ms: bundle.virtual_clock_start_ms,
      random: seededRandom(bundle.seed),
      advanceTo: (timestampMs) => {
        if (!Number.isSafeInteger(timestampMs) || timestampMs < bundle.virtual_clock_start_ms) {
          throw new ReplayServiceError('replay_failed', 'replay clock cannot move backwards')
        }
      }
    }
    try {
      const evidence = await this.#recordedRunner(bundle, context)
      if (evidence === null || evidence === undefined) {
        throw new ReplayServiceError(
          'replay_failed',
          'recorded runtime did not return replay evidence'
        )
      }
      if (evidence.external_transport_call_count !== 0) {
        throw new ReplayServiceError(
          'replay_failed',
          'recorded replay attempted an external transport call'
        )
      }
      return evidence
    } catch (error) {
      if (error instanceof ReplayServiceError) throw error
      throw new ReplayServiceError(
        'replay_failed',
        error instanceof Error ? error.message : 'recorded replay failed'
      )
    } finally {
      await rm(dataDirectory, { recursive: true, force: true })
    }
  }
}

function assertRecordedBundleIntegrity(bundle: ReplayRequest['bundle']): void {
  if (bundle.redacted !== true) {
    throw new ReplayServiceError('unsafe_replay_bundle', 'replay bundle is not redacted')
  }
  const expectedDigest = canonicalSha256(bundle.recorded_provider_outputs)
  if (
    bundle.recorded_outputs_digest !== undefined &&
    bundle.recorded_outputs_digest !== null &&
    bundle.recorded_outputs_digest !== expectedDigest
  ) {
    throw new ReplayServiceError(
      'unsafe_replay_bundle',
      'recorded Provider output digest does not match the bundle'
    )
  }
}

async function defaultRecordedReplayRunner(
  bundle: ReplayRequest['bundle']
): Promise<NonNullable<ReplayResult['recorded_evidence']>> {
  const outputByIdentity = new Map(
    bundle.recorded_provider_outputs.map((output) => [
      `${output.provider_role}:${output.generation_request_id}`,
      output
    ])
  )
  const references = bundle.events.flatMap((event) => {
    const role = event.event_type.split('.', 1)[0]!
    const ids = Array.isArray(event.payload.generation_request_ids)
      ? event.payload.generation_request_ids.filter((id): id is string => typeof id === 'string')
      : typeof event.payload.generation_request_id === 'string'
        ? [event.payload.generation_request_id]
        : []
    return ids.map((id) => `${role}:${id}`)
  })
  const roleCounts = new Map<string, number>()
  const consumed = references.map((identity) => {
    const output = outputByIdentity.get(identity)
    if (output === undefined) {
      throw new ReplayServiceError('unsafe_replay_bundle', `missing recorded output: ${identity}`)
    }
    const callIndex = (roleCounts.get(output.provider_role) ?? 0) + 1
    roleCounts.set(output.provider_role, callIndex)
    return {
      provider_role: output.provider_role,
      generation_request_id: output.generation_request_id,
      call_index: callIndex
    }
  })
  const viewerEvents = bundle.events.filter((event) => event.event_type.startsWith('viewer.'))
  const memoryEvents = bundle.events.filter((event) => event.event_type.startsWith('memory.'))
  return {
    decisions: viewerEvents.map((event) => event.payload),
    selected_viewer_ids: viewerEvents
      .map((event) => event.payload.viewer_instance_id)
      .filter((value): value is string => typeof value === 'string'),
    barrages: bundle.events
      .filter((event) => event.event_type.startsWith('barrage.') || event.event_type === 'viewer.published')
      .map((event) => event.payload),
    memories: memoryEvents.map((event) => event.payload),
    traces: bundle.traces ?? [],
    consumed_provider_roles: [...new Set(consumed.map((item) => item.provider_role))],
    consumed_provider_outputs: consumed,
    external_transport_call_count: 0
  }
}

function completionTime(bundle: ReplayRequest['bundle']): number {
  return Math.max(
    bundle.virtual_clock_start_ms,
    ...bundle.events.map((event) => event.occurred_at_ms)
  )
}

function seededRandom(seed: number): () => number {
  let state = (seed >>> 0) || 0x9e3779b9
  return () => {
    state |= 0
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}
