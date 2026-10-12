import { Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ChatGoal } from '../../shared/types'
import { t } from './i18n'
import { useAppSettings } from './AppSettings'

const LABELS: Record<ChatGoal['status'], string> = { active: 'Working toward goal', completed: 'Goal completed', blocked: 'Goal needs input', paused: 'Goal paused', 'turn-limit': 'Goal turn limit reached', 'waiting-provider': 'Waiting for provider' }
export function GoalBar({ goal, onControl }: { goal: ChatGoal; onControl: (action: 'pause' | 'resume' | 'clear') => void }) {
  const { preferences } = useAppSettings()
  const disabled = preferences.goals.mode === 'off'
  const active = goal.status === 'active' || goal.status === 'waiting-provider'
  return <div className="goal-bar" aria-label={t('Chat goal')}>
    <Target size={15} />
    <div className="goal-bar-text"><strong>{disabled ? t('Goals disabled') : t(LABELS[goal.status])}</strong><span className="goal-objective">{goal.objective}</span>
      {goal.reason && <span className="goal-reason muted small">{goal.reason}</span>}
      <span className="muted small">{t('{0} continuation turns · limit {1}', { '0': goal.turns, '1': preferences.goals.maxTurns ?? t('Unlimited') })}{goal.status === 'waiting-provider' && goal.retryAt ? ` · ${t('Next availability check: {0}', { '0': new Date(goal.retryAt).toLocaleString() })}` : ''}</span>
    </div>
    {goal.status !== 'completed' && <Button className="ghost small" disabled={disabled && !active} onClick={() => onControl(active ? 'pause' : 'resume')}>{active ? t('Pause goal') : t('Resume goal')}</Button>}
    <Button className="ghost small" onClick={() => onControl('clear')}>{t('Clear goal')}</Button>
  </div>
}
