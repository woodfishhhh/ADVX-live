import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

import { checkImportBoundaries } from './check-import-boundaries'

const fixtureRoot = resolve(import.meta.dir, '.boundary-fixture')

afterEach(() => {
  rmSync(fixtureRoot, { force: true, recursive: true })
})

describe('import boundary checker', () => {
  test('accepts the backend source tree', () => {
    expect(checkImportBoundaries(resolve(import.meta.dir, '../src'))).toEqual([])
  })

  test('rejects an outward framework import from domain', async () => {
    const domainRoot = resolve(fixtureRoot, 'domain')
    mkdirSync(domainRoot, { recursive: true })
    await Bun.write(
      resolve(domainRoot, 'invalid.ts'),
      "import { Elysia } from 'elysia'\nexport const invalid = Elysia\n"
    )

    expect(checkImportBoundaries(fixtureRoot)).toEqual([
      expect.objectContaining({
        moduleSpecifier: 'elysia',
        reason: 'domain may import only inward source modules and @advx/contracts'
      })
    ])
  })

  test('rejects a domain import of an explicit composition root', async () => {
    const domainRoot = resolve(fixtureRoot, 'domain')
    mkdirSync(domainRoot, { recursive: true })
    await Bun.write(resolve(domainRoot, 'invalid.ts'), "import '../app'\n")

    expect(checkImportBoundaries(fixtureRoot)).toEqual([
      expect.objectContaining({
        moduleSpecifier: '../app',
        reason: 'domain cannot import composition root app.ts'
      })
    ])
  })

  test('rejects an undeclared root production source', async () => {
    mkdirSync(fixtureRoot, { recursive: true })
    await Bun.write(
      resolve(fixtureRoot, 'rogue.ts'),
      "import './infrastructure/adapter'\n"
    )

    expect(checkImportBoundaries(fixtureRoot)).toEqual([
      expect.objectContaining({
        moduleSpecifier: 'rogue.ts',
        reason:
          'undeclared root production source; allowed composition roots are app.ts, index.ts, and main.ts'
      })
    ])
  })
})
