import { SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import type { AppPreferences } from '@ramu/shared/types'
import { t } from '../i18n'
import { Dropdown } from '../Menu'
import { SECONDARY_BUTTON_CLASS, SETTINGS_FORM_CLASS, sizeOptions } from './constants'
import { ToggleRow, type DraftProps } from './ToggleRow'

export function AppearanceSettings({
  draft,
  onChange,
  busy,
  sizesReset,
  onResetSizes,
}: DraftProps & { sizesReset: boolean; onResetSizes: () => void }) {
  const toggleProps = { draft, onChange, busy }
  return (
    <div className={SETTINGS_FORM_CLASS}>
      <SettingsRow setting="language">
        <SettingsLabel title={t('Language')} help={t('Choose your preferred language. Changes apply after saving.')} />
        <Dropdown
          label={t('App language')}
          value={draft.language}
          options={[
            { value: 'system', label: t('Follow system') },
            { value: 'id', label: 'Bahasa Indonesia' },
            { value: 'en', label: 'English' },
          ]}
          onChange={(language) => onChange({ ...draft, language: language as AppPreferences['language'] })}
        />
      </SettingsRow>
      <SettingsRow setting="accent">
        <SettingsLabel title={t('Primary color')} help={t('Used for primary actions, activity, and links.')} />
        <Dropdown
          label={t('Primary color')}
          value={draft.accent}
          options={[
            { value: 'blue', label: t('Blue') },
            { value: 'violet', label: t('Violet') },
            { value: 'teal', label: t('Teal') },
          ]}
          onChange={(accent) => onChange({ ...draft, accent: accent as AppPreferences['accent'] })}
        />
      </SettingsRow>
      <SettingsRow setting="fontFamily">
        <SettingsLabel title={t('Interface font')} help={t('Choose the font used throughout Ramu.')} />
        <Dropdown
          label={t('Interface font')}
          value={draft.fontFamily}
          options={[
            { value: 'system', label: t('System') },
            { value: 'geist', label: 'Geist' },
          ]}
          onChange={(fontFamily) => onChange({ ...draft, fontFamily: fontFamily as AppPreferences['fontFamily'] })}
        />
      </SettingsRow>
      <SettingsRow setting="fontSize">
        <strong>{t('Interface font size')}</strong>
        <Dropdown
          label={t('Interface font size')}
          value={String(draft.fontSize)}
          options={sizeOptions(12, 18)}
          onChange={(value) => onChange({ ...draft, fontSize: Number(value) })}
        />
      </SettingsRow>
      <ToggleRow
        {...toggleProps}
        setting="reduceMotion"
        title="Reduce motion"
        description="Disable interface animations. System reduced motion is always respected."
      />
      <ToggleRow
        {...toggleProps}
        setting="fontSmoothing"
        title="Crisper text"
        description="Use lighter text rendering on macOS."
      />
      <SettingsRow>
        <SettingsLabel
          title={t('Layout sizes')}
          help={t(
            'Return the sidebar, editor/thread split and terminal height to their default sizes in every workspace.',
          )}
        />
        <Button variant="secondary" className={SECONDARY_BUTTON_CLASS} onClick={onResetSizes}>
          {sizesReset ? t('Sizes reset') : t('Reset sizes')}
        </Button>
      </SettingsRow>
      <div className="settings-appearance-sample flex items-center gap-2.5 p-3.5 [border:1px_solid_transparent] rounded-(--radius-s) flex-wrap mt-4 bg-fill">
        <span
          className={`accent-swatch w-4 h-4 rounded-full accent-${draft.accent} [&.accent-blue]:bg-[#0a84ff] [&.accent-violet]:bg-[#7652d4] [&.accent-teal]:bg-[#087f7b]`}
        />
        <span>{t('Project workspace')}</span>
        <span className="muted text-muted-foreground">{t('Preview of your primary accent')}</span>
      </div>
    </div>
  )
}
