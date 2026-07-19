import { describe, expect, it } from 'vitest'
import { calculateFrameCamera } from './framing'

const currentCamera = {
  position: { x: 8, y: 6, z: 8 },
  target: { x: 0, y: 1, z: 0 },
  fovDegrees: 42,
  aspectWidth: 16,
  aspectHeight: 9
}

describe('camera framing', () => {
  it('centers the requested bounds while preserving the viewing direction', () => {
    const framed = calculateFrameCamera({
      center: { x: 12, y: 3, z: -4 },
      radius: 2,
      currentCamera,
      verticalFovDegrees: 42,
      aspect: 16 / 9
    })

    expect(framed.target).toEqual({ x: 12, y: 3, z: -4 })
    const oldDirection = {
      x: currentCamera.position.x - currentCamera.target.x,
      y: currentCamera.position.y - currentCamera.target.y,
      z: currentCamera.position.z - currentCamera.target.z
    }
    const newDirection = {
      x: framed.position.x - framed.target.x,
      y: framed.position.y - framed.target.y,
      z: framed.position.z - framed.target.z
    }
    expect(newDirection.x / newDirection.z).toBeCloseTo(oldDirection.x / oldDirection.z)
    expect(newDirection.y / newDirection.z).toBeCloseTo(oldDirection.y / oldDirection.z)
  })

  it('moves farther away in a narrow portrait viewport', () => {
    const landscape = calculateFrameCamera({
      center: { x: 0, y: 1, z: 0 },
      radius: 3,
      currentCamera,
      verticalFovDegrees: 42,
      aspect: 16 / 9
    })
    const portrait = calculateFrameCamera({
      center: { x: 0, y: 1, z: 0 },
      radius: 3,
      currentCamera,
      verticalFovDegrees: 42,
      aspect: 9 / 16
    })

    const landscapeDistance = Math.hypot(
      landscape.position.x - landscape.target.x,
      landscape.position.y - landscape.target.y,
      landscape.position.z - landscape.target.z
    )
    const portraitDistance = Math.hypot(
      portrait.position.x - portrait.target.x,
      portrait.position.y - portrait.target.y,
      portrait.position.z - portrait.target.z
    )
    expect(portraitDistance).toBeGreaterThan(landscapeDistance)
  })

  it('returns finite coordinates for a point-sized object and a collapsed camera direction', () => {
    const framed = calculateFrameCamera({
      center: { x: 2, y: 2, z: 2 },
      radius: 0,
      currentCamera: {
        position: { x: 0, y: 0, z: 0 },
        target: { x: 0, y: 0, z: 0 },
        fovDegrees: 42,
        aspectWidth: 16,
        aspectHeight: 9
      },
      verticalFovDegrees: 42,
      aspect: 1
    })

    expect(Object.values(framed.position).every(Number.isFinite)).toBe(true)
    expect(
      Math.hypot(
        framed.position.x - framed.target.x,
        framed.position.y - framed.target.y,
        framed.position.z - framed.target.z
      )
    ).toBeGreaterThanOrEqual(1.5)
  })
})
