import { useState } from 'react'
import { Pressable, View } from 'react-native'
import type { InteractiveReference, InteractiveState } from '@ramu/shared/interactive'
import { interactiveSelectedFollowup } from '@ramu/shared/interactive'
import { translate } from '@ramu/shared/i18n'
import { useStore } from '../runtime/store'
import { Button, T } from './ui'
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
  const { language } = useStore(),
    t = (text: string) => translate(language, text)
  const [keys, setKeys] = useState<string[]>([])
  const [custom, setCustom] = useState(false)
  return (
    <View style={{ gap: 8 }}>
      <T weight="600">{t('Choose captured values')}</T>
      {state.controls.map((control) => (
        <Pressable
          key={control.key}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: keys.includes(control.key) }}
          onPress={() =>
            setKeys((current) =>
              current.includes(control.key) ? current.filter((key) => key !== control.key) : [...current, control.key],
            )
          }
          style={{ paddingVertical: 8 }}
        >
          <T>
            {keys.includes(control.key) ? '☑ ' : '☐ '}
            {control.label || control.key}: {control.value}
            {control.checked ? ` · ${t('Checked')}` : ''}
          </T>
        </Pressable>
      ))}
      {state.custom !== null && (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: custom }}
          onPress={() => setCustom((value) => !value)}
          style={{ paddingVertical: 8 }}
        >
          <T>
            {custom ? '☑ ' : '☐ '}
            {t('Include custom scenario data')}
          </T>
        </Pressable>
      )}
      <Button
        title={t('Add selected values to draft')}
        disabled={!keys.length && !custom}
        onPress={() => {
          onStage(interactiveSelectedFollowup(reference, state, keys, custom))
          onClose()
        }}
      />
      <Button title={t('Cancel')} onPress={onClose} />
    </View>
  )
}
