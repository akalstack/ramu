import { useHostWriteAccess } from '../composer/useHostWriteAccess'
import { VIEW_ONLY_WRITE_NOTICE } from '../composer/viewerAccess'
import { useState } from 'react'
import { readRemovalCommands } from '@ramu/shared/chat/taskRemoval'
import { Button } from '@/components/desktop-button'
import { SettingsGroupTitle } from '@/components/settings-row'
import { t, useLanguage } from '../i18n'
import { Dialog } from '../Menu'
import { useHost } from '../workspace/HostProvider'
import { errorText } from '../workspace/TaskPane'
import { useWorkspace } from '../workspace/workspace'
import { TaskRow } from '../sidebar/projects/TaskRow'
import { SETTINGS_FORM_CLASS } from './constants'
import { ListCount, ListEmpty, ListToolbar, useListView } from './ListView'

/** Archived history belongs to the current workspace, independently of preference targets. */
export function ArchivedThreads() {
  useLanguage()
  const { invoke } = useHost()
  const { viewOnly, canWrite } = useHostWriteAccess()
  const ws = useWorkspace()
  const [clearingArchived, setClearingArchived] = useState(false)
  const [clearBusy, setClearBusy] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)
  const archivedChats = ws.tasks
    .filter((task) => task.status === 'archived')
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  const projectName = (id: string) => ws.projects.find((project) => project.id === id)?.name
  const view = useListView(archivedChats, {
    text: (task) => `${task.title} ${projectName(task.projectId) ?? ''}`,
    size: 30,
  })
  return (
    <div className={SETTINGS_FORM_CLASS}>
      <SettingsGroupTitle>
        {t('Archived threads')} · {archivedChats.length}
      </SettingsGroupTitle>
      <div className="flex flex-col gap-3">
        <ListToolbar view={view} label={t('Search archived threads')} />
        <ListCount view={view} />
        <ListEmpty view={view} none="No archived threads" filtered="No archived threads match your search." />
        <div className="task-list flex flex-col gap-0.5">
          {view.paged.shown.map((task) => (
            <TaskRow key={task.id} task={task} projectName={projectName(task.projectId)} />
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
          <p>{t("This removes every archived thread and its agent transcripts. This can't be undone.")}</p>
          <p className="muted text-muted-foreground">{t('Worktrees and branches are kept.')}</p>
        </Dialog>
      )}
    </div>
  )
}
