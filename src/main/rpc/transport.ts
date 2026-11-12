import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  isDialogRequest,
  isExtensionUiRequest,
  isRpcResponse,
  type DialogRequest,
  type ExtensionUiRequest,
  type ExtensionUiResponse,
  type PromptDisposition,
  type RpcCommand,
  type RpcEvent,
  type RpcResponse
} from '../../shared/protocol.ts'

export interface TransportHandlers {
  onEvent: (event: RpcEvent) => void
  onDialog: (request: DialogRequest) => void
  onNotice: (request: ExtensionUiRequest) => void
  onProtocolError: (error: Error) => void
  onExit: (info: { code: number | null; signal: NodeJS.Signals | null }) => void
}

/** A command pi answered with `success: false`. */
export class RpcCommandError extends Error {
  readonly command: string

  constructor(command: string, message: string) {
    super(message)
    this.name = 'RpcCommandError'
    this.command = command
  }
}

/** One unparseable line is a protocol defect, not a reason to lie about state. */
export class RpcProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RpcProtocolError'
  }
}

/** A command that never got an answer, usually because the child died. */
export class RpcTransportClosedError extends Error {
  constructor(message = 'the pi process is no longer running') {
    super(message)
    this.name = 'RpcTransportClosedError'
  }
}

const MAX_BUFFER_BYTES = 32 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 60_000

interface PendingRequest {
  command: string
  resolve: (response: RpcResponse) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
}

/**
 * Strict newline-delimited JSON over the child's stdio.
 *
 * Framing rules that must not be relaxed: records are separated by LF only, a trailing
 * CR is stripped, and stdout is protocol-only — diagnostics arrive on stderr. `readline`
 * is deliberately unused because it also splits on U+2028/U+2029.
 */
export class RpcTransport {
  readonly #child: ChildProcessWithoutNullStreams
  readonly #handlers: TransportHandlers
  readonly #pending = new Map<string, PendingRequest>()
  #buffer = ''
  #nextId = 0
  #closed = false

  constructor(child: ChildProcessWithoutNullStreams, handlers: TransportHandlers) {
    this.#child = child
    this.#handlers = handlers

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.#ingest(chunk))
    child.stderr.setEncoding('utf8')

    child.on('exit', (code, signal) => {
      this.#closed = true
      this.#failPending(new RpcTransportClosedError())
      this.#handlers.onExit({ code, signal })
    })

    child.on('error', (error: Error) => {
      this.#closed = true
      this.#failPending(error)
      this.#handlers.onProtocolError(error)
    })
  }

  get child(): ChildProcessWithoutNullStreams {
    return this.#child
  }

  get isClosed(): boolean {
    return this.#closed
  }

  /** Sends one command and resolves with its reply payload. */
  async request<T = unknown>(command: RpcCommand, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    const response = await this.#send(command, timeoutMs)
    return response.data as T
  }

  /** Sends one prompt and reports how pi disposed of it. */
  async prompt(message: string, options: { streamingBehavior?: 'steer' | 'followUp' } = {}): Promise<PromptDisposition> {
    const payload = await this.request<{ disposition?: PromptDisposition }>({
      type: 'prompt',
      message,
      ...(options.streamingBehavior ? { streamingBehavior: options.streamingBehavior } : {})
    })
    return payload?.disposition ?? 'started'
  }

  /** Answers a dialog, or cancels it. Unanswered dialogs block the extension forever. */
  respond(response: ExtensionUiResponse): void {
    if (this.#closed) return
    this.#write(`${JSON.stringify(response)}\n`)
  }

  cancelDialog(id: string): void {
    this.respond({ type: 'extension_ui_response', id, cancelled: true })
  }

  /** Ends stdin so pi shuts down in order instead of being killed. */
  close(): void {
    if (this.#closed) return
    this.#closed = true
    this.#failPending(new RpcTransportClosedError())
    this.#child.stdin.end()
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): void {
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.kill(signal)
    }
  }

  #send(command: RpcCommand, timeoutMs: number): Promise<RpcResponse> {
    if (this.#closed) return Promise.reject(new RpcTransportClosedError())

    const id = `d${(this.#nextId += 1)}`
    return new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id)
        reject(new RpcCommandError(command.type, `no reply to "${command.type}" within ${timeoutMs}ms`))
      }, timeoutMs)
      timer.unref?.()

      this.#pending.set(id, { command: command.type, resolve, reject, timer })
      this.#write(`${JSON.stringify({ ...command, id })}\n`)
    })
  }

  #write(chunk: string): void {
    this.#child.stdin.write(chunk)
  }

  #ingest(chunk: string): void {
    this.#buffer += chunk

    let newlineIndex = this.#buffer.indexOf('\n')
    while (newlineIndex !== -1) {
      const line = this.#buffer.slice(0, newlineIndex)
      this.#buffer = this.#buffer.slice(newlineIndex + 1)
      this.#handleLine(line.endsWith('\r') ? line.slice(0, -1) : line)
      newlineIndex = this.#buffer.indexOf('\n')
    }

    if (this.#buffer.length > MAX_BUFFER_BYTES) {
      this.#buffer = ''
      this.#handlers.onProtocolError(
        new RpcProtocolError(`a single record exceeded ${MAX_BUFFER_BYTES} bytes without a newline`)
      )
    }
  }

  #handleLine(line: string): void {
    if (line.length === 0) return

    let record: unknown
    try {
      record = JSON.parse(line)
    } catch (error) {
      this.#handlers.onProtocolError(
        new RpcProtocolError(`unparseable record: ${error instanceof Error ? error.message : String(error)}`)
      )
      return
    }

    if (isRpcResponse(record)) {
      this.#settle(record)
      return
    }

    if (isExtensionUiRequest(record)) {
      if (isDialogRequest(record)) this.#handlers.onDialog(record)
      else this.#handlers.onNotice(record)
      return
    }

    this.#handlers.onEvent(record as RpcEvent)
  }

  #settle(response: RpcResponse): void {
    const id = response.id
    if (id === undefined) {
      // Unsolicited failure replies (parse errors) have no id and no waiter.
      if (!response.success) {
        this.#handlers.onProtocolError(
          new RpcProtocolError(`${response.command}: ${response.error ?? 'rejected without an error message'}`)
        )
      }
      return
    }

    const pending = this.#pending.get(id)
    if (!pending) return

    this.#pending.delete(id)
    clearTimeout(pending.timer)

    if (response.success) {
      pending.resolve(response)
      return
    }

    pending.reject(new RpcCommandError(pending.command, response.error ?? 'command failed without an error message'))
  }

  #failPending(error: Error): void {
    for (const [id, pending] of this.#pending) {
      this.#pending.delete(id)
      clearTimeout(pending.timer)
      pending.reject(error)
    }
  }
}
