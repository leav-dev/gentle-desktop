import { useCallback, useEffect, useReducer, useState } from 'react'
import type { DialogRequest, ExtensionUiRequest, RpcEvent, SessionState } from '../../../shared/protocol.ts'
import type { HostStatus } from '../../../shared/ipc.ts'
import {
  appendUserMessage,
  hydrateTranscript,
  initialTranscriptState,
  reduceTranscript,
  type TranscriptState
} from './transcript.ts'
import { buildDialogResponse, type DialogAnswer } from './dialogResponses.ts'

type TranscriptAction =
  | { kind: 'event'; event: RpcEvent }
  | { kind: 'user'; text: string }
  | { kind: 'reset' }
  | { kind: 'hydrate'; messages: readonly unknown[] }

/** Bridges the pure transcript reducer to useReducer's action shape. */
function transcriptReducer(state: TranscriptState, action: TranscriptAction): TranscriptState {
  switch (action.kind) {
    case 'event':
      return reduceTranscript(state, action.event)
    case 'user':
      return appendUserMessage(state, action.text)
    case 'reset':
      return initialTranscriptState()
    case 'hydrate':
      return hydrateTranscript(action.messages)
  }
}

export interface EngineView {
  status: HostStatus
  ready: boolean
  streaming: boolean
  transcript: TranscriptState
  sessionName: string | null
  model: unknown
  /** Dialog queue in arrival order; only the first is presented at a time. */
  dialogs: DialogRequest[]
  activeDialog: DialogRequest | null
  notice: ExtensionUiRequest | null
  send: (message: string) => void
  switchSession: (sessionPath: string) => void
  abort: () => void
  newSession: () => void
  answerDialog: (request: DialogRequest, answer: DialogAnswer) => void
}

/**
 * The renderer's single subscription point to the engine. Every subscription returns
 * its own unsubscribe and the effect cleans all of them up, so StrictMode's double
 * mount cannot leak listeners or duplicate transcript items.
 */
export function useEngine(): EngineView {
  const [status, setStatus] = useState<HostStatus>({ phase: 'starting', restarts: 0 })
  const [transcript, dispatch] = useReducer(transcriptReducer, undefined, initialTranscriptState)
  const [sessionState, setSessionState] = useState<SessionState | null>(null)
  const [dialogs, setDialogs] = useState<DialogRequest[]>([])
  const [notice, setNotice] = useState<ExtensionUiRequest | null>(null)

  useEffect(() => {
    const gentle = window.gentle
    const offStatus = gentle.host.onStatus(setStatus)
    const offEvent = gentle.host.onEvent((event: RpcEvent) => {
      if (event.type === 'session_info_changed') {
        const name = event.name ?? null
        setSessionState((prev) => (prev === null ? prev : { ...prev, sessionName: name }))
      }
      dispatch({ kind: 'event', event })
    })
    const offDialog = gentle.host.onDialog((request: DialogRequest) => {
      setDialogs((prev) => [...prev, request])
    })
    // Only user-visible notices reach the status bar; widget/title requests are TUI-surface.
    const offNotice = gentle.host.onNotice((request: ExtensionUiRequest) => {
      if (request.method === 'setStatus' || request.method === 'notify') setNotice(request)
    })

    let cancelled = false
    void gentle.host.status().then((initial) => {
      if (!cancelled) setStatus(initial)
    })
    void gentle.session.state().then((state) => {
      if (!cancelled) setSessionState(state)
    })

    return () => {
      cancelled = true
      offStatus()
      offEvent()
      offDialog()
      offNotice()
    }
  }, [])

  const send = useCallback((message: string) => {
    dispatch({ kind: 'user', text: message })
    // `prompt` resolves on acceptance; the turn itself streams in as events.
    void window.gentle.session.prompt(message).catch(() => {
      // The status bar already reflects a dead engine; nothing else to surface here.
    })
  }, [])

  const abort = useCallback(() => {
    void window.gentle.session.abort().catch(() => {})
  }, [])

  const loadHistory = useCallback(() => {
    void window.gentle.session
      .messages()
      .then((messages) => dispatch({ kind: 'hydrate', messages }))
      .catch(() => {
        // An unreadable history leaves the transcript empty; the session itself is fine.
      })
  }, [])

  const newSession = useCallback(() => {
    dispatch({ kind: 'reset' })
    void window.gentle.session
      .newSession()
      .then(() => window.gentle.session.state())
      .then((state) => setSessionState(state))
      .catch(() => {})
  }, [])

  // Reopening a saved conversation must show it, not an empty pane.
  const switchSession = useCallback(
    (sessionPath: string) => {
      dispatch({ kind: 'reset' })
      void window.gentle.sessions
        .switchTo(sessionPath)
        .then(() => window.gentle.session.state())
        .then((state) => {
          setSessionState(state)
          loadHistory()
        })
        .catch(() => {})
    },
    [loadHistory]
  )

  const answerDialog = useCallback((request: DialogRequest, answer: DialogAnswer) => {
    const response = buildDialogResponse(request, answer)
    setDialogs((prev) => prev.filter((dialog) => dialog.id !== request.id))
    window.gentle.session.answerDialog(response)
  }, [])

  return {
    status,
    ready: status.phase === 'ready',
    streaming: transcript.isStreaming,
    transcript,
    sessionName: sessionState?.sessionName ?? null,
    model: sessionState?.model,
    dialogs,
    activeDialog: dialogs.length > 0 ? (dialogs[0] ?? null) : null,
    notice,
    send,
    abort,
    newSession,
    switchSession,
    answerDialog
  }
}
