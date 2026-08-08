import { resolve } from 'node:path'

import {
  parseNamedArguments,
  parsePositiveInteger,
  runMachineCli,
  SCRIPT_EXIT,
  ScriptError
} from './evidence-script-runtime.ts'
import { verifyViewerRuntimeEvidence } from './viewer-runtime-evidence.ts'

const repositoryRoot = resolve(import.meta.dir, '..')

await runMachineCli(async () => {
  const args = parseNamedArguments(
    Bun.argv.slice(2),
    new Set(['--fixture', '--artifact-root', '--timeout-ms'])
  )
  const fixture = args.get('--fixture')
  const artifactRoot = args.get('--artifact-root')
  if (fixture === undefined || artifactRoot === undefined) {
    throw new ScriptError(
      SCRIPT_EXIT.usage,
      '--fixture and --artifact-root are required'
    )
  }
  return verifyViewerRuntimeEvidence({
    fixturePath: resolve(fixture),
    artifactRoot: resolve(artifactRoot),
    repositoryRoot,
    timeoutMs: parsePositiveInteger(args.get('--timeout-ms') ?? '15000', '--timeout-ms')
  })
})
