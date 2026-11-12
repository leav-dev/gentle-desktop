import { Composer } from './components/Composer.tsx'
import { DialogHost } from './components/DialogHost.tsx'
import { StatusBar } from './components/StatusBar.tsx'
import { Transcript } from './components/Transcript.tsx'
import { useEngine } from './state/useEngine.ts'

export function App(): React.JSX.Element {
  const engine = useEngine()
  return (
    <main className="app-frame">
      <aside className="app-sidebar" aria-label="Sessions">
        {/* Session list and creation ship with the next slice (T4). */}
        <button type="button" className="sidebar-new-session" onClick={engine.newSession}>
          New session
        </button>
      </aside>
      <section className="app-conversation">
        <StatusBar
          status={engine.status}
          sessionName={engine.sessionName}
          model={engine.model}
          notice={engine.notice}
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
    </main>
  )
}
