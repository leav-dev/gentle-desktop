import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ACTIVITY_SCHEMA,
  ACTIVITY_WIDGET_KEY,
  emptyAgentActivity,
  parseAgentActivity
} from '../src/renderer/src/state/agentActivity.ts'
import { visibleRailSections } from '../src/renderer/src/state/railSections.ts'

function activityPayload(tasks: unknown[]): string {
  return JSON.stringify({
    schema: ACTIVITY_SCHEMA,
    summary: { running: 1, queued: 0, waiting: 1, finished: 2 },
    tasks
  })
}

const RUNNING_TASK = {
  summary: {
    id: 't_abc123',
    agent: 'explore',
    label: 'Map the auth module',
    prompt: 'Explore how authentication works…',
    status: 'running',
    lastStep: 'reading lib/auth.ts'
  },
  thread: { version: 7, dropped: 0, items: [] }
}

test('the activity payload is published under the gentle-agents widget key', () => {
  assert.equal(ACTIVITY_WIDGET_KEY, 'gentle-agents')
  assert.equal(ACTIVITY_SCHEMA, 'gentle-agents.activity/v1')
})

test('a well-formed payload yields the counts and one row per task', () => {
  const activity = parseAgentActivity(activityPayload([RUNNING_TASK]))
  assert.deepEqual(activity.counts, { running: 1, queued: 0, waiting: 1, finished: 2 })
  assert.equal(activity.tasks.length, 1)
  assert.equal(activity.tasks[0]?.label, 'Map the auth module')
  assert.equal(activity.tasks[0]?.status, 'running')
  assert.equal(activity.tasks[0]?.agent, 'explore')
  assert.equal(activity.tasks[0]?.lastStep, 'reading lib/auth.ts')
})

test('a task without a label falls back to its prompt', () => {
  const activity = parseAgentActivity(
    activityPayload([{ summary: { prompt: 'Explore the codebase', status: 'queued' }, thread: null }])
  )
  assert.equal(activity.tasks[0]?.label, 'Explore the codebase')
  assert.equal(activity.tasks[0]?.status, 'queued')
})

test('a malformed payload degrades to an empty section and never throws', () => {
  for (const broken of ['not json', '', 'null', '42', '{"schema":"other/v9"}', '"[object]"', '[1,2,3]']) {
    assert.deepEqual(parseAgentActivity(broken), emptyAgentActivity(), `payload: ${broken}`)
  }
})

test('a partial payload yields empty counts without losing the parseable parts', () => {
  assert.deepEqual(parseAgentActivity('{"schema":"gentle-agents.activity/v1"}'), emptyAgentActivity())
  const summaryOnly = parseAgentActivity(
    '{"schema":"gentle-agents.activity/v1","summary":{"running":2},"tasks":"gone"}'
  )
  assert.equal(summaryOnly.counts.running, 2)
  assert.equal(summaryOnly.tasks.length, 0)
})

test('null and undefined payloads (no widget push yet) yield an empty section', () => {
  assert.deepEqual(parseAgentActivity(null), emptyAgentActivity())
  assert.deepEqual(parseAgentActivity(undefined), emptyAgentActivity())
})

test('empty helper activity leaves no Helpers section in the rail', () => {
  const sections = visibleRailSections({
    tasks: [{ feature: 'x', done: 0, total: 1, open: ['a'] }],
    activity: emptyAgentActivity(),
    repo: { branch: 'main', dirtyCount: 1, added: 1, removed: 0, files: ['a'] },
    sessionName: null
  })
  assert.deepEqual(sections, ['tasks', 'status'])
})

test('the rail keeps the fixed order Tasks → Helpers → Status', () => {
  const sections = visibleRailSections({
    tasks: [{ feature: 'x', done: 0, total: 1, open: ['a'] }],
    activity: {
      counts: { running: 1, queued: 0, waiting: 0, finished: 0 },
      tasks: [{ label: 'a', status: 'running', agent: 'x', lastStep: '' }]
    },
    repo: { branch: 'main', dirtyCount: 1, added: 1, removed: 0, files: ['a'] },
    sessionName: 'review'
  })
  assert.deepEqual(sections, ['tasks', 'helpers', 'status'])
})
