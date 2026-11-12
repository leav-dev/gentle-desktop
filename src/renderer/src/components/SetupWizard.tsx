import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AuthEventEnvelope,
  AuthLoginResult,
  AuthMethod,
  AuthPromptRequest,
  ProviderChoice
} from '../../../shared/ipc.ts'

/**
 * The first-run setup window (S8/S9): provider registration driven entirely by the app.
 * It renders the questions pi asks during login — one at a time — and the events the
 * sign-in flow produces, so the user never leaves the app window. Secrets are kept in a
 * password input and are never logged; errors are shown as human text only, never as
 * stack traces or internal details.
 */

type TimelineItem =
  | { kind: 'link'; id: number; message: string | null; url: string }
  | {
      kind: 'code'
      id: number
      userCode: string
      verificationUri: string
      expiresInSeconds: number | null
    }
  | { kind: 'info'; id: number; message: string; links: { url: string; label: string | null }[] }

/** A finished login that failed, kept as display-ready text from the main process. */
type Outcome = { message: string; cancelled: boolean }

function methodButtons(provider: ProviderChoice): { method: AuthMethod; label: string }[] {
  const buttons: { method: AuthMethod; label: string }[] = []
  // Built conditionally: the provider decides which methods exist at all.
  if (provider.supportsOauth) {
    buttons.push({ method: 'oauth', label: provider.oauthLabel ?? 'Sign in with your browser' })
  }
  if (provider.supportsApiKey) {
    buttons.push({ method: 'api_key', label: provider.apiKeyLabel ?? 'Use an API key' })
  }
  return buttons
}

function linkLabel(url: string, label?: string): string {
  return label ?? url
}

export function SetupWizard({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderChoice[] | null>(null)
  const [providersFailed, setProvidersFailed] = useState(false)
  const [connecting, setConnecting] = useState<{ providerId: string; method: AuthMethod } | null>(null)
  const [activePrompt, setActivePrompt] = useState<AuthPromptRequest | null>(null)
  const [draft, setDraft] = useState('')
  const [timeline, setTimeline] = useState<TimelineItem[]>([])
  const [statusLine, setStatusLine] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [connectedId, setConnectedId] = useState<string | null>(null)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const firstOptionRef = useRef<HTMLButtonElement | null>(null)
  const closeTimer = useRef<number | null>(null)
  // Timeline entries need stable keys across renders; a counter is enough.
  const seq = useRef(0)

  // The provider list is re-read on open and again after a successful login, so the
  // rows reflect whatever the engine currently has stored.
  useEffect(() => {
    let cancelled = false
    setProvidersFailed(false)
    void window.gentle.auth
      .providers()
      .then((choices) => {
        if (!cancelled) setProviders(choices)
      })
      .catch(() => {
        if (!cancelled) setProvidersFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Prompts and events arrive as IPC pushes while a login runs in the main process.
  // Both subscriptions return their own unsubscribe and are cleaned up on unmount.
  useEffect(() => {
    const offPrompt = window.gentle.auth.onPrompt((request: AuthPromptRequest) => {
      setActivePrompt(request)
      setDraft('')
    })
    const offEvent = window.gentle.auth.onEvent((envelope: AuthEventEnvelope) => {
      const event = envelope.event
      if (event.type === 'progress') {
        // Progress is chatter, not news: one quiet line, replaced as it advances.
        setStatusLine(event.message)
        return
      }
      seq.current += 1
      const id = seq.current
      if (event.type === 'auth_url') {
        setTimeline((prev) => [
          ...prev,
          { kind: 'link', id, message: event.instructions ?? null, url: event.url }
        ])
      } else if (event.type === 'device_code') {
        setTimeline((prev) => [
          ...prev,
          {
            kind: 'code',
            id,
            userCode: event.userCode,
            verificationUri: event.verificationUri,
            expiresInSeconds: event.expiresInSeconds ?? null
          }
        ])
      } else {
        setTimeline((prev) => [
          ...prev,
          {
            kind: 'info',
            id,
            message: event.message,
            links: (event.links ?? []).map((link) => ({ url: link.url, label: link.label ?? null }))
          }
        ])
      }
    })
    return () => {
      offPrompt()
      offEvent()
    }
  }, [])

  // Each new prompt takes focus, so Enter-then-type works without the mouse.
  useEffect(() => {
    if (activePrompt === null) return
    if (activePrompt.prompt.type === 'select') firstOptionRef.current?.focus()
    else inputRef.current?.focus()
  }, [activePrompt])

  useEffect(
    () => () => {
      // The auto-close timer must not fire after the wizard is gone.
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current)
    },
    []
  )

  const submitPrompt = useCallback((): void => {
    const request = activePrompt
    if (request === null) return
    const prompt = request.prompt
    if (prompt.type === 'select') return
    // An empty answer would be a silent misconfiguration; the user cancels instead.
    const value = prompt.type === 'secret' ? draft : draft.trim()
    if (value.length === 0) return
    setActivePrompt(null)
    setDraft('')
    window.gentle.auth.answerPrompt(request.requestId, value)
  }, [activePrompt, draft])

  const chooseOption = useCallback((request: AuthPromptRequest, optionId: string): void => {
    setActivePrompt(null)
    window.gentle.auth.answerPrompt(request.requestId, optionId)
  }, [])

  const cancelPending = useCallback((): void => {
    if (activePrompt !== null) {
      const request = activePrompt
      setActivePrompt(null)
      setDraft('')
      // Answering null is the bridge's cancellation signal for the visible prompt.
      window.gentle.auth.answerPrompt(request.requestId, null)
    } else if (connecting !== null) {
      window.gentle.auth.cancel()
    }
  }, [activePrompt, connecting])

  const startLogin = useCallback(
    async (provider: ProviderChoice, method: AuthMethod): Promise<void> => {
      setOutcome(null)
      setTimeline([])
      setStatusLine(null)
      setActivePrompt(null)
      setDraft('')
      setConnecting({ providerId: provider.id, method })

      let result: AuthLoginResult
      try {
        result = await window.gentle.auth.login({ providerId: provider.id, type: method })
      } catch {
        // The channel itself failed; keep the message human and unspecific.
        result = { ok: false, error: 'Sign-in could not be started. Please try again.' }
      }

      setConnecting(null)
      setActivePrompt(null)
      if (result.ok) {
        // Mark connected from this session even before the re-read catches up, then
        // refresh the list so the row reflects the engine's stored state.
        setConnectedId(provider.id)
        try {
          setProviders(await window.gentle.auth.providers())
        } catch {
          // The just-completed login still stands; the list can lag.
        }
        closeTimer.current = window.setTimeout(onClose, 1600)
      } else {
        setOutcome({ message: result.error, cancelled: result.cancelled === true })
      }
    },
    [onClose]
  )

  const requestClose = useCallback((): void => {
    // Leaving mid-sign-in must not leave prompts dangling in the main process.
    cancelPending()
    onClose()
  }, [cancelPending, onClose])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (activePrompt !== null || connecting !== null) cancelPending()
      else onClose()
    },
    [activePrompt, connecting, cancelPending, onClose]
  )

  const connectingProvider =
    connecting !== null
      ? (providers ?? []).find((provider) => provider.id === connecting.providerId) ?? null
      : null

  return (
    <div className="wizard-overlay" role="presentation" onKeyDown={onKeyDown}>
      <div
        className="wizard-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Connect an AI provider"
      >
        <div className="wizard-head">
          <h1 className="wizard-title">Connect an AI provider</h1>
          <button
            type="button"
            className="wizard-close"
            aria-label="Close setup"
            onClick={requestClose}
          >
            ×
          </button>
        </div>
        <p className="wizard-subtitle">
          Sign in once. The app keeps the connection and asks again only if it expires.
        </p>

        {providers === null ? (
          <p className="wizard-loading">
            {providersFailed
              ? 'The provider list could not be loaded. Please close this window and try again.'
              : 'Loading providers…'}
          </p>
        ) : (
          <ul className="wizard-providers">
            {providers.map((provider) => {
              const connected = provider.configured || connectedId === provider.id
              return (
                <li key={provider.id} className="wizard-provider">
                  <div className="wizard-provider-name">
                    {provider.name}
                    {connected ? <span className="wizard-badge">Connected</span> : null}
                  </div>
                  {!connected ? (
                    <div className="wizard-methods">
                      {methodButtons(provider).map((button) => (
                        <button
                          key={button.method}
                          type="button"
                          className="wizard-method"
                          disabled={connecting !== null}
                          onClick={() => {
                            void startLogin(provider, button.method)
                          }}
                        >
                          {button.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}

        {connecting !== null ? (
          <section className="wizard-connecting" aria-live="polite">
            <h2 className="wizard-connecting-title">
              Connecting to {connectingProvider?.name ?? 'your provider'}…
            </h2>

            {timeline.map((item) => {
              if (item.kind === 'link') {
                return (
                  <div key={item.id} className="wizard-step">
                    {item.message !== null ? <p className="wizard-step-text">{item.message}</p> : null}
                    <a
                      className="wizard-link"
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open the sign-in page
                    </a>
                  </div>
                )
              }
              if (item.kind === 'code') {
                return (
                  <div key={item.id} className="wizard-step">
                    <p className="wizard-step-text">Enter this code on the sign-in page:</p>
                    <code className="wizard-code">{item.userCode}</code>
                    <p className="wizard-step-text">
                      If the page did not open:{' '}
                      <a className="wizard-link" href={item.verificationUri} target="_blank" rel="noreferrer">
                        {item.verificationUri}
                      </a>
                    </p>
                    {item.expiresInSeconds !== null ? (
                      <p className="wizard-step-meta">
                        Valid for about {Math.max(1, Math.round(item.expiresInSeconds / 60))} minutes.
                      </p>
                    ) : null}
                  </div>
                )
              }
              return (
                <div key={item.id} className="wizard-step">
                  <p className="wizard-step-text">{item.message}</p>
                  {item.links.map((link) => (
                    <a key={link.url} className="wizard-link" href={link.url} target="_blank" rel="noreferrer">
                      {linkLabel(link.url, link.label ?? undefined)}
                    </a>
                  ))}
                </div>
              )
            })}

            {statusLine !== null ? <p className="wizard-status-line">{statusLine}</p> : null}

            {activePrompt !== null ? (
              <div className="wizard-prompt">
                {activePrompt.prompt.type === 'select' ? (
                  <>
                    <p className="wizard-prompt-message">{activePrompt.prompt.message}</p>
                    <div className="wizard-select-options">
                      {activePrompt.prompt.options.map((option, index) => (
                        <button
                          key={option.id}
                          type="button"
                          className="wizard-select-option"
                          ref={index === 0 ? firstOptionRef : undefined}
                          onClick={() => chooseOption(activePrompt, option.id)}
                        >
                          <span className="wizard-select-label">{option.label}</span>
                          {option.description !== undefined ? (
                            <span className="wizard-select-description">{option.description}</span>
                          ) : null}
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <form
                    onSubmit={(event) => {
                      event.preventDefault()
                      submitPrompt()
                    }}
                  >
                    <label className="wizard-prompt-message" htmlFor="wizard-prompt-input">
                      {activePrompt.prompt.message}
                    </label>
                    <input
                      id="wizard-prompt-input"
                      ref={inputRef}
                      className="wizard-input"
                      type={activePrompt.prompt.type === 'secret' ? 'password' : 'text'}
                      // Password inputs keep the value out of sight and out of the screen.
                      placeholder={activePrompt.prompt.placeholder ?? ''}
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </form>
                )}
              </div>
            ) : null}

            <div className="wizard-actions">
              <button type="button" className="wizard-cancel" onClick={cancelPending}>
                {activePrompt !== null ? 'Cancel this step' : 'Cancel sign-in'}
              </button>
            </div>
          </section>
        ) : null}

        {outcome !== null ? (
          <div className={outcome.cancelled ? 'wizard-outcome-cancelled' : 'wizard-outcome-error'} role="alert">
            {outcome.cancelled
              ? 'Sign-in was cancelled. Nothing was changed — you can try again whenever you like.'
              : outcome.message}
          </div>
        ) : null}

        {connectedId !== null ? (
          <div className="wizard-outcome-connected">Connected. You can start a conversation now.</div>
        ) : null}
      </div>
    </div>
  )
}
