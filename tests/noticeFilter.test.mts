import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shouldShowNotice } from '../src/renderer/src/state/noticeFilter.ts'

test('the skill registry refresh does not interrupt the composer', () => {
  assert.equal(shouldShowNotice('Skill registry refreshed (13 skills)'), false)
  assert.equal(shouldShowNotice('SKILL REGISTRY refreshed'), false, 'case is not the user’s problem')
})

test('every other notice still reaches the user', () => {
  assert.equal(shouldShowNotice('Skill registry watcher stopped: permission denied'), false)
  assert.equal(shouldShowNotice('Provider connected'), true)
  assert.equal(shouldShowNotice('Review approved for this candidate'), true)
  assert.equal(shouldShowNotice(''), true, 'an empty message is not ours to judge')
})
