import { basename, extname } from 'path'
import type {
  AutosaveProjectRequest,
  LoadRecoveryResult,
  RecentProjectEntry,
  RecentProjectsResult,
  WorkspaceOperationResult
} from '../shared/desktop-api'
import { parseProjectDocument } from '../shared/project-document'

const WORKSPACE_STATE_VERSION = 1
export const RECENT_PROJECT_LIMIT = 8

export interface WorkspaceStateLocations {
  recoveryFilePath: string
  recentFilePath: string
}

export interface WorkspaceStateDependencies {
  readOptionalFile: (filePath: string) => Promise<string | null>
  writeFileAtomic: (filePath: string, data: string) => Promise<void>
  removeOptionalFile: (filePath: string) => Promise<void>
  fileExists: (filePath: string) => Promise<boolean>
  fileMetadata?: (filePath: string) => Promise<{ fileSizeBytes: number; modifiedAt: string } | null>
  now: () => Date
}

interface RecoveryFile {
  version: number
  capturedAt: string
  currentPath: string | null
  document: unknown
}

interface RecentProjectsFile {
  version: number
  entries: RecentProjectEntry[]
}

function operationError(prefix: string, error: unknown): WorkspaceOperationResult {
  const detail = error instanceof Error ? error.message : '未知错误'
  return { status: 'error', message: `${prefix}：${detail}` }
}

function recentDisplayName(filePath: string): string {
  return basename(filePath, extname(filePath))
}

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
}

function normalizeRecentEntry(value: unknown): RecentProjectEntry | null {
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<RecentProjectEntry>
  if (typeof candidate.filePath !== 'string' || candidate.filePath.trim().length === 0) return null
  if (!isDateString(candidate.lastOpenedAt)) return null
  return {
    filePath: candidate.filePath,
    displayName:
      typeof candidate.displayName === 'string' && candidate.displayName.trim().length > 0
        ? candidate.displayName
        : recentDisplayName(candidate.filePath),
    lastOpenedAt: candidate.lastOpenedAt
  }
}

async function readRecentEntries(
  locations: WorkspaceStateLocations,
  dependencies: WorkspaceStateDependencies
): Promise<RecentProjectEntry[]> {
  const source = await dependencies.readOptionalFile(locations.recentFilePath)
  if (source === null) return []
  const parsed = JSON.parse(source) as Partial<RecentProjectsFile>
  if (parsed.version !== WORKSPACE_STATE_VERSION || !Array.isArray(parsed.entries)) {
    throw new Error('最近工程记录版本无效')
  }
  const entries = parsed.entries
    .map(normalizeRecentEntry)
    .filter((entry): entry is RecentProjectEntry => entry !== null)
  const available: RecentProjectEntry[] = []
  for (const entry of entries) {
    if (!(await dependencies.fileExists(entry.filePath))) continue
    const metadata = await dependencies.fileMetadata?.(entry.filePath)
    available.push(metadata ? { ...entry, ...metadata } : entry)
  }
  return available.slice(0, RECENT_PROJECT_LIMIT)
}

async function writeRecentEntries(
  entries: RecentProjectEntry[],
  locations: WorkspaceStateLocations,
  dependencies: WorkspaceStateDependencies
): Promise<void> {
  const file: RecentProjectsFile = {
    version: WORKSPACE_STATE_VERSION,
    entries: entries.slice(0, RECENT_PROJECT_LIMIT)
  }
  await dependencies.writeFileAtomic(locations.recentFilePath, `${JSON.stringify(file, null, 2)}\n`)
}

export async function saveRecoverySnapshot(
  request: AutosaveProjectRequest,
  locations: WorkspaceStateLocations,
  dependencies: WorkspaceStateDependencies
): Promise<WorkspaceOperationResult> {
  try {
    const document = parseProjectDocument(JSON.stringify(request.document))
    const recoveryFile: RecoveryFile = {
      version: WORKSPACE_STATE_VERSION,
      capturedAt: dependencies.now().toISOString(),
      currentPath: request.currentPath,
      document
    }
    await dependencies.writeFileAtomic(
      locations.recoveryFilePath,
      `${JSON.stringify(recoveryFile, null, 2)}\n`
    )
    return { status: 'ok' }
  } catch (error) {
    return operationError('无法更新自动恢复副本', error)
  }
}

export async function loadRecoverySnapshot(
  locations: WorkspaceStateLocations,
  dependencies: WorkspaceStateDependencies
): Promise<LoadRecoveryResult> {
  try {
    const source = await dependencies.readOptionalFile(locations.recoveryFilePath)
    if (source === null) return { status: 'empty' }
    const parsed = JSON.parse(source) as Partial<RecoveryFile>
    if (parsed.version !== WORKSPACE_STATE_VERSION) throw new Error('恢复文件版本无效')
    if (!isDateString(parsed.capturedAt)) throw new Error('恢复时间无效')
    if (parsed.currentPath !== null && typeof parsed.currentPath !== 'string') {
      throw new Error('恢复工程路径无效')
    }
    const document = parseProjectDocument(JSON.stringify(parsed.document))
    return {
      status: 'found',
      snapshot: {
        document,
        currentPath: parsed.currentPath ?? null,
        capturedAt: parsed.capturedAt
      }
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误'
    return { status: 'error', message: `无法读取自动恢复副本：${detail}` }
  }
}

export async function clearRecoverySnapshot(
  locations: WorkspaceStateLocations,
  dependencies: WorkspaceStateDependencies
): Promise<WorkspaceOperationResult> {
  try {
    await dependencies.removeOptionalFile(locations.recoveryFilePath)
    return { status: 'ok' }
  } catch (error) {
    return operationError('无法清除自动恢复副本', error)
  }
}

export async function recordRecentProject(
  filePath: string,
  locations: WorkspaceStateLocations,
  dependencies: WorkspaceStateDependencies
): Promise<WorkspaceOperationResult> {
  try {
    const entries = await readRecentEntries(locations, dependencies)
    const normalizedPath = filePath.toLocaleLowerCase()
    const nextEntry: RecentProjectEntry = {
      filePath,
      displayName: recentDisplayName(filePath),
      lastOpenedAt: dependencies.now().toISOString()
    }
    await writeRecentEntries(
      [
        nextEntry,
        ...entries.filter((entry) => entry.filePath.toLocaleLowerCase() !== normalizedPath)
      ],
      locations,
      dependencies
    )
    return { status: 'ok' }
  } catch (error) {
    return operationError('无法更新最近工程记录', error)
  }
}

export async function listRecentProjects(
  locations: WorkspaceStateLocations,
  dependencies: WorkspaceStateDependencies
): Promise<RecentProjectsResult> {
  try {
    const entries = await readRecentEntries(locations, dependencies)
    return { status: 'loaded', entries }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误'
    return { status: 'error', message: `无法读取最近工程记录：${detail}` }
  }
}

export async function removeRecentProject(
  filePath: string,
  locations: WorkspaceStateLocations,
  dependencies: WorkspaceStateDependencies
): Promise<RecentProjectsResult> {
  try {
    const normalizedPath = filePath.toLocaleLowerCase()
    const entries = (await readRecentEntries(locations, dependencies)).filter(
      (entry) => entry.filePath.toLocaleLowerCase() !== normalizedPath
    )
    await writeRecentEntries(entries, locations, dependencies)
    return { status: 'loaded', entries }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误'
    return { status: 'error', message: `无法删除最近工程记录：${detail}` }
  }
}

export async function isRecordedRecentProject(
  filePath: string,
  locations: WorkspaceStateLocations,
  dependencies: WorkspaceStateDependencies
): Promise<boolean> {
  const normalizedPath = filePath.toLocaleLowerCase()
  const entries = await readRecentEntries(locations, dependencies)
  return entries.some((entry) => entry.filePath.toLocaleLowerCase() === normalizedPath)
}
