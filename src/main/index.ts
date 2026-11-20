import { dirname, join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron'
import {
  IPC,
  type AuthLoginRequest,
  type ConnectionTestInput,
  type CustomProviderInput,
  type HostStatus,
  type OrchestratorWriteResult,
  type PromptRequest,
  type RoutingView,
  type RoutingWriteResult,
  type WorkspaceChangeResult
} from '../shared/ipc.ts'
import type { ExtensionUiResponse, RpcEvent } from '../shared/protocol.ts'
import type { AuthInteraction } from '@earendil-works/pi-ai'
import { invalidateAuthRuntime } from './auth.ts'
import { AuthPromptBridge } from './auth-bridge.ts'
import { listProviderChoices, loginProvider, providerConfigured } from './auth.ts'
import { currentDesktopConfigHome } from './config-home.ts'
import {
  listCustomProviders,
  removeCustomProvider,
  saveCustomProvider,
  testConnection
} from './custom-providers.ts'
import {
  applyOrchestratorDefault,
  parseModelRef,
  readRouting,
  setActiveProfile,
  setAgentModel,
  setOrchestratorModel
} from './model-routing.ts'
import { listOddTasks } from './odd-tasks.ts'
import { collectRepoStatus, emptyRepoStatus } from './repo.ts'
import { readPermissionMode, resolveConfigHome } from './permission-mode.ts'
import { readProfiles, resolveActiveProfile } from './profiles.ts'
import { readSubscriptionUsage } from './subscription-usage.ts'
import { ensureAgentSettingsForDesktop } from './agent-settings.ts'
import { resolveAgentHome } from './rpc/launch.ts'
import { PiHost } from './rpc/host.ts'
import { listSessions } from './sessions.ts'
import {
  applicationDirectory,
  chooseStartFolder,
  readRememberedWorkspace,
  writeRememberedWorkspace,
  workspaceLabel
} from './workspace.ts'

let host: PiHost | null = null
let authBridge: AuthPromptBridge | null = null

/**
 * The application's own directory: where its executable sits once packaged. A window
 * still working from here must say so in the header (S17) instead of naming an install
 * folder like `win-unpacked`. In dev the working directory is the application's own tree.
 */
const APP_DIRECTORY = applicationDirectory(app.getPath('exe'), app.isPackaged, process.cwd())

// Installed and portable builds share userData and the agent home; two processes fight over
// the same engine and Gentle Agents session locks on Windows.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const windows = BrowserWindow.getAllWindows()
    if (windows.length === 0) return
    const window = windows[0]
    if (window.isMinimized()) window.restore()
    window.focus()
  })
}

/** The app's own state directory — where the chosen folder is remembered, never in a repo. */
function stateDir(): string {
  return app.getPath('userData')
}

/**
 * Attaches the person-readable folder name to every status the UI sees. The renderer has
 * no notion of the application's own directory — and must not need one — so the label is
 * decided here, once, wherever a status leaves the main process.
 */
function decorateStatus(status: HostStatus): HostStatus {
  if (status.cwd === undefined) return status
  const label = workspaceLabel(status.cwd, APP_DIRECTORY)
  if (label === null) return status
  return { ...status, cwdLabel: label.name }
}

/**
 * Opens the system's own folder picker. The main process is the only side allowed to do
 * this, and it is shared by the two moments that need it: the first-run question (S19),
 * where there is no window yet, and a later folder change from the window that asked.
 */
async function showFolderPicker(owner: BrowserWindow | null, current: string | null): Promise<string | null> {
  // `defaultPath` must be absent when there is no folder yet, not set to undefined.
  const options: OpenDialogOptions = {
    title: current === null ? 'Choose a folder to work in' : 'Choose a folder',
    buttonLabel: current === null ? 'Work in this folder' : 'Choose this folder',
    ...(current !== null ? { defaultPath: current } : {}),
    properties: ['openDirectory', 'createDirectory']
  }
  const picked =
    owner !== null && !owner.isDestroyed()
      ? await dialog.showOpenDialog(owner, options)
      : await dialog.showOpenDialog(options)

  const folder = picked.filePaths[0]
  return picked.canceled || folder === undefined ? null : folder
}

/** Remembers a folder the engine actually started in; a failed write only costs the next launch its default. */
function rememberWorkspace(folder: string): void {
  try {
    writeRememberedWorkspace(stateDir(), folder)
  } catch (error) {
    process.stderr.write(
      `[workspace] cannot remember the folder: ${error instanceof Error ? error.message : String(error)}\n`
    )
  }
}

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
}

/** Error text for the renderer: a plain sentence, never a stack trace or a full path. */
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function routingFailure(error: unknown): { ok: false; error: string } {
  return { ok: false, error: `The profiles file could not be changed: ${describeError(error)}` }
}

/**
 * Answers pi's first secret prompt with the key the user already typed in the custom
 * provider form, so the sign-in question is not asked a second time. Any later prompt
 * still reaches the window. The key exists only in memory here; pi's own login is what
 * persists it, into auth.json.
 */
function withPrefilledKey(interaction: AuthInteraction, apiKey: string): AuthInteraction {
  let used = false
  return {
    ...(interaction.signal !== undefined ? { signal: interaction.signal } : {}),
    prompt: async (prompt) => {
      if (!used && prompt.type === 'secret') {
        used = true
        return apiKey
      }
      return interaction.prompt(prompt)
    },
    notify: (event) => interaction.notify(event)
  }
}

function createHost(): PiHost {
  return new PiHost({
    onStatus: (status: HostStatus) => broadcast(IPC.hostStatus, decorateStatus(status)),
    onEvent: (event: RpcEvent) => broadcast(IPC.hostEvent, event),
    onDialog: (request) => broadcast(IPC.hostDialog, request),
    onNotice: (request) => broadcast(IPC.hostNotice, request),
    onDiagnostic: (message) => process.stderr.write(`[engine] ${message}\n`)
  })
}

function registerIpc(instance: PiHost): void {
  ipcMain.handle(IPC.hostGetStatus, () => decorateStatus(instance.status()))

  ipcMain.handle(IPC.hostRestart, async () => decorateStatus(await instance.restart()))

  ipcMain.handle(IPC.workspaceChoose, async (event): Promise<WorkspaceChangeResult> => {
    // The picker belongs to the window that asked for it, so it centres on that window.
    const owner = BrowserWindow.fromWebContents(event.sender)
    const folder = await showFolderPicker(owner, instance.status().cwd ?? null)
    if (folder === null) return { outcome: 'cancelled' }

    const change = await instance.changeDirectory(folder)
    if (change.outcome !== 'changed') return change

    // Only a folder the engine actually started in is remembered; a failed start must
    // not survive an app restart.
    rememberWorkspace(folder)
    return change
  })

  ipcMain.handle(IPC.sessionPrompt, async (_event, request: PromptRequest) => {
    return instance.prompt(request.message)
  })

  ipcMain.handle(IPC.sessionAbort, async () => instance.abort())

  ipcMain.handle(IPC.sessionNew, async () => instance.newSession())

  ipcMain.handle(IPC.sessionState, async () => instance.sessionState())

  ipcMain.handle(IPC.sessionMessages, async () => instance.messages())

  ipcMain.handle(IPC.sessionsList, async () => {
    const home = instance.status().home
    // Before the first successful spawn there is no home to scan, and an empty list is
    // the honest answer rather than a filesystem guess.
    return home ? listSessions(home) : []
  })

  ipcMain.handle(IPC.sessionsSwitch, async (_event, sessionPath: string) => instance.switchSession(sessionPath))

  const agentHome = (): string | null => instance.status().home ?? null

  ipcMain.handle(IPC.agentMode, async () => readPermissionMode())

  ipcMain.handle(IPC.profilesRead, async () => readProfiles(resolveConfigHome()))

  ipcMain.handle(IPC.profilesActive, async (_event, modelKey: string | null) =>
    resolveActiveProfile(resolveConfigHome(), modelKey)
  )

  ipcMain.handle(IPC.usageRead, async (_event, providerId: string) => {
    const home = agentHome()
    if (!home) return null
    return readSubscriptionUsage({ home, providerId })
  })

  ipcMain.handle(IPC.authProviders, async () => {
    const home = agentHome()
    if (!home) return []

    // The engine is the only catalogue that includes extension-contributed providers, so a
    // failure to ask it must not silently collapse the list to the SDK's providers.
    let engineModels: Awaited<ReturnType<typeof instance.availableModels>> = []
    try {
      engineModels = await instance.availableModels()
    } catch (error) {
      process.stderr.write(`[auth] engine catalogue unavailable: ${error instanceof Error ? error.message : String(error)}
`)
    }

    return listProviderChoices(home, engineModels)
  })

  ipcMain.handle(IPC.sessionSetModel, async (_event, request: { provider: string; modelId: string }) =>
    instance.setModel(request.provider, request.modelId)
  )

  ipcMain.handle(IPC.sessionStats, async () => instance.sessionStats())

  ipcMain.handle(IPC.sessionCommands, async () => instance.commands())

  ipcMain.handle(IPC.repoStatus, async () => {
    const cwd = instance.status().cwd
    // Without a session directory there is nothing to diff; the rail stays empty.
    return cwd ? collectRepoStatus(cwd) : emptyRepoStatus()
  })

  ipcMain.handle(IPC.oddTasks, async () => {
    const cwd = instance.status().cwd
    return cwd ? listOddTasks(cwd) : []
  })

  ipcMain.handle(IPC.authConfigured, async (_event, providerId: string) => {
    const home = agentHome()
    return home ? providerConfigured(home, providerId) : false
  })

  ipcMain.handle(IPC.authLogin, async (event, request: AuthLoginRequest) => {
    const home = agentHome()
    if (!home) return { ok: false, error: 'The engine is not running yet.' }

    authBridge?.cancelAll()
    const bridge = new AuthPromptBridge(event.sender)
    authBridge = bridge

    try {
      const interaction =
        request.apiKey !== undefined ? withPrefilledKey(bridge.interaction(), request.apiKey) : bridge.interaction()
      return await loginProvider(home, request.providerId, request.type, interaction)
    } finally {
      if (authBridge === bridge) authBridge = null
    }
  })

  ipcMain.handle(IPC.customProvidersList, async () => {
    const home = agentHome()
    // Without an agent home there is no file to read; an empty list is the honest answer.
    return home ? listCustomProviders(home) : []
  })

  ipcMain.handle(IPC.customProvidersSave, async (_event, input: CustomProviderInput) => {
    const home = agentHome()
    if (!home) return { ok: false, error: 'The engine is not running yet. Please wait a moment and try again.' }

    const result = await saveCustomProvider(input, home)
    if (result.ok) {
      // The cached SDK runtime read models.json before this save; without a reset its
      // catalogue would not know the new provider and the sign-in below would fail.
      invalidateAuthRuntime()
    }
    return result
  })

  ipcMain.handle(IPC.customProvidersRemove, async (_event, id: string) => {
    const home = agentHome()
    if (!home) return { ok: false, error: 'The engine is not running yet. Please wait a moment and try again.' }
    const result = await removeCustomProvider(id, home)
    if (result.ok) invalidateAuthRuntime()
    return result
  })

  ipcMain.handle(IPC.customProvidersTest, async (_event, input: ConnectionTestInput) => testConnection(input))

  // The routing store (S21) is read and written through the engine's own config home —
  // the same folder the engine resolves — so the app and the engine never disagree about
  // where profiles.json lives. Every answer is a value: nothing rejects with a raw stack,
  // and error text names "the profiles file" or "the settings file", never a full path.
  ipcMain.handle(IPC.routingRead, async (): Promise<RoutingView> => {
    const configHome = currentDesktopConfigHome()
    try {
      return readRouting(configHome)
    } catch (error) {
      // The view has no error channel, so an unexpected read failure is reported as an
      // unreadable store — the honest state for a window that shows what is on disk —
      // and logged for diagnosis, never thrown at the renderer.
      process.stderr.write(`[routing] cannot read the profiles file: ${describeError(error)}\n`)
      return { configHome, fileStatus: 'invalid', active: null, profiles: [] }
    }
  })

  ipcMain.handle(
    IPC.routingSetAgentModel,
    async (_event, input: { profile: string; agent: string; model: string | null }): Promise<RoutingWriteResult> => {
      try {
        return setAgentModel(currentDesktopConfigHome(), input.profile, input.agent, input.model)
      } catch (error) {
        return routingFailure(error)
      }
    }
  )

  ipcMain.handle(
    IPC.routingSetOrchestrator,
    async (_event, input: { profile: string; model: string }): Promise<OrchestratorWriteResult> => {
      // The store write is the durable intent: it happens first and stays even when the
      // live change to the running session cannot be applied, which is then reported
      // instead of being mistaken for a failed save.
      //
      // Pi's settings.json is the ACTIVE profile's orchestrator default (it is only read
      // inside activation), and the live model belongs to the running session. A profile
      // that is not the store's active one owns neither, so both are left untouched.
      let write: ReturnType<typeof setOrchestratorModel>
      try {
        write = setOrchestratorModel(currentDesktopConfigHome(), input.profile, input.model)
      } catch (error) {
        return routingFailure(error)
      }
      if (!write.ok) return write
      if (!write.profileActive) return { ok: true, profileActive: false }

      const home = agentHome()
      if (!home) {
        return {
          ok: true,
          profileActive: true,
          appliedLive: false,
          error: 'The engine is not running yet, so the model was saved but is not live in a session.'
        }
      }
      try {
        const applied = applyOrchestratorDefault(home, input.model)
        if (!applied.ok) {
          return { ok: true, profileActive: true, appliedLive: false, error: applied.error }
        }
      } catch (error) {
        return {
          ok: true,
          profileActive: true,
          appliedLive: false,
          error: `The model was saved, but the settings file could not be updated: ${describeError(error)}`
        }
      }

      const reference = parseModelRef(input.model)
      if (reference === null) {
        return {
          ok: true,
          profileActive: true,
          appliedLive: false,
          error: 'The model was saved, but it is not a provider/id pair, so the running session was not changed.'
        }
      }
      try {
        await instance.setModel(reference.provider, reference.id)
        return { ok: true, profileActive: true, appliedLive: true }
      } catch (error) {
        return {
          ok: true,
          profileActive: true,
          appliedLive: false,
          error: `The model was saved, but the running session could not switch to it: ${describeError(error)}`
        }
      }
    }
  )

  ipcMain.handle(
    IPC.routingSetActive,
    async (_event, input: { profile: string }): Promise<RoutingWriteResult> => {
      try {
        return setActiveProfile(currentDesktopConfigHome(), input.profile)
      } catch (error) {
        return routingFailure(error)
      }
    }
  )

  ipcMain.on(IPC.authAnswer, (_event, payload: { requestId: string; value: string | null }) => {
    authBridge?.answer(payload.requestId, payload.value)
  })

  ipcMain.on(IPC.authCancel, () => {
    authBridge?.cancelAll()
  })

  ipcMain.on(IPC.dialogAnswer, (_event, response: ExtensionUiResponse) => {
    try {
      instance.answerDialog(response)
    } catch (error) {
      process.stderr.write(
        `[dialog] cannot answer ${response.id}: ${error instanceof Error ? error.message : String(error)}\n`
      )
    }
  })
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f1115',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  window.once('ready-to-show', () => window.show())

  // External links belong in the user's browser, never inside the app frame.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}

// Windows identifies an application by this id: without it, the window groups under
// Electron, notifications carry Electron's name and icon, and pinning the app to the taskbar
// pins the wrong thing. It must match `appId` in electron-builder.yml, which is what the
// installer registers; the two strings are the only copy of this identity.
app.setAppUserModelId('dev.gentledesktop.app')

app.whenReady().then(async () => {
  host = createHost()
  registerIpc(host)

  // The user's remembered choice wins over the environment override: it is the folder
  // they picked on purpose. With no choice yet (S17, first run) and no override, the app
  // asks for a folder before it starts (S19): working in its own installation directory
  // is not something a person can make sense of. A cancelled picker still launches, and
  // the header says plainly that the folder is the app's own.
  const startFolder = await chooseStartFolder({
    remembered: readRememberedWorkspace(stateDir()),
    override: process.env['GENTLE_DESKTOP_CWD'] ?? null,
    fallback: process.cwd(),
    ask: async () => {
      try {
        return await showFolderPicker(null, null)
      } catch (error) {
        process.stderr.write(
          `[workspace] cannot ask for a folder: ${error instanceof Error ? error.message : String(error)}\n`
        )
        return null
      }
    }
  })
  if (startFolder.remember) rememberWorkspace(startFolder.folder)

  try {
    ensureAgentSettingsForDesktop(resolveAgentHome())
  } catch (error) {
    process.stderr.write(
      `[agent] cannot prepare settings.json: ${error instanceof Error ? error.message : String(error)}\n`
    )
  }

  // The engine starts before the window exists, so the window's first questions always
  // reach a child instead of a stopped host — a window that mounts first logs failed
  // session queries while the folder question is still open.
  host.start({ cwd: startFolder.folder, moduleBase: __dirname })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void host?.stop()
  host = null
})
