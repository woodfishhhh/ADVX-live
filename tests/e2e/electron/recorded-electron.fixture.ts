import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer } from 'node:net'
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { _electron as electron } from 'playwright'
import type {
  ConsoleMessage,
  ElectronApplication,
  Page
} from 'playwright'
import type { AudienceWorkspaceState } from '../../../apps/desktop/src/shared/audience/types.ts'
import type {
  BackendBarrageEvent,
  BackendRuntime,
  ControlApi
} from '../../../apps/desktop/src/shared/contracts.ts'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const desktopRoot = join(repositoryRoot, 'apps', 'desktop')
const backendPort = 8765
const syntheticFrameBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const defaultDeadlines = {
  startupMs: 25_000,
  actionMs: 12_000,
  shutdownMs: 12_000
} as const

export type RecordedElectronScenario = 'full-pipeline' | 'recorded-lifecycle'

export type RecordedElectronScenarioOptions = Readonly<{
  artifactDirectory: string
  backendRuntime: Extract<BackendRuntime, 'bun-source' | 'bun-compiled'>
  compiledExecutable?: string
  scenario: RecordedElectronScenario
  deadlines?: Partial<typeof defaultDeadlines>
}>

type DiagnosticEntry = Readonly<{
  at: string
  kind: 'console' | 'page-error' | 'page-crash' | 'process-error' | 'stdio'
  source: 'electron-main' | 'electron-process' | 'renderer'
  level: 'debug' | 'info' | 'warning' | 'error'
  text: string
  window?: string
}>

type FixtureWindow = Window & {
  advx: ControlApi
  __tst008Barrages?: BackendBarrageEvent[]
}

export type RecordedElectronScenarioResult = Readonly<{
  schema_version: 1
  task_id: 'TST-008'
  status: 'passed' | 'failed'
  scenario: RecordedElectronScenario
  backend_runtime: Extract<BackendRuntime, 'bun-source' | 'bun-compiled'>
  provider_mode: 'recorded'
  provider_model: 'recorded-viewer-v1'
  duration_ms: number
  inputs: readonly ('text' | 'frame' | 'microphone' | 'system_audio')[]
  barrage: Readonly<{ delivered: boolean; text_prefix: string | null }>
  overlay: Readonly<{ rendered: boolean; screenshot: string | null }>
  traces: Readonly<{ count: number; frame_hash_count: number; provider: string | null }>
  isolation: Readonly<{
    electron_user_data: 'isolated-temporary-directory'
    backend_data_relative: string
    backend_data_observed: boolean
  }>
  diagnostics: Readonly<{
    collected: number
    error_count: number
    fatal_error_count: number
    artifact: string
  }>
  failure_artifacts: Readonly<{
    trace: string | null
    screenshots: readonly string[]
    application_log: string | null
    video: 'disabled-short-deterministic-scenario'
  }>
  deadlines_ms: typeof defaultDeadlines
  cleanup: Readonly<{
    session_stopped: boolean
    electron_closed: boolean
    backend_port_released: boolean
    temporary_directory_removed: boolean
  }>
  failure: Readonly<{ name: string; message: string }> | null
}>

export async function runRecordedElectronScenario(
  options: RecordedElectronScenarioOptions
): Promise<RecordedElectronScenarioResult> {
  const artifactDirectory = resolve(options.artifactDirectory)
  const deadlines = { ...defaultDeadlines, ...options.deadlines }
  const startedAt = Date.now()
  const temporaryDirectory = await mkdtemp(join(tmpdir(), `advx-tst-008-${options.backendRuntime}-`))
  const electronUserDataDirectory = join(temporaryDirectory, 'electron-user-data')
  const backendDataRelative = join('backend', options.backendRuntime).replaceAll('\\', '/')
  const backendDataDirectory = join(electronUserDataDirectory, 'backend', options.backendRuntime)
  const resultPath = join(artifactDirectory, 'result.json')
  const diagnosticsPath = join(artifactDirectory, 'diagnostics.json')
  const tracePath = join(artifactDirectory, 'trace.zip')
  const diagnosticEntries: DiagnosticEntry[] = []
  const attachedPages = new WeakSet<Page>()
  const failureScreenshots: string[] = []
  let electronApp: ElectronApplication | undefined
  let controlPage: Page | undefined
  let sessionStarted = false
  let tracingStarted = false
  let scenarioPassed = false
  let failure: unknown
  let barrageText: string | null = null
  let overlayRendered = false
  let traceCount = 0
  let frameHashCount = 0
  let traceProvider: string | null = null
  let backendDataObserved = false
  let sessionStopped = false
  let electronClosed = false
  let backendPortReleased = false
  let temporaryDirectoryRemoved = false
  let applicationLogArtifact: string | null = null
  let traceArtifact: string | null = null

  await rm(artifactDirectory, { recursive: true, force: true })
  await mkdir(artifactDirectory, { recursive: true })

  const addDiagnostic = (
    entry: Omit<DiagnosticEntry, 'at' | 'kind' | 'text'> & {
      kind?: DiagnosticEntry['kind']
      text: unknown
    }
  ): void => {
    if (diagnosticEntries.length >= 250) return
    diagnosticEntries.push({
      ...entry,
      at: new Date().toISOString(),
      kind: entry.kind ?? 'console',
      text: redactDiagnostic(String(entry.text)).slice(0, 2_000)
    })
  }

  const attachPage = (page: Page): void => {
    if (attachedPages.has(page)) return
    attachedPages.add(page)
    const windowName = page.url().replaceAll('\\', '/') || 'loading'
    page.on('console', (message) => {
      addDiagnostic({
        source: 'renderer',
        level: normalizeConsoleLevel(message),
        text: message.text(),
        window: windowName
      })
    })
    page.on('pageerror', (error) => {
      addDiagnostic({
        kind: 'page-error',
        source: 'renderer',
        level: 'error',
        text: error,
        window: windowName
      })
    })
    page.on('crash', () => {
      addDiagnostic({
        kind: 'page-crash',
        source: 'renderer',
        level: 'error',
        text: 'renderer_crashed',
        window: windowName
      })
    })
  }

  try {
    if (process.platform !== 'win32') {
      throw new Error('TST-008 normal-CI Electron scenario currently requires the Windows job')
    }
    if (options.backendRuntime === 'bun-compiled' && !options.compiledExecutable) {
      throw new Error('bun-compiled scenario requires an explicit compiled executable')
    }
    assert.equal(await portIsFree(backendPort), true, `backend port ${backendPort} must be free`)

    const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...electronEnvironment } = process.env
    electronApp = await withDeadline(
      'Electron launch',
      electron.launch({
        args: ['.', `--user-data-dir=${electronUserDataDirectory}`],
        cwd: desktopRoot,
        env: {
          ...electronEnvironment,
          ADVX_BACKEND_RUNTIME: options.backendRuntime,
          ADVX_RECORDED_PIPELINE: '1',
          ...(options.compiledExecutable
            ? { ADVX_BACKEND_COMPILED_EXECUTABLE: resolve(options.compiledExecutable) }
            : {}),
          ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
        }
      }),
      deadlines.startupMs
    )
    electronApp.on('console', (message) => {
      addDiagnostic({
        source: 'electron-main',
        level: normalizeConsoleLevel(message),
        text: message.text()
      })
    })
    electronApp.on('window', attachPage)
    electronApp.on('close', () => {
      electronClosed = true
    })
    const electronProcess = electronApp.process()
    electronProcess.on('error', (error) => {
      addDiagnostic({ kind: 'process-error', source: 'electron-process', level: 'error', text: error })
    })
    electronProcess.stdout?.on('data', (chunk: Buffer | string) => {
      addDiagnostic({ kind: 'stdio', source: 'electron-process', level: 'info', text: chunk })
    })
    electronProcess.stderr?.on('data', (chunk: Buffer | string) => {
      addDiagnostic({ kind: 'stdio', source: 'electron-process', level: 'warning', text: chunk })
    })

    await electronApp.context().tracing.start({ screenshots: true, snapshots: true, sources: true })
    tracingStarted = true
    controlPage = await withDeadline(
      'control window',
      electronApp.firstWindow({ timeout: deadlines.startupMs }),
      deadlines.startupMs
    )
    attachPage(controlPage)
    controlPage.setDefaultTimeout(deadlines.actionMs)
    await controlPage.getByRole('heading', { name: '直播控制台', exact: true }).waitFor()

    const status = await waitFor(
      'Bun BackendClient connection',
      () => controlPage!.evaluate(async () => {
        const value = await (window as unknown as FixtureWindow).advx.getBackendStatus()
        return value.connection === 'connected' ? value : null
      }),
      deadlines.startupMs
    )
    assert.equal(status.backendRuntime, options.backendRuntime)
    assert.equal(status.providersConfigured, false)
    backendDataObserved = await pathExists(backendDataDirectory)
    assert.equal(backendDataObserved, true, 'backend data directory was not isolated under Electron user data')

    const saved = await controlPage.evaluate(() =>
      (window as unknown as FixtureWindow).advx.saveModelConfig({
        baseUrl: 'recorded://model',
        providerProfileId: 'recorded-desktop-fixture',
        model: 'recorded-viewer-v1',
        viewerModel: 'recorded-viewer-v1',
        memoryModel: 'recorded-memory-v1',
        visualSummaryModel: 'recorded-visual-v1',
        apiKey: 'recorded-model-key',
        asrBaseUrl: 'recorded://asr',
        asrModel: 'recorded-asr-v1',
        asrApiKey: 'recorded-asr-key'
      })
    )
    assert.equal(saved.ok, true)

    const workspace = await waitFor(
      'initial audience workspace',
      () => controlPage!.evaluate(() => (window as unknown as FixtureWindow).advx.loadAudienceWorkspace()),
      deadlines.actionMs
    )
    const fixtureWorkspace = constrainWorkspace(workspace)
    const started = await controlPage.evaluate(
      ({ audienceWorkspace, clientRequestId }) =>
        (window as unknown as FixtureWindow).advx.startBackendSession(audienceWorkspace, clientRequestId),
      {
        audienceWorkspace: fixtureWorkspace,
        clientRequestId: `tst-008-${options.backendRuntime}`
      }
    )
    sessionStarted = true
    assert.equal(started.state, 'running')
    assert.ok(started.sessionId)

    await controlPage.evaluate(() => {
      const fixtureWindow = window as unknown as FixtureWindow
      fixtureWindow.__tst008Barrages = []
      fixtureWindow.advx.onBackendBarrage((event) => fixtureWindow.__tst008Barrages!.push(event))
    })

    let overlayPage: Page | undefined
    if (options.scenario === 'full-pipeline') {
      await controlPage.evaluate(() => (window as unknown as FixtureWindow).advx.showOverlay())
      overlayPage = await waitFor(
        'overlay window',
        async () => electronApp!.windows().find(isOverlayWindow) ?? null,
        deadlines.actionMs
      )
      attachPage(overlayPage)
      await overlayPage.waitForLoadState('domcontentloaded')
      await submitMediaInputs(controlPage)
    }

    await controlPage.evaluate(() =>
      (window as unknown as FixtureWindow).advx.submitUserText('tst-008 recorded pipeline input')
    )
    const barrage = await waitFor(
      'recorded barrage',
      () => controlPage!.evaluate(() => (window as unknown as FixtureWindow).__tst008Barrages?.at(-1) ?? null),
      deadlines.actionMs
    )
    barrageText = barrage.text
    assert.equal(barrage.sessionId, started.sessionId)
    assert.match(barrage.text, /^Recorded reply:/)

    if (overlayPage) {
      await controlPage.evaluate(
        (backendEvent) => (window as unknown as FixtureWindow).advx.pushBarrage({
          barrageId: backendEvent.barrageId,
          audienceId: backendEvent.audienceId,
          audienceName: backendEvent.audienceName,
          text: backendEvent.text,
          color: '#5f8f7a',
          createdAt: backendEvent.createdAt,
          mode: 'scroll',
          roomId: backendEvent.roomId,
          sessionId: backendEvent.sessionId,
          audienceEpoch: backendEvent.audienceEpoch,
          observationId: backendEvent.observationId,
          generationRequestId: backendEvent.generationRequestId,
          viewerInstanceId: backendEvent.viewerInstanceId,
          personaId: backendEvent.personaId,
          viewerSequence: backendEvent.viewerSequence,
          reactionType: backendEvent.reactionType,
          evidenceRefs: backendEvent.evidenceRefs,
          expiresAt: backendEvent.expiresAt
        }),
        barrage
      )
      const overlayBarrage = overlayPage.locator('.overlay-barrage', { hasText: barrage.text })
      await overlayBarrage.waitFor({ state: 'visible', timeout: deadlines.actionMs })
      await overlayPage.screenshot({ path: join(artifactDirectory, 'overlay.png') })
      overlayRendered = true
    }

    const traces = await controlPage.evaluate(
      (sessionId) => (window as unknown as FixtureWindow).advx.queryDebugTraces(sessionId),
      started.sessionId
    )
    traceCount = traces.items.length
    assert.ok(traceCount > 0)
    const latestTrace = traces.items.at(-1)!
    frameHashCount = latestTrace.frame_hashes?.length ?? 0
    traceProvider = latestTrace.provider.model_id
    assert.equal(traceProvider, 'recorded-viewer-v1')
    if (options.scenario === 'full-pipeline') assert.ok(frameHashCount > 0)

    const stopped = await controlPage.evaluate(() =>
      (window as unknown as FixtureWindow).advx.stopBackendSession()
    )
    assert.equal(stopped.state, 'idle')
    sessionStarted = false
    sessionStopped = true

    const fatalDiagnostics = diagnosticEntries.filter(isFatalDiagnostic)
    assert.deepEqual(
      fatalDiagnostics,
      [],
      `Electron diagnostics contain fatal errors: ${JSON.stringify(fatalDiagnostics)}`
    )
    await electronApp.context().tracing.stop()
    tracingStarted = false
    scenarioPassed = true
  } catch (error) {
    failure = error
    if (electronApp) {
      failureScreenshots.push(...await captureFailureScreenshots(electronApp, artifactDirectory))
      if (tracingStarted) {
        try {
          await electronApp.context().tracing.stop({ path: tracePath })
          traceArtifact = 'trace.zip'
        } catch (traceError) {
          addDiagnostic({
            kind: 'process-error',
            source: 'electron-process',
            level: 'error',
            text: traceError
          })
        } finally {
          tracingStarted = false
        }
      }
    }
    applicationLogArtifact = await captureApplicationLog(electronUserDataDirectory, artifactDirectory)
  } finally {
    if (tracingStarted && electronApp) {
      await electronApp.context().tracing.stop().catch(() => undefined)
      tracingStarted = false
    }
    if (sessionStarted && controlPage) {
      try {
        const stopped = await withDeadline(
          'session cleanup',
          controlPage.evaluate(() => (window as unknown as FixtureWindow).advx.stopBackendSession()),
          deadlines.shutdownMs
        )
        sessionStopped = stopped.state === 'idle'
        sessionStarted = false
      } catch (cleanupError) {
        failure ??= cleanupError
        addDiagnostic({
          kind: 'process-error',
          source: 'electron-process',
          level: 'error',
          text: cleanupError
        })
      }
    }
    if (electronApp && !electronClosed) {
      try {
        await withDeadline('Electron close', electronApp.close(), deadlines.shutdownMs)
        electronClosed = true
      } catch (closeError) {
        failure ??= closeError
        addDiagnostic({
          kind: 'process-error',
          source: 'electron-process',
          level: 'error',
          text: closeError
        })
        await terminateProcessTree(electronApp.process().pid)
        electronClosed = true
      }
    }
    try {
      await waitFor('Bun port release', () => portIsFree(backendPort), deadlines.shutdownMs)
      backendPortReleased = true
    } catch (portError) {
      failure ??= portError
      addDiagnostic({
        kind: 'process-error',
        source: 'electron-process',
        level: 'error',
        text: portError
      })
    }
    try {
      await rm(temporaryDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      temporaryDirectoryRemoved = !(await pathExists(temporaryDirectory))
    } catch (removeError) {
      failure ??= removeError
      addDiagnostic({
        kind: 'process-error',
        source: 'electron-process',
        level: 'error',
        text: removeError
      })
    }
  }

  const serializedFailure = failure ? serializeError(failure) : null
  const status = scenarioPassed && serializedFailure === null ? 'passed' : 'failed'
  const result: RecordedElectronScenarioResult = {
    schema_version: 1,
    task_id: 'TST-008',
    status,
    scenario: options.scenario,
    backend_runtime: options.backendRuntime,
    provider_mode: 'recorded',
    provider_model: 'recorded-viewer-v1',
    duration_ms: Date.now() - startedAt,
    inputs: options.scenario === 'full-pipeline'
      ? ['text', 'frame', 'microphone', 'system_audio']
      : ['text'],
    barrage: {
      delivered: barrageText !== null,
      text_prefix: barrageText?.slice(0, 'Recorded reply:'.length) ?? null
    },
    overlay: {
      rendered: overlayRendered,
      screenshot: overlayRendered ? 'overlay.png' : null
    },
    traces: {
      count: traceCount,
      frame_hash_count: frameHashCount,
      provider: traceProvider
    },
    isolation: {
      electron_user_data: 'isolated-temporary-directory',
      backend_data_relative: backendDataRelative,
      backend_data_observed: backendDataObserved
    },
    diagnostics: {
      collected: diagnosticEntries.length,
      error_count: diagnosticEntries.filter((entry) => entry.level === 'error').length,
      fatal_error_count: diagnosticEntries.filter(isFatalDiagnostic).length,
      artifact: 'diagnostics.json'
    },
    failure_artifacts: {
      trace: traceArtifact,
      screenshots: failureScreenshots,
      application_log: applicationLogArtifact,
      video: 'disabled-short-deterministic-scenario'
    },
    deadlines_ms: deadlines,
    cleanup: {
      session_stopped: sessionStopped,
      electron_closed: electronClosed,
      backend_port_released: backendPortReleased,
      temporary_directory_removed: temporaryDirectoryRemoved
    },
    failure: serializedFailure
  }
  await writeJsonAtomic(diagnosticsPath, { schema_version: 1, entries: diagnosticEntries })
  await writeJsonAtomic(resultPath, result)
  if (status === 'failed') {
    throw new Error(`TST-008 ${options.backendRuntime}/${options.scenario} failed: ${serializedFailure?.message ?? 'cleanup failure'}`)
  }
  return result
}

async function submitMediaInputs(controlPage: Page): Promise<void> {
  const capturedAtMs = Date.now()
  await controlPage.evaluate(
    ({ encoded, captured }) => {
      const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
      return (window as unknown as FixtureWindow).advx.submitVisualFrame({
        inputId: 'tst-008-frame',
        capturedAtMs: captured,
        mimeType: 'image/png',
        changeScore: 1,
        visualSignature: 'a'.repeat(192),
        body: bytes
      })
    },
    { encoded: syntheticFrameBase64, captured: capturedAtMs }
  )
  const audioBody = [0, 0, 1, 0, 2, 0, 3, 0]
  await controlPage.evaluate(
    ({ body, captured }) => (window as unknown as FixtureWindow).advx.submitAudioSegment({
      source: 'system_audio',
      inputId: 'tst-008-system-audio',
      capturedAtMs: captured,
      body: Uint8Array.from(body)
    }),
    { body: audioBody, captured: capturedAtMs }
  )
  await controlPage.evaluate(
    ({ body, captured }) => (window as unknown as FixtureWindow).advx.submitAudioSegment({
      source: 'microphone',
      inputId: 'tst-008-microphone',
      capturedAtMs: captured,
      turnId: 'tst-008-turn',
      systemAudioRequired: true,
      body: Uint8Array.from(body)
    }),
    { body: audioBody, captured: capturedAtMs }
  )
  await controlPage.evaluate(() =>
    (window as unknown as FixtureWindow).advx.notifyVoiceActivity('microphone', Date.now())
  )
}

function constrainWorkspace(workspace: AudienceWorkspaceState): AudienceWorkspaceState {
  const personas = workspace.personas.slice(0, 32)
  const firstPersona = personas[0]
  const sourceMode = workspace.modeState.modes.find(
    (mode) => mode.id === workspace.modeState.activeModeId
  ) ?? workspace.modeState.modes[0]
  if (!firstPersona || !sourceMode) throw new Error('recorded workspace fixture is empty')
  const allowed = new Set(personas.map((persona) => persona.id))
  const personaCounts = Object.fromEntries(
    Object.entries(sourceMode.personaCounts).filter(([personaId]) => allowed.has(personaId))
  )
  if (Object.keys(personaCounts).length === 0) personaCounts[firstPersona.id] = 0
  const personaOverrides = Object.fromEntries(
    Object.entries(sourceMode.personaOverrides).filter(([personaId]) => allowed.has(personaId))
  )
  const total = Math.max(1, Object.values(personaCounts).reduce((sum, count) => sum + count, 0))
  const clampRange = (range: readonly [number, number]): readonly [number, number] => [
    Math.min(range[0], total),
    Math.min(Math.max(range[0], range[1]), total)
  ]
  return {
    ...workspace,
    personas,
    modeState: {
      ...workspace.modeState,
      modes: [{
        ...sourceMode,
        personaCounts,
        personaOverrides,
        normalResponseRange: clampRange(sourceMode.normalResponseRange),
        highlightResponseRange: clampRange(sourceMode.highlightResponseRange)
      }]
    }
  }
}

async function waitFor<T>(
  description: string,
  operation: () => Promise<T | null | false>,
  timeoutMs: number
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const value = await operation()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error(
    `${description} did not become ready within ${timeoutMs}ms${lastError ? `: ${serializeError(lastError).message}` : ''}`
  )
}

async function withDeadline<T>(description: string, operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${description} exceeded ${timeoutMs}ms`)),
          timeoutMs
        )
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

async function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolveFree) => {
    const server = createServer()
    server.once('error', () => resolveFree(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolveFree(true)))
  })
}

async function terminateProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) return
  if (process.platform === 'win32') {
    await execFileAsync('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      timeout: 10_000
    }).catch(() => undefined)
    return
  }
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // The process already exited.
  }
}

async function captureFailureScreenshots(
  electronApp: ElectronApplication,
  artifactDirectory: string
): Promise<string[]> {
  const screenshotDirectory = join(artifactDirectory, 'failure-screenshots')
  await mkdir(screenshotDirectory, { recursive: true })
  const captured: string[] = []
  for (const [index, page] of electronApp.windows().entries()) {
    const name = `window-${index + 1}.png`
    try {
      await page.screenshot({ path: join(screenshotDirectory, name), timeout: 5_000 })
      captured.push(`failure-screenshots/${name}`)
    } catch {
      // A crashed or already closed renderer cannot provide a screenshot.
    }
  }
  return captured
}

async function captureApplicationLog(
  electronUserDataDirectory: string,
  artifactDirectory: string
): Promise<string | null> {
  try {
    const source = join(electronUserDataDirectory, 'logs', 'advx.log')
    const contents = await readFile(source, 'utf8')
    const targetName = 'application.log'
    await writeFile(
      join(artifactDirectory, targetName),
      `${redactDiagnostic(contents).slice(-1_000_000)}\n`,
      'utf8'
    )
    return targetName
  } catch {
    return null
  }
}

function normalizeConsoleLevel(message: ConsoleMessage): DiagnosticEntry['level'] {
  const type = message.type()
  if (type === 'error' || type === 'assert') return 'error'
  if (type === 'warning') return 'warning'
  if (type === 'debug' || type === 'trace') return 'debug'
  return 'info'
}

function isFatalDiagnostic(entry: DiagnosticEntry): boolean {
  return entry.kind === 'page-error' || entry.kind === 'page-crash' || entry.kind === 'process-error'
}

function isOverlayWindow(page: Page): boolean {
  return page.url().replaceAll('\\', '/').includes('/overlay/')
}

function redactDiagnostic(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s,;"']+/gi, '$1[REDACTED]')
    .replace(/recorded-(?:model|asr)-key/g, '[REDACTED]')
}

function serializeError(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.name, message: redactDiagnostic(error.message).slice(0, 2_000) }
  }
  return { name: 'Error', message: redactDiagnostic(String(error)).slice(0, 2_000) }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, path)
}
