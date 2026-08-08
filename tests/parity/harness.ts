import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export type NondeterminismKind = 'volatile-id' | 'timestamp'

export interface NondeterminismRule {
  path: string
  kind: NondeterminismKind
}

export interface ParityOutput {
  json: unknown
  binary: Uint8Array
}

export interface ParityDiff {
  channel: 'json' | 'binary' | 'nondeterminism'
  path: string
  expected: unknown
  actual: unknown
  message: string
}

export interface CommandResult {
  role: 'oracle' | 'decode' | 'candidate'
  command: string
  exitCode: number
  status: 'passed' | 'failed'
  timedOut: boolean
  stdout: string
  stderr: string
}

export interface ParityCaseReport {
  schemaVersion: 1
  caseId: string
  status: 'passed' | 'failed'
  proofScope: 'migration-fixture-harness'
  productParityClaimed: false
  commands: CommandResult[]
  nondeterminism: NondeterminismRule[]
  diffs: ParityDiff[]
  temporaryDataDirectory: {
    path: string
    environmentVariable: 'ADVX_DATA_DIR'
    cleanupAttempted: boolean
    existsAfterCleanup: boolean
  }
}

const nondeterminismKinds = new Set<NondeterminismKind>([
  'volatile-id',
  'timestamp'
])

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value))
}

function getPath(root: unknown, path: string): { found: boolean; value: unknown } {
  const segments = path.split('.').filter(Boolean)
  let cursor = root
  for (const segment of segments) {
    if (
      cursor === null ||
      typeof cursor !== 'object' ||
      !(segment in cursor)
    ) {
      return { found: false, value: undefined }
    }
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return { found: true, value: cursor }
}

function setPath(root: unknown, path: string, value: unknown): boolean {
  const segments = path.split('.').filter(Boolean)
  if (segments.length === 0) {
    return false
  }
  let cursor = root
  for (const segment of segments.slice(0, -1)) {
    if (
      cursor === null ||
      typeof cursor !== 'object' ||
      !(segment in cursor)
    ) {
      return false
    }
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  if (cursor === null || typeof cursor !== 'object') {
    return false
  }
  const record = cursor as Record<string, unknown>
  record[segments.at(-1)!] = value
  return true
}

function collectJsonDiffs(
  expected: unknown,
  actual: unknown,
  path = '$'
): ParityDiff[] {
  if (Object.is(expected, actual)) {
    return []
  }
  if (
    expected === null ||
    actual === null ||
    typeof expected !== 'object' ||
    typeof actual !== 'object'
  ) {
    return [{
      channel: 'json',
      path,
      expected,
      actual,
      message: 'JSON values differ'
    }]
  }

  const expectedRecord = expected as Record<string, unknown>
  const actualRecord = actual as Record<string, unknown>
  const keys = [...new Set([
    ...Object.keys(expectedRecord),
    ...Object.keys(actualRecord)
  ])].sort()
  return keys.flatMap((key) =>
    collectJsonDiffs(
      expectedRecord[key],
      actualRecord[key],
      `${path}.${key}`
    )
  )
}

export function compareParity(
  expected: ParityOutput,
  actual: ParityOutput,
  rules: readonly NondeterminismRule[]
): ParityDiff[] {
  const expectedJson = cloneJson(expected.json)
  const actualJson = cloneJson(actual.json)
  const classificationDiffs: ParityDiff[] = []

  for (const rule of rules) {
    if (!nondeterminismKinds.has(rule.kind)) {
      classificationDiffs.push({
        channel: 'nondeterminism',
        path: rule.path,
        expected: [...nondeterminismKinds],
        actual: rule.kind,
        message: 'Unsupported nondeterminism classification'
      })
      continue
    }
    const expectedPath = getPath(expectedJson, rule.path)
    const actualPath = getPath(actualJson, rule.path)
    if (!expectedPath.found || !actualPath.found) {
      classificationDiffs.push({
        channel: 'nondeterminism',
        path: rule.path,
        expected: expectedPath.found,
        actual: actualPath.found,
        message: 'Expected nondeterminism path must exist in both outputs'
      })
      continue
    }
    const marker = `<${rule.kind}>`
    setPath(expectedJson, rule.path, marker)
    setPath(actualJson, rule.path, marker)
  }

  const diffs = [
    ...classificationDiffs,
    ...collectJsonDiffs(expectedJson, actualJson)
  ]
  if (!Buffer.from(expected.binary).equals(Buffer.from(actual.binary))) {
    diffs.push({
      channel: 'binary',
      path: '$binary',
      expected: Buffer.from(expected.binary).toString('base64'),
      actual: Buffer.from(actual.binary).toString('base64'),
      message: 'Binary outputs differ'
    })
  }
  return diffs
}

export async function runCommand(
  command: readonly string[],
  environment: Record<string, string>,
  timeoutMs = 30_000
): Promise<CommandResult> {
  const subprocess = Bun.spawn([...command], {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    stdout: 'pipe',
    stderr: 'pipe'
  })
  let timedOut = false
  const timeout = setTimeout(() => {
    timedOut = true
    subprocess.kill()
  }, timeoutMs)
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
    subprocess.exited
  ])
  clearTimeout(timeout)
  return {
    role: 'oracle',
    command: command.join(' '),
    exitCode,
    status: exitCode === 0 && !timedOut ? 'passed' : 'failed',
    timedOut,
    stdout: stdout.trim(),
    stderr: timedOut
      ? `${stderr.trim()}\nCommand exceeded ${timeoutMs}ms timeout`.trim()
      : stderr.trim()
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function runParityCase(options: {
  caseId: string
  oracleCommand: readonly string[]
  candidateCommand: string
  candidate: () => Promise<ParityOutput> | ParityOutput
  decodeOracle: (stdout: string) => ParityOutput
  nondeterminism: readonly NondeterminismRule[]
  reportPath: string
}): Promise<ParityCaseReport> {
  const temporaryDataDirectory = await mkdtemp(join(tmpdir(), 'advx-parity-'))
  let cleanupAttempted = false
  let oracle: CommandResult | undefined
  let decode: CommandResult = {
    role: 'decode',
    command: 'decode:python-oracle-output',
    exitCode: -1,
    status: 'failed',
    timedOut: false,
    stdout: '',
    stderr: 'Decode did not run'
  }
  let candidate: CommandResult = {
    role: 'candidate',
    command: options.candidateCommand,
    exitCode: -1,
    status: 'failed',
    timedOut: false,
    stdout: '',
    stderr: 'Candidate did not run'
  }
  let diffs: ParityDiff[] = []

  try {
    try {
      oracle = await runCommand(options.oracleCommand, {
        ADVX_DATA_DIR: temporaryDataDirectory,
        PYTHONUTF8: '1'
      })
    } catch (error) {
      oracle = {
        role: 'oracle',
        command: options.oracleCommand.join(' '),
        exitCode: -1,
        status: 'failed',
        timedOut: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error)
      }
    }
    if (oracle.status !== 'passed') {
      diffs = [{
        channel: 'json',
        path: '$command',
        expected: { exitCode: 0, timedOut: false },
        actual: {
          exitCode: oracle.exitCode,
          timedOut: oracle.timedOut
        },
        message: 'Python oracle command failed'
      }]
    } else {
      let oracleOutput: ParityOutput | undefined
      let candidateOutput: ParityOutput | undefined
      try {
        oracleOutput = options.decodeOracle(oracle.stdout)
        decode = {
          ...decode,
          exitCode: 0,
          status: 'passed',
          stdout: 'oracle output decoded',
          stderr: ''
        }
      } catch (error) {
        decode.stderr = error instanceof Error ? error.message : String(error)
        diffs.push({
          channel: 'json',
          path: '$decode',
          expected: 'decodable oracle output',
          actual: decode.stderr,
          message: 'Python oracle output could not be decoded'
        })
      }
      try {
        candidateOutput = await options.candidate()
        candidate = {
          ...candidate,
          exitCode: 0,
          status: 'passed',
          stdout: 'deterministic TypeScript fixture',
          stderr: ''
        }
      } catch (error) {
        candidate.stderr = error instanceof Error ? error.message : String(error)
        diffs.push({
          channel: 'json',
          path: '$candidate',
          expected: 'successful candidate fixture',
          actual: candidate.stderr,
          message: 'TypeScript candidate fixture failed'
        })
      }
      if (oracleOutput && candidateOutput) {
        diffs.push(...compareParity(
          oracleOutput,
          candidateOutput,
          options.nondeterminism
        ))
      }
    }
  } finally {
    cleanupAttempted = true
    await rm(temporaryDataDirectory, { recursive: true, force: true })
  }

  const report: ParityCaseReport = {
    schemaVersion: 1,
    caseId: options.caseId,
    status:
      oracle?.status === 'passed' &&
      decode.status === 'passed' &&
      candidate.status === 'passed' &&
      diffs.length === 0
        ? 'passed'
        : 'failed',
    proofScope: 'migration-fixture-harness',
    productParityClaimed: false,
    commands: [
      oracle ?? {
        role: 'oracle',
        command: options.oracleCommand.join(' '),
        exitCode: -1,
        status: 'failed',
        timedOut: false,
        stdout: '',
        stderr: 'Oracle command did not complete'
      },
      decode,
      candidate
    ],
    nondeterminism: [...options.nondeterminism],
    diffs,
    temporaryDataDirectory: {
      path: temporaryDataDirectory,
      environmentVariable: 'ADVX_DATA_DIR',
      cleanupAttempted,
      existsAfterCleanup: await pathExists(temporaryDataDirectory)
    }
  }
  await mkdir(dirname(options.reportPath), { recursive: true })
  await writeFile(options.reportPath, `${JSON.stringify(report, null, 2)}\n`)
  return report
}
