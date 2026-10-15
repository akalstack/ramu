import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { t } from '../i18n'
import { Dropdown } from '../Menu'
import { SETTINGS_FORM_CLASS, sizeOptions } from './constants'
import { ToggleRow, type DraftProps } from './ToggleRow'

export function EditorSettings({ draft, onChange, busy }: DraftProps) {
  return (
    <div className={SETTINGS_FORM_CLASS}>
      <SettingsGroupTitle>{t('Editor')}</SettingsGroupTitle>
      <ToggleRow
        draft={draft}
        onChange={onChange}
        busy={busy}
        setting="previewTabs"
        title="Preview tabs"
        description="Single-click previews a file. Double-click or edit to keep it open."
      />
      <SettingsRow setting="editorFontSize">
        <strong>{t('Editor font size')}</strong>
        <Dropdown
          label={t('Editor font size')}
          value={String(draft.editorFontSize)}
          options={sizeOptions(10, 22)}
          onChange={(value) => onChange({ ...draft, editorFontSize: Number(value) })}
        />
      </SettingsRow>
      <SettingsGroupTitle>{t('Terminal')}</SettingsGroupTitle>
      <SettingsRow setting="terminalFontSize">
        <strong>{t('Terminal font size')}</strong>
        <Dropdown
          label={t('Terminal font size')}
          value={String(draft.terminalFontSize)}
          options={sizeOptions(8, 22)}
          onChange={(value) => onChange({ ...draft, terminalFontSize: Number(value) })}
        />
      </SettingsRow>
      <SettingsRow setting="defaultTerminalDock">
        <SettingsLabel
          title={t('Default terminal position')}
          help={t('Choose where the terminal panel opens. Checkouts with a saved terminal position keep that choice.')}
        />
        <Dropdown
          label={t('Default terminal position')}
          value={draft.defaultTerminalDock}
          options={[
            { value: 'bottom', label: t('Bottom') },
            { value: 'right', label: t('Right') },
          ]}
          onChange={(value) => onChange({ ...draft, defaultTerminalDock: value === 'right' ? 'right' : 'bottom' })}
        />
      </SettingsRow>
      <p className="muted text-muted-foreground small text-caption">
        {t('Files and terminals are shared by chats in the same checkout. Isolated worktrees keep separate state.')}
      </p>
    </div>
  )
}
