import type { OpenDialogOptions, OpenDialogReturnValue, SaveDialogOptions } from 'electron'
import { basename, extname, join } from 'path'
import type {
  BeginImageSequenceRequest,
  FileOperationResult,
  ImageSequenceOperationResult,
  OpenProjectResult,
  SaveImageBundleRequest,
  SaveImageBundleResult,
  SaveModelRequest,
  SavePngRequest,
  SaveProjectRequest
} from '../shared/desktop-api'
import { parseProjectDocument, PROJECT_EXTENSION } from '../shared/project-document'

export interface ProjectFileServiceDependencies {
  showSaveDialog: (
    options: SaveDialogOptions
  ) => Promise<{ canceled: boolean; filePath?: string | undefined }>
  showOpenDialog: (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>
  writeFile: (
    filePath: string,
    data: string | Uint8Array,
    encoding?: BufferEncoding
  ) => Promise<void>
  writeFileAtomic: (filePath: string, data: string) => Promise<void>
  readFile: (filePath: string, encoding: BufferEncoding) => Promise<string>
  makeDirectory: (directoryPath: string) => Promise<void>
  now: () => Date
}

export interface ImageSequenceSession {
  directoryPath: string
  baseName: string
  frameRate: number
  totalFrames: number
  width: number
  height: number
  writtenFrames: Set<number>
}

export type BeginImageSequenceFileResult =
  | { status: 'opened'; session: ImageSequenceSession }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

interface SaveProjectFileRequest extends SaveProjectRequest {
  currentPath?: string
}

function safeName(name: string, fallback: string): string {
  const invalidCharacters = '<>:"/\\|?*'
  const sanitized = [...name]
    .map((character) =>
      character.charCodeAt(0) <= 31 || invalidCharacters.includes(character) ? '_' : character
    )
    .join('')
    .trim()
  return sanitized || fallback
}

function displayName(filePath: string): string {
  return basename(filePath, extname(filePath))
}

function isValidBase64(value: string): boolean {
  return Boolean(value) && /^[a-zA-Z0-9+/]+=*$/.test(value)
}

function sequenceTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
}

export async function saveProjectFile(
  request: SaveProjectFileRequest,
  dependencies: ProjectFileServiceDependencies
): Promise<FileOperationResult> {
  try {
    const validated = parseProjectDocument(JSON.stringify(request.document))
    let filePath = request.saveAs ? undefined : request.currentPath

    if (!filePath) {
      const result = await dependencies.showSaveDialog({
        title: request.saveAs ? '另存工程' : '保存工程',
        defaultPath: `${safeName(validated.name, '未命名场景')}.${PROJECT_EXTENSION}`,
        filters: [{ name: '白膜工程', extensions: [PROJECT_EXTENSION] }],
        properties: ['showOverwriteConfirmation', 'createDirectory']
      })
      if (result.canceled || !result.filePath) return { status: 'cancelled' }
      filePath = result.filePath
    }

    const nextDisplayName = displayName(filePath)
    const storedDocument = { ...validated, name: nextDisplayName }
    await dependencies.writeFileAtomic(filePath, `${JSON.stringify(storedDocument, null, 2)}\n`)
    return { status: 'saved', filePath, displayName: nextDisplayName }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误'
    return { status: 'error', message: `无法保存工程：${detail}` }
  }
}

export async function openProjectFile(
  dependencies: ProjectFileServiceDependencies
): Promise<OpenProjectResult> {
  try {
    const result = await dependencies.showOpenDialog({
      title: '打开工程',
      filters: [{ name: '白膜工程', extensions: [PROJECT_EXTENSION] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) return { status: 'cancelled' }

    return openProjectAtPath(result.filePaths[0], dependencies)
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误'
    return { status: 'error', message: detail }
  }
}

export async function openProjectAtPath(
  filePath: string,
  dependencies: ProjectFileServiceDependencies
): Promise<OpenProjectResult> {
  try {
    const source = await dependencies.readFile(filePath, 'utf8')
    const document = parseProjectDocument(source)
    return { status: 'opened', filePath, displayName: displayName(filePath), document }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误'
    return { status: 'error', message: detail }
  }
}

export async function savePngFile(
  request: SavePngRequest,
  dependencies: ProjectFileServiceDependencies
): Promise<FileOperationResult> {
  try {
    if (!isValidBase64(request.base64Data)) {
      throw new Error('图片数据无效。')
    }
    const format = request.format === 'jpg' ? 'jpg' : 'png'
    const label = format === 'jpg' ? 'JPG 图片' : 'PNG 图片'
    const result = await dependencies.showSaveDialog({
      title: '导出摄影机画面',
      defaultPath: safeName(request.suggestedName, `白膜场景.${format}`),
      filters: [{ name: label, extensions: [format] }],
      properties: ['showOverwriteConfirmation', 'createDirectory']
    })
    if (result.canceled || !result.filePath) return { status: 'cancelled' }

    await dependencies.writeFile(result.filePath, Buffer.from(request.base64Data, 'base64'))
    return {
      status: 'saved',
      filePath: result.filePath,
      displayName: basename(result.filePath)
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误'
    return { status: 'error', message: `无法导出图片：${detail}` }
  }
}

export async function saveModelFile(
  request: SaveModelRequest,
  dependencies: ProjectFileServiceDependencies
): Promise<FileOperationResult> {
  try {
    if (!(['glb', 'gltf', 'obj'] as const).includes(request.format)) {
      throw new Error('模型格式无效。')
    }
    const byteLength =
      typeof request.data === 'string' ? request.data.length : request.data.byteLength
    if (byteLength === 0) throw new Error('模型数据为空。')
    const labels = { glb: 'GLB 模型', gltf: 'GLTF 模型', obj: 'OBJ 模型' } as const
    const result = await dependencies.showSaveDialog({
      title: '导出当前场景模型',
      defaultPath: `${safeName(request.suggestedName, '白膜场景')}.${request.format}`,
      filters: [{ name: labels[request.format], extensions: [request.format] }],
      properties: ['showOverwriteConfirmation', 'createDirectory']
    })
    if (result.canceled || !result.filePath) return { status: 'cancelled' }
    await dependencies.writeFile(result.filePath, request.data)
    return {
      status: 'saved',
      filePath: result.filePath,
      displayName: basename(result.filePath)
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误'
    return { status: 'error', message: `无法导出模型：${detail}` }
  }
}

export async function saveImageBundle(
  request: SaveImageBundleRequest,
  dependencies: ProjectFileServiceDependencies
): Promise<SaveImageBundleResult> {
  try {
    if (request.images.length !== 6) throw new Error('参考图组必须包含六张图片。')
    const kinds = new Set(request.images.map((image) => image.kind))
    if (
      kinds.size !== 6 ||
      !(['white', 'depth', 'normal', 'objectId', 'mask', 'outline'] as const).every((kind) =>
        kinds.has(kind)
      )
    ) {
      throw new Error('参考图组缺少必需的控制图通道。')
    }
    for (const image of request.images) {
      if (!isValidBase64(image.base64Data)) {
        throw new Error('图片数据无效。')
      }
    }
    const result = await dependencies.showOpenDialog({
      title: '选择参考图保存文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return { status: 'cancelled' }

    const directoryPath = result.filePaths[0]
    const baseName = safeName(request.suggestedBaseName, '白膜场景')
    const suffixes = {
      white: '白模',
      depth: '深度',
      normal: '法线',
      objectId: '物体分色',
      mask: '遮罩',
      outline: '轮廓'
    } as const
    const filePaths: string[] = []
    for (const image of request.images) {
      const filePath = join(directoryPath, `${baseName}_${suffixes[image.kind]}.png`)
      await dependencies.writeFile(filePath, Buffer.from(image.base64Data, 'base64'))
      filePaths.push(filePath)
    }
    return { status: 'saved', directoryPath, filePaths }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误'
    return { status: 'error', message: `无法导出参考图：${detail}` }
  }
}

export async function beginImageSequence(
  request: BeginImageSequenceRequest,
  dependencies: ProjectFileServiceDependencies
): Promise<BeginImageSequenceFileResult> {
  try {
    if (!Number.isInteger(request.frameRate) || request.frameRate < 1 || request.frameRate > 120) {
      throw new Error('动画帧率无效。')
    }
    if (
      !Number.isInteger(request.totalFrames) ||
      request.totalFrames < 1 ||
      request.totalFrames > 7201
    ) {
      throw new Error('动画帧数量无效。')
    }
    if (
      !Number.isInteger(request.width) ||
      !Number.isInteger(request.height) ||
      request.width < 16 ||
      request.height < 16 ||
      request.width > 8192 ||
      request.height > 8192
    ) {
      throw new Error('动画画面尺寸无效。')
    }
    const result = await dependencies.showOpenDialog({
      title: '选择动画帧保存位置',
      properties: ['openDirectory', 'createDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return { status: 'cancelled' }

    const baseName = safeName(request.suggestedBaseName, '白膜动画')
    const directoryPath = join(
      result.filePaths[0],
      `${baseName}_动画帧_${sequenceTimestamp(dependencies.now())}`
    )
    await dependencies.makeDirectory(directoryPath)
    return {
      status: 'opened',
      session: {
        directoryPath,
        baseName,
        frameRate: request.frameRate,
        totalFrames: request.totalFrames,
        width: request.width,
        height: request.height,
        writtenFrames: new Set()
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误'
    return { status: 'error', message: `无法开始导出动画帧：${detail}` }
  }
}

export async function writeImageSequenceFrame(
  session: ImageSequenceSession,
  frameIndex: number,
  base64Data: string,
  dependencies: ProjectFileServiceDependencies
): Promise<ImageSequenceOperationResult> {
  try {
    if (!Number.isInteger(frameIndex) || frameIndex < 0 || frameIndex >= session.totalFrames) {
      throw new Error('动画帧编号无效。')
    }
    if (session.writtenFrames.has(frameIndex)) throw new Error('动画帧不能重复写入。')
    if (!isValidBase64(base64Data)) throw new Error('动画帧图片数据无效。')
    const digits = Math.max(6, String(session.totalFrames - 1).length)
    const filePath = join(
      session.directoryPath,
      `${session.baseName}_${String(frameIndex).padStart(digits, '0')}.png`
    )
    await dependencies.writeFile(filePath, Buffer.from(base64Data, 'base64'))
    session.writtenFrames.add(frameIndex)
    return {
      status: 'saved',
      directoryPath: session.directoryPath,
      fileCount: session.writtenFrames.size
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误'
    return { status: 'error', message: `无法写入动画帧：${detail}` }
  }
}

async function writeImageSequenceManifest(
  session: ImageSequenceSession,
  complete: boolean,
  dependencies: ProjectFileServiceDependencies
): Promise<void> {
  const manifest = {
    schemaVersion: 1,
    complete,
    frameRate: session.frameRate,
    totalFrames: session.totalFrames,
    writtenFrames: session.writtenFrames.size,
    width: session.width,
    height: session.height,
    filePattern: `${session.baseName}_%06d.png`
  }
  await dependencies.writeFile(
    join(session.directoryPath, `${session.baseName}_动画帧.json`),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  )
}

export async function finishImageSequence(
  session: ImageSequenceSession,
  dependencies: ProjectFileServiceDependencies
): Promise<ImageSequenceOperationResult> {
  try {
    if (session.writtenFrames.size !== session.totalFrames) {
      throw new Error(
        `动画帧不完整：应有 ${session.totalFrames} 张，实际 ${session.writtenFrames.size} 张。`
      )
    }
    await writeImageSequenceManifest(session, true, dependencies)
    return {
      status: 'saved',
      directoryPath: session.directoryPath,
      fileCount: session.writtenFrames.size
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误'
    return { status: 'error', message: `无法完成动画帧导出：${detail}` }
  }
}

export async function cancelImageSequence(
  session: ImageSequenceSession,
  dependencies: ProjectFileServiceDependencies
): Promise<ImageSequenceOperationResult> {
  try {
    await writeImageSequenceManifest(session, false, dependencies)
    return {
      status: 'cancelled',
      directoryPath: session.directoryPath,
      fileCount: session.writtenFrames.size
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误'
    return { status: 'error', message: `无法标记未完成的动画帧：${detail}` }
  }
}
