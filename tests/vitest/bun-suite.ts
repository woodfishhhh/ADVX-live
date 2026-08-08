import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const maxOutputBytes = 16 * 1024 * 1024

export type BunTestResult = {
  exitCode: number
  signal: NodeJS.Signals | null
  stderr: string
  stdout: string
  timedOut: boolean
}

async function walk(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? walk(path) : [path]
  }))
  return files.flat()
}

export async function collectTestFiles(
  directory: string,
  accept: (path: string) => boolean
): Promise<string[]> {
  const absoluteDirectory = resolve(repositoryRoot, directory)
  const files = await walk(absoluteDirectory)

  return files
    .map((path) => relative(repositoryRoot, path).split(sep).join('/'))
    .filter(accept)
    .sort()
}

export async function runBunTests(
  files: string[],
  options: {
    processTimeoutMs: number
    testTimeoutMs?: number
  }
): Promise<BunTestResult> {
  const testTimeoutMs = options.testTimeoutMs ?? 15_000
  return runBunCommand(
    ['test', '--timeout', String(testTimeoutMs), ...files],
    options.processTimeoutMs
  )
}

export async function runBunCommand(
  args: string[],
  processTimeoutMs: number
): Promise<BunTestResult> {
  const executable = process.env.ADVX_BUN_EXECUTABLE?.trim() || 'bun'

  return new Promise((resolveResult) => {
    execFile(
      executable,
      args,
      {
        cwd: repositoryRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          FORCE_COLOR: '0',
          NO_COLOR: '1'
        },
        killSignal: 'SIGKILL',
        maxBuffer: maxOutputBytes,
        timeout: processTimeoutMs,
        windowsHide: true
      },
      (error, stdout, stderr) => {
        resolveResult({
          exitCode: typeof error?.code === 'number' ? error.code : error ? 1 : 0,
          signal: error?.signal ?? null,
          stderr,
          stdout,
          timedOut: Boolean(error?.killed)
        })
      }
    )
  })
}

export function formatBunFailure(result: BunTestResult): string {
  return [
    `Bun process failed with exit code ${result.exitCode}`,
    result.timedOut ? 'The bounded Bun process timed out.' : '',
    result.signal ? `Signal: ${result.signal}` : '',
    result.stdout.trim(),
    result.stderr.trim()
  ].filter(Boolean).join('\n\n')
}
