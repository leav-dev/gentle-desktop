import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AssistantMessageEvent, RpcEvent } from '../src/shared/protocol.ts'
import { appendUserMessage, hasVisibleContent, hydrateTranscript, initialTranscriptState, reduceTranscript, type TranscriptItem } from '../src/renderer/src/state/transcript.ts'

function messageUpdate(assistantMessageEvent: AssistantMessageEvent): RpcEvent {
  return { type: 'message_update', assistantMessageEvent }
}

function findKind(items: readonly TranscriptItem[], kind: TranscriptItem['kind']): TranscriptItem[] {
  return items.filter((item) => item.kind === kind)
}

test('text deltas accumulate into a single streaming assistant item', () => {
  let state = initialTranscriptState()
  state = reduceTranscript(state, messageUpdate({ type: 'text_start', contentIndex: 0 }))
  state = reduceTranscript(state, messageUpdate({ type: 'text_delta', contentIndex: 0, delta: 'Hello' }))
  state = reduceTranscript(state, messageUpdate({ type: 'text_delta', contentIndex: 0, delta: ', world' }))

  const texts = findKind(state.items, 'assistant-text')
  assert.equal(texts.length, 1, 'consecutive deltas share one item, not one per delta')
  const item = texts[0]!
  assert.equal(item.text, 'Hello, world')
  assert.equal(item.streaming, true, 'the item is marked as still streaming')
})

test('text_end reconciles the item by replacing its text, not appending', () => {
  let state = initialTranscriptState()
  state = reduceTranscript(state, messageUpdate({ type: 'text_start', contentIndex: 0 }))
  state = reduceTranscript(state, messageUpdate({ type: 'text_delta', contentIndex: 0, delta: 'partial acc' }))
  state = reduceTranscript(
    state,
    messageUpdate({ type: 'text_end', contentIndex: 0, content: 'authoritative final text' })
  )

  const texts = findKind(state.items, 'assistant-text')
  assert.equal(texts.length, 1)
  assert.equal(texts[0]!.text, 'authoritative final text', 'content from text_end wins over the deltas')
  assert.equal(texts[0]!.streaming, false)
})

test('assistant item keys stay stable across deltas and reconciliation', () => {
  let state = initialTranscriptState()
  state = reduceTranscript(state, messageUpdate({ type: 'text_start', contentIndex: 0 }))
  const created = findKind(state.items, 'assistant-text')[0]!.id
  state = reduceTranscript(state, messageUpdate({ type: 'text_delta', contentIndex: 0, delta: 'x' }))
  assert.equal(findKind(state.items, 'assistant-text')[0]!.id, created)
  state = reduceTranscript(state, messageUpdate({ type: 'text_end', contentIndex: 0, content: 'x' }))
  assert.equal(findKind(state.items, 'assistant-text')[0]!.id, created)
})

test('thinking deltas render as a separate item from assistant text', () => {
  let state = initialTranscriptState()
  state = reduceTranscript(state, messageUpdate({ type: 'thinking_start', contentIndex: 0 }))
  state = reduceTranscript(state, messageUpdate({ type: 'thinking_delta', contentIndex: 0, delta: 'pondering' }))
  state = reduceTranscript(state, messageUpdate({ type: 'text_start', contentIndex: 1 }))
  state = reduceTranscript(state, messageUpdate({ type: 'text_delta', contentIndex: 1, delta: 'answer' }))
  state = reduceTranscript(state, messageUpdate({ type: 'thinking_end', contentIndex: 0, content: 'thinking done' }))

  const thinking = findKind(state.items, 'thinking')
  assert.equal(thinking.length, 1, 'thinking is its own item kind')
  assert.equal(thinking[0]!.text, 'thinking done', 'thinking_end reconciles the thinking item')
  const texts = findKind(state.items, 'assistant-text')
  assert.equal(texts.length, 1)
  assert.equal(texts[0]!.text, 'answer')
})

test('a second turn with the same contentIndex gets its own items, not a merge', () => {
  let state = initialTranscriptState()
  state = reduceTranscript(state, messageUpdate({ type: 'text_start', contentIndex: 0 }))
  state = reduceTranscript(state, messageUpdate({ type: 'text_delta', contentIndex: 0, delta: 'turn one' }))
  state = reduceTranscript(state, messageUpdate({ type: 'text_end', contentIndex: 0, content: 'turn one' }))
  state = reduceTranscript(state, messageUpdate({ type: 'text_start', contentIndex: 0 }))
  state = reduceTranscript(state, messageUpdate({ type: 'text_delta', contentIndex: 0, delta: 'turn two' }))

  const texts = findKind(state.items, 'assistant-text')
  assert.equal(texts.length, 2, 'contentIndex is per-message, so each turn allocates a new item')
  assert.deepEqual(texts.map((item) => item.text), ['turn one', 'turn two'])
})

test('tool_execution_start opens a running card and update refreshes it', () => {
  let state = initialTranscriptState()
  state = reduceTranscript(state, {
    type: 'tool_execution_start',
    toolCallId: 'call-1',
    toolName: 'edit',
    args: { path: 'a.ts' }
  })

  const opened = findKind(state.items, 'tool')
  assert.equal(opened.length, 1)
  const card = opened[0]!
  assert.equal(card.toolName, 'edit')
  assert.equal(card.status, 'running')
  assert.deepEqual(card.args, { path: 'a.ts' })

  state = reduceTranscript(state, {
    type: 'tool_execution_update',
    toolCallId: 'call-1',
    toolName: 'edit',
    partialResult: { progress: 0.5 }
  })
  const updated = findKind(state.items, 'tool')[0]!
  assert.deepEqual(updated.partialResult, { progress: 0.5 })
  assert.equal(updated.status, 'running', 'an update does not close the card')
})

test('tool_execution_end closes the card with isError and durationMs', () => {
  let state = initialTranscriptState()
  state = reduceTranscript(state, {
    type: 'tool_execution_start',
    toolCallId: 'call-1',
    toolName: 'bash'
  })
  state = reduceTranscript(state, {
    type: 'tool_execution_end',
    toolCallId: 'call-1',
    toolName: 'bash',
    result: { exitCode: 1 },
    isError: true,
    durationMs: 42
  })

  const card = findKind(state.items, 'tool')[0]!
  assert.equal(card.status, 'error')
  assert.equal(card.isError, true)
  assert.equal(card.durationMs, 42)
  assert.deepEqual(card.result, { exitCode: 1 })

  let success = initialTranscriptState()
  success = reduceTranscript(success, {
    type: 'tool_execution_start',
    toolCallId: 'call-2',
    toolName: 'read'
  })
  success = reduceTranscript(success, {
    type: 'tool_execution_end',
    toolCallId: 'call-2',
    toolName: 'read',
    result: 'ok'
  })
  const okCard = findKind(success.items, 'tool')[0]!
  assert.equal(okCard.status, 'done', 'a tool without isError closes as done')
  assert.equal(okCard.isError, false)
})

test('tool cards are keyed by toolCallId and interleaved tool calls update independently', () => {
  let state = initialTranscriptState()
  state = reduceTranscript(state, {
    type: 'tool_execution_start',
    toolCallId: 'a',
    toolName: 'read'
  })
  state = reduceTranscript(state, {
    type: 'tool_execution_start',
    toolCallId: 'b',
    toolName: 'edit'
  })
  state = reduceTranscript(state, {
    type: 'tool_execution_end',
    toolCallId: 'a',
    toolName: 'read',
    result: 'done'
  })

  const cards = findKind(state.items, 'tool')
  assert.deepEqual(
    cards.map((card) => [card.toolCallId, card.status]),
    [
      ['a', 'done'],
      ['b', 'running']
    ],
    'closing one call leaves the other open'
  )
})

test('agent_start and agent_settled toggle streaming', () => {
  let state = initialTranscriptState()
  assert.equal(state.isStreaming, false)
  state = reduceTranscript(state, { type: 'agent_start' })
  assert.equal(state.isStreaming, true)
  state = reduceTranscript(state, { type: 'agent_settled' })
  assert.equal(state.isStreaming, false)
})

test('agent_settled finalizes blocks left open by an aborted turn', () => {
  let state = initialTranscriptState()
  state = reduceTranscript(state, { type: 'agent_start' })
  state = reduceTranscript(state, messageUpdate({ type: 'text_start', contentIndex: 0 }))
  state = reduceTranscript(state, messageUpdate({ type: 'text_delta', contentIndex: 0, delta: 'cut off' }))
  state = reduceTranscript(state, { type: 'agent_settled', aborted: true })

  assert.equal(state.isStreaming, false)
  const texts = findKind(state.items, 'assistant-text')
  assert.equal(texts[0]!.streaming, false, 'no item is left claiming to stream after settle')
})

test('events the transcript does not render leave items untouched', () => {
  const state = initialTranscriptState()
  const after = reduceTranscript(state, { type: 'queue_update', steering: ['x'] })
  assert.deepEqual(after.items, state.items)
})

test('the reducer is pure: the previous state object is never mutated', () => {
  const state = initialTranscriptState()
  const snapshot = structuredClone({ items: state.items, isStreaming: state.isStreaming })
  reduceTranscript(state, messageUpdate({ type: 'text_delta', contentIndex: 0, delta: 'delta' }))

  assert.deepEqual(
    { items: state.items, isStreaming: state.isStreaming },
    snapshot,
    'the input state survives reduction unchanged'
  )
})

test('appendUserMessage adds a user item without touching streaming', () => {
  let state = initialTranscriptState()
  state = reduceTranscript(state, { type: 'agent_start' })
  state = appendUserMessage(state, 'fix the bug')

  const users = findKind(state.items, 'user')
  assert.equal(users.length, 1)
  assert.equal(users[0]!.text, 'fix the bug')
  assert.equal(state.isStreaming, true, 'a user message does not reset the streaming flag')
})

// --- history hydration -----------------------------------------------------

test('hydrating a saved conversation rebuilds user and assistant turns', () => {
  const state = hydrateTranscript([
    { role: 'user', content: 'arreglá el parser' },
    { role: 'assistant', content: [{ type: 'text', text: 'voy' }] }
  ])

  assert.deepEqual(
    state.items.map((item) => item.kind),
    ['user', 'assistant-text']
  )
  assert.deepEqual(
    state.items.map((item) => (item.kind === 'user' || item.kind === 'assistant-text' ? item.text : '')),
    ['arreglá el parser', 'voy']
  )
  assert.equal(state.isStreaming, false, 'history never renders as streaming')
})

test('hydrated tool calls are done by default and take the error flag from their result', () => {
  const state = hydrateTranscript([
    {
      role: 'assistant',
      content: [
        { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'a.ts' } },
        { type: 'toolCall', id: 'call-2', name: 'bash', arguments: { command: 'false' } }
      ]
    },
    { role: 'toolResult', toolCallId: 'call-1', content: 'file body', isError: false },
    { role: 'toolResult', toolCallId: 'call-2', content: 'exit 1', isError: true }
  ])

  const tools = state.items.filter((item) => item.kind === 'tool')
  assert.equal(tools.length, 2)
  assert.deepEqual(
    tools.map((item) => (item.kind === 'tool' ? [item.toolName, item.status, item.isError] : [])),
    [
      ['read', 'done', false],
      ['bash', 'error', true]
    ]
  )
  assert.deepEqual(
    tools.map((item) => (item.kind === 'tool' ? item.result : undefined)),
    ['file body', 'exit 1'],
    'the result is attached to the call it answers'
  )
})

test('hydration ignores shapes it does not understand instead of failing the view', () => {
  const state = hydrateTranscript([
    null,
    'not a message',
    { role: 'system', content: 'irrelevant' },
    { role: 'toolResult' },
    { role: 'user', content: [] }
  ])

  assert.deepEqual(state.items, [], 'nothing renderable, nothing invented')
})

test('a text item with nothing in it is not drawn', () => {
  // The transcript is a flex column with a gap: an empty block costs a whole row, which is
  // what the user saw as "several lines under my message".
  assert.equal(hasVisibleContent({ kind: 'user', id: 'u', text: '' }), false)
  assert.equal(hasVisibleContent({ kind: 'user', id: 'u', text: '   \n  ' }), false)
  assert.equal(hasVisibleContent({ kind: 'assistant', id: 'a', text: '', streaming: false }), false)
  assert.equal(hasVisibleContent({ kind: 'thinking', id: 't', text: '\n' }), false)
})

test('content and the streaming cursor are both kept', () => {
  assert.equal(hasVisibleContent({ kind: 'user', id: 'u', text: 'hola' }), true)
  assert.equal(
    hasVisibleContent({ kind: 'assistant', id: 'a', text: '', streaming: true }),
    true,
    'the caret must not vanish between deltas'
  )
  assert.equal(
    hasVisibleContent({ kind: 'tool', id: 'x', toolCallId: 'c', toolName: 'bash', status: 'running' }),
    true
  )
})
