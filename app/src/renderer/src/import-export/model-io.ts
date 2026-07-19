import * as THREE from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { DRACO_GLTF_CONFIG, DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js'
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js'

export type StaticModelFormat = 'glb' | 'gltf' | 'obj'

export interface ModelIssue {
  code: string
  severity: 'info' | 'warning' | 'error'
  message: string
}

export interface ModelReport {
  format: StaticModelFormat
  objectCount: number
  meshCount: number
  triangleCount: number
  materialCount: number
  textureCount: number
  boneCount: number
  morphTargetCount: number
  animationCount: number
  cameraCount: number
  lightCount: number
  bounds: { x: number; y: number; z: number }
  issues: ModelIssue[]
}

export interface ImportedStaticModel {
  root: THREE.Object3D
  animations: THREE.AnimationClip[]
  report: ModelReport
}

export interface ExportedStaticModel {
  format: StaticModelFormat
  data: ArrayBuffer | string
  report: ModelReport
}

export interface GltfExternalResource {
  data: ArrayBuffer
  mimeType?: string
}

export type GltfExternalResources = ReadonlyMap<string, GltfExternalResource>

export interface ModelImportRuntime {
  renderer?: THREE.WebGLRenderer
}

function normalizeResourceName(value: string): string {
  const withoutQuery = value.split(/[?#]/, 1)[0] ?? value
  return decodeURIComponent(withoutQuery).replaceAll('\\', '/').replace(/^\.\//, '')
}

interface GltfLoaderSession {
  loader: GLTFLoader
  dispose: () => void
}

async function createGltfLoaderSession(
  manager?: THREE.LoadingManager,
  runtime: ModelImportRuntime = {}
): Promise<GltfLoaderSession> {
  const dracoLoader = new DRACOLoader().setDecoderPath(DRACO_GLTF_CONFIG).setWorkerLimit(2)
  const loader = new GLTFLoader(manager)
    .setMeshoptDecoder(MeshoptDecoder)
    .setDRACOLoader(dracoLoader)
  let ktx2Loader: KTX2Loader | undefined

  try {
    if (runtime.renderer) {
      ktx2Loader = new KTX2Loader().setWorkerLimit(2).detectSupport(runtime.renderer)
      await ktx2Loader.init()
      // Transcoders load from trusted app URLs first; model textures then return to the controlled map.
      if (manager) ktx2Loader.manager = manager
      loader.setKTX2Loader(ktx2Loader)
    }

    return {
      loader,
      dispose: () => {
        dracoLoader.dispose()
        ktx2Loader?.dispose()
      }
    }
  } catch (error) {
    dracoLoader.dispose()
    ktx2Loader?.dispose()
    throw error
  }
}

function readableImportError(error: unknown): string {
  const detail = error instanceof Error ? error.message : '未知错误'
  if (detail.includes('setKTX2Loader must be called')) {
    return '模型包含 KTX2 压缩纹理，需要可用的三维渲染器。'
  }
  return detail
}

function countTriangles(geometry: THREE.BufferGeometry): number {
  if (geometry.index) return Math.floor(geometry.index.count / 3)
  const position = geometry.getAttribute('position')
  return position ? Math.floor(position.count / 3) : 0
}

function materialList(material: THREE.Material | THREE.Material[]): THREE.Material[] {
  return Array.isArray(material) ? material : [material]
}

export function analyzeModel(
  root: THREE.Object3D,
  format: StaticModelFormat,
  animations: THREE.AnimationClip[] = []
): ModelReport {
  let objectCount = 0
  let meshCount = 0
  let triangleCount = 0
  let boneCount = 0
  let morphTargetCount = 0
  let cameraCount = 0
  let lightCount = 0
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()

  root.updateMatrixWorld(true)
  root.traverse((object) => {
    objectCount += 1
    if (object instanceof THREE.Bone) boneCount += 1
    if (object instanceof THREE.Camera) cameraCount += 1
    if (object instanceof THREE.Light) lightCount += 1
    if (!(object instanceof THREE.Mesh)) return
    meshCount += 1
    triangleCount += countTriangles(object.geometry)
    morphTargetCount += object.morphTargetInfluences?.length ?? 0
    for (const material of materialList(object.material)) {
      materials.add(material)
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value)
      }
    }
  })

  const boundsBox = new THREE.Box3().setFromObject(root)
  const bounds = boundsBox.isEmpty() ? new THREE.Vector3() : boundsBox.getSize(new THREE.Vector3())
  const largestDimension = Math.max(bounds.x, bounds.y, bounds.z)
  const issues: ModelIssue[] = []

  if (meshCount === 0) {
    issues.push({ code: 'no-mesh', severity: 'error', message: '模型中没有可显示的网格。' })
  }
  if (largestDimension > 10_000 || (largestDimension > 0 && largestDimension < 0.001)) {
    issues.push({
      code: 'extreme-scale',
      severity: 'warning',
      message: '模型尺寸异常，导入时应提示用户确认单位和显示比例。'
    })
  }
  if (triangleCount > 500_000) {
    issues.push({
      code: 'high-triangle-count',
      severity: 'warning',
      message: '模型面数较高，可能影响普通电脑上的编辑流畅度。'
    })
  }
  if (format === 'obj') {
    issues.push({
      code: 'obj-static-only',
      severity: 'info',
      message: 'OBJ 主要保存静态网格，不保存骨骼、动画和完整现代材质。'
    })
  }

  return {
    format,
    objectCount,
    meshCount,
    triangleCount,
    materialCount: materials.size,
    textureCount: textures.size,
    boneCount,
    morphTargetCount,
    animationCount: animations.length,
    cameraCount,
    lightCount,
    bounds: { x: bounds.x, y: bounds.y, z: bounds.z },
    issues
  }
}

export async function importStaticModel(
  data: ArrayBuffer | string,
  format: StaticModelFormat,
  runtime: ModelImportRuntime = {}
): Promise<ImportedStaticModel> {
  try {
    if (format === 'obj') {
      if (typeof data !== 'string') throw new Error('OBJ 内容必须是文本。')
      const root = new OBJLoader().parse(data)
      return { root, animations: [], report: analyzeModel(root, format) }
    }

    const session = await createGltfLoaderSession(undefined, runtime)
    try {
      const gltf = await session.loader.parseAsync(data, '')
      return {
        root: gltf.scene,
        animations: gltf.animations,
        report: analyzeModel(gltf.scene, format, gltf.animations)
      }
    } finally {
      session.dispose()
    }
  } catch (error) {
    const detail = readableImportError(error)
    throw new Error(`无法读取 ${format.toUpperCase()} 模型：${detail}`)
  }
}

export async function importObjWithResources(
  data: string,
  resources: GltfExternalResources
): Promise<ImportedStaticModel> {
  const mtlEntry = [...resources.entries()].find(([name]) => name.toLowerCase().endsWith('.mtl'))
  if (!mtlEntry) return importStaticModel(data, 'obj')

  const manager = new THREE.LoadingManager()
  const objectUrls: string[] = []
  manager.setURLModifier((requestedUrl) => {
    const normalized = normalizeResourceName(requestedUrl)
    const basename = normalized.split('/').at(-1) ?? normalized
    const resource = resources.get(normalized) ?? resources.get(basename)
    if (!resource) throw new Error(`缺少关联文件：${normalized}`)
    const objectUrl = URL.createObjectURL(
      new Blob([resource.data], { type: resource.mimeType ?? 'application/octet-stream' })
    )
    objectUrls.push(objectUrl)
    return objectUrl
  })

  try {
    const mtlText = new TextDecoder().decode(mtlEntry[1].data)
    let finishLoading: (() => void) | undefined
    let failLoading: ((error: Error) => void) | undefined
    const loading = new Promise<void>((resolve, reject) => {
      finishLoading = resolve
      failLoading = reject
    })
    manager.onLoad = () => finishLoading?.()
    manager.onError = (url) => failLoading?.(new Error(`无法读取关联贴图：${url}`))
    const materials = new MTLLoader(manager).parse(mtlText, '')
    materials.preload()
    const root = new OBJLoader(manager).setMaterials(materials).parse(data)
    if (objectUrls.length > 0) await loading
    return { root, animations: [], report: analyzeModel(root, 'obj') }
  } catch (error) {
    const detail = readableImportError(error)
    throw new Error(`无法读取 OBJ 模型：${detail}`)
  } finally {
    for (const url of objectUrls) URL.revokeObjectURL(url)
  }
}

export async function importGltfWithResources(
  data: ArrayBuffer | string,
  resources: GltfExternalResources,
  runtime: ModelImportRuntime = {}
): Promise<ImportedStaticModel> {
  const manager = new THREE.LoadingManager()
  const objectUrls: string[] = []
  manager.setURLModifier((requestedUrl) => {
    if (requestedUrl.startsWith('data:') || requestedUrl.startsWith('blob:')) return requestedUrl
    const normalized = normalizeResourceName(requestedUrl)
    const basename = normalized.split('/').at(-1) ?? normalized
    const resource = resources.get(normalized) ?? resources.get(basename)
    if (!resource) throw new Error(`缺少关联文件：${normalized}`)
    const objectUrl = URL.createObjectURL(
      new Blob([resource.data], { type: resource.mimeType ?? 'application/octet-stream' })
    )
    objectUrls.push(objectUrl)
    return objectUrl
  })

  let session: GltfLoaderSession | undefined
  try {
    session = await createGltfLoaderSession(manager, runtime)
    const gltf = await session.loader.parseAsync(data, '')
    return {
      root: gltf.scene,
      animations: gltf.animations,
      report: analyzeModel(gltf.scene, 'gltf', gltf.animations)
    }
  } catch (error) {
    const detail = readableImportError(error)
    throw new Error(`无法读取 GLTF 模型：${detail}`)
  } finally {
    session?.dispose()
    for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl)
  }
}

export async function exportStaticModel(
  root: THREE.Object3D,
  format: StaticModelFormat,
  animations: THREE.AnimationClip[] = []
): Promise<ExportedStaticModel> {
  const report = analyzeModel(root, format, animations)
  if (report.issues.some((issue) => issue.severity === 'error')) {
    throw new Error(report.issues.find((issue) => issue.severity === 'error')?.message)
  }

  if (format === 'obj') {
    return { format, data: new OBJExporter().parse(root), report }
  }

  const exported = await new GLTFExporter().parseAsync(root, {
    binary: format === 'glb',
    onlyVisible: true,
    trs: true,
    animations
  })
  return {
    format,
    data: exported instanceof ArrayBuffer ? exported : JSON.stringify(exported),
    report
  }
}
