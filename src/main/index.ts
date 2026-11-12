import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { IPC, type HostStatus, type PromptRequest } from '../shared/ipc.ts'
import type { ExtensionUiResponse, RpcEvent } from '../shared/protocol.ts'
import { PiHost } from './rpc/host.ts'

let host: PiHost | null = null

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
  host.start({ cwd: process.env['GENTLE_DESKTOP_CWD'] ?? process.cwd() })

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
