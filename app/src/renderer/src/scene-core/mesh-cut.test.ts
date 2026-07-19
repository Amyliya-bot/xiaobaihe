import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { createCustomGeometry } from './geometry'
import { clipGeometryByPlane } from './mesh-cut'

function boundsOf(geometry: THREE.BufferGeometry): THREE.Box3 {
  geometry.computeBoundingBox()
  return geometry.boundingBox?.clone() ?? new THREE.Box3()
}

describe('non-destructive plane cutting', () => {
  it('keeps the requested half and closes the cut surface', () => {
    const result = clipGeometryByPlane(new THREE.BoxGeometry(1, 1, 1), {
      normal: { x: 1, y: 0, z: 0 },
      offset: 0,
      keep: 'positive'
    })
    const bounds = boundsOf(result)
    const positions = result.getAttribute('position')
    let cutPlaneVertexCount = 0
    for (let index = 0; index < positions.count; index += 1) {
      if (Math.abs(positions.getX(index)) < 1e-5) cutPlaneVertexCount += 1
    }

    expect(bounds.min.x).toBeCloseTo(0)
    expect(bounds.max.x).toBeCloseTo(0.5)
    expect(cutPlaneVertexCount).toBeGreaterThanOrEqual(6)
    expect(positions.count % 3).toBe(0)
    result.dispose()
  })

  it('creates complementary halves with matching cut bounds', () => {
    const source = new THREE.SphereGeometry(0.5, 18, 12)
    const positive = clipGeometryByPlane(source, {
      normal: { x: 0, y: 1, z: 0 },
      offset: 0.1,
      keep: 'positive'
    })
    const negative = clipGeometryByPlane(source, {
      normal: { x: 0, y: 1, z: 0 },
      offset: 0.1,
      keep: 'negative'
    })

    expect(boundsOf(positive).min.y).toBeCloseTo(0.1)
    expect(boundsOf(negative).max.y).toBeCloseTo(0.1)
    source.dispose()
    positive.dispose()
    negative.dispose()
  })

  it('builds valid trapezoid and collapsed-top cone geometry in either winding direction', () => {
    const counterClockwise = [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 }
    ]
    const trapezoid = createCustomGeometry({
      points: [...counterClockwise].reverse(),
      topPoints: [
        { x: -0.5, y: 0.5 },
        { x: 0.5, y: 0.5 },
        { x: 0.5, y: -0.5 },
        { x: -0.5, y: -0.5 }
      ]
    })
    const coneLike = createCustomGeometry({
      points: counterClockwise,
      topPoints: counterClockwise.map(() => ({ x: 0, y: 0 }))
    })

    expect(trapezoid.getAttribute('normal').count).toBeGreaterThan(0)
    expect(coneLike.getAttribute('position').count).toBe(18)
    trapezoid.dispose()
    coneLike.dispose()
  })
})
