import type { OddTaskFeature, RepoStatus } from '../../../shared/ipc.ts'
import type { AgentActivity } from '../state/agentActivity.ts'
import { visibleRailSections } from '../state/railSections.ts'

/** Open tasks shown per feature before the row folds into "N more". */
const MAX_OPEN_TASK_ROWS = 4
const MAX_HELPER_ROWS = 8

function statusGlyph(status: string): string {
  switch (status) {
    case 'running':
      return '◐'
    case 'waiting':
      return '?'
    case 'queued':
      return '○'
    case 'finished':
      return '✓'
    case 'error':
      return '✗'
    default:
      return '○'
  }
}

function statusClass(status: string): string {
  switch (status) {
    case 'running':
      return 'run'
    case 'waiting':
      return 'warn'
    case 'finished':
      return 'ok'
    case 'error':
      return 'bad'
    default:
      return ''
  }
}

function countsSummary(activity: AgentActivity): string {
  const { running, queued, waiting, finished } = activity.counts
  const parts: string[] = []
  if (running > 0) parts.push(`${running} running`)
  if (waiting > 0) parts.push(`${waiting} waiting`)
  if (queued > 0) parts.push(`${queued} queued`)
  if (finished > 0) parts.push(`${finished} finished`)
  return parts.join(' · ')
}

function TasksSection({ tasks }: { tasks: readonly OddTaskFeature[] }): React.JSX.Element {
  const done = tasks.reduce((sum, feature) => sum + feature.done, 0)
  const total = tasks.reduce((sum, feature) => sum + feature.total, 0)
  return (
    <section>
      <h2>
        <b>▾ Tasks</b>
        <span className="count">
          {done}/{total}
        </span>
      </h2>
      {tasks.map((feature) => (
        <div key={feature.feature} className="rail-group">
          <p className="rail-feature">
            <span className="task">{feature.feature}</span>
            <span className="meta">
              {feature.done}/{feature.total}
            </span>
          </p>
          {feature.open.slice(0, MAX_OPEN_TASK_ROWS).map((task) => (
            <p key={task}>
              <span className="task">
                <span className="run">○</span> {task}
              </span>
            </p>
          ))}
          {feature.open.length > MAX_OPEN_TASK_ROWS ? (
            <p className="fold">{feature.open.length - MAX_OPEN_TASK_ROWS} more open</p>
          ) : null}
        </div>
      ))}
    </section>
  )
}

function HelpersSection({ activity }: { activity: AgentActivity }): React.JSX.Element {
  const summary = countsSummary(activity)
  return (
    <section>
      <h2>
        <b>▾ Helpers</b>
        {summary.length > 0 ? <span className="count">{summary}</span> : null}
      </h2>
      {activity.tasks.slice(0, MAX_HELPER_ROWS).map((task, index) => (
        <p key={`${task.label}-${index}`}>
          <span className="task">
            <span className={statusClass(task.status)}>{statusGlyph(task.status)}</span>{' '}
            {task.label.length > 0 ? task.label : task.agent}
          </span>
          {task.lastStep.length > 0 ? <span className="meta">{task.lastStep}</span> : null}
        </p>
      ))}
    </section>
  )
}

function SessionSection({
  repo,
  sessionName
}: {
  repo: RepoStatus | null
  sessionName: string | null
}): React.JSX.Element {
  const dirty = repo !== null && repo.dirtyCount > 0
  return (
    <section>
      <h2>
        <b>▾ Session</b>
        {sessionName !== null && sessionName.length > 0 ? <span>{sessionName}</span> : null}
      </h2>
      {dirty && repo !== null ? (
        <p>
          <span className="task">
            <span className="edit">✎</span> {repo.files.length} {repo.files.length === 1 ? 'file' : 'files'} ·{' '}
            <span className="add">+{repo.added}</span> <span className="del">−{repo.removed}</span>
          </span>
        </p>
      ) : null}
      {dirty && repo !== null ? <p className="fold">{repo.files.join(' · ')}</p> : null}
    </section>
  )
}

/**
 * The rail: a preset set of sections in fixed order, each with a `▾ NAME` header.
 * A section with nothing to show is not rendered at all — the visibility rule
 * lives in `railSections.ts` and is pinned by the contract tests.
 */
export function Rail({
  tasks,
  activity,
  repo,
  sessionName
}: {
  tasks: readonly OddTaskFeature[]
  activity: AgentActivity
  repo: RepoStatus | null
  sessionName: string | null
}): React.JSX.Element {
  const sections = visibleRailSections({ tasks, activity, repo, sessionName })
  return (
    <aside className="rail" aria-label="Session rail">
      {sections.includes('tasks') ? <TasksSection tasks={tasks} /> : null}
      {sections.includes('helpers') ? <HelpersSection activity={activity} /> : null}
      {sections.includes('session') ? <SessionSection repo={repo} sessionName={sessionName} /> : null}
    </aside>
  )
}
