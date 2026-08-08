import type { BackendRuntime } from '../../shared/contracts'

export const BACKEND_RUNTIMES = [
  'python-oracle',
  'bun-source',
  'bun-compiled'
] as const satisfies readonly BackendRuntime[]

export type BackendKind = 'python' | 'bun'

export type BackendRuntimeResolutionOptions = {
  packaged?: boolean
}

export function resolveBackendRuntime(
  runtime = process.env.ADVX_BACKEND_RUNTIME,
  options: BackendRuntimeResolutionOptions = {}
): BackendRuntime {
  const requested = runtime?.trim().toLowerCase()
  if (options.packaged) return 'bun-compiled'
  if (requested === 'python-oracle') return 'python-oracle'
  if (requested === 'bun-source') return 'bun-source'
  if (requested === 'bun-compiled') return 'bun-compiled'
  return 'bun-source'
}

export function backendKindForRuntime(runtime: BackendRuntime): BackendKind {
  return runtime === 'python-oracle' ? 'python' : 'bun'
}

export function runtimeForBackendKind(kind: BackendKind): BackendRuntime {
  return kind === 'python' ? 'python-oracle' : 'bun-source'
}
