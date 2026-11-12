import type { AuthPrompt } from '@earendil-works/pi-ai'
import type {
  DialogRequest,
  ExtensionUiRequest,
  ExtensionUiResponse,
  PromptDisposition,
  RpcEvent,
  SessionState
} from './protocol.ts'

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
  sessionSetModel: 'session:set-model',
  sessionStats: 'session:stats',
  sessionsList: 'sessions:list',
  sessionsSwitch: 'sessions:switch',
  repoStatus: 'repo:status',
  oddTasks: 'odd:tasks',
  dialogAnswer: 'dialog:answer',
  authProviders: 'auth:providers',
  authConfigured: 'auth:configured',
  authLogin: 'auth:login',
  authCancel: 'auth:cancel',
  authPrompt: 'auth:prompt',
  authEvent: 'auth:event',
  authAnswer: 'auth:answer'
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

/** Working-tree state of the session directory, as the terminal's changes widget shows it. */
export interface RepoStatus {
  /** Current branch, or null on a detached head or outside a repository. */
  branch: string | null
  dirtyCount: number
  added: number
  removed: number
  files: string[]
}

/** One `odd/tasks/*.md` feature: its checklist progress and its open items. */
export interface OddTaskFeature {
  feature: string
  done: number
  total: number
  open: string[]
}

/** Totals pi reports for one session; numbers only, unknown fields stay absent. */
export interface SessionUsageTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
}

export interface SessionContextUsage {
  tokens: number | null
  contextWindow: number
  percent: number | null
}

/** Passthrough of the engine's `get_session_stats` reply. */
export interface SessionStats {
  sessionId?: string
  sessionFile?: string
  totalMessages?: number
  userMessages?: number
  assistantMessages?: number
  toolCalls?: number
  tokens?: SessionUsageTotals
  cost?: SessionUsageTotals
  contextUsage?: SessionContextUsage | null
}

/** One model the running engine can actually use right now. */
export interface EngineModelRef {
  provider: string
  id: string
  name?: string
}

/**
 * A provider the setup window can offer, and how it can be registered.
 *
 * `ready` is what matters to a user: it means the engine already reports models for this
 * provider, so there is nothing to set up. A provider can be ready without any login flow —
 * gentle-pi contributes `nan` exactly that way — and hiding those would hide the provider
 * the user is already working with.
 */
export interface ProviderChoice {
  id: string
  name: string
  supportsOauth: boolean
  supportsApiKey: boolean
  apiKeyLabel?: string
  oauthLabel?: string
  configured: boolean
  ready: boolean
  /** Models the engine offers for this provider, ready to pass to `set_model`. */
  models: EngineModelRef[]
}

export type AuthMethod = 'oauth' | 'api_key'

export interface AuthLoginRequest {
  providerId: string
  type: AuthMethod
}

export type AuthLoginResult = { ok: true } | { ok: false; error: string; cancelled?: boolean }

/** One question pi needs answered while registering a provider. */
export interface AuthPromptRequest {
  requestId: string
  prompt: AuthPrompt
}

/** A progress event: a sign-in URL, a device code, or a status line. */
export interface AuthEventEnvelope {
  event: import('@earendil-works/pi-ai').AuthEvent
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
    setModel: (provider: string, modelId: string) => Promise<void>
    stats: () => Promise<SessionStats | null>
    answerDialog: (response: ExtensionUiResponse) => void
  }
  /** Session-directory data the engine does not expose over RPC. */
  repo: {
    status: () => Promise<RepoStatus>
  }
  odd: {
    tasks: () => Promise<OddTaskFeature[]>
  }
  auth: {
    providers: () => Promise<ProviderChoice[]>
    configured: (providerId: string) => Promise<boolean>
    login: (request: AuthLoginRequest) => Promise<AuthLoginResult>
    cancel: () => void
    answerPrompt: (requestId: string, value: string | null) => void
    onPrompt: (listener: (request: AuthPromptRequest) => void) => () => void
    onEvent: (listener: (envelope: AuthEventEnvelope) => void) => () => void
  }
}
