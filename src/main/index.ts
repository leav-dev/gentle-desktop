import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import {
  IPC,
  type AuthLoginRequest,
  type ConnectionTestInput,
  type CustomProviderInput,
  type HostStatus,
  type PromptRequest
} from '../shared/ipc.ts'
import type { ExtensionUiResponse, RpcEvent } from '../shared/protocol.ts'
import type { AuthInteraction } from '@earendil-works/pi-ai'
import { invalidateAuthRuntime } from './auth.ts'
import { AuthPromptBridge } from './auth-bridge.ts'
import { listProviderChoices, loginProvider, providerConfigured } from './auth.ts'
import {
  listCustomProviders,
  removeCustomProvider,
  saveCustomProvider,
  testConnection
} from './custom-providers.ts'
import { listOddTasks } from './odd-tasks.ts'
import { collectRepoStatus, emptyRepoStatus } from './repo.ts'
import { readPermissionMode, resolveConfigHome } from './permission-mode.ts'
import { readProfiles, resolveActiveProfile } from './profiles.ts'
import { readSubscriptionUsage } from './subscription-usage.ts'
import { PiHost } from './rpc/host.ts'
import { listSessions } from './sessions.ts'

let host: PiHost | null = null
let authBridge: AuthPromptBridge | null = null

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
  }
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
    onStatus: (status: HostStatus) => broadcast(IPC.hostStatus, status),
    onEvent: (event: RpcEvent) => broadcast(IPC.hostEvent, event),
    onDialog: (request) => broadcast(IPC.hostDialog, request),
    onNotice: (request) => broadcast(IPC.hostNotice, request),
    onDiagnostic: (message) => process.stderr.write(`[engine] ${message}\n`)
  })
}

function registerIpc(instance: PiHost): void {
  ipcMain.handle(IPC.hostGetStatus, () => instance.status())

  ipcMain.handle(IPC.hostRestart, async () => instance.restart())

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

app.whenReady().then(() => {
  host = createHost()
  registerIpc(host)
  createWindow()

  // The engine starts with the app: the window is the only surface the user needs.
  host.start({ cwd: process.env['GENTLE_DESKTOP_CWD'] ?? process.cwd(), moduleBase: __dirname })

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
