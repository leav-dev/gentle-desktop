import assert from 'node:assert/strict'
import { test } from 'node:test'
import { visibleIntegrations } from '../src/renderer/src/state/railSections.ts'

test('the skill registry entry is not drawn, matched by key or by text', () => {
  const entries = [
    { key: 'nan', text: 'nan: ready' },
    { key: 'skill-registry', text: 'indexing skills' },
    { key: 'watcher', text: 'Skill registry refreshed' }
  ]

  assert.deepEqual(
    visibleIntegrations(entries).map((entry) => entry.key),
    ['nan'],
    'both spellings are caught: the key and the text the extension reports'
  )
})

test('everything else survives, in the order it arrived', () => {
  const entries = [
    { key: 'z', text: 'last' },
    { key: 'a', text: 'first' },
    { key: 'm', text: 'middle' }
  ]

  assert.deepEqual(
    visibleIntegrations(entries).map((entry) => entry.key),
    ['z', 'a', 'm']
  )
})

test('an empty list stays empty and the caller keeps its own copy', () => {
  const entries: { key: string; text: string }[] = []
  assert.deepEqual(visibleIntegrations(entries), [])

  const original = [{ key: 'skill-registry', text: 'gone' }, { key: 'nan', text: 'kept' }]
  const shown = visibleIntegrations(original)
  assert.equal(original.length, 2, 'the session keeps every entry; only the drawing changed')
  assert.equal(shown.length, 1)
})
