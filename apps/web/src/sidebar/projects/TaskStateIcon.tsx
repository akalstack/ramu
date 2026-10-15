import type { Task } from '@ramu/shared/types'
import { t, useLanguage } from '../../i18n'
import { ProviderWaitIcon } from '../../models/ProviderWait'
import { timeAgo } from '../../Menu'

const STATE_CLASS =
  "task-state [&.spinner::before]:[content:''] [&.spinner::before]:w-3 [&.spinner::before]:h-3 [&.spinner::before]:[box-sizing:border-box] [&.spinner::before]:rounded-full [&.spinner::before]:[border:2px_solid_var(--line-strong)] [&.spinner::before]:[border-top-color:var(--soft)]! [&.spinner::before]:[animation:spin_0.9s_linear_infinite] [&.dot::before]:[content:''] [&.dot::before]:w-2 [&.dot::before]:h-2 [&.dot::before]:rounded-full [&.dot::before]:[background:var(--muted)] [&.unread::before]:[background:var(--accent)] [&.warn::before]:[background:var(--warn)] [&.bad::before]:[background:var(--bad)] w-3.5 h-3.5 flex-none inline-flex items-center justify-center mr-1"

function StateDot({ kind, label }: { kind: string; label: string }) {
  return <span className={`${STATE_CLASS} ${kind}`} role="img" aria-label={label} title={label} />
}

/** The trailing status of a chat row: working, needs input, waiting, failed, unread, or its age. */
export function TaskStateIcon({ task, unread }: { task: Task; unread: boolean }) {
  useLanguage()
  if (task.status === 'running') return <StateDot kind="spinner" label={t('Agent working')} />
  if (task.status === 'needs-input') return <StateDot kind="dot warn text-warn" label={t('Waiting for your input')} />
  if (task.waitingUntil) return <ProviderWaitIcon retryAt={task.waitingUntil} />
  if (task.status === 'failed') return <StateDot kind="dot bad" label={t('Agent failed')} />
  if (unread) return <StateDot kind="dot unread" label={t('Finished, not viewed yet')} />
  return (
    <span className="task-time text-caption text-muted-foreground flex-none tabular-nums min-w-6 text-right">
      {timeAgo(task.lastActiveAt)}
    </span>
  )
}
