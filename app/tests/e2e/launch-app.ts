import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { _electron as electron, type ElectronApplication } from '@playwright/test'

export function createIsolatedUserDataPath(): string {
  const userDataPath = resolve(
    process.cwd(),
    'test-results',
    'user-data',
    `${process.pid}-${randomUUID()}`
  )
  mkdirSync(userDataPath, { recursive: true })
  return userDataPath
}

export async function launchElectronWithUserData(
  userDataPath: string,
  dismissOnboarding = true
): Promise<ElectronApplication> {
  const electronApp = await electron.launch({
    args: ['.'],
    env: { ...process.env, WHITEBOX_TEST_USER_DATA: userDataPath }
  })
  if (dismissOnboarding) {
    const window = await electronApp.firstWindow()
    await window.evaluate(() =>
      window.localStorage.setItem('whitebox-studio-onboarding-complete-v1', 'true')
    )
    await window.reload({ waitUntil: 'domcontentloaded' })
  }
  return electronApp
}

export async function launchIsolatedElectron(): Promise<ElectronApplication> {
  return launchElectronWithUserData(createIsolatedUserDataPath())
}
