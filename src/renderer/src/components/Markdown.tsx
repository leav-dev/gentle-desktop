import type { Block, Inline, List } from '../state/markdown.ts'
import { parseMarkdown } from '../state/markdown.ts'
import { Highlight } from './Highlight.tsx'

/**
 * Renders the Markdown AST from `state/markdown.ts` as React elements (S15 /
 * T56). Absolute safety rules, all of them structural:
 * - no `dangerouslySetInnerHTML`, no HTML passthrough — model output only ever
 *   becomes text nodes and fixed elements built here;
 * - a link navigates only through the main window's `setWindowOpenHandler`,
 *   which routes to the user's browser; anything that is not a plain http(s)
 *   or mailto URL degrades to text with the URL shown.
 */

/** Only schemes the terminal would hand to the user's browser get an anchor. */
const SAFE_URL_RE = /^(https?:\/\/|mailto:)/i

function renderInline(nodes: readonly Inline[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`
    switch (node.type) {
      case 'text':
        return node.value
      case 'strong':
        return <strong key={key}>{renderInline(node.children, key)}</strong>
      case 'em':
        return <em key={key}>{renderInline(node.children, key)}</em>
      case 'strike':
        return <del key={key}>{renderInline(node.children, key)}</del>
      case 'code':
        return (
          <code key={key} className="md-code-inline">
            {node.value}
          </code>
        )
      case 'link':
        // The URL is the one thing the model could aim at the app frame, so it
        // is scheme-checked before it is allowed near an href.
        if (SAFE_URL_RE.test(node.url)) {
          return (
            <a key={key} className="md-link" href={node.url} target="_blank" rel="noreferrer">
              {renderInline(node.children, key)}
            </a>
          )
        }
        // Not a scheme we hand to the browser: plain text, URL shown, no href.
        return (
          <span key={key}>
            {renderInline(node.children, key)} ({node.url})
          </span>
        )
    }
  })
}

function ListTag({ list, keyPrefix }: { list: List; keyPrefix: string }): React.JSX.Element {
  const items = list.items.map((item, index) => {
    const key = `${keyPrefix}-item-${index}`
    return (
      <li key={key}>
        {renderInline(item.children, key)}
        {item.nested !== null && <ListTag list={item.nested} keyPrefix={key} />}
      </li>
    )
  })
  if (list.ordered) {
    return <ol className="md-list md-ol">{items}</ol>
  }
  return <ul className="md-list md-ul">{items}</ul>
}

function BlockNode({ block, index }: { block: Block; index: number }): React.JSX.Element {
  const key = `block-${index}`
  switch (block.type) {
    case 'paragraph':
      return <p className="md-p">{renderInline(block.children, key)}</p>
    case 'heading': {
      const Tag = `h${block.level}` as 'h1' | 'h2' | 'h3' | 'h4'
      return <Tag className="md-h">{renderInline(block.children, key)}</Tag>
    }
    case 'code':
      return (
        <div className="md-code">
          {block.language !== null && <div className="md-code-lang">{block.language}</div>}
          <pre>
            <code>
              <Highlight code={block.value} language={block.language} />
            </code>
          </pre>
        </div>
      )
    case 'list':
      return <ListTag list={block.list} keyPrefix={key} />
    case 'quote':
      return <blockquote className="md-quote">{renderInline(block.children, key)}</blockquote>
    case 'rule':
      return <hr className="md-rule" />
  }
}

/**
 * The transcript's Markdown surface. A half-streamed document is safe by
 * construction: the parser keeps every unclosed marker literal, so this can
 * never throw and never invent structure the model has not finished writing.
 */
export function Markdown({ text }: { text: string }): React.JSX.Element {
  const blocks = parseMarkdown(text)
  return (
    <div className="message-text md-root">
      {blocks.map((block, index) => (
        <BlockNode key={`block-${index}`} block={block} index={index} />
      ))}
    </div>
  )
}
