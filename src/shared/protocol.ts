/**
 * Wire types for pi's RPC mode (`pi --mode rpc`).
 *
 * Transport is strict newline-delimited JSON over the child's stdout: every record is
 * one JSON object terminated by LF. Splitting must happen on LF only — Node's
 * `readline` also splits on U+2028/U+2029 and corrupts message payloads.
 *
 * Three record families share the stream:
 *   - `response`               reply to a client command, correlated by `id`
 *   - `extension_ui_request`   dialog or host notification originated by an extension
 *   - anything else            a session event
 */

export interface PromptImage {
  type: 'image'
  /** base64, no data: prefix. */
  data: string
  mimeType: string
}

export type StreamingBehavior = 'steer' | 'followUp'

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export type QueueMode = 'all' | 'one-at-a-time'

export type RpcCommand =
  | { type: 'prompt'; message: string; images?: PromptImage[]; streamingBehavior?: StreamingBehavior }
  | { type: 'steer'; message: string; images?: PromptImage[] }
  | { type: 'follow_up'; message: string; images?: PromptImage[] }
  | { type: 'abort' }
  | { type: 'clear_queue' }
  | { type: 'new_session'; parentSession?: string }
  | { type: 'switch_session'; sessionPath: string }
  | { type: 'get_state' }
  | { type: 'get_messages' }
  | { type: 'get_entries'; since?: string }
  | { type: 'get_commands' }
  | { type: 'get_last_assistant_text' }
  | { type: 'set_session_name'; name: string }
  | { type: 'set_model'; provider: string; modelId: string }
  | { type: 'get_available_models' }
  | { type: 'set_thinking_level'; level: ThinkingLevel }
  | { type: 'set_steering_mode'; mode: QueueMode }
  | { type: 'set_follow_up_mode'; mode: QueueMode }
  | { type: 'compact'; customInstructions?: string }
  | { type: 'set_auto_compaction'; enabled: boolean }
  | { type: 'set_auto_retry'; enabled: boolean }
  | { type: 'get_session_stats' }

/** A reply to one client command. `command: "parse"` failures carry no id. */
export interface RpcResponse {
  type: 'response'
  id?: string
  command: string
  success: boolean
  data?: unknown
  error?: string
}

/**
 * `prompt` resolves as soon as the message is accepted, not when the turn finishes:
 * `started` means the agent is running, `queued` means it waits behind a running turn,
 * and `handled` means a command or extension consumed it without starting a turn.
 */
export type PromptDisposition = 'started' | 'queued' | 'handled'

export interface SessionState {
  model?: unknown
  thinkingLevel?: ThinkingLevel
  isStreaming?: boolean
  isCompacting?: boolean
  steeringMode?: QueueMode
  followUpMode?: QueueMode
  sessionFile?: string | null
  sessionId?: string
  sessionName?: string | null
  autoCompactionEnabled?: boolean
  messageCount?: number
  pendingMessageCount?: number
}

export interface ToolCallBlock {
  id?: string
  name?: string
  arguments?: unknown
}

/**
 * Delta-only streaming events. Cumulative partials are not sent over the wire, so the
 * UI accumulates `text_delta` and reconciles on `text_end` / `toolcall_end` / `message_end`.
 */
export type AssistantMessageEvent =
  | { type: 'start' }
  | { type: 'text_start'; contentIndex: number }
  | { type: 'text_delta'; contentIndex: number; delta: string }
  | { type: 'text_end'; contentIndex: number; content: string }
  | { type: 'thinking_start'; contentIndex: number }
  | { type: 'thinking_delta'; contentIndex: number; delta: string }
  | { type: 'thinking_end'; contentIndex: number; content: string }
  | { type: 'toolcall_start'; contentIndex: number; id: string; toolName: string }
  | { type: 'toolcall_delta'; contentIndex: number; delta: string }
  | { type: 'toolcall_end'; contentIndex: number; toolCall: ToolCallBlock }
  | { type: 'done' }
  | { type: 'error'; error?: unknown }

export type RpcEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end'; messages?: unknown[]; willRetry?: boolean }
  | { type: 'agent_settled'; aborted?: boolean }
  | { type: 'turn_start' }
  | { type: 'turn_end'; message?: unknown; toolResults?: unknown[] }
  | { type: 'message_start'; message?: unknown }
  | { type: 'message_end'; message?: unknown }
  | { type: 'message_update'; usage?: unknown; assistantMessageEvent: AssistantMessageEvent }
  | { type: 'tool_execution_start'; toolCallId: string; toolName: string; args?: unknown }
  | {
      type: 'tool_execution_update'
      toolCallId: string
      toolName: string
      partialResult?: unknown
    }
  | {
      type: 'tool_execution_end'
      toolCallId: string
      toolName: string
      result?: unknown
      isError?: boolean
      durationMs?: number
    }
  | { type: 'queue_update'; steering?: string[]; followUp?: string[] }
  | { type: 'entry_appended'; entry?: unknown }
  | { type: 'session_info_changed'; name?: string | null }
  | { type: 'thinking_level_changed'; level: ThinkingLevel }
  | { type: 'compaction_start'; reason?: string }
  | { type: 'compaction_end'; reason?: string; result?: unknown; aborted?: boolean }
  | { type: 'auto_retry_start'; attempt?: number; error?: unknown }
  | { type: 'auto_retry_end'; success?: boolean; attempt?: number }
  | { type: 'extension_error'; extensionPath?: string; event?: string; error?: unknown }

/** Anything the protocol sends that this host does not model yet. */
export interface RpcUnknownEvent {
  type: string
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Extension dialog subprotocol
// ---------------------------------------------------------------------------

/**
 * pi asks the host for user input. `ask_user_question` maps onto one `select` per
 * question titled `"<header>: <question>"`; multiSelect is a loop of `select` rounds
 * whose options are `"[x] label"` / `"[ ] label"` plus a `Done` entry.
 */
export type ExtensionUiRequest =
  | { type: 'extension_ui_request'; id: string; method: 'select'; title: string; options: string[]; timeout?: number }
  | { type: 'extension_ui_request'; id: string; method: 'confirm'; title: string; message: string; timeout?: number }
  | { type: 'extension_ui_request'; id: string; method: 'input'; title: string; placeholder?: string }
  | { type: 'extension_ui_request'; id: string; method: 'editor'; title: string; prefill?: string }
  | { type: 'extension_ui_request'; id: string; method: 'notify'; message: string; notifyType?: 'info' | 'warning' | 'error' }
  | { type: 'extension_ui_request'; id: string; method: 'setStatus'; statusKey: string; statusText?: string }
  | {
      type: 'extension_ui_request'
      id: string
      method: 'setWidget'
      widgetKey: string
      widgetLines?: string[]
      widgetPlacement?: 'aboveEditor' | 'belowEditor'
    }
  | { type: 'extension_ui_request'; id: string; method: 'setTitle'; title: string }
  | { type: 'extension_ui_request'; id: string; method: 'set_editor_text'; text: string }

export type DialogMethod = 'select' | 'confirm' | 'input' | 'editor'

/** Requests that expect exactly one `extension_ui_response`. */
export type DialogRequest = Extract<ExtensionUiRequest, { method: DialogMethod }>

export type ExtensionUiResponse =
  | { type: 'extension_ui_response'; id: string; value: string }
  | { type: 'extension_ui_response'; id: string; confirmed: boolean }
  | { type: 'extension_ui_response'; id: string; cancelled: true }

export function isDialogRequest(request: ExtensionUiRequest): request is DialogRequest {
  return (
    request.method === 'select' ||
    request.method === 'confirm' ||
    request.method === 'input' ||
    request.method === 'editor'
  )
}

export function isRpcResponse(record: unknown): record is RpcResponse {
  return typeof record === 'object' && record !== null && (record as { type?: unknown }).type === 'response'
}

export function isExtensionUiRequest(record: unknown): record is ExtensionUiRequest {
  return (
    typeof record === 'object' &&
    record !== null &&
    (record as { type?: unknown }).type === 'extension_ui_request'
  )
}
