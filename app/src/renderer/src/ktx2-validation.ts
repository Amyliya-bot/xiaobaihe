import * as THREE from 'three'
import {
  importGltfWithResources,
  type GltfExternalResources,
  type ModelReport
} from './import-export/model-io'

interface ValidationResource {
  name: string
  base64: string
  mimeType?: string
}

interface Ktx2ValidationInput {
  source: string
  resources: ValidationResource[]
}

interface Ktx2ValidationResult {
  report: ModelReport
  compressedTextureCount: number
  textureFormats: string[]
  supportedTargets: string[]
  rendererTextureCount: number
  renderedPixelCount: number
  sampledColorCount: number
  privilegedApiExposed: boolean
  nodeProcessExposed: boolean
  imageBase64: string
}

function decodeBase64(value: string): ArrayBuffer {
  const binary = window.atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

function collectTextures(root: THREE.Object3D): THREE.Texture[] {
  const textures = new Set<THREE.Texture>()
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) textures.add(value)
      }
    }
  })
  return [...textures]
}

function textureFormatName(format: number): string {
  const names = new Map<number, string>([
    [THREE.RGBA_ASTC_4x4_Format, 'ASTC 4x4'],
    [THREE.RGBA_BPTC_Format, 'BC7'],
    [THREE.RGB_S3TC_DXT1_Format, 'S3TC DXT1'],
    [THREE.RGBA_S3TC_DXT5_Format, 'S3TC DXT5'],
    [THREE.RGB_ETC1_Format, 'ETC1'],
    [THREE.RGB_ETC2_Format, 'ETC2 RGB'],
    [THREE.RGBA_ETC2_EAC_Format, 'ETC2 RGBA'],
    [THREE.RGBAFormat, 'RGBA fallback']
  ])
  return names.get(format) ?? `Three.js format ${format}`
}

function supportedTargets(renderer: THREE.WebGLRenderer): string[] {
  const extensions: Array<[string, string]> = [
    ['ASTC', 'WEBGL_compressed_texture_astc'],
    ['BC7', 'EXT_texture_compression_bptc'],
    ['S3TC', 'WEBGL_compressed_texture_s3tc'],
    ['ETC2', 'WEBGL_compressed_texture_etc'],
    ['ETC1', 'WEBGL_compressed_texture_etc1']
  ]
  return extensions
    .filter(([, extension]) => renderer.extensions.has(extension))
    .map(([name]) => name)
}

function renderModel(
  renderer: THREE.WebGLRenderer,
  root: THREE.Object3D
): { renderedPixelCount: number; sampledColorCount: number; imageBase64: string } {
  const scene = new THREE.Scene()
  const background = new THREE.Color('#263033')
  scene.background = background
  scene.add(root)

  const bounds = new THREE.Box3().setFromObject(root)
  const center = bounds.getCenter(new THREE.Vector3())
  const size = bounds.getSize(new THREE.Vector3())
  const largestDimension = Math.max(size.x, size.y, size.z, 0.01)
  const camera = new THREE.PerspectiveCamera(35, 1, largestDimension / 100, largestDimension * 100)
  camera.position
    .copy(center)
    .add(new THREE.Vector3(1.25, 0.8, 1.25).normalize().multiplyScalar(largestDimension * 2.6))
  camera.lookAt(center)

  const hemisphere = new THREE.HemisphereLight('#ffffff', '#4b5557', 2.5)
  const keyLight = new THREE.DirectionalLight('#ffffff', 4)
  keyLight.position.copy(center).add(new THREE.Vector3(2, 3, 2).multiplyScalar(largestDimension))
  scene.add(hemisphere, keyLight)

  renderer.render(scene, camera)
  const context = renderer.getContext()
  const width = renderer.domElement.width
  const height = renderer.domElement.height
  const pixels = new Uint8Array(width * height * 4)
  context.readPixels(0, 0, width, height, context.RGBA, context.UNSIGNED_BYTE, pixels)

  const backgroundPixel = [pixels[0], pixels[1], pixels[2]]
  const sampledColors = new Set<string>()
  let renderedPixelCount = 0
  for (let index = 0; index < pixels.length; index += 4) {
    const differsFromBackground =
      Math.abs(pixels[index] - backgroundPixel[0]) > 3 ||
      Math.abs(pixels[index + 1] - backgroundPixel[1]) > 3 ||
      Math.abs(pixels[index + 2] - backgroundPixel[2]) > 3
    if (differsFromBackground) renderedPixelCount += 1
    if (index % 64 === 0) {
      sampledColors.add(`${pixels[index] >> 4}:${pixels[index + 1] >> 4}:${pixels[index + 2] >> 4}`)
    }
  }

  const imageBase64 = renderer.domElement.toDataURL('image/png').split(',')[1] ?? ''
  return { renderedPixelCount, sampledColorCount: sampledColors.size, imageBase64 }
}

function disposeModel(root: THREE.Object3D, textures: THREE.Texture[]): void {
  for (const texture of textures) texture.dispose()
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    for (const material of materials) material.dispose()
  })
}

declare global {
  interface Window {
    runKtx2PackageValidation: (input: Ktx2ValidationInput) => Promise<Ktx2ValidationResult>
  }
}

window.runKtx2PackageValidation = async ({
  source,
  resources
}: Ktx2ValidationInput): Promise<Ktx2ValidationResult> => {
  document.documentElement.dataset.validationPhase = 'create-renderer'
  const canvas = document.querySelector('canvas')
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('KTX2 验证画布不存在')

  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    preserveDrawingBuffer: true
  })
  renderer.setPixelRatio(1)
  renderer.setSize(320, 320, false)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.2

  const resourceMap = new Map(
    resources.map((resource) => [
      resource.name,
      { data: decodeBase64(resource.base64), mimeType: resource.mimeType }
    ])
  ) as GltfExternalResources

  try {
    document.documentElement.dataset.validationPhase = 'import-model'
    const imported = await importGltfWithResources(source, resourceMap, { renderer })
    document.documentElement.dataset.validationPhase = 'inspect-textures'
    const textures = collectTextures(imported.root)
    document.documentElement.dataset.validationPhase = 'render-model'
    const rendered = renderModel(renderer, imported.root)
    const result: Ktx2ValidationResult = {
      report: imported.report,
      compressedTextureCount: textures.filter(
        (texture) => texture instanceof THREE.CompressedTexture
      ).length,
      textureFormats: [...new Set(textures.map((texture) => textureFormatName(texture.format)))],
      supportedTargets: supportedTargets(renderer),
      rendererTextureCount: renderer.info.memory.textures,
      privilegedApiExposed: 'desktopApi' in window || 'desktopRuntime' in window,
      nodeProcessExposed:
        typeof (window as unknown as { process?: unknown }).process !== 'undefined',
      ...rendered
    }
    disposeModel(imported.root, textures)
    document.documentElement.dataset.validationPhase = 'complete'
    return result
  } finally {
    renderer.dispose()
  }
}

document.documentElement.dataset.validationReady = 'true'
