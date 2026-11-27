import type { Task } from '@ramu/shared/types'
import { t, useLanguage } from '../../i18n'
import { ProviderWaitIcon } from '../../models/ProviderWait'
import { timeAgo } from '../../Menu'
import { threadStatus, type ThreadStatus } from '@ramu/shared/chat/threadStatus'
import { useHeld, useSteadyPulse } from '../../lib/steadyActivity'

const STATE_CLASS =
  "task-state [&.dot::before]:[content:''] [&.dot::before]:w-2 [&.dot::before]:h-2 [&.dot::before]:rounded-full [&.dot::before]:[background:var(--muted)] [&.unread::before]:[background:var(--accent)] [&.warn::before]:[background:var(--warn)] [&.bad::before]:[background:var(--bad)] w-3.5 h-3.5 flex-none inline-flex items-center justify-center mr-1"

export function StateDot({ kind, label }: { kind: string; label: string }) {
  return <span className={`${STATE_CLASS} ${kind}`} role="img" aria-label={label} title={label} />
}

/** A thread at work: the accent dot, breathing on a clock every working dot shares, alive without pulling the eye. */
export function WorkingDot({ label }: { label?: string }) {
  const ref = useSteadyPulse<HTMLSpanElement>()
  return (
    <span
      ref={ref}
      className={`${STATE_CLASS} dot unread`}
      {...(label ? { role: 'img', 'aria-label': label, title: label } : { 'aria-hidden': true })}
    />
  )
}

const isWorking = (status: ThreadStatus | null) =>
  status?.kind === 'working' || status?.kind === 'goal' || status?.kind === 'verifying'

/** The indicator for a thread's status, shared by every list that shows threads; null when there is none to show. */
export function StatusMark({ task, status }: { task: Task; status: ThreadStatus | null }) {
  useLanguage()
  if (!status) return null
  if (isWorking(status)) return <WorkingDot label={t(status.full)} />
  if (
    status.kind === 'approval' ||
    status.kind === 'input' ||
    status.kind === 'blocked' ||
    status.kind === 'turn-limit'
  )
    return <StateDot kind="dot warn text-warn" label={t(status.full)} />
  if (status.kind === 'paused' || status.kind === 'stopped') return <StateDot kind="dot" label={t(status.full)} />
  if (status.kind === 'limit')
    return task.waitingUntil ? (
      <ProviderWaitIcon retryAt={task.waitingUntil} />
    ) : (
      <StateDot kind="dot warn text-warn" label={t(status.full)} />
    )
  if (status.kind === 'failed') return <StateDot kind="dot bad" label={t(status.full)} />
  return <StateDot kind="dot unread" label={t(status.full)} />
}

/** A row's status mark: working, needs input, waiting, failed or unread; null when there is none. */
function useStatusMark(task: Task, unread: boolean) {
  const status = threadStatus(task, unread, task.goalState)
  // Anything that needs the person shows at once; only a plain stop waits to see whether the turn carries on.
  const held = useHeld(isWorking(status))
  return held && (!status || status.kind === 'finished') ? (
    <WorkingDot label={t('Agent working')} />
  ) : status ? (
    <StatusMark task={task} status={status} />
  ) : null
}

/**
 * The trailing status of a chat row: working, needs input, waiting, failed, unread, or its age, at its natural width so
 * a short age leaves the title its room. With `ageOnly` the mark is drawn in the row's gutter (TaskGutterMark) and this
 * says only the age. On hover the row's actions take its place.
 */
export function TaskStateIcon({ task, unread, ageOnly = false }: { task: Task; unread: boolean; ageOnly?: boolean }) {
  useLanguage()
  const mark = useStatusMark(task, unread)
  return (
    <span className="task-trailing inline-flex min-w-5 flex-none items-center justify-center [&>.task-state]:mr-0">
      {mark && !ageOnly ? (
        mark
      ) : (
        <span className="task-time text-caption text-muted-foreground tabular-nums">{timeAgo(task.lastActiveAt)}</span>
      )}
    </span>
  )
}

/**
 * A nested row's status mark in the indent under its project's folder icon, so every title keeps one edge and the age
 * keeps its place at the right. The column is the folder icon's: 8px in and 15px wide.
 */
export function TaskGutterMark({ task, unread }: { task: Task; unread: boolean }) {
  useLanguage()
  const mark = useStatusMark(task, unread)
  if (!mark) return null
  return (
    <span className="task-gutter pointer-events-none absolute top-0 left-2 flex h-[30px] w-[15px] items-center justify-center [&>.task-state]:mr-0 [&>span]:pointer-events-auto">
      {mark}
    </span>
  )
}
