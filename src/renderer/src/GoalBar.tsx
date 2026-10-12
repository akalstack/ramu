import { ChevronDown, CircleAlert, CircleCheck, CirclePause, Clock3, Target } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { ChatGoal } from '../../shared/types'
import { t } from './i18n'
import { useAppSettings } from './AppSettings'

const LABELS: Record<ChatGoal['status'], string> = { active: 'Working toward goal', completed: 'Goal completed', blocked: 'Goal needs input', paused: 'Goal paused', 'turn-limit': 'Goal turn limit reached', 'waiting-provider': 'Waiting for provider' }
// A finished goal sits in the transcript where the work ended; a goal still in progress stays pinned above the composer as a slim bar.
export function GoalBar({ goal, inline = false, onControl }: { goal: ChatGoal; inline?: boolean; onControl: (action: 'pause' | 'resume' | 'clear') => void }) {
  const { preferences } = useAppSettings()
  const disabled = preferences.goals.mode === 'off'
  const active = goal.status === 'active' || goal.status === 'waiting-provider'
  const Icon = disabled ? CirclePause : goal.status === 'completed' ? CircleCheck : goal.status === 'blocked' || goal.status === 'turn-limit' ? CircleAlert : goal.status === 'paused' ? CirclePause : goal.status === 'waiting-provider' ? Clock3 : Target
  return <div className={inline ? 'goal-row' : 'goal-dock'}>
    <Collapsible className="goal-bar" data-status={disabled ? 'paused' : goal.status} aria-label={t('Chat goal')}>
      <div className="goal-bar-header">
        <CollapsibleTrigger render={<Button variant="ghost" className="ghost goal-summary" />}>
          <Icon data-icon="inline-start" />
          <span className="goal-bar-text"><strong>{disabled ? t('Goals disabled') : t(LABELS[goal.status])}</strong><span className="goal-objective" title={goal.objective}>{goal.objective}</span></span>
          <ChevronDown data-icon="inline-end" className="goal-caret" />
        </CollapsibleTrigger>
        <div className="goal-actions">
          {goal.status !== 'completed' && <Button variant="ghost" size="sm" className="ghost small" disabled={disabled && !active} onClick={() => onControl(active ? 'pause' : 'resume')}>{active ? t('Pause goal') : t('Resume goal')}</Button>}
          {goal.status !== 'completed' && <Button variant="ghost" size="sm" className="ghost small" onClick={() => onControl('clear')}>{t('Clear goal')}</Button>}
        </div>
      </div>
      <CollapsibleContent>
        <div className="goal-details">
          {goal.reason && <p className="goal-reason">{goal.reason}</p>}
          <span className="muted small">{t('{0} continuation turns · limit {1}', { '0': goal.turns, '1': preferences.goals.maxTurns ?? t('Unlimited') })}{goal.status === 'waiting-provider' && goal.retryAt ? ` · ${t('Next availability check: {0}', { '0': new Date(goal.retryAt).toLocaleString() })}` : ''}</span>
        </div>
      </CollapsibleContent>
    </Collapsible>
  </div>
}
