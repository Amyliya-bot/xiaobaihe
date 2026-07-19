import type { BasicPrimitiveKind, Vector3Value } from '../../../shared/project-document'

export type QuickBuildKind = Extract<BasicPrimitiveKind, 'wall' | 'floor'>

export interface QuickBuildDraft {
  kind: QuickBuildKind
  start: Vector3Value
  end: Vector3Value
}

export interface QuickBuildTransform {
  position: Vector3Value
  rotation: Vector3Value
  size: Vector3Value
}

const GRID_STEP = 0.1
const AXIS_SNAP_DEGREES = 8
const MINIMUM_SPAN = 0.2
const WALL_HEIGHT = 2.8
const WALL_THICKNESS = 0.18
const FLOOR_THICKNESS = 0.12

function snap(value: number): number {
  const snapped = Math.round(value / GRID_STEP) * GRID_STEP
  return Object.is(snapped, -0) ? 0 : snapped
}

export function snapQuickBuildStart(point: Vector3Value): Vector3Value {
  return { x: snap(point.x), y: 0, z: snap(point.z) }
}

export function snapQuickBuildEnd(
  kind: QuickBuildKind,
  start: Vector3Value,
  point: Vector3Value
): { point: Vector3Value; axisSnapped: boolean } {
  const candidate = snapQuickBuildStart(point)
  if (kind !== 'wall') return { point: candidate, axisSnapped: false }

  const deltaX = candidate.x - start.x
  const deltaZ = candidate.z - start.z
  if (Math.hypot(deltaX, deltaZ) < MINIMUM_SPAN) {
    return { point: candidate, axisSnapped: false }
  }
  const tolerance = Math.tan((AXIS_SNAP_DEGREES * Math.PI) / 180)
  if (Math.abs(deltaZ) <= Math.abs(deltaX) * tolerance) {
    return { point: { ...candidate, z: start.z }, axisSnapped: true }
  }
  if (Math.abs(deltaX) <= Math.abs(deltaZ) * tolerance) {
    return { point: { ...candidate, x: start.x }, axisSnapped: true }
  }
  return { point: candidate, axisSnapped: false }
}

export function quickBuildTransform(draft: QuickBuildDraft): QuickBuildTransform | null {
  const deltaX = draft.end.x - draft.start.x
  const deltaZ = draft.end.z - draft.start.z

  if (draft.kind === 'wall') {
    const length = Math.hypot(deltaX, deltaZ)
    if (!Number.isFinite(length) || length < MINIMUM_SPAN) return null
    return {
      position: {
        x: (draft.start.x + draft.end.x) / 2,
        y: WALL_HEIGHT / 2,
        z: (draft.start.z + draft.end.z) / 2
      },
      rotation: { x: 0, y: (-Math.atan2(deltaZ, deltaX) * 180) / Math.PI, z: 0 },
      size: { x: length, y: WALL_HEIGHT, z: WALL_THICKNESS }
    }
  }

  const width = Math.abs(deltaX)
  const depth = Math.abs(deltaZ)
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(depth) ||
    width < MINIMUM_SPAN ||
    depth < MINIMUM_SPAN
  ) {
    return null
  }
  return {
    position: {
      x: (draft.start.x + draft.end.x) / 2,
      y: FLOOR_THICKNESS / 2,
      z: (draft.start.z + draft.end.z) / 2
    },
    rotation: { x: 0, y: 0, z: 0 },
    size: { x: width, y: FLOOR_THICKNESS, z: depth }
  }
}

export function quickBuildMeasurement(draft: QuickBuildDraft): string {
  const transform = quickBuildTransform(draft)
  if (!transform) return draft.kind === 'wall' ? '墙体起点' : '地面起点'
  return draft.kind === 'wall'
    ? `长度 ${transform.size.x.toFixed(1)}`
    : `${transform.size.x.toFixed(1)} × ${transform.size.z.toFixed(1)}`
}
