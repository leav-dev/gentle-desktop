import type { DialogRequest } from '../../../shared/protocol.ts'
import type { DialogAnswer } from '../state/dialogResponses.ts'
import { SelectDialog } from './dialogs/SelectDialog.tsx'
import { ConfirmDialog } from './dialogs/ConfirmDialog.tsx'
import { InputDialog } from './dialogs/InputDialog.tsx'

/**
 * Dialogs can pile up while a turn runs, so they queue and are presented one at a
 * time. Every dialog is cancellable: an unanswered request blocks the extension.
 */
export function DialogHost({
  dialogs,
  onAnswer
}: {
  dialogs: readonly DialogRequest[]
  onAnswer: (request: DialogRequest, answer: DialogAnswer) => void
}): React.JSX.Element | null {
  const active = dialogs[0]
  if (active === undefined) return null

  const onCancel = (): void => onAnswer(active, { kind: 'cancel' })
  const onAnswerActive = (answer: DialogAnswer): void => onAnswer(active, answer)

  return (
    <div className="dialog-overlay" role="dialog" aria-modal="true" aria-label={active.title}>
      <div className="dialog-queue">
        <div className="dialog-queue-meta">
          {dialogs.length > 1 ? `${dialogs.length} dialogs pending — answering one shows the next` : '1 dialog pending'}
        </div>
        <div className="dialog-card">
          {active.method === 'select' ? (
            <SelectDialog request={active} onAnswer={onAnswerActive} onCancel={onCancel} />
          ) : active.method === 'confirm' ? (
            <ConfirmDialog request={active} onAnswer={onAnswerActive} onCancel={onCancel} />
          ) : (
            <InputDialog request={active} onAnswer={onAnswerActive} onCancel={onCancel} />
          )}
        </div>
      </div>
    </div>
  )
}
