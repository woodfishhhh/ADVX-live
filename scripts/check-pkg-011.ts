import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  fileIdentity,
  parseNamedArguments,
  requireSafeArtifactRoot,
  writeJsonAtomic
} from './evidence-script-runtime.ts'

const repositoryRoot = resolve(import.meta.dir, '..')
const desktopRoot = join(repositoryRoot, 'apps', 'desktop')
const backendEntry = join(repositoryRoot, 'apps', 'backend-bun', 'src', 'main.ts')
const electronBuilderCli = join(desktopRoot, 'node_modules', 'electron-builder', 'cli.js')
const electronBuilderConfig = join(desktopRoot, 'electron-builder.yml')
const workflowPath = join(repositoryRoot, '.github', 'workflows', 'bun-ci.yml')
const limitationDecisionPath = join(
  repositoryRoot,
  'docs',
  'migrations',
  'typescript-bun',
  'PKG-011-MACOS-LIMITATION-DECISION.md'
)
const platformDecisionPath = join(
  repositoryRoot,
  'docs',
  'migrations',
  'typescript-bun',
  'ADR-MIG-004.md'
)
const runtimeCompatibilityPath = join(
  repositoryRoot,
  'docs',
  'migrations',
  'typescript-bun',
  'RUNTIME-COMPATIBILITY.md'
)
const docsReadmePath = join(repositoryRoot, 'docs', 'README.md')
const productPath = join(repositoryRoot, 'docs', 'PRODUCT.md')
const decisionsPath = join(repositoryRoot, 'docs', 'DECISIONS.md')
const realPipelinePath = join(repositoryRoot, 'docs', 'REAL_PIPELINE.md')
const rootPackagePath = join(repositoryRoot, 'package.json')
const args = parseNamedArguments(
  Bun.argv.slice(2),
  new Set(['--artifact-root', '--mode'])
)
const mode = args.get('--mode') ?? 'platform'
if (mode !== 'platform' && mode !== 'accepted-limitation') {
  throw new Error('--mode must be platform or accepted-limitation')
}
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ?? join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'pkg-011'),
  repositoryRoot
)
const crossBuildRoot = join(artifactRoot, 'cross-build')
const nodeCommand = process.env.npm_node_execpath ?? 'node'

type CommandResult = Readonly<{
  command: readonly string[]
  exitCode: number
  stdout: string
  stderr: string
  durationMs: number
}>

function commandLabel(command: readonly string[]): string {
  return command.join(' ')
}

async function runCommand(command: readonly string[], cwd = repositoryRoot): Promise<CommandResult> {
  const startedAt = Date.now()
  const child = Bun.spawn([...command], {
    cwd,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true
  })
  const stdoutPromise = new Response(child.stdout).text()
  const stderrPromise = new Response(child.stderr).text()
  return {
    command,
    exitCode: await child.exited,
    stdout: await stdoutPromise,
    stderr: await stderrPromise,
    durationMs: Date.now() - startedAt
  }
}

async function recordCommand(result: CommandResult, name: string): Promise<JsonRecord> {
  await writeFile(join(crossBuildRoot, `${name}.stdout.txt`), result.stdout, 'utf8')
  await writeFile(join(crossBuildRoot, `${name}.stderr.txt`), result.stderr, 'utf8')
  return {
    command: [...result.command],
    commandLine: commandLabel(result.command),
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdoutPath: join(crossBuildRoot, `${name}.stdout.txt`),
    stderrPath: join(crossBuildRoot, `${name}.stderr.txt`),
    stdoutTail: result.stdout.slice(-2_000),
    stderrTail: result.stderr.slice(-2_000)
  }
}

async function commandAvailable(command: string): Promise<boolean> {
  const result = await runCommand(process.platform === 'win32' ? ['where.exe', command] : ['sh', '-lc', `command -v ${command}`])
  return result.exitCode === 0
}

async function captureBuild(target: 'bun-darwin-arm64' | 'bun-darwin-x64') {
  const output = join(crossBuildRoot, `advx-backend-${target}`)
  const command = [
    process.execPath,
    'build',
    '--compile',
    `--target=${target}`,
    '--sourcemap=none',
    '--env=disable',
    '--no-compile-autoload-dotenv',
    '--no-compile-autoload-bunfig',
    '--no-compile-autoload-package-json',
    '--no-compile-autoload-tsconfig',
    `--outfile=${output}`,
    backendEntry
  ] as const
  const result = await runCommand(command)
  const record = await recordCommand(result, target)
  let artifact: JsonRecord | null = null
  try {
    artifact = await fileIdentity(output, `cross-build/${target}`)
  } catch {
    artifact = null
  }
  return { ...record, output, artifact }
}

type JsonRecord = Record<string, unknown>

type LimitationRequirement = Readonly<{
  path: string
  relativePath: string
  requiredText: readonly string[]
  forbiddenText?: readonly string[]
}>

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

async function checkAcceptedLimitation(): Promise<void> {
  const requirements: readonly LimitationRequirement[] = [
    {
      path: limitationDecisionPath,
      relativePath: 'docs/migrations/typescript-bun/PKG-011-MACOS-LIMITATION-DECISION.md',
      requiredText: [
        '> Status: `ACCEPTED_LIMITATION`',
        '`Windows-only 限制授权`',
        '> Current release scope: Windows x64 only',
        'Revisit owner: the future macOS release owner',
        'before any macOS release candidate, download, signing, notarization, support statement, or public availability'
      ]
    },
    {
      path: platformDecisionPath,
      relativePath: 'docs/migrations/typescript-bun/ADR-MIG-004.md',
      requiredText: [
        'Current release limitation: Windows x64 only',
        'records an authorized `ACCEPTED_LIMITATION`',
        'before a release candidate, download, signing, notarization, support statement, or public availability'
      ]
    },
    {
      path: docsReadmePath,
      relativePath: 'docs/README.md',
      requiredText: [
        '当前发布范围仅支持 Windows x64',
        'macOS 是未发布的未来架构目标'
      ],
      forbiddenText: ['产品目标平台是 Windows 和 macOS']
    },
    {
      path: productPath,
      relativePath: 'docs/PRODUCT.md',
      requiredText: [
        '> 当前发布平台：Windows x64',
        '> macOS：未来架构目标，当前未发布且不在支持范围',
        '当前正式发布与支持平台仅为 Windows x64',
        '不属于当前 MVP 验收'
      ],
      forbiddenText: [
        '> 目标平台：Windows、macOS',
        'Windows 和 macOS 都属于正式目标平台',
        'Windows 和 macOS 上各完成一次从启动到停止的会话'
      ]
    },
    {
      path: decisionsPath,
      relativePath: 'docs/DECISIONS.md',
      requiredText: [
        '当前发布仅支持 Windows x64，macOS 保留架构边界',
        '当前发布与支持',
        '范围仅为 Windows x64',
        '未来 macOS release owner'
      ]
    },
    {
      path: realPipelinePath,
      relativePath: 'docs/REAL_PIPELINE.md',
      requiredText: ['macOS 当前未发布且不在支持范围']
    },
    {
      path: runtimeCompatibilityPath,
      relativePath: 'docs/migrations/typescript-bun/RUNTIME-COMPATIBILITY.md',
      requiredText: [
        '| macOS | arm64 | Accepted limitation for current release |',
        '| macOS | x64 | Accepted limitation for current release |',
        'current release and support scope is Windows x64 only'
      ]
    }
  ]
  const failures: string[] = []
  const reviewedFiles: JsonRecord[] = []

  for (const requirement of requirements) {
    const contents = await readFile(requirement.path, 'utf8')
    const normalizedContents = normalizeWhitespace(contents)
    for (const requiredText of requirement.requiredText) {
      if (!normalizedContents.includes(normalizeWhitespace(requiredText))) {
        failures.push(`${requirement.relativePath}: missing ${JSON.stringify(requiredText)}`)
      }
    }
    for (const forbiddenText of requirement.forbiddenText ?? []) {
      if (normalizedContents.includes(normalizeWhitespace(forbiddenText))) {
        failures.push(`${requirement.relativePath}: forbidden current-release claim ${JSON.stringify(forbiddenText)}`)
      }
    }
    reviewedFiles.push(await fileIdentity(requirement.path, requirement.relativePath))
  }

  const rootPackage = JSON.parse(await readFile(rootPackagePath, 'utf8')) as {
    scripts?: Record<string, string>
  }
  const packageCommand = rootPackage.scripts?.['package:desktop'] ?? ''
  if (!packageCommand.includes('electron-builder --win --x64 --dir')) {
    failures.push('package.json: package:desktop must remain explicitly Windows x64')
  }
  if (packageCommand.includes('--mac')) {
    failures.push('package.json: current package:desktop command must not build macOS')
  }
  reviewedFiles.push(await fileIdentity(rootPackagePath, 'package.json'))

  const result = {
    schemaVersion: 1,
    taskId: 'PKG-011',
    status: failures.length === 0 ? 'accepted_limitation' : 'failed',
    evidenceClass: 'authorized-external-limitation',
    authorization: {
      instruction: 'Windows-only 限制授权',
      date: '2026-08-08',
      authorizedBy: 'human user',
      currentReleaseScope: 'Windows x64 only',
      unsupportedCurrentTargets: ['Windows arm64', 'macOS arm64', 'macOS x64'],
      revisitOwner: 'future macOS release owner',
      revisitTrigger: 'before any macOS release candidate, download, signing, notarization, support statement, or public availability'
    },
    missingProof: [
      'macOS arm64/x64 installed lifecycle and native media behavior',
      'macOS signing and notarization'
    ],
    currentReleaseCommand: packageCommand,
    dormantMacPackageConfigurationRetained: true,
    reviewedFiles,
    failures
  }
  await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (failures.length > 0) process.exit(1)
}

await mkdir(artifactRoot, { recursive: true })
if (mode === 'accepted-limitation') {
  await checkAcceptedLimitation()
  process.exit(0)
}

await mkdir(crossBuildRoot, { recursive: true })
const workflow = await readFile(workflowPath, 'utf8')
const [arm64, x64, electronMac] = await Promise.all([
  captureBuild('bun-darwin-arm64'),
  captureBuild('bun-darwin-x64'),
  (async () => {
    const output = join(crossBuildRoot, 'electron-mac-arm64')
    const result = await runCommand([
      nodeCommand,
      electronBuilderCli,
      '--mac',
      '--arm64',
      '--dir',
      '--projectDir',
      desktopRoot,
      '--config',
      'electron-builder.yml',
      `--config.directories.output=${output}`
    ], desktopRoot)
    return { ...(await recordCommand(result, 'electron-mac-arm64')), output }
  })()
])

const host = {
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  bun: Bun.version,
  os: process.env.OS ?? null,
  runnerOs: process.env.RUNNER_OS ?? null,
  ci: process.env.CI ?? null,
  githubActions: process.env.GITHUB_ACTIONS ?? null,
  macosRunnerWorkflowConfigured: /macos-/.test(workflow),
  xcodebuildAvailable: await commandAvailable('xcodebuild'),
  codesignAvailable: await commandAvailable('codesign')
}

const macRunnerAvailable = host.platform === 'darwin' && host.xcodebuildAvailable
const crossBuildAvailable = Number((arm64 as JsonRecord).exitCode) === 0 && Number((x64 as JsonRecord).exitCode) === 0
const installedProofAvailable = false
const status = macRunnerAvailable && installedProofAvailable ? 'passed' : 'blocked'
const result = {
  schemaVersion: 1,
  taskId: 'PKG-011',
  status,
  evidenceClass: 'platform-cross-build-and-external-availability',
  currentReleaseClaim: 'Windows x64 only; macOS arm64 and macOS x64 remain not released',
  host,
  crossBuild: {
    available: crossBuildAvailable,
    bunDarwinArm64: arm64,
    bunDarwinX64: x64,
    electronMacArm64: electronMac
  },
  installedProof: {
    available: installedProofAvailable,
    reason: 'No macOS hardware or target runner is available in this Windows worktree; cross-build output cannot substitute for installed execution, signing, native dependency, or lifecycle proof.'
  },
  missingAuthorityOrResource: [
    'macOS 13+ arm64 runner or Apple Silicon hardware',
    'Xcode command-line tools and codesign on the target runner',
    'Developer ID/notarization authority if a signed release claim is required'
  ],
  releaseClaimsNotProven: [
    'macOS arm64 installed launch/session/stop/restart/uninstall lifecycle',
    'macOS x64 installed launch/session/stop/restart/uninstall lifecycle',
    'macOS native dependency and microphone/system-audio behavior',
    'macOS signing and notarization'
  ],
  nextExecutableValidation: [
    'Run on a macOS 13+ arm64 runner with Xcode command-line tools installed.',
    'pnpm install --frozen-lockfile',
    'pnpm run typecheck:pkg-011',
    'pnpm exec electron-builder --mac --arm64 --dir --projectDir apps/desktop --config electron-builder.yml --config.directories.output=.omx/artifacts/typescript-bun/PKG-011/macos-arm64',
    'Execute the equivalent packaged CDP/session/recorded-input/overlay/diagnostics/stop/restart/uninstall flow and retain process-tree evidence.',
    'Record codesign/notarization status separately; do not widen the release matrix until the installed proof is accepted.'
  ],
  crossBuildEvidenceRoot: crossBuildRoot,
  source: {
    workflowPath,
    workflowSha256: createHash('sha256').update(workflow).digest('hex'),
    electronBuilderConfig
  }
}
await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
