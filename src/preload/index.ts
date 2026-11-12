import { contextBridge } from 'electron'

/**
 * The renderer never touches Node or Electron internals directly. Everything the UI can
 * do is an explicit, typed entry of this surface; the engine bridge lands in the next
 * commit.
 */
const api = {} as const

export type GentleDesktopApi = typeof api

contextBridge.exposeInMainWorld('gentle', api)
