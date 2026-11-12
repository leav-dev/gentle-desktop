import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ProfileSummary } from '../shared/ipc.ts'

/**
 * The agent model profiles gentle-pi keeps in `<config home>/profiles.json`.
 *
 * Shape (verified on disk): `{ kind, version, profiles: { <name>: { <agent>: { model } } } }`.
 * The file also carries a `current` entry that holds overrides rather than being a profile
 * name, so it is excluded.
 *
 * There is no persisted selection in the agent settings, so the active profile is resolved
 * in two steps, in this order:
 *
 *   1. an explicit `profiles.current.profile` record, if a future version writes one;
 *   2. exactly one profile whose `orchestrator` model matches the model this session uses.
 *
 * Two or more matches, or none, resolve to nothing: showing the wrong profile is worse than
 * showing none, because the user would trust a label that does not describe the session.
 */
export function parseProfiles(raw: string): ProfileSummary[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return []

  const profiles = (parsed as { profiles?: unknown }).profiles
  if (typeof profiles !== 'object' || profiles === null || Array.isArray(profiles)) return []

  const summaries: ProfileSummary[] = []
  for (const [name, value] of Object.entries(profiles as Record<string, unknown>)) {
    if (name === 'current') continue
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue

    const agents = Object.entries(value as Record<string, unknown>).filter(([, entry]) => {
      if (typeof entry !== 'object' || entry === null) return false
      return typeof (entry as { model?: unknown }).model === 'string'
    })

    summaries.push({ name, agents: agents.length })
  }

  summaries.sort((left, right) => left.name.localeCompare(right.name))
  return summaries
}

export interface ActiveProfile {
  name: string
}

/**
 * Resolves the profile this session is running under.
 *
 * `modelKey` is `provider/modelId` as the engine reports it, which is the same shape the
 * profile file stores, so matching is a string comparison rather than a fuzzy guess.
 */
export function resolveActiveProfile(configHome: string, modelKey: string | null): ActiveProfile | null {
  const file = join(configHome, 'profiles.json')
  if (!existsSync(file)) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }

  if (typeof parsed !== 'object' || parsed === null) return null
  const profiles = (parsed as { profiles?: unknown }).profiles
  if (typeof profiles !== 'object' || profiles === null || Array.isArray(profiles)) return null

  const table = profiles as Record<string, unknown>

  const explicit = table['current']
  if (typeof explicit === 'object' && explicit !== null && !Array.isArray(explicit)) {
    const name = (explicit as { profile?: unknown }).profile
    if (typeof name === 'string' && name.length > 0) return { name }
  }

  if (modelKey === null || modelKey.length === 0) return null

  const matches: string[] = []
  for (const [name, value] of Object.entries(table)) {
    if (name === 'current') continue
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const orchestrator = (value as Record<string, unknown>)['orchestrator']
    if (typeof orchestrator !== 'object' || orchestrator === null) continue
    const model = (orchestrator as { model?: unknown }).model
    if (typeof model === 'string' && model === modelKey) matches.push(name)
  }

  return matches.length === 1 && matches[0] !== undefined ? { name: matches[0] } : null
}

export function readProfiles(configHome: string): ProfileSummary[] {
  const file = join(configHome, 'profiles.json')
  if (!existsSync(file)) return []

  try {
    return parseProfiles(readFileSync(file, 'utf8'))
  } catch {
    return []
  }
}
