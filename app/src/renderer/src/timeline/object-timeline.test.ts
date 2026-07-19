import { describe, expect, it } from 'vitest'
import type { ObjectKeyframeNode, SceneObjectData } from '../../../shared/project-document'
import {
  applyObjectKeyframePreview,
  duplicateObjectKeyframe,
  evaluateObjectKeyframes,
  moveObjectKeyframe,
  updateObjectKeyframeInterpolation,
  upsertObjectKeyframe
} from './object-timeline'
import { MANNEQUIN_PRESETS, createMannequinData } from '../mannequin/mannequin'

function object(positionX: number, rotationY = 0, sizeX = 1): SceneObjectData {
  return {
    id: 'box-1',
    kind: 'box',
    name: '方块 01',
    position: { x: positionX, y: 1, z: 0 },
    rotation: { x: 0, y: rotationY, z: 0 },
    size: { x: sizeX, y: 1, z: 1 },
    color: '#ffffff',
    visible: true,
    locked: false
  }
}

function keyframe(
  id: string,
  timeSeconds: number,
  positionX: number,
  rotationY: number,
  interpolation: ObjectKeyframeNode['interpolation'] = 'smooth'
): ObjectKeyframeNode {
  return {
    id,
    objectId: 'box-1',
    timeSeconds,
    interpolation,
    transform: {
      position: { x: positionX, y: 1, z: 0 },
      rotation: { x: 0, y: rotationY, z: 0 },
      size: { x: 1 + positionX / 10, y: 1, z: 1 }
    }
  }
}

describe('object keyframe timeline', () => {
  it('smoothly interpolates position and size while rotating through the shortest angle', () => {
    const preview = evaluateObjectKeyframes(
      [keyframe('a', 0, 0, 350), keyframe('b', 2, 10, 10)],
      1
    ).get('box-1')

    expect(preview?.position.x).toBeCloseTo(5)
    expect(preview?.size.x).toBeCloseTo(1.5)
    expect(preview?.rotation.y).toBeCloseTo(360)
  })

  it('supports linear arrival and holds the first and last recorded state', () => {
    const keys = [keyframe('a', 1, 2, 0), keyframe('b', 5, 10, 90, 'linear')]
    expect(evaluateObjectKeyframes(keys, 0).get('box-1')?.position.x).toBe(2)
    expect(evaluateObjectKeyframes(keys, 3).get('box-1')?.position.x).toBe(6)
    expect(evaluateObjectKeyframes(keys, 8).get('box-1')?.position.x).toBe(10)
  })

  it('updates the same object and time instead of creating duplicate states', () => {
    const existing = keyframe('a', 1, 1, 0)
    const result = upsertObjectKeyframe([existing], 1.01, object(7, 45, 2))
    expect(result.keyframes).toHaveLength(1)
    expect(result.keyframes[0].transform.position.x).toBe(7)
    expect(result.keyframes[0].transform.rotation.y).toBe(45)
  })

  it('applies preview transforms without mutating stored scene objects', () => {
    const source = object(0)
    const preview = evaluateObjectKeyframes([keyframe('a', 0, 6, 30)], 0)
    const displayed = applyObjectKeyframePreview([source], preview)
    expect(displayed[0].position.x).toBe(6)
    expect(source.position.x).toBe(0)
    expect(
      updateObjectKeyframeInterpolation([keyframe('a', 0, 0, 0)], 'a', 'linear')[0].interpolation
    ).toBe('linear')
  })

  it('moves and copies states only within the selected object track', () => {
    const otherObject = { ...keyframe('other', 1, 9, 0), objectId: 'sphere-1' }
    const moved = moveObjectKeyframe([keyframe('a', 0, 0, 0), otherObject], 'a', 1, 5)
    expect(moved.find((item) => item.id === 'a')?.timeSeconds).toBe(1)

    const duplicated = duplicateObjectKeyframe(moved, 'a', 5)
    expect(duplicated?.keyframes).toHaveLength(3)
    expect(
      duplicated?.keyframes.find((item) => item.id === duplicated.selectedId)?.transform.position.x
    ).toBe(0)
  })

  it('preserves both states when a drag lands on an occupied frame in the same track', () => {
    const moved = moveObjectKeyframe([keyframe('a', 0, 0, 0), keyframe('b', 1, 5, 0)], 'a', 1, 5)
    expect(moved).toHaveLength(2)
    expect(new Set(moved.map((item) => item.timeSeconds)).size).toBe(2)
  })

  it('records and interpolates mannequin joint rotations without mutating the source pose', () => {
    const mannequin = createMannequinData()
    const source: SceneObjectData = {
      id: 'mannequin-1',
      kind: 'mannequin',
      name: '人台 01',
      position: { x: 0, y: 0.875, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      size: { x: 1.75, y: 1.75, z: 1.75 },
      color: '#d9dddc',
      visible: true,
      locked: false,
      mannequin
    }
    const start = upsertObjectKeyframe([], 0, source).keyframes[0]
    const walking = {
      ...source,
      mannequin: { ...mannequin, pose: MANNEQUIN_PRESETS.find((item) => item.id === 'walk')!.pose }
    }
    const end = upsertObjectKeyframe([], 2, walking).keyframes[0]
    const preview = evaluateObjectKeyframes([start, end], 1).get(source.id)

    expect(preview?.mannequinPose?.leftHip.x).toBeCloseTo(-16)
    expect(preview?.mannequinPose?.rightShoulder.x).toBeCloseTo(-15)
    expect(source.mannequin?.pose.leftHip.x).toBe(0)
    expect(
      applyObjectKeyframePreview([source], new Map([[source.id, preview!]]))[0].mannequin?.pose
        .leftHip.x
    ).toBeCloseTo(-16)
  })
})
