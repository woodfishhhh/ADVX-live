import { canonicalJson, canonicalSha256 } from '@advx/contracts'

export const AGENT_EVAL_SCHEMA_VERSION = 1 as const

export const AGENT_EVAL_ASSERTION_IDS = Object.freeze([
  'eligible_viewers_only',
  'no_director_or_global_theme',
  'barrage_silence_parse',
  'barrage_bounds',
  'reply_context_same_wave_freeze',
  'stale_epoch_sequence_rejected',
  'cancellation_no_late_memory_write',
  'failure_degrades_without_invented_output'
] as const)

export type AgentEvalAssertionId = typeof AGENT_EVAL_ASSERTION_IDS[number]
export type AgentEvalPrivacyClassification = 'synthetic' | 'recorded'
export type AgentEvalProviderEvidenceClass = 'fake' | 'recorded'

export type AgentEvalFixture = Readonly<{
  schema_version: typeof AGENT_EVAL_SCHEMA_VERSION
  fixture_id: string
  fixture_version: string
  privacy_classification: AgentEvalPrivacyClassification
  provider_evidence_class: AgentEvalProviderEvidenceClass
  input: Readonly<Record<string, unknown>>
  assertions: readonly AgentEvalAssertionId[]
  expectations: Readonly<{
    eligible_viewer_ids: readonly string[]
    max_barrage_count: number
    max_barrage_length: number
    max_repairs: number
    reply_context_event_ids: readonly string[]
    same_wave_frozen: true
    minimum_stale_rejections: number
    cancellation_required: true
    failure_must_degrade: true
  }>
}>

export type AgentEvalCall = Readonly<{
  viewer_instance_id: string
  role: 'viewer' | 'director' | 'global_theme'
  eligible: boolean
  model_id: string
}>

export type AgentEvalOutput = Readonly<{
  action: 'barrage' | 'silence' | 'invalid'
  text: string | null
  repair_attempts: number
  viewer_instance_id: string
  epoch: number
  sequence: number
}>

export type AgentEvalObservation = Readonly<{
  calls: readonly AgentEvalCall[]
  outputs: readonly AgentEvalOutput[]
  reply_context: Readonly<{
    event_ids: readonly string[]
    same_wave_frozen: boolean
  }>
  stale_results: readonly Readonly<{
    epoch: number
    sequence: number
    emitted: boolean
  }>[]
  cancellation: Readonly<{
    cancelled: boolean
    late_memory_writes: number
  }>
  failure: Readonly<{
    degraded: boolean
    invented_output: boolean
  }>
}>

export type AgentEvalAssertion = Readonly<{
  id: AgentEvalAssertionId
  status: 'passed' | 'failed'
  evidence: Readonly<Record<string, unknown>>
  message: string
}>

export type AgentEvalReport = Readonly<{
  schema_version: typeof AGENT_EVAL_SCHEMA_VERSION
  fixture_id: string
  fixture_version: string
  fixture_digest: string
  privacy_classification: AgentEvalPrivacyClassification
  provider_evidence_class: AgentEvalProviderEvidenceClass
  status: 'passed' | 'failed'
  passed_count: number
  failed_count: number
  assertions: readonly AgentEvalAssertion[]
}>

export class AgentEvalFixtureError extends Error {
  constructor(
    readonly code:
      | 'invalid_fixture'
      | 'unsupported_schema_version'
      | 'live_provider_evidence'
      | 'duplicate_assertion',
    message: string
  ) {
    super(message)
    this.name = 'AgentEvalFixtureError'
  }
}

export function parseAgentEvalFixture(value: unknown): AgentEvalFixture {
  if (!isRecord(value)) {
    throw new AgentEvalFixtureError('invalid_fixture', 'fixture must be an object')
  }
  if (value.schema_version !== AGENT_EVAL_SCHEMA_VERSION) {
    throw new AgentEvalFixtureError(
      'unsupported_schema_version',
      'fixture schema_version must be 1'
    )
  }
  const providerEvidence = value.provider_evidence_class
  if (providerEvidence === 'live') {
    throw new AgentEvalFixtureError(
      'live_provider_evidence',
      'deterministic agent eval fixtures cannot use live Provider evidence'
    )
  }
  if (
    typeof value.fixture_id !== 'string' || value.fixture_id.trim().length === 0 ||
    typeof value.fixture_version !== 'string' || value.fixture_version.trim().length === 0 ||
    (value.privacy_classification !== 'synthetic' && value.privacy_classification !== 'recorded') ||
    (providerEvidence !== 'fake' && providerEvidence !== 'recorded') ||
    !isRecord(value.input) ||
    !Array.isArray(value.assertions) ||
    !isRecord(value.expectations)
  ) {
    throw new AgentEvalFixtureError('invalid_fixture', 'fixture metadata or expectations are invalid')
  }

  const assertions = value.assertions.map((entry) => {
    if (!isAssertionId(entry)) {
      throw new AgentEvalFixtureError('invalid_fixture', 'fixture contains an unknown assertion')
    }
    return entry
  })
  if (new Set(assertions).size !== assertions.length) {
    throw new AgentEvalFixtureError(
      'duplicate_assertion',
      'fixture assertions must be unique'
    )
  }

  const expectations = parseExpectations(value.expectations)
  return freezeClone({
    schema_version: AGENT_EVAL_SCHEMA_VERSION,
    fixture_id: value.fixture_id,
    fixture_version: value.fixture_version,
    privacy_classification: value.privacy_classification,
    provider_evidence_class: providerEvidence,
    input: value.input,
    assertions: Object.freeze(assertions),
    expectations
  })
}

export function evaluateAgentFixture(
  fixture: AgentEvalFixture,
  observation: AgentEvalObservation
): AgentEvalReport {
  const parsedFixture = parseAgentEvalFixture(fixture)
  const assertions = parsedFixture.assertions.map((id) =>
    evaluateAssertion(id, parsedFixture.expectations, observation)
  )
  const passedCount = assertions.filter((assertion) => assertion.status === 'passed').length
  const failedCount = assertions.length - passedCount
  return freezeClone({
    schema_version: AGENT_EVAL_SCHEMA_VERSION,
    fixture_id: parsedFixture.fixture_id,
    fixture_version: parsedFixture.fixture_version,
    fixture_digest: canonicalSha256(parsedFixture),
    privacy_classification: parsedFixture.privacy_classification,
    provider_evidence_class: parsedFixture.provider_evidence_class,
    status: failedCount === 0 ? 'passed' : 'failed',
    passed_count: passedCount,
    failed_count: failedCount,
    assertions
  })
}

export function serializeAgentEvalReport(report: AgentEvalReport): string {
  return canonicalJson(report)
}

function evaluateAssertion(
  id: AgentEvalAssertionId,
  expectations: AgentEvalFixture['expectations'],
  observation: AgentEvalObservation
): AgentEvalAssertion {
  switch (id) {
    case 'eligible_viewers_only': {
      const eligible = new Set(expectations.eligible_viewer_ids)
      const invalidCalls = observation.calls.filter((call) =>
        call.role !== 'viewer' || !call.eligible || !eligible.has(call.viewer_instance_id)
      )
      return assertion(
        id,
        invalidCalls.length === 0,
        {
          total_calls: observation.calls.length,
          eligible_viewer_ids: [...eligible],
          invalid_calls: invalidCalls.map((call) => ({
            viewer_instance_id: call.viewer_instance_id,
            role: call.role,
            eligible: call.eligible
          }))
        },
        invalidCalls.length === 0
          ? 'only eligible Viewers were called'
          : 'an ineligible or undeclared Viewer was called'
      )
    }
    case 'no_director_or_global_theme': {
      const forbiddenCalls = observation.calls.filter((call) =>
        call.role === 'director' ||
        call.role === 'global_theme' ||
        forbiddenModelIdentity(call.model_id)
      )
      return assertion(
        id,
        forbiddenCalls.length === 0,
        {
          forbidden_call_count: forbiddenCalls.length,
          forbidden_calls: forbiddenCalls.map((call) => ({
            model_id: call.model_id,
            role: call.role
          }))
        },
        forbiddenCalls.length === 0
          ? 'no Director or global-theme model appears'
          : 'a Director or global-theme model appears'
      )
    }
    case 'barrage_silence_parse': {
      const invalidOutputs = observation.outputs.filter((output) =>
        output.action === 'invalid' ||
        (output.action === 'barrage' && output.text?.trim().length === 0) ||
        (output.action === 'silence' && output.text !== null)
      )
      return assertion(
        id,
        invalidOutputs.length === 0,
        {
          output_count: observation.outputs.length,
          invalid_outputs: invalidOutputs.map(outputSummary)
        },
        invalidOutputs.length === 0
          ? 'barrage and silence outputs parse correctly'
          : 'an output does not satisfy the barrage/silence shape'
      )
    }
    case 'barrage_bounds': {
      const barrages = observation.outputs.filter((output) => output.action === 'barrage')
      const overlong = barrages.filter((output) =>
        unicodeLength(output.text ?? '') > expectations.max_barrage_length
      )
      const overRepaired = observation.outputs.filter((output) =>
        output.repair_attempts > expectations.max_repairs
      )
      const passed = barrages.length <= expectations.max_barrage_count &&
        overlong.length === 0 &&
        overRepaired.length === 0
      return assertion(
        id,
        passed,
        {
          barrage_count: barrages.length,
          max_barrage_count: expectations.max_barrage_count,
          overlong_outputs: overlong.map(outputSummary),
          over_repaired_outputs: overRepaired.map(outputSummary)
        },
        passed
          ? 'barrage count, length, and repair bounds hold'
          : 'barrage count, length, or repair bounds are exceeded'
      )
    }
    case 'reply_context_same_wave_freeze': {
      const expected = expectations.reply_context_event_ids
      const actual = observation.reply_context.event_ids
      const passed = sameStrings(actual, expected) &&
        observation.reply_context.same_wave_frozen === expectations.same_wave_frozen
      return assertion(
        id,
        passed,
        {
          expected_event_ids: expected,
          actual_event_ids: actual,
          same_wave_frozen: observation.reply_context.same_wave_frozen
        },
        passed
          ? 'reply context and same-wave freeze are preserved'
          : 'reply context or same-wave freeze changed'
      )
    }
    case 'stale_epoch_sequence_rejected': {
      const emittedStale = observation.stale_results.filter((result) => result.emitted)
      const rejectedCount = observation.stale_results.length - emittedStale.length
      const passed = rejectedCount >= expectations.minimum_stale_rejections &&
        emittedStale.length === 0
      return assertion(
        id,
        passed,
        {
          stale_result_count: observation.stale_results.length,
          rejected_count: rejectedCount,
          minimum_rejected_count: expectations.minimum_stale_rejections,
          emitted_stale_results: emittedStale
        },
        passed
          ? 'stale epoch/sequence results are rejected before emission'
          : 'a stale epoch/sequence result was emitted or not rejected'
      )
    }
    case 'cancellation_no_late_memory_write': {
      const passed = observation.cancellation.cancelled === expectations.cancellation_required &&
        observation.cancellation.late_memory_writes === 0
      return assertion(
        id,
        passed,
        {
          cancelled: observation.cancellation.cancelled,
          late_memory_writes: observation.cancellation.late_memory_writes
        },
        passed
          ? 'cancellation leaves no late memory write'
          : 'cancellation leaked a late memory write'
      )
    }
    case 'failure_degrades_without_invented_output': {
      const passed = observation.failure.degraded === expectations.failure_must_degrade &&
        observation.failure.invented_output === false
      return assertion(
        id,
        passed,
        {
          degraded: observation.failure.degraded,
          invented_output: observation.failure.invented_output
        },
        passed
          ? 'failure degrades without inventing output'
          : 'failure did not degrade cleanly'
      )
    }
  }
}

function parseExpectations(
  value: Record<string, unknown>
): AgentEvalFixture['expectations'] {
  const eligibleViewerIds = value.eligible_viewer_ids
  const replyContextEventIds = value.reply_context_event_ids
  if (
    !Array.isArray(eligibleViewerIds) ||
    !eligibleViewerIds.every((entry) => typeof entry === 'string' && entry.length > 0) ||
    !Array.isArray(replyContextEventIds) ||
    !replyContextEventIds.every((entry) => typeof entry === 'string' && entry.length > 0) ||
    !positiveOrZeroInteger(value.max_barrage_count) ||
    !positiveOrZeroInteger(value.max_barrage_length) ||
    !positiveOrZeroInteger(value.max_repairs) ||
    !positiveOrZeroInteger(value.minimum_stale_rejections) ||
    value.same_wave_frozen !== true ||
    value.cancellation_required !== true ||
    value.failure_must_degrade !== true
  ) {
    throw new AgentEvalFixtureError('invalid_fixture', 'fixture expectations are invalid')
  }
  return {
    eligible_viewer_ids: Object.freeze([...eligibleViewerIds]),
    max_barrage_count: value.max_barrage_count,
    max_barrage_length: value.max_barrage_length,
    max_repairs: value.max_repairs,
    reply_context_event_ids: Object.freeze([...replyContextEventIds]),
    same_wave_frozen: true,
    minimum_stale_rejections: value.minimum_stale_rejections,
    cancellation_required: true,
    failure_must_degrade: true
  }
}

function assertion(
  id: AgentEvalAssertionId,
  passed: boolean,
  evidence: Readonly<Record<string, unknown>>,
  message: string
): AgentEvalAssertion {
  return Object.freeze({
    id,
    status: passed ? 'passed' : 'failed',
    evidence: Object.freeze(evidence),
    message
  })
}

function outputSummary(output: AgentEvalOutput): Readonly<Record<string, unknown>> {
  return {
    action: output.action,
    text_length: unicodeLength(output.text ?? ''),
    repair_attempts: output.repair_attempts,
    viewer_instance_id: output.viewer_instance_id,
    epoch: output.epoch,
    sequence: output.sequence
  }
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function unicodeLength(value: string): number {
  return Array.from(value).length
}

function forbiddenModelIdentity(value: string): boolean {
  return /director|global[-_ ]?theme/i.test(value)
}

function isAssertionId(value: unknown): value is AgentEvalAssertionId {
  return typeof value === 'string' &&
    (AGENT_EVAL_ASSERTION_IDS as readonly string[]).includes(value)
}

function positiveOrZeroInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function freezeClone<T>(value: T): T {
  return deepFreeze(structuredClone(value)) as T
}

function deepFreeze(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const child of Object.values(value)) deepFreeze(child)
  return value
}
