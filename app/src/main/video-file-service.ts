import type { SaveDialogOptions } from 'electron'
import { basename, extname } from 'path'
import type {
  BeginVideoExportRequest,
  VideoChunkOperationResult,
  VideoExportOperationResult
} from '../shared/desktop-api'

const MAX_VIDEO_BYTES = 512 * 1024 * 1024
const MAX_CHUNK_BYTES = 4 * 1024 * 1024

export interface WritableVideoFile {
  write: (
    data: Uint8Array,
    offset: number,
    length: number,
    position: number
  ) => Promise<{ bytesWritten: number }>
  sync: () => Promise<void>
  close: () => Promise<void>
}

export interface VideoFileServiceDependencies {
  showSaveDialog: (
    options: SaveDialogOptions
  ) => Promise<{ canceled: boolean; filePath?: string | undefined }>
  openFile: (filePath: string) => Promise<WritableVideoFile>
  replaceFile: (temporaryPath: string, targetPath: string) => Promise<void>
  removeFile: (filePath: string) => Promise<void>
  createTemporaryPath: (targetPath: string) => string
}

export interface VideoExportSession {
  targetPath: string
  temporaryPath: string
  displayName: string
  file: WritableVideoFile
  highestWrittenByte: number
  closed: boolean
}

export type BeginVideoFileResult =
  | { status: 'opened'; session: VideoExportSession }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

function safeName(name: string): string {
  const invalidCharacters = '<>:"/\\|?*'
  const sanitized = [...name]
    .map((character) =>
      character.charCodeAt(0) <= 31 || invalidCharacters.includes(character) ? '_' : character
    )
    .join('')
    .trim()
  return sanitized || '白膜动画'
}

function validateRequest(request: BeginVideoExportRequest): void {
  if (!Number.isInteger(request.frameRate) || request.frameRate < 1 || request.frameRate > 120) {
    throw new Error('视频帧率无效。')
  }
  if (
    !Number.isInteger(request.totalFrames) ||
    request.totalFrames < 1 ||
    request.totalFrames > 7201
  ) {
    throw new Error('视频帧数无效。')
  }
  if (
    !Number.isInteger(request.width) ||
    !Number.isInteger(request.height) ||
    request.width < 16 ||
    request.height < 16 ||
    request.width > 4096 ||
    request.height > 4096 ||
    request.width % 2 !== 0 ||
    request.height % 2 !== 0
  ) {
    throw new Error('视频尺寸必须是 16-4096 范围内的偶数。')
  }
  if (typeof request.presetId !== 'string' || request.presetId.trim().length === 0) {
    throw new Error('视频预设无效。')
  }
}

function ensureMp4Extension(filePath: string): string {
  return extname(filePath).toLowerCase() === '.mp4' ? filePath : `${filePath}.mp4`
}

export async function beginVideoExport(
  request: BeginVideoExportRequest,
  dependencies: VideoFileServiceDependencies
): Promise<BeginVideoFileResult> {
  try {
    validateRequest(request)
    const result = await dependencies.showSaveDialog({
      title: '导出动画视频',
      defaultPath: `${safeName(request.suggestedName)}.mp4`,
      filters: [{ name: 'MP4 视频', extensions: ['mp4'] }],
      properties: ['showOverwriteConfirmation', 'createDirectory']
    })
    if (result.canceled || !result.filePath) return { status: 'cancelled' }

    const targetPath = ensureMp4Extension(result.filePath)
    const temporaryPath = dependencies.createTemporaryPath(targetPath)
    const file = await dependencies.openFile(temporaryPath)
    return {
      status: 'opened',
      session: {
        targetPath,
        temporaryPath,
        displayName: basename(targetPath),
        file,
        highestWrittenByte: 0,
        closed: false
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误'
    return { status: 'error', message: `无法开始导出视频：${detail}` }
  }
}

export async function writeVideoChunk(
  session: VideoExportSession,
  position: number,
  data: Uint8Array
): Promise<VideoChunkOperationResult> {
  try {
    if (session.closed) throw new Error('视频导出会话已经结束。')
    if (!Number.isInteger(position) || position < 0) throw new Error('视频数据位置无效。')
    if (!(data instanceof Uint8Array) || data.byteLength < 1 || data.byteLength > MAX_CHUNK_BYTES) {
      throw new Error('视频数据块无效或过大。')
    }
    if (position + data.byteLength > MAX_VIDEO_BYTES) {
      throw new Error('视频文件超过 512 MB 安全上限。')
    }

    let written = 0
    while (written < data.byteLength) {
      const result = await session.file.write(
        data,
        written,
        data.byteLength - written,
        position + written
      )
      if (!Number.isInteger(result.bytesWritten) || result.bytesWritten <= 0) {
        throw new Error('磁盘没有继续写入数据。')
      }
      written += result.bytesWritten
    }
    session.highestWrittenByte = Math.max(session.highestWrittenByte, position + data.byteLength)
    return { status: 'written', byteLength: data.byteLength }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误'
    return { status: 'error', message: `无法写入视频：${detail}` }
  }
}

async function closeSessionFile(session: VideoExportSession): Promise<void> {
  if (session.closed) return
  await session.file.close()
  session.closed = true
}

export async function finishVideoExport(
  session: VideoExportSession,
  dependencies: VideoFileServiceDependencies
): Promise<VideoExportOperationResult> {
  try {
    if (session.closed) throw new Error('视频导出会话已经结束。')
    if (session.highestWrittenByte < 64) throw new Error('编码器没有生成完整的视频数据。')
    await session.file.sync()
    await closeSessionFile(session)
    await dependencies.replaceFile(session.temporaryPath, session.targetPath)
    return {
      status: 'saved',
      filePath: session.targetPath,
      displayName: session.displayName,
      byteLength: session.highestWrittenByte
    }
  } catch (error) {
    await closeSessionFile(session).catch(() => undefined)
    await dependencies.removeFile(session.temporaryPath).catch(() => undefined)
    const detail = error instanceof Error ? error.message : '未知错误'
    return { status: 'error', message: `无法完成视频导出：${detail}` }
  }
}

export async function cancelVideoExport(
  session: VideoExportSession,
  dependencies: VideoFileServiceDependencies
): Promise<VideoExportOperationResult> {
  try {
    await closeSessionFile(session)
    await dependencies.removeFile(session.temporaryPath)
    return { status: 'cancelled' }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误'
    return { status: 'error', message: `无法清理未完成的视频：${detail}` }
  }
}
