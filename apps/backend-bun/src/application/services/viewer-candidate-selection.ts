import type {
  ObservationTrigger,
  ViewerId
} from '@advx/contracts'

import type { ViewerInstanceRecord } from '../ports/repositories'
import type { ObservationWave } from './observation-wave'

export const USER_CANDIDATE_BUDGET = 6
export const AMBIENT_CANDIDATE_BUDGET = 2
export const DIRECT_MENTION_CANDIDATE_BUDGET = 1
export const SCREEN_ACTIVE_VIEWER_DIVISOR = 4

export type ViewerCandidateBudgetKind =
  | 'user'
  | 'screen'
  | 'ambient'
  | 'direct_viewer'
  | 'direct_persona'

export type ViewerCandidateSelectionInput = Readonly<{
  wave: ObservationWave
  sessionSeed: string
  viewers: readonly ViewerInstanceRecord[]
  targetViewerId?: ViewerId | null
  targetPersonaId?: string | null
  targetAmbiguous?: boolean
}>

export type ViewerCandidateSelection = Readonly<{
  selectionId: string
  budgetKind: ViewerCandidateBudgetKind
  candidateBudget: number
  activePopulation: number
  eligiblePopulation: number
  candidates: readonly ViewerInstanceRecord[]
  candidateViewerIds: readonly ViewerId[]
}>

export type ViewerCandidateSelectionErrorCode =
  | 'invalid_scope'
  | 'invalid_target'
  | 'invalid_trigger'

export class ViewerCandidateSelectionError extends Error {
  constructor(
    readonly code: ViewerCandidateSelectionErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'ViewerCandidateSelectionError'
  }
}

export class ViewerCandidateSelector {
  select(input: ViewerCandidateSelectionInput): ViewerCandidateSelection {
    validateInput(input)
    const active = input.viewers.filter((viewer) =>
      belongsToWave(viewer, input.wave) &&
      viewer.storageState === 'active' &&
      viewer.lifecycleState === 'active'
    )
    const eligible = active.filter(
      (viewer) =>
        viewer.mutedUntil === null || viewer.mutedUntil <= input.wave.createdAt
    )
    const targetAmbiguous = input.targetAmbiguous ?? false
    let budgetKind: ViewerCandidateBudgetKind
    let candidateBudget: number
    let candidates: ViewerInstanceRecord[]

    if (!targetAmbiguous && input.targetViewerId != null) {
      budgetKind = 'direct_viewer'
      candidateBudget = DIRECT_MENTION_CANDIDATE_BUDGET
      candidates = eligible.filter(
        (viewer) => viewer.viewerInstanceId === input.targetViewerId
      )
    } else if (!targetAmbiguous && input.targetPersonaId != null) {
      budgetKind = 'direct_persona'
      candidateBudget = DIRECT_MENTION_CANDIDATE_BUDGET
      candidates = orderedCandidates(
        eligible.filter((viewer) => viewer.personaId === input.targetPersonaId),
        input,
        budgetKind
      ).slice(0, candidateBudget)
    } else {
      budgetKind = budgetKindFor(input.wave.triggers)
      candidateBudget = budgetFor(budgetKind, active.length)
      candidates = orderedCandidates(eligible, input, budgetKind).slice(
        0,
        candidateBudget
      )
    }

    const candidateViewerIds = candidates.map(
      (viewer) => viewer.viewerInstanceId
    )
    return Object.freeze({
      selectionId: selectionId(input, budgetKind, candidateViewerIds),
      budgetKind,
      candidateBudget,
      activePopulation: active.length,
      eligiblePopulation: eligible.length,
      candidates: Object.freeze(candidates),
      candidateViewerIds: Object.freeze(candidateViewerIds)
    })
  }
}

function validateInput(input: ViewerCandidateSelectionInput): void {
  if (input.sessionSeed.length === 0 || input.wave.observationId.length === 0) {
    fail('invalid_scope', 'Session seed and Observation identity must not be empty')
  }
  if (input.wave.triggers.length === 0) {
    fail('invalid_trigger', 'candidate selection requires an Observation trigger')
  }
  if (
    !(input.targetAmbiguous ?? false) &&
    input.targetViewerId != null &&
    input.targetPersonaId != null
  ) {
    fail('invalid_target', 'an accurate mention may target one Viewer or one Persona')
  }
  if (input.targetPersonaId !== undefined && input.targetPersonaId !== null) {
    if (input.targetPersonaId.length === 0) {
      fail('invalid_target', 'Persona target must not be empty')
    }
  }
}

function belongsToWave(
  viewer: ViewerInstanceRecord,
  wave: ObservationWave
): boolean {
  return (
    viewer.roomId === wave.roomId &&
    viewer.sessionId === wave.sessionId &&
    viewer.audienceEpoch === wave.audienceEpoch
  )
}

function budgetKindFor(
  triggers: readonly ObservationTrigger[]
): 'user' | 'screen' | 'ambient' {
  if (
    triggers.some(
      (trigger) =>
        trigger === 'user_text' ||
        trigger === 'final_voice' ||
        trigger === 'system_audio'
    )
  ) {
    return 'user'
  }
  if (triggers.includes('screen_change')) return 'screen'
  if (triggers.includes('ambient_tick')) return 'ambient'
  fail('invalid_trigger', 'Observation trigger has no candidate budget')
}

function budgetFor(
  kind: 'user' | 'screen' | 'ambient',
  activePopulation: number
): number {
  switch (kind) {
    case 'user':
      return USER_CANDIDATE_BUDGET
    case 'screen':
      return Math.ceil(activePopulation / SCREEN_ACTIVE_VIEWER_DIVISOR)
    case 'ambient':
      return AMBIENT_CANDIDATE_BUDGET
  }
}

function orderedCandidates(
  viewers: readonly ViewerInstanceRecord[],
  input: ViewerCandidateSelectionInput,
  kind: ViewerCandidateBudgetKind
): ViewerInstanceRecord[] {
  const ranked = viewers.map((viewer) => ({
    viewer,
    digest: rotationDigest(input, kind, viewer.viewerInstanceId)
  }))
  ranked.sort((left, right) => {
    if (kind !== 'screen') {
      const leftSpoke = left.viewer.privateState.last_spoke_at_ms
      const rightSpoke = right.viewer.privateState.last_spoke_at_ms
      const spokenDifference = Number(leftSpoke !== null) - Number(rightSpoke !== null)
      if (spokenDifference !== 0) return spokenDifference
      if (leftSpoke !== null && rightSpoke !== null && leftSpoke !== rightSpoke) {
        return leftSpoke - rightSpoke
      }
    }
    return (
      compareBytes(left.digest, right.digest) ||
      compareStrings(left.viewer.viewerInstanceId, right.viewer.viewerInstanceId)
    )
  })
  return ranked.map((entry) => entry.viewer)
}

function rotationDigest(
  input: ViewerCandidateSelectionInput,
  kind: ViewerCandidateBudgetKind,
  viewerInstanceId: ViewerId
): Uint8Array {
  return sha256Bytes(
    `${input.sessionSeed}\0${input.wave.audienceEpoch}\0${input.wave.observationId}` +
      `\0${kind}\0${viewerInstanceId}\0candidate-selection-v1`
  )
}

function selectionId(
  input: ViewerCandidateSelectionInput,
  kind: ViewerCandidateBudgetKind,
  candidateViewerIds: readonly ViewerId[]
): string {
  return `selection-${sha256Hex(
    `${input.wave.replayIdentity}\0${input.sessionSeed}\0${kind}\0` +
      candidateViewerIds.join('\0')
  ).slice(0, 24)}`
}

function sha256Bytes(value: string): Uint8Array {
  return new Uint8Array(new Bun.CryptoHasher('sha256').update(value).digest())
}

function sha256Hex(value: string): string {
  return Buffer.from(sha256Bytes(value)).toString('hex')
}

function compareBytes(left: Uint8Array, right: Uint8Array): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const difference = left[index]! - right[index]!
    if (difference !== 0) return difference
  }
  return left.length - right.length
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function fail(
  code: ViewerCandidateSelectionErrorCode,
  message: string
): never {
  throw new ViewerCandidateSelectionError(code, message)
}
