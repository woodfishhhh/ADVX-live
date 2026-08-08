import { createHash } from 'node:crypto'
import { access, readFile, rm } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'

import {
  fileIdentity,
  parseNamedArguments,
  readJsonFile,
  requireSafeArtifactRoot,
  runMachineCli,
  SCRIPT_EXIT,
  ScriptError,
  writeJsonAtomic
} from './evidence-script-runtime.ts'

type JsonRecord = Record<string, unknown>

const repositoryRoot = resolve(import.meta.dir, '..')
const args = parseNamedArguments(Bun.argv.slice(2), new Set(['--artifact-root']))
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ??
    join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'cut-007'),
  repositoryRoot
)

const activeDocumentPaths = [
  'AGENTS.md',
  'README.md',
  'apps/desktop/README.md',
  'apps/backend-bun/README.md',
  'packages/contracts/README.md',
  'scripts/README.md',
  'tests/e2e/README.md',
  'docs/README.md',
  'docs/ARCHITECTURE.md',
  'docs/BACKEND_DESIGN.md',
  'docs/DECISIONS.md',
  'docs/INGEST_PROTOCOL.md',
  'docs/REAL_PIPELINE.md',
  'docs/PRODUCT.md',
  'docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md',
  'docs/OPERATIONS.md'
] as const

const historicalDocumentPaths = [
  'apps/backend/README.md',
  'docs/SB6657_STYLE_TUNING.md',
  'docs/VIEWER_BEHAVIOR_REDESIGN.md',
  'docs/VIEWER_RUNTIME_INTEGRATION_PLAN.md',
  'docs/VIEWER_RUNTIME_REQUIREMENTS_LOG.md'
] as const

const sourcePaths = [
  'package.json',
  ...activeDocumentPaths,
  ...historicalDocumentPaths,
  'scripts/check-cut-007.ts',
  'scripts/tsconfig.cut-007.json'
] as const

function verify(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ScriptError(SCRIPT_EXIT.verificationFailed, message)
}

function asRecord(value: unknown, label: string): JsonRecord {
  verify(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    `${label} is not an object`
  )
  return value as JsonRecord
}

function stringScripts(value: unknown, label: string): Record<string, string> {
  const record = asRecord(value, label)
  for (const [name, script] of Object.entries(record)) {
    verify(typeof script === 'string', `${label}.${name} is not a string`)
  }
  return record as Record<string, string>
}

function decisionSection(text: string, id: string): string {
  const start = text.indexOf(`### ${id}`)
  verify(start >= 0, `decision is missing: ${id}`)
  const next = text.indexOf('\n### ', start + 4)
  return text.slice(start, next >= 0 ? next : text.length)
}

function markdownTargets(text: string): string[] {
  const targets: string[] = []
  for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
    let target = match[1]?.trim() ?? ''
    if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1)
    else target = target.split(/\s+/u, 1)[0] ?? ''
    if (!target || target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/iu.test(target)) continue
    targets.push(target.split('#', 1)[0] ?? '')
  }
  return targets.filter(Boolean)
}

await runMachineCli(async () => {
  verify(process.platform === 'win32' && process.arch === 'x64', 'CUT-007 requires Windows x64')
  verify(Bun.version === '1.3.14', `CUT-007 requires Bun 1.3.14, got ${Bun.version}`)
  await rm(artifactRoot, { recursive: true, force: true })

  const documents: ReadonlyMap<string, string> = new Map(
    await Promise.all(
      [...activeDocumentPaths, ...historicalDocumentPaths].map(
        async (path) => [path, await readFile(join(repositoryRoot, path), 'utf8')] as const
      )
    )
  )
  const document = (
    path: (typeof activeDocumentPaths)[number] | (typeof historicalDocumentPaths)[number]
  ) => {
    const text = documents.get(path)
    verify(text !== undefined, `document was not loaded: ${path}`)
    return text
  }

  const rootPackage = asRecord(
    await readJsonFile(join(repositoryRoot, 'package.json')),
    'package.json'
  )
  const rootScripts = stringScripts(rootPackage.scripts, 'package.json.scripts')
  verify(rootPackage.packageManager === 'bun@1.3.14', 'root package manager drifted')
  verify(
    rootScripts['check:cut-007']?.startsWith('bun run typecheck:cut-007'),
    'CUT-007 command gate is missing'
  )
  for (const command of ['dev', 'dev:backend', 'typecheck', 'test', 'build', 'package:desktop']) {
    verify(
      rootScripts[command]?.startsWith('bun '),
      `documented root command is not Bun-owned: ${command}`
    )
  }

  const requiredClauses: ReadonlyArray<readonly [string, readonly string[]]> = [
    [
      'README.md',
      [
        'apps/backend-bun',
        '127.0.0.1:8765',
        'HTTP protocol v3',
        'realtime protocol v4',
        'ADVX-BIN/3',
        'Windows x64',
        'Python parity oracle'
      ]
    ],
    [
      'AGENTS.md',
      [
        'apps/backend-bun',
        'current Elysia/Bun service',
        'historical Python parity oracle',
        'bun install --frozen-lockfile --ignore-scripts'
      ]
    ],
    [
      'apps/desktop/README.md',
      ['supervises the current Bun', 'authenticated', '/health', 'no child process orphaned']
    ],
    [
      'apps/backend-bun/README.md',
      [
        'current local product backend',
        'inherited startup descriptor',
        'HTTP protocol v3',
        'Realtime v4',
        'Windows x64'
      ]
    ],
    [
      'apps/backend/README.md',
      ['Historical Python parity oracle', 'Do not add new product features']
    ],
    [
      'docs/ARCHITECTURE.md',
      [
        'Current Architecture Baseline',
        '127.0.0.1:8765',
        'Authorization: Bearer <local-token>',
        'realtime v4',
        'ADVX-BIN/3',
        'Python oracle'
      ]
    ],
    [
      'docs/BACKEND_DESIGN.md',
      [
        'Current Backend Baseline',
        'Bun `1.3.14`',
        'Elysia',
        'bun:sqlite',
        'Drizzle',
        '每个 Viewer 独立决策'
      ]
    ],
    ['docs/INGEST_PROTOCOL.md', ['Electron 与 Bun 后端', 'realtime protocol v4', 'ADVX-BIN/3']],
    [
      'docs/REAL_PIPELINE.md',
      ['Windows x64、Bun 1.3.14', '受监督 Bun 后端', '127.0.0.1:8765', '无 Electron/Bun orphan']
    ],
    ['docs/PRODUCT.md', ['Electron 与 Bun 后端', 'Windows x64', '不再使用 Director']],
    ['docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md', ['不设 Director', '本地确定性策略']],
    [
      'docs/OPERATIONS.md',
      [
        'Current Windows x64 Operations Baseline',
        'bun install --frozen-lockfile --ignore-scripts',
        '故障排查',
        '安全基线',
        '发布门禁'
      ]
    ],
    ['docs/README.md', ['当前产品与技术入口', 'Bun/Elysia', '历史文档', 'OPERATIONS.md']]
  ]
  for (const [path, clauses] of requiredClauses) {
    const text = documents.get(path)
    verify(text !== undefined, `required document was not loaded: ${path}`)
    for (const clause of clauses) verify(text.includes(clause), `${path} is missing: ${clause}`)
  }

  const legacyCommandHits: Array<{ path: string; pattern: string }> = []
  const legacyCommandPatterns = [
    /\bpnpm\b/iu,
    /\buv\s+(?:run|sync)\b/iu,
    /\bpytest\b/iu,
    /\bruff\b/iu,
    /(?:^|\r?\n)\s*python(?:3)?(?:\.exe)?(?:\s+-m\s+|\s+\S+\.py\b)/imu,
    /`python(?:3)?(?:\.exe)?\s+(?:-m\s+|[^`\s]+\.py\b)/iu
  ] as const
  for (const path of activeDocumentPaths) {
    const text = document(path)
    for (const pattern of legacyCommandPatterns) {
      if (pattern.test(text)) legacyCommandHits.push({ path, pattern: pattern.source })
    }
  }
  verify(
    legacyCommandHits.length === 0,
    `active docs contain legacy commands: ${JSON.stringify(legacyCommandHits)}`
  )

  const implementationDocs = activeDocumentPaths.filter(
    (path) => path !== 'docs/README.md' && path !== 'docs/DECISIONS.md'
  )
  const legacyImplementationHits: Array<{ path: string; pattern: string }> = []
  for (const path of implementationDocs) {
    const text = document(path)
    for (const pattern of [/\bFastAPI\b/iu, /\bPydantic\b/iu, /\bSQLAlchemy\b/iu]) {
      if (pattern.test(text)) legacyImplementationHits.push({ path, pattern: pattern.source })
    }
  }
  verify(
    legacyImplementationHits.length === 0,
    `active implementation docs contain legacy backend terms: ${JSON.stringify(legacyImplementationHits)}`
  )

  const staleDirectorHits: Array<{ path: string; pattern: string }> = []
  for (const path of activeDocumentPaths.filter(
    (path) => path !== 'docs/DECISIONS.md' && path !== 'docs/AUDIENCE_SPEAKING_PRODUCT_SPEC.md'
  )) {
    const text = document(path)
    for (const pattern of [
      /Director\s+(?:每波调用|精确选|选择准确|只输出)/u,
      /导演(?:产生|输出|判断成立)/u,
      /真实 Director/u
    ]) {
      if (pattern.test(text)) staleDirectorHits.push({ path, pattern: pattern.source })
    }
  }
  verify(
    staleDirectorHits.length === 0,
    `active docs retain stale Director semantics: ${JSON.stringify(staleDirectorHits)}`
  )

  for (const path of historicalDocumentPaths) {
    const opening = document(path).slice(0, 1_000)
    verify(
      /Historical|Superseded|parity oracle/iu.test(opening),
      `${path} is not labeled historical or superseded`
    )
  }

  const decisions = document('docs/DECISIONS.md')
  for (const id of ['D-004', 'D-011', 'D-018', 'D-027']) {
    verify(decisionSection(decisions, id).includes('`Superseded`'), `${id} is not superseded`)
  }
  for (const id of ['D-045', 'D-046', 'D-047']) {
    verify(decisionSection(decisions, id).includes('`Accepted`'), `${id} is not accepted`)
  }

  const brokenLinks: Array<{ path: string; target: string }> = []
  for (const path of activeDocumentPaths) {
    for (const target of markdownTargets(document(path))) {
      let decoded: string
      try {
        decoded = decodeURIComponent(target)
      } catch {
        brokenLinks.push({ path, target })
        continue
      }
      const resolved = resolve(dirname(join(repositoryRoot, path)), decoded)
      try {
        await access(resolved)
      } catch {
        brokenLinks.push({ path, target })
      }
    }
  }
  verify(
    brokenLinks.length === 0,
    `active docs contain broken local links: ${JSON.stringify(brokenLinks)}`
  )

  for (const oraclePath of [
    'tests/parity/python_health_oracle.py',
    'tests/parity/python_control_session_server.py',
    'apps/backend/src/advx_backend/main.py'
  ]) {
    try {
      await access(join(repositoryRoot, oraclePath))
    } catch {
      throw new ScriptError(
        SCRIPT_EXIT.verificationFailed,
        `Python parity oracle was removed: ${oraclePath}`
      )
    }
  }

  const sourceIdentities = await Promise.all(
    sourcePaths.map((path) => fileIdentity(join(repositoryRoot, path), path))
  )
  const sourceAggregateSha256 = createHash('sha256')
    .update(sourceIdentities.map((identity) => `${identity.path}:${identity.sha256}`).join('\n'))
    .digest('hex')
  const result = {
    schemaVersion: 1,
    taskId: 'CUT-007',
    status: 'passed',
    activeDocuments: activeDocumentPaths,
    historicalDocuments: historicalDocumentPaths,
    legacyCommandHits,
    legacyImplementationHits,
    staleDirectorHits,
    brokenLinks,
    decisions: {
      superseded: ['D-004', 'D-011', 'D-018', 'D-027'],
      accepted: ['D-045', 'D-046', 'D-047']
    },
    currentBackend: 'apps/backend-bun',
    releasePlatform: 'Windows x64',
    pythonOraclePreserved: true,
    releaseSideEffects: { commit: false, push: false, publish: false, sign: false, deploy: false },
    sourceAggregateSha256,
    sourceIdentities
  }
  await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
  return {
    artifact: relative(repositoryRoot, join(artifactRoot, 'result.json')).replace(/\\/g, '/'),
    activeDocuments: activeDocumentPaths.length,
    historicalDocuments: historicalDocumentPaths.length,
    brokenLinks: brokenLinks.length,
    legacyHits:
      legacyCommandHits.length + legacyImplementationHits.length + staleDirectorHits.length,
    sourceFiles: sourceIdentities.length,
    sourceAggregateSha256
  }
})
