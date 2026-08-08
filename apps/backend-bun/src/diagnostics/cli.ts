import { createDiagnosticsBundle, type DiagnosticsBundleInput } from '../infrastructure'

const inputText = await new Response(Bun.stdin).text()
try {
  const input = JSON.parse(inputText) as DiagnosticsBundleInput
  const result = await createDiagnosticsBundle(input)
  process.stdout.write(`${JSON.stringify({ schema_version: 1, ok: true, manifest: result.manifest })}\n`)
} catch (error) {
  const code = error instanceof Error && 'code' in error
    ? String((error as { code?: unknown }).code ?? 'diagnostics_bundle_failed')
    : 'diagnostics_bundle_failed'
  process.stdout.write(`${JSON.stringify({ schema_version: 1, ok: false, error: { code } })}\n`)
  process.exitCode = 2
}
