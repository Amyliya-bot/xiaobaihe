import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { PerspectiveCamera, Vector3 } from 'three'
import {
  createIsolatedUserDataPath,
  launchElectronWithUserData,
  launchIsolatedElectron
} from './launch-app'

async function expectStableLayout(window: Page): Promise<void> {
  const audit = await window.evaluate(() => {
    const visible = (element: Element): boolean => {
      const bounds = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden'
    }
    const unnamedButtons = [...document.querySelectorAll('button')]
      .filter(visible)
      .filter(
        (button) =>
          !button.getAttribute('aria-label') &&
          !button.getAttribute('title') &&
          !button.textContent?.trim()
      )
      .map((button) => button.outerHTML.slice(0, 160))
    const overflowingButtons = [...document.querySelectorAll('button')]
      .filter(visible)
      .filter(
        (button) =>
          button.scrollWidth > button.clientWidth + 2 ||
          button.scrollHeight > button.clientHeight + 2
      )
      .map(
        (button) =>
          button.getAttribute('aria-label') ?? button.getAttribute('title') ?? button.textContent
      )
    const bounds = (selector: string): DOMRect | null =>
      document.querySelector(selector)?.getBoundingClientRect() ?? null
    const left = bounds('.left-panel')
    const viewport = bounds('.viewport-panel')
    const right = bounds('.right-panel')
    const timeline = bounds('.timeline-panel')
    return {
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      unnamedButtons,
      overflowingButtons,
      panelOrder:
        Boolean(left && viewport && right) &&
        left!.right <= viewport!.left + 1 &&
        viewport!.right <= right!.left + 1,
      timelineOrder: Boolean(viewport && timeline) && viewport!.bottom <= timeline!.top + 1
    }
  })

  expect(audit).toEqual({
    horizontalOverflow: false,
    unnamedButtons: [],
    overflowingButtons: [],
    panelOrder: true,
    timelineOrder: true
  })
}

test('guides first-time users through the three ordinary-language steps', async () => {
  const electronApp = await launchElectronWithUserData(createIsolatedUserDataPath(), false)
  try {
    const window = await electronApp.firstWindow()
    const guide = window.getByRole('dialog', { name: '快速开始' })
    await expect(guide).toBeVisible({ timeout: 15_000 })
    await expect(guide).toContainText('搭场景')
    await expect(guide).toContainText('调镜头与动作')
    await expect(guide).toContainText('导出作品')
    await expect
      .poll(() =>
        window.evaluate(() => {
          const active = document.activeElement
          const dialog = document.querySelector('[role="dialog"]')
          return Boolean(active && dialog?.contains(active))
        })
      )
      .toBe(true)
    await window.getByRole('button', { name: '开始搭建' }).click()
    await expect(guide).toBeHidden()
    expect(
      await window.evaluate(() =>
        window.localStorage.getItem('whitebox-studio-onboarding-complete-v1')
      )
    ).toBe('true')
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
    await electronApp.close().catch(() => undefined)
  }
})

test('keeps keyboard focus inside dialogs and commits one undo step for a slider gesture', async () => {
  const electronApp = await launchIsolatedElectron()
  try {
    const window = await electronApp.firstWindow()
    await window.setViewportSize({ width: 1440, height: 900 })
    const canvas = window.locator('canvas[data-scene-ready="true"]')
    await expect(canvas).toBeVisible({ timeout: 15_000 })
    await expect(window.getByRole('button', { name: '动画时间轴', exact: true })).toHaveAttribute(
      'aria-expanded',
      'false'
    )

    const exportButton = window.getByRole('button', { name: '导出图片、视频或三维模型' })
    await exportButton.click()
    const exportDialog = window.getByRole('dialog', { name: '导出作品' })
    await expect(exportDialog).toBeVisible()
    for (let index = 0; index < 8; index += 1) {
      await window.keyboard.press('Tab')
      expect(
        await window.evaluate(() => {
          const active = document.activeElement
          const dialog = document.querySelector('[role="dialog"]')
          return Boolean(active && dialog?.contains(active))
        })
      ).toBe(true)
    }
    await window.keyboard.press('Escape')
    await expect(exportDialog).toBeHidden()
    await expect(exportButton).toBeFocused()

    await window.getByRole('button', { name: '主相机', exact: true }).click()
    const slider = window.getByRole('slider', { name: '摄影机视野' })
    const originalFov = await canvas.getAttribute('data-output-camera-fov')
    await slider.fill('50')
    await slider.fill('60')
    await slider.fill('70')
    await expect(canvas).toHaveAttribute('data-output-camera-fov', '70')
    await slider.press('Tab')
    await window.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-output-camera-fov', originalFov ?? '42')
  } finally {
    await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => undefined)
    await electronApp.close().catch(() => undefined)
  }
})

test('keeps the live camera monitor editable and fullscreen preview escapable', async () => {
  test.setTimeout(45_000)
  const electronApp = await launchIsolatedElectron()

  try {
    const window = await electronApp.firstWindow()
    const pageErrors: string[] = []
    window.on('pageerror', (error) => pageErrors.push(error.message))
    window.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text())
    })
    await window.setViewportSize({ width: 1280, height: 720 })
    await expect(window.locator('canvas[data-scene-ready="true"]')).toBeVisible({
      timeout: 15_000
    })

    await window.getByRole('button', { name: '添加方块' }).click()
    const rightPanel = window.getByLabel('属性面板')
    await rightPanel.evaluate((panel) => {
      panel.scrollTop = panel.scrollHeight
    })
    expect(await rightPanel.evaluate((panel) => panel.scrollTop)).toBeGreaterThan(0)

    const mainCamera = window.getByRole('button', { name: '主相机', exact: true })
    await mainCamera.click()
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-monitor', 'true')
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-preview', 'false')
    expect(await rightPanel.evaluate((panel) => panel.scrollTop)).toBe(0)
    await expect(window.getByLabel('实时摄影机取景窗')).toBeVisible()
    await expect(window.getByLabel('摄影机实时画面 16:9')).toBeVisible()
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-gizmo', 'translate')

    await window.getByRole('button', { name: '选择 方块 01', exact: true }).click()
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-monitor', 'true')
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-preview', 'false')
    await expect(rightPanel.getByRole('textbox', { name: '对象名称' })).toHaveValue('方块 01')
    await window.getByLabel('位置 X').fill('2')
    await window.getByLabel('位置 X').press('Enter')
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-monitor', 'true')
    await window.getByRole('button', { name: '关闭实时取景窗' }).click()
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-monitor', 'false')

    await mainCamera.click()
    await window.getByRole('button', { name: '转向', exact: true }).click()
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-gizmo', 'aim')
    const canvas = window.locator('canvas')
    const canvasBounds = await canvas.boundingBox()
    if (!canvasBounds) throw new Error('Scene canvas has no visible bounds')
    const editorPosition = JSON.parse(
      (await canvas.getAttribute('data-camera-position')) ?? '{}'
    ) as { x: number; y: number; z: number }
    const editorTarget = JSON.parse((await canvas.getAttribute('data-camera-target')) ?? '{}') as {
      x: number
      y: number
      z: number
    }
    const outputTargetBefore = JSON.parse(
      (await canvas.getAttribute('data-output-camera-target')) ?? '{}'
    ) as { x: number; y: number; z: number }
    const editorCamera = new PerspectiveCamera(
      42,
      canvasBounds.width / canvasBounds.height,
      0.1,
      180
    )
    editorCamera.position.set(editorPosition.x, editorPosition.y, editorPosition.z)
    editorCamera.lookAt(editorTarget.x, editorTarget.y, editorTarget.z)
    editorCamera.updateProjectionMatrix()
    editorCamera.updateMatrixWorld()
    const targetScreen = new Vector3(
      outputTargetBefore.x,
      outputTargetBefore.y,
      outputTargetBefore.z
    ).project(editorCamera)
    const targetX = canvasBounds.x + ((targetScreen.x + 1) / 2) * canvasBounds.width
    const targetY = canvasBounds.y + ((1 - targetScreen.y) / 2) * canvasBounds.height
    await window.mouse.move(targetX, targetY)
    await window.mouse.down()
    await window.mouse.move(targetX + 52, targetY - 24, { steps: 10 })
    await window.mouse.up()
    await expect
      .poll(async () => canvas.getAttribute('data-output-camera-target'))
      .not.toBe(JSON.stringify(outputTargetBefore))
    await window.getByRole('button', { name: '全屏取景', exact: true }).click()
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-preview', 'true')
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-monitor', 'false')
    await window.keyboard.press('Escape')
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-preview', 'false')

    await mainCamera.click()
    const themeButton = window.getByRole('button', { name: /切换到.+主题/ })
    await themeButton.click()
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-monitor', 'true')
    await expect(window.getByLabel('实时摄影机取景窗')).toBeVisible()

    await window.getByRole('button', { name: '固定场景光', exact: true }).click()
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-monitor', 'true')
    await expect(window.locator('canvas')).toHaveAttribute('data-camera-preview', 'false')
    await expect(rightPanel.getByRole('heading', { name: '固定场景光' })).toBeVisible()
    await window.getByRole('button', { name: '关闭实时取景窗' }).click()

    await expectStableLayout(window)
    await window.setViewportSize({ width: 1440, height: 900 })
    await expectStableLayout(window)
    await mainCamera.click()
    await expect(window.getByLabel('实时摄影机取景窗')).toBeVisible()
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-10-camera-monitor-dark-1440x900.png'),
      animations: 'disabled'
    })
    await expect(window.locator('canvas[data-scene-ready="true"]')).toBeVisible()
    expect(pageErrors).toEqual([])
  } finally {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    await electronApp.close()
  }
})

test('keeps the editor canvas usable while syncing its view to the output camera', async () => {
  test.setTimeout(30_000)
  const electronApp = await launchIsolatedElectron()

  try {
    const window = await electronApp.firstWindow()
    await window.setViewportSize({ width: 1440, height: 900 })
    const canvas = window.locator('canvas[data-scene-ready="true"]')
    await expect(canvas).toBeVisible({ timeout: 15_000 })
    const expectEditorCameraSynced = async (): Promise<void> => {
      await expect
        .poll(async () => {
          const editor = JSON.parse(
            (await canvas.getAttribute('data-camera-position')) ?? '{}'
          ) as {
            x: number
            y: number
            z: number
          }
          const output = JSON.parse(
            (await canvas.getAttribute('data-output-camera-position')) ?? '{}'
          ) as { x: number; y: number; z: number }
          return Math.hypot(editor.x - output.x, editor.y - output.y, editor.z - output.z)
        })
        .toBeLessThan(0.001)
      await expect
        .poll(async () => {
          const editor = JSON.parse((await canvas.getAttribute('data-camera-target')) ?? '{}') as {
            x: number
            y: number
            z: number
          }
          const output = JSON.parse(
            (await canvas.getAttribute('data-output-camera-target')) ?? '{}'
          ) as { x: number; y: number; z: number }
          return Math.hypot(editor.x - output.x, editor.y - output.y, editor.z - output.z)
        })
        .toBeLessThan(0.001)
    }
    const waitForEditorCameraToSettle = async (): Promise<void> => {
      await expect
        .poll(
          async () => {
            const before = JSON.parse(
              (await canvas.getAttribute('data-camera-position')) ?? '{}'
            ) as { x: number; y: number; z: number }
            await window.waitForTimeout(120)
            const after = JSON.parse(
              (await canvas.getAttribute('data-camera-position')) ?? '{}'
            ) as { x: number; y: number; z: number }
            return Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z)
          },
          { timeout: 5_000 }
        )
        .toBeLessThan(0.005)
    }
    await window.getByRole('button', { name: '添加方块' }).click()
    await expect(window.getByRole('button', { name: '选择 方块 01', exact: true })).toBeVisible()
    const mainCamera = window.getByRole('button', { name: '主相机', exact: true })
    await mainCamera.click()
    await window.getByRole('slider', { name: '摄影机视野' }).fill('70')
    await expect(canvas).toHaveAttribute('data-output-camera-fov', '70')
    const ordinaryCanvasBounds = await canvas.boundingBox()
    if (!ordinaryCanvasBounds) throw new Error('Ordinary canvas bounds are unavailable')
    const ordinaryOrbitStart = {
      x: ordinaryCanvasBounds.x + ordinaryCanvasBounds.width * 0.72,
      y: ordinaryCanvasBounds.y + ordinaryCanvasBounds.height * 0.66
    }
    const initialEditorCamera = await canvas.getAttribute('data-camera-position')
    await window.mouse.move(ordinaryOrbitStart.x, ordinaryOrbitStart.y)
    await window.mouse.down({ button: 'middle' })
    await window.mouse.move(ordinaryOrbitStart.x + 85, ordinaryOrbitStart.y - 40, { steps: 8 })
    await window.mouse.up({ button: 'middle' })
    await expect
      .poll(async () => canvas.getAttribute('data-camera-position'))
      .not.toBe(initialEditorCamera)
    await waitForEditorCameraToSettle()
    const editorCameraBeforeControl = await canvas.getAttribute('data-camera-position')
    const editorTargetBeforeControl = await canvas.getAttribute('data-camera-target')
    const editorFovBeforeControl = await canvas.getAttribute('data-camera-fov')
    const outputCameraBeforeAlignment = await canvas.getAttribute('data-output-camera-position')
    expect(outputCameraBeforeAlignment).not.toBe(editorCameraBeforeControl)
    await mainCamera.click({ button: 'right' })
    await expect(canvas).toHaveAttribute('data-first-person-camera', 'true')
    await expect(canvas).toHaveAttribute('data-first-person-view', 'editor-camera-synced')
    await expect(canvas).toHaveAttribute('data-output-camera-fov', editorFovBeforeControl ?? '')
    const alignedOutputCamera = JSON.parse(
      (await canvas.getAttribute('data-output-camera-position')) ?? '{}'
    ) as { x: number; y: number; z: number }
    const alignedOutputTarget = JSON.parse(
      (await canvas.getAttribute('data-output-camera-target')) ?? '{}'
    ) as { x: number; y: number; z: number }
    const editorCameraAfterControl = await canvas.getAttribute('data-camera-position')
    const editorTargetAfterControl = await canvas.getAttribute('data-camera-target')
    const editorCamera = JSON.parse(editorCameraAfterControl ?? '{}') as {
      x: number
      y: number
      z: number
    }
    const editorTarget = JSON.parse(editorTargetAfterControl ?? '{}') as {
      x: number
      y: number
      z: number
    }
    const editorCameraBeforeEntry = JSON.parse(editorCameraBeforeControl ?? '{}') as {
      x: number
      y: number
      z: number
    }
    const editorTargetBeforeEntry = JSON.parse(editorTargetBeforeControl ?? '{}') as {
      x: number
      y: number
      z: number
    }
    expect(
      Math.hypot(
        editorCamera.x - editorCameraBeforeEntry.x,
        editorCamera.y - editorCameraBeforeEntry.y,
        editorCamera.z - editorCameraBeforeEntry.z
      )
    ).toBeLessThan(0.01)
    expect(
      Math.hypot(
        editorTarget.x - editorTargetBeforeEntry.x,
        editorTarget.y - editorTargetBeforeEntry.y,
        editorTarget.z - editorTargetBeforeEntry.z
      )
    ).toBeLessThan(0.01)
    expect(
      Math.hypot(
        alignedOutputCamera.x - editorCamera.x,
        alignedOutputCamera.y - editorCamera.y,
        alignedOutputCamera.z - editorCamera.z
      )
    ).toBeLessThan(0.001)
    await expectEditorCameraSynced()
    await expect(canvas).toHaveAttribute('data-grid-triangles', '2')
    expect(
      Math.hypot(
        alignedOutputTarget.x - editorTarget.x,
        alignedOutputTarget.y - editorTarget.y,
        alignedOutputTarget.z - editorTarget.z
      )
    ).toBeLessThan(0.001)
    await expect(canvas).toHaveAttribute('data-camera-monitor', 'true')
    await expect(window.getByLabel('第一人称控制已开启')).toBeVisible()
    const hint = window.getByRole('status').filter({ hasText: '画布操作同步镜头' })
    await expect(hint).toBeVisible()

    const monitor = window.getByLabel('实时摄影机取景窗')
    const monitorViewport = window.getByLabel('摄影机实时画面 16:9')
    const monitorHeader = monitor.locator('.camera-monitor-header')
    const initialMonitor = await monitor.boundingBox()
    const initialHeader = await monitorHeader.boundingBox()
    if (!initialMonitor || !initialHeader) throw new Error('Live monitor has no visible bounds')
    await window.mouse.move(
      initialHeader.x + initialHeader.width * 0.45,
      initialHeader.y + initialHeader.height / 2
    )
    await window.mouse.down()
    await window.mouse.move(initialHeader.x - 70, initialHeader.y + 70, { steps: 8 })
    await window.mouse.up()
    const movedMonitor = await monitor.boundingBox()
    if (!movedMonitor) throw new Error('Moved monitor disappeared')
    expect(
      Math.hypot(movedMonitor.x - initialMonitor.x, movedMonitor.y - initialMonitor.y)
    ).toBeGreaterThan(40)

    const initialViewport = await monitorViewport.boundingBox()
    if (!initialViewport) throw new Error('Monitor viewport has no visible bounds')
    expect(initialViewport.width / initialViewport.height).toBeCloseTo(16 / 9, 2)

    const resizeHandle = window.getByRole('button', { name: '从右侧等比缩放取景窗' })
    const resizeBounds = await resizeHandle.boundingBox()
    if (!resizeBounds) throw new Error('Monitor resize handle has no visible bounds')
    const resizeStart = {
      x: resizeBounds.x + resizeBounds.width / 2,
      y: resizeBounds.y + resizeBounds.height / 2
    }
    await window.mouse.move(resizeStart.x, resizeStart.y)
    await window.mouse.down()
    await window.mouse.move(resizeStart.x + 90, resizeStart.y, { steps: 8 })
    await window.mouse.up()
    const resizedMonitor = await monitor.boundingBox()
    if (!resizedMonitor) throw new Error('Resized monitor disappeared')
    expect(resizedMonitor.width).toBeGreaterThan(movedMonitor.width + 50)
    const enlargedViewport = await monitorViewport.boundingBox()
    if (!enlargedViewport) throw new Error('Resized monitor viewport disappeared')
    expect(enlargedViewport.width / enlargedViewport.height).toBeCloseTo(16 / 9, 2)
    const enlargedResizeBounds = await resizeHandle.boundingBox()
    if (!enlargedResizeBounds) throw new Error('Enlarged monitor resize handle disappeared')
    await window.mouse.move(
      enlargedResizeBounds.x + enlargedResizeBounds.width / 2,
      enlargedResizeBounds.y + enlargedResizeBounds.height / 2
    )
    await window.mouse.down()
    await window.mouse.move(enlargedResizeBounds.x - 55, enlargedResizeBounds.y, { steps: 6 })
    await window.mouse.up()
    const reducedMonitor = await monitor.boundingBox()
    if (!reducedMonitor) throw new Error('Reduced monitor disappeared')
    expect(reducedMonitor.width).toBeLessThan(resizedMonitor.width - 35)

    await window.getByRole('button', { name: '9:16', exact: true }).click()
    const portraitViewport = window.getByLabel('摄影机实时画面 9:16')
    await expect(portraitViewport).toBeVisible()
    const portraitBounds = await portraitViewport.boundingBox()
    const portraitWindowBounds = await monitor.boundingBox()
    const stageBounds = await window.getByRole('region', { name: '三维场景' }).boundingBox()
    if (!portraitBounds || !portraitWindowBounds || !stageBounds) {
      throw new Error('Portrait monitor bounds are unavailable')
    }
    expect(portraitBounds.width / portraitBounds.height).toBeCloseTo(9 / 16, 2)
    expect(portraitWindowBounds.y + portraitWindowBounds.height).toBeLessThanOrEqual(
      stageBounds.y + stageBounds.height
    )

    const editorCameraBefore = await canvas.getAttribute('data-camera-position')
    const outputCameraBefore = await canvas.getAttribute('data-output-camera-position')
    const canvasBounds = await canvas.boundingBox()
    if (!canvasBounds) throw new Error('Scene canvas has no visible bounds')
    const dragStart = {
      x: canvasBounds.x + canvasBounds.width * 0.15,
      y: canvasBounds.y + canvasBounds.height * 0.72
    }
    await window.mouse.move(dragStart.x, dragStart.y)
    await window.mouse.down()
    await window.mouse.move(dragStart.x + 70, dragStart.y - 35, { steps: 8 })
    await window.mouse.up()
    await expect
      .poll(async () => canvas.getAttribute('data-output-camera-position'))
      .not.toBe(outputCameraBefore)
    await expect
      .poll(async () => canvas.getAttribute('data-camera-position'))
      .not.toBe(editorCameraBefore)
    await expectEditorCameraSynced()
    await window.waitForTimeout(500)

    const outputPositionBeforeOrbit = await canvas.getAttribute('data-output-camera-position')
    await window.mouse.move(dragStart.x, dragStart.y)
    await window.mouse.down({ button: 'middle' })
    await window.mouse.move(dragStart.x - 65, dragStart.y + 30, { steps: 8 })
    await window.mouse.up({ button: 'middle' })
    await expect
      .poll(async () => canvas.getAttribute('data-output-camera-position'))
      .not.toBe(outputPositionBeforeOrbit)
    await expectEditorCameraSynced()
    await window.waitForTimeout(500)

    const outputPositionBeforeZoom = await canvas.getAttribute('data-output-camera-position')
    await window.mouse.move(dragStart.x, dragStart.y)
    await window.mouse.wheel(0, -180)
    await expect
      .poll(async () => canvas.getAttribute('data-output-camera-position'))
      .not.toBe(outputPositionBeforeZoom)
    await expectEditorCameraSynced()

    await window.getByRole('button', { name: '选择 方块 01', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-selected-count', '1')
    const positionX = window.getByLabel('位置 X')
    const positionXBefore = Number.parseFloat(await positionX.inputValue())
    await positionX.fill(String(positionXBefore + 1))
    await positionX.press('Enter')
    await expect(positionX).toHaveValue((positionXBefore + 1).toFixed(2))
    await expect(canvas).toHaveAttribute('data-first-person-camera', 'true')
    await mainCamera.click()

    await expect(hint).toBeHidden({ timeout: 6_500 })
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-20-first-person-camera-1440x900.png'),
      animations: 'disabled'
    })
    await window.setViewportSize({ width: 1280, height: 720 })
    const compactCanvasBounds = await canvas.boundingBox()
    const compactMonitorBounds = await monitor.boundingBox()
    const compactStageBounds = await window.getByRole('region', { name: '三维场景' }).boundingBox()
    if (!compactCanvasBounds || !compactMonitorBounds || !compactStageBounds) {
      throw new Error('Compact first-person layout bounds are unavailable')
    }
    expect(compactMonitorBounds.x).toBeGreaterThanOrEqual(compactStageBounds.x)
    expect(compactMonitorBounds.y).toBeGreaterThanOrEqual(compactStageBounds.y)
    expect(compactMonitorBounds.x + compactMonitorBounds.width).toBeLessThanOrEqual(
      compactStageBounds.x + compactStageBounds.width
    )
    expect(compactMonitorBounds.y + compactMonitorBounds.height).toBeLessThanOrEqual(
      compactStageBounds.y + compactStageBounds.height
    )
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-20-first-person-camera-1280x720.png'),
      animations: 'disabled'
    })
    await window.keyboard.press('Escape')
    await expect(canvas).toHaveAttribute('data-first-person-camera', 'false')
    await expect(canvas).toHaveAttribute('data-camera-monitor', 'true')
  } finally {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    await electronApp.close()
  }
})

test('keeps ordinary canvas clicks and drags out of camera preview', async () => {
  test.setTimeout(30_000)
  const electronApp = await launchIsolatedElectron()

  try {
    const window = await electronApp.firstWindow()
    await window.setViewportSize({ width: 1440, height: 900 })
    const canvas = window.locator('canvas[data-scene-ready="true"]')
    await expect(canvas).toBeVisible({ timeout: 15_000 })
    await expect(canvas).toHaveAttribute('data-camera-preview', 'false')
    const bounds = await canvas.boundingBox()
    if (!bounds) throw new Error('Scene canvas has no visible bounds')

    await window.mouse.click(bounds.x + bounds.width * 0.78, bounds.y + bounds.height * 0.72)
    await expect(canvas).toHaveAttribute('data-camera-preview', 'false')
    await window.mouse.click(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5)
    await expect(canvas).toHaveAttribute('data-camera-preview', 'false')

    await window.mouse.click(bounds.x + bounds.width * 0.5, bounds.y + 2)
    await expect(canvas).toHaveAttribute('data-camera-monitor', 'true')
    await window.getByRole('button', { name: '关闭实时取景窗' }).click()
    await expect(canvas).toHaveAttribute('data-camera-monitor', 'false')

    await window.mouse.move(bounds.x + bounds.width * 0.68, bounds.y + bounds.height * 0.68)
    await window.mouse.down()
    await window.mouse.move(bounds.x + bounds.width * 0.6, bounds.y + bounds.height * 0.62, {
      steps: 8
    })
    await window.mouse.up()
    await expect(canvas).toHaveAttribute('data-camera-preview', 'false')

    await window.getByRole('button', { name: '添加方块' }).click()
    await window.getByRole('button', { name: '聚焦查看 方块 01' }).click()
    await window.mouse.click(bounds.x + bounds.width * 0.5, bounds.y + bounds.height * 0.5)
    await expect(canvas).toHaveAttribute('data-camera-preview', 'false')
    await expect(canvas).toHaveAttribute('data-selected-count', '1')
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-7-camera-guide-hit-safe-1440x900.png'),
      animations: 'disabled'
    })

    await window.getByRole('button', { name: '主相机', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-camera-monitor', 'true')
  } finally {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    await electronApp.close()
  }
})

test('preserves active modeling tools when the theme rebuilds the Three.js scene', async () => {
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
    const themeButton = window.getByRole('button', { name: /切换到(白色|黑色)主题/ })

    await window.getByRole('button', { name: '在模型面上继续画' }).click()
    await expect(canvas).toHaveAttribute('data-surface-pick', 'true')
    await themeButton.click()
    await expect(window.getByLabel('选择模型表面')).toBeVisible()
    await expect(canvas).toHaveAttribute('data-surface-pick', 'true')
    await window.keyboard.press('Escape')
    await expect(canvas).toHaveAttribute('data-surface-pick', 'false')

    await window.getByRole('button', { name: '绘制自定义形状' }).click()
    await expect(window.getByLabel('画布建模工具')).toBeVisible()
    await expect(canvas).toHaveAttribute('data-modeling-mode', 'vertex')
    await themeButton.click()
    await expect(window.getByLabel('画布建模工具')).toBeVisible()
    await expect(canvas).toHaveAttribute('data-modeling-mode', 'vertex')
    await window.keyboard.press('Escape')
    await expect(window.getByLabel('画布建模工具')).toBeHidden()

    await window.getByRole('button', { name: '选择 方块 01', exact: true }).click()
    await window.getByRole('button', { name: '平面切割', exact: true }).click()
    await expect(window.getByLabel('平面切割工具')).toBeVisible()
    await expect(canvas).toHaveAttribute('data-cut-preview', /x:/)
    await themeButton.click()
    await expect(window.getByLabel('平面切割工具')).toBeVisible()
    await expect(canvas).toHaveAttribute('data-cut-preview', /x:/)
    await window.keyboard.press('Escape')
    await expect(window.getByLabel('平面切割工具')).toBeHidden()

    await window.getByRole('button', { name: '动画时间轴', exact: true }).click()
    const timelineTrack = window.locator('.track-area')
    const initialTrackBounds = await timelineTrack.boundingBox()
    if (!initialTrackBounds) throw new Error('Object timeline has no visible bounds')
    await window.mouse.click(
      initialTrackBounds.x + 2,
      initialTrackBounds.y + initialTrackBounds.height * 0.6
    )
    const startX = Number.parseFloat(await window.getByLabel('位置 X').inputValue())
    await window.getByRole('button', { name: '记录物体状态', exact: true }).click()
    await window.mouse.click(
      initialTrackBounds.x + initialTrackBounds.width * 0.8,
      initialTrackBounds.y + initialTrackBounds.height * 0.6
    )
    await window.getByLabel('位置 X').fill(String(startX + 4))
    await window.getByLabel('位置 X').press('Enter')
    await window.getByRole('button', { name: '记录物体状态', exact: true }).click()

    const expandedTrackBounds = await timelineTrack.boundingBox()
    if (!expandedTrackBounds) throw new Error('Expanded object timeline has no visible bounds')
    await window.mouse.click(
      expandedTrackBounds.x + expandedTrackBounds.width * 0.4,
      expandedTrackBounds.y + expandedTrackBounds.height * 0.75
    )
    const transformBeforeTheme = await canvas.getAttribute('data-selected-animation-transform')
    expect(transformBeforeTheme).toBeTruthy()
    await themeButton.click()
    await expect(canvas).toHaveAttribute(
      'data-selected-animation-transform',
      transformBeforeTheme ?? ''
    )
    await expect(canvas).toHaveAttribute('data-animated-object-count', '1')

    await expectStableLayout(window)
    await expect(canvas).toBeVisible()
    expect(pageErrors).toEqual([])
  } finally {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy()
    })
    await electronApp.close()
  }
})

test('keeps the first point freely editable and closes only on an explicit face command', async () => {
  test.setTimeout(30_000)
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
    await window.getByRole('button', { name: '绘制自定义形状' }).click()

    const canvasBounds = await canvas.boundingBox()
    if (!canvasBounds) throw new Error('Modeling canvas has no visible bounds')
    for (const [x, y] of [
      [0.42, 0.58],
      [0.58, 0.58],
      [0.5, 0.43]
    ]) {
      await window.mouse.click(
        canvasBounds.x + canvasBounds.width * x,
        canvasBounds.y + canvasBounds.height * y
      )
    }
    await expect(canvas).toHaveAttribute('data-modeling-point-count', '3')

    const firstPointScreen = {
      x: canvasBounds.x + canvasBounds.width * 0.42,
      y: canvasBounds.y + canvasBounds.height * 0.58
    }

    const pointsBeforeDrag = await canvas.getAttribute('data-modeling-points')
    await window.mouse.move(firstPointScreen.x, firstPointScreen.y)
    await window.mouse.down()
    await window.mouse.move(firstPointScreen.x + 36, firstPointScreen.y - 20, { steps: 6 })
    await window.mouse.up()
    await expect(canvas).toHaveAttribute('data-modeling-closed', 'false')
    await expect(canvas).not.toHaveAttribute('data-modeling-points', pointsBeforeDrag ?? '')
    await window.getByRole('button', { name: '撤销', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-modeling-points', pointsBeforeDrag ?? '')

    await window.getByLabel('画布建模工具').getByRole('button', { name: '闭合线成面' }).click()
    await expect(canvas).toHaveAttribute('data-modeling-closed', 'true')
    await expect(canvas).toHaveAttribute('data-modeling-point-count', '3')
    await expect(
      window.getByLabel('点线面编辑').getByRole('button', { name: '面' })
    ).toHaveAttribute('aria-pressed', 'true')
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-9-explicit-face-command-1440x900.png'),
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

test('drags generated vertices freely on screen and along view depth without losing preview', async () => {
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
    await window.getByRole('button', { name: '绘制自定义形状' }).click()
    const canvasBounds = await canvas.boundingBox()
    if (!canvasBounds) throw new Error('Modeling canvas has no visible bounds')

    for (const [x, y] of [
      [0.42, 0.62],
      [0.58, 0.62],
      [0.58, 0.44],
      [0.42, 0.44]
    ]) {
      await window.mouse.click(
        canvasBounds.x + canvasBounds.width * x,
        canvasBounds.y + canvasBounds.height * y
      )
    }
    const modelingToolbar = window.getByLabel('画布建模工具')
    await modelingToolbar.getByRole('button', { name: '闭合线成面' }).click()
    await modelingToolbar.getByLabel('拉伸距离').fill('2')
    await modelingToolbar.getByRole('button', { name: '拉伸所选面' }).click()
    await modelingToolbar.getByRole('button', { name: '点', exact: true }).click()
    await expect(canvas).toHaveAttribute('data-modeling-point-count', '8')
    await expect(canvas).toHaveAttribute('data-modeling-geometry-state', 'valid')

    const projectPoint = async (point: {
      x: number
      y: number
      z: number
    }): Promise<{ x: number; y: number }> => {
      const bounds = await canvas.boundingBox()
      if (!bounds) throw new Error('Modeling canvas lost its bounds')
      const cameraPosition = JSON.parse(
        (await canvas.getAttribute('data-camera-position')) ?? '{}'
      ) as { x: number; y: number; z: number }
      const cameraTarget = JSON.parse(
        (await canvas.getAttribute('data-camera-target')) ?? '{}'
      ) as { x: number; y: number; z: number }
      const camera = new PerspectiveCamera(42, bounds.width / bounds.height, 0.1, 180)
      camera.position.set(cameraPosition.x, cameraPosition.y, cameraPosition.z)
      camera.lookAt(cameraTarget.x, cameraTarget.y, cameraTarget.z)
      camera.updateProjectionMatrix()
      camera.updateMatrixWorld()
      const projected = new Vector3(point.x, point.y, point.z).project(camera)
      return {
        x: bounds.x + ((projected.x + 1) / 2) * bounds.width,
        y: bounds.y + ((1 - projected.y) / 2) * bounds.height
      }
    }

    const verticesBefore = JSON.parse(
      (await canvas.getAttribute('data-modeling-vertices')) ?? '[]'
    ) as Array<{ x: number; y: number; z: number }>
    const freeTarget = {
      x: verticesBefore[4].x + 0.35,
      y: verticesBefore[4].y + 0.25,
      z: verticesBefore[4].z
    }
    const freeStartScreen = await projectPoint(verticesBefore[4])
    const freeTargetScreen = await projectPoint(freeTarget)
    await window.mouse.move(freeStartScreen.x, freeStartScreen.y)
    await window.mouse.down()
    await window.mouse.move(freeTargetScreen.x, freeTargetScreen.y, { steps: 8 })
    await window.mouse.up()
    await expect(canvas).toHaveAttribute('data-modeling-last-drag', 'free')
    const verticesAfterFree = JSON.parse(
      (await canvas.getAttribute('data-modeling-vertices')) ?? '[]'
    ) as Array<{ x: number; y: number; z: number }>
    expect(verticesAfterFree[4]).not.toEqual(verticesBefore[4])
    expect(Object.values(verticesAfterFree[4]).every(Number.isFinite)).toBe(true)
    await expect(canvas).toHaveAttribute('data-modeling-geometry-state', 'valid')
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-9-free-3d-vertex-drag-1440x900.png'),
      animations: 'disabled'
    })

    const depthStartScreen = await projectPoint(verticesAfterFree[4])
    await window.mouse.move(depthStartScreen.x, depthStartScreen.y)
    await window.keyboard.down('Alt')
    await window.mouse.down()
    await window.mouse.move(depthStartScreen.x, depthStartScreen.y - 48, { steps: 10 })
    await window.mouse.up()
    await window.keyboard.up('Alt')
    await expect(canvas).toHaveAttribute('data-modeling-last-drag', 'depth')
    await expect(canvas).toHaveAttribute('data-modeling-geometry-state', 'valid')
    const verticesAfterDepth = JSON.parse(
      (await canvas.getAttribute('data-modeling-vertices')) ?? '[]'
    ) as Array<{ x: number; y: number; z: number }>
    expect(verticesAfterDepth[4]).not.toEqual(verticesAfterFree[4])
    const canvasPixelStats = await canvas.evaluate((element) => {
      const source = element as HTMLCanvasElement
      const snapshot = document.createElement('canvas')
      snapshot.width = source.width
      snapshot.height = source.height
      const context = snapshot.getContext('2d')
      if (!context) return { uniqueColors: 0, luminanceRange: 0 }
      context.drawImage(source, 0, 0)
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
    expect(canvasPixelStats.uniqueColors).toBeGreaterThan(12)
    expect(canvasPixelStats.luminanceRange).toBeGreaterThan(30)

    await window.setViewportSize({ width: 1280, height: 720 })
    await expectStableLayout(window)
    await window.screenshot({
      path: resolve(process.cwd(), '..', 'artifacts', 'stage-9-depth-vertex-drag-1280x720.png'),
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
