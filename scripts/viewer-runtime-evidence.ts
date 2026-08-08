import { mkdir, rm } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'

import { ReplayService } from '../apps/backend-bun/src/application/services/replay-service.ts'
import {
  replayRequestSchema,
  replayResultSchema,
  type ReplayRequest,
  type ReplayResult
} from '../packages/contracts/src/http/debug.ts'
import { canonicalSha256 } from '../packages/contracts/src/http/canonical.ts'
import {
  ExecutionGuard,
  fileIdentity,
  readJsonFile,
  requireSafeArtifactRoot,
  SCRIPT_EXIT,
  ScriptError,
  writeJsonAtomic,
  type FileIdentity
} from './evidence-script-runtime.ts'

const expectedRoles = ['viewer', 'visual_summary', 'memory', 'asr'] as const
const forbiddenKey = /(^|_)(api_?key|authorization|password|secret|access_?token|refresh_?token|raw_audio|raw_frame|raw_prompt|raw_provider_response)($|_)/i
const forbiddenString = /(^|\s)(bearer\s+[a-z0-9._~+/=-]{8,}|sk-[a-z0-9_-]{8,})/i

export type ViewerRuntimeVerification = Readonly<{
  schema_version: 1
  task_id: 'TST-009'
  status: 'passed'
  fixture: FileIdentity & Readonly<{ unchanged: true }>
  replay: Readonly<{
    bundle_id: string
    deterministic_proof: true
    credentialed_provider_proof: false
    external_transport_call_count: 0
    event_count: number
    consumed_provider_roles: readonly string[]
    replay_digest: string
  }>
  artifacts: readonly FileIdentity[]
  artifact_hashes_verified: true
  product_data_mutated: false
  redaction_verified: true
  compatibility_projection: 'active-mode-current-contract-v1'
}>

export async function verifyViewerRuntimeEvidence(options: Readonly<{
  fixturePath: string
  artifactRoot: string
  repositoryRoot: string
  timeoutMs: number
}>): Promise<ViewerRuntimeVerification> {
  const fixturePath = resolve(options.fixturePath)
  const artifactRoot = requireSafeArtifactRoot(options.artifactRoot, options.repositoryRoot)
  const guard = new ExecutionGuard(options.timeoutMs)
  const workRoot = join(artifactRoot, '.work')
  guard.addCleanup(() => rm(workRoot, { recursive: true, force: true }))

  try {
    await rm(artifactRoot, { recursive: true, force: true })
    await mkdir(workRoot, { recursive: true })
    const fixtureRelative = normalizeRelative(options.repositoryRoot, fixturePath)
    const fixtureBefore = await fileIdentity(fixturePath, fixtureRelative)
    const rawFixture = await readJsonFile(fixturePath)
    assertRedactedValue(rawFixture)
    const fixture = recordValue(rawFixture, 'fixture')
    const request = parseReplayRequest(projectFixtureBundle(fixture.bundle))
    const service = new ReplayService({ recordedDataDirectory: workRoot })
    const replayOperation = service.replay(request)
    let replayValue: ReplayResult
    try {
      replayValue = await guard.race(replayOperation)
    } catch (error) {
      await replayOperation.catch(() => undefined)
      throw error
    }
    const replay = replayResultSchema.parse(replayValue)
    assertReplayResult(replay)

    const evidencePath = join(artifactRoot, 'replay-evidence.json')
    const resultPath = join(artifactRoot, 'result.json')
    await writeJsonAtomic(evidencePath, replay.recorded_evidence)
    await writeJsonAtomic(resultPath, {
      schema_version: 1,
      task_id: 'TST-009',
      status: 'passed',
      fixture: fixtureRelative,
      bundle_id: replay.bundle_id,
      replay_digest: replay.replay_digest,
      event_count: replay.event_count,
      consumed_provider_roles: replay.recorded_evidence?.consumed_provider_roles,
      external_transport_call_count: replay.external_transport_call_count,
      redaction_verified: true,
      product_data_mutated: false
    })

    const artifacts = await Promise.all([
      fileIdentity(evidencePath, 'replay-evidence.json'),
      fileIdentity(resultPath, 'result.json')
    ])
    const fixtureAfter = await fileIdentity(fixturePath, fixtureRelative)
    if (
      fixtureBefore.sha256 !== fixtureAfter.sha256 ||
      fixtureBefore.bytes !== fixtureAfter.bytes
    ) {
      throw new ScriptError(
        SCRIPT_EXIT.verificationFailed,
        'input fixture changed during verification'
      )
    }
    await verifyArtifactIdentities(artifactRoot, artifacts)

    const verification: ViewerRuntimeVerification = {
      schema_version: 1,
      task_id: 'TST-009',
      status: 'passed',
      fixture: { ...fixtureAfter, unchanged: true },
      replay: {
        bundle_id: replay.bundle_id,
        deterministic_proof: true,
        credentialed_provider_proof: false,
        external_transport_call_count: 0,
        event_count: replay.event_count,
        consumed_provider_roles: replay.recorded_evidence!.consumed_provider_roles,
        replay_digest: replay.replay_digest!
      },
      artifacts,
      artifact_hashes_verified: true,
      product_data_mutated: false,
      redaction_verified: true,
      compatibility_projection: 'active-mode-current-contract-v1'
    }
    await writeJsonAtomic(join(artifactRoot, 'manifest.json'), verification)
    return verification
  } finally {
    await guard.close()
  }
}

export function assertRedactedValue(value: unknown): void {
  const pending: Array<{ value: unknown; path: string; depth: number }> = [
    { value, path: '$', depth: 0 }
  ]
  let visited = 0
  while (pending.length > 0) {
    const current = pending.pop()!
    visited += 1
    if (visited > 250_000 || current.depth > 64) {
      throw new ScriptError(
        SCRIPT_EXIT.invalidInput,
        'redaction scan exceeded its bounded input limits'
      )
    }
    if (typeof current.value === 'string' && forbiddenString.test(current.value)) {
      throw new ScriptError(
        SCRIPT_EXIT.verificationFailed,
        `credential-like string found at ${current.path}`
      )
    }
    if (Array.isArray(current.value)) {
      current.value.forEach((child, index) => pending.push({
        value: child,
        path: `${current.path}[${index}]`,
        depth: current.depth + 1
      }))
      continue
    }
    if (current.value === null || typeof current.value !== 'object') continue
    for (const [key, child] of Object.entries(current.value)) {
      const childPath = `${current.path}.${key}`
      if (forbiddenKey.test(key)) {
        throw new ScriptError(
          SCRIPT_EXIT.verificationFailed,
          `forbidden raw or credential field found at ${childPath}`
        )
      }
      pending.push({ value: child, path: childPath, depth: current.depth + 1 })
    }
  }
}

function projectFixtureBundle(bundleValue: unknown): unknown {
  const bundle = structuredClone(recordValue(bundleValue, 'fixture.bundle'))
  const runtimeSpec = recordValue(bundle.canonical_runtime_spec, 'canonical_runtime_spec')
  const activeModeId = runtimeSpec.active_mode_id
  if (typeof activeModeId !== 'string') {
    throw new ScriptError(SCRIPT_EXIT.invalidInput, 'active_mode_id must be a string')
  }
  if (!Array.isArray(runtimeSpec.modes) || !Array.isArray(runtimeSpec.personas)) {
    throw new ScriptError(
      SCRIPT_EXIT.invalidInput,
      'canonical runtime modes and personas must be arrays'
    )
  }
  const modes = runtimeSpec.modes
  const personas = runtimeSpec.personas
  const activeMode = modes.find((value) => {
    const mode = value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
    return mode?.mode_id === activeModeId
  })
  const activeModeRecord = recordValue(activeMode, 'active mode')
  const counts = recordValue(activeModeRecord.persona_counts, 'active mode persona_counts')
  const activePersonaIds = new Set(Object.keys(counts))
  runtimeSpec.modes = [activeModeRecord]
  const activePersonas = personas.filter((value) => {
    const persona = value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
    return typeof persona?.persona_id === 'string' && activePersonaIds.has(persona.persona_id)
  })
  runtimeSpec.personas = activePersonas
  if (activePersonas.length !== activePersonaIds.size) {
    throw new ScriptError(
      SCRIPT_EXIT.invalidInput,
      'active mode does not have an exact persona definition set'
    )
  }

  if (!Array.isArray(bundle.recorded_provider_outputs)) {
    throw new ScriptError(
      SCRIPT_EXIT.invalidInput,
      'recorded_provider_outputs must be an array'
    )
  }
  bundle.recorded_provider_outputs = bundle.recorded_provider_outputs.map((value) => {
    const recorded = recordValue(value, 'recorded provider output')
    if (recorded.provider_role !== 'viewer') return recorded
    const output = recordValue(recorded.output, 'recorded viewer output')
    const legacyTexts = Array.isArray(output.texts) ? output.texts : []
    const text = typeof output.text === 'string'
      ? output.text
      : legacyTexts.find((item): item is string => typeof item === 'string')
    return {
      generation_request_id: recorded.generation_request_id,
      provider_role: recorded.provider_role,
      output: {
        ...(typeof output.action === 'string' ? { action: output.action } : {}),
        ...(text === undefined ? {} : { text }),
        ...(typeof output.reaction_type === 'string'
          ? { reaction_type: output.reaction_type }
          : {}),
        ...(Array.isArray(output.evidence_event_ids)
          ? { evidence_event_ids: output.evidence_event_ids }
          : {}),
        ...(Array.isArray(output.evidence_frame_indexes)
          ? { evidence_frame_indexes: output.evidence_frame_indexes }
          : {})
      }
    }
  })
  bundle.config_hash = canonicalSha256(runtimeSpec)
  bundle.recorded_outputs_digest = canonicalSha256(bundle.recorded_provider_outputs)
  return bundle
}

function parseReplayRequest(bundle: unknown): ReplayRequest {
  try {
    return replayRequestSchema.parse({
      mode: 'recorded',
      bundle,
      allow_external_provider_calls: false
    })
  } catch (error) {
    throw new ScriptError(
      SCRIPT_EXIT.invalidInput,
      error instanceof Error ? error.message : 'replay fixture is invalid'
    )
  }
}

function assertReplayResult(replay: ReplayResult): asserts replay is ReplayResult & {
  deterministic_proof: true
  credentialed_provider_proof: false
  external_transport_call_count: 0
  replay_digest: string
  recorded_evidence: NonNullable<ReplayResult['recorded_evidence']>
} {
  const roles = replay.recorded_evidence?.consumed_provider_roles
  if (
    replay.mode !== 'recorded' ||
    replay.deterministic_proof !== true ||
    replay.credentialed_provider_proof !== false ||
    replay.external_transport_call_count !== 0 ||
    replay.recorded_evidence?.external_transport_call_count !== 0 ||
    typeof replay.replay_digest !== 'string' ||
    replay.event_count !== 6 ||
    roles === undefined ||
    roles.length !== expectedRoles.length ||
    !expectedRoles.every((role, index) => roles[index] === role)
  ) {
    throw new ScriptError(
      SCRIPT_EXIT.verificationFailed,
      'recorded replay did not satisfy the decisive TST-009 evidence contract'
    )
  }
}

async function verifyArtifactIdentities(
  artifactRoot: string,
  artifacts: readonly FileIdentity[]
): Promise<void> {
  for (const expected of artifacts) {
    const actual = await fileIdentity(join(artifactRoot, expected.path), expected.path)
    if (actual.sha256 !== expected.sha256 || actual.bytes !== expected.bytes) {
      throw new ScriptError(
        SCRIPT_EXIT.verificationFailed,
        `artifact hash verification failed: ${expected.path}`
      )
    }
  }
}

function recordValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new ScriptError(SCRIPT_EXIT.invalidInput, `${label} must be a JSON object`)
  }
  return value as Record<string, unknown>
}

function normalizeRelative(root: string, path: string): string {
  const value = relative(root, path).replaceAll('\\', '/')
  return value.startsWith('../') ? basename(path) : value
}
