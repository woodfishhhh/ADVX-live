import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import { canonicalJson, sha256Hex } from '@advx/contracts'

import { sanitizeDiagnosticValue } from './diagnostic-logging'

export const DIAGNOSTICS_BUNDLE_SCHEMA_VERSION = 1 as const
export const DIAGNOSTICS_BUNDLE_MAX_FILES = 64
export const DIAGNOSTICS_BUNDLE_DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024
export const DIAGNOSTICS_BUNDLE_DEFAULT_MAX_TOTAL_BYTES = 32 * 1024 * 1024

export const DIAGNOSTICS_ARTIFACT_KINDS = Object.freeze([
  'redacted-logs',
  'viewer-traces',
  'versions',
  'health',
  'debug-snapshot',
  'replay',
  'eval',
  'screenshots',
  'content-trace',
  'bun-cpu-profile',
  'bun-heap-profile',
  'crash-metadata',
  'configuration-names'
] as const)

export type DiagnosticsArtifactKind = (typeof DIAGNOSTICS_ARTIFACT_KINDS)[number]

export type DiagnosticsFileSource = Readonly<{
  kind: DiagnosticsArtifactKind
  name: string
  sourcePath: string
  redacted: true
}>

export type DiagnosticsJsonSource = Readonly<{
  kind: DiagnosticsArtifactKind
  name: string
  value: unknown
  redacted: true
}>

export type DiagnosticsMissingArtifact = Readonly<{
  kind: DiagnosticsArtifactKind
  reason: string
}>

export type DiagnosticsBundleInput = Readonly<{
  destination: string
  requested: readonly DiagnosticsArtifactKind[]
  files?: readonly DiagnosticsFileSource[]
  json?: readonly DiagnosticsJsonSource[]
  missing?: readonly DiagnosticsMissingArtifact[]
  bundleId?: string
  now?: () => Date
  maxFileBytes?: number
  maxTotalBytes?: number
}>

export type DiagnosticsBundleFile = Readonly<{
  kind: DiagnosticsArtifactKind
  name: string
  relative_path: string
  source: 'file' | 'json'
  sha256: string
  size_bytes: number
}>

export type DiagnosticsBundleManifest = Readonly<{
  schema_version: typeof DIAGNOSTICS_BUNDLE_SCHEMA_VERSION
  bundle_id: string
  created_at: string
  redacted: true
  requested: readonly DiagnosticsArtifactKind[]
  files: readonly DiagnosticsBundleFile[]
  missing: readonly DiagnosticsMissingArtifact[]
  excluded: readonly Readonly<{
    kind: DiagnosticsArtifactKind
    name: string
    reason: 'not_requested'
  }>[]
  limits: Readonly<{
    max_files: number
    max_file_bytes: number
    max_total_bytes: number
  }>
  total_size_bytes: number
  manifest_size_bytes: number
  integrity: Readonly<{
    algorithm: 'sha256'
    canonical_payload_sha256: string
    self_hash_excluded: true
  }>
}>

export type DiagnosticsBundleResult = Readonly<{
  destination: string
  manifest_path: string
  manifest: DiagnosticsBundleManifest
}>

export type RuntimeVersionSnapshotInput = Readonly<{
  backendVersion: string
  buildId: string
  dependencyVersions?: Readonly<Record<string, string>>
  bunVersion?: string
  nodeVersion?: string
  pnpmVersion?: string
  platform?: string
  arch?: string
}>

export class DiagnosticsBundleError extends Error {
  readonly name = 'DiagnosticsBundleError'

  constructor(readonly code: DiagnosticsBundleErrorCode, message: string) {
    super(message)
  }
}

export type DiagnosticsBundleErrorCode =
  | 'invalid_request'
  | 'invalid_destination'
  | 'destination_not_empty'
  | 'invalid_artifact'
  | 'unredacted_artifact'
  | 'artifact_not_found'
  | 'artifact_is_not_file'
  | 'artifact_too_large'
  | 'bundle_too_large'

const DEFAULT_MISSING_REASONS: Readonly<Record<DiagnosticsArtifactKind, string>> = {
  'redacted-logs': 'no approved redacted log file was supplied',
  'viewer-traces': 'no viewer trace artifact was available',
  versions: 'runtime or dependency version snapshot was not supplied',
  health: 'health response was not available',
  'debug-snapshot': 'bounded debug snapshot was not available',
  replay: 'replay report was not available',
  eval: 'evaluation report was not available',
  screenshots: 'no selected screenshot was supplied',
  'content-trace': 'Electron content trace was not available',
  'bun-cpu-profile': 'Bun CPU profile was not requested or available',
  'bun-heap-profile': 'Bun heap profile was not requested or available',
  'crash-metadata': 'local crash dump metadata was not available',
  'configuration-names': 'configuration names were not supplied'
}

export async function createDiagnosticsBundle(
  input: DiagnosticsBundleInput
): Promise<DiagnosticsBundleResult> {
  const normalized = normalizeRequest(input)
  const destination = resolve(normalized.destination)
  await mkdir(destination, { recursive: true })
  if ((await readdir(destination)).length > 0) {
    throw new DiagnosticsBundleError('destination_not_empty', 'diagnostics bundle destination must be empty')
  }

  const requestedSet = new Set(normalized.requested)
  const excluded: Array<{
    kind: DiagnosticsArtifactKind
    name: string
    reason: 'not_requested'
  }> = []
  const candidates = [
    ...normalized.files.map((source) => ({
      kind: source.kind,
      name: source.name,
      source: 'file' as const,
      value: source
    })),
    ...normalized.json.map((source) => ({
      kind: source.kind,
      name: source.name,
      source: 'json' as const,
      value: source
    }))
  ]
  const seenNames = new Set<string>()
  for (const candidate of candidates) {
    if (!requestedSet.has(candidate.kind)) {
      excluded.push({ kind: candidate.kind, name: candidate.name, reason: 'not_requested' })
      continue
    }
    const key = `${candidate.kind}:${candidate.name}`
    if (seenNames.has(key)) throw new DiagnosticsBundleError('invalid_artifact', `duplicate artifact: ${key}`)
    seenNames.add(key)
  }

  const included: DiagnosticsBundleFile[] = []
  let totalSize = 0
  for (const candidate of candidates) {
    if (!requestedSet.has(candidate.kind)) continue
    if (candidate.value.redacted !== true) {
      throw new DiagnosticsBundleError(
        'unredacted_artifact',
        `artifact is not marked redacted: ${candidate.kind}/${candidate.name}`
      )
    }
    const bytes = candidate.source === 'file'
      ? await readApprovedFile(candidate.value.sourcePath, destination, normalized.maxFileBytes)
      : encodeJsonArtifact(candidate.kind, candidate.value.value)
    if (bytes.byteLength > normalized.maxFileBytes) {
      throw new DiagnosticsBundleError('artifact_too_large', `artifact exceeds ${normalized.maxFileBytes} bytes: ${candidate.kind}/${candidate.name}`)
    }
    if (included.length >= DIAGNOSTICS_BUNDLE_MAX_FILES) {
      throw new DiagnosticsBundleError('bundle_too_large', 'diagnostics bundle file count is bounded')
    }
    totalSize += bytes.byteLength
    if (totalSize > normalized.maxTotalBytes) {
      throw new DiagnosticsBundleError('bundle_too_large', `diagnostics bundle exceeds ${normalized.maxTotalBytes} bytes`)
    }
    const relativePath = join('artifacts', candidate.kind, candidate.name)
    const outputPath = join(destination, relativePath)
    await mkdir(join(destination, 'artifacts', candidate.kind), { recursive: true })
    await writeFile(outputPath, bytes)
    included.push({
      kind: candidate.kind,
      name: candidate.name,
      relative_path: relativePath.split(sep).join('/'),
      source: candidate.source,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size_bytes: bytes.byteLength
    })
  }

  const missing = buildMissingArtifacts(normalized.requested, included, normalized.missing)
  const sortedFiles = Object.freeze([...included].sort((left, right) => left.relative_path.localeCompare(right.relative_path)))
  const sortedExcluded = Object.freeze([...excluded].sort((left, right) => `${left.kind}/${left.name}`.localeCompare(`${right.kind}/${right.name}`)))
  const baseManifest = {
    schema_version: DIAGNOSTICS_BUNDLE_SCHEMA_VERSION,
    bundle_id: normalized.bundleId,
    created_at: normalized.now().toISOString(),
    redacted: true as const,
    requested: Object.freeze([...normalized.requested]),
    files: sortedFiles,
    missing,
    excluded: sortedExcluded,
    limits: Object.freeze({
      max_files: DIAGNOSTICS_BUNDLE_MAX_FILES,
      max_file_bytes: normalized.maxFileBytes,
      max_total_bytes: normalized.maxTotalBytes
    }),
    total_size_bytes: totalSize
  }
  const payloadHash = sha256Hex(canonicalJson(baseManifest))
  let manifestSize = 0
  let serialized = ''
  let manifest: DiagnosticsBundleManifest
  for (let attempt = 0; attempt < 4; attempt += 1) {
    manifest = {
      ...baseManifest,
      manifest_size_bytes: manifestSize,
      integrity: { algorithm: 'sha256', canonical_payload_sha256: payloadHash, self_hash_excluded: true }
    }
    serialized = `${canonicalJson(manifest)}\n`
    const nextSize = Buffer.byteLength(serialized, 'utf8')
    if (nextSize === manifestSize) break
    manifestSize = nextSize
  }
  manifest = {
    ...baseManifest,
    manifest_size_bytes: manifestSize,
    integrity: { algorithm: 'sha256', canonical_payload_sha256: payloadHash, self_hash_excluded: true }
  }
  serialized = `${canonicalJson(manifest)}\n`
  const finalManifestSize = Buffer.byteLength(serialized, 'utf8')
  if (manifest.manifest_size_bytes !== finalManifestSize) {
    manifest = { ...manifest, manifest_size_bytes: finalManifestSize }
    serialized = `${canonicalJson(manifest)}\n`
  }
  const manifestPath = join(destination, 'manifest.json')
  await writeFile(manifestPath, serialized, 'utf8')
  return Object.freeze({ destination, manifest_path: manifestPath, manifest: Object.freeze(manifest) })
}

export function createRuntimeVersionSnapshot(
  input: RuntimeVersionSnapshotInput
): Readonly<Record<string, unknown>> {
  const dependencies = Object.fromEntries(
    Object.entries(input.dependencyVersions ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, version]) => [boundedDependencyName(name), boundedText(version, name)])
  )
  return Object.freeze({
    schema_version: 1,
    backend: { version: boundedText(input.backendVersion, 'backendVersion'), build_id: boundedText(input.buildId, 'buildId') },
    runtime: {
      bun: boundedText(input.bunVersion ?? (typeof Bun === 'undefined' ? 'unknown' : Bun.version), 'bunVersion'),
      node: boundedText(input.nodeVersion ?? process.version, 'nodeVersion'),
      platform: boundedText(input.platform ?? process.platform, 'platform'),
      arch: boundedText(input.arch ?? process.arch, 'arch')
    },
    ...(input.pnpmVersion === undefined ? {} : { package_manager: { pnpm: boundedText(input.pnpmVersion, 'pnpmVersion') } }),
    dependencies
  })
}

function normalizeRequest(input: DiagnosticsBundleInput): {
  destination: string
  requested: readonly DiagnosticsArtifactKind[]
  files: readonly DiagnosticsFileSource[]
  json: readonly DiagnosticsJsonSource[]
  missing: readonly DiagnosticsMissingArtifact[]
  bundleId: string
  now: () => Date
  maxFileBytes: number
  maxTotalBytes: number
} {
  if (input === null || typeof input !== 'object') throw new DiagnosticsBundleError('invalid_request', 'diagnostics bundle request must be an object')
  if (typeof input.destination !== 'string' || !isAbsolute(input.destination)) throw new DiagnosticsBundleError('invalid_destination', 'diagnostics bundle destination must be absolute')
  if (!Array.isArray(input.requested) || input.requested.length < 1 || input.requested.length > DIAGNOSTICS_ARTIFACT_KINDS.length) throw new DiagnosticsBundleError('invalid_request', 'diagnostics bundle must request one or more artifact kinds')
  const requested = input.requested.map((kind) => validateKind(kind))
  if (new Set(requested).size !== requested.length) throw new DiagnosticsBundleError('invalid_request', 'diagnostics artifact kinds must be unique')
  const maxFileBytes = boundedLimit(input.maxFileBytes ?? DIAGNOSTICS_BUNDLE_DEFAULT_MAX_FILE_BYTES, 1, 50 * 1024 * 1024, 'maxFileBytes')
  const maxTotalBytes = boundedLimit(input.maxTotalBytes ?? DIAGNOSTICS_BUNDLE_DEFAULT_MAX_TOTAL_BYTES, maxFileBytes, 100 * 1024 * 1024, 'maxTotalBytes')
  const files = normalizeFiles(input.files ?? [])
  const json = normalizeJson(input.json ?? [])
  const missing = normalizeMissing(input.missing ?? [], new Set(requested))
  const now = input.now ?? (() => new Date())
  const date = now()
  if (!(date instanceof Date) || Number.isNaN(date.valueOf())) throw new DiagnosticsBundleError('invalid_request', 'diagnostics bundle clock returned an invalid date')
  return {
    destination: resolve(input.destination),
    requested: Object.freeze(requested),
    files,
    json,
    missing,
    bundleId: input.bundleId === undefined ? randomUUID() : boundedBundleId(input.bundleId),
    now,
    maxFileBytes,
    maxTotalBytes
  }
}

function normalizeFiles(value: readonly DiagnosticsFileSource[]): readonly DiagnosticsFileSource[] {
  if (!Array.isArray(value) || value.length > DIAGNOSTICS_BUNDLE_MAX_FILES) throw new DiagnosticsBundleError('invalid_request', 'diagnostics file sources are bounded')
  return Object.freeze(value.map((source) => {
    if (source === null || typeof source !== 'object') throw new DiagnosticsBundleError('invalid_artifact', 'diagnostics file source is invalid')
    return Object.freeze({ kind: validateKind(source.kind), name: validateArtifactName(source.name), sourcePath: validateSourcePath(source.sourcePath), redacted: source.redacted })
  }))
}

function normalizeJson(value: readonly DiagnosticsJsonSource[]): readonly DiagnosticsJsonSource[] {
  if (!Array.isArray(value) || value.length > DIAGNOSTICS_BUNDLE_MAX_FILES) throw new DiagnosticsBundleError('invalid_request', 'diagnostics JSON sources are bounded')
  return Object.freeze(value.map((source) => {
    if (source === null || typeof source !== 'object') throw new DiagnosticsBundleError('invalid_artifact', 'diagnostics JSON source is invalid')
    return Object.freeze({ kind: validateKind(source.kind), name: validateArtifactName(source.name), value: source.value, redacted: source.redacted })
  }))
}

function normalizeMissing(value: readonly DiagnosticsMissingArtifact[], requested: ReadonlySet<DiagnosticsArtifactKind>): readonly DiagnosticsMissingArtifact[] {
  if (!Array.isArray(value) || value.length > DIAGNOSTICS_ARTIFACT_KINDS.length) throw new DiagnosticsBundleError('invalid_request', 'missing artifact reasons are bounded')
  const seen = new Set<DiagnosticsArtifactKind>()
  return Object.freeze(value.map((item) => {
    const kind = validateKind(item.kind)
    if (!requested.has(kind)) throw new DiagnosticsBundleError('invalid_request', `missing artifact was not requested: ${kind}`)
    if (seen.has(kind)) throw new DiagnosticsBundleError('invalid_request', `duplicate missing artifact: ${kind}`)
    seen.add(kind)
    return Object.freeze({ kind, reason: boundedText(item.reason, 'missing reason', 256) })
  }))
}

function buildMissingArtifacts(requested: readonly DiagnosticsArtifactKind[], included: readonly DiagnosticsBundleFile[], explicit: readonly DiagnosticsMissingArtifact[]): readonly DiagnosticsMissingArtifact[] {
  const includedKinds = new Set(included.map((file) => file.kind))
  const explicitByKind = new Map(explicit.map((item) => [item.kind, item]))
  return Object.freeze(requested.filter((kind) => !includedKinds.has(kind)).map((kind) => explicitByKind.get(kind) ?? { kind, reason: DEFAULT_MISSING_REASONS[kind] }))
}

async function readApprovedFile(sourcePath: string, destination: string, maxFileBytes: number): Promise<Buffer> {
  const source = resolve(sourcePath)
  if (isWithin(destination, source)) throw new DiagnosticsBundleError('invalid_artifact', 'artifact source cannot be inside bundle destination')
  let info
  try { info = await lstat(source) } catch { throw new DiagnosticsBundleError('artifact_not_found', `artifact source was not found: ${sourcePath}`) }
  if (info.isSymbolicLink() || !info.isFile()) throw new DiagnosticsBundleError('artifact_is_not_file', `artifact source is not a regular file: ${sourcePath}`)
  if (info.size > maxFileBytes) throw new DiagnosticsBundleError('artifact_too_large', `artifact source exceeds ${maxFileBytes} bytes: ${sourcePath}`)
  return readFile(source)
}

function encodeJsonArtifact(kind: DiagnosticsArtifactKind, value: unknown): Buffer {
  if (kind === 'configuration-names') validateConfigurationNames(value)
  const sanitized = sanitizeDiagnosticValue(value)
  if (sanitized === undefined) throw new DiagnosticsBundleError('invalid_artifact', `JSON artifact is undefined: ${kind}`)
  try { return Buffer.from(`${canonicalJson(sanitized)}\n`, 'utf8') } catch (error) {
    throw new DiagnosticsBundleError('invalid_artifact', `JSON artifact is not serializable: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function validateConfigurationNames(value: unknown): void {
  if (!Array.isArray(value) || value.length > 256 || !value.every((item) => typeof item === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(item))) throw new DiagnosticsBundleError('invalid_artifact', 'configuration-names must contain only bounded environment/configuration names')
}

function validateKind(value: unknown): DiagnosticsArtifactKind {
  if (typeof value !== 'string' || !(DIAGNOSTICS_ARTIFACT_KINDS as readonly string[]).includes(value)) throw new DiagnosticsBundleError('invalid_artifact', `unsupported diagnostics artifact kind: ${String(value)}`)
  return value as DiagnosticsArtifactKind
}

function validateArtifactName(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value) || value === '..') throw new DiagnosticsBundleError('invalid_artifact', 'diagnostics artifact names must be safe basenames')
  return value
}

function validateSourcePath(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value) || value.length > 4096) throw new DiagnosticsBundleError('invalid_artifact', 'diagnostics source paths must be absolute')
  return resolve(value)
}

function boundedBundleId(value: unknown): string {
  const id = boundedText(value, 'bundleId', 128)
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id)) throw new DiagnosticsBundleError('invalid_request', 'bundleId is invalid')
  return id
}

function boundedDependencyName(value: string): string {
  if (!/^[@A-Za-z0-9._/-]{1,128}$/.test(value)) throw new DiagnosticsBundleError('invalid_artifact', 'dependency name is invalid')
  return value
}

function boundedText(value: unknown, field: string, maximumLength = 256): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maximumLength || value.includes('\0')) throw new DiagnosticsBundleError('invalid_request', `${field} is invalid`)
  return value
}

function boundedLimit(value: unknown, minimum: number, maximum: number, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new DiagnosticsBundleError('invalid_request', `${field} is out of bounds`)
  return Number(value)
}

function isWithin(root: string, candidate: string): boolean {
  const path = relative(resolve(root), resolve(candidate))
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path))
}
