import type { Task } from '@ramu/shared/types'
import { t, useLanguage } from '../../i18n'
import { ProviderWaitIcon } from '../../models/ProviderWait'
import { timeAgo } from '../../Menu'
import { threadStatus, type ThreadStatus } from '@ramu/shared/chat/threadStatus'
import { useHeld, useSteadySpin } from '../../lib/steadyActivity'

const STATE_CLASS =
  "task-state [&.spinner::before]:[content:''] [&.spinner::before]:w-3 [&.spinner::before]:h-3 [&.spinner::before]:[box-sizing:border-box] [&.spinner::before]:rounded-full [&.spinner::before]:[border:2px_solid_var(--line-strong)] [&.spinner::before]:[border-top-color:var(--soft)]! [&.spinner::before]:[animation:spin_0.9s_linear_infinite] [&.dot::before]:[content:''] [&.dot::before]:w-2 [&.dot::before]:h-2 [&.dot::before]:rounded-full [&.dot::before]:[background:var(--muted)] [&.unread::before]:[background:var(--accent)] [&.warn::before]:[background:var(--warn)] [&.bad::before]:[background:var(--bad)] w-3.5 h-3.5 flex-none inline-flex items-center justify-center mr-1"

export function StateDot({ kind, label }: { kind: string; label: string }) {
  return <span className={`${STATE_CLASS} ${kind}`} role="img" aria-label={label} title={label} />
}

function Spinner({ label }: { label: string }) {
  const ref = useSteadySpin<HTMLSpanElement>()
  return <span ref={ref} className={`${STATE_CLASS} spinner`} role="img" aria-label={label} title={label} />
}

const isWorking = (status: ThreadStatus | null) =>
  status?.kind === 'working' || status?.kind === 'goal' || status?.kind === 'verifying'

/** The indicator for a thread's status, shared by every list that shows threads; null when there is none to show. */
export function StatusMark({ task, status }: { task: Task; status: ThreadStatus | null }) {
  useLanguage()
  if (!status) return null
  if (isWorking(status)) return <Spinner label={t(status.full)} />
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

/**
 * The trailing status of a chat row: working, needs input, waiting, failed, unread, or its age. Mark and age share one
 * fixed slot, so the agent marks before it line up down the list whichever a row shows. On hover the row's two action
 * buttons are this slot's width, so the last lands on it and the first on the agent mark.
 */
export function TaskStateIcon({ task, unread }: { task: Task; unread: boolean }) {
  useLanguage()
  const status = threadStatus(task, unread, task.goalState)
  // Anything that needs the person shows at once; only a plain stop waits to see whether the turn carries on.
  const held = useHeld(isWorking(status))
  return (
    <span className="task-trailing inline-flex min-w-5 flex-none items-center justify-center [&>.task-state]:mr-0">
      {held && (!status || status.kind === 'finished') ? (
        <Spinner label={t('Agent working')} />
      ) : status ? (
        <StatusMark task={task} status={status} />
      ) : (
        <span className="task-time text-caption text-muted-foreground tabular-nums">{timeAgo(task.lastActiveAt)}</span>
      )}
    </span>
  )
}
