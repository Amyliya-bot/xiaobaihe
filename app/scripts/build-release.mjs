import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageJson = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8'))
const target = process.argv[2]
if (target !== '--dir' && target !== '--win') {
  throw new Error('用法：node scripts/build-release.mjs --dir|--win')
}

const outputDirectory = `release/v${packageJson.version}`
const child = spawn(
  process.execPath,
  [
    join(appRoot, 'node_modules', 'electron-builder', 'out', 'cli', 'cli.js'),
    target,
    `--config.directories.output=${outputDirectory}`
  ],
  { cwd: appRoot, stdio: 'inherit' }
)

child.on('error', (error) => {
  throw error
})

const exitCode = await new Promise((resolveExit) => child.on('close', resolveExit))
if (exitCode !== 0) process.exitCode = Number(exitCode ?? 1)
