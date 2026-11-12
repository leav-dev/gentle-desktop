import type {
  ActiveProfile,
  AgentPermissionMode,
  HostStatus,
  OddTaskFeature,
  RepoStatus,
  SessionStats
} from '../../../shared/ipc.ts'
import { visibleIntegrations, visibleRailSections } from '../state/railSections.ts'

/** Open tasks shown per feature before the row folds into "N more". */
const MAX_OPEN_TASK_ROWS = 4

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
  activeProfile
}: {
  phase: HostStatus['phase']
  restarts: number
  permissionMode: AgentPermissionMode
  stats: SessionStats | null
  repo: RepoStatus | null
  sessionName: string | null
  integrations: readonly { key: string; text: string }[]
  activeProfile: ActiveProfile | null
}): React.JSX.Element {
  const dirty = repo !== null && repo.dirtyCount > 0
  const healthy = phase === 'ready'
  const messages = typeof stats?.totalMessages === 'number' ? stats.totalMessages : null
  const identity = sessionName !== null && sessionName.length > 0 ? sessionName : 'untitled session'
  // Retired from the view, not from the session: the entry still arrives, it is not drawn.
  const integrationsShown = visibleIntegrations(integrations)

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
      {integrationsShown.length > 0 ? (
        <>
          <p className="rail-subhead">Integrations</p>
          {integrationsShown.map((entry) => (
            <p key={entry.key}>
              <span className="task">{entry.text}</span>
            </p>
          ))}
        </>
      ) : null}
      {/* Only the active profile, and only its name: the list of profiles the session is
          not using belongs to the command that switches them. */}
      {activeProfile !== null ? (
        <>
          <p className="rail-subhead">Profile</p>
          <p>
            <span className="task">{activeProfile.name}</span>
          </p>
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
  integrations,
  activeProfile,
  status,
  permissionMode,
  stats,
  repo,
  sessionName
}: {
  tasks: readonly OddTaskFeature[]
  integrations: readonly { key: string; text: string }[]
  activeProfile: ActiveProfile | null
  status: HostStatus
  permissionMode: AgentPermissionMode
  stats: SessionStats | null
  repo: RepoStatus | null
  sessionName: string | null
}): React.JSX.Element {
  const sections = visibleRailSections({ tasks, repo, sessionName })
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
          activeProfile={activeProfile}
        />
      ) : null}
      {sections.includes('tasks') ? <TasksSection tasks={tasks} /> : null}
    </aside>
  )
}
