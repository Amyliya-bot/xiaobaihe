import { describe, expect, it } from 'vitest'
import { createSceneObject } from './scene'
import { inspectSceneQuality } from './quality'

describe('scene quality inspection', () => {
  it('blocks an empty scene from reference export', () => {
    const report = inspectSceneQuality([])

    expect(report.status).toBe('error')
    expect(report.issues[0].message).toContain('没有')
  })

  it('warns about dimensions that make outlines unclear', () => {
    const object = createSceneObject('box', [])
    object.size.z = 0.01
    const report = inspectSceneQuality([object])

    expect(report.status).toBe('warning')
    expect(report.issues[0].objectId).toBe(object.id)
  })
})
