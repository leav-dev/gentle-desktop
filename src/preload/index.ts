import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IPC,
  type GentleApi,
  type HostStatus,
  type PromptRequest
} from '../shared/ipc.ts'
import type {
  DialogRequest,
  ExtensionUiRequest,
  ExtensionUiResponse,
  PromptDisposition,
  RpcEvent,
  SessionState
} from '../shared/protocol.ts'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, wrapped)
  return () => {
    ipcRenderer.removeListener(channel, wrapped)
  }
}

/**
 * The renderer never touches Node or Electron internals directly. Everything the UI can
 * do is an explicit, typed entry of this surface, and every stream returns its own
 * unsubscribe so React effects cannot leak listeners.
 */
const api: GentleApi = {
  host: {
    status: () => ipcRenderer.invoke(IPC.hostGetStatus) as Promise<HostStatus>,
    restart: () => ipcRenderer.invoke(IPC.hostRestart) as Promise<HostStatus>,
    onStatus: (listener) => subscribe<HostStatus>(IPC.hostStatus, listener),
    onEvent: (listener) => subscribe<RpcEvent>(IPC.hostEvent, listener),
    onDialog: (listener) => subscribe<DialogRequest>(IPC.hostDialog, listener),
    onNotice: (listener) => subscribe<ExtensionUiRequest>(IPC.hostNotice, listener)
  },
  session: {
    prompt: (message) =>
      ipcRenderer.invoke(IPC.sessionPrompt, { message } satisfies PromptRequest) as Promise<PromptDisposition>,
    abort: () => ipcRenderer.invoke(IPC.sessionAbort) as Promise<void>,
    newSession: () => ipcRenderer.invoke(IPC.sessionNew) as Promise<void>,
    state: () => ipcRenderer.invoke(IPC.sessionState) as Promise<SessionState | null>,
    messages: () => ipcRenderer.invoke(IPC.sessionMessages) as Promise<unknown[]>,
    answerDialog: (response: ExtensionUiResponse) => {
      ipcRenderer.send(IPC.dialogAnswer, response)
    }
  }
}

contextBridge.exposeInMainWorld('gentle', api)
