import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import {
  IPC,
  type AuthLoginRequest,
  type HostStatus,
  type PromptRequest
} from '../shared/ipc.ts'
import type { ExtensionUiResponse, RpcEvent } from '../shared/protocol.ts'
import { AuthPromptBridge } from './auth-bridge.ts'
import { listProviderChoices, loginProvider, providerConfigured } from './auth.ts'
import { listOddTasks } from './odd-tasks.ts'
import { collectRepoStatus, emptyRepoStatus } from './repo.ts'
import { readPermissionMode } from './permission-mode.ts'
import { PiHost } from './rpc/host.ts'
import { listSessions } from './sessions.ts'

let host: PiHost | null = null
let authBridge: AuthPromptBridge | null = null

function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload)
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
      return await loginProvider(home, request.providerId, request.type, bridge.interaction())
    } finally {
      if (authBridge === bridge) authBridge = null
    }
  })

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
