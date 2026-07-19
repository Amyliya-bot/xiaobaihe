import { describe, expect, it } from 'vitest'
import { calculateStretch } from './stretch'

describe('direct face stretching', () => {
  it('moves the dragged positive face while keeping the opposite face fixed', () => {
    const result = calculateStretch({
      position: { x: 0, y: 1, z: 0 },
      size: { x: 2, y: 2, z: 2 },
      axis: 'x',
      sign: 1,
      delta: 1.5,
      worldAxis: { x: 1, y: 0, z: 0 }
    })

    expect(result.size.x).toBe(3.5)
    expect(result.position.x).toBe(0.75)
  })

  it('clamps the minimum size and adjusts the center by the applied distance', () => {
    const result = calculateStretch({
      position: { x: 0, y: 1, z: 0 },
      size: { x: 2, y: 2, z: 2 },
      axis: 'y',
      sign: -1,
      delta: 4,
      worldAxis: { x: 0, y: 1, z: 0 }
    })

    expect(result.size.y).toBe(0.1)
    expect(result.position.y).toBe(1.95)
  })
})
