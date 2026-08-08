import { describe, expect, test } from 'bun:test'
import {
  canonicalSha256,
  legacySessionSnapshotSchema,
  normalizedErrorSchema,
  runtimeSessionSnapshotSchema,
  type CanonicalRuntimeSpec,
  type Revision,
  type RoomId,
  type SessionId
} from '@advx/contracts'

import { createApp } from '../app'
import type {
  RuntimeControlKernel,
  RuntimeControlKernelFactory,
  RuntimeSpecCommitToken,
  RuntimeSpecRecord,
  RuntimeSpecRepository,
  TransactionContext
} from '../application'
import {
  RoomSessionLifecycle,
  RuntimeControlService,
  RuntimeSpecCoordinator,
  transactionContext,
  wallClockTimestampMs
} from '../application'
import { InMemoryBackendProfileReader } from '../providers'

const TOKEN = 'BCK007-local-token'
const RAW_CANARY = 'D:/private/runtime.sqlite provider-secret-model'

describe('BCK-007 canonical Elysia control routes', () => {
  test('authenticates and version-guards before parsing or starting work', async () => {
    const harness = createHarness()
    const invalidBody = { raw_secret: RAW_CANARY }

    const missing = await harness.api.handle(
      new Request('http://localhost/runtime/sessions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-advx-protocol-version': '3'
        },
        body: JSON.stringify(invalidBody)
      })
    )
    expect(missing.status).toBe(401)
    expect(normalizedErrorSchema.parse(await missing.json()).code).toBe(
      'invalid_local_token'
    )
    expect(missing.headers.get('www-authenticate')).toBe('Bearer')
    expect(missing.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/)

    const missingVersion = await request(harness.api, '/runtime/sessions', {
      method: 'POST',
      body: invalidBody,
      version: null
    })
    expect(missingVersion.status).toBe(422)
    expect(normalizedErrorSchema.parse(await missingVersion.json()).code).toBe(
      'unsupported_protocol_version'
    )

    const legacyVersion = await request(harness.api, '/runtime/sessions', {
      method: 'POST',
      body: invalidBody,
      version: '1'
    })
    expect(legacyVersion.status).toBe(409)
    expect(normalizedErrorSchema.parse(await legacyVersion.json()).code).toBe(
      'protocol_version_conflict'
    )

    const legacyGuard = await request(harness.api, '/sessions/current', {
      version: '1'
    })
    expect(legacyGuard.status).toBe(426)
    expect(normalizedErrorSchema.parse(await legacyGuard.json()).code).toBe(
      'protocol_version_mismatch'
    )

    const malformedJson = await harness.api.handle(
      new Request('http://localhost/runtime/sessions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${TOKEN}`,
          'content-type': 'application/json',
          'x-advx-protocol-version': '3'
        },
        body: `{"raw":"${RAW_CANARY}`
      })
    )
    expect(malformedJson.status).toBe(422)
    const malformedText = await malformedJson.text()
    expect(normalizedErrorSchema.parse(JSON.parse(malformedText)).code).toBe(
      'runtime_start_rejected'
    )
    expect(malformedText).not.toContain(RAW_CANARY)
    expect(harness.kernels.lifecycleCount).toBe(0)
  })

  test('starts, queries, and replays one real lifecycle/coordinator session', async () => {
    const harness = createHarness()
    const start = startRequest(runtimeSpec(1))

    const created = await request(harness.api, '/runtime/sessions', {
      method: 'POST',
      body: start
    })
    expect(created.status).toBe(201)
    const snapshot = runtimeSessionSnapshotSchema.parse(await created.json())
    expect(snapshot).toMatchObject({
      session_id: 'session-1',
      room_id: 'room-1',
      audience_epoch: 1,
      config_revision: 1,
      config_hash: start.client_config_hash,
      apply_id: 'start:start-1',
      recovered: false
    })

    const replay = await request(harness.api, '/runtime/sessions', {
      method: 'POST',
      body: start
    })
    expect(replay.status).toBe(201)
    expect(runtimeSessionSnapshotSchema.parse(await replay.json())).toEqual(snapshot)
    expect(harness.kernels.lifecycleCount).toBe(1)

    const current = await request(
      harness.api,
      '/runtime/sessions/session-1'
    )
    expect(current.status).toBe(200)
    expect(runtimeSessionSnapshotSchema.parse(await current.json())).toEqual(snapshot)

    const changed = startRequest(runtimeSpec(2))
    const conflict = await request(harness.api, '/runtime/sessions', {
      method: 'POST',
      body: changed
    })
    expect(conflict.status).toBe(409)
    expect(normalizedErrorSchema.parse(await conflict.json()).code).toBe(
      'client_request_conflict'
    )
  })

  test('validates and maps apply/rollback through the accepted coordinator', async () => {
    const harness = createHarness()
    await startSession(harness.api)

    const invalid = await request(
      harness.api,
      '/runtime/sessions/session-1/apply',
      { method: 'POST', body: { apply_id: 'partial' } }
    )
    expect(invalid.status).toBe(422)
    expect(normalizedErrorSchema.parse(await invalid.json()).code).toBe(
      'runtime_apply_rejected'
    )

    const wrongRoomSpec = runtimeSpec(2)
    wrongRoomSpec.room.room_id = 'room-2'
    const wrongRoom = await request(
      harness.api,
      '/runtime/sessions/session-1/apply',
      {
        method: 'POST',
        body: {
          apply_id: 'wrong-room-apply',
          base_revision: 1,
          audience_contract_version: 3,
          canonical_runtime_spec: wrongRoomSpec,
          client_config_hash: canonicalSha256(wrongRoomSpec)
        }
      }
    )
    expect(wrongRoom.status).toBe(422)
    expect(normalizedErrorSchema.parse(await wrongRoom.json()).code).toBe(
      'runtime_apply_rejected'
    )

    const nextSpec = runtimeSpec(2)
    const apply = {
      apply_id: 'apply-2',
      base_revision: 1,
      audience_contract_version: 3,
      canonical_runtime_spec: nextSpec,
      client_config_hash: canonicalSha256(nextSpec)
    }
    const applied = await request(
      harness.api,
      '/runtime/sessions/session-1/apply',
      { method: 'POST', body: apply }
    )
    expect(applied.status).toBe(200)
    const appliedSnapshot = runtimeSessionSnapshotSchema.parse(await applied.json())
    expect(appliedSnapshot).toMatchObject({
      audience_epoch: 2,
      config_revision: 2,
      apply_id: 'apply-2',
      recovered: false
    })

    const applyReplay = await request(
      harness.api,
      '/runtime/sessions/session-1/apply',
      { method: 'POST', body: apply }
    )
    expect(applyReplay.status).toBe(200)
    expect(runtimeSessionSnapshotSchema.parse(await applyReplay.json())).toEqual(
      appliedSnapshot
    )

    const rollback = {
      apply_id: 'rollback-1',
      base_revision: 2,
      target_revision: 1,
      audience_contract_version: 3
    }
    const rolledBack = await request(
      harness.api,
      '/runtime/sessions/session-1/rollback',
      { method: 'POST', body: rollback }
    )
    expect(rolledBack.status).toBe(200)
    expect(runtimeSessionSnapshotSchema.parse(await rolledBack.json())).toMatchObject({
      audience_epoch: 3,
      config_revision: 1,
      apply_id: 'rollback-1'
    })

    const rollbackReplay = await request(
      harness.api,
      '/runtime/sessions/session-1/rollback',
      { method: 'POST', body: rollback }
    )
    expect(rollbackReplay.status).toBe(200)

    const stale = await request(
      harness.api,
      '/runtime/sessions/session-1/apply',
      {
        method: 'POST',
        body: {
          ...apply,
          apply_id: 'stale-apply',
          base_revision: 2,
          canonical_runtime_spec: runtimeSpec(3),
          client_config_hash: canonicalSha256(runtimeSpec(3))
        }
      }
    )
    expect(stale.status).toBe(422)
    expect(normalizedErrorSchema.parse(await stale.json()).code).toBe(
      'runtime_apply_rejected'
    )
  })

  test('maps internal lifecycle states without expanding public SessionState', async () => {
    const harness = createHarness()
    await startSession(harness.api)

    const current = await request(harness.api, '/sessions/current')
    expect(legacySessionSnapshotSchema.parse(await current.json()).state).toBe(
      'running'
    )

    const paused = await request(harness.api, '/sessions/session-1/pause', {
      method: 'POST'
    })
    expect(legacySessionSnapshotSchema.parse(await paused.json()).state).toBe(
      'paused'
    )
    const resumed = await request(harness.api, '/sessions/session-1/resume', {
      method: 'POST'
    })
    expect(legacySessionSnapshotSchema.parse(await resumed.json()).state).toBe(
      'running'
    )

    await harness.kernels.degrade('session-1')
    const degraded = await request(harness.api, '/sessions/current')
    expect(legacySessionSnapshotSchema.parse(await degraded.json()).state).toBe(
      'error'
    )

    const recovered = await request(
      harness.api,
      '/runtime/sessions/session-1/recover',
      { method: 'POST' }
    )
    expect(recovered.status).toBe(200)
    expect(runtimeSessionSnapshotSchema.parse(await recovered.json())).toMatchObject({
      session_id: 'session-1',
      audience_epoch: 2,
      recovered: true
    })

    const stopped = await request(harness.api, '/sessions/session-1/stop', {
      method: 'POST'
    })
    expect(legacySessionSnapshotSchema.parse(await stopped.json())).toMatchObject({
      session_id: null,
      state: 'idle',
      started_at_ms: null
    })
    const idle = await request(harness.api, '/sessions/current')
    expect(legacySessionSnapshotSchema.parse(await idle.json()).state).toBe('idle')

    const oldPause = await request(harness.api, '/sessions/session-1/pause', {
      method: 'POST'
    })
    expect(oldPause.status).toBe(404)
    expect(normalizedErrorSchema.parse(await oldPause.json()).code).toBe(
      'session_not_found'
    )
  })

  test('keeps unavailable application failures normalized and secret-free', async () => {
    const profileReader = new InMemoryBackendProfileReader({
      name: '@advx/backend-bun',
      runtime: 'bun'
    })
    const app = createApp(
      { profileReader },
      { mode: 'production', system: systemOptions() }
    ).api

    const response = await request(app, '/runtime/sessions/missing')
    expect(response.status).toBe(503)
    const text = await response.text()
    expect(normalizedErrorSchema.parse(JSON.parse(text))).toMatchObject({
      code: 'runtime_persistence_unavailable',
      retryable: true
    })
    expect(text).not.toContain(RAW_CANARY)
  })
})

class TestRuntimeSpecRepository implements RuntimeSpecRepository {
  readonly records: RuntimeSpecRecord[]
  active: RuntimeSpecRecord

  constructor(initial: RuntimeSpecRecord) {
    this.records = [initial]
    this.active = initial
  }

  async getActive(_transaction: TransactionContext, _sessionId: SessionId) {
    return this.active
  }

  async getRevision(
    _transaction: TransactionContext,
    _sessionId: SessionId,
    revision: Revision
  ) {
    return this.records.find((record) => record.revision === revision) ?? null
  }

  async getByApplyId(
    _transaction: TransactionContext,
    _sessionId: SessionId,
    applyId: string
  ) {
    return this.records.find((record) => record.applyId === applyId) ?? null
  }

  async nextRevision(_transaction: TransactionContext, _sessionId: SessionId) {
    return Math.max(...this.records.map((record) => record.revision)) + 1
  }

  async addPending(_transaction: TransactionContext, record: RuntimeSpecRecord) {
    this.records.push(record)
  }

  async rejectPending(
    _transaction: TransactionContext,
    _sessionId: SessionId,
    revision: Revision,
    updatedAt: RuntimeSpecRecord['updatedAt']
  ) {
    const record = this.records.find((candidate) => candidate.revision === revision)
    if (record?.status === 'pending') {
      this.replace(record, { ...record, status: 'rejected', updatedAt })
    }
  }

  async prepareCommit(
    _transaction: TransactionContext,
    record: RuntimeSpecRecord,
    expectedActiveRevision: Revision,
    rolledBackRevision?: Revision
  ): Promise<RuntimeSpecCommitToken> {
    if (this.active.revision !== expectedActiveRevision) {
      throw new Error(RAW_CANARY)
    }
    return {
      record,
      commit: () => {
        const pending = this.records.find(
          (candidate) => candidate.revision === record.revision
        )
        if (pending === undefined) throw new Error(RAW_CANARY)
        this.replace(pending, record)
        if (rolledBackRevision !== undefined) {
          const rolledBack = this.records.find(
            (candidate) => candidate.revision === rolledBackRevision
          )
          if (rolledBack !== undefined) {
            this.replace(rolledBack, { ...rolledBack, status: 'rolled_back' })
          }
        }
        this.active = record
      }
    }
  }

  runtimeRevision(configRevision: Revision): Revision | null {
    if (this.active.configRevision === configRevision) return this.active.revision
    return this.records
      .filter(
        (record) =>
          record.configRevision === configRevision &&
          (record.status === 'committed' || record.status === 'rolled_back')
      )
      .sort((left, right) => right.revision - left.revision)[0]?.revision ?? null
  }

  rollbackTargetRevision(
    applyId: string,
    configRevision: Revision
  ): Revision | null {
    const existing = this.records.find((record) => record.applyId === applyId)
    if (
      existing?.operation === 'rollback' &&
      existing.rollbackTargetRevision !== null
    ) {
      const target = this.records.find(
        (record) => record.revision === existing.rollbackTargetRevision
      )
      if (target?.configRevision === configRevision) {
        return existing.rollbackTargetRevision
      }
    }
    return this.runtimeRevision(configRevision)
  }

  recover(record: RuntimeSpecRecord): void {
    this.replace(this.active, record)
    this.active = record
  }

  private replace(previous: RuntimeSpecRecord, next: RuntimeSpecRecord): void {
    this.records[this.records.indexOf(previous)] = next
  }
}

class TestKernelFactory implements RuntimeControlKernelFactory {
  lifecycleCount = 0
  readonly #repositories = new Map<SessionId, TestRuntimeSpecRepository>()
  readonly #kernels = new Map<SessionId, RuntimeControlKernel>()

  constructor(
    private readonly wallClock: { now(): ReturnType<typeof wallClockTimestampMs> }
  ) {}

  createLifecycle(roomId: RoomId): RoomSessionLifecycle {
    this.lifecycleCount += 1
    const sessionId = `session-${this.lifecycleCount}` as SessionId
    return new RoomSessionLifecycle({
      wallClock: this.wallClock,
      roomIds: { nextId: () => roomId },
      sessionIds: { nextId: () => sessionId },
      eventIds: { nextId: () => crypto.randomUUID() },
      createTaskScope: () => ({
        spawn: () => {
          throw new Error('not used by BCK-007')
        },
        cancelAll: () => {},
        drain: async () => {}
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
  }

  async createKernel(input: {
    lifecycle: RoomSessionLifecycle
    initial: RuntimeSpecRecord
  }): Promise<RuntimeControlKernel> {
    const repository = new TestRuntimeSpecRepository(input.initial)
    this.#repositories.set(input.initial.sessionId, repository)
    const kernel = this.#buildKernel(input.lifecycle, repository, input.initial)
    this.#kernels.set(input.initial.sessionId, kernel)
    return kernel
  }

  async prepareRecovery(input: {
    previous: RuntimeControlKernel
    recovered: RuntimeSpecRecord
  }) {
    const repository = this.#repository(input.recovered.sessionId)
    return {
      commit: (lifecycle: RoomSessionLifecycle) => {
        repository.recover(input.recovered)
        const kernel = this.#buildKernel(
          lifecycle,
          repository,
          input.recovered
        )
        this.#kernels.set(input.recovered.sessionId, kernel)
        return kernel
      },
      rollback: async () => {}
    }
  }

  async degrade(sessionId: SessionId): Promise<void> {
    const lifecycle = this.#kernel(sessionId).lifecycle
    const snapshot = lifecycle.snapshot
    if (snapshot.sessionId === null) throw new Error('session was not started')
    await lifecycle.degrade({
      roomId: snapshot.roomId,
      sessionId: snapshot.sessionId,
      audienceEpoch: snapshot.audienceEpoch,
      expectedRevision: snapshot.revision
    })
  }

  #buildKernel(
    lifecycle: RoomSessionLifecycle,
    repository: TestRuntimeSpecRepository,
    initial: RuntimeSpecRecord
  ): RuntimeControlKernel {
    let transactionId = 0
    const coordinator = new RuntimeSpecCoordinator({
      wallClock: this.wallClock,
      lifecycle,
      repository,
      initial,
      transactions: {
        run: async (work) =>
          await work(transactionContext(`control-tx-${++transactionId}`))
      },
      capabilityGate: { validate: async () => {} },
      observationWaves: { cutover: async (work) => await work() }
    })
    return {
      lifecycle,
      coordinator,
      runtimeRevisionForConfigRevision: async (revision) =>
        repository.runtimeRevision(revision),
      rollbackTargetRuntimeRevision: async (applyId, revision) =>
        repository.rollbackTargetRevision(applyId, revision)
    }
  }

  #repository(sessionId: SessionId): TestRuntimeSpecRepository {
    const repository = this.#repositories.get(sessionId)
    if (repository === undefined) throw new Error('repository missing')
    return repository
  }

  #kernel(sessionId: SessionId): RuntimeControlKernel {
    const kernel = this.#kernels.get(sessionId)
    if (kernel === undefined) throw new Error('kernel missing')
    return kernel
  }
}

function createHarness() {
  let now = 1_000
  const wallClock = { now: () => wallClockTimestampMs(now += 1) }
  const kernels = new TestKernelFactory(wallClock)
  const runtimeControl = new RuntimeControlService({ wallClock, kernels })
  const profileReader = new InMemoryBackendProfileReader({
    name: '@advx/backend-bun',
    runtime: 'bun'
  })
  const api = createApp(
    { profileReader, runtimeControl },
    { mode: 'production', system: systemOptions() }
  ).api
  return { api, kernels }
}

function systemOptions() {
  return {
    authorize: (authorization: string | null) =>
      authorization === `Bearer ${TOKEN}`,
    readiness: () => ({ contract: true, database: true, runtime: true }),
    backendVersion: '0.1.0',
    buildId: 'bck-007-test'
  }
}

function request(
  api: { handle(request: Request): Response | Promise<Response> },
  path: string,
  options: {
    method?: string
    body?: unknown
    version?: string | null
    headers?: Record<string, string>
  } = {}
) {
  const headers: Record<string, string> = {
    authorization: `Bearer ${TOKEN}`,
    ...(options.version === null
      ? {}
      : options.version === undefined
      ? { 'x-advx-protocol-version': '3' }
      : { 'x-advx-protocol-version': options.version }),
    ...options.headers
  }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  return api.handle(
    new Request(`http://localhost${path}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) })
    })
  )
}

async function startSession(
  api: { handle(request: Request): Response | Promise<Response> }
) {
  const response = await request(api, '/runtime/sessions', {
    method: 'POST',
    body: startRequest(runtimeSpec(1))
  })
  expect(response.status).toBe(201)
}

function startRequest(spec: CanonicalRuntimeSpec) {
  return {
    client_request_id: 'start-1',
    canonical_runtime_spec: spec,
    client_config_hash: canonicalSha256(spec)
  }
}

function runtimeSpec(configRevision: number): CanonicalRuntimeSpec {
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
    personas: [
      {
        persona_id: 'persona-1',
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
    ],
    modes: [
      {
        mode_id: 'mode-1',
        namespace_id: 'namespace-1',
        revision: 1,
        persona_counts: { 'persona-1': 1 },
        normal_response_range: { minimum: 0, maximum: 1 },
        highlight_response_range: { minimum: 0, maximum: 1 }
      }
    ],
    provider: {
      provider_profile_id: 'profile-1',
      viewer_model: 'viewer-model',
      memory_model: 'memory-model',
      visual_summary_model: 'vision-model'
    }
  }
}
