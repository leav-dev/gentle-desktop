import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SubscriptionUsage } from '../shared/ipc.ts'

/**
 * Subscription usage for providers that publish a quota endpoint.
 *
 * pi's RPC surface has none, so the app asks the provider directly with the credential pi
 * already stored, exactly as the terminal does. Mirrored from
 * `node_modules/gentle-pi/lib/shell-usage.ts` (`NAN_QUOTA_URL`, `parseNanQuota`):
 * a `models` array, one entry per metered model, with the period allowance in
 * `fullCap`/`cap` and the consumed amount in `tokensUsed`.
 *
 * Rules that must not be relaxed: the request is GET, refuses redirects, has a hard
 * timeout, and the credential never appears in a log, an error message or any other host.
 */

export const NAN_PROVIDER = 'nan'
export const NAN_QUOTA_URL = 'https://cloud-api.nan.builders/api/usage/quota'

const DEFAULT_WINDOW_TOKENS = 400_000_000
const CACHE_TTL_MS = 60_000
const TIMEOUT_MS = 5_000

interface RawNanModel {
  model?: unknown
  tokensUsed?: unknown
  fullCap?: unknown
  cap?: unknown
  periodEnd?: unknown
  windowTokensUsed?: unknown
  fullWindowTokens?: unknown
  windowTokens?: unknown
  windowHours?: unknown
  windowResetsAt?: unknown
}

function numberField(value: unknown, positive: boolean): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  if (positive) return value > 0 ? value : undefined
  return value >= 0 ? value : undefined
}

function timestampField(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value * 1000
  if (typeof value !== 'string') return null
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value))
}

/**
 * Parses the quota payload into one row per metered model.
 *
 * Every field is optional in this payload — it lives outside the provider's published
 * contract — so an entry that reports no allowance is skipped rather than guessed, and a
 * malformed entry never fails the whole read: a partial snapshot would understate usage.
 */
export function parseNanQuota(payload: unknown, now: number): SubscriptionUsage {
  const raw = (typeof payload === 'object' && payload !== null ? payload : {}) as {
    periodEnd?: unknown
    models?: unknown
  }

  const fallbackResetAt = timestampField(raw.periodEnd)
  const models: SubscriptionUsage['models'] = []

  if (Array.isArray(raw.models)) {
    for (const entry of raw.models) {
      if (typeof entry !== 'object' || entry === null) continue
      const model = entry as RawNanModel
      if (typeof model.model !== 'string' || model.model.length === 0) continue

      const allowance = numberField(model.fullCap, true) ?? numberField(model.cap, true)
      if (allowance === undefined) continue

      const used = numberField(model.tokensUsed, false)
      if (used === undefined) continue

      models.push({
        id: model.model,
        usedPercent: clampPercent((used / allowance) * 100),
        limitReached: used >= allowance,
        resetAt: timestampField(model.periodEnd) ?? fallbackResetAt,
        // The rolling sub-window, when the payload reports one.
        rolling: rollingWindow(model, now)
      })
    }
  }

  return { provider: NAN_PROVIDER, models, fetchedAt: now }
}

function rollingWindow(
  model: RawNanModel,
  now: number
): { usedPercent: number; resetAt: number | null } | null {
  const used = numberField(model.windowTokensUsed, false)
  if (used === undefined) return null
  const budget =
    numberField(model.fullWindowTokens, true) ??
    numberField(model.windowTokens, true) ??
    DEFAULT_WINDOW_TOKENS
  const resetAt = timestampField(model.windowResetsAt)
  void now
  return { usedPercent: clampPercent((used / budget) * 100), resetAt }
}

function credentialFor(home: string, providerId: string): string | null {
  const file = join(home, 'auth.json')
  if (!existsSync(file)) return null

  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const entry = parsed[providerId]
    if (typeof entry !== 'object' || entry === null) return null
    const key = (entry as { key?: unknown }).key
    return typeof key === 'string' && key.length > 0 ? key : null
  } catch {
    return null
  }
}

interface CacheEntry {
  usage: SubscriptionUsage
  at: number
}

export interface UsageOptions {
  home: string
  providerId: string
  fetchImpl?: typeof fetch
  now?: () => number
}

const cache = new Map<string, CacheEntry>()

/** Test seam: forget cached usage. */
export function clearUsageCache(): void {
  cache.clear()
}

export function quotaUrlFor(providerId: string): string | null {
  return providerId === NAN_PROVIDER ? NAN_QUOTA_URL : null
}

/**
 * Reads the quota for a provider, reusing a value younger than the TTL.
 *
 * A failed refresh returns null instead of a stale value: usage that silently ages is
 * worse than no usage, because the user would keep trusting a number that stopped moving.
 */
export async function readSubscriptionUsage(options: UsageOptions): Promise<SubscriptionUsage | null> {
  const url = quotaUrlFor(options.providerId)
  if (url === null) return null

  const now = options.now ?? Date.now
  const cached = cache.get(options.providerId)
  if (cached !== undefined && now() - cached.at < CACHE_TTL_MS) return cached.usage

  const key = credentialFor(options.home, options.providerId)
  if (key === null) return null

  const fetchImpl = options.fetchImpl ?? fetch
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' }
    })
    if (!response.ok) return null

    const payload: unknown = await response.json()
    const usage = parseNanQuota(payload, now())
    cache.set(options.providerId, { usage, at: now() })
    return usage
  } catch {
    // Never include the request in the error: it carries the credential.
    return null
  }
}
