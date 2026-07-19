import { describe, expect, it } from 'vitest'
import type { CameraShotNode, CameraState } from '../../../shared/project-document'
import {
  duplicateCameraShot,
  evaluateCameraShots,
  moveCameraShot,
  upsertCameraShot
} from './camera-timeline'

const camera = (x: number): CameraState => ({
  position: { x, y: 4, z: 8 },
  target: { x: 0, y: 1, z: 0 },
  fovDegrees: 40 + x,
  aspectWidth: 16,
  aspectHeight: 9
})

const shot = (
  id: string,
  timeSeconds: number,
  x: number,
  transition: CameraShotNode['transition']
): CameraShotNode => ({ id, name: id, timeSeconds, transition, camera: camera(x) })

describe('camera timeline', () => {
  it('smoothly interpolates position, target and field of view', () => {
    const result = evaluateCameraShots([shot('a', 0, 0, 'cut'), shot('b', 2, 10, 'smooth')], 1, {
      aspectWidth: 9,
      aspectHeight: 16
    })
    expect(result?.position.x).toBeCloseTo(5)
    expect(result?.fovDegrees).toBeCloseTo(45)
    expect(result?.aspectWidth).toBe(9)
  })

  it('holds the previous camera until a cut node is reached', () => {
    const shots = [shot('a', 0, 1, 'cut'), shot('b', 2, 9, 'cut')]
    expect(evaluateCameraShots(shots, 1.9, camera(0))?.position.x).toBe(1)
    expect(evaluateCameraShots(shots, 2, camera(0))?.position.x).toBe(9)
  })

  it('updates a node at the same time instead of adding a duplicate', () => {
    const existing = shot('a', 1, 1, 'cut')
    const result = upsertCameraShot([existing], 1.01, camera(7))
    expect(result.shots).toHaveLength(1)
    expect(result.shots[0].camera.position.x).toBe(7)
  })

  it('moves and duplicates nodes while preserving every recorded camera', () => {
    const shots = [shot('a', 0, 1, 'cut'), shot('b', 2, 9, 'smooth')]
    const moved = moveCameraShot(shots, 'a', 1, 5)
    expect(moved.map((item) => item.timeSeconds)).toEqual([1, 2])
    expect(shots[0].timeSeconds).toBe(0)

    const duplicated = duplicateCameraShot(moved, 'a', 5)
    expect(duplicated?.shots).toHaveLength(3)
    expect(duplicated?.shots.find((item) => item.id === duplicated.selectedId)?.timeSeconds).toBe(
      1.5
    )
  })

  it('nudges a moved node to a free frame instead of overwriting another node', () => {
    const moved = moveCameraShot([shot('a', 0, 1, 'cut'), shot('b', 1, 9, 'smooth')], 'a', 1, 5)
    expect(moved).toHaveLength(2)
    expect(new Set(moved.map((item) => item.timeSeconds)).size).toBe(2)
  })
})
