import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const vitestPath = fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url))
const result = spawnSync(
  process.execPath,
  [vitestPath, 'run', '--config', 'vitest.network.config.ts'],
  {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, RUN_KHRONOS_REAL_MODEL: '1' },
    stdio: 'inherit'
  }
)

process.exit(result.status ?? 1)
