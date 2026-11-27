import { GoalFacts } from './GoalFacts'
import { useState } from 'react'
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CirclePause,
  Clock3,
  Pause,
  Play,
  ShieldCheck,
  Target,
  X,
} from 'lucide-react'
import { ChatActivityButton } from './ChatActivity'
import { ComposerTraySection } from '../composer/ComposerTraySection'
import { useTraySection } from '../composer/TrayStack'
import { Button } from '@/components/desktop-button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { goalTurnLimit, type ChatGoal } from '@ramu/shared/types'
import { type GoalChange, type GoalChangeType } from '@ramu/shared/chat/goalHistory'
import { t, useLanguage } from '../i18n'
import { Dialog, Dropdown } from '../Menu'
import { useAppSettings } from '../settings/AppSettings'
import { resumeTime } from '../models/limitCopy'
import { goalContinues, goalState, isLimitHold } from '@ramu/shared/chat/goalHold'
import { goalLabel, GOAL_NOTE_LABELS, VERIFY_LIMIT, verifyDraft } from './goalLabels'

const goalIcon = (goal: ChatGoal) => {
  const state = goalState(goal)
  return state === 'completed'
    ? CircleCheck
    : state === 'blocked' || state === 'turn-limit'
      ? CircleAlert
      : state === 'paused'
        ? CirclePause
        : state === 'limit'
          ? Clock3
          : Target
}

export { GoalFacts } from './GoalFacts'

/** Limits this goal can take instead of Settings', the common ones a person reaches for. */
const LIMIT_CHOICES = [5, 10, 20, 50, 100]

function GoalDetails({ goal, onLimit }: { goal: ChatGoal; onLimit?: (limit: number | null | 'default') => void }) {
  const { preferences } = useAppSettings()
  const fallback = preferences.goals.maxTurns
  const limit = goalTurnLimit(goal, preferences.goals)
  const value = goal.maxTurns === undefined ? 'default' : goal.maxTurns === null ? 'none' : String(goal.maxTurns)
  return (
    <div className="goal-details flex flex-col gap-1.5 p-[2px_4px_8px_28px]">
      <p className="goal-objective-full m-0 whitespace-pre-wrap [overflow-wrap:anywhere] select-text text-foreground">
        {goal.objective}
      </p>
      {goal.reason && (
        <p className="goal-reason m-0 text-soft whitespace-pre-wrap [overflow-wrap:anywhere] select-text">
          {goal.reason}
        </p>
      )}
      <GoalFacts goal={goal} />
      <span className="goal-meta flex flex-wrap items-center gap-x-1.5 text-muted-foreground text-caption">
        {onLimit ? (
          <>
            {t('{0} continuation turns', { '0': goal.turns })} ·
            {/* This goal only: Settings keep the limit every other goal starts with. */}
            <Dropdown
              label={t('Turn limit for this goal')}
              value={value}
              options={[
                {
                  value: 'default',
                  label:
                    fallback === null
                      ? t('Settings default (no limit)')
                      : t('Settings default ({0})', { '0': fallback }),
                },
                ...[...new Set([...LIMIT_CHOICES, ...(goal.maxTurns ? [goal.maxTurns] : [])])]
                  .sort((a, b) => a - b)
                  .map((n) => ({ value: String(n), label: t('Limit {0}', { '0': n }) })),
                { value: 'none', label: t('No limit') },
              ]}
              onChange={(next) => onLimit(next === 'default' ? 'default' : next === 'none' ? null : Number(next))}
              className="h-6! min-h-6! w-auto! min-w-0! text-caption"
            />
          </>
        ) : limit === null ? (
          t('{0} continuation turns · no limit', { '0': goal.turns })
        ) : (
          t('{0} continuation turns · limit {1}', { '0': goal.turns, '1': limit })
        )}
        {isLimitHold(goal) && goal.retryAt ? ` · ${t('Resumes around {0}', { '0': resumeTime(goal.retryAt) })}` : ''}
      </span>
    </div>
  )
}

/** The command Ramu runs itself when the agent says the goal is done. Blank or `off` removes it. */
export function GoalVerifyEditor({
  current,
  onSave,
  onClose,
  readOnly = false,
}: {
  readOnly?: boolean
  current: string | undefined
  onSave: (command: string | null) => void
  onClose: () => void
}) {
  useLanguage()
  const [draft, setDraft] = useState(current ?? '')
  const view = verifyDraft(draft, current)
  const save = () => {
    if (readOnly || view.tooLong) return
    if (view.changed) onSave(view.command)
    onClose()
  }
  return (
    <form
      className="goal-verify-editor flex flex-col gap-1 p-[2px_4px_6px_28px]"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          disabled={readOnly}
          value={draft}
          aria-label={t('Verification command')}
          aria-invalid={view.tooLong || undefined}
          placeholder={t('Command to run when the agent says the goal is done')}
          className="goal-verify-input h-7 flex-1 font-mono text-caption"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              onClose()
            }
          }}
        />
        <Button type="submit" size="xs" disabled={readOnly || view.tooLong || !view.changed}>
          {view.command || !current ? t('Save') : t('Remove')}
        </Button>
        <Button type="button" variant="ghost" size="xs" onClick={onClose}>
          {t('Cancel')}
        </Button>
      </div>
      <span className="text-muted-foreground text-caption">
        {view.tooLong
          ? t('A verification command can be at most {0} characters.', { '0': VERIFY_LIMIT })
          : t('Runs in the thread folder, for up to 10 minutes. Only you can set it. Leave blank to remove.')}
      </span>
    </form>
  )
}

/** A goal still in progress: the first row of the tray the composer rests on. */
export function GoalBar({
  goal,
  onControl,
  onVerify,
  onLimit,
  readOnly = false,
}: {
  readOnly?: boolean
  goal: ChatGoal
  onControl: (action: 'pause' | 'resume' | 'clear') => void
  /** Sets the goal's verification command, or removes it with null. */
  onVerify?: (command: string | null) => void
  /** Sets how many automatic turns this goal may take: a number, null for none, or `default` for Settings'. */
  onLimit?: (limit: number | null | 'default') => void
}) {
  useLanguage()
  const [editing, setEditing] = useState(false)
  // Clearing ends what may be hours of automatic work and cannot be undone, so it is confirmed.
  const [clearing, setClearing] = useState(false)
  const [expanded, setExpanded] = useTraySection()
  const { preferences } = useAppSettings()
  const active = goalContinues(goal)
  const Icon = goalIcon(goal),
    limit = goalTurnLimit(goal, preferences.goals)
  return (
    <ComposerTraySection
      className="goal-bar [&[data-status='paused']_.goal-icon]:text-muted-foreground [&:is([data-status='blocked'],_[data-status='turn-limit'],_[data-status='limit'])_.goal-icon]:text-warn"
      data-status={goalState(goal)}
      aria-label={t('Thread goal')}
      open={expanded}
      onOpenChange={setExpanded}
      icon={<Icon className="goal-icon text-brand" />}
      chip={t('Goal')}
      live={active}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <strong className="goal-status flex-none text-foreground font-medium">{t(goalLabel(goal))}</strong>
          <span
            className="goal-objective flex-initial min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-soft font-normal"
            title={goal.objective}
          >
            {goal.objective}
          </span>
          {limit !== null && goal.turns > 0 && (
            <span
              className="goal-turns flex-none text-muted-foreground text-caption tabular-nums"
              title={t('{0} continuation turns · limit {1}', { '0': goal.turns, '1': limit })}
            >
              {goal.turns}/{limit}
            </span>
          )}
        </span>
      }
      actions={
        <>
          {onVerify && goal.status !== 'completed' && (
            <Button
              disabled={readOnly}
              variant="ghost"
              size="icon-xs"
              className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact) goal-action goal-verify-action [&:hover:not(:disabled)]:text-foreground flex-none text-muted-foreground rounded-(--radius-s)"
              aria-label={goal.verify ? t('Edit verification command') : t('Set verification command')}
              title={goal.verify ? t('Edit verification command') : t('Set verification command')}
              aria-pressed={editing}
              onClick={() => {
                setExpanded(true)
                setEditing((open) => !open)
              }}
            >
              <ShieldCheck size={14} className={goal.verify ? 'text-brand' : undefined} />
            </Button>
          )}
          {goal.status !== 'completed' && (
            <Button
              disabled={readOnly}
              variant="ghost"
              size="icon-xs"
              className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact) goal-action [&:hover:not(:disabled)]:text-foreground flex-none text-muted-foreground rounded-(--radius-s)"
              aria-label={active ? t('Pause goal') : t('Resume goal')}
              title={active ? t('Pause goal') : t('Resume goal')}
              onClick={() => onControl(active ? 'pause' : 'resume')}
            >
              {active ? <Pause size={14} /> : <Play size={14} />}
            </Button>
          )}
          <Button
            disabled={readOnly}
            variant="ghost"
            size="icon-xs"
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact) goal-action [&:hover:not(:disabled)]:text-foreground flex-none text-muted-foreground rounded-(--radius-s)"
            aria-label={t('Clear goal')}
            title={t('Clear goal')}
            onClick={() => setClearing(true)}
          >
            <X size={14} />
          </Button>
        </>
      }
    >
      {clearing && (
        <Dialog
          title={t('Clear this goal?')}
          confirmLabel={t('Clear goal')}
          danger
          onConfirm={() => {
            setClearing(false)
            onControl('clear')
          }}
          onCancel={() => setClearing(false)}
        >
          <p className="m-0">
            {t(
              'The thread stops working toward it on its own. Its messages and changes stay; start another with /goal.',
            )}
          </p>
        </Dialog>
      )}
      {editing && onVerify && (
        <GoalVerifyEditor
          readOnly={readOnly}
          current={goal.verify}
          onSave={onVerify}
          onClose={() => setEditing(false)}
        />
      )}
      <GoalDetails goal={goal} onLimit={readOnly ? undefined : onLimit} />
    </ComposerTraySection>
  )
}

/** A finished goal sits in the transcript where the work ended, as quiet as the turn's tool rows. */
export function GoalDone({ goal }: { goal: ChatGoal }) {
  useLanguage()
  return (
    <Collapsible
      className="goal-done chat-activity-disclosure [&_.goal-details]:pl-[22px] [&_.goal-details]:text-chat"
      aria-label={t('Thread goal')}
    >
      <CollapsibleTrigger render={<ChatActivityButton />}>
        <CircleCheck size={14} className="goal-icon text-ok" />
        <span className="tool-group-label text-[length:inherit]">{t('Goal completed')}</span>
        <span
          className="goal-objective chat-activity-meta flex-initial min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
          title={goal.objective}
        >
          {goal.objective}
        </span>
        <ChevronRight
          size={14}
          className="caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot='collapsible-trigger']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot='collapsible-trigger']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="tool-disclosure-panel [&[data-starting-style]]:h-0 [&[data-ending-style]]:h-0 h-[var(--collapsible-panel-height)] overflow-hidden [transition:height_160ms_var(--ease)]">
        <GoalDetails goal={goal} />
      </CollapsibleContent>
    </Collapsible>
  )
}

const NOTE_STYLE: Record<GoalChangeType, { Icon: typeof Target; tone: string }> = {
  set: { Icon: Target, tone: 'text-brand' },
  edited: { Icon: Target, tone: 'text-brand' },
  paused: { Icon: CirclePause, tone: 'text-muted-foreground' },
  resumed: { Icon: Play, tone: 'text-brand' },
  blocked: { Icon: CircleAlert, tone: 'text-warn' },
  stalled: { Icon: CircleAlert, tone: 'text-warn' },
  'verify-failed': { Icon: CircleAlert, tone: 'text-warn' },
  'turn-limit': { Icon: CircleAlert, tone: 'text-warn' },
  cleared: { Icon: X, tone: 'text-muted-foreground' },
}

/** A turning point in a goal's life, left in the transcript where it happened. Same quiet line as a finished goal. */
export function GoalNote({ change }: { change: GoalChange }) {
  useLanguage()
  const { Icon, tone } = NOTE_STYLE[change.type]
  const label = GOAL_NOTE_LABELS[change.type]
  // A failed verification names its command in the row; the rest name the goal.
  const meta = change.type === 'verify-failed' && change.goal.check ? change.goal.check.command : change.goal.objective
  return (
    <Collapsible
      className="goal-note chat-activity-disclosure [&_.goal-details]:pl-[22px] [&_.goal-details]:text-chat"
      aria-label={t('Thread goal')}
    >
      <CollapsibleTrigger render={<ChatActivityButton />}>
        <Icon size={14} className={`goal-icon ${tone}`} />
        <span className="tool-group-label text-[length:inherit]">{t(label)}</span>
        <span
          className="goal-objective chat-activity-meta flex-initial min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
          title={meta}
        >
          {meta}
        </span>
        <ChevronRight
          size={14}
          className="caret flex-none text-muted-foreground [transition:transform_0.15s_var(--ease)] [[data-open]>_[data-slot='collapsible-trigger']_&]:[transform:rotate(90deg)]"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="tool-disclosure-panel [&[data-starting-style]]:h-0 [&[data-ending-style]]:h-0 h-[var(--collapsible-panel-height)] overflow-hidden [transition:height_160ms_var(--ease)]">
        <GoalDetails goal={change.goal} />
      </CollapsibleContent>
    </Collapsible>
  )
}
