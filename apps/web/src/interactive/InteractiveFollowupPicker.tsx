import { Checkbox } from '../components/desktop-checkbox'
import { useState } from 'react'
import type { InteractiveReference, InteractiveState } from '@ramu/shared/interactive'
import { interactiveSelectedFollowup } from '@ramu/shared/interactive'
import { t } from '../i18n'
import { Button } from '../components/desktop-button'
/** A frozen capture makes clear which values will enter the user's draft even if the live view changes. */
export function InteractiveFollowupPicker({
  reference,
  state,
  onStage,
  onClose,
}: {
  reference: InteractiveReference
  state: InteractiveState
  onStage(text: string): void
  onClose(): void
}) {
  const [keys, setKeys] = useState<string[]>([])
  const [custom, setCustom] = useState(false)
  return (
    <fieldset className="m-3 rounded-lg border border-border p-3">
      <legend>{t('Choose captured values')}</legend>
      {state.controls.map((control) => (
        <label key={control.key} className="my-1 flex items-center gap-2">
          <Checkbox
            checked={keys.includes(control.key)}
            onCheckedChange={(checked) =>
              setKeys((current) => (checked ? [...current, control.key] : current.filter((key) => key !== control.key)))
            }
          />
          <span>
            {control.label || control.key}: {control.value}
            {control.checked ? ` · ${t('Checked')}` : ''}
          </span>
        </label>
      ))}
      {state.custom !== null && (
        <label className="my-1 flex items-center gap-2">
          <Checkbox checked={custom} onCheckedChange={(checked) => setCustom(checked)} />
          {t('Include custom scenario data')}
        </label>
      )}
      <div className="mt-2 flex gap-2">
        <Button
          disabled={!keys.length && !custom}
          onClick={() => {
            onStage(interactiveSelectedFollowup(reference, state, keys, custom))
            onClose()
          }}
        >
          {t('Add to message')}
        </Button>
        <Button onClick={onClose}>{t('Cancel')}</Button>
      </div>
    </fieldset>
  )
}
