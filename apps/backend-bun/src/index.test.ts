import { describe, expect, test } from 'bun:test'

import { backendBunPackage } from './index'

describe('@advx/backend-bun package boundary', () => {
  test('describes the Bun backend package foundation', () => {
    expect(backendBunPackage).toEqual({
      name: '@advx/backend-bun',
      runtime: 'bun',
      role: 'backend-package-foundation'
    })
  })
})
