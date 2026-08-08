import { resolve } from 'node:path'

import {
  BUN_PROFILE_MAX_DURATION_MS,
  BUN_PROFILE_MIN_DURATION_MS,
  runBunProfile
} from '../infrastructure/observability/bun-profile-runner'
import {
  collectRuntimeProfile,
  RUNTIME_PROFILE_MAX_DURATION_MS,
  RUNTIME_PROFILE_MIN_DURATION_MS
} from '../infrastructure/observability/runtime-profile'

class CliError extends Error {
  constructor(readonly code: 'invalid_request' | 'profile_failed', message: string) {
    super(message)
  }
}

const [mode, ...arguments_] = Bun.argv.slice(2)
const parsed = parseArguments(arguments_)
const values = parsed.options

try {
  if (mode === 'cpu' || mode === 'heap') {
    const result = await runBunProfile({
      kind: mode,
      outputDirectory: resolve(values['output-dir'] ?? '.advx-data/diagnostics/profiles'),
      durationMs: integerValue(values['duration-ms'], 10_000, BUN_PROFILE_MIN_DURATION_MS, BUN_PROFILE_MAX_DURATION_MS),
      profileName: values.name,
      cwd: values.cwd === undefined ? undefined : resolve(values.cwd),
      command: parsed.command.length === 0 ? ['run', 'src/main.ts'] : parsed.command
    })
    print({ ok: true, result })
  } else if (mode === 'sample') {
    const result = await collectRuntimeProfile({
      outputPath: resolve(values.output ?? '.advx-data/diagnostics/profiles/runtime-samples.json'),
      durationMs: integerValue(values['duration-ms'], 10_000, RUNTIME_PROFILE_MIN_DURATION_MS, RUNTIME_PROFILE_MAX_DURATION_MS),
      intervalMs: integerValue(values.interval, 1_000, 50, 60_000),
      readQueueDepth: values['queue-depth'] === undefined ? undefined : () => integerValue(values['queue-depth'], 0, 0, 1_000_000),
      readProviderLatencyMs: values['provider-latency-ms'] === undefined ? undefined : () => integerValue(values['provider-latency-ms'], 0, 0, 86_400_000)
    })
    print({ ok: true, result })
  } else {
    throw new CliError('invalid_request', 'usage: cpu|heap|sample [options] [-- command]')
  }
} catch (error) {
  const code = error instanceof CliError
    ? error.code
    : error instanceof Error && 'code' in error
      ? String((error as { code?: unknown }).code ?? 'profile_failed')
      : 'profile_failed'
  print({ ok: false, error: { code } })
  process.exitCode = 2
}

function parseArguments(arguments_: readonly string[]): {
  options: Record<string, string | undefined>
  command: readonly string[]
} {
  const values: Record<string, string | undefined> = {}
  const separator = arguments_.indexOf('--')
  const optionArguments = separator < 0 ? arguments_ : arguments_.slice(0, separator)
  const command = separator < 0 ? [] : arguments_.slice(separator + 1)
  for (let index = 0; index < optionArguments.length; index += 1) {
    const argument = optionArguments[index]
    if (!argument.startsWith('--')) throw new CliError('invalid_request', 'profile options must start with --')
    const [key, inlineValue] = argument.slice(2).split('=', 2)
    const value = inlineValue ?? optionArguments[index + 1]
    if (inlineValue === undefined) index += 1
    if (value === undefined || value.startsWith('--')) throw new CliError('invalid_request', `missing value for --${key}`)
    values[key] = value
  }
  return { options: values, command }
}

function integerValue(value: string | readonly string[] | undefined, fallback: number, minimum: number, maximum: number): number {
  const candidate = value === undefined || Array.isArray(value) ? fallback : Number(value)
  if (!Number.isSafeInteger(candidate) || candidate < minimum || candidate > maximum) {
    throw new CliError('invalid_request', 'numeric profile option is out of bounds')
  }
  return candidate
}

function print(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`)
}
