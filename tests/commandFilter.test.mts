import assert from 'node:assert/strict'
import { test } from 'node:test'
import { filterCommands, shouldOpenPalette } from '../src/renderer/src/state/commandFilter.ts'

const engine = [
  { name: 'copy', description: 'Copy the last assistant answer', source: 'gentle' },
  { name: 'settings', source: 'gentle' },
  { name: 'review', description: 'Run a review pass', source: 'builtin' },
  { name: 'REVIEW-DIFF', description: 'Inspect the latest diff', source: 'builtin' }
]

test('an empty query returns every command in engine order', () => {
  const filtered = filterCommands(engine, '')
  assert.deepEqual(filtered.map((command) => command.name), ['copy', 'settings', 'review', 'REVIEW-DIFF'])
})

test('matching is case-insensitive on name and description', () => {
  assert.deepEqual(filterCommands(engine, 'REVIEW').map((command) => command.name), ['review', 'REVIEW-DIFF'])
  assert.deepEqual(
    filterCommands(engine, 'latest diff').map((command) => command.name),
    ['REVIEW-DIFF']
  )
})

test('a name match ranks above a description-only match', () => {
  // 'review' matches by name; 'undo' matches only through its description.
  const commands = [
    { name: 'undo', description: 'redo the review' },
    { name: 'review', description: 'ask for a second pass' }
  ]
  const filtered = filterCommands(commands, 'review')
  assert.deepEqual(filtered.map((command) => command.name), ['review', 'undo'])
})

test('a query that matches nothing returns an empty list', () => {
  assert.deepEqual(filterCommands(engine, 'nonexistent'), [])
})

test('a command without a description never throws and still matches by name', () => {
  const filtered = filterCommands(engine, 'settings')
  assert.deepEqual(filtered.map((command) => command.name), ['settings'])
  // The description-only tier simply has no entry for it.
  assert.equal(filterCommands(engine, 'settings').length, 1)
})

test('a leading slash in the query does not break matching', () => {
  assert.deepEqual(filterCommands(engine, '/set').map((command) => command.name), ['settings'])
})

test('a first-character slash on an empty prompt opens the palette', () => {
  assert.equal(shouldOpenPalette('', '/'), true)
  assert.equal(shouldOpenPalette('', '/help'), true)
})

test('a slash mid-text does not open the palette', () => {
  assert.equal(shouldOpenPalette('hi', '/'), false)
  assert.equal(shouldOpenPalette('see src/', 'see src/app.ts'), false)
  assert.equal(shouldOpenPalette('', 'a/b'), false)
  assert.equal(shouldOpenPalette('/review', '/review more'), false)
})


test('skills stay out of the unfiltered list but a query brings them back', () => {
  const commands = [
    { name: 'gentle:status', description: 'Show status' },
    { name: 'skill:gentle-ai-skill-registry', description: 'Index available skills' },
    { name: 'skill:gentle-ai', description: 'Harness discipline' }
  ]

  assert.deepEqual(
    filterCommands(commands, '').map((command) => command.name),
    ['gentle:status'],
    'an unfiltered palette is not a wall of skills'
  )
  assert.deepEqual(
    filterCommands(commands, 'registry').map((command) => command.name),
    ['skill:gentle-ai-skill-registry'],
    'a specific query still finds the skill'
  )
  assert.equal(filterCommands(commands, 'skill').length, 2, 'typing skill lists them')
  assert.deepEqual(filterCommands(commands, '/skill').length, 2, 'the handed-over draft keeps its slash')
})
