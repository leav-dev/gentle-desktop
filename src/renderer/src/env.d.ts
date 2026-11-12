import type { GentleApi } from '../../shared/ipc.ts'

declare global {
  interface Window {
    /** Injected by the preload bridge; the only door to the engine. */
    readonly gentle: GentleApi
  }
}

export {}
