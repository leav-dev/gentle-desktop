import { useState } from 'react'
import type { DialogAnswer } from '../../state/dialogResponses.ts'
import type { InputLikeRequest } from './dialogRequests.ts'

/**
 * Covers both `input` (single question, optional placeholder) and `editor` (multiline
 * with a prefill), since the wire answer for both is the same `{value}` shape.
 */
export function InputDialog({
  request,
  onAnswer,
  onCancel
}: {
  request: InputLikeRequest
  onAnswer: (answer: DialogAnswer) => void
  onCancel: () => void
}): React.JSX.Element {
  const isEditor = request.method === 'editor'
  const [value, setValue] = useState(() => (isEditor ? (request.prefill ?? '') : ''))

  return (
    <div className="dialog-body">
      <h2 className="dialog-title">{request.title}</h2>
      <textarea
        className="dialog-input"
        rows={isEditor ? 8 : 2}
        value={value}
        placeholder={isEditor ? '' : (request.placeholder ?? '')}
        onChange={(event) => setValue(event.target.value)}
        autoFocus
      />
      <div className="dialog-actions">
        <button type="button" className="dialog-confirm" onClick={() => onAnswer({ kind: 'text', value })}>
          OK
        </button>
        <button type="button" className="dialog-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
