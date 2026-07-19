import {
  CanvasSource,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  canEncodeVideo,
  type StreamTargetChunk
} from 'mediabunny'

export interface Mp4VideoEncoderOptions {
  width: number
  height: number
  frameRate: number
  totalFrames: number
  bitrate: number
  writeChunk: (position: number, data: Uint8Array) => Promise<void>
}

export interface Mp4VideoEncoder {
  canvas: OffscreenCanvas
  addFrame: (frameIndex: number) => Promise<void>
  finalize: () => Promise<void>
  cancel: () => Promise<void>
}

function fullCodecString(width: number, height: number): string {
  return width <= 1280 && height <= 1280 ? 'avc1.42001f' : 'avc1.4d0034'
}

export async function canEncodeH264Video(
  width: number,
  height: number,
  bitrate: number
): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined' || typeof OffscreenCanvas === 'undefined') return false
  return canEncodeVideo('avc', {
    width,
    height,
    bitrate,
    latencyMode: 'quality',
    fullCodecString: fullCodecString(width, height)
  })
}

export async function createMp4VideoEncoder(
  options: Mp4VideoEncoderOptions
): Promise<Mp4VideoEncoder> {
  const canvas = new OffscreenCanvas(options.width, options.height)
  const writable = new WritableStream<StreamTargetChunk>({
    write: async (chunk) => {
      await options.writeChunk(chunk.position, chunk.data.slice())
    }
  })
  const target = new StreamTarget(writable, { chunked: true, chunkSize: 1024 * 1024 })
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'reserve' }),
    target
  })
  const source = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: options.bitrate,
    keyFrameInterval: 2,
    latencyMode: 'quality',
    fullCodecString: fullCodecString(options.width, options.height),
    sizeChangeBehavior: 'deny'
  })
  output.addVideoTrack(source, {
    frameRate: options.frameRate,
    maximumPacketCount: options.totalFrames + 2
  })
  await output.start()

  let finished = false
  return {
    canvas,
    addFrame: async (frameIndex) => {
      if (finished) throw new Error('视频编码器已经结束。')
      await source.add(frameIndex / options.frameRate, 1 / options.frameRate, {
        keyFrame: frameIndex % (options.frameRate * 2) === 0
      })
    },
    finalize: async () => {
      if (finished) return
      source.close()
      await output.finalize()
      finished = true
    },
    cancel: async () => {
      if (finished) return
      finished = true
      source.close()
      await output.cancel()
    }
  }
}
