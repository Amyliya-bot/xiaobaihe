import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { PerspectiveCamera, Vector3 } from 'three'
import { launchIsolatedElectron } from './launch-app'

function writeCameraLightGltf(filePath: string): void {
  const positions = Buffer.alloc(36)
  ;[
    [-0.8, 0, 0],
    [0.8, 0, 0],
    [0, 1.4, 0]
  ].forEach((position, vertexIndex) => {
    position.forEach((value, axisIndex) =>
      positions.writeFloatLE(value, vertexIndex * 12 + axisIndex * 4)
    )
  })
  const indices = Buffer.alloc(8)
  indices.writeUInt16LE(0, 0)
  indices.writeUInt16LE(1, 2)
  indices.writeUInt16LE(2, 4)
  const binary = Buffer.concat([positions, indices])
  writeFileSync(
    filePath,
    JSON.stringify({
      asset: { version: '2.0', generator: 'Xiaobaihe E2E' },
      extensionsUsed: ['KHR_lights_punctual'],
      extensions: {
        KHR_lights_punctual: {
          lights: [{ type: 'directional', color: [1, 0.92, 0.8], intensity: 1.5 }]
        }
      },
      buffers: [
        {
          byteLength: binary.byteLength,
          uri: `data:application/octet-stream;base64,${binary.toString('base64')}`
        }
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 36, target: 34962 },
        { buffer: 0, byteOffset: 36, byteLength: 6, target: 34963 }
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: 3,
          type: 'VEC3',
          min: [-0.8, 0, 0],
          max: [0.8, 1.4, 0]
        },
        { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' }
      ],
      materials: [
        { name: '测试材质', pbrMetallicRoughness: { baseColorFactor: [0.7, 0.75, 0.8, 1] } }
      ],
      meshes: [
        { name: '测试模型', primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }
      ],
      cameras: [{ type: 'perspective', perspective: { yfov: 0.72, znear: 0.1, zfar: 100 } }],
      nodes: [
        { mesh: 0 },
        {
          camera: 0,
          translation: [0, 4, 8],
          rotation: [-0.174108, 0, 0, 0.984727]
        },
        {
          translation: [4, 7, 3],
          extensions: { KHR_lights_punctual: { light: 0 } }
        }
      ],
      scenes: [{ nodes: [0, 1, 2] }],
      scene: 0
    })
  )
}

function pngDimensions(buffer: Buffer): { width: number; height: number } {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

test('completes the stage 2 direct-manipulation and local file loop', async () => {
  test.setTimeout(60_000)
  const outputDirectory = resolve(process.cwd(), 'test-results', 'stage-2-loop')
  const projectPath = resolve(outputDirectory, '课堂场景.block3d')
  const pngPath = resolve(outputDirectory, '课堂场景.png')
  rmSync(outputDirectory, { recursive: true, force: true })
  mkdirSync(outputDirectory, { recursive: true })

  const electronApp = await launchIsolatedElectron()

  try {
    await electronApp.evaluate(
      ({ dialog }, paths) => {
        dialog.showSaveDialog = async (_browserWindowOrOptions, maybeOptions) => {
          const options = maybeOptions ?? _browserWindowOrOptions
          const isPng = options.filters?.some((filter) => filter.extensions.includes('png'))
          return { canceled: false, filePath: isPng ? paths.pngPath : paths.projectPath }
        }
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [paths.projectPath]
        })
      },
      { projectPath, pngPath }
    )

    const window = await electronApp.firstWindow()
    const pageErrors: string[] = []
    window.on('pageerror', (error) => pageErrors.push(error.message))

    await expect(window).toHaveTitle('小白盒')
    const externalRequestSucceeded = await window.evaluate(async () => {
      try {
        await fetch('https://example.com', { mode: 'no-cors' })
        return true
      } catch {
        return false
      }
    })
    expect(externalRequestSucceeded).toBe(false)
    await expect(window.getByLabel('顶部命令栏')).toBeVisible({ timeout: 15_000 })
    await expect(window.getByLabel('场景对象')).toBeVisible()
    await expect(window.getByLabel('三维场景')).toBeVisible()
    await expect(window.getByLabel('属性面板')).toBeVisible()
    await expect(window.getByLabel('动画时间轴')).toBeVisible()
    await expect(window.locator('canvas[data-scene-ready="true"]')).toBeVisible()
    await expect(window.locator('canvas[data-origin-marker="true"]')).toBeVisible()
    await expect(window.locator('canvas')).toHaveAttribute(
      'data-camera-controls',
      'left-pan-middle-orbit-right-marquee'
    )
    await expect(window.locator('canvas')).toHaveAttribute(
      'data-grid-mode',
      'camera-following-infinite'
    )
    await expect(window.locator('canvas')).toHaveAttribute('data-grid-triangles', '2')

    if ((await window.locator('html').getAttribute('data-theme')) === 'dark') {
      await window.getByRole('button', { name: '切换到白色主题' }).click()
    }

    await expect(window.getByText('0 个模型')).toBeVisible()
    await expect(window.locator('.local-state')).toContainText('未保存到文件')
    await window.setViewportSize({ width: 1440, height: 900 })
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-2-empty-center-1440x900.png'),
      animations: 'disabled'
    })

    await window.getByRole('button', { name: '添加方块' }).click()
    await expect(window.getByLabel('位置 X')).toHaveValue('0.00')
    await window.getByLabel('位置 X').fill('-3')
    await window.getByLabel('位置 X').press('Enter')

    await window.getByRole('button', { name: '添加圆柱' }).click()
    await expect(window.getByLabel('位置 X')).not.toHaveValue('-3.00')
    await expect(window.getByLabel('位置 Z')).toHaveValue('0.00')
    await window.getByLabel('位置 X').fill('3.5')
    await window.getByLabel('位置 X').press('Enter')

    await window.getByRole('button', { name: '添加球体' }).click()
    await expect(window.getByLabel('位置 X')).not.toHaveValue('0.00')
    await expect(window.getByLabel('位置 Z')).toHaveValue('0.00')
    await window.getByLabel('位置 X').fill('0')
    await window.getByLabel('位置 X').press('Enter')
    await expect(window.getByText('3 个模型')).toBeVisible()
    await window.getByRole('button', { name: '选择 圆柱 01', exact: true }).click()

    const positionX = window.getByLabel('位置 X')
    await expect(positionX).toHaveValue('3.50')

    await window.getByRole('button', { name: '拉伸', exact: true }).click()
    await expect(window.getByRole('button', { name: '拉伸', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true'
    )
    await expect(window.locator('canvas')).toHaveAttribute('data-stretch-handles', '6')
    await window.getByRole('button', { name: '选择 圆柱 01' }).click({ button: 'right' })
    await expect(window.getByRole('menu', { name: '圆柱 01 操作菜单' })).toBeVisible()
    await window.getByRole('menuitem', { name: '复制对象' }).click()
    await expect(window.getByRole('button', { name: '选择 圆柱 01 副本' })).toBeVisible()

    await window.getByRole('button', { name: '撤销' }).click()
    await expect(window.getByRole('button', { name: '选择 圆柱 01 副本' })).toHaveCount(0)
    await window.getByRole('button', { name: '重做' }).click()
    await expect(window.getByRole('button', { name: '选择 圆柱 01 副本' })).toBeVisible()

    await window.getByRole('button', { name: '选择 圆柱 01 副本' }).click()
    await window.getByRole('button', { name: '锁定 圆柱 01 副本' }).click()
    await expect(window.getByRole('button', { name: '解锁 圆柱 01 副本' })).toBeVisible()
    await expect(window.getByRole('button', { name: '已锁定，点击解锁' })).toBeVisible()
    await window.getByRole('button', { name: '隐藏 圆柱 01 副本' }).click()
    await expect(window.getByRole('button', { name: '显示 圆柱 01 副本' })).toBeVisible()
    await window.getByRole('button', { name: '显示 圆柱 01 副本' }).click()

    await window.getByRole('button', { name: '选择 球体 01' }).click()
    await expect(window.getByRole('button', { name: '删除这个对象' })).toHaveCount(0)
    await window.getByRole('button', { name: '选择 球体 01' }).click({ button: 'right' })
    await window.getByRole('menuitemradio', { name: '半透明显示' }).click()
    await expect(window.locator('canvas')).toHaveAttribute(
      'data-selected-display-mode',
      'transparent'
    )
    await window.getByRole('button', { name: '选择 球体 01' }).click({ button: 'right' })
    await window.getByRole('menuitem', { name: '删除对象' }).click()
    await expect(window.getByRole('button', { name: '选择 球体 01' })).toHaveCount(0)
    await window.getByRole('button', { name: '撤销' }).click()
    await expect(window.getByRole('button', { name: '选择 球体 01' })).toBeVisible()

    await window.getByRole('button', { name: '新建项目' }).click()
    await expect(window.getByRole('dialog', { name: '保存当前更改吗？' })).toBeVisible()
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'editor-audit-unsaved-dialog-1440x900.png'),
      animations: 'disabled'
    })
    await window.getByRole('button', { name: '取消', exact: true }).click()
    await expect(window.getByRole('button', { name: '选择 球体 01' })).toBeVisible()

    await window.keyboard.press('Control+S')
    await expect(window.getByRole('status')).toContainText('工程已保存')
    expect(existsSync(projectPath)).toBe(true)
    const savedProject = JSON.parse(readFileSync(projectPath, 'utf8')) as {
      schemaVersion: number
      scene: { objects: Array<{ name: string; displayMode?: string }> }
    }
    expect(savedProject.schemaVersion).toBe(12)
    expect(savedProject.scene.objects).toHaveLength(4)
    expect(
      savedProject.scene.objects.find((object) => object.name === '球体 01')?.displayMode
    ).toBe('transparent')

    await window.getByRole('button', { name: '新建项目' }).click()
    await expect(window.getByText('0 个模型')).toBeVisible()
    await expect(window.locator('.local-state')).toContainText('未保存到文件')
    await window.getByRole('button', { name: '打开项目' }).click()
    await expect(window.getByRole('status')).toContainText('已打开')
    await expect(window.getByRole('button', { name: '选择 圆柱 01 副本' })).toBeVisible()
    await expect(window.locator('.local-state')).toContainText('已保存')

    await window.getByRole('button', { name: '导出图片、视频或三维模型' }).click()
    await window.getByRole('button', { name: '导出摄影机画面为 PNG' }).click()
    await expect(window.getByRole('status')).toContainText('图片已导出')
    expect(existsSync(pngPath)).toBe(true)
    const png = readFileSync(pngPath)
    expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10])
    expect(png.byteLength).toBeGreaterThan(10_000)

    await window.getByRole('button', { name: '移动', exact: true }).click()
    await window.getByRole('button', { name: '选择 圆柱 01', exact: true }).click()
    await window.getByRole('button', { name: '聚焦查看 圆柱 01' }).click()
    await expect(window.getByRole('status')).toContainText('已聚焦查看：圆柱 01')
    await expect(window.locator('canvas')).toHaveAttribute('data-focus-scope', 'object')
    const cylinderTarget = JSON.parse(
      (await window.locator('canvas').getAttribute('data-camera-target')) ?? '{}'
    ) as { x: number; y: number; z: number }
    expect(cylinderTarget.x).toBeCloseTo(3.5)
    expect(cylinderTarget.y).toBeCloseTo(1.2)
    await window.setViewportSize({ width: 1440, height: 900 })
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-2-focus-selected-light-1440x900.png'),
      animations: 'disabled'
    })

    const canvasBounds = await window.locator('canvas[data-scene-ready="true"]').boundingBox()
    if (!canvasBounds) throw new Error('Three.js canvas has no visible bounds')
    await window.mouse.click(
      canvasBounds.x + canvasBounds.width * 0.5,
      canvasBounds.y + canvasBounds.height * 0.5,
      { button: 'right' }
    )
    await expect(window.getByRole('menu')).toBeVisible()
    await window.keyboard.press('Escape')
    await window.mouse.click(
      canvasBounds.x + canvasBounds.width * 0.9,
      canvasBounds.y + canvasBounds.height * 0.12
    )
    await expect(window.getByText('没有选中对象')).toBeVisible()

    const startX = canvasBounds.x + canvasBounds.width * 0.5
    const startY = canvasBounds.y + canvasBounds.height * 0.5
    const cameraBeforePan = await window.locator('canvas').getAttribute('data-camera-position')
    await window.mouse.move(startX, startY)
    await window.mouse.down()
    await window.mouse.move(startX + 70, startY + 30, { steps: 8 })
    await window.mouse.up()
    await expect(window.getByText('没有选中对象')).toBeVisible()
    await expect(window.locator('canvas')).toHaveAttribute(
      'data-grid-mode',
      'camera-following-infinite'
    )
    await expect(window.locator('.local-state')).toContainText('已保存')
    await expect(window.locator('canvas')).not.toHaveAttribute(
      'data-camera-position',
      cameraBeforePan ?? ''
    )
    await window.getByRole('button', { name: '查看全部对象' }).click()
    await expect(window.getByRole('status')).toContainText('已显示全部可见对象')
    await expect(window.locator('canvas')).toHaveAttribute('data-focus-scope', 'scene')

    await window.mouse.move(startX, startY)
    await window.mouse.down({ button: 'middle' })
    await window.mouse.move(startX + 55, startY + 65, { steps: 8 })
    await window.mouse.up({ button: 'middle' })
    await expect(window.locator('.local-state')).toContainText('已保存')
    await window.getByRole('button', { name: '查看全部对象' }).click()
    await expect(window.locator('canvas')).toHaveAttribute('data-focus-scope', 'scene')

    await window.getByRole('button', { name: '选择 球体 01' }).click()
    await window.getByRole('button', { name: '选择 球体 01' }).click({ button: 'right' })
    await window.getByRole('menuitem', { name: '聚焦查看' }).click()
    await expect(window.getByRole('status')).toContainText('已聚焦查看：球体 01')
    await expect(window.locator('canvas')).toHaveAttribute('data-focus-scope', 'object')
    await window.getByRole('button', { name: '拉伸', exact: true }).click()
    await expect(window.locator('canvas')).toHaveAttribute('data-stretch-handles', '6')

    await window.setViewportSize({ width: 1440, height: 900 })
    const stretchCanvasBounds = await window.locator('canvas').boundingBox()
    if (!stretchCanvasBounds) throw new Error('Stretch canvas has no visible bounds')
    const projectionCamera = new PerspectiveCamera(
      42,
      stretchCanvasBounds.width / stretchCanvasBounds.height,
      0.1,
      180
    )
    const focusedCameraPosition = JSON.parse(
      (await window.locator('canvas').getAttribute('data-camera-position')) ?? '{}'
    ) as { x: number; y: number; z: number }
    const focusedCameraTarget = JSON.parse(
      (await window.locator('canvas').getAttribute('data-camera-target')) ?? '{}'
    ) as { x: number; y: number; z: number }
    projectionCamera.position.set(
      focusedCameraPosition.x,
      focusedCameraPosition.y,
      focusedCameraPosition.z
    )
    projectionCamera.lookAt(focusedCameraTarget.x, focusedCameraTarget.y, focusedCameraTarget.z)
    projectionCamera.updateProjectionMatrix()
    projectionCamera.updateMatrixWorld()
    const projectToScreen = (point: Vector3): { x: number; y: number } => {
      const projected = point.clone().project(projectionCamera)
      return {
        x: stretchCanvasBounds.x + ((projected.x + 1) / 2) * stretchCanvasBounds.width,
        y: stretchCanvasBounds.y + ((1 - projected.y) / 2) * stretchCanvasBounds.height
      }
    }
    const topHandle = projectToScreen(new Vector3(0, 2, 0))
    const stretchedTop = projectToScreen(new Vector3(0, 2.8, 0))
    await window.mouse.move(topHandle.x, topHandle.y)
    await window.mouse.down()
    await window.mouse.move(stretchedTop.x, stretchedTop.y, { steps: 10 })
    await window.mouse.up()
    await expect(window.getByLabel('大小 Y')).not.toHaveValue('2.00')
    await window.getByRole('button', { name: '撤销' }).click()
    await expect(window.getByLabel('大小 Y')).toHaveValue('2.00')

    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-2-usability-light-1440x900.png'),
      animations: 'disabled'
    })

    await window.getByRole('button', { name: '选择 球体 01' }).click({ button: 'right' })
    await expect(window.getByRole('menu', { name: '球体 01 操作菜单' })).toBeVisible()
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-2-layer-menu-light-1440x900.png'),
      animations: 'disabled'
    })
    await window.keyboard.press('Escape')

    await window.getByRole('button', { name: '切换到黑色主题' }).click()
    await window.getByRole('button', { name: '动画时间轴' }).click()
    await expect(window.getByText('摄影机镜头')).toBeVisible()
    await window.setViewportSize({ width: 1280, height: 720 })
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-2-usability-dark-1280x720.png'),
      animations: 'disabled'
    })

    await window.setViewportSize({ width: 1080, height: 680 })
    const hasHorizontalOverflow = await window.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth
    )
    expect(hasHorizontalOverflow).toBe(false)
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'editor-audit-dark-1080x680.png'),
      animations: 'disabled'
    })

    const security = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const mainWindow = BrowserWindow.getAllWindows()[0]
      return mainWindow.webContents.getLastWebPreferences()
    })

    expect(security.contextIsolation).toBe(true)
    expect(security.nodeIntegration).toBe(false)
    expect(security.sandbox).toBe(true)
    expect(pageErrors).toEqual([])

    await window.getByLabel('位置 X').fill('0.25')
    await window.getByLabel('位置 X').press('Enter')
    await expect(window.locator('.local-state')).toContainText('有未保存更改')
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await expect(window.getByRole('dialog', { name: '保存当前更改吗？' })).toBeVisible()
    await window.getByRole('button', { name: '取消', exact: true }).click()
    await expect(window.locator('canvas[data-scene-ready="true"]')).toBeVisible()
    await window.keyboard.press('Control+S')
    await expect(window.locator('.local-state')).toContainText('已保存')
    await window.getByLabel('位置 X').fill('0.5')
    await window.getByLabel('位置 X').press('Enter')
    await expect(window.locator('.local-state')).toContainText('有未保存更改')
    await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await expect(window.getByRole('dialog', { name: '保存当前更改吗？' })).toBeVisible()
    const windowClosed = window.waitForEvent('close')
    await window.getByRole('button', { name: '保存并继续' }).click()
    await windowClosed
  } finally {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    await electronApp.close()
  }
})

test('completes multi-layout, custom model, imported camera-light and reference export', async () => {
  test.setTimeout(60_000)
  const outputDirectory = resolve(process.cwd(), 'test-results', 'stage-3-composition')
  const exportDirectory = resolve(outputDirectory, 'reference-images')
  const modelPath = resolve(outputDirectory, 'camera-light-model.gltf')
  const projectPath = resolve(outputDirectory, '镜头时间轴.block3d')
  const glbExportPath = resolve(outputDirectory, '镜头时间轴.glb')
  const gltfExportPath = resolve(outputDirectory, '镜头时间轴.gltf')
  const objExportPath = resolve(outputDirectory, '镜头时间轴.obj')
  rmSync(outputDirectory, { recursive: true, force: true })
  mkdirSync(exportDirectory, { recursive: true })
  writeCameraLightGltf(modelPath)

  const electronApp = await launchIsolatedElectron()
  try {
    await electronApp.evaluate(
      ({ dialog }, paths) => {
        dialog.showSaveDialog = async (_browserWindowOrOptions, maybeOptions) => {
          const options = maybeOptions ?? _browserWindowOrOptions
          if (options.filters?.some((filter) => filter.extensions.includes('glb'))) {
            return { canceled: false, filePath: paths.glbExportPath }
          }
          if (options.filters?.some((filter) => filter.extensions.includes('gltf'))) {
            return { canceled: false, filePath: paths.gltfExportPath }
          }
          if (options.filters?.some((filter) => filter.extensions.includes('obj'))) {
            return { canceled: false, filePath: paths.objExportPath }
          }
          return { canceled: false, filePath: paths.projectPath }
        }
        dialog.showOpenDialog = async (_browserWindowOrOptions, maybeOptions) => {
          const options = maybeOptions ?? _browserWindowOrOptions
          if (options.properties?.includes('openDirectory')) {
            return { canceled: false, filePaths: [paths.exportDirectory] }
          }
          if (options.filters?.some((filter) => filter.extensions.includes('block3d'))) {
            return { canceled: false, filePaths: [paths.projectPath] }
          }
          return { canceled: false, filePaths: [paths.modelPath] }
        }
      },
      {
        exportDirectory,
        modelPath,
        projectPath,
        glbExportPath,
        gltfExportPath,
        objExportPath
      }
    )

    const window = await electronApp.firstWindow()
    const pageErrors: string[] = []
    window.on('pageerror', (error) => pageErrors.push(error.message))
    window.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text())
    })
    await window.setViewportSize({ width: 1440, height: 900 })
    await expect(window.locator('canvas[data-scene-ready="true"]')).toBeVisible({
      timeout: 15_000
    })
    if ((await window.locator('html').getAttribute('data-theme')) === 'dark') {
      await window.getByRole('button', { name: '切换到白色主题' }).click()
    }

    await window.getByRole('button', { name: '添加方块' }).click()
    await window.getByRole('button', { name: '添加圆柱' }).click()
    await window.getByRole('button', { name: '添加球体' }).click()
    await expect(window.getByText('3 个模型')).toBeVisible()
    const canvasBounds = await window.locator('canvas').boundingBox()
    if (!canvasBounds) throw new Error('Three.js canvas has no visible bounds')
    await window.getByRole('button', { name: '固定场景光' }).click()
    await window.getByRole('button', { name: '查看全部对象' }).click()

    await window.mouse.move(canvasBounds.x + 8, canvasBounds.y + 8)
    await window.mouse.down({ button: 'right' })
    await window.mouse.move(
      canvasBounds.x + canvasBounds.width - 8,
      canvasBounds.y + canvasBounds.height - 8,
      { steps: 12 }
    )
    await window.mouse.up({ button: 'right' })
    await expect(window.locator('canvas')).toHaveAttribute('data-selected-count', '3')
    await expect(window.locator('canvas')).toHaveAttribute('data-marquee-selection-count', '3')
    const layoutTools = window.getByLabel('多个对象排列工具')
    await expect(layoutTools).toContainText('3 个对象')
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-3-multi-select-light-1440x900.png'),
      animations: 'disabled'
    })
    await layoutTools.getByRole('button', { name: '横向对齐' }).click()
    await layoutTools.getByRole('button', { name: '保存为组合' }).click()
    await expect(window.getByRole('dialog', { name: '保存为一个组合？' })).toBeVisible()
    await window.getByRole('button', { name: '保存为组合', exact: true }).last().click()
    await expect(window.getByRole('status')).toContainText('已保存为组合')

    await window.getByRole('button', { name: '选择 方块 01', exact: true }).click()
    await window.getByRole('button', { name: '聚焦查看 方块 01' }).click()
    await window.getByRole('button', { name: '在模型面上继续画' }).click()
    await expect(window.getByLabel('选择模型表面')).toBeVisible()
    await expect(window.locator('canvas')).toHaveAttribute('data-surface-pick', 'true')
    await window.mouse.click(
      canvasBounds.x + canvasBounds.width * 0.5,
      canvasBounds.y + canvasBounds.height * 0.5
    )
    await expect(window.locator('canvas')).toHaveAttribute('data-surface-pick-hit', 'true')
    await expect(window.locator('canvas')).toHaveAttribute('data-modeling-plane-mode', 'surface')
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-6-surface-drawing-light-1440x900.png'),
      animations: 'disabled'
    })
    await window.getByLabel('画布建模工具').getByRole('button', { name: '取消' }).click()

    await window.getByRole('button', { name: '绘制自定义形状' }).click()
    const modelingToolbar = window.getByLabel('画布建模工具')
    await expect(modelingToolbar).toBeVisible()
    await window.mouse.click(
      canvasBounds.x + canvasBounds.width * 0.42,
      canvasBounds.y + canvasBounds.height * 0.58
    )
    await window.mouse.click(
      canvasBounds.x + canvasBounds.width * 0.58,
      canvasBounds.y + canvasBounds.height * 0.58
    )
    await expect(window.locator('canvas')).toHaveAttribute('data-modeling-point-count', '2')
    await window.mouse.click(
      canvasBounds.x + canvasBounds.width * 0.58,
      canvasBounds.y + canvasBounds.height * 0.42
    )
    await window.mouse.click(
      canvasBounds.x + canvasBounds.width * 0.42,
      canvasBounds.y + canvasBounds.height * 0.42
    )
    await expect(window.locator('canvas')).toHaveAttribute('data-modeling-point-count', '4')
    await modelingToolbar.getByRole('button', { name: '闭合线成面' }).click()
    await expect(window.locator('canvas')).toHaveAttribute('data-modeling-closed', 'true')
    await modelingToolbar.getByLabel('拉伸距离').fill('2')
    await modelingToolbar.getByRole('button', { name: '拉伸所选面', exact: true }).click()
    await expect(window.locator('canvas')).toHaveAttribute('data-modeling-point-count', '8')
    await expect(window.locator('canvas')).toHaveAttribute('data-modeling-geometry-state', 'valid')
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-9-mesh-modeling-light-1440x900.png'),
      animations: 'disabled'
    })
    await modelingToolbar.getByRole('button', { name: '完成模型' }).click()
    await expect(window.getByRole('button', { name: '选择 自定义形状 01' })).toBeVisible()

    await window.getByRole('button', { name: '编辑点、线和面' }).click()
    await expect(window.locator('canvas')).toHaveAttribute('data-modeling-face-selected', 'true')
    await modelingToolbar.getByRole('button', { name: '在此面继续画' }).click()
    await expect(window.locator('canvas')).toHaveAttribute('data-modeling-plane-mode', 'surface')
    await modelingToolbar.getByRole('button', { name: '取消', exact: true }).click()

    await window.getByRole('button', { name: '选择 自定义形状 01' }).click()
    await window.getByRole('button', { name: '平面切割', exact: true }).click()
    const cutToolbar = window.getByLabel('平面切割工具')
    await expect(cutToolbar).toBeVisible()
    await expect(window.locator('canvas')).toHaveAttribute('data-cut-preview', /x:/)
    await window.setViewportSize({ width: 1280, height: 720 })
    const cutToolbarBounds = await cutToolbar.boundingBox()
    if (!cutToolbarBounds) throw new Error('Cut toolbar has no visible bounds')
    expect(cutToolbarBounds.x).toBeGreaterThanOrEqual(0)
    expect(cutToolbarBounds.x + cutToolbarBounds.width).toBeLessThanOrEqual(1280)
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-6-cut-tool-1280x720.png'),
      animations: 'disabled'
    })
    await window.setViewportSize({ width: 1440, height: 900 })
    await cutToolbar.getByRole('button', { name: '应用切割', exact: true }).click()
    await expect(window.getByRole('button', { name: '选择 自定义形状 01 切面 A' })).toBeVisible()
    await expect(window.getByRole('button', { name: '选择 自定义形状 01 切面 B' })).toBeVisible()
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-6-plane-cut-light-1440x900.png'),
      animations: 'disabled'
    })
    const canvasPixelStats = await window.locator('canvas').evaluate((element) => {
      const canvas = element as HTMLCanvasElement
      const snapshot = document.createElement('canvas')
      snapshot.width = canvas.width
      snapshot.height = canvas.height
      const context = snapshot.getContext('2d')
      if (!context) return { uniqueColors: 0, luminanceRange: 0 }
      context.drawImage(canvas, 0, 0)
      const pixels = context.getImageData(0, 0, snapshot.width, snapshot.height).data
      const colors = new Set<string>()
      let darkest = 255
      let brightest = 0
      for (let y = 0; y < snapshot.height; y += 24) {
        for (let x = 0; x < snapshot.width; x += 24) {
          const offset = (y * snapshot.width + x) * 4
          const red = pixels[offset]
          const green = pixels[offset + 1]
          const blue = pixels[offset + 2]
          colors.add(`${red >> 3}:${green >> 3}:${blue >> 3}`)
          const luminance = red * 0.2126 + green * 0.7152 + blue * 0.0722
          darkest = Math.min(darkest, luminance)
          brightest = Math.max(brightest, luminance)
        }
      }
      return { uniqueColors: colors.size, luminanceRange: brightest - darkest }
    })
    expect(canvasPixelStats.uniqueColors).toBeGreaterThan(20)
    expect(canvasPixelStats.luminanceRange).toBeGreaterThan(40)

    await window.getByRole('button', { name: '主相机' }).click()
    await expect(window.getByLabel('摄影机实时画面 16:9')).toBeVisible()
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-monitor', 'true')
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-preview', 'false')
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-gizmo', 'translate')
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-guide-tone', 'dark')
    await window.getByRole('button', { name: '转向', exact: true }).click()
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-gizmo', 'aim')
    await window.getByRole('button', { name: '移动', exact: true }).click()
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-gizmo', 'translate')
    await window.getByRole('button', { name: '9:16', exact: true }).click()
    await expect(window.locator('canvas')).toHaveAttribute('data-output-aspect', '9:16')
    await expect(window.getByLabel('摄影机实时画面 9:16')).toBeVisible()
    await window.setViewportSize({ width: 1280, height: 720 })
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-10-camera-monitor-1280x720.png'),
      animations: 'disabled'
    })
    await window.getByRole('button', { name: '全屏取景', exact: true }).click()
    await expect(window.getByLabel('摄影机取景 9:16')).toBeVisible()
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-preview', 'true')
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-4-camera-preview-1280x720.png'),
      animations: 'disabled'
    })
    await window.locator('.camera-preview-exit').click()

    await window.getByRole('button', { name: '记录当前镜头', exact: true }).click()
    await expect(window.getByRole('status')).toContainText('已记录 0.0 秒')
    await expect(window.getByText('起始镜头', { exact: true })).toBeVisible()
    await expect(window.getByRole('button', { name: '直接切换', exact: true })).toHaveCount(0)
    const timelineTrack = window.locator('.track-area')
    const timelineBounds = await timelineTrack.boundingBox()
    if (!timelineBounds) throw new Error('Camera timeline has no visible bounds')
    await window.mouse.click(
      timelineBounds.x + timelineBounds.width * 0.6,
      timelineBounds.y + timelineBounds.height * 0.6
    )
    await window.getByLabel('相机位置 X').fill('12')
    await window.getByLabel('相机位置 X').press('Enter')
    await window.getByRole('button', { name: '记录当前镜头', exact: true }).click()
    await expect(window.locator('.track-labels > div')).toContainText('摄影机镜头2')

    await window.mouse.click(
      timelineBounds.x + timelineBounds.width * 0.3,
      timelineBounds.y + timelineBounds.height * 0.6
    )
    const smoothPosition = JSON.parse(
      (await window.locator('canvas').getAttribute('data-output-camera-position')) ?? '{}'
    ) as { x: number }
    expect(smoothPosition.x).toBeGreaterThan(7.5)
    expect(smoothPosition.x).toBeLessThan(12)

    await window.getByRole('button', { name: '直接切换', exact: true }).click()
    await window.mouse.click(
      timelineBounds.x + timelineBounds.width * 0.3,
      timelineBounds.y + timelineBounds.height * 0.6
    )
    const cutPosition = JSON.parse(
      (await window.locator('canvas').getAttribute('data-output-camera-position')) ?? '{}'
    ) as { x: number }
    expect(cutPosition.x).toBeCloseTo(7.5)
    await window.getByRole('button', { name: '平滑移动', exact: true }).click()

    const timeBeforePlayback = Number(
      ((await window.locator('.timeline-time').textContent()) ?? '0').split('/')[0].trim()
    )
    await window.getByRole('button', { name: '播放动画', exact: true }).click()
    await window.waitForTimeout(350)
    await window.getByRole('button', { name: '暂停预览', exact: true }).click()
    const timeAfterPlayback = Number(
      ((await window.locator('.timeline-time').textContent()) ?? '0').split('/')[0].trim()
    )
    expect(timeAfterPlayback).toBeGreaterThan(timeBeforePlayback)
    await window.setViewportSize({ width: 1440, height: 900 })
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-5-camera-timeline-light-1440x900.png'),
      animations: 'disabled'
    })

    const objectTrackBeforeRecording = await timelineTrack.boundingBox()
    if (!objectTrackBeforeRecording) throw new Error('Object timeline has no visible bounds')
    await window.mouse.click(
      objectTrackBeforeRecording.x + 2,
      objectTrackBeforeRecording.y + objectTrackBeforeRecording.height * 0.6
    )
    await window.getByRole('button', { name: '选择 方块 01', exact: true }).click()
    const objectStartX = Number.parseFloat(await window.getByLabel('位置 X').inputValue())
    const objectStartRotationY = Number.parseFloat(await window.getByLabel('旋转 Y').inputValue())
    const objectStartSizeX = Number.parseFloat(await window.getByLabel('大小 X').inputValue())
    await window.getByRole('button', { name: '记录物体状态', exact: true }).click()
    await expect(window.getByRole('status')).toContainText('已记录 0.0 秒的 方块 01 状态')
    await expect(window.locator('canvas')).toHaveAttribute('data-animated-object-count', '1')

    const objectTrack = await timelineTrack.boundingBox()
    if (!objectTrack) throw new Error('Expanded object timeline has no visible bounds')
    await window.mouse.click(
      objectTrack.x + objectTrack.width * 0.8,
      objectTrack.y + objectTrack.height * 0.75
    )
    await window.getByLabel('位置 X').fill(String(objectStartX + 4))
    await window.getByLabel('位置 X').press('Enter')
    await window.getByLabel('旋转 Y').fill(String(objectStartRotationY + 90))
    await window.getByLabel('旋转 Y').press('Enter')
    await window.getByLabel('大小 X').fill(String(objectStartSizeX + 1))
    await window.getByLabel('大小 X').press('Enter')
    await window.getByRole('button', { name: '记录物体状态', exact: true }).click()
    await expect(window.locator('.track-labels > div').last()).toContainText('方块 01')
    await expect(window.locator('.track-labels > div').last()).toContainText('2')

    await window.mouse.click(
      objectTrack.x + objectTrack.width * 0.4,
      objectTrack.y + objectTrack.height * 0.75
    )
    const objectPreview = JSON.parse(
      (await window.locator('canvas').getAttribute('data-selected-animation-transform')) ?? '{}'
    ) as { position: { x: number }; rotation: { y: number }; size: { x: number } }
    expect(objectPreview.position.x).toBeCloseTo(objectStartX + 2, 0)
    expect(objectPreview.rotation.y).toBeCloseTo(objectStartRotationY + 45, 0)
    expect(objectPreview.size.x).toBeCloseTo(objectStartSizeX + 0.5, 0)

    await window.locator('[data-marker-kind="object"][data-marker-time="4.000"]').click()
    await window.getByRole('button', { name: '匀速运动', exact: true }).click()
    await expect(window.getByRole('button', { name: '匀速运动', exact: true })).toHaveClass(
      /is-active/
    )
    await window.mouse.click(
      objectTrack.x + objectTrack.width * 0.2,
      objectTrack.y + objectTrack.height * 0.75
    )
    const objectTimeBeforePlayback = Number(
      ((await window.locator('.timeline-time').textContent()) ?? '0').split('/')[0].trim()
    )
    await window.getByRole('button', { name: '播放动画', exact: true }).click()
    await window.waitForTimeout(350)
    await window.getByRole('button', { name: '暂停预览', exact: true }).click()
    const objectTimeAfterPlayback = Number(
      ((await window.locator('.timeline-time').textContent()) ?? '0').split('/')[0].trim()
    )
    expect(objectTimeAfterPlayback).toBeGreaterThan(objectTimeBeforePlayback)
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-7-object-timeline-light-1440x900.png'),
      animations: 'disabled'
    })

    await window.keyboard.press('Control+S')
    await expect(window.getByRole('status')).toContainText('工程已保存')
    const timelineProject = JSON.parse(readFileSync(projectPath, 'utf8')) as {
      schemaVersion: number
      scene: {
        timeline: {
          cameraShots: Array<{ transition: string }>
          objectKeyframes: Array<{ objectId: string; interpolation: string }>
        }
      }
    }
    expect(timelineProject.schemaVersion).toBe(12)
    expect(timelineProject.scene.timeline.cameraShots).toHaveLength(2)
    expect(timelineProject.scene.timeline.cameraShots[1].transition).toBe('smooth')
    expect(timelineProject.scene.timeline.objectKeyframes).toHaveLength(2)
    expect(timelineProject.scene.timeline.objectKeyframes[1].interpolation).toBe('linear')

    await window.keyboard.press('Control+N')
    await expect(window.getByText('0 个模型')).toBeVisible()
    await window.keyboard.press('Control+O')
    await expect(window.getByRole('status')).toContainText('已打开：镜头时间轴')
    await expect(window.locator('.timeline-time')).toContainText('0.0 / 5.0 秒')
    await expect(window.locator('.track-labels > div').last()).toContainText('方块 01')
    await expect(window.locator('.track-labels > div').last()).toContainText('2')
    await window.getByRole('button', { name: '记录当前镜头', exact: true }).click()
    await expect(window.locator('.track-labels > div').first()).toContainText('2')

    await window.getByRole('button', { name: '固定场景光' }).click()
    await window.getByRole('button', { name: '点光源', exact: true }).click()
    await expect(window.locator('canvas')).toHaveAttribute('data-user-light-count', '2')
    await expect(window.locator('canvas')).toHaveAttribute('data-light-guide-tone', 'dark')
    await expect(window.locator('input[value="点光源 01"]')).toBeVisible()
    await window.getByLabel('灯光强度').fill('5.4')
    await window.setViewportSize({ width: 1440, height: 900 })

    await window.getByRole('button', { name: '导入本地模型' }).click()
    await expect(window.locator('.notice')).toContainText('已导入', { timeout: 15_000 })
    await expect(window.getByRole('button', { name: '选择 camera-light-model' })).toBeVisible({
      timeout: 15_000
    })
    const importedSummary = window.getByRole('heading', { name: '导入模型' }).locator('..')
    await expect(importedSummary).toContainText('相机')
    await expect(importedSummary).toContainText('灯光')
    await window.getByRole('button', { name: '使用模型相机' }).click()
    await expect(window.getByRole('status')).toContainText('已切换到模型中保存的相机视角')
    await window.getByRole('button', { name: '选择 camera-light-model' }).click()
    await window.getByText('使用模型自带灯光').click()

    await window.getByRole('button', { name: '导出图片、视频或三维模型' }).click()
    await window.locator('summary', { hasText: '高级导出与检查' }).click()
    await window.getByRole('button', { name: '检查模型质量' }).click()
    const qualityDialog = window.getByRole('dialog', { name: '模型质量' })
    await expect(qualityDialog).toBeVisible()
    await expect(qualityDialog).toContainText('6')
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-3-quality-check-light-1440x900.png'),
      animations: 'disabled'
    })
    await qualityDialog.getByRole('button', { name: '关闭', exact: true }).click()

    await window.getByRole('button', { name: '导出图片、视频或三维模型' }).click()
    await window.getByText('高级导出与检查', { exact: true }).click()
    await window.getByRole('button', { name: '导出六张控制参考图' }).click()
    await expect(window.getByRole('status')).toContainText(
      '白模、深度、法线、物体分色、遮罩和轮廓图已导出'
    )
    const paths = [
      '镜头时间轴_白模.png',
      '镜头时间轴_深度.png',
      '镜头时间轴_法线.png',
      '镜头时间轴_物体分色.png',
      '镜头时间轴_遮罩.png',
      '镜头时间轴_轮廓.png'
    ].map((name) => resolve(exportDirectory, name))
    for (const path of paths) expect(existsSync(path)).toBe(true)
    const images = paths.map((path) => readFileSync(path))
    expect(images.map(pngDimensions)).toEqual(images.map(() => pngDimensions(images[0])))
    expect(images[0].equals(images[1])).toBe(false)
    expect(images[1].equals(images[2])).toBe(false)
    expect(images[2].equals(images[3])).toBe(false)
    expect(images[3].equals(images[4])).toBe(false)
    expect(images[4].equals(images[5])).toBe(false)
    expect(images.every((image) => image.byteLength > 1_000)).toBe(true)

    for (const format of ['GLB', 'GLTF', 'OBJ'] as const) {
      await window.getByRole('button', { name: '导出图片、视频或三维模型' }).click()
      await window.getByRole('button', { name: '导出场景模型' }).click()
      const exportDialog = window.getByRole('dialog', { name: '选择导出格式' })
      await expect(exportDialog).toBeVisible()
      if (format === 'GLB') {
        await window.screenshot({
          path: resolve(
            process.cwd(),
            '..',
            'artifacts',
            'stage-3-model-export-light-1440x900.png'
          ),
          animations: 'disabled'
        })
      }
      await exportDialog.getByRole('button', { name: new RegExp(`^${format}`) }).click()
      await expect(window.getByRole('status')).toContainText(`${format} `, { timeout: 15_000 })
    }
    expect(readFileSync(glbExportPath).subarray(0, 4).toString('ascii')).toBe('glTF')
    const exportedGltf = JSON.parse(readFileSync(gltfExportPath, 'utf8'))
    expect(exportedGltf.asset.version).toBe('2.0')
    expect(exportedGltf.meshes.length).toBeGreaterThan(0)
    const exportedObj = readFileSync(objExportPath, 'utf8')
    expect(exportedObj).toMatch(/^o /m)
    expect(exportedObj).toMatch(/^v /m)
    expect(pageErrors).toEqual([])

    await window.getByRole('button', { name: /^聚焦查看/ }).click()
    await window.waitForTimeout(300)
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-3-composition-light-1440x900.png'),
      animations: 'disabled'
    })
    await window.getByRole('button', { name: '切换到黑色主题' }).click()
    await window.setViewportSize({ width: 1280, height: 720 })
    await expect(window.locator('canvas')).toHaveAttribute('data-selected-display-mode', 'solid')
    await window.waitForTimeout(500)
    expect(
      await window.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
    ).toBe(false)
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-3-composition-dark-1280x720.png'),
      animations: 'disabled'
    })
  } finally {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    await electronApp.close()
  }
})
