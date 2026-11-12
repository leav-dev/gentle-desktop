import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { listSessions, parseSessionFile } from '../src/main/sessions.ts'

function scratchHome(): { home: string; group: string } {
  const home = mkdtempSync(join(tmpdir(), 'gentle-desktop-sessions-'))
  const group = join(home, 'sessions', '--C--proj--')
  mkdirSync(group, { recursive: true })
  return { home, group }
}

function writeSession(group: string, file: string, lines: object[]): string {
  const path = join(group, file)
  writeFileSync(path, lines.map((line) => JSON.stringify(line)).join('\n') + '\n')
  return path
}

const header = (id: string, timestamp: string, cwd = '/proj') => ({ type: 'session', version: 3, id, timestamp, cwd })

test('a session is summarised from its header, its first user message, and its latest name', () => {
  const { group } = scratchHome()
  const path = writeSession(group, '2024-12-03T14-00-00_abc.jsonl', [
    header('abc', '2024-12-03T14:00:00.000Z'),
    {
      type: 'message',
      id: 'm1',
      parentId: null,
      timestamp: '2024-12-03T14:00:01.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'arreglá\n el   parser' }] }
    },
    {
      type: 'message',
      id: 'm2',
      parentId: 'm1',
      timestamp: '2024-12-03T14:00:02.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'listo' }] }
    },
    {
      type: 'session_info',
      id: 'n1',
      parentId: 'm2',
      timestamp: '2024-12-03T14:35:00.000Z',
      name: 'Parser'
    }
  ])

  const summary = parseSessionFile(path)
  assert.ok(summary)
  assert.equal(summary.id, 'abc')
  assert.equal(summary.cwd, '/proj')
  assert.equal(summary.timestamp, '2024-12-03T14:00:00.000Z')
  assert.equal(summary.name, 'Parser', 'the latest session_info name wins')
  assert.equal(summary.preview, 'arreglá el parser', 'the preview is collapsed for a single row')
  assert.equal(summary.messageCount, 2, 'only conversation entries are counted')
  assert.ok(summary.sizeBytes > 0)
})

test('the newest name wins when a session was renamed more than once', () => {
  const { group } = scratchHome()
  const path = writeSession(group, '2024-12-03T14-00-00_abc.jsonl', [
    header('abc', '2024-12-03T14:00:00.000Z'),
    { type: 'session_info', id: 'n1', parentId: null, timestamp: '2024-12-03T14:10:00.000Z', name: 'Old' },
    { type: 'session_info', id: 'n2', parentId: 'n1', timestamp: '2024-12-03T14:20:00.000Z', name: 'New' }
  ])

  assert.equal(parseSessionFile(path)?.name, 'New')
})

test('a session with a truncated tail is still listed', () => {
  const { group } = scratchHome()
  const path = join(group, '2024-12-03T14-00-00_trunc.jsonl')
  writeFileSync(
    path,
    `${JSON.stringify(header('trunc', '2024-12-03T14:00:00.000Z'))}\n{"type":"message","message":{"role":"user","content":"hola"}}\n{"type":"mess`
  )

  const summary = parseSessionFile(path)
  assert.ok(summary, 'a half-written session is not dropped')
  assert.equal(summary.id, 'trunc')
  assert.equal(summary.preview, 'hola')
})

test('a file without a usable header is listed without inventing an identity', () => {
  const { group } = scratchHome()
  const path = join(group, 'broken.jsonl')
  writeFileSync(path, 'not json at all\n')

  const summary = parseSessionFile(path)
  assert.ok(summary)
  assert.equal(summary.id, '')
  assert.equal(summary.name, null)
  assert.equal(summary.preview, null)
  assert.equal(summary.messageCount, 0)
})

test('listing returns every readable session newest first and ignores other files', () => {
  const { home, group } = scratchHome()
  writeSession(group, 'old.jsonl', [header('old', '2024-01-01T00:00:00.000Z')])
  writeSession(group, 'mid.jsonl', [header('mid', '2024-06-01T00:00:00.000Z')])
  writeSession(group, 'new.jsonl', [header('new', '2024-12-01T00:00:00.000Z')])
  writeFileSync(join(group, 'notes.txt'), 'ignore me')
  mkdirSync(join(home, 'sessions', 'not-a-group.jsonl'), { recursive: true })

  const sessions = listSessions(home)
  assert.deepEqual(
    sessions.map((session) => session.id),
    ['new', 'mid', 'old']
  )
  assert.equal(sessions.length, 3, 'non-session files and stray directories are ignored')
})

test('an absent sessions directory lists nothing instead of throwing', () => {
  const home = mkdtempSync(join(tmpdir(), 'gentle-desktop-empty-'))
  assert.deepEqual(listSessions(home), [])
})
