import type {
  AgentPermissionMode,
  HostStatus,
  OddTaskFeature,
  RepoStatus,
  SessionStats
} from '../../../shared/ipc.ts'
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

const PHASE_LABELS: Record<HostStatus['phase'], string> = {
  ready: 'ready',
  starting: 'starting…',
  restarting: 'reconnecting…',
  crashed: 'stopped',
  stopped: 'stopped'
}

const MODE_LABELS: Record<AgentPermissionMode, string> = {
  normal: 'guarded',
  auto: 'auto',
  yolo: 'yolo',
  'super-yolo': 'super-yolo'
}

/**
 * The rail's permanent section: engine health, what the agent is allowed to do, which
 * session this is, and the working tree. Always drawn — an absent Status section would
 * leave the user without an answer to questions that always have one.
 */
function StatusSection({
  phase,
  restarts,
  permissionMode,
  stats,
  repo,
  sessionName,
  integrations,
  profiles
}: {
  phase: HostStatus['phase']
  restarts: number
  permissionMode: AgentPermissionMode
  stats: SessionStats | null
  repo: RepoStatus | null
  sessionName: string | null
  integrations: readonly { key: string; text: string }[]
  profiles: readonly { name: string; agents: number }[]
}): React.JSX.Element {
  const dirty = repo !== null && repo.dirtyCount > 0
  const healthy = phase === 'ready'
  const messages = typeof stats?.totalMessages === 'number' ? stats.totalMessages : null
  const identity = sessionName !== null && sessionName.length > 0 ? sessionName : 'untitled session'

  return (
    <section className="rail-status">
      <h2>
        <b>▾ Status</b>
        <span className={healthy ? 'ok' : 'bad'}>{PHASE_LABELS[phase]}</span>
      </h2>
      <p>
        <span className="task">
          <span className={healthy ? 'ok' : 'bad'}>{healthy ? '✿' : '✗'}</span> engine{' '}
          {PHASE_LABELS[phase]}
        </span>
        {restarts > 0 ? <span className="meta">{restarts} restarts</span> : null}
      </p>
      <p>
        <span className="task">permission {MODE_LABELS[permissionMode]}</span>
      </p>
      <p>
        <span className="task">{identity}</span>
        {messages !== null ? <span className="meta">{messages} msgs</span> : null}
      </p>
      {dirty && repo !== null ? (
        <p>
          <span className="task">
            <span className="edit">✎</span> {repo.files.length} {repo.files.length === 1 ? 'file' : 'files'} ·{' '}
            <span className="add">+{repo.added}</span> <span className="del">−{repo.removed}</span>
          </span>
        </p>
      ) : null}
      {/* Integrations and Profiles are groups of the session's state, not sections of their
          own: they answer "what else is attached to this session" once the basics are read. */}
      {integrations.length > 0 ? (
        <>
          <p className="rail-subhead">Integrations</p>
          {integrations.map((entry) => (
            <p key={entry.key}>
              <span className="task">{entry.text}</span>
            </p>
          ))}
        </>
      ) : null}
      {profiles.length > 0 ? (
        <>
          <p className="rail-subhead">Profiles</p>
          {profiles.map((profile) => (
            <p key={profile.name}>
              <span className="task">{profile.name}</span>
              <span className="meta">{profile.agents} agents</span>
            </p>
          ))}
          <p className="fold">and more: /gentle:profiles</p>
        </>
      ) : null}
      {/* Only the count: a list of paths is noise in a status panel. */}
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
  integrations,
  profiles,
  status,
  permissionMode,
  stats,
  repo,
  sessionName
}: {
  tasks: readonly OddTaskFeature[]
  activity: AgentActivity
  integrations: readonly { key: string; text: string }[]
  profiles: readonly { name: string; agents: number }[]
  status: HostStatus
  permissionMode: AgentPermissionMode
  stats: SessionStats | null
  repo: RepoStatus | null
  sessionName: string | null
}): React.JSX.Element {
  const sections = visibleRailSections({ tasks, activity, repo, sessionName, integrations, profiles })
  return (
    <aside className="rail" aria-label="Session rail">
      {sections.includes('status') ? (
        <StatusSection
          phase={status.phase}
          restarts={status.restarts}
          permissionMode={permissionMode}
          stats={stats}
          repo={repo}
          sessionName={sessionName}
          integrations={integrations}
          profiles={profiles}
        />
      ) : null}
      {sections.includes('tasks') ? <TasksSection tasks={tasks} /> : null}
      {sections.includes('helpers') ? <HelpersSection activity={activity} /> : null}
    </aside>
  )
}
