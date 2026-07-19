import { describe, expect, it } from 'vitest'
import { quickBuildTransform, snapQuickBuildEnd, snapQuickBuildStart } from './quick-build'

describe('quick build geometry', () => {
  it('creates a stable wall between two arbitrary ground points', () => {
    const transform = quickBuildTransform({
      kind: 'wall',
      start: { x: 1, y: 0, z: 2 },
      end: { x: 4, y: 0, z: 6 }
    })

    expect(transform).not.toBeNull()
    expect(transform?.position).toEqual({ x: 2.5, y: 1.4, z: 4 })
    expect(transform?.size.x).toBeCloseTo(5)
    expect(transform?.size).toMatchObject({ y: 2.8, z: 0.18 })
    expect(transform?.rotation.y).toBeCloseTo(-53.1301, 3)
  })

  it('creates an axis-aligned floor from two opposite corners', () => {
    expect(
      quickBuildTransform({
        kind: 'floor',
        start: { x: -2, y: 0, z: 1 },
        end: { x: 3, y: 0, z: 5 }
      })
    ).toEqual({
      position: { x: 0.5, y: 0.06, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      size: { x: 5, y: 0.12, z: 4 }
    })
  })

  it('snaps coordinates to a tenth and straightens near-axis walls', () => {
    const start = snapQuickBuildStart({ x: 0.04, y: 8, z: -0.04 })
    const end = snapQuickBuildEnd('wall', start, { x: 3.04, y: -2, z: 0.21 })
    expect(start).toEqual({ x: 0, y: 0, z: 0 })
    expect(end).toEqual({ point: { x: 3, y: 0, z: 0 }, axisSnapped: true })
  })

  it('rejects zero-length walls and degenerate floors', () => {
    expect(
      quickBuildTransform({
        kind: 'wall',
        start: { x: 0, y: 0, z: 0 },
        end: { x: 0.1, y: 0, z: 0 }
      })
    ).toBeNull()
    expect(
      quickBuildTransform({
        kind: 'floor',
        start: { x: 0, y: 0, z: 0 },
        end: { x: 4, y: 0, z: 0 }
      })
    ).toBeNull()
  })
})
