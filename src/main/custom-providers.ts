import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  ConnectionTestInput,
  ConnectionTestResult,
  CustomProviderField,
  CustomProviderInput,
  CustomProviderResult,
  StoredCustomProvider
} from '../shared/ipc.ts'
import { resolveAgentHome } from './rpc/launch.ts'

/**
 * Custom providers (S16): the app writes pi's own configuration file so a provider that
 * needs its own server address can be added without editing anything by hand.
 *
 * The file is `<agent dir>/models.json`, where the agent dir is resolved exactly the way
 * `src/main/rpc/launch.ts` resolves it — the same directory the engine child is pointed
 * at, never a second guess. One malformed file disables every custom provider at engine
 * load, so this module is deliberately paranoid: it validates before writing, it merges
 * instead of replacing, and on any doubt the previous file is left byte-identical.
 *
 * Custody rule: the API key never enters models.json. It is validated here for presence,
 * then handed to the existing login flow, whose credential store writes `auth.json`.
 */

/** The engine falls back to the OpenAI-compatible chat API, which is what most custom servers speak. */
const DEFAULT_API = 'openai-completions'

const RESERVED_IDS = new Set(['nan'])

interface ProviderEntry {
  name?: unknown
  baseUrl?: unknown
  api?: unknown
  models?: unknown
}

interface ModelsDocument {
  providers?: unknown
  [key: string]: unknown
}

function modelsFile(home: string): string {
  return join(home, 'models.json')
}

/**
 * Reads and parses models.json, treating every absence as empty and every malformed
 * document as unreadable. Returns null when the file cannot be trusted, so callers can
 * refuse to write rather than clobber something they could not read.
 */
function readDocument(file: string): { doc: ModelsDocument; raw: string } | null {
  if (!existsSync(file)) return { doc: {}, raw: '' }
  try {
    // The engine strips the byte-order mark too; a BOM left by an editor must not turn
    // the whole file unreadable here.
    const raw = readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
    if (raw.trim().length === 0) return { doc: {}, raw }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    return { doc: parsed as ModelsDocument, raw }
  } catch {
    return null
  }
}

function providersOf(doc: ModelsDocument): Record<string, ProviderEntry> | null {
  const providers = doc.providers
  if (providers === undefined) return {}
  if (typeof providers !== 'object' || providers === null || Array.isArray(providers)) return null
  return providers as Record<string, ProviderEntry>
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLoopbackHost(hostname: string): boolean {
  const bare = hostname.replace(/^\[|\]$/g, '')
  return bare === 'localhost' || /^127(\.\d{1,3}){0,3}$/.test(bare) || bare === '::1'
}

/**
 * Full-address validation. Returns the human message when the address cannot be used.
 * `http` is allowed only for a server on this same computer, because sending an API key
 * unencrypted over the internet would hand it to anyone on the path.
 */
function validateServerAddress(address: string): string | null {
  if (address.trim().length === 0) return 'Please enter the server address.'
  let url: URL
  try {
    url = new URL(address.trim())
  } catch {
    return 'That server address does not look complete. Please enter the full address, starting with https://.'
  }
  if (url.protocol === 'https:') return null
  if (url.protocol === 'http:' && isLoopbackHost(url.hostname)) return null
  return (
    'For safety, plain http only works for a server on this same computer (localhost or 127.0.0.1). ' +
    'Anything on the internet needs an https address, so your key travels encrypted.'
  )
}

function normalizeModelIds(models: readonly string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const entry of models) {
    const id = entry.trim()
    // Blank entries come from extra commas or empty lines; they are noise, not a mistake.
    if (id.length === 0 || seen.has(id)) continue
    seen.add(id)
    normalized.push(id)
  }
  return normalized
}

interface ValidationFailure {
  error: string
  field: CustomProviderField
}

function validateInput(
  input: CustomProviderInput,
  providers: Record<string, ProviderEntry>
): ValidationFailure | null {
  const id = input.id.trim()
  if (!/^[a-z0-9-]+$/.test(id)) {
    return {
      error: 'Please pick a short provider name made of lowercase letters, numbers and dashes — for example my-provider.',
      field: 'id'
    }
  }
  if (RESERVED_IDS.has(id)) {
    return {
      error: "'nan' is reserved for the provider that ships with this app. Please pick a different name for yours.",
      field: 'id'
    }
  }
  const inputName = input.name.trim()
  if (inputName.length === 0) {
    return { error: 'Please give this provider a name.', field: 'name' }
  }
  const existing = providers[id]
  if (
    existing !== undefined &&
    isPlainObject(existing) &&
    typeof existing['name'] === 'string' &&
    existing['name'] !== inputName
  ) {
    return {
      error: `Another provider already uses the name "${id}". Please pick a different one.`,
      field: 'id'
    }
  }
  const addressFailure = validateServerAddress(input.serverAddress)
  if (addressFailure !== null) return { error: addressFailure, field: 'serverAddress' }

  const trimmedModels = input.models.map((entry) => entry.trim())
  const modelIds = trimmedModels.filter((id) => id.length > 0)
  if (modelIds.length === 0) {
    return {
      error: 'Please add at least one model id — you can find them on your provider\'s website.',
      field: 'models'
    }
  }
  const duplicate = trimmedModels.find((id, index) => id.length > 0 && trimmedModels.indexOf(id) !== index)
  if (duplicate !== undefined) {
    return {
      error: `"${duplicate}" is listed more than once. Each model only needs to be listed once.`,
      field: 'models'
    }
  }
  if (input.apiKey.trim().length === 0) {
    return {
      error: 'Please enter your API key. The app stores it safely in the sign-in store and never writes it into the provider list.',
      field: 'apiKey'
    }
  }
  return null
}

/**
 * Structural check of the whole merged document. This is the last line of defence before
 * the write: one entry the engine would reject disables every custom provider at load, so
 * the result must be trustworthy or nothing is written at all.
 */
function documentIsEngineSafe(doc: ModelsDocument): boolean {
  const providers = doc.providers
  if (providers === undefined) return true
  if (!isPlainObject(providers)) return false
  for (const entry of Object.values(providers)) {
    if (!isPlainObject(entry)) return false
    const provider = entry as ProviderEntry
    const models = provider.models
    if (models === undefined) continue
    if (!Array.isArray(models)) return false
    for (const model of models) {
      if (!isPlainObject(model)) return false
      if (typeof model['id'] !== 'string' || model['id'].length === 0) return false
    }
    // The engine needs an api and a baseUrl at provider level or on every model.
    const apiOk = typeof provider.api === 'string' || models.every((model) => typeof model['api'] === 'string')
    const urlOk =
      typeof provider.baseUrl === 'string' ||
      (models.length > 0 && models.every((model) => typeof model['baseUrl'] === 'string'))
    if (!apiOk || !urlOk) return false
  }
  return true
}

function buildProviderEntry(input: CustomProviderInput): Record<string, unknown> {
  return {
    name: input.name.trim(),
    baseUrl: input.serverAddress.trim(),
    api: DEFAULT_API,
    models: normalizeModelIds(input.models).map((id) => ({ id }))
  }
}

/**
 * Writes through a temp file in the same directory and a rename, so a crash can never
 * leave a half-written models.json behind — the engine would then disable every custom
 * provider it has. `simulateCrashAfterTempWrite` is a test seam that fails exactly
 * between the two steps, where a real crash would land.
 */
async function writeAtomically(
  file: string,
  contents: string,
  simulateCrashAfterTempWrite?: boolean
): Promise<void> {
  const temp = `${file}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, contents, 'utf8')
    if (simulateCrashAfterTempWrite === true) {
      throw new Error('simulated crash between temp write and rename')
    }
    await rename(temp, file)
  } catch (error) {
    // The temp file is ours alone; removing it cannot touch the user's data.
    await unlink(temp).catch(() => {})
    throw error
  }
}

function refusal(error: string, field: CustomProviderField): CustomProviderResult {
  return { ok: false, error, field }
}

/** Serialises the merged document the way the engine's own examples do. */
function serialize(doc: ModelsDocument): string {
  return `${JSON.stringify(doc, null, 2)}\n`
}

async function persistDocument(file: string, doc: ModelsDocument, simulateCrash?: boolean): Promise<CustomProviderResult> {
  if (!documentIsEngineSafe(doc)) {
    return refusal(
      'Something in the provider list would not be understood by the engine, so nothing was changed. Your existing providers are untouched.',
      'id'
    )
  }
  try {
    await writeAtomically(file, serialize(doc), simulateCrash)
  } catch {
    return refusal(
      'The provider list could not be saved. Nothing was changed — please try again.',
      'id'
    )
  }
  return { ok: true }
}

/**
 * One custom provider as the engine stores it: display name, server address, API type
 * and one entry per model id. Merging preserves every other provider and every unknown
 * key, because the same file may hold hand-written configuration this app does not own.
 */
export async function saveCustomProvider(
  input: CustomProviderInput,
  home: string = resolveAgentHome(),
  options: { simulateCrashAfterTempWrite?: boolean } = {}
): Promise<CustomProviderResult> {
  const file = modelsFile(home)
  const read = readDocument(file)
  if (read === null) {
    return refusal(
      'The provider list file could not be read, so nothing was changed. Your existing providers are untouched.',
      'id'
    )
  }
  const providers = providersOf(read.doc)
  if (providers === null) {
    return refusal(
      'The provider list file has an unexpected shape, so nothing was changed. Your existing providers are untouched.',
      'id'
    )
  }

  const failure = validateInput(input, providers)
  if (failure !== null) return refusal(failure.error, failure.field)

  const merged: ModelsDocument = { ...read.doc }
  merged['providers'] = { ...providers, [input.id.trim()]: buildProviderEntry(input) }

  return persistDocument(file, merged, options.simulateCrashAfterTempWrite)
}

/** Removes one provider under the same merge rules a save follows. */
export async function removeCustomProvider(
  id: string,
  home: string = resolveAgentHome()
): Promise<CustomProviderResult> {
  const file = modelsFile(home)
  const read = readDocument(file)
  // Nothing stored yet: removing is already done.
  if (read === null) return { ok: true }
  const providers = providersOf(read.doc)
  if (providers === null) {
    return refusal(
      'The provider list file has an unexpected shape, so nothing was changed. Your existing providers are untouched.',
      'id'
    )
  }
  if (!(id in providers)) return { ok: true }

  // Never leave `{"providers": {}}` behind as a surprise: drop the empty map, and drop
  // the file entirely when nothing else is left in it.
  const remaining = { ...providers }
  delete remaining[id]
  const doc: ModelsDocument = { ...read.doc }
  if (Object.keys(remaining).length > 0) doc['providers'] = remaining
  else delete doc['providers']

  if (Object.keys(doc).length === 0) {
    try {
      await unlink(file)
    } catch {
      return refusal('The provider could not be removed. Please try again.', 'id')
    }
    return { ok: true }
  }

  return persistDocument(file, doc)
}

/**
 * The stored custom providers, without secrets. Every absence — no file, empty file,
 * unreadable file — is an empty list, never a throw: an unreadable file must not break
 * the window that offers the catalogue.
 */
export async function listCustomProviders(home: string = resolveAgentHome()): Promise<StoredCustomProvider[]> {
  const read = readDocument(modelsFile(home))
  if (read === null) return []
  const providers = providersOf(read.doc)
  if (providers === null) return []

  const stored: StoredCustomProvider[] = []
  for (const [id, entry] of Object.entries(providers)) {
    if (!isPlainObject(entry)) continue
    const provider = entry as ProviderEntry
    const models: string[] = Array.isArray(provider.models)
      ? provider.models
          .filter(isPlainObject)
          .map((model) => model['id'])
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []
    stored.push({
      id,
      name: typeof provider.name === 'string' && provider.name.length > 0 ? provider.name : id,
      serverAddress: typeof provider.baseUrl === 'string' ? provider.baseUrl : '',
      models
    })
  }
  return stored
}

const TEST_TIMEOUT_MS = 8_000

/**
 * Asks the server whether it accepts the key, so the user learns about a mistake before
 * saving. `GET <baseUrl>/models` with the key, a hard timeout and no redirect following.
 *
 * Many compatible servers do not implement that endpoint, so a 404 or 405 is reported as
 * "could not check automatically" — never as invalid. Only 401/403 means the key was
 * actually refused; anything else, including the server not answering, is reported as its
 * own outcome.
 */
export async function testConnection(input: ConnectionTestInput): Promise<ConnectionTestResult> {
  const addressFailure = validateServerAddress(input.serverAddress)
  if (addressFailure !== null) return { status: 'could_not_check', message: addressFailure }
  if (input.apiKey.trim().length === 0) {
    return { status: 'key_rejected', message: 'Please enter your API key first, then test again.' }
  }

  let response: Response
  try {
    response = await fetch(input.serverAddress.trim().replace(/\/$/, '') + '/models', {
      method: 'GET',
      // The key must not be replayed against wherever a redirect points.
      redirect: 'manual',
      headers: { Authorization: `Bearer ${input.apiKey.trim()}` },
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS)
    })
  } catch (error) {
    // AbortSignal.timeout rejects with a DOMException named TimeoutError, while a dead
    // address arrives as a plain TypeError, so the two failures can be told apart. A
    // hung server must be reported as its own outcome, not with the words for a server
    // that is unreachable.
    const timedOut = error instanceof Error && error.name === 'TimeoutError'
    return {
      status: 'no_answer',
      message: timedOut
        ? 'The server took too long to answer, so the check was stopped. Please check the address and try again.'
        : 'The server did not answer. Please check the address and your connection, then try again.'
    }
  }

  if (response.status >= 200 && response.status < 300) {
    return { status: 'reachable', message: 'Connected. The server answered and accepted your key.' }
  }
  if (response.status === 401 || response.status === 403) {
    return {
      status: 'key_rejected',
      message: 'The key was not accepted by the server. Please check the key and try again.'
    }
  }
  if (response.status === 404 || response.status === 405) {
    return {
      status: 'could_not_check',
      message:
        'The server answered, but it does not offer the check this app uses, so the key could not be verified automatically. You can still save the provider and try it in a conversation.'
    }
  }
  return {
    status: 'could_not_check',
    message:
      'The server answered in an unexpected way, so the key could not be checked automatically. You can still save the provider and try it in a conversation.'
  }
}
