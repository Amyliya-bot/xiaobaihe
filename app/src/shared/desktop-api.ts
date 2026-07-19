import type { ProjectDocument } from './project-document'
import type { ImportedModelFormat } from './project-document'

export type FileOperationResult =
  | { status: 'saved'; filePath: string; displayName: string; warning?: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

export type OpenProjectResult =
  | { status: 'opened'; filePath: string; displayName: string; document: ProjectDocument }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

export interface SaveProjectRequest {
  document: ProjectDocument
  saveAs: boolean
}

export interface AutosaveProjectRequest {
  document: ProjectDocument
  currentPath: string | null
}

export interface RecoverySnapshot {
  document: ProjectDocument
  currentPath: string | null
  capturedAt: string
}

export type WorkspaceOperationResult = { status: 'ok' } | { status: 'error'; message: string }

export type LoadRecoveryResult =
  | { status: 'found'; snapshot: RecoverySnapshot }
  | { status: 'empty' }
  | { status: 'error'; message: string }

export interface RecentProjectEntry {
  filePath: string
  displayName: string
  lastOpenedAt: string
  fileSizeBytes?: number
  modifiedAt?: string
}

export type RecentProjectsResult =
  { status: 'loaded'; entries: RecentProjectEntry[] } | { status: 'error'; message: string }

export interface SavePngRequest {
  base64Data: string
  suggestedName: string
  format?: 'png' | 'jpg'
}

export interface SaveImageBundleRequest {
  images: Array<{
    kind: 'white' | 'depth' | 'normal' | 'objectId' | 'mask' | 'outline'
    base64Data: string
  }>
  suggestedBaseName: string
}

export interface BeginImageSequenceRequest {
  suggestedBaseName: string
  frameRate: number
  totalFrames: number
  width: number
  height: number
}

export type BeginImageSequenceResult =
  | { status: 'opened'; sessionId: string; directoryPath: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

export interface WriteImageSequenceFrameRequest {
  sessionId: string
  frameIndex: number
  base64Data: string
}

export interface FinishImageSequenceRequest {
  sessionId: string
}

export interface BeginVideoExportRequest {
  suggestedName: string
  presetId: string
  frameRate: number
  totalFrames: number
  width: number
  height: number
}

export type BeginVideoExportResult =
  | { status: 'opened'; sessionId: string; filePath: string; displayName: string }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

export interface WriteVideoChunkRequest {
  sessionId: string
  position: number
  data: Uint8Array
}

export interface FinishVideoExportRequest {
  sessionId: string
}

export type VideoChunkOperationResult =
  { status: 'written'; byteLength: number } | { status: 'error'; message: string }

export type VideoExportOperationResult =
  | { status: 'saved'; filePath: string; displayName: string; byteLength: number }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

export type ImageSequenceOperationResult =
  | { status: 'saved'; directoryPath: string; fileCount: number }
  | { status: 'cancelled'; directoryPath: string; fileCount: number }
  | { status: 'error'; message: string }

export type SaveImageBundleResult =
  | { status: 'saved'; directoryPath: string; filePaths: string[] }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

export interface OpenedModelFile {
  name: string
  data: Uint8Array
  mimeType?: string
}

export type OpenModelResult =
  | {
      status: 'opened'
      format: ImportedModelFormat
      primary: OpenedModelFile
      resources: OpenedModelFile[]
    }
  | { status: 'cancelled' }
  | { status: 'error'; message: string }

export type ExportModelFormat = 'glb' | 'gltf' | 'obj'

export interface SaveModelRequest {
  format: ExportModelFormat
  data: string | Uint8Array
  suggestedName: string
}

export interface DesktopProjectApi {
  resetPath: () => Promise<void>
  save: (request: SaveProjectRequest) => Promise<FileOperationResult>
  open: () => Promise<OpenProjectResult>
  autosave: (request: AutosaveProjectRequest) => Promise<WorkspaceOperationResult>
  loadRecovery: () => Promise<LoadRecoveryResult>
  restoreRecovery: () => Promise<WorkspaceOperationResult>
  clearRecovery: () => Promise<WorkspaceOperationResult>
  listRecent: () => Promise<RecentProjectsResult>
  openRecent: (filePath: string) => Promise<OpenProjectResult>
  removeRecent: (filePath: string) => Promise<RecentProjectsResult>
  showInFolder: (filePath: string) => Promise<WorkspaceOperationResult>
  trashRecent: (filePath: string) => Promise<RecentProjectsResult>
}

export interface DesktopImageApi {
  savePng: (request: SavePngRequest) => Promise<FileOperationResult>
  saveBundle: (request: SaveImageBundleRequest) => Promise<SaveImageBundleResult>
  beginSequence: (request: BeginImageSequenceRequest) => Promise<BeginImageSequenceResult>
  writeSequenceFrame: (
    request: WriteImageSequenceFrameRequest
  ) => Promise<ImageSequenceOperationResult>
  finishSequence: (request: FinishImageSequenceRequest) => Promise<ImageSequenceOperationResult>
  cancelSequence: (request: FinishImageSequenceRequest) => Promise<ImageSequenceOperationResult>
}

export interface DesktopModelApi {
  open: () => Promise<OpenModelResult>
  save: (request: SaveModelRequest) => Promise<FileOperationResult>
}

export interface DesktopVideoApi {
  begin: (request: BeginVideoExportRequest) => Promise<BeginVideoExportResult>
  writeChunk: (request: WriteVideoChunkRequest) => Promise<VideoChunkOperationResult>
  finish: (request: FinishVideoExportRequest) => Promise<VideoExportOperationResult>
  cancel: (request: FinishVideoExportRequest) => Promise<VideoExportOperationResult>
}

export interface DesktopAppApi {
  setDirty: (dirty: boolean) => Promise<void>
  onCloseRequested: (listener: () => void) => () => void
  confirmClose: () => Promise<void>
  cancelClose: () => Promise<void>
}

export interface DesktopApi {
  project: DesktopProjectApi
  image: DesktopImageApi
  model: DesktopModelApi
  video: DesktopVideoApi
  app: DesktopAppApi
}
