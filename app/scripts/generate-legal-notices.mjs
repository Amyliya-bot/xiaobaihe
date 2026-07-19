/* eslint-disable @typescript-eslint/explicit-function-return-type -- Node executes this release script directly as ESM JavaScript. */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(appRoot, '..')
const legalDirectory = join(appRoot, 'resources', 'legal')
const checkOnly = process.argv.includes('--check')

async function text(relativePath) {
  return readFile(resolve(appRoot, relativePath), 'utf8')
}

async function writeOrCheck(filePath, content) {
  const normalized = `${content
    .split(/\r?\n/u)
    .map((line) => line.trimEnd())
    .join('\n')
    .trimEnd()}\n`
  if (checkOnly) {
    const current = await readFile(filePath, 'utf8').catch(() => '')
    if (current !== normalized) {
      throw new Error(`${filePath} 不是最新生成结果，请运行 npm run legal:generate。`)
    }
    return
  }
  await writeFile(filePath, normalized, 'utf8')
}

const projectLicense = await readFile(join(repositoryRoot, 'LICENSE'), 'utf8')
const runtimeLicenses = [
  {
    heading: 'React and React DOM',
    version: '19.2.7',
    license: 'MIT',
    text: await text('node_modules/react/LICENSE')
  },
  {
    heading: 'Three.js, addons and SimplifyModifier',
    version: '0.185.1',
    license: 'MIT',
    text: await text('node_modules/three/LICENSE')
  },
  {
    heading: 'Lucide React and derived Feather icons',
    version: '1.24.0',
    license: 'ISC and MIT',
    text: await text('node_modules/lucide-react/LICENSE')
  },
  {
    heading: 'Mediabunny',
    version: '1.50.8',
    license: 'MPL-2.0',
    text: await text('node_modules/mediabunny/LICENSE')
  },
  {
    heading: 'Draco and Basis Universal decoder resources',
    version: 'bundled with Three.js 0.185.1',
    license: 'Apache-2.0',
    text: await text('node_modules/typescript/LICENSE.txt')
  },
  {
    heading: 'Quaternius Universal Base Characters - Superhero Male',
    version: 'Standard free pack, retrieved 2026-07-16',
    license: 'CC0-1.0',
    text: await text('src/renderer/src/assets/mannequin/LICENSE.txt')
  }
]

const noticeSections = runtimeLicenses.map(
  (entry) =>
    `================================================================================\n${entry.heading}\nVersion: ${entry.version}\nLicense: ${entry.license}\n================================================================================\n\n${entry.text.trim()}`
)
const runtimeNotice = `THIRD-PARTY RUNTIME NOTICES

This file accompanies the Xiaobaihe Windows distribution.

Electron's own MIT license and Chromium's complete third-party license list are shipped beside the application executable as LICENSE.electron.txt and LICENSES.chromium.html. Electron's Chromium media runtime includes ffmpeg.dll; this project does not add a separate FFmpeg executable or libx264 build.

The unmodified Mediabunny source used by this build is available in the corresponding public source tag and the release source archive. No project or user data is transmitted by these components.

${noticeSections.join('\n\n')}`

const lock = JSON.parse(await readFile(join(appRoot, 'package-lock.json'), 'utf8'))
const inventory = Object.entries(lock.packages)
  .filter(([packagePath]) => packagePath.length > 0)
  .map(([packagePath, metadata]) => ({
    packagePath,
    version: metadata.version ?? 'unknown',
    license: metadata.license ?? ''
  }))
  .sort((left, right) => left.packagePath.localeCompare(right.packagePath))

const missingLicense = inventory.filter((entry) => entry.license.length === 0)
if (missingLicense.length > 0) {
  throw new Error(`有 ${missingLicense.length} 个锁定依赖缺少许可证标记。`)
}

const dependencyInventory = `LOCKED SOURCE AND BUILD DEPENDENCY LICENSES

Generated from package-lock.json. Entries include development and packaging tools and do not imply that every package is shipped in the runtime installer.

Path | Version | License
-----|---------|--------
${inventory.map((entry) => `${entry.packagePath} | ${entry.version} | ${entry.license}`).join('\n')}`

await mkdir(legalDirectory, { recursive: true })
await writeOrCheck(join(legalDirectory, 'LICENSE.txt'), projectLicense)
await writeOrCheck(join(legalDirectory, 'THIRD_PARTY_NOTICES.txt'), runtimeNotice)
await writeOrCheck(join(legalDirectory, 'DEPENDENCY_LICENSES.txt'), dependencyInventory)

console.log(
  checkOnly
    ? `Legal files are current (${inventory.length} locked dependency entries).`
    : `Generated legal files (${inventory.length} locked dependency entries).`
)
