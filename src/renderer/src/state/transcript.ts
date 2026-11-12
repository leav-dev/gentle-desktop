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
