import { ChevronRight, CircleAlert, CircleCheck, CirclePause, Clock3, Pause, Play, Target, X } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { ChatGoal } from '../../shared/types'
import { t, useLanguage } from './i18n'
import { useAppSettings } from './AppSettings'

const LABELS: Record<ChatGoal['status'], string> = { active: 'Working toward goal', completed: 'Goal completed', blocked: 'Goal needs input', paused: 'Goal paused', 'turn-limit': 'Goal turn limit reached', 'waiting-provider': 'Waiting for provider' }
const goalIcon = (goal: ChatGoal) => goal.status === 'completed' ? CircleCheck : goal.status === 'blocked' || goal.status === 'turn-limit' ? CircleAlert : goal.status === 'paused' ? CirclePause : goal.status === 'waiting-provider' ? Clock3 : Target

function GoalDetails({ goal }: { goal: ChatGoal }) {
  const { preferences } = useAppSettings()
  const limit = preferences.goals.maxTurns
  return <div className="goal-details flex flex-col gap-1.5 p-[2px_4px_8px_28px]">
    <p className="goal-objective-full m-0 whitespace-pre-wrap [overflow-wrap:anywhere] select-text text-foreground">{goal.objective}</p>
    {goal.reason && <p className="goal-reason m-0 text-soft whitespace-pre-wrap [overflow-wrap:anywhere] select-text">{goal.reason}</p>}
    <span className="goal-meta text-muted-foreground text-caption">{limit === null ? t('{0} continuation turns · no limit', { '0': goal.turns }) : t('{0} continuation turns · limit {1}', { '0': goal.turns, '1': limit })}{goal.status === 'waiting-provider' && goal.retryAt ? ` · ${t('Next availability check: {0}', { '0': new Date(goal.retryAt).toLocaleString() })}` : ''}</span>
  </div>
}

/** A goal still in progress: the first row of the tray the composer rests on. */
export function GoalBar({ goal, onControl }: { goal: ChatGoal; onControl: (action: 'pause' | 'resume' | 'clear') => void }) {
  useLanguage()
  const { preferences } = useAppSettings()
  const active = goal.status === 'active' || goal.status === 'waiting-provider'
  const Icon = goalIcon(goal), limit = preferences.goals.maxTurns
  return <Collapsible className="goal-bar [&[data-status='paused']_.goal-icon]:text-muted-foreground [&:is([data-status='blocked'],_[data-status='turn-limit'],_[data-status='waiting-provider'])_.goal-icon]:text-warn [&[data-open]_.goal-summary_.caret]:opacity-100 [&[data-open]_.goal-summary_.caret]:[transform:rotate(90deg)] text-control" data-status={goal.status} aria-label={t('Chat goal')}>
    <div className="goal-bar-header flex items-center gap-0.5 min-h-8">
      <CollapsibleTrigger render={<Button variant="ghost" className="goal-summary [&:hover:not(:disabled)]:bg-transparent [&:hover:not(:disabled)]:[border:0] [&_svg]:flex-none [&_svg]:w-[var(--icon-compact)] [&_svg]:h-[var(--icon-compact)] [&_.caret]:text-muted-foreground [&_.caret]:opacity-0 [&_.caret]:[transition:opacity_0.15s_var(--ease),_transform_0.15s_var(--ease)] [&:is(:hover,_:focus-visible)_.caret]:opacity-100 flex flex-1 items-center justify-start gap-2 min-w-0 h-7 p-[0_4px] [border:0] rounded-(--radius-s) bg-transparent text-control font-normal text-left" />}>
        <Icon size={14} className="goal-icon text-brand" />
        <strong className="goal-status flex-none text-foreground font-medium">{t(LABELS[goal.status])}</strong>
        <span className="goal-objective flex-initial min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-soft font-normal" title={goal.objective}>{goal.objective}</span>
        {limit !== null && goal.turns > 0 && <span className="goal-turns flex-none text-muted-foreground text-caption tabular-nums" title={t('{0} continuation turns · limit {1}', { '0': goal.turns, '1': limit })}>{goal.turns}/{limit}</span>}
        <ChevronRight size={14} className="caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot='collapsible-trigger']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot='collapsible-trigger']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]" />
      </CollapsibleTrigger>
      {(goal.status !== 'completed') && <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact) goal-action [&:hover:not(:disabled)]:text-foreground flex-none text-muted-foreground rounded-(--radius-s)" aria-label={active ? t('Pause goal') : t('Resume goal')} title={active ? t('Pause goal') : t('Resume goal')} onClick={() => onControl(active ? 'pause' : 'resume')}>{active ? <Pause size={14} /> : <Play size={14} />}</Button>}
      <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact) goal-action [&:hover:not(:disabled)]:text-foreground flex-none text-muted-foreground rounded-(--radius-s)" aria-label={t('Clear goal')} title={t('Clear goal')} onClick={() => onControl('clear')}><X size={14} /></Button>
    </div>
    <CollapsibleContent className="tool-disclosure-panel [&[data-starting-style]]:h-0 [&[data-ending-style]]:h-0 h-[var(--collapsible-panel-height)] overflow-hidden [transition:height_160ms_var(--ease)]"><GoalDetails goal={goal} /></CollapsibleContent>
  </Collapsible>
}

/** A finished goal sits in the transcript where the work ended, as quiet as the turn's tool rows. */
export function GoalDone({ goal }: { goal: ChatGoal }) {
  useLanguage()
  return <Collapsible className="tool-group [&_>_[data-slot='collapsible-trigger']]:cursor-pointer [&_>_[data-slot='collapsible-trigger']]:[list-style:none] [&_>_[data-slot='collapsible-trigger']]:font-normal [&_>_[data-slot='collapsible-trigger']]:[transition:background_0.12s_var(--ease),_border-color_0.12s_var(--ease)] [&_>_[data-slot='collapsible-trigger']]:flex [&_>_[data-slot='collapsible-trigger']]:items-center [&_>_[data-slot='collapsible-trigger']]:justify-start [&_>_[data-slot='collapsible-trigger']]:gap-2 [&_>_[data-slot='collapsible-trigger']]:h-auto [&_>_[data-slot='collapsible-trigger']]:min-h-0 [&_>_[data-slot='collapsible-trigger']]:p-[3px_0] [&_>_[data-slot='collapsible-trigger']]:[border:0] [&_>_[data-slot='collapsible-trigger']]:[border-radius:0] [&_>_[data-slot='collapsible-trigger']]:bg-transparent [&_>_[data-slot='collapsible-trigger']]:text-muted-foreground [&_>_[data-slot='collapsible-trigger']]:text-chat [&_>_[data-slot='collapsible-trigger']::-webkit-details-marker]:hidden [&_>_[data-slot='collapsible-trigger']:hover]:bg-transparent [&_>_[data-slot='collapsible-trigger']:hover]:[border:0] [&_>_[data-slot='collapsible-trigger']:hover]:text-soft [&[data-open]_>_summary_.caret]:[transform:rotate(90deg)] [&[data-open]_>_summary]:bg-transparent [&[data-open]_>_summary]:[border:0] [&[data-open]_>_summary]:text-soft [&_>_[data-slot='collapsible-trigger']_.caret]:m-0 [&_>_[data-slot='collapsible-trigger']_.caret]:opacity-0 [&_>_[data-slot='collapsible-trigger']_.caret]:[transition:opacity_0.15s_var(--ease),_transform_0.15s_var(--ease)] text-control text-muted-foreground goal-done [&_>_[data-slot='collapsible-trigger']]:max-w-full [&_.goal-icon]:flex-none [&_.goal-icon]:text-ok [&_.tool-group-label]:flex-none [&_.tool-group-label]:text-soft [&_.goal-objective]:text-muted-foreground [&_.goal-details]:pl-[22px] [&_.goal-details]:text-chat m-[8px_0_4px]" aria-label={t('Chat goal')}>
    <CollapsibleTrigger render={<Button variant="ghost" />}>
      <CircleCheck size={14} className="goal-icon text-brand" />
      <span className="tool-group-label text-[length:inherit]">{t('Goal completed')}</span>
      <span className="goal-objective flex-initial min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-soft font-normal" title={goal.objective}>{goal.objective}</span>
      <ChevronRight size={14} className="caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot='collapsible-trigger']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot='collapsible-trigger']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]" />
    </CollapsibleTrigger>
    <CollapsibleContent className="tool-disclosure-panel [&[data-starting-style]]:h-0 [&[data-ending-style]]:h-0 h-[var(--collapsible-panel-height)] overflow-hidden [transition:height_160ms_var(--ease)]"><GoalDetails goal={goal} /></CollapsibleContent>
  </Collapsible>
}
