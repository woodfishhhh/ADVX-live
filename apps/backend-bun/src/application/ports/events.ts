import type {
  RoomId,
  SafeJsonValue,
  SessionId
} from '@advx/contracts'

import type { WallClockTimestampMs } from './time'
import type { TraceContext } from './observability'

export type ApplicationEvent = {
  readonly eventId: string
  readonly type: string
  readonly occurredAt: WallClockTimestampMs
  readonly roomId?: RoomId
  readonly sessionId?: SessionId
  readonly traceContext?: TraceContext
  readonly payload: SafeJsonValue
}

export interface EventPublisher {
  publish(event: ApplicationEvent): Promise<void>
}
