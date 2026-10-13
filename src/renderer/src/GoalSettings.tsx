import { SettingsRow } from '@/components/settings-row'
import { Dropdown } from './Menu'
import { Switch } from '@/components/ui/switch'
import { FieldContent, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { t } from './i18n'
import type { GoalPreferences } from '../../shared/types'

export function GoalSettings({ value, onChange }: { value: GoalPreferences; onChange: (value: GoalPreferences) => void }) {
  return <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0">
    <FieldGroup className="gap-0">
      <SettingsRow className="settings-toggle">
        <FieldContent>
          <FieldLabel htmlFor="automatic-goals">{t('Automatic goals')}</FieldLabel>
          <FieldDescription>{t('Let the agent start goals automatically for tasks that need multiple turns. When off, use /goal to start a goal. Existing goals continue until completed, blocked, or paused.')}</FieldDescription>
        </FieldContent>
        <Switch id="automatic-goals" aria-label={t('Automatic goals')} checked={value.mode === 'auto'} onCheckedChange={(checked) => onChange({ ...value, mode: checked ? 'auto' : 'manual' })} />
      </SettingsRow>
      <SettingsRow className=""><span><strong>{t('Maximum continuation turns')}</strong><span className="muted text-muted-foreground block block small text-caption">{t('Extra agent turns per goal. Your messages and the first turn do not count. Default: 10. Unlimited keeps working until the goal is complete, blocked, or paused.')}</span></span><Dropdown label={t('Maximum continuation turns')} value={value.maxTurns === null ? 'unlimited' : String(value.maxTurns)} options={[...Array.from(new Set([3, 5, 10, 25, 50, 100, ...(value.maxTurns === null ? [] : [value.maxTurns])])).sort((a, b) => a - b).map((turns) => ({ value: String(turns), label: String(turns) })), { value: 'unlimited', label: t('Unlimited') }]} onChange={(turns) => onChange({ ...value, maxTurns: turns === 'unlimited' ? null : Number(turns) })} /></SettingsRow>
      {value.maxTurns !== null && <SettingsRow className=""><strong>{t('Custom turn limit')}</strong><Input type="number" aria-label={t('Custom turn limit')} min={1} max={1000} value={value.maxTurns} onChange={(e) => { const turns = Number(e.target.value); if (Number.isInteger(turns) && turns >= 1 && turns <= 1000) onChange({ ...value, maxTurns: turns }) }} /></SettingsRow>}
    </FieldGroup>
    <p className="muted text-muted-foreground small text-caption">{t('Goals are checked by the working agent at turn boundaries, without periodic AI calls. Usage limits wait and resume automatically when a provider is available. Stop pauses the goal. Settings apply to existing goals too.')}</p>
  </div>
}
