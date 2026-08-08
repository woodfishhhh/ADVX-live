import {
  VIEWER_GENERATION_SCHEMA_NAME,
  truncateViewerBarrageText,
  viewerModelOutputSchema,
  type SchemaIssue,
  type ViewerModelOutput
} from '@advx/contracts'

import {
  protocolRepairAttempt,
  providerFailure,
  type ModelGenerationRequest,
  type ModelGenerationResult,
  type ModelProvider,
  type ModelRequestBudget,
  type ProviderCallContext,
  type ProviderFailure,
  type ProviderOutcome
} from '../ports'

const MINIMUM_REPAIR_REMAINING_MS = 6_000
const MAXIMUM_VALIDATION_CODE_LENGTH = 512
const SERVER_OWNED_OUTPUT_KEYS = [
  'generation_request_id',
  'viewer_instance_id',
  'viewer_sequence'
] as const

export type ViewerOutputFence = {
  readonly allowedEventIds: readonly string[]
  readonly frameCount: number
  readonly activeViewerIds: readonly string[]
  readonly replyableEventIds: readonly string[]
}

export type ValidatedViewerGeneration = {
  readonly result: ModelGenerationResult
  readonly output: Readonly<ViewerModelOutput>
  readonly publicationTexts: readonly string[]
}

export type ModelOutputValidationDependencies = {
  readonly monotonicNow?: () => number
}

type InvalidOutput = {
  readonly ok: false
  readonly repairable: boolean
  readonly validationCodes: string
}

type ParsedOutput =
  | { readonly ok: true; readonly output: ViewerModelOutput }
  | InvalidOutput

export class ModelOutputValidationService {
  readonly #provider: ModelProvider
  readonly #monotonicNow: () => number

  constructor(
    provider: ModelProvider,
    dependencies: ModelOutputValidationDependencies = {}
  ) {
    this.#provider = provider
    this.#monotonicNow = dependencies.monotonicNow ?? (() => performance.now())
  }

  async generateViewer(
    request: ModelGenerationRequest,
    context: ProviderCallContext,
    requestBudget: ModelRequestBudget,
    fence: ViewerOutputFence
  ): Promise<ProviderOutcome<ValidatedViewerGeneration>> {
    if (!validViewerRequest(request) || !validFence(fence)) {
      return { ok: false, error: invalidRequestFailure() }
    }

    const initial = await this.#provider.generate(request, context, requestBudget)
    if (!initial.ok) return initial

    const initialOutput = validateResult(request, initial.value, fence)
    if (initialOutput.ok) return validatedGeneration(initial.value, initialOutput.output)

    if (!this.#canRepair(request, context, requestBudget, initialOutput)) {
      return { ok: false, error: invalidResponseFailure(initial.value) }
    }

    const repairRequest: ModelGenerationRequest = {
      ...request,
      messages: [
        ...request.messages,
        {
          role: 'system',
          content: [{ type: 'text', text: repairInstruction(initialOutput.validationCodes) }]
        }
      ],
      protocolRepairAttempt: protocolRepairAttempt(1)
    }
    const repaired = await this.#provider.generate(
      repairRequest,
      context,
      requestBudget
    )
    if (!repaired.ok) return repaired

    const repairedOutput = validateResult(repairRequest, repaired.value, fence)
    return repairedOutput.ok
      ? validatedGeneration(repaired.value, repairedOutput.output)
      : { ok: false, error: invalidResponseFailure(repaired.value) }
  }

  #canRepair(
    request: ModelGenerationRequest,
    context: ProviderCallContext,
    requestBudget: ModelRequestBudget,
    invalid: InvalidOutput
  ): boolean {
    return invalid.repairable &&
      request.protocolRepairAttempt === 0 &&
      requestBudget.remainingRequests >= 1 &&
      context.deadline.expiresAt - this.#monotonicNow() >=
        MINIMUM_REPAIR_REMAINING_MS
  }
}

function validViewerRequest(request: ModelGenerationRequest): boolean {
  return request.purpose === 'viewer' &&
    request.output.type === 'structured' &&
    request.output.schemaName === VIEWER_GENERATION_SCHEMA_NAME &&
    request.protocolRepairAttempt === 0 &&
    request.stream === false
}

function validFence(fence: ViewerOutputFence): boolean {
  return Number.isSafeInteger(fence.frameCount) && fence.frameCount >= 0 &&
    [...fence.allowedEventIds, ...fence.activeViewerIds, ...fence.replyableEventIds]
      .every((value) => value.trim().length > 0)
}

function validateResult(
  request: ModelGenerationRequest,
  result: ModelGenerationResult,
  fence: ViewerOutputFence
): ParsedOutput {
  if (!sameGenerationIdentity(request, result) || result.finishReason !== 'stop') {
    return invalidOutput(false, ['$:identity_or_finish_reason'])
  }
  if (
    result.output.type !== 'structured' ||
    result.output.schemaName !== VIEWER_GENERATION_SCHEMA_NAME
  ) {
    return invalidOutput(false, ['$:schema_identity'])
  }

  let decoded: unknown
  try {
    decoded = JSON.parse(result.output.text)
  } catch {
    return invalidOutput(false, ['$:invalid_json'])
  }
  if (!isRecord(decoded)) return invalidOutput(false, ['$:expected_object'])

  const normalized = canonicalizeViewerOutput(decoded)
  const parsed = viewerModelOutputSchema.safeParse(normalized)
  if (!parsed.success) return invalidOutput(true, parsed.issues)

  const fenceIssues = publicationFenceIssues(parsed.data, fence)
  if (fenceIssues.length > 0) return invalidOutput(false, fenceIssues)

  return {
    ok: true,
    output: {
      ...parsed.data,
      texts: parsed.data.texts?.map((text) => text.trim()) ?? null
    }
  }
}

function sameGenerationIdentity(
  request: ModelGenerationRequest,
  result: ModelGenerationResult
): boolean {
  return result.requestId === request.requestId &&
    result.provider.kind === request.provider.kind &&
    result.provider.providerProfileId === request.provider.providerProfileId &&
    result.provider.providerRevision === request.provider.providerRevision &&
    result.roleModel.role === request.roleModel.role &&
    result.roleModel.modelId === request.roleModel.modelId &&
    result.protocolRepairAttempt === request.protocolRepairAttempt
}

function canonicalizeViewerOutput(output: Record<string, unknown>): unknown {
  const normalized = { ...output }
  for (const key of SERVER_OWNED_OUTPUT_KEYS) delete normalized[key]
  if (!Object.hasOwn(normalized, 'intent')) normalized.intent = 'react_to_scene'
  if (!Object.hasOwn(normalized, 'target')) normalized.target = null
  if (!Object.hasOwn(normalized, 'texts')) normalized.texts = null
  if (!Object.hasOwn(normalized, 'decision_reason')) normalized.decision_reason = null
  if (!Object.hasOwn(normalized, 'evidence_refs')) normalized.evidence_refs = []

  if (isRecord(normalized.target)) {
    normalized.target = {
      ...normalized.target,
      viewer_instance_id: normalized.target.viewer_instance_id === ''
        ? null
        : normalized.target.viewer_instance_id ?? null,
      event_id: normalized.target.event_id === ''
        ? null
        : normalized.target.event_id ?? null
    }
  }
  if (Array.isArray(normalized.evidence_refs)) {
    normalized.evidence_refs = normalized.evidence_refs.map((reference) => {
      if (!isRecord(reference)) return reference
      if (reference.source === 'event') {
        return { ...reference, frame_index: null }
      }
      if (reference.source === 'frame') {
        return { ...reference, event_id: null }
      }
      return { ...reference }
    })
  }
  return normalized
}

function publicationFenceIssues(
  output: ViewerModelOutput,
  fence: ViewerOutputFence
): SchemaIssue[] {
  const issues: SchemaIssue[] = []
  const allowedEventIds = new Set(fence.allowedEventIds)
  output.evidence_refs.forEach((reference, index) => {
    if (reference.source === 'event') {
      if (reference.event_id === null || reference.event_id === undefined ||
        !allowedEventIds.has(reference.event_id)) {
        issues.push({ path: ['evidence_refs', index], message: 'event_not_allowed' })
      }
    } else if (
      reference.frame_index === null ||
      reference.frame_index === undefined ||
      reference.frame_index >= fence.frameCount
    ) {
      issues.push({ path: ['evidence_refs', index], message: 'frame_not_allowed' })
    }
  })

  if (output.target?.kind === 'viewer') {
    if (
      output.target.viewer_instance_id === null ||
      output.target.viewer_instance_id === undefined ||
      !new Set(fence.activeViewerIds).has(output.target.viewer_instance_id)
    ) {
      issues.push({ path: ['target'], message: 'viewer_not_allowed' })
    }
  } else if (output.target?.kind === 'event') {
    if (
      output.target.event_id === null ||
      output.target.event_id === undefined ||
      !new Set(fence.replyableEventIds).has(output.target.event_id)
    ) {
      issues.push({ path: ['target'], message: 'event_not_replyable' })
    }
  }
  return issues
}

function validatedGeneration(
  result: ModelGenerationResult,
  output: ViewerModelOutput
): ProviderOutcome<ValidatedViewerGeneration> {
  return {
    ok: true,
    value: {
      result,
      output,
      publicationTexts: output.texts?.map(truncateViewerBarrageText) ?? []
    }
  }
}

function invalidOutput(
  repairable: boolean,
  issues: readonly SchemaIssue[] | readonly string[]
): InvalidOutput {
  const codes = issues.map((entry) =>
    typeof entry === 'string'
      ? entry
      : `${formatPath(entry.path)}:invalid`
  )
  return {
    ok: false,
    repairable,
    validationCodes: [...new Set(codes)].sort().join(',').slice(
      0,
      MAXIMUM_VALIDATION_CODE_LENGTH
    ) || '$:invalid'
  }
}

function formatPath(path: readonly (string | number)[]): string {
  return path.length === 0 ? '$' : path.map(String).join('.')
}

function repairInstruction(validationCodes: string): string {
  return 'Your prior JSON violated the contract. Return one corrected JSON object only. ' +
    `Validation codes: ${validationCodes}`
}

function invalidRequestFailure(): ProviderFailure {
  return providerFailure({
    code: 'invalid_request',
    source: 'advx',
    retryable: false
  })
}

function invalidResponseFailure(result: ModelGenerationResult): ProviderFailure {
  return providerFailure({
    code: 'invalid_response',
    source: 'protocol',
    retryable: false,
    ...(result.providerRequestId === undefined
      ? {}
      : { providerRequestId: result.providerRequestId })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
