import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { createIsolatedUserDataPath, launchElectronWithUserData } from './launch-app'

test('recovers one local snapshot and manages recent records without deleting projects', async () => {
  test.setTimeout(60_000)
  const outputDirectory = resolve(process.cwd(), 'test-results', 'workspace-safety')
  const projectPath = resolve(outputDirectory, '恢复后的课堂.block3d')
  rmSync(outputDirectory, { recursive: true, force: true })
  mkdirSync(outputDirectory, { recursive: true })
  const userDataPath = createIsolatedUserDataPath()
  const recoveryPath = resolve(userDataPath, 'workspace-state', 'recovery.json')

  let electronApp = await launchElectronWithUserData(userDataPath)
  try {
    let window = await electronApp.firstWindow()
    await window.setViewportSize({ width: 1440, height: 900 })
    await expect(window.locator('canvas[data-scene-ready="true"]')).toBeVisible({ timeout: 15_000 })
    await window.getByRole('button', { name: '添加方块' }).click()
    await expect(window.getByText('恢复副本已更新')).toBeVisible({ timeout: 10_000 })
    expect(existsSync(recoveryPath)).toBe(true)
    const snapshot = JSON.parse(readFileSync(recoveryPath, 'utf8')) as {
      version: number
      document: { scene: { objects: unknown[] } }
    }
    expect(snapshot.version).toBe(1)
    expect(snapshot.document.scene.objects.length).toBeGreaterThan(0)

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach((browserWindow) => browserWindow.destroy())
    })
    await electronApp.close().catch(() => undefined)

    electronApp = await launchElectronWithUserData(userDataPath)
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, projectPath)
    window = await electronApp.firstWindow()
    await window.setViewportSize({ width: 1440, height: 900 })
    await expect(window.getByRole('heading', { name: '发现未保存的工程' })).toBeVisible({
      timeout: 15_000
    })
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-5-recovery-1440x900.png'),
      animations: 'disabled'
    })
    await window.getByRole('button', { name: '恢复工程' }).click()
    await expect(window.getByText(`${snapshot.document.scene.objects.length} 个模型`)).toBeVisible()
    await expect(window.getByText('未保存到文件 · 有更改')).toBeVisible()

    await window.getByRole('button', { name: '保存项目 (Ctrl+S)' }).click()
    await expect(window.getByText('工程已保存：恢复后的课堂')).toBeVisible()
    expect(existsSync(projectPath)).toBe(true)
    expect(existsSync(recoveryPath)).toBe(false)

    await window.getByRole('button', { name: '本地项目' }).click()
    await expect(window.getByRole('heading', { name: '本地项目' })).toBeVisible()
    await expect(window.locator('.recent-project-open')).toContainText('恢复后的课堂')
    await expect(window.getByLabel('本地项目统计')).toContainText('1')
    await expect(window.getByLabel('本地项目统计')).toContainText(/KB|MB/)
    await expect(
      window.getByRole('button', { name: '删除本地项目文件 恢复后的课堂' })
    ).toBeDisabled()
    await window.setViewportSize({ width: 1280, height: 720 })
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-5-recent-projects-1280x720.png'),
      animations: 'disabled'
    })
    await window.getByRole('button', { name: '仅移除最近记录 恢复后的课堂' }).click()
    await expect(window.getByText('还没有保存或打开过本地工程。')).toBeVisible()
    await expect(window.getByText('已移除最近记录，原工程文件仍保留在原位置。')).toBeVisible()
    expect(existsSync(projectPath)).toBe(true)
  } finally {
    await electronApp
      .evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows().forEach((browserWindow) => browserWindow.destroy())
      })
      .catch(() => undefined)
    await electronApp.close().catch(() => undefined)
  }
})
