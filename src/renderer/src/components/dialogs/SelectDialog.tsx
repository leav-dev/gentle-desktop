import type { DialogAnswer } from '../../state/dialogResponses.ts'
import type { SelectRequest } from './dialogRequests.ts'

/**
 * One button per option. The option string itself is the wire value — the extension
 * matches on it exactly (including multiSelect's "[x] label" rounds).
 */
export function SelectDialog({
  request,
  onAnswer,
  onCancel
}: {
  request: SelectRequest
  onAnswer: (answer: DialogAnswer) => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <div className="dialog-body">
      <h2 className="dialog-title">{request.title}</h2>
      <div className="dialog-options">
        {request.options.map((option) => (
          <button
            key={option}
            type="button"
            className="dialog-option"
            onClick={() => onAnswer({ kind: 'select', option })}
          >
            {option}
          </button>
        ))}
      </div>
      <div className="dialog-actions">
        <button type="button" className="dialog-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}
