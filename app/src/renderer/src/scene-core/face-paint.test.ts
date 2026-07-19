import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { SceneObjectData } from '../../../shared/project-document'
import { applyPaintToMesh, faceColorKey, surfaceTriangles } from './face-paint'

function boxObject(update: Partial<SceneObjectData> = {}): SceneObjectData {
  return {
    id: 'box-1',
    kind: 'box',
    name: '方块',
    position: { x: 0, y: 0.5, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    size: { x: 1, y: 1, z: 1 },
    color: '#f2f4f3',
    visible: true,
    locked: false,
    ...update
  }
}

describe('face paint surface grouping', () => {
  it('treats the two triangles on one box side as one visible surface', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1)
    const surface = surfaceTriangles(geometry, 0)

    expect(surface).toHaveLength(2)
    expect(surface).toContain(0)
  })

  it('keeps a cylinder cap separate from its curved side', () => {
    const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32)
    const capSurface = surfaceTriangles(geometry, 64)
    const sideSurface = surfaceTriangles(geometry, 0)

    expect(sideSurface.length).toBeGreaterThan(32)
    expect(capSurface.length).toBeGreaterThan(1)
    expect(sideSurface).not.toContain(capSurface[0])
  })

  it('creates stable mesh and triangle keys for project persistence', () => {
    expect(faceColorKey('3', 27)).toBe('3:27')
  })

  it('assigns one paint material to every triangle on the selected box side', () => {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: '#ffffff' })
    )
    applyPaintToMesh(mesh, boxObject({ faceColors: { '0:0': '#ef476f', '0:1': '#ef476f' } }), '0')

    expect(Array.isArray(mesh.material)).toBe(true)
    const groups = mesh.geometry.groups.filter((group) => group.start < 6)
    expect(groups).toEqual([{ start: 0, count: 6, materialIndex: 1 }])
  })
})
