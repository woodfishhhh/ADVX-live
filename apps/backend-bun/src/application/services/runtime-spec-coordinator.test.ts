import { describe, expect, test } from 'bun:test'
import {
  canonicalJson,
  canonicalSha256,
  type CanonicalRuntimeSpec,
  type Revision
} from '@advx/contracts'

import type {
  RuntimeSpecCommitToken,
  RuntimeSpecRecord,
  RuntimeSpecRepository,
  RuntimeSpecRevisionStatus,
  TransactionContext
} from '../ports/repositories'
import { transactionContext } from '../ports/repositories'
import type { TaskScope } from '../ports/tasks'
import { wallClockTimestampMs } from '../ports/time'
import { RoomSessionLifecycle } from './room-session-lifecycle'
import {
  RuntimeSpecCoordinator,
  RuntimeSpecCoordinatorError
} from './runtime-spec-coordinator'

describe('BCK-006 runtime spec coordination', () => {
  test('canonically commits a full spec only at the wave boundary', async () => {
    const harness = await createHarness()
    const candidate = runtimeSpec(2, {
      personas: [persona('persona-2'), persona('persona-1')],
      modes: [mode('mode-1', { 'persona-1': 1, 'persona-2': 1 })]
    })
    const reordered = reorder(candidate)
    expect(canonicalSha256(candidate)).toBe(canonicalSha256(reordered))

    harness.capabilityInspect = () => {
      expect(harness.repository.active?.revision).toBe(1)
      expect(harness.coordinator.current().revision).toBe(1)
      expect(harness.repository.records.some((record) => record.status === 'pending')).toBe(true)
    }
    harness.boundaryInspect = () => {
      expect(harness.repository.active?.revision).toBe(1)
      expect(harness.lifecycle.snapshot.audienceEpoch).toBe(1)
    }

    const committed = await harness.coordinator.apply(
      harness.applyCommand('apply-2', reordered)
    )

    expect(committed.revision).toBe(2)
    expect(committed.operation).toBe('apply')
    expect(committed.rollbackTargetRevision).toBeNull()
    expect(committed.audienceEpoch).toBe(2)
    expect(committed.configHash).toBe(canonicalSha256(candidate))
    expect(committed.canonicalSpecJson).toBe(canonicalJson(candidate))
    expect(harness.repository.active).toBe(committed)
    expect(harness.lifecycle.snapshot.audienceEpoch).toBe(2)
    expect(harness.cancelledScopes).toBe(1)
    expect(committed.diffSummary.changedSections).toEqual(['room', 'personas', 'modes'])
    expect(JSON.stringify(committed.diffSummary)).not.toContain('viewer-model')
    expect(JSON.stringify(committed.diffSummary).length).toBeLessThan(2_048)
  })

  test('rejects partial and reference-broken candidates without moving the head', async () => {
    const harness = await createHarness()
    const partial = { protocol_version: 3 }
    const broken = runtimeSpec(2, {
      modes: [mode('mode-1', { missing: 1 })]
    })

    await expectCode(
      harness.coordinator.apply(harness.applyCommand('partial', partial)),
      'invalid_runtime_spec'
    )
    await expectCode(
      harness.coordinator.apply(harness.applyCommand('broken', broken)),
      'invalid_runtime_spec'
    )
    expect(harness.coordinator.current().revision).toBe(1)
    expect(harness.lifecycle.snapshot.audienceEpoch).toBe(1)
    expect(harness.repository.records).toHaveLength(1)
  })

  test('enforces apply idempotency, conflicts, and compare-and-swap', async () => {
    const harness = await createHarness()
    const command = harness.applyCommand('apply-2', runtimeSpec(2))
    const committed = await harness.coordinator.apply(command)
    expect(await harness.coordinator.apply(command)).toBe(committed)

    await expectCode(
      harness.coordinator.apply({
        ...command,
        candidate: runtimeSpec(3)
      }),
      'apply_id_conflict'
    )
    await expectCode(
      harness.coordinator.apply({
        ...harness.currentApplyCommand('stale-base', runtimeSpec(3)),
        baseRevision: 1
      }),
      'base_revision_conflict'
    )
    expect(harness.coordinator.current()).toBe(committed)
  })

  test('rejects apply IDs reused across apply and rollback operations', async () => {
    const harness = await createHarness()
    const command = harness.applyCommand('shared-id', runtimeSpec(2))
    const committed = await harness.coordinator.apply(command)

    await expectCode(
      harness.coordinator.rollback({
        ...harness.identity('shared-id'),
        baseRevision: 1,
        targetRevision: 2
      }),
      'apply_id_conflict'
    )
    expect(await harness.coordinator.apply(command)).toBe(committed)
  })

  test('rejects rollback IDs reused with a different exact target revision', async () => {
    const harness = await createHarness()
    await harness.coordinator.apply(harness.applyCommand('apply-2', runtimeSpec(2)))
    const firstCommand = {
      ...harness.identity('rollback-id'),
      targetRevision: 1
    }
    const firstRollback = await harness.coordinator.rollback(firstCommand)

    await expectCode(
      harness.coordinator.rollback({
        ...harness.identity('rollback-id'),
        baseRevision: 2,
        targetRevision: 3
      }),
      'apply_id_conflict'
    )
    expect(await harness.coordinator.rollback(firstCommand)).toBe(firstRollback)
  })

  test('retains the old head and epoch across each fallible stage', async () => {
    const failures = [
      ['pending', 'pending_persistence_failed'],
      ['capability', 'capability_rejected'],
      ['boundary', 'wave_boundary_failed'],
      ['cancel', 'old_work_cancellation_failed'],
      ['transaction', 'pending_persistence_failed'],
      ['commit', 'commit_failed']
    ] as const

    for (const [failure, code] of failures) {
      const harness = await createHarness()
      harness.fail(failure)
      await expectCode(
        harness.coordinator.apply(harness.applyCommand(`fail-${failure}`, runtimeSpec(2))),
        code
      )
      expect(harness.coordinator.current().revision).toBe(1)
      expect(harness.lifecycle.snapshot.audienceEpoch).toBe(1)
      expect(harness.repository.active?.revision).toBe(1)
    }
  })

  test('fences old work before any publish or persistence side effect', async () => {
    const harness = await createHarness()
    const oldFence = harness.fence()
    await harness.coordinator.apply(harness.applyCommand('apply-2', runtimeSpec(2)))
    let sideEffects = 0
    expect(harness.coordinator.acceptsWork(oldFence)).toBe(false)
    expect(harness.coordinator.commitIfCurrent(oldFence, () => sideEffects += 1)).toBe(false)
    expect(sideEffects).toBe(0)
    expect(harness.coordinator.commitIfCurrent(harness.fence(), () => sideEffects += 1)).toBe(true)
    expect(sideEffects).toBe(1)
  })

  test('rolls back by committing a new monotonic revision and epoch', async () => {
    const harness = await createHarness()
    await harness.coordinator.apply(harness.applyCommand('apply-2', runtimeSpec(2)))
    const beforeRollback = harness.coordinator.current()
    const rolledBack = await harness.coordinator.rollback({
      ...harness.identity('rollback-1'),
      targetRevision: 1
    })

    expect(rolledBack.revision).toBe(3)
    expect(rolledBack.operation).toBe('rollback')
    expect(rolledBack.rollbackTargetRevision).toBe(1)
    expect(rolledBack.configRevision).toBe(1)
    expect(rolledBack.canonicalSpecJson).toBe(harness.repository.records[0]?.canonicalSpecJson)
    expect(rolledBack.audienceEpoch).toBe(3)
    expect(harness.repository.record(2)?.status).toBe('rolled_back')
    expect(harness.repository.record(3)?.status).toBe('committed')
    expect(beforeRollback.revision).toBe(2)
  })

  test('serializes concurrent same-base commands so exactly one wins', async () => {
    const harness = await createHarness()
    const first = harness.applyCommand('concurrent-a', runtimeSpec(2))
    const second = harness.applyCommand('concurrent-b', runtimeSpec(3))
    const settled = await Promise.allSettled([
      harness.coordinator.apply(first),
      harness.coordinator.apply(second)
    ])

    expect(settled.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(harness.coordinator.current().revision).toBe(2)
    expect(harness.lifecycle.snapshot.audienceEpoch).toBe(2)
  })
})

class FakeRuntimeSpecRepository implements RuntimeSpecRepository {
  records: RuntimeSpecRecord[]
  active: RuntimeSpecRecord | null
  failPending = false
  failPrepareCommit = false
  failCommit = false

  constructor(initial: RuntimeSpecRecord) {
    this.records = [initial]
    this.active = initial
  }

  async getActive(_transaction: TransactionContext, _sessionId: string) {
    return this.active
  }

  async getRevision(
    _transaction: TransactionContext,
    _sessionId: string,
    revision: Revision
  ) {
    return this.record(revision) ?? null
  }

  async getByApplyId(
    _transaction: TransactionContext,
    _sessionId: string,
    applyId: string
  ) {
    return this.records.find((record) => record.applyId === applyId) ?? null
  }

  async nextRevision(_transaction: TransactionContext, _sessionId: string) {
    return Math.max(...this.records.map((record) => record.revision)) + 1
  }

  async addPending(_transaction: TransactionContext, record: RuntimeSpecRecord) {
    if (this.failPending) throw new Error('pending failed')
    this.records.push(record)
  }

  async rejectPending(
    _transaction: TransactionContext,
    _sessionId: string,
    revision: Revision,
    updatedAt: ReturnType<typeof wallClockTimestampMs>
  ) {
    const record = this.record(revision)
    if (record?.status !== 'pending') return
    this.replace(record, { ...record, status: 'rejected', updatedAt })
  }

  async prepareCommit(
    _transaction: TransactionContext,
    record: RuntimeSpecRecord,
    expectedActiveRevision: Revision,
    rolledBackRevision?: Revision
  ): Promise<RuntimeSpecCommitToken> {
    if (this.failPrepareCommit || this.active?.revision !== expectedActiveRevision) {
      throw new Error('prepare commit failed')
    }
    return {
      record,
      commit: () => {
        if (this.failCommit) throw new Error('commit failed')
        const pending = this.record(record.revision)
        if (pending === undefined) throw new Error('pending missing')
        this.replace(pending, record)
        if (rolledBackRevision !== undefined) {
          const previous = this.record(rolledBackRevision)
          if (previous !== undefined) {
            this.replace(previous, { ...previous, status: 'rolled_back' })
          }
        }
        this.active = record
      }
    }
  }

  record(revision: Revision): RuntimeSpecRecord | undefined {
    return this.records.find((record) => record.revision === revision)
  }

  private replace(previous: RuntimeSpecRecord, next: RuntimeSpecRecord): void {
    this.records[this.records.indexOf(previous)] = next
  }
}

async function createHarness() {
  let now = 100
  let cancelledScopes = 0
  let failCancel = false
  let capabilityInspect = () => {}
  let boundaryInspect = () => {}
  let failCapability = false
  let failBoundary = false
  let failTransaction = false
  let transactionCalls = 0
  const wallClock = { now: () => wallClockTimestampMs(now += 1) }
  const lifecycle = new RoomSessionLifecycle({
    wallClock,
    roomIds: { nextId: () => 'room-1' },
    sessionIds: { nextId: () => 'session-1' },
    eventIds: { nextId: () => `event-${now}` },
    createTaskScope: (): TaskScope => ({
      spawn: () => {
        throw new Error('not used')
      },
      cancelAll: () => {
        cancelledScopes += 1
        if (failCancel) throw new Error('cancel failed')
      },
      drain: async () => {
        if (failCancel) throw new Error('drain failed')
      }
    }),
    events: { publish: async () => {} },
    resources: {
      start: async () => {},
      pause: async () => {},
      resume: async () => {},
      recover: async () => {},
      release: async () => {}
    }
  })
  await lifecycle.start({
    roomId: 'room-1',
    clientStartId: 'start-1',
    requestFingerprint: 'fingerprint-1',
    expectedRevision: 0
  })

  const spec = runtimeSpec(1)
  const initial: RuntimeSpecRecord = {
    sessionId: 'session-1',
    roomId: 'room-1',
    revision: 1,
    applyId: 'start:start-1',
    operation: 'bootstrap',
    rollbackTargetRevision: null,
    baseRevision: 0,
    status: 'committed',
    configRevision: 1,
    audienceEpoch: 1,
    configHash: canonicalSha256(spec),
    canonicalSpecJson: canonicalJson(spec),
    spec,
    diffSummary: emptyDiff(),
    createdAt: wallClockTimestampMs(1),
    updatedAt: wallClockTimestampMs(1)
  }
  const repository = new FakeRuntimeSpecRepository(initial)
  const transactions = {
    async run<TResult>(work: (transaction: TransactionContext) => Promise<TResult>) {
      transactionCalls += 1
      if (failTransaction && transactionCalls === 2) throw new Error('transaction failed')
      return await work(transactionContext(`tx-${now}`))
    }
  }
  const coordinator = new RuntimeSpecCoordinator({
    wallClock,
    transactions,
    repository,
    lifecycle,
    capabilityGate: {
      validate: async () => {
        capabilityInspect()
        if (failCapability) throw new Error('capability failed')
      }
    },
    observationWaves: {
      cutover: async (work) => {
        boundaryInspect()
        if (failBoundary) throw new Error('boundary failed')
        return await work()
      }
    },
    initial
  })

  const identity = (applyId: string) => ({
    roomId: 'room-1',
    sessionId: 'session-1',
    audienceEpoch: coordinator.current().audienceEpoch,
    lifecycleRevision: lifecycle.snapshot.revision,
    baseRevision: coordinator.current().revision,
    applyId
  })
  return {
    lifecycle,
    repository,
    coordinator,
    get cancelledScopes() { return cancelledScopes },
    set capabilityInspect(inspect: () => void) { capabilityInspect = inspect },
    set boundaryInspect(inspect: () => void) { boundaryInspect = inspect },
    identity,
    applyCommand: (applyId: string, candidate: unknown) => ({
      roomId: 'room-1',
      sessionId: 'session-1',
      audienceEpoch: 1,
      lifecycleRevision: 2,
      baseRevision: 1,
      applyId,
      candidate
    }),
    currentApplyCommand: (applyId: string, candidate: unknown) => ({
      ...identity(applyId),
      candidate
    }),
    fence: () => ({
      roomId: 'room-1',
      sessionId: 'session-1',
      audienceEpoch: coordinator.current().audienceEpoch,
      runtimeRevision: coordinator.current().revision
    }),
    fail(stage: 'pending' | 'capability' | 'boundary' | 'cancel' | 'transaction' | 'commit') {
      if (stage === 'pending') repository.failPending = true
      if (stage === 'capability') failCapability = true
      if (stage === 'boundary') failBoundary = true
      if (stage === 'cancel') failCancel = true
      if (stage === 'transaction') failTransaction = true
      if (stage === 'commit') repository.failCommit = true
    }
  }
}

function runtimeSpec(
  configRevision: number,
  overrides: Partial<CanonicalRuntimeSpec> = {}
): CanonicalRuntimeSpec {
  return {
    protocol_version: 3,
    audience_contract_version: 3,
    config_revision: configRevision,
    room: {
      room_id: 'room-1',
      display_name: 'Room',
      created_at_ms: 1,
      updated_at_ms: configRevision
    },
    active_mode_id: 'mode-1',
    personas: [persona('persona-1')],
    modes: [mode('mode-1', { 'persona-1': 1 })],
    provider: {
      provider_profile_id: 'profile-1',
      viewer_model: 'viewer-model',
      memory_model: 'memory-model',
      visual_summary_model: 'vision-model'
    },
    ...overrides
  }
}

function persona(personaId: string) {
  return {
    persona_id: personaId,
    document_version: 1,
    revision: 1,
    content_hash: 'a'.repeat(64),
    display_name: 'Viewer',
    role: 'viewer',
    silence_bias: 0,
    burst_bias: 0,
    repetition_bias: 0,
    cooldown_ms: 0,
    enabled: true
  }
}

function mode(modeId: string, personaCounts: Record<string, number>) {
  return {
    mode_id: modeId,
    namespace_id: 'namespace-1',
    revision: 1,
    persona_counts: personaCounts,
    normal_response_range: { minimum: 0, maximum: 1 },
    highlight_response_range: { minimum: 0, maximum: 1 }
  }
}

function reorder(spec: CanonicalRuntimeSpec): unknown {
  return {
    provider: { ...spec.provider },
    modes: spec.modes.map((item) => ({ ...item })),
    personas: spec.personas.map((item) => ({ ...item })),
    active_mode_id: spec.active_mode_id,
    room: { ...spec.room },
    config_revision: spec.config_revision,
    audience_contract_version: spec.audience_contract_version,
    protocol_version: spec.protocol_version
  }
}

function emptyDiff() {
  return {
    changedSections: [],
    personas: identityDiff(),
    modes: identityDiff(),
    providerChanged: false,
    settingsChanged: false
  } as const
}

function identityDiff() {
  return {
    addedIds: [],
    removedIds: [],
    changedIds: [],
    previousCount: 1,
    nextCount: 1
  } as const
}

async function expectCode(
  promise: Promise<unknown>,
  code: RuntimeSpecCoordinatorError['code']
): Promise<void> {
  try {
    await promise
    throw new Error(`expected ${code}`)
  } catch (error) {
    expect(error).toBeInstanceOf(RuntimeSpecCoordinatorError)
    expect((error as RuntimeSpecCoordinatorError).code).toBe(code)
  }
}
