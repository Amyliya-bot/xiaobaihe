import { describe, expect, it } from 'vitest'
import { clampTimelineTime, findAvailableTimelineTime, snapTimelineTime } from './timeline-edit'

describe('timeline editing rules', () => {
  it('clamps and snaps time to a deterministic frame boundary', () => {
    expect(clampTimelineTime(-2, 5)).toBe(0)
    expect(clampTimelineTime(7, 5)).toBe(5)
    expect(snapTimelineTime(1.02, 5, 30)).toBeCloseTo(1.0333333333)
  })

  it('keeps a dragged node on the requested frame when it is free', () => {
    expect(findAvailableTimelineTime(2, [0, 1], 5, 30)).toBe(2)
  })

  it('places overlapping nodes on the nearest free frame without losing either state', () => {
    expect(findAvailableTimelineTime(1, [1, 1 + 1 / 30], 5, 30)).toBeCloseTo(1 - 1 / 30)
    expect(findAvailableTimelineTime(5, [5], 5, 30)).toBeCloseTo(5 - 1 / 30)
  })
})
