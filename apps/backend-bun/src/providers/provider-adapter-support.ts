import {
  durationMs,
  providerFailure,
  wallClockTimestampMs,
  type ProviderCallContext,
  type ProviderFailure,
  type ProviderFailureInput,
  type ProviderIdentity,
  type ProviderKind,
  type ProviderOutcome
} from '../application/ports'

export type ProviderEvidenceClass = 'fake' | 'recorded'
export type ProviderEvidenceSource = 'deterministic' | 'recorded_sse'

export type ProviderEvidenceMetadata = {
  readonly evidenceClass: ProviderEvidenceClass
  readonly source: ProviderEvidenceSource
  readonly adapterId: string
  readonly recordingId?: string
  readonly sanitized: boolean
  readonly liveFallback: false
}

export type ProviderAdapterControls = {
  readonly latencyMs?: number
  readonly sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>
  readonly monotonicNow?: () => number
  readonly wallClockNow?: () => number
}

export function adapterControls(
  controls: ProviderAdapterControls = {}
): Required<ProviderAdapterControls> {
  const latencyMs = nonNegativeInteger(controls.latencyMs ?? 0, 'adapter latency')
  return {
    latencyMs,
    sleep: controls.sleep ?? immediateSleep,
    monotonicNow: controls.monotonicNow ?? (() => performance.now()),
    wallClockNow: controls.wallClockNow ?? (() => Date.now())
  }
}

export function evidenceMetadata(
  metadata: ProviderEvidenceMetadata
): ProviderEvidenceMetadata {
  if (metadata.sanitized !== true || metadata.liveFallback !== false) {
    throw new RangeError('Provider adapter evidence must disable live fallback')
  }
  if (metadata.adapterId.trim().length === 0) {
    throw new RangeError('Provider adapter ID is required')
  }
  if (metadata.evidenceClass === 'recorded' && metadata.recordingId === undefined) {
    throw new RangeError('recorded Provider evidence requires a recording ID')
  }
  return Object.freeze({ ...metadata })
}

export function preflightProvider<TKind extends ProviderKind>(
  expected: ProviderIdentity<TKind>,
  actual: ProviderIdentity,
  context: ProviderCallContext,
  monotonicNow: () => number
): ProviderFailure | undefined {
  if (context.callerSignal.aborted || context.cancellationReason() !== undefined) {
    return cancellationFailure(context)
  }
  if (context.deadline.expiresAt <= monotonicNow()) {
    return providerFailure({ code: 'timeout', source: 'advx', retryable: true })
  }
  if (
    actual.kind !== expected.kind ||
    actual.providerProfileId !== expected.providerProfileId ||
    actual.providerRevision !== expected.providerRevision
  ) {
    return providerFailure({ code: 'invalid_request', source: 'advx', retryable: false })
  }
  return undefined
}

export async function waitForAdapterLatency(
  latencyMs: number,
  controls: Required<ProviderAdapterControls>,
  context: ProviderCallContext
): Promise<ProviderFailure | undefined> {
  const failure = cancellationOrDeadline(context, controls.monotonicNow)
  if (failure !== undefined || latencyMs === 0) return failure
  await controls.sleep(latencyMs, context.callerSignal)
  return cancellationOrDeadline(context, controls.monotonicNow)
}

export function cancellationOrDeadline(
  context: ProviderCallContext,
  monotonicNow: () => number
): ProviderFailure | undefined {
  if (context.callerSignal.aborted || context.cancellationReason() !== undefined) {
    return cancellationFailure(context)
  }
  if (context.deadline.expiresAt <= monotonicNow()) {
    return providerFailure({ code: 'timeout', source: 'advx', retryable: true })
  }
  return undefined
}

export function cancellationFailure(context: ProviderCallContext): ProviderFailure {
  const timedOut = context.cancellationReason()?.code === 'deadline_exceeded'
  return providerFailure({
    code: timedOut ? 'timeout' : 'aborted',
    source: timedOut ? 'advx' : 'caller',
    retryable: timedOut
  })
}

export function configuredFailure(
  failure: ProviderFailureInput | undefined,
  abort: boolean | undefined
): ProviderFailure | undefined {
  if (abort === true) {
    return providerFailure({ code: 'aborted', source: 'caller', retryable: false })
  }
  return failure === undefined ? undefined : providerFailure(failure)
}

export function healthResult<TKind extends ProviderKind>(
  provider: ProviderIdentity<TKind>,
  controls: Required<ProviderAdapterControls>
): ProviderOutcome<{
  readonly provider: ProviderIdentity<TKind>
  readonly status: 'healthy'
  readonly checkedAt: ReturnType<typeof wallClockTimestampMs>
  readonly latency: { readonly totalMs: ReturnType<typeof durationMs> }
}> {
  return {
    ok: true,
    value: {
      provider,
      status: 'healthy',
      checkedAt: wallClockTimestampMs(controls.wallClockNow()),
      latency: { totalMs: durationMs(0) }
    }
  }
}

export function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`)
  }
  return value
}

async function immediateSleep(_delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await Promise.resolve()
}
