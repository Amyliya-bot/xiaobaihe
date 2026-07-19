import { expect, test } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'fs'
import { resolve } from 'path'
import { ALL_FORMATS, BufferSource, Input } from 'mediabunny'
import { launchIsolatedElectron } from './launch-app'

async function forceCloseElectron(electronApp: ElectronApplication): Promise<void> {
  await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
  await electronApp.close().catch(() => undefined)
}

async function createOneSecondAnimation(window: Page): Promise<void> {
  await window.getByRole('button', { name: '添加方块' }).click()
  await window.getByLabel('时间轴总时长').fill('1')
  await window.getByLabel('时间轴总时长').press('Enter')
  await window.getByRole('button', { name: '动画时间轴', exact: true }).click()
  const trackArea = window.locator('.track-area')
  const initialBounds = await trackArea.boundingBox()
  if (!initialBounds) throw new Error('Timeline track has no visible bounds')
  await window.mouse.click(initialBounds.x + 2, initialBounds.y + initialBounds.height * 0.6)
  await window.getByRole('button', { name: '记录物体状态', exact: true }).click()
  const expandedBounds = await trackArea.boundingBox()
  if (!expandedBounds) throw new Error('Expanded timeline track has no visible bounds')
  await window.mouse.click(
    expandedBounds.x + expandedBounds.width - 2,
    expandedBounds.y + expandedBounds.height * 0.82
  )
  await window.getByLabel('位置 X').fill('4')
  await window.getByLabel('位置 X').press('Enter')
  await window.getByRole('button', { name: '记录物体状态', exact: true }).click()
}

test('exports a deterministic playable H.264 MP4 through a platform preset', async () => {
  test.setTimeout(60_000)
  const outputDirectory = resolve(process.cwd(), 'test-results', 'video-export')
  const videoPath = resolve(outputDirectory, '平台参考.mp4')
  rmSync(outputDirectory, { recursive: true, force: true })
  mkdirSync(outputDirectory, { recursive: true })
  const electronApp = await launchIsolatedElectron()

  try {
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, videoPath)
    const window = await electronApp.firstWindow()
    const pageErrors: string[] = []
    window.on('pageerror', (error) => pageErrors.push(error.message))
    window.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text())
    })
    await window.setViewportSize({ width: 1440, height: 900 })
    await expect(window.locator('canvas[data-scene-ready="true"]')).toBeVisible({ timeout: 15_000 })
    await createOneSecondAnimation(window)

    await window.getByRole('button', { name: '导出图片、视频或三维模型' }).click()
    await window.getByRole('button', { name: '按平台预设导出 MP4 视频' }).click()
    const presetDialog = window.getByRole('dialog', { name: '选择视频用途' })
    await expect(presetDialog).toBeVisible()
    await expect(presetDialog).toContainText('通用 AI 参考')
    await expect(presetDialog).toContainText('1280 × 720')
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-10-video-presets-light-1440x900.png'),
      animations: 'disabled'
    })

    await presetDialog.getByRole('button', { name: '关闭视频导出' }).click()
    await window.getByRole('button', { name: '切换到黑色主题' }).click()
    await window.setViewportSize({ width: 1280, height: 720 })
    await window.getByRole('button', { name: '导出图片、视频或三维模型' }).click()
    await window.getByRole('button', { name: '按平台预设导出 MP4 视频' }).click()
    await expect(presetDialog).toBeVisible()
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-10-video-presets-dark-1280x720.png'),
      animations: 'disabled'
    })

    await presetDialog.getByRole('button', { name: '导出 MP4' }).click()
    await expect(window.getByRole('status')).toContainText('视频已导出', { timeout: 45_000 })
    expect(existsSync(videoPath)).toBe(true)

    const bytes = Uint8Array.from(readFileSync(videoPath))
    expect(new TextDecoder().decode(bytes.subarray(4, 8))).toBe('ftyp')
    const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS })
    const videoTrack = await input.getPrimaryVideoTrack()
    expect(videoTrack).not.toBeNull()
    if (!videoTrack) throw new Error('MP4 has no video track')
    expect(await videoTrack.getCodec()).toBe('avc')
    expect(await videoTrack.getDisplayWidth()).toBe(1280)
    expect(await videoTrack.getDisplayHeight()).toBe(720)
    expect(await videoTrack.computeDuration()).toBeCloseTo(1, 1)
    expect(pageErrors).toEqual([])
  } finally {
    await forceCloseElectron(electronApp)
  }
})

test('cancels video export without leaving a final or partial file', async () => {
  test.setTimeout(60_000)
  const outputDirectory = resolve(process.cwd(), 'test-results', 'video-export-cancel')
  const videoPath = resolve(outputDirectory, '取消测试.mp4')
  rmSync(outputDirectory, { recursive: true, force: true })
  mkdirSync(outputDirectory, { recursive: true })
  const electronApp = await launchIsolatedElectron()

  try {
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, videoPath)
    const window = await electronApp.firstWindow()
    await window.setViewportSize({ width: 1440, height: 900 })
    await expect(window.locator('canvas[data-scene-ready="true"]')).toBeVisible({ timeout: 15_000 })
    await window.getByRole('button', { name: '添加方块' }).click()
    await window.getByRole('button', { name: '记录物体状态', exact: true }).click()
    await window.getByRole('button', { name: '导出图片、视频或三维模型' }).click()
    await window.getByRole('button', { name: '按平台预设导出 MP4 视频' }).click()
    await window
      .getByRole('dialog', { name: '选择视频用途' })
      .getByRole('button', { name: '导出 MP4' })
      .click()

    const progressDialog = window.getByRole('dialog', { name: '正在生成视频' })
    await expect(progressDialog).toBeVisible({ timeout: 15_000 })
    await progressDialog.getByRole('button', { name: '取消导出' }).click()
    await expect(window.getByRole('status')).toContainText('视频导出已取消', { timeout: 30_000 })
    expect(existsSync(videoPath)).toBe(false)
    expect(readdirSync(outputDirectory).some((name) => name.endsWith('.partial'))).toBe(false)
  } finally {
    await forceCloseElectron(electronApp)
  }
})
