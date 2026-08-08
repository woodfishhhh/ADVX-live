import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright'
import type { ConsoleMessage, ElectronApplication, Page } from 'playwright'

import type { AudienceWorkspaceState } from '../apps/desktop/src/shared/audience/types.ts'
import type {
  BackendBarrageEvent,
  BackendRuntimeStatus,
  ControlApi
} from '../apps/desktop/src/shared/contracts.ts'
import {
  ExecutionGuard,
  parseNamedArguments,
  parsePositiveInteger,
  requireSafeArtifactRoot,
  runMachineCli,
  SCRIPT_EXIT,
  ScriptError,
  writeJsonAtomic
} from './evidence-script-runtime.ts'

type JsonRecord = Record<string, unknown>
type DiagnosticEntry = Readonly<{
  at: string
  kind: 'console' | 'page-error' | 'page-crash' | 'process-error' | 'stdio'
  source: 'electron-main' | 'electron-process' | 'renderer'
  level: 'debug' | 'info' | 'warning' | 'error'
  text: string
}>
type ResourceProcess = Readonly<{
  id: number
  workingSetBytes: number
  cpuSeconds: number
}>
type ResourceSample = Readonly<{
  label: string
  at: string
  electron: ResourceProcess
  backend: ResourceProcess
}>
type SoakWindow = Window & {
  advx: ControlApi
  __cut002?: {
    barrages: Array<BackendBarrageEvent & { receivedAtMs: number }>
    statuses: Array<BackendRuntimeStatus & { receivedAtMs: number }>
    inFlightStartedAtMs: number | null
    inFlightSettled: number
    inFlightErrors: string[]
  }
}

const repositoryRoot = resolve(process.cwd())
const desktopRoot = join(repositoryRoot, 'apps', 'desktop')
const diagnosticsCli = join(
  repositoryRoot,
  'apps',
  'backend-bun',
  'src',
  'diagnostics',
  'cli.ts'
)
const decisionPath = join(
  repositoryRoot,
  'docs',
  'migrations',
  'typescript-bun',
  'CUT-002-BUN-DEFAULT-SOAK.md'
)
const args = parseNamedArguments(
  process.argv.slice(2),
  new Set(['--artifact-root', '--timeout-ms'])
)
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ?? join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'cut-002'),
  repositoryRoot
)
const timeoutMs = parsePositiveInteger(args.get('--timeout-ms') ?? '180000', '--timeout-ms')
const runtimeRoot = join(artifactRoot, 'runtime')
const userDataDirectory = join(runtimeRoot, 'electron-user-data')
const backendDataDirectory = join(runtimeRoot, 'backend-data')
const applicationLogPath = join(userDataDirectory, 'logs', 'advx.log')
const databasePath = join(backendDataDirectory, 'advx.sqlite3')
const modelSecret = `cut002-model-${randomBytes(12).toString('hex')}`
const asrSecret = `cut002-asr-${randomBytes(12).toString('hex')}`
const ambientSecret = `cut002-ambient-${randomBytes(12).toString('hex')}`
const resourceLimits = {
  electronWorkingSetBytes: 1024 * 1024 * 1024,
  backendWorkingSetBytes: 512 * 1024 * 1024
} as const
const frameBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

function verify(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScriptError(SCRIPT_EXIT.verificationFailed, message)
}

await runMachineCli(async () => {
  const startedAt = Date.now()
  const guard = new ExecutionGuard(timeoutMs)
  let electronApp: ElectronApplication | undefined
  let electronClosed = false
  let electronPid = 0
  let currentStage = 'preflight'
  const diagnosticEntries: DiagnosticEntry[] = []
  const checkpoint = async (stage: string): Promise<void> => {
    currentStage = stage
    await writeJsonAtomic(join(artifactRoot, 'progress.json'), {
      stage,
      at: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt
    })
  }

  guard.addCleanup(async () => {
    if (electronApp && !electronClosed) {
      await electronApp.close().catch(() => undefined)
      electronClosed = true
    }
    if (electronPid > 0 && await taskExists(electronPid)) await taskkill(electronPid)
  })

  try {
    return await guard.race((async () => {
      verify(process.platform === 'win32' && process.arch === 'x64', 'CUT-002 requires Windows x64')
      verify(process.versions.node === '24.18.0', `CUT-002 requires Node 24.18.0, got ${process.versions.node}`)
      await rm(artifactRoot, { recursive: true, force: true })
      await mkdir(runtimeRoot, { recursive: true })
      await checkpoint('contract')

      const decision = await readFile(decisionPath, 'utf8')
      for (const clause of [
        'Overall runner deadline | 180 seconds',
        'Clean Session cycles | 3',
        'In-flight quit cycle | 1',
        'Electron main working-set ceiling | 1 GiB',
        'Bun backend working-set ceiling | 512 MiB',
        'no output arrives after',
        'no unhandled rejection'
      ]) {
        verify(decision.toLowerCase().includes(clause.toLowerCase()), `soak contract is missing: ${clause}`)
      }
      await checkpoint('targeted-tests')

      const targetedTests = []
      targetedTests.push(await runTargetedTest(
        'provider-timeout-rate-limit-reconnect',
        'apps/backend-bun/src/testing/tst-005-provider-faults.test.ts',
        'timeout and caller cancellation|401, 403, 429|one bounded reconnect'
      ))
      targetedTests.push(await runTargetedTest(
        'provider-rate-limit-recovery',
        'apps/backend-bun/src/testing/tst-004-scheduling-invariants.test.ts',
        'retry-backoff-caps'
      ))
      targetedTests.push(await runTargetedTest(
        'sqlite-retention',
        'apps/backend-bun/src/infrastructure/persistence/sqlite/room-event-repository.test.ts',
        'applies source-specific retention'
      ))
      const bunVersionResult = await runCommand(['bun', '--version'], repositoryRoot)
      verify(bunVersionResult.exitCode === 0, `Bun version probe failed: ${bunVersionResult.stderr}`)
      const bunVersion = bunVersionResult.stdout.trim()
      await checkpoint('electron-launch')

      const backendPort = await availablePort()
      verify(await portIsFree(backendPort), `backend port ${backendPort} is unavailable`)
      const cleanEnvironment = Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] =>
          entry[1] !== undefined &&
          entry[0] !== 'ELECTRON_RUN_AS_NODE' &&
          entry[0] !== 'ADVX_BACKEND_RUNTIME'
        )
      )
      electronApp = await electron.launch({
        args: ['.', `--user-data-dir=${userDataDirectory}`],
        cwd: desktopRoot,
        env: {
          ...cleanEnvironment,
          ADVX_BACKEND_EXTERNAL: '0',
          ADVX_BACKEND_URL: `http://127.0.0.1:${backendPort}`,
          ADVX_BACKEND_DATA_DIR: backendDataDirectory,
          ADVX_RECORDED_PIPELINE: '1',
          OPENAI_API_KEY: ambientSecret,
          ELECTRON_DISABLE_SECURITY_WARNINGS: 'true'
        }
      })
      electronPid = electronApp.process().pid ?? 0
      verify(electronPid > 0, 'Electron PID is unavailable')
      electronApp.on('console', (message) => addDiagnostic(diagnosticEntries, {
        source: 'electron-main',
        level: normalizeConsoleLevel(message),
        text: message.text()
      }))
      electronApp.on('window', (page) => attachPage(page, diagnosticEntries))
      electronApp.on('close', () => {
        electronClosed = true
      })
      electronApp.process().on('error', (error) => addDiagnostic(diagnosticEntries, {
        kind: 'process-error',
        source: 'electron-process',
        level: 'error',
        text: String(error)
      }))
      electronApp.process().stdout?.on('data', (chunk: Buffer | string) =>
        addDiagnostic(diagnosticEntries, {
          kind: 'stdio',
          source: 'electron-process',
          level: 'info',
          text: String(chunk)
        })
      )
      electronApp.process().stderr?.on('data', (chunk: Buffer | string) =>
        addDiagnostic(diagnosticEntries, {
          kind: 'stdio',
          source: 'electron-process',
          level: 'warning',
          text: String(chunk)
        })
      )
      await checkpoint('control-window')

      const controlPage = await withDeadline(
        'control window',
        electronApp.firstWindow({ timeout: 30_000 }),
        30_000
      )
      attachPage(controlPage, diagnosticEntries)
      controlPage.setDefaultTimeout(20_000)
      await controlPage.getByRole('heading', { name: '直播控制台', exact: true }).waitFor()
      await checkpoint('default-runtime')
      await controlPage.evaluate(() => {
        const soakWindow = window as unknown as SoakWindow
        soakWindow.__cut002 = {
          barrages: [],
          statuses: [],
          inFlightStartedAtMs: null,
          inFlightSettled: 0,
          inFlightErrors: []
        }
        soakWindow.advx.onBackendBarrage((event) =>
          soakWindow.__cut002!.barrages.push({ ...event, receivedAtMs: Date.now() })
        )
        soakWindow.advx.onBackendStatus((status) =>
          soakWindow.__cut002!.statuses.push({ ...status, receivedAtMs: Date.now() })
        )
      })

      const initialStatus = await waitFor(
        'default Bun connection',
        async () => {
          const status = await controlPage.evaluate(() =>
            (window as unknown as SoakWindow).advx.getBackendStatus()
          )
          return status.connection === 'connected' ? status : null
        },
        30_000
      )
      verify(initialStatus.backendRuntime === 'bun-source', 'runtime selector did not use the Bun default')
      await checkpoint('provider-config')

      const saved = await controlPage.evaluate(
        ({ modelKey, asrKey }) => (window as unknown as SoakWindow).advx.saveModelConfig({
          baseUrl: 'recorded://model',
          providerProfileId: 'cut-002-recorded',
          model: 'recorded-viewer-v1',
          viewerModel: 'recorded-viewer-v1',
          memoryModel: 'recorded-memory-v1',
          visualSummaryModel: 'recorded-visual-v1',
          apiKey: modelKey,
          asrBaseUrl: 'recorded://asr',
          asrModel: 'recorded-asr-v1',
          asrApiKey: asrKey
        }),
        { modelKey: modelSecret, asrKey: asrSecret }
      )
      verify(saved.ok, 'recorded Provider configuration failed')
      await checkpoint('workspace')
      const workspace = await waitFor(
        'audience workspace',
        () => controlPage.evaluate(() =>
          (window as unknown as SoakWindow).advx.loadAudienceWorkspace()
        ),
        20_000
      )
      const fixtureWorkspace = constrainWorkspace(workspace)
      const cycles: JsonRecord[] = []
      const traces: JsonRecord[] = []
      const stoppedSessions: Array<{ sessionId: string; stoppedAtMs: number }> = []
      const resourceSamples: ResourceSample[] = []

      const cycle1 = await startCycle(controlPage, fixtureWorkspace, 'cycle-1-full-media')
      await submitMedia(controlPage, 'cycle-1', { frame: true, microphone: true, systemAudio: true })
      const barrage1 = await submitTextAndWaitForBarrage(
        controlPage,
        cycle1.sessionId!,
        'cut-002 full-media barrage'
      )
      const trace1 = await controlPage.evaluate(
        (sessionId) => (window as unknown as SoakWindow).advx.queryDebugTraces(sessionId),
        cycle1.sessionId!
      )
      verify(trace1.items.some((item) => item.response_status === 'published'), 'cycle 1 lacks published trace')
      traces.push({ cycle: 1, sessionId: cycle1.sessionId, responseStatus: 'published', count: trace1.items.length })
      stoppedSessions.push(await stopCycle(controlPage, cycle1.sessionId!))
      cycles.push({ cycle: 1, sessionId: cycle1.sessionId, inputs: ['text', 'frame', 'microphone', 'system_audio', 'voice_activity'], outcome: 'barrage', barrageId: barrage1.barrageId })

      const firstPids = await waitForBackendPids(applicationLogPath, 1)
      resourceSamples.push(await sampleResources('after-cycle-1', electronPid, firstPids.at(-1)!))
      await checkpoint('cycle-1-complete')

      const cycle2 = await startCycle(controlPage, fixtureWorkspace, 'cycle-2-silence')
      await submitMedia(controlPage, 'cycle-2', { frame: true, microphone: false, systemAudio: true })
      await sleep(600)
      const cycle2Barrages = await barrageEvents(controlPage)
      verify(!cycle2Barrages.some((event) => event.sessionId === cycle2.sessionId), 'silence cycle published a barrage')
      const trace2 = await controlPage.evaluate(
        (sessionId) => (window as unknown as SoakWindow).advx.queryDebugTraces(sessionId),
        cycle2.sessionId!
      )
      verify(trace2.items.some((item) => item.response_status === 'silence'), 'cycle 2 lacks silence trace')
      traces.push({ cycle: 2, sessionId: cycle2.sessionId, responseStatus: 'silence', count: trace2.items.length })
      stoppedSessions.push(await stopCycle(controlPage, cycle2.sessionId!))
      cycles.push({ cycle: 2, sessionId: cycle2.sessionId, inputs: ['frame', 'system_audio'], outcome: 'silence' })
      await checkpoint('cycle-2-complete')

      const statusOffset = await controlPage.evaluate(() =>
        (window as unknown as SoakWindow).__cut002!.statuses.length
      )
      const pidsBeforeRestart = await waitForBackendPids(applicationLogPath, firstPids.length)
      const oldBackendPid = pidsBeforeRestart.at(-1)!
      const restarted = await controlPage.evaluate(() =>
        (window as unknown as SoakWindow).advx.restartBackend()
      )
      verify(restarted.connection === 'connected' && restarted.backendRuntime === 'bun-source', 'backend restart did not reconnect Bun')
      const pidsAfterRestart = await waitForBackendPids(applicationLogPath, pidsBeforeRestart.length + 1)
      const newBackendPid = pidsAfterRestart.at(-1)!
      verify(newBackendPid !== oldBackendPid, 'backend restart reused the old PID')
      await waitFor('old backend exit', async () => !(await taskExists(oldBackendPid)), 20_000)
      const restartStatuses = await controlPage.evaluate(
        (offset) => (window as unknown as SoakWindow).__cut002!.statuses.slice(offset),
        statusOffset
      )
      verify(
        restartStatuses.some((status) => status.connection !== 'connected') &&
          restartStatuses.at(-1)?.connection === 'connected',
        'WebSocket restart did not expose disconnect/reconnect states'
      )
      resourceSamples.push(await sampleResources('after-backend-restart', electronPid, newBackendPid))
      await checkpoint('backend-restart-complete')

      const cycle3 = await startCycle(controlPage, fixtureWorkspace, 'cycle-3-post-restart')
      await submitMedia(controlPage, 'cycle-3', { frame: false, microphone: true, systemAudio: false })
      const barrage3 = await submitTextAndWaitForBarrage(
        controlPage,
        cycle3.sessionId!,
        'cut-002 post-restart barrage'
      )
      const trace3 = await controlPage.evaluate(
        (sessionId) => (window as unknown as SoakWindow).advx.queryDebugTraces(sessionId),
        cycle3.sessionId!
      )
      verify(trace3.items.some((item) => item.response_status === 'published'), 'cycle 3 lacks published trace')
      traces.push({ cycle: 3, sessionId: cycle3.sessionId, responseStatus: 'published', count: trace3.items.length })
      stoppedSessions.push(await stopCycle(controlPage, cycle3.sessionId!))
      cycles.push({ cycle: 3, sessionId: cycle3.sessionId, inputs: ['text', 'microphone', 'voice_activity'], outcome: 'barrage', barrageId: barrage3.barrageId, backendRestarted: true })
      resourceSamples.push(await sampleResources('after-cycle-3', electronPid, newBackendPid))
      await checkpoint('cycle-3-complete')

      for (const sample of resourceSamples) {
        verify(sample.electron.workingSetBytes <= resourceLimits.electronWorkingSetBytes, `${sample.label} Electron memory ceiling exceeded`)
        verify(sample.backend.workingSetBytes <= resourceLimits.backendWorkingSetBytes, `${sample.label} Bun memory ceiling exceeded`)
      }
      const allBarragesBeforeQuit = await barrageEvents(controlPage)
      const staleOutputs = allBarragesBeforeQuit.filter((event) =>
        stoppedSessions.some((stopped) =>
          stopped.sessionId === event.sessionId && event.receivedAtMs > stopped.stoppedAtMs
        )
      )
      verify(staleOutputs.length === 0, `stale barrage output observed: ${JSON.stringify(staleOutputs)}`)

      const cycle4 = await startCycle(controlPage, fixtureWorkspace, 'cycle-4-in-flight-quit')
      const inFlightStarted = await controlPage.evaluate(
        ({ encoded, sessionId }) => {
          const soakWindow = window as unknown as SoakWindow
          const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
          soakWindow.__cut002!.inFlightStartedAtMs = Date.now()
          const observe = (operation: Promise<unknown>): void => {
            void operation
              .then(() => { soakWindow.__cut002!.inFlightSettled += 1 })
              .catch((error: unknown) => { soakWindow.__cut002!.inFlightErrors.push(String(error)) })
          }
          observe(soakWindow.advx.submitUserText(`cut-002 in-flight quit ${sessionId}`))
          observe(soakWindow.advx.submitVisualFrame({
            inputId: 'cut-002-in-flight-frame',
            capturedAtMs: Date.now(),
            mimeType: 'image/png',
            changeScore: 1,
            visualSignature: 'f'.repeat(192),
            body: bytes
          }))
          return soakWindow.__cut002!.inFlightStartedAtMs
        },
        { encoded: frameBase64, sessionId: cycle4.sessionId! }
      )
      verify(typeof inFlightStarted === 'number' && inFlightStarted > 0, 'in-flight quit work did not start')
      const processTree = await descendantPids(electronPid)
      cycles.push({ cycle: 4, sessionId: cycle4.sessionId, inputs: ['text', 'frame'], outcome: 'electron-quit-in-flight', startedAtMs: inFlightStarted })

      await withDeadline('Electron in-flight close', electronApp.close(), 20_000)
      electronClosed = true
      await checkpoint('electron-closed')
      await waitFor('backend port release', () => portIsFree(backendPort), 20_000)
      for (const pid of processTree) {
        await waitFor(`process ${pid} exit`, async () => !(await taskExists(pid)), 20_000)
      }
      for (const pid of pidsAfterRestart) {
        verify(!(await taskExists(pid)), `Bun backend orphan remains: ${pid}`)
      }

      const databaseBytes = (await stat(databasePath)).size
      const walBytes = await fileSize(`${databasePath}-wal`)
      const database = new DatabaseSync(databasePath, { readOnly: true })
      const quickCheck = firstColumn(database.prepare('PRAGMA quick_check').get())
      const applicationTables = (database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
      ).all() as Array<{ name: string }>).map((row) => row.name)
      const schemaVersion = applicationTables.includes('advx_schema_migrations')
        ? Number(firstColumn(database.prepare('SELECT MAX(version) FROM advx_schema_migrations').get()))
        : null
      database.close()
      verify(quickCheck === 'ok', 'SQLite quick_check failed')
      verify(walBytes === 0, `SQLite WAL was not cleanly truncated: ${walBytes} bytes`)
      verify(databaseBytes <= 32 * 1024 * 1024, `process database exceeded 32 MiB: ${databaseBytes}`)
      if (schemaVersion !== null) verify(schemaVersion === 6, `unexpected SQLite schema version: ${schemaVersion}`)
      await checkpoint('database-checked')

      const applicationLog = await readFile(applicationLogPath, 'utf8')
      const unhandledDiagnostics = diagnosticEntries.filter((entry) =>
        /unhandled(?:promiserejection| rejection)|uncaught exception/i.test(entry.text)
      )
      const fatalDiagnostics = diagnosticEntries.filter((entry) =>
        entry.kind === 'page-error' || entry.kind === 'page-crash' || entry.kind === 'process-error'
      )
      verify(unhandledDiagnostics.length === 0, `unhandled rejection observed: ${JSON.stringify(unhandledDiagnostics)}`)
      verify(fatalDiagnostics.length === 0, `fatal diagnostics observed: ${JSON.stringify(fatalDiagnostics)}`)
      verify(!/unhandled(?:promiserejection| rejection)|uncaught exception/i.test(applicationLog), 'application log contains an unhandled failure')

      const redactedDiagnostics = diagnosticEntries.map((entry) => ({
        ...entry,
        text: redact(entry.text, [modelSecret, asrSecret, ambientSecret])
      }))
      await writeJsonAtomic(join(artifactRoot, 'runtime-diagnostics.json'), {
        schema_version: 1,
        entries: redactedDiagnostics
      })
      const diagnosticsInput = {
        destination: join(artifactRoot, 'diagnostics-bundle'),
        requested: ['versions', 'health', 'debug-snapshot', 'viewer-traces', 'redacted-logs'],
        json: [
          { kind: 'versions', name: 'runtime.json', redacted: true, value: { bun: bunVersion, node: process.versions.node, platform: process.platform, arch: process.arch, backend_runtime: 'bun-source' } },
          { kind: 'health', name: 'backend-status.json', redacted: true, value: initialStatus },
          { kind: 'debug-snapshot', name: 'soak-database.json', redacted: true, value: { quick_check: quickCheck, database_bytes: databaseBytes, wal_bytes: walBytes, application_schema_version: schemaVersion, application_tables: applicationTables } },
          { kind: 'viewer-traces', name: 'soak-traces.json', redacted: true, value: traces },
          { kind: 'redacted-logs', name: 'runtime-diagnostics.json', redacted: true, value: redactedDiagnostics }
        ]
      }
      const diagnostics = await runCommand(
        ['bun', diagnosticsCli],
        repositoryRoot,
        JSON.stringify(diagnosticsInput)
      )
      verify(diagnostics.exitCode === 0, `diagnostics bundle failed: ${tail(diagnostics.stderr || diagnostics.stdout)}`)
      const diagnosticsResponse = JSON.parse(diagnostics.stdout) as JsonRecord
      verify(diagnosticsResponse.ok === true, 'diagnostics CLI did not return ok')
      const manifest = JSON.parse(
        await readFile(join(artifactRoot, 'diagnostics-bundle', 'manifest.json'), 'utf8')
      ) as JsonRecord
      verify(manifest.redacted === true, 'diagnostics manifest is not redacted')
      verify(Array.isArray(manifest.files) && manifest.files.length === 5, 'diagnostics bundle is incomplete')

      const secretLeaks = await scanSecrets(
        artifactRoot,
        [modelSecret, asrSecret, ambientSecret],
        new Set([relative(artifactRoot, userDataDirectory).replaceAll('\\', '/')])
      )
      verify(secretLeaks.length === 0, `fixture secret leaked into evidence: ${secretLeaks.join(', ')}`)
      await checkpoint('complete')

      const result = {
        schemaVersion: 1,
        taskId: 'CUT-002',
        status: 'passed',
        platformClaim: 'windows-x64-only',
        contract: {
          timeoutMs,
          cleanCycles: 3,
          inFlightQuitCycles: 1,
          staleObservationMs: 300,
          resourceLimits
        },
        defaultRuntime: initialStatus.backendRuntime,
        targetedTests,
        cycles,
        barrageWaves: { published: 2, silence: 1, staleOutputs: 0 },
        restart: {
          oldBackendPid,
          newBackendPid,
          oldBackendExited: true,
          statusTransitions: restartStatuses.map((status) => status.connection),
          reconnected: true
        },
        resources: resourceSamples,
        database: {
          quickCheck,
          databaseBytes,
          walBytes,
          applicationSchemaVersion: schemaVersion,
          applicationTables,
          runtimeSessionPersistence: 'transient-control',
          runtimeCompaction: 'not-exposed',
          migrationWriteRetentionTargetedTest: 'passed'
        },
        diagnostics: {
          collected: diagnosticEntries.length,
          fatal: fatalDiagnostics.length,
          unhandled: unhandledDiagnostics.length,
          bundleFiles: (manifest.files as unknown[]).length,
          redacted: manifest.redacted
        },
        cleanup: {
          electronClosed,
          backendPortReleased: true,
          processTreeChecked: processTree,
          backendPidsChecked: pidsAfterRestart,
          orphanCount: 0
        },
        secretLeaks,
        durationMs: Date.now() - startedAt,
        runtime: { bun: bunVersion, node: process.versions.node, platform: process.platform, arch: process.arch }
      } as const
      await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
      return result
    })())
  } catch (error) {
    await mkdir(artifactRoot, { recursive: true })
    await writeJsonAtomic(join(artifactRoot, 'failure.json'), {
      stage: currentStage,
      at: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      diagnostics: diagnosticEntries.map((entry) => ({
        ...entry,
        text: redact(entry.text, [modelSecret, asrSecret, ambientSecret])
      }))
    })
    throw error
  } finally {
    await guard.close()
  }
})

async function startCycle(
  page: Page,
  workspace: AudienceWorkspaceState,
  clientRequestId: string
) {
  const started = await page.evaluate(
    ({ value, requestId }) =>
      (window as unknown as SoakWindow).advx.startBackendSession(value, requestId),
    { value: workspace, requestId: clientRequestId }
  )
  verify(started.state === 'running' && started.sessionId, `${clientRequestId} did not start`)
  return started
}

async function stopCycle(page: Page, sessionId: string) {
  const stopped = await page.evaluate(() =>
    (window as unknown as SoakWindow).advx.stopBackendSession()
  )
  verify(stopped.state === 'idle', `Session ${sessionId} did not stop`)
  const stoppedAtMs = Date.now()
  await sleep(300)
  const late = (await barrageEvents(page)).filter((event) =>
    event.sessionId === sessionId && event.receivedAtMs > stoppedAtMs
  )
  verify(late.length === 0, `Session ${sessionId} produced stale output after stop`)
  return { sessionId, stoppedAtMs }
}

async function submitTextAndWaitForBarrage(page: Page, sessionId: string, text: string) {
  const offset = (await barrageEvents(page)).length
  await page.evaluate(
    (value) => (window as unknown as SoakWindow).advx.submitUserText(value),
    text
  )
  return waitFor(
    `barrage for ${sessionId}`,
    async () => {
      const events = await barrageEvents(page)
      const event = events.slice(offset).find((candidate) => candidate.sessionId === sessionId)
      return event ?? null
    },
    20_000
  )
}

async function barrageEvents(page: Page) {
  return page.evaluate(() => (window as unknown as SoakWindow).__cut002!.barrages)
}

async function submitMedia(
  page: Page,
  prefix: string,
  inputs: { frame: boolean; microphone: boolean; systemAudio: boolean }
): Promise<void> {
  const capturedAtMs = Date.now()
  if (inputs.frame) {
    await page.evaluate(
      ({ encoded, captured, inputId }) => {
        const body = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
        return (window as unknown as SoakWindow).advx.submitVisualFrame({
          inputId,
          capturedAtMs: captured,
          mimeType: 'image/png',
          changeScore: 1,
          visualSignature: 'a'.repeat(192),
          body
        })
      },
      { encoded: frameBase64, captured: capturedAtMs, inputId: `${prefix}-frame` }
    )
  }
  const body = [0, 0, 1, 0, 2, 0, 3, 0]
  if (inputs.systemAudio) {
    await page.evaluate(
      ({ bytes, captured, inputId }) =>
        (window as unknown as SoakWindow).advx.submitAudioSegment({
          source: 'system_audio',
          inputId,
          capturedAtMs: captured,
          body: Uint8Array.from(bytes)
        }),
      { bytes: body, captured: capturedAtMs, inputId: `${prefix}-system-audio` }
    )
  }
  if (inputs.microphone) {
    await page.evaluate(
      ({ bytes, captured, inputId, turnId, systemAudioRequired }) =>
        (window as unknown as SoakWindow).advx.submitAudioSegment({
          source: 'microphone',
          inputId,
          capturedAtMs: captured,
          turnId,
          systemAudioRequired,
          body: Uint8Array.from(bytes)
        }),
      {
        bytes: body,
        captured: capturedAtMs,
        inputId: `${prefix}-microphone`,
        turnId: `${prefix}-turn`,
        systemAudioRequired: inputs.systemAudio
      }
    )
    await page.evaluate(() =>
      (window as unknown as SoakWindow).advx.notifyVoiceActivity('microphone', Date.now())
    )
  }
}

function constrainWorkspace(workspace: AudienceWorkspaceState | null): AudienceWorkspaceState {
  if (!workspace) throw new Error('recorded workspace fixture is unavailable')
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
  const clamp = (range: readonly [number, number]): readonly [number, number] => [
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
        normalResponseRange: clamp(sourceMode.normalResponseRange),
        highlightResponseRange: clamp(sourceMode.highlightResponseRange)
      }]
    }
  }
}

async function runTargetedTest(name: string, file: string, pattern: string) {
  const startedAt = Date.now()
  const command = ['bun', 'test', file, '-t', pattern]
  const result = await runCommand(command, repositoryRoot)
  verify(result.exitCode === 0, `${name} failed: ${tail(result.stderr || result.stdout)}`)
  return { name, file, pattern, exitCode: result.exitCode, durationMs: Date.now() - startedAt }
}

async function runCommand(
  command: readonly string[],
  cwd: string,
  input?: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const child = spawn(command[0]!, command.slice(1), {
    cwd,
    env: process.env,
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    windowsHide: true
  })
  const stdoutChunks: Buffer[] = []
  const stderrChunks: Buffer[] = []
  verify(child.stdout && child.stderr, `command output pipes are unavailable: ${command[0]}`)
  child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk))
  child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk))
  if (input !== undefined) {
    verify(child.stdin, `command input pipe is unavailable: ${command[0]}`)
    child.stdin.end(input)
  }
  const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
    child.once('error', rejectExit)
    child.once('close', (code) => resolveExit(code ?? -1))
  })
  return {
    exitCode,
    stdout: Buffer.concat(stdoutChunks).toString('utf8'),
    stderr: Buffer.concat(stderrChunks).toString('utf8')
  }
}

async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveStart, rejectStart) => {
    server.once('error', rejectStart)
    server.listen(0, '127.0.0.1', resolveStart)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('port_probe_failed')
  const port = address.port
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
  return port
}

async function portIsFree(port: number): Promise<boolean> {
  const server = createServer()
  return new Promise<boolean>((resolveFree) => {
    server.once('error', () => resolveFree(false))
    server.listen(port, '127.0.0.1', () => server.close(() => resolveFree(true)))
  })
}

async function waitFor<T>(
  description: string,
  operation: () => Promise<T | null | false>,
  deadlineMs: number
): Promise<T> {
  const deadline = Date.now() + deadlineMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const value = await operation()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await sleep(100)
  }
  throw new Error(`${description} timed out${lastError ? `: ${String(lastError)}` : ''}`)
}

async function withDeadline<T>(description: string, operation: Promise<T>, deadlineMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${description} timed out`)), deadlineMs)
      })
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

function attachPage(page: Page, entries: DiagnosticEntry[]): void {
  page.on('console', (message) => addDiagnostic(entries, {
    source: 'renderer',
    level: normalizeConsoleLevel(message),
    text: message.text()
  }))
  page.on('pageerror', (error) => addDiagnostic(entries, {
    kind: 'page-error',
    source: 'renderer',
    level: 'error',
    text: String(error)
  }))
  page.on('crash', () => addDiagnostic(entries, {
    kind: 'page-crash',
    source: 'renderer',
    level: 'error',
    text: 'renderer_crashed'
  }))
}

function addDiagnostic(
  entries: DiagnosticEntry[],
  entry: Omit<DiagnosticEntry, 'at' | 'kind' | 'text'> & {
    kind?: DiagnosticEntry['kind']
    text: string
  }
): void {
  if (entries.length >= 1_000) return
  entries.push({
    ...entry,
    at: new Date().toISOString(),
    kind: entry.kind ?? 'console',
    text: redact(entry.text, []).slice(0, 4_000)
  })
}

function normalizeConsoleLevel(message: ConsoleMessage): DiagnosticEntry['level'] {
  if (message.type() === 'error' || message.type() === 'assert') return 'error'
  if (message.type() === 'warning') return 'warning'
  if (message.type() === 'debug' || message.type() === 'trace') return 'debug'
  return 'info'
}

function redact(value: string, secrets: readonly string[]): string {
  let redacted = value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/((?:api[_-]?key|token|secret|password)\s*[:=]\s*)[^\s,;"']+/gi, '$1[REDACTED]')
  for (const secret of secrets) redacted = redacted.replaceAll(secret, '[REDACTED]')
  return redacted
}

function backendPids(log: string): number[] {
  return [...log.matchAll(/backend\.spawned \{ pid: (\d+) \}/g)].map((match) => Number(match[1]))
}

async function waitForBackendPids(logPath: string, minimum: number): Promise<number[]> {
  return waitFor('backend PID log', async () => {
    try {
      const pids = backendPids(await readFile(logPath, 'utf8'))
      return pids.length >= minimum ? pids : null
    } catch {
      return null
    }
  }, 30_000)
}

async function sampleResources(label: string, electronPid: number, backendPid: number): Promise<ResourceSample> {
  const command = [
    'powershell.exe',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$p=Get-Process -Id ${electronPid},${backendPid} -ErrorAction Stop; $p | Select-Object Id,WorkingSet64,CPU | ConvertTo-Json -Compress`
  ]
  const result = await runCommand(command, repositoryRoot)
  verify(result.exitCode === 0, `${label} resource sample failed: ${result.stderr}`)
  const parsed = JSON.parse(result.stdout) as JsonRecord | JsonRecord[]
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  const convert = (pid: number): ResourceProcess => {
    const row = rows.find((candidate) => Number(candidate.Id) === pid)
    verify(row, `${label} resource sample omitted PID ${pid}`)
    return {
      id: pid,
      workingSetBytes: Number(row.WorkingSet64),
      cpuSeconds: Number(row.CPU ?? 0)
    }
  }
  return {
    label,
    at: new Date().toISOString(),
    electron: convert(electronPid),
    backend: convert(backendPid)
  }
}

async function taskExists(pid: number): Promise<boolean> {
  const result = await runCommand(
    ['tasklist.exe', '/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
    repositoryRoot
  )
  return result.exitCode === 0 && result.stdout.includes(`"${pid}"`)
}

async function taskkill(pid: number): Promise<void> {
  await runCommand(['taskkill.exe', '/PID', String(pid), '/T', '/F'], repositoryRoot)
}

async function descendantPids(rootPid: number): Promise<number[]> {
  const command = [
    'powershell.exe',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$all=Get-CimInstance Win32_Process; $ids=@(${rootPid}); do { $new=@($all | Where-Object { $ids -contains [int]$_.ParentProcessId } | ForEach-Object { [int]$_.ProcessId } | Where-Object { $ids -notcontains $_ }); $ids += $new } while ($new.Count -gt 0); $ids | ConvertTo-Json -Compress`
  ]
  const result = await runCommand(command, repositoryRoot)
  verify(result.exitCode === 0, `process tree snapshot failed: ${result.stderr}`)
  const parsed = JSON.parse(result.stdout) as number | number[]
  return [...new Set(Array.isArray(parsed) ? parsed : [parsed])]
}

function firstColumn(row: unknown): unknown {
  if (typeof row !== 'object' || row === null) return undefined
  return Object.values(row as JsonRecord)[0]
}

async function scanSecrets(
  root: string,
  secrets: readonly string[],
  excludedRelativeRoots: ReadonlySet<string>
): Promise<string[]> {
  const leaks: string[] = []
  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      const relativePath = relative(root, path).replaceAll('\\', '/')
      if ([...excludedRelativeRoots].some((excluded) => relativePath === excluded || relativePath.startsWith(`${excluded}/`))) continue
      if (entry.isDirectory()) {
        await visit(path)
        continue
      }
      const bytes = await readFile(path)
      if (bytes.byteLength > 5 * 1024 * 1024) continue
      const text = new TextDecoder().decode(bytes)
      if (secrets.some((secret) => text.includes(secret))) leaks.push(relativePath)
    }
  }
  await visit(root)
  return leaks.sort()
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await stat(path)).size
  } catch {
    return 0
  }
}

function tail(value: string): string {
  return value.length > 4_000 ? value.slice(-4_000) : value
}

async function sleep(milliseconds: number): Promise<void> {
  await new Promise<void>((resolveSleep) => setTimeout(resolveSleep, milliseconds))
}
