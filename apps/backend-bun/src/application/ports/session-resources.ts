import type { Epoch, RoomId, SessionId } from '@advx/contracts'

export type SessionResourceIdentity = Readonly<{
  roomId: RoomId
  sessionId: SessionId
  audienceEpoch: Epoch
}>

export interface SessionResources {
  start(identity: SessionResourceIdentity): Promise<void>
  pause(identity: SessionResourceIdentity): Promise<void>
  resume(identity: SessionResourceIdentity): Promise<void>
  recover(identity: SessionResourceIdentity): Promise<void>
  release(identity: SessionResourceIdentity): Promise<void>
}
