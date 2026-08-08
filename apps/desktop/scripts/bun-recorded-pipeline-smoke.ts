import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RecordedElectronScenarioResult } from '../../../tests/e2e/electron/recorded-electron.fixture.ts'

import {
  ExecutionGuard,
  parseNamedArguments,
  parsePositiveInteger,
  requireSafeArtifactRoot,
  runMachineCli,
  SCRIPT_EXIT,
  ScriptError
} from '../../../scripts/evidence-script-runtime.ts'
const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(desktopRoot, '..', '..')
const runnerPath = join(repositoryRoot, 'tests', 'e2e', 'electron', 'run-recorded-smoke.ts')

await runMachineCli(async () => {
  const args = parseNamedArguments(
    Bun.argv.slice(2),
    new Set(['--artifact-root', '--timeout-ms'])
  )
  const artifactArgument = args.get('--artifact-root')
  if (artifactArgument === undefined) {
    throw new ScriptError(SCRIPT_EXIT.usage, '--artifact-root is required')
  }
  const artifactDirectory = requireSafeArtifactRoot(artifactArgument, repositoryRoot)
  const timeoutMs = parsePositiveInteger(args.get('--timeout-ms') ?? '60000', '--timeout-ms')
  const guard = new ExecutionGuard(timeoutMs)

  try {
    const child = Bun.spawn([process.env.ADVX_NODE_EXECUTABLE?.trim() || 'node', runnerPath], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ADVX_RECORDED_SMOKE_ARTIFACT_ROOT: artifactDirectory
      },
      stdin: 'ignore',
      stdout: 'inherit',
      stderr: 'inherit',
      windowsHide: true
    })
    guard.addCleanup(async () => {
      if (child.exitCode !== null) return
      const killer = Bun.spawn(['taskkill.exe', '/pid', String(child.pid), '/t', '/f'], {
        stdin: 'ignore',
        stdout: 'ignore',
        stderr: 'ignore',
        windowsHide: true
      })
      await killer.exited
      await child.exited
    })
    const exitCode = await guard.race(child.exited)
    const result = JSON.parse(
      await readFile(join(artifactDirectory, 'result.json'), 'utf8')
    ) as RecordedElectronScenarioResult
    if (exitCode !== 0 || result.status !== 'passed') {
      throw new ScriptError(
        SCRIPT_EXIT.verificationFailed,
        `recorded Electron smoke failed: ${result.failure?.message ?? `Node exited ${exitCode}`}`
      )
    }
    const proof = {
      status: result.status,
      proof_scope: 'electron-supervised-bun-recorded-full-pipeline',
      backend_runtime: result.backend_runtime,
      inputs: result.inputs,
      barrage: result.barrage,
      overlay: result.overlay,
      traces: result.traces,
      isolation: result.isolation,
      diagnostics: result.diagnostics,
      cleanup: result.cleanup,
      consolidated_fixture: '../../../tests/e2e/electron/recorded-electron.fixture.ts'
    }
    const proofPath = join(artifactDirectory, 'proof.json')
    await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`, 'utf8')
    return { proof: 'proof.json', result: proof }
  } finally {
    await guard.close()
  }
})
