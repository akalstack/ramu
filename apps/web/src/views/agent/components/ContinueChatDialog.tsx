import { t as translate, useLanguage } from '../../../i18n'
import { Dialog } from '../../../Menu'

/** Confirms starting a new chat from this one's transcript. It cannot be dismissed while the new chat is being created. */
export function ContinueChatDialog({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  useLanguage()
  return (
    <Dialog
      title={translate('Continue in a new chat?')}
      confirmLabel={translate('Continue in new chat')}
      busy={busy}
      onCancel={() => {
        if (!busy) onCancel()
      }}
      onConfirm={onConfirm}
    >
      <p>{translate('Start a new chat in this checkout using the current conversation as context.')}</p>
    </Dialog>
  )
}
