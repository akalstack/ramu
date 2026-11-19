import { SettingsGroupTitle, SettingsLabel, SettingsRow, SettingsTitle } from '@/components/settings-row'
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
        <SettingsTitle>{t('Editor font size')}</SettingsTitle>
        <Dropdown
          label={t('Editor font size')}
          value={String(draft.editorFontSize)}
          options={sizeOptions(10, 22)}
          onChange={(value) => onChange({ ...draft, editorFontSize: Number(value) })}
        />
      </SettingsRow>
      <SettingsRow setting="defaultMarkdownView">
        <SettingsLabel
          title={t('Default Markdown view')}
          help={t('Choose how Markdown files open. Links to a specific line open Source.')}
        />
        <Dropdown
          label={t('Default Markdown view')}
          value={draft.defaultMarkdownView}
          disabled={busy}
          options={[
            { value: 'source', label: t('Source') },
            { value: 'edit', label: t('Edit') },
            { value: 'preview', label: t('Preview') },
          ]}
          onChange={(value) => {
            if (value === 'source' || value === 'edit' || value === 'preview')
              onChange({ ...draft, defaultMarkdownView: value })
          }}
        />
      </SettingsRow>
      <SettingsGroupTitle>{t('Terminal')}</SettingsGroupTitle>
      <SettingsRow setting="terminalFontSize">
        <SettingsTitle>{t('Terminal font size')}</SettingsTitle>
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
            { value: 'right', label: t('Workspace tabs') },
          ]}
          onChange={(value) => onChange({ ...draft, defaultTerminalDock: value === 'right' ? 'right' : 'bottom' })}
        />
      </SettingsRow>
      <p className="muted text-muted-foreground small text-caption">
        {t('Files and terminals are shared by threads in the same checkout. Isolated worktrees keep separate state.')}
      </p>
    </div>
  )
}
