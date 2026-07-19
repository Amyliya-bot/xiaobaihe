import { describe, expect, it } from 'vitest'
import type { SceneObjectData } from '../../../shared/project-document'
import { createSceneObject } from './scene'
import {
  alignObjects,
  distributeObjects,
  placeNewObject,
  placeOnGround,
  snapSelectionToObjectEdges
} from './layout'

describe('beginner layout operations', () => {
  it('aligns selected objects without merging them', () => {
    const left = createSceneObject('box', [])
    const right = createSceneObject('box', [left])
    left.position.x = -4
    right.position.x = 3
    const result = alignObjects([left, right], new Set([left.id, right.id]), 'x', 'center')

    expect(result[0].position.x).toBeCloseTo(result[1].position.x)
    expect(result).toHaveLength(2)
  })

  it('places rotated objects on the ground using their actual bounds', () => {
    const object = createSceneObject('box', [])
    object.position.y = 8
    object.rotation.z = 35
    const [result] = placeOnGround([object], new Set([object.id]))
    expect(result.position.y).toBeLessThan(8)
    expect(result.position.y).toBeGreaterThan(0)
  })

  it('distributes three objects while keeping the first and last extents', () => {
    const objects: SceneObjectData[] = []
    for (let index = 0; index < 3; index += 1) {
      const object = createSceneObject('box', objects)
      object.position.x = index === 0 ? -6 : index === 1 ? -4 : 6
      objects.push(object)
    }
    const result = distributeObjects(objects, new Set(objects.map((object) => object.id)), 'x')
    expect(result[1].position.x).toBeCloseTo(0)
  })

  it('places a new object in a deterministic adjacent slot without overlap', () => {
    const anchor = createSceneObject('box', [])
    const next = createSceneObject('box', [anchor])
    const placed = placeNewObject(next, [anchor])

    expect(placed.position.x).toBeCloseTo(2.2)
    expect(placed.position.z).toBe(0)
  })

  it('does not depend on the current selection when choosing a new slot', () => {
    const first = createSceneObject('box', [])
    const second = placeNewObject(createSceneObject('sphere', [first]), [first])
    const next = createSceneObject('cylinder', [first, second])

    expect(placeNewObject(next, [first, second])).toEqual(placeNewObject(next, [first, second]))
  })

  it('snaps a moved selection to nearby object edges and preserves group spacing', () => {
    const target = createSceneObject('box', [])
    const first = { ...createSceneObject('box', [target]), position: { x: 2.18, y: 1.1, z: 0 } }
    const second = {
      ...createSceneObject('box', [target, first]),
      position: { x: 2.18, y: 1.1, z: 3 }
    }
    const result = snapSelectionToObjectEdges(
      [target, first, second],
      new Set([first.id, second.id]),
      0.3
    )
    const snapped = result.objects.filter((object) => object.id !== target.id)

    expect(result.axes).toContain('x')
    expect(snapped[0].position.x).toBeCloseTo(2.2)
    expect(snapped[1].position.z - snapped[0].position.z).toBe(3)
  })
})
