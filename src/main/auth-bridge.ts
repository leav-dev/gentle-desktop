import type { WebContents } from 'electron'
import type { AuthEvent, AuthInteraction, AuthPrompt } from '@earendil-works/pi-ai'
import { IPC, type AuthEventEnvelope, type AuthPromptRequest } from '../shared/ipc.ts'

/**
 * Bridges pi's auth interaction to the setup window.
 *
 * Each prompt becomes one IPC round trip with its own id, because the SDK awaits the
 * answer before continuing. A cancelled prompt rejects rather than resolving to an empty
 * string: an empty API key is a silent misconfiguration, while a rejection is a clean user
 * decision that the login wrapper reports as a cancellation.
 */
export class AuthPromptBridge {
  readonly #sender: WebContents
  readonly #pending = new Map<string, (value: string | null) => void>()
  #seq = 0
  #active = true

  constructor(sender: WebContents) {
    this.#sender = sender
    // A closed window can never answer, so every waiter must fail instead of hanging.
    sender.once('destroyed', () => this.cancelAll())
  }

  interaction(): AuthInteraction {
    return {
      prompt: (prompt) => this.#ask(prompt),
      notify: (event) => this.#notify(event)
    }
  }

  answer(requestId: string, value: string | null): void {
    const resolve = this.#pending.get(requestId)
    if (!resolve) return
    this.#pending.delete(requestId)
    resolve(value)
  }

  cancelAll(): void {
    this.#active = false
    for (const [requestId, resolve] of this.#pending) {
      this.#pending.delete(requestId)
      resolve(null)
    }
  }

  #alive(): boolean {
    return this.#active && !this.#sender.isDestroyed()
  }

  #ask(prompt: AuthPrompt): Promise<string> {
    if (!this.#alive()) return Promise.reject(new Error('sign-in cancelled'))

    const requestId = `auth-${(this.#seq += 1)}`
    return new Promise<string>((resolve, reject) => {
      this.#pending.set(requestId, (value) => {
        if (value === null) reject(new Error('sign-in cancelled'))
        else resolve(value)
      })
      this.#sender.send(IPC.authPrompt, { requestId, prompt } satisfies AuthPromptRequest)
    })
  }

  #notify(event: AuthEvent): void {
    if (!this.#alive()) return
    this.#sender.send(IPC.authEvent, { event } satisfies AuthEventEnvelope)
  }
}
