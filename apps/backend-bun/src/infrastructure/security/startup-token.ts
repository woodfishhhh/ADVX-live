import { timingSafeEqual } from 'node:crypto'
import { closeSync, readSync } from 'node:fs'

import type { BackendConfig } from '../config/backend-config'

const startupTokenPattern = /^[A-Za-z0-9_-]{43,128}$/
const encoder = new TextEncoder()

export class BackendStartupError extends Error {
  readonly code: string

  constructor(code: string) {
    super(`Backend startup failed (${code})`)
    this.name = 'BackendStartupError'
    this.code = code
  }

  toJSON() {
    return { name: this.name, code: this.code }
  }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `${this.name} ${JSON.stringify(this.toJSON())}`
  }
}

export class StartupTokenCredential {
  #bytes: Uint8Array | null

  private constructor(bytes: Uint8Array) {
    this.#bytes = bytes
  }

  static consume(
    channel: BackendConfig['startupTokenChannel']
  ): StartupTokenCredential {
    const raw = Buffer.alloc(129)
    let bytesRead: number
    try {
      bytesRead = readSync(
        channel.fileDescriptor,
        raw,
        0,
        raw.byteLength,
        null
      )
    } catch {
      throw new BackendStartupError('startup_token_unavailable')
    } finally {
      try {
        closeSync(channel.fileDescriptor)
      } catch {
        // A failed read may already have invalidated the inherited descriptor.
      }
    }

    try {
      const token = new TextDecoder(channel.encoding, { fatal: true }).decode(
        raw.subarray(0, bytesRead)
      )
      if (!startupTokenPattern.test(token)) {
        throw new BackendStartupError('startup_token_malformed')
      }
      return new StartupTokenCredential(encoder.encode(token))
    } catch (error) {
      if (error instanceof BackendStartupError) throw error
      throw new BackendStartupError('startup_token_malformed')
    } finally {
      raw.fill(0)
    }
  }

  matchesAuthorization(authorization: string | null): boolean {
    const expected = this.#bytes
    if (expected === null || authorization === null) return false
    const match = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(authorization)
    if (match === null) return false

    const candidate = encoder.encode(match[1])
    try {
      return (
        candidate.length === expected.length && timingSafeEqual(candidate, expected)
      )
    } finally {
      candidate.fill(0)
    }
  }

  clear(): void {
    this.#bytes?.fill(0)
    this.#bytes = null
  }

  isActive(): boolean {
    return this.#bytes !== null
  }
}
