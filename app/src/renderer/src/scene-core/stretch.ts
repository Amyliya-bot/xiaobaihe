import type { Vector3Value } from '../../../shared/project-document'

export type StretchAxis = keyof Vector3Value
export type StretchSign = -1 | 1

interface StretchInput {
  position: Vector3Value
  size: Vector3Value
  axis: StretchAxis
  sign: StretchSign
  delta: number
  worldAxis: Vector3Value
}

export function calculateStretch({ position, size, axis, sign, delta, worldAxis }: StretchInput): {
  position: Vector3Value
  size: Vector3Value
} {
  const nextAxisSize = Math.max(0.1, size[axis] + sign * delta)
  const appliedSizeChange = nextAxisSize - size[axis]
  const appliedFaceDistance = appliedSizeChange * sign
  const centerDistance = appliedFaceDistance / 2

  return {
    size: { ...size, [axis]: nextAxisSize },
    position: {
      x: position.x + worldAxis.x * centerDistance,
      y: position.y + worldAxis.y * centerDistance,
      z: position.z + worldAxis.z * centerDistance
    }
  }
}
