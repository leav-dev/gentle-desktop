import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseMarkdown, type Block, type Inline } from '../src/renderer/src/state/markdown.ts'

// Helpers -------------------------------------------------------------------

function firstBlock(blocks: readonly Block[]): Block {
  assert.ok(blocks.length > 0, 'expected at least one block')
  return blocks[0]!
}

function assertText(node: Inline, value: string): void {
  assert.deepEqual(node, { type: 'text', value })
}

/** Parses one line of source and returns the inline children of its paragraph. */
function paragraph(src: string): Inline[] {
  const block = firstBlock(parseMarkdown(src))
  assert.equal(block.type, 'paragraph', `expected a paragraph for ${JSON.stringify(src)}`)
  return block.children
}

// Inline markup -------------------------------------------------------------

test('**bold** produces a strong node', () => {
  assert.deepEqual(paragraph('plain **bold** end'), [
    { type: 'text', value: 'plain ' },
    { type: 'strong', children: [{ type: 'text', value: 'bold' }] },
    { type: 'text', value: ' end' }
  ])
})

test('__bold__ also produces a strong node', () => {
  const children = paragraph('__bold__')
  assert.equal(children.length, 1)
  assert.equal(children[0]!.type, 'strong')
})

test('*em* produces an em node', () => {
  assert.deepEqual(paragraph('a *tiny* b'), [
    { type: 'text', value: 'a ' },
    { type: 'em', children: [{ type: 'text', value: 'tiny' }] },
    { type: 'text', value: ' b' }
  ])
})

test('_em_ produces an em node at a word boundary', () => {
  const children = paragraph('_soft_')
  assert.equal(children.length, 1)
  assert.equal(children[0]!.type, 'em')
})

test('underscores inside a word stay literal, as in the terminal', () => {
  const children = paragraph('some_var_name_here')
  assert.equal(children.length, 1, 'no emphasis is invented mid-word')
  assertText(children[0]!, 'some_var_name_here')
})

test('`code` produces an inline code node with its content verbatim', () => {
  assert.deepEqual(paragraph('run `npm test` now'), [
    { type: 'text', value: 'run ' },
    { type: 'code', value: 'npm test' },
    { type: 'text', value: ' now' }
  ])
})

test('inline code never parses markup inside it', () => {
  const children = paragraph('`**not bold**`')
  assert.equal(children.length, 1)
  assert.equal(children[0]!.type, 'code')
  assert.equal(children[0]!.type === 'code' ? children[0]!.value : '', '**not bold**')
})

test('~~strike~~ produces a strike node', () => {
  assert.deepEqual(paragraph('~~gone~~'), [{ type: 'strike', children: [{ type: 'text', value: 'gone' }] }])
})

test('[label](https://x) produces a link node with the URL', () => {
  const children = paragraph('see [docs](https://x) here')
  assert.equal(children.length, 3)
  const link = children[1]!
  assert.equal(link.type, 'link')
  assert.equal(link.type === 'link' ? link.url : '', 'https://x')
  assert.deepEqual(link.type === 'link' ? link.children : [], [{ type: 'text', value: 'docs' }])
})

// Unmatched markers stay literal --------------------------------------------

test('an unmatched ** stays literal text', () => {
  const children = paragraph('**open')
  assert.equal(children.length, 1, 'one text node, nothing invented')
  assertText(children[0]!, '**open')
})

test('an unmatched backtick stays literal text', () => {
  const children = paragraph('`open')
  assert.equal(children.length, 1)
  assertText(children[0]!, '`open')
})

test('an unterminated [label]( stays literal text', () => {
  const children = paragraph('[label](broken')
  assert.equal(children.length, 1)
  assertText(children[0]!, '[label](broken')
})

test('a link without a URL stays literal text', () => {
  const children = paragraph('[label]()')
  assert.equal(children.length, 1)
  assertText(children[0]!, '[label]()')
})

// Fenced code ----------------------------------------------------------------

test('a fenced block keeps its language and its body untouched, including ** inside', () => {
  const blocks = parseMarkdown('before\n\n```ts\nconst a = **b**;\n```\nafter')
  assert.deepEqual(
    blocks.map((block) => block.type),
    ['paragraph', 'code', 'paragraph']
  )
  const code = blocks[1]!
  assert.equal(code.type, 'code')
  assert.equal(code.type === 'code' ? code.language : '', 'ts')
  assert.equal(code.type === 'code' ? code.value : '', 'const a = **b**;')
})

test('a fenced block without a language has no language', () => {
  const code = firstBlock(parseMarkdown('```\nplain\n```'))
  assert.equal(code.type, 'code')
  assert.equal(code.type === 'code' ? code.language : undefined, null)
})

test('an open fence renders as literal text until it closes', () => {
  const blocks = parseMarkdown('```ts\nlet x = 1')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0]!.type, 'paragraph', 'a half-streamed fence is not yet a code block')
  const children = blocks[0]!.type === 'paragraph' ? blocks[0]!.children : []
  assert.ok(children.some((node) => node.type === 'text' && node.value.includes('```ts')))
})

// Blocks ---------------------------------------------------------------------

test('headings level 1-4 produce heading blocks', () => {
  const blocks = parseMarkdown('# one\n## two\n### three\n#### four')
  assert.deepEqual(
    blocks.map((block) => (block.type === 'heading' ? block.level : -1)),
    [1, 2, 3, 4]
  )
})

test('five hashes are not a heading', () => {
  const block = firstBlock(parseMarkdown('##### five'))
  assert.equal(block.type, 'paragraph')
})

test('# without a space is literal text', () => {
  const block = firstBlock(parseMarkdown('#hashtag'))
  assert.equal(block.type, 'paragraph')
})

test('an unordered list produces a list block with its items', () => {
  const block = firstBlock(parseMarkdown('- alpha\n- beta'))
  assert.equal(block.type, 'list')
  const list = block.type === 'list' ? block.list : null
  assert.equal(list?.ordered, false)
  assert.deepEqual(
    list?.items.map((item) => (item.children[0]?.type === 'text' ? item.children[0].value : '')),
    ['alpha', 'beta']
  )
})

test('an ordered list produces an ordered list block starting at its first number', () => {
  const block = firstBlock(parseMarkdown('3. first\n4. second'))
  assert.equal(block.type, 'list')
  const list = block.type === 'list' ? block.list : null
  assert.equal(list?.ordered, true)
  assert.equal(list?.start, 3)
})

test('an indented item nests under the previous one', () => {
  const block = firstBlock(parseMarkdown('- one\n  - nested'))
  assert.equal(block.type, 'list')
  const list = block.type === 'list' ? block.list : null
  assert.equal(list?.items.length, 1)
  const nested = list?.items[0]?.nested
  assert.equal(nested?.items.length, 1)
  assert.equal(nested?.items[0]?.children[0]?.type === 'text' ? nested.items[0]!.children[0]!.value : '', 'nested')
})

test('a quote collects its consecutive lines into one quote block', () => {
  const block = firstBlock(parseMarkdown('> line one\n> line two'))
  assert.equal(block.type, 'quote')
  const children = block.type === 'quote' ? block.children : []
  assert.ok(children.length > 0)
  const joined = children.map((node) => (node.type === 'text' ? node.value : '')).join('')
  assert.ok(joined.includes('line one'))
  assert.ok(joined.includes('line two'))
})

test('a horizontal rule produces a rule block', () => {
  for (const src of ['---', '***', '- - -']) {
    assert.equal(firstBlock(parseMarkdown(src)).type, 'rule', src)
  }
})

test('a paragraph with a newline is one block', () => {
  const blocks = parseMarkdown('first line\nsecond line')
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0]!.type, 'paragraph')
  const children = blocks[0]!.type === 'paragraph' ? blocks[0]!.children : []
  const joined = children.map((node) => (node.type === 'text' ? node.value : '')).join('')
  assert.ok(joined.includes('first line\nsecond line'))
})

test('a blank line separates two paragraphs', () => {
  const blocks = parseMarkdown('first\n\nsecond')
  assert.deepEqual(
    blocks.map((block) => block.type),
    ['paragraph', 'paragraph']
  )
})

test('empty input yields no blocks and never throws', () => {
  assert.deepEqual(parseMarkdown(''), [])
  assert.deepEqual(parseMarkdown('\n\n'), [])
})
