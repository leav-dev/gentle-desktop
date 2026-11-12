import { useMemo, useState } from 'react'
import type { ConnectionTestResult } from '../../../shared/ipc.ts'

/**
 * The form that adds a custom provider without a terminal (S16): name, server address,
 * API key and model ids, submitted to the main process where pi's own files are written.
 *
 * The renderer never validates deeply — the module that owns the file is the single
 * authority — but it keeps every message next to the field that caused it, keeps Save
 * disabled while it cannot succeed, and hands the typed key straight to the sign-in flow,
 * whose credential store is the only place it is persisted.
 */

type FieldKey = 'name' | 'address' | 'key' | 'models'

type FieldErrors = { [K in FieldKey]?: string }

type Busy = null | 'testing' | 'saving'

interface Note {
  tone: 'info' | 'success' | 'warning'
  message: string
}

/** Model ids come as one per line or comma-separated, whatever the user finds natural. */
function parseModelIds(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

/** The provider id the engine stores under, derived from the display name. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function firstDuplicate(ids: readonly string[]): string | null {
  for (let index = 0; index < ids.length; index += 1) {
    const id = ids[index]
    if (id !== undefined && ids.indexOf(id) !== index) return id
  }
  return null
}

/** Maps the main process's field hint onto the form's own field keys. */
function fieldOf(result: { field?: 'id' | 'name' | 'serverAddress' | 'models' | 'apiKey' }): FieldKey {
  if (result.field === 'apiKey') return 'key'
  if (result.field === 'serverAddress') return 'address'
  if (result.field === 'models') return 'models'
  // The id is derived from the name here, so an id problem is a name problem.
  return 'name'
}

export function CustomProviderForm({
  onBack,
  onSaved
}: {
  onBack: () => void
  onSaved: (providerId: string) => void
}): React.JSX.Element {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [key, setKey] = useState('')
  const [modelsText, setModelsText] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [note, setNote] = useState<Note | null>(null)
  const [busy, setBusy] = useState<Busy>(null)

  const modelIds = useMemo(() => parseModelIds(modelsText), [modelsText])
  const duplicateModel = useMemo(() => firstDuplicate(modelIds), [modelIds])

  const setFieldError = (field: FieldKey, message: string): void => {
    setErrors((previous) => ({ ...previous, [field]: message }))
  }

  const clearMessages = (): void => {
    setErrors({})
    setNote(null)
  }

  const canSave =
    name.trim().length > 0 &&
    address.trim().length > 0 &&
    key.trim().length > 0 &&
    modelIds.length > 0 &&
    duplicateModel === null &&
    busy === null

  const runTest = async (): Promise<void> => {
    clearMessages()
    setBusy('testing')
    let result: ConnectionTestResult
    try {
      result = await window.gentle.customProviders.testConnection({
        serverAddress: address.trim(),
        apiKey: key.trim()
      })
    } catch {
      setNote({ tone: 'warning', message: 'The check could not be started. Please try again.' })
      setBusy(null)
      return
    }
    setBusy(null)
    if (result.status === 'reachable') setNote({ tone: 'success', message: result.message })
    else if (result.status === 'key_rejected') setFieldError('key', result.message)
    else setNote({ tone: 'warning', message: result.message })
  }

  const runSave = async (): Promise<void> => {
    clearMessages()
    setBusy('saving')
    const id = slugify(name)
    const typedKey = key.trim()

    let saved: Awaited<ReturnType<typeof window.gentle.customProviders.save>>
    try {
      saved = await window.gentle.customProviders.save({
        id,
        name: name.trim(),
        serverAddress: address.trim(),
        models: modelIds,
        apiKey: typedKey
      })
    } catch {
      setNote({ tone: 'warning', message: 'The provider could not be saved. Please try again.' })
      setBusy(null)
      return
    }
    if (!saved.ok) {
      setFieldError(fieldOf(saved), saved.error)
      setBusy(null)
      return
    }

    // The key goes through the existing sign-in flow: pi asks for it as usual, and the
    // answer it is given here is the one the user already typed. Nothing is stored by
    // this form — the credential store writes it.
    const login = await window.gentle.auth.login({ providerId: id, type: 'api_key', apiKey: typedKey })
    if (!login.ok) {
      setNote({
        tone: 'warning',
        message: `The provider was saved, but signing in did not finish: ${login.error}`
      })
      setBusy(null)
      return
    }

    setNote({ tone: 'info', message: 'Restarting the engine so the new provider is picked up…' })
    try {
      await window.gentle.host.restart()
    } catch {
      setNote({
        tone: 'warning',
        message:
          'The provider was saved and signed in. The engine could not be restarted from here — it will pick the provider up the next time the app starts.'
      })
      setBusy(null)
      return
    }
    onSaved(id)
  }

  return (
    <form
      className="wizard-form"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSave) void runSave()
      }}
    >
      <p className="wizard-form-intro">
        For providers with their own server address. The address and key stay in the app —
        no file editing needed.
      </p>

      <div className="wizard-field">
        <label htmlFor="custom-provider-name">Name</label>
        <input
          id="custom-provider-name"
          className="wizard-input"
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={errors['name'] !== undefined}
        />
        {errors['name'] !== undefined ? (
          <p className="wizard-field-error" role="alert">
            {errors['name']}
          </p>
        ) : null}
      </div>

      <div className="wizard-field">
        <label htmlFor="custom-provider-address">Server address</label>
        <input
          id="custom-provider-address"
          className="wizard-input"
          type="text"
          placeholder="https://…"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={errors['address'] !== undefined}
        />
        {errors['address'] !== undefined ? (
          <p className="wizard-field-error" role="alert">
            {errors['address']}
          </p>
        ) : null}
      </div>

      <div className="wizard-field">
        <label htmlFor="custom-provider-key">API key</label>
        <input
          id="custom-provider-key"
          className="wizard-input"
          type="password"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          autoComplete="off"
          aria-invalid={errors['key'] !== undefined}
        />
        {errors['key'] !== undefined ? (
          <p className="wizard-field-error" role="alert">
            {errors['key']}
          </p>
        ) : null}
      </div>

      <div className="wizard-field">
        <label htmlFor="custom-provider-models">Models</label>
        <textarea
          id="custom-provider-models"
          className="wizard-input wizard-textarea"
          value={modelsText}
          onChange={(event) => setModelsText(event.target.value)}
          placeholder={'one model id per line, or separated by commas'}
          spellCheck={false}
          aria-invalid={errors['models'] !== undefined || duplicateModel !== null}
        />
        <p className="wizard-field-hint">One model id per line, or separated by commas.</p>
        {duplicateModel !== null ? (
          <p className="wizard-field-error" role="alert">
            "{duplicateModel}" is listed more than once. Each model only needs to be listed once.
          </p>
        ) : errors['models'] !== undefined ? (
          <p className="wizard-field-error" role="alert">
            {errors['models']}
          </p>
        ) : null}
      </div>

      {note !== null ? (
        <div className={`wizard-note wizard-note-${note.tone}`} role="status">
          {note.message}
        </div>
      ) : null}

      <div className="wizard-form-actions">
        <button
          type="button"
          className="wizard-method"
          disabled={busy !== null || address.trim().length === 0 || key.trim().length === 0}
          onClick={() => {
            void runTest()
          }}
        >
          {busy === 'testing' ? 'Testing…' : 'Test'}
        </button>
        <button
          type="button"
          className="wizard-method wizard-method-primary"
          disabled={!canSave}
          onClick={() => {
            void runSave()
          }}
        >
          {busy === 'saving' ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="wizard-method" disabled={busy !== null} onClick={onBack}>
          Back
        </button>
      </div>
    </form>
  )
}
