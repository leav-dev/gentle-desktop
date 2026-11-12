import type { DialogAnswer } from '../../state/dialogResponses.ts'
import type { ConfirmRequest } from './dialogRequests.ts'

/** Confirm distinguishes an explicit "no" (confirmed: false) from cancellation. */
export function ConfirmDialog({
  request,
  onAnswer,
  onCancel
}: {
  request: ConfirmRequest
  onAnswer: (answer: DialogAnswer) => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <div className="dialog-body">
      <h2 className="dialog-title">{request.title}</h2>
      <p className="dialog-message">{request.message}</p>
      <div className="dialog-actions">
        <button type="button" className="dialog-confirm" onClick={() => onAnswer({ kind: 'confirm', confirmed: true })}>
          Yes
        </button>
        <button type="button" className="dialog-decline" onClick={() => onAnswer({ kind: 'confirm', confirmed: false })}>
          No
        </button>
        <button type="button" className="dialog-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
