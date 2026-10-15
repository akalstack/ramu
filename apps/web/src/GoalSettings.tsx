import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Dropdown } from './Menu'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { t } from './i18n'
import type { GoalPreferences } from '@ramu/shared/types'

export function GoalSettings({ value, onChange }: { value: GoalPreferences; onChange: (value: GoalPreferences) => void }) {
  return <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0">
    <SettingsGroupTitle>{t('Goals')}</SettingsGroupTitle>
      <SettingsRow setting="goals.mode" ><SettingsLabel title={t('Automatic goals')} help={t("Let the agent set a goal for longer tasks. When off, start one with /goal.")} /><Switch aria-label={t('Automatic goals')} checked={value.mode === 'auto'} onCheckedChange={(checked) => onChange({ ...value, mode: checked ? 'auto' : 'manual' })} /></SettingsRow>
      <SettingsRow setting="goals.maxTurns" className=""><SettingsLabel title={t('Maximum continuation turns')} help={t("How many follow-up turns a goal may take on its own. Your messages and the first turn don't count.")} /><Dropdown label={t('Maximum continuation turns')} value={value.maxTurns === null ? 'unlimited' : String(value.maxTurns)} options={[...Array.from(new Set([3, 5, 10, 25, 50, 100, ...(value.maxTurns === null ? [] : [value.maxTurns])])).sort((a, b) => a - b).map((turns) => ({ value: String(turns), label: String(turns) })), { value: 'unlimited', label: t('Unlimited') }]} onChange={(turns) => onChange({ ...value, maxTurns: turns === 'unlimited' ? null : Number(turns) })} /></SettingsRow>
      {value.maxTurns !== null && <SettingsRow setting="goals.maxTurns"><SettingsLabel title={t('Custom turn limit')} help={t('Any number from 1 to 1000.')} /><Input type="number" aria-label={t('Custom turn limit')} min={1} max={1000} value={value.maxTurns} onChange={(e) => { const turns = Number(e.target.value); if (Number.isInteger(turns) && turns >= 1 && turns <= 1000) onChange({ ...value, maxTurns: turns }) }} /></SettingsRow>}
    <p className="muted text-muted-foreground small text-caption">{t("Goals resume after a usage limit resets, and Stop pauses them. Changes also apply to goals already running.")}</p>
  </div>
}
