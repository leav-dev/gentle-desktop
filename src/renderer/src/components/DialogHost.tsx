import type { DialogRequest } from '../../../shared/protocol.ts'
import type { DialogAnswer } from '../state/dialogResponses.ts'
import { SelectDialog } from './dialogs/SelectDialog.tsx'
import { ConfirmDialog } from './dialogs/ConfirmDialog.tsx'
import { InputDialog } from './dialogs/InputDialog.tsx'
import { FloatingWindow } from './FloatingWindow.tsx'

/**
 * Dialogs can pile up while a turn runs, so they queue and are presented one at a
 * time. Every dialog is cancellable: an unanswered request blocks the extension.
 * The frame is the shared floating-window chrome; a dialog is never dismissible
 * by backdrop click — it must be answered or cancelled explicitly.
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
    <FloatingWindow
      title={active.title}
      dismissible={false}
      centered
      className="floating-panel-dialog"
      onClose={() => onCancel()}
    >
      <div className="dialog-queue-meta">
        {dialogs.length > 1 ? `${dialogs.length} dialogs pending — answering one shows the next` : '1 dialog pending'}
      </div>
      {active.method === 'select' ? (
        <SelectDialog request={active} onAnswer={onAnswerActive} onCancel={onCancel} />
      ) : active.method === 'confirm' ? (
        <ConfirmDialog request={active} onAnswer={onAnswerActive} onCancel={onCancel} />
      ) : (
        <InputDialog request={active} onAnswer={onAnswerActive} onCancel={onCancel} />
      )}
    </FloatingWindow>
  )
}
