import { useEffect } from 'react'
import type { AgentNotice } from '../state/useEngine.ts'

/** How long a toast stays before fading itself out. */
const AUTO_DISMISS_MS = 8000

/**
 * Extension notifications become toasts instead of status-bar text.
 *
 * With no status bar, ignoring `notify` would silently drop real signals (a failed
 * permission check, a quota warning). The toast is not modal: it must never steal focus
 * from the prompt, and it disappears on its own so a stale message cannot pile up.
 */
export function NoticeToast({
  notice,
  onDismiss
}: {
  notice: AgentNotice | null
  onDismiss: () => void
}): React.JSX.Element | null {
  useEffect(() => {
    if (notice === null) return
    const timer = setTimeout(onDismiss, AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [notice, onDismiss])

  if (notice === null) return null

  return (
    <div className={`notice-toast notice-toast-${notice.tone}`} role="status">
      <span className="notice-toast-text">{notice.message}</span>
      <button type="button" className="notice-toast-close" aria-label="Dismiss notification" onClick={onDismiss}>
        ×
      </button>
    </div>
  )
}
