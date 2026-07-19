import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { importGltfWithResources, type GltfExternalResources } from './model-io'

const sampleCommit = '2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf'
const khrSampleBase = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${sampleCommit}/Models/MeshoptCubeTest/glTF-Meshopt`
const extSampleCommit = 'd7a3cc8e51d7c573771ae77a57f16b0662a905c6'
const extSampleBase = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/${extSampleCommit}/2.0/BrainStem/glTF-Meshopt`

class NodeProgressEvent {
  readonly type: string
  readonly lengthComputable: boolean
  readonly loaded: number
  readonly total: number

  constructor(
    type: string,
    init: { lengthComputable?: boolean; loaded?: number; total?: number } = {}
  ) {
    this.type = type
    this.lengthComputable = init.lengthComputable ?? false
    this.loaded = init.loaded ?? 0
    this.total = init.total ?? 0
  }
}

async function fetchBytes(baseUrl: string, path: string): Promise<ArrayBuffer> {
  const response = await fetch(`${baseUrl}/${path}`)
  if (!response.ok) throw new Error(`Khronos 样本下载失败：${path} (${response.status})`)
  return response.arrayBuffer()
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'self', { configurable: true, value: globalThis })
  Object.defineProperty(globalThis, 'ProgressEvent', {
    configurable: true,
    value: NodeProgressEvent
  })
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => ({ width: 1, height: 1, close: () => undefined })
  })
})

describe.runIf(process.env.RUN_KHRONOS_REAL_MODEL === '1')(
  'Khronos real Meshopt samples validation',
  () => {
    it('loads the pinned CC0 MeshoptCubeTest with external buffers and textures', async () => {
      const gltfResponse = await fetch(`${khrSampleBase}/MeshoptCubeTest.gltf`)
      if (!gltfResponse.ok) throw new Error(`Khronos GLTF 下载失败：${gltfResponse.status}`)
      const source = await gltfResponse.text()
      const document = JSON.parse(source) as {
        extensionsRequired?: string[]
        buffers?: Array<{ uri?: string }>
        images?: Array<{ uri?: string }>
      }
      expect(document.extensionsRequired).toContain('KHR_meshopt_compression')

      const resourceNames = new Set(
        [...(document.buffers ?? []), ...(document.images ?? [])]
          .map((resource) => resource.uri)
          .filter((uri): uri is string => typeof uri === 'string' && !uri.startsWith('data:'))
      )
      const resources = new Map<string, { data: ArrayBuffer; mimeType?: string }>()
      for (const resourceName of resourceNames) {
        resources.set(resourceName, {
          data: await fetchBytes(khrSampleBase, resourceName),
          mimeType: resourceName.endsWith('.png') ? 'image/png' : undefined
        })
      }

      const imported = await importGltfWithResources(source, resources as GltfExternalResources)

      expect(resourceNames.size).toBeGreaterThanOrEqual(11)
      expect(imported.report.meshCount).toBeGreaterThanOrEqual(20)
      expect(imported.report.triangleCount).toBeGreaterThan(100)
      expect(imported.report.textureCount).toBeGreaterThanOrEqual(10)
      expect(imported.report.animationCount).toBeGreaterThanOrEqual(1)
      expect(imported.report.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    })

    it('loads the pinned EXT_meshopt BrainStem with its skeleton and animation', async () => {
      const gltfResponse = await fetch(`${extSampleBase}/BrainStem.gltf`)
      if (!gltfResponse.ok) throw new Error(`Khronos BrainStem 下载失败：${gltfResponse.status}`)
      const source = await gltfResponse.text()
      const document = JSON.parse(source) as {
        extensionsRequired?: string[]
        buffers?: Array<{ uri?: string }>
      }
      expect(document.extensionsRequired).toContain('EXT_meshopt_compression')
      const resourceName = document.buffers?.find((buffer) => buffer.uri)?.uri
      if (!resourceName) throw new Error('BrainStem 样本缺少压缩缓冲区')

      const imported = await importGltfWithResources(
        source,
        new Map([
          [resourceName, { data: await fetchBytes(extSampleBase, resourceName) }]
        ]) as GltfExternalResources
      )
      let skinnedMeshCount = 0
      imported.root.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) skinnedMeshCount += 1
      })

      expect(imported.report.meshCount).toBe(49)
      expect(imported.report.triangleCount).toBe(61_666)
      expect(imported.report.materialCount).toBe(49)
      expect(imported.report.boneCount).toBe(18)
      expect(imported.report.animationCount).toBe(1)
      expect(skinnedMeshCount).toBe(49)
      expect(imported.report.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    })
  }
)
