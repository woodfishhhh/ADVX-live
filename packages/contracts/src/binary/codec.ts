const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true })

export const ADVX_BINARY_MAGIC = 'ADVX' as const
export const ADVX_BINARY_CURRENT_VERSION = 3 as const
export const ADVX_BINARY_READABLE_VERSIONS = [1, 2, 3] as const

export const MAX_BINARY_SESSION_ID_BYTES = 128
export const MAX_BINARY_INPUT_ID_BYTES = 128
export const MAX_BINARY_FORMAT_BYTES = 256
export const MAX_BINARY_JSON_HEADER_BYTES = 4_096
export const MAX_BINARY_AUDIO_BODY_BYTES = 2_097_152
export const MAX_BINARY_IMAGE_BODY_BYTES = 4_194_304
export const MAX_BINARY_ENVELOPE_BYTES = 9 + MAX_BINARY_JSON_HEADER_BYTES + MAX_BINARY_IMAGE_BODY_BYTES
export const MAX_BINARY_CAPTURED_AT_MS = (1n << 64n) - 1n

/** Python struct `>4sBBHHQHI`, all integer fields unsigned and big-endian. */
export const ADVX_BINARY_V1_LAYOUT = {
  byteLength: 24,
  magic: 0,
  version: 4,
  mediaType: 5,
  sessionIdLength: 6,
  inputIdLength: 8,
  capturedAtMs: 10,
  formatLength: 18,
  bodyLength: 20
} as const

/** Python struct `>4sBBBHHQHI`, all integer fields unsigned and big-endian. */
export const ADVX_BINARY_V2_LAYOUT = {
  byteLength: 25,
  magic: 0,
  version: 4,
  mediaType: 5,
  source: 6,
  sessionIdLength: 7,
  inputIdLength: 9,
  capturedAtMs: 11,
  formatLength: 19,
  bodyLength: 21
} as const

/** Python struct `>4sBI`; JSON starts at byte 9 and the opaque body follows it. */
export const ADVX_BINARY_V3_LAYOUT = {
  byteLength: 9,
  magic: 0,
  version: 4,
  jsonHeaderLength: 5,
  jsonHeader: 9
} as const

export const ADVX_BINARY_MEDIA_IDS = { audio: 1, image: 2 } as const
export const ADVX_BINARY_SOURCE_IDS = { none: 0, microphone: 1, system_audio: 2 } as const

export type AdvxBinaryVersion = 1 | 2 | 3
export type AdvxBinaryMediaType = keyof typeof ADVX_BINARY_MEDIA_IDS
export type AdvxBinaryAudioSource = Exclude<keyof typeof ADVX_BINARY_SOURCE_IDS, 'none'>
export type AdvxBinarySource = AdvxBinaryAudioSource | null
export type AdvxBinaryBinding = 'audio' | 'frame'

export interface AdvxBinaryHeader {
  readonly version: AdvxBinaryVersion
  readonly mediaType: AdvxBinaryMediaType
  readonly source: AdvxBinarySource
  readonly sessionId: string
  readonly inputId: string
  readonly capturedAtMs: number | bigint
  readonly format: string
  readonly bodyLength: number
  readonly turnId?: string
  readonly systemAudioRequired: boolean
}

export interface AdvxBinaryEnvelopeInput extends Omit<AdvxBinaryHeader, 'bodyLength'> {
  readonly body: Uint8Array
}

export class AdvxBinaryEnvelope {
  readonly header: AdvxBinaryHeader
  declare readonly body: Uint8Array

  constructor(header: AdvxBinaryHeader, body: Uint8Array) {
    this.header = Object.freeze({ ...header })
    Object.defineProperty(this, 'body', { value: body, enumerable: false, writable: false })
  }

  toJSON(): AdvxBinaryHeader {
    return this.header
  }
}

export class AdvxBinaryCodecError extends Error {}
export class AdvxBinaryPayloadTooLargeError extends AdvxBinaryCodecError {}
export class AdvxUnsupportedBinaryVersionError extends AdvxBinaryCodecError {}
export class AdvxUnsupportedBinaryMediaTypeError extends AdvxBinaryCodecError {}
export class AdvxUnsupportedBinarySourceError extends AdvxBinaryCodecError {}

export interface AdvxBinaryCodecBinding {
  readonly id: `ADVX-BIN/${AdvxBinaryVersion} ${AdvxBinaryBinding}`
  readonly version: AdvxBinaryVersion
  readonly binding: AdvxBinaryBinding
  readonly direction: 'client-to-backend'
  readonly mediaType: AdvxBinaryMediaType
  readonly mode: 'compatibility-read-only' | 'canonical-current'
}

export const advxBinaryCodecRegistry: readonly AdvxBinaryCodecBinding[] = Object.freeze(
  ([1, 2, 3] as const).flatMap((version) =>
    ([['audio', 'audio'], ['frame', 'image']] as const).map(([binding, mediaType]) => Object.freeze({
      id: `ADVX-BIN/${version} ${binding}` as const,
      version,
      binding,
      direction: 'client-to-backend' as const,
      mediaType,
      mode: version === 3 ? 'canonical-current' as const : 'compatibility-read-only' as const
    }))
  )
)

export function encodeAdvxBinaryEnvelope(input: AdvxBinaryEnvelopeInput): Uint8Array {
  const body = exactView(input.body)
  const header = validateHeader({ ...input, bodyLength: body.byteLength })
  const bodyLimit = maxBodyBytes(header.mediaType)
  if (body.byteLength > bodyLimit) {
    throw new AdvxBinaryPayloadTooLargeError(`binary ${header.mediaType} body exceeds ${bodyLimit} bytes`)
  }
  return header.version === 3 ? encodeV3(header, body) : encodeLegacy(header, body)
}

export function decodeAdvxBinaryEnvelope(payload: Uint8Array): AdvxBinaryEnvelope {
  const bytes = exactView(payload)
  if (bytes.byteLength < 5) throw new AdvxBinaryCodecError('binary envelope is shorter than its fixed header')
  if (bytes.byteLength > MAX_BINARY_ENVELOPE_BYTES) {
    throw new AdvxBinaryPayloadTooLargeError('binary envelope exceeds the maximum allowed size')
  }
  assertMagic(bytes)
  const version = bytes[4]
  if (version !== 1 && version !== 2 && version !== 3) {
    throw new AdvxUnsupportedBinaryVersionError('binary envelope version is not supported')
  }
  return version === 3 ? decodeV3(bytes) : decodeLegacy(bytes, version)
}

function encodeLegacy(header: AdvxBinaryHeader, body: Uint8Array): Uint8Array {
  const sessionId = encodeWireText(header.sessionId, 'session_id', MAX_BINARY_SESSION_ID_BYTES)
  const inputId = encodeWireText(header.inputId, 'input_id', MAX_BINARY_INPUT_ID_BYTES)
  const format = encodeWireText(header.format, 'format', MAX_BINARY_FORMAT_BYTES)
  const layout = header.version === 1 ? ADVX_BINARY_V1_LAYOUT : ADVX_BINARY_V2_LAYOUT
  const output = new Uint8Array(layout.byteLength + sessionId.length + inputId.length + format.length + body.length)
  writeMagic(output)
  const view = dataView(output)
  view.setUint8(4, header.version)
  view.setUint8(5, ADVX_BINARY_MEDIA_IDS[header.mediaType])
  let lengthOffset: number
  if (header.version === 2) {
    view.setUint8(6, sourceId(header.source))
    lengthOffset = 7
  } else {
    lengthOffset = 6
  }
  view.setUint16(lengthOffset, sessionId.length, false)
  view.setUint16(lengthOffset + 2, inputId.length, false)
  view.setBigUint64(lengthOffset + 4, BigInt(header.capturedAtMs), false)
  view.setUint16(lengthOffset + 12, format.length, false)
  view.setUint32(lengthOffset + 14, body.length, false)
  copyParts(output, layout.byteLength, sessionId, inputId, format, body)
  return output
}

function encodeV3(header: AdvxBinaryHeader, body: Uint8Array): Uint8Array {
  const values: readonly (readonly [string, string | number | bigint | boolean | null])[] = [
    ['media_type', header.mediaType],
    // The canonical header always carries an explicit nullable source so
    // image frames round-trip through the strict decoder as `null`.
    ['source', header.mediaType === 'audio' ? header.source : null],
    ['session_id', header.sessionId],
    ['input_id', header.inputId],
    ['captured_at_ms', header.capturedAtMs],
    ['format', header.format],
    ['body_length', header.bodyLength],
    ...(header.turnId === undefined ? [] : [['turn_id', header.turnId] as const]),
    ...(header.systemAudioRequired ? [['system_audio_required', true] as const] : [])
  ]
  const jsonHeader = textEncoder.encode(`{${values.map(([key, value]) =>
    `${pythonJsonString(key)}:${pythonJsonValue(value)}`).join(',')}}`)
  if (jsonHeader.length > MAX_BINARY_JSON_HEADER_BYTES) {
    throw new AdvxBinaryCodecError('binary envelope JSON header is too large')
  }
  const output = new Uint8Array(ADVX_BINARY_V3_LAYOUT.byteLength + jsonHeader.length + body.length)
  writeMagic(output)
  const view = dataView(output)
  view.setUint8(4, 3)
  view.setUint32(5, jsonHeader.length, false)
  copyParts(output, ADVX_BINARY_V3_LAYOUT.byteLength, jsonHeader, body)
  return output
}

function decodeLegacy(bytes: Uint8Array, version: 1 | 2): AdvxBinaryEnvelope {
  const layout = version === 1 ? ADVX_BINARY_V1_LAYOUT : ADVX_BINARY_V2_LAYOUT
  if (bytes.length < layout.byteLength) throw new AdvxBinaryCodecError('binary envelope is shorter than its fixed header')
  const view = dataView(bytes)
  const mediaType = mediaTypeFromId(view.getUint8(5))
  const source = version === 1
    ? (mediaType === 'audio' ? 'microphone' : null)
    : sourceFromId(view.getUint8(6))
  const lengthOffset = version === 1 ? 6 : 7
  const sessionIdLength = view.getUint16(lengthOffset, false)
  const inputIdLength = view.getUint16(lengthOffset + 2, false)
  const capturedAt = view.getBigUint64(lengthOffset + 4, false)
  const formatLength = view.getUint16(lengthOffset + 12, false)
  const bodyLength = view.getUint32(lengthOffset + 14, false)
  validateWireLength(sessionIdLength, 'session_id', MAX_BINARY_SESSION_ID_BYTES)
  validateWireLength(inputIdLength, 'input_id', MAX_BINARY_INPUT_ID_BYTES)
  validateWireLength(formatLength, 'format', MAX_BINARY_FORMAT_BYTES)
  validateBodyLength(mediaType, bodyLength)
  const expected = layout.byteLength + sessionIdLength + inputIdLength + formatLength + bodyLength
  if (bytes.length !== expected) throw new AdvxBinaryCodecError('binary envelope length does not match its header')
  let cursor = layout.byteLength
  const sessionId = decodeWireText(bytes.subarray(cursor, cursor += sessionIdLength), 'session_id')
  const inputId = decodeWireText(bytes.subarray(cursor, cursor += inputIdLength), 'input_id')
  const format = decodeWireText(bytes.subarray(cursor, cursor += formatLength), 'format')
  const header = validateHeader({ version, mediaType, source, sessionId, inputId,
    capturedAtMs: capturedAt <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(capturedAt) : capturedAt,
    format, bodyLength, systemAudioRequired: false })
  return new AdvxBinaryEnvelope(header, bytes.slice(cursor))
}

function decodeV3(bytes: Uint8Array): AdvxBinaryEnvelope {
  if (bytes.length < ADVX_BINARY_V3_LAYOUT.byteLength) {
    throw new AdvxBinaryCodecError('binary envelope is shorter than its fixed header')
  }
  const headerLength = dataView(bytes).getUint32(ADVX_BINARY_V3_LAYOUT.jsonHeaderLength, false)
  if (headerLength < 2 || headerLength > MAX_BINARY_JSON_HEADER_BYTES) {
    throw new AdvxBinaryCodecError('binary envelope JSON header length is invalid')
  }
  const bodyOffset = ADVX_BINARY_V3_LAYOUT.jsonHeader + headerLength
  if (bytes.length < bodyOffset) throw new AdvxBinaryCodecError('binary envelope JSON header is truncated')
  let raw: unknown
  let jsonHeader: string
  try {
    jsonHeader = textDecoder.decode(bytes.subarray(ADVX_BINARY_V3_LAYOUT.jsonHeader, bodyOffset))
    raw = JSON.parse(jsonHeader)
  } catch {
    throw new AdvxBinaryCodecError('binary envelope JSON header is invalid')
  }
  const header = parseV3Header(raw, jsonHeader)
  if (bytes.length !== bodyOffset + header.bodyLength) {
    throw new AdvxBinaryCodecError('binary envelope length does not match its header')
  }
  return new AdvxBinaryEnvelope(header, bytes.slice(bodyOffset))
}

function parseV3Header(raw: unknown, jsonHeader: string): AdvxBinaryHeader {
  if (!isRecord(raw)) throw new AdvxBinaryCodecError('binary envelope JSON header must be an object')
  const allowed = new Set(['media_type', 'source', 'session_id', 'input_id', 'captured_at_ms', 'format', 'body_length', 'turn_id', 'system_audio_required'])
  if (Object.keys(raw).some((key) => !allowed.has(key))) throw new AdvxBinaryCodecError('binary envelope header has unknown fields')
  const mediaType = raw.media_type
  if (mediaType !== 'audio' && mediaType !== 'image') throw new AdvxUnsupportedBinaryMediaTypeError('binary envelope has an unsupported media type')
  const source = raw.source
  if (source !== null && source !== 'microphone' && source !== 'system_audio') {
    throw new AdvxUnsupportedBinarySourceError('binary envelope has an unsupported audio source')
  }
  return validateHeader({
    version: 3,
    mediaType,
    source,
    sessionId: requireString(raw.session_id, 'session_id'),
    inputId: requireString(raw.input_id, 'input_id'),
    capturedAtMs: requireJsonInteger(raw.captured_at_ms, jsonHeader, 'captured_at_ms'),
    format: requireString(raw.format, 'format'),
    bodyLength: requireInteger(raw.body_length, 'body_length'),
    ...(raw.turn_id === undefined ? {} : { turnId: requireString(raw.turn_id, 'turn_id') }),
    systemAudioRequired: raw.system_audio_required === undefined
      ? false
      : requireBoolean(raw.system_audio_required, 'system_audio_required')
  })
}

function validateHeader(header: AdvxBinaryHeader): AdvxBinaryHeader {
  if (!ADVX_BINARY_READABLE_VERSIONS.includes(header.version)) throw new AdvxUnsupportedBinaryVersionError('binary envelope version is not supported')
  encodeWireText(header.sessionId, 'session_id', MAX_BINARY_SESSION_ID_BYTES)
  encodeWireText(header.inputId, 'input_id', MAX_BINARY_INPUT_ID_BYTES)
  encodeWireText(header.format, 'format', MAX_BINARY_FORMAT_BYTES)
  const capturedAt = typeof header.capturedAtMs === 'bigint'
    ? header.capturedAtMs
    : (Number.isSafeInteger(header.capturedAtMs) ? BigInt(header.capturedAtMs) : -1n)
  if (capturedAt < 0n || capturedAt > MAX_BINARY_CAPTURED_AT_MS) throw new AdvxBinaryCodecError('captured_at_ms must be an unsigned 64-bit integer')
  validateBodyLength(header.mediaType, header.bodyLength)
  if (header.mediaType === 'audio' && header.source === null) throw new AdvxUnsupportedBinarySourceError('binary audio envelope requires a source')
  if (header.mediaType === 'image' && header.source !== null) throw new AdvxUnsupportedBinarySourceError('binary image envelope cannot have an audio source')
  if (header.version === 1 && header.mediaType === 'audio' && header.source !== 'microphone') throw new AdvxUnsupportedBinarySourceError('binary envelope v1 only supports microphone audio')
  if (header.version < 3 && (header.turnId !== undefined || header.systemAudioRequired)) throw new AdvxBinaryCodecError('coordinated audio metadata requires binary envelope v3')
  if (header.mediaType === 'image' && (header.turnId !== undefined || header.systemAudioRequired)) throw new AdvxBinaryCodecError('image envelopes cannot have coordinated audio metadata')
  if (header.turnId !== undefined) encodeWireText(header.turnId, 'turn_id', MAX_BINARY_INPUT_ID_BYTES)
  if (header.systemAudioRequired && (header.mediaType !== 'audio' || header.source !== 'microphone' || header.turnId === undefined)) {
    throw new AdvxBinaryCodecError('system audio requirements need microphone audio and a turn_id')
  }
  return header
}

function maxBodyBytes(mediaType: AdvxBinaryMediaType): number {
  return mediaType === 'audio' ? MAX_BINARY_AUDIO_BODY_BYTES : MAX_BINARY_IMAGE_BODY_BYTES
}

function validateBodyLength(mediaType: AdvxBinaryMediaType, length: number): void {
  if (!Number.isInteger(length) || length < 1) throw new AdvxBinaryCodecError('binary envelope body length must be at least one')
  if (length > maxBodyBytes(mediaType)) throw new AdvxBinaryPayloadTooLargeError(`binary ${mediaType} body exceeds its limit`)
}

function mediaTypeFromId(id: number): AdvxBinaryMediaType {
  if (id === 1) return 'audio'
  if (id === 2) return 'image'
  throw new AdvxUnsupportedBinaryMediaTypeError('binary envelope has an unsupported media type')
}

function sourceFromId(id: number): AdvxBinarySource {
  if (id === 0) return null
  if (id === 1) return 'microphone'
  if (id === 2) return 'system_audio'
  throw new AdvxUnsupportedBinarySourceError('binary envelope has an unsupported audio source')
}

function sourceId(source: AdvxBinarySource): number {
  return source === null ? 0 : ADVX_BINARY_SOURCE_IDS[source]
}

function encodeWireText(value: string, field: string, limit: number): Uint8Array {
  if (!value || value.includes('\0')) throw new AdvxBinaryCodecError(`binary envelope ${field} must be non-empty text`)
  const bytes = textEncoder.encode(value)
  if (bytes.length > limit) throw new AdvxBinaryCodecError(`binary envelope ${field} exceeds ${limit} UTF-8 bytes`)
  return bytes
}

function decodeWireText(value: Uint8Array, field: string): string {
  let decoded: string
  try { decoded = textDecoder.decode(value) } catch { throw new AdvxBinaryCodecError(`binary envelope ${field} is not valid UTF-8`) }
  if (!decoded || decoded.includes('\0')) throw new AdvxBinaryCodecError(`binary envelope ${field} must be non-empty text`)
  return decoded
}

function validateWireLength(value: number, field: string, limit: number): void {
  if (value < 1 || value > limit) throw new AdvxBinaryCodecError(`binary envelope ${field} length must be between 1 and ${limit} bytes`)
}

function dataView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function exactView(bytes: Uint8Array): Uint8Array {
  if (!(bytes instanceof Uint8Array)) throw new AdvxBinaryCodecError('binary envelope payload must be a Uint8Array')
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
}

function assertMagic(bytes: Uint8Array): void {
  if (bytes[0] !== 65 || bytes[1] !== 68 || bytes[2] !== 86 || bytes[3] !== 88) throw new AdvxBinaryCodecError('binary envelope has an invalid magic value')
}

function writeMagic(bytes: Uint8Array): void {
  bytes.set([65, 68, 86, 88], 0)
}

function copyParts(output: Uint8Array, offset: number, ...parts: Uint8Array[]): void {
  for (const part of parts) { output.set(part, offset); offset += part.length }
}

function pythonJsonValue(value: string | number | bigint | boolean | null): string {
  if (typeof value === 'string') return pythonJsonString(value)
  if (value === null) return 'null'
  return String(value)
}

function pythonJsonString(value: string): string {
  let result = '"'
  for (const character of value) {
    const point = character.codePointAt(0)!
    if (character === '"') result += '\\"'
    else if (character === '\\') result += '\\\\'
    else if (character === '\b') result += '\\b'
    else if (character === '\f') result += '\\f'
    else if (character === '\n') result += '\\n'
    else if (character === '\r') result += '\\r'
    else if (character === '\t') result += '\\t'
    else if (point < 0x20 || point > 0x7e) {
      if (point <= 0xffff) result += `\\u${point.toString(16).padStart(4, '0')}`
      else {
        const adjusted = point - 0x10000
        result += `\\u${(0xd800 + (adjusted >> 10)).toString(16)}\\u${(0xdc00 + (adjusted & 0x3ff)).toString(16)}`
      }
    } else result += character
  }
  return `${result}"`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new AdvxBinaryCodecError(`${field} must be text`)
  return value
}

function requireInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value)) throw new AdvxBinaryCodecError(`${field} must be a safe integer`)
  return value as number
}

function requireJsonInteger(value: unknown, json: string, field: string): number | bigint {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new AdvxBinaryCodecError(`${field} must be an integer`)
  }
  const parsed = value
  const pattern = new RegExp(`"${field}"\\s*:\\s*(-?\\d+)`, 'g')
  for (const match of json.matchAll(pattern)) {
    const exact = BigInt(match[1]!)
    if (Number(exact) !== parsed) continue
    return exact <= BigInt(Number.MAX_SAFE_INTEGER) && exact >= BigInt(Number.MIN_SAFE_INTEGER)
      ? Number(exact)
      : exact
  }
  throw new AdvxBinaryCodecError(`${field} must be an integer`)
}

function requireBoolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new AdvxBinaryCodecError(`${field} must be boolean`)
  return value
}
