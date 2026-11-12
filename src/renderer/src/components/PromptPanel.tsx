import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { AgentPermissionMode } from '../../../shared/ipc.ts'
import { commandKeyLabel, historyKeyLabel } from '../state/format.ts'
import { shouldOpenPalette } from '../state/commandFilter.ts'

/**
 * The petal prompt panel — the only place the ✿ appears. A rule above the field
 * carries the petal and the state label; the input is prefixed with `› `.
 * Enter sends, Shift+Enter inserts a newline, Escape aborts while streaming,
 * and the field stays disabled while the engine is not ready. Never a boxed
 * chat input with a send button as the primary affordance — the keyboard
 * contract leads; the small button only serves mouse users.
 */const MODE_LABELS: Record<AgentPermissionMode, string | null> = {
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
  onAbort,
  onSlashTrigger
}: {
  disabled: boolean
  streaming: boolean
  /** The agent's permission mode; only the unguarded ones are worth surfacing. */
  mode: AgentPermissionMode
  onSend: (message: string) => void
  onAbort: () => void
  /**
   * Fires when the first character typed into an empty prompt is `/`: the palette
   * takes the draft over and the prompt stays empty, so a slash can never end up
   * both in the palette filter and in the message.
   */
  onSlashTrigger?: (draft: string) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const trimmed = draft.trim()
  const canSend = !disabled && trimmed.length > 0

  const stateLabel = disabled ? 'waiting for the engine' : streaming ? 'working…' : 'waiting for input'
  const modeLabel = MODE_LABELS[mode]

  function handleChange(event: React.ChangeEvent<HTMLTextAreaElement>): void {
    const next = event.target.value
    // The trigger rule is pure and pinned in tests/commandFilter.test.mts.
    if (onSlashTrigger !== undefined && shouldOpenPalette(draft, next)) {
      onSlashTrigger(next)
      return
    }
    setDraft(next)
  }

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
        {/* The action row owns the accelerators; repeating one here is noise. */}
        <span className="prompt-rule-right">{streaming ? 'esc · stop' : ''}</span>
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
          onChange={handleChange}
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
      <div className="prompt-hint">
        {commandKeyLabel()} · ⏎ send · ⇧⏎ newline{streaming ? ' · esc stop' : ''}
      </div>
    </div>
  )
}
