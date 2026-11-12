import type { AssistantTextItem, ThinkingItem, UserMessageItem } from '../state/transcript.ts'

export type MessageItem = AssistantTextItem | ThinkingItem | UserMessageItem

/**
 * Text-bearing transcript items. Thinking renders as a native collapsible so it stays
 * out of the way; model output is rendered as text nodes only — never as HTML.
 */
export function Message({ item }: { item: MessageItem }): React.JSX.Element {
  if (item.kind === 'user') {
    return (
      <div className="message message-user">
        <p className="message-text">{item.text}</p>
      </div>
    )
  }
  if (item.kind === 'thinking') {
    // Collapsed by default; while streaming it starts open so progress is visible.
    return (
      <details className="message message-thinking" open={item.streaming}>
        <summary className="message-thinking-summary">
          Thinking{item.streaming ? '…' : ''}
        </summary>
        <p className="message-text message-thinking-text">{item.text}</p>
      </details>
    )
  }
  return (
    <div className={`message message-assistant${item.streaming ? ' message-streaming' : ''}`}>
      <p className="message-text">{item.text}</p>
    </div>
  )
}
