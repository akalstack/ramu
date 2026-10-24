import { createContext, useContext, useEffect, useState } from 'react'
import { Archive, Check, Pin, PinOff, Trash2, X } from 'lucide-react'
import type { Task } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../../i18n'
import { useHost } from '../../workspace/HostProvider'
import { useComputers } from '../../workspace/computers'
import { animateThreadListChange } from '../../workspace/threadListMotion'
import { useWorkspace } from '../../workspace/workspace'
import { errorText } from '../../workspace/TaskPane'
import { DeleteThreadDialog } from '../../chat/DeleteThreadDialog'
import { ICON_BUTTON_CLASS } from './constants'
import { useHostWriteAccess } from '../../composer/useHostWriteAccess'
import { threadSelection, useThreadSelection } from './threadSelection'

/** A thread that is working or waiting for an answer is finished or archived deliberately, one at a time. */
const busy = (task: Task) => task.status === 'running' || task.status === 'needs-input'

/**
 * Bulk actions for the threads picked in the sidebar (Cmd/Ctrl-click, Shift-click for a range). Everything it does is
 * undoable except delete, which still goes through each thread's own review so a running command is never lost.
 */
export function useBulkThreadActions() {
  const ws = useWorkspace()
  const host = useHost()
  const { viewOnly, canWrite } = useHostWriteAccess()
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Task[]>([])
  const run = async (work: () => Promise<unknown>) => {
    if (!canWrite()) return
    setError(null)
    try {
      await animateThreadListChange(async () => {
        if (!canWrite()) return
        await work()
        await ws.refresh()
      })
    } catch (reason) {
      setError(errorText(reason))
    }
  }
  const pick = (ids: ReadonlySet<string>) => ws.tasks.filter((task) => ids.has(task.id))
  return {
    error,
    viewOnly,
    deleting,
    clearError: () => setError(null),
    pin(tasks: Task[]) {
      const pin = !tasks.every((task) => task.pinnedAt)
      void run(async () => {
        for (const task of tasks) {
          if (!canWrite()) return
          if (!!task.pinnedAt !== pin) await host.invoke('tasks.pin', task.id, pin)
        }
      })
    },
    done(tasks: Task[]) {
      const done = !tasks.every((task) => task.doneAt)
      void run(async () => {
        for (const task of tasks) {
          if (!canWrite()) return
          if (task.status !== 'archived' && !!task.doneAt !== done && (done ? !busy(task) : true))
            await host.invoke('tasks.done', task.id, done)
        }
        threadSelection.clear()
      })
    },
    archive(tasks: Task[]) {
      void run(async () => {
        for (const task of tasks) {
          if (!canWrite()) return
          await host.invoke('tasks.archive', task.id, true)
          ws.forgetTask(task.id)
        }
        threadSelection.clear()
      })
    },
    requestDelete: (tasks: Task[]) => {
      if (canWrite()) setDeleting(tasks)
    },
    pick,
    finishDelete: async () => {
      ws.forgetTask(deleting[0]!.id)
      await ws.refresh()
      setDeleting((queue) => queue.slice(1))
      if (deleting.length <= 1) threadSelection.clear()
    },
    cancelDelete: () => setDeleting([]),
  }
}

export type BulkThreadActions = ReturnType<typeof useBulkThreadActions>

/** Provided by the list that owns the selection bar; rows outside it cannot be selected. */
export const BulkThreadActionsContext = createContext<BulkThreadActions | null>(null)
export const useBulkActionsContext = () => useContext(BulkThreadActionsContext)

export function ThreadSelectionBar({ actions }: { actions: BulkThreadActions }) {
  useLanguage()
  const ids = useThreadSelection()
  const computers = useComputers()
  const host = useHost()
  const ws = useWorkspace()
  const tasks = actions.pick(ids)
  useEffect(() => {
    if (!ids.size) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      if (
        event.target instanceof Element &&
        event.target.closest('input, textarea, [contenteditable="true"], [role="dialog"]')
      )
        return
      threadSelection.clear()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [ids.size])
  const current = actions.deleting[0]
  const unavailable = actions.viewOnly || tasks.some((task) => task.status === 'archived')
  if (!tasks.length && !current) return null
  const allPinned = tasks.every((task) => task.pinnedAt)
  const allDone = tasks.every((task) => task.doneAt)
  return (
    <>
      {tasks.length > 0 && (
        <div
          role="toolbar"
          aria-label={t('Selected threads')}
          className="sticky top-0 z-10 mb-1 flex items-center gap-0.5 rounded-(--radius-s) bg-accent p-[2px_4px_2px_8px] text-control"
        >
          <span className="min-w-0 flex-1 truncate tabular-nums" role="status">
            {t('{0} selected', { 0: tasks.length })}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON_CLASS}
            aria-label={allPinned ? t('Unpin selected') : t('Pin selected')}
            title={allPinned ? t('Unpin selected') : t('Pin selected')}
            disabled={unavailable}
            onClick={() => actions.pin(tasks)}
          >
            {allPinned ? <PinOff size={14} /> : <Pin size={14} />}
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON_CLASS}
            aria-label={allDone ? t('Reopen selected') : t('Mark selected done')}
            title={allDone ? t('Reopen selected') : t('Mark selected done')}
            disabled={unavailable}
            onClick={() => actions.done(tasks)}
          >
            <Check size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON_CLASS}
            aria-label={t('Archive selected')}
            title={t('Archive selected')}
            disabled={unavailable}
            onClick={() => actions.archive(tasks)}
          >
            <Archive size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON_CLASS}
            disabled={actions.viewOnly}
            aria-label={t('Delete selected…')}
            title={t('Delete selected…')}
            onClick={() => actions.requestDelete(tasks)}
          >
            <Trash2 size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON_CLASS}
            aria-label={t('Clear selection')}
            title={t('Clear selection (Esc)')}
            onClick={() => threadSelection.clear()}
          >
            <X size={14} />
          </Button>
        </div>
      )}
      {actions.error && (
        <div role="alert" className="error text-bad text-caption p-[1px_10px_4px]" onClick={actions.clearError}>
          {actions.error}
        </div>
      )}
      {current && (
        <DeleteThreadDialog
          key={current.id}
          task={current}
          hostName={computers?.computers.find((computer) => computer.id === host.id)?.name}
          sharedWorktree={ws.tasks.some(
            (other) => other.id !== current.id && other.workspaceId === current.workspaceId && !!current.workspaceId,
          )}
          onCancel={actions.cancelDelete}
          onDeleted={actions.finishDelete}
        />
      )}
    </>
  )
}
