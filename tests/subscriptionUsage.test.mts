import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  clearUsageCache,
  parseNanQuota,
  quotaUrlFor,
  readSubscriptionUsage
} from '../src/main/subscription-usage.ts'

function homeWithKey(providerId: string, key: string): string {
  const home = mkdtempSync(join(tmpdir(), 'gentle-desktop-usage-'))
  writeFileSync(join(home, 'auth.json'), JSON.stringify({ [providerId]: { type: 'api_key', key } }))
  return home
}

function fakeFetch(payload: unknown, calls: string[] = []): typeof fetch {
  return (async (url: string) => {
    calls.push(url)
    return { ok: true, json: async () => payload } as unknown as Response
  }) as unknown as typeof fetch
}

const NOW = 1_700_000_000_000

test('a well-formed quota reports one row per metered model', () => {
  const usage = parseNanQuota(
    {
      periodEnd: '2026-12-01T00:00:00.000Z',
      models: [
        { model: 'deepseek-v4-flash', tokensUsed: 50_000_000, fullCap: 200_000_000 },
        { model: 'glm5.3-flash', tokensUsed: 300_000_000, cap: 400_000_000 }
      ]
    },
    NOW
  )

  assert.equal(usage.provider, 'nan')
  assert.equal(usage.models.length, 2)
  assert.deepEqual(
    usage.models.map((model) => [model.id, Math.round(model.usedPercent), model.limitReached]),
    [
      ['deepseek-v4-flash', 25, false],
      ['glm5.3-flash', 75, false]
    ]
  )
  assert.equal(usage.models[0]?.resetAt, Date.parse('2026-12-01T00:00:00.000Z'))
})

test('a model with no readable allowance is skipped, never guessed', () => {
  const usage = parseNanQuota(
    {
      models: [
        { model: 'no-allowance', tokensUsed: 10 },
        { model: '', tokensUsed: 10, fullCap: 100 },
        { model: 'ok', tokensUsed: 10, fullCap: 100 },
        null,
        'nonsense'
      ]
    },
    NOW
  )

  assert.deepEqual(
    usage.models.map((model) => model.id),
    ['ok'],
    'only the entry that reports both an allowance and a usage survives'
  )
})

test('percentages are clamped, spent allowances are flagged, negative usage is dropped', () => {
  const usage = parseNanQuota(
    {
      models: [
        { model: 'over', tokensUsed: 500, fullCap: 100 },
        { model: 'negative', tokensUsed: -5, fullCap: 100 }
      ]
    },
    NOW
  )

  // Negative consumption is not clamped to zero: upstream's quota reader rejects it, and a
  // made-up zero would look like an untouched quota.
  assert.deepEqual(
    usage.models.map((model) => [model.id, model.usedPercent, model.limitReached]),
    [['over', 100, true]]
  )
})

test('a rolling window is reported when the payload carries one', () => {
  const withRolling = parseNanQuota(
    {
      models: [
        {
          model: 'm',
          tokensUsed: 10,
          fullCap: 100,
          windowTokensUsed: 50,
          fullWindowTokens: 200,
          windowResetsAt: 1_800_000_000
        }
      ]
    },
    NOW
  )
  const withoutRolling = parseNanQuota({ models: [{ model: 'm', tokensUsed: 10, fullCap: 100 }] }, NOW)

  assert.equal(withRolling.models[0]?.rolling?.usedPercent, 25)
  assert.equal(withRolling.models[0]?.rolling?.resetAt, 1_800_000_000_000)
  assert.equal(withoutRolling.models[0]?.rolling, null)
})

test('a provider without a quota endpoint is never fetched', async () => {
  clearUsageCache()
  const calls: string[] = []
  const home = homeWithKey('openai', 'sk-test')

  const usage = await readSubscriptionUsage({
    home,
    providerId: 'openai',
    fetchImpl: fakeFetch({ models: [] }, calls),
    now: () => NOW
  })

  assert.equal(usage, null)
  assert.equal(calls.length, 0, 'no request leaves the machine for a provider without a known endpoint')
  assert.equal(quotaUrlFor('openai'), null)
})

test('a missing credential means no request at all', async () => {
  clearUsageCache()
  const calls: string[] = []
  const home = mkdtempSync(join(tmpdir(), 'gentle-desktop-usage-nokey-'))

  const usage = await readSubscriptionUsage({
    home,
    providerId: 'nan',
    fetchImpl: fakeFetch({ models: [{ model: 'm', tokensUsed: 1, fullCap: 10 }] }, calls),
    now: () => NOW
  })

  assert.equal(usage, null)
  assert.equal(calls.length, 0)
})

test('a fresh value is reused and an expired one is refetched', async () => {
  clearUsageCache()
  const calls: string[] = []
  const home = homeWithKey('nan', 'sk-test')
  const payload = { models: [{ model: 'm', tokensUsed: 5, fullCap: 10 }] }
  let clock = NOW

  const first = await readSubscriptionUsage({
    home,
    providerId: 'nan',
    fetchImpl: fakeFetch(payload, calls),
    now: () => clock
  })
  assert.ok(first)
  assert.equal(calls.length, 1)

  clock = NOW + 30_000
  const cached = await readSubscriptionUsage({
    home,
    providerId: 'nan',
    fetchImpl: fakeFetch(payload, calls),
    now: () => clock
  })
  assert.ok(cached)
  assert.equal(calls.length, 1, 'inside the TTL the cached value is reused')

  clock = NOW + 61_000
  await readSubscriptionUsage({
    home,
    providerId: 'nan',
    fetchImpl: fakeFetch(payload, calls),
    now: () => clock
  })
  assert.equal(calls.length, 2, 'past the TTL the quota is read again')
})

test('a failed refresh reports nothing instead of a stale number', async () => {
  clearUsageCache()
  const home = homeWithKey('nan', 'sk-test')
  let clock = NOW

  const ok = await readSubscriptionUsage({
    home,
    providerId: 'nan',
    fetchImpl: fakeFetch({ models: [{ model: 'm', tokensUsed: 5, fullCap: 10 }] }),
    now: () => clock
  })
  assert.ok(ok)

  clock = NOW + 120_000
  const failing = (async () => {
    throw new Error('network down')
  }) as unknown as typeof fetch

  const stale = await readSubscriptionUsage({ home, providerId: 'nan', fetchImpl: failing, now: () => clock })
  assert.equal(stale, null, 'usage that silently ages is worse than no usage')
})
