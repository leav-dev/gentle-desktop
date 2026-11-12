import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { EngineModelRef, HostStatus, SessionStats } from '../../shared/ipc.ts'
import type {
  DialogRequest,
  ExtensionUiRequest,
  ExtensionUiResponse,
  PromptDisposition,
  RpcEvent,
  SessionState
} from '../../shared/protocol.ts'
import { buildLaunchPlan, LaunchResolutionError, type LaunchOptions } from './launch.ts'
import { RpcTransport } from './transport.ts'

export interface PiHostListener {
  onStatus: (status: HostStatus) => void
  onEvent: (event: RpcEvent) => void
  onDialog: (request: DialogRequest) => void
  onNotice: (request: ExtensionUiRequest) => void
  onDiagnostic: (message: string) => void
}

const MAX_RESTARTS = 3
const RESTART_DELAY_MS = 750
const STDERR_TAIL_LIMIT = 4096

/**
 * Owns exactly one `pi --mode rpc` child for the whole app.
 *
 * Two invariants matter more than the rest:
 *   - a dialog is never dropped silently: an unanswered `extension_ui_request` blocks
 *     the extension forever, so pending dialogs are retained and cancellable;
 *   - the engine is supervised, because a crashed child that the UI still believes is
 *     ready turns every later prompt into a hang.
 */
export class PiHost {
  readonly #listener: PiHostListener
  #transport: RpcTransport | null = null
  #options: LaunchOptions = {}
  #status: HostStatus = { phase: 'stopped', restarts: 0 }
  #stopping = false
  #restartTimer: NodeJS.Timeout | null = null
  #stderrTail = ''
  #streaming = false
  readonly #pendingDialogs = new Map<string, DialogRequest>()

  constructor(listener: PiHostListener) {
    this.#listener = listener
  }

  status(): HostStatus {
    return this.#status
  }

  pendingDialogs(): DialogRequest[] {
    return [...this.#pendingDialogs.values()]
  }

  start(options: LaunchOptions = {}): void {
    if (this.#transport !== null) return
    this.#options = options
    this.#stopping = false
    this.#spawn()
  }

  async stop(): Promise<void> {
    this.#stopping = true
    if (this.#restartTimer) {
      clearTimeout(this.#restartTimer)
      this.#restartTimer = null
    }

    const transport = this.#transport
    this.#transport = null
    if (transport) {
      transport.close()
      // Give pi a moment to shut down in order before forcing it.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          transport.kill('SIGKILL')
          resolve()
        }, 2000)
        transport.child.once('exit', () => {
          clearTimeout(timer)
          resolve()
        })
      })
    }

    this.#cancelAllDialogs()
    this.#setStatus({ phase: 'stopped', restarts: this.#status.restarts })
  }

  async restart(): Promise<HostStatus> {
    await this.stop()
    this.#status = { ...this.#status, restarts: 0 }
    this.start(this.#options)
    return this.#status
  }

  async prompt(message: string): Promise<PromptDisposition> {
    const transport = this.#require()
    const disposition = await transport.prompt(
      message,
      this.#streaming ? { streamingBehavior: 'steer' } : {}
    )
    if (disposition === 'started') this.#streaming = true
    return disposition
  }

  async abort(): Promise<void> {
    await this.#require().request({ type: 'abort' })
  }

  async newSession(): Promise<void> {
    await this.#require().request({ type: 'new_session' })
  }

  async switchSession(sessionPath: string): Promise<void> {
    await this.#require().request({ type: 'switch_session', sessionPath })
  }

  async sessionState(): Promise<SessionState | null> {
    const state = await this.#require().request<SessionState>({ type: 'get_state' })
    this.#streaming = state?.isStreaming === true
    return state ?? null
  }

  /**
   * Models the running engine actually offers.
   *
   * This is the only honest catalogue: extensions contribute providers at runtime, so a
   * bare SDK lookup misses every provider they add.
   */
  async availableModels(): Promise<EngineModelRef[]> {
    const payload = await this.#require().request<{ models?: unknown }>({ type: 'get_available_models' })
    const models = Array.isArray(payload?.models) ? payload.models : []

    const refs: EngineModelRef[] = []
    for (const raw of models) {
      if (typeof raw !== 'object' || raw === null) continue
      const model = raw as { provider?: unknown; id?: unknown; name?: unknown }
      if (typeof model.provider !== 'string' || typeof model.id !== 'string') continue
      refs.push({
        provider: model.provider,
        id: model.id,
        ...(typeof model.name === 'string' ? { name: model.name } : {})
      })
    }
    return refs
  }

  async setModel(provider: string, modelId: string): Promise<void> {
    await this.#require().request({ type: 'set_model', provider, modelId })
  }

  async messages(): Promise<unknown[]> {
    const payload = await this.#require().request<{ messages?: unknown[] }>({ type: 'get_messages' })
    return payload?.messages ?? []
  }

  /** Passthrough of the engine's `get_session_stats`; typed at the shared contract. */
  async sessionStats(): Promise<SessionStats | null> {
    const payload = await this.#require().request<SessionStats | null>({ type: 'get_session_stats' })
    return payload ?? null
  }

  answerDialog(response: ExtensionUiResponse): void {
    const transport = this.#require()
    this.#pendingDialogs.delete(response.id)
    transport.respond(response)
  }

  cancelAllDialogs(): void {
    this.#cancelAllDialogs()
  }

  #require(): RpcTransport {
    if (this.#transport === null) {
      throw new Error(`the engine is not running (phase: ${this.#status.phase})`)
    }
    return this.#transport
  }

  #spawn(): void {
    let plan
    try {
      plan = buildLaunchPlan(this.#options)
    } catch (error) {
      const message =
        error instanceof LaunchResolutionError || error instanceof Error ? error.message : String(error)
      // A crash the user cannot diagnose is a support ticket; keep it in the log too.
      this.#listener.onDiagnostic(`cannot start the engine: ${message}`)
      this.#setStatus({ phase: 'crashed', restarts: this.#status.restarts, detail: message })
      return
    }

    this.#setStatus({
      phase: 'starting',
      restarts: this.#status.restarts,
      piEntry: plan.piEntry,
      home: plan.home,
      cwd: plan.cwd
    })

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(plan.command, plan.args, {
        cwd: plan.cwd,
        env: plan.env,
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.#listener.onDiagnostic(`cannot spawn the engine: ${message}`)
      this.#setStatus({ phase: 'crashed', restarts: this.#status.restarts, detail: message })
      return
    }

    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk: string) => {
      this.#stderrTail = `${this.#stderrTail}${chunk}`.slice(-STDERR_TAIL_LIMIT)
      for (const line of chunk.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.length > 0) this.#listener.onDiagnostic(trimmed)
      }
    })

    const transport = new RpcTransport(child, {
      onEvent: (event) => this.#handleEvent(event),
      onDialog: (request) => {
        this.#pendingDialogs.set(request.id, request)
        this.#setReadyIfNeeded()
        this.#listener.onDialog(request)
      },
      onNotice: (request) => this.#listener.onNotice(request),
      onProtocolError: (error) => this.#listener.onDiagnostic(`protocol: ${error.message}`),
      onExit: (info) => this.#handleExit(info)
    })

    this.#transport = transport
    // The first successful command proves the child speaks the protocol.
    void this.#handshake()
  }

  async #handshake(): Promise<void> {
    try {
      await this.#require().request({ type: 'get_state' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.#listener.onDiagnostic(`handshake failed: ${message}`)
      return
    }
    this.#setReadyIfNeeded()
  }

  #setReadyIfNeeded(): void {
    if (this.#status.phase === 'ready') return
    // A successful handshake clears the previous failure detail.
    const { detail: _staleDetail, ...rest } = this.#status
    this.#setStatus({ ...rest, phase: 'ready' })
  }

  #handleEvent(event: RpcEvent): void {
    if (event.type === 'agent_start') this.#streaming = true
    if (event.type === 'agent_settled') this.#streaming = false
    this.#listener.onEvent(event)
  }

  #handleExit(info: { code: number | null; signal: NodeJS.Signals | null }): void {
    this.#transport = null
    this.#streaming = false
    this.#cancelAllDialogs()

    if (this.#stopping) {
      this.#setStatus({ phase: 'stopped', restarts: this.#status.restarts })
      return
    }

    const tail = this.#stderrTail.trim()
    const summary = `engine exited (code ${info.code ?? 'null'}${info.signal ? `, signal ${info.signal}` : ''})`
    const detail = tail.length > 0 ? `${summary}: ${tail.split('\n').slice(-3).join(' | ')}` : summary
    const restarts = this.#status.restarts

    if (restarts >= MAX_RESTARTS) {
      this.#setStatus({ phase: 'crashed', restarts, detail: `${detail} — restart limit reached` })
      return
    }

    this.#setStatus({ phase: 'restarting', restarts: restarts + 1, detail })
    this.#status = { ...this.#status, restarts: restarts + 1 }
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = null
      this.#spawn()
    }, RESTART_DELAY_MS)
  }

  #cancelAllDialogs(): void {
    const transport = this.#transport
    if (transport) {
      for (const id of this.#pendingDialogs.keys()) transport.cancelDialog(id)
    }
    this.#pendingDialogs.clear()
  }

  #setStatus(status: HostStatus): void {
    this.#status = status
    this.#listener.onStatus(status)
  }
}
