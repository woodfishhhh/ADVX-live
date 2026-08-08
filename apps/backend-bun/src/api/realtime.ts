import { Elysia } from 'elysia'

import {
  RealtimeHub,
  type RealtimeSocketPort
} from '../application'

export type RealtimeApiOptions = Readonly<{
  maxPayloadLength: number
  backpressureLimit: number
}>

export function createRealtimeApi(
  hub: RealtimeHub,
  options: RealtimeApiOptions
) {
  return new Elysia({ name: 'advx-realtime-api' }).ws('/ws', {
    maxPayloadLength: options.maxPayloadLength,
    backpressureLimit: options.backpressureLimit,
    closeOnBackpressureLimit: true,
    sendPings: false,
    open(ws) {
      hub.open(socketPort(ws), {
        authorization: ws.data.request.headers.get('authorization'),
        desktopClientId: ws.data.request.headers.get('x-advx-client-id')
      })
    },
    message(ws, message) {
      return hub.receive(ws.id, message)
    },
    drain(ws) {
      hub.drain(ws.id)
    },
    ping(ws) {
      hub.alive(ws.id)
    },
    pong(ws) {
      hub.alive(ws.id)
    },
    close(ws) {
      hub.disconnected(ws.id)
    }
  })
}

function socketPort(
  ws: Parameters<NonNullable<Parameters<Elysia['ws']>[1]['open']>>[0]
): RealtimeSocketPort {
  return {
    transportId: ws.id,
    sendText: (value) => ws.sendText(value),
    ping: (value) => ws.ping(value),
    close: (code, reason) => ws.close(code, reason),
    terminate: () => ws.terminate()
  }
}
