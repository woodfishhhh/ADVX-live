import { beforeEach, describe, expect, it } from 'vitest'
import {
  selectActiveView,
  selectSession,
  selectSessionError,
  selectSessionStatus,
  useControlStore
} from './controlStore'

describe('control store', () => {
  beforeEach(() => {
    useControlStore.getState().reset()
  })

  it('keeps local navigation and session presentation state in one Zustand store', () => {
    const initial = useControlStore.getState()
    expect(selectActiveView(initial)).toBe('live')
    expect(selectSessionStatus(initial)).toBe('idle')

    initial.setActiveView('settings')
    initial.dispatchSession({ type: 'start' })
    initial.dispatchSession({ type: 'started' })
    const running = useControlStore.getState()

    expect(selectActiveView(running)).toBe('settings')
    expect(selectSession(running)).toEqual({ status: 'running', error: null })
    expect(selectSessionStatus(running)).toBe('running')
    expect(selectSessionError(running)).toBeNull()
  })

  it('preserves pause, error recovery, and reset transitions without remote state', () => {
    const store = useControlStore.getState()
    store.dispatchSession({ type: 'start' })
    store.dispatchSession({ type: 'started' })
    store.dispatchSession({ type: 'pause' })
    expect(selectSessionStatus(useControlStore.getState())).toBe('paused')

    store.dispatchSession({ type: 'resume' })
    store.dispatchSession({ type: 'fail', error: 'capture stopped' })
    expect(selectSession(useControlStore.getState())).toEqual({
      status: 'error',
      error: 'capture stopped'
    })

    store.dispatchSession({ type: 'start' })
    expect(selectSession(useControlStore.getState())).toEqual({
      status: 'starting',
      error: null
    })
    store.reset()
    expect(selectActiveView(useControlStore.getState())).toBe('live')
    expect(selectSessionStatus(useControlStore.getState())).toBe('idle')
  })
})
