import { describe, expect, it } from 'vitest'
import type { CameraState } from '../../../shared/project-document'
import { cameraStateFromControl } from './controls'

const camera: CameraState = {
  position: { x: 0, y: 2, z: 5 },
  target: { x: 0, y: 2, z: 0 },
  fovDegrees: 42,
  aspectWidth: 16,
  aspectHeight: 9
}

describe('camera canvas controls', () => {
  it('moves the position and target together without changing the viewing direction', () => {
    const moved = cameraStateFromControl(camera, { x: 3, y: 4, z: 1 }, 'translate')

    expect(moved.position).toEqual({ x: 3, y: 4, z: 1 })
    expect(moved.target).toEqual({ x: 3, y: 4, z: -4 })
  })

  it('changes camera direction by moving the visible aim target', () => {
    const aimed = cameraStateFromControl(camera, { x: -5, y: 2, z: 5 }, 'aim')

    expect(aimed.position).toEqual(camera.position)
    expect(aimed.target).toEqual({ x: -5, y: 2, z: 5 })
  })

  it('keeps a finite viewing direction when the aim target reaches the camera', () => {
    const aimed = cameraStateFromControl(camera, camera.position, 'aim')

    expect(Object.values(aimed.target).every(Number.isFinite)).toBe(true)
    expect(aimed.target.z).toBeCloseTo(4.9)
  })
})
