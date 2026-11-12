import type { AgentActivity, AgentActivityTask } from '../state/agentActivity.ts'
import { FloatingWindow } from './FloatingWindow.tsx'
import './AgentsView.css'

/**
 * The subagent view, opened with Alt+A like the terminal's agent overlay.
 *
 * It reads the activity the engine already pushes through `setWidget`, so it shows the
 * same truth the rail's Helpers section does — this is the full-sized view of it, not a
 * second source. The rail is for glancing; this is for reading what each helper is doing.
 */

const STATUS_GLYPHS: Record<string, string> = {
  queued: '○',
  running: '◐',
  waiting: '?',
  finished: '✓',
  failed: '✗',
  cancelled: '–'
}

function glyph(status: string): string {
  return STATUS_GLYPHS[status] ?? '·'
}

function Row({ task }: { task: AgentActivityTask }): React.JSX.Element {
  return (
    <li className={`agents-row agents-row-${task.status}`}>
      <span className="agents-glyph" aria-hidden="true">
        {glyph(task.status)}
      </span>
      <span className="agents-label">{task.label}</span>
      <span className="agents-kind">{task.agent}</span>
      <span className="agents-step">{task.lastStep}</span>
    </li>
  )
}

export function AgentsView({
  activity,
  onClose
}: {
  activity: AgentActivity
  onClose: () => void
}): React.JSX.Element {
  const { counts, tasks } = activity
  const summary = [
    counts.running > 0 ? `${counts.running} running` : null,
    counts.waiting > 0 ? `${counts.waiting} waiting` : null,
    counts.queued > 0 ? `${counts.queued} queued` : null,
    counts.finished > 0 ? `${counts.finished} done` : null
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')

  return (
    <FloatingWindow title="Agents" hint={summary.length > 0 ? summary : 'alt+a'} onClose={onClose}>
      {tasks.length === 0 ? (
        <p className="agents-empty">No subagents in this session.</p>
      ) : (
        <ul className="agents-list">
          {tasks.map((task, index) => (
            <Row key={`${task.agent}-${task.label}-${index}`} task={task} />
          ))}
        </ul>
      )}
    </FloatingWindow>
  )
}
