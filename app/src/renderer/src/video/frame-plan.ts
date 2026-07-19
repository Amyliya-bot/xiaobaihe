export interface VideoFramePlan {
  frameRate: number
  totalFrames: number
  frameDurationSeconds: number
  sourceTimeSeconds: (frameIndex: number) => number
}

export function createVideoFramePlan(durationSeconds: number, frameRate: number): VideoFramePlan {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('视频时长必须大于 0。')
  }
  if (!Number.isInteger(frameRate) || frameRate < 1 || frameRate > 120) {
    throw new Error('视频帧率无效。')
  }
  const totalFrames = Math.max(1, Math.round(durationSeconds * frameRate))
  return {
    frameRate,
    totalFrames,
    frameDurationSeconds: 1 / frameRate,
    sourceTimeSeconds: (frameIndex) => {
      if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= totalFrames) {
        throw new Error('视频帧编号无效。')
      }
      // The last encoded frame shows the exact final key state without extending the file duration.
      return frameIndex === totalFrames - 1 ? durationSeconds : frameIndex / frameRate
    }
  }
}
