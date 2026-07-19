import * as THREE from 'three'
import type { OpenModelResult } from '../../../shared/desktop-api'
import type {
  ImportedModelAsset,
  ImportedModelFormat,
  StoredModelReport
} from '../../../shared/project-document'
import {
  importGltfWithResources,
  importObjWithResources,
  importStaticModel,
  type GltfExternalResources,
  type ImportedStaticModel,
  type ModelReport
} from './model-io'

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function storedReport(report: ModelReport): StoredModelReport {
  return {
    meshCount: report.meshCount,
    triangleCount: report.triangleCount,
    materialCount: report.materialCount,
    textureCount: report.textureCount,
    cameraCount: report.cameraCount,
    lightCount: report.lightCount,
    bounds: report.bounds,
    issues: report.issues.map((issue) => ({ severity: issue.severity, message: issue.message }))
  }
}

function primaryInput(asset: ImportedModelAsset): ArrayBuffer | string {
  if (asset.encoding === 'text') return asset.primaryData
  return Uint8Array.from(base64ToBytes(asset.primaryData)).buffer
}

function usesKtx2Textures(asset: ImportedModelAsset): boolean {
  if (asset.format === 'gltf') return asset.primaryData.includes('KHR_texture_basisu')
  if (asset.format !== 'glb' || asset.encoding !== 'base64') return false
  const bytes = base64ToBytes(asset.primaryData)
  if (bytes.byteLength < 20) return false
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const jsonLength = view.getUint32(12, true)
  const jsonEnd = Math.min(20 + jsonLength, bytes.byteLength)
  return new TextDecoder().decode(bytes.subarray(20, jsonEnd)).includes('KHR_texture_basisu')
}

export async function loadImportedAsset(
  asset: ImportedModelAsset,
  renderer?: THREE.WebGLRenderer
): Promise<ImportedStaticModel> {
  if (
    (asset.format === 'gltf' || asset.format === 'obj') &&
    asset.resources &&
    asset.resources.length > 0
  ) {
    const resources: GltfExternalResources = new Map(
      asset.resources.map((resource) => {
        const bytes = base64ToBytes(resource.dataBase64)
        return [
          resource.name,
          {
            data: Uint8Array.from(bytes).buffer,
            mimeType: resource.mimeType
          }
        ]
      })
    )
    if (asset.format === 'obj') {
      return importObjWithResources(asset.primaryData, resources)
    }
    return importGltfWithResources(primaryInput(asset), resources, {
      renderer: usesKtx2Textures(asset) ? renderer : undefined
    })
  }
  return importStaticModel(primaryInput(asset), asset.format, {
    renderer: usesKtx2Textures(asset) ? renderer : undefined
  })
}

export async function createStoredModelAsset(
  result: Extract<OpenModelResult, { status: 'opened' }>,
  renderer?: THREE.WebGLRenderer
): Promise<ImportedModelAsset> {
  const format = result.format as ImportedModelFormat
  const isText = format === 'gltf' || format === 'obj'
  const primaryData = isText
    ? new TextDecoder().decode(result.primary.data)
    : bytesToBase64(result.primary.data)
  const draft: ImportedModelAsset = {
    format,
    sourceName: result.primary.name,
    primaryData,
    encoding: isText ? 'text' : 'base64',
    resources: result.resources.map((resource) => ({
      name: resource.name,
      dataBase64: bytesToBase64(resource.data),
      mimeType: resource.mimeType
    })),
    report: {
      meshCount: 0,
      triangleCount: 0,
      materialCount: 0,
      textureCount: 0,
      cameraCount: 0,
      lightCount: 0,
      bounds: { x: 0, y: 0, z: 0 },
      issues: []
    }
  }
  const imported = await loadImportedAsset(draft, renderer)
  draft.report = storedReport(imported.report)
  return draft
}

export function normalizeImportedRoot(root: THREE.Object3D): THREE.Group {
  root.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(root)
  const center = bounds.getCenter(new THREE.Vector3())
  const size = bounds.getSize(new THREE.Vector3())
  const normalized = new THREE.Group()
  root.position.sub(center)
  const longestSide = Math.max(size.x, size.y, size.z, 1e-6)
  normalized.scale.setScalar(1 / longestSide)
  normalized.add(root)
  return normalized
}
