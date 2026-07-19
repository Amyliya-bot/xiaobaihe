import type {
  CameraState,
  ObjectTransformState,
  TimelineState
} from '../../../shared/project-document'
import { evaluateCameraShots } from './camera-timeline'
import { evaluateObjectKeyframes } from './object-timeline'
import { clampTimelineTime, TIMELINE_FRAME_RATE } from './timeline-edit'

export interface TimelineFrameState {
  frameIndex: number
  timeSeconds: number
  camera: CameraState
  objectTransforms: Map<string, ObjectTransformState>
}

function cloneCamera(camera: CameraState): CameraState {
  return {
    position: { ...camera.position },
    target: { ...camera.target },
    fovDegrees: camera.fovDegrees,
    aspectWidth: camera.aspectWidth,
    aspectHeight: camera.aspectHeight
  }
}

export function timeToFrameIndex(
  timeSeconds: number,
  durationSeconds: number,
  frameRate = TIMELINE_FRAME_RATE
): number {
  return Math.round(clampTimelineTime(timeSeconds, durationSeconds) * frameRate)
}

export function frameIndexToTime(
  frameIndex: number,
  durationSeconds: number,
  frameRate = TIMELINE_FRAME_RATE
): number {
  return clampTimelineTime(Math.max(Math.round(frameIndex), 0) / frameRate, durationSeconds)
}

export function evaluateTimelineAtTime(
  timeline: TimelineState,
  baseCamera: CameraState,
  timeSeconds: number
): Omit<TimelineFrameState, 'frameIndex'> {
  const resolvedTime = clampTimelineTime(timeSeconds, timeline.durationSeconds)
  return {
    timeSeconds: resolvedTime,
    camera:
      evaluateCameraShots(timeline.cameraShots, resolvedTime, {
        aspectWidth: baseCamera.aspectWidth,
        aspectHeight: baseCamera.aspectHeight
      }) ?? cloneCamera(baseCamera),
    objectTransforms: evaluateObjectKeyframes(timeline.objectKeyframes, resolvedTime)
  }
}

export function evaluateTimelineFrame(
  timeline: TimelineState,
  baseCamera: CameraState,
  frameIndex: number,
  frameRate = TIMELINE_FRAME_RATE
): TimelineFrameState {
  const resolvedFrame = Math.max(Math.round(frameIndex), 0)
  const evaluated = evaluateTimelineAtTime(
    timeline,
    baseCamera,
    frameIndexToTime(resolvedFrame, timeline.durationSeconds, frameRate)
  )
  return { frameIndex: resolvedFrame, ...evaluated }
}
