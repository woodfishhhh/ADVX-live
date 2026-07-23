import { describe, expect, it, vi } from 'vitest'
import {
  COMPRESSION_PROFILES,
  DEFAULT_VISUAL_SETTINGS,
  VISUAL_SETTINGS_STORAGE_KEY,
  cameraPreviewTransform,
  encodeJpegWithinTarget,
  getContainRectangle,
  getPipRectangle,
  loadVisualSettings,
  parseVisualSettings,
  resolveVisualMode,
  saveVisualSettings
} from './visual'

describe('visual composition helpers', () => {
  it('places medium picture-in-picture in each requested corner', () => {
    expect(getPipRectangle(1600, 900, 'top-left', 'medium')).toEqual({
      x: 23,
      y: 23,
      width: 448,
      height: 252
    })
    expect(getPipRectangle(1600, 900, 'bottom-right', 'medium')).toEqual({
      x: 1129,
      y: 625,
      width: 448,
      height: 252
    })
  })

  it('contains a camera frame without cropping and mirrors only when requested', () => {
    expect(getContainRectangle(1920, 1080, { x: 10, y: 20, width: 400, height: 400 })).toEqual({
      x: 10,
      y: 107.5,
      width: 400,
      height: 225
    })
    expect(cameraPreviewTransform(false)).toBe('none')
    expect(cameraPreviewTransform(true)).toBe('scaleX(-1)')
  })

  it('downgrades picture-in-picture to the remaining source', () => {
    expect(resolveVisualMode('pip', true, true)).toBe('pip')
    expect(resolveVisualMode('pip', true, false)).toBe('screen')
    expect(resolveVisualMode('pip', false, true)).toBe('camera')
    expect(resolveVisualMode('pip', false, false)).toBeNull()
  })
})

describe('visual compression', () => {
  it.each([
    ['economy', 960, 120 * 1024],
    ['balanced', 1440, 250 * 1024],
    ['clear', 1920, 500 * 1024]
  ] as const)('uses the %s profile limits', async (preset, expectedLongEdge, targetBytes) => {
    const encode = vi.fn(async (width: number, height: number, quality: number) => {
      const size = quality <= 0.74 ? targetBytes - 1 : targetBytes + 1
      return new Blob([new Uint8Array(size)], { type: 'image/jpeg' })
    })

    const result = await encodeJpegWithinTarget(
      3840,
      2160,
      COMPRESSION_PROFILES[preset],
      encode
    )

    expect(Math.max(result.width, result.height)).toBe(expectedLongEdge)
    expect(result.blob.size).toBeLessThanOrEqual(targetBytes)
    expect(result.overTarget).toBe(false)
  })

  it('stops shrinking at the 720px readable floor and reports an oversized result', async () => {
    const visitedLongEdges: number[] = []
    const encode = vi.fn(async (width: number, height: number) => {
      visitedLongEdges.push(Math.max(width, height))
      return new Blob([new Uint8Array(300 * 1024)], { type: 'image/jpeg' })
    })
    const result = await encodeJpegWithinTarget(
      3840,
      2160,
      COMPRESSION_PROFILES.balanced,
      encode
    )

    expect(Math.min(...visitedLongEdges)).toBe(720)
    expect(result.width).toBe(720)
    expect(result.overTarget).toBe(true)
    expect(encode.mock.calls.length).toBeLessThanOrEqual(12)
  })
})

describe('visual settings', () => {
  it('restores only versioned valid settings and safely falls back', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value)
    }
    const settings = {
      ...DEFAULT_VISUAL_SETTINGS,
      mode: 'pip' as const,
      mirrorCamera: true,
      compressionPreset: 'clear' as const
    }

    expect(saveVisualSettings(storage, settings)).toBe(true)
    expect(loadVisualSettings(storage)).toEqual(settings)
    values.set(VISUAL_SETTINGS_STORAGE_KEY, JSON.stringify({ version: 0, settings }))
    expect(loadVisualSettings(storage)).toEqual(DEFAULT_VISUAL_SETTINGS)
    expect(parseVisualSettings({ version: 1, settings: { mode: 'invalid' } })).toEqual(
      DEFAULT_VISUAL_SETTINGS
    )
  })

  it('migrates older sampling choices to the required 500ms cadence', () => {
    expect(
      parseVisualSettings({
        version: 1,
        settings: {
          ...DEFAULT_VISUAL_SETTINGS,
          sampleIntervalMs: 5000
        }
      }).sampleIntervalMs
    ).toBe(500)
  })
})
