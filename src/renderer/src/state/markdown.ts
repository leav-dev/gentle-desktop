/**
 * Pure Markdown subset parser for assistant transcript output (S15 / T56).
 *
 * The model's output is untrusted: the parser produces a plain AST with no HTML
 * anywhere in it, so the renderer never has a path from model text to markup.
 * Every marker it does not recognize — including a marker whose closer has not
 * streamed in yet — stays literal text, exactly like a terminal that does not
 * invent emphasis. The function is pure so `node --test` can exercise it
 * without React or a renderer.
 *
 * Supported subset:
 * - blocks: paragraph, heading (#..####), fenced code (``` / ~~~, optional language),
 *   list (ordered and unordered, one level plus simple nesting), quote, rule
 * - inline: text, strong (** __), em (* _), code (`), link ([label](url)), strike (~~)
 *
 * Deliberately out of the subset: images, tables, reference links, autolinks,
 * setext headings, indented code blocks, HTML, escapes.
 */

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'strike'; children: Inline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; url: string; children: Inline[] }

export interface ListItem {
  children: Inline[]
  /** A sublist nested under this item; null when the item has no children list. */
  nested: List | null
}

export interface List {
  ordered: boolean
  /** First number of an ordered list; null for unordered lists. */
  start: number | null
  items: ListItem[]
}

export type Block =
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'heading'; level: 1 | 2 | 3 | 4; children: Inline[] }
  | { type: 'code'; language: string | null; value: string }
  | { type: 'list'; list: List }
  | { type: 'quote'; children: Inline[] }
  | { type: 'rule' }

// Line-shape recognizers. They are anchored so a marker mid-line is text, and
// headings require the space (`#hashtag` is not a heading), like CommonMark.

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})([^`]*)$/
const HEADING_RE = /^(#{1,4})\s+(.*)$/
// Three or more of the same rule character, optionally space-separated.
const RULE_RE = /^ {0,3}([-*_])(?: *\1){2,} *$/
const LIST_RE = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const QUOTE_RE = /^>\s?(.*)$/

function leadingSpaces(line: string): number {
  const match = /^\s*/.exec(line)
  return match !== null ? match[0].length : 0
}

function runLength(src: string, at: number): number {
  const ch = src[at]!
  let end = at
  while (end < src.length && src[end] === ch) end += 1
  return end - at
}

/**
 * Finds the next run of exactly `len` copies of `ch` at or after `from`.
 * Exact length matters: the closer of `` ` `` must not swallow a nested `` `` ``.
 */
function findRun(src: string, from: number, ch: string, len: number): number {
  for (let i = from; i < src.length; ) {
    if (src[i] === ch) {
      const run = runLength(src, i)
      if (run === len) return i
      i += run
    } else {
      i += 1
    }
  }
  return -1
}

function isWordChar(ch: string): boolean {
  return /[A-Za-z0-9_]/.test(ch)
}

// ---------------------------------------------------------------------------
// Inline parsing
// ---------------------------------------------------------------------------

/** A `[label](url)` only counts when it is complete; otherwise `[` is text. */
function tryLink(src: string, start: number): { url: string; label: string; next: number } | null {
  const closeBracket = src.indexOf(']', start + 1)
  if (closeBracket === -1 || src[closeBracket + 1] !== '(') return null
  const closeParen = src.indexOf(')', closeBracket + 2)
  if (closeParen === -1) return null
  const url = src.slice(closeBracket + 2, closeParen).trim()
  // An empty URL is not a link the terminal would act on; keep the text.
  if (url === '') return null
  return { url, label: src.slice(start + 1, closeBracket), next: closeParen + 1 }
}

function parseInline(src: string): Inline[] {
  const out: Inline[] = []
  let text = ''
  // Text is buffered so adjacent literal characters merge into one node; the
  // buffer is flushed only right before a structured node is emitted.
  const flush = (): void => {
    if (text !== '') {
      out.push({ type: 'text', value: text })
      text = ''
    }
  }

  let i = 0
  while (i < src.length) {
    const ch = src[i]!

    if (ch === '`') {
      const run = runLength(src, i)
      const close = findRun(src, i + run, '`', run)
      if (close !== -1) {
        flush()
        let value = src.slice(i + run, close)
        // CommonMark strips one surrounding space from a code span.
        if (value.length >= 2 && value.startsWith(' ') && value.endsWith(' ')) value = value.slice(1, -1)
        out.push({ type: 'code', value })
        i = close + run
        continue
      }
      // Unmatched: the backticks are literal text, never an open span.
      text += '`'.repeat(run)
      i += run
      continue
    }

    if (ch === '*' || ch === '_') {
      const run = runLength(src, i)
      if (run >= 2) {
        const marker = ch.repeat(run)
        const close = src.indexOf(marker, i + run)
        if (close !== -1) {
          flush()
          out.push({ type: 'strong', children: parseInline(src.slice(i + run, close)) })
          i = close + run
          continue
        }
      } else {
        const close = src.indexOf(ch, i + 1)
        // Underscore emphasis is not recognized inside a word, so identifiers
        // like `some_var_name` stay literal — same rule as CommonMark.
        const intraword =
          ch === '_' && ((i > 0 && isWordChar(src[i - 1]!)) || isWordChar(src[close + 1] ?? ''))
        if (close !== -1 && !intraword) {
          flush()
          out.push({ type: 'em', children: parseInline(src.slice(i + 1, close)) })
          i = close + 1
          continue
        }
      }
      text += ch.repeat(run)
      i += run
      continue
    }

    if (ch === '~') {
      const run = runLength(src, i)
      if (run >= 2) {
        const close = src.indexOf('~~', i + 2)
        if (close !== -1) {
          flush()
          out.push({ type: 'strike', children: parseInline(src.slice(i + 2, close)) })
          i = close + 2
          continue
        }
      }
      text += '~'.repeat(run)
      i += run
      continue
    }

    if (ch === '[') {
      const link = tryLink(src, i)
      if (link !== null) {
        flush()
        out.push({ type: 'link', url: link.url, children: parseInline(link.label) })
        i = link.next
        continue
      }
      text += '['
      i += 1
      continue
    }

    text += ch
    i += 1
  }

  flush()
  return out
}

// ---------------------------------------------------------------------------
// Block parsing
// ---------------------------------------------------------------------------

function parseFencedCode(lines: readonly string[], start: number): { block: Block; next: number } | null {
  const open = FENCE_RE.exec(lines[start]!)
  if (open === null) return null
  const fence = open[1]!
  const fenceChar = fence[0]!
  const fenceLength = fence.length

  // The info string only counts when the fence is made of backticks; a tilde
  // fence followed by backticks would otherwise be misread as a language.
  let language: string | null = null
  if (fenceChar === '`') {
    const info = (open[2] ?? '').trim()
    if (info !== '') language = info.split(/\s+/)[0] ?? null
  }

  const body: string[] = []
  let i = start + 1
  let closed = false
  while (i < lines.length) {
    const line = lines[i]!
    const close = /^ {0,3}(`{3,}|~{3,}) *$/.exec(line)
    if (close !== null && close[1]![0] === fenceChar && close[1]!.length >= fenceLength) {
      closed = true
      i += 1
      break
    }
    body.push(line)
    i += 1
  }

  if (!closed) {
    // Streaming contract: an open fence renders as literal text until it
    // closes, so the whole unterminated region stays one paragraph.
    const raw = lines.slice(start).join('\n')
    return { block: { type: 'paragraph', children: parseInline(raw) }, next: lines.length }
  }
  return { block: { type: 'code', language, value: body.join('\n') }, next: i }
}

function parseList(lines: readonly string[], start: number): { block: Block; next: number } {
  const first = LIST_RE.exec(lines[start]!)!
  const baseIndent = first[1]!.length
  const ordered = /\d/.test(first[2]!)
  const startNum = ordered ? Number.parseInt(first[2]!, 10) : null

  interface RawItem {
    text: string
    nested: List | null
  }
  const raw: RawItem[] = []

  let i = start
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') break
    const match = LIST_RE.exec(line)
    if (match !== null) {
      const indent = match[1]!.length
      const content = match[3]!
      if (indent >= baseIndent + 2) {
        // A deeper marker continues the previous item as a nested list.
        const last = raw[raw.length - 1]
        if (last !== undefined) {
          const sub = parseList(lines, i)
          last.nested = sub.block.type === 'list' ? sub.block.list : null
          i = sub.next
          continue
        }
        // No item to nest under yet: treat it as an item at the base level.
        raw.push({ text: content, nested: null })
        i += 1
        continue
      }
      if (indent < baseIndent) break
      raw.push({ text: content, nested: null })
      i += 1
      continue
    }
    // A deeper non-marker line is a continuation of the previous item.
    if (leadingSpaces(line) > baseIndent && raw.length > 0) {
      const last = raw[raw.length - 1]!
      last.text += '\n' + line.trim()
      i += 1
      continue
    }
    break
  }

  const items: ListItem[] = raw.map((item) => ({
    children: parseInline(item.text),
    nested: item.nested
  }))
  return { block: { type: 'list', list: { ordered, start: startNum, items } }, next: i }
}

function startsBlock(line: string): boolean {
  return (
    line.trim() === '' ||
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    RULE_RE.test(line) ||
    QUOTE_RE.test(line) ||
    LIST_RE.test(line)
  )
}

export function parseMarkdown(src: string): Block[] {
  const lines = src.split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') {
      i += 1
      continue
    }

    const fenced = parseFencedCode(lines, i)
    if (fenced !== null) {
      blocks.push(fenced.block)
      i = fenced.next
      continue
    }

    const heading = HEADING_RE.exec(line)
    if (heading !== null) {
      const level = heading[1]!.length as 1 | 2 | 3 | 4
      blocks.push({ type: 'heading', level, children: parseInline(heading[2]!) })
      i += 1
      continue
    }

    if (RULE_RE.test(line)) {
      blocks.push({ type: 'rule' })
      i += 1
      continue
    }

    if (QUOTE_RE.test(line)) {
      const quoted: string[] = []
      while (i < lines.length) {
        const match = QUOTE_RE.exec(lines[i]!)
        if (match === null) break
        quoted.push(match[1] ?? '')
        i += 1
      }
      blocks.push({ type: 'quote', children: parseInline(quoted.join('\n')) })
      continue
    }

    if (LIST_RE.test(line)) {
      const parsed = parseList(lines, i)
      blocks.push(parsed.block)
      i = parsed.next
      continue
    }

    // Paragraph: consecutive lines until a blank line or the start of another
    // block. A single newline inside stays part of the same paragraph.
    const para: string[] = []
    while (i < lines.length && !startsBlock(lines[i]!)) {
      para.push(lines[i]!)
      i += 1
    }
    blocks.push({ type: 'paragraph', children: parseInline(para.join('\n')) })
  }

  return blocks
}
