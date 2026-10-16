import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import type { AppPreferences } from '@ramu/shared/types'
import { accessName } from '../chat/AgentControls'
import { FallbackSettings } from './FallbackSettings'
import { t } from '../i18n'
import { Dropdown } from '../Menu'
import { SETTINGS_FORM_CLASS, type DraftSetter } from './constants'
import { ToggleRow } from './ToggleRow'

export function AccessSettings({
  draft,
  onChange,
  busy,
}: {
  draft: AppPreferences
  onChange: DraftSetter
  busy: boolean
}) {
  return (
    <div className={SETTINGS_FORM_CLASS}>
      <SettingsGroupTitle>{t('Permissions')}</SettingsGroupTitle>
      <SettingsRow setting="defaultAccess">
        <SettingsLabel
          title={t('Default access')}
          help={t('Starting access for new threads. Existing threads keep theirs.')}
        />
        <Dropdown
          label={t('Default access')}
          value={draft.defaultAccess}
          options={(['edits', 'auto', 'full'] as const).map((value) => ({ value, label: accessName(value) }))}
          onChange={(value) => onChange({ ...draft, defaultAccess: value as AppPreferences['defaultAccess'] })}
        />
      </SettingsRow>
      <SettingsGroupTitle>{t('Provider fallback')}</SettingsGroupTitle>
      <ToggleRow
        draft={draft}
        onChange={onChange}
        busy={busy}
        setting="defaultAutoFallback"
        title="Automatic provider fallback"
        description="Switch to another provider when a usage limit is reached. When off, a thread waits and resumes on the same provider once the limit resets. Applies to new threads."
      />
      <FallbackSettings value={draft} onChange={onChange} busy={busy} />
    </div>
  )
}
