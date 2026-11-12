import { join } from 'node:path'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import type { AuthEvent, AuthInteraction, AuthPrompt, AuthType } from '@earendil-works/pi-ai'
import type { ProviderChoice } from '../shared/ipc.ts'

/**
 * Provider registration, driven by the app instead of a terminal.
 *
 * pi's CLI refuses to log in without a TTY, but the SDK behind it accepts an
 * `AuthInteraction`: the host answers the prompts. That is the whole trick — the app asks
 * the same questions the terminal would, and pi's own credential store writes the result
 * with the permissions it already uses. The app never parses or keeps secrets itself.
 *
 * The SDK is imported lazily because its root entry also pulls the terminal UI modules,
 * which cost about two seconds and are pointless unless the user opens the wizard.
 */

let cached: { home: string; runtime: Promise<ModelRuntime> } | null = null

async function createRuntime(home: string): Promise<ModelRuntime> {
  const { ModelRuntime: Runtime } = await import('@earendil-works/pi-coding-agent')
  return Runtime.create({
    authPath: join(home, 'auth.json'),
    modelsPath: join(home, 'models.json'),
    // Network stays off, but the create-time refresh must stay on: it is what loads
    // stored credentials into the status snapshot. With it disabled, every read reports
    // an already-configured provider as unconfigured, which reopens the setup window on
    // every launch.
    allowModelNetwork: false
  })
}

/** One runtime per agent home: the catalogue is static, so it is built once. */
async function runtimeFor(home: string): Promise<ModelRuntime> {
  if (cached?.home !== home) {
    cached = { home, runtime: createRuntime(home) }
  }
  return cached.runtime
}

/** Forget the cached runtime, so the next call re-reads credentials from disk. */
export function invalidateAuthRuntime(): void {
  cached = null
}

/**
 * Every provider the app can register, with the methods it supports and whether it is
 * already configured. Ambient-only providers are excluded: offering a button that cannot
 * work is worse than omitting it.
 */
export async function listProviderChoices(home: string): Promise<ProviderChoice[]> {
  const runtime = await runtimeFor(home)

  const choices: ProviderChoice[] = []
  for (const provider of runtime.getProviders()) {
    const supportsOauth = provider.auth.oauth !== undefined
    const supportsApiKey = provider.auth.apiKey?.login !== undefined
    if (!supportsOauth && !supportsApiKey) continue

    let configured = false
    try {
      configured = runtime.getProviderAuthStatus(provider.id).configured
    } catch {
      // A provider whose status cannot be read is offered as unconfigured.
    }

    choices.push({
      id: provider.id,
      name: provider.name,
      supportsOauth,
      supportsApiKey,
      ...(provider.auth.apiKey?.name ? { apiKeyLabel: provider.auth.apiKey.name } : {}),
      ...(provider.auth.oauth?.loginLabel ? { oauthLabel: provider.auth.oauth.loginLabel } : {}),
      configured
    })
  }

  choices.sort((left, right) => left.name.localeCompare(right.name))
  return choices
}

export async function providerConfigured(home: string, providerId: string): Promise<boolean> {
  const runtime = await runtimeFor(home)
  try {
    return runtime.getProviderAuthStatus(providerId).configured
  } catch {
    return false
  }
}

export type LoginResult = { ok: true } | { ok: false; error: string; cancelled?: boolean }

/**
 * Runs pi's own login for one provider. Errors are returned rather than thrown so the IPC
 * boundary never leaks a stack trace into the UI, and a cancelled prompt is reported as
 * a cancellation instead of a failure the user caused.
 */
export async function loginProvider(
  home: string,
  providerId: string,
  type: AuthType,
  interaction: AuthInteraction
): Promise<LoginResult> {
  const runtime = await runtimeFor(home)

  try {
    await runtime.login(providerId, type, interaction)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const cancelled = /abort|cancel/i.test(message)
    return { ok: false, error: cancelled ? 'Sign-in cancelled.' : message, ...(cancelled ? { cancelled: true } : {}) }
  }

  // The catalogue caches auth state, so a fresh runtime is what makes a follow-up status
  // read reflect the credential that was just stored.
  invalidateAuthRuntime()
  return { ok: true }
}

export type { AuthEvent, AuthInteraction, AuthPrompt, AuthType }
