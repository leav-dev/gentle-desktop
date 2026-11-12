import { useCallback, useEffect, useState } from 'react'
import type { SessionSummary } from '../../../shared/ipc.ts'

interface SessionListProps {
  /** Reload when a turn finishes, so a just-written session shows up. */
  streaming: boolean
  onSwitch: (sessionPath: string) => void
}

function relativeTime(timestamp: string | null): string {
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

function label(session: SessionSummary): string {
  if (session.name) return session.name
  if (session.preview) return session.preview
  if (session.id) return session.id.slice(0, 8)
  return 'Untitled session'
}

/**
 * Sessions come from disk, so the list is a snapshot: it reloads when a turn settles and
 * when the window regains focus, which is when the underlying files can have changed.
 */
export function SessionList({ streaming, onSwitch }: SessionListProps): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [failed, setFailed] = useState(false)
  const [wasStreaming, setWasStreaming] = useState(streaming)

  const reload = useCallback(() => {
    void window.gentle.sessions
      .list()
      .then((next) => {
        setSessions(next)
        setFailed(false)
      })
      .catch(() => setFailed(true))
  }, [])

  useEffect(() => {
    reload()
  }, [reload])

  // A finished turn is the moment a new session file may exist or change.
  useEffect(() => {
    if (wasStreaming && !streaming) reload()
    setWasStreaming(streaming)
  }, [streaming, wasStreaming, reload])

  useEffect(() => {
    const onFocus = (): void => reload()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reload])

  if (failed) {
    return (
      <p className="sidebar-empty">
        Could not read the session history. The app still works; the list refreshes on the next turn.
      </p>
    )
  }

  if (sessions.length === 0) {
    return <p className="sidebar-empty">No saved conversations yet.</p>
  }

  return (
    <ul className="session-list">
      {sessions.map((session) => (
        <li key={session.path}>
          <button
            type="button"
            className="session-row"
            onClick={() => onSwitch(session.path)}
            title={session.cwd ?? undefined}
          >
            <span className="session-row-label">{label(session)}</span>
            <span className="session-row-meta">
              {relativeTime(session.timestamp)}
              {session.messageCount > 0 ? ` · ${session.messageCount} messages` : ''}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
