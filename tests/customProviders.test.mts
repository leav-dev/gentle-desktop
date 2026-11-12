import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import {
  listCustomProviders,
  removeCustomProvider,
  saveCustomProvider
} from '../src/main/custom-providers.ts'

const created: string[] = []

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'gentle-desktop-models-'))
  created.push(home)
  return home
}

afterEach(() => {
  for (const home of created) rmSync(home, { recursive: true, force: true })
  created.length = 0
})

const BASE_INPUT = {
  id: 'my-provider',
  name: 'My Provider',
  serverAddress: 'https://api.example.com/v1',
  models: ['model-a'],
  apiKey: 'sk-secret'
}

/** One custom provider stored through the module, plus a hand-written key the app does not own. */
async function homeWithExisting(home: string): Promise<void> {
  const result = await saveCustomProvider(BASE_INPUT, home)
  assert.equal(result.ok, true)
  const file = join(home, 'models.json')
  const doc = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  doc['keepMe'] = { note: 'written by hand, must survive' }
  writeFileSync(file, JSON.stringify(doc, null, 2) + '\n', 'utf8')
}

test('a new provider merges into an existing file and the other providers and unknown keys survive', async () => {
  const home = tempHome()
  await homeWithExisting(home)

  const result = await saveCustomProvider(
    { ...BASE_INPUT, id: 'second', name: 'Second', models: ['m1', 'm2'] },
    home
  )
  assert.equal(result.ok, true)

  const listed = await listCustomProviders(home)
  assert.deepEqual(
    listed.map((entry) => entry.id),
    ['my-provider', 'second']
  )
  const kept = listed.find((entry) => entry.id === 'my-provider')
  assert.ok(kept)
  assert.equal(kept.name, 'My Provider')
  assert.equal(kept.serverAddress, 'https://api.example.com/v1')
  assert.deepEqual(kept.models, ['model-a'])

  // The other provider's entry and a key this app never wrote stay byte-for-byte present.
  const raw = readFileSync(join(home, 'models.json'), 'utf8')
  const parsed = JSON.parse(raw) as { keepMe?: unknown; providers: Record<string, unknown> }
  assert.deepEqual(parsed, {
    keepMe: { note: 'written by hand, must survive' },
    providers: {
      'my-provider': {
        name: 'My Provider',
        baseUrl: 'https://api.example.com/v1',
        api: 'openai-completions',
        models: [{ id: 'model-a' }]
      },
      second: {
        name: 'Second',
        baseUrl: 'https://api.example.com/v1',
        api: 'openai-completions',
        models: [{ id: 'm1' }, { id: 'm2' }]
      }
    }
  })
  assert.match(raw, /written by hand/)
})

test('saving the same id twice replaces it instead of duplicating', async () => {
  const home = tempHome()
  await homeWithExisting(home)

  const result = await saveCustomProvider(
    { ...BASE_INPUT, models: ['model-a', 'model-b'] },
    home
  )
  assert.equal(result.ok, true)

  const listed = await listCustomProviders(home)
  assert.equal(listed.length, 1)
  assert.deepEqual(listed[0]?.models, ['model-a', 'model-b'])
})

test('a malformed existing file is never overwritten: the write is refused and the original bytes survive', async () => {
  const home = tempHome()
  const file = join(home, 'models.json')
  const broken = '{"providers": { "old": '
  writeFileSync(file, broken, 'utf8')

  const result = await saveCustomProvider(BASE_INPUT, home)
  assert.equal(result.ok, false)
  assert.match(result.error, /Nothing was changed/i)
  assert.equal(readFileSync(file, 'utf8'), broken, 'original bytes must survive untouched')
  assert.deepEqual(
    readdirSync(home).filter((name) => name.endsWith('.tmp')),
    [],
    'no temp file may be left behind'
  )
  assert.deepEqual(await listCustomProviders(home), [], 'a malformed file lists as nothing, not a throw')
})

test('nan is refused, with the reason in the message', async () => {
  const home = tempHome()
  const result = await saveCustomProvider(
    { ...BASE_INPUT, id: 'nan', name: 'Nan again' },
    home
  )
  assert.equal(result.ok, false)
  assert.match(result.error, /nan/i)
  assert.match(result.error, /reserved|built-in/i)
  assert.equal(existsSync(join(home, 'models.json')), false, 'a refused save writes nothing')
})

test('http is refused for a public host and allowed for 127.0.0.1 and localhost', async () => {
  const home = tempHome()
  const publicResult = await saveCustomProvider(
    { ...BASE_INPUT, serverAddress: 'http://api.example.com/v1' },
    home
  )
  assert.equal(publicResult.ok, false)
  assert.match(publicResult.error, /https/i)
  assert.match(publicResult.error, /localhost|127\.0\.0\.1/)

  for (const host of ['http://127.0.0.1:11434/v1', 'http://localhost:11434/v1']) {
    const target = tempHome()
    const result = await saveCustomProvider({ ...BASE_INPUT, serverAddress: host }, target)
    assert.equal(result.ok, true, `${host} is loopback and must be allowed`)
    const listed = await listCustomProviders(target)
    assert.equal(listed[0]?.serverAddress, host)
  }
})

test('an empty model list is refused', async () => {
  const home = tempHome()
  const result = await saveCustomProvider({ ...BASE_INPUT, models: [] }, home)
  assert.equal(result.ok, false)
  assert.match(result.error, /at least one model/i)
  assert.equal(existsSync(join(home, 'models.json')), false)
})

test('a duplicate model id is refused', async () => {
  const home = tempHome()
  const result = await saveCustomProvider({ ...BASE_INPUT, models: ['m1', 'm1'] }, home)
  assert.equal(result.ok, false)
  assert.match(result.error, /more than once|m1/)
})

test('a missing API key is refused with a message, and never reaches the models file', async () => {
  const home = tempHome()
  const result = await saveCustomProvider({ ...BASE_INPUT, apiKey: '   ' }, home)
  assert.equal(result.ok, false)
  assert.match(result.error, /api key/i)
  assert.equal(existsSync(join(home, 'models.json')), false)
})

test('the write is atomic: after a simulated failure no partial file is left in the directory', async () => {
  const home = tempHome()
  await homeWithExisting(home)
  const file = join(home, 'models.json')
  const before = readFileSync(file, 'utf8')

  const result = await saveCustomProvider({ ...BASE_INPUT, models: ['model-b'] }, home, {
    simulateCrashAfterTempWrite: true
  })
  assert.equal(result.ok, false, 'the simulated crash must surface as a refusal')

  assert.equal(readFileSync(file, 'utf8'), before, 'the previous file stays byte-identical')
  assert.deepEqual(readdirSync(home), ['models.json'], 'the temp file is cleaned up, nothing partial remains')

  // Without a previous file, a crashed save must leave the directory empty, not half-written.
  const fresh = tempHome()
  const freshResult = await saveCustomProvider(BASE_INPUT, fresh, {
    simulateCrashAfterTempWrite: true
  })
  assert.equal(freshResult.ok, false)
  assert.deepEqual(readdirSync(fresh), [])
})

test('removing a provider keeps the others and unknown keys, and never leaves an empty providers object', async () => {
  const home = tempHome()
  await homeWithExisting(home)
  await saveCustomProvider({ ...BASE_INPUT, id: 'second', name: 'Second' }, home)

  const result = await removeCustomProvider('my-provider', home)
  assert.equal(result.ok, true)
  const listed = await listCustomProviders(home)
  assert.deepEqual(
    listed.map((entry) => entry.id),
    ['second']
  )
  const raw = JSON.parse(readFileSync(join(home, 'models.json'), 'utf8')) as Record<string, unknown>
  assert.ok(raw['keepMe'], 'unknown top-level keys survive a removal')

  // Removing the last provider must not leave {"providers": {}} behind.
  const last = await removeCustomProvider('second', home)
  assert.equal(last.ok, true)
  const tail = JSON.parse(readFileSync(join(home, 'models.json'), 'utf8')) as {
    providers?: unknown
  }
  assert.equal(tail.providers, undefined, 'an emptied providers map is dropped instead of written empty')
})
