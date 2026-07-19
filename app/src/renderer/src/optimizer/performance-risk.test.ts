import { describe, expect, it } from 'vitest'
import type { StoredModelReport } from '../../../shared/project-document'
import { assessModelPerformanceRisk } from './performance-risk'

function report(update: Partial<StoredModelReport> = {}): StoredModelReport {
  return {
    meshCount: 1,
    triangleCount: 20_000,
    materialCount: 2,
    textureCount: 1,
    cameraCount: 0,
    lightCount: 0,
    bounds: { x: 1, y: 1, z: 1 },
    issues: [],
    ...update
  }
}

describe('model performance risk', () => {
  it('does not interrupt ordinary imported models', () => {
    expect(assessModelPerformanceRisk(report(), 30_000)).toMatchObject({
      level: 'normal',
      reasons: []
    })
  })

  it('considers both the model and current scene', () => {
    expect(assessModelPerformanceRisk(report({ triangleCount: 300_000 }), 20_000).level).toBe(
      'caution'
    )
    expect(assessModelPerformanceRisk(report({ triangleCount: 700_000 }), 600_000).level).toBe(
      'high'
    )
  })

  it('reports material and texture pressure in ordinary language', () => {
    const risk = assessModelPerformanceRisk(report({ materialCount: 90, textureCount: 45 }), 0)
    expect(risk.level).toBe('high')
    expect(risk.reasons.join(' ')).toContain('材质')
    expect(risk.reasons.join(' ')).toContain('纹理')
  })
})
