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
import { Button } from '@/components/desktop-button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import type { ChatGoal } from '@ramu/shared/types'
import { goalFacts, type GoalChange, type GoalChangeType } from '@ramu/shared/chat/goalHistory'
import { t, useLanguage } from '../i18n'
import { useAppSettings } from '../settings/AppSettings'
import { resumeTime } from '../models/limitCopy'
import { goalContinues, goalState, isLimitHold } from '@ramu/shared/chat/goalHold'
import { checkOutcomeCopy, goalLabel, GOAL_NOTE_LABELS, VERIFY_LIMIT, verifyDraft } from './goalLabels'

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

const FILES_SHOWN = 8
const code = 'font-mono text-caption [overflow-wrap:anywhere] select-text'

/**
 * What a goal knows beyond its objective: the verification command and its latest result (a failure shows the command,
 * how it ended and the end of its output), and the evidence the agent gave for completion.
 */
export function GoalFacts({ goal }: { goal: ChatGoal }) {
  useLanguage()
  const { verify, check, evidence } = goalFacts(goal)
  if (!verify && !check && !evidence) return null
  const files = evidence?.changedFiles ?? []
  return (
    <div className="goal-facts flex flex-col gap-1.5 text-caption text-soft">
      {verify && (
        <p className="goal-verify m-0 [overflow-wrap:anywhere]">
          <span className="text-muted-foreground">{t('Verification')}</span> <code className={code}>{verify}</code>
        </p>
      )}
      {check &&
        (check.ok ? (
          <p className="goal-check m-0 [overflow-wrap:anywhere]">
            <span className="text-ok">{t('Verified')}</span> <code className={code}>{check.command}</code>
          </p>
        ) : (
          <div className="goal-check goal-check-failed flex flex-col gap-1">
            <p className="m-0 [overflow-wrap:anywhere]">
              <span className="text-warn">{t('Verification failed')}</span> · {t(...checkOutcomeCopy(check.outcome))}
              {' · '}
              <code className={code}>{check.command}</code>
            </p>
            {check.tail && (
              <pre className="goal-check-output m-0 max-h-40 overflow-auto whitespace-pre-wrap rounded-(--radius-s) bg-fill p-1.5 font-mono text-caption select-text [overflow-wrap:anywhere]">
                {check.tail}
              </pre>
            )}
          </div>
        ))}
      {evidence && evidence.checks.length > 0 && (
        <div className="goal-evidence-checks flex flex-col gap-0.5">
          <span className="text-muted-foreground">{t('Checks')}</span>
          {evidence.checks.map((item, index) => (
            <span key={index} className={`[overflow-wrap:anywhere] ${item.passed ? '' : 'text-warn'}`}>
              {item.passed ? '✓' : '✗'} {item.name}
            </span>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="goal-evidence-files flex flex-col gap-0.5">
          <span className="text-muted-foreground">{t('Changed files')}</span>
          <code className={code}>{files.slice(0, FILES_SHOWN).join(', ')}</code>
          {files.length > FILES_SHOWN && (
            <span className="text-muted-foreground">{t('+{0} more', { '0': files.length - FILES_SHOWN })}</span>
          )}
        </div>
      )}
    </div>
  )
}

function GoalDetails({ goal }: { goal: ChatGoal }) {
  const { preferences } = useAppSettings()
  const limit = preferences.goals.maxTurns
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
      <span className="goal-meta text-muted-foreground text-caption">
        {limit === null
          ? t('{0} continuation turns · no limit', { '0': goal.turns })
          : t('{0} continuation turns · limit {1}', { '0': goal.turns, '1': limit })}
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
}: {
  current: string | undefined
  onSave: (command: string | null) => void
  onClose: () => void
}) {
  useLanguage()
  const [draft, setDraft] = useState(current ?? '')
  const view = verifyDraft(draft, current)
  const save = () => {
    if (view.tooLong) return
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
        <Button type="submit" size="xs" disabled={view.tooLong || !view.changed}>
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
}: {
  goal: ChatGoal
  onControl: (action: 'pause' | 'resume' | 'clear') => void
  /** Sets the goal's verification command, or removes it with null. */
  onVerify?: (command: string | null) => void
}) {
  useLanguage()
  const [editing, setEditing] = useState(false)
  const { preferences } = useAppSettings()
  const active = goalContinues(goal)
  const Icon = goalIcon(goal),
    limit = preferences.goals.maxTurns
  return (
    <Collapsible
      className="goal-bar [&[data-status='paused']_.goal-icon]:text-muted-foreground [&:is([data-status='blocked'],_[data-status='turn-limit'],_[data-status='limit'])_.goal-icon]:text-warn [&[data-open]_.goal-summary_.caret]:opacity-100 [&[data-open]_.goal-summary_.caret]:[transform:rotate(90deg)] text-control"
      data-status={goalState(goal)}
      aria-label={t('Thread goal')}
    >
      <div className="goal-bar-header flex items-center gap-0.5 min-h-8">
        <CollapsibleTrigger
          render={
            <Button
              variant="ghost"
              className="goal-summary [&:hover:not(:disabled)]:bg-transparent [&:hover:not(:disabled)]:[border:0] [&_svg]:flex-none [&_svg]:w-[var(--icon-compact)] [&_svg]:h-[var(--icon-compact)] [&_.caret]:text-muted-foreground [&_.caret]:opacity-0 [&_.caret]:[transition:opacity_0.15s_var(--ease),_transform_0.15s_var(--ease)] [&:is(:hover,_:focus-visible)_.caret]:opacity-100 flex flex-1 items-center justify-start gap-2 min-w-0 h-7 p-[0_4px] [border:0] rounded-(--radius-s) bg-transparent text-control font-normal text-left"
            />
          }
        >
          <Icon size={14} className="goal-icon text-brand" />
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
          <ChevronRight
            size={14}
            className="caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot='collapsible-trigger']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot='collapsible-trigger']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]"
          />
        </CollapsibleTrigger>
        {onVerify && goal.status !== 'completed' && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact) goal-action goal-verify-action [&:hover:not(:disabled)]:text-foreground flex-none text-muted-foreground rounded-(--radius-s)"
            aria-label={goal.verify ? t('Edit verification command') : t('Set verification command')}
            title={goal.verify ? t('Edit verification command') : t('Set verification command')}
            aria-pressed={editing}
            onClick={() => setEditing((open) => !open)}
          >
            <ShieldCheck size={14} className={goal.verify ? 'text-brand' : undefined} />
          </Button>
        )}
        {goal.status !== 'completed' && (
          <Button
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
          variant="ghost"
          size="icon-xs"
          className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact) goal-action [&:hover:not(:disabled)]:text-foreground flex-none text-muted-foreground rounded-(--radius-s)"
          aria-label={t('Clear goal')}
          title={t('Clear goal')}
          onClick={() => onControl('clear')}
        >
          <X size={14} />
        </Button>
      </div>
      {editing && onVerify && (
        <GoalVerifyEditor current={goal.verify} onSave={onVerify} onClose={() => setEditing(false)} />
      )}
      <CollapsibleContent className="tool-disclosure-panel [&[data-starting-style]]:h-0 [&[data-ending-style]]:h-0 h-[var(--collapsible-panel-height)] overflow-hidden [transition:height_160ms_var(--ease)]">
        <GoalDetails goal={goal} />
      </CollapsibleContent>
    </Collapsible>
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
