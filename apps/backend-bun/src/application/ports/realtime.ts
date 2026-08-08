import type {
  RealtimeEnvelope,
  SessionSnapshot
} from '@advx/contracts'

export type RealtimeWireFamily = 'canonical-envelope' | 'legacy-v3-v4'

export interface RealtimeSocketPort {
  readonly transportId: string
  sendText(value: string): number
  ping(value?: string): number
  close(code: number, reason: string): void
  terminate(): void
}

export interface RealtimeSessionReader {
  currentSession(): SessionSnapshot | Promise<SessionSnapshot>
}

export type RealtimePublicationResult = Readonly<{
  acceptedConnections: number
  rejectedConnections: number
}>

export interface RealtimePublisher {
  publish(envelope: RealtimeEnvelope): Promise<RealtimePublicationResult>
}
