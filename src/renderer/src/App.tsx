import { useCallback, useEffect, useRef, useState } from 'react'
import { CommandPalette } from './components/CommandPalette.tsx'
import { AgentsView } from './components/AgentsView.tsx'
import { DialogHost } from './components/DialogHost.tsx'
import { Header } from './components/Header.tsx'
import { NoticeToast } from './components/NoticeToast.tsx'
import { HistoryPicker } from './components/HistoryPicker.tsx'
import { PromptPanel } from './components/PromptPanel.tsx'
import { Rail } from './components/Rail.tsx'
import { SetupWizard } from './components/SetupWizard.tsx'
import { Transcript } from './components/Transcript.tsx'
import { useEngine } from './state/useEngine.ts'

/** The terminal folds its rail below this many columns of available width. */
const RAIL_BREAKPOINT_COLUMNS = 140

/**
 * Available width measured in `ch` columns, matching the terminal's
 * SIDEBAR_BREAKPOINT = 140. A hidden `0` glyph measures the chrome's monospace
 * column; the body's client width is divided by it.
 */
function useAvailableColumns(bodyRef: React.RefObject<HTMLDivElement | null>): number {
  const [columns, setColumns] = useState(Number.POSITIVE_INFINITY)
  useEffect(() => {
    const measure = (): void => {
      const body = bodyRef.current
      if (!body) return
      const probe = document.createElement('span')
      probe.textContent = '0'
      probe.style.position = 'absolute'
      probe.style.visibility = 'hidden'
      probe.style.whiteSpace = 'pre'
      probe.style.font = getComputedStyle(document.body).font
      document.body.appendChild(probe)
      const chWidth = probe.getBoundingClientRect().width
      probe.remove()
      if (chWidth > 0) setColumns(Math.floor(body.clientWidth / chWidth))
    }
    measure()
    const observer = new ResizeObserver(measure)
    if (bodyRef.current) observer.observe(bodyRef.current)
    return () => observer.disconnect()
  }, [bodyRef])
  return columns
}

export function App(): React.JSX.Element {
  const engine = useEngine()

  // First-run gate: if no provider is configured yet, the setup window opens itself
  // once. The dismissal is remembered for this session only (a plain ref, not storage),
  // so the next launch offers onboarding again until a provider is connected.
  const [agentsOpen, setAgentsOpen] = useState(false)
  const [wizardOpen, setWizardOpen] = useState(false)
  const autoOpenDone = useRef(false)
  const dismissedThisSession = useRef(false)

  // The history picker (S12), the command palette (S13) and the folded rail (S11)
  // are overlays, not layout. The seed is the draft the `/` trigger hands over.
  const [historyOpen, setHistoryOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteSeed, setPaletteSeed] = useState('')
  const [railOverlayOpen, setRailOverlayOpen] = useState(false)

  const bodyRef = useRef<HTMLDivElement | null>(null)
  const columns = useAvailableColumns(bodyRef)
  const railWide = columns >= RAIL_BREAKPOINT_COLUMNS

  useEffect(() => {
    if (!engine.ready || autoOpenDone.current) return
    autoOpenDone.current = true
    void window.gentle.auth
      .providers()
      .then((choices) => {
        if (!choices.some((choice) => choice.configured) && !dismissedThisSession.current) {
          setWizardOpen(true)
        }
      })
      .catch(() => {
        // A failed readiness check must not block the app; the header affordance
        // still opens the window manually.
      })
  }, [engine.ready])

  // ⌘K / Ctrl+K opens the picker, ⌘P / Ctrl+P the command palette, Alt+A the agents
  // overlay, ⌘, / Ctrl+, the setup window. Pressing an accelerator again closes its
  // overlay, and overlays never stack.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      const key = event.key.toLowerCase()

      // Alt+A must be handled before the modifier guard below: it is the terminal's
      // agents shortcut, and a user who reaches for it expects the same overlay here.
      if (event.altKey && !event.ctrlKey && !event.metaKey) {
        if (key === 'a') {
          event.preventDefault()
          setPaletteOpen(false)
          setHistoryOpen(false)
          setAgentsOpen((open) => !open)
        }
        return
      }

      if (!(event.metaKey || event.ctrlKey)) return

      if (key === ',') {
        event.preventDefault()
        setWizardOpen(true)
        return
      }

      if (key === 'k') {
        event.preventDefault()
        setPaletteOpen(false)
        setHistoryOpen((open) => !open)
      } else if (key === 'p') {
        event.preventDefault()
        setHistoryOpen(false)
        setPaletteSeed('')
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Folding the rail while the window widens must not leave a stale overlay.
  useEffect(() => {
    if (railWide) setRailOverlayOpen(false)
  }, [railWide])

  const closeWizard = useCallback(() => {
    dismissedThisSession.current = true
    setWizardOpen(false)
  }, [])

  const openWizard = useCallback(() => {
    setWizardOpen(true)
  }, [])

  const openHistory = useCallback(() => setHistoryOpen(true), [])

  const openPalette = useCallback(() => {
    setHistoryOpen(false)
    setPaletteSeed('')
    setPaletteOpen(true)
  }, [])
  const closeHistory = useCallback(() => setHistoryOpen(false), [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])

  // The `/` trigger: the prompt hands its draft over and stays empty, so the text
  // the user typed continues in the palette's filter, never in the message.
  const openPaletteFromSlash = useCallback((draft: string) => {
    setHistoryOpen(false)
    setPaletteSeed(draft)
    setPaletteOpen(true)
  }, [])

  // Running a command goes through the ordinary prompt path, so the turn starts
  // exactly as if the user had typed `/<name>` themselves.
  const runCommand = useCallback(
    (command: string) => {
      engine.send(command)
    },
    [engine]
  )

  const switchSession = useCallback(
    (sessionPath: string) => {
      engine.switchSession(sessionPath)
    },
    [engine]
  )

  return (
    <div className="app-shell">
      <Header
        status={engine.status}
        model={engine.model}
        thinkingLevel={engine.thinkingLevel}
        stats={engine.stats}
        repo={engine.repo}
        railCollapsed={!railWide}
        onNewSession={engine.newSession}
        onOpenCommands={openPalette}
        onOpenAgents={() => setAgentsOpen((open) => !open)}
        onToggleRail={() => setRailOverlayOpen((open) => !open)}
        onOpenSetup={openWizard}
        onOpenHistory={openHistory}
      />
      <div className={`app-body${railWide ? '' : ' app-body-rail-hidden'}`} ref={bodyRef}>
        <section className="app-conversation">
          <Transcript items={engine.transcript.items} />
          <NoticeToast notice={engine.notice} onDismiss={engine.dismissNotice} />
          <PromptPanel
            disabled={!engine.ready}
            streaming={engine.streaming}
            mode={engine.permissionMode}
            statusText={engine.statusText}
            onSend={engine.send}
            onAbort={engine.abort}
            onSlashTrigger={openPaletteFromSlash}
          />
        </section>
        {railWide ? (
          <Rail tasks={engine.oddTasks} activity={engine.activity} repo={engine.repo} sessionName={engine.sessionName} />
        ) : railOverlayOpen ? (
          <div className="rail-overlay">
            <Rail
              tasks={engine.oddTasks}
              activity={engine.activity}
              repo={engine.repo}
              sessionName={engine.sessionName}
            />
          </div>
        ) : null}
      </div>
      <DialogHost dialogs={engine.dialogs} onAnswer={engine.answerDialog} />
      {historyOpen ? (
        <HistoryPicker currentPath={engine.sessionPath} onSwitch={switchSession} onClose={closeHistory} />
      ) : null}
      {paletteOpen ? (
        <CommandPalette initialQuery={paletteSeed} onClose={closePalette} onRun={runCommand} />
      ) : null}
      {agentsOpen ? <AgentsView activity={engine.activity} onClose={() => setAgentsOpen(false)} /> : null}
      {wizardOpen ? <SetupWizard onClose={closeWizard} /> : null}
    </div>
  )
}
