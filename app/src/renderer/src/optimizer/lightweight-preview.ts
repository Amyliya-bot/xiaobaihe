import * as THREE from 'three'
import { SimplifyModifier } from 'three/addons/modifiers/SimplifyModifier.js'
import type { ImportedModelQuality } from '../../../shared/project-document'

export interface LightweightPreviewReport {
  originalTriangles: number
  previewTriangles: number
  simplifiedMeshes: number
  skippedMeshes: number
}

function geometryTriangles(geometry: THREE.BufferGeometry): number {
  return geometry.index
    ? Math.floor(geometry.index.count / 3)
    : Math.floor((geometry.getAttribute('position')?.count ?? 0) / 3)
}

export function objectTriangles(root: THREE.Object3D): number {
  let triangles = 0
  root.traverse((child) => {
    if (child instanceof THREE.Mesh) triangles += geometryTriangles(child.geometry)
  })
  return triangles
}

function canSimplify(mesh: THREE.Mesh): boolean {
  const position = mesh.geometry.getAttribute('position')
  return Boolean(
    position &&
    position.count >= 120 &&
    !(mesh instanceof THREE.SkinnedMesh) &&
    !mesh.geometry.getAttribute('skinIndex') &&
    (mesh.geometry.morphAttributes.position?.length ?? 0) === 0 &&
    mesh.geometry.groups.length <= 1
  )
}

export function createLightweightPreview(
  original: THREE.Object3D,
  targetRatio: number
): { root: THREE.Object3D; report: LightweightPreviewReport } {
  const ratio = THREE.MathUtils.clamp(targetRatio, 0.1, 0.8)
  const root = original.clone(true)
  const modifier = new SimplifyModifier()
  let simplifiedMeshes = 0
  let skippedMeshes = 0
  root.traverse((child) => {
    if (child instanceof THREE.Light) child.visible = false
    if (!(child instanceof THREE.Mesh)) return
    if (!canSimplify(child)) {
      skippedMeshes += 1
      return
    }
    const sourceGeometry = child.geometry
    const positionCount = sourceGeometry.getAttribute('position').count
    const removeCount = Math.min(
      Math.floor(positionCount * (1 - ratio)),
      Math.max(positionCount - 12, 0)
    )
    if (removeCount <= 0) {
      skippedMeshes += 1
      return
    }
    try {
      const simplified = modifier.modify(sourceGeometry.clone(), removeCount)
      if (geometryTriangles(simplified) >= geometryTriangles(sourceGeometry)) {
        simplified.dispose()
        skippedMeshes += 1
        return
      }
      simplified.computeVertexNormals()
      child.geometry = simplified
      simplifiedMeshes += 1
    } catch {
      skippedMeshes += 1
    }
  })
  return {
    root,
    report: {
      originalTriangles: objectTriangles(original),
      previewTriangles: objectTriangles(root),
      simplifiedMeshes,
      skippedMeshes
    }
  }
}

export function markImportedVariant(root: THREE.Object3D, quality: ImportedModelQuality): void {
  root.userData.importedQuality = quality
}

export function setImportedVariantVisibility(
  container: THREE.Object3D,
  requestedQuality: ImportedModelQuality
): ImportedModelQuality {
  const variants = container.children.filter(
    (child) =>
      child.userData.importedQuality === 'original' ||
      child.userData.importedQuality === 'lightweight'
  )
  const hasLightweight = variants.some((child) => child.userData.importedQuality === 'lightweight')
  const resolved = requestedQuality === 'lightweight' && hasLightweight ? 'lightweight' : 'original'
  for (const variant of variants) variant.visible = variant.userData.importedQuality === resolved
  return resolved
}

export function cloneImportedVariant(
  container: THREE.Object3D,
  requestedQuality: ImportedModelQuality
): THREE.Object3D {
  const clone = container.clone(true)
  const resolved = setImportedVariantVisibility(clone, requestedQuality)
  for (const child of [...clone.children]) {
    if (
      (child.userData.importedQuality === 'original' ||
        child.userData.importedQuality === 'lightweight') &&
      child.userData.importedQuality !== resolved
    ) {
      clone.remove(child)
    }
  }
  return clone
}
