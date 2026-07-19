import type { StoredModelReport } from '../../../shared/project-document'

export type PerformanceRiskLevel = 'normal' | 'caution' | 'high'

export interface ModelPerformanceRisk {
  level: PerformanceRiskLevel
  reasons: string[]
  recommendedPreviewRatio: number
}

export function assessModelPerformanceRisk(
  report: StoredModelReport,
  existingSceneTriangles: number
): ModelPerformanceRisk {
  const reasons: string[] = []
  const sceneTriangles = existingSceneTriangles + report.triangleCount
  if (report.triangleCount >= 800_000) {
    reasons.push(`单个模型约有 ${report.triangleCount.toLocaleString()} 个三角面`)
  } else if (report.triangleCount >= 250_000) {
    reasons.push(`模型约有 ${report.triangleCount.toLocaleString()} 个三角面`)
  }
  if (sceneTriangles >= 1_200_000) {
    reasons.push(`加入后整个场景约有 ${sceneTriangles.toLocaleString()} 个三角面`)
  } else if (sceneTriangles >= 600_000 && report.triangleCount < 250_000) {
    reasons.push(`场景累计约有 ${sceneTriangles.toLocaleString()} 个三角面`)
  }
  if (report.materialCount >= 80) reasons.push(`模型包含 ${report.materialCount} 个材质`)
  else if (report.materialCount >= 35)
    reasons.push(`模型包含较多材质（${report.materialCount} 个）`)
  if (report.textureCount >= 40) reasons.push(`模型包含 ${report.textureCount} 张纹理`)

  const high =
    report.triangleCount >= 800_000 ||
    sceneTriangles >= 1_200_000 ||
    report.materialCount >= 80 ||
    report.textureCount >= 40
  return {
    level: high ? 'high' : reasons.length > 0 ? 'caution' : 'normal',
    reasons,
    recommendedPreviewRatio: high ? 0.2 : 0.4
  }
}
