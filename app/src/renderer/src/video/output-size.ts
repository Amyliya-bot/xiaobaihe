import type { CameraState } from '../../../shared/project-document'

export function outputSize(
  camera: CameraState,
  maxDimension = 1280
): { width: number; height: number } {
  const ratio = camera.aspectWidth / camera.aspectHeight
  const even = (value: number): number => Math.max(2, Math.round(value / 2) * 2)
  if (ratio >= 1) return { width: even(maxDimension), height: even(maxDimension / ratio) }
  return { width: even(maxDimension * ratio), height: even(maxDimension) }
}
