import { readFile, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

import {
  fileIdentity,
  parseNamedArguments,
  readJsonFile,
  requireSafeArtifactRoot,
  runMachineCli,
  SCRIPT_EXIT,
  ScriptError,
  writeJsonAtomic
} from './evidence-script-runtime.ts'

type JsonRecord = Record<string, unknown>

const repositoryRoot = resolve(import.meta.dir, '..')
const backendRoot = join(repositoryRoot, 'apps', 'backend-bun')
const args = parseNamedArguments(
  Bun.argv.slice(2),
  new Set(['--artifact-root', '--windows-result', '--security-result'])
)
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ??
    join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'cut-004'),
  repositoryRoot
)
const liveProofPath = join(artifactRoot, 'credentialed-live.json')
const windowsRoot = join(artifactRoot, 'windows-installed')
const securityRoot = join(artifactRoot, 'security')
const reusedWindowsResult = safeArtifactFile(args.get('--windows-result'))
const reusedSecurityResult = safeArtifactFile(args.get('--security-result'))
const decisionPath = join(
  repositoryRoot,
  'docs',
  'migrations',
  'typescript-bun',
  'CUT-004-FINAL-EXTERNAL-EVIDENCE.md'
)

const acceptedArtifactPaths = {
  product: join(
    repositoryRoot,
    '.omx',
    'artifacts',
    'typescript-bun',
    'CUT-002',
    'cut-002-checker-root-20260808-126',
    'result.json'
  ),
  legacyData: join(
    repositoryRoot,
    '.omx',
    'artifacts',
    'typescript-bun',
    'CUT-003',
    'cut-003-checker-root-20260808-128',
    'result.json'
  ),
  platformLimitation: join(
    repositoryRoot,
    '.omx',
    'artifacts',
    'typescript-bun',
    'PKG-011',
    'pkg-011-limitation-checker-root-20260808-116',
    'result.json'
  )
} as const

const providerSourcePaths = [
  'apps/backend-bun/scripts/agt-015-live-proof.ts',
  'apps/backend-bun/src/providers/asr/stepfun-asr-provider.ts',
  'apps/backend-bun/src/providers/model/model-gateway.ts',
  'apps/backend-bun/src/application/ports/providers.ts',
  'apps/backend-bun/src/application/ports/tasks.ts',
  'apps/backend-bun/src/testing/tst-005-provider-faults.test.ts'
] as const

function verify(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScriptError(SCRIPT_EXIT.verificationFailed, message)
}

function safeArtifactFile(candidate: string | undefined): string | undefined {
  if (candidate === undefined) return undefined
  const path = resolve(candidate)
  requireSafeArtifactRoot(dirname(path), repositoryRoot)
  return path
}

function asRecord(value: unknown, label: string): JsonRecord {
  verify(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} is not an object`)
  return value as JsonRecord
}

function nested(record: JsonRecord, key: string, label: string): JsonRecord {
  return asRecord(record[key], `${label}.${key}`)
}

async function run(
  command: readonly string[],
  cwd: string,
  options: Readonly<{ live?: boolean }> = {}
): Promise<{ readonly stdout: string; readonly stderr: string }> {
  const child = Bun.spawn([...command], {
    cwd,
    env: options.live
      ? { ...process.env, AGT015_LIVE_CONSENT: '1' }
      : process.env,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true
  })
  const stdoutPromise = new Response(child.stdout).text()
  const stderrPromise = new Response(child.stderr).text()
  const exitCode = await child.exited
  const stdout = await stdoutPromise
  const stderr = await stderrPromise
  if (exitCode !== 0) {
    const detail = options.live ? '' : `: ${(stderr || stdout).slice(-2_000)}`
    throw new ScriptError(
      SCRIPT_EXIT.verificationFailed,
      `${options.live ? 'credentialed live proof' : command[1] ?? command[0]} failed with exit ${exitCode}${detail}`
    )
  }
  return { stdout, stderr }
}

await runMachineCli(async () => {
  verify(process.platform === 'win32' && process.arch === 'x64', 'CUT-004 requires Windows x64')
  verify(Bun.version === '1.3.14', `CUT-004 requires Bun 1.3.14, got ${Bun.version}`)
  verify(Bun.env.CUT004_LIVE_CONSENT === '1', 'CUT-004 requires CUT004_LIVE_CONSENT=1')
  verify(Boolean(Bun.env.STEPFUN_API_KEY?.trim()), 'CUT-004 requires STEPFUN_API_KEY')

  await rm(artifactRoot, { recursive: true, force: true })
  const decision = await readFile(decisionPath, 'utf8')
  for (const clause of [
    'Windows x64 only',
    'Fresh credentialed StepFun request',
    'Authorized `PKG-011` Windows-only accepted limitation',
    'Python backend',
    'remains the parity oracle',
    'Credentials and',
    'raw private content are never written'
  ]) {
    verify(decision.includes(clause), `CUT-004 decision is missing: ${clause}`)
  }

  const head = (await run(['git', 'rev-parse', 'HEAD'], repositoryRoot)).stdout.trim()
  const branch = (await run(['git', 'branch', '--show-current'], repositoryRoot)).stdout.trim()
  verify(branch === 'TS_backend_refactor', `unexpected branch: ${branch}`)

  const liveCommand = await run(
    [process.execPath, 'run', 'scripts/agt-015-live-proof.ts'],
    backendRoot,
    { live: true }
  )
  let liveResult: JsonRecord
  try {
    liveResult = asRecord(JSON.parse(liveCommand.stdout.trim()) as unknown, 'credentialed live result')
  } catch (error) {
    if (error instanceof ScriptError) throw error
    throw new ScriptError(SCRIPT_EXIT.verificationFailed, 'credentialed live proof returned invalid JSON')
  }
  verify(liveResult.evidenceClass === 'credentialed_live', 'live evidence class drifted')
  const destination = nested(liveResult, 'destination', 'live')
  const models = nested(liveResult, 'models', 'live')
  const asr = nested(liveResult, 'asr', 'live')
  const microphone = nested(asr, 'microphone', 'live.asr')
  const systemAudio = nested(asr, 'systemAudio', 'live.asr')
  const model = nested(liveResult, 'model', 'live')
  const viewer = nested(model, 'viewer', 'live.model')
  verify(String(destination.asrBaseUrl).startsWith('https://'), 'ASR destination is not HTTPS')
  verify(String(destination.modelBaseUrl).startsWith('https://'), 'model destination is not HTTPS')
  verify(typeof models.asr === 'string' && models.asr.length > 0, 'ASR model identity is missing')
  verify(typeof models.viewer === 'string' && models.viewer.length > 0, 'Viewer model identity is missing')
  verify(microphone.finalTranscript === true, 'live microphone ASR did not finish')
  verify(systemAudio.finalTranscript === true, 'live system-audio ASR did not finish')
  verify(viewer.ok === true && Number(viewer.outputTextLength) > 0, 'live Viewer request failed')
  verify(JSON.stringify(asr.cancellation) === '["aborted"]', 'ASR cancellation did not normalize')
  verify(JSON.stringify(asr.deadline) === '["timeout"]', 'ASR deadline did not normalize')
  verify(nested(model, 'cancellation', 'live.model').errorCode === 'aborted', 'model cancellation did not normalize')
  verify(nested(model, 'deadline', 'live.model').errorCode === 'timeout', 'model deadline did not normalize')
  verify(
    liveResult.secretHandling === 'API key was read from the environment and never emitted.',
    'live proof secret boundary drifted'
  )

  const providerSources = await Promise.all(
    providerSourcePaths.map((path) => fileIdentity(join(repositoryRoot, path), path))
  )
  const credentialedReceipt = {
    schemaVersion: 1,
    taskId: 'CUT-004',
    evidenceClass: 'credentialed_live',
    recordedAt: new Date().toISOString(),
    buildSha: head,
    branch,
    destination,
    models,
    asr: {
      microphone: { source: microphone.source, finalTranscript: microphone.finalTranscript },
      systemAudio: { source: systemAudio.source, finalTranscript: systemAudio.finalTranscript },
      cancellation: asr.cancellation,
      deadline: asr.deadline
    },
    model: {
      viewer: {
        ok: viewer.ok,
        outputType: viewer.outputType,
        outputTextLength: viewer.outputTextLength,
        finishReason: viewer.finishReason
      },
      cancellation: model.cancellation,
      deadline: model.deadline
    },
    providerSources,
    limitations: [
      'Synthetic PCM and a one-pixel PNG only; no user media was used or persisted.',
      'Current release evidence is Windows x64 only.',
      'The local build is unsigned and no publish or deployment occurred.'
    ],
    secretHandling: 'Credential value inherited by the live child only and omitted from artifacts.'
  }
  await writeJsonAtomic(liveProofPath, credentialedReceipt)

  const errorNormalization = await run(
    [process.execPath, 'test', 'src/providers/model/model-gateway.test.ts'],
    backendRoot
  )
  verify(/\b5 pass\b/u.test(errorNormalization.stderr + errorNormalization.stdout), 'model error tests did not pass all five cases')

  const windowsResultPath = reusedWindowsResult ?? join(windowsRoot, 'result.json')
  const securityResultPath = reusedSecurityResult ?? join(securityRoot, 'result.json')
  if (reusedWindowsResult === undefined) {
    await run(
      [process.execPath, join(repositoryRoot, 'scripts', 'check-pkg-010.ts'), '--artifact-root', windowsRoot],
      repositoryRoot
    )
  }
  if (reusedSecurityResult === undefined) {
    await run(
      [process.execPath, join(repositoryRoot, 'scripts', 'check-pkg-009.ts'), '--artifact-root', securityRoot],
      repositoryRoot
    )
  }

  const windows = asRecord(await readJsonFile(windowsResultPath), 'Windows result')
  const security = asRecord(await readJsonFile(securityResultPath), 'security result')
  const product = asRecord(await readJsonFile(acceptedArtifactPaths.product), 'product result')
  const legacyData = asRecord(await readJsonFile(acceptedArtifactPaths.legacyData), 'legacy-data result')
  const platformLimitation = asRecord(
    await readJsonFile(acceptedArtifactPaths.platformLimitation),
    'platform-limitation result'
  )

  verify(windows.taskId === 'PKG-010' && windows.status === 'passed', 'Windows installed proof failed')
  const target = nested(windows, 'target', 'Windows')
  verify(target.platform === 'win32' && target.arch === 'x64', 'Windows target drifted')
  const orphanAudit = nested(windows, 'orphanAudit', 'Windows')
  verify(orphanAudit.electronOrphan === false && orphanAudit.backendOrphan === false, 'orphan audit failed')
  verify(security.taskId === 'PKG-009' && security.status === 'passed', 'security proof failed')
  verify(nested(security, 'secretScan', 'security').findings === 0, 'secret scan found credentials')
  verify(nested(security, 'bunAudit', 'security').advisoryCount === 0, 'Bun audit found advisories')
  verify(nested(security, 'licenses', 'security').directPolicyFailures === 0, 'license policy failed')
  verify(nested(security, 'sbom', 'security').specVersion === '1.5', 'SBOM is not CycloneDX 1.5')
  verify(product.taskId === 'CUT-002' && product.status === 'passed', 'recorded product matrix is not accepted')
  verify(legacyData.taskId === 'CUT-003' && legacyData.status === 'passed', 'legacy rehearsal is not accepted')
  verify(
    platformLimitation.taskId === 'PKG-011' && platformLimitation.status === 'accepted_limitation',
    'Windows-only limitation is not accepted'
  )

  const acceptedArtifacts = await Promise.all(
    Object.values(acceptedArtifactPaths).map((path) =>
      fileIdentity(path, relative(repositoryRoot, path).replaceAll('\\', '/'))
    )
  )
  const result = {
    schemaVersion: 1,
    taskId: 'CUT-004',
    status: 'passed',
    buildSha: head,
    branch,
    recordedAt: new Date().toISOString(),
    currentReleaseScope: 'Windows x64 only',
    matrix: {
      llmProvider: {
        status: 'passed',
        evidenceClass: 'credentialed_live',
        model: models.viewer,
        cancellation: 'aborted',
        deadline: 'timeout',
        errorNormalizationTests: 5
      },
      asrProvider: {
        status: 'passed',
        evidenceClass: 'credentialed_live',
        model: models.asr,
        sources: ['microphone', 'system_audio'],
        transport: 'HTTP SSE'
      },
      windows: {
        status: 'passed',
        installedEndToEnd: true,
        restart: true,
        uninstall: true,
        orphanCount: 0
      },
      macos: {
        status: 'accepted_limitation',
        currentReleaseClaimRemoved: true
      },
      legacyData: {
        status: 'passed',
        migration: true,
        backup: true,
        restore: true,
        pythonRestart: true
      },
      security: {
        status: 'passed',
        secretFindings: 0,
        advisoryCount: 0,
        directLicenseFailures: 0,
        sbom: 'CycloneDX 1.5'
      },
      product: {
        status: 'passed',
        evidenceClass: 'recorded_deterministic',
        staleOutputs: 0,
        orphanCount: 0
      }
    },
    credentialedEvidence: await fileIdentity(liveProofPath, 'credentialed-live.json'),
    currentEvidence: {
      windows: await fileIdentity(
        windowsResultPath,
        relative(repositoryRoot, windowsResultPath).replaceAll('\\', '/')
      ),
      security: await fileIdentity(
        securityResultPath,
        relative(repositoryRoot, securityResultPath).replaceAll('\\', '/')
      )
    },
    acceptedArtifacts,
    providerSources,
    limitations: credentialedReceipt.limitations,
    pythonOracleChanged: false,
    releaseSideEffects: {
      signing: false,
      publishing: false,
      deployment: false,
      autoUpdate: false
    }
  }
  await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
  return result
})
