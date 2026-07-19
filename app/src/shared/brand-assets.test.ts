import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const appRoot = resolve(process.cwd())

async function readAsset(relativePath: string): Promise<Buffer> {
  return readFile(resolve(appRoot, relativePath))
}

describe('小白盒品牌资源', () => {
  it('保留项目自有的白底黑线立方体 SVG 母版', async () => {
    const source = (await readAsset('build/icon-source.svg')).toString('utf8')

    expect(source).toContain('viewBox="0 0 1024 1024"')
    expect(source).toContain('fill="#ffffff"')
    expect(source).toContain('stroke="#000000"')
    expect(source).toContain('stroke-width="64"')
    expect(source).toContain('白色正方形背景上的黑色粗线立方体')
  })

  it.each(['build/icon.png', 'resources/icon.png'])('%s 是 1024×1024 PNG', async (path) => {
    const png = await readAsset(path)

    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(png.readUInt32BE(16)).toBe(1024)
    expect(png.readUInt32BE(20)).toBe(1024)
  })

  it('Windows ICO 包含常用的小图标尺寸', async () => {
    const ico = await readAsset('build/icon.ico')
    const count = ico.readUInt16LE(4)
    const sizes = Array.from({ length: count }, (_, index) => {
      const encodedWidth = ico[6 + index * 16]
      return encodedWidth === 0 ? 256 : encodedWidth
    })

    expect(ico.readUInt16LE(0)).toBe(0)
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(sizes).toEqual([16, 24, 32, 48, 64, 128, 256])
  })

  it('macOS 图标保留有效 ICNS 文件头', async () => {
    const icns = await readAsset('build/icon.icns')

    expect(icns.subarray(0, 4).toString('ascii')).toBe('icns')
    expect(icns.readUInt32BE(4)).toBe(icns.length)
  })
})
