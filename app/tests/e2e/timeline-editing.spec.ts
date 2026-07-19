import { expect, test } from '@playwright/test'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { launchIsolatedElectron } from './launch-app'

function pngDimensions(buffer: Buffer): { width: number; height: number } {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function exportedSequenceDirectory(root: string): string {
  const directory = readdirSync(root, { withFileTypes: true }).find((entry) => entry.isDirectory())
  if (!directory) throw new Error('No animation sequence directory was created')
  return join(root, directory.name)
}

test('drags, copies and previews timeline states without overwriting recorded motion', async () => {
  test.setTimeout(45_000)
  const electronApp = await launchIsolatedElectron()

  try {
    const window = await electronApp.firstWindow()
    const pageErrors: string[] = []
    window.on('pageerror', (error) => pageErrors.push(error.message))
    window.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text())
    })

    await window.setViewportSize({ width: 1440, height: 900 })
    const canvas = window.locator('canvas[data-scene-ready="true"]')
    await expect(canvas).toBeVisible({ timeout: 15_000 })
    await window.getByRole('button', { name: '添加方块' }).click()
    await window.getByRole('button', { name: '动画时间轴', exact: true }).click()

    const trackArea = window.locator('.track-area')
    const initialBounds = await trackArea.boundingBox()
    if (!initialBounds) throw new Error('Timeline track has no visible bounds')
    await window.mouse.click(initialBounds.x + 2, initialBounds.y + initialBounds.height * 0.6)
    await window.getByRole('button', { name: '记录物体状态', exact: true }).click()

    const expandedBounds = await trackArea.boundingBox()
    if (!expandedBounds) throw new Error('Expanded timeline track has no visible bounds')
    await window.mouse.click(
      expandedBounds.x + expandedBounds.width * 0.8,
      expandedBounds.y + expandedBounds.height * 0.82
    )
    await window.getByLabel('位置 X').fill('4')
    await window.getByLabel('位置 X').press('Enter')
    await window.getByRole('button', { name: '记录物体状态', exact: true }).click()

    const objectMarkers = window.locator('[data-marker-kind="object"]')
    await expect(objectMarkers).toHaveCount(2)
    const firstMarker = objectMarkers.first()
    const firstBounds = await firstMarker.boundingBox()
    if (!firstBounds) throw new Error('Object marker has no visible bounds')
    await window.mouse.move(
      firstBounds.x + firstBounds.width / 2,
      firstBounds.y + firstBounds.height / 2
    )
    await window.mouse.down()
    await window.mouse.move(expandedBounds.x + expandedBounds.width * 0.4, firstBounds.y + 7, {
      steps: 10
    })
    await window.mouse.up()

    await expect(window.getByRole('status')).toContainText('记录点已移动到')
    const draggedTime = Number(await objectMarkers.first().getAttribute('data-marker-time'))
    expect(draggedTime).toBeGreaterThan(1.8)
    expect(draggedTime).toBeLessThan(2.2)
    await expect(objectMarkers).toHaveCount(2)

    await window.getByRole('button', { name: '撤销', exact: true }).click()
    expect(Number(await objectMarkers.first().getAttribute('data-marker-time'))).toBeCloseTo(0, 3)

    await objectMarkers.first().click()
    await window.getByRole('button', { name: '复制物体状态记录点' }).click()
    await expect(objectMarkers).toHaveCount(3)
    const timesAfterCopy = await objectMarkers.evaluateAll((markers) =>
      markers.map((marker) => marker.getAttribute('data-marker-time'))
    )
    expect(new Set(timesAfterCopy).size).toBe(3)

    const selectedMarker = window.locator('[data-marker-kind="object"].is-selected')
    const beforeKeyboardMove = Number(await selectedMarker.getAttribute('data-marker-time'))
    await selectedMarker.focus()
    await selectedMarker.press('ArrowRight')
    const afterKeyboardMove = Number(await selectedMarker.getAttribute('data-marker-time'))
    expect(afterKeyboardMove).toBeGreaterThan(beforeKeyboardMove)

    await window.getByRole('button', { name: '播放动画' }).click()
    await expect(window.getByRole('button', { name: '暂停预览' })).toBeVisible()
    await window.waitForTimeout(250)
    await window.getByRole('button', { name: '暂停预览' }).click()
    await expect(canvas).toHaveAttribute('data-animated-object-count', '1')

    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-3c-timeline-editing-1440x900.png'),
      animations: 'disabled'
    })
    await window.setViewportSize({ width: 1280, height: 720 })
    await expect(window.getByLabel('动画时间轴')).toBeVisible()
    const timelineMetrics = await window.locator('.timeline-content').evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }))
    expect(timelineMetrics.scrollHeight).toBeLessThanOrEqual(timelineMetrics.clientHeight)
    const lastTrackBounds = await window.locator('.track-row').last().boundingBox()
    const timelinePanelBounds = await window.getByLabel('动画时间轴').boundingBox()
    if (!lastTrackBounds || !timelinePanelBounds) {
      throw new Error('Timeline rows have no visible bounds')
    }
    expect(lastTrackBounds.y + lastTrackBounds.height).toBeLessThanOrEqual(
      timelinePanelBounds.y + timelinePanelBounds.height
    )
    await expect(window.getByLabel('时间轴总时长')).toBeInViewport()
    expect(await window.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      1280
    )
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-3c-timeline-editing-1280x720.png'),
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

test('exports deterministic animation frames incrementally and records a complete manifest', async () => {
  test.setTimeout(45_000)
  const outputRoot = resolve(process.cwd(), 'test-results', 'animation-sequence-complete')
  rmSync(outputRoot, { recursive: true, force: true })
  mkdirSync(outputRoot, { recursive: true })
  const electronApp = await launchIsolatedElectron()

  try {
    await electronApp.evaluate(({ dialog }, directoryPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directoryPath] })
    }, outputRoot)
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

    await window.getByRole('button', { name: '导出图片、视频或三维模型' }).click()
    await window.locator('summary', { hasText: '高级导出与检查' }).click()
    await window.getByRole('button', { name: '导出动画帧序列' }).click()
    const progressDialog = window.getByRole('dialog', { name: '正在导出动画帧' })
    await expect(progressDialog).toBeVisible()
    await window.screenshot({
      path: resolve(
        process.cwd(),
        '..',
        'artifacts',
        'stage-3c-frame-export-progress-1440x900.png'
      ),
      animations: 'disabled'
    })
    await expect(window.getByRole('status')).toContainText('动画帧已导出：31 张 PNG', {
      timeout: 30_000
    })
    await expect(progressDialog).toBeHidden()

    const directory = exportedSequenceDirectory(outputRoot)
    const files = readdirSync(directory)
    const pngFiles = files.filter((name) => name.endsWith('.png')).sort()
    expect(pngFiles).toHaveLength(31)
    const manifestName = files.find((name) => name.endsWith('_动画帧.json'))
    if (!manifestName) throw new Error('Animation sequence manifest is missing')
    const manifest = JSON.parse(readFileSync(join(directory, manifestName), 'utf8')) as {
      complete: boolean
      totalFrames: number
      frameRate: number
    }
    expect(manifest).toMatchObject({ complete: true, totalFrames: 31, frameRate: 30 })
    const first = readFileSync(join(directory, pngFiles[0]))
    const last = readFileSync(join(directory, pngFiles.at(-1)!))
    expect(pngDimensions(first)).toEqual(pngDimensions(last))
    expect(first.equals(last)).toBe(false)
    expect(pageErrors).toEqual([])
  } finally {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    await electronApp.close()
  }
})

test('cancels an animation frame export without deleting frames already written', async () => {
  test.setTimeout(45_000)
  const outputRoot = resolve(process.cwd(), 'test-results', 'animation-sequence-cancelled')
  rmSync(outputRoot, { recursive: true, force: true })
  mkdirSync(outputRoot, { recursive: true })
  const electronApp = await launchIsolatedElectron()

  try {
    await electronApp.evaluate(({ dialog }, directoryPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directoryPath] })
    }, outputRoot)
    const window = await electronApp.firstWindow()
    await window.setViewportSize({ width: 1440, height: 900 })
    await expect(window.locator('canvas[data-scene-ready="true"]')).toBeVisible({
      timeout: 15_000
    })
    await window.getByRole('button', { name: '添加方块' }).click()
    await window.getByRole('button', { name: '记录物体状态', exact: true }).click()
    const trackArea = window.locator('.track-area')
    const bounds = await trackArea.boundingBox()
    if (!bounds) throw new Error('Timeline track has no visible bounds')
    await window.mouse.click(bounds.x + bounds.width * 0.9, bounds.y + bounds.height * 0.8)
    await window.getByLabel('位置 X').fill('4')
    await window.getByLabel('位置 X').press('Enter')
    await window.getByRole('button', { name: '记录物体状态', exact: true }).click()

    await window.getByRole('button', { name: '导出图片、视频或三维模型' }).click()
    await window.locator('summary', { hasText: '高级导出与检查' }).click()
    await window.getByRole('button', { name: '导出动画帧序列' }).click()
    const progressDialog = window.getByRole('dialog', { name: '正在导出动画帧' })
    await expect(progressDialog).toBeVisible()
    await progressDialog.getByRole('button', { name: '取消导出' }).click()
    await expect(window.getByRole('status')).toContainText('已取消，保留', { timeout: 30_000 })
    await expect(progressDialog).toBeHidden()

    const directory = exportedSequenceDirectory(outputRoot)
    const files = readdirSync(directory)
    expect(files.some((name) => name.endsWith('.png'))).toBe(true)
    const manifestName = files.find((name) => name.endsWith('_动画帧.json'))
    expect(manifestName).toBeTruthy()
    const manifestPath = join(directory, manifestName!)
    expect(existsSync(manifestPath)).toBe(true)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      complete: boolean
      writtenFrames: number
    }
    expect(manifest.complete).toBe(false)
    expect(manifest.writtenFrames).toBeGreaterThan(0)
  } finally {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    await electronApp.close()
  }
})
