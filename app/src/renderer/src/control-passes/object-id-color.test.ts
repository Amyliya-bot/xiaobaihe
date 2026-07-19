import { describe, expect, it } from 'vitest'
import { objectIdColor } from './object-id-color'

describe('object id control colors', () => {
  it('returns a stable visible RGB color for the same object id', () => {
    expect(objectIdColor('box-1')).toBe(objectIdColor('box-1'))
    expect(objectIdColor('box-1')).toMatch(/^#[0-9a-f]{6}$/)
    const channels = objectIdColor('box-1')
      .slice(1)
      .match(/.{2}/g)!
      .map((value) => Number.parseInt(value, 16))
    expect(Math.min(...channels)).toBeGreaterThanOrEqual(64)
  })

  it('assigns different colors to ordinary distinct ids', () => {
    expect(new Set(['box-1', 'box-2', 'sphere-1'].map(objectIdColor)).size).toBe(3)
  })
})
