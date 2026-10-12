import { Dropdown } from './Menu'
import { Input } from '@/components/ui/input'
import { t } from './i18n'
import type { GoalPreferences } from '../../shared/types'

export function GoalSettings({ value, onChange }: { value: GoalPreferences; onChange: (value: GoalPreferences) => void }) {
  return <div className="settings-form">
    <div className="settings-row"><span><strong>{t('Goal detection')}</strong><span className="muted block small">{t('Auto lets the agent identify goals at the start or during a conversation. Manual starts goals only when you use /goal. Off disables automatic continuation.')}</span></span><Dropdown label={t('Goal detection')} value={value.mode} options={[{ value: 'auto', label: t('Auto (recommended)') }, { value: 'manual', label: t('Manual') }, { value: 'off', label: t('Off') }]} onChange={(mode) => onChange({ ...value, mode: mode as GoalPreferences['mode'] })} /></div>
    <div className="settings-row"><span><strong>{t('Maximum continuation turns')}</strong><span className="muted block small">{t('Extra agent turns per goal. Your messages and the first turn do not count. Default: 10. Unlimited keeps working until the goal is complete, blocked, or paused.')}</span></span><Dropdown label={t('Maximum continuation turns')} value={value.maxTurns === null ? 'unlimited' : String(value.maxTurns)} options={[...Array.from(new Set([3, 5, 10, 25, 50, 100, ...(value.maxTurns === null ? [] : [value.maxTurns])])).sort((a, b) => a - b).map((turns) => ({ value: String(turns), label: String(turns) })), { value: 'unlimited', label: t('Unlimited') }]} onChange={(turns) => onChange({ ...value, maxTurns: turns === 'unlimited' ? null : Number(turns) })} /></div>
    {value.maxTurns !== null && <div className="settings-row"><strong>{t('Custom turn limit')}</strong><Input type="number" aria-label={t('Custom turn limit')} min={1} max={1000} value={value.maxTurns} onChange={(e) => { const turns = Number(e.target.value); if (Number.isInteger(turns) && turns >= 1 && turns <= 1000) onChange({ ...value, maxTurns: turns }) }} /></div>}
    <p className="muted small">{t('Goals are checked by the working agent at turn boundaries, without periodic AI calls. Usage limits wait and resume automatically when a provider is available. Stop pauses the goal. Settings apply to existing goals too.')}</p>
  </div>
}
