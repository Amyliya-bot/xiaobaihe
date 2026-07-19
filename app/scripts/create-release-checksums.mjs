import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8'))
const releaseDirectory = join(appRoot, 'release', `v${packageJson.version}`)
const setupPath = join(releaseDirectory, `xiaobaihe-${packageJson.version}-setup.exe`)
const unpackedExecutable = join(releaseDirectory, 'win-unpacked', 'Xiaobaihe.exe')
const legalDirectory = join(releaseDirectory, 'win-unpacked', 'resources', 'legal')

for (const requiredPath of [
  setupPath,
  unpackedExecutable,
  join(legalDirectory, 'LICENSE.txt'),
  join(legalDirectory, 'THIRD_PARTY_NOTICES.txt'),
  join(legalDirectory, 'DEPENDENCY_LICENSES.txt')
]) {
  await stat(requiredPath)
}

const setup = await readFile(setupPath)
const checksum = createHash('sha256').update(setup).digest('hex')
const checksumLine = `${checksum}  ${basename(setupPath)}\n`
await writeFile(join(releaseDirectory, 'SHA256SUMS.txt'), checksumLine, 'utf8')
console.log(checksumLine.trim())
