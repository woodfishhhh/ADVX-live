import { HeadlessHarness, HEADLESS_EXIT_CODES } from './headless-harness'

const inputText = await new Response(Bun.stdin).text()
let input: unknown
try {
  input = JSON.parse(inputText)
} catch {
  const output = {
    schema_version: 1,
    ok: false,
    exit_code: HEADLESS_EXIT_CODES.invalidInput,
    error: { code: 'invalid_json' },
    metadata: { proof_scope: 'typescript-headless-fixture' }
  }
  process.stdout.write(`${JSON.stringify(output)}\n`)
  process.exitCode = HEADLESS_EXIT_CODES.invalidInput
}

if (input !== undefined) {
  const result = await new HeadlessHarness().execute(input)
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = result.exit_code
}
