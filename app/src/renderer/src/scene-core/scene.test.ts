import { describe, expect, it } from 'vitest'
import { DEFAULT_CAMERA_STATE } from './defaults'
import { createInitialScene, createSceneObject } from './scene'

describe('basic object placement', () => {
  it('starts with an empty scene so the origin remains visible', () => {
    expect(createInitialScene().objects).toEqual([])
    expect(createInitialScene().camera).toEqual(DEFAULT_CAMERA_STATE)
  })

  it('places every new primitive at the fixed world origin', () => {
    const existing = [createSceneObject('box', [])]

    for (const kind of ['box', 'cylinder', 'sphere', 'wall', 'floor'] as const) {
      const object = createSceneObject(kind, existing)
      expect(object.position.x).toBe(0)
      expect(object.position.z).toBe(0)
      expect(object.position.y).toBe(object.size.y / 2)
    }
  })
})
