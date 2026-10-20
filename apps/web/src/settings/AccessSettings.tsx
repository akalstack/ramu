import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import type { AppPreferences } from '@ramu/shared/types'
import { accessName } from '../chat/AgentControls'
import { FallbackSettings } from './FallbackSettings'
import { t } from '../i18n'
import { Dropdown } from '../Menu'
import { SETTINGS_FORM_CLASS, type DraftSetter } from './constants'
import { PermissionRules } from './PermissionRules'
import { LimitChoiceRow } from './LimitChoiceRow'

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
      <PermissionRules disabled={busy} />
    </div>
  )
}

/** What happens when a model reaches its usage limit; shown with model sets on the Models page. */
export function ProviderFallbackSettings({
  draft,
  onChange,
  busy,
}: {
  draft: AppPreferences
  onChange: DraftSetter
  busy: boolean
}) {
  return (
    <div className={`${SETTINGS_FORM_CLASS} mt-8`}>
      <SettingsGroupTitle>{t('Provider fallback')}</SettingsGroupTitle>
      <LimitChoiceRow draft={draft} onChange={onChange} busy={busy} />
      <FallbackSettings value={draft} onChange={onChange} busy={busy} />
    </div>
  )
}
