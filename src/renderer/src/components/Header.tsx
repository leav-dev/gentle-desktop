import type { HostStatus, SessionStats } from '../../../shared/ipc.ts'
import { contextGauge, effortLabel, formatCost, historyKeyLabel, modelLabel, percentLabel } from '../state/format.ts'

/**
 * The top bar: brand, working directory, and on the right the history affordance,
 * the model with effort, the context gauge and the cost. Context usage and cost live
 * here and nowhere else — never repeated in the rail or the status bar.
 */
export function Header({
  status,
  model,
  thinkingLevel,
  stats,
  onOpenHistory
}: {
  status: HostStatus
  model: unknown
  thinkingLevel: string | null
  stats: SessionStats | null
  onOpenHistory: () => void
}): React.JSX.Element {
  const label = modelLabel(model)
  const level = effortLabel(thinkingLevel)
  const cost = formatCost(stats?.cost)
  const usage = stats?.contextUsage
  const modelText = label !== null && level !== null ? `${label} · ${level}` : label

  return (
    <header className="app-header">
      <span className="brand">
        ✿ <b>gentle desktop</b>
      </span>
      {status.cwd !== undefined && status.cwd.length > 0 ? <span className="header-path">{status.cwd}</span> : null}
      <span className="header-right">
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
