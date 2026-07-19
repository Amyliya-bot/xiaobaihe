export const CAMERA_MONITOR_HEADER_HEIGHT = 34
export const CAMERA_MONITOR_MARGIN = 8
export const CAMERA_MONITOR_MIN_WIDTH = 220

export type CameraMonitorResizeEdge = 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw'

export interface CameraMonitorWindow {
  x: number | null
  y: number
  width: number
}

export interface ResolvedCameraMonitorWindow extends CameraMonitorWindow {
  x: number
}

interface CameraMonitorStage {
  width: number
  height: number
}

function safeRatio(ratio: number): number {
  return Number.isFinite(ratio) ? Math.max(ratio, 0.001) : 1
}

export function cameraMonitorWidthForRatio(
  width: number,
  previousRatio: number,
  nextRatio: number
): number {
  return Math.max(width, 1) * Math.sqrt(safeRatio(nextRatio) / safeRatio(previousRatio))
}

function widthLimits(
  window: ResolvedCameraMonitorWindow,
  stage: CameraMonitorStage,
  ratio: number,
  edge?: CameraMonitorResizeEdge
): { minimum: number; maximum: number } {
  const normalizedRatio = safeRatio(ratio)
  const right = window.x + window.width
  const bottom = window.y + CAMERA_MONITOR_HEADER_HEIGHT + window.width / normalizedRatio
  const horizontalMaximum = edge?.includes('w')
    ? right - CAMERA_MONITOR_MARGIN
    : stage.width - window.x - CAMERA_MONITOR_MARGIN
  const verticalMaximum = edge?.includes('n')
    ? (bottom - CAMERA_MONITOR_HEADER_HEIGHT - CAMERA_MONITOR_MARGIN) * normalizedRatio
    : (stage.height - window.y - CAMERA_MONITOR_HEADER_HEIGHT - CAMERA_MONITOR_MARGIN) *
      normalizedRatio
  const maximum = Math.max(
    Math.min(horizontalMaximum, verticalMaximum, stage.width - CAMERA_MONITOR_MARGIN * 2),
    1
  )
  return { minimum: Math.min(CAMERA_MONITOR_MIN_WIDTH, maximum), maximum }
}

export function fitCameraMonitorWindow(
  window: CameraMonitorWindow,
  stage: CameraMonitorStage,
  ratio: number
): ResolvedCameraMonitorWindow {
  const normalizedRatio = safeRatio(ratio)
  const initialX = window.x ?? stage.width - window.width - 14
  const initial = { ...window, x: initialX }
  const maximum = Math.max(
    Math.min(
      stage.width - CAMERA_MONITOR_MARGIN * 2,
      (stage.height - CAMERA_MONITOR_HEADER_HEIGHT - CAMERA_MONITOR_MARGIN * 2) * normalizedRatio
    ),
    1
  )
  const minimum = Math.min(CAMERA_MONITOR_MIN_WIDTH, maximum)
  const width = Math.min(Math.max(initial.width, minimum), maximum)
  const height = CAMERA_MONITOR_HEADER_HEIGHT + width / normalizedRatio
  return {
    width,
    x: Math.min(
      Math.max(initial.x, CAMERA_MONITOR_MARGIN),
      Math.max(stage.width - width - CAMERA_MONITOR_MARGIN, CAMERA_MONITOR_MARGIN)
    ),
    y: Math.min(
      Math.max(initial.y, CAMERA_MONITOR_MARGIN),
      Math.max(stage.height - height - CAMERA_MONITOR_MARGIN, CAMERA_MONITOR_MARGIN)
    )
  }
}

export function resizeCameraMonitorWindow(
  window: CameraMonitorWindow,
  edge: CameraMonitorResizeEdge,
  deltaX: number,
  deltaY: number,
  stage: CameraMonitorStage,
  ratio: number
): ResolvedCameraMonitorWindow {
  const normalizedRatio = safeRatio(ratio)
  const start = { ...window, x: window.x ?? CAMERA_MONITOR_MARGIN }
  const horizontalDelta = edge.includes('e') ? deltaX : edge.includes('w') ? -deltaX : null
  const verticalDelta = edge.includes('s')
    ? deltaY * normalizedRatio
    : edge.includes('n')
      ? -deltaY * normalizedRatio
      : null
  const widthDelta =
    horizontalDelta === null
      ? (verticalDelta ?? 0)
      : verticalDelta === null
        ? horizontalDelta
        : Math.abs(horizontalDelta) >= Math.abs(verticalDelta)
          ? horizontalDelta
          : verticalDelta
  const limits = widthLimits(start, stage, normalizedRatio, edge)
  const width = Math.min(Math.max(start.width + widthDelta, limits.minimum), limits.maximum)
  const widthChange = width - start.width
  return {
    width,
    x: edge.includes('w') ? start.x - widthChange : start.x,
    y: edge.includes('n') ? start.y - widthChange / normalizedRatio : start.y
  }
}
