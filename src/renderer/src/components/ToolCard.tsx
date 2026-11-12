import type { ToolItem } from '../state/transcript.ts'
import { Diff, extractDiff } from './Diff.tsx'

function formatPayload(item: ToolItem): string {
  const payload: Record<string, unknown> = { args: item.args }
  if (item.result !== undefined) payload['result'] = item.result
  else if (item.partialResult !== undefined) payload['partial'] = item.partialResult
  return JSON.stringify(payload, null, 2) ?? ''
}

/**
 * One tool call. When the payload carries file-edit data we render a line diff;
 * otherwise the raw args/result JSON, never a fabricated diff.
 */
export function ToolCard({ item }: { item: ToolItem }): React.JSX.Element {
  const diff = extractDiff(item.args, item.result)
  return (
    <div className={`tool-card tool-${item.status}`}>
      <div className="tool-card-head">
        <span className="tool-name">{item.toolName}</span>
        <span className="tool-status">
          {item.status === 'running' ? 'running…' : item.status === 'error' ? 'failed' : `${item.durationMs ?? 0} ms`}
        </span>
      </div>
      {diff !== null && diff.length > 0 ? (
        <Diff lines={diff} />
      ) : (
        <pre className="tool-payload">{formatPayload(item)}</pre>
      )}
    </div>
  )
}
