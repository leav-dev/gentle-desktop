import type { DialogRequest, ExtensionUiResponse } from '../../../shared/protocol.ts'

/**
 * The user's answer in UI terms. The builders below are the single place that shapes
 * the `extension_ui_response` wire format, so the components never touch the protocol
 * directly.
 */
export type DialogAnswer =
  | { kind: 'select'; option: string }
  | { kind: 'confirm'; confirmed: boolean }
  | { kind: 'text'; value: string }
  | { kind: 'cancel' }

export function buildSelectResponse(id: string, option: string): ExtensionUiResponse {
  return { type: 'extension_ui_response', id, value: option }
}

export function buildConfirmResponse(id: string, confirmed: boolean): ExtensionUiResponse {
  return { type: 'extension_ui_response', id, confirmed }
}

export function buildInputResponse(id: string, value: string): ExtensionUiResponse {
  return { type: 'extension_ui_response', id, value }
}

export function buildEditorResponse(id: string, value: string): ExtensionUiResponse {
  return { type: 'extension_ui_response', id, value }
}

/**
 * An unanswered `extension_ui_request` blocks the extension forever, so cancelling is
 * always available and always produces the same `cancelled` shape.
 */
export function buildCancelResponse(id: string): ExtensionUiResponse {
  return { type: 'extension_ui_response', id, cancelled: true }
}

export function buildDialogResponse(request: DialogRequest, answer: DialogAnswer): ExtensionUiResponse {
  if (answer.kind === 'cancel') return buildCancelResponse(request.id)
  switch (request.method) {
    case 'select':
      return answer.kind === 'select'
        ? buildSelectResponse(request.id, answer.option)
        : buildCancelResponse(request.id)
    case 'confirm':
      return answer.kind === 'confirm'
        ? buildConfirmResponse(request.id, answer.confirmed)
        : buildCancelResponse(request.id)
    case 'input':
    case 'editor':
      return answer.kind === 'text'
        ? buildInputResponse(request.id, answer.value)
        : buildCancelResponse(request.id)
  }
}
