import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { OddTaskFeature } from '../shared/ipc.ts'

/**
 * ODD task checklists for the rail, read from `odd/tasks/*.md` in the session
 * working directory. Parsing is pure so `tests/oddTasks.test.mts` can pin the
 * checkbox rules without touching the filesystem.
 */

const TOP_LEVEL_CHECKBOX = /^- \[([ xX])\] ?(.*)$/

export interface ParsedOddTasks {
  done: number
  total: number
  open: string[]
}

/**
 * Only top-level list items count: the anchored regex ignores indented (nested)
 * checkboxes and every prose line, even ones that look like checkboxes.
 */
export function parseOddTasksMarkdown(content: string): ParsedOddTasks {
  let done = 0
  let total = 0
  const open: string[] = []

  for (const line of content.split('\n')) {
    const match = TOP_LEVEL_CHECKBOX.exec(line)
    if (match === null) continue
    total += 1
    const state = match[1] ?? ' '
    const text = (match[2] ?? '').trim()
    if (state === ' ') {
      if (text.length > 0) open.push(text)
    } else {
      done += 1
    }
  }

  return { done, total, open }
}

/**
 * The first `#` heading names the feature; the file name is the fallback. ODD
 * headings carry a subtitle after an em dash (`# name — description`), so only
 * the part before it is the name.
 */
export function featureName(content: string, fallback: string): string {
  for (const line of content.split('\n')) {
    if (line.startsWith('# ')) {
      const name = (line.slice(2).split(' — ')[0] ?? '').trim()
      if (name.length > 0) return name
    }
  }
  return fallback
}

/**
 * One feature per markdown file. A missing or unreadable `odd/tasks` directory
 * yields an empty list — the rail just has no Tasks section.
 */
export function listOddTasks(cwd: string): OddTaskFeature[] {
  const dir = join(cwd, 'odd', 'tasks')

  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }

  const features: OddTaskFeature[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue
    let content: string
    try {
      content = readFileSync(join(dir, entry), 'utf8')
    } catch {
      continue
    }
    const parsed = parseOddTasksMarkdown(content)
    features.push({
      feature: featureName(content, entry.replace(/\.md$/, '')),
      done: parsed.done,
      total: parsed.total,
      open: parsed.open
    })
  }
  return features
}
