import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { parsePermissionMode, permissionModeFile, readPermissionMode } from '../src/main/permission-mode.ts'

function scratchHome(): string {
  return mkdtempSync(join(tmpdir(), 'gentle-desktop-mode-'))
}

test('a persisted mode is read back exactly', () => {
  for (const mode of ['normal', 'auto', 'yolo', 'super-yolo'] as const) {
    assert.equal(parsePermissionMode(JSON.stringify({ schema: 'gentle-pi.permission-mode/v1', mode })), mode)
  }
})

test('an unreadable preference falls back to the guarded mode', () => {
  // Being wrong towards "normal" hides a badge; being wrong the other way would claim the
  // agent is unguarded when it is not.
  assert.equal(parsePermissionMode('not json'), 'normal')
  assert.equal(parsePermissionMode('[]'), 'normal')
  assert.equal(parsePermissionMode('null'), 'normal')
  assert.equal(parsePermissionMode('{"schema":"x"}'), 'normal')
  assert.equal(parsePermissionMode('{"mode":"turbo"}'), 'normal')
  assert.equal(parsePermissionMode('{"mode":7}'), 'normal')
})

test('a different schema value does not hide a readable mode', () => {
  assert.equal(parsePermissionMode(JSON.stringify({ schema: 'some.future/schema', mode: 'yolo' })), 'yolo')
})

test('a missing file reports the guarded mode', () => {
  const home = scratchHome()
  assert.equal(readPermissionMode(home), 'normal')
})

test('the file is read from the given config home', () => {
  const home = scratchHome()
  writeFileSync(join(home, 'permission-mode.json'), JSON.stringify({ schema: 's', mode: 'super-yolo' }))

  assert.equal(permissionModeFile(home), join(home, 'permission-mode.json'))
  assert.equal(readPermissionMode(home), 'super-yolo')
})
