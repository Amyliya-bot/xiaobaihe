import { describe, expect, it } from 'vitest'
import { APP_NAME, APP_VERSION } from './app-meta'

describe('application metadata', () => {
  it('provides a stable development identity', () => {
    expect(APP_NAME).toBe('小白盒')
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
