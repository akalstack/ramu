import { t as translate, useLanguage } from '../../../i18n'
import { Dialog } from '../../../Menu'

/** Asks before a model switch that gives up the conversation's cache; "Don't show this again" turns the warning off. */
export function ModelChangeDialog({
  dontWarn,
  onDontWarnChange,
  onCancel,
  onConfirm,
}: {
  dontWarn: boolean
  onDontWarnChange: (value: boolean) => void
  onCancel: () => void
  onConfirm: () => void
}) {
  useLanguage()
  return (
    <Dialog
      title={translate('Change model mid-conversation?')}
      confirmLabel={translate('Change model')}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <p>
        {translate(
          "The new model can't reuse the cache built for this conversation, so the first message after the change uses more of your usage than usual.",
        )}
      </p>
      <label className="mt-2 flex items-center gap-2 text-control">
        <input type="checkbox" checked={dontWarn} onChange={(event) => onDontWarnChange(event.target.checked)} />
        {translate("Don't show this again")}
      </label>
    </Dialog>
  )
}
