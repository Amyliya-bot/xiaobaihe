import type {
  CameraShotNode,
  CameraState,
  CameraTransition
} from '../../../shared/project-document'
import { findAvailableTimelineTime } from './timeline-edit'

function cloneCamera(camera: CameraState): CameraState {
  return {
    position: { ...camera.position },
    target: { ...camera.target },
    fovDegrees: camera.fovDegrees,
    aspectWidth: camera.aspectWidth,
    aspectHeight: camera.aspectHeight
  }
}

function interpolate(first: number, second: number, amount: number): number {
  return first + (second - first) * amount
}

export function sortedCameraShots(shots: CameraShotNode[]): CameraShotNode[] {
  return [...shots].sort((first, second) => first.timeSeconds - second.timeSeconds)
}

export function upsertCameraShot(
  shots: CameraShotNode[],
  timeSeconds: number,
  camera: CameraState
): { shots: CameraShotNode[]; selectedId: string } {
  const existing = shots.find((shot) => Math.abs(shot.timeSeconds - timeSeconds) < 0.025)
  if (existing) {
    return {
      selectedId: existing.id,
      shots: sortedCameraShots(
        shots.map((shot) =>
          shot.id === existing.id ? { ...shot, camera: cloneCamera(camera) } : shot
        )
      )
    }
  }
  const id = crypto.randomUUID()
  const next: CameraShotNode = {
    id,
    name: `镜头 ${String(shots.length + 1).padStart(2, '0')}`,
    timeSeconds,
    transition: shots.length === 0 ? 'cut' : 'smooth',
    camera: cloneCamera(camera)
  }
  return { shots: sortedCameraShots([...shots, next]), selectedId: id }
}

export function updateCameraShotTransition(
  shots: CameraShotNode[],
  id: string,
  transition: CameraTransition
): CameraShotNode[] {
  return shots.map((shot) => (shot.id === id ? { ...shot, transition } : shot))
}

export function moveCameraShot(
  shots: CameraShotNode[],
  id: string,
  requestedTime: number,
  durationSeconds: number
): CameraShotNode[] {
  const source = shots.find((shot) => shot.id === id)
  if (!source) return shots
  const timeSeconds = findAvailableTimelineTime(
    requestedTime,
    shots.filter((shot) => shot.id !== id).map((shot) => shot.timeSeconds),
    durationSeconds
  )
  return sortedCameraShots(shots.map((shot) => (shot.id === id ? { ...shot, timeSeconds } : shot)))
}

export function duplicateCameraShot(
  shots: CameraShotNode[],
  id: string,
  durationSeconds: number
): { shots: CameraShotNode[]; selectedId: string } | null {
  const source = shots.find((shot) => shot.id === id)
  if (!source) return null
  const timeSeconds = findAvailableTimelineTime(
    source.timeSeconds + 0.5,
    shots.map((shot) => shot.timeSeconds),
    durationSeconds
  )
  const duplicate: CameraShotNode = {
    ...source,
    id: crypto.randomUUID(),
    name: `${source.name} 副本`,
    timeSeconds,
    camera: cloneCamera(source.camera)
  }
  return {
    shots: sortedCameraShots([...shots, duplicate]),
    selectedId: duplicate.id
  }
}

export function evaluateCameraShots(
  shots: CameraShotNode[],
  timeSeconds: number,
  outputAspect: Pick<CameraState, 'aspectWidth' | 'aspectHeight'>
): CameraState | null {
  const ordered = sortedCameraShots(shots)
  if (ordered.length === 0) return null
  const withOutputAspect = (camera: CameraState): CameraState => ({
    ...cloneCamera(camera),
    aspectWidth: outputAspect.aspectWidth,
    aspectHeight: outputAspect.aspectHeight
  })
  if (timeSeconds <= ordered[0].timeSeconds) return withOutputAspect(ordered[0].camera)
  const last = ordered.at(-1)
  if (!last || timeSeconds >= last.timeSeconds) return last ? withOutputAspect(last.camera) : null

  for (let index = 1; index < ordered.length; index += 1) {
    const next = ordered[index]
    const previous = ordered[index - 1]
    if (timeSeconds > next.timeSeconds) continue
    if (next.transition === 'cut') return withOutputAspect(previous.camera)
    const raw = (timeSeconds - previous.timeSeconds) / (next.timeSeconds - previous.timeSeconds)
    const amount = raw * raw * (3 - 2 * raw)
    return {
      position: {
        x: interpolate(previous.camera.position.x, next.camera.position.x, amount),
        y: interpolate(previous.camera.position.y, next.camera.position.y, amount),
        z: interpolate(previous.camera.position.z, next.camera.position.z, amount)
      },
      target: {
        x: interpolate(previous.camera.target.x, next.camera.target.x, amount),
        y: interpolate(previous.camera.target.y, next.camera.target.y, amount),
        z: interpolate(previous.camera.target.z, next.camera.target.z, amount)
      },
      fovDegrees: interpolate(previous.camera.fovDegrees, next.camera.fovDegrees, amount),
      aspectWidth: outputAspect.aspectWidth,
      aspectHeight: outputAspect.aspectHeight
    }
  }
  return withOutputAspect(last.camera)
}
