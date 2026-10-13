import { SettingsRow } from '@/components/settings-row'
import { Dropdown } from './Menu'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { t } from './i18n'
import type { GoalPreferences } from '@ramu/shared/types'

export function GoalSettings({ value, onChange }: { value: GoalPreferences; onChange: (value: GoalPreferences) => void }) {
  return <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0">
      <SettingsRow className="settings-toggle"><span><strong>{t('Automatic goals')}</strong><span className="muted text-muted-foreground block block small text-caption">{t("Create goals for longer tasks. Turn off to start goals with /goal. Existing goals keep running.")}</span></span><Switch aria-label={t('Automatic goals')} checked={value.mode === 'auto'} onCheckedChange={(checked) => onChange({ ...value, mode: checked ? 'auto' : 'manual' })} /></SettingsRow>
      <SettingsRow className=""><span><strong>{t('Maximum continuation turns')}</strong><span className="muted text-muted-foreground block block small text-caption">{t("Limit automatic follow-up turns. Your messages and the first turn do not count.")}</span></span><Dropdown label={t('Maximum continuation turns')} value={value.maxTurns === null ? 'unlimited' : String(value.maxTurns)} options={[...Array.from(new Set([3, 5, 10, 25, 50, 100, ...(value.maxTurns === null ? [] : [value.maxTurns])])).sort((a, b) => a - b).map((turns) => ({ value: String(turns), label: String(turns) })), { value: 'unlimited', label: t('Unlimited') }]} onChange={(turns) => onChange({ ...value, maxTurns: turns === 'unlimited' ? null : Number(turns) })} /></SettingsRow>
      {value.maxTurns !== null && <SettingsRow className=""><strong>{t('Custom turn limit')}</strong><Input type="number" aria-label={t('Custom turn limit')} min={1} max={1000} value={value.maxTurns} onChange={(e) => { const turns = Number(e.target.value); if (Number.isInteger(turns) && turns >= 1 && turns <= 1000) onChange({ ...value, maxTurns: turns }) }} /></SettingsRow>}
    <p className="muted text-muted-foreground small text-caption">{t("Goals resume after usage limits reset. Stop pauses the goal. Changes apply to existing goals.")}</p>
  </div>
}
