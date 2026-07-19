import { describe, expect, it, vi } from 'vitest'
import {
  createProjectDocument,
  DEFAULT_LIGHTING,
  DEFAULT_TIMELINE
} from '../shared/project-document'
import {
  clearRecoverySnapshot,
  listRecentProjects,
  loadRecoverySnapshot,
  recordRecentProject,
  removeRecentProject,
  saveRecoverySnapshot,
  type WorkspaceStateDependencies,
  type WorkspaceStateLocations
} from './workspace-state-service'

const locations: WorkspaceStateLocations = {
  recoveryFilePath: 'C:\\UserData\\workspace-state\\recovery.json',
  recentFilePath: 'C:\\UserData\\workspace-state\\recent-projects.json'
}

const project = createProjectDocument({
  name: '恢复测试',
  objects: [],
  camera: {
    position: { x: 7, y: 5, z: 8 },
    target: { x: 0, y: 1, z: 0 },
    fovDegrees: 42,
    aspectWidth: 16,
    aspectHeight: 9
  },
  lighting: DEFAULT_LIGHTING,
  timeline: DEFAULT_TIMELINE
})

function createMemoryDependencies(existingProjects: string[] = []): {
  dependencies: WorkspaceStateDependencies
  files: Map<string, string>
  removeOptionalFile: ReturnType<typeof vi.fn>
  writeFileAtomic: ReturnType<typeof vi.fn>
} {
  const files = new Map<string, string>()
  const projects = new Set(existingProjects.map((filePath) => filePath.toLowerCase()))
  const writeFileAtomic = vi.fn(async (filePath: string, data: string) => {
    files.set(filePath, data)
  })
  const removeOptionalFile = vi.fn(async (filePath: string) => {
    files.delete(filePath)
  })
  return {
    files,
    writeFileAtomic,
    removeOptionalFile,
    dependencies: {
      readOptionalFile: async (filePath) => files.get(filePath) ?? null,
      writeFileAtomic,
      removeOptionalFile,
      fileExists: async (filePath) => projects.has(filePath.toLowerCase()),
      now: () => new Date('2026-07-16T08:30:00.000Z')
    }
  }
}

describe('workspace state service', () => {
  it('overwrites one versioned recovery snapshot and reads it back', async () => {
    const memory = createMemoryDependencies()
    const first = await saveRecoverySnapshot(
      { document: project, currentPath: 'D:\\Scenes\\course.block3d' },
      locations,
      memory.dependencies
    )
    const second = await saveRecoverySnapshot(
      { document: { ...project, name: '第二次恢复' }, currentPath: null },
      locations,
      memory.dependencies
    )
    const loaded = await loadRecoverySnapshot(locations, memory.dependencies)

    expect(first).toEqual({ status: 'ok' })
    expect(second).toEqual({ status: 'ok' })
    expect(memory.writeFileAtomic).toHaveBeenCalledTimes(2)
    expect(memory.files.size).toBe(1)
    expect(loaded.status).toBe('found')
    if (loaded.status === 'found') {
      expect(loaded.snapshot.document.name).toBe('第二次恢复')
      expect(loaded.snapshot.currentPath).toBeNull()
      expect(loaded.snapshot.capturedAt).toBe('2026-07-16T08:30:00.000Z')
    }
  })

  it('reports damaged recovery data instead of applying it', async () => {
    const memory = createMemoryDependencies()
    memory.files.set(locations.recoveryFilePath, '{broken')

    const loaded = await loadRecoverySnapshot(locations, memory.dependencies)

    expect(loaded.status).toBe('error')
    if (loaded.status === 'error') expect(loaded.message).toContain('无法读取自动恢复副本')
  })

  it('clears only the recovery snapshot', async () => {
    const memory = createMemoryDependencies()
    memory.files.set(locations.recoveryFilePath, '{}')
    memory.files.set(locations.recentFilePath, '{}')

    const result = await clearRecoverySnapshot(locations, memory.dependencies)

    expect(result).toEqual({ status: 'ok' })
    expect(memory.files.has(locations.recoveryFilePath)).toBe(false)
    expect(memory.files.has(locations.recentFilePath)).toBe(true)
  })

  it('deduplicates and caps recent projects at eight available files', async () => {
    const projectPaths = Array.from(
      { length: 10 },
      (_, index) => `D:\\Scenes\\scene-${index}.block3d`
    )
    const memory = createMemoryDependencies(projectPaths)

    for (const filePath of projectPaths) {
      await recordRecentProject(filePath, locations, memory.dependencies)
    }
    await recordRecentProject(projectPaths[5], locations, memory.dependencies)
    const result = await listRecentProjects(locations, memory.dependencies)

    expect(result.status).toBe('loaded')
    if (result.status === 'loaded') {
      expect(result.entries).toHaveLength(8)
      expect(result.entries[0].filePath).toBe(projectPaths[5])
      expect(new Set(result.entries.map((entry) => entry.filePath)).size).toBe(8)
    }
  })

  it('removes a recent record without deleting the project file', async () => {
    const filePath = 'D:\\Scenes\\keep-me.block3d'
    const memory = createMemoryDependencies([filePath])
    await recordRecentProject(filePath, locations, memory.dependencies)

    const result = await removeRecentProject(filePath, locations, memory.dependencies)

    expect(result).toEqual({ status: 'loaded', entries: [] })
    expect(memory.removeOptionalFile).not.toHaveBeenCalled()
  })

  it('hides missing files from the recent project list', async () => {
    const existingPath = 'D:\\Scenes\\existing.block3d'
    const missingPath = 'D:\\Scenes\\missing.block3d'
    const memory = createMemoryDependencies([existingPath, missingPath])
    await recordRecentProject(existingPath, locations, memory.dependencies)
    await recordRecentProject(missingPath, locations, memory.dependencies)
    memory.dependencies.fileExists = async (filePath) => filePath === existingPath

    const result = await listRecentProjects(locations, memory.dependencies)

    expect(result).toEqual({
      status: 'loaded',
      entries: [expect.objectContaining({ filePath: existingPath })]
    })
  })

  it('adds local file size and modification time without changing the stored record', async () => {
    const filePath = 'D:\\Scenes\\metadata.block3d'
    const memory = createMemoryDependencies([filePath])
    memory.dependencies.fileMetadata = async () => ({
      fileSizeBytes: 4096,
      modifiedAt: '2026-07-18T06:00:00.000Z'
    })
    await recordRecentProject(filePath, locations, memory.dependencies)

    const result = await listRecentProjects(locations, memory.dependencies)

    expect(result).toEqual({
      status: 'loaded',
      entries: [
        expect.objectContaining({
          filePath,
          fileSizeBytes: 4096,
          modifiedAt: '2026-07-18T06:00:00.000Z'
        })
      ]
    })
  })
})
