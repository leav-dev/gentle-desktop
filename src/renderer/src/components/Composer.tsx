import { useState, type KeyboardEvent } from 'react'

/**
 * The editor surface. Enter sends, Shift+Enter inserts a newline; sending is disabled
 * while the engine is not ready and abort replaces send while a turn is streaming.
 */
export function Composer({
  disabled,
  streaming,
  onSend,
  onAbort
}: {
  disabled: boolean
  streaming: boolean
  onSend: (message: string) => void
  onAbort: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const trimmed = draft.trim()
  const canSend = !disabled && trimmed.length > 0

  function submit(): void {
    if (!canSend) return
    onSend(trimmed)
    setDraft('')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="composer">
      <textarea
        className="composer-input"
        rows={3}
        value={draft}
        disabled={disabled}
        placeholder={
          disabled
            ? 'Waiting for the engine…'
            : 'Message the agent (Enter to send, Shift+Enter for a newline)'
        }
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      <div className="composer-actions">
        {streaming ? (
          <button type="button" className="composer-abort" onClick={onAbort}>
            Abort
          </button>
        ) : (
          <button type="button" className="composer-send" onClick={submit} disabled={!canSend}>
            Send
          </button>
        )}
      </div>
    </div>
  )
}
