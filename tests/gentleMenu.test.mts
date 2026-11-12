import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveGentleDestinations } from '../src/renderer/src/state/gentleMenu.ts'

const profileCommand = { name: 'gentle:profiles', description: 'Choose an agent model profile' }
const modeCommand = { name: 'gentle:permission', description: 'Set the permission mode' }

test('profiles and mode appear only when the engine exposes them', () => {
  const withCommands = resolveGentleDestinations([profileCommand, modeCommand])
  assert.deepEqual(
    withCommands.map((destination) => destination.id),
    ['profiles', 'mode', 'subagents', 'providers', 'commands']
  )
  assert.equal(withCommands[0]?.command, 'gentle:profiles')
  assert.equal(withCommands[1]?.command, 'gentle:permission')

  const withoutCommands = resolveGentleDestinations([])
  assert.deepEqual(
    withoutCommands.map((destination) => destination.id),
    ['subagents', 'providers', 'commands'],
    'a row that runs a command the engine does not have is worse than a missing row'
  )
})

test('a destination is matched by command name, never by description', () => {
  const tempting = { name: 'gentle:review', description: 'Review the profile of the change' }
  const ids = resolveGentleDestinations([tempting]).map((destination) => destination.id)

  assert.deepEqual(ids, ['subagents', 'providers', 'commands'], 'a description is not an identity')
})

test('the app surfaces are always present, in a fixed order', () => {
  const destinations = resolveGentleDestinations([profileCommand, modeCommand])
  const tail = destinations.slice(-3).map((destination) => destination.id)

  assert.deepEqual(tail, ['subagents', 'providers', 'commands'])
  assert.deepEqual(
    destinations.slice(-3).map((destination) => destination.command),
    [null, null, null],
    'these open an app window, they do not start a turn'
  )
})

test('every destination carries a label and a one-line detail', () => {
  for (const destination of resolveGentleDestinations([profileCommand, modeCommand])) {
    assert.ok(destination.label.length > 0)
    assert.ok(destination.detail.length > 0)
  }
})
