import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, relative, resolve } from 'node:path'

export const SCRIPT_EXIT = {
  success: 0,
  usage: 2,
  invalidInput: 3,
  verificationFailed: 4,
  interrupted: 5,
  unexpected: 10
} as const

export type ScriptExitCode = (typeof SCRIPT_EXIT)[keyof typeof SCRIPT_EXIT]

export class ScriptError extends Error {
  readonly name = 'ScriptError'

  constructor(
    readonly exitCode: ScriptExitCode,
    message: string
  ) {
    super(message)
  }
}

export type FileIdentity = Readonly<{
  path: string
  sha256: string
  bytes: number
}>

export async function readJsonFile(path: string): Promise<unknown> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    throw new ScriptError(
      SCRIPT_EXIT.invalidInput,
      `cannot read JSON input: ${errorMessage(error)}`
    )
  }
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new ScriptError(
      SCRIPT_EXIT.invalidInput,
      `invalid JSON input: ${errorMessage(error)}`
    )
  }
}

export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await rename(temporaryPath, path)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

export async function fileIdentity(path: string, displayPath: string): Promise<FileIdentity> {
  const hash = createHash('sha256')
  let bytes = 0
  try {
    for await (const chunk of createReadStream(path)) {
      hash.update(chunk)
      bytes += chunk.length
    }
  } catch (error) {
    throw new ScriptError(
      SCRIPT_EXIT.invalidInput,
      `cannot hash file: ${errorMessage(error)}`
    )
  }
  return { path: displayPath, sha256: hash.digest('hex'), bytes }
}

export function requireSafeArtifactRoot(
  candidate: string,
  repositoryRoot: string
): string {
  if (candidate.trim() === '') {
    throw new ScriptError(SCRIPT_EXIT.usage, '--artifact-root must not be empty')
  }
  const artifactRoot = resolve(candidate)
  if (!isAbsolute(artifactRoot)) {
    throw new ScriptError(SCRIPT_EXIT.usage, '--artifact-root must resolve absolutely')
  }
  const allowedRepositoryRoot = resolve(repositoryRoot, '.omx', 'artifacts')
  if (
    isInside(artifactRoot, allowedRepositoryRoot) ||
    isInside(artifactRoot, resolve(tmpdir()))
  ) {
    return artifactRoot
  }
  throw new ScriptError(
    SCRIPT_EXIT.usage,
    '--artifact-root must be under .omx/artifacts or the operating-system temp directory'
  )
}

export function parsePositiveInteger(value: string, option: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ScriptError(SCRIPT_EXIT.usage, `${option} must be a positive integer`)
  }
  return parsed
}

export function parseNamedArguments(
  argv: readonly string[],
  allowed: ReadonlySet<string>
): Map<string, string> {
  const values = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]
    const value = argv[index + 1]
    if (name === undefined || value === undefined || !allowed.has(name) || !name.startsWith('--')) {
      throw new ScriptError(SCRIPT_EXIT.usage, 'arguments must be explicit --name value pairs')
    }
    if (values.has(name)) {
      throw new ScriptError(SCRIPT_EXIT.usage, `duplicate argument: ${name}`)
    }
    values.set(name, value)
  }
  return values
}

export class ExecutionGuard {
  readonly signal: AbortSignal
  #controller = new AbortController()
  #cleanup: Array<() => void | Promise<void>> = []
  #timeout: ReturnType<typeof setTimeout>
  #reason: 'timeout' | 'signal' | null = null
  #signalHandler: () => void

  constructor(timeoutMs: number) {
    this.signal = this.#controller.signal
    this.#signalHandler = () => this.#abort('signal')
    process.once('SIGINT', this.#signalHandler)
    process.once('SIGTERM', this.#signalHandler)
    this.#timeout = setTimeout(() => this.#abort('timeout'), timeoutMs)
  }

  addCleanup(cleanup: () => void | Promise<void>): void {
    this.#cleanup.push(cleanup)
  }

  async race<T>(operation: Promise<T>): Promise<T> {
    const interrupted = new Promise<never>((_resolve, reject) => {
      if (this.signal.aborted) {
        reject(this.#interruptionError())
        return
      }
      this.signal.addEventListener(
        'abort',
        () => reject(this.#interruptionError()),
        { once: true }
      )
    })
    return Promise.race([operation, interrupted])
  }

  async close(): Promise<void> {
    clearTimeout(this.#timeout)
    process.removeListener('SIGINT', this.#signalHandler)
    process.removeListener('SIGTERM', this.#signalHandler)
    for (const cleanup of this.#cleanup.reverse()) await cleanup()
  }

  #abort(reason: 'timeout' | 'signal'): void {
    if (this.#controller.signal.aborted) return
    this.#reason = reason
    this.#controller.abort()
  }

  #interruptionError(): ScriptError {
    return new ScriptError(
      SCRIPT_EXIT.interrupted,
      this.#reason === 'timeout' ? 'script timed out' : 'script interrupted by signal'
    )
  }
}

export async function runMachineCli<T>(
  task: () => Promise<T>
): Promise<never> {
  try {
    const result = await task()
    process.stdout.write(`${JSON.stringify({ status: 'passed', result })}\n`)
    process.exit(SCRIPT_EXIT.success)
  } catch (error) {
    const exitCode = error instanceof ScriptError
      ? error.exitCode
      : SCRIPT_EXIT.unexpected
    process.stdout.write(`${JSON.stringify({
      status: 'failed',
      exit_code: exitCode,
      error: errorMessage(error)
    })}\n`)
    process.exit(exitCode)
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isInside(candidate: string, parent: string): boolean {
  const relation = relative(parent, candidate)
  return relation !== '' && !relation.startsWith('..') && !isAbsolute(relation)
}
