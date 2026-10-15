import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Input } from '@/components/ui/input'
import type { AppPreferences } from '@ramu/shared/types'
import { AppUpdates } from '../AppUpdates'
import { BackgroundControls } from '../Automation'
import { t } from '../i18n'
import { Dropdown } from '../Menu'
import { SETTINGS_FORM_CLASS, type DraftSetter } from './constants'
import { ToggleRow } from './ToggleRow'

export function SystemSettings({
  draft,
  onChange,
  busy,
}: {
  draft: AppPreferences
  onChange: DraftSetter
  busy: boolean
}) {
  const toggleProps = { draft, onChange, busy }
  return (
    <div className={SETTINGS_FORM_CLASS}>
      <SettingsGroupTitle>{t('Background service')}</SettingsGroupTitle>
      <BackgroundControls onInstalled={() => onChange((current) => ({ ...current, keepAwake: true }))} />
      <ToggleRow
        {...toggleProps}
        setting="keepAwake"
        title="Keep computer awake"
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
      <SettingsGroupTitle>{t('Daily recaps')}</SettingsGroupTitle>
      <ToggleRow
        {...toggleProps}
        setting="recapsEnabled"
        title="Daily recaps"
        description="Show recent chats and unfinished work on Home. Uses model tokens to write the summary."
      />
      {draft.recapsEnabled && (
        <SettingsRow setting="recapTime">
          <SettingsLabel
            title={t('Generate daily at')}
            help={t('Create the recap at this time in your system timezone.')}
          />
          <Input
            aria-label={t('Generate daily at')}
            type="time"
            value={draft.recapTime}
            onChange={(e) => onChange({ ...draft, recapTime: e.target.value })}
          />
        </SettingsRow>
      )}
      <SettingsGroupTitle>{t('Updates')}</SettingsGroupTitle>
      <AppUpdates value={draft} onChange={onChange} />
    </div>
  )
}
