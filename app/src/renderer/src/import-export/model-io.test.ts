import { beforeAll, describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  exportStaticModel,
  importGltfWithResources,
  importObjWithResources,
  importStaticModel
} from './model-io'

class NodeFileReader {
  result: string | ArrayBuffer | null = null
  error: DOMException | null = null
  onloadend: ((event: ProgressEvent<FileReader>) => void) | null = null

  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((result) => {
      this.result = result
      this.onloadend?.({ target: this } as unknown as ProgressEvent<FileReader>)
    })
  }

  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((result) => {
      this.result = `data:${blob.type};base64,${Buffer.from(result).toString('base64')}`
      this.onloadend?.({ target: this } as unknown as ProgressEvent<FileReader>)
    })
  }
}

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

function createFixture(): THREE.Group {
  const root = new THREE.Group()
  root.name = '测试模型'
  const furniture = new THREE.Group()
  furniture.name = '桌子层级'
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(2, 0.4, 1),
    new THREE.MeshStandardMaterial({ color: '#45a58d', roughness: 0.8 })
  )
  mesh.name = '桌面'
  mesh.position.y = 1
  furniture.add(mesh)
  root.add(furniture)
  return root
}

function createAnimatedMorphFixture(): { root: THREE.Group; clip: THREE.AnimationClip } {
  const root = new THREE.Group()
  root.name = '形变动画测试'
  const geometry = new THREE.BoxGeometry(1, 1, 1)
  const basePosition = geometry.getAttribute('position')
  const morphPosition = new Float32Array(basePosition.count * 3)
  for (let index = 0; index < basePosition.count; index += 1) {
    morphPosition[index * 3] = basePosition.getX(index)
    morphPosition[index * 3 + 1] = basePosition.getY(index) * 1.8
    morphPosition[index * 3 + 2] = basePosition.getZ(index)
  }
  geometry.morphAttributes.position = [new THREE.BufferAttribute(morphPosition, 3)]
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: '#8db5e8' }))
  mesh.name = '形变方块'
  mesh.updateMorphTargets()
  root.add(mesh)
  const clip = new THREE.AnimationClip('拉高', 1, [
    new THREE.NumberKeyframeTrack('形变方块.morphTargetInfluences[0]', [0, 1], [0, 1])
  ])
  return { root, clip }
}

function createSkinnedFixture(): THREE.Group {
  const root = new THREE.Group()
  root.name = '骨骼测试'
  const geometry = new THREE.BoxGeometry(1, 2, 1, 1, 2, 1)
  const position = geometry.getAttribute('position')
  const skinIndices: number[] = []
  const skinWeights: number[] = []
  for (let index = 0; index < position.count; index += 1) {
    const upper = position.getY(index) > 0
    skinIndices.push(upper ? 1 : 0, 0, 0, 0)
    skinWeights.push(1, 0, 0, 0)
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndices, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeights, 4))

  const lowerBone = new THREE.Bone()
  lowerBone.name = '下段骨骼'
  lowerBone.position.y = -1
  const upperBone = new THREE.Bone()
  upperBone.name = '上段骨骼'
  upperBone.position.y = 2
  lowerBone.add(upperBone)

  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial({ color: '#e5e6e4' }))
  mesh.name = '蒙皮模型'
  mesh.add(lowerBone)
  mesh.bind(new THREE.Skeleton([lowerBone, upperBone]))
  root.add(mesh)
  return root
}

function externalizeGltfBuffer(source: string): { json: string; buffer: ArrayBuffer } {
  const document = JSON.parse(source) as {
    buffers: Array<{ byteLength: number; uri: string }>
    images?: Array<{ uri: string }>
    textures?: Array<{ source: number }>
    materials?: Array<{
      pbrMetallicRoughness?: { baseColorTexture?: { index: number } }
    }>
  }
  const embedded = document.buffers[0]?.uri
  if (!embedded) throw new Error('测试 GLTF 未包含内嵌缓冲区')
  const encoded = embedded.split(',')[1]
  if (!encoded) throw new Error('测试 GLTF 缓冲区格式无效')
  const bytes = Buffer.from(encoded, 'base64')
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer
  document.buffers[0].uri = 'assets/geometry.bin'
  return { json: JSON.stringify(document), buffer }
}

beforeAll(() => {
  Object.defineProperty(globalThis, 'self', {
    configurable: true,
    value: globalThis
  })
  Object.defineProperty(globalThis, 'FileReader', {
    configurable: true,
    value: NodeFileReader
  })
  Object.defineProperty(globalThis, 'ProgressEvent', {
    configurable: true,
    value: NodeProgressEvent
  })
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    value: async () => ({ width: 1, height: 1, close: () => undefined })
  })
})

describe('stage 3A model import and export validation', () => {
  it.each(['glb', 'gltf'] as const)(
    'round-trips hierarchy and material through %s',
    async (format) => {
      const exported = await exportStaticModel(createFixture(), format)
      const imported = await importStaticModel(exported.data, format)

      expect(imported.report.meshCount).toBe(1)
      expect(imported.report.triangleCount).toBe(12)
      expect(imported.report.materialCount).toBe(1)
      expect(imported.root.getObjectByName('桌子层级')).toBeDefined()
      expect(imported.root.getObjectByName('桌面')).toBeDefined()
      expect(imported.report.issues.filter((issue) => issue.severity === 'error')).toEqual([])
    }
  )

  it('applies a selected local MTL file to an OBJ model', async () => {
    const obj = [
      'mtllib sample.mtl',
      'o Triangle',
      'v 0 0 0',
      'v 1 0 0',
      'v 0 1 0',
      'usemtl Red',
      'f 1 2 3'
    ].join('\n')
    const mtl = ['newmtl Red', 'Kd 1.0 0.0 0.0'].join('\n')
    const encoded = new TextEncoder().encode(mtl)
    const imported = await importObjWithResources(
      obj,
      new Map([
        [
          'sample.mtl',
          {
            data: encoded.buffer.slice(
              encoded.byteOffset,
              encoded.byteOffset + encoded.byteLength
            ) as ArrayBuffer,
            mimeType: 'text/plain'
          }
        ]
      ])
    )
    const mesh = imported.root.getObjectByName('Triangle') as THREE.Mesh
    const material = mesh.material as THREE.MeshPhongMaterial

    expect(material.color.r).toBeCloseTo(1)
    expect(material.color.g).toBeCloseTo(0)
  })

  it('loads a GLTF with an explicitly supplied external binary buffer', async () => {
    const exported = await exportStaticModel(createFixture(), 'gltf')
    const external = externalizeGltfBuffer(exported.data as string)
    const imported = await importGltfWithResources(
      external.json,
      new Map([['assets/geometry.bin', { data: external.buffer }]])
    )

    expect(imported.report.meshCount).toBe(1)
    expect(imported.report.triangleCount).toBe(12)
  })

  it('loads an explicitly supplied external texture without network access', async () => {
    const exported = await exportStaticModel(createFixture(), 'gltf')
    const external = externalizeGltfBuffer(exported.data as string)
    const document = JSON.parse(external.json) as {
      images?: Array<{ uri: string }>
      textures?: Array<{ source: number }>
      materials?: Array<{
        pbrMetallicRoughness?: { baseColorTexture?: { index: number } }
      }>
    }
    document.images = [{ uri: 'textures/pixel.png' }]
    document.textures = [{ source: 0 }]
    const pbr = document.materials?.[0]?.pbrMetallicRoughness
    if (!pbr) throw new Error('测试 GLTF 缺少基础材质')
    pbr.baseColorTexture = { index: 0 }
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlV0AAAAASUVORK5CYII=',
      'base64'
    )
    const pngBuffer = pngBytes.buffer.slice(
      pngBytes.byteOffset,
      pngBytes.byteOffset + pngBytes.byteLength
    ) as ArrayBuffer

    const imported = await importGltfWithResources(
      JSON.stringify(document),
      new Map([
        ['assets/geometry.bin', { data: external.buffer }],
        ['textures/pixel.png', { data: pngBuffer, mimeType: 'image/png' }]
      ])
    )

    expect(imported.report.textureCount).toBe(1)
  })

  it('reports that a KTX2 model needs an initialized renderer', async () => {
    const exported = await exportStaticModel(createFixture(), 'gltf')
    const external = externalizeGltfBuffer(exported.data as string)
    const document = JSON.parse(external.json) as {
      extensionsUsed?: string[]
      extensionsRequired?: string[]
      images?: Array<{ uri: string }>
      textures?: Array<{ extensions: { KHR_texture_basisu: { source: number } } }>
      materials?: Array<{
        pbrMetallicRoughness?: { baseColorTexture?: { index: number } }
      }>
    }
    document.extensionsUsed = ['KHR_texture_basisu']
    document.extensionsRequired = ['KHR_texture_basisu']
    document.images = [{ uri: 'textures/compressed.ktx2' }]
    document.textures = [{ extensions: { KHR_texture_basisu: { source: 0 } } }]
    const pbr = document.materials?.[0]?.pbrMetallicRoughness
    if (!pbr) throw new Error('测试 GLTF 缺少基础材质')
    pbr.baseColorTexture = { index: 0 }

    await expect(
      importGltfWithResources(
        JSON.stringify(document),
        new Map([
          ['assets/geometry.bin', { data: external.buffer }],
          ['textures/compressed.ktx2', { data: new ArrayBuffer(0), mimeType: 'image/ktx2' }]
        ])
      )
    ).rejects.toThrow('模型包含 KTX2 压缩纹理，需要可用的三维渲染器')
  })

  it('rejects a missing external GLTF resource with a readable error', async () => {
    const exported = await exportStaticModel(createFixture(), 'gltf')
    const external = externalizeGltfBuffer(exported.data as string)

    await expect(importGltfWithResources(external.json, new Map())).rejects.toThrow(
      '缺少关联文件：assets/geometry.bin'
    )
  })

  it('round-trips static geometry through OBJ and reports its limitations', async () => {
    const exported = await exportStaticModel(createFixture(), 'obj')
    const imported = await importStaticModel(exported.data, 'obj')

    expect(imported.report.meshCount).toBe(1)
    expect(imported.report.triangleCount).toBe(12)
    expect(imported.report.issues.some((issue) => issue.code === 'obj-static-only')).toBe(true)
  })

  it.each(['glb', 'gltf'] as const)(
    'round-trips morph targets and animation through %s',
    async (format) => {
      const fixture = createAnimatedMorphFixture()
      const exported = await exportStaticModel(fixture.root, format, [fixture.clip])
      const imported = await importStaticModel(exported.data, format)

      expect(imported.report.morphTargetCount).toBe(1)
      expect(imported.report.animationCount).toBe(1)
      expect(imported.animations[0]?.name).toBe('拉高')
    }
  )

  it.each(['glb', 'gltf'] as const)(
    'round-trips a two-bone skinned mesh through %s',
    async (format) => {
      const exported = await exportStaticModel(createSkinnedFixture(), format)
      const imported = await importStaticModel(exported.data, format)

      expect(imported.report.boneCount).toBe(2)
      expect(imported.root.getObjectByName('蒙皮模型')).toBeInstanceOf(THREE.SkinnedMesh)
    }
  )

  it('flags extreme model scale without modifying the source', async () => {
    const fixture = createFixture()
    fixture.scale.setScalar(100_000)
    fixture.updateMatrixWorld(true)
    const exported = await exportStaticModel(fixture, 'glb')
    const imported = await importStaticModel(exported.data, 'glb')

    expect(imported.report.issues.some((issue) => issue.code === 'extreme-scale')).toBe(true)
  })

  it('rejects malformed model data with a readable error', async () => {
    await expect(importStaticModel(new ArrayBuffer(12), 'glb')).rejects.toThrow('无法读取 GLB')
    await expect(importStaticModel('{broken', 'gltf')).rejects.toThrow('无法读取 GLTF')
  })
})
