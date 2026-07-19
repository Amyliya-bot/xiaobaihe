import { describe, expect, it } from 'vitest'
import { createVideoFramePlan } from './frame-plan'

describe('video frame plan', () => {
  it('keeps the encoded duration exact and samples the final key state', () => {
    const plan = createVideoFramePlan(5, 24)
    expect(plan.totalFrames).toBe(120)
    expect(plan.frameDurationSeconds).toBeCloseTo(1 / 24)
    expect(plan.sourceTimeSeconds(0)).toBe(0)
    expect(plan.sourceTimeSeconds(118)).toBeCloseTo(118 / 24)
    expect(plan.sourceTimeSeconds(119)).toBe(5)
  })

  it('rejects invalid frame indexes', () => {
    const plan = createVideoFramePlan(1, 24)
    expect(() => plan.sourceTimeSeconds(24)).toThrow('视频帧编号无效')
  })
})
