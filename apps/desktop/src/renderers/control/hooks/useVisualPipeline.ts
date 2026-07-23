import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject
} from 'react'
import type { BackendFailure } from '../../../shared/contracts'
import type { SessionStatus } from '../../../shared/session'
import {
  COMPRESSION_PROFILES,
  compressCompositeCanvas,
  drawCompositeFrame,
  requiredVisualSources,
  type VisualPipelineStatus,
  type VisualSettings
} from '../visual'

type UseVisualPipelineOptions = {
  sessionStatus: SessionStatus
  visualSettings: VisualSettings
  captureStream: MediaStream | null
  cameraStream: MediaStream | null
  captureStreamRef: MutableRefObject<MediaStream | null>
  cameraStreamRef: MutableRefObject<MediaStream | null>
  videoRef: RefObject<HTMLVideoElement | null>
  cameraVideoRef: RefObject<HTMLVideoElement | null>
  onBackendFailure?: (failure: BackendFailure) => void
}

type VisualPipeline = {
  compositeCanvasRef: RefObject<HTMLCanvasElement | null>
  status: VisualPipelineStatus
  lastFrameBytes: number | null
  lastFrameOverTarget: boolean
  lastSentAt: number | null
}

function describeBackendError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : '实时连接异常。'
}

export function useVisualPipeline({
  sessionStatus,
  visualSettings,
  captureStream,
  cameraStream,
  captureStreamRef,
  cameraStreamRef,
  videoRef,
  cameraVideoRef,
  onBackendFailure
}: UseVisualPipelineOptions): VisualPipeline {
  const compositeCanvasRef = useRef<HTMLCanvasElement>(null)
  const [status, setStatus] = useState<VisualPipelineStatus>('waiting-backend')
  const [lastFrameBytes, setLastFrameBytes] = useState<number | null>(null)
  const [lastFrameOverTarget, setLastFrameOverTarget] = useState(false)
  const [lastSentAt, setLastSentAt] = useState<number | null>(null)

  const sessionStatusRef = useRef(sessionStatus)
  const onBackendFailureRef = useRef(onBackendFailure)
  const runRef = useRef(0)
  const sampleBusyRef = useRef<number | null>(null)
  const frameSequenceRef = useRef(0)
  sessionStatusRef.current = sessionStatus
  onBackendFailureRef.current = onBackendFailure

  const reportBackendFailure = useCallback((failure: BackendFailure): void => {
    if (!['starting', 'running', 'paused'].includes(sessionStatusRef.current)) return
    setStatus('backend-failed')
    onBackendFailureRef.current?.(failure)
  }, [])

  useEffect(
    () => window.advx.onBackendFailure((failure) => reportBackendFailure(failure)),
    [reportBackendFailure]
  )

  useEffect(() => {
    const runId = runRef.current + 1
    runRef.current = runId

    if (sessionStatus !== 'running') {
      setStatus((current) =>
        sessionStatus === 'error' && current === 'backend-failed'
          ? current
          : 'waiting-backend'
      )
      return
    }

    setStatus('waiting-backend')
    const profile = COMPRESSION_PROFILES[visualSettings.compressionPreset]

    const sampleFrame = async (): Promise<void> => {
      if (sampleBusyRef.current !== null) return
      const requirements = requiredVisualSources(visualSettings.mode)
      const screenVideo = videoRef.current
      const cameraVideo = cameraVideoRef.current
      if (
        (requirements.screen &&
          (!captureStreamRef.current || !screenVideo || screenVideo.videoWidth === 0)) ||
        (requirements.camera &&
          (!cameraStreamRef.current || !cameraVideo || cameraVideo.videoWidth === 0))
      ) {
        return
      }

      const canvas = compositeCanvasRef.current
      if (!canvas) return
      sampleBusyRef.current = runId
      try {
        const primaryVideo = visualSettings.mode === 'camera' ? cameraVideo : screenVideo
        const outputLongEdge = Math.min(
          profile.maxLongEdge,
          Math.max(primaryVideo?.videoWidth ?? 0, primaryVideo?.videoHeight ?? 0)
        )
        if (outputLongEdge <= 0) return
        const drawn = drawCompositeFrame(canvas, {
          mode: visualSettings.mode,
          screen: requirements.screen ? screenVideo : null,
          camera: requirements.camera ? cameraVideo : null,
          mirrorCamera: visualSettings.mirrorCamera,
          pipPosition: visualSettings.pipPosition,
          pipSize: visualSettings.pipSize,
          longEdge: outputLongEdge
        })
        if (!drawn) return

        const encoded = await compressCompositeCanvas(canvas, profile)
        if (runRef.current !== runId || sessionStatusRef.current !== 'running') return
        const sequence = frameSequenceRef.current + 1
        frameSequenceRef.current = sequence
        const capturedAt = Date.now()
        setLastFrameBytes(encoded.blob.size)
        setLastFrameOverTarget(encoded.overTarget)
        const body = new Uint8Array(await encoded.blob.arrayBuffer())
        try {
          await window.advx.submitVisualFrame({
            inputId: `visual-${capturedAt}-${sequence}`,
            capturedAtMs: capturedAt,
            mimeType: encoded.blob.type || 'image/jpeg',
            body
          })
        } catch (error) {
          if (runRef.current !== runId || sessionStatusRef.current !== 'running') return
          reportBackendFailure({
            code: 'backend_disconnected',
            message: `画面未送达后端：${describeBackendError(error)}`
          })
          return
        }
        if (runRef.current !== runId || sessionStatusRef.current !== 'running') return
        setLastSentAt(Date.now())
        setStatus('ready')
      } catch {
        if (runRef.current === runId) setStatus('compression-failed')
      } finally {
        if (sampleBusyRef.current === runId) sampleBusyRef.current = null
      }
    }

    void sampleFrame()
    const sampleTimer = window.setInterval(
      () => void sampleFrame(),
      visualSettings.sampleIntervalMs
    )
    return () => {
      window.clearInterval(sampleTimer)
      if (runRef.current === runId) runRef.current += 1
      if (sampleBusyRef.current === runId) sampleBusyRef.current = null
    }
  }, [
    cameraStream,
    cameraStreamRef,
    cameraVideoRef,
    captureStream,
    captureStreamRef,
    reportBackendFailure,
    sessionStatus,
    videoRef,
    visualSettings.compressionPreset,
    visualSettings.mirrorCamera,
    visualSettings.mode,
    visualSettings.pipPosition,
    visualSettings.pipSize,
    visualSettings.sampleIntervalMs
  ])

  return {
    compositeCanvasRef,
    status,
    lastFrameBytes,
    lastFrameOverTarget,
    lastSentAt
  }
}
