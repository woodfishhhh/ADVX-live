import type { TaskScope } from './tasks'

export interface FlushableLifecycleResource {
  flush(): void | Promise<void>
}

export interface DatabaseLifecycleResource extends FlushableLifecycleResource {
  close(): void | Promise<void>
}

export type ProcessLifecycleResources = Readonly<{
  initialize?: (signal: AbortSignal) => void | Promise<void>
  taskScopes?: readonly TaskScope[]
  database?: DatabaseLifecycleResource
  traces?: FlushableLifecycleResource
  logs?: FlushableLifecycleResource
}>
