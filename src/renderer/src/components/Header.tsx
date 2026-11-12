import type { HostStatus, RepoStatus, SessionStats } from '../../../shared/ipc.ts'
import { contextGauge, effortLabel, formatCost, historyKeyLabel, modelLabel, percentLabel } from '../state/format.ts'

/**
 * The top bar: brand, working directory, branch with `±N`, and on the right the
 * history affordance, the model with effort, the context gauge and the cost.
 * Context usage and cost live here and nowhere else — never repeated in the rail
 * or the prompt rule. There is no status bar below the transcript (design/system.md):
 * the branch moved here, work counts live in the rail and key hints on the prompt
 * rule, so the two small controls that had no other owner (rail toggle, provider
 * setup) sit with the other chrome affordances on this row.
 */
export function Header({
  status,
  model,
  thinkingLevel,
  stats,
  repo,
  railCollapsed,
  onToggleRail,
  onOpenSetup,
  onOpenHistory
}: {
  status: HostStatus
  model: unknown
  thinkingLevel: string | null
  stats: SessionStats | null
  repo: RepoStatus | null
  /** Whether the rail is folded away; the toggle only exists when it is. */
  railCollapsed: boolean
  onToggleRail: () => void
  onOpenSetup: () => void
  onOpenHistory: () => void
}): React.JSX.Element {
  const label = modelLabel(model)
  const level = effortLabel(thinkingLevel)
  const cost = formatCost(stats?.cost)
  const usage = stats?.contextUsage
  const modelText = label !== null && level !== null ? `${label} · ${level}` : label
  /** Only non-ready phases are worth surfacing; a healthy engine says nothing. */
const ENGINE_LABELS: Record<HostStatus['phase'], string | null> = {
  ready: null,
  starting: 'engine starting…',
  restarting: 'engine restarting…',
  crashed: 'engine stopped',
  stopped: 'engine stopped'
}

const dirty = repo?.dirtyCount ?? 0

  return (
    <header className="app-header">
      <span className="brand">
        ✿ <b>gentle desktop</b>
      </span>
      {status.cwd !== undefined && status.cwd.length > 0 ? <span className="header-path">{status.cwd}</span> : null}
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
        {railCollapsed ? (
          <button type="button" className="picker-key" onClick={onToggleRail}>
            rail
          </button>
        ) : null}
        <button type="button" className="picker-key" onClick={onOpenSetup}>
          Providers
        </button>
        <button type="button" className="picker-key" onClick={onOpenHistory}>
          {historyKeyLabel()}
        </button>
        {modelText !== null ? <span className="header-model">{modelText}</span> : null}
        {usage !== undefined && usage !== null ? (
          <span className="header-ctx">
            ctx{' '}
            <span className="gauge" aria-label={`Context ${percentLabel(usage.percent)}`}>
              {contextGauge(usage.percent)}
            </span>{' '}
            {percentLabel(usage.percent)}
          </span>
        ) : null}
        {cost !== null ? <span className="header-cost">{cost}</span> : null}
      </span>
    </header>
  )
}
