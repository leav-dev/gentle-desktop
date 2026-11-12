import type { HostStatus } from '../../../shared/ipc.ts'
import type { ExtensionUiRequest } from '../../../shared/protocol.ts'

/** The engine reports the model as opaque JSON; narrow defensively for display. */
export function modelLabel(model: unknown): string | null {
  if (typeof model === 'string') return model
  if (typeof model !== 'object' || model === null) return null
  const record = model as Record<string, unknown>
  const id = record['modelId'] ?? record['id']
  if (typeof id !== 'string') return null
  const provider = record['provider']
  return typeof provider === 'string' ? `${provider}/${id}` : id
}

function noticeText(notice: ExtensionUiRequest | null): string | null {
  if (notice === null) return null
  if (notice.method === 'setStatus') return notice.statusText ?? notice.statusKey
  if (notice.method === 'notify') return notice.message
  return null
}

export function StatusBar({
  status,
  sessionName,
  model,
  notice,
  onOpenSetup
}: {
  status: HostStatus
  sessionName: string | null
  model: unknown
  notice: ExtensionUiRequest | null
  /** Persistent entry point to the provider setup window. */
  onOpenSetup: () => void
}): React.JSX.Element {
  const label = modelLabel(model)
  const text = noticeText(notice) ?? status.detail
  return (
    <header className="status-bar">
      <span className={`status-phase status-phase-${status.phase}`}>{status.phase}</span>
      {sessionName !== null ? <span className="status-session">{sessionName}</span> : null}
      {label !== null ? <span className="status-model">{label}</span> : null}
      {status.restarts > 0 ? <span className="status-restarts">{status.restarts} restarts</span> : null}
      {text !== undefined && text.length > 0 ? <span className="status-notice">{text}</span> : null}
      <button type="button" className="status-bar-setup" onClick={onOpenSetup}>
        Providers
      </button>
    </header>
  )
}
