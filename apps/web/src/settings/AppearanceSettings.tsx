import { SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Button } from '@/components/desktop-button'
import type { AppPreferences } from '@ramu/shared/types'
import { t } from '../i18n'
import { PasteTheme, ThemeEditor } from '../theme/ThemeEditor'
import { removeTheme, selectTheme, themeLibrary, useSelectedTheme, useThemeLibrary } from '../theme/themes'
import { useRef, useState } from 'react'
import { importThemeFile, themeDigest, type RamuTheme } from '@ramu/shared/theme'
import { notifyError } from '../chat/Notifications'
import { setAppearance, useAppearance, type Appearance } from '../appearance'
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
  const appearance = useAppearance()
  const [editing, setEditing] = useState(false)
  const [opened, setOpened] = useState<{ theme: RamuTheme; notice?: string } | null>(null)
  const [pasting, setPasting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  /** Previews a shared theme. The same theme again is reused; a changed copy of an installed id becomes its own theme. */
  const openImported = async (text: string) => {
    const result = await importThemeFile(text)
    if (!result.ok) {
      notifyError(t(result.error), t('Import theme'))
      return false
    }
    const same = themeLibrary().find((theme) => theme.id === result.theme.id)
    if (same && (await themeDigest(same)) === result.digest) {
      selectTheme(same.id)
      return true
    }
    const theme = same ? { ...result.theme, id: `${result.theme.id}-${Date.now().toString(36)}` } : result.theme
    const notice = result.edited
      ? t('The colors in this file were changed after it was exported.')
      : result.issues.length
        ? t('Some colors are hard to read. Adjust them before keeping this theme.')
        : undefined
    setOpened({ theme, notice })
    return true
  }
  const saved = useThemeLibrary()
  const current = useSelectedTheme()
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
      <SettingsRow>
        <SettingsLabel
          title={t('Theme')}
          help={t('Choose light or dark, or follow your device. Applies immediately on this device only.')}
        />
        <Dropdown
          label={t('Theme')}
          value={appearance}
          options={[
            { value: 'system', label: t('Match device') },
            { value: 'light', label: t('Light') },
            { value: 'dark', label: t('Dark') },
          ]}
          onChange={(value) => setAppearance(value as Appearance)}
        />
      </SettingsRow>
      <SettingsRow>
        <SettingsLabel
          title={t('Colors')}
          help={t('Adjust every color of the app, light and dark. Nothing changes until you keep it.')}
        />
        <span className="flex flex-wrap items-center justify-end gap-2 min-w-0">
          {saved.length > 0 && (
            <Dropdown
              label={t('Color theme')}
              value={current.id}
              options={[
                { value: 'ramu-default', label: 'Ramu Default' },
                ...saved.map((x) => ({ value: x.id, label: x.name })),
              ]}
              onChange={(id) => selectTheme(id === 'ramu-default' ? null : id)}
            />
          )}
          <Button variant="secondary" className={SECONDARY_BUTTON_CLASS} onClick={() => setEditing(true)}>
            {t('Customize colors')}
          </Button>
          <Button variant="secondary" className={SECONDARY_BUTTON_CLASS} onClick={() => fileInput.current?.click()}>
            {t('Import theme')}
          </Button>
          <Button variant="ghost" onClick={() => setPasting(true)}>
            {t('Paste JSON')}
          </Button>
          {current.id !== 'ramu-default' && (
            <Button variant="ghost" onClick={() => removeTheme(current.id)}>
              {t('Delete theme')}
            </Button>
          )}
        </span>
      </SettingsRow>
      {editing && <ThemeEditor onClose={() => setEditing(false)} />}
      {pasting && <PasteTheme onClose={() => setPasting(false)} onPreview={openImported} />}
      {opened && <ThemeEditor imported={opened.theme} notice={opened.notice} onClose={() => setOpened(null)} />}
      <input
        ref={fileInput}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) await openImported(await file.text())
        }}
      />
      <SettingsRow setting="accent">
        <SettingsLabel
          title={t('Primary color')}
          help={
            current.id === 'ramu-default'
              ? t('Used for primary actions, activity, and links.')
              : t('Set by your color theme. Choose Ramu Default to use this.')
          }
        />
        <Dropdown
          label={t('Primary color')}
          disabled={current.id !== 'ramu-default'}
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
