/**
 * Display formatting for chrome surfaces (header, status bar, rail). Every
 * helper narrows defensively: the engine reports opaque JSON and the chrome
 * must render silence rather than `undefined` or `NaN`.
 */

/** The engine reports the model as opaque JSON; narrow defensively for display. */
export function modelLabel(model: unknown): string | null {
  if (typeof model === 'string') return model
  if (typeof model !== 'object' || model === null) return null
  const record = model as Record<string, unknown>
  const id = record['modelId'] ?? record['id']
  if (typeof id !== 'string') return null
  const provider = record['provider']
  return typeof provider === 'string' ? `${provider}/${id}` : id
}

/** The engine reports the model as opaque JSON; this is what an API call needs from it. */
export function modelRef(model: unknown): { provider: string; id: string } | null {
  if (typeof model !== 'object' || model === null) return null
  const record = model as Record<string, unknown>
  const id = record['modelId'] ?? record['id']
  const provider = record['provider']
  if (typeof id !== 'string' || typeof provider !== 'string') return null
  return { provider, id }
}

/** The effort level is the terminal's "medium"/"high" suffix; `off` adds noise. */
export function effortLabel(level: unknown): string | null {
  if (typeof level !== 'string' || level.length === 0 || level === 'off') return null
  return level
}

export interface ContextUsageView {
  percent: number | null
}

/** The terminal's context gauge: eight steps of ▰/▱. */
export function contextGauge(percent: number | null | undefined, steps = 8): string {
  const clamped = typeof percent === 'number' && Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0
  const filled = Math.round((clamped / 100) * steps)
  return `${'▰'.repeat(filled)}${'▱'.repeat(steps - filled)}`
}

export function percentLabel(percent: number | null | undefined): string {
  if (typeof percent !== 'number' || !Number.isFinite(percent)) return '?'
  return `${Math.round(percent)}%`
}

export function formatCost(cost: unknown): string | null {
  const total = typeof cost === 'object' && cost !== null ? (cost as Record<string, unknown>)['total'] : undefined
  if (typeof total !== 'number' || !Number.isFinite(total)) return null
  return `$${total.toFixed(2)}`
}

function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
}

/** The picker affordance names the accelerator for the running platform. */
export function historyKeyLabel(): string {
  return isMac() ? '⌘K history' : 'Ctrl+K history'
}

/** The command palette's accelerator, named for the running platform. */
export function commandKeyLabel(): string {
  return isMac() ? '⌘P commands' : 'Ctrl+P commands'
}

/** Bare accelerators, for the action row where the button already carries the verb. */
export function historyShortcut(): string {
  return isMac() ? '⌘H' : 'Ctrl+H'
}

/**
 * Commands follow the terminal: `alt+k` opens the command menu there, and `ctrl+k` is
 * reserved by pi's editor. The app keeps `ctrl+p` as a convenience alias.
 */
export function commandsShortcut(): string {
  return isMac() ? '⌘K' : 'Ctrl+K'
}

export function agentsShortcut(): string {
  return isMac() ? '⌥A' : 'Alt+A'
}

export function settingsShortcut(): string {
  return isMac() ? '⌘,' : 'Ctrl+,'
}

export function relativeTime(timestamp: string | null): string {
  if (!timestamp) return ''
  const parsed = Date.parse(timestamp)
  if (Number.isNaN(parsed)) return ''

  const minutes = Math.round((Date.now() - parsed) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(parsed).toLocaleDateString()
}
