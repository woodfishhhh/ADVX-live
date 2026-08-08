import { createHash } from 'node:crypto'

import {
  aiCallTraceSchema,
  type AiCallTrace,
  type ViewerRequestTrace,
  viewerRequestTraceSchema
} from '@advx/contracts'

export const TRACE_EVIDENCE_NORMALIZER_VERSION = 1 as const

export type TraceEvidenceRuntime = 'bun' | 'python'

export type NormalizedViewerTrace = Readonly<{
  normalizer_version: typeof TRACE_EVIDENCE_NORMALIZER_VERSION
  source_runtime: TraceEvidenceRuntime
  trace_kind: 'viewer_request'
  trace: ViewerRequestTrace
}>

export type NormalizedAiCallTrace = Readonly<{
  normalizer_version: typeof TRACE_EVIDENCE_NORMALIZER_VERSION
  source_runtime: TraceEvidenceRuntime
  trace_kind: 'ai_call'
  trace: AiCallTrace
}>

export type NormalizedTraceEvidence = NormalizedViewerTrace | NormalizedAiCallTrace

/**
 * Normalize traces at the comparison boundary. The payload stays on the
 * existing versioned contract so Python and Bun can be compared field-for-
 * field without leaking runtime-specific objects into the debug API.
 */
export function normalizeViewerTrace(
  input: unknown,
  sourceRuntime: TraceEvidenceRuntime = 'bun'
): NormalizedViewerTrace {
  const trace = viewerRequestTraceSchema.parse(input)
  return Object.freeze({
    normalizer_version: TRACE_EVIDENCE_NORMALIZER_VERSION,
    source_runtime: sourceRuntime,
    trace_kind: 'viewer_request',
    trace
  })
}

export function normalizeAiCallTrace(
  input: unknown,
  sourceRuntime: TraceEvidenceRuntime = 'bun'
): NormalizedAiCallTrace {
  const parsed = aiCallTraceSchema.parse(input)
  const trace = aiCallTraceSchema.parse({
    ...parsed,
    endpoint: sanitizeEndpoint(parsed.endpoint),
    request: parsed.request === undefined || parsed.request === null
      ? parsed.request
      : {
          ...parsed.request,
          input_preview: normalizeInputPreview(parsed.request.input_preview)
        },
    response: parsed.response === undefined || parsed.response === null
      ? parsed.response
      : {
          ...parsed.response,
          // Raw model text is intentionally excluded from cross-runtime proof.
          model_output: null,
          parsed_output: normalizeSafeValue(parsed.response.parsed_output)
        }
  })
  return Object.freeze({
    normalizer_version: TRACE_EVIDENCE_NORMALIZER_VERSION,
    source_runtime: sourceRuntime,
    trace_kind: 'ai_call',
    trace
  })
}

export type AiCallInputMetadata = Readonly<{
  category: string
  input_bytes: number
  input_sha256: string
  text_part_count?: number
  image_part_count?: number
  redacted_fields?: readonly string[]
}>

export function inputMetadata(
  category: string,
  input: Uint8Array | string,
  options: Omit<AiCallInputMetadata, 'category' | 'input_bytes' | 'input_sha256'> = {}
): AiCallInputMetadata {
  const bytes = typeof input === 'string' ? Buffer.from(input, 'utf8') : Buffer.from(input)
  return Object.freeze({
    category: boundedText(category, 64),
    input_bytes: bytes.byteLength,
    input_sha256: createHash('sha256').update(bytes).digest('hex'),
    ...(options.text_part_count === undefined ? {} : { text_part_count: boundedCount(options.text_part_count) }),
    ...(options.image_part_count === undefined ? {} : { image_part_count: boundedCount(options.image_part_count) }),
    redacted_fields: [...new Set(options.redacted_fields ?? ['input_text'])].slice(0, 32)
  })
}

function normalizeInputPreview(value: unknown): unknown {
  return normalizeSafeValue(value) ?? { redacted: true }
}

function normalizeSafeValue(value: unknown, depth = 0, key?: string): unknown {
  if (key !== undefined && /(prompt|message|instruction|response|token|secret|credential|password|audio|image|frame|raw|text)/i.test(key)) {
    return '[REDACTED]'
  }
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') {
    return value
  }
  if (typeof value === 'string') {
    return value.length > 128 ? `[TEXT_HASH sha256=${sha256(value)}]` : value
  }
  if (depth >= 4) return '[DEPTH_LIMIT]'
  if (Array.isArray(value)) {
    return value.slice(0, 64).map((item) => normalizeSafeValue(item, depth + 1))
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 64)
        .map(([childKey, childValue]) => [
          childKey,
          normalizeSafeValue(childValue, depth + 1, childKey)
        ])
    )
  }
  return `[${typeof value}]`
}

function sanitizeEndpoint(value: string): string {
  try {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`.slice(0, 2_048)
  } catch {
    return value.replace(/([?#]).*$/, '').replace(/\/\/[^/]+@/, '//[REDACTED]')
      .slice(0, 2_048)
  }
}

function boundedText(value: string, limit: number): string {
  const normalized = value.trim()
  if (normalized.length === 0 || normalized.length > limit) {
    throw new RangeError('trace evidence text is out of bounds')
  }
  return normalized
}

function boundedCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 1_000_000) {
    throw new RangeError('trace evidence count is out of bounds')
  }
  return value
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}
