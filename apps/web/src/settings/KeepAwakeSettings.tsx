import { SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Dropdown } from '../Menu'
import { t } from '../i18n'
import { ToggleRow, type DraftProps } from './ToggleRow'

/** One shared host preference, available in System and Computer use. `supported` is false on hosts that cannot hold it. */
export function KeepAwakeSettings({ supported = true, ...props }: DraftProps & { supported?: boolean }) {
  const { draft, onChange } = props
  const toggleProps = props
  if (!supported)
    return (
      <ToggleRow
        {...toggleProps}
        setting="keepAwake"
        title="Keep host awake"
        description="Keeping the host awake is available on macOS."
        disabled
      />
    )
  return (
    <>
      <ToggleRow
        {...toggleProps}
        setting="keepAwake"
        title="Keep host awake"
        description="Stop your Mac sleeping from idle while the service runs. Display sleep and manual sleep still work."
      />
      {draft.keepAwake && (
        <SettingsRow setting="keepAwakeWhen">
          <SettingsLabel title={t('When to keep awake')} help={t('Choose whether to keep awake on battery power.')} />
          <Dropdown
            label={t('When to keep awake')}
            value={draft.keepAwakeWhen}
            options={[
              { value: 'plugged-in', label: t('Plugged in only (recommended)') },
              { value: 'always', label: t('Plugged in and on battery') },
            ]}
            onChange={(when) => onChange({ ...draft, keepAwakeWhen: when === 'always' ? 'always' : 'plugged-in' })}
          />
        </SettingsRow>
      )}
    </>
  )
}
