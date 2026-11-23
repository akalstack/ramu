import { useEffect, useState } from 'react'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Input } from '@/components/ui/input'
import type { AppPreferences } from '@ramu/shared/types'
import { BackgroundControls } from '../Automation'
import { t } from '../i18n'
import { SETTINGS_FORM_CLASS, type DraftSetter } from './constants'
import { KeepAwakeSettings } from './KeepAwakeSettings'
import { ToggleRow } from './ToggleRow'
import { useSettingsInvoke } from './SettingsScope'

export function SystemSettings({
  draft,
  onChange,
  busy,
}: {
  draft: AppPreferences
  onChange: DraftSetter
  busy: boolean
}) {
  const invoke = useSettingsInvoke()
  const toggleProps = { draft, onChange, busy }
  const [awakeSupported, setAwakeSupported] = useState(true)
  useEffect(() => {
    void invoke('background.keepAwake')
      .then((status) => setAwakeSupported(status.supported))
      .catch(() => {})
  }, [invoke])
  return (
    <div className={SETTINGS_FORM_CLASS}>
      <SettingsGroupTitle>{t('Background service')}</SettingsGroupTitle>
      <BackgroundControls onInstalled={() => onChange((current) => ({ ...current, keepAwake: true }))} />
      <KeepAwakeSettings {...toggleProps} supported={awakeSupported} />
      <SettingsGroupTitle>{t('Daily recaps')}</SettingsGroupTitle>
      <ToggleRow
        {...toggleProps}
        setting="recapsEnabled"
        title="Daily recaps"
        description="Show recent threads and unfinished work on Home. Uses model tokens to write the summary."
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
    </div>
  )
}
