import { SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Dropdown } from '../Menu'
import { t } from '../i18n'
import { ToggleRow, type DraftProps } from './ToggleRow'

/** One shared host preference, available in System and Computer use, left out on hosts that cannot hold it. */
export function KeepAwakeSettings({ supported = true, ...props }: DraftProps & { supported?: boolean }) {
  const { draft, onChange } = props
  const toggleProps = props
  if (!supported) return null
  return (
    <>
      <ToggleRow
        {...toggleProps}
        setting="keepAwake"
        title="Keep host awake"
        description="Stop the host sleeping from idle while the service runs. The display can still turn off."
      />
      {draft.keepAwake && (
        <SettingsRow setting="keepAwakeWhen">
          <SettingsLabel
            title={t('When to keep awake')}
            help={t('On battery, recommended keeps the host awake only while agents work, and a minute after.')}
          />
          <Dropdown
            label={t('When to keep awake')}
            value={draft.keepAwakeWhen}
            options={[
              { value: 'plugged-in', label: t('Plugged in, or while agents work (recommended)') },
              { value: 'always', label: t('Always') },
            ]}
            onChange={(when) => onChange({ ...draft, keepAwakeWhen: when === 'always' ? 'always' : 'plugged-in' })}
          />
        </SettingsRow>
      )}
    </>
  )
}
