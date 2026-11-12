import type { HostStatus, OddTaskFeature, RepoStatus } from '../../../shared/ipc.ts'
import type { AgentActivity } from '../state/agentActivity.ts'
import { effortLabel, historyKeyLabel, modelLabel } from '../state/format.ts'

function noticeText(notice: unknown): string | null {
  if (typeof notice !== 'object' || notice === null) return null
  const request = notice as { method?: unknown; statusText?: unknown; statusKey?: unknown; message?: unknown }
  if (request.method === 'setStatus') {
    return typeof request.statusText === 'string' ? request.statusText : String(request.statusKey ?? '')
  }
  if (request.method === 'notify') return typeof request.message === 'string' ? request.message : null
  return null
}

/**
 * One full-width status row. Segments are separated by `│` and ordered so the
 * least important sit at the right: when space runs out the stylesheet drops
 * them from the right first. Context usage and cost never appear here — they
 * live in the top bar only.
 */
export function StatusBar({
  status,
  model,
  thinkingLevel,
  repo,
  tasks,
  activity,
  notice,
  railCollapsed,
  onToggleRail,
  onOpenSetup
}: {
  status: HostStatus
  model: unknown
  thinkingLevel: string | null
  repo: RepoStatus | null
  tasks: readonly OddTaskFeature[]
  activity: AgentActivity
  notice: unknown
  railCollapsed: boolean
  onToggleRail: () => void
  onOpenSetup: () => void
}): React.JSX.Element {
  const label = modelLabel(model)
  const level = effortLabel(thinkingLevel)
  const dirty = repo?.dirtyCount ?? 0
  const openTasks = tasks.reduce((sum, feature) => sum + (feature.total - feature.done), 0)
  const totalTasks = tasks.reduce((sum, feature) => sum + feature.total, 0)
  const helpers = activity.counts.running + activity.counts.waiting
  const text = noticeText(notice) ?? status.detail ?? null

  const segments: React.JSX.Element[] = []
  let key = 0
  const push = (element: React.JSX.Element): void => {
    if (segments.length > 0) segments.push(<span key={`sep-${key++}`} className="sep">│</span>)
    segments.push(element)
  }

  if (status.phase !== 'ready') {
    push(
      <span key={`phase-${key++}`} className={`status-phase status-phase-${status.phase}`}>
        {status.phase}
      </span>
    )
  }
  if (status.restarts > 0) {
    push(
      <span key={`restarts-${key++}`}>
        {status.restarts} {status.restarts === 1 ? 'restart' : 'restarts'}
      </span>
    )
  }
  if (repo?.branch !== undefined && repo.branch !== null) {
    push(
      <span key={`branch-${key++}`} className="status-branch">
        <b>{repo.branch}</b>
        {dirty > 0 ? <span className="warn"> ±{dirty}</span> : null}
      </span>
    )
  }
  if (label !== null) {
    push(
      <span key={`model-${key++}`}>
        <b>{label}</b>
        {level !== null ? ` · ${level}` : ''}
      </span>
    )
  }
  if (totalTasks > 0 || helpers > 0) {
    push(
      <span key={`work-${key++}`} className="status-work">
        {totalTasks > 0 ? `${openTasks}/${totalTasks} tasks` : null}
        {totalTasks > 0 && helpers > 0 ? ' · ' : null}
        {helpers > 0 ? `${helpers} helpers` : null}
      </span>
    )
  }

  return (
    <footer className="status-bar">
      {segments}
      <span className="grow" />
      {text !== null && text.length > 0 ? <span className="status-notice">{text}</span> : null}      <span className="hint statusbar-hints">{historyKeyLabel()}</span>
      {railCollapsed ? (
        <button type="button" className="statusbar-toggle" onClick={onToggleRail}>
          rail
        </button>
      ) : null}
      <button type="button" className="statusbar-setup" onClick={onOpenSetup}>
        Providers
      </button>
    </footer>
  )
}
