import type {
  HostStatus,
  RepoStatus,
  SessionStats,
  SubscriptionUsage
} from '../../../shared/ipc.ts'
import {
  agentsShortcut,
  commandsShortcut,
  contextGauge,
  effortLabel,
  formatCost,
  historyShortcut,
  modelLabel,
  modelRef,
  percentLabel,
  settingsShortcut
} from '../state/format.ts'

/**
 * The top bar, plus the action row right under it.
 *
 * The action row exists for people who do not memorize accelerators: every overlay is a
 * labelled button, and the shortcut sits beside it so the keyboard path stays learnable
 * instead of hidden. Nothing on that row is only a shortcut.
 */

/** Only non-ready phases are worth surfacing; a healthy engine says nothing. */
const ENGINE_LABELS: Record<HostStatus['phase'], string | null> = {
  ready: null,
  starting: 'engine starting…',
  restarting: 'engine restarting…',
  crashed: 'engine stopped',
  stopped: 'engine stopped'
}

/** The last path segment, for both separators: a wrong pattern silently shows everything. */
function projectFolder(cwd: string | undefined): string | null {
  if (cwd === undefined || cwd.length === 0) return null
  const lastSeparator = Math.max(cwd.lastIndexOf('/'), cwd.lastIndexOf('\\'))
  const folder = cwd.slice(lastSeparator + 1)
  return folder.length > 0 ? folder : null
}

export function Header({
  status,
  model,
  thinkingLevel,
  stats,
  repo,
  usage,
  railCollapsed,
  onNewSession,
  onOpenCommands,
  onOpenAgents,
  onToggleRail,
  onOpenSetup,
  onOpenHistory
}: {
  status: HostStatus
  model: unknown
  thinkingLevel: string | null
  stats: SessionStats | null
  repo: RepoStatus | null
  usage: SubscriptionUsage | null
  /** Whether the rail is folded away; the toggle only exists when it is. */
  railCollapsed: boolean
  onNewSession: () => void
  onOpenCommands: () => void
  onOpenAgents: () => void
  onToggleRail: () => void
  onOpenSetup: () => void
  onOpenHistory: () => void
}): React.JSX.Element {
  const label = modelLabel(model)
  const level = effortLabel(thinkingLevel)
  const cost = formatCost(stats?.cost)
  const contextUsage = stats?.contextUsage
  const modelText = label !== null && level !== null ? `${label} · ${level}` : label
  /**
   * The row for the model in use, falling back to the first metered model. A provider that
   * reports no quota leaves the whole segment out.
   */
  const usageRow = (() => {
    if (usage === null || usage.models.length === 0) return null
    const active = modelRef(model)
    return usage.models.find((entry) => entry.id === active?.id) ?? usage.models[0] ?? null
  })()

  const dirty = repo?.dirtyCount ?? 0
  const projectName = projectFolder(status.cwd)

  const actions: Array<{ key: string; label: string; shortcut: string | null; onClick: () => void }> = [
    { key: 'new', label: 'New', shortcut: null, onClick: onNewSession },
    { key: 'history', label: 'History', shortcut: historyShortcut(), onClick: onOpenHistory },
    { key: 'commands', label: 'Commands', shortcut: commandsShortcut(), onClick: onOpenCommands },
    { key: 'agents', label: 'Agents', shortcut: agentsShortcut(), onClick: onOpenAgents },
    { key: 'providers', label: 'Providers', shortcut: settingsShortcut(), onClick: onOpenSetup },
    ...(railCollapsed
      ? [{ key: 'rail', label: 'Show rail', shortcut: null, onClick: onToggleRail }]
      : [])
  ]

  return (
    <div className="app-chrome">
      <header className="app-header">
        <span className="brand">
          ✿ <b>gentle desktop</b>
        </span>
        {projectName !== null ? (
          <span className="header-path" title={status.cwd ?? projectName}>
            {projectName}
          </span>
        ) : null}
        {repo?.branch !== undefined && repo.branch !== null ? (
          <span className="header-branch">
            <b>{repo.branch}</b>
            {dirty > 0 ? <span className="header-dirty"> ±{dirty}</span> : null}
          </span>
        ) : null}
        <span className="header-right">
          {ENGINE_LABELS[status.phase] !== null ? (
            <span
              className={`header-engine header-engine-${status.phase}`}
              title={status.detail ?? status.phase}
              role="status"
            >
              {ENGINE_LABELS[status.phase]}
            </span>
          ) : null}
          {modelText !== null ? <span className="header-model">{modelText}</span> : null}
          {contextUsage !== undefined && contextUsage !== null ? (
            <span className="header-ctx">
              ctx{' '}
              <span className="gauge" aria-label={`Context ${percentLabel(contextUsage.percent)}`}>
                {contextGauge(contextUsage.percent)}
              </span>{' '}
              {percentLabel(contextUsage.percent)}
            </span>
          ) : null}
          {usageRow !== null ? (
            <span className="header-usage">
              usage{' '}
              <span className="gauge" aria-label={`Subscription usage ${percentLabel(usageRow.usedPercent)}`}>
                {contextGauge(usageRow.usedPercent)}
              </span>{' '}
              {percentLabel(usageRow.usedPercent)}
            </span>
          ) : null}
          {cost !== null ? (
            <span className="header-cost">
              {cost}
              {usageRow !== null ? <span className="header-cost-sub"> sub</span> : null}
            </span>
          ) : null}
        </span>
      </header>

      <div className="app-actions" role="toolbar" aria-label="Actions">
        {actions.map((action) => (
          <button key={action.key} type="button" className="action-button" onClick={action.onClick}>
            <span className="action-label">{action.label}</span>
            {action.shortcut !== null ? <span className="action-shortcut">{action.shortcut}</span> : null}
          </button>
        ))}
      </div>
    </div>
  )
}
