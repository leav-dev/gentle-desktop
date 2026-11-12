import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionSummary } from '../shared/ipc.ts'

/**
 * Session listing derived from pi's own files.
 *
 * pi exposes no list-sessions RPC command, so reading the session files is the only
 * supported way — and it must stay defensive: one unreadable file may never hide the rest
 * of the history.
 */
export type { SessionSummary }

/** A session file larger than this is listed but not scanned for a name or preview. */
const MAX_SCAN_BYTES = 8 * 1024 * 1024
const PREVIEW_LIMIT = 160

interface SessionHeaderRecord {
  type?: unknown
  id?: unknown
  timestamp?: unknown
  cwd?: unknown
}

interface SessionNameRecord {
  type?: unknown
  name?: unknown
}

interface SessionMessageRecord {
  type?: unknown
  message?: unknown
}

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
  return parts.join(' ')
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function parseSessionFile(path: string): SessionSummary | null {
  let sizeBytes: number
  try {
    sizeBytes = statSync(path).size
  } catch {
    return null
  }

  const base = { path, id: '', name: null, preview: null, cwd: null, timestamp: null, messageCount: 0, sizeBytes }

  if (sizeBytes > MAX_SCAN_BYTES) {
    return base
  }

  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    return null
  }

  const lines = raw.split('\n')
  const headerLine = lines.find((line) => line.trim().length > 0)
  if (!headerLine) return base

  let header: SessionHeaderRecord
  try {
    header = JSON.parse(headerLine) as SessionHeaderRecord
  } catch {
    return base
  }

  const summary: SessionSummary = {
    ...base,
    id: typeof header.id === 'string' ? header.id : '',
    timestamp: typeof header.timestamp === 'string' ? header.timestamp : null,
    cwd: typeof header.cwd === 'string' ? header.cwd : null
  }

  for (const line of lines) {
    if (line.length === 0) continue

    let record: SessionNameRecord & SessionMessageRecord
    try {
      record = JSON.parse(line) as SessionNameRecord & SessionMessageRecord
    } catch {
      // A truncated tail is normal for a session that was killed mid-write.
      continue
    }

    if (record.type === 'session_info' && typeof record.name === 'string') {
      const name = record.name.trim()
      if (name.length > 0) summary.name = name
      continue
    }

    if (record.type === 'message') {
      summary.messageCount += 1
      if (summary.preview === null && typeof record.message === 'object' && record.message !== null) {
        const message = record.message as { role?: unknown; content?: unknown }
        if (message.role === 'user') {
          const text = collapse(textFromContent(message.content))
          if (text.length > 0) {
            summary.preview = text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT - 1)}…` : text
          }
        }
      }
    }
  }

  return summary
}

/** Sessions directory for one agent home, matching pi's `--<cwd>--` grouping. */
export function sessionsRoot(home: string): string {
  return join(home, 'sessions')
}

/**
 * Lists every readable session, newest first. Directories are visited defensively: a
 * missing home, an unreadable group, or a broken file degrades the list instead of
 * failing the sidebar.
 */
export function listSessions(home: string, limit = 200): SessionSummary[] {
  const root = sessionsRoot(home)
  if (!existsSync(root)) return []

  const summaries: SessionSummary[] = []

  let groups: string[]
  try {
    groups = readdirSync(root)
  } catch {
    return []
  }

  for (const group of groups) {
    const groupPath = join(root, group)
    let entries: string[]
    try {
      if (!statSync(groupPath).isDirectory()) continue
      entries = readdirSync(groupPath)
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue
      const summary = parseSessionFile(join(groupPath, entry))
      if (summary) summaries.push(summary)
    }
  }

  summaries.sort((left, right) => (right.timestamp ?? '').localeCompare(left.timestamp ?? ''))
  return summaries.slice(0, limit)
}
