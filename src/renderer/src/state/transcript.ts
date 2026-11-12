import type { AssistantMessageEvent, RpcEvent } from '../../../shared/protocol.ts'

/**
 * Transcript items are the render model for the conversation surface. The reducer is
 * pure so `node:test` can exercise it without React and the hook can feed it straight
 * into `useReducer`.
 *
 * The wire only carries deltas (`message_update`), so text is accumulated here and
 * reconciled — replaced, not appended — when the protocol sends the authoritative
 * content on `text_end` / `thinking_end`.
 */
export interface AssistantTextItem {
  kind: 'assistant-text'
  id: string
  text: string
  streaming: boolean
}

export interface ThinkingItem {
  kind: 'thinking'
  id: string
  text: string
  streaming: boolean
}

export interface UserMessageItem {
  kind: 'user'
  id: string
  text: string
}

export interface ToolItem {
  kind: 'tool'
  /** Derived from the engine's `toolCallId`, which is unique per call. */
  id: string
  toolCallId: string
  toolName: string
  args?: unknown
  partialResult?: unknown
  result?: unknown
  status: 'running' | 'done' | 'error'
  isError: boolean
  durationMs?: number
}

export type TranscriptItem = AssistantTextItem | ThinkingItem | UserMessageItem | ToolItem

/**
 * Whether an item has anything to draw.
 *
 * The transcript is a flex column with a gap, so a text item whose text is empty still
 * occupies a row — a user message that arrived as whitespace, or an assistant text block
 * the engine opened and left blank, shows up as a gap of several lines under the message
 * above it. A tool card is never empty: it carries a name and a status.
 *
 * A streaming item is kept even while empty, because it is the cursor the reader is
 * following; hiding it would make the caret vanish between deltas.
 */
export function hasVisibleContent(item: TranscriptItem): boolean {
  if (item.kind === 'tool') return true
  // Only assistant text and thinking carry `streaming`; a user message never does.
  if ('streaming' in item && item.streaming === true) return true
  return item.text.trim().length > 0
}

/**
 * Open streaming blocks, keyed by the `contentIndex` of the current assistant message.
 * The index repeats across turns, so a new block always allocates a fresh item id and
 * the map only ever holds blocks of the message currently being streamed.
 */
interface OpenBlocks {
  text: Map<number, string>
  thinking: Map<number, string>
}

export interface TranscriptState {
  items: TranscriptItem[]
  isStreaming: boolean
  seq: number
  open: OpenBlocks
}

export function initialTranscriptState(): TranscriptState {
  return { items: [], isStreaming: false, seq: 0, open: { text: new Map(), thinking: new Map() } }
}

function mapWithout(source: Map<number, string>, key: number): Map<number, string> {
  const next = new Map(source)
  next.delete(key)
  return next
}

/** Mark every block still marked as streaming as finished; used when a turn ends. */
function finalizeOpen(state: TranscriptState): TranscriptState {
  const openIds = new Set<string>([...state.open.text.values(), ...state.open.thinking.values()])
  if (openIds.size === 0) return state
  const items = state.items.map((item) =>
    (item.kind === 'assistant-text' || item.kind === 'thinking') && openIds.has(item.id)
      ? { ...item, streaming: false }
      : item
  )
  return { ...state, items, open: { text: new Map(), thinking: new Map() } }
}

interface StreamingItemShape {
  kind: 'assistant-text' | 'thinking'
  prefix: 'text' | 'thinking'
}

/**
 * Shared accumulation/reconciliation for text and thinking: `*_delta` appends to the
 * open block (opening one if the start event was never seen), `*_end` replaces the
 * accumulated text with the authoritative content.
 */
function reduceStreamingBlock(
  state: TranscriptState,
  shape: StreamingItemShape,
  phase: 'start' | 'delta' | 'end',
  contentIndex: number,
  payload: { delta?: string; content?: string }
): TranscriptState {
  const open = shape.prefix === 'text' ? state.open.text : state.open.thinking
  const existingId = open.get(contentIndex)

  if (phase === 'end' && existingId === undefined) {
    // Reconciliation without a seen start/delta still lands the final content.
    const id = `${shape.prefix}-${state.seq}`
    return {
      ...state,
      seq: state.seq + 1,
      items: [
        ...state.items,
        { kind: shape.kind, id, text: payload.content ?? '', streaming: false }
      ]
    }
  }

  if (existingId !== undefined) {
    const items = state.items.map((item) => {
      if (item.kind !== shape.kind || item.id !== existingId) return item
      if (phase === 'end') return { ...item, text: payload.content ?? '', streaming: false }
      return { ...item, text: item.text + (payload.delta ?? '') }
    })
    if (phase !== 'end') return { ...state, items }
    const nextOpen =
      shape.prefix === 'text'
        ? mapWithout(state.open.text, contentIndex)
        : mapWithout(state.open.thinking, contentIndex)
    return {
      ...state,
      items,
      open: shape.prefix === 'text' ? { ...state.open, text: nextOpen } : { ...state.open, thinking: nextOpen }
    }
  }

  // No open block: `start`, or a `delta` that arrived without a start.
  const id = `${shape.prefix}-${state.seq}`
  const item =
    shape.kind === 'assistant-text'
      ? ({ kind: 'assistant-text', id, text: payload.delta ?? '', streaming: true } satisfies AssistantTextItem)
      : ({ kind: 'thinking', id, text: payload.delta ?? '', streaming: true } satisfies ThinkingItem)
  const nextOpen = new Map(open)
  nextOpen.set(contentIndex, id)
  return {
    ...state,
    seq: state.seq + 1,
    items: [...state.items, item],
    open: shape.prefix === 'text' ? { ...state.open, text: nextOpen } : { ...state.open, thinking: nextOpen }
  }
}

function reduceMessageUpdate(state: TranscriptState, event: AssistantMessageEvent): TranscriptState {
  switch (event.type) {
    case 'text_start':
      return reduceStreamingBlock(state, { kind: 'assistant-text', prefix: 'text' }, 'start', event.contentIndex, {})
    case 'text_delta':
      return reduceStreamingBlock(
        state,
        { kind: 'assistant-text', prefix: 'text' },
        'delta',
        event.contentIndex,
        { delta: event.delta }
      )
    case 'text_end':
      return reduceStreamingBlock(
        state,
        { kind: 'assistant-text', prefix: 'text' },
        'end',
        event.contentIndex,
        { content: event.content }
      )
    case 'thinking_start':
      return reduceStreamingBlock(state, { kind: 'thinking', prefix: 'thinking' }, 'start', event.contentIndex, {})
    case 'thinking_delta':
      return reduceStreamingBlock(
        state,
        { kind: 'thinking', prefix: 'thinking' },
        'delta',
        event.contentIndex,
        { delta: event.delta }
      )
    case 'thinking_end':
      return reduceStreamingBlock(
        state,
        { kind: 'thinking', prefix: 'thinking' },
        'end',
        event.contentIndex,
        { content: event.content }
      )
    default:
      return state
  }
}

export function reduceTranscript(state: TranscriptState, event: RpcEvent): TranscriptState {
  switch (event.type) {
    case 'agent_start':
      return { ...state, isStreaming: true }
    case 'agent_settled':
      // Finalize blocks left open (e.g. by an aborted turn) so no card claims to stream.
      return { ...finalizeOpen(state), isStreaming: false }
    // The protocol reconciles on text_end/toolcall_end/message_end; a message that
    // ends closes anything the delta stream left open.
    case 'message_end':
      return finalizeOpen(state)
    case 'message_update':
      return reduceMessageUpdate(state, event.assistantMessageEvent)
    case 'tool_execution_start': {
      const base: ToolItem = {
        kind: 'tool',
        id: `tool-${event.toolCallId}`,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        status: 'running',
        isError: false
      }
      const item: ToolItem = event.args !== undefined ? { ...base, args: event.args } : base
      return { ...state, items: [...state.items, item] }
    }
    case 'tool_execution_update': {
      const items = state.items.map((item) =>
        item.kind === 'tool' && item.toolCallId === event.toolCallId && event.partialResult !== undefined
          ? { ...item, partialResult: event.partialResult }
          : item
      )
      return { ...state, items }
    }
    case 'tool_execution_end': {
      const items = state.items.map((item) => {
        if (item.kind !== 'tool' || item.toolCallId !== event.toolCallId) return item
        // The final result supersedes any partial progress shown while running.
        const { partialResult: _superseded, ...closed } = item
        const ended: Omit<ToolItem, 'result' | 'durationMs'> = {
          ...closed,
          status: event.isError === true ? 'error' : 'done',
          isError: event.isError === true
        }
        const withResult: ToolItem = event.result !== undefined ? { ...ended, result: event.result } : ended
        return event.durationMs !== undefined ? { ...withResult, durationMs: event.durationMs } : withResult
      })
      return { ...state, items }
    }
    default:
      // Events without a transcript surface (queue updates, compaction, retries…).
      return state
  }
}

export function appendUserMessage(state: TranscriptState, text: string): TranscriptState {
  const item: UserMessageItem = { kind: 'user', id: `user-${state.seq}`, text }
  return { ...state, seq: state.seq + 1, items: [...state.items, item] }
}

// ---------------------------------------------------------------------------
// History hydration
// ---------------------------------------------------------------------------

function textFromContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  const parts: string[] = []
  for (const block of content) {
    if (typeof block === 'string') {
      parts.push(block)
      continue
    }
    if (typeof block === 'object' && block !== null) {
      const candidate = block as { type?: unknown; text?: unknown }
      if (candidate.type === 'text' && typeof candidate.text === 'string') parts.push(candidate.text)
    }
  }
  return parts.join('\n').trim()
}

interface HistoricalToolCall {
  id: string
  name: string
  args?: unknown
}

function toolCallsFromContent(content: unknown): HistoricalToolCall[] {
  if (!Array.isArray(content)) return []

  const calls: HistoricalToolCall[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const candidate = block as { type?: unknown; id?: unknown; name?: unknown; arguments?: unknown }
    if (candidate.type !== 'toolCall' || typeof candidate.name !== 'string') continue
    calls.push({
      id: typeof candidate.id === 'string' ? candidate.id : candidate.name,
      name: candidate.name,
      ...(candidate.arguments !== undefined ? { args: candidate.arguments } : {})
    })
  }
  return calls
}

/**
 * Rebuilds a transcript from `get_messages`, so reopening a saved session shows the
 * conversation instead of an empty pane.
 *
 * Historical entries are read defensively and by shape: pi's message payload is not the
 * RPC event stream, and a session written by another version must degrade to fewer items
 * rather than break the view. Tool results arrive as their own messages, so they are
 * attached to the call they answer rather than rendered as separate cards.
 */
export function hydrateTranscript(messages: readonly unknown[]): TranscriptState {
  const items: TranscriptItem[] = []
  let seq = 0

  for (const raw of messages) {
    if (typeof raw !== 'object' || raw === null) continue
    const message = raw as { role?: unknown; content?: unknown }
    const id = `history-${(seq += 1)}`

    if (message.role === 'user') {
      const text = textFromContent(message.content)
      if (text.length > 0) items.push({ kind: 'user', id, text })
      continue
    }

    if (message.role === 'assistant') {
      const text = textFromContent(message.content)
      if (text.length > 0) items.push({ kind: 'assistant-text', id, text, streaming: false })

      for (const call of toolCallsFromContent(message.content)) {
        items.push({
          kind: 'tool',
          id: `${id}-${call.id}`,
          toolCallId: call.id,
          toolName: call.name,
          ...(call.args !== undefined ? { args: call.args } : {}),
          status: 'done',
          isError: false
        })
      }
      continue
    }

    if (message.role === 'toolResult') {
      const result = raw as { toolCallId?: unknown; isError?: unknown; content?: unknown }
      const toolCallId = typeof result.toolCallId === 'string' ? result.toolCallId : null
      if (toolCallId === null) continue

      const index = items.findIndex((item) => item.kind === 'tool' && item.toolCallId === toolCallId)
      const target = index === -1 ? undefined : items[index]
      if (!target || target.kind !== 'tool') continue

      items[index] = {
        ...target,
        result: result.content,
        status: result.isError === true ? 'error' : 'done',
        isError: result.isError === true
      }
    }
  }

  return { items, isStreaming: false, seq, open: { text: new Map(), thinking: new Map() } }
}
