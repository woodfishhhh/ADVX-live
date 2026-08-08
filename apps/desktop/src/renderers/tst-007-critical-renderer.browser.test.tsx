import { page, userEvent } from '@vitest/browser/context'
import { act, useRef, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, test, vi } from 'vitest'

import type {
  BackendRuntimeStatus,
  BarrageEvent,
  ControlApi,
  OverlaySettings
} from '../shared/contracts'
import { AppShell } from './control/app/AppShell'
import { LiveDeviceStrip } from './control/features/live/LiveDeviceStrip'
import { LiveStage } from './control/features/live/LiveStage'
import { SourcePickerDialog } from './control/features/source-picker/SourcePickerDialog'
import { useBackendRuntime } from './control/hooks/useBackendRuntime'
import {
  selectDispatchSession,
  selectSession,
  useControlStore
} from './control/store/controlStore'
import { DEFAULT_VISUAL_SETTINGS } from './control/visual'
import { App as OverlayApp } from './overlay/App'
import { DEFAULT_OVERLAY_SETTINGS } from './overlay/overlay-state'

type MountedRoot = Readonly<{ host: HTMLDivElement; root: Root }>

const mountedRoots: MountedRoot[] = []
const reactGlobal = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
reactGlobal.IS_REACT_ACT_ENVIRONMENT = true

afterEach(async () => {
  for (const mounted of mountedRoots.splice(0).reverse()) {
    await act(async () => mounted.root.unmount())
    mounted.host.remove()
  }
  useControlStore.getState().reset()
  Reflect.deleteProperty(window, 'advx')
  Reflect.deleteProperty(window, 'advxOverlay')
  vi.restoreAllMocks()
})

describe('TST-007 critical renderer behavior in real Chromium', () => {
  test('updates LiveStage from the control store through pause, clear, resume, and stop', async () => {
    const onClear = vi.fn()
    useControlStore.setState({
      session: { status: 'running', error: null }
    })
    await mount(<SessionControlHarness onClear={onClear} />)

    await expect.element(page.getByText('REC', { exact: true })).toBeVisible()
    await expect.element(page.getByRole('button', { name: '暂停', exact: true })).toBeEnabled()

    await act(async () => {
      useControlStore.getState().dispatchSession({ type: 'pause' })
    })
    await expect.element(page.getByText('观察已暂停', { exact: true })).toBeVisible()
    await expect.element(page.getByRole('button', { name: '恢复', exact: true })).toBeEnabled()

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '恢复', exact: true }))
    })
    await expect.element(page.getByRole('button', { name: '暂停', exact: true })).toBeEnabled()

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '清屏', exact: true }))
    })
    expect(onClear).toHaveBeenCalledTimes(1)

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '结束直播', exact: true }))
    })
    await expect.element(page.getByRole('button', { name: '停止中...', exact: true })).toBeVisible()
    await expect.element(page.getByRole('button', { name: '暂停', exact: true })).toBeDisabled()
  })

  test('renders overlay barrage order and clear events', async () => {
    const overlay = installOverlayApi()
    const host = await mount(<OverlayApp />)

    await act(async () => {
      overlay.emitBarrage(barrage('first', '第一条', 'top'))
      overlay.emitBarrage(barrage('second', '第二条', 'bottom'))
      overlay.emitBarrage(barrage('third', '第三条', 'scroll'))
    })
    expect(renderedBarrageText(host)).toEqual(['第一条', '第二条', '第三条'])

    await act(async () => {
      overlay.emitSettings({
        ...DEFAULT_OVERLAY_SETTINGS,
        density: 2
      })
    })
    expect(renderedBarrageText(host)).toEqual(['第二条', '第三条'])
    expect(host.querySelector('.overlay-barrage--bottom')?.textContent).toBe('第二条')
    expect(host.querySelector('.overlay-barrage--scroll')?.textContent).toBe('第三条')

    await act(async () => overlay.emitClear())
    expect(renderedBarrageText(host)).toEqual([])
  })

  test('shows backend loss, failure, retry, and reconnect notices', async () => {
    let statusListener: ((status: BackendRuntimeStatus) => void) | null = null
    const restartBackend = vi.fn(async () => backendStatus('connected'))
    window.advx = {
      getBackendStatus: async () => backendStatus('connected'),
      restartBackend,
      onBackendStatus: (listener: (status: BackendRuntimeStatus) => void) => {
        statusListener = listener
        return () => {
          statusListener = null
        }
      }
    } as unknown as ControlApi

    const host = await mount(<BackendNoticeHarness />)
    await expect.element(page.getByRole('heading', { name: '直播控制台' })).toBeVisible()

    await act(async () => statusListener?.(backendStatus('disconnected')))
    await expect.element(page.getByText('本地服务连接中断', { exact: true })).toBeVisible()

    await act(async () => statusListener?.(backendStatus('failed', 'synthetic startup failure')))
    await expect.element(page.getByRole('alert')).toHaveTextContent('synthetic startup failure')

    await act(async () => {
      await userEvent.click(page.getByRole('button', { name: '重试', exact: true }))
    })
    expect(restartBackend).toHaveBeenCalledTimes(1)
    await expect.poll(() => host.textContent).not.toContain('本地服务启动失败')
    expect(host.querySelector('[role="alert"]')).toBeNull()
  })

  test('keeps microphone and system-audio identities distinct in permission states', async () => {
    const toggleMicrophone = vi.fn()
    const toggleSystemAudio = vi.fn()
    await mount(
      <LiveDeviceStrip
        session={{ status: 'running', error: null }}
        microphones={[mediaDevice('mic-studio', 'Studio microphone', 'audioinput')]}
        selectedMicrophoneId="mic-studio"
        microphoneEnabled
        microphoneReady={false}
        microphonePermission="denied"
        systemAudioEnabled
        systemAudioSupported
        systemAudioReady
        systemAudioStatus="系统声音已就绪"
        cameras={[]}
        cameraStream={null}
        cameraEnabled={false}
        cameraPermission="restricted"
        cameraDeviceId=""
        isSessionActive={false}
        mediaTransitioning={false}
        onChangeMicrophone={() => undefined}
        onRequestMicrophoneAccess={() => undefined}
        onToggleMicrophone={toggleMicrophone}
        onToggleSystemAudio={toggleSystemAudio}
        onChangeCamera={() => undefined}
        onToggleCamera={() => undefined}
      />
    )

    await expect.element(page.getByRole('combobox', { name: '麦克风' })).toHaveTextContent(
      'Studio microphone'
    )
    await expect.element(page.getByText('系统声音已就绪', { exact: true })).toBeVisible()
    await expect.element(page.getByText('系统麦克风权限受限', { exact: true })).toBeVisible()
    await expect.element(page.getByText('系统摄像头权限受限', { exact: true })).toBeVisible()

    const microphoneSwitch = page.getByRole('switch', { name: '关闭麦克风', exact: true })
    const systemAudioSwitch = document.querySelector<HTMLButtonElement>('#system-audio-toggle')
    expect(systemAudioSwitch).not.toBeNull()
    await expect.element(microphoneSwitch).toHaveAttribute('aria-checked', 'true')
    expect(systemAudioSwitch?.getAttribute('aria-checked')).toBe('true')

    await act(async () => {
      await userEvent.click(microphoneSwitch)
      await userEvent.click(systemAudioSwitch!)
    })
    expect(toggleMicrophone).toHaveBeenCalledTimes(1)
    expect(toggleSystemAudio).toHaveBeenCalledTimes(1)
  })

  test('focuses the source dialog, reports permission errors, and closes on Escape', async () => {
    const onClose = vi.fn()
    window.advx = {
      listDesktopSources: async () => {
        throw new Error('synthetic permission denial')
      }
    } as unknown as ControlApi

    await mount(<SourcePickerDialog onClose={onClose} onSelect={async () => undefined} />)

    await expect.element(page.getByRole('alert')).toHaveTextContent(
      '无法读取屏幕来源，请检查系统录屏权限。'
    )
    await expect.element(page.getByRole('dialog')).toHaveFocus()

    await act(async () => userEvent.keyboard('{Escape}'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

async function mount(node: ReactNode): Promise<HTMLDivElement> {
  const host = document.createElement('div')
  host.dataset.tst007Root = 'true'
  document.body.append(host)
  const root = createRoot(host)
  mountedRoots.push({ host, root })
  await act(async () => root.render(node))
  return host
}

function SessionControlHarness({ onClear }: Readonly<{ onClear(): void }>): React.JSX.Element {
  const session = useControlStore(selectSession)
  const dispatchSession = useControlStore(selectDispatchSession)
  const [visualSettings, setVisualSettings] = useState(DEFAULT_VISUAL_SETTINGS)
  const videoRef = useRef<HTMLVideoElement>(null)
  const cameraVideoRef = useRef<HTMLVideoElement>(null)

  return (
    <LiveStage
      session={session}
      effectiveVisualMode="screen"
      visualSettings={visualSettings}
      setVisualSettings={setVisualSettings}
      selectedSource={null}
      captureStream={null}
      cameraStream={null}
      cameras={[]}
      cameraEnabled={false}
      mediaTransitioning={false}
      isSessionActive={session.status !== 'idle'}
      canStart
      goLiveBusy={false}
      audienceSessionActive
      overlayVisible
      barrageTotal={2}
      microphoneEnabled
      microphoneLevel={42}
      message=""
      messageSending={false}
      providerProbeState={{
        backendConnected: true,
        profileLoading: false,
        profileSaved: true,
        profileId: 'profile-tst-007',
        runtimeProviderReady: true,
        probing: false,
        probe: null,
        error: null
      }}
      targetSuggestions={[]}
      pipPreviewStyle={{}}
      videoRef={videoRef}
      cameraVideoRef={cameraVideoRef}
      onOpenSourcePicker={() => undefined}
      onChangeVisualMode={() => undefined}
      onToggleGoLive={() => dispatchSession({ type: 'stop' })}
      onTogglePause={() =>
        dispatchSession({ type: session.status === 'paused' ? 'resume' : 'pause' })
      }
      onClearBarrage={onClear}
      onToggleOverlay={() => undefined}
      onMessageChange={() => undefined}
      onSelectMessageTarget={() => undefined}
      onSendUserMessage={() => undefined}
    />
  )
}

function BackendNoticeHarness(): React.JSX.Element {
  const backend = useBackendRuntime()
  return (
    <AppShell
      activeView="live"
      onViewChange={() => undefined}
      colorTheme="dark"
      onColorThemeToggle={() => undefined}
      sessionStatus="idle"
      audienceCount={null}
      modeName="测试模式"
      elapsedSeconds={0}
      barrageTotal={0}
      statusItems={[]}
      notice={
        backend.notice
          ? {
              ...backend.notice,
              tone: backend.connection === 'failed' ? 'failed' : 'info',
              action:
                backend.connection === 'failed'
                  ? {
                      label: '重试',
                      busyLabel: '重试中',
                      busy: backend.retrying,
                      onClick: () => void backend.retry()
                    }
                  : undefined
            }
          : null
      }
    >
      <div>browser fixture</div>
    </AppShell>
  )
}

function installOverlayApi(): Readonly<{
  emitBarrage(event: BarrageEvent): void
  emitClear(): void
  emitSettings(settings: OverlaySettings): void
}> {
  let barrageListener: ((event: BarrageEvent) => void) | null = null
  let clearListener: (() => void) | null = null
  let settingsListener: ((settings: OverlaySettings) => void) | null = null

  window.advxOverlay = {
    onBarrage: (listener) => {
      barrageListener = listener
      return () => {
        barrageListener = null
      }
    },
    onClear: (listener) => {
      clearListener = listener
      return () => {
        clearListener = null
      }
    },
    onSettingsChanged: (listener) => {
      settingsListener = listener
      return () => {
        settingsListener = null
      }
    }
  }

  return {
    emitBarrage: (event) => barrageListener?.(event),
    emitClear: () => clearListener?.(),
    emitSettings: (settings) => settingsListener?.(settings)
  }
}

function barrage(id: string, text: string, mode: BarrageEvent['mode']): BarrageEvent {
  return {
    barrageId: id,
    audienceId: `audience-${id}`,
    text,
    mode,
    createdAt: Date.now()
  }
}

function renderedBarrageText(host: HTMLElement): string[] {
  return [...host.querySelectorAll<HTMLElement>('.overlay-barrage')].map(
    (element) => element.textContent ?? ''
  )
}

function backendStatus(
  connection: BackendRuntimeStatus['connection'],
  startupError: string | null = null
): BackendRuntimeStatus {
  return {
    backendRuntime: 'bun-source',
    connection,
    providersConfigured: true,
    startupError,
    recoverableRuntimeSessionId: null,
    session: {
      sessionId: null,
      state: 'idle',
      startedAtMs: null,
      updatedAtMs: 1,
      revision: 0
    }
  }
}

function mediaDevice(
  deviceId: string,
  label: string,
  kind: MediaDeviceKind
): MediaDeviceInfo {
  return {
    deviceId,
    groupId: 'group-tst-007',
    kind,
    label,
    toJSON: () => ({ deviceId, groupId: 'group-tst-007', kind, label })
  }
}
