import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import electronPath from 'electron'
import { _electron as electron } from 'playwright-core'

const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = resolve(scriptRoot, '..', '..')
const artifactRoot = resolve(process.env.ADVX_PKG_008_ARTIFACT_ROOT ?? join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'pkg-008'))
const userDataDirectory = join(artifactRoot, 'crash-smoke-user-data')
const crashDumpsDirectory = join(userDataDirectory, 'crash-dumps')
const maxDumpBytes = 64 * 1024 * 1024

async function waitFor(description, check, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      const value = await check()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(`${description} did not become ready${lastError ? `: ${lastError.message}` : ''}`)
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const port = address.port
  await new Promise((resolveClose) => server.close(resolveClose))
  return port
}

async function listDumps() {
  try {
    const reportsDirectory = join(crashDumpsDirectory, 'reports')
    return (await readdir(reportsDirectory)).filter((name) => name.endsWith('.dmp')).map((name) => join('reports', name)).sort()
  } catch {
    return []
  }
}

async function hashFile(path) {
  const bytes = await readFile(path)
  return { bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex') }
}

await rm(artifactRoot, { recursive: true, force: true })
await mkdir(artifactRoot, { recursive: true })
const backendPort = await reservePort()
const providerSecret = 'pkg-008-provider-secret'
const rawContentSentinel = 'pkg-008-raw-user-content-sentinel'
const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...parentEnvironment } = process.env
const environment = {
  ...parentEnvironment,
  ADVX_BACKEND_EXTERNAL: '0',
  ADVX_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
  ADVX_RECORDED_PIPELINE: '1',
  OPENAI_API_KEY: providerSecret,
  ADVX_RAW_USER_CONTENT_SENTINEL: rawContentSentinel,
  ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
}

let electronApp
try {
  electronApp = await electron.launch({
    args: ['.', `--user-data-dir=${userDataDirectory}`, '--disable-gpu'],
    cwd: scriptRoot,
    env: environment
  })
  const page = await electronApp.firstWindow()
  await page.getByRole('heading', { name: '直播控制台', exact: true }).waitFor()
  const logPath = join(userDataDirectory, 'logs', 'advx.log')
  await waitFor('application logging', async () => {
    const log = await readFile(logPath, 'utf8').catch(() => '')
    return log.includes('app.start') ? log : null
  })

  const reporter = await electronApp.evaluate(({ crashReporter }) => ({
    uploadToServer: crashReporter.getUploadToServer(),
    parameters: crashReporter.getParameters(),
    lastCrashReport: crashReporter.getLastCrashReport()
  }))
  assert.equal(reporter.uploadToServer, false)
  assert.equal(reporter.lastCrashReport, null)
  const expectedAnnotationKeys = [
    'app_version',
    'electron_version',
    'chrome_version',
    'node_version',
    'bun_version',
    'session_id'
  ]
  assert.deepEqual(Object.keys(reporter.parameters).sort(), expectedAnnotationKeys.sort())
  for (const key of expectedAnnotationKeys) {
    assert.notEqual(reporter.parameters[key], '')
    assert.ok(reporter.parameters[key].length <= 127)
  }
  const annotationText = JSON.stringify(reporter.parameters)
  assert.ok(!annotationText.includes(providerSecret))
  assert.ok(!annotationText.includes(rawContentSentinel))

  await electronApp.evaluate(({ BrowserWindow }) => {
    const controlWindow = BrowserWindow.getAllWindows().find((window) =>
      window.webContents.getURL().includes('/control/')
    )
    if (!controlWindow) throw new Error('Control window is missing before deliberate crash.')
    controlWindow.webContents.forcefullyCrashRenderer()
  })
  await waitFor('local renderer crash dump', async () => {
    const dumps = await listDumps()
    return dumps.length > 0 ? dumps : null
  }, 45_000)

  const dumps = await listDumps()
  assert.equal(dumps.length, 1, `expected one bounded dump, found ${dumps.length}`)
  const dumpPath = join(crashDumpsDirectory, dumps[0])
  const dumpIdentity = await hashFile(dumpPath)
  assert.ok(dumpIdentity.bytes > 0)
  assert.ok(dumpIdentity.bytes <= maxDumpBytes)
  const crashManifest = {
    schemaVersion: 1,
    taskId: 'PKG-008',
    status: 'passed',
    uploadToServer: false,
    annotations: {
      app_version: reporter.parameters.app_version,
      electron_version: reporter.parameters.electron_version,
      chrome_version: reporter.parameters.chrome_version,
      node_version: reporter.parameters.node_version,
      bun_version: reporter.parameters.bun_version,
      session_id: reporter.parameters.session_id
    },
    dump: {
      path: relative(artifactRoot, dumpPath).replaceAll('\\', '/'),
      bytes: dumpIdentity.bytes,
      sha256: dumpIdentity.sha256,
      embedded: false
    },
    retention: { maxBytes: maxDumpBytes, remoteUpload: 'disabled' }
  }
  await writeFile(join(artifactRoot, 'diagnostics-manifest.json'), `${JSON.stringify(crashManifest, null, 2)}\n`, 'utf8')
  await stat(dumpPath)
  const logText = await readFile(logPath, 'utf8').catch(() => '')
  assert.ok(!logText.includes(providerSecret))
  assert.ok(!logText.includes(rawContentSentinel))
  const result = {
    ...crashManifest,
    runtime: {
      platform: process.platform,
      arch: process.arch,
      backendPort,
      logPath,
      deliberateRendererCrash: true,
      localDumpCreated: true,
      annotationsRedacted: true,
      manifestEmbedsDump: false
    }
  }
  await writeFile(join(artifactRoot, 'result.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify(result, null, 2))
} finally {
  if (electronApp) await electronApp.close().catch(() => undefined)
}
