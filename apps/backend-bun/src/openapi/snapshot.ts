import { resolve } from 'node:path'
import { serializeAdvxOpenApiDocument } from './document'

const snapshotPath = resolve(import.meta.dir, '../../openapi/advx-control-plane.openapi.json')
const expected = serializeAdvxOpenApiDocument()
const command = process.argv[2] ?? '--check'

if (command === '--write') {
  await Bun.write(snapshotPath, expected)
  console.log(`Wrote ${snapshotPath}`)
} else if (command === '--check') {
  const actual = await Bun.file(snapshotPath).text()
  if (actual !== expected) {
    console.error('OpenAPI snapshot is stale. Run bun run openapi:generate.')
    process.exit(1)
  }
  console.log('OpenAPI snapshot matches the 47-operation registry.')
} else {
  console.error(`Unknown OpenAPI snapshot command: ${command}`)
  process.exit(2)
}
