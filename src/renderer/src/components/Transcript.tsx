import { useEffect, useRef } from 'react'
import type { TranscriptItem } from '../state/transcript.ts'
import { Message } from './Message.tsx'
import { ToolCard } from './ToolCard.tsx'

/**
 * Renders the transcript in event order. Items arrive keyed and stable, so list
 * reconciliation is plain React keys — no index keys anywhere.
 */
export function Transcript({ items }: { items: readonly TranscriptItem[] }): React.JSX.Element {
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [items])

  return (
    <div className="transcript">
      {items.length === 0 ? <p className="transcript-empty">No messages yet.</p> : null}
      {items.map((item) =>
        item.kind === 'tool' ? (
          <ToolCard key={item.id} item={item} />
        ) : (
          <Message key={item.id} item={item} />
        )
      )}
      <div ref={endRef} />
    </div>
  )
}
