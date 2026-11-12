import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { DialogRequest, ExtensionUiRequest, RpcEvent, SessionState } from '../../../shared/protocol.ts'
import type {
  AgentPermissionMode,
  HostStatus,
  OddTaskFeature,
  RepoStatus,
  SessionStats
} from '../../../shared/ipc.ts'
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

/** One extension notification, rendered as a toast by the shell. */
export interface AgentNotice {
  id: number
  message: string
  tone: 'info' | 'warning' | 'error'
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
  /** The agent's permission mode; only unguarded modes are surfaced in the prompt. */
  permissionMode: AgentPermissionMode
  /** The latest extension notification, rendered as a toast. */
  notice: AgentNotice | null
  /** The latest extension status line, shown beside the prompt rule. */
  statusText: string | null
  send: (message: string) => void
  dismissNotice: () => void
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
  const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>('normal')
  const [activity, setActivity] = useState<AgentActivity>(emptyAgentActivity)
  const [oddTasks, setOddTasks] = useState<OddTaskFeature[]>([])
  const [repo, setRepo] = useState<RepoStatus | null>(null)
  const [stats, setStats] = useState<SessionStats | null>(null)
  const [notice, setNotice] = useState<AgentNotice | null>(null)
  const [statusText, setStatusText] = useState<string | null>(null)
  const notifySeq = useRef(0)

  const refreshShellData = useCallback((): void => {
    // The engine is not the source of these, so a rejected call keeps the last
    // known value instead of hiding real state mid-turn.
    void window.gentle.repo.status().then(setRepo).catch(() => {})
    void window.gentle.odd.tasks().then(setOddTasks).catch(() => {})
    void window.gentle.session.stats().then(setStats).catch(() => {})
    // The permission mode can change outside the app, so it is re-read with the rest.
    void window.gentle.agent.mode().then(setPermissionMode).catch(() => {})
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
    // Widget pushes feed the Helpers rail, `notify` becomes a toast and `setStatus` a quiet
    // segment on the prompt rule: with no status bar, an ignored notice would be a lost signal.
    const offNotice = gentle.host.onNotice((request: ExtensionUiRequest) => {
      if (request.method === 'setWidget' && request.widgetKey === ACTIVITY_WIDGET_KEY) {
        setActivity(parseAgentActivity(request.widgetLines?.[0] ?? null))
      } else if (request.method === 'notify') {
        notifySeq.current += 1
        setNotice({
          id: notifySeq.current,
          message: request.message,
          tone: request.notifyType ?? 'info'
        })
      } else if (request.method === 'setStatus') {
        setStatusText(request.statusText ?? null)
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
      // A dead engine shows up as a disabled prompt panel; nothing else to surface here.
    })
  }, [])

  const abort = useCallback(() => {
    void window.gentle.session.abort().catch(() => {})
  }, [])

  const dismissNotice = useCallback(() => setNotice(null), [])

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
    permissionMode,
    notice,
    statusText,
    dismissNotice,
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
    send,
    abort,
    newSession,
    switchSession,
    answerDialog
  }
}
