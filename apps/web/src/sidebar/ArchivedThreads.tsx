import { useHostWriteAccess } from '../composer/useHostWriteAccess'
import { VIEW_ONLY_WRITE_NOTICE } from '../composer/viewerAccess'
import { useState } from 'react'
import { readRemovalCommands } from '@ramu/shared/chat/taskRemoval'
import { Button } from '@/components/desktop-button'
import { Dialog as DialogRoot, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { X } from 'lucide-react'
import { t, useLanguage } from '../i18n'
import { Dialog } from '../Menu'
import { useHost } from '../workspace/HostProvider'
import { errorText } from '../workspace/TaskPane'
import { useWorkspace } from '../workspace/workspace'
import { TaskRow } from './projects/TaskRow'
import { archivedThreads } from './projects/threadLists'
import { ListCount, ListEmpty, ListToolbar, useListView } from '../settings/ListView'

/** The window's own host's archived threads, searchable, with each row's own actions (Unarchive, Delete). */
export function ArchivedThreads({ onOpen }: { onOpen?: () => void }) {
  useLanguage()
  const { invoke } = useHost()
  const { viewOnly, canWrite } = useHostWriteAccess()
  const ws = useWorkspace()
  const [clearingArchived, setClearingArchived] = useState(false)
  const [clearBusy, setClearBusy] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)
  const archivedChats = archivedThreads(ws.tasks)
  const projectName = (id: string) => ws.projects.find((project) => project.id === id)?.name
  const view = useListView(archivedChats, {
    text: (task) => `${task.title} ${projectName(task.projectId) ?? ''}`,
    size: 30,
  })
  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-col gap-3">
        <ListToolbar view={view} label={t('Search archived threads')} />
        <ListCount view={view} />
        <ListEmpty
          view={view}
          none="No archived threads. Archive a thread from its menu in the sidebar to hide it."
          filtered="No archived threads match your search."
        />
        <div className="task-list flex flex-col gap-0.5">
          {view.paged.shown.map((task) => (
            <TaskRow key={task.id} task={task} projectName={projectName(task.projectId)} onOpen={onOpen} />
          ))}
          {view.paged.more}
        </div>
      </div>
      {archivedChats.length > 0 && !viewOnly && (
        <Button
          variant="outline"
          className="mt-3 self-start"
          onClick={() => {
            if (!canWrite()) return
            setClearError(null)
            setClearingArchived(true)
          }}
        >
          {t('Delete all archived threads')}
        </Button>
      )}
      {viewOnly && <p role="status">{t(VIEW_ONLY_WRITE_NOTICE)}</p>}
      {clearingArchived && (
        <Dialog
          title={t('Delete {0} archived threads?', { '0': archivedChats.length })}
          confirmLabel={t('Delete all')}
          danger
          confirmDisabled={viewOnly}
          busy={clearBusy}
          error={clearError}
          onCancel={() => {
            setClearingArchived(false)
            setClearError(null)
          }}
          onConfirm={async () => {
            if (!canWrite()) return
            setClearBusy(true)
            setClearError(null)
            try {
              const commands = await Promise.all(archivedChats.map((task) => readRemovalCommands(invoke, task.id)))
              if (commands.some((rows) => rows.length))
                throw new Error(
                  t('Some archived threads have background commands. Review deletion from each thread first.'),
                )
              for (const task of archivedChats) {
                if (!canWrite()) return
                await invoke('tasks.delete', task.id, false)
                ws.forgetTask(task.id)
              }
              await ws.refresh()
              setClearingArchived(false)
            } catch (e) {
              setClearError(errorText(e))
              await ws.refresh()
            } finally {
              setClearBusy(false)
            }
          }}
        >
          <p>{t('Removes every archived thread and its agent transcripts. This can’t be undone.')}</p>
          <p className="muted text-muted-foreground">{t('Worktrees and branches are kept.')}</p>
        </Dialog>
      )}
    </div>
  )
}

/** The Archived view over the window, opened from the sidebar's foot, the command menu or Settings search. */
export function ArchivedThreadsDialog({ onClose }: { onClose: () => void }) {
  useLanguage()
  const ws = useWorkspace()
  const count = archivedThreads(ws.tasks).length
  return (
    <DialogRoot
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="[[data-slot='dialog-content']&]:max-w-[none] [[data-slot='dialog-content']&]:w-[min(640px,_calc(100vw_-_48px))] flex max-h-[min(640px,_calc(100vh_-_96px))] flex-col gap-3 overflow-hidden rounded-(--radius-xl) [border:1px_solid_var(--edge)] bg-canvas p-5"
        showCloseButton={false}
        aria-describedby={undefined}
      >
        <header className="flex items-center gap-3">
          <DialogTitle className="m-0 grow text-heading font-semibold">
            {t('Archived threads')}
            {count ? ` · ${count}` : ''}
          </DialogTitle>
          <Button variant="ghost" size="icon-sm" aria-label={t('Close')} onClick={onClose}>
            <X size={16} />
          </Button>
        </header>
        <div className="min-h-0 overflow-y-auto">
          <ArchivedThreads onOpen={onClose} />
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
