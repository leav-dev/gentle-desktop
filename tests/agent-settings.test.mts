import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { test } from 'node:test'
import { ensureAgentSettingsForDesktop } from '../src/main/agent-settings.ts'

test('ensureAgentSettingsForDesktop adds -builtin:codemode to a new home', () => {
  const home = mkdtempSync(join(tmpdir(), 'gentle-desktop-settings-'))
  ensureAgentSettingsForDesktop(home)
  const text = readFileSync(join(home, 'settings.json'), 'utf8')
  const settings = JSON.parse(text) as { extensions: string[] }
  assert.ok(settings.extensions.includes('-builtin:codemode'))
})