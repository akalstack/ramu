import { GitFork, MessagesSquare } from 'lucide-react'
import type { StartedThread } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../../../i18n'
import { useWorkspace } from '../../../workspace/workspace'
import { GHOST_TEXT_BUTTON_CLASS } from '../styles'

/** The header chip on a thread an agent or one Home prompt started: it opens the starting thread. */
export function ThreadOriginChip({ taskId }: { taskId: string | undefined }) {
  useLanguage()
  const ws = useWorkspace()
  const origin = ws.tasks.find((task) => task.id === taskId)?.startedFrom
  if (!origin) return null
  const together =
    origin.groupSize > 1 ? t('Started together with {0} other threads', { '0': origin.groupSize - 1 }) : ''
  if (!origin.taskId)
    return together ? (
      <span className="inline-flex items-center gap-1 text-caption text-muted-foreground">
        <MessagesSquare size={13} aria-hidden="true" />
        {together}
      </span>
    ) : null
  const starter = origin.taskId
  const label = t('From {0}', { '0': origin.title ?? t('another thread') })
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`${GHOST_TEXT_BUTTON_CLASS} max-w-[260px]`}
      title={[t('Started by the agent in {0}', { '0': origin.title ?? '' }), together].filter(Boolean).join(' · ')}
      onClick={() => ws.openTask(starter)}
    >
      <GitFork size={13} aria-hidden="true" />
      <span className="min-w-0 truncate">{label}</span>
    </Button>
  )
}

/** The card in the starting thread listing the threads its agent started, each one a click away. */
export function ThreadsStartedCard({ threads }: { threads: StartedThread[] }) {
  useLanguage()
  const ws = useWorkspace()
  return (
    <div className="m-[12px_0] flex items-start gap-3 rounded-(--radius-m) bg-fill p-[15px]">
      <GitFork size={16} className="mt-0.5 flex-none" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-left">
        <strong>
          {threads.length === 1 ? t('Started a thread') : t('Started {0} threads', { '0': threads.length })}
        </strong>
        <ul className="mt-1 flex flex-col gap-1">
          {threads.map((thread, index) => (
            <li key={thread.taskId || index} className="flex min-w-0 items-center gap-2 text-caption">
              <span className="min-w-0 flex-1 truncate">
                {thread.title}
                <span className="text-muted-foreground"> · {thread.projectName}</span>
                {thread.error && <span className="block text-bad">{thread.error}</span>}
              </span>
              {thread.taskId && ws.tasks.some((task) => task.id === thread.taskId) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className={GHOST_TEXT_BUTTON_CLASS}
                  onClick={() => ws.openTask(thread.taskId)}
                >
                  {t('Open')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
