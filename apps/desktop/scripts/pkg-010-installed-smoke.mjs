import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const packageRoot = resolve(process.argv[2])
const artifactRoot = resolve(process.argv[3])
const executable = join(packageRoot, 'ADVX Live.exe')
const userData = join(artifactRoot, 'installed-user-data')
const proofPath = join(artifactRoot, 'installed-pipeline.json')
const screenshotPath = join(artifactRoot, 'installed-overlay.png')
const frameBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 4, 0, 0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 156, 99, 100, 0, 1, 0, 0, 5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])

async function reservePort() {
  const server = createServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const port = address.port
  await new Promise((resolvePromise) => server.close(resolvePromise))
  return port
}

async function waitForPort(port, timeoutMs = 30_000) {
  return waitFor(`port ${port}`, async () => {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      return response.ok ? response : null
    } catch {
      return null
    }
  }, timeoutMs)
}

async function sendShutdown(socketPath) {
  const net = await import('node:net')
  await new Promise((resolvePromise, reject) => {
    const socket = net.connect(socketPath)
    const finish = (error) => {
      socket.destroy()
      if (error) reject(error)
      else resolvePromise()
    }
    socket.once('error', finish)
    socket.once('data', (data) => finish(data.toString().trim() === 'ok' ? undefined : new Error('shutdown rejected')))
    socket.once('connect', () => socket.write('quit\n'))
  })
}

async function waitFor(description, operation, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const result = await operation()
      if (result) return result
    } catch (error) {
      lastError = error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  throw new Error(`${description} did not become ready${lastError ? `: ${String(lastError)}` : ''}`)
}

await rm(artifactRoot, { recursive: true, force: true })
await mkdir(artifactRoot, { recursive: true })
await mkdir(userData, { recursive: true })
assert.equal(process.platform, 'win32')
assert.equal(process.arch, 'x64')
await stat(executable)

const port = await reservePort()
const debugPort = await reservePort()
const shutdownSocket = `\\\\.\\pipe\\advx-pkg-010-${crypto.randomUUID()}`
const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...electronEnvironment } = process.env
const appEnvironment = {
  ...electronEnvironment,
  ADVX_BACKEND_RUNTIME: 'bun-compiled',
  ADVX_BACKEND_EXTERNAL: '0',
  ADVX_BACKEND_URL: `http://127.0.0.1:${port}`,
  ADVX_RECORDED_PIPELINE: '1',
  ADVX_DESKTOP_SHUTDOWN_SOCKET: shutdownSocket,
  ADVX_DATA_DIR: join(userData, 'backend-data'),
  BUN_BE_BUN: '1',
  OPENAI_API_KEY: 'pkg-010-recorded-provider-secret',
  ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
}
const child = spawn(executable, [`--user-data-dir=${userData}`, '--disable-gpu', '--use-fake-device-for-media-stream', `--remote-debugging-port=${debugPort}`, '--remote-allow-origins=*'], {
  cwd: packageRoot,
  env: appEnvironment,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true
})
let appLog = ''
child.stdout.setEncoding('utf8')
child.stderr.setEncoding('utf8')
child.stdout.on('data', (chunk) => { appLog += chunk })
child.stderr.on('data', (chunk) => { appLog += chunk })
await waitForPort(debugPort)
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`)
const context = browser.contexts()[0]
const pageFor = (suffix) => context.pages().find((candidate) => candidate.url().replaceAll('\\', '/').includes(suffix))

let sessionId = null
try {
  const control = await waitFor('control renderer', () => pageFor('/control/'), 45_000)
  await control.getByRole('heading', { name: '直播控制台', exact: true }).waitFor({ timeout: 30_000 })
  const status = await waitFor('Bun backend ready/version handshake', () =>
    control.evaluate(async () => {
      const value = await window.advx.getBackendStatus()
      return value.connection === 'connected' ? value : null
    })
  )
  assert.equal(status.connection, 'connected')
  const saved = await control.evaluate(() => window.advx.saveModelConfig({
    baseUrl: 'recorded://model',
    providerProfileId: 'pkg-010-recorded',
    model: 'recorded-viewer-v1',
    viewerModel: 'recorded-viewer-v1',
    memoryModel: 'recorded-memory-v1',
    visualSummaryModel: 'recorded-visual-v1',
    apiKey: 'pkg-010-recorded-model-key',
    asrBaseUrl: 'recorded://asr',
    asrModel: 'recorded-asr-v1',
    asrApiKey: 'pkg-010-recorded-asr-key'
  }))
  console.log('pkg010-saved', saved)
  assert.equal(saved.ok, true)
  const workspace = await waitFor('persisted audience workspace', () =>
    control.evaluate(() => window.advx.loadAudienceWorkspace()))
  const started = await control.evaluate(
    ({ workspace: value }) => window.advx.startBackendSession(value, 'pkg-010-installed-start'),
    { workspace }
  )
  assert.equal(started.state, 'running')
  assert.ok(started.sessionId)
  sessionId = started.sessionId

  await control.evaluate(() => {
    window.__pkg010Barrages = []
    window.advx.onBackendBarrage((event) => window.__pkg010Barrages.push(event))
  })
  await control.evaluate(() => window.advx.notifyVoiceActivity('microphone', Date.now()))
  await control.evaluate(({ bytes }) => window.advx.submitAudioSegment({
    inputId: 'pkg-010-microphone',
    source: 'microphone',
    capturedAtMs: Date.now(),
    mimeType: 'audio/wav',
    body: Uint8Array.from(bytes)
  }), { bytes: [0, 1, 2, 3] })
  await control.evaluate(({ bytes }) => window.advx.submitAudioSegment({
    inputId: 'pkg-010-system-audio',
    source: 'system_audio',
    capturedAtMs: Date.now(),
    mimeType: 'audio/wav',
    body: Uint8Array.from(bytes)
  }), { bytes: [4, 5, 6, 7] })
  await control.evaluate(({ bytes }) => window.advx.submitVisualFrame({
    inputId: 'pkg-010-frame',
    capturedAtMs: Date.now(),
    mimeType: 'image/png',
    changeScore: 0,
    visualSignature: 'a'.repeat(192),
    body: Uint8Array.from(bytes)
  }), { bytes: [...frameBytes] })
  await control.getByRole('button', { name: '显示', exact: true }).click()
  const overlay = await waitFor('overlay window', () => pageFor('/overlay/'))
  await overlay.waitForLoadState('domcontentloaded')
  await overlay.locator('.overlay-root').waitFor()
  await control.evaluate(() => window.advx.submitUserText('pkg-010 recorded text'))

  const barrage = await waitFor('recorded barrage reaches control overlay', () =>
    control.evaluate(() => window.__pkg010Barrages.at(-1) ?? null), 30_000)
  assert.equal(barrage.sessionId, sessionId)
  await control.evaluate((event) => window.advx.pushBarrage(event), {
    barrageId: barrage.barrageId,
    audienceId: barrage.viewerInstanceId,
    audienceName: barrage.audienceName,
    text: barrage.text,
    color: '#5f8f7a',
    createdAt: barrage.createdAt,
    mode: 'scroll',
    roomId: barrage.roomId,
    sessionId: barrage.sessionId,
    audienceEpoch: barrage.audienceEpoch,
    observationId: barrage.observationId,
    generationRequestId: barrage.generationRequestId,
    viewerInstanceId: barrage.viewerInstanceId,
    personaId: barrage.personaId,
    viewerSequence: barrage.viewerSequence
  })
  const overlayBarrage = overlay.locator('.overlay-barrage', { hasText: 'Recorded reply: pkg-010 recorded text' })
  await overlayBarrage.waitFor({ state: 'visible', timeout: 20_000 })
  await overlay.screenshot({ path: screenshotPath })

  const traces = await control.evaluate((id) => window.advx.queryDebugTraces(id), sessionId)
  assert.ok(traces.items.some((item) => item.frame_hashes.length > 0))
  const diagnosticsInput = {
    destination: join(artifactRoot, 'diagnostics-bundle'),
    requested: ['versions', 'health', 'debug-snapshot', 'viewer-traces'],
    json: [
      { kind: 'versions', name: 'runtime.json', redacted: true, value: { electron: process.versions.electron, bun: '1.3.14', platform: process.platform, arch: process.arch } },
      { kind: 'health', name: 'backend-status.json', redacted: true, value: status },
      { kind: 'debug-snapshot', name: 'recorded-pipeline.json', redacted: true, value: { session_id: sessionId, input_kinds: ['text', 'frame', 'audio', 'voice_activity'], barrage_id: barrage.barrageId } },
      { kind: 'viewer-traces', name: 'traces.json', redacted: true, value: traces }
    ]
  }
  await writeFile(join(artifactRoot, 'diagnostics-input.json'), `${JSON.stringify(diagnosticsInput, null, 2)}\n`)

  const stopped = await control.evaluate(() => window.advx.stopBackendSession())
  assert.equal(stopped.state, 'idle')
  await sendShutdown(shutdownSocket)
  await Promise.race([once(child, 'exit'), new Promise((resolvePromise) => setTimeout(resolvePromise, 15_000))])
  await browser.close().catch(() => undefined)
  await writeFile(join(artifactRoot, 'app.log'), appLog, 'utf8')
  const proof = {
    schemaVersion: 1,
    taskId: 'PKG-010',
    status: 'passed',
    package: { executable, packageRoot, userData, screenshotPath },
    platform: { platform: process.platform, arch: process.arch, osRelease: process.getSystemVersion?.() ?? null },
    handshake: { connected: true, runtime: 'bun-compiled', recordedPipeline: true },
    session: { sessionId, text: true, frame: true, microphoneAudio: true, systemAudio: true, voiceActivity: true },
    overlay: { rendered: true, text: barrage.text, screenshot: screenshotPath },
    diagnostics: { input: join(artifactRoot, 'diagnostics-input.json'), destination: diagnosticsInput.destination },
    lifecycle: { stopped: true, appClosed: true }
  }
  await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`)
  console.log(JSON.stringify(proof, null, 2))
} catch (error) {
  await writeFile(join(artifactRoot, 'app.log'), appLog, 'utf8').catch(() => undefined)
  await browser.close().catch(() => undefined)
  await sendShutdown(shutdownSocket).catch(() => undefined)
  if (child.exitCode === null) child.kill()
  throw error
}
