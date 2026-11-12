import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { CommandChoice } from '../../../shared/ipc.ts'
import { FloatingWindow } from './FloatingWindow.tsx'
import { filterCommands } from '../state/commandFilter.ts'

/**
 * The command palette (gentle-desktop S13): every command the engine exposes over
 * `get_commands`, listed, filtered as the user types and executed with the same
 * effect as typing `/name` in the terminal. Keyboard-first: the filter input takes
 * focus on open, ↑ ↓ move, ⏎ runs, esc closes. Like the rail, a world with nothing
 * to show says so in one line instead of rendering an empty frame.
 */
export function CommandPalette({
  initialQuery = '',
  onClose,
  onRun
}: {
  /** Draft handed over by the `/` trigger, e.g. `/se` typed in the prompt. */
  initialQuery?: string
  onClose: () => void
  onRun: (command: string) => void
}): React.JSX.Element {
  const [commands, setCommands] = useState<CommandChoice[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [query, setQuery] = useState(initialQuery)
  const [index, setIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    void window.gentle.session
      .commands()
      .then((next) => {
        if (cancelled) return
        setCommands(next)
        setFailed(false)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = useMemo(() => filterCommands(commands ?? [], query), [commands, query])
  const activeIndex = Math.min(index, Math.max(filtered.length - 1, 0))

  useEffect(() => {
    // Loading the list or filtering can shrink it under the cursor.
    setIndex(activeIndex)
  }, [activeIndex])

  const run = useCallback(
    (command: CommandChoice): void => {
      onRun(`/${command.name}`)
      onClose()
    },
    [onRun, onClose]
  )

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIndex(Math.min(activeIndex + 1, Math.max(filtered.length - 1, 0)))
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setIndex(Math.max(activeIndex - 1, 0))
      return
    }
    if (event.key === 'Enter') {
      const chosen = filtered[activeIndex]
      if (chosen !== undefined) {
        event.preventDefault()
        run(chosen)
      }
    }
  }

  const hint = failed || commands === null || filtered.length === 0 ? undefined : '↑ ↓ choose · ⏎ run · esc close'

  return (
    <FloatingWindow
      title="commands"
      className="floating-panel-palette"
      onClose={onClose}
      {...(hint !== undefined ? { hint } : {})}
    >
      <input
        className="palette-input"
        type="text"
        value={query}
        placeholder="Type to filter commands"
        aria-label="Filter commands"
        autoFocus
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={handleKeyDown}
      />
      {failed ? <p className="palette-empty">Could not load the command list.</p> : null}
      {!failed && commands !== null && commands.length === 0 ? (
        <p className="palette-empty">This engine exposes no commands.</p>
      ) : null}
      {!failed && commands !== null && commands.length > 0 && filtered.length === 0 ? (
        <p className="palette-empty">No command matches that text.</p>
      ) : null}
      {!failed && filtered.length > 0 ? (
        <ul className="palette-list" role="listbox" aria-label="Commands">
          {filtered.map((command, position) => (
            <li key={command.name}>
              <button
                type="button"
                role="option"
                aria-selected={position === activeIndex}
                className={`palette-row${position === activeIndex ? ' palette-row-active' : ''}`}
                onClick={() => run(command)}
                onMouseEnter={() => setIndex(position)}
              >
                <span className="palette-row-name">/{command.name}</span>
                {command.description !== undefined ? (
                  <span className="palette-row-description">{command.description}</span>
                ) : null}
                {command.source !== undefined ? <span className="palette-row-source">{command.source}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </FloatingWindow>
  )
}
