import * as THREE from 'three'
import type { ObjectDisplayMode, SceneObjectData } from '../../../shared/project-document'

const normalAngleLimit = THREE.MathUtils.degToRad(20)
const normalDotLimit = Math.cos(normalAngleLimit)
const coordinatePrecision = 100_000

interface FaceTopology {
  neighbors: number[][]
  normals: THREE.Vector3[]
  regions: Map<number, readonly number[]>
}

const topologyCache = new WeakMap<THREE.BufferGeometry, FaceTopology>()

function triangleCount(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute('position')
  if (!position) return 0
  return Math.floor((geometry.index?.count ?? position.count) / 3)
}

function vertexIndex(geometry: THREE.BufferGeometry, triangle: number, corner: number): number {
  return geometry.index?.getX(triangle * 3 + corner) ?? triangle * 3 + corner
}

function vertexPoint(
  geometry: THREE.BufferGeometry,
  triangle: number,
  corner: number,
  target: THREE.Vector3
): THREE.Vector3 {
  const position = geometry.getAttribute('position')
  return target.fromBufferAttribute(position, vertexIndex(geometry, triangle, corner))
}

function pointKey(point: THREE.Vector3): string {
  return `${Math.round(point.x * coordinatePrecision)},${Math.round(point.y * coordinatePrecision)},${Math.round(point.z * coordinatePrecision)}`
}

function edgeKey(first: THREE.Vector3, second: THREE.Vector3): string {
  const firstKey = pointKey(first)
  const secondKey = pointKey(second)
  return firstKey < secondKey ? `${firstKey}|${secondKey}` : `${secondKey}|${firstKey}`
}

function createTopology(geometry: THREE.BufferGeometry): FaceTopology {
  const count = triangleCount(geometry)
  const neighbors = Array.from({ length: count }, () => [] as number[])
  const normals = Array.from({ length: count }, () => new THREE.Vector3())
  const edges = new Map<string, number[]>()
  const first = new THREE.Vector3()
  const second = new THREE.Vector3()
  const third = new THREE.Vector3()

  for (let triangle = 0; triangle < count; triangle += 1) {
    vertexPoint(geometry, triangle, 0, first)
    vertexPoint(geometry, triangle, 1, second)
    vertexPoint(geometry, triangle, 2, third)
    normals[triangle].copy(second).sub(first).cross(third.clone().sub(first)).normalize()
    for (const [start, end] of [
      [first, second],
      [second, third],
      [third, first]
    ] as Array<[THREE.Vector3, THREE.Vector3]>) {
      const key = edgeKey(start, end)
      const matches = edges.get(key)
      if (matches) matches.push(triangle)
      else edges.set(key, [triangle])
    }
  }

  for (const triangles of edges.values()) {
    for (let firstIndex = 0; firstIndex < triangles.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < triangles.length; secondIndex += 1) {
        const firstTriangle = triangles[firstIndex]
        const secondTriangle = triangles[secondIndex]
        neighbors[firstTriangle].push(secondTriangle)
        neighbors[secondTriangle].push(firstTriangle)
      }
    }
  }

  return { neighbors, normals, regions: new Map() }
}

function topologyFor(geometry: THREE.BufferGeometry): FaceTopology {
  const cached = topologyCache.get(geometry)
  if (cached) return cached
  const topology = createTopology(geometry)
  topologyCache.set(geometry, topology)
  return topology
}

export function surfaceTriangles(
  geometry: THREE.BufferGeometry,
  seedTriangle: number
): readonly number[] {
  const topology = topologyFor(geometry)
  if (seedTriangle < 0 || seedTriangle >= topology.normals.length) return []
  const cached = topology.regions.get(seedTriangle)
  if (cached) return cached

  const region: number[] = []
  const queue = [seedTriangle]
  const visited = new Set(queue)
  for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
    const triangle = queue[queueIndex]
    region.push(triangle)
    for (const neighbor of topology.neighbors[triangle]) {
      if (
        visited.has(neighbor) ||
        topology.normals[triangle].dot(topology.normals[neighbor]) < normalDotLimit
      ) {
        continue
      }
      visited.add(neighbor)
      queue.push(neighbor)
    }
  }

  region.sort((first, second) => first - second)
  for (const triangle of region) topology.regions.set(triangle, region)
  return region
}

export function faceColorKey(meshKey: string, triangle: number): string {
  return `${meshKey}:${triangle}`
}

function originalMaterialIndex(geometry: THREE.BufferGeometry, triangle: number): number {
  const offset = triangle * 3
  const group = geometry.groups.find(
    (candidate) => offset >= candidate.start && offset < candidate.start + candidate.count
  )
  return group?.materialIndex ?? 0
}

function applyDisplayMode(material: THREE.Material, displayMode: ObjectDisplayMode): void {
  if (displayMode === 'solid') return
  material.transparent = true
  material.opacity = displayMode === 'transparent' ? 0.34 : 0.62
  material.depthWrite = false
  if ('wireframe' in material) material.wireframe = displayMode === 'wireframe'
  material.needsUpdate = true
}

function createPaintMaterial(
  color: string,
  displayMode: ObjectDisplayMode
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.82,
    metalness: 0,
    side: THREE.DoubleSide
  })
  applyDisplayMode(material, displayMode)
  return material
}

function tintMaterial(material: THREE.Material, color: string): THREE.Material {
  const candidate = material as THREE.Material & { color?: THREE.Color }
  if (candidate.color instanceof THREE.Color) {
    candidate.color.set(color)
    candidate.needsUpdate = true
    return candidate
  }
  return createPaintMaterial(color, 'solid')
}

function colorsForMesh(object: SceneObjectData, meshKey: string): Map<number, string> {
  const result = new Map<number, string>()
  for (const [key, color] of Object.entries(object.faceColors ?? {})) {
    const separator = key.lastIndexOf(':')
    if (separator < 0 || key.slice(0, separator) !== meshKey) continue
    const triangle = Number(key.slice(separator + 1))
    if (Number.isSafeInteger(triangle) && triangle >= 0) result.set(triangle, color)
  }
  return result
}

export function applyPaintToMesh(
  mesh: THREE.Mesh,
  object: SceneObjectData,
  meshKey: string,
  cloneGeometry = false
): void {
  const displayMode = object.displayMode ?? 'solid'
  const originalMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const baseMaterials = object.colorOverride
    ? originalMaterials.map((material) => tintMaterial(material, object.colorOverride as string))
    : originalMaterials
  for (const material of baseMaterials) applyDisplayMode(material, displayMode)

  const faceColors = colorsForMesh(object, meshKey)
  if (faceColors.size === 0) {
    mesh.material = baseMaterials.length === 1 ? baseMaterials[0] : baseMaterials
    return
  }

  if (cloneGeometry) mesh.geometry = mesh.geometry.clone()
  const geometry = mesh.geometry
  const materials = [...baseMaterials]
  const colorMaterialIndices = new Map<string, number>()
  const materialIndexFor = (color: string): number => {
    const cached = colorMaterialIndices.get(color)
    if (cached !== undefined) return cached
    const index = materials.length
    materials.push(createPaintMaterial(color, displayMode))
    colorMaterialIndices.set(color, index)
    return index
  }

  const count = triangleCount(geometry)
  const assignments = Array.from({ length: count }, (_, triangle) => {
    const color = faceColors.get(triangle)
    if (color) return materialIndexFor(color)
    const originalIndex = originalMaterialIndex(geometry, triangle)
    return originalIndex < baseMaterials.length ? originalIndex : 0
  })
  geometry.clearGroups()
  let groupStart = 0
  for (let triangle = 1; triangle <= assignments.length; triangle += 1) {
    if (triangle < assignments.length && assignments[triangle] === assignments[groupStart]) continue
    geometry.addGroup(groupStart * 3, (triangle - groupStart) * 3, assignments[groupStart] ?? 0)
    groupStart = triangle
  }
  mesh.material = materials
}

export function createSurfacePreviewGeometry(
  mesh: THREE.Mesh,
  triangles: readonly number[]
): THREE.BufferGeometry {
  mesh.updateMatrixWorld(true)
  const positions: number[] = []
  const point = new THREE.Vector3()
  for (const triangle of triangles) {
    for (let corner = 0; corner < 3; corner += 1) {
      vertexPoint(mesh.geometry, triangle, corner, point).applyMatrix4(mesh.matrixWorld)
      positions.push(point.x, point.y, point.z)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  return geometry
}
