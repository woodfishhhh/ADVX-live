import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import {
  parseNamedArguments,
  requireSafeArtifactRoot,
  SCRIPT_EXIT,
  ScriptError,
  writeJsonAtomic
} from './evidence-script-runtime.ts'

const repositoryRoot = resolve(import.meta.dir, '..')
const args = parseNamedArguments(Bun.argv.slice(2), new Set(['--artifact-root']))
const artifactRoot = requireSafeArtifactRoot(
  args.get('--artifact-root') ?? join(repositoryRoot, '.omx', 'artifacts', 'test-results', 'pkg-002'),
  repositoryRoot
)

const [adr, master, builder, desktopPackage, workflow, fndReport] = await Promise.all([
  readFile(join(repositoryRoot, 'docs', 'migrations', 'typescript-bun', 'ADR-MIG-004.md'), 'utf8'),
  readFile(join(repositoryRoot, 'docs', 'migrations', 'typescript-bun', '00-MASTER-PLAN.md'), 'utf8'),
  readFile(join(repositoryRoot, 'apps', 'desktop', 'electron-builder.yml'), 'utf8'),
  readFile(join(repositoryRoot, 'apps', 'desktop', 'package.json'), 'utf8'),
  readFile(join(repositoryRoot, '.github', 'workflows', 'bun-ci.yml'), 'utf8'),
  readFile(
    join(
      repositoryRoot,
      '.omx',
      'artifacts',
      'typescript-bun',
      'FND-004',
      'fnd-004-checker-20260730-002',
      'checker-report.md'
    ),
    'utf8'
  )
])

type Criterion = Readonly<{
  id: string
  claim: string
  passed: boolean
  evidence: readonly string[]
}>

function criterion(
  id: string,
  claim: string,
  passed: boolean,
  evidence: readonly string[]
): Criterion {
  return { id, claim, passed, evidence }
}

function includesAll(text: string, needles: readonly string[]): boolean {
  return needles.every((needle) => text.includes(needle))
}

const criteria: readonly Criterion[] = [
  criterion(
    'adr-present',
    'ADR-MIG-004 exists and owns the Phase 08 target decision',
    includesAll(adr, ['ADR-MIG-004', 'Phase 08 packaging']) &&
      (adr.includes('Status: Candidate') || adr.includes('Status: Accepted')),
    ['docs/migrations/typescript-bun/ADR-MIG-004.md']
  ),
  criterion(
    'release-target',
    'Windows x64 baseline is the only current release target',
    includesAll(adr, ['Windows x64 baseline', '**Required**', 'bun-windows-x64-baseline']) &&
      !adr.includes('Windows arm64 is a current release target'),
    ['ADR-MIG-004 matrix and decision']
  ),
  criterion(
    'deferred-targets',
    'Windows arm64 and both macOS targets are explicitly not released',
    includesAll(adr, ['Windows arm64', 'macOS arm64', 'macOS x64']) &&
      (adr.match(/\*\*Not released\*\*/g)?.length ?? 0) >= 3 &&
      adr.includes('PKG-011'),
    ['ADR-MIG-004 deferred rows', 'PKG-011 dependency']
  ),
  criterion(
    'minimum-os',
    'Minimum operating-system floors are recorded',
    includesAll(adr, ['Windows 10 or later', 'macOS 13 Ventura or later']),
    ['ADR-MIG-004 minimum OS column']
  ),
  criterion(
    'bun-target-shapes',
    'Every matrix target uses an explicit Bun compile target shape',
    includesAll(adr, [
      'bun-windows-x64-baseline',
      'bun-windows-x64',
      'bun-windows-arm64',
      'bun-darwin-arm64',
      'bun-darwin-x64'
    ]),
    ['ADR-MIG-004 Bun target column']
  ),
  criterion(
    'electron-targets',
    'Electron version and installer targets match the current configuration',
    includesAll(adr, ['Electron 43.2.0', 'NSIS `win`', 'DMG `mac`']) &&
      desktopPackage.includes('"electron": "43.2.0"') &&
      builder.includes('target: nsis') &&
      builder.includes('target: dmg'),
    ['ADR-MIG-004', 'apps/desktop/package.json', 'apps/desktop/electron-builder.yml']
  ),
  criterion(
    'native-risk',
    'Bun and desktop native/WASM risk is explicit',
    includesAll(adr, ['bun:sqlite', 'bun:ffi', '@echogarden/fvad-wasm', 'no backend `.node` addon']),
    ['ADR-MIG-004 native dependency risk column']
  ),
  criterion(
    'signing-boundary',
    'Signing identities are not invented and remain a release prerequisite',
    includesAll(adr, ['Authenticode is **not configured**', 'Developer ID/notarization is not configured']),
    ['ADR-MIG-004 signing column']
  ),
  criterion(
    'runner-boundary',
    'Available runner/hardware boundaries are explicit',
    includesAll(adr, [
      'local Windows x64 runner is available',
      'no macOS runner',
      'No ARM signing or hardware runner is available'
    ]),
    ['ADR-MIG-004 runner column']
  ),
  criterion(
    'fnd004-proof',
    'FND-004 accepted evidence is bound to the Windows x64 baseline',
    includesAll(fndReport, ['Windows x64', 'baseline', '0x8664', '0d9b296af']),
    ['.omx/artifacts/typescript-bun/FND-004/fnd-004-checker-20260730-002/checker-report.md']
  ),
  criterion(
    'ci-boundary',
    'Current CI is not misrepresented as installed target proof',
    workflow.includes('runs-on: ubuntu-latest') &&
      adr.includes('not installed Windows or macOS package proof'),
    ['.github/workflows/bun-ci.yml', 'ADR-MIG-004 CI boundary']
  ),
  criterion(
    'cross-compile-limit',
    'Cross-compilation is explicitly insufficient for release acceptance',
    adr.includes('Cross-compilation can create a candidate binary') &&
      adr.includes('cannot satisfy installed') &&
      adr.includes('signing, native dependency, or lifecycle proof'),
    ['ADR-MIG-004 constraints']
  ),
  criterion(
    'plan-dependency',
    'Master plan records PKG-002 after PKG-001 and before PKG-003',
    master.includes('| `PKG-001` | `DONE`') &&
      master.includes('| `PKG-002` |') &&
      master.includes('| `PKG-003` |'),
    ['docs/migrations/typescript-bun/00-MASTER-PLAN.md']
  )
]

const passed = criteria.filter((item) => item.passed).length
const result = {
  schemaVersion: 1,
  taskId: 'PKG-002',
  status: passed === criteria.length ? 'passed' : 'failed',
  runtime: { bun: Bun.version, platform: process.platform, arch: process.arch },
  summary: { passed, failed: criteria.length - passed, total: criteria.length },
  criteria
} as const

await mkdir(artifactRoot, { recursive: true })
await writeJsonAtomic(join(artifactRoot, 'result.json'), result)
if (passed !== criteria.length) {
  throw new ScriptError(
    SCRIPT_EXIT.verificationFailed,
    `PKG-002 static matrix audit failed: ${criteria.filter((item) => !item.passed).map((item) => item.id).join(', ')}`
  )
}
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
