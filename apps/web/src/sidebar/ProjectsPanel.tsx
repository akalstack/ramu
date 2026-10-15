import { Button } from '@/components/desktop-button'
import { FolderPlus, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NO_PROJECT } from '@ramu/shared/types'
import { t, useLanguage } from '../i18n'
import { invoke } from '../ipc'
import { Dialog } from '../Menu'
import { errorText } from '../workspace/TaskPane'
import { useWorkspace } from '../workspace/workspace'
import { useAppSettings } from '../settings/AppSettings'
import { useAddProject } from '../workspace/addProject'
import { Collapse } from './projects/Collapse'
import { ICON_BUTTON_CLASS, pinnedFirst } from './projects/constants'
import { useProjectsDragDrop } from './projects/dnd'
import { ProjectGroup } from './projects/ProjectGroup'
import { SectionHead } from './projects/SectionHead'
import { TaskRow } from './projects/TaskRow'

export function ProjectsPanel() {
  useLanguage()
  const ws = useWorkspace()
  const addProject = useAddProject()
  const [showArchived, setShowArchived] = useState(false)
  const [clearingArchived, setClearingArchived] = useState(false)
  const [clearBusy, setClearBusy] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)
  const archivedChats = ws.tasks
    .filter((task) => task.status === 'archived')
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  // Pinned chats from every project gather in one section above the projects.
  const showPinned = ws.isExpanded('section:pinned'),
    showProjects = ws.isExpanded('section:projects'),
    showChats = ws.isExpanded('section:chats')
  const pinned = ws.tasks.filter((t) => t.pinnedAt && t.status !== 'archived').sort(pinnedFirst)
  const looseChats = ws.tasks
    .filter((t) => t.projectId === NO_PROJECT && t.status !== 'archived' && !t.pinnedAt)
    .sort(pinnedFirst)
  const { preferences } = useAppSettings()
  // Relative labels keep aging even when no provider event re-renders the list.
  const [, setTimeTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setTimeTick((tick) => tick + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  // Recent mode: every chat in one list by activity, each led by its project's name.
  const recentMode = preferences.recentChatMode
  const latest = recentMode
    ? ws.tasks.filter((t) => t.status !== 'archived' && !t.pinnedAt).sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    : []
  const { dnd, folderOver, onDragOver, onDragLeave, onDrop } = useProjectsDragDrop()

  return (
    <div
      className={`panel [&_>_.hint]:m-[8px_0_12px] [&_>_.hint]:p-[4px_8px] [&_>_.hint]:leading-[1.55] [&_>_.hint]:[overflow-wrap:anywhere] [&_:is(.scm-empty,_.empty-tasks)]:m-[8px_0] [&_:is(.scm-empty,_.empty-tasks)]:p-2 [&_:is(.scm-empty,_.empty-tasks)]:leading-[1.5] [&_:is(.scm-empty,_.empty-tasks)]:[overflow-wrap:anywhere] p-[2px_8px_16px] tasks-panel${folderOver ? ' folder-drop' : ''}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {pinned.length > 0 && (
        <>
          <SectionHead
            title={t('Pinned')}
            open={showPinned}
            onToggle={() => ws.setExpanded('section:pinned', !showPinned)}
            controls="pinned-chats"
          />
          <Collapse open={showPinned} id="pinned-chats" className="task-list flex flex-col gap-0.5">
            {pinned.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                hidePin
                projectName={ws.projects.find((project) => project.id === task.projectId)?.name}
              />
            ))}
          </Collapse>
        </>
      )}
      <SectionHead
        title={recentMode ? t('Recent chats') : t('Projects')}
        open={showProjects}
        onToggle={() => ws.setExpanded('section:projects', !showProjects)}
        controls="projects-list"
      >
        <Button
          variant="ghost"
          size="icon-xs"
          className={ICON_BUTTON_CLASS}
          aria-label={t('Add project')}
          title={t('Add project…')}
          disabled={addProject.busy}
          onClick={() => void addProject.add()}
        >
          <FolderPlus size={14} />
        </Button>
      </SectionHead>
      <Collapse open={showProjects} id="projects-list">
        {recentMode && (
          <div className="flex flex-col gap-0.5">
            {latest.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                projectName={ws.projects.find((project) => project.id === task.projectId)?.name}
              />
            ))}
          </div>
        )}
        {!recentMode && ws.projects.length === 0 && (
          <div className="add-project [&_.hint]:m-[6px_0_14px] [&_.hint]:leading-[1.55] p-[2px_8px_4px]">
            <p className="muted text-muted-foreground hint m-[4px_0_8px] text-control leading-[1.5]">
              {t('Choose a repository or a folder containing repositories.')}
            </p>
            <Button
              variant="secondary"
              className="bg-fill hover:bg-fill-hover add-project-btn [&:hover:not(:disabled)]:[background:var(--fill-hover)] w-full min-h-[30px] rounded-(--radius-s) bg-fill [border-color:transparent] text-foreground justify-start"
              disabled={addProject.busy}
              onClick={() => void addProject.add()}
            >
              <FolderPlus size={14} /> {t(' Add project…')}
            </Button>
          </div>
        )}
        {!recentMode && ws.projects.map((p) => <ProjectGroup key={p.id} project={p} dnd={dnd} />)}
      </Collapse>
      {!recentMode && (
        <>
          <SectionHead
            title={t('Chats')}
            open={showChats}
            onToggle={() => ws.setExpanded('section:chats', !showChats)}
            controls="loose-chats"
          >
            <Button
              variant="ghost"
              size="icon-xs"
              className={ICON_BUTTON_CLASS}
              aria-label={t('New chat without a project')}
              onClick={() => ws.newTask(NO_PROJECT)}
            >
              <Plus size={14} />
            </Button>
          </SectionHead>
          <Collapse open={showChats} id="loose-chats" className="flex flex-col gap-0.5">
            {looseChats.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </Collapse>
        </>
      )}
      {archivedChats.length > 0 && (
        <>
          <SectionHead
            title={`${t('Archived')} · ${archivedChats.length}`}
            open={showArchived}
            onToggle={() => setShowArchived((shown) => !shown)}
            controls="archived-chats"
          >
            <Button
              variant="ghost"
              size="icon-xs"
              className={`${ICON_BUTTON_CLASS} opacity-0 [transition:opacity_0.12s] group-hover/head:opacity-100 group-focus-within/head:opacity-100`}
              aria-label={t('Delete all archived chats')}
              title={t('Delete all archived chats')}
              onClick={() => {
                setClearError(null)
                setClearingArchived(true)
              }}
            >
              <Trash2 size={14} />
            </Button>
          </SectionHead>
          {showArchived && (
            <div id="archived-chats" className="task-list flex flex-col gap-0.5">
              {archivedChats.length === 0 && <p className="muted small empty-tasks">{t('No archived chats')}</p>}
              {archivedChats.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  projectName={ws.projects.find((project) => project.id === task.projectId)?.name}
                />
              ))}
            </div>
          )}
        </>
      )}
      {clearingArchived && (
        <Dialog
          title={t('Delete {0} archived chats?', { '0': archivedChats.length })}
          confirmLabel={t('Delete all')}
          danger
          busy={clearBusy}
          error={clearError}
          onCancel={() => {
            setClearingArchived(false)
            setClearError(null)
          }}
          onConfirm={async () => {
            setClearBusy(true)
            setClearError(null)
            try {
              for (const task of archivedChats) {
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
          <p>{t("This removes every archived chat and its agent transcripts. This can't be undone.")}</p>
          <p className="muted text-muted-foreground">{t('Worktrees and branches are kept.')}</p>
        </Dialog>
      )}
    </div>
  )
}
