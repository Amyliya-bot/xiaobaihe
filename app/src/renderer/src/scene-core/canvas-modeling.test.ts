import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import {
  addModelingEdge,
  addModelingVertex,
  closeModelingDraft,
  createGroundModelingDraft,
  createSurfaceModelingDraftFromPlane,
  createViewModelingDraft,
  draftFromCustomObject,
  draftMesh,
  draftPointFromWorld,
  draftVertexWorldPoint,
  draftWorldPoint,
  extrudeModelingFace,
  finalizeModelingDraft,
  insertVertexOnFace,
  mergeModelingVertices,
  moveModelingVertex,
  orderClosedEdgeLoop,
  type CanvasModelingDraft
} from './canvas-modeling'
import { validateCustomMesh } from './geometry'

function squareFace(): CanvasModelingDraft {
  let draft = createGroundModelingDraft()
  const points = [
    new THREE.Vector3(-1, 0, 1),
    new THREE.Vector3(1, 0, 1),
    new THREE.Vector3(1, 0, -1),
    new THREE.Vector3(-1, 0, -1)
  ]
  points.forEach((point, index) => {
    draft = addModelingVertex(draft, point, index === 0 ? null : index - 1)
  })
  return closeModelingDraft(draft)
}

describe('general vertex, edge and face modeling', () => {
  it('creates one face from a quick sequence of points and lines', () => {
    const draft = squareFace()

    expect(draft.vertices).toHaveLength(4)
    expect(draft.edges).toEqual([
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0]
    ])
    expect(draft.faces).toEqual([[0, 1, 2, 3]])
    expect(draft.selectedFace).toBe(0)
  })

  it('connects any two existing points without requiring profile order', () => {
    let draft = squareFace()
    draft = addModelingEdge(draft, 0, 2)

    expect(draft.edges).toContainEqual([0, 2])
    expect(addModelingEdge(draft, 2, 0).edges).toHaveLength(draft.edges.length)
  })

  it('orders arbitrarily drawn lines into a closed face and rejects branches', () => {
    expect(
      orderClosedEdgeLoop([
        [2, 3],
        [0, 1],
        [3, 0],
        [1, 2]
      ])
    ).toEqual([2, 3, 0, 1])
    expect(() =>
      orderClosedEdgeLoop([
        [0, 1],
        [1, 2],
        [2, 0],
        [1, 3]
      ])
    ).toThrow('没有分叉')
  })

  it('extrudes a selected face into editable topology', () => {
    const draft = extrudeModelingFace(squareFace(), 0, 2)

    expect(draft.vertices).toHaveLength(8)
    expect(draft.edges).toHaveLength(12)
    expect(draft.faces).toHaveLength(6)
    expect(validateCustomMesh(draftMesh(draft))).toEqual([])
  })

  it('moves an extruded point freely in all three axes without a shape shortcut', () => {
    const draft = extrudeModelingFace(squareFace(), 0, 2)
    const moved = moveModelingVertex(draft, 4, new THREE.Vector3(-0.45, 2.7, 0.2))

    expect(moved.vertices[4]).toEqual({ x: -0.45, y: 2.7, z: 0.2 })
    expect(moved.vertices[5]).toEqual(draft.vertices[5])
    expect(validateCustomMesh(draftMesh(moved))).toEqual([])
  })

  it('welds overlapping points and cleans duplicate topology', () => {
    let draft = extrudeModelingFace(squareFace(), 0, 2)
    draft = moveModelingVertex(draft, 5, draftVertexWorldPoint(draft, 4))
    const merged = mergeModelingVertices(draft, 5, 4)

    expect(merged.vertices).toHaveLength(7)
    expect(merged.edges.every(([first, second]) => first !== second)).toBe(true)
    expect(merged.faces.every((face) => new Set(face).size >= 3)).toBe(true)
  })

  it('adds a point directly on a selected face and splits it into editable faces', () => {
    const draft = insertVertexOnFace(squareFace(), 0, new THREE.Vector3(0, 0, 0))

    expect(draft.vertices).toHaveLength(5)
    expect(draft.faces).toHaveLength(4)
    expect(draft.faces.every((face) => face.includes(4))).toBe(true)
    expect(validateCustomMesh(draftMesh(draft))).toEqual([])
  })

  it('maps drawing-plane coordinates to world space without drift', () => {
    const draft = createViewModelingDraft({ x: 4, y: 5, z: 8 }, { x: 1, y: 2, z: 0 })
    const point = { x: 1.25, y: -0.75 }
    const restored = draftPointFromWorld(draft, draftWorldPoint(draft, point))

    expect(restored.x).toBeCloseTo(point.x)
    expect(restored.y).toBeCloseTo(point.y)
  })

  it('starts a local drawing plane from a picked model surface', () => {
    const draft = createSurfaceModelingDraftFromPlane(
      {
        origin: { x: 1, y: 2, z: 3 },
        normal: { x: 0, y: 0, z: 2 },
        axisU: { x: 1, y: 0.2, z: 0 },
        axisV: { x: 0, y: 0, z: 0 }
      },
      'box-1'
    )

    expect(draft.planeMode).toBe('surface')
    expect(draft.surfaceSourceId).toBe('box-1')
    expect(draft.plane.normal).toEqual({ x: 0, y: 0, z: 1 })
    expect(draft.vertices).toEqual([])
  })

  it('centers a new mesh for ordinary object transforms', () => {
    const result = finalizeModelingDraft(extrudeModelingFace(squareFace(), 0, 2))

    expect(result.position).toEqual({ x: 0, y: 1, z: 0 })
    expect(result.size).toEqual({ x: 1, y: 1, z: 1 })
    expect(result.mesh.vertices[0].y).toBe(-1)
  })

  it('preserves an existing object transform while editing its mesh', () => {
    const mesh = finalizeModelingDraft(extrudeModelingFace(squareFace(), 0, 2)).mesh
    const draft = draftFromCustomObject({
      id: 'custom-1',
      kind: 'custom',
      name: '测试模型',
      position: { x: 3, y: 4, z: 5 },
      rotation: { x: 10, y: 20, z: 30 },
      size: { x: 2, y: 3, z: 4 },
      color: '#ffffff',
      visible: true,
      locked: false,
      customMesh: mesh
    })
    const result = finalizeModelingDraft(draft)

    expect(result.position).toEqual({ x: 3, y: 4, z: 5 })
    expect(result.rotation).toEqual({ x: 10, y: 20, z: 30 })
    expect(result.size).toEqual({ x: 2, y: 3, z: 4 })
  })
})
