import { describe, expect, it, vi } from 'vitest'
import {
  beginVideoExport,
  cancelVideoExport,
  finishVideoExport,
  writeVideoChunk,
  type VideoFileServiceDependencies,
  type WritableVideoFile
} from './video-file-service'

function createHarness(options: { cancelled?: boolean; partialWrites?: boolean } = {}): {
  dependencies: VideoFileServiceDependencies
  bytes: Uint8Array
  close: ReturnType<typeof vi.fn>
  replaceFile: ReturnType<typeof vi.fn>
  removeFile: ReturnType<typeof vi.fn>
} {
  const bytes = new Uint8Array(1024)
  const close = vi.fn(async () => undefined)
  const file: WritableVideoFile = {
    write: vi.fn(async (data, offset, length, position) => {
      const bytesWritten = options.partialWrites ? Math.min(length, 3) : length
      bytes.set(data.subarray(offset, offset + bytesWritten), position)
      return { bytesWritten }
    }),
    sync: vi.fn(async () => undefined),
    close
  }
  const replaceFile = vi.fn(async () => undefined)
  const removeFile = vi.fn(async () => undefined)
  return {
    bytes,
    close,
    replaceFile,
    removeFile,
    dependencies: {
      showSaveDialog: vi.fn(async () =>
        options.cancelled ? { canceled: true } : { canceled: false, filePath: 'C:\\Exports\\scene' }
      ),
      openFile: vi.fn(async () => file),
      replaceFile,
      removeFile,
      createTemporaryPath: (targetPath) => `${targetPath}.partial`
    }
  }
}

const request = {
  suggestedName: '场景',
  presetId: 'general-ai-720',
  frameRate: 24,
  totalFrames: 120,
  width: 1280,
  height: 720
}

describe('video file service', () => {
  it('opens an mp4 temporary session and honors partial disk writes', async () => {
    const harness = createHarness({ partialWrites: true })
    const opened = await beginVideoExport(request, harness.dependencies)
    expect(opened.status).toBe('opened')
    if (opened.status !== 'opened') return

    const data = Uint8Array.from({ length: 80 }, (_, index) => index)
    expect(await writeVideoChunk(opened.session, 0, data)).toEqual({
      status: 'written',
      byteLength: 80
    })
    expect(harness.bytes.slice(0, 80)).toEqual(data)

    const finished = await finishVideoExport(opened.session, harness.dependencies)
    expect(finished.status).toBe('saved')
    expect(harness.replaceFile).toHaveBeenCalledWith(
      'C:\\Exports\\scene.mp4.partial',
      'C:\\Exports\\scene.mp4'
    )
    expect(harness.close).toHaveBeenCalledOnce()
  })

  it('removes the temporary file when cancelled', async () => {
    const harness = createHarness()
    const opened = await beginVideoExport(request, harness.dependencies)
    if (opened.status !== 'opened') throw new Error('session did not open')
    expect(await cancelVideoExport(opened.session, harness.dependencies)).toEqual({
      status: 'cancelled'
    })
    expect(harness.removeFile).toHaveBeenCalledWith('C:\\Exports\\scene.mp4.partial')
    expect(harness.replaceFile).not.toHaveBeenCalled()
  })

  it('rejects odd H.264 dimensions before showing a save dialog', async () => {
    const harness = createHarness()
    const result = await beginVideoExport({ ...request, width: 1279 }, harness.dependencies)
    expect(result.status).toBe('error')
    expect(harness.dependencies.showSaveDialog).not.toHaveBeenCalled()
  })

  it('returns cancellation without opening a temporary file', async () => {
    const harness = createHarness({ cancelled: true })
    expect(await beginVideoExport(request, harness.dependencies)).toEqual({ status: 'cancelled' })
    expect(harness.dependencies.openFile).not.toHaveBeenCalled()
  })
})
