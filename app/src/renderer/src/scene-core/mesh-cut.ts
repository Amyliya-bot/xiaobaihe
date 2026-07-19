import * as THREE from 'three'
import type { MeshCutData } from '../../../shared/project-document'

const epsilon = 1e-5

function planeDistance(point: THREE.Vector3, cut: MeshCutData): number {
  const signed = point.dot(new THREE.Vector3(cut.normal.x, cut.normal.y, cut.normal.z)) - cut.offset
  return cut.keep === 'positive' ? signed : -signed
}

function intersection(
  first: THREE.Vector3,
  second: THREE.Vector3,
  firstDistance: number,
  secondDistance: number
): THREE.Vector3 {
  const amount = firstDistance / (firstDistance - secondDistance)
  return first.clone().lerp(second, THREE.MathUtils.clamp(amount, 0, 1))
}

function clipPolygon(points: THREE.Vector3[], cut: MeshCutData): THREE.Vector3[] {
  const result: THREE.Vector3[] = []
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]
    const previous = points[(index + points.length - 1) % points.length]
    const currentDistance = planeDistance(current, cut)
    const previousDistance = planeDistance(previous, cut)
    const currentInside = currentDistance >= -epsilon
    const previousInside = previousDistance >= -epsilon
    if (currentInside && !previousInside) {
      result.push(intersection(previous, current, previousDistance, currentDistance))
    }
    if (currentInside) result.push(current.clone())
    if (!currentInside && previousInside) {
      result.push(intersection(previous, current, previousDistance, currentDistance))
    }
  }
  return result
}

function addTriangle(
  positions: number[],
  first: THREE.Vector3,
  second: THREE.Vector3,
  third: THREE.Vector3,
  desiredNormal?: THREE.Vector3
): void {
  const normal = second.clone().sub(first).cross(third.clone().sub(first))
  if (normal.lengthSq() < epsilon * epsilon) return
  const resolvedSecond = desiredNormal && normal.dot(desiredNormal) < 0 ? third : second
  const resolvedThird = desiredNormal && normal.dot(desiredNormal) < 0 ? second : third
  positions.push(
    first.x,
    first.y,
    first.z,
    resolvedSecond.x,
    resolvedSecond.y,
    resolvedSecond.z,
    resolvedThird.x,
    resolvedThird.y,
    resolvedThird.z
  )
}

function pointKey(point: THREE.Vector3): string {
  return [point.x, point.y, point.z].map((value) => Math.round(value / epsilon)).join(':')
}

function capLoops(segments: Array<[THREE.Vector3, THREE.Vector3]>): THREE.Vector3[][] {
  const points = new Map<string, THREE.Vector3>()
  const neighbours = new Map<string, Set<string>>()
  const edges = new Set<string>()
  for (const [first, second] of segments) {
    const firstKey = pointKey(first)
    const secondKey = pointKey(second)
    if (firstKey === secondKey) continue
    points.set(firstKey, first)
    points.set(secondKey, second)
    const edgeKey = [firstKey, secondKey].sort().join('|')
    if (edges.has(edgeKey)) continue
    edges.add(edgeKey)
    if (!neighbours.has(firstKey)) neighbours.set(firstKey, new Set())
    if (!neighbours.has(secondKey)) neighbours.set(secondKey, new Set())
    neighbours.get(firstKey)?.add(secondKey)
    neighbours.get(secondKey)?.add(firstKey)
  }

  const visited = new Set<string>()
  const loops: THREE.Vector3[][] = []
  for (const edge of edges) {
    if (visited.has(edge)) continue
    const [start, next] = edge.split('|')
    const keys = [start]
    let previous = start
    let current = next
    visited.add(edge)
    while (current !== start && keys.length <= points.size + 1) {
      keys.push(current)
      const candidates = [...(neighbours.get(current) ?? [])].filter((key) => key !== previous)
      const candidate = candidates.find(
        (key) => !visited.has([current, key].sort().join('|')) || key === start
      )
      if (!candidate) break
      visited.add([current, candidate].sort().join('|'))
      previous = current
      current = candidate
    }
    if (current === start && keys.length >= 3) {
      loops.push(keys.flatMap((key) => (points.get(key) ? [points.get(key)!.clone()] : [])))
    }
  }
  return loops
}

function addCap(
  positions: number[],
  loop: THREE.Vector3[],
  planeNormal: THREE.Vector3,
  keep: MeshCutData['keep']
): void {
  const helper =
    Math.abs(planeNormal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)
  const axisU = helper.cross(planeNormal).normalize()
  const axisV = planeNormal.clone().cross(axisU).normalize()
  const points2 = loop.map((point) => new THREE.Vector2(point.dot(axisU), point.dot(axisV)))
  const triangles = THREE.ShapeUtils.triangulateShape(points2, [])
  const desiredNormal = planeNormal.clone().multiplyScalar(keep === 'positive' ? -1 : 1)
  for (const [first, second, third] of triangles) {
    addTriangle(positions, loop[first], loop[second], loop[third], desiredNormal)
  }
}

export function clipGeometryByPlane(
  geometry: THREE.BufferGeometry,
  cut: MeshCutData
): THREE.BufferGeometry {
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone()
  const attribute = source.getAttribute('position')
  const positions: number[] = []
  const segments: Array<[THREE.Vector3, THREE.Vector3]> = []
  const planeNormal = new THREE.Vector3(cut.normal.x, cut.normal.y, cut.normal.z).normalize()

  for (let offset = 0; offset + 2 < attribute.count; offset += 3) {
    const triangle = [0, 1, 2].map((index) =>
      new THREE.Vector3().fromBufferAttribute(attribute, offset + index)
    )
    const signedDistances = triangle.map((point) => point.dot(planeNormal) - cut.offset)
    const intersections: THREE.Vector3[] = []
    for (let edge = 0; edge < 3; edge += 1) {
      const next = (edge + 1) % 3
      const firstDistance = signedDistances[edge]
      const secondDistance = signedDistances[next]
      if (
        (firstDistance > epsilon && secondDistance < -epsilon) ||
        (firstDistance < -epsilon && secondDistance > epsilon)
      ) {
        intersections.push(
          intersection(triangle[edge], triangle[next], firstDistance, secondDistance)
        )
      } else if (Math.abs(firstDistance) <= epsilon) {
        intersections.push(triangle[edge].clone())
      }
    }
    const uniqueIntersections = [
      ...new Map(intersections.map((point) => [pointKey(point), point])).values()
    ]
    if (uniqueIntersections.length >= 2) {
      let pair: [THREE.Vector3, THREE.Vector3] = [uniqueIntersections[0], uniqueIntersections[1]]
      let longest = pair[0].distanceToSquared(pair[1])
      for (let first = 0; first < uniqueIntersections.length; first += 1) {
        for (let second = first + 1; second < uniqueIntersections.length; second += 1) {
          const distance = uniqueIntersections[first].distanceToSquared(uniqueIntersections[second])
          if (distance > longest) {
            pair = [uniqueIntersections[first], uniqueIntersections[second]]
            longest = distance
          }
        }
      }
      if (longest > epsilon * epsilon) segments.push(pair)
    }

    const clipped = clipPolygon(triangle, cut)
    for (let index = 1; index + 1 < clipped.length; index += 1) {
      addTriangle(positions, clipped[0], clipped[index], clipped[index + 1])
    }
  }

  for (const loop of capLoops(segments)) addCap(positions, loop, planeNormal, cut.keep)
  source.dispose()
  const result = new THREE.BufferGeometry()
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  result.computeVertexNormals()
  result.computeBoundingBox()
  return result
}

export function applyMeshCuts(
  geometry: THREE.BufferGeometry,
  cuts: MeshCutData[] | undefined
): THREE.BufferGeometry {
  if (!cuts || cuts.length === 0) return geometry
  let current = geometry
  for (const cut of cuts) {
    const next = clipGeometryByPlane(current, cut)
    current.dispose()
    current = next
  }
  return current
}
