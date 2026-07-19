import * as THREE from 'three'
import type {
  CustomMeshData,
  CustomProfileData,
  SceneObjectData,
  Vector2Value,
  Vector3Value
} from '../../../shared/project-document'
import { applyMeshCuts } from './mesh-cut'

const epsilon = 1e-6

export function polygonArea(points: Vector2Value[]): number {
  return Math.abs(signedPolygonArea(points))
}

function signedPolygonArea(points: Vector2Value[]): number {
  return (
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length]
      return sum + point.x * next.y - next.x * point.y
    }, 0) / 2
  )
}

function orientation(a: Vector2Value, b: Vector2Value, c: Vector2Value): number {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y)
}

function segmentsIntersect(
  a: Vector2Value,
  b: Vector2Value,
  c: Vector2Value,
  d: Vector2Value
): boolean {
  const first = orientation(a, b, c)
  const second = orientation(a, b, d)
  const third = orientation(c, d, a)
  const fourth = orientation(c, d, b)
  return first * second < -epsilon && third * fourth < -epsilon
}

export function profileSelfIntersects(points: Vector2Value[]): boolean {
  for (let first = 0; first < points.length; first += 1) {
    const firstNext = (first + 1) % points.length
    for (let second = first + 1; second < points.length; second += 1) {
      const secondNext = (second + 1) % points.length
      if (first === second || firstNext === second || secondNext === first) continue
      if (first === 0 && secondNext === 0) continue
      if (segmentsIntersect(points[first], points[firstNext], points[second], points[secondNext])) {
        return true
      }
    }
  }
  return false
}

export function validateCustomProfile(profile: CustomProfileData): string[] {
  const issues: string[] = []
  if (profile.points.length < 3) issues.push('轮廓至少需要三个点。')
  if (profile.points.length > 64) issues.push('轮廓点过多，请控制在 64 个以内。')
  if (profile.points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
    issues.push('轮廓包含无效坐标，请重新放置对应点。')
  }
  if (
    profile.points.some((point, index) => {
      const next = profile.points[(index + 1) % profile.points.length]
      return next && Math.hypot(point.x - next.x, point.y - next.y) < epsilon
    })
  ) {
    issues.push('相邻轮廓点发生重叠，请移动或删除其中一个点。')
  }
  if (polygonArea(profile.points) < 0.005) issues.push('轮廓面积太小，无法生成稳定模型。')
  if (profileSelfIntersects(profile.points)) issues.push('轮廓线发生交叉，请调整点的位置。')
  if (profile.topPoints) {
    if (profile.topPoints.length !== profile.points.length) {
      issues.push('顶面和底面的点数量必须一致。')
    } else if (
      profile.topPoints.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))
    ) {
      issues.push('顶面包含无效坐标，请重新调整。')
    } else if (polygonArea(profile.topPoints) >= 0.005) {
      if (
        profile.topPoints.some((point, index) => {
          const next = profile.topPoints?.[(index + 1) % profile.topPoints.length]
          return next && Math.hypot(point.x - next.x, point.y - next.y) < epsilon
        })
      ) {
        issues.push('顶面相邻点发生重叠，请移动或合并其中一个点。')
      }
      if (profileSelfIntersects(profile.topPoints)) {
        issues.push('顶面轮廓线发生交叉，请调整点的位置。')
      }
    }
  }
  return issues
}

function addTriangle(
  positions: number[],
  first: THREE.Vector3,
  second: THREE.Vector3,
  third: THREE.Vector3,
  desiredNormal?: THREE.Vector3
): void {
  const cross = second.clone().sub(first).cross(third.clone().sub(first))
  if (cross.lengthSq() < epsilon * epsilon) return
  const flip = desiredNormal ? cross.dot(desiredNormal) < 0 : false
  const ordered = flip ? [first, third, second] : [first, second, third]
  for (const point of ordered) positions.push(point.x, point.y, point.z)
}

export function createCustomGeometry(profile: CustomProfileData): THREE.BufferGeometry {
  const issues = validateCustomProfile(profile)
  if (issues.length > 0) throw new Error(issues[0])
  const sourceTopPoints = profile.topPoints ?? profile.points
  const bottomPoints =
    signedPolygonArea(profile.points) < 0 ? [...profile.points].reverse() : profile.points
  const topPoints =
    signedPolygonArea(profile.points) < 0 ? [...sourceTopPoints].reverse() : sourceTopPoints
  const bottom = bottomPoints.map((point) => new THREE.Vector3(point.x, -0.5, -point.y))
  const top = topPoints.map((point) => new THREE.Vector3(point.x, 0.5, -point.y))
  const positions: number[] = []
  const bottomTriangles = THREE.ShapeUtils.triangulateShape(
    bottomPoints.map((point) => new THREE.Vector2(point.x, point.y)),
    []
  )
  const topTriangles =
    polygonArea(topPoints) > epsilon
      ? THREE.ShapeUtils.triangulateShape(
          topPoints.map((point) => new THREE.Vector2(point.x, point.y)),
          []
        )
      : []
  for (const [first, second, third] of bottomTriangles) {
    addTriangle(
      positions,
      bottom[first],
      bottom[second],
      bottom[third],
      new THREE.Vector3(0, -1, 0)
    )
  }
  for (const [first, second, third] of topTriangles) {
    addTriangle(positions, top[first], top[second], top[third], new THREE.Vector3(0, 1, 0))
  }
  for (let index = 0; index < bottom.length; index += 1) {
    const next = (index + 1) % bottom.length
    addTriangle(positions, bottom[index], bottom[next], top[next])
    addTriangle(positions, bottom[index], top[next], top[index])
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  return geometry
}

function meshVertex(value: Vector3Value): THREE.Vector3 {
  return new THREE.Vector3(value.x, value.y, value.z)
}

export function customMeshFaceNormal(mesh: CustomMeshData, face: number[]): THREE.Vector3 {
  const normal = new THREE.Vector3()
  for (let index = 0; index < face.length; index += 1) {
    const current = mesh.vertices[face[index]]
    const next = mesh.vertices[face[(index + 1) % face.length]]
    if (!current || !next) continue
    normal.x += (current.y - next.y) * (current.z + next.z)
    normal.y += (current.z - next.z) * (current.x + next.x)
    normal.z += (current.x - next.x) * (current.y + next.y)
  }
  return normal.lengthSq() > epsilon * epsilon ? normal.normalize() : normal
}

function projectedFacePoint(point: Vector3Value, normal: THREE.Vector3): THREE.Vector2 {
  const x = Math.abs(normal.x)
  const y = Math.abs(normal.y)
  const z = Math.abs(normal.z)
  if (x >= y && x >= z) return new THREE.Vector2(point.y, point.z)
  if (y >= z) return new THREE.Vector2(point.x, point.z)
  return new THREE.Vector2(point.x, point.y)
}

export function validateCustomMesh(mesh: CustomMeshData): string[] {
  const issues: string[] = []
  if (mesh.vertices.length < 3) issues.push('模型至少需要三个点。')
  if (mesh.vertices.length > 4096) issues.push('模型点数超过 4096，请先拆分模型。')
  if (mesh.faces.length < 1) issues.push('请先用闭合的线生成至少一个面。')
  if (
    mesh.vertices.some(
      (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)
    )
  ) {
    issues.push('模型包含无效点坐标。')
  }
  const edgeKeys = new Set<string>()
  for (const [first, second] of mesh.edges) {
    if (
      !Number.isInteger(first) ||
      !Number.isInteger(second) ||
      first < 0 ||
      second < 0 ||
      first >= mesh.vertices.length ||
      second >= mesh.vertices.length ||
      first === second
    ) {
      issues.push('模型中存在无效的线。')
      break
    }
    const key = first < second ? `${first}:${second}` : `${second}:${first}`
    if (edgeKeys.has(key)) {
      issues.push('模型中存在重复的线。')
      break
    }
    edgeKeys.add(key)
  }
  for (const face of mesh.faces) {
    if (
      face.length < 3 ||
      new Set(face).size !== face.length ||
      face.some((index) => !Number.isInteger(index) || index < 0 || index >= mesh.vertices.length)
    ) {
      issues.push('模型中存在无效的面。')
      break
    }
    if (customMeshFaceNormal(mesh, face).lengthSq() < epsilon * epsilon) {
      issues.push('模型中有面积过小或完全重叠的面。')
      break
    }
    if (
      face.some((index, position) => {
        const next = face[(position + 1) % face.length]
        const key = index < next ? `${index}:${next}` : `${next}:${index}`
        return !edgeKeys.has(key)
      })
    ) {
      issues.push('模型的面缺少相连的边。')
      break
    }
  }
  return issues
}

export function createCustomMeshGeometry(mesh: CustomMeshData): THREE.BufferGeometry {
  const issues = validateCustomMesh(mesh)
  if (issues.length > 0) throw new Error(issues[0])
  const positions: number[] = []

  for (const face of mesh.faces) {
    const normal = customMeshFaceNormal(mesh, face)
    const projected = face.map((index) => projectedFacePoint(mesh.vertices[index], normal))
    const triangles = THREE.ShapeUtils.triangulateShape(projected, [])
    for (const [first, second, third] of triangles) {
      addTriangle(
        positions,
        meshVertex(mesh.vertices[face[first]]),
        meshVertex(mesh.vertices[face[second]]),
        meshVertex(mesh.vertices[face[third]]),
        normal
      )
    }
  }
  if (positions.length === 0) throw new Error('模型的面无法生成，请检查点和线的位置。')

  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export function createGeometry(object: SceneObjectData): THREE.BufferGeometry {
  let geometry: THREE.BufferGeometry
  if (object.kind === 'cylinder') geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32)
  else if (object.kind === 'sphere') geometry = new THREE.SphereGeometry(0.5, 32, 20)
  else if (object.kind === 'custom' && object.customMesh) {
    geometry = createCustomMeshGeometry(object.customMesh)
  } else if (object.kind === 'custom' && object.customProfile) {
    geometry = createCustomGeometry(object.customProfile)
  } else geometry = new THREE.BoxGeometry(1, 1, 1)
  return applyMeshCuts(geometry, object.cuts)
}

export function objectLocalBounds(object: SceneObjectData): THREE.Box3 {
  if (object.kind === 'mannequin') {
    return new THREE.Box3(new THREE.Vector3(-0.2, -0.5, -0.16), new THREE.Vector3(0.2, 0.5, 0.16))
  }
  if (object.kind === 'imported' && object.importedAsset) {
    const bounds = object.importedAsset.report.bounds
    const longestSide = Math.max(bounds.x, bounds.y, bounds.z, epsilon)
    return new THREE.Box3(
      new THREE.Vector3(
        -bounds.x / longestSide / 2,
        -bounds.y / longestSide / 2,
        -bounds.z / longestSide / 2
      ),
      new THREE.Vector3(
        bounds.x / longestSide / 2,
        bounds.y / longestSide / 2,
        bounds.z / longestSide / 2
      )
    )
  }
  const geometry = createGeometry(object)
  geometry.computeBoundingBox()
  const bounds = geometry.boundingBox?.clone() ?? new THREE.Box3()
  geometry.dispose()
  return bounds
}

export function objectWorldBounds(object: SceneObjectData): THREE.Box3 {
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(object.position.x, object.position.y, object.position.z),
    new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(object.rotation.x),
        THREE.MathUtils.degToRad(object.rotation.y),
        THREE.MathUtils.degToRad(object.rotation.z)
      )
    ),
    new THREE.Vector3(object.size.x, object.size.y, object.size.z)
  )
  return objectLocalBounds(object).applyMatrix4(matrix)
}
