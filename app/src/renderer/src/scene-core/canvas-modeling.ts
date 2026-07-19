import * as THREE from 'three'
import {
  customProfileToMesh,
  type CustomMeshData,
  type CustomMeshEdge,
  type SceneObjectData,
  type Vector2Value,
  type Vector3Value
} from '../../../shared/project-document'
import { customMeshFaceNormal, validateCustomMesh } from './geometry'

export type MeshElementMode = 'vertex' | 'edge' | 'face'
export type ModelingPlaneMode = 'ground' | 'view' | 'surface'
export type ModelingEdge = CustomMeshEdge

export interface SketchPlane {
  origin: Vector3Value
  normal: Vector3Value
  axisU: Vector3Value
  axisV: Vector3Value
}

export interface DraftTransform {
  position: Vector3Value
  rotation: Vector3Value
  size: Vector3Value
}

export interface CanvasModelingDraft {
  objectId?: string
  planeMode: ModelingPlaneMode
  plane: SketchPlane
  vertices: Vector3Value[]
  edges: ModelingEdge[]
  faces: number[][]
  extrusion: number
  selectedVertex: number | null
  selectedEdge: number | null
  selectedEdges: number[]
  selectedFace: number | null
  pendingEdgeVertex: number | null
  surfaceSourceId?: string
  objectTransform?: DraftTransform
}

export interface FinalizedCustomShape {
  mesh: CustomMeshData
  position: Vector3Value
  rotation: Vector3Value
  size: Vector3Value
}

function value(input: THREE.Vector3): Vector3Value {
  return { x: input.x, y: input.y, z: input.z }
}

function vector(input: Vector3Value): THREE.Vector3 {
  return new THREE.Vector3(input.x, input.y, input.z)
}

function edgeKey(first: number, second: number): string {
  return first < second ? `${first}:${second}` : `${second}:${first}`
}

function copyTransform(transform: DraftTransform): DraftTransform {
  return {
    position: { ...transform.position },
    rotation: { ...transform.rotation },
    size: { ...transform.size }
  }
}

export function draftMesh(draft: CanvasModelingDraft): CustomMeshData {
  return {
    vertices: draft.vertices.map((point) => ({ ...point })),
    edges: draft.edges.map(([first, second]) => [first, second]),
    faces: draft.faces.map((face) => [...face])
  }
}

export function normalizeSketchPlane(plane: SketchPlane): SketchPlane {
  const normal = vector(plane.normal).normalize()
  let axisU = vector(plane.axisU).sub(
    normal.clone().multiplyScalar(vector(plane.axisU).dot(normal))
  )
  if (axisU.lengthSq() < 1e-8) {
    axisU =
      Math.abs(normal.y) < 0.9
        ? new THREE.Vector3(0, 1, 0).cross(normal)
        : new THREE.Vector3(0, 0, 1).cross(normal)
  }
  axisU.normalize()
  const axisV = normal.clone().cross(axisU).normalize()
  return {
    origin: { ...plane.origin },
    normal: value(normal),
    axisU: value(axisU),
    axisV: value(axisV)
  }
}

export function createGroundModelingDraft(): CanvasModelingDraft {
  return {
    planeMode: 'ground',
    plane: {
      origin: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      axisU: { x: 1, y: 0, z: 0 },
      axisV: { x: 0, y: 0, z: -1 }
    },
    vertices: [],
    edges: [],
    faces: [],
    extrusion: 1,
    selectedVertex: null,
    selectedEdge: null,
    selectedEdges: [],
    selectedFace: null,
    pendingEdgeVertex: null
  }
}

export function createViewModelingDraft(
  cameraPosition: Vector3Value,
  cameraTarget: Vector3Value
): CanvasModelingDraft {
  const position = vector(cameraPosition)
  const origin = vector(cameraTarget)
  const normal = position.sub(origin).normalize()
  const helperAxis =
    Math.abs(normal.y) > 0.94 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)
  const axisU = helperAxis.cross(normal).normalize()
  return {
    ...createGroundModelingDraft(),
    planeMode: 'view',
    plane: normalizeSketchPlane({
      origin: value(origin),
      normal: value(normal),
      axisU: value(axisU),
      axisV: { x: 0, y: 0, z: 0 }
    })
  }
}

export function draftWorldPoint(draft: CanvasModelingDraft, point: Vector2Value): THREE.Vector3 {
  const plane = normalizeSketchPlane(draft.plane)
  return vector(plane.origin)
    .addScaledVector(vector(plane.axisU), point.x)
    .addScaledVector(vector(plane.axisV), point.y)
}

export function draftPointFromWorld(
  draft: CanvasModelingDraft,
  point: THREE.Vector3
): Vector2Value {
  const plane = normalizeSketchPlane(draft.plane)
  const offset = point.clone().sub(vector(plane.origin))
  return {
    x: offset.dot(vector(plane.axisU)),
    y: offset.dot(vector(plane.axisV))
  }
}

function transformMatrix(transform?: DraftTransform): THREE.Matrix4 {
  if (!transform) return new THREE.Matrix4()
  return new THREE.Matrix4().compose(
    vector(transform.position),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(transform.rotation.x),
        THREE.MathUtils.degToRad(transform.rotation.y),
        THREE.MathUtils.degToRad(transform.rotation.z)
      )
    ),
    vector(transform.size)
  )
}

export function draftVertexWorldPoint(
  draft: CanvasModelingDraft,
  vertex: number | Vector3Value
): THREE.Vector3 {
  const point = typeof vertex === 'number' ? draft.vertices[vertex] : vertex
  return vector(point).applyMatrix4(transformMatrix(draft.objectTransform))
}

export function draftVertexFromWorld(
  draft: CanvasModelingDraft,
  point: THREE.Vector3
): Vector3Value {
  return value(point.clone().applyMatrix4(transformMatrix(draft.objectTransform).invert()))
}

export function addModelingVertex(
  draft: CanvasModelingDraft,
  worldPoint: THREE.Vector3,
  connectFrom: number | null = null
): CanvasModelingDraft {
  const vertexIndex = draft.vertices.length
  const next: CanvasModelingDraft = {
    ...draft,
    vertices: [...draft.vertices, draftVertexFromWorld(draft, worldPoint)],
    selectedVertex: vertexIndex,
    selectedEdge: null,
    selectedEdges: [],
    selectedFace: null
  }
  return connectFrom === null ? next : addModelingEdge(next, connectFrom, vertexIndex)
}

export function moveModelingVertex(
  draft: CanvasModelingDraft,
  vertexIndex: number,
  worldPoint: THREE.Vector3
): CanvasModelingDraft {
  if (!draft.vertices[vertexIndex]) return draft
  const vertices = draft.vertices.map((point, index) =>
    index === vertexIndex ? draftVertexFromWorld(draft, worldPoint) : { ...point }
  )
  return { ...draft, vertices, selectedVertex: vertexIndex }
}

export function addModelingEdge(
  draft: CanvasModelingDraft,
  first: number,
  second: number
): CanvasModelingDraft {
  if (!draft.vertices[first] || !draft.vertices[second] || first === second) return draft
  const key = edgeKey(first, second)
  const existing = draft.edges.findIndex(([start, end]) => edgeKey(start, end) === key)
  if (existing >= 0) {
    return {
      ...draft,
      selectedEdge: existing,
      selectedEdges: [existing],
      pendingEdgeVertex: null
    }
  }
  return {
    ...draft,
    edges: [...draft.edges, [first, second]],
    selectedEdge: draft.edges.length,
    selectedEdges: [draft.edges.length],
    selectedFace: null,
    pendingEdgeVertex: null
  }
}

export function orderClosedEdgeLoop(edges: ModelingEdge[], selectedEdges: number[] = []): number[] {
  const chosenIndices = selectedEdges.length > 0 ? selectedEdges : edges.map((_, index) => index)
  const chosen = chosenIndices.map((index) => edges[index])
  if (chosen.length < 3 || chosen.some((edge) => !edge)) {
    throw new Error('成面至少需要三条有效的线。')
  }
  const neighbours = new Map<number, number[]>()
  for (const [first, second] of chosen) {
    neighbours.set(first, [...(neighbours.get(first) ?? []), second])
    neighbours.set(second, [...(neighbours.get(second) ?? []), first])
  }
  if ([...neighbours.values()].some((items) => items.length !== 2)) {
    throw new Error('所选线必须组成没有分叉的闭合轮廓。')
  }
  const start = chosen[0][0]
  const loop = [start]
  let previous = -1
  let current = start
  while (loop.length <= chosen.length) {
    const next = neighbours.get(current)?.find((item) => item !== previous)
    if (next === undefined) throw new Error('所选线没有形成连续闭环。')
    if (next === start) break
    if (loop.includes(next)) throw new Error('所选线形成了重复或交叉环路。')
    loop.push(next)
    previous = current
    current = next
  }
  if (loop.length !== chosen.length) throw new Error('所选线没有形成一个完整闭环。')
  return loop
}

export function closeModelingDraft(draft: CanvasModelingDraft): CanvasModelingDraft {
  let next = draft
  const chosen = draft.selectedEdges.length >= 3 ? draft.selectedEdges : []
  if (
    chosen.length === 0 &&
    draft.vertices.length >= 3 &&
    draft.edges.length === draft.vertices.length - 1
  ) {
    next = addModelingEdge(draft, draft.vertices.length - 1, 0)
  }
  const loop = orderClosedEdgeLoop(next.edges, chosen)
  const faceNormal = customMeshFaceNormal(
    { vertices: next.vertices, edges: next.edges, faces: [loop] },
    loop
  )
  if (faceNormal.lengthSq() < 1e-10) throw new Error('这些线围成的面过小，请移动点后重试。')
  const duplicateFace = next.faces.some(
    (face) => face.length === loop.length && face.every((vertex) => loop.includes(vertex))
  )
  if (duplicateFace) throw new Error('这个面已经存在。')
  return {
    ...next,
    faces: [...next.faces, loop],
    selectedVertex: null,
    selectedEdge: null,
    selectedEdges: [],
    selectedFace: next.faces.length,
    pendingEdgeVertex: null
  }
}

export function insertVertexOnFace(
  draft: CanvasModelingDraft,
  faceIndex: number,
  worldPoint: THREE.Vector3
): CanvasModelingDraft {
  const face = draft.faces[faceIndex]
  if (!face) throw new Error('请先选择一个有效的面。')
  const vertexIndex = draft.vertices.length
  let next: CanvasModelingDraft = {
    ...draft,
    vertices: [...draft.vertices, draftVertexFromWorld(draft, worldPoint)],
    faces: draft.faces.filter((_, index) => index !== faceIndex),
    selectedFace: null,
    selectedVertex: vertexIndex
  }
  face.forEach((current, index) => {
    const following = face[(index + 1) % face.length]
    next = addModelingEdge(next, current, vertexIndex)
    next.faces.push([current, following, vertexIndex])
  })
  return { ...next, selectedVertex: vertexIndex, selectedEdge: null, selectedEdges: [] }
}

export function extrudeModelingFace(
  draft: CanvasModelingDraft,
  faceIndex: number,
  distance: number
): CanvasModelingDraft {
  const face = draft.faces[faceIndex]
  if (!face) throw new Error('请先选择要拉伸的面。')
  if (!Number.isFinite(distance) || Math.abs(distance) < 0.01) {
    throw new Error('拉伸距离至少需要 0.01。')
  }
  const mesh = draftMesh(draft)
  const normal = customMeshFaceNormal(mesh, face)
  if (normal.lengthSq() < 1e-10) throw new Error('这个面过小，无法稳定拉伸。')
  const offset = normal.multiplyScalar(distance)
  const newIndices = face.map((_, index) => draft.vertices.length + index)
  const newVertices = face.map((vertexIndex) =>
    value(vector(draft.vertices[vertexIndex]).add(offset))
  )
  const keepBase = draft.faces.length === 1
  const retainedFaces = draft.faces.filter((_, index) => index !== faceIndex)
  const baseFace = distance > 0 ? [...face].reverse() : [...face]
  const topFace = distance > 0 ? [...newIndices] : [...newIndices].reverse()
  const sideFaces = face.map((oldIndex, index) => {
    const oldNext = face[(index + 1) % face.length]
    const newIndex = newIndices[index]
    const newNext = newIndices[(index + 1) % face.length]
    return distance > 0
      ? [oldIndex, oldNext, newNext, newIndex]
      : [oldNext, oldIndex, newIndex, newNext]
  })
  let next: CanvasModelingDraft = {
    ...draft,
    vertices: [...draft.vertices, ...newVertices],
    faces: [...retainedFaces, ...(keepBase ? [baseFace] : []), ...sideFaces, topFace],
    selectedVertex: null,
    selectedEdge: null,
    selectedEdges: [],
    selectedFace: retainedFaces.length + (keepBase ? 1 : 0) + sideFaces.length,
    pendingEdgeVertex: null,
    extrusion: distance
  }
  face.forEach((oldIndex, index) => {
    const nextIndex = (index + 1) % face.length
    next = addModelingEdge(next, newIndices[index], newIndices[nextIndex])
    next = addModelingEdge(next, oldIndex, newIndices[index])
  })
  return {
    ...next,
    selectedEdge: null,
    selectedEdges: [],
    selectedFace: retainedFaces.length + (keepBase ? 1 : 0) + sideFaces.length
  }
}

export function mergeModelingVertices(
  draft: CanvasModelingDraft,
  sourceIndex: number,
  targetIndex: number
): CanvasModelingDraft {
  if (sourceIndex === targetIndex || !draft.vertices[sourceIndex] || !draft.vertices[targetIndex]) {
    return draft
  }
  const remapIndex = (index: number): number => {
    const merged = index === sourceIndex ? targetIndex : index
    return merged > sourceIndex ? merged - 1 : merged
  }
  const vertices = draft.vertices
    .filter((_, index) => index !== sourceIndex)
    .map((point) => ({ ...point }))
  const edgeKeys = new Set<string>()
  const edges: ModelingEdge[] = []
  for (const [first, second] of draft.edges) {
    const remapped: ModelingEdge = [remapIndex(first), remapIndex(second)]
    if (remapped[0] === remapped[1]) continue
    const key = edgeKey(remapped[0], remapped[1])
    if (edgeKeys.has(key)) continue
    edgeKeys.add(key)
    edges.push(remapped)
  }
  const faces = draft.faces.reduce<number[][]>((result, face) => {
    const remapped = face
      .map(remapIndex)
      .filter((index, position, values) => index !== values[position - 1])
    if (remapped[0] === remapped.at(-1)) remapped.pop()
    if (new Set(remapped).size < 3) return result
    const unique = remapped.filter((index, position) => remapped.indexOf(index) === position)
    return unique.length >= 3 ? [...result, unique] : result
  }, [])
  return {
    ...draft,
    vertices,
    edges,
    faces,
    selectedVertex: remapIndex(targetIndex),
    selectedEdge: null,
    selectedEdges: [],
    selectedFace: null,
    pendingEdgeVertex: null
  }
}

export function modelingFaceWorldCenter(
  draft: CanvasModelingDraft,
  faceIndex: number
): THREE.Vector3 {
  const face = draft.faces[faceIndex]
  if (!face || face.length === 0) return new THREE.Vector3()
  return face
    .reduce((center, index) => center.add(draftVertexWorldPoint(draft, index)), new THREE.Vector3())
    .multiplyScalar(1 / face.length)
}

export function modelingFaceWorldNormal(
  draft: CanvasModelingDraft,
  faceIndex: number
): THREE.Vector3 {
  const face = draft.faces[faceIndex]
  if (!face) return new THREE.Vector3(0, 1, 0)
  const local = customMeshFaceNormal(draftMesh(draft), face)
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(transformMatrix(draft.objectTransform))
  return local.applyMatrix3(normalMatrix).normalize()
}

export function finalizeModelingDraft(draft: CanvasModelingDraft): FinalizedCustomShape {
  const mesh = draftMesh(draft)
  const issues = validateCustomMesh(mesh)
  if (issues.length > 0) throw new Error(issues[0])
  if (draft.objectTransform) {
    return { mesh, ...copyTransform(draft.objectTransform) }
  }

  const bounds = new THREE.Box3().setFromPoints(mesh.vertices.map(vector))
  const center = bounds.getCenter(new THREE.Vector3())
  return {
    mesh: {
      ...mesh,
      vertices: mesh.vertices.map((point) => value(vector(point).sub(center)))
    },
    position: value(center),
    rotation: { x: 0, y: 0, z: 0 },
    size: { x: 1, y: 1, z: 1 }
  }
}

export function draftFromCustomObject(object: SceneObjectData): CanvasModelingDraft {
  if (object.kind !== 'custom' || (!object.customMesh && !object.customProfile)) {
    throw new Error('只有画布自定义模型可以进入点线面编辑。')
  }
  const mesh = object.customMesh ?? customProfileToMesh(object.customProfile!)
  return {
    ...createGroundModelingDraft(),
    objectId: object.id,
    planeMode: 'view',
    vertices: mesh.vertices.map((point) => ({ ...point })),
    edges: mesh.edges.map(([first, second]) => [first, second]),
    faces: mesh.faces.map((face) => [...face]),
    selectedFace: mesh.faces.length > 0 ? mesh.faces.length - 1 : null,
    objectTransform: {
      position: { ...object.position },
      rotation: { ...object.rotation },
      size: { ...object.size }
    }
  }
}

export function createSurfaceModelingDraft(draft: CanvasModelingDraft): CanvasModelingDraft {
  if (!draft.objectId || draft.selectedFace === null) {
    throw new Error('请先选择已有模型的一个面。')
  }
  const origin = modelingFaceWorldCenter(draft, draft.selectedFace)
  const normal = modelingFaceWorldNormal(draft, draft.selectedFace)
  const helper = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
  const axisU = helper.cross(normal).normalize()
  return {
    ...createGroundModelingDraft(),
    planeMode: 'surface',
    plane: normalizeSketchPlane({
      origin: value(origin),
      normal: value(normal),
      axisU: value(axisU),
      axisV: { x: 0, y: 0, z: 0 }
    }),
    surfaceSourceId: draft.objectId
  }
}

export function createSurfaceModelingDraftFromPlane(
  plane: SketchPlane,
  surfaceSourceId: string
): CanvasModelingDraft {
  return {
    ...createGroundModelingDraft(),
    planeMode: 'surface',
    plane: normalizeSketchPlane(plane),
    surfaceSourceId
  }
}

export function snapSketchValue(input: number, step = 0.1): number {
  return Math.round(input / step) * step
}
