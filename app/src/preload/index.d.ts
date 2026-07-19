import type { DesktopApi } from '../shared/desktop-api'

export interface DesktopRuntimeInfo {
  platform: NodeJS.Platform
  electronVersion: string
  chromeVersion: string
}

declare global {
  interface Window {
    desktopRuntime: DesktopRuntimeInfo
    desktopApi: DesktopApi
  }
}
