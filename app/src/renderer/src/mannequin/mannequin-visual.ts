import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js'
import type { MannequinJointId, MannequinPresetId } from '../../../shared/project-document'
import officialActionSource from '../assets/mannequin/quaternius-ual1-standard.glb?url'

interface BoneTransform {
  position: THREE.Vector3
  quaternion: THREE.Quaternion
  scale: THREE.Vector3
}

type BonePoseSnapshot = Map<string, BoneTransform>

export interface MannequinVisualState {
  presetId?: MannequinPresetId
  manualJoints?: readonly MannequinJointId[]
  actionTimeSeconds?: number
  presetBlend?: {
    from?: MannequinPresetId
    to?: MannequinPresetId
    amount: number
  }
}

interface VisualBoneBinding {
  bone: THREE.Bone
  endpoint?: THREE.Object3D
  restQuaternion: THREE.Quaternion
  restDirectionInParent: THREE.Vector3
}

export interface MannequinVisualRig {
  root: THREE.Group
  bindings: Map<MannequinJointId, VisualBoneBinding>
  bones: Map<string, THREE.Bone>
  restPose: BonePoseSnapshot
  officialPoses: Map<MannequinPresetId, BonePoseSnapshot>
  actionClips: Map<MannequinPresetId, THREE.AnimationClip>
  mixer: THREE.AnimationMixer
}

const officialPoseSources: Record<MannequinPresetId, { clip: string; timeSeconds: number }> = {
  stand: { clip: 'Idle_Loop', timeSeconds: 0.6 },
  sit: { clip: 'Sitting_Idle_Loop', timeSeconds: 0.5 },
  'raise-hand': { clip: 'Interact', timeSeconds: 1 },
  walk: { clip: 'Walk_Loop', timeSeconds: 0 },
  run: { clip: 'Sprint_Loop', timeSeconds: 0 }
}

const visualBoneNames: Record<MannequinJointId, { bone: string; child?: string }> = {
  spine: { bone: 'spine_01', child: 'spine_02' },
  head: { bone: 'Head' },
  leftShoulder: { bone: 'upperarm_r', child: 'lowerarm_r' },
  rightShoulder: { bone: 'upperarm_l', child: 'lowerarm_l' },
  leftElbow: { bone: 'lowerarm_r', child: 'hand_r' },
  rightElbow: { bone: 'lowerarm_l', child: 'hand_l' },
  leftHip: { bone: 'thigh_r', child: 'calf_r' },
  rightHip: { bone: 'thigh_l', child: 'calf_l' },
  leftKnee: { bone: 'calf_r', child: 'foot_r' },
  rightKnee: { bone: 'calf_l', child: 'foot_l' }
}

let officialAssetPromise: ReturnType<GLTFLoader['loadAsync']> | null = null
let officialPosePromise: Promise<Map<MannequinPresetId, BonePoseSnapshot>> | null = null

function loadOfficialAsset(): ReturnType<GLTFLoader['loadAsync']> {
  if (!officialAssetPromise) {
    officialAssetPromise = new GLTFLoader()
      .loadAsync(officialActionSource)
      .catch((error: unknown) => {
        officialAssetPromise = null
        throw error
      })
  }
  return officialAssetPromise
}

function loadPrototype(): Promise<THREE.Group> {
  return loadOfficialAsset().then((gltf) => gltf.scene)
}

function boneMap(root: THREE.Object3D): Map<string, THREE.Bone> {
  const bones = new Map<string, THREE.Bone>()
  root.traverse((object) => {
    if (object instanceof THREE.Bone) bones.set(object.name, object)
  })
  return bones
}

function snapshotBones(root: THREE.Object3D): BonePoseSnapshot {
  return new Map(
    [...boneMap(root)].map(([name, bone]) => [
      name,
      {
        position: bone.position.clone(),
        quaternion: bone.quaternion.clone(),
        scale: bone.scale.clone()
      }
    ])
  )
}

async function loadOfficialPoses(): Promise<Map<MannequinPresetId, BonePoseSnapshot>> {
  if (!officialPosePromise) {
    officialPosePromise = loadOfficialAsset()
      .then((source) => {
        const poses = new Map<MannequinPresetId, BonePoseSnapshot>()

        for (const [presetId, sourcePose] of Object.entries(officialPoseSources) as Array<
          [MannequinPresetId, { clip: string; timeSeconds: number }]
        >) {
          const sourceRoot = cloneSkeleton(source.scene) as THREE.Group
          const clip = THREE.AnimationClip.findByName(source.animations, sourcePose.clip)
          if (!clip) throw new Error(`人台动作资源缺少“${sourcePose.clip}”。`)
          const mixer = new THREE.AnimationMixer(sourceRoot)
          mixer.clipAction(clip).play()
          mixer.setTime(Math.min(sourcePose.timeSeconds, clip.duration))
          sourceRoot.updateMatrixWorld(true)
          poses.set(presetId, snapshotBones(sourceRoot))
          mixer.stopAllAction()
        }
        return poses
      })
      .catch((error: unknown) => {
        officialPosePromise = null
        throw error
      })
  }
  return officialPosePromise
}

function findNamedObject(root: THREE.Object3D, name: string): THREE.Object3D {
  const object = root.getObjectByName(name)
  if (!object) throw new Error(`人台资源缺少骨骼“${name}”。`)
  return object
}

function normalizeVisual(content: THREE.Group): THREE.Group {
  content.updateMatrixWorld(true)
  const bounds = new THREE.Box3().setFromObject(content)
  const size = bounds.getSize(new THREE.Vector3())
  if (!Number.isFinite(size.y) || size.y <= 0) throw new Error('人台资源没有有效高度。')
  const center = bounds.getCenter(new THREE.Vector3())
  const scale = 1 / size.y
  content.scale.setScalar(scale)
  content.position.set(-center.x * scale, -0.5 - bounds.min.y * scale, -center.z * scale)
  content.updateMatrixWorld(true)
  return content
}

function applyWhiteboxMaterial(root: THREE.Object3D, source: THREE.MeshStandardMaterial): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return
    object.geometry = object.geometry.clone()
    object.material = source.clone()
    object.castShadow = true
    object.receiveShadow = true
    object.frustumCulled = false
  })
}

function buildBindings(root: THREE.Object3D): Map<MannequinJointId, VisualBoneBinding> {
  return new Map(
    Object.entries(visualBoneNames).map(([jointId, names]) => {
      const bone = findNamedObject(root, names.bone)
      if (!(bone instanceof THREE.Bone)) throw new Error(`“${names.bone}”不是有效骨骼。`)
      const restQuaternion = bone.quaternion.clone()
      const endpoint = names.child ? findNamedObject(root, names.child) : undefined
      const localDirection = names.child ? endpoint!.position.clone() : new THREE.Vector3(0, 1, 0)
      const restDirectionInParent = localDirection.applyQuaternion(restQuaternion).normalize()
      return [
        jointId as MannequinJointId,
        { bone, endpoint, restQuaternion, restDirectionInParent }
      ]
    })
  )
}

export async function createMannequinVisual(
  material: THREE.MeshStandardMaterial
): Promise<MannequinVisualRig> {
  const [source, prototype, officialPoses] = await Promise.all([
    loadOfficialAsset(),
    loadPrototype(),
    loadOfficialPoses()
  ])
  const content = normalizeVisual(cloneSkeleton(prototype) as THREE.Group)
  applyWhiteboxMaterial(content, material)
  const root = new THREE.Group()
  root.name = 'Quaternius CC0 人台外观'
  root.add(content)
  return {
    root,
    bindings: buildBindings(content),
    bones: boneMap(content),
    restPose: snapshotBones(content),
    officialPoses,
    actionClips: new Map(
      (
        Object.entries(officialPoseSources) as Array<
          [MannequinPresetId, { clip: string; timeSeconds: number }]
        >
      ).map(([presetId, action]) => {
        const clip = THREE.AnimationClip.findByName(source.animations, action.clip)
        if (!clip) throw new Error(`人台动作资源缺少“${action.clip}”。`)
        return [presetId, clip]
      })
    ),
    mixer: new THREE.AnimationMixer(content)
  }
}

function bakeSkinnedPose(root: THREE.Object3D): void {
  root.updateMatrixWorld(true)
  const vertex = new THREE.Vector3()
  root.traverse((object) => {
    if (!(object instanceof THREE.SkinnedMesh)) return
    object.skeleton.update()
    const geometry = object.geometry.clone()
    const sourcePositions = geometry.getAttribute('position')
    if (!(sourcePositions instanceof THREE.BufferAttribute)) return
    const bakedPositions = sourcePositions.clone()
    for (let index = 0; index < bakedPositions.count; index += 1) {
      object.getVertexPosition(index, vertex)
      bakedPositions.setXYZ(index, vertex.x, vertex.y, vertex.z)
    }
    geometry.setAttribute('position', bakedPositions)
    geometry.deleteAttribute('skinIndex')
    geometry.deleteAttribute('skinWeight')
    geometry.computeVertexNormals()
    object.geometry = geometry
  })
}

export function cloneMannequinObject(
  root: THREE.Object3D,
  bakeCurrentPose = false
): THREE.Object3D {
  const clone = cloneSkeleton(root)
  const controlRoots: THREE.Object3D[] = []
  clone.traverse((object) => {
    if (object.userData.mannequinControl === true) controlRoots.push(object)
  })
  for (const controlRoot of controlRoots) controlRoot.removeFromParent()
  clone.traverse((object) => {
    object.userData = {}
  })
  if (bakeCurrentPose) bakeSkinnedPose(clone)
  return clone
}

export function updateMannequinVisual(
  visual: MannequinVisualRig,
  joints: Map<MannequinJointId, THREE.Group>,
  handles: Map<MannequinJointId, THREE.Object3D>,
  state: MannequinVisualState = {}
): void {
  const origin = new THREE.Vector3()
  const endpoint = new THREE.Vector3()
  const parentQuaternion = new THREE.Quaternion()
  const desiredDirection = new THREE.Vector3()
  const correction = new THREE.Quaternion()

  const actionClip =
    state.actionTimeSeconds !== undefined && state.presetId && !state.presetBlend
      ? visual.actionClips.get(state.presetId)
      : undefined

  if (actionClip) {
    const actionTime =
      actionClip.duration > 0
        ? (((state.actionTimeSeconds ?? 0) % actionClip.duration) + actionClip.duration) %
          actionClip.duration
        : 0
    visual.mixer.stopAllAction()
    const action = visual.mixer.clipAction(actionClip)
    action.reset().play()
    action.time = actionTime
    visual.mixer.update(0)
    visual.root.userData.mannequinActionClip = actionClip.name
    visual.root.userData.mannequinActionTime = actionTime
  } else {
    visual.mixer.stopAllAction()
    delete visual.root.userData.mannequinActionClip
    delete visual.root.userData.mannequinActionTime
  }

  const firstPose = state.presetBlend?.from
    ? visual.officialPoses.get(state.presetBlend.from)
    : state.presetId
      ? visual.officialPoses.get(state.presetId)
      : undefined
  const secondPose = state.presetBlend?.to
    ? visual.officialPoses.get(state.presetBlend.to)
    : firstPose
  const blend = THREE.MathUtils.clamp(state.presetBlend?.amount ?? 0, 0, 1)
  if (!actionClip) {
    for (const [name, bone] of visual.bones) {
      const rest = visual.restPose.get(name)
      const first = firstPose?.get(name) ?? rest
      const second = secondPose?.get(name) ?? first
      if (!first || !second) continue
      bone.position.copy(first.position).lerp(second.position, blend)
      bone.quaternion.copy(first.quaternion).slerp(second.quaternion, blend)
      bone.scale.copy(first.scale).lerp(second.scale, blend)
    }
  }

  const overridden = new Set(
    state.presetId || state.presetBlend ? (state.manualJoints ?? []) : [...visual.bindings.keys()]
  )
  visual.root.updateMatrixWorld(true)
  for (const [jointId, binding] of visual.bindings) {
    if (!overridden.has(jointId)) continue
    const joint = joints.get(jointId)
    const handle = handles.get(jointId)
    const parent = binding.bone.parent
    if (!joint || !handle || !parent) continue

    joint.getWorldPosition(origin)
    handle.getWorldPosition(endpoint)
    desiredDirection.copy(endpoint).sub(origin)
    if (desiredDirection.lengthSq() < 1e-10) continue
    desiredDirection.normalize()
    parent.getWorldQuaternion(parentQuaternion).invert()
    desiredDirection.applyQuaternion(parentQuaternion).normalize()
    correction.setFromUnitVectors(binding.restDirectionInParent, desiredDirection)
    binding.bone.quaternion.copy(correction.multiply(binding.restQuaternion))
    binding.bone.updateMatrix()
    binding.bone.updateMatrixWorld(true)
  }

  const sample = visual.bones.get('calf_r') ?? visual.bones.values().next().value
  visual.root.userData.mannequinActionSample = sample
    ? [sample.quaternion.x, sample.quaternion.y, sample.quaternion.z, sample.quaternion.w]
        .map((value) => value.toFixed(5))
        .join(',')
    : ''
}

export function mannequinVisualHandlePosition(
  root: THREE.Object3D,
  jointId: MannequinJointId,
  target = new THREE.Vector3()
): THREE.Vector3 | null {
  const visual = root.userData.mannequinVisual as MannequinVisualRig | undefined
  const state = root.userData.mannequinVisualState as MannequinVisualState | undefined
  const binding = visual?.bindings.get(jointId)
  const usesOfficialPose = Boolean(state?.presetId || state?.presetBlend)
  const manuallyOverridden = state?.manualJoints?.includes(jointId) ?? false
  if (!usesOfficialPose || manuallyOverridden || !binding?.endpoint) return null
  return binding.endpoint.getWorldPosition(target)
}
