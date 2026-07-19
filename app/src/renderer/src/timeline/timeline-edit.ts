const DEFAULT_FRAME_RATE = 30

export function clampTimelineTime(timeSeconds: number, durationSeconds: number): number {
  if (!Number.isFinite(timeSeconds)) return 0
  return Math.min(Math.max(timeSeconds, 0), Math.max(durationSeconds, 0))
}

export function snapTimelineTime(
  timeSeconds: number,
  durationSeconds: number,
  frameRate = DEFAULT_FRAME_RATE
): number {
  const safeFrameRate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : DEFAULT_FRAME_RATE
  const clamped = clampTimelineTime(timeSeconds, durationSeconds)
  return clampTimelineTime(Math.round(clamped * safeFrameRate) / safeFrameRate, durationSeconds)
}

export function findAvailableTimelineTime(
  requestedTime: number,
  occupiedTimes: number[],
  durationSeconds: number,
  frameRate = DEFAULT_FRAME_RATE
): number {
  const safeFrameRate = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : DEFAULT_FRAME_RATE
  const maximumFrame = Math.max(0, Math.round(Math.max(durationSeconds, 0) * safeFrameRate))
  const requestedFrame = Math.min(
    Math.max(Math.round(clampTimelineTime(requestedTime, durationSeconds) * safeFrameRate), 0),
    maximumFrame
  )
  const occupiedFrames = new Set(
    occupiedTimes.map((time) =>
      Math.min(
        Math.max(Math.round(clampTimelineTime(time, durationSeconds) * safeFrameRate), 0),
        maximumFrame
      )
    )
  )

  if (!occupiedFrames.has(requestedFrame)) return requestedFrame / safeFrameRate
  for (let distance = 1; distance <= maximumFrame; distance += 1) {
    const later = requestedFrame + distance
    if (later <= maximumFrame && !occupiedFrames.has(later)) return later / safeFrameRate
    const earlier = requestedFrame - distance
    if (earlier >= 0 && !occupiedFrames.has(earlier)) return earlier / safeFrameRate
  }
  return requestedFrame / safeFrameRate
}

export const TIMELINE_FRAME_RATE = DEFAULT_FRAME_RATE
