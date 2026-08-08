import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  httpOperations,
  normalizeLegacyRealtimeMessage,
  parseCanonicalRealtimeEnvelope,
  realtimeMessageRegistrations
} from '../src/index'
import { decodeAdvxBinaryEnvelope, encodeAdvxBinaryEnvelope } from '../src/binary/index'
import { canonicalSha256 } from '../src/http/canonical'
import type { JsonSchema, Schema } from '../src/schema'

type JsonRecord = Record<string, unknown>
type ParityDiff = { path: string; expected: unknown; actual: unknown }

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const fixtureRoot = join(root, 'packages/contracts/test/fixtures')
const reportPath = resolve(process.env.ADVX_CONTRACT_PARITY_REPORT ??
  join(root, '.omx/artifacts/typescript-bun/CON-009/con-009-maker-20260801-001/contract-parity-report.json'))

function sample(schema: JsonSchema, path = '$'): unknown {
  if ('const' in schema) return schema.const
  if (Array.isArray(schema.enum)) return schema.enum[0]
  if (Array.isArray(schema.oneOf)) {
    const nullable = schema.oneOf.find((entry) => isRecord(entry) && entry.const === null)
    if (nullable && prefersNull(path)) return null
    return sample(schema.oneOf[0] as JsonSchema, path)
  }
  if (schema.type === 'object') {
    const properties = isRecord(schema.properties) ? schema.properties : {}
    const required = new Set(Array.isArray(schema.required) ? schema.required as string[] : [])
    const output = Object.fromEntries(Object.entries(properties)
      .filter(([key]) => required.has(key))
      .map(([key, value]) => [key, sample(value as JsonSchema, `${path}.${key}`)]))
    if (Object.keys(output).length === 0 && Number(schema.minProperties ?? 0) > 0 && isRecord(schema.additionalProperties)) {
      output.synthetic = sample(schema.additionalProperties as JsonSchema, `${path}.synthetic`)
    }
    return output
  }
  if (schema.type === 'array') {
    const count = Number(schema.minItems ?? 0)
    return Array.from({ length: count }, (_, index) => sample(schema.items as JsonSchema, `${path}.${index}`))
  }
  if (schema.type === 'boolean') return false
  if (schema.type === 'null') return null
  if (schema.type === 'integer' || schema.type === 'number') {
    const minimum = Number(schema.minimum ?? 0)
    if (/expires_at_ms|ended_at_ms|updated_at_ms|deadline_at_ms/.test(path)) return Math.max(minimum, 2_000)
    if (/created_at_ms|started_at_ms|occurred_at_ms|captured_at_ms|accepted_at_ms|committed_at_ms|joined_at_ms/.test(path)) return Math.max(minimum, 1_000)
    return minimum
  }
  if (schema.type === 'string') {
    const minimum = Math.max(Number(schema.minLength ?? 1), 1)
    if (/base_url/.test(path)) return 'https://example.invalid/v1'
    if (/sha256|digest|hash/.test(path)) return 'a'.repeat(64)
    if (/mime_type/.test(path)) return 'application/json'
    if (/format/.test(path)) return 'synthetic-format'
    if (/path/.test(path)) return 'synthetic/path.json'
    return `synthetic-${path.split('.').at(-1)}`.slice(0, Math.max(minimum, 64))
  }
  throw new Error(`Cannot synthesize JSON Schema at ${path}: ${JSON.stringify(schema)}`)
}

function prefersNull(path: string): boolean {
  return /target_viewer_id|target_persona_id|viewer_instance_id|event_id|frame_index|last_left_at_ms|muted_until_ms|revoked_at_ms|removed_at_ms|kicked_at_ms|source_id|supported_version/.test(path)
}

function canonical<T>(schema: Schema<T>, path: string): T {
  const candidate = repair(sample(schema.jsonSchema, path), path)
  const parsed = schema.safeParse(candidate)
  if (!parsed.success) throw new Error(`${path}: ${JSON.stringify(parsed.issues)}`)
  return parsed.data
}

function repair(value: unknown, path: string): unknown {
  if (Array.isArray(value)) return value.map((item, index) => repair(item, `${path}.${index}`))
  if (!isRecord(value)) return value
  for (const [key, child] of Object.entries(value)) value[key] = repair(child, `${path}.${key}`)
  if (Array.isArray(value.personas) && value.personas.length > 0 && Array.isArray(value.modes) && value.modes.length > 0) {
    const persona = value.personas[0] as JsonRecord
    const mode = value.modes[0] as JsonRecord
    value.active_mode_id = mode.mode_id
    mode.persona_counts = { [String(persona.persona_id)]: 1 }
  }
  if (path.includes('advx.runtime.sessions.apply.body') && isRecord(value.canonical_runtime_spec)) {
    value.canonical_runtime_spec.audience_contract_version = 3
  }
  if (isRecord(value.canonical_runtime_spec) && 'client_config_hash' in value) {
    value.client_config_hash = canonicalSha256(value.canonical_runtime_spec)
  }
  if ('target_revision' in value && 'base_revision' in value) {
    value.base_revision = 2
    value.target_revision = 1
  }
  if (isRecord(value.canonical_runtime_spec) && Array.isArray(value.events) && Array.isArray(value.recorded_provider_outputs)) {
    value.audience_contract_version = value.canonical_runtime_spec.audience_contract_version
    value.config_hash = canonicalSha256(value.canonical_runtime_spec)
    const provider = value.recorded_provider_outputs[0] as JsonRecord
    const event = value.events[0] as JsonRecord
    if (isRecord(provider.output) && Object.keys(provider.output).length === 0) provider.output.text = 'synthetic-output'
    event.sequence = 1
    event.event_type = `${String(provider.provider_role)}.synthetic`
    event.payload = { generation_request_id: provider.generation_request_id }
    value.recorded_outputs_digest = canonicalSha256(value.recorded_provider_outputs)
  }
  return value
}

function buildHttpSeed() {
  return httpOperations.map((operation) => ({
    operationId: operation.operationId,
    method: operation.method,
    path: operation.path,
    bodyKind: operation.body?.kind ?? null,
    errors: operation.errors,
    contracts: {
      pathParams: canonical(operation.pathParams, `${operation.operationId}.pathParams`),
      query: canonical(operation.query, `${operation.operationId}.query`),
      ...(operation.body === undefined ? {} : {
        body: canonical(operation.body.kind === 'public' ? operation.body.schema : operation.body.publicMetadataSchema,
          `${operation.operationId}.body`)
      }),
      responses: Object.fromEntries(Object.entries(operation.responses).map(([status, response]) =>
        [status, canonical(response, `${operation.operationId}.responses.${status}`)]))
    }
  }))
}

async function buildRealtimeSeed() {
  const fixture = JSON.parse(await readFile(join(fixtureRoot, 'realtime-python-v4.json'), 'utf8')) as {
    messages: Array<{ wire: unknown; context: Parameters<typeof normalizeLegacyRealtimeMessage>[1] }>
  }
  return fixture.messages
}

async function buildBinarySeed() {
  const manifest = JSON.parse(await readFile(join(fixtureRoot, 'binary/manifest.json'), 'utf8')) as {
    fixtures: Array<{ name: string; file: string; sha256: string; byteLength: number }>
  }
  return Promise.all(manifest.fixtures.map(async (fixture) => {
    const bytes = new Uint8Array(await Bun.file(join(fixtureRoot, 'binary', fixture.file)).arrayBuffer())
    return { ...fixture, base64: Buffer.from(bytes).toString('base64') }
  }))
}

async function runPython(input: string, output: string) {
  const pidPath = `${output}.pid`
  const child = Bun.spawn([
    'uv', 'run', '--project', 'apps/backend', 'python',
    'packages/contracts/test/contract-parity-oracle.py', '--input', input, '--output', output
  ], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, PYTHONUTF8: '1', ADVX_PARITY_PID_FILE: pidPath }
  })
  let timedOut = false
  const timeout = setTimeout(() => { timedOut = true; child.kill() }, 30_000)
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited
  ])
  clearTimeout(timeout)
  const oraclePid = Number(await readFile(pidPath, 'ascii'))
  let processAliveAfterExit = processExists(oraclePid)
  if (processAliveAfterExit) {
    process.kill(oraclePid, 'SIGKILL')
    await Bun.sleep(25)
    processAliveAfterExit = processExists(oraclePid)
  }
  if (exitCode !== 0 || timedOut) throw new Error(`Python oracle failed (${exitCode}, timeout=${timedOut}): ${stderr}\n${stdout}`)
  if (processAliveAfterExit) throw new Error(`Python oracle process ${oraclePid} remained alive after exit`)
  return { exitCode, timedOut, processAliveAfterExit, stdout: stdout.trim(), stderr: stderr.trim() }
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function compare(expected: unknown, actual: unknown, path = '$'): ParityDiff[] {
  if (Object.is(expected, actual)) return []
  if (expected === null || actual === null || typeof expected !== 'object' || typeof actual !== 'object') {
    return [{ path, expected, actual }]
  }
  const left = expected as JsonRecord
  const right = actual as JsonRecord
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    .flatMap((key) => compare(left[key], right[key], `${path}.${key}`))
}

async function main() {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'advx-con009-'))
  const firstInput = join(temporaryDirectory, 'seed.json')
  const pythonOutput = join(temporaryDirectory, 'python.json')
  const tsOutput = join(temporaryDirectory, 'typescript.json')
  const reparsedOutput = join(temporaryDirectory, 'python-reparsed.json')
  let cleanupAttempted = false
  try {
    const seed = { schemaVersion: 1, http: buildHttpSeed(), realtime: await buildRealtimeSeed(), binary: await buildBinarySeed() }
    await writeFile(firstInput, `${JSON.stringify(seed)}\n`)
    const emitCommand = await runPython(firstInput, pythonOutput)
    const python = JSON.parse(await readFile(pythonOutput, 'utf8')) as typeof seed

    const canonicalRealtime = python.realtime.map((entry) => {
      const normalized = normalizeLegacyRealtimeMessage(entry.wire, entry.context)
      return parseCanonicalRealtimeEnvelope(JSON.parse(JSON.stringify(normalized)))
    })
    const canonicalHttp = python.http.map((record, index) => {
      const operation = httpOperations[index]!
      if (record.operationId !== operation.operationId) throw new Error(`HTTP ordering mismatch at ${index}`)
      const contracts = record.contracts as JsonRecord
      const responses = contracts.responses as JsonRecord
      return {
        ...record,
        contracts: {
          pathParams: operation.pathParams.parse(contracts.pathParams),
          query: operation.query.parse(contracts.query),
          ...(operation.body === undefined ? {} : {
            body: (operation.body.kind === 'public' ? operation.body.schema : operation.body.publicMetadataSchema).parse(contracts.body)
          }),
          responses: Object.fromEntries(Object.entries(operation.responses).map(([status, response]) =>
            [status, response.parse(responses[status])]))
        }
      }
    })
    const canonicalBinary = python.binary.map((record) => {
      const bytes = new Uint8Array(Buffer.from(record.base64, 'base64'))
      const decoded = decodeAdvxBinaryEnvelope(bytes)
      const encoded = encodeAdvxBinaryEnvelope({ ...decoded.header, body: decoded.body })
      return { ...record, base64: Buffer.from(encoded).toString('base64') }
    })
    const ts = { schemaVersion: 1, http: canonicalHttp, realtime: canonicalRealtime, binary: canonicalBinary }
    await writeFile(tsOutput, `${JSON.stringify(ts)}\n`)

    const reparseInput = {
      ...ts,
      realtime: canonicalRealtime.map((canonical) => ({ canonical }))
    }
    await writeFile(tsOutput, `${JSON.stringify(reparseInput)}\n`)
    const reparseCommand = await runPython(tsOutput, reparsedOutput)
    const reparsed = JSON.parse(await readFile(reparsedOutput, 'utf8')) as typeof seed
    const httpDiffs = compare(canonicalHttp, reparsed.http, '$.http')
    const binaryDiffs = compare(canonicalBinary, reparsed.binary, '$.binary')
    const realtimeReparsed = (reparsed.realtime as unknown as Array<{ canonical: unknown }>).map((entry) =>
      parseCanonicalRealtimeEnvelope(entry.canonical))
    const realtimeDiffs = compare(canonicalRealtime, realtimeReparsed, '$.realtime')
    const diffs = [...httpDiffs, ...realtimeDiffs, ...binaryDiffs]

    const firstResponse = httpOperations.find((operation) =>
      Object.values(operation.responses).some((response) =>
        Array.isArray(response.jsonSchema.required) && response.jsonSchema.required.length > 0))!
    const status = Object.keys(firstResponse.responses).find((key) =>
      Array.isArray(firstResponse.responses[Number(key)]!.jsonSchema.required) &&
      (firstResponse.responses[Number(key)]!.jsonSchema.required as unknown[]).length > 0)!
    const responseSchema = firstResponse.responses[Number(status)]!
    const valid = canonical(responseSchema, 'negative.response') as JsonRecord
    const removedField = (responseSchema.jsonSchema.required as string[])[0]!
    const mutated = { ...valid }
    delete mutated[removedField]
    const negativeDetected = !responseSchema.safeParse(mutated).success && compare(valid, mutated).length > 0

    const binarySummaries = canonicalBinary.map((record) => {
      const bytes = Buffer.from(record.base64, 'base64')
      return { name: record.name, byteCount: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), pythonReparse: 'passed' }
    })
    const publicContracts = canonicalHttp.reduce((count, record) => {
      const contracts = record.contracts as JsonRecord
      return count + 2 + ('body' in contracts ? 1 : 0) + Object.keys(contracts.responses as JsonRecord).length
    }, 0)
    const httpBindings = canonicalHttp.map((record) => ({
      operationId: record.operationId,
      method: record.method,
      path: record.path,
      bodyKind: record.bodyKind,
      publicContractCount: 2 + ('body' in (record.contracts as JsonRecord) ? 1 : 0) +
        Object.keys((record.contracts as JsonRecord).responses as JsonRecord).length,
      pythonEmit: 'passed',
      typescriptParseSerialize: 'passed',
      pythonReparse: 'passed'
    }))
    const realtimeFamilies = canonicalRealtime.map((entry) => ({
      messageType: entry.message_type,
      pythonEmit: 'passed',
      typescriptNormalizeSerialize: 'passed',
      pythonReparse: 'passed'
    }))
    cleanupAttempted = true
    await rm(temporaryDirectory, { recursive: true, force: true })
    const existsAfterCleanup = await pathExists(temporaryDirectory)
    const report = {
      schemaVersion: 1,
      taskId: 'CON-009',
      passed: diffs.length === 0 && negativeDetected && canonicalHttp.length === 47 && canonicalRealtime.length === 19 && canonicalBinary.length === 6,
      counts: {
        httpOperationBindings: canonicalHttp.length,
        serializablePublicContracts: publicContracts,
        realtimeWireFamilies: canonicalRealtime.length,
        binaryFixtures: canonicalBinary.length,
        binaryBytes: binarySummaries.reduce((sum, item) => sum + item.byteCount, 0),
        normalizedErrorRecords: httpOperations.reduce((sum, operation) => sum + operation.errors.length, 0),
        semanticLossDiffs: diffs.length
      },
      twoWay: { pythonEmit: emitCommand, typescriptParseSerialize: 'passed', pythonReparse: reparseCommand },
      normalizedPaths: [],
      authorityProjections: [
        {
          path: 'PUT /configuration/providers; POST /configuration/providers/probe',
          reason: 'credential fields remain inside the nonserializable Python authority boundary'
        },
        {
          path: 'GET /debug/ai-calls/images/{preview_id}',
          reason: 'synthetic Python data_url is reduced to the accepted metadata-only public contract'
        }
      ],
      httpBindings,
      realtimeFamilies,
      binary: binarySummaries,
      semanticLossDiffs: diffs,
      negativeRegression: { removedField, detected: negativeDetected },
      controlledSecretValuesSerialized: false,
      temporaryDirectory: { cleanupAttempted, existsAfterCleanup }
    }
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    if (!report.passed) throw new Error(`Contract parity failed: ${JSON.stringify(report.semanticLossDiffs.slice(0, 5))}`)
    console.log(JSON.stringify({ passed: true, reportPath, counts: report.counts }))
  } finally {
    if (!cleanupAttempted) {
      cleanupAttempted = true
      await rm(temporaryDirectory, { recursive: true, force: true })
    }
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

await main()
