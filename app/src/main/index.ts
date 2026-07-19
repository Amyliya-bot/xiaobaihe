import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { randomUUID } from 'crypto'
import { access, mkdir, open, readFile, rename, rm, stat, writeFile } from 'fs/promises'
import { basename, dirname, extname, join } from 'path'
import icon from '../../resources/icon.png?asset'
import type {
  BeginImageSequenceRequest,
  BeginVideoExportRequest,
  AutosaveProjectRequest,
  FinishImageSequenceRequest,
  OpenedModelFile,
  SaveImageBundleRequest,
  SavePngRequest,
  SaveProjectRequest,
  SaveModelRequest,
  WriteImageSequenceFrameRequest,
  WriteVideoChunkRequest
} from '../shared/desktop-api'
import { APP_NAME } from '../shared/app-meta'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import {
  beginImageSequence,
  cancelImageSequence,
  finishImageSequence,
  openProjectAtPath,
  openProjectFile,
  saveImageBundle,
  saveModelFile,
  savePngFile,
  saveProjectFile,
  writeImageSequenceFrame,
  type ImageSequenceSession,
  type ProjectFileServiceDependencies
} from './project-file-service'
import {
  clearRecoverySnapshot,
  isRecordedRecentProject,
  listRecentProjects,
  loadRecoverySnapshot,
  recordRecentProject,
  removeRecentProject,
  saveRecoverySnapshot,
  type WorkspaceStateDependencies,
  type WorkspaceStateLocations
} from './workspace-state-service'
import {
  beginVideoExport,
  cancelVideoExport,
  finishVideoExport,
  writeVideoChunk,
  type VideoExportSession,
  type VideoFileServiceDependencies
} from './video-file-service'

const testUserDataPath = process.env['WHITEBOX_TEST_USER_DATA']
if (testUserDataPath) app.setPath('userData', testUserDataPath)
else {
  // Keep existing projects, recovery state and preferences after the public product rename.
  app.setPath('userData', join(app.getPath('appData'), '轻量白膜建模平台'))
}

app.enableSandbox()

let currentProjectPath: string | undefined
let hasUnsavedChanges = false
let closeConfirmed = false
let closeRequestPending = false
const imageSequenceSessions = new Map<
  string,
  { webContentsId: number; session: ImageSequenceSession }
>()
const videoExportSessions = new Map<
  string,
  { webContentsId: number; session: VideoExportSession }
>()
let workspaceMutationQueue: Promise<void> = Promise.resolve()

function queueWorkspaceMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = workspaceMutationQueue.then(operation, operation)
  workspaceMutationQueue = result.then(
    () => undefined,
    () => undefined
  )
  return result
}

function isMissingFileError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function workspaceLocations(): WorkspaceStateLocations {
  const directoryPath = join(app.getPath('userData'), 'workspace-state')
  return {
    recoveryFilePath: join(directoryPath, 'recovery.json'),
    recentFilePath: join(directoryPath, 'recent-projects.json')
  }
}

async function writeTextFileAtomic(filePath: string, data: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, data, 'utf8')
    await rename(temporaryPath, filePath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }
}

function workspaceDependencies(): WorkspaceStateDependencies {
  return {
    readOptionalFile: async (filePath) => {
      try {
        return await readFile(filePath, 'utf8')
      } catch (error) {
        if (isMissingFileError(error)) return null
        throw error
      }
    },
    writeFileAtomic: writeTextFileAtomic,
    removeOptionalFile: async (filePath) => {
      await rm(filePath, { force: true })
    },
    fileExists: async (filePath) => {
      try {
        await access(filePath)
        return true
      } catch {
        return false
      }
    },
    fileMetadata: async (filePath) => {
      try {
        const metadata = await stat(filePath)
        return {
          fileSizeBytes: metadata.size,
          modifiedAt: metadata.mtime.toISOString()
        }
      } catch (error) {
        if (isMissingFileError(error)) return null
        throw error
      }
    },
    now: () => new Date()
  }
}

async function finalizeProjectTransition(filePath: string): Promise<string | undefined> {
  return queueWorkspaceMutation(async () => {
    const locations = workspaceLocations()
    const dependencies = workspaceDependencies()
    const recentResult = await recordRecentProject(filePath, locations, dependencies)
    const recoveryResult = await clearRecoverySnapshot(locations, dependencies)
    const messages = [recentResult, recoveryResult]
      .filter((result) => result.status === 'error')
      .map((result) => (result.status === 'error' ? result.message : ''))
    return messages.length > 0 ? messages.join('；') : undefined
  })
}

function fileDependencies(window: BrowserWindow | null): ProjectFileServiceDependencies {
  return {
    showSaveDialog: (options) =>
      window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options),
    showOpenDialog: (options) =>
      window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options),
    writeFile,
    writeFileAtomic: writeTextFileAtomic,
    readFile,
    makeDirectory: (directoryPath) => mkdir(directoryPath),
    now: () => new Date()
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function replaceVideoFile(temporaryPath: string, targetPath: string): Promise<void> {
  const backupPath = `${targetPath}.${process.pid}.${randomUUID()}.backup`
  const targetExisted = await pathExists(targetPath)
  if (targetExisted) await rename(targetPath, backupPath)
  try {
    await rename(temporaryPath, targetPath)
  } catch (error) {
    if (targetExisted) await rename(backupPath, targetPath).catch(() => undefined)
    throw error
  }
  if (targetExisted) await rm(backupPath, { force: true }).catch(() => undefined)
}

function videoDependencies(window: BrowserWindow | null): VideoFileServiceDependencies {
  return {
    showSaveDialog: (options) =>
      window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options),
    openFile: (filePath) => open(filePath, 'w'),
    replaceFile: replaceVideoFile,
    removeFile: (filePath) => rm(filePath, { force: true }),
    createTemporaryPath: (targetPath) => `${targetPath}.${process.pid}.${randomUUID()}.partial`
  }
}

function registerFileHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.projectResetPath, async (event) => {
    currentProjectPath = undefined
    hasUnsavedChanges = false
    BrowserWindow.fromWebContents(event.sender)?.setTitle(APP_NAME)
    const clearResult = await queueWorkspaceMutation(() =>
      clearRecoverySnapshot(workspaceLocations(), workspaceDependencies())
    )
    if (clearResult.status === 'error') throw new Error(clearResult.message)
  })

  ipcMain.handle(IPC_CHANNELS.projectSave, async (event, request: SaveProjectRequest) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await saveProjectFile(
      { ...request, currentPath: currentProjectPath },
      fileDependencies(window)
    )
    if (result.status === 'saved') {
      currentProjectPath = result.filePath
      hasUnsavedChanges = false
      window?.setTitle(`${result.displayName} - ${APP_NAME}`)
      const warning = await finalizeProjectTransition(result.filePath)
      return warning ? { ...result, warning } : result
    }
    return result
  })

  ipcMain.handle(IPC_CHANNELS.projectOpen, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await openProjectFile(fileDependencies(window))
    if (result.status === 'opened') {
      currentProjectPath = result.filePath
      hasUnsavedChanges = false
      window?.setTitle(`${result.displayName} - ${APP_NAME}`)
      await finalizeProjectTransition(result.filePath)
    }
    return result
  })

  ipcMain.handle(IPC_CHANNELS.projectAutosave, (_event, request: AutosaveProjectRequest) =>
    queueWorkspaceMutation(() =>
      saveRecoverySnapshot(request, workspaceLocations(), workspaceDependencies())
    )
  )

  ipcMain.handle(IPC_CHANNELS.projectRecoveryLoad, () =>
    loadRecoverySnapshot(workspaceLocations(), workspaceDependencies())
  )

  ipcMain.handle(IPC_CHANNELS.projectRecoveryRestore, async (event) => {
    const result = await loadRecoverySnapshot(workspaceLocations(), workspaceDependencies())
    if (result.status !== 'found') {
      return {
        status: 'error' as const,
        message: result.status === 'error' ? result.message : '没有可恢复的工程副本。'
      }
    }
    currentProjectPath = result.snapshot.currentPath ?? undefined
    hasUnsavedChanges = true
    const window = BrowserWindow.fromWebContents(event.sender)
    window?.setTitle(`${result.snapshot.document.name} * - ${APP_NAME}`)
    return { status: 'ok' as const }
  })

  ipcMain.handle(IPC_CHANNELS.projectRecoveryClear, () =>
    queueWorkspaceMutation(() =>
      clearRecoverySnapshot(workspaceLocations(), workspaceDependencies())
    )
  )

  ipcMain.handle(IPC_CHANNELS.projectRecentList, () =>
    listRecentProjects(workspaceLocations(), workspaceDependencies())
  )

  ipcMain.handle(IPC_CHANNELS.projectRecentOpen, async (event, filePath: string) => {
    try {
      if (typeof filePath !== 'string' || filePath.trim().length === 0) {
        return { status: 'error' as const, message: '最近工程路径无效。' }
      }
      const recorded = await isRecordedRecentProject(
        filePath,
        workspaceLocations(),
        workspaceDependencies()
      )
      if (!recorded) return { status: 'error' as const, message: '该工程已不在最近记录中。' }
      const window = BrowserWindow.fromWebContents(event.sender)
      const result = await openProjectAtPath(filePath, fileDependencies(window))
      if (result.status === 'opened') {
        currentProjectPath = result.filePath
        hasUnsavedChanges = false
        window?.setTitle(`${result.displayName} - ${APP_NAME}`)
        await finalizeProjectTransition(result.filePath)
      }
      return result
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知错误'
      return { status: 'error' as const, message: `无法打开最近工程：${detail}` }
    }
  })

  ipcMain.handle(IPC_CHANNELS.projectRecentRemove, (_event, filePath: string) =>
    queueWorkspaceMutation(() =>
      removeRecentProject(filePath, workspaceLocations(), workspaceDependencies())
    )
  )

  ipcMain.handle(IPC_CHANNELS.projectRecentShowInFolder, async (_event, filePath: string) => {
    try {
      const recorded = await isRecordedRecentProject(
        filePath,
        workspaceLocations(),
        workspaceDependencies()
      )
      if (!recorded) return { status: 'error' as const, message: '该工程已不在本地项目记录中。' }
      shell.showItemInFolder(filePath)
      return { status: 'ok' as const }
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知错误'
      return { status: 'error' as const, message: `无法打开工程所在文件夹：${detail}` }
    }
  })

  ipcMain.handle(IPC_CHANNELS.projectRecentTrash, async (_event, filePath: string) => {
    try {
      const recorded = await isRecordedRecentProject(
        filePath,
        workspaceLocations(),
        workspaceDependencies()
      )
      if (!recorded) return { status: 'error' as const, message: '该工程已不在本地项目记录中。' }
      if (currentProjectPath?.toLocaleLowerCase() === filePath.toLocaleLowerCase()) {
        return {
          status: 'error' as const,
          message: '当前正在编辑这个工程，请先打开其他工程再删除。'
        }
      }
      await shell.trashItem(filePath)
      return queueWorkspaceMutation(() =>
        removeRecentProject(filePath, workspaceLocations(), workspaceDependencies())
      )
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知错误'
      return { status: 'error' as const, message: `无法移入 Windows 回收站：${detail}` }
    }
  })

  ipcMain.handle(IPC_CHANNELS.projectSetDirty, (_event, dirty: boolean) => {
    hasUnsavedChanges = dirty === true
  })

  ipcMain.handle(IPC_CHANNELS.appConfirmClose, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    await queueWorkspaceMutation(() =>
      clearRecoverySnapshot(workspaceLocations(), workspaceDependencies())
    )
    closeConfirmed = true
    closeRequestPending = false
    window.close()
  })

  ipcMain.handle(IPC_CHANNELS.appCancelClose, () => {
    closeRequestPending = false
  })

  ipcMain.handle(IPC_CHANNELS.imageSavePng, async (event, request: SavePngRequest) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return savePngFile(request, fileDependencies(window))
  })

  ipcMain.handle(IPC_CHANNELS.imageSaveBundle, async (event, request: SaveImageBundleRequest) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return saveImageBundle(request, fileDependencies(window))
  })

  ipcMain.handle(
    IPC_CHANNELS.imageSequenceBegin,
    async (event, request: BeginImageSequenceRequest) => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const result = await beginImageSequence(request, fileDependencies(window))
      if (result.status !== 'opened') return result
      const sessionId = randomUUID()
      imageSequenceSessions.set(sessionId, {
        webContentsId: event.sender.id,
        session: result.session
      })
      return {
        status: 'opened',
        sessionId,
        directoryPath: result.session.directoryPath
      }
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.imageSequenceWrite,
    async (event, request: WriteImageSequenceFrameRequest) => {
      const stored = imageSequenceSessions.get(request.sessionId)
      if (!stored || stored.webContentsId !== event.sender.id) {
        return { status: 'error', message: '动画帧导出会话不存在或已结束。' }
      }
      return writeImageSequenceFrame(
        stored.session,
        request.frameIndex,
        request.base64Data,
        fileDependencies(BrowserWindow.fromWebContents(event.sender))
      )
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.imageSequenceFinish,
    async (event, request: FinishImageSequenceRequest) => {
      const stored = imageSequenceSessions.get(request.sessionId)
      if (!stored || stored.webContentsId !== event.sender.id) {
        return { status: 'error', message: '动画帧导出会话不存在或已结束。' }
      }
      const result = await finishImageSequence(
        stored.session,
        fileDependencies(BrowserWindow.fromWebContents(event.sender))
      )
      if (result.status === 'saved') imageSequenceSessions.delete(request.sessionId)
      return result
    }
  )

  ipcMain.handle(
    IPC_CHANNELS.imageSequenceCancel,
    async (event, request: FinishImageSequenceRequest) => {
      const stored = imageSequenceSessions.get(request.sessionId)
      if (!stored || stored.webContentsId !== event.sender.id) {
        return { status: 'error', message: '动画帧导出会话不存在或已结束。' }
      }
      const result = await cancelImageSequence(
        stored.session,
        fileDependencies(BrowserWindow.fromWebContents(event.sender))
      )
      imageSequenceSessions.delete(request.sessionId)
      return result
    }
  )

  ipcMain.handle(IPC_CHANNELS.videoBegin, async (event, request: BeginVideoExportRequest) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = await beginVideoExport(request, videoDependencies(window))
    if (result.status !== 'opened') return result
    const sessionId = randomUUID()
    videoExportSessions.set(sessionId, {
      webContentsId: event.sender.id,
      session: result.session
    })
    return {
      status: 'opened',
      sessionId,
      filePath: result.session.targetPath,
      displayName: result.session.displayName
    }
  })

  ipcMain.handle(IPC_CHANNELS.videoWriteChunk, async (event, request: WriteVideoChunkRequest) => {
    const stored = videoExportSessions.get(request.sessionId)
    if (!stored || stored.webContentsId !== event.sender.id) {
      return { status: 'error', message: '视频导出会话不存在或已经结束。' }
    }
    return writeVideoChunk(stored.session, request.position, request.data)
  })

  ipcMain.handle(IPC_CHANNELS.videoFinish, async (event, request: { sessionId: string }) => {
    const stored = videoExportSessions.get(request.sessionId)
    if (!stored || stored.webContentsId !== event.sender.id) {
      return { status: 'error', message: '视频导出会话不存在或已经结束。' }
    }
    const result = await finishVideoExport(
      stored.session,
      videoDependencies(BrowserWindow.fromWebContents(event.sender))
    )
    videoExportSessions.delete(request.sessionId)
    return result
  })

  ipcMain.handle(IPC_CHANNELS.videoCancel, async (event, request: { sessionId: string }) => {
    const stored = videoExportSessions.get(request.sessionId)
    if (!stored || stored.webContentsId !== event.sender.id) {
      return { status: 'error', message: '视频导出会话不存在或已经结束。' }
    }
    const result = await cancelVideoExport(
      stored.session,
      videoDependencies(BrowserWindow.fromWebContents(event.sender))
    )
    videoExportSessions.delete(request.sessionId)
    return result
  })

  ipcMain.handle(IPC_CHANNELS.modelOpen, async (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender)
      const result = await (window
        ? dialog.showOpenDialog(window, {
            title: '导入模型及关联文件',
            filters: [
              {
                name: '三维模型',
                extensions: ['glb', 'gltf', 'obj', 'bin', 'mtl', 'png', 'jpg', 'jpeg', 'webp']
              }
            ],
            properties: ['openFile', 'multiSelections']
          })
        : dialog.showOpenDialog({
            title: '导入模型及关联文件',
            filters: [
              {
                name: '三维模型',
                extensions: ['glb', 'gltf', 'obj', 'bin', 'mtl', 'png', 'jpg', 'jpeg', 'webp']
              }
            ],
            properties: ['openFile', 'multiSelections']
          }))
      if (result.canceled || result.filePaths.length === 0) return { status: 'cancelled' }

      const primaryPath = result.filePaths.find((filePath) =>
        ['.glb', '.gltf', '.obj'].includes(extname(filePath).toLowerCase())
      )
      if (!primaryPath) return { status: 'error', message: '请选择 GLB、GLTF 或 OBJ 主文件。' }
      const extension = extname(primaryPath).toLowerCase().slice(1)
      const mimeTypes: Record<string, string> = {
        bin: 'application/octet-stream',
        png: 'image/png',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        webp: 'image/webp',
        mtl: 'text/plain'
      }
      const readModelFile = async (filePath: string): Promise<OpenedModelFile> => ({
        name: basename(filePath),
        data: new Uint8Array(await readFile(filePath)),
        mimeType: mimeTypes[extname(filePath).toLowerCase().slice(1)]
      })
      return {
        status: 'opened',
        format: extension,
        primary: await readModelFile(primaryPath),
        resources: await Promise.all(
          result.filePaths.filter((filePath) => filePath !== primaryPath).map(readModelFile)
        )
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : '未知错误'
      return { status: 'error', message: `无法读取模型文件：${detail}` }
    }
  })

  ipcMain.handle(IPC_CHANNELS.modelSave, async (event, request: SaveModelRequest) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    return saveModelFile(request, fileDependencies(window))
  })
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1360,
    height: 820,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#eef0f1',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })
  const mainWebContentsId = mainWindow.webContents.id
  const networkSession = mainWindow.webContents.session

  networkSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false)
  })
  networkSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      let isLocalDevelopmentRequest = false
      if (!app.isPackaged) {
        try {
          const host = new URL(details.url).hostname
          isLocalDevelopmentRequest =
            host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
        } catch {
          isLocalDevelopmentRequest = false
        }
      }
      callback({ cancel: !isLocalDevelopmentRequest })
    }
  )

  mainWindow.on('ready-to-show', () => {
    if (process.env['WHITEBOX_TECHNICAL_VALIDATION'] !== '1') mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.on('close', (event) => {
    if (!hasUnsavedChanges || closeConfirmed) return
    event.preventDefault()
    if (closeRequestPending) return
    closeRequestPending = true
    mainWindow.webContents.send(IPC_CHANNELS.appCloseRequested)
  })

  mainWindow.on('closed', () => {
    for (const [sessionId, stored] of videoExportSessions) {
      if (stored.webContentsId !== mainWebContentsId) continue
      videoExportSessions.delete(sessionId)
      void cancelVideoExport(stored.session, videoDependencies(null))
    }
    closeConfirmed = false
    closeRequestPending = false
    hasUnsavedChanges = false
  })

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  app.setAppUserModelId('org.whiteboxstudio.app')
  registerFileHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
