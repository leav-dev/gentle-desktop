import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BUILTIN_CODEMODE = 'builtin:codemode'
const CODEMODE_OPTOUT = `-builtin:codemode`

function hasExplicitBuiltinEntry(extensions: unknown): boolean {
  return (
    Array.isArray(extensions) &&
    extensions.some(
      (entry) => typeof entry === 'string' && entry.replace(/^[+!-]/, '') === BUILTIN_CODEMODE
    )
  )
}

/** Same shape as gentle-pi's withBuiltinExtensionExcluded; keeps unrelated keys. */
function withCodemodeOptOut(settingsText: string): string | undefined {
  let settings: unknown
  try {
    settings = JSON.parse(settingsText)
  } catch {
    return undefined
  }
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return undefined
  const extensions = Object.prototype.hasOwnProperty.call(settings, 'extensions')
    ? (settings as { extensions: unknown }).extensions
    : []
  if (!Array.isArray(extensions) || hasExplicitBuiltinEntry(extensions)) return undefined
  const indent = settingsText.match(/\{\r?\n([ \t]+)/)?.[1]
  const serialized = JSON.stringify(
    { ...settings, extensions: [...extensions, CODEMODE_OPTOUT] },
    null,
    indent
  )
  return settingsText.endsWith('\n') ? `${serialized}\n` : serialized
}

/**
 * Desktop RPC has no TUI prompt for gentle-pi's codemode opt-out (#1612). Pi warns on every
 * launch until `settings.json` lists `-builtin:codemode`.
 */
export function ensureAgentSettingsForDesktop(agentHome: string): void {
  mkdirSync(agentHome, { recursive: true })
  const path = join(agentHome, 'settings.json')
  if (!existsSync(path)) {
    writeFileSync(path, `${JSON.stringify({ extensions: [CODEMODE_OPTOUT] }, null, 2)}\n`, 'utf8')
    return
  }
  const current = readFileSync(path, 'utf8')
  const next = withCodemodeOptOut(current)
  if (next !== undefined) writeFileSync(path, next, 'utf8')
}