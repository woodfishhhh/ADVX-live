import type {
  Epoch,
  Revision,
  RoomId,
  SessionId,
  TimestampMs
} from '@advx/contracts'

export type RoomSessionLifecycleState =
  | 'idle'
  | 'starting'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'stopped'
  | 'degraded'
  | 'failed'

export type RoomSessionLifecycleReason =
  | 'start_requested'
  | 'start_completed'
  | 'pause_requested'
  | 'resume_requested'
  | 'stop_requested'
  | 'stop_completed'
  | 'runtime_degraded'
  | 'runtime_failed'
  | 'recovery_requested'
  | 'recovery_completed'
  | 'runtime_spec_applied'
  | 'runtime_spec_rolled_back'
  | 'resource_operation_failed'

export type RoomSessionSnapshot = Readonly<{
  roomId: RoomId
  sessionId: SessionId | null
  audienceEpoch: Epoch
  revision: Revision
  state: RoomSessionLifecycleState
  recoveryEligible: boolean
  reasonCode: RoomSessionLifecycleReason | null
  createdAt: TimestampMs
  updatedAt: TimestampMs
  startedAt: TimestampMs | null
  endedAt: TimestampMs | null
}>

export function immutableRoomSessionSnapshot(
  snapshot: RoomSessionSnapshot
): RoomSessionSnapshot {
  return Object.freeze({ ...snapshot })
}
