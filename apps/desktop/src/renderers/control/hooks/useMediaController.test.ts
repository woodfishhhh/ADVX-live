import { describe, expect, it } from 'vitest'
import {
  canStartLive,
  resolveAudioChannelStatus,
  shouldStopCaptureOnBackendLoss
} from './useMediaController'

describe('backend loss capture policy', () => {
  it('stops an active audience capture when a connected backend is lost', () => {
    expect(shouldStopCaptureOnBackendLoss({
      previousBackendConnected: true,
      backendConnected: false,
      audienceSessionActive: true,
      sessionStatus: 'running'
    })).toBe(true)
  })

  it('does not stop local preview or an already idle session', () => {
    expect(shouldStopCaptureOnBackendLoss({
      previousBackendConnected: true,
      backendConnected: false,
      audienceSessionActive: false,
      sessionStatus: 'running'
    })).toBe(false)
    expect(shouldStopCaptureOnBackendLoss({
      previousBackendConnected: true,
      backendConnected: false,
      audienceSessionActive: true,
      sessionStatus: 'idle'
    })).toBe(false)
  })

  it('does not trigger for a startup or reconnection state without a prior connection', () => {
    expect(shouldStopCaptureOnBackendLoss({
      previousBackendConnected: false,
      backendConnected: false,
      audienceSessionActive: true,
      sessionStatus: 'starting'
    })).toBe(false)
    expect(shouldStopCaptureOnBackendLoss({
      previousBackendConnected: true,
      backendConnected: true,
      audienceSessionActive: true,
      sessionStatus: 'paused'
    })).toBe(false)
  })

  it('keeps microphone and system-audio presentation status independent', () => {
    expect(resolveAudioChannelStatus({
      paused: false,
      ready: true,
      transportError: null,
      idleStatus: '待检测'
    })).toBe('正常')
    expect(resolveAudioChannelStatus({
      paused: true,
      ready: true,
      transportError: 'system audio stopped',
      idleStatus: '待检测'
    })).toBe('已暂停')
    expect(resolveAudioChannelStatus({
      paused: false,
      ready: false,
      transportError: 'microphone stopped',
      idleStatus: '待授权'
    })).toBe('传输异常')
  })

  it('does not start a visual mode until its required source is present', () => {
    expect(canStartLive({
      sessionStatus: 'idle',
      visualMode: 'screen',
      hasScreen: false,
      hasCamera: false
    })).toBe(false)
    expect(canStartLive({
      sessionStatus: 'idle',
      visualMode: 'screen',
      hasScreen: true,
      hasCamera: false
    })).toBe(true)
    expect(canStartLive({
      sessionStatus: 'running',
      visualMode: 'screen',
      hasScreen: true,
      hasCamera: false
    })).toBe(false)
  })
})
