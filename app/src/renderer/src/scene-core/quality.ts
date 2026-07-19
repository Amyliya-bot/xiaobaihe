import type { SceneObjectData } from '../../../shared/project-document'
import { validateCustomMesh, validateCustomProfile } from './geometry'

export interface SceneQualityIssue {
  severity: 'warning' | 'error'
  objectId?: string
  message: string
}

export interface SceneQualityReport {
  objectCount: number
  triangleCount: number
  issueCount: number
  issues: SceneQualityIssue[]
  status: 'good' | 'warning' | 'error'
}

function primitiveTriangles(object: SceneObjectData): number {
  if (object.kind === 'box') return 12
  if (object.kind === 'cylinder') return 128
  if (object.kind === 'sphere') return 1216
  if (object.kind === 'mannequin') return 12566
  if (object.kind === 'custom') {
    if (object.customMesh) {
      return object.customMesh.faces.reduce((sum, face) => sum + Math.max(face.length - 2, 0), 0)
    }
    return Math.max((object.customProfile?.points.length ?? 0) * 4 - 4, 0)
  }
  return object.importedAsset?.report.triangleCount ?? 0
}

export function inspectSceneQuality(objects: SceneObjectData[]): SceneQualityReport {
  const issues: SceneQualityIssue[] = []
  let triangleCount = 0

  if (objects.length === 0) {
    issues.push({ severity: 'error', message: '场景中还没有可导出的模型。' })
  }

  for (const object of objects) {
    triangleCount += primitiveTriangles(object)
    if (Math.min(object.size.x, object.size.y, object.size.z) < 0.02) {
      issues.push({
        severity: 'warning',
        objectId: object.id,
        message: `${object.name} 有一个方向过薄，导出轮廓时可能不清楚。`
      })
    }
    if (object.kind === 'custom' && (object.customMesh || object.customProfile)) {
      const customIssues = object.customMesh
        ? validateCustomMesh(object.customMesh)
        : validateCustomProfile(object.customProfile!)
      for (const message of customIssues) {
        issues.push({
          severity: 'error',
          objectId: object.id,
          message: `${object.name}：${message}`
        })
      }
    }
    if (object.kind === 'imported' && object.importedAsset) {
      for (const issue of object.importedAsset.report.issues) {
        if (issue.severity === 'info') continue
        issues.push({ severity: issue.severity, objectId: object.id, message: issue.message })
      }
    }
  }

  if (triangleCount > 1_000_000) {
    issues.push({ severity: 'warning', message: '场景超过 100 万三角面，编辑和导出可能变慢。' })
  }
  const status = issues.some((issue) => issue.severity === 'error')
    ? 'error'
    : issues.length > 0
      ? 'warning'
      : 'good'
  return { objectCount: objects.length, triangleCount, issueCount: issues.length, issues, status }
}
