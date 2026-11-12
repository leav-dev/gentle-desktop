/**
 * Minimal best-effort tokenizer for fenced code blocks (S15 / T56).
 *
 * It colors strings, comments, numbers and a short keyword list per language,
 * and it is deliberately not a parser: an unterminated string simply runs to
 * the end of the line, and an unknown or missing language renders the code
 * plain rather than half-colored. Nothing here can throw its way into broken
 * markup — tokens are plain text spans, never HTML.
 */

type TokenKind = 'plain' | 'str' | 'comment' | 'number' | 'keyword' | 'added' | 'removed' | 'meta'

interface Token {
  text: string
  kind: TokenKind
}

interface LangSpec {
  quotes: readonly string[]
  /** Sequences that start a comment running to the end of the line. */
  lineComments: readonly string[]
  /** Pairs of [open, close] for block comments. */
  blockComments: readonly (readonly [string, string])[]
  keywords: ReadonlySet<string>
}

const TS_KEYWORDS = [
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'class',
  'new', 'import', 'export', 'from', 'default', 'async', 'await', 'this', 'typeof', 'interface',
  'type', 'extends', 'implements', 'enum', 'try', 'catch', 'finally', 'throw', 'switch', 'case',
  'break', 'continue', 'null', 'undefined', 'true', 'false', 'static', 'public', 'private',
  'protected', 'readonly', 'void', 'string', 'number', 'boolean', 'as', 'of', 'in'
]

const BASH_KEYWORDS = [
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done', 'case', 'esac',
  'function', 'return', 'export', 'local', 'echo', 'exit', 'in', 'set', 'cd', 'source'
]

const PYTHON_KEYWORDS = [
  'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'import', 'from', 'as',
  'try', 'except', 'finally', 'raise', 'with', 'lambda', 'pass', 'yield', 'None', 'True',
  'False', 'and', 'or', 'not', 'in', 'is', 'global', 'async', 'await'
]

const YAML_KEYWORDS = ['true', 'false', 'null', 'yes', 'no', 'on', 'off']

const LANG_SPECS: Record<string, LangSpec> = {
  ts: {
    quotes: ['"', "'", '`'],
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    keywords: new Set(TS_KEYWORDS)
  },
  js: {
    quotes: ['"', "'", '`'],
    lineComments: ['//'],
    blockComments: [['/*', '*/']],
    keywords: new Set(TS_KEYWORDS)
  },
  json: {
    quotes: ['"'],
    lineComments: [],
    blockComments: [],
    keywords: new Set(['true', 'false', 'null'])
  },
  bash: {
    quotes: ['"', "'"],
    lineComments: ['#'],
    blockComments: [],
    keywords: new Set(BASH_KEYWORDS)
  },
  python: {
    quotes: ['"', "'"],
    lineComments: ['#'],
    blockComments: [],
    keywords: new Set(PYTHON_KEYWORDS)
  },
  yaml: {
    quotes: ['"', "'"],
    lineComments: ['#'],
    blockComments: [],
    keywords: new Set(YAML_KEYWORDS)
  }
}

/** Names a fence may carry that map onto one of the specs above. */
const LANG_ALIASES: Record<string, string> = {
  tsx: 'ts',
  typescript: 'ts',
  jsx: 'js',
  javascript: 'js',
  mjs: 'js',
  cjs: 'js',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  py: 'python',
  python3: 'python',
  yml: 'yaml'
}

function specFor(language: string | null): LangSpec | null {
  if (language === null) return null
  const name = LANG_ALIASES[language] ?? language
  return LANG_SPECS[name] ?? null
}

const NUMBER_RE = /^(0[xob][0-9a-fA-F_]+|\d[\d_]*(\.\d+)?([eE][+-]?\d+)?)/

function isWordStart(ch: string): boolean {
  return /[A-Za-z_]/.test(ch)
}

/** Tokenizes with the generic spec: strings, comments, numbers, keywords. */
function tokenizeWith(src: string, spec: LangSpec): Token[] {
  const tokens: Token[] = []
  let plain = ''
  const flush = (): void => {
    if (plain !== '') {
      tokens.push({ text: plain, kind: 'plain' })
      plain = ''
    }
  }

  let i = 0
  while (i < src.length) {
    const rest = src.slice(i)
    const ch = src[i]!

    // Block comments first, so a `/*` inside them is never misread.
    const block = spec.blockComments.find(([open]) => rest.startsWith(open))
    if (block !== undefined) {
      const [open, close] = block
      const end = src.indexOf(close, i + open.length)
      const stop = end === -1 ? src.length : end + close.length
      flush()
      tokens.push({ text: src.slice(i, stop), kind: 'comment' })
      i = stop
      continue
    }

    const line = spec.lineComments.find((open) => rest.startsWith(open))
    if (line !== undefined) {
      const end = src.indexOf('\n', i)
      const stop = end === -1 ? src.length : end
      flush()
      tokens.push({ text: src.slice(i, stop), kind: 'comment' })
      i = stop
      continue
    }

    if (spec.quotes.includes(ch)) {
      // A string runs to the matching quote; a missing closer ends at the
      // newline so one broken line cannot swallow the rest of the block.
      const nl = src.indexOf('\n', i + 1)
      let j = i + 1
      while (j < src.length && src[j] !== ch && src[j] !== '\n') {
        if (src[j] === '\\') j += 1
        j += 1
      }
      const stop = j <= nl || nl === -1 ? Math.min(j + 1, src.length) : nl
      flush()
      tokens.push({ text: src.slice(i, stop), kind: 'str' })
      i = stop
      continue
    }

    if (isWordStart(ch)) {
      let j = i
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j += 1
      const word = src.slice(i, j)
      flush()
      tokens.push({ text: word, kind: spec.keywords.has(word) ? 'keyword' : 'plain' })
      i = j
      continue
    }

    if (/[0-9]/.test(ch)) {
      const match = NUMBER_RE.exec(rest)
      if (match !== null) {
        flush()
        tokens.push({ text: match[0], kind: 'number' })
        i += match[0].length
        continue
      }
    }

    plain += ch
    i += 1
  }

  flush()
  return tokens
}

/**
 * `diff` is per-line, not per-token: whole lines are additions, removals or
 * hunk headers, exactly like the diff cards elsewhere in the app.
 */
function tokenizeDiff(src: string): Token[] {
  return src.split('\n').map((line, index, lines) => ({
    text: index < lines.length - 1 ? line + '\n' : line,
    kind: line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@')
      ? 'meta'
      : line.startsWith('+')
        ? 'added'
        : line.startsWith('-')
          ? 'removed'
          : 'plain'
  }))
}

/**
 * Renders code as colored text spans. An unknown or missing language degrades
 * to the code verbatim — plain is always better than half-colored.
 */
export function Highlight({ code, language }: { code: string; language: string | null }): React.JSX.Element {
  const spec = specFor(language)
  let tokens: Token[]
  if (language !== null && (language === 'diff' || language === 'patch')) {
    tokens = tokenizeDiff(code)
  } else if (spec === null) {
    tokens = [{ text: code, kind: 'plain' }]
  } else {
    // The tokenizer is best-effort by design; any surprise falls back to plain
    // text instead of breaking the transcript.
    try {
      tokens = tokenizeWith(code, spec)
    } catch {
      tokens = [{ text: code, kind: 'plain' }]
    }
  }
  return (
    <>
      {tokens.map((token, index) => (
        <span key={index} className={token.kind === 'plain' ? undefined : `tok-${token.kind}`}>
          {token.text}
        </span>
      ))}
    </>
  )
}
