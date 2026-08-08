import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  ExecutionGuard,
  fileIdentity,
  parseNamedArguments,
  parsePositiveInteger,
  requireSafeArtifactRoot,
  runMachineCli,
  SCRIPT_EXIT,
  ScriptError,
  writeJsonAtomic
} from './evidence-script-runtime.ts'

const repositoryRoot = resolve(import.meta.dir, '..')

await runMachineCli(async () => {
  const args = parseNamedArguments(
    Bun.argv.slice(2),
    new Set(['--artifact-root', '--timeout-ms'])
  )
  const artifactArgument = args.get('--artifact-root')
  if (artifactArgument === undefined) {
    throw new ScriptError(SCRIPT_EXIT.usage, '--artifact-root is required')
  }
  const artifactRoot = requireSafeArtifactRoot(artifactArgument, repositoryRoot)
  const timeoutMs = parsePositiveInteger(args.get('--timeout-ms') ?? '30000', '--timeout-ms')
  const input = join(repositoryRoot, 'apps', 'backend-bun', 'openapi', 'advx-control-plane.openapi.json')
  const checkedIn = join(
    repositoryRoot,
    'packages',
    'contracts',
    'src',
    'generated',
    'bun-control-openapi.ts'
  )
  const workRoot = join(artifactRoot, '.work')
  const generated = join(workRoot, 'bun-control-openapi.ts')
  const generator = join(repositoryRoot, 'node_modules', 'openapi-typescript', 'bin', 'cli.js')
  const guard = new ExecutionGuard(timeoutMs)
  guard.addCleanup(() => rm(workRoot, { recursive: true, force: true }))

  try {
    await rm(artifactRoot, { recursive: true, force: true })
    await mkdir(workRoot, { recursive: true })
    const child = Bun.spawn(
      [process.env.ADVX_NODE_EXECUTABLE?.trim() || 'node', generator, input, '-o', generated],
      {
        cwd: repositoryRoot,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
        windowsHide: true
      }
    )
    guard.addCleanup(async () => {
      if (child.exitCode === null) child.kill('SIGKILL')
      await child.exited
    })
    const stdoutPromise = new Response(child.stdout).text()
    const stderrPromise = new Response(child.stderr).text()
    const exitCode = await guard.race(child.exited)
    const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
    if (exitCode !== 0) {
      throw new ScriptError(
        SCRIPT_EXIT.verificationFailed,
        `OpenAPI generation exited ${exitCode}: ${(stderr || stdout).trim()}`
      )
    }

    const [generatedBytes, checkedInBytes] = await Promise.all([
      readFile(generated),
      readFile(checkedIn)
    ])
    const generatedIdentity = await fileIdentity(generated, 'generated/bun-control-openapi.ts')
    const checkedInIdentity = await fileIdentity(
      checkedIn,
      'packages/contracts/src/generated/bun-control-openapi.ts'
    )
    if (!generatedBytes.equals(checkedInBytes)) {
      throw new ScriptError(
        SCRIPT_EXIT.verificationFailed,
        'Bun control OpenAPI generated types are stale; run bun run contracts:bun-openapi'
      )
    }

    const result = {
      schema_version: 1,
      task_id: 'TST-009',
      status: 'passed',
      parser: 'openapi-typescript',
      input: 'apps/backend-bun/openapi/advx-control-plane.openapi.json',
      generated: generatedIdentity,
      checked_in: checkedInIdentity,
      byte_equal: true,
      product_data_mutated: false,
      runtime: { bun: Bun.version, platform: process.platform }
    } as const
    await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
    return result
  } finally {
    await guard.close()
  }
})
