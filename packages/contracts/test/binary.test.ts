import { describe, expect, test } from 'bun:test'
import {
  ADVX_BINARY_V1_LAYOUT,
  ADVX_BINARY_V2_LAYOUT,
  ADVX_BINARY_V3_LAYOUT,
  MAX_BINARY_AUDIO_BODY_BYTES,
  AdvxBinaryCodecError,
  advxBinaryCodecRegistry,
  decodeAdvxBinaryEnvelope,
  encodeAdvxBinaryEnvelope,
  type AdvxBinaryEnvelopeInput
} from '../src/binary/index'

interface FixtureRecord extends Omit<AdvxBinaryEnvelopeInput, 'body'> {
  readonly name: string
  readonly file: string
  readonly bodyLength: number
  readonly sha256: string
  readonly byteLength: number
}

const fixtureRoot = new URL('./fixtures/binary/', import.meta.url)
const manifest = await Bun.file(new URL('manifest.json', fixtureRoot)).json() as {
  fixtures: FixtureRecord[]
}
const directBodies: Readonly<Record<string, readonly number[]>> = {
  'v1-audio': [1, 2, 3],
  'v1-frame': [255, 216, 255, 217],
  'v2-audio': [16, 32, 48, 64],
  'v2-frame': [82, 73, 70, 70, 87, 69, 66, 80],
  'v3-audio': [170, 187, 204],
  'v3-frame': [137, 80, 78, 71, 13, 10, 26, 10]
}

async function fixtureBytes(fixture: FixtureRecord): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(new URL(fixture.file, fixtureRoot)).arrayBuffer())
}

function mutate(bytes: Uint8Array, offset: number, value: number): Uint8Array {
  const copy = bytes.slice()
  copy[offset] = value
  return copy
}

describe('ADVX-BIN codec', () => {
  test('publishes the exact six accepted bindings and documented header boundaries', () => {
    expect(advxBinaryCodecRegistry.map((entry) => [entry.id, entry.mode])).toEqual([
      ['ADVX-BIN/1 audio', 'compatibility-read-only'],
      ['ADVX-BIN/1 frame', 'compatibility-read-only'],
      ['ADVX-BIN/2 audio', 'compatibility-read-only'],
      ['ADVX-BIN/2 frame', 'compatibility-read-only'],
      ['ADVX-BIN/3 audio', 'canonical-current'],
      ['ADVX-BIN/3 frame', 'canonical-current']
    ])
    expect(new Set(advxBinaryCodecRegistry.map((entry) => entry.id)).size).toBe(6)
    expect(advxBinaryCodecRegistry.every((entry) => entry.direction === 'client-to-backend')).toBe(true)
    expect([ADVX_BINARY_V1_LAYOUT.byteLength, ADVX_BINARY_V2_LAYOUT.byteLength,
      ADVX_BINARY_V3_LAYOUT.byteLength]).toEqual([24, 25, 9])
  })

  test('decodes and re-encodes every Python fixture byte-for-byte from offset views', async () => {
    expect(manifest.fixtures).toHaveLength(6)
    for (const fixture of manifest.fixtures) {
      const canonical = await fixtureBytes(fixture)
      const padded = new Uint8Array(canonical.length + 6)
      padded.set(canonical, 3)
      const offsetView = padded.subarray(3, 3 + canonical.length)
      const decoded = decodeAdvxBinaryEnvelope(offsetView)
      expect(decoded.header).toEqual({
        version: fixture.version,
        mediaType: fixture.mediaType,
        source: fixture.source,
        sessionId: fixture.sessionId,
        inputId: fixture.inputId,
        capturedAtMs: fixture.capturedAtMs,
        format: fixture.format,
        bodyLength: fixture.bodyLength,
        ...(fixture.turnId === null ? {} : { turnId: fixture.turnId }),
        systemAudioRequired: fixture.systemAudioRequired
      })
      expect(encodeAdvxBinaryEnvelope({ ...decoded.header, body: decoded.body })).toEqual(canonical)
      expect(JSON.stringify(decoded)).not.toContain('0":')
      expect(Object.keys(decoded)).toEqual(['header'])
    }
  })

  test('direct TypeScript encoding equals all authoritative Python bytes', async () => {
    for (const fixture of manifest.fixtures) {
      const python = await fixtureBytes(fixture)
      expect(encodeAdvxBinaryEnvelope({
        version: fixture.version,
        mediaType: fixture.mediaType,
        source: fixture.source,
        sessionId: fixture.sessionId,
        inputId: fixture.inputId,
        capturedAtMs: fixture.capturedAtMs,
        format: fixture.format,
        ...(fixture.turnId === null ? {} : { turnId: fixture.turnId }),
        systemAudioRequired: fixture.systemAudioRequired,
        body: new Uint8Array(directBodies[fixture.name]!)
      })).toEqual(python)
    }
    const v3Audio = await fixtureBytes(manifest.fixtures.find((item) => item.name === 'v3-audio')!)
    expect(new TextDecoder().decode(v3Audio.subarray(9, 9 + new DataView(
      v3Audio.buffer, v3Audio.byteOffset, v3Audio.byteLength).getUint32(5, false)))).toContain('\\u4f1a\\u8bdd-v3')
  })

  test('rejects the required compact malformed corpus', async () => {
    const v2 = await fixtureBytes(manifest.fixtures.find((item) => item.name === 'v2-audio')!)
    const v3 = await fixtureBytes(manifest.fixtures.find((item) => item.name === 'v3-audio')!)
    for (const hostile of [
      mutate(v2, 0, 0),
      mutate(v2, 4, 99),
      mutate(v2, 5, 99),
      mutate(v2, 6, 99),
      v2.subarray(0, v2.length - 1),
      new Uint8Array([...v2, 0])
    ]) expect(() => decodeAdvxBinaryEnvelope(hostile)).toThrow(AdvxBinaryCodecError)

    expect(() => encodeAdvxBinaryEnvelope({
      version: 3, mediaType: 'audio', source: 'microphone', sessionId: 's', inputId: 'i',
      capturedAtMs: 1, format: 'pcm', systemAudioRequired: false,
      body: new Uint8Array(MAX_BINARY_AUDIO_BODY_BYTES + 1)
    })).toThrow(AdvxBinaryCodecError)
    expect(() => encodeAdvxBinaryEnvelope({
      version: 3, mediaType: 'audio', source: 'system_audio', sessionId: 's', inputId: 'i',
      capturedAtMs: 1, format: 'pcm', turnId: 'turn', systemAudioRequired: true,
      body: new Uint8Array([1])
    })).toThrow(AdvxBinaryCodecError)

    const headerLength = new DataView(v3.buffer, v3.byteOffset, v3.byteLength).getUint32(5, false)
    const raw = new TextDecoder().decode(v3.subarray(9, 9 + headerLength))
    const invalid = new TextEncoder().encode(raw.replace('"microphone"', '"system_audio"'))
    const hostile = new Uint8Array(9 + invalid.length + 3)
    hostile.set(v3.subarray(0, 9), 0)
    new DataView(hostile.buffer).setUint32(5, invalid.length, false)
    hostile.set(invalid, 9)
    hostile.set(v3.subarray(9 + headerLength), 9 + invalid.length)
    expect(() => decodeAdvxBinaryEnvelope(hostile)).toThrow(AdvxBinaryCodecError)
  })
})
