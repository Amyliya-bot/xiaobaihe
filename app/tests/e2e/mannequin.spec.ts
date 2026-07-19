import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { resolve } from 'path'
import { launchIsolatedElectron } from './launch-app'

test('poses a proportional mannequin directly on canvas and persists its animation state', async () => {
  test.setTimeout(60_000)
  const outputDirectory = resolve(process.cwd(), 'test-results', 'mannequin')
  const projectPath = resolve(outputDirectory, '人台测试.block3d')
  const glbPath = resolve(outputDirectory, '人台测试.glb')
  const objPath = resolve(outputDirectory, '人台测试.obj')
  rmSync(outputDirectory, { recursive: true, force: true })
  mkdirSync(outputDirectory, { recursive: true })

  const electronApp = await launchIsolatedElectron()
  try {
    await electronApp.evaluate(
      ({ dialog }, paths) => {
        dialog.showSaveDialog = async (_windowOrOptions, maybeOptions) => {
          const options = maybeOptions ?? _windowOrOptions
          if (options.filters?.some((filter) => filter.extensions.includes('glb'))) {
            return { canceled: false, filePath: paths.glbPath }
          }
          if (options.filters?.some((filter) => filter.extensions.includes('obj'))) {
            return { canceled: false, filePath: paths.objPath }
          }
          return { canceled: false, filePath: paths.projectPath }
        }
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [paths.projectPath]
        })
      },
      { projectPath, glbPath, objPath }
    )
    const window = await electronApp.firstWindow()
    const pageErrors: string[] = []
    window.on('pageerror', (error) => pageErrors.push(error.message))
    await window.setViewportSize({ width: 1440, height: 900 })
    const canvas = window.locator('canvas[data-scene-ready="true"]')
    await expect(canvas).toBeVisible({ timeout: 15_000 })
    if ((await window.locator('html').getAttribute('data-theme')) === 'dark') {
      await window.getByRole('button', { name: '切换到白色主题' }).click()
    }

    await window.getByRole('button', { name: '添加可摆姿势人台' }).click()
    await expect(canvas).toHaveAttribute('data-mannequin-visual', 'quaternius-cc0')
    await expect(canvas).toHaveAttribute('data-mannequin-actions', 'quaternius-ual1-standard-cc0')
    await expect(window.getByRole('heading', { name: '人台编辑' })).toBeVisible()
    await expect(window.getByRole('status')).toContainText('先整体摆放，需要改动作时再点“调整姿势”')
    await window.getByRole('button', { name: '调整姿势', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-mannequin-joint-count', '10')
    await window.getByRole('button', { name: /聚焦查看 人台/ }).click()
    const importedActions = [
      { name: '站立', screenshot: 'stand' },
      { name: '坐下', screenshot: 'sit' },
      { name: '伸手', screenshot: 'raise-hand' },
      { name: '行走', screenshot: 'walk' },
      { name: '跑步', screenshot: 'run' }
    ]
    for (const action of importedActions) {
      await window.getByRole('button', { name: action.name, exact: true }).click()
      await expect(window.getByRole('status')).toContainText(`已应用“${action.name}”动作`)
      await window.screenshot({
        path: resolve(
          process.cwd(),
          '..',
          'artifacts',
          `stage-20-official-action-${action.screenshot}-1440x900.png`
        ),
        animations: 'disabled'
      })
    }
    await window.getByRole('button', { name: '行走', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-mannequin-action-clip', 'Walk_Loop')
    await window.getByRole('button', { name: '导出图片、视频或三维模型' }).click()
    await expect(window.getByRole('button', { name: '按平台预设导出 MP4 视频' })).toBeEnabled()
    await window.getByText('高级导出与检查', { exact: true }).click()
    await expect(window.getByRole('button', { name: '导出动画帧序列' })).toBeEnabled()
    await window.keyboard.press('Escape')
    const firstActionSample = await canvas.getAttribute('data-mannequin-action-sample')
    await window.getByRole('button', { name: '播放人物动作' }).click()
    await expect
      .poll(async () => Number(await canvas.getAttribute('data-mannequin-action-time')))
      .toBeGreaterThan(0.2)
    await expect
      .poll(async () => canvas.getAttribute('data-mannequin-action-sample'))
      .not.toBe(firstActionSample)
    await window.getByRole('button', { name: '暂停人物动作' }).click()

    const shoulder = window.getByRole('button', { name: '拖动右上臂' })
    await expect(shoulder).toBeVisible()
    const shoulderBounds = await shoulder.boundingBox()
    if (!shoulderBounds) throw new Error('Mannequin shoulder handle has no visible bounds')
    const shoulderCenter = {
      x: shoulderBounds.x + shoulderBounds.width / 2,
      y: shoulderBounds.y + shoulderBounds.height / 2
    }
    await window.mouse.move(shoulderCenter.x, shoulderCenter.y)
    await window.mouse.down()
    await window.mouse.move(shoulderCenter.x + 28, shoulderCenter.y - 20, { steps: 6 })
    await window.mouse.up()
    await expect(canvas).toHaveAttribute('data-mannequin-last-joint', 'rightShoulder')
    const draggedPose = JSON.parse((await canvas.getAttribute('data-mannequin-pose')) ?? '{}') as {
      rightShoulder?: { x: number; y: number; z: number }
    }
    expect(draggedPose.rightShoulder).toBeTruthy()
    expect(draggedPose.rightShoulder?.z).not.toBe(8)
    const movedShoulderBounds = await shoulder.boundingBox()
    if (!movedShoulderBounds) throw new Error('Dragged mannequin handle disappeared')
    expect(
      Math.hypot(
        movedShoulderBounds.x + movedShoulderBounds.width / 2 - shoulderCenter.x,
        movedShoulderBounds.y + movedShoulderBounds.height / 2 - shoulderCenter.y
      )
    ).toBeGreaterThan(3)

    const height = window.getByLabel('参考身高')
    await height.fill('1.90')
    await height.press('Enter')
    await expect(height).toHaveValue('1.90 m')
    await window.getByRole('button', { name: '记录物体状态' }).click()
    await expect(window.getByRole('status')).toContainText(/已记录 \d\.\d 秒/)
    await window.getByRole('button', { name: /聚焦查看 人台/ }).click()

    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-12-mannequin-light-1440x900.png'),
      animations: 'disabled'
    })

    await window.keyboard.press('Control+S')
    await expect(window.getByRole('status')).toContainText('工程已保存')
    expect(existsSync(projectPath)).toBe(true)
    const saved = JSON.parse(readFileSync(projectPath, 'utf8')) as {
      schemaVersion: number
      scene: {
        objects: Array<{
          kind: string
          size: { x: number; y: number; z: number }
          mannequin?: {
            heightMeters: number
            pose: { rightShoulder: { x: number; y: number; z: number } }
          }
        }>
        timeline: { objectKeyframes: Array<{ transform: { mannequinPose?: unknown } }> }
      }
    }
    const mannequin = saved.scene.objects.find((object) => object.kind === 'mannequin')
    expect(saved.schemaVersion).toBe(12)
    expect(mannequin?.mannequin?.heightMeters).toBe(1.9)
    expect(mannequin?.size).toEqual({ x: 1.9, y: 1.9, z: 1.9 })
    expect(mannequin?.mannequin?.pose.rightShoulder.z).not.toBe(10)
    expect(saved.scene.timeline.objectKeyframes[0].transform.mannequinPose).toBeTruthy()

    await window.getByRole('button', { name: '导出图片、视频或三维模型' }).click()
    await window.getByRole('button', { name: '导出场景模型' }).click()
    await window
      .getByRole('dialog', { name: '选择导出格式' })
      .getByRole('button', { name: /^GLB/ })
      .click()
    await expect(window.getByRole('status')).toContainText('GLB 模型已导出', {
      timeout: 15_000
    })
    const exportedGlb = readFileSync(glbPath)
    expect(exportedGlb.subarray(0, 4).toString('ascii')).toBe('glTF')
    expect(exportedGlb.byteLength).toBeGreaterThan(100_000)
    expect(exportedGlb.byteLength).toBeLessThan(1_500_000)
    const jsonChunkLength = exportedGlb.readUInt32LE(12)
    const exportedDocument = JSON.parse(
      exportedGlb.subarray(20, 20 + jsonChunkLength).toString('utf8')
    ) as {
      meshes?: unknown[]
      nodes?: Array<{ extras?: unknown }>
      skins?: unknown[]
    }
    expect(exportedDocument.meshes).toHaveLength(2)
    expect(exportedDocument.skins).toHaveLength(2)
    expect(exportedDocument.nodes?.some((node) => node.extras)).toBe(false)

    await window.getByRole('button', { name: '导出图片、视频或三维模型' }).click()
    await window.getByRole('button', { name: '导出场景模型' }).click()
    await window
      .getByRole('dialog', { name: '选择导出格式' })
      .getByRole('button', { name: /^OBJ/ })
      .click()
    await expect(window.getByRole('status')).toContainText('OBJ 已导出', {
      timeout: 15_000
    })
    const exportedObj = readFileSync(objPath, 'utf8')
    expect(exportedObj).toMatch(/^o Mannequin_1$/m)
    expect(exportedObj).not.toContain('人台控制骨架')
    expect(exportedObj.match(/^v /gm)?.length).toBeGreaterThan(7_000)

    await window.getByRole('button', { name: '切换到黑色主题' }).click()
    await window.setViewportSize({ width: 1280, height: 720 })
    await window.getByRole('button', { name: /聚焦查看 人台/ }).click()
    await expect(shoulder).toBeVisible()
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-12-mannequin-dark-1280x720.png'),
      animations: 'disabled'
    })

    expect(pageErrors).toEqual([])
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
    await electronApp.close().catch(() => undefined)
  }
})
