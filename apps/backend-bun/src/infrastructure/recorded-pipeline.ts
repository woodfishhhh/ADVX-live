import { createHash } from 'node:crypto'

import {
  realtimeMessageRegistry,
  traceQueryResponseSchema,
  viewerRequestTraceSchema,
  type RuntimeSessionSnapshot,
  type RealtimeEnvelope,
  type SessionId
} from '@advx/contracts'
import type {
  BinaryIngestCommand,
  BinaryIngestCommandSink,
  TextIngestCommand,
  TextIngestCommandSink,
  VoiceActivityCommand,
  VoiceActivitySink
} from '../application'
import {
  ProviderConfigurationService,
  type RealtimePublisher
} from '../application'
import {
  inputMetadata,
  normalizeAiCallTrace,
  normalizeViewerTrace
} from './observability/trace-evidence'
import { AiCallEvidenceStore } from './observability/ai-call-evidence-store'

const RECORDED_MODEL = 'recorded-viewer-v1'

type RecordedInput = Readonly<{
  kind: 'text' | 'frame' | 'audio' | 'voice_activity'
  input_id?: string
  source?: 'microphone' | 'system_audio'
  captured_at_ms: number
  byte_length?: number
  sha256?: string
}>

export class RecordedPipelineFixture {
  readonly binaryIngestSink: BinaryIngestCommandSink = {
    dispatch: (command) => this.#recordBinary(command)
  }
  readonly textIngestSink: TextIngestCommandSink = {
    dispatch: (command) => this.#recordText(command)
  }
  readonly voiceActivitySink: VoiceActivitySink = {
    notify: (command) => this.#recordVoice(command)
  }

  #publisher: RealtimePublisher | null = null
  #runtimeReader: ((sessionId: SessionId) => Promise<RuntimeSessionSnapshot>) | null = null
  #activeSessionId: SessionId | null = null
  readonly #providerConfiguration = new ProviderConfigurationService({
    sessionActive: () => this.#activeSessionId !== null
  })
  #stoppedSessionIds = new Set<SessionId>()
  readonly #inputs: RecordedInput[] = []
  readonly #frameHashes = new Map<SessionId, string[]>()
  readonly #barrages = new Map<SessionId, string>()
  readonly #aiCalls = new AiCallEvidenceStore()

  attachPublisher(publisher: RealtimePublisher): void {
    this.#publisher = publisher
  }

  attachRuntimeReader(
    reader: (sessionId: SessionId) => Promise<RuntimeSessionSnapshot>
  ): void {
    this.#runtimeReader = reader
  }

  providerStatus() {
    return this.#providerConfiguration.status()
  }

  saveProvider(input: unknown): ReturnType<RecordedPipelineFixture['providerStatus']> {
    return this.#providerConfiguration.configure(input)
  }

  providerModels() {
    return this.#providerConfiguration.models()
  }

  providerProbe() {
    return this.#providerConfiguration.probe()
  }

  markSessionStarted(sessionId: SessionId): void {
    this.#activeSessionId = sessionId
    this.#stoppedSessionIds.delete(sessionId)
  }

  markSessionStopped(sessionId: SessionId): void {
    this.#stoppedSessionIds.add(sessionId)
    if (this.#activeSessionId === sessionId) this.#activeSessionId = null
  }

  snapshot(sessionId?: SessionId | null) {
    const selected = sessionId ?? this.#activeSessionId
    return {
      active_session_id: this.#activeSessionId,
      selected_session_id: selected ?? null,
      configured: this.providerStatus().configured,
      stopped: selected === null || selected === undefined
        ? true
        : this.#stoppedSessionIds.has(selected),
      input_count: this.#inputs.length,
      input_kinds: [...new Set(this.#inputs.map((input) => input.kind))],
      frame_hashes: selected === null || selected === undefined
        ? []
        : [...(this.#frameHashes.get(selected) ?? [])],
      barrage_published: selected === null || selected === undefined
        ? false
        : this.#barrages.has(selected)
    }
  }

  async traces(sessionId: SessionId | null) {
    if (sessionId === null || this.#runtimeReader === null) {
      return traceQueryResponseSchema.parse({ items: [], next_cursor: null })
    }
    const runtime = await this.#runtimeReader(sessionId)
    const frameHashes = this.#frameHashes.get(sessionId) ?? []
    const now = Date.now()
    const persona = runtime.canonical_runtime_spec.personas[0]
    const observationId = `recorded-observation-${sessionId}`
    const traceId = `recorded-trace-${sessionId}`
    const barrageId = this.#barrages.get(sessionId) ?? null
    const trace = normalizeViewerTrace(viewerRequestTraceSchema.parse({
      trace_kind: 'viewer_request',
      trace_schema_version: 1,
      trace_id: traceId,
      room_id: runtime.room_id,
      session_id: sessionId,
      audience_epoch: runtime.audience_epoch,
      config_hash: runtime.config_hash,
      observation_id: observationId,
      decision: {
        decision_id: `recorded-decision-${sessionId}`,
        room_id: runtime.room_id,
        session_id: sessionId,
        audience_epoch: runtime.audience_epoch,
        observation_id: observationId,
        decision_source: 'fallback',
        reason_codes: ['recorded_fixture'],
        created_at_ms: now,
        expires_at_ms: now + 60_000
      },
      viewer_instance_id: `recorded-viewer-${sessionId}`,
      viewer_sequence: 1,
      persona_revision: persona.revision,
      instance_variant: {
        expression_length: 0.5,
        skepticism: 0.2,
        encouragement: 0.8,
        meme_affinity: 0.4,
        focus: 'recorded fixture',
        silence_tendency: 0.1
      },
      memory: { room_id: runtime.room_id, memory_revision: 0 },
      ...(frameHashes.length === 0 ? {} : { frame_hashes: frameHashes }),
      prompt_manifest: {
        template_id: 'recorded-viewer-template',
        template_revision: 1,
        input_hash: sha256(`recorded:${sessionId}`),
        sections: ['recorded-inputs']
      },
      provider: {
        provider_role: 'viewer',
        model_id: RECORDED_MODEL,
        queued_at_ms: now,
        dispatched_at_ms: now,
        completed_at_ms: now
      },
      response_status: barrageId === null ? 'silence' : 'published',
      validation: { accepted: true, codes: ['recorded_fixture'] },
      side_effects: barrageId === null ? {} : { published_barrage_id: barrageId },
      output_delivery: barrageId === null
        ? null
        : {
            ready_at_ms: now,
            scheduled_at_ms: now,
            published_at_ms: now,
            queue_delay_ms: 0,
            event_count: 1,
            published_event_count: 1,
            interruption_reason: null
          }
    })).trace
    return traceQueryResponseSchema.parse({
      items: [trace],
      next_cursor: null,
      metadata: {
        source: 'recorded_fixture',
        input_kinds: this.snapshot(sessionId).input_kinds,
        stopped: this.#stoppedSessionIds.has(sessionId)
      }
    })
  }

  async aiCalls() {
    return {
      items: this.#aiCalls.query().map((trace) => ({
        call_id: trace.call_id,
        correlation_id: trace.correlation_id,
        role: trace.role,
        status: trace.status,
        model_id: trace.model_id,
        trigger_context: trace.trigger_context ?? null,
        started_at_ms: trace.started_at_ms,
        updated_at_ms: trace.updated_at_ms,
        duration_ms: trace.duration_ms ?? null
      })),
      next_cursor: null,
      metadata: { source: 'recorded_fixture', normalizer_version: 1 }
    }
  }

  async #recordBinary(command: BinaryIngestCommand): Promise<void> {
    const hash = command.kind === 'frame' ? sha256(command.body) : undefined
    if (command.kind === 'frame') {
      const hashes = this.#frameHashes.get(command.sessionId) ?? []
      hashes.push(hash!)
      this.#frameHashes.set(command.sessionId, hashes)
    }
    this.#inputs.push({
      kind: command.kind,
      input_id: command.inputId,
      source: command.kind === 'audio' ? command.source : undefined,
      captured_at_ms: Number(command.capturedAtMs),
      byte_length: command.body.byteLength,
      ...(hash === undefined ? {} : { sha256: hash })
    })
  }

  async #recordText(command: TextIngestCommand): Promise<void> {
    this.#inputs.push({
      kind: 'text',
      input_id: command.inputId,
      captured_at_ms: command.createdAtMs
    })
    const startedAt = command.createdAtMs
    const completedAt = Math.max(startedAt, Date.now())
    const trace = normalizeAiCallTrace({
      call_id: `recorded-ai-call-${command.inputId}`,
      correlation_id: command.traceContext?.traceId ?? command.inputId,
      role: 'viewer',
      status: 'succeeded',
      provider: 'recorded',
      model_id: RECORDED_MODEL,
      endpoint: 'recorded://model/v1/chat',
      session_id: command.sessionId,
      audience_epoch: command.traceContext?.correlation.epoch ?? 1,
      observation_id: command.traceContext?.correlation.observationId ?? `recorded-observation-${command.sessionId}`,
      generation_request_id: command.traceContext?.correlation.generationId ?? `recorded-generation-${command.sessionId}`,
      started_at_ms: startedAt,
      updated_at_ms: completedAt,
      completed_at_ms: completedAt,
      duration_ms: Math.max(0, completedAt - startedAt),
      request: {
        input_preview: inputMetadata('viewer', command.text),
        redacted_fields: ['input_text']
      },
      response: {
        finish_reason: 'stop',
        parsed_output: { action: 'barrage', source: 'recorded_fixture' }
      },
      redacted: true
    }).trace
    this.#aiCalls.upsert(trace)
    if (this.#barrages.has(command.sessionId)) return
    this.#barrages.set(command.sessionId, `recorded-barrage-${command.sessionId}`)
    await this.publishBarrage(command.sessionId, command.text)
  }

  async #recordVoice(command: VoiceActivityCommand): Promise<void> {
    this.#inputs.push({
      kind: 'voice_activity',
      source: command.source,
      captured_at_ms: command.occurredAtMs
    })
  }

  async publishBarrage(sessionId: SessionId, inputText: string): Promise<void> {
    if (this.#publisher === null || this.#runtimeReader === null) return
    const runtime = await this.#runtimeReader(sessionId)
    const now = Date.now()
    const barrage = {
      barrage_id: this.#barrages.get(sessionId) ?? `recorded-barrage-${sessionId}`,
      room_id: runtime.room_id,
      session_id: sessionId,
      audience_epoch: runtime.audience_epoch,
      observation_id: `recorded-observation-${sessionId}`,
      generation_request_id: `recorded-generation-${sessionId}`,
      viewer_instance_id: `recorded-viewer-${sessionId}`,
      persona_id: runtime.canonical_runtime_spec.personas[0].persona_id,
      display_name: 'Recorded Viewer',
      viewer_sequence: 1,
      reaction_type: 'reply',
      intent: 'reply_to_viewer' as const,
      target: null,
      evidence_refs: [{ source: 'event' as const, event_id: `recorded-input-${sessionId}`, frame_index: null }],
      text: `Recorded reply: ${inputText}`.slice(0, 160),
      created_at_ms: now,
      expires_at_ms: now + 60_000
    }
    const envelope = realtimeMessageRegistry['barrage.event'].schema.parse({
      protocol_version: 4,
      message_type: 'barrage.event',
      message_id: `recorded-message-${sessionId}`,
      room_id: runtime.room_id,
      session_id: sessionId,
      audience_epoch: runtime.audience_epoch,
      created_at_ms: now,
      payload: { barrage }
    }) as RealtimeEnvelope
    await this.#publisher.publish(envelope)
  }
}

function sha256(input: Uint8Array | string): string {
  return createHash('sha256').update(input).digest('hex')
}
