import type { CameraState, Vector3Value } from '../../../shared/project-document'

export interface FrameCameraInput {
  center: Vector3Value
  radius: number
  currentCamera: CameraState
  verticalFovDegrees: number
  aspect: number
  minimumDistance?: number
  margin?: number
}

function subtract(a: Vector3Value, b: Vector3Value): Vector3Value {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function normalize(vector: Vector3Value): Vector3Value | null {
  const length = Math.hypot(vector.x, vector.y, vector.z)
  if (length < 0.000001) return null
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length }
}

export function calculateFrameCamera({
  center,
  radius,
  currentCamera,
  verticalFovDegrees,
  aspect,
  minimumDistance = 1.5,
  margin = 1.55
}: FrameCameraInput): CameraState {
  const verticalHalfFov = (Math.max(verticalFovDegrees, 1) * Math.PI) / 360
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * Math.max(aspect, 0.01))
  const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov)
  const safeRadius = Math.max(radius, 0.05)
  const distance = Math.max(minimumDistance, (safeRadius * margin) / Math.sin(limitingHalfFov))
  const fallbackDirection = normalize({ x: 7.5, y: 4.5, z: 8.5 }) ?? { x: 0, y: 0, z: 1 }
  const direction =
    normalize(subtract(currentCamera.position, currentCamera.target)) ?? fallbackDirection

  return {
    target: { ...center },
    position: {
      x: center.x + direction.x * distance,
      y: center.y + direction.y * distance,
      z: center.z + direction.z * distance
    },
    fovDegrees: verticalFovDegrees,
    aspectWidth: currentCamera.aspectWidth,
    aspectHeight: currentCamera.aspectHeight
  }
}
