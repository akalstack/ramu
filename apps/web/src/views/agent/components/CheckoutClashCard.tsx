import { useState } from 'react'
import { Clock, GitFork } from 'lucide-react'
import type { AgentEvent } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { notifyError } from '../../../chat/Notifications'
import { t, useLanguage } from '../../../i18n'
import { errorText } from '../../../lib/errors'
import { useHost } from '../../../workspace/HostProvider'
import { useWorkspace } from '../../../workspace/workspace'

/**
 * Another thread edited the same file in this checkout during this turn. Both keep working; each turn's changes keep
 * only what it wrote, and the file they share stays out of undo. Moving this thread to its own worktree ends the overlap.
 */
export function CheckoutClashCard({
  event,
  sessionId,
  readOnly,
}: {
  event: Extract<AgentEvent, { kind: 'checkout-clash' }>
  sessionId: string
  readOnly: boolean
}) {
  useLanguage()
  const ws = useWorkspace()
  const { invoke } = useHost()
  const [moving, setMoving] = useState(false)
  const title = ws.task(event.taskId)?.title ?? t('Another thread')
  const file = event.path.split(/[\\/]/).at(-1) ?? event.path
  const move = async () => {
    setMoving(true)
    try {
      // The host creates the worktree, copies the uncommitted changes and links both threads in one call.
      const started = await invoke('threads.continueInWorktree', sessionId)
      await ws.refresh()
      ws.openTask(started.taskId)
    } catch (error) {
      notifyError(errorText(error))
    } finally {
      setMoving(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-caption text-muted-foreground" role="status">
      <GitFork size={14} aria-hidden="true" className="flex-none" />
      <span className="min-w-0 flex-1" title={event.path}>
        {t('“{0}” is also editing {1} in this checkout. Each thread keeps only its own changes.', {
          0: title,
          1: file,
        })}
      </span>
      <Button variant="ghost" size="xs" onClick={() => ws.openTask(event.taskId)}>
        {t('Open thread')}
      </Button>
      {!readOnly && (
        <Button variant="ghost" size="xs" disabled={moving} onClick={() => void move()}>
          {t('Move to a new worktree')}
        </Button>
      )}
    </div>
  )
}

/** A command held until another thread's command in this checkout finished, so each one's writes stay its own. */
export function CommandWaitNote({ taskId }: { taskId: string }) {
  useLanguage()
  const ws = useWorkspace()
  const title = ws.task(taskId)?.title ?? t('Another thread')
  return (
    <div className="flex items-center gap-2 text-caption text-muted-foreground" role="status">
      <Clock size={14} aria-hidden="true" className="flex-none" />
      <span className="min-w-0 flex-1">
        {t('Held a command until “{0}” finished its own, so each thread’s changes stay apart.', { 0: title })}
      </span>
      <Button variant="ghost" size="xs" onClick={() => ws.openTask(taskId)}>
        {t('Open thread')}
      </Button>
    </div>
  )
}
