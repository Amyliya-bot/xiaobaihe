import * as THREE from 'three'
import type {
  MannequinData,
  MannequinJointId,
  MannequinPose,
  MannequinPresetId,
  Vector3Value
} from '../../../shared/project-document'
import {
  updateMannequinVisual,
  type MannequinVisualRig,
  type MannequinVisualState
} from './mannequin-visual'

export interface MannequinJointDefinition {
  id: MannequinJointId
  label: string
  group: '上身' | '手臂' | '腿部'
  limits: {
    x: readonly [number, number]
    y: readonly [number, number]
    z: readonly [number, number]
  }
}

export const MANNEQUIN_JOINTS: readonly MannequinJointDefinition[] = [
  {
    id: 'head',
    label: '头部',
    group: '上身',
    limits: { x: [-45, 45], y: [-70, 70], z: [-30, 30] }
  },
  {
    id: 'spine',
    label: '躯干',
    group: '上身',
    limits: { x: [-35, 35], y: [-50, 50], z: [-30, 30] }
  },
  {
    id: 'leftShoulder',
    label: '左上臂',
    group: '手臂',
    limits: { x: [-120, 120], y: [-80, 80], z: [-175, 70] }
  },
  {
    id: 'rightShoulder',
    label: '右上臂',
    group: '手臂',
    limits: { x: [-120, 120], y: [-80, 80], z: [-70, 175] }
  },
  {
    id: 'leftElbow',
    label: '左前臂',
    group: '手臂',
    limits: { x: [0, 145], y: [-20, 20], z: [-15, 15] }
  },
  {
    id: 'rightElbow',
    label: '右前臂',
    group: '手臂',
    limits: { x: [0, 145], y: [-20, 20], z: [-15, 15] }
  },
  {
    id: 'leftHip',
    label: '左大腿',
    group: '腿部',
    limits: { x: [-110, 65], y: [-45, 45], z: [-45, 35] }
  },
  {
    id: 'rightHip',
    label: '右大腿',
    group: '腿部',
    limits: { x: [-110, 65], y: [-45, 45], z: [-35, 45] }
  },
  {
    id: 'leftKnee',
    label: '左小腿',
    group: '腿部',
    limits: { x: [0, 150], y: [0, 0], z: [0, 0] }
  },
  {
    id: 'rightKnee',
    label: '右小腿',
    group: '腿部',
    limits: { x: [0, 150], y: [0, 0], z: [0, 0] }
  }
]

const zero = (): Vector3Value => ({ x: 0, y: 0, z: 0 })

export function createNeutralMannequinPose(): MannequinPose {
  return {
    head: zero(),
    spine: zero(),
    leftShoulder: { x: 0, y: 0, z: -6 },
    rightShoulder: { x: 0, y: 0, z: 6 },
    leftElbow: zero(),
    rightElbow: zero(),
    leftHip: zero(),
    rightHip: zero(),
    leftKnee: zero(),
    rightKnee: zero()
  }
}

function poseWith(updates: Partial<MannequinPose>): MannequinPose {
  return { ...createNeutralMannequinPose(), ...updates }
}

export const MANNEQUIN_PRESETS: ReadonlyArray<{
  id: MannequinPresetId
  label: string
  pose: MannequinPose
  sourceClip: string
  sampleTimeSeconds: number
}> = [
  {
    id: 'stand',
    label: '站立',
    pose: createNeutralMannequinPose(),
    sourceClip: 'Idle_Loop',
    sampleTimeSeconds: 0.6
  },
  {
    id: 'sit',
    label: '坐下',
    sourceClip: 'Sitting_Idle_Loop',
    sampleTimeSeconds: 0.5,
    pose: poseWith({
      spine: { x: 8, y: 0, z: 0 },
      leftHip: { x: -88, y: 0, z: -4 },
      rightHip: { x: -88, y: 0, z: 4 },
      leftKnee: { x: 92, y: 0, z: 0 },
      rightKnee: { x: 92, y: 0, z: 0 },
      leftShoulder: { x: -18, y: 0, z: -12 },
      rightShoulder: { x: -18, y: 0, z: 12 },
      leftElbow: { x: 58, y: 0, z: 0 },
      rightElbow: { x: 58, y: 0, z: 0 }
    })
  },
  {
    id: 'raise-hand',
    label: '伸手',
    sourceClip: 'Interact',
    sampleTimeSeconds: 1,
    pose: poseWith({
      rightShoulder: { x: -8, y: 0, z: 165 },
      rightElbow: { x: 18, y: 0, z: 0 },
      head: { x: 0, y: 18, z: 0 }
    })
  },
  {
    id: 'walk',
    label: '行走',
    sourceClip: 'Walk_Loop',
    sampleTimeSeconds: 0,
    pose: poseWith({
      leftShoulder: { x: 30, y: 0, z: -8 },
      rightShoulder: { x: -30, y: 0, z: 8 },
      leftElbow: { x: 18, y: 0, z: 0 },
      rightElbow: { x: 24, y: 0, z: 0 },
      leftHip: { x: -32, y: 0, z: -3 },
      rightHip: { x: 26, y: 0, z: 3 },
      leftKnee: { x: 20, y: 0, z: 0 },
      rightKnee: { x: 8, y: 0, z: 0 }
    })
  },
  {
    id: 'run',
    label: '跑步',
    sourceClip: 'Sprint_Loop',
    sampleTimeSeconds: 0,
    pose: poseWith({
      spine: { x: -16, y: 0, z: 0 },
      leftShoulder: { x: 58, y: 0, z: -10 },
      rightShoulder: { x: -62, y: 0, z: 10 },
      leftElbow: { x: 72, y: 0, z: 0 },
      rightElbow: { x: 78, y: 0, z: 0 },
      leftHip: { x: -58, y: 0, z: -4 },
      rightHip: { x: 42, y: 0, z: 4 },
      leftKnee: { x: 38, y: 0, z: 0 },
      rightKnee: { x: 104, y: 0, z: 0 }
    })
  }
]

export function cloneMannequinPose(pose: MannequinPose): MannequinPose {
  return Object.fromEntries(
    MANNEQUIN_JOINTS.map(({ id }) => [id, { ...pose[id] }])
  ) as MannequinPose
}

export function createMannequinData(heightMeters = 1.75): MannequinData {
  return {
    heightMeters,
    pose: createNeutralMannequinPose(),
    presetId: 'stand',
    manualJoints: []
  }
}

function clamp(value: number, limits: readonly [number, number]): number {
  return Math.min(Math.max(value, limits[0]), limits[1])
}

export function constrainMannequinJoint(
  jointId: MannequinJointId,
  value: Vector3Value
): Vector3Value {
  const definition = MANNEQUIN_JOINTS.find((joint) => joint.id === jointId)!
  return {
    x: clamp(value.x, definition.limits.x),
    y: clamp(value.y, definition.limits.y),
    z: clamp(value.z, definition.limits.z)
  }
}

function partMaterial(source: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  return source.clone()
}

function cylinderPart(
  radius: number,
  length: number,
  offsetY: number,
  material: THREE.MeshStandardMaterial
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius, Math.max(length - radius * 2, 0.005), 5, 10),
    partMaterial(material)
  )
  mesh.position.y = offsetY
  mesh.castShadow = true
  mesh.receiveShadow = true
  return mesh
}

function jointNode(parent: THREE.Object3D, position: THREE.Vector3): THREE.Group {
  const group = new THREE.Group()
  group.position.copy(position)
  parent.add(group)
  return group
}

export interface MannequinRig {
  root: THREE.Group
  joints: Map<MannequinJointId, THREE.Group>
  handles: Map<MannequinJointId, THREE.Object3D>
}

export function createMannequinRig(material: THREE.MeshStandardMaterial): MannequinRig {
  const root = new THREE.Group()
  root.name = '人台控制骨架'
  root.userData.mannequinControl = true
  const joints = new Map<MannequinJointId, THREE.Group>()
  const handles = new Map<MannequinJointId, THREE.Object3D>()

  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.105, 16, 12), partMaterial(material))
  pelvis.scale.set(1.25, 0.72, 0.82)
  pelvis.position.y = -0.075
  pelvis.castShadow = true
  pelvis.receiveShadow = true
  root.add(pelvis)

  const spine = jointNode(root, new THREE.Vector3(0, -0.055, 0))
  joints.set('spine', spine)
  const torso = cylinderPart(0.095, 0.285, 0.145, material)
  torso.scale.x = 1.25
  torso.scale.z = 0.72
  spine.add(torso)

  const neck = cylinderPart(0.038, 0.055, 0.32, material)
  spine.add(neck)
  const headJoint = jointNode(spine, new THREE.Vector3(0, 0.34, 0))
  joints.set('head', headJoint)
  handles.set('spine', headJoint)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.072, 18, 14), partMaterial(material))
  head.scale.set(0.86, 1.08, 0.9)
  head.position.y = 0.078
  head.castShadow = true
  head.receiveShadow = true
  headJoint.add(head)
  const headHandle = jointNode(headJoint, new THREE.Vector3(0, 0.16, 0))
  handles.set('head', headHandle)

  const addArm = (side: 'left' | 'right'): void => {
    const sign = side === 'left' ? -1 : 1
    const shoulderId = `${side}Shoulder` as MannequinJointId
    const elbowId = `${side}Elbow` as MannequinJointId
    const shoulder = jointNode(spine, new THREE.Vector3(sign * 0.145, 0.265, 0))
    joints.set(shoulderId, shoulder)
    shoulder.add(cylinderPart(0.034, 0.185, -0.0925, material))
    const elbow = jointNode(shoulder, new THREE.Vector3(0, -0.185, 0))
    joints.set(elbowId, elbow)
    handles.set(shoulderId, elbow)
    elbow.add(cylinderPart(0.029, 0.17, -0.085, material))
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 9), partMaterial(material))
    hand.scale.y = 1.25
    hand.position.y = -0.185
    hand.castShadow = true
    hand.receiveShadow = true
    elbow.add(hand)
    const handHandle = jointNode(elbow, new THREE.Vector3(0, -0.185, 0))
    handles.set(elbowId, handHandle)
  }

  const addLeg = (side: 'left' | 'right'): void => {
    const sign = side === 'left' ? -1 : 1
    const hipId = `${side}Hip` as MannequinJointId
    const kneeId = `${side}Knee` as MannequinJointId
    const hip = jointNode(root, new THREE.Vector3(sign * 0.065, -0.115, 0))
    joints.set(hipId, hip)
    hip.add(cylinderPart(0.043, 0.205, -0.1025, material))
    const knee = jointNode(hip, new THREE.Vector3(0, -0.205, 0))
    joints.set(kneeId, knee)
    handles.set(hipId, knee)
    knee.add(cylinderPart(0.036, 0.19, -0.095, material))
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.045, 0.13), partMaterial(material))
    foot.position.set(0, -0.205, 0.035)
    foot.castShadow = true
    foot.receiveShadow = true
    knee.add(foot)
    const footHandle = jointNode(knee, new THREE.Vector3(0, -0.205, 0.035))
    handles.set(kneeId, footHandle)
  }

  addArm('left')
  addArm('right')
  addLeg('left')
  addLeg('right')
  root.userData.mannequinJoints = joints
  root.userData.mannequinHandles = handles
  applyMannequinPose(root, createNeutralMannequinPose())
  return { root, joints, handles }
}

function applyMannequinControlPose(root: THREE.Object3D, pose: MannequinPose): void {
  const joints = root.userData.mannequinJoints as Map<MannequinJointId, THREE.Group> | undefined
  if (!joints) return
  for (const definition of MANNEQUIN_JOINTS) {
    const joint = joints.get(definition.id)
    if (!joint) continue
    const value = constrainMannequinJoint(definition.id, pose[definition.id])
    joint.rotation.set(
      THREE.MathUtils.degToRad(value.x),
      THREE.MathUtils.degToRad(value.y),
      THREE.MathUtils.degToRad(value.z)
    )
  }
  root.updateMatrixWorld(true)
}

export function applyMannequinPose(
  root: THREE.Object3D,
  pose: MannequinPose,
  visualState: MannequinVisualState = {}
): void {
  applyMannequinControlPose(root, pose)
  const handles = root.userData.mannequinHandles as
    Map<MannequinJointId, THREE.Object3D> | undefined
  const visual = root.userData.mannequinVisual as MannequinVisualRig | undefined
  const joints = root.userData.mannequinJoints as Map<MannequinJointId, THREE.Group> | undefined
  root.userData.mannequinVisualState = visualState
  if (joints && handles && visual) updateMannequinVisual(visual, joints, handles, visualState)
}

function nearestEquivalentDegrees(value: number, reference: number): number {
  let result = value
  while (result - reference > 180) result -= 360
  while (result - reference < -180) result += 360
  return result
}

function jointReferenceAxis(jointId: MannequinJointId): THREE.Vector3 {
  return jointId === 'head' || jointId === 'spine'
    ? new THREE.Vector3(0, 1, 0)
    : new THREE.Vector3(0, -1, 0)
}

export function poseMannequinJointToward(
  root: THREE.Object3D,
  startPose: MannequinPose,
  jointId: MannequinJointId,
  worldTarget: THREE.Vector3
): MannequinPose {
  const joints = root.userData.mannequinJoints as Map<MannequinJointId, THREE.Group> | undefined
  const joint = joints?.get(jointId)
  if (!joint?.parent) return cloneMannequinPose(startPose)

  applyMannequinControlPose(root, startPose)
  const origin = joint.getWorldPosition(new THREE.Vector3())
  const desired = worldTarget.clone().sub(origin)
  if (desired.lengthSq() < 1e-10) return cloneMannequinPose(startPose)
  const parentWorldQuaternion = joint.parent.getWorldQuaternion(new THREE.Quaternion()).invert()
  desired.normalize().applyQuaternion(parentWorldQuaternion).normalize()

  const nextPose = cloneMannequinPose(startPose)
  if (jointId.endsWith('Elbow') || jointId.endsWith('Knee')) {
    const projectedLength = Math.hypot(desired.y, desired.z)
    if (projectedLength < 1e-6) return nextPose
    nextPose[jointId] = constrainMannequinJoint(jointId, {
      x: THREE.MathUtils.radToDeg(Math.atan2(-desired.z, -desired.y)),
      y: startPose[jointId].y,
      z: startPose[jointId].z
    })
    return nextPose
  }

  const reference = jointReferenceAxis(jointId)
  const rotation = new THREE.Quaternion()
  if (reference.dot(desired) < -0.9999) {
    const direction = jointId.startsWith('left') ? -1 : 1
    rotation.setFromAxisAngle(new THREE.Vector3(0, 0, direction), Math.PI)
  } else {
    rotation.setFromUnitVectors(reference, desired)
  }
  const euler = new THREE.Euler().setFromQuaternion(rotation, 'XYZ')
  const start = startPose[jointId]
  nextPose[jointId] = constrainMannequinJoint(jointId, {
    x: nearestEquivalentDegrees(THREE.MathUtils.radToDeg(euler.x), start.x),
    y: nearestEquivalentDegrees(THREE.MathUtils.radToDeg(euler.y), start.y),
    z: nearestEquivalentDegrees(THREE.MathUtils.radToDeg(euler.z), start.z)
  })
  return nextPose
}

export function readMannequinPose(root: THREE.Object3D): MannequinPose | undefined {
  const joints = root.userData.mannequinJoints as Map<MannequinJointId, THREE.Group> | undefined
  if (!joints) return undefined
  return Object.fromEntries(
    MANNEQUIN_JOINTS.map(({ id }) => {
      const joint = joints.get(id)
      const value = joint
        ? {
            x: THREE.MathUtils.radToDeg(joint.rotation.x),
            y: THREE.MathUtils.radToDeg(joint.rotation.y),
            z: THREE.MathUtils.radToDeg(joint.rotation.z)
          }
        : zero()
      return [id, constrainMannequinJoint(id, value)]
    })
  ) as MannequinPose
}

export function mannequinJointLabel(jointId: MannequinJointId): string {
  return MANNEQUIN_JOINTS.find((joint) => joint.id === jointId)?.label ?? jointId
}
