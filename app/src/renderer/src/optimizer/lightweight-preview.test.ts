import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import {
  cloneImportedVariant,
  createLightweightPreview,
  markImportedVariant,
  setImportedVariantVisibility
} from './lightweight-preview'

describe('lightweight imported preview', () => {
  it('reduces ordinary mesh geometry without changing the source', () => {
    const original = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20))
    const originalPositionCount = original.geometry.getAttribute('position').count
    const result = createLightweightPreview(original, 0.4)
    expect(result.report.simplifiedMeshes).toBe(1)
    expect(result.report.previewTriangles).toBeLessThan(result.report.originalTriangles)
    expect(original.geometry.getAttribute('position').count).toBe(originalPositionCount)
  })

  it('keeps original and lightweight variants reversible', () => {
    const container = new THREE.Group()
    const original = new THREE.Group()
    const lightweight = new THREE.Group()
    markImportedVariant(original, 'original')
    markImportedVariant(lightweight, 'lightweight')
    container.add(original, lightweight)
    expect(setImportedVariantVisibility(container, 'lightweight')).toBe('lightweight')
    expect(original.visible).toBe(false)
    expect(lightweight.visible).toBe(true)
    expect(setImportedVariantVisibility(container, 'original')).toBe('original')
    expect(original.visible).toBe(true)
    const exportClone = cloneImportedVariant(container, 'lightweight')
    expect(exportClone.children).toHaveLength(1)
    expect(exportClone.children[0].userData.importedQuality).toBe('lightweight')
  })
})
