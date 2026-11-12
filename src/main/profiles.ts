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
 * The *active* profile is not in this file and not in the agent settings; the terminal
 * records the profile a session took inside the session itself. Until that record is read,
 * profiles are listed without a selection marker rather than guessing one.
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

export function readProfiles(configHome: string): ProfileSummary[] {
  const file = join(configHome, 'profiles.json')
  if (!existsSync(file)) return []

  try {
    return parseProfiles(readFileSync(file, 'utf8'))
  } catch {
    return []
  }
}
