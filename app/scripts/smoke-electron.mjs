import { _electron as electron } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

let electronApp
const watchdog = setTimeout(() => {
  console.error('[smoke] watchdog timeout')
  process.exitCode = 2
  process.exit()
}, 20_000)

try {
  console.log('[smoke] launching Electron')
  electronApp = await electron.launch({
    args: ['.'],
    timeout: 15_000,
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '1'
    }
  })

  console.log('[smoke] waiting for the first window')
  const window = await electronApp.firstWindow({ timeout: 15_000 })
  console.log(`[smoke] title: ${await window.title()}`)
  console.log(`[smoke] heading: ${await window.getByRole('heading').textContent()}`)

  if (process.env.SMOKE_SCREENSHOT_PATH) {
    await mkdir(dirname(process.env.SMOKE_SCREENSHOT_PATH), { recursive: true })
    await window.screenshot({ path: process.env.SMOKE_SCREENSHOT_PATH })
    console.log(`[smoke] screenshot: ${process.env.SMOKE_SCREENSHOT_PATH}`)
  }
} finally {
  clearTimeout(watchdog)
  if (electronApp) {
    console.log('[smoke] closing Electron')
    await electronApp.close()
  }
}
