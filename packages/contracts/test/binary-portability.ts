import {
  decodeAdvxBinaryEnvelope,
  encodeAdvxBinaryEnvelope
} from '../src/binary/index'
import { pythonBinaryFixtureHex } from './fixtures/binary/corpus'

let bytes = 0
for (const hex of Object.values(pythonBinaryFixtureHex)) {
  const fixture = Uint8Array.from(hex.match(/../g)!, (byte) => Number.parseInt(byte, 16))
  const padded = new Uint8Array(fixture.length + 4)
  padded.set(fixture, 2)
  const decoded = decodeAdvxBinaryEnvelope(padded.subarray(2, 2 + fixture.length))
  const encoded = encodeAdvxBinaryEnvelope({ ...decoded.header, body: decoded.body })
  if (encoded.length !== fixture.length || encoded.some((value, index) => value !== fixture[index])) {
    throw new Error('portable Python fixture round trip failed')
  }
  bytes += fixture.length
}
globalThis.console.log(JSON.stringify({ fixtures: Object.keys(pythonBinaryFixtureHex).length, bytes }))
