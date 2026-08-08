import {
  ADVX_HTTP_PROTOCOL_VERSION,
  ADVX_JSON_SCHEMA_DIALECT,
  ADVX_REALTIME_PROTOCOL_VERSION,
  ADVX_SCHEMA_PACKAGE_VERSION,
  ADVX_SUPPORTED_REALTIME_PROTOCOL_VERSIONS,
  ADVX_TRACE_SCHEMA_VERSION,
  SchemaParseError,
  aiCallStatusSchema,
  applyIdSchema,
  barrageEvidenceSourceSchema,
  barrageIdSchema,
  boundedListMetadataSchema,
  currentRealtimeProtocolVersionSchema,
  createSchemaRegistry,
  deadlineAtMsSchema,
  durationMsSchema,
  epochSchema,
  generationIdSchema,
  httpProtocolVersionSchema,
  httpOperationRegistry,
  httpOperations,
  HTTP_OPERATION_COUNT,
  canonicalRuntimeSpecSchema,
  canonicalSha256,
  sha256Hex,
  runtimeApplyRequestSchema,
  runtimeRollbackRequestSchema,
  replayRequestSchema,
  recordedProviderOutputSchema,
  normalizedErrorSchema,
  observationIdSchema,
  observationTriggerSchema,
  observationWaveStatusSchema,
  paginationMetadataSchema,
  personaIdSchema,
  positiveDurationMsSchema,
  positiveRevisionSchema,
  realtimeProtocolErrorCodeSchema,
  realtimeProtocolVersionSchema,
  revisionSchema,
  roomEventSourceSchema,
  roomIdSchema,
  schema,
  schemaPackageVersionSchema,
  sessionIdSchema,
  sessionStateSchema,
  timestampMsSchema,
  traceCorrelationMetadataSchema,
  traceResponseStatusSchema,
  traceSchemaVersionSchema,
  viewerIdSchema,
  viewerLifecycleStateSchema,
  CURRENT_PYTHON_WIRE_MESSAGE_COUNT,
  normalizeLegacyRealtimeMessage,
  pairedAudioTurnPayloadSchema,
  parseCanonicalRealtimeEnvelope,
  realtimeMessageRegistrations,
  realtimeMessageRegistry,
  type InferSchema
} from '../src/index'
import { readFileSync } from 'node:fs'
import {
  collectInvalidFixtureIssues,
  defineValidFixture
} from '@advx/contracts/fixtures'

let passed = 0

function test(name: string, run: () => void): void {
  try {
    run()
    passed += 1
  } catch (error) {
    throw new Error(`Test failed: ${name}`, { cause: error })
  }
}

function equal(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
  }
}

function throws(run: () => void, includes: string): void {
  try {
    run()
  } catch (error) {
    if (error instanceof Error && error.message.includes(includes)) return
    throw error
  }
  throw new Error(`Expected error containing "${includes}"`)
}

const messageSchema = schema.object({
  type: schema.literal('message'),
  id: schema.string({ minLength: 1 }),
  tags: schema.array(schema.string(), { maxItems: 2 }),
  target: schema.optional(
    schema.union([
      schema.object({ kind: schema.literal('viewer'), id: schema.string() }),
      schema.object({ kind: schema.literal('persona'), id: schema.string() })
    ])
  )
})

type Message = InferSchema<typeof messageSchema>

test('one declaration drives static type and runtime parsing', () => {
  const value: Message = { type: 'message', id: 'm-1', tags: ['one'] }
  equal(messageSchema.parse(value), value)
  equal(messageSchema.check(value), true)
})

test('strict objects reject unknown keys', () => {
  const result = messageSchema.safeParse({
    type: 'message',
    id: 'm-1',
    tags: [],
    secret: 'not-public'
  })
  equal(result.success, false)
  if (!result.success) equal(result.issues[0]?.path, ['secret'])
})

test('strict objects use own properties for declarations and input values', () => {
  const identifierSchema = schema.object({ id: schema.string() })

  for (const key of ['toString', 'constructor', '__proto__']) {
    const value = { id: 'm-1' } as Record<string, unknown>
    Object.defineProperty(value, key, {
      value: 'not-declared',
      enumerable: true
    })
    const result = identifierSchema.safeParse(value)
    equal(result.success, false)
    if (!result.success) {
      equal(result.issues, [{ path: [key], message: 'Unknown object key' }])
    }
  }

  const inheritedIdentifier = Object.create({ id: 'inherited' }) as Record<
    string,
    unknown
  >
  const result = identifierSchema.safeParse(inheritedIdentifier)
  equal(result.success, false)
  if (!result.success) {
    equal(result.issues, [{ path: ['id'], message: 'Required value is missing' }])
  }
})

test('nested optional union and array validation share paths', () => {
  const issues = collectInvalidFixtureIssues(messageSchema, {
    type: 'message',
    id: 'm-1',
    tags: ['one', 'two', 'three'],
    target: { kind: 'viewer', id: 3 }
  })
  equal(issues.map((issue) => issue.path), [['tags'], ['target']])
})

test('parse throws a stable path-aware error', () => {
  try {
    messageSchema.parse({ type: 'message', id: '', tags: [] })
  } catch (error) {
    if (!(error instanceof SchemaParseError)) throw error
    equal(error.issues[0]?.path, ['id'])
    throws(() => {
      throw error
    }, '$.id')
    return
  }
  throw new Error('Expected parse to fail')
})

test('JSON Schema output is stable and strict', () => {
  equal(messageSchema.jsonSchema, {
    type: 'object',
    properties: {
      type: { const: 'message' },
      id: { type: 'string', minLength: 1 },
      tags: { type: 'array', items: { type: 'string' }, maxItems: 2 },
      target: {
        oneOf: [
          {
            type: 'object',
            properties: { kind: { const: 'viewer' }, id: { type: 'string' } },
            required: ['kind', 'id'],
            additionalProperties: false
          },
          {
            type: 'object',
            properties: { kind: { const: 'persona' }, id: { type: 'string' } },
            required: ['kind', 'id'],
            additionalProperties: false
          }
        ]
      }
    },
    required: ['type', 'id', 'tags'],
    additionalProperties: false
  })
})

test('registry output and references are deterministic', () => {
  const registry = createSchemaRegistry([
    ['Message', messageSchema],
    ['Identifier', schema.string({ minLength: 1 })]
  ])
  equal(Object.keys(registry.toJsonSchemaDocument().$defs), ['Identifier', 'Message'])
  equal(registry.toJsonSchemaDocument().$schema, ADVX_JSON_SCHEMA_DIALECT)
  equal(registry.jsonSchemaReference('Message'), { $ref: '#/$defs/Message' })
  equal(registry.openApiReference('Message'), {
    $ref: '#/components/schemas/Message'
  })
  equal(Object.keys(registry.toOpenApiComponents().schemas), ['Identifier', 'Message'])
})

test('registry rejects duplicate names', () => {
  throws(
    () =>
      createSchemaRegistry([
        ['Message', messageSchema],
        ['Message', messageSchema]
      ]),
    'already registered'
  )
})

test('fixture helpers stay usable through the fixture subpath', () => {
  equal(defineValidFixture(messageSchema, {
    type: 'message',
    id: 'fixture',
    tags: []
  }).id, 'fixture')
  equal(ADVX_SCHEMA_PACKAGE_VERSION, 1)
})

const commonContractFixtureSchema = schema.object({
  room_id: roomIdSchema,
  session_id: sessionIdSchema,
  viewer_id: viewerIdSchema,
  persona_id: personaIdSchema,
  observation_id: observationIdSchema,
  generation_id: generationIdSchema,
  barrage_id: barrageIdSchema,
  apply_id: applyIdSchema,
  revision: positiveRevisionSchema,
  audience_epoch: epochSchema,
  created_at_ms: timestampMsSchema,
  deadline_at_ms: deadlineAtMsSchema,
  room_source: roomEventSourceSchema,
  evidence_source: barrageEvidenceSourceSchema,
  observation_source: observationTriggerSchema,
  session_state: sessionStateSchema,
  viewer_state: viewerLifecycleStateSchema,
  trace_status: traceResponseStatusSchema,
  observation_status: observationWaveStatusSchema,
  protocol_error: realtimeProtocolErrorCodeSchema,
  error: normalizedErrorSchema,
  pagination: paginationMetadataSchema,
  bounded: boundedListMetadataSchema,
  trace: traceCorrelationMetadataSchema
})

test('common scalar, enum, error, and metadata fixture round trips', () => {
  const fixture: InferSchema<typeof commonContractFixtureSchema> = {
    room_id: 'room-1',
    session_id: 'session-1',
    viewer_id: 'viewer-1',
    persona_id: 'persona-1',
    observation_id: 'observation-1',
    generation_id: 'generation-1',
    barrage_id: 'barrage-1',
    apply_id: 'apply-1',
    revision: 1,
    audience_epoch: 1,
    created_at_ms: 0,
    deadline_at_ms: 1,
    room_source: 'user_text',
    evidence_source: 'event',
    observation_source: 'screen_change',
    session_state: 'running',
    viewer_state: 'active',
    trace_status: 'published',
    observation_status: 'completed',
    protocol_error: 'version_mismatch',
    error: { code: 'provider_timeout', retryable: true, safe_detail: 'timed out' },
    pagination: { cursor: null, next_cursor: 'next', limit: 100 },
    bounded: { count: 2, limit: 32, truncated: false, total: 2 },
    trace: {
      trace_id: 'trace-1',
      correlation_id: 'correlation-1',
      started_at_ms: 0,
      elapsed_ms: 1
    }
  }
  equal(commonContractFixtureSchema.parse(fixture), fixture)
})

test('common identifiers and numeric scalar bounds are enforced', () => {
  equal(roomIdSchema.check(''), false)
  equal(applyIdSchema.check('x'.repeat(129)), false)
  equal(timestampMsSchema.check(-1), false)
  equal(durationMsSchema.check(0), true)
  equal(positiveDurationMsSchema.check(0), false)
  equal(revisionSchema.check(0), true)
  equal(positiveRevisionSchema.check(0), false)
  equal(epochSchema.check(0), false)
  equal(deadlineAtMsSchema.check(0), false)
})

test('protocol and schema version authorities are exact', () => {
  equal(ADVX_HTTP_PROTOCOL_VERSION, 3)
  equal(ADVX_REALTIME_PROTOCOL_VERSION, 4)
  equal(ADVX_SUPPORTED_REALTIME_PROTOCOL_VERSIONS, [3, 4])
  equal(ADVX_TRACE_SCHEMA_VERSION, 1)
  equal(httpProtocolVersionSchema.check(3), true)
  equal(httpProtocolVersionSchema.check(4), false)
  equal(realtimeProtocolVersionSchema.check(3), true)
  equal(realtimeProtocolVersionSchema.check(4), true)
  equal(realtimeProtocolVersionSchema.check(2), false)
  equal(currentRealtimeProtocolVersionSchema.check(3), false)
  equal(schemaPackageVersionSchema.check(1), true)
  equal(traceSchemaVersionSchema.check(2), false)
})

test('ported enums reject values outside the Python authority', () => {
  equal(roomEventSourceSchema.check('user_text'), true)
  equal(roomEventSourceSchema.check('user_audio'), false)
  equal(observationTriggerSchema.check('ambient_tick'), true)
  equal(observationWaveStatusSchema.check('running'), false)
  equal(realtimeProtocolErrorCodeSchema.check('raw_exception'), false)
})

test('AI call statuses match the retained Python authority exactly', () => {
  const expected = [
    'preparing',
    'sent',
    'streaming',
    'received',
    'succeeded',
    'failed',
    'blocked',
    'cancelled',
    'interrupted'
  ]
  equal(aiCallStatusSchema.jsonSchema.enum, expected)
  equal(expected.filter((status) => aiCallStatusSchema.check(status)), expected)
  equal(aiCallStatusSchema.check('unknown'), false)
})

test('normalized errors expose only bounded sanitized detail', () => {
  equal(
    normalizedErrorSchema.check({ code: 'timeout', retryable: true }),
    true
  )
  equal(
    normalizedErrorSchema.check({
      code: 'timeout',
      retryable: true,
      safe_detail: 'x'.repeat(257)
    }),
    false
  )
  equal(
    normalizedErrorSchema.check({
      code: 'timeout',
      retryable: false,
      raw_payload: { token: 'secret' }
    }),
    false
  )
})

test('pagination, bounded-list, and trace metadata enforce limits', () => {
  equal(paginationMetadataSchema.check({ limit: 1001 }), false)
  equal(
    boundedListMetadataSchema.check({ count: -1, limit: 1, truncated: false }),
    false
  )
  equal(
    traceCorrelationMetadataSchema.check({
      trace_id: 'trace-1',
      correlation_id: '',
      started_at_ms: 0
    }),
    false
  )
  equal(
    traceCorrelationMetadataSchema.check({
      trace_id: 'trace-1',
      correlation_id: 'correlation-1',
      started_at_ms: 0
    }),
    true
  )
})

test('record, refinement, and bounded safe JSON support nested control contracts', () => {
  const refined = schema.refine(
    schema.object({ lower: schema.integer(), upper: schema.integer() }),
    (value) => value.lower <= value.upper,
    'ordered range'
  )
  equal(refined.check({ lower: 1, upper: 2 }), true)
  equal(refined.check({ lower: 2, upper: 1 }), false)
  equal(schema.record(schema.integer(), { maxProperties: 1 }).check({ one: 1 }), true)
  equal(
    schema.record(schema.integer(), { maxProperties: 1 }).check({ one: 1, two: 2 }),
    false
  )
  const safe = schema.safeJson({ maxDepth: 3 })
  equal(safe.check({ nested: { value: ['ok', 1, true, null] } }), true)
  equal(safe.check({ nested: { model_api_key: 'secret' } }), false)
  equal(safe.check({ raw_audio: 'base64' }), false)
})

const expectedHttpBindings = [
  'DELETE /shared-brain/rooms/{room_id}/memories/{memory_id}',
  'GET /configuration/providers',
  'GET /configuration/providers/models',
  'GET /debug/ai-calls',
  'GET /debug/ai-calls/{call_id}',
  'GET /debug/ai-calls/images/{preview_id}',
  'GET /debug/runtime/{session_id}',
  'GET /debug/traces',
  'GET /health',
  'GET /runtime/sessions/{session_id}',
  'GET /runtime/sessions/{session_id}/audience',
  'GET /sessions/current',
  'GET /shared-brain/modes/{namespace_id}/auto-ingest',
  'GET /shared-brain/modes/{namespace_id}/meme-candidates/pending',
  'GET /shared-brain/modes/{namespace_id}/memes',
  'GET /shared-brain/modes/{namespace_id}/memes/active',
  'GET /shared-brain/rooms/{room_id}/memories',
  'GET /shared-brain/rooms/{room_id}/memories/{memory_id}',
  'GET /shared-brain/rooms/{room_id}/memory-head',
  'POST /configuration/providers/probe',
  'POST /debug/replay',
  'POST /debug/traces/export',
  'POST /runtime/sessions',
  'POST /runtime/sessions/{session_id}/apply',
  'POST /runtime/sessions/{session_id}/recover',
  'POST /runtime/sessions/{session_id}/rollback',
  'POST /runtime/sessions/{session_id}/viewers/{viewer_id}/kick',
  'POST /runtime/sessions/{session_id}/viewers/{viewer_id}/mute',
  'POST /runtime/sessions/{session_id}/viewers/{viewer_id}/unmute',
  'POST /sessions',
  'POST /sessions/{session_id}/pause',
  'POST /sessions/{session_id}/resume',
  'POST /sessions/{session_id}/stop',
  'POST /shared-brain/meme-candidates',
  'POST /shared-brain/memory-candidates',
  'POST /shared-brain/modes/{namespace_id}/legacy-memes/import',
  'POST /shared-brain/modes/{namespace_id}/meme-candidates/{candidate_id}/approve',
  'POST /shared-brain/modes/{namespace_id}/meme-candidates/{candidate_id}/reject',
  'POST /shared-brain/modes/{namespace_id}/memes/maintenance',
  'POST /shared-brain/rooms/{room_id}/memories/{memory_id}/merge',
  'POST /shared-brain/rooms/{room_id}/memories/{memory_id}/replace',
  'POST /shared-brain/rooms/{room_id}/memories/{memory_id}/revoke',
  'POST /shared-brain/rooms/{room_id}/memories/reset',
  'PUT /configuration/providers',
  'PUT /shared-brain/modes/{namespace_id}/auto-ingest',
  'PUT /shared-brain/modes/{namespace_id}/memes/{meme_id}',
  'PUT /shared-brain/rooms/{room_id}/memories/{memory_id}'
].sort()

test('operation registry covers the accepted 47 HTTP method/path bindings exactly', () => {
  equal(HTTP_OPERATION_COUNT, 47)
  equal(httpOperations.length, 47)
  equal(Object.keys(httpOperationRegistry).sort(), expectedHttpBindings)
  equal(new Set(httpOperations.map((entry) => entry.operationId)).size, 47)
})

test('every HTTP operation records schemas, statuses, and normalized errors', () => {
  for (const operation of httpOperations) {
    equal(operation.pathParams.check({}), !operation.path.includes('{'))
    if (operation.path.includes('{')) equal(operation.pathParams.check({}), false)
    equal(Object.keys(operation.responses).length > 0, true)
    equal(Object.keys(operation.responses).some((status) => {
      const value = Number(status)
      return Number.isInteger(value) && value >= 200 && value < 300
    }), true)
    equal(operation.errors.length > 0, true)
    for (const entry of operation.errors) {
      equal(Number.isInteger(entry.status) && entry.status >= 400, true)
      equal(entry.code.length > 0, true)
      equal(typeof entry.retryable, 'boolean')
    }
  }
  const legacyStart = httpOperationRegistry['POST /sessions']
  equal(legacyStart?.responses[200]?.check(null), true)
  equal(legacyStart?.responses[200]?.check({}), false)
})

function collectJsonSchemaPropertyNames(value: unknown, output = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const child of value) collectJsonSchemaPropertyNames(child, output)
    return output
  }
  if (typeof value !== 'object' || value === null) return output
  const object = value as Record<string, unknown>
  const properties = object.properties
  if (typeof properties === 'object' && properties !== null) {
    for (const key of Object.keys(properties)) output.add(key)
  }
  for (const child of Object.values(object)) collectJsonSchemaPropertyNames(child, output)
  return output
}

test('public HTTP schemas never declare credential or raw media fields', () => {
  const names = new Set<string>()
  for (const operation of httpOperations) {
    collectJsonSchemaPropertyNames(operation.pathParams.jsonSchema, names)
    collectJsonSchemaPropertyNames(operation.query.jsonSchema, names)
    if (operation.body?.kind === 'public') {
      collectJsonSchemaPropertyNames(operation.body.schema.jsonSchema, names)
    }
    for (const response of Object.values(operation.responses)) {
      collectJsonSchemaPropertyNames(response.jsonSchema, names)
    }
  }
  for (const forbidden of [
    'model_api_key',
    'asr_api_key',
    'api_key',
    'credentials',
    'raw_image',
    'raw_audio',
    'data_url'
  ]) {
    equal(names.has(forbidden), false)
  }
  const setup = httpOperationRegistry['PUT /configuration/providers']?.body
  equal(setup?.kind, 'controlled-secret-boundary')
  if (setup?.kind === 'controlled-secret-boundary') {
    equal(setup.serializablePublicContract, false)
    equal(setup.publicMetadataSchema.check({
      model_base_url: 'https://example.test/v1',
      model_name: 'model',
      model_api_key: 'secret'
    }), false)
  }
  const probe = httpOperationRegistry['POST /configuration/providers/probe']?.body
  equal(probe?.kind, 'controlled-secret-boundary')
  if (probe?.kind === 'controlled-secret-boundary') {
    equal(probe.serializablePublicContract, false)
    equal(probe.publicMetadataSchema.check({ provider_profile_id: 'profile-1' }), true)
    for (const forbidden of [
      { model_api_key: 'secret' },
      { raw_audio: 'base64' },
      { messages: [{ role: 'user', content: 'wire payload' }] }
    ]) {
      equal(probe.publicMetadataSchema.check(forbidden), false)
    }
  }
})

const canonicalRuntimeSpecFixture = {
  protocol_version: 3,
  audience_contract_version: 3,
  config_revision: 1,
  room: {
    room_id: 'room-1',
    display_name: 'Room',
    created_at_ms: 1,
    updated_at_ms: 1
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
} as const
const runtimeConfigHash = canonicalSha256(canonicalRuntimeSpecFixture)

test('runtime spec and apply/rollback schemas enforce references and secret-free inputs', () => {
  equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
  )
  equal(canonicalRuntimeSpecSchema.check(canonicalRuntimeSpecFixture), true)
  equal(
    canonicalRuntimeSpecSchema.check({
      ...canonicalRuntimeSpecFixture,
      active_mode_id: 'missing'
    }),
    false
  )
  equal(
    runtimeApplyRequestSchema.check({
      apply_id: 'apply-1',
      base_revision: 0,
      audience_contract_version: 3,
      canonical_runtime_spec: canonicalRuntimeSpecFixture,
      client_config_hash: 'b'.repeat(64),
      provider_candidate: {
        provider_profile_id: 'profile-1',
        model_api_key: 'secret'
      }
    }),
    false
  )
  equal(
    runtimeApplyRequestSchema.check({
      apply_id: 'apply-1',
      base_revision: 0,
      audience_contract_version: 3,
      canonical_runtime_spec: canonicalRuntimeSpecFixture,
      client_config_hash: runtimeConfigHash,
      provider_candidate: { provider_profile_id: 'profile-1' }
    }),
    true
  )
  equal(
    runtimeRollbackRequestSchema.check({
      apply_id: 'apply-1',
      base_revision: 2,
      target_revision: 1,
      audience_contract_version: 3
    }),
    true
  )
  equal(
    runtimeRollbackRequestSchema.check({
      apply_id: 'apply-1',
      base_revision: 1,
      target_revision: 1,
      audience_contract_version: 3
    }),
    false
  )
})

const replayBundleFixture = {
  replay_schema_version: 1,
  protocol_version: 3,
  audience_contract_version: 3,
  bundle_id: 'bundle-1',
  created_at_ms: 1,
  seed: 1,
  virtual_clock_start_ms: 1,
  config_hash: runtimeConfigHash,
  canonical_runtime_spec: canonicalRuntimeSpecFixture,
  events: [
    {
      sequence: 1,
      event_type: 'viewer.completed',
      occurred_at_ms: 1,
      payload: { generation_request_id: 'generation-1' }
    }
  ],
  recorded_provider_outputs: [
    {
      generation_request_id: 'generation-1',
      provider_role: 'viewer',
      output: { action: 'respond', text: 'hello' }
    }
  ],
  redacted: true
} as const

test('replay contracts enforce redaction, Provider whitelists, correlation, and live opt-in', () => {
  equal(
    replayRequestSchema.check({ mode: 'recorded', bundle: replayBundleFixture }),
    true
  )
  equal(
    replayRequestSchema.check({
      mode: 'recorded',
      bundle: replayBundleFixture,
      allow_external_provider_calls: true
    }),
    false
  )
  equal(
    replayRequestSchema.check({
      mode: 'live',
      bundle: replayBundleFixture,
      allow_external_provider_calls: true
    }),
    true
  )
  equal(
    replayRequestSchema.check({
      mode: 'recorded',
      bundle: {
        ...replayBundleFixture,
        events: [
          {
            ...replayBundleFixture.events[0],
            payload: { generation_request_id: 'other' }
          }
        ]
      }
    }),
    false
  )
  equal(
    recordedProviderOutputSchema.check({
      generation_request_id: 'generation-1',
      provider_role: 'viewer',
      output: { raw_audio: 'base64' }
    }),
    false
  )
})

test('CON-005 accepts and normalizes all 19 current Python wire families', () => {
  const fixture = JSON.parse(
    readFileSync(new URL('./fixtures/realtime-python-v4.json', import.meta.url), 'utf8')
  ) as {
    messages: Array<{
      wire: unknown
      context: Parameters<typeof normalizeLegacyRealtimeMessage>[1]
    }>
  }
  equal(fixture.messages.length, CURRENT_PYTHON_WIRE_MESSAGE_COUNT)
  const types = new Set<string>()
  for (const entry of fixture.messages) {
    const canonical = normalizeLegacyRealtimeMessage(entry.wire, entry.context)
    types.add(canonical.message_type)
    equal(parseCanonicalRealtimeEnvelope(JSON.parse(JSON.stringify(canonical))), canonical)
  }
  equal(types.size, CURRENT_PYTHON_WIRE_MESSAGE_COUNT)
  equal(realtimeMessageRegistrations.filter((entry) => entry.currentPythonWire).length, 19)
})

test('CON-005 canonical envelopes reject unknown, secret, and invalid scope fields', () => {
  equal(realtimeMessageRegistry['client.hello'].schema.check({
    protocol_version: 4,
    message_type: 'client.hello',
    message_id: 'message-1',
    created_at_ms: 1,
    payload: { token: 'secret' }
  }), false)
  equal(realtimeMessageRegistry['client.text.submit'].schema.check({
    protocol_version: 4,
    message_type: 'client.text.submit',
    message_id: 'message-2',
    room_id: 'room-1',
    session_id: 'session-1',
    created_at_ms: 1,
    payload: { input_id: 'input-1', text: 'hello' }
  }), false)
  equal(realtimeMessageRegistry['backend.shutdown'].schema.check({
    protocol_version: 4,
    message_type: 'backend.shutdown',
    message_id: 'message-3',
    created_at_ms: 1,
    payload: { reason: 'requested' },
    raw_audio: 'forbidden'
  }), false)
})

test('CON-005 paired audio state persists a late final without a second wave', () => {
  const lateFinal = {
    turn_id: 'turn-1',
    microphone_final_id: 'mic-final-1',
    system_audio_final_id: 'system-final-1',
    system_audio_required: true,
    system_audio_degraded: true,
    observation_trigger: {
      trigger_id: 'turn-1',
      idempotency_key: 'turn-1',
      observation_id: 'observation-1',
      authorized_by: 'microphone_final'
    },
    late_system_audio_final: {
      input_id: 'system-final-1',
      persisted_at_ms: 10,
      authorizes_observation_wave: false
    }
  } as const
  equal(pairedAudioTurnPayloadSchema.check(lateFinal), true)
  equal(pairedAudioTurnPayloadSchema.check({
    ...lateFinal,
    observation_trigger: {
      ...lateFinal.observation_trigger,
      trigger_id: 'turn-2',
      idempotency_key: 'turn-2'
    }
  }), false)
  equal(pairedAudioTurnPayloadSchema.check({
    ...lateFinal,
    late_system_audio_final: {
      ...lateFinal.late_system_audio_final,
      authorizes_observation_wave: true
    }
  }), false)
  equal(pairedAudioTurnPayloadSchema.check({
    ...lateFinal,
    observation_trigger: {
      ...lateFinal.observation_trigger,
      idempotency_key: 'second-trigger'
    }
  }), false)
})

console.log(JSON.stringify({ status: 'passed', tests: passed }))
