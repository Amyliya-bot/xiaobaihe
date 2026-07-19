import { strict as assert } from 'node:assert'
import { resolve } from 'node:path'
import { _electron as electron } from '@playwright/test'

const sampleCommit = '2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf'
const sampleBase = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${sampleCommit}/Models/Box/glTF-Draco`
const executablePath = resolve('test-results', 'draco-package', 'win-unpacked', 'Xiaobaihe.exe')

const [gltfResponse, binaryResponse] = await Promise.all([
  fetch(`${sampleBase}/Box.gltf`),
  fetch(`${sampleBase}/Box.bin`)
])
if (!gltfResponse.ok) {
  throw new Error(`Khronos Draco 样本下载失败：Box.gltf (${gltfResponse.status})`)
}
if (!binaryResponse.ok) {
  throw new Error(`Khronos Draco 样本下载失败：Box.bin (${binaryResponse.status})`)
}

const source = await gltfResponse.text()
const document = JSON.parse(source)
assert.ok(document.extensionsRequired?.includes('KHR_draco_mesh_compression'))
const binary = Buffer.from(await binaryResponse.arrayBuffer())

const electronApp = await electron.launch({
  executablePath,
  env: { ...process.env, WHITEBOX_TECHNICAL_VALIDATION: '1' }
})

try {
  const validationPagePromise = electronApp.waitForEvent('window')
  await electronApp.evaluate(async ({ app, BrowserWindow }) => {
    const validationWindow = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    })
    await validationWindow.loadFile(`${app.getAppPath()}/out/renderer/draco-validation.html`)
  })
  const validationPage = await validationPagePromise
  const pageErrors = []
  validationPage.on('pageerror', (error) => pageErrors.push(error.message))
  await validationPage.waitForFunction(
    () => document.documentElement.dataset.validationReady === 'true'
  )
  const report = await validationPage.evaluate(
    async ({ modelSource, binaryBase64 }) =>
      window.runDracoPackageValidation({
        source: modelSource,
        resources: [{ name: 'Box.bin', base64: binaryBase64 }]
      }),
    { modelSource: source, binaryBase64: binary.toString('base64') }
  )

  assert.equal(report.meshCount, 1)
  assert.equal(report.triangleCount, 12)
  assert.equal(report.materialCount, 1)
  assert.deepEqual(pageErrors, [])
  process.stdout.write(
    `Khronos Draco packaged validation passed: ${report.meshCount} mesh, ${report.triangleCount} triangles.\n`
  )
} finally {
  await electronApp.close()
}
