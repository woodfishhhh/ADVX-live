import type { BackendRuntime } from '../../shared/contracts'

export const BACKEND_RUNTIMES = [
  'bun-source',
  'bun-compiled'
] as const satisfies readonly BackendRuntime[]

export type BackendRuntimeResolutionOptions = {
  packaged?: boolean
}

export function resolveBackendRuntime(
  runtime = process.env.ADVX_BACKEND_RUNTIME,
  options: BackendRuntimeResolutionOptions = {}
): BackendRuntime {
  const requested = runtime?.trim().toLowerCase()
  if (options.packaged) return 'bun-compiled'
  if (requested === 'bun-source') return 'bun-source'
  if (requested === 'bun-compiled') return 'bun-compiled'
  return 'bun-source'
}
