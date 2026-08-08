import type { WallClockTimestampMs } from './time'

export type ShutdownReason =
  | 'requested'
  | 'restart'
  | 'signal'
  | 'parent_lost'
  | 'startup_failed'
  | 'fatal_error'

export type ShutdownNotice = {
  readonly requestId: string
  readonly reason: ShutdownReason
  readonly requestedAt: WallClockTimestampMs
  readonly exitCode: number
}

export type ShutdownReceipt = {
  readonly notice: ShutdownNotice
  readonly firstRequest: boolean
}

export interface ProcessShutdownNotifier {
  requestOnce(notice: ShutdownNotice): Promise<ShutdownReceipt>
  whenRequested(): Promise<ShutdownNotice>
}
