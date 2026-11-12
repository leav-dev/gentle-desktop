export interface DiffLine {
  type: 'add' | 'del' | 'context'
  text: string
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

/** Look for a unified-diff string on the payload or inside it, a few levels deep. */
function findDiffString(value: unknown, depth: number): string | null {
  if (depth > 3 || typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  const diff = asString(record['diff']) ?? asString(record['unifiedDiff'])
  if (diff !== null) return diff
  for (const child of Object.values(record)) {
    const nested = findDiffString(child, depth + 1)
    if (nested !== null) return nested
  }
  return null
}

function parseUnifiedDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = []
  for (const line of diff.split('\n')) {
    // Unified headers carry no user-visible edit content.
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ') ||
      line.startsWith('@@')
    ) {
      continue
    }
    if (line.startsWith('+')) lines.push({ type: 'add', text: line.slice(1) })
    else if (line.startsWith('-')) lines.push({ type: 'del', text: line.slice(1) })
    else if (line.startsWith(' ') || line === '') lines.push({ type: 'context', text: line.slice(1) })
    else lines.push({ type: 'context', text: line })
  }
  return lines
}

/** Prefix/suffix line diff: enough for edit args without pulling in a diff library. */
function lineDiff(oldText: string, newText: string): DiffLine[] {
  const before = oldText.split('\n')
  const after = newText.split('\n')
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start += 1
  let endBefore = before.length
  let endAfter = after.length
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1
    endAfter -= 1
  }
  const lines: DiffLine[] = []
  for (const text of before.slice(0, start)) lines.push({ type: 'context', text })
  for (const text of before.slice(start, endBefore)) lines.push({ type: 'del', text })
  for (const text of after.slice(start, endAfter)) lines.push({ type: 'add', text })
  for (const text of before.slice(endBefore)) lines.push({ type: 'context', text })
  return lines
}

/**
 * Derive a line-level diff from the tool call payload we actually received, or null
 * when the payload carries no edit data (the card then falls back to formatted JSON
 * instead of inventing a diff).
 */
export function extractDiff(args: unknown, result: unknown): DiffLine[] | null {
  const fromResult = typeof result === 'object' && result !== null ? findDiffString(result, 0) : null
  if (fromResult !== null) return parseUnifiedDiff(fromResult)
  const fromArgs = typeof args === 'object' && args !== null ? findDiffString(args, 0) : null
  if (fromArgs !== null) return parseUnifiedDiff(fromArgs)

  if (typeof args === 'object' && args !== null) {
    const record = args as Record<string, unknown>
    const oldText = asString(record['oldText'])
    const newText = asString(record['newText'])
    if (oldText !== null && newText !== null) return lineDiff(oldText, newText)
    const content = asString(record['content'])
    if (content !== null && record['path'] !== undefined) {
      return content.split('\n').map((text) => ({ type: 'add' as const, text }))
    }
  }
  return null
}

export function Diff({ lines }: { lines: readonly DiffLine[] }): React.JSX.Element {
  return (
    <pre className="diff">
      {lines.map((line, index) => (
        <code key={index} className={`diff-line diff-${line.type}`}>
          <span className="diff-sign">{line.type === 'add' ? '+' : line.type === 'del' ? '-' : ' '}</span>
          {line.text}
        </code>
      ))}
    </pre>
  )
}
