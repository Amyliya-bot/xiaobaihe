import { describe, expect, it } from 'vitest'
import {
  cameraMonitorWidthForRatio,
  fitCameraMonitorWindow,
  resizeCameraMonitorWindow,
  type CameraMonitorWindow
} from './monitor-window'

const stage = { width: 900, height: 600 }
const start = { x: 420, y: 80, width: 360 } satisfies CameraMonitorWindow

describe('camera monitor window', () => {
  it('keeps approximately the same visible area when the output ratio changes', () => {
    const landscapeWidth = 360
    const portraitWidth = cameraMonitorWidthForRatio(landscapeWidth, 16 / 9, 9 / 16)
    const landscapeArea = landscapeWidth * (landscapeWidth / (16 / 9))
    const portraitArea = portraitWidth * (portraitWidth / (9 / 16))

    expect(portraitWidth).toBeCloseTo(202.5, 5)
    expect(portraitArea).toBeCloseTo(landscapeArea, 5)
  })

  it('fits portrait output inside the stage while preserving the output ratio', () => {
    const fitted = fitCameraMonitorWindow(start, stage, 9 / 16)
    const contentHeight = fitted.width / (9 / 16)

    expect(fitted.x).toBeGreaterThanOrEqual(8)
    expect(fitted.y).toBeGreaterThanOrEqual(8)
    expect(fitted.x + fitted.width).toBeLessThanOrEqual(stage.width - 8)
    expect(fitted.y + 34 + contentHeight).toBeLessThanOrEqual(stage.height - 8)
  })

  it('resizes proportionally from every window edge and keeps the opposite edge anchored', () => {
    const ratio = 16 / 9
    const east = resizeCameraMonitorWindow(start, 'e', 90, 0, stage, ratio)
    expect(east.width).toBe(450)
    expect(east.x).toBe(start.x)
    expect(east.y).toBe(start.y)

    const west = resizeCameraMonitorWindow(start, 'w', -60, 0, stage, ratio)
    expect(west.width).toBe(420)
    expect(west.x + west.width).toBe(start.x + start.width)

    const north = resizeCameraMonitorWindow(start, 'n', 0, -45, stage, ratio)
    expect(north.width).toBeGreaterThan(start.width)
    expect(north.y + 34 + north.width / ratio).toBeCloseTo(start.y + 34 + start.width / ratio, 5)
  })
})
