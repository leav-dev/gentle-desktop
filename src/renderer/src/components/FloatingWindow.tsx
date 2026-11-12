import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'

/** The terminal card's tone per message kind (gentle-pi `shell-card.ts`). */
export type FloatingTone = 'info' | 'success' | 'warning' | 'error'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * The one floating-window chrome every overlay shares (gentle-desktop S14): a dimmed
 * backdrop, a centered rounded frame, a title rule with the tone the terminal gives
 * each message kind (info → accent, success/warning/error → their own color), and a
 * right-aligned hint slot on that rule.
 *
 * Behavior, not just looks: focus moves into the panel on open and returns to the
 * previously focused element on close, Tab is trapped inside while open, Escape closes,
 * and the backdrop click closes only when `dismissible` — a modal question must never
 * be dismissed by a stray click.
 */
export function FloatingWindow({
  title,
  hint,
  tone = 'info',
  dismissible = true,
  centered = false,
  label,
  className,
  onClose,
  children
}: {
  title: string
  /** Right-aligned hint on the title rule, e.g. the keys that drive the window. */
  hint?: string
  tone?: FloatingTone
  /** Whether clicking the backdrop closes the window. */
  dismissible?: boolean
  /** Centered in the viewport instead of top-anchored like a picker. */
  centered?: boolean
  /** Accessible name; defaults to the title. */
  label?: string
  /** Extra class on the panel, for a surface's width tweaks. */
  className?: string
  onClose: () => void
  children: ReactNode
}): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null)
  // The element to hand focus back to when the window goes away.
  const restoreFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    // A surface with an autoFocus control already moved focus in; only claim it
    // ourselves when nothing inside the panel is focused yet.
    if (panel !== null && !panel.contains(document.activeElement)) panel.focus()
    return () => {
      restoreFocusRef.current?.focus()
    }
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    // Trap Tab inside the frame: cycle at the ends instead of escaping to the page.
    const panel = panelRef.current
    if (panel === null) return
    const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
    if (focusables.length === 0) {
      event.preventDefault()
      panel.focus()
      return
    }
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (first === undefined || last === undefined) return
    const active = document.activeElement
    const inside = active instanceof HTMLElement && panel.contains(active)
    if (event.shiftKey) {
      if (!inside || active === first || active === panel) {
        event.preventDefault()
        last.focus()
      }
    } else if (!inside || active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return (
    <div
      className={`floating-overlay${centered ? ' floating-overlay-centered' : ''}`}
      role="presentation"
      onClick={dismissible ? onClose : undefined}
    >
      <div
        ref={panelRef}
        className={
          className !== undefined
            ? `floating-panel floating-tone-${tone} ${className}`
            : `floating-panel floating-tone-${tone}`
        }
        role="dialog"
        aria-modal="true"
        aria-label={label ?? title}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="floating-head">
          {/* No petal here: the petal marks the agent's prompt, not every dialog. */}
          <b className="floating-title">{title}</b>
          {hint !== undefined ? <span className="floating-hint">{hint}</span> : null}
        </div>
        {children}
      </div>
    </div>
  )
}
