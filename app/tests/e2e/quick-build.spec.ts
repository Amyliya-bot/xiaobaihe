import { expect, test } from '@playwright/test'
import { mkdirSync, readFileSync, rmSync } from 'fs'
import { resolve } from 'path'
import { launchIsolatedElectron } from './launch-app'

test('adds preset architecture and lays out walls and floors directly on the canvas', async () => {
  test.setTimeout(45_000)
  const outputDirectory = resolve(process.cwd(), 'test-results', 'quick-build')
  const projectPath = resolve(outputDirectory, '快速建筑.block3d')
  rmSync(outputDirectory, { recursive: true, force: true })
  mkdirSync(outputDirectory, { recursive: true })

  const electronApp = await launchIsolatedElectron()
  try {
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, projectPath)
    const window = await electronApp.firstWindow()
    const pageErrors: string[] = []
    window.on('pageerror', (error) => pageErrors.push(error.message))
    window.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text())
    })
    await window.setViewportSize({ width: 1440, height: 900 })
    const canvas = window.locator('canvas[data-scene-ready="true"]')
    await expect(canvas).toBeVisible({ timeout: 15_000 })

    await window.getByRole('button', { name: '添加墙体' }).click()
    await expect(window.getByRole('button', { name: '选择 墙体 01' })).toBeVisible()
    await window.getByRole('button', { name: '添加地面' }).click()
    await expect(window.getByRole('button', { name: '选择 地面 01' })).toBeVisible()
    await expect(window.getByText('2 个模型')).toBeVisible()

    await window.getByRole('button', { name: '连续铺设' }).click()
    await expect(window.getByRole('group', { name: '铺设类型' })).toBeVisible()
    await expect(canvas).toHaveAttribute('data-quick-build-tool', 'wall')
    const bounds = await canvas.boundingBox()
    if (!bounds) throw new Error('Quick build canvas has no visible bounds')

    const point = (x: number, y: number): { x: number; y: number } => ({
      x: bounds.x + bounds.width * x,
      y: bounds.y + bounds.height * y
    })
    const wallStart = point(0.38, 0.64)
    const wallEnd = point(0.64, 0.64)
    await window.mouse.click(wallStart.x, wallStart.y)
    await window.mouse.move(wallEnd.x, wallEnd.y, { steps: 6 })
    await expect(canvas).toHaveAttribute('data-quick-build-phase', 'drawing')
    await expect(window.locator('.quick-build-toolbar output')).toContainText('长度')
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-4-quick-wall-preview-1440x900.png'),
      animations: 'disabled'
    })
    await window.mouse.click(wallEnd.x, wallEnd.y)
    await expect(window.getByText('3 个模型')).toBeVisible()
    await expect(canvas).toHaveAttribute('data-quick-build-last-kind', 'wall')

    await window.getByRole('button', { name: '地面', exact: true }).last().click()
    await expect(canvas).toHaveAttribute('data-quick-build-tool', 'floor')
    const floorStart = point(0.42, 0.54)
    const floorEnd = point(0.64, 0.72)
    await window.mouse.click(floorStart.x, floorStart.y)
    await window.mouse.move(floorEnd.x, floorEnd.y, { steps: 6 })
    await expect(window.locator('.quick-build-toolbar output')).toContainText('×')
    await window.mouse.click(floorEnd.x, floorEnd.y)
    await expect(window.getByText('4 个模型')).toBeVisible()
    await expect(canvas).toHaveAttribute('data-quick-build-last-kind', 'floor')

    await window.getByRole('button', { name: '完成', exact: true }).click()
    await expect(canvas).not.toHaveAttribute('data-quick-build-tool')
    await window.keyboard.press('Control+S')
    await expect(window.getByRole('status')).toContainText('工程已保存')
    const saved = JSON.parse(readFileSync(projectPath, 'utf8'))
    expect(saved.schemaVersion).toBe(12)
    expect(saved.scene.objects.map((object: { kind: string }) => object.kind)).toEqual([
      'wall',
      'floor',
      'wall',
      'floor'
    ])
    expect(saved.scene.objects[2].size.x).toBeGreaterThan(0.2)
    expect(saved.scene.objects[2].size.y).toBe(2.8)
    expect(saved.scene.objects[3].size.y).toBe(0.12)

    await window.keyboard.press('Control+Z')
    await expect(window.getByText('3 个模型')).toBeVisible()
    await window.getByRole('button', { name: '切换到黑色主题' }).click()
    await window.setViewportSize({ width: 1280, height: 720 })
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-4-quick-build-dark-1280x720.png'),
      animations: 'disabled'
    })
    expect(pageErrors).toEqual([])
  } finally {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    await electronApp.close()
  }
})
