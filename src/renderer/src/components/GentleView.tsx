import { useCallback, useEffect, useRef, useState } from 'react'
import type { CommandChoice } from '../../../shared/ipc.ts'
import { FloatingWindow } from './FloatingWindow.tsx'
import { resolveGentleDestinations, type GentleDestination } from '../state/gentleMenu.ts'

/**
 * The Gentle window (gentle-desktop S17): the place a user goes to change how the agent
 * behaves — profiles, permission mode, subagents, providers — without meeting the engine's
 * command list first. The terminal reaches these through slash commands, which is fine when
 * the command names are already in your fingers; they are not, for this audience.
 *
 * Rows that map to an app window always appear. Rows that run an engine command appear only
 * when that command exists, so nothing here can press a button that does nothing.
 */
export function GentleView({
  onClose,
  onRunCommand,
  onOpenSubagents,
  onOpenProviders,
  onOpenCommands,
  onChooseFolder
}: {
  onClose: () => void
  /** Runs a command through the ordinary prompt path, as if it had been typed. */
  onRunCommand: (command: string) => void
  onOpenSubagents: () => void
  onOpenProviders: () => void
  onOpenCommands: () => void
  /** Opens the system folder picker so the user can move the agent elsewhere (S17). */
  onChooseFolder: () => void
}): React.JSX.Element {
  const [commands, setCommands] = useState<readonly CommandChoice[]>([])
  const [index, setIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    void window.gentle.session
      .commands()
      .then((next) => {
        if (!cancelled) setCommands(next)
      })
      .catch(() => {
        // Without the command list the app's own destinations still work; the engine
        // ones simply do not appear. An error here must not empty the window.
        if (!cancelled) setCommands([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const destinations = resolveGentleDestinations(commands)
  const activeIndex = Math.min(index, Math.max(destinations.length - 1, 0))

  const choose = useCallback(
    (destination: GentleDestination): void => {
      switch (destination.id) {
        case 'subagents':
          onOpenSubagents()
          break
        case 'providers':
          onOpenProviders()
          break
        case 'commands':
          onOpenCommands()
          break
        case 'folder':
          onChooseFolder()
          break
        default:
          if (destination.command !== null) onRunCommand(`/${destination.command}`)
      }
      onClose()
    },
    [onChooseFolder, onClose, onOpenCommands, onOpenProviders, onOpenSubagents, onRunCommand]
  )

  // There is nothing to type into here, and `autoFocus` on a plain container is not
  // dependable — the focus stays on the body and the arrow keys never arrive. The listener
  // therefore lives on the window for as long as this window is open, and the container is
  // still focused so the scroll and the screen reader land somewhere sensible.
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    containerRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      // A dialog from the engine can sit on top of this window; it owns the keyboard then.
      if (document.querySelector('.floating-panel-dialog') !== null) return

      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setIndex((current) => Math.min(current + 1, Math.max(destinations.length - 1, 0)))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setIndex((current) => Math.max(current - 1, 0))
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        const chosen = destinations[Math.min(activeIndex, Math.max(destinations.length - 1, 0))]
        if (chosen !== undefined) choose(chosen)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeIndex, destinations, choose])

  return (
    <FloatingWindow title="gentle" className="floating-panel-palette" onClose={onClose} hint="↑ ↓ choose · ⏎ open · esc close">
      <div ref={containerRef} tabIndex={0} style={{ outline: 'none' }}>
        <ul className="palette-list" role="listbox" aria-label="Gentle settings">
          {destinations.map((destination, position) => (
            <li key={destination.id}>
              <button
                type="button"
                role="option"
                aria-selected={position === activeIndex}
                className={`palette-row${position === activeIndex ? ' palette-row-active' : ''}`}
                onClick={() => choose(destination)}
                onMouseEnter={() => setIndex(position)}
              >
                <span className="palette-row-name">{destination.label}</span>
                <span className="palette-row-description">{destination.detail}</span>
                {destination.command !== null ? (
                  <span className="palette-row-source">/{destination.command}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </FloatingWindow>
  )
}
