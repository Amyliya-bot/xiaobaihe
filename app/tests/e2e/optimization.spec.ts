import { expect, test, type ElectronApplication } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { launchIsolatedElectron } from './launch-app'

async function forceCloseElectron(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  await electronApp.close().catch(() => undefined)
}

function writeMeshGltf(filePath: string, positions: Float32Array, indices: Uint32Array): void {
  const positionBytes = Buffer.from(positions.buffer)
  const indexBytes = Buffer.from(indices.buffer)
  const binary = Buffer.concat([positionBytes, indexBytes])
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let minZ = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let maxZ = Number.NEGATIVE_INFINITY
  for (let index = 0; index < positions.length; index += 3) {
    minX = Math.min(minX, positions[index])
    minY = Math.min(minY, positions[index + 1])
    minZ = Math.min(minZ, positions[index + 2])
    maxX = Math.max(maxX, positions[index])
    maxY = Math.max(maxY, positions[index + 1])
    maxZ = Math.max(maxZ, positions[index + 2])
  }
  writeFileSync(
    filePath,
    JSON.stringify({
      asset: { version: '2.0', generator: 'Xiaobaihe optimization E2E' },
      buffers: [
        {
          byteLength: binary.byteLength,
          uri: `data:application/octet-stream;base64,${binary.toString('base64')}`
        }
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: positionBytes.byteLength, target: 34962 },
        {
          buffer: 0,
          byteOffset: positionBytes.byteLength,
          byteLength: indexBytes.byteLength,
          target: 34963
        }
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: positions.length / 3,
          type: 'VEC3',
          min: [minX, minY, minZ],
          max: [maxX, maxY, maxZ]
        },
        { bufferView: 1, componentType: 5125, count: indices.length, type: 'SCALAR' }
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
      nodes: [{ mesh: 0 }],
      scenes: [{ nodes: [0] }],
      scene: 0
    })
  )
}

function writeRiskFixture(filePath: string): void {
  const positions = new Float32Array([-1, 0, 0, 1, 0, 0, 0, 2, 0])
  const indices = new Uint32Array(250_000 * 3)
  for (let index = 0; index < indices.length; index += 3) {
    indices[index] = 0
    indices[index + 1] = 1
    indices[index + 2] = 2
  }
  writeMeshGltf(filePath, positions, indices)
}

function writeGridFixture(filePath: string, segments = 22): void {
  const positions: number[] = []
  const indices: number[] = []
  for (let z = 0; z <= segments; z += 1) {
    for (let x = 0; x <= segments; x += 1) {
      const px = (x / segments - 0.5) * 4
      const pz = (z / segments - 0.5) * 4
      positions.push(px, Math.sin(px * 1.7) * Math.cos(pz * 1.3) * 0.3, pz)
    }
  }
  for (let z = 0; z < segments; z += 1) {
    for (let x = 0; x < segments; x += 1) {
      const first = z * (segments + 1) + x
      const next = first + segments + 1
      indices.push(first, next, first + 1, first + 1, next, next + 1)
    }
  }
  writeMeshGltf(filePath, new Float32Array(positions), new Uint32Array(indices))
}

test('warns about a complex model but allows the untouched original', async () => {
  test.setTimeout(60_000)
  const directory = resolve(process.cwd(), 'test-results', 'optimization-risk')
  const modelPath = resolve(directory, '高面模型.gltf')
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(directory, { recursive: true })
  writeRiskFixture(modelPath)
  const electronApp = await launchIsolatedElectron()
  try {
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [filePath] })
    }, modelPath)
    const window = await electronApp.firstWindow()
    await window.setViewportSize({ width: 1440, height: 900 })
    await expect(window.locator('canvas[data-scene-ready="true"]')).toBeVisible({ timeout: 15_000 })
    await window.getByRole('button', { name: '导入本地模型' }).click()
    const dialog = window.getByRole('dialog', { name: '这个模型编辑时可能不够流畅' })
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog).toContainText('250,000 个三角面')
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-11-performance-risk-1440x900.png'),
      animations: 'disabled'
    })
    await dialog.getByRole('button', { name: '继续使用原模型' }).click()
    await expect(window.getByRole('group', { name: '编辑预览精度' })).toBeVisible()
  } finally {
    await forceCloseElectron(electronApp)
  }
})

test('keeps lightweight preview reversible and export precision explicit', async () => {
  test.setTimeout(60_000)
  const directory = resolve(process.cwd(), 'test-results', 'optimization-reversible')
  const modelPath = resolve(directory, '起伏地形.gltf')
  const projectPath = resolve(directory, '轻量预览.block3d')
  const originalPngPath = resolve(directory, '原始精度.png')
  const lightweightPngPath = resolve(directory, '轻量精度.png')
  rmSync(directory, { recursive: true, force: true })
  mkdirSync(directory, { recursive: true })
  writeGridFixture(modelPath)
  const electronApp = await launchIsolatedElectron()
  try {
    await electronApp.evaluate(
      ({ dialog }, paths) => {
        let pngCount = 0
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths.modelPath] })
        dialog.showSaveDialog = async (_windowOrOptions, maybeOptions) => {
          const options = maybeOptions ?? _windowOrOptions
          if (options.filters?.some((filter) => filter.extensions.includes('png'))) {
            pngCount += 1
            return {
              canceled: false,
              filePath: pngCount === 1 ? paths.originalPngPath : paths.lightweightPngPath
            }
          }
          return { canceled: false, filePath: paths.projectPath }
        }
      },
      { modelPath, projectPath, originalPngPath, lightweightPngPath }
    )
    const window = await electronApp.firstWindow()
    await window.setViewportSize({ width: 1280, height: 720 })
    await expect(window.locator('canvas[data-scene-ready="true"]')).toBeVisible({ timeout: 15_000 })
    await window.getByRole('button', { name: '导入本地模型' }).click()

    const previewGroup = window.getByRole('group', { name: '编辑预览精度' })
    const exportGroup = window.getByRole('group', { name: '最终导出精度' })
    await previewGroup.getByRole('button', { name: '轻量' }).click()
    await expect(window.locator('.optimization-result')).toContainText('→', { timeout: 15_000 })
    await window.getByRole('button', { name: '切换到黑色主题' }).click()
    await window.screenshot({
      path: resolve(
        process.cwd(),
        '..',
        'artifacts',
        'stage-11-lightweight-preview-dark-1280x720.png'
      ),
      animations: 'disabled'
    })

    await exportGroup.getByRole('button', { name: '原始' }).click()
    await window.getByRole('button', { name: '导出图片、视频或三维模型' }).click()
    await window.getByRole('button', { name: '导出摄影机画面为 PNG' }).click()
    await exportGroup.getByRole('button', { name: '轻量' }).click()
    await window.getByRole('button', { name: '导出图片、视频或三维模型' }).click()
    await window.getByRole('button', { name: '导出摄影机画面为 PNG' }).click()
    expect(readFileSync(originalPngPath).equals(readFileSync(lightweightPngPath))).toBe(false)

    await previewGroup.getByRole('button', { name: '原始' }).click()
    await window.getByRole('button', { name: '撤销' }).click()
    await expect(previewGroup.getByRole('button', { name: '轻量' })).toHaveClass(/is-active/)
    await window.getByRole('button', { name: '保存项目' }).click()
    await expect(window.getByRole('status')).toContainText('工程已保存')
    await expect.poll(() => existsSync(projectPath)).toBe(true)
    const saved = JSON.parse(readFileSync(projectPath, 'utf8')) as {
      schemaVersion: number
      scene: { objects: Array<{ previewQuality?: string; exportQuality?: string }> }
    }
    expect(saved.schemaVersion).toBe(12)
    expect(saved.scene.objects[0]).toMatchObject({
      previewQuality: 'lightweight',
      exportQuality: 'lightweight'
    })
  } finally {
    await forceCloseElectron(electronApp)
  }
})
