import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Input } from '@/components/ui/input'
import type { AppPreferences } from '@ramu/shared/types'
import { AppUpdates } from './AppUpdates'
import { BackgroundControls } from '../Automation'
import { t } from '../i18n'
import { SETTINGS_FORM_CLASS, type DraftSetter } from './constants'
import { KeepAwakeSettings } from './KeepAwakeSettings'
import { ToggleRow } from './ToggleRow'
import { copyText } from '../ipc'
import { useSettingsInvoke } from './SettingsScope'
import { Button } from '@/components/desktop-button'
import { notifyError } from '../chat/Notifications'
import { errorText } from '../lib/errors'

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
  return (
    <div className={SETTINGS_FORM_CLASS}>
      <SettingsGroupTitle>{t('Background service')}</SettingsGroupTitle>
      <ToggleRow
        {...toggleProps}
        setting="localCrashReports"
        title="Keep local crash reports"
        description="Off by default. Keeps sanitized service errors and Electron crash dumps on this device, never uploaded. Restart Ramu to apply. Native dumps may hold process memory and are left out of copied diagnostics."
      />
      <div className="flex gap-2 mb-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void invoke('diagnostics.export')
              .then(copyText)
              .catch((e) => notifyError(errorText(e)))
          }
        >
          {t('Copy sanitized diagnostics')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void invoke('diagnostics.clear').catch((e) => notifyError(errorText(e)))}
        >
          {t('Clear diagnostics')}
        </Button>
      </div>
      <BackgroundControls onInstalled={() => onChange((current) => ({ ...current, keepAwake: true }))} />
      <KeepAwakeSettings {...toggleProps} />
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
      <SettingsGroupTitle>{t('Updates')}</SettingsGroupTitle>
      <AppUpdates value={draft} onChange={onChange} />
    </div>
  )
}
