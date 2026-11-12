import { useCallback, useEffect, useRef } from 'react'
import type { TranscriptItem } from '../state/transcript.ts'
import { Message } from './Message.tsx'
import { ToolCard } from './ToolCard.tsx'

/** How close to the bottom still counts as "following the conversation". */
const FOLLOW_THRESHOLD_PX = 80

/**
 * Renders the transcript in event order. Items arrive keyed and stable, so list
 * reconciliation is plain React keys — no index keys anywhere.
 *
 * Auto-scroll only applies while the reader is already at the bottom: yanking the view
 * back on every delta makes reading earlier messages impossible during a streaming turn.
 */
export function Transcript({ items }: { items: readonly TranscriptItem[] }): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const followingRef = useRef(true)

  const handleScroll = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight
    followingRef.current = distance <= FOLLOW_THRESHOLD_PX
  }, [])

  useEffect(() => {
    const element = scrollRef.current
    if (!element || !followingRef.current) return
    element.scrollTop = element.scrollHeight
  }, [items])

  return (
    <div className="transcript" ref={scrollRef} onScroll={handleScroll} role="log" aria-live="polite">
      {items.length === 0 ? <p className="transcript-empty">No messages yet.</p> : null}
      {items.map((item) =>
        item.kind === 'tool' ? (
          <ToolCard key={item.id} item={item} />
        ) : (
          <Message key={item.id} item={item} />
        )
      )}
    </div>
  )
}
