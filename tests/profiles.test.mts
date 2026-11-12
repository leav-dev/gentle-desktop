import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parseProfiles, readProfiles, resolveActiveProfile } from '../src/main/profiles.ts'
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


function homeWithProfiles(profiles: object): string {
  const home = mkdtempSync(join(tmpdir(), 'gentle-desktop-active-profile-'))
  writeFileSync(join(home, 'profiles.json'), JSON.stringify({ kind: 'x', version: 1, profiles }))
  return home
}

test('an explicit record wins over any model match', () => {
  const home = homeWithProfiles({
    current: { profile: 'base' },
    base: { orchestrator: { model: 'nan/other' } },
    nan_builders: { orchestrator: { model: 'nan/deepseek-v4-flash' } }
  })

  assert.deepEqual(resolveActiveProfile(home, 'nan/deepseek-v4-flash'), { name: 'base' })
})

test('the profile whose orchestrator model matches the session is the active one', () => {
  const home = homeWithProfiles({
    current: {},
    base: { orchestrator: { model: 'opencode-go/deepseek-v4-flash' } },
    nan_builders: { orchestrator: { model: 'nan/deepseek-v4-flash' } }
  })

  assert.deepEqual(resolveActiveProfile(home, 'nan/deepseek-v4-flash'), { name: 'nan_builders' })
})

test('two profiles matching the same model resolve to nothing', () => {
  const home = homeWithProfiles({
    current: {},
    a: { orchestrator: { model: 'nan/deepseek-v4-flash' } },
    b: { orchestrator: { model: 'nan/deepseek-v4-flash' } }
  })

  assert.equal(
    resolveActiveProfile(home, 'nan/deepseek-v4-flash'),
    null,
    'a wrong label would describe a session it does not match'
  )
})

test('no match, no model and no file all resolve to nothing', () => {
  const home = homeWithProfiles({ current: {}, base: { orchestrator: { model: 'a/b' } } })

  assert.equal(resolveActiveProfile(home, 'x/y'), null)
  assert.equal(resolveActiveProfile(home, null), null)
  assert.equal(resolveActiveProfile(join(home, 'missing'), 'a/b'), null)
  assert.equal(resolveActiveProfile(home, ''), null)
})
