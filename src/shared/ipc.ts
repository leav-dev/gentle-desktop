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
  session: {
    prompt: (message: string) => Promise<PromptDisposition>
    abort: () => Promise<void>
    newSession: () => Promise<void>
    state: () => Promise<SessionState | null>
    messages: () => Promise<unknown[]>
    answerDialog: (response: ExtensionUiResponse) => void
  }
}
