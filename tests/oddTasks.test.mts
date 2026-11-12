import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { featureName, listOddTasks, parseOddTasksMarkdown } from '../src/main/odd-tasks.ts'
import { visibleRailSections } from '../src/renderer/src/state/railSections.ts'
import { emptyAgentActivity } from '../src/renderer/src/state/agentActivity.ts'

const MARKDOWN = [
  '# gentle-desktop — a desktop host',
  '',
  'S5.1 prose lines are never task items.',
  '',
  '## Tasks',
  '',
  '- [x] First done',
  '- [ ] Second open',
  '  - [ ] nested and ignored',
  '- [X] Third done, uppercase marker',
  '- [ ] last open',
  ''
].join('\n')

test('checkbox counts match the top-level list items only', () => {
  const parsed = parseOddTasksMarkdown(MARKDOWN)
  assert.equal(parsed.total, 4, 'nested checkboxes do not count')
  assert.equal(parsed.done, 2, '[x] and [X] both count as done')
  assert.deepEqual(parsed.open, ['Second open', 'last open'])
})

test('indented and prose lines are ignored even when they look like checkboxes', () => {
  const parsed = parseOddTasksMarkdown(['- [x] real', '  - [x] nested', '\t- [ ] tabbed', '- [ ] open'].join('\n'))
  assert.equal(parsed.total, 2)
  assert.equal(parsed.done, 1)
  assert.deepEqual(parsed.open, ['open'])
})

test('the feature name comes from the first heading, with the file name as fallback', () => {
  assert.equal(featureName(MARKDOWN, 'fallback'), 'gentle-desktop')
  assert.equal(featureName('No heading here\n- [x] a', 'tasks'), 'tasks')
})

test('a directory without odd/tasks yields an empty list', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'gentle-desktop-odd-'))
  try {
    assert.deepEqual(listOddTasks(scratch), [])
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('every markdown file becomes one feature with its own counts', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'gentle-desktop-odd-files-'))
  const tasksDir = join(scratch, 'odd', 'tasks')
  mkdirSync(tasksDir, { recursive: true })
  try {
    writeFileSync(join(tasksDir, 'alpha.md'), MARKDOWN)
    writeFileSync(join(tasksDir, 'beta.md'), '- [ ] only open\n')
    writeFileSync(join(tasksDir, 'notes.txt'), '- [x] not markdown\n')

    const features = listOddTasks(scratch)
    assert.equal(features.length, 2, 'only markdown files are read')
    const alpha = features.find((feature) => feature.feature === 'gentle-desktop')
    assert.ok(alpha)
    assert.equal(alpha.done, 2)
    assert.equal(alpha.total, 4)
    const beta = features.find((feature) => feature.feature === 'beta')
    assert.ok(beta)
    assert.deepEqual(beta.open, ['only open'])
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
})

test('an empty task list yields no Tasks section, and sections keep their fixed order', () => {
  const withoutTasks = visibleRailSections({ tasks: [], repo: null, sessionName: 'review' })
  assert.deepEqual(withoutTasks, ['status'], 'no Tasks header with a zero count')

  const withTasks = visibleRailSections({
    tasks: [{ feature: 'x', done: 0, total: 1, open: ['a'] }],
    repo: null,
    sessionName: 'review'
  })
  assert.deepEqual(withTasks, ['status', 'tasks'], 'Tasks follows Status, and nothing follows Tasks')
})
