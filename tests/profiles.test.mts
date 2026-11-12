import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseProfiles, readProfiles } from '../src/main/profiles.ts'
import { visibleRailSections } from '../src/renderer/src/state/railSections.ts'

const RAW = JSON.stringify({
  kind: 'gentle-pi.agent_model_profiles',
  version: 1,
  profiles: {
    current: {},
    base: { orchestrator: { model: 'opencode-go/deepseek-v4-flash' } },
    nan_builders: {
      orchestrator: { model: 'nan/deepseek-v4-flash' },
      'gentle-ai-explore': { model: 'nan/glm5.3-flash' },
      broken: { note: 'no model here' }
    }
  }
})

test('profiles are summarised by name and how many agents they configure', () => {
  const profiles = parseProfiles(RAW)

  assert.deepEqual(
    profiles.map((profile) => [profile.name, profile.agents]),
    [
      ['base', 1],
      ['nan_builders', 2]
    ],
    'current is an overrides holder, not a profile, and an entry without a model does not count'
  )
})

test('an unreadable profiles file yields no section instead of throwing', () => {
  assert.deepEqual(parseProfiles('not json'), [])
  assert.deepEqual(parseProfiles('[]'), [])
  assert.deepEqual(parseProfiles('{"profiles": 7}'), [])
  assert.deepEqual(readProfiles(join(mkdtempSync(join(tmpdir(), 'gentle-desktop-profiles-')), 'missing')), [])
})

test('profiles are read from the given config home', () => {
  const home = mkdtempSync(join(tmpdir(), 'gentle-desktop-profiles-home-'))
  writeFileSync(join(home, 'profiles.json'), RAW)

  assert.equal(readProfiles(home).length, 2)
})

test('integrations and profiles live inside Status and add no section of their own', () => {
  const sections = visibleRailSections({
    tasks: [{ feature: 'x', done: 0, total: 1, open: ['a'] }],
    activity: { counts: { running: 0, queued: 0, waiting: 0, finished: 0 }, tasks: [] },
    repo: null,
    sessionName: null,
    integrations: [{ key: 'btw', text: 'btw ready' }],
    profiles: [{ name: 'base', agents: 1 }]
  })

  assert.deepEqual(sections, ['status', 'tasks'], 'two sections, and the groups stay inside Status')
})

test('Status is first even when every other section is empty', () => {
  const sections = visibleRailSections({
    tasks: [],
    activity: { counts: { running: 0, queued: 0, waiting: 0, finished: 0 }, tasks: [] },
    repo: null,
    sessionName: null,
    integrations: [],
    profiles: []
  })

  assert.deepEqual(sections, ['status'])
})
