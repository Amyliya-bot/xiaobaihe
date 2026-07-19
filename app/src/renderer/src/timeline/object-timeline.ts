import type {
  MannequinPose,
  ObjectInterpolation,
  ObjectKeyframeNode,
  ObjectTransformState,
  SceneObjectData,
  Vector3Value
} from '../../../shared/project-document'
import { MANNEQUIN_JOINT_IDS } from '../../../shared/project-document'
import { cloneMannequinPose } from '../mannequin/mannequin'
import { findAvailableTimelineTime } from './timeline-edit'

function cloneVector(value: Vector3Value): Vector3Value {
  return { x: value.x, y: value.y, z: value.z }
}

function cloneTransform(transform: ObjectTransformState): ObjectTransformState {
  return {
    position: cloneVector(transform.position),
    rotation: cloneVector(transform.rotation),
    size: cloneVector(transform.size),
    mannequinPose: transform.mannequinPose
      ? cloneMannequinPose(transform.mannequinPose)
      : undefined,
    mannequinPresetId: transform.mannequinPresetId,
    mannequinManualJoints: transform.mannequinManualJoints
      ? [...transform.mannequinManualJoints]
      : undefined,
    mannequinPresetBlend: transform.mannequinPresetBlend
      ? { ...transform.mannequinPresetBlend }
      : undefined
  }
}

function objectTransform(object: SceneObjectData): ObjectTransformState {
  return {
    position: cloneVector(object.position),
    rotation: cloneVector(object.rotation),
    size: cloneVector(object.size),
    mannequinPose: object.mannequin ? cloneMannequinPose(object.mannequin.pose) : undefined,
    mannequinPresetId: object.mannequin?.presetId,
    mannequinManualJoints: object.mannequin?.manualJoints
      ? [...object.mannequin.manualJoints]
      : undefined
  }
}

function interpolate(first: number, second: number, amount: number): number {
  return first + (second - first) * amount
}

function interpolateRotation(first: number, second: number, amount: number): number {
  const delta = ((((second - first + 180) % 360) + 360) % 360) - 180
  return first + delta * amount
}

function interpolateVector(
  first: Vector3Value,
  second: Vector3Value,
  amount: number,
  rotation = false
): Vector3Value {
  const resolve = rotation ? interpolateRotation : interpolate
  return {
    x: resolve(first.x, second.x, amount),
    y: resolve(first.y, second.y, amount),
    z: resolve(first.z, second.z, amount)
  }
}

function interpolateMannequinPose(
  first: MannequinPose | undefined,
  second: MannequinPose | undefined,
  amount: number
): MannequinPose | undefined {
  if (!first && !second) return undefined
  if (!first) return second ? cloneMannequinPose(second) : undefined
  if (!second) return cloneMannequinPose(first)
  return Object.fromEntries(
    MANNEQUIN_JOINT_IDS.map((jointId) => [
      jointId,
      interpolateVector(first[jointId], second[jointId], amount, true)
    ])
  ) as MannequinPose
}

export function sortedObjectKeyframes(keyframes: ObjectKeyframeNode[]): ObjectKeyframeNode[] {
  return [...keyframes].sort(
    (first, second) =>
      first.timeSeconds - second.timeSeconds || first.objectId.localeCompare(second.objectId)
  )
}

export function upsertObjectKeyframe(
  keyframes: ObjectKeyframeNode[],
  timeSeconds: number,
  object: SceneObjectData
): { keyframes: ObjectKeyframeNode[]; selectedId: string } {
  const existing = keyframes.find(
    (keyframe) =>
      keyframe.objectId === object.id && Math.abs(keyframe.timeSeconds - timeSeconds) < 0.025
  )
  if (existing) {
    return {
      selectedId: existing.id,
      keyframes: sortedObjectKeyframes(
        keyframes.map((keyframe) =>
          keyframe.id === existing.id
            ? { ...keyframe, transform: objectTransform(object) }
            : keyframe
        )
      )
    }
  }
  const keyframe: ObjectKeyframeNode = {
    id: crypto.randomUUID(),
    objectId: object.id,
    timeSeconds,
    interpolation: 'smooth',
    transform: objectTransform(object)
  }
  return {
    selectedId: keyframe.id,
    keyframes: sortedObjectKeyframes([...keyframes, keyframe])
  }
}

export function updateObjectKeyframeInterpolation(
  keyframes: ObjectKeyframeNode[],
  id: string,
  interpolation: ObjectInterpolation
): ObjectKeyframeNode[] {
  return keyframes.map((keyframe) =>
    keyframe.id === id ? { ...keyframe, interpolation } : keyframe
  )
}

export function moveObjectKeyframe(
  keyframes: ObjectKeyframeNode[],
  id: string,
  requestedTime: number,
  durationSeconds: number
): ObjectKeyframeNode[] {
  const source = keyframes.find((keyframe) => keyframe.id === id)
  if (!source) return keyframes
  const timeSeconds = findAvailableTimelineTime(
    requestedTime,
    keyframes
      .filter((keyframe) => keyframe.id !== id && keyframe.objectId === source.objectId)
      .map((keyframe) => keyframe.timeSeconds),
    durationSeconds
  )
  return sortedObjectKeyframes(
    keyframes.map((keyframe) => (keyframe.id === id ? { ...keyframe, timeSeconds } : keyframe))
  )
}

export function duplicateObjectKeyframe(
  keyframes: ObjectKeyframeNode[],
  id: string,
  durationSeconds: number
): { keyframes: ObjectKeyframeNode[]; selectedId: string } | null {
  const source = keyframes.find((keyframe) => keyframe.id === id)
  if (!source) return null
  const timeSeconds = findAvailableTimelineTime(
    source.timeSeconds + 0.5,
    keyframes
      .filter((keyframe) => keyframe.objectId === source.objectId)
      .map((keyframe) => keyframe.timeSeconds),
    durationSeconds
  )
  const duplicate: ObjectKeyframeNode = {
    ...source,
    id: crypto.randomUUID(),
    timeSeconds,
    transform: cloneTransform(source.transform)
  }
  return {
    keyframes: sortedObjectKeyframes([...keyframes, duplicate]),
    selectedId: duplicate.id
  }
}

function evaluateTrack(keyframes: ObjectKeyframeNode[], timeSeconds: number): ObjectTransformState {
  if (timeSeconds <= keyframes[0].timeSeconds) return cloneTransform(keyframes[0].transform)
  const last = keyframes.at(-1)!
  if (timeSeconds >= last.timeSeconds) return cloneTransform(last.transform)
  for (let index = 1; index < keyframes.length; index += 1) {
    const next = keyframes[index]
    const previous = keyframes[index - 1]
    if (timeSeconds > next.timeSeconds) continue
    const raw = (timeSeconds - previous.timeSeconds) / (next.timeSeconds - previous.timeSeconds)
    const amount = next.interpolation === 'smooth' ? raw * raw * (3 - 2 * raw) : raw
    return {
      position: interpolateVector(previous.transform.position, next.transform.position, amount),
      rotation: interpolateVector(
        previous.transform.rotation,
        next.transform.rotation,
        amount,
        true
      ),
      size: interpolateVector(previous.transform.size, next.transform.size, amount),
      mannequinPose: interpolateMannequinPose(
        previous.transform.mannequinPose,
        next.transform.mannequinPose,
        amount
      ),
      mannequinPresetId:
        amount < 0.5 ? previous.transform.mannequinPresetId : next.transform.mannequinPresetId,
      mannequinManualJoints: [
        ...new Set([
          ...(previous.transform.mannequinManualJoints ?? []),
          ...(next.transform.mannequinManualJoints ?? [])
        ])
      ],
      mannequinPresetBlend:
        previous.transform.mannequinPresetId === next.transform.mannequinPresetId
          ? undefined
          : {
              from: previous.transform.mannequinPresetId,
              to: next.transform.mannequinPresetId,
              amount
            }
    }
  }
  return cloneTransform(last.transform)
}

export function evaluateObjectKeyframes(
  keyframes: ObjectKeyframeNode[],
  timeSeconds: number
): Map<string, ObjectTransformState> {
  const tracks = new Map<string, ObjectKeyframeNode[]>()
  for (const keyframe of sortedObjectKeyframes(keyframes)) {
    tracks.set(keyframe.objectId, [...(tracks.get(keyframe.objectId) ?? []), keyframe])
  }
  return new Map(
    [...tracks.entries()].map(([objectId, track]) => [objectId, evaluateTrack(track, timeSeconds)])
  )
}

export function applyObjectKeyframePreview(
  objects: SceneObjectData[],
  preview: Map<string, ObjectTransformState> | null
): SceneObjectData[] {
  if (!preview) return objects
  return objects.map((object) => {
    const transform = preview.get(object.id)
    if (!transform) return object
    const cloned = cloneTransform(transform)
    return {
      ...object,
      position: cloned.position,
      rotation: cloned.rotation,
      size: cloned.size,
      mannequin:
        object.mannequin && cloned.mannequinPose
          ? {
              ...object.mannequin,
              pose: cloned.mannequinPose,
              presetId: cloned.mannequinPresetId,
              manualJoints: cloned.mannequinManualJoints
            }
          : object.mannequin
    }
  })
}
