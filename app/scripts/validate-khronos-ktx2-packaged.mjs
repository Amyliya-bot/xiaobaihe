import { strict as assert } from 'node:assert'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { _electron as electron } from '@playwright/test'

const sampleCommit = '2bac6f8c57bf471df0d2a1e8a8ec023c7801dddf'
const sampleBase = `https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/${sampleCommit}/Models/AnisotropyBarnLamp/glTF-KTX-BasisU`
const sampleFiles = [
  'AnisotropyBarnLamp.gltf',
  'AnisotropyBarnLamp.bin',
  'AnisotropyBarnLamp_anisotropy.ktx2',
  'AnisotropyBarnLamp_basecolor.ktx2',
  'AnisotropyBarnLamp_normalbump.ktx2',
  'AnisotropyBarnLamp_occlusionroughnessmetal.ktx2'
]
const packageDirectory = resolve('test-results', 'ktx2-package')
const executablePath = resolve(packageDirectory, 'win-unpacked', 'Xiaobaihe.exe')
const screenshotPath = resolve('..', 'artifacts', 'stage-3a-ktx2-anisotropy-lamp.png')

const responses = await Promise.all(sampleFiles.map((file) => fetch(`${sampleBase}/${file}`)))
for (const [index, response] of responses.entries()) {
  if (!response.ok) {
    throw new Error(`Khronos KTX2 样本下载失败：${sampleFiles[index]} (${response.status})`)
  }
}
process.stdout.write('KTX2 validation: sample downloaded.\n')

const source = await responses[0].text()
const document = JSON.parse(source)
assert.ok(document.extensionsRequired?.includes('KHR_texture_basisu'))
assert.equal(document.images?.length, 4)
assert.ok(document.images.every((image) => image.uri.endsWith('.ktx2')))

const resources = await Promise.all(
  sampleFiles.slice(1).map(async (name, index) => ({
    name,
    base64: Buffer.from(await responses[index + 1].arrayBuffer()).toString('base64'),
    mimeType: name.endsWith('.ktx2') ? 'image/ktx2' : 'application/octet-stream'
  }))
)

const electronApp = await electron.launch({
  executablePath,
  env: { ...process.env, WHITEBOX_TECHNICAL_VALIDATION: '1' }
})
process.stdout.write('KTX2 validation: packaged app launched.\n')

try {
  const mainPage = await electronApp.firstWindow()
  const mainCsp = await mainPage
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content')
  assert.ok(mainCsp)
  assert.ok(!mainCsp.split(/[\s;]/).includes("'unsafe-eval'"))

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
    await validationWindow.loadFile(`${app.getAppPath()}/out/renderer/ktx2-validation.html`)
  })
  process.stdout.write('KTX2 validation: technical page loaded.\n')
  const validationPage = await validationPagePromise
  const pageErrors = []
  const consoleErrors = []
  const failedRequests = []
  const workerUrls = []
  validationPage.on('pageerror', (error) => pageErrors.push(error.message))
  validationPage.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  validationPage.on('requestfailed', (request) => {
    failedRequests.push(`${request.url()} (${request.failure()?.errorText ?? 'unknown'})`)
  })
  validationPage.on('worker', (worker) => workerUrls.push(worker.url()))
  await validationPage.waitForFunction(
    () => document.documentElement.dataset.validationReady === 'true'
  )
  process.stdout.write('KTX2 validation: renderer validation started.\n')

  let result
  try {
    result = await validationPage.evaluate(
      async (input) =>
        Promise.race([
          window.runKtx2PackageValidation(input),
          new Promise((_, reject) => {
            window.setTimeout(() => {
              const phase = document.documentElement.dataset.validationPhase ?? 'unknown'
              reject(new Error(`KTX2 验证超时，停在阶段：${phase}`))
            }, 60_000)
          })
        ]),
      { source, resources }
    )
  } catch (error) {
    process.stderr.write(
      `KTX2 diagnostics: pageErrors=${JSON.stringify(pageErrors)}, consoleErrors=${JSON.stringify(consoleErrors)}, failedRequests=${JSON.stringify(failedRequests)}, workers=${JSON.stringify(workerUrls)}.\n`
    )
    throw error
  }

  assert.equal(result.report.meshCount, 3)
  assert.equal(result.report.triangleCount, 10_203)
  assert.equal(result.report.materialCount, 3)
  assert.equal(result.report.textureCount, 4)
  assert.equal(result.compressedTextureCount, 4)
  assert.ok(result.textureFormats.length > 0)
  assert.ok(result.rendererTextureCount >= 4)
  assert.ok(result.renderedPixelCount > 500)
  assert.ok(result.sampledColorCount > 4)
  assert.equal(result.privilegedApiExposed, false)
  assert.equal(result.nodeProcessExposed, false)
  assert.ok(result.imageBase64.length > 0)
  assert.deepEqual(pageErrors, [])
  assert.deepEqual(consoleErrors, [])

  await mkdir(dirname(screenshotPath), { recursive: true })
  await writeFile(screenshotPath, Buffer.from(result.imageBase64, 'base64'))
  process.stdout.write(
    `Khronos KTX2 packaged validation passed: ${result.report.textureCount} textures, ${result.textureFormats.join(', ')}; screenshot ${screenshotPath}.\n`
  )
} finally {
  await electronApp.close()
}
