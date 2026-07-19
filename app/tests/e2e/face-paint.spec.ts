import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { resolve } from 'path'
import { launchIsolatedElectron } from './launch-app'

test('paints a whole object and one understandable surface with undo and local persistence', async () => {
  test.setTimeout(60_000)
  const outputDirectory = resolve(process.cwd(), 'test-results', 'face-paint')
  const projectPath = resolve(outputDirectory, '上色测试.block3d')
  rmSync(outputDirectory, { recursive: true, force: true })
  mkdirSync(outputDirectory, { recursive: true })

  const electronApp = await launchIsolatedElectron()
  try {
    await electronApp.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path })
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    }, projectPath)
    const window = await electronApp.firstWindow()
    const pageErrors: string[] = []
    window.on('pageerror', (error) => pageErrors.push(error.message))
    await window.setViewportSize({ width: 1440, height: 900 })
    await expect(window.locator('canvas[data-scene-ready="true"]')).toBeVisible({
      timeout: 15_000
    })
    if ((await window.locator('html').getAttribute('data-theme')) === 'dark') {
      await window.getByRole('button', { name: '切换到白色主题' }).click()
    }

    await window.getByRole('button', { name: '添加方块' }).click()
    const colorInput = window.getByLabel('上色颜色')
    await colorInput.fill('#4e82dd')
    await expect(window.locator('canvas')).toHaveAttribute('data-whole-color-count', '1')
    await window.getByRole('button', { name: '撤销' }).click()
    await expect(window.locator('canvas')).toHaveAttribute('data-whole-color-count', '0')
    await window.getByRole('button', { name: '重做' }).click()
    await expect(window.locator('canvas')).toHaveAttribute('data-whole-color-count', '1')

    await window.getByRole('button', { name: '单个面', exact: true }).click()
    await colorInput.fill('#ef476f')
    await expect(window.locator('canvas')).toHaveAttribute('data-face-paint', 'true')
    const canvas = window.locator('canvas')
    const bounds = await canvas.boundingBox()
    if (!bounds) throw new Error('Three.js canvas has no visible bounds')
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    await window.mouse.move(center.x, center.y)
    await expect(canvas).toHaveAttribute('data-face-paint-surface-size', '2')
    await window.mouse.click(center.x, center.y)
    await expect(canvas).toHaveAttribute('data-painted-face-count', '2')
    await expect(window.getByRole('status')).toContainText('表面颜色已更新')
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-8-face-paint-light-1440x900.png'),
      animations: 'disabled'
    })

    await window.getByRole('button', { name: '撤销' }).click()
    await expect(canvas).toHaveAttribute('data-painted-face-count', '0')
    await window.getByRole('button', { name: '重做' }).click()
    await expect(canvas).toHaveAttribute('data-painted-face-count', '2')

    await window.keyboard.press('Control+S')
    await expect(window.getByRole('status')).toContainText('工程已保存')
    expect(existsSync(projectPath)).toBe(true)
    const saved = JSON.parse(readFileSync(projectPath, 'utf8')) as {
      schemaVersion: number
      scene: {
        objects: Array<{
          colorOverride?: string
          faceColors?: Record<string, string>
        }>
      }
    }
    expect(saved.schemaVersion).toBe(12)
    expect(saved.scene.objects[0].colorOverride).toBe('#4e82dd')
    expect(Object.values(saved.scene.objects[0].faceColors ?? {})).toEqual(['#ef476f', '#ef476f'])

    await window.getByRole('button', { name: '新建项目' }).click()
    await window.getByRole('button', { name: '打开项目' }).click()
    await expect(canvas).toHaveAttribute('data-painted-face-count', '2')
    await expect(canvas).toHaveAttribute('data-whole-color-count', '1')
    await window.getByRole('button', { name: '切换到黑色主题' }).click()
    await window.setViewportSize({ width: 1280, height: 720 })
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-8-face-paint-dark-1280x720.png'),
      animations: 'disabled'
    })

    expect(pageErrors).toEqual([])
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
    await electronApp.close().catch(() => undefined)
  }
})
