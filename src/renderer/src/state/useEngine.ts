import { useCallback, useEffect, useReducer, useState } from 'react'
import type { DialogRequest, ExtensionUiRequest, RpcEvent, SessionState } from '../../../shared/protocol.ts'
import type { HostStatus, OddTaskFeature, RepoStatus, SessionStats } from '../../../shared/ipc.ts'
import {
  appendUserMessage,
  hydrateTranscript,
  initialTranscriptState,
  reduceTranscript,
  type TranscriptState
} from './transcript.ts'
import { buildDialogResponse, type DialogAnswer } from './dialogResponses.ts'
import { ACTIVITY_WIDGET_KEY, emptyAgentActivity, parseAgentActivity, type AgentActivity } from './agentActivity.ts'

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
  /** Path of the session file on disk, when one is open. */
  sessionPath: string | null
  model: unknown
  thinkingLevel: string | null
  /** Live subagent activity pushed through `setWidget` (`gentle-agents.activity/v1`). */
  activity: AgentActivity
  /** ODD checklist features from `odd/tasks/*.md` in the session directory. */
  oddTasks: OddTaskFeature[]
  /** Working-tree state of the session directory. */
  repo: RepoStatus | null
  /** Cost, tokens and context usage for the current session. */
  stats: SessionStats | null
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
  const [activity, setActivity] = useState<AgentActivity>(emptyAgentActivity)
  const [oddTasks, setOddTasks] = useState<OddTaskFeature[]>([])
  const [repo, setRepo] = useState<RepoStatus | null>(null)
  const [stats, setStats] = useState<SessionStats | null>(null)

  const refreshShellData = useCallback((): void => {
    // The engine is not the source of these, so a rejected call keeps the last
    // known value instead of hiding real state mid-turn.
    void window.gentle.repo.status().then(setRepo).catch(() => {})
    void window.gentle.odd.tasks().then(setOddTasks).catch(() => {})
    void window.gentle.session.stats().then(setStats).catch(() => {})
  }, [])

  useEffect(() => {
    const gentle = window.gentle
    const offStatus = gentle.host.onStatus(setStatus)
    const offEvent = gentle.host.onEvent((event: RpcEvent) => {
      if (event.type === 'session_info_changed') {
        const name = event.name ?? null
        setSessionState((prev) => (prev === null ? prev : { ...prev, sessionName: name }))
      }
      // A settled turn is when the working tree, tokens and session stats move.
      if (event.type === 'agent_settled') refreshShellData()
      dispatch({ kind: 'event', event })
    })
    const offDialog = gentle.host.onDialog((request: DialogRequest) => {
      setDialogs((prev) => [...prev, request])
    })
    // Only user-visible notices reach the status bar; widget pushes feed the Helpers rail.
    const offNotice = gentle.host.onNotice((request: ExtensionUiRequest) => {
      if (request.method === 'setStatus' || request.method === 'notify') setNotice(request)
      else if (request.method === 'setWidget' && request.widgetKey === ACTIVITY_WIDGET_KEY) {
        setActivity(parseAgentActivity(request.widgetLines?.[0] ?? null))
      }
    })

    let cancelled = false
    void gentle.host.status().then((initial) => {
      if (!cancelled) setStatus(initial)
    })
    void gentle.session.state().then((state) => {
      if (!cancelled) setSessionState(state)
    })

    const onFocus = (): void => refreshShellData()
    window.addEventListener('focus', onFocus)

    return () => {
      cancelled = true
      offStatus()
      offEvent()
      offDialog()
      offNotice()
      window.removeEventListener('focus', onFocus)
    }
  }, [refreshShellData])

  // The shell data sources only exist once the engine is up.
  const ready = status.phase === 'ready'
  useEffect(() => {
    if (ready) refreshShellData()
  }, [ready, refreshShellData])

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
      .then((state) => {
        setSessionState(state)
        refreshShellData()
      })
      .catch(() => {})
  }, [refreshShellData])

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
          refreshShellData()
        })
        .catch(() => {})
    },
    [loadHistory, refreshShellData]
  )

  const answerDialog = useCallback((request: DialogRequest, answer: DialogAnswer) => {
    const response = buildDialogResponse(request, answer)
    setDialogs((prev) => prev.filter((dialog) => dialog.id !== request.id))
    window.gentle.session.answerDialog(response)
  }, [])

  return {
    status,
    ready,
    streaming: transcript.isStreaming,
    transcript,
    sessionName: sessionState?.sessionName ?? null,
    sessionPath: sessionState?.sessionFile ?? null,
    model: sessionState?.model,
    thinkingLevel: sessionState?.thinkingLevel ?? null,
    activity,
    oddTasks,
    repo,
    stats,
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
