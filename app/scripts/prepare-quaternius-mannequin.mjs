import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceGltf = process.argv[2]
const sourceBin = process.argv[3]

if (!sourceGltf || !sourceBin) {
  throw new Error('用法：node scripts/prepare-quaternius-mannequin.mjs <模型.gltf> <模型.bin>')
}

const document = JSON.parse(await readFile(resolve(sourceGltf), 'utf8'))
const binary = await readFile(resolve(sourceBin))
const requiredBones = [
  'Head',
  'spine_01',
  'upperarm_l',
  'lowerarm_l',
  'hand_l',
  'upperarm_r',
  'lowerarm_r',
  'hand_r',
  'thigh_l',
  'calf_l',
  'foot_l',
  'thigh_r',
  'calf_r',
  'foot_r'
]
const nodeNames = new Set(document.nodes?.map((node) => node.name).filter(Boolean))
const missingBones = requiredBones.filter((name) => !nodeNames.has(name))
if (missingBones.length > 0) {
  throw new Error(`模型缺少预期骨骼：${missingBones.join('、')}`)
}
if (document.buffers?.length !== 1 || document.buffers[0].byteLength !== binary.byteLength) {
  throw new Error('模型二进制缓冲区与 glTF 声明不一致。')
}

const armature = document.nodes.find((node) => node.name === 'Armature')
const body = document.nodes.find((node) => node.name === 'SuperHero_Male')
const rootBone = document.nodes.find((node) => node.name === 'root')
if (!armature || body?.mesh === undefined || rootBone === undefined) {
  throw new Error('模型缺少主体、骨架或根骨骼。')
}

// The product uses one neutral white body. Remove character textures and detach
// the separate eye/eyebrow meshes while preserving the authored skin and topology.
armature.children = document.nodes
  .map((node, index) => ({ node, index }))
  .filter(({ node }) => node === body || node === rootBone)
  .map(({ index }) => index)
for (const mesh of document.meshes ?? []) {
  for (const primitive of mesh.primitives ?? []) delete primitive.material
}
delete document.materials
delete document.textures
delete document.images
delete document.samplers
document.asset = {
  ...document.asset,
  copyright: 'Quaternius, CC0 1.0 Universal',
  generator: 'Xiaobaihe mannequin preparation script'
}
document.buffers[0].uri = `data:application/octet-stream;base64,${binary.toString('base64')}`

const target = resolve(appRoot, 'src/renderer/src/assets/mannequin/quaternius-superhero-male.gltf')
await writeFile(target, `${JSON.stringify(document)}\n`, 'utf8')
console.log(`Prepared ${target} (${binary.byteLength} embedded bytes).`)
