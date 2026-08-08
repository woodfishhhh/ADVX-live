import { canonicalJson, type CanonicalRuntimeSpec } from '@advx/contracts'

export type RuntimeSpecIdentityDiff = Readonly<{
  addedIds: readonly string[]
  removedIds: readonly string[]
  changedIds: readonly string[]
  previousCount: number
  nextCount: number
}>

export type RuntimeSpecDiffSummary = Readonly<{
  changedSections: readonly (
    | 'room'
    | 'active_mode'
    | 'personas'
    | 'modes'
    | 'provider'
    | 'settings'
  )[]
  personas: RuntimeSpecIdentityDiff
  modes: RuntimeSpecIdentityDiff
  providerChanged: boolean
  settingsChanged: boolean
}>

const SECTION_ORDER = [
  'room',
  'active_mode',
  'personas',
  'modes',
  'provider',
  'settings'
] as const

export function summarizeRuntimeSpecDiff(
  previous: CanonicalRuntimeSpec,
  next: CanonicalRuntimeSpec
): RuntimeSpecDiffSummary {
  const personas = identityDiff(previous.personas, next.personas, 'persona_id')
  const modes = identityDiff(previous.modes, next.modes, 'mode_id')
  const changed = new Set<(typeof SECTION_ORDER)[number]>()
  if (canonicalJson(previous.room) !== canonicalJson(next.room)) changed.add('room')
  if (previous.active_mode_id !== next.active_mode_id) changed.add('active_mode')
  if (hasIdentityChanges(personas)) changed.add('personas')
  if (hasIdentityChanges(modes)) changed.add('modes')
  const providerChanged = canonicalJson(previous.provider) !== canonicalJson(next.provider)
  const settingsChanged = canonicalOptional(previous.settings) !== canonicalOptional(next.settings)
  if (providerChanged) changed.add('provider')
  if (settingsChanged) changed.add('settings')

  return deepFreeze({
    changedSections: SECTION_ORDER.filter((section) => changed.has(section)),
    personas,
    modes,
    providerChanged,
    settingsChanged
  })
}

function identityDiff<
  TItem extends Record<TKey, string>,
  TKey extends 'persona_id' | 'mode_id'
>(
  previous: readonly TItem[],
  next: readonly TItem[],
  key: TKey
): RuntimeSpecIdentityDiff {
  const before = new Map(previous.map((item) => [item[key], canonicalJson(item)]))
  const after = new Map(next.map((item) => [item[key], canonicalJson(item)]))
  const addedIds = [...after.keys()].filter((id) => !before.has(id)).sort()
  const removedIds = [...before.keys()].filter((id) => !after.has(id)).sort()
  const changedIds = [...after.keys()]
    .filter((id) => before.has(id) && before.get(id) !== after.get(id))
    .sort()
  return deepFreeze({
    addedIds: addedIds.slice(0, 32),
    removedIds: removedIds.slice(0, 32),
    changedIds: changedIds.slice(0, 32),
    previousCount: previous.length,
    nextCount: next.length
  })
}

function hasIdentityChanges(diff: RuntimeSpecIdentityDiff): boolean {
  return (
    diff.addedIds.length > 0 ||
    diff.removedIds.length > 0 ||
    diff.changedIds.length > 0
  )
}

function canonicalOptional(value: unknown): string {
  return value === undefined ? 'undefined' : canonicalJson(value)
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}
