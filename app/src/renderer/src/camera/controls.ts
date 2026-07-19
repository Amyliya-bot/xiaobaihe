import * as THREE from 'three'
import type { CameraState, Vector3Value } from '../../../shared/project-document'

export type CameraControlMode = 'translate' | 'aim'

const minimumTargetDistance = 0.1

export function cameraStateFromControl(
  start: CameraState,
  controlPosition: Vector3Value,
  mode: CameraControlMode
): CameraState {
  const position = new THREE.Vector3(controlPosition.x, controlPosition.y, controlPosition.z)
  const startPosition = new THREE.Vector3(start.position.x, start.position.y, start.position.z)
  const startTarget = new THREE.Vector3(start.target.x, start.target.y, start.target.z)

  if (mode === 'translate') {
    const delta = position.clone().sub(startPosition)
    return {
      ...start,
      position: { x: position.x, y: position.y, z: position.z },
      target: {
        x: startTarget.x + delta.x,
        y: startTarget.y + delta.y,
        z: startTarget.z + delta.z
      }
    }
  }

  if (position.distanceTo(startPosition) < minimumTargetDistance) {
    const direction = startTarget.clone().sub(startPosition)
    if (direction.lengthSq() < Number.EPSILON) direction.set(0, 0, -1)
    position.copy(startPosition).add(direction.normalize().multiplyScalar(minimumTargetDistance))
  }

  return {
    ...start,
    target: { x: position.x, y: position.y, z: position.z }
  }
}
