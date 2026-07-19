import { describe, expect, it, vi } from 'vitest'
import {
  createProjectDocument,
  DEFAULT_LIGHTING,
  DEFAULT_TIMELINE
} from '../shared/project-document'
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
  type ProjectFileServiceDependencies
} from './project-file-service'

function createDependencies(
  overrides: Partial<ProjectFileServiceDependencies> = {}
): ProjectFileServiceDependencies {
  return {
    showSaveDialog: vi.fn().mockResolvedValue({ canceled: true }),
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    writeFileAtomic: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(''),
    makeDirectory: vi.fn().mockResolvedValue(undefined),
    now: () => new Date('2026-07-16T01:02:03.000Z'),
    ...overrides
  }
}

const project = createProjectDocument({
  name: '测试场景',
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

describe('project file service', () => {
  it('leaves files untouched when save is cancelled', async () => {
    const dependencies = createDependencies()
    const result = await saveProjectFile({ document: project, saveAs: true }, dependencies)

    expect(result.status).toBe('cancelled')
    expect(dependencies.writeFile).not.toHaveBeenCalled()
  })

  it('updates the current project without reopening the dialog', async () => {
    const dependencies = createDependencies()
    const result = await saveProjectFile(
      { document: project, saveAs: false, currentPath: 'D:\\Scenes\\test.block3d' },
      dependencies
    )

    expect(result).toEqual({
      status: 'saved',
      filePath: 'D:\\Scenes\\test.block3d',
      displayName: 'test'
    })
    expect(dependencies.showSaveDialog).not.toHaveBeenCalled()
    expect(dependencies.writeFileAtomic).toHaveBeenCalledOnce()
  })

  it('reports write failures without claiming success', async () => {
    const dependencies = createDependencies({
      writeFileAtomic: vi.fn().mockRejectedValue(new Error('access denied'))
    })
    const result = await saveProjectFile(
      { document: project, saveAs: false, currentPath: 'D:\\Locked\\test.block3d' },
      dependencies
    )

    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.message).toContain('无法保存工程')
  })

  it('rejects a damaged project selected by the user', async () => {
    const dependencies = createDependencies({
      showOpenDialog: vi
        .fn()
        .mockResolvedValue({ canceled: false, filePaths: ['D:\\Scenes\\broken.block3d'] }),
      readFile: vi.fn().mockResolvedValue('{broken')
    })
    const result = await openProjectFile(dependencies)

    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.message).toContain('工程文件无法读取')
  })

  it('opens a validated project directly from a known recent path', async () => {
    const dependencies = createDependencies({
      readFile: vi.fn().mockResolvedValue(JSON.stringify(project))
    })

    const result = await openProjectAtPath('D:\\Scenes\\known.block3d', dependencies)

    expect(result.status).toBe('opened')
    if (result.status === 'opened') {
      expect(result.displayName).toBe('known')
      expect(result.document.schemaVersion).toBe(project.schemaVersion)
    }
    expect(dependencies.showOpenDialog).not.toHaveBeenCalled()
  })

  it('does not create an image when export is cancelled', async () => {
    const dependencies = createDependencies()
    const result = await savePngFile(
      { base64Data: Buffer.from('png').toString('base64'), suggestedName: '场景.png' },
      dependencies
    )

    expect(result.status).toBe('cancelled')
    expect(dependencies.writeFile).not.toHaveBeenCalled()
  })

  it('uses a JPG filename and filter when the user chooses compressed image export', async () => {
    const dependencies = createDependencies({
      showSaveDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePath: 'D:\\Exports\\课堂场景.jpg'
      })
    })
    const result = await savePngFile(
      {
        base64Data: Buffer.from('jpeg').toString('base64'),
        suggestedName: '课堂场景.jpg',
        format: 'jpg'
      },
      dependencies
    )

    expect(result.status).toBe('saved')
    expect(dependencies.showSaveDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '导出摄影机画面',
        filters: [{ name: 'JPG 图片', extensions: ['jpg'] }]
      })
    )
    expect(dependencies.writeFile).toHaveBeenCalledWith(
      'D:\\Exports\\课堂场景.jpg',
      expect.any(Buffer)
    )
  })

  it('writes the six control images into one selected directory', async () => {
    const dependencies = createDependencies({
      showOpenDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePaths: ['D:\\Exports']
      })
    })
    const base64Data = Buffer.from('png').toString('base64')
    const result = await saveImageBundle(
      {
        suggestedBaseName: '课堂:场景',
        images: [
          { kind: 'white', base64Data },
          { kind: 'depth', base64Data },
          { kind: 'normal', base64Data },
          { kind: 'objectId', base64Data },
          { kind: 'mask', base64Data },
          { kind: 'outline', base64Data }
        ]
      },
      dependencies
    )

    expect(result.status).toBe('saved')
    expect(dependencies.writeFile).toHaveBeenCalledTimes(6)
    expect(dependencies.writeFile).toHaveBeenCalledWith(
      'D:\\Exports\\课堂_场景_深度.png',
      expect.any(Buffer)
    )
  })

  it('does not write partial reference images when directory selection is cancelled', async () => {
    const dependencies = createDependencies()
    const base64Data = Buffer.from('png').toString('base64')
    const result = await saveImageBundle(
      {
        suggestedBaseName: '场景',
        images: [
          { kind: 'white', base64Data },
          { kind: 'depth', base64Data },
          { kind: 'normal', base64Data },
          { kind: 'objectId', base64Data },
          { kind: 'mask', base64Data },
          { kind: 'outline', base64Data }
        ]
      },
      dependencies
    )

    expect(result.status).toBe('cancelled')
    expect(dependencies.writeFile).not.toHaveBeenCalled()
  })

  it('rejects a reference image bundle with duplicated channels', async () => {
    const dependencies = createDependencies()
    const base64Data = Buffer.from('png').toString('base64')
    const result = await saveImageBundle(
      {
        suggestedBaseName: '场景',
        images: [
          { kind: 'white', base64Data },
          { kind: 'white', base64Data },
          { kind: 'normal', base64Data },
          { kind: 'objectId', base64Data },
          { kind: 'mask', base64Data },
          { kind: 'outline', base64Data }
        ]
      },
      dependencies
    )

    expect(result.status).toBe('error')
    expect(dependencies.showOpenDialog).not.toHaveBeenCalled()
    expect(dependencies.writeFile).not.toHaveBeenCalled()
  })

  it('writes a GLB model only after the user selects a destination', async () => {
    const dependencies = createDependencies({
      showSaveDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePath: 'D:\\Exports\\scene.glb'
      })
    })
    const data = new Uint8Array([0x67, 0x6c, 0x54, 0x46])
    const result = await saveModelFile(
      { format: 'glb', data, suggestedName: 'scene' },
      dependencies
    )

    expect(result).toEqual({
      status: 'saved',
      filePath: 'D:\\Exports\\scene.glb',
      displayName: 'scene.glb'
    })
    expect(dependencies.writeFile).toHaveBeenCalledWith('D:\\Exports\\scene.glb', data)
  })

  it('does not write a model when export is cancelled or the data is empty', async () => {
    const cancelledDependencies = createDependencies()
    expect(
      await saveModelFile(
        { format: 'obj', data: 'v 0 0 0', suggestedName: 'scene' },
        cancelledDependencies
      )
    ).toEqual({ status: 'cancelled' })
    expect(cancelledDependencies.writeFile).not.toHaveBeenCalled()

    const emptyDependencies = createDependencies()
    const empty = await saveModelFile(
      { format: 'gltf', data: '', suggestedName: 'scene' },
      emptyDependencies
    )
    expect(empty.status).toBe('error')
    expect(emptyDependencies.showSaveDialog).not.toHaveBeenCalled()
    expect(emptyDependencies.writeFile).not.toHaveBeenCalled()
  })

  it('streams a complete image sequence into an isolated timestamped directory', async () => {
    const dependencies = createDependencies({
      showOpenDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePaths: ['D:\\Exports']
      })
    })
    const started = await beginImageSequence(
      {
        suggestedBaseName: '课堂:运镜',
        frameRate: 30,
        totalFrames: 2,
        width: 1280,
        height: 720
      },
      dependencies
    )
    expect(started.status).toBe('opened')
    if (started.status !== 'opened') return
    expect(started.session.directoryPath).toBe('D:\\Exports\\课堂_运镜_动画帧_20260716-010203')
    expect(dependencies.makeDirectory).toHaveBeenCalledWith(started.session.directoryPath)

    const png = Buffer.from('png').toString('base64')
    expect((await writeImageSequenceFrame(started.session, 0, png, dependencies)).status).toBe(
      'saved'
    )
    expect((await writeImageSequenceFrame(started.session, 1, png, dependencies)).status).toBe(
      'saved'
    )
    const finished = await finishImageSequence(started.session, dependencies)
    expect(finished).toEqual({
      status: 'saved',
      directoryPath: started.session.directoryPath,
      fileCount: 2
    })
    expect(dependencies.writeFile).toHaveBeenCalledWith(
      `${started.session.directoryPath}\\课堂_运镜_000001.png`,
      expect.any(Buffer)
    )
    expect(dependencies.writeFile).toHaveBeenCalledWith(
      `${started.session.directoryPath}\\课堂_运镜_动画帧.json`,
      expect.stringContaining('"complete": true'),
      'utf8'
    )
  })

  it('keeps partial frames and writes an incomplete manifest when export is cancelled', async () => {
    const dependencies = createDependencies({
      showOpenDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePaths: ['D:\\Exports']
      })
    })
    const started = await beginImageSequence(
      {
        suggestedBaseName: '场景',
        frameRate: 24,
        totalFrames: 3,
        width: 640,
        height: 640
      },
      dependencies
    )
    if (started.status !== 'opened') throw new Error('Sequence did not start')
    await writeImageSequenceFrame(
      started.session,
      0,
      Buffer.from('png').toString('base64'),
      dependencies
    )
    expect((await finishImageSequence(started.session, dependencies)).status).toBe('error')
    const cancelled = await cancelImageSequence(started.session, dependencies)
    expect(cancelled.status).toBe('cancelled')
    expect(dependencies.writeFile).toHaveBeenCalledWith(
      expect.stringContaining('场景_动画帧.json'),
      expect.stringContaining('"complete": false'),
      'utf8'
    )
  })
})
