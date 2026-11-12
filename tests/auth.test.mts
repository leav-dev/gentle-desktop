import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import type { AuthInteraction, AuthPrompt } from '@earendil-works/pi-ai'
import type { ProviderChoice } from '../src/shared/ipc.ts'
import {
  invalidateAuthRuntime,
  listProviderChoices,
  loginProvider,
  providerConfigured
} from '../src/main/auth.ts'

/**
 * Tests for the app's auth module (src/main/auth.ts), not the raw SDK: these pin the
 * contract the setup window depends on — what is offered, what a login persists, and
 * what a cancellation reports. Every test runs against a fresh throwaway agent home, so
 * the user's real pi home is never touched and nothing needs the network
 * (`allowModelNetwork: false` and the api-key flow are offline by design).
 */

const TEST_KEY = 'sk-test-not-a-real-key'

function freshHome(): string {
  return mkdtempSync(join(tmpdir(), 'gentle-desktop-auth-'))
}

function authFile(home: string): string {
  return join(home, 'auth.json')
}

/** An interaction like the one the setup window's bridge implements: answers every prompt. */
function answeringInteraction(key: string): AuthInteraction & { seen: string[] } {
  const seen: string[] = []
  return {
    seen,
    prompt: async (prompt: AuthPrompt) => {
      seen.push(prompt.type)
      if (prompt.type === 'secret') return key
      if (prompt.type === 'select') {
        const first = prompt.options[0]
        assert.ok(first, 'a select prompt always offers at least one choice')
        return first.id
      }
      return 'test-value'
    },
    notify: () => {}
  }
}

/** An interaction like the bridge on a user cancellation: it rejects, never answers. */
function cancelledInteraction(): AuthInteraction {
  return {
    prompt: () => Promise.reject(new Error('sign-in cancelled')),
    notify: () => {}
  }
}

/** Anthropic's api-key login is the deterministic offline flow: one secret prompt, no network. */
function apiKeyProviderId(choices: readonly ProviderChoice[]): string {
  const anthropic = choices.find((choice) => choice.id === 'anthropic')
  assert.ok(anthropic, 'the bundled catalogue offers Anthropic')
  assert.ok(anthropic.supportsApiKey, 'Anthropic can be registered with an API key')
  return anthropic.id
}

test('listProviderChoices offers exactly the registerable providers, unconfigured on a fresh home', async () => {
  invalidateAuthRuntime()
  const home = freshHome()

  const choices = await listProviderChoices(home)
  assert.ok(choices.length > 0, 'the catalogue offers at least one provider')

  for (const choice of choices) {
    assert.ok(
      choice.supportsOauth || choice.supportsApiKey,
      `${choice.id} can actually be registered from the app`
    )
    assert.equal(choice.configured, false, `${choice.id} is not configured on a fresh home`)
    assert.equal(typeof choice.name, 'string')
  }

  // Cross-check against the raw catalogue: nothing login-capable was dropped, and no
  // ambient-only provider (no oauth, no interactive api-key login) was offered.
  const { ModelRuntime } = await import('@earendil-works/pi-coding-agent')
  const runtime = await ModelRuntime.create({
    authPath: authFile(home),
    modelsPath: join(home, 'models.json'),
    allowModelNetwork: false,
    refreshOnCreate: false
  })
  const registerable = runtime
    .getProviders()
    .filter((provider) => provider.auth.oauth !== undefined || provider.auth.apiKey?.login !== undefined)
    .map((provider) => provider.id)
    .sort()
  assert.deepEqual(
    choices.map((choice) => choice.id).sort(),
    registerable,
    'the offered list is exactly the registerable set'
  )
})

test('providerConfigured is false before and true after a successful login', async () => {
  invalidateAuthRuntime()
  const home = freshHome()
  const providerId = apiKeyProviderId(await listProviderChoices(home))

  assert.equal(await providerConfigured(home, providerId), false, 'nothing configured before login')

  const result = await loginProvider(home, providerId, 'api_key', answeringInteraction(TEST_KEY))
  assert.deepEqual(result, { ok: true })

  assert.equal(
    await providerConfigured(home, providerId),
    true,
    'the credential written by login is visible to a later status read'
  )
})

test('an api-key login answers the prompts and persists the credential to the home', async () => {
  invalidateAuthRuntime()
  const home = freshHome()
  const providerId = apiKeyProviderId(await listProviderChoices(home))
  const interaction = answeringInteraction(TEST_KEY)

  const result = await loginProvider(home, providerId, 'api_key', interaction)
  assert.deepEqual(result, { ok: true })
  assert.ok(interaction.seen.includes('secret'), 'the flow asked for the key through the interaction')

  const stored = JSON.parse(readFileSync(authFile(home), 'utf8')) as Record<string, { type?: string }>
  assert.equal(
    stored[providerId]?.type,
    'api_key',
    'the credential file in the redirected home records an api_key credential'
  )
  const entry = stored[providerId] as { key?: string } | undefined
  assert.ok(entry?.key, 'the answered key was persisted, not discarded')
})

test('a cancelled prompt reports a cancellation and stores no credential', async () => {
  invalidateAuthRuntime()
  const home = freshHome()

  const result = await loginProvider(home, 'anthropic', 'api_key', cancelledInteraction())
  assert.equal(result.ok, false, 'a rejected interaction fails the login')
  assert.equal(result.cancelled, true, 'the bridge-style rejection is a cancellation, not a failure')
  assert.equal(typeof result.error, 'string', 'a human-readable error text is returned')

  if (existsSync(authFile(home))) {
    const stored = JSON.parse(readFileSync(authFile(home), 'utf8')) as Record<string, unknown>
    assert.deepEqual(Object.keys(stored), [], 'no credential entry was persisted for the provider')
  }
})

test('invalidateAuthRuntime makes a later status read reflect the credential written on disk', async () => {
  invalidateAuthRuntime()
  const home = freshHome()
  await listProviderChoices(home) // populates the runtime cache for this home

  // A credential appears on disk the way a login leaves it.
  writeFileSync(
    authFile(home),
    JSON.stringify({ anthropic: { type: 'api_key', key: TEST_KEY } }, null, 2)
  )

  assert.equal(
    await providerConfigured(home, 'anthropic'),
    false,
    'the cached runtime still reports the old state'
  )
  invalidateAuthRuntime()
  assert.equal(
    await providerConfigured(home, 'anthropic'),
    true,
    'a fresh runtime reads the credential from disk'
  )
})
