import type {
  DialogRequest,
  ExtensionUiRequest,
  ExtensionUiResponse,
  PromptDisposition,
  RpcEvent,
  SessionState
} from './protocol'

/**
 * Channel names for the main↔renderer bridge. Commands use `invoke`, streams use `on`,
 * because the renderer must never hold a Node handle or a raw child process.
 */
export const IPC = {
  hostStatus: 'host:status',
  hostEvent: 'host:event',
  hostDialog: 'host:dialog',
  hostNotice: 'host:notice',
  hostGetStatus: 'host:get-status',
  hostRestart: 'host:restart',
  sessionPrompt: 'session:prompt',
  sessionAbort: 'session:abort',
  sessionNew: 'session:new',
  sessionState: 'session:get-state',
  sessionMessages: 'session:get-messages',
  sessionsList: 'sessions:list',
  sessionsSwitch: 'sessions:switch',
  dialogAnswer: 'dialog:answer'
} as const

export type HostPhase = 'starting' | 'ready' | 'restarting' | 'crashed' | 'stopped'

export interface HostStatus {
  phase: HostPhase
  /** Human-readable detail for the UI, always safe to display. */
  detail?: string
  piEntry?: string
  home?: string
  cwd?: string
  /** How many times supervision already restarted the engine. */
  restarts: number
}

/**
 * A session as the launcher sees it on disk. pi exposes no list-sessions RPC command, so
 * the main process derives this from pi's own session files.
 */
export interface SessionSummary {
  path: string
  id: string
  /** User-assigned name from the latest `session_info` entry, when present. */
  name: string | null
  /** First user message, trimmed for a list row. */
  preview: string | null
  cwd: string | null
  /** ISO timestamp of the session header. */
  timestamp: string | null
  messageCount: number
  sizeBytes: number
}

export interface PromptRequest {
  message: string
}

/** The surface exposed on `window.gentle`. Every entry is explicit and typed. */
export interface GentleApi {
  host: {
    status: () => Promise<HostStatus>
    restart: () => Promise<HostStatus>
    onStatus: (listener: (status: HostStatus) => void) => () => void
    onEvent: (listener: (event: RpcEvent) => void) => () => void
    onDialog: (listener: (request: DialogRequest) => void) => () => void
    onNotice: (listener: (request: ExtensionUiRequest) => void) => () => void
  }
  sessions: {
    list: () => Promise<SessionSummary[]>
    switchTo: (sessionPath: string) => Promise<void>
  }
  session: {
    prompt: (message: string) => Promise<PromptDisposition>
    abort: () => Promise<void>
    newSession: () => Promise<void>
    state: () => Promise<SessionState | null>
    messages: () => Promise<unknown[]>
    answerDialog: (response: ExtensionUiResponse) => void
  }
}
