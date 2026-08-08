import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, relative, resolve } from 'node:path'

import { Database } from 'bun:sqlite'

import { SpawnedBackendProcess } from '../apps/desktop/src/main/backend/backend-process.ts'
import { createBunBackendProcessOptions } from '../apps/desktop/src/main/backend/backend-process-bun.ts'
import { BackendClient } from '../apps/desktop/src/main/backend/backend-client.ts'
import type { BackendProcessLogger } from '../apps/desktop/src/main/backend/backend-supervisor.ts'
import {
  createInitialAudienceWorkspace,
  type AudienceWorkspaceState
} from '../apps/desktop/src/shared/audience/index.ts'
import {
  compileCanonicalRuntimeSpec,
  type CompiledRuntimeSpec
} from '../apps/desktop/src/shared/backend-client.ts'
import type { BackendBarrageEvent, ModelConfig } from '../apps/desktop/src/shared/contracts.ts'
import {
  LEGACY_ALEMBIC_HEAD,
  LEGACY_MIGRATION_STRATEGY,
  legacyMigrationRunDirectory,
  migrateLegacyDatabase
} from '../apps/backend-bun/src/infrastructure/persistence/sqlite/legacy-database-migration.ts'
import { PythonSqliteOnlineBackupAdapter } from '../apps/backend-bun/src/infrastructure/persistence/sqlite/python-online-backup-adapter.ts'
import {
  ExecutionGuard,
  fileIdentity,
  parseNamedArguments,
  parsePositiveInteger,
  requireSafeArtifactRoot,
  runMachineCli,
  SCRIPT_EXIT,
  ScriptError,
  writeJsonAtomic
} from './evidence-script-runtime.ts'

type JsonRecord = Record<string, unknown>
type ProcessLog = Readonly<{
  level: 'info' | 'warn' | 'error'
  message: string
}>

const repositoryRoot = resolve(process.cwd())
const decisionPath = join(
  repositoryRoot,
  'docs',
  'migrations',
  'typescript-bun',
  'CUT-003-BACKUP-ROLLBACK-REHEARSAL.md'
)
const backupScript = join(repositoryRoot, 'apps', 'backend', 'scripts', 'sqlite_online_backup.py')
const fixtureScript = join(
  repositoryRoot,
  'apps',
  'backend-bun',
  'src',
  'infrastructure',
  'persistence',
  'sqlite',
  'legacy-database-fixture.py'
)
const backendPackagePath = join(repositoryRoot, 'apps', 'backend-bun', 'package.json')
const pythonOracleScript = join(repositoryRoot, 'tests', 'parity', 'python_control_session_server.py')
const pythonExecutable = join(repositoryRoot, 'apps', 'backend', '.venv', 'Scripts', 'python.exe')
const args = parseNamedArguments(
  process.argv.slice(2),
  new Set(['--artifact-root', '--timeout-ms'])
)
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ?? join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'cut-003'),
  repositoryRoot
)
const timeoutMs = parsePositiveInteger(args.get('--timeout-ms') ?? '180000', '--timeout-ms')
const runtimeRoot = join(artifactRoot, 'runtime')
const sourceDirectory = join(runtimeRoot, 'legacy-source')
const workspaceDirectory = join(runtimeRoot, 'migration-workspace')
const finalRollbackDirectory = join(runtimeRoot, 'final-rollback')
const finalRollbackDatabasePath = join(finalRollbackDirectory, 'advx.sqlite3')
const sourceAppVersion = '0.1.0'
const targetAppVersion = '0.1.0'
const migrationRunId = 'cut-003-rehearsal'
const pythonCommand = [
  'uv',
  'run',
  '--project',
  join(repositoryRoot, 'apps', 'backend'),
  'python'
] as const

function verify(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScriptError(SCRIPT_EXIT.verificationFailed, message)
}

await runMachineCli(async () => {
  const startedAt = Date.now()
  const guard = new ExecutionGuard(timeoutMs)
  let legacyFixture: Awaited<ReturnType<typeof startLegacyFixture>> | undefined
  let bunController: SpawnedBackendProcess | undefined
  let bunClient: BackendClient | undefined
  let pythonOracle: Awaited<ReturnType<typeof startPythonOracle>> | undefined
  const bunLogs: ProcessLog[] = []

  guard.addCleanup(async () => {
    await bunClient?.stop().catch(() => undefined)
    await bunController?.dispose().catch(() => undefined)
    await pythonOracle?.stop().catch(() => undefined)
    await legacyFixture?.stop().catch(() => undefined)
  })

  try {
    return await guard.race((async () => {
      verify(
        process.platform === 'win32' && process.arch === 'x64',
        'CUT-003 is authorized for Windows x64 only'
      )
      verify(Bun.version === '1.3.14', `CUT-003 requires Bun 1.3.14, got ${Bun.version}`)
      await rm(artifactRoot, { recursive: true, force: true })
      await Promise.all([
        mkdir(sourceDirectory, { recursive: true }),
        mkdir(workspaceDirectory, { recursive: true })
      ])

      const decision = await readFile(decisionPath, 'utf8')
      for (const clause of [
        'restore-from-backup and restart',
        '0006_viewer_lifecycle',
        '0006_durable_outbox',
        'in-place Python rollback remains unsupported',
        'Windows x64'
      ]) {
        verify(decision.includes(clause), `rollback decision is missing: ${clause}`)
      }

      const backendPackage = JSON.parse(await readFile(backendPackagePath, 'utf8')) as {
        version: string
      }
      verify(backendPackage.version === targetAppVersion, 'Bun target application version drifted')

      legacyFixture = await startLegacyFixture(sourceDirectory)
      verify(await pathExists(`${legacyFixture.databasePath}-wal`), 'legacy owner did not expose an active WAL')
      const sourceBefore = inspectDatabase(legacyFixture.databasePath)
      verify(sourceBefore.alembicRevision === LEGACY_ALEMBIC_HEAD, 'legacy schema head drifted')
      verifyLegacyRows(sourceBefore, 'legacy source')

      const runDirectory = legacyMigrationRunDirectory(workspaceDirectory, migrationRunId)
      const backupAdapter = new PythonSqliteOnlineBackupAdapter({
        command: pythonCommand,
        scriptPath: backupScript,
        backupDirectory: join(runDirectory, 'backups'),
        sourceAppVersion
      })
      let stopCalls = 0
      const migration = await migrateLegacyDatabase({
        runId: migrationRunId,
        sourceDatabasePath: legacyFixture.databasePath,
        workspaceDirectory,
        sourceAppVersion,
        targetAppVersion,
        backupAdapter,
        stopBackends: async () => {
          stopCalls += 1
          await legacyFixture!.stop()
          return {
            pythonStopped: true,
            bunStopped: true,
            stoppedAtMs: Date.now()
          }
        }
      })
      verify(stopCalls === 1, 'legacy owner stop boundary did not run exactly once')
      verify(migration.strategy === LEGACY_MIGRATION_STRATEGY, 'migration was not copy-and-swap')
      verify(migration.sourceSchemaVersion === LEGACY_ALEMBIC_HEAD, 'migration source schema drifted')
      verify(migration.targetMigrationVersion === 6, 'Bun migration target drifted')
      verify(migration.appliedMigrations.join(',') === '0006_durable_outbox', 'unexpected forward migrations')
      verify(migration.originalSourceUnchangedAfterStop, 'closed legacy source changed')
      verify(!migration.copiedLiveMainOrSidecars, 'migration copied a live SQLite main file or sidecar')
      verify(!migration.bunOwnedOnlineBackupAvailable, 'Bun-owned online backup was unexpectedly enabled')
      verify(!migration.destructiveBunMigrationsAllowed, 'destructive Bun migration was unexpectedly enabled')
      verify(await sha256(migration.backup.backupPath) === migration.backup.sha256, 'backup hash mismatch')
      verify(!(await pathExists(`${migration.backup.backupPath}-wal`)), 'backup retained WAL')
      verify(!(await pathExists(`${migration.backup.backupPath}-shm`)), 'backup retained SHM')

      const migratedBeforeScenario = inspectDatabase(migration.workingDatabasePath)
      verify(migratedBeforeScenario.bunMigrationVersion === 6, 'migrated copy is not at Bun version 6')
      verify((migratedBeforeScenario.durableOutboxCount ?? 0) >= 1, 'Bun migration smoke marker is missing')
      verifyLegacyRows(migratedBeforeScenario, 'migrated Bun copy')

      const bunPort = await availablePort()
      const bunToken = randomBytes(32).toString('base64url')
      const bunBaseUrl = `http://127.0.0.1:${bunPort}`
      bunController = new SpawnedBackendProcess(
        createBunBackendProcessOptions({
          repositoryRoot,
          backendBaseUrl: bunBaseUrl,
          backendPort: String(bunPort),
          dataDirectory: migration.workingDataDirectory,
          startupToken: bunToken,
          expectedBackendVersion: backendPackage.version,
          parentEnvironment: { ...process.env, ADVX_RECORDED_PIPELINE: '1' },
          identity: {
            version: `bun-source@${backendPackage.version}`,
            port: bunPort,
            token: bunToken,
            dataDirectory: migration.workingDataDirectory,
            logLocation: join(migration.workingDataDirectory, 'logs')
          },
          logger: collectLogger(bunLogs)
        })
      )
      await bunController.start()
      const bunIdentity = bunController.status().identity
      bunClient = new BackendClient({
        baseUrl: bunBaseUrl,
        localToken: bunToken,
        backendRuntime: 'bun-source'
      })
      bunClient.setBackendStartId(bunIdentity.id)
      await bunClient.start()
      await bunClient.configureProviders(recordedModelConfig())
      const compiled = recordedRuntimeSpec()
      const started = await bunClient.startSession('cut-003-recorded-start', compiled)
      verify(started.state === 'running' && started.sessionId !== null, 'recorded Session did not start')
      const barragePromise = waitForBarrage(bunClient, started.sessionId, 20_000)
      await bunClient.submitText('cut-003-text', Date.now(), 'cut-003 recorded rollback rehearsal')
      const barrage = await barragePromise
      verify(barrage.text.startsWith('Recorded reply:'), 'recorded barrage did not use the recorded Provider')
      const traces = await bunClient.queryDebugTraces(started.sessionId)
      verify(traces.items.length > 0, 'recorded scenario produced no trace')
      verify(traces.items.at(-1)?.provider.model_id === 'recorded-viewer-v1', 'recorded trace provider drifted')
      const stopped = await bunClient.stopSession()
      verify(stopped.state === 'idle', 'recorded Session did not stop')
      await bunClient.stop()
      await bunController.dispose()
      await waitForPortRelease(bunPort)
      const bunStatus = bunController.status()
      verify(bunStatus.state === 'disposed', 'Bun supervisor did not dispose')
      verify(bunStatus.lastExit?.code === 0, 'Bun backend did not exit cleanly')
      verify(!bunLogs.some((entry) => entry.message === 'backend.stop.forced'), 'Bun backend required forced stop')

      verify(await sha256(migration.backup.backupPath) === migration.backup.sha256, 'backup changed during Bun scenario')
      const finalRestore = await backupAdapter.restoreVerifiedBackup({
        backupPath: migration.backup.backupPath,
        backupSha256: migration.backup.sha256,
        destinationPath: finalRollbackDatabasePath
      })
      verify(finalRestore.sourceSchemaVersion === LEGACY_ALEMBIC_HEAD, 'final restore schema drifted')
      verify(!(await pathExists(`${finalRollbackDatabasePath}-wal`)), 'final restore retained WAL')
      verify(!(await pathExists(`${finalRollbackDatabasePath}-shm`)), 'final restore retained SHM')
      const rollbackBeforePython = inspectDatabase(finalRollbackDatabasePath)
      verifyRollbackDatabase(rollbackBeforePython)

      const pythonPort = await availablePort()
      const pythonToken = randomBytes(32).toString('base64url')
      const pythonBaseUrl = `http://127.0.0.1:${pythonPort}`
      pythonOracle = await startPythonOracle(
        pythonPort,
        pythonToken,
        finalRollbackDirectory
      )
      const [pythonHealth, pythonConfiguration, pythonOpenApi] = await Promise.all([
        fetchJson(pythonBaseUrl, pythonToken, '/health'),
        fetchJson(pythonBaseUrl, pythonToken, '/configuration/providers'),
        fetchJson(pythonBaseUrl, pythonToken, '/openapi.json')
      ])
      verify(pythonHealth.status === 200 && pythonHealth.body.status === 'ok', 'Python oracle health failed')
      verify(
        pythonConfiguration.status === 200 && typeof pythonConfiguration.body.configured === 'boolean',
        'Python oracle authenticated control failed'
      )
      const pythonInfo = pythonOpenApi.body.info as JsonRecord
      verify(pythonOpenApi.status === 200 && pythonInfo.version === sourceAppVersion, 'Python oracle version drifted')
      const pythonExitCode = await pythonOracle.stop()
      await waitForPortRelease(pythonPort)
      verify(pythonExitCode === 0, 'Python oracle did not exit cleanly')

      const rollbackAfterPython = inspectDatabase(finalRollbackDatabasePath)
      verifyRollbackDatabase(rollbackAfterPython)
      verify(await sha256(migration.backup.backupPath) === migration.backup.sha256, 'untouched backup hash changed')

      const identities = await Promise.all([
        fileIdentity(migration.sourceDatabasePath, artifactRelative(migration.sourceDatabasePath)),
        fileIdentity(migration.backup.backupPath, artifactRelative(migration.backup.backupPath)),
        fileIdentity(migration.workingDatabasePath, artifactRelative(migration.workingDatabasePath)),
        fileIdentity(finalRollbackDatabasePath, artifactRelative(finalRollbackDatabasePath))
      ])
      const manifest = {
        schemaVersion: 1,
        taskId: 'CUT-003',
        strategy: 'restore-from-backup-and-restart',
        source: {
          applicationVersion: sourceAppVersion,
          schemaVersion: LEGACY_ALEMBIC_HEAD,
          closedSha256: migration.sourceClosedSha256
        },
        target: {
          applicationVersion: targetAppVersion,
          migrationVersion: migration.targetMigrationVersion,
          appliedMigrations: migration.appliedMigrations
        },
        backup: {
          method: migration.backup.method,
          createdAtMs: migration.backup.createdAtMs,
          quickCheck: migration.backup.quickCheck,
          sha256: migration.backup.sha256
        },
        files: identities,
        compatibility: {
          destructiveLegacyTableChanges: [],
          notRollbackRetained: ['advx_schema_migrations', 'durable_outbox', 'post-backup Bun writes'],
          inPlacePythonRollbackSupported: false
        }
      } as const
      await writeJsonAtomic(join(artifactRoot, 'backup-manifest.json'), manifest)

      const result = {
        schemaVersion: 1,
        taskId: 'CUT-003',
        status: 'passed',
        platformClaim: 'windows-x64-only',
        source: {
          applicationVersion: sourceAppVersion,
          schemaVersion: sourceBefore.alembicRevision,
          privacyClass: 'synthetic-legacy-fixture',
          activeWalObserved: true,
          unchangedAfterStop: migration.originalSourceUnchangedAfterStop
        },
        backup: {
          method: migration.backup.method,
          quickCheck: migration.backup.quickCheck,
          sha256: migration.backup.sha256,
          sidecars: 0,
          manifest: 'backup-manifest.json'
        },
        migration: {
          runtime: `bun@${Bun.version}`,
          strategy: migration.strategy,
          targetApplicationVersion: targetAppVersion,
          targetMigrationVersion: migration.targetMigrationVersion,
          appliedMigrations: migration.appliedMigrations,
          preservedLegacyTables: migration.preservedTables.length,
          destructiveBunMigrationsAllowed: migration.destructiveBunMigrationsAllowed
        },
        recordedScenario: {
          backendRuntime: 'bun-source',
          sessionState: stopped.state,
          barrageDelivered: true,
          barragePrefix: 'Recorded reply:',
          traceCount: traces.items.length,
          providerModel: traces.items.at(-1)?.provider.model_id,
          backendExitCode: bunStatus.lastExit?.code,
          forcedStop: false,
          portReleased: true
        },
        rollback: {
          method: 'restore-from-backup-and-restart',
          inPlaceSupported: false,
          restoredSchemaVersion: rollbackAfterPython.alembicRevision,
          bunMigrationJournalPresent: rollbackAfterPython.bunMigrationVersion !== null,
          durableOutboxPresent: rollbackAfterPython.durableOutboxCount !== null,
          legacyRowsRetained: true,
          pythonHealthStatus: pythonHealth.status,
          pythonControlStatus: pythonConfiguration.status,
          pythonVersion: pythonInfo.version,
          pythonExitCode,
          pythonForcedStop: false,
          portReleased: true
        },
        compatibility: manifest.compatibility,
        durationMs: Date.now() - startedAt,
        runtime: { bun: Bun.version, platform: process.platform, arch: process.arch }
      } as const
      await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
      return result
    })())
  } finally {
    await guard.close()
  }
})

function recordedModelConfig(): ModelConfig {
  return {
    baseUrl: 'recorded://model',
    providerProfileId: 'recorded-cut-003',
    model: 'recorded-viewer-v1',
    viewerModel: 'recorded-viewer-v1',
    memoryModel: 'recorded-memory-v1',
    visualSummaryModel: 'recorded-visual-v1',
    apiKey: 'recorded-model-key',
    asrBaseUrl: 'recorded://asr',
    asrModel: 'recorded-asr-v1',
    asrApiKey: 'recorded-asr-key'
  }
}

function recordedRuntimeSpec(): CompiledRuntimeSpec {
  const initial = createInitialAudienceWorkspace()
  const persona = initial.personas[0]
  const mode = initial.modeState.modes.find((item) => item.id === initial.modeState.activeModeId)
    ?? initial.modeState.modes[0]
  verify(persona !== undefined && mode !== undefined, 'recorded workspace fixture is empty')
  const workspace: AudienceWorkspaceState = {
    ...initial,
    personas: [persona],
    modeState: {
      ...initial.modeState,
      activeModeId: mode.id,
      modes: [{
        ...mode,
        personaCounts: { [persona.id]: 1 },
        personaOverrides: mode.personaOverrides[persona.id]
          ? { [persona.id]: mode.personaOverrides[persona.id] }
          : {},
        normalResponseRange: [0, 1],
        highlightResponseRange: [0, 1]
      }]
    }
  }
  return compileCanonicalRuntimeSpec(workspace, {
    configRevision: 1,
    roomId: 'room-cut-003',
    roomDisplayName: 'CUT-003 Recorded Room',
    roomRevision: 1,
    provider: {
      providerProfileId: 'recorded-cut-003',
      viewerModel: 'recorded-viewer-v1',
      memoryModel: 'recorded-memory-v1',
      visualSummaryModel: 'recorded-visual-v1'
    }
  })
}

function collectLogger(entries: ProcessLog[]): BackendProcessLogger {
  const add = (level: ProcessLog['level'], message: string): void => {
    if (entries.length < 500) entries.push({ level, message })
  }
  return {
    info: (message) => add('info', message),
    warn: (message) => add('warn', message),
    error: (message) => add('error', message)
  }
}

async function startPythonOracle(
  port: number,
  token: string,
  dataDirectory: string
) {
  verify(await pathExists(pythonExecutable), 'Python oracle virtual environment is missing')
  const child = Bun.spawn(
    [pythonExecutable, pythonOracleScript],
    {
      cwd: repositoryRoot,
      env: {
        ...safeProcessEnvironment(),
        PYTHONPATH: join(repositoryRoot, 'apps', 'backend', 'src'),
        PYTHONUTF8: '1',
        ADVX_LOCAL_TOKEN: token,
        ADVX_DATA_DIR: dataDirectory,
        ADVX_PARITY_PORT: String(port)
      },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      windowsHide: true
    }
  )
  const stdoutPromise = new Response(child.stdout).text()
  const stderrPromise = new Response(child.stderr).text()
  try {
    await waitForHealth(port, token, 20_000)
  } catch (cause) {
    child.kill()
    await child.exited
    throw new ScriptError(
      SCRIPT_EXIT.verificationFailed,
      `Python oracle failed to start: ${(await stderrPromise).trim() || String(cause)}`
    )
  }
  let stopped = false
  let exitCode: number | undefined
  return {
    pid: child.pid,
    stop: async (): Promise<number> => {
      if (stopped) return exitCode ?? await child.exited
      stopped = true
      child.stdin.write('shutdown\n')
      child.stdin.end()
      const cleanExit = await Promise.race([
        child.exited.then((code) => ({ code })),
        Bun.sleep(10_000).then(() => null)
      ])
      if (cleanExit === null) {
        child.kill()
        await child.exited
        throw new ScriptError(SCRIPT_EXIT.verificationFailed, 'Python oracle stdin shutdown timed out')
      }
      exitCode = cleanExit.code
      const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise])
      verify(exitCode === 0, `Python oracle exited with ${exitCode}: ${(stderr || stdout).trim()}`)
      return exitCode
    }
  }
}

function safeProcessEnvironment(): Record<string, string> {
  const allowed = [
    'APPDATA',
    'COMSPEC',
    'HOME',
    'LANG',
    'LOCALAPPDATA',
    'PATH',
    'PATHEXT',
    'SYSTEMROOT',
    'TEMP',
    'TMP',
    'USERPROFILE',
    'WINDIR'
  ] as const
  const environment: Record<string, string> = {}
  for (const key of allowed) {
    const value = process.env[key]
    if (value !== undefined) environment[key] = value
  }
  return environment
}

async function waitForHealth(port: number, token: string, timeout: number): Promise<void> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(500)
      })
      if (response.status === 200) return
    } catch {
      // Retry until the bounded startup deadline.
    }
    await Bun.sleep(50)
  }
  throw new Error('Python oracle health timeout')
}

async function waitForBarrage(
  client: BackendClient,
  sessionId: string,
  deadlineMs: number
): Promise<BackendBarrageEvent> {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => {
      remove()
      reject(new ScriptError(SCRIPT_EXIT.verificationFailed, 'recorded barrage timed out'))
    }, deadlineMs)
    const remove = client.onBarrage((event) => {
      if (event.sessionId !== sessionId) return
      clearTimeout(timer)
      remove()
      resolvePromise(event)
    })
  })
}

type DatabaseInspection = Readonly<{
  quickCheck: string
  alembicRevision: string | null
  bunMigrationVersion: number | null
  durableOutboxCount: number | null
  legacyRoomCount: number
  legacyViewerCount: number
  legacyEventCount: number
}>

function inspectDatabase(path: string): DatabaseInspection {
  const database = new Database(path, { readonly: true, strict: true })
  try {
    const quickCheckRow = database.query('PRAGMA quick_check').get() as JsonRecord | null
    const quickCheck = quickCheckRow === null ? '' : String(Object.values(quickCheckRow)[0])
    const hasAlembic = tableExists(database, 'alembic_version')
    const hasBunJournal = tableExists(database, 'advx_schema_migrations')
    const hasOutbox = tableExists(database, 'durable_outbox')
    return {
      quickCheck,
      alembicRevision: hasAlembic
        ? (database.query('SELECT version_num FROM alembic_version').get() as { version_num: string }).version_num
        : null,
      bunMigrationVersion: hasBunJournal
        ? (database.query('SELECT MAX(version) AS version FROM advx_schema_migrations').get() as { version: number | null }).version
        : null,
      durableOutboxCount: hasOutbox
        ? Number((database.query('SELECT COUNT(*) AS count FROM durable_outbox').get() as { count: number }).count)
        : null,
      legacyRoomCount: count(database, "SELECT COUNT(*) AS count FROM rooms WHERE room_id = 'room-legacy'"),
      legacyViewerCount: count(database, "SELECT COUNT(*) AS count FROM audience_profiles WHERE audience_id = 'audience-legacy'"),
      legacyEventCount: count(database, "SELECT COUNT(*) AS count FROM room_events WHERE event_id = 'event-legacy'")
    }
  } finally {
    database.close()
  }
}

function verifyLegacyRows(inspection: DatabaseInspection, label: string): void {
  verify(inspection.quickCheck === 'ok', `${label} failed quick_check`)
  verify(inspection.legacyRoomCount === 1, `${label} lost the legacy Room`)
  verify(inspection.legacyViewerCount === 1, `${label} lost the legacy Viewer`)
  verify(inspection.legacyEventCount === 1, `${label} lost the legacy event`)
}

function verifyRollbackDatabase(inspection: DatabaseInspection): void {
  verifyLegacyRows(inspection, 'restored Python rollback copy')
  verify(inspection.alembicRevision === LEGACY_ALEMBIC_HEAD, 'restored Alembic head drifted')
  verify(inspection.bunMigrationVersion === null, 'restored copy retained Bun migration journal')
  verify(inspection.durableOutboxCount === null, 'restored copy retained Bun-only outbox')
}

function tableExists(database: Database, table: string): boolean {
  return database
    .query("SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = ?")
    .get(table) !== null
}

function count(database: Database, query: string): number {
  return Number((database.query(query).get() as { count: number }).count)
}

async function startLegacyFixture(dataDirectory: string) {
  const process = Bun.spawn(
    [...pythonCommand, fixtureScript, '--data-directory', dataDirectory],
    { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', windowsHide: true }
  )
  const reader = process.stdout.getReader()
  const stderrPromise = new Response(process.stderr).text()
  const line = await readLine(reader, 60_000)
  let ready: unknown
  try {
    ready = JSON.parse(line)
  } catch {
    process.kill()
    throw new ScriptError(SCRIPT_EXIT.verificationFailed, `legacy fixture returned invalid JSON: ${await stderrPromise}`)
  }
  verify(
    typeof ready === 'object' &&
      ready !== null &&
      (ready as JsonRecord).status === 'ready' &&
      typeof (ready as JsonRecord).databasePath === 'string',
    'legacy fixture returned an invalid ready record'
  )
  let stopped = false
  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    process.stdin.write('stop\n')
    process.stdin.end()
    const exitCode = await process.exited
    await reader.cancel().catch(() => undefined)
    verify(exitCode === 0, `legacy fixture exited with ${exitCode}: ${await stderrPromise}`)
  }
  return {
    databasePath: (ready as { databasePath: string }).databasePath,
    stop
  }
}

async function readLine(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number
): Promise<string> {
  const decoder = new TextDecoder()
  let buffered = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      (async () => {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) throw new Error('legacy fixture exited before ready')
          buffered += decoder.decode(chunk.value, { stream: true })
          const newline = buffered.indexOf('\n')
          if (newline >= 0) return buffered.slice(0, newline)
        }
      })(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('legacy fixture ready timeout')), timeoutMs)
      })
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function fetchJson(
  baseUrl: string,
  token: string,
  path: string
): Promise<Readonly<{ status: number; body: JsonRecord }>> {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      authorization: `Bearer ${token}`,
      'x-advx-protocol-version': '3'
    }
  })
  return { status: response.status, body: JSON.parse(await response.text()) as JsonRecord }
}

function availablePort(): Promise<number> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      verify(typeof address === 'object' && address !== null, 'cannot allocate loopback port')
      const port = address.port
      server.close((error) => error ? reject(error) : resolvePromise(port))
    })
  })
}

async function waitForPortRelease(port: number): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if (await portIsFree(port)) return
    await Bun.sleep(100)
  }
  throw new ScriptError(SCRIPT_EXIT.verificationFailed, `port ${port} was not released`)
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolvePromise) => {
    const server = createServer()
    server.once('error', () => resolvePromise(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolvePromise(true))
    })
  })
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function sha256(path: string): Promise<string> {
  const identity = await fileIdentity(path, 'file')
  return identity.sha256
}

function artifactRelative(path: string): string {
  const display = relative(artifactRoot, resolve(path))
  verify(display !== '' && !display.startsWith('..'), 'artifact escaped CUT-003 root')
  return display.replaceAll('\\', '/')
}
