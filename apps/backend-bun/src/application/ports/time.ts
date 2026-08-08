declare const wallClockTimestampBrand: unique symbol
declare const monotonicTimestampBrand: unique symbol
declare const durationBrand: unique symbol

export type WallClockTimestampMs = number & {
  readonly [wallClockTimestampBrand]: 'wall-clock-timestamp-ms'
}

export type MonotonicTimestampMs = number & {
  readonly [monotonicTimestampBrand]: 'monotonic-timestamp-ms'
}

export type DurationMs = number & {
  readonly [durationBrand]: 'duration-ms'
}

export type MonotonicDeadline = {
  readonly expiresAt: MonotonicTimestampMs
}

export interface WallClock {
  now(): WallClockTimestampMs
}

export interface MonotonicClock {
  now(): MonotonicTimestampMs
}

function finiteNonNegative(value: number, name: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite non-negative number`)
  }
  return value
}

export function wallClockTimestampMs(value: number): WallClockTimestampMs {
  return finiteNonNegative(value, 'wall clock timestamp') as WallClockTimestampMs
}

export function monotonicTimestampMs(value: number): MonotonicTimestampMs {
  return finiteNonNegative(value, 'monotonic timestamp') as MonotonicTimestampMs
}

export function durationMs(value: number): DurationMs {
  return finiteNonNegative(value, 'duration') as DurationMs
}

export function monotonicDeadline(expiresAt: number): MonotonicDeadline {
  return { expiresAt: monotonicTimestampMs(expiresAt) }
}
