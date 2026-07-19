import { contextBridge, ipcRenderer } from 'electron'
import type { DesktopApi } from '../shared/desktop-api'
import { IPC_CHANNELS } from '../shared/ipc-channels'
import type { DesktopRuntimeInfo } from './index.d'

const runtimeInfo: DesktopRuntimeInfo = Object.freeze({
  platform: process.platform,
  electronVersion: process.versions.electron,
  chromeVersion: process.versions.chrome
})

const desktopApi: DesktopApi = Object.freeze({
  project: Object.freeze({
    resetPath: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.projectResetPath),
    save: (request) => ipcRenderer.invoke(IPC_CHANNELS.projectSave, request),
    open: () => ipcRenderer.invoke(IPC_CHANNELS.projectOpen),
    autosave: (request) => ipcRenderer.invoke(IPC_CHANNELS.projectAutosave, request),
    loadRecovery: () => ipcRenderer.invoke(IPC_CHANNELS.projectRecoveryLoad),
    restoreRecovery: () => ipcRenderer.invoke(IPC_CHANNELS.projectRecoveryRestore),
    clearRecovery: () => ipcRenderer.invoke(IPC_CHANNELS.projectRecoveryClear),
    listRecent: () => ipcRenderer.invoke(IPC_CHANNELS.projectRecentList),
    openRecent: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.projectRecentOpen, filePath),
    removeRecent: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.projectRecentRemove, filePath),
    showInFolder: (filePath) =>
      ipcRenderer.invoke(IPC_CHANNELS.projectRecentShowInFolder, filePath),
    trashRecent: (filePath) => ipcRenderer.invoke(IPC_CHANNELS.projectRecentTrash, filePath)
  }),
  image: Object.freeze({
    savePng: (request) => ipcRenderer.invoke(IPC_CHANNELS.imageSavePng, request),
    saveBundle: (request) => ipcRenderer.invoke(IPC_CHANNELS.imageSaveBundle, request),
    beginSequence: (request) => ipcRenderer.invoke(IPC_CHANNELS.imageSequenceBegin, request),
    writeSequenceFrame: (request) => ipcRenderer.invoke(IPC_CHANNELS.imageSequenceWrite, request),
    finishSequence: (request) => ipcRenderer.invoke(IPC_CHANNELS.imageSequenceFinish, request),
    cancelSequence: (request) => ipcRenderer.invoke(IPC_CHANNELS.imageSequenceCancel, request)
  }),
  model: Object.freeze({
    open: () => ipcRenderer.invoke(IPC_CHANNELS.modelOpen),
    save: (request) => ipcRenderer.invoke(IPC_CHANNELS.modelSave, request)
  }),
  video: Object.freeze({
    begin: (request) => ipcRenderer.invoke(IPC_CHANNELS.videoBegin, request),
    writeChunk: (request) => ipcRenderer.invoke(IPC_CHANNELS.videoWriteChunk, request),
    finish: (request) => ipcRenderer.invoke(IPC_CHANNELS.videoFinish, request),
    cancel: (request) => ipcRenderer.invoke(IPC_CHANNELS.videoCancel, request)
  }),
  app: Object.freeze({
    setDirty: (dirty) => ipcRenderer.invoke(IPC_CHANNELS.projectSetDirty, dirty),
    onCloseRequested: (listener) => {
      const handler = (): void => listener()
      ipcRenderer.on(IPC_CHANNELS.appCloseRequested, handler)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.appCloseRequested, handler)
    },
    confirmClose: () => ipcRenderer.invoke(IPC_CHANNELS.appConfirmClose),
    cancelClose: () => ipcRenderer.invoke(IPC_CHANNELS.appCancelClose)
  })
})

contextBridge.exposeInMainWorld('desktopRuntime', runtimeInfo)
contextBridge.exposeInMainWorld('desktopApi', desktopApi)
