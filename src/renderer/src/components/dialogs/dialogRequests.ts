import type { DialogRequest } from '../../../../shared/protocol.ts'

export type SelectRequest = Extract<DialogRequest, { method: 'select' }>
export type ConfirmRequest = Extract<DialogRequest, { method: 'confirm' }>
export type InputRequest = Extract<DialogRequest, { method: 'input' }>
export type EditorRequest = Extract<DialogRequest, { method: 'editor' }>
export type InputLikeRequest = InputRequest | EditorRequest
