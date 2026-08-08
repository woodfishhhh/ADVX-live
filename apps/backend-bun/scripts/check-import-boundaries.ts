import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, relative, resolve, sep } from 'node:path'
import ts from 'typescript'

type Layer =
  | 'api'
  | 'application'
  | 'diagnostics'
  | 'domain'
  | 'headless'
  | 'infrastructure'
  | 'openapi'
  | 'profiling'
  | 'providers'
  | 'shared'
  | 'testing'

export type BoundaryViolation = {
  readonly file: string
  readonly moduleSpecifier: string
  readonly reason: string
}

const inwardLayers: Record<Layer, ReadonlySet<Layer>> = {
  api: new Set(['api', 'application', 'domain', 'shared']),
  application: new Set(['application', 'domain', 'shared']),
  diagnostics: new Set(['application', 'diagnostics', 'domain', 'infrastructure', 'shared']),
  domain: new Set(['domain', 'shared']),
  headless: new Set([
    'api',
    'application',
    'domain',
    'headless',
    'infrastructure',
    'providers',
    'shared'
  ]),
  infrastructure: new Set(['application', 'domain', 'infrastructure', 'shared']),
  openapi: new Set(['application', 'domain', 'openapi', 'shared']),
  profiling: new Set(['application', 'domain', 'infrastructure', 'profiling', 'shared']),
  providers: new Set(['application', 'domain', 'providers', 'shared']),
  shared: new Set(['shared']),
  testing: new Set([
    'api',
    'application',
    'domain',
    'infrastructure',
    'providers',
    'shared',
    'testing'
  ])
}

const compositionRoots = new Set(['app', 'index', 'main'])
const reviewedApplicationPlatformImports = new Map<string, ReadonlySet<string>>([
  [
    'application/services/replay-service.ts',
    new Set(['node:fs/promises', 'node:os', 'node:path'])
  ]
])

function sourceFiles(root: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(root)) {
    const path = resolve(root, entry)
    if (statSync(path).isDirectory()) {
      files.push(...sourceFiles(path))
    } else if (path.endsWith('.ts') && !path.endsWith('.test.ts')) {
      files.push(path)
    }
  }
  return files
}

function layerFor(path: string, sourceRoot: string): Layer | null {
  const [segment] = relative(sourceRoot, path).split(sep)
  return segment in inwardLayers ? (segment as Layer) : null
}

function compositionRootFor(path: string, sourceRoot: string): string | null {
  const relativePath = relative(sourceRoot, path)
  const segments = relativePath.split(sep)
  if (segments.length > 1) return null

  const name = (segments[0] || 'index').replace(/\.ts$/, '')
  return compositionRoots.has(name) ? `${name}.ts` : null
}

function importedLayer(
  file: string,
  moduleSpecifier: string,
  sourceRoot: string
): Layer | null {
  if (!moduleSpecifier.startsWith('.')) return null
  return layerFor(resolve(dirname(file), moduleSpecifier), sourceRoot)
}

function moduleSpecifiers(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const specifiers: string[] = []

  source.forEachChild((node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text)
    }
  })
  return specifiers
}

export function checkImportBoundaries(sourceRoot: string): BoundaryViolation[] {
  const violations: BoundaryViolation[] = []

  for (const file of sourceFiles(sourceRoot)) {
    const layer = layerFor(file, sourceRoot)
    if (!layer) {
      if (!compositionRootFor(file, sourceRoot)) {
        violations.push({
          file,
          moduleSpecifier: relative(sourceRoot, file),
          reason:
            'undeclared root production source; allowed composition roots are app.ts, index.ts, and main.ts'
        })
      }
      continue
    }

    for (const moduleSpecifier of moduleSpecifiers(file)) {
      const targetLayer = importedLayer(file, moduleSpecifier, sourceRoot)
      if (targetLayer && !inwardLayers[layer].has(targetLayer)) {
        violations.push({
          file,
          moduleSpecifier,
          reason: `${layer} cannot import outward layer ${targetLayer}`
        })
        continue
      }

      if (moduleSpecifier.startsWith('.')) {
        const targetRoot = compositionRootFor(
          resolve(dirname(file), moduleSpecifier),
          sourceRoot
        )
        if (targetRoot) {
          violations.push({
            file,
            moduleSpecifier,
            reason: `${layer} cannot import composition root ${targetRoot}`
          })
          continue
        }
      }

      if (
        (layer === 'domain' || layer === 'shared' || layer === 'application') &&
        !moduleSpecifier.startsWith('.') &&
        moduleSpecifier !== '@advx/contracts' &&
        !moduleSpecifier.startsWith('@advx/contracts/') &&
        !reviewedApplicationPlatformImports
          .get(relative(sourceRoot, file).split(sep).join('/'))
          ?.has(moduleSpecifier)
      ) {
        violations.push({
          file,
          moduleSpecifier,
          reason: `${layer} may import only inward source modules and @advx/contracts`
        })
      }
    }
  }

  return violations
}

if (import.meta.main) {
  const sourceRoot = resolve(import.meta.dir, '../src')
  const violations = checkImportBoundaries(sourceRoot)
  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(
        `${relative(sourceRoot, violation.file)}: ${violation.moduleSpecifier}: ${violation.reason}`
      )
    }
    process.exitCode = 1
  } else {
    console.log(
      `Import boundaries passed for ${sourceFiles(sourceRoot).length} source files.`
    )
  }
}
