import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  MANNEQUIN_JOINTS,
  MANNEQUIN_PRESETS,
  applyMannequinPose,
  createMannequinRig,
  createMannequinData,
  createNeutralMannequinPose,
  poseMannequinJointToward
} from './mannequin'
import { cloneMannequinObject } from './mannequin-visual'

describe('mannequin', () => {
  it('creates a complete neutral pose at a normal reference height', () => {
    const mannequin = createMannequinData()
    expect(mannequin.heightMeters).toBe(1.75)
    expect(Object.keys(mannequin.pose)).toHaveLength(MANNEQUIN_JOINTS.length)
  })

  it('keeps every self-made preset inside joint limits', () => {
    for (const preset of MANNEQUIN_PRESETS) {
      for (const joint of MANNEQUIN_JOINTS) {
        const value = preset.pose[joint.id]
        expect(value.x).toBeGreaterThanOrEqual(joint.limits.x[0])
        expect(value.x).toBeLessThanOrEqual(joint.limits.x[1])
        expect(value.y).toBeGreaterThanOrEqual(joint.limits.y[0])
        expect(value.y).toBeLessThanOrEqual(joint.limits.y[1])
        expect(value.z).toBeGreaterThanOrEqual(joint.limits.z[0])
        expect(value.z).toBeLessThanOrEqual(joint.limits.z[1])
      }
    }
  })

  it('aims a limb endpoint at a world target while preserving its segment length', () => {
    const material = new THREE.MeshStandardMaterial()
    const rig = createMannequinRig(material)
    material.dispose()
    const start = createNeutralMannequinPose()
    const endpoint = rig.handles.get('rightShoulder')!
    const joint = rig.joints.get('rightShoulder')!
    const before = endpoint.getWorldPosition(new THREE.Vector3())
    const segmentLength = joint.getWorldPosition(new THREE.Vector3()).distanceTo(before)
    const target = before.clone().add(new THREE.Vector3(0.18, 0.09, 0))

    const pose = poseMannequinJointToward(rig.root, start, 'rightShoulder', target)
    applyMannequinPose(rig.root, pose)
    const after = endpoint.getWorldPosition(new THREE.Vector3())

    expect(after.x).toBeGreaterThan(before.x)
    expect(joint.getWorldPosition(new THREE.Vector3()).distanceTo(after)).toBeCloseTo(
      segmentLength,
      6
    )
  })

  it('keeps elbow and knee dragging on their safe hinge axis', () => {
    const material = new THREE.MeshStandardMaterial()
    const rig = createMannequinRig(material)
    material.dispose()
    const start = createNeutralMannequinPose()
    const elbow = rig.joints.get('rightElbow')!.getWorldPosition(new THREE.Vector3())
    const pose = poseMannequinJointToward(
      rig.root,
      start,
      'rightElbow',
      elbow.add(new THREE.Vector3(0, -0.1, -0.2))
    )

    expect(pose.rightElbow.x).toBeGreaterThan(60)
    expect(pose.rightElbow.x).toBeLessThan(70)
    expect(pose.rightElbow.y).toBe(0)
    expect(pose.rightElbow.z).toBe(0)
  })

  it('bakes the current skinned pose for static OBJ export', () => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([0, 1, 0, 0.1, 1, 0, 0, 1.1, 0], 3)
    )
    geometry.setAttribute(
      'skinIndex',
      new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 4)
    )
    geometry.setAttribute(
      'skinWeight',
      new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 4)
    )
    geometry.setIndex([0, 1, 2])
    const bone = new THREE.Bone()
    const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial())
    mesh.add(bone)
    mesh.bind(new THREE.Skeleton([bone]))
    const root = new THREE.Group()
    root.add(mesh)
    bone.rotation.z = Math.PI / 2
    root.updateMatrixWorld(true)

    const baked = cloneMannequinObject(root, true)
    const bakedMesh = baked.getObjectByProperty('isSkinnedMesh', true) as THREE.SkinnedMesh
    const positions = bakedMesh.geometry.getAttribute('position')

    expect(positions.getX(0)).toBeCloseTo(-1, 5)
    expect(positions.getY(0)).toBeCloseTo(0, 5)
    expect(positions.getX(0)).not.toBe(geometry.getAttribute('position').getX(0))
    expect(bakedMesh.geometry.getAttribute('skinIndex')).toBeUndefined()
  })
})
