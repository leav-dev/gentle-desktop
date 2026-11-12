import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { AgentPermissionMode } from '../../../shared/ipc.ts'
import { historyKeyLabel } from '../state/format.ts'

/**
 * The petal prompt panel — the only place the ✿ appears. A rule above the field
 * carries the petal and the state label; the input is prefixed with `› `.
 * Enter sends, Shift+Enter inserts a newline, Escape aborts while streaming,
 * and the field stays disabled while the engine is not ready. Never a boxed
 * chat input with a send button as the primary affordance — the keyboard
 * contract leads; the small button only serves mouse users.
 */
const MODE_LABELS: Record<AgentPermissionMode, string | null> = {
  normal: null,
  auto: null,
  yolo: '🔥 YOLO',
  'super-yolo': '💥 SUPER-YOLO'
}

export function PromptPanel({
  disabled,
  streaming,
  mode,
  onSend,
  onAbort
}: {
  disabled: boolean
  streaming: boolean
  /** The agent's permission mode; only the unguarded ones are worth surfacing. */
  mode: AgentPermissionMode
  onSend: (message: string) => void
  onAbort: () => void
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const trimmed = draft.trim()
  const canSend = !disabled && trimmed.length > 0

  const stateLabel = disabled ? 'waiting for the engine' : streaming ? 'working…' : 'waiting for input'
  const modeLabel = MODE_LABELS[mode]

  function submit(): void {
    if (!canSend) return
    onSend(trimmed)
    setDraft('')
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      submit()
      return
    }
    if (event.key === 'Escape' && streaming) {
      event.preventDefault()
      onAbort()
    }
  }

  // Grow with the draft so Shift+Enter stays readable, without a scrollbar box.
  useEffect(() => {
    const element = inputRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${element.scrollHeight}px`
  }, [draft])

  return (
    <div className="prompt">
      <div className="prompt-rule">
        <span className="petal">✿</span>
        <span>{stateLabel}</span>
        {modeLabel ? <span className="mode-badge">{modeLabel}</span> : null}
        <span className="prompt-rule-right">{streaming ? 'esc · stop' : historyKeyLabel()}</span>
      </div>
      <div className="prompt-input">
        <span className="prompt-prefix" aria-hidden="true">
          ›
        </span>
        <textarea
          ref={inputRef}
          className="prompt-field"
          rows={1}
          value={draft}
          disabled={disabled}
          aria-label="Message the agent"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className={streaming ? 'prompt-stop' : 'prompt-send'}
          onClick={streaming ? onAbort : submit}
          disabled={streaming ? disabled : !canSend}
        >
          {streaming ? 'stop' : 'send'}
        </button>
      </div>
      <div className="prompt-hint">⏎ send · ⇧⏎ newline{streaming ? ' · esc stop' : ''}</div>
    </div>
  )
}
