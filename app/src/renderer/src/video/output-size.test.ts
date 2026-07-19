import { describe, expect, it } from 'vitest'
import type { CameraState } from '../../../shared/project-document'
import { outputSize } from './output-size'

function camera(aspectWidth: number, aspectHeight: number): CameraState {
  return {
    position: { x: 5, y: 5, z: 5 },
    target: { x: 0, y: 0, z: 0 },
    fovDegrees: 45,
    aspectWidth,
    aspectHeight
  }
}

describe('video output size', () => {
  it('resolves standard landscape and portrait dimensions', () => {
    expect(outputSize(camera(16, 9), 1280)).toEqual({ width: 1280, height: 720 })
    expect(outputSize(camera(9, 16), 1280)).toEqual({ width: 720, height: 1280 })
    expect(outputSize(camera(1, 1), 1920)).toEqual({ width: 1920, height: 1920 })
  })

  it('keeps custom H.264 dimensions even', () => {
    const size = outputSize(camera(13, 7), 1280)
    expect(size.width % 2).toBe(0)
    expect(size.height % 2).toBe(0)
  })
})
