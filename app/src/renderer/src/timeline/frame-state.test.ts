import { describe, expect, it } from 'vitest'
import type { CameraState, TimelineState } from '../../../shared/project-document'
import { evaluateTimelineAtTime, evaluateTimelineFrame, timeToFrameIndex } from './frame-state'

const camera: CameraState = {
  position: { x: 0, y: 4, z: 8 },
  target: { x: 0, y: 1, z: 0 },
  fovDegrees: 42,
  aspectWidth: 16,
  aspectHeight: 9
}

const timeline: TimelineState = {
  durationSeconds: 2,
  cameraShots: [
    { id: 'a', name: 'a', timeSeconds: 0, transition: 'cut', camera },
    {
      id: 'b',
      name: 'b',
      timeSeconds: 2,
      transition: 'smooth',
      camera: { ...camera, position: { x: 10, y: 4, z: 8 } }
    }
  ],
  objectKeyframes: [
    {
      id: 'object-a',
      objectId: 'box',
      timeSeconds: 0,
      interpolation: 'linear',
      transform: {
        position: { x: 0, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        size: { x: 1, y: 1, z: 1 }
      }
    },
    {
      id: 'object-b',
      objectId: 'box',
      timeSeconds: 2,
      interpolation: 'linear',
      transform: {
        position: { x: 4, y: 1, z: 0 },
        rotation: { x: 0, y: 90, z: 0 },
        size: { x: 2, y: 1, z: 1 }
      }
    }
  ]
}

describe('deterministic timeline frame state', () => {
  it('evaluates the camera and every object from one shared time', () => {
    const state = evaluateTimelineAtTime(timeline, camera, 1)
    expect(state.timeSeconds).toBe(1)
    expect(state.camera.position.x).toBeCloseTo(5)
    expect(state.objectTransforms.get('box')?.position.x).toBeCloseTo(2)
  })

  it('returns the same state for repeated evaluation of the same frame', () => {
    const first = evaluateTimelineFrame(timeline, camera, 30)
    const second = evaluateTimelineFrame(timeline, camera, 30)
    expect(first).toEqual(second)
    expect(first.timeSeconds).toBe(1)
    expect(timeToFrameIndex(1.01, 2, 30)).toBe(30)
  })

  it('uses the base camera when no camera nodes exist', () => {
    const state = evaluateTimelineAtTime({ ...timeline, cameraShots: [] }, camera, 0.5)
    expect(state.camera).toEqual(camera)
    expect(state.camera).not.toBe(camera)
  })
})
