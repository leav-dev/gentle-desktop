import { useCallback, useEffect, useRef, useState } from 'react'
import { Composer } from './components/Composer.tsx'
import { DialogHost } from './components/DialogHost.tsx'
import { SessionList } from './components/SessionList.tsx'
import { SetupWizard } from './components/SetupWizard.tsx'
import { StatusBar } from './components/StatusBar.tsx'
import { Transcript } from './components/Transcript.tsx'
import { useEngine } from './state/useEngine.ts'

export function App(): React.JSX.Element {
  const engine = useEngine()

  // First-run gate: if no provider is configured yet, the setup window opens itself
  // once. The dismissal is remembered for this session only (a plain ref, not storage),
  // so the next launch offers onboarding again until a provider is connected.
  const [wizardOpen, setWizardOpen] = useState(false)
  const autoOpenDone = useRef(false)
  const dismissedThisSession = useRef(false)

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
        // A failed readiness check must not block the app; the status-bar entry
        // still opens the window manually.
      })
  }, [engine.ready])

  const closeWizard = useCallback(() => {
    dismissedThisSession.current = true
    setWizardOpen(false)
  }, [])

  const openWizard = useCallback(() => {
    setWizardOpen(true)
  }, [])
  return (
    <main className="app-frame">
      <aside className="app-sidebar" aria-label="Conversations">
        <button type="button" className="sidebar-new-session" onClick={engine.newSession}>
          New conversation
        </button>
        <SessionList streaming={engine.streaming} onSwitch={engine.switchSession} />
      </aside>
      <section className="app-conversation">
        <StatusBar
          status={engine.status}
          sessionName={engine.sessionName}
          model={engine.model}
          notice={engine.notice}
          onOpenSetup={openWizard}
        />
        <Transcript items={engine.transcript.items} />
        <Composer
          disabled={!engine.ready}
          streaming={engine.streaming}
          onSend={engine.send}
          onAbort={engine.abort}
        />
      </section>
      <DialogHost dialogs={engine.dialogs} onAnswer={engine.answerDialog} />
      {wizardOpen ? <SetupWizard onClose={closeWizard} /> : null}
    </main>
  )
}
