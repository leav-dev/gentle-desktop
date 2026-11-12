import { useCallback, useEffect, useRef, useState } from 'react'
import type { SessionSummary } from '../../../shared/ipc.ts'
import { relativeTime } from '../state/format.ts'

function rowLabel(session: SessionSummary): string {
  if (session.name) return session.name
  if (session.preview) return session.preview
  if (session.id) return session.id.slice(0, 8)
  return 'Untitled session'
}

/**
 * The history picker (gentle-desktop S12): there is no permanent conversation
 * list. Saved conversations are reached through this overlay, opened on demand
 * with ⌘K / Ctrl+K or the header affordance, and navigated with the keyboard:
 * ↑ ↓ move, ⏎ opens, esc closes.
 */
export function HistoryPicker({
  currentPath,
  onSwitch,
  onClose
}: {
  currentPath: string | null
  onSwitch: (sessionPath: string) => void
  onClose: () => void
}): React.JSX.Element {
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [failed, setFailed] = useState(false)
  const [index, setIndex] = useState(0)
  const activeRowRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.gentle.sessions
      .list()
      .then((next) => {
        if (cancelled) return
        setSessions(next)
        setFailed(false)
        setIndex(0)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const choose = useCallback(
    (session: SessionSummary): void => {
      onSwitch(session.path)
      onClose()
    },
    [onSwitch, onClose]
  )

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setIndex((current) => Math.min(current + 1, Math.max(sessions.length - 1, 0)))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setIndex((current) => Math.max(current - 1, 0))
        return
      }
      if (event.key === 'Enter') {
        const chosen = sessions[index]
        if (chosen !== undefined) {
          event.preventDefault()
          choose(chosen)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [sessions, index, choose, onClose])

  return (
    <div className="picker-overlay" onClick={onClose}>
      <div
        className="picker-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Conversation history"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="picker-head">
          <span className="petal">✿</span>
          <b>history</b>
          <span className="picker-hint">↑ ↓ choose · ⏎ open · esc close</span>
        </div>
        {failed ? <p className="picker-empty">Could not read the conversation history.</p> : null}
        {!failed && sessions.length === 0 ? <p className="picker-empty">No saved conversations yet.</p> : null}
        {!failed && sessions.length > 0 ? (
          <ul className="picker-list" role="listbox" aria-label="Saved conversations">
            {sessions.map((session, position) => (
              <li key={session.path}>
                <button
                  type="button"
                  role="option"
                  aria-selected={position === index}
                  className={`picker-row${position === index ? ' picker-row-active' : ''}`}
                  ref={position === index ? activeRowRef : undefined}
                  onClick={() => choose(session)}
                  onMouseEnter={() => setIndex(position)}
                  title={session.cwd ?? undefined}
                >
                  <span className="picker-row-label">
                    {session.path === currentPath ? '▸ ' : ''}
                    {rowLabel(session)}
                  </span>
                  <span className="picker-row-meta">
                    {relativeTime(session.timestamp)}
                    {session.messageCount > 0 ? ` · ${session.messageCount} messages` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  )
}
