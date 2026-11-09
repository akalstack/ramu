import { Button } from '@/components/desktop-button'
import { useIdentityView } from './identityView'
import { CheckCheck, FolderClosed, FolderPlus, MessageCircle, Pin, Plus } from 'lucide-react'
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { NO_PROJECT } from '@ramu/shared/types'
import { t, useLanguage } from '../i18n'
import { useWorkspace } from '../workspace/workspace'
import { useAppSettings } from '../settings/AppSettings'
import { useAddProject } from '../workspace/addProject'
import { useHost } from '../workspace/HostProvider'
import { PendingThreadsSection } from '../composer/WaitingThreads'
import { Collapse } from './projects/Collapse'
import { ICON_BUTTON_CLASS, pinnedFirst } from './projects/constants'
import { useProjectsDragDrop } from './projects/dnd'
import { ProjectGroup } from './projects/ProjectGroup'
import { SectionHead } from './projects/SectionHead'
import { TaskRow } from './projects/TaskRow'
import { BulkThreadActionsContext, ThreadSelectionBar, useBulkThreadActions } from './projects/ThreadSelectionBar'
import { sidebarThreads, threadProjectName } from './projects/threadLists'
import { useSidebarExpansion } from './projects/sidebarExpansion'
import { EMBEDDED_THREAD_LIMIT, ThreadPreviewList, useThreadPreview } from './projects/ThreadPreviewList'

export function ProjectsPanel({ embedded = false }: { embedded?: boolean }) {
  useLanguage()
  const ws = useWorkspace()
  const addProject = useAddProject()
  const { active, done } = sidebarThreads(ws.tasks)
  const host = useHost()
  const identityView = useIdentityView(host.id)
  const tree = useSidebarExpansion(host.id)
  const showDone = tree.isExpanded('section:done')
  // Pinned chats from every project gather in one section above the projects.
  const showPinned = tree.isExpanded('section:pinned'),
    showProjects = embedded || tree.isExpanded('section:projects'),
    showChats = tree.isExpanded('section:chats')
  const pinned = active.filter((t) => t.pinnedAt).sort(pinnedFirst)
  const looseChats = active.filter((t) => t.projectId === NO_PROJECT && !t.pinnedAt).sort(pinnedFirst)
  const { preferences } = useAppSettings()
  const loosePreview = useThreadPreview(
    host.id,
    ws.tasks,
    NO_PROJECT,
    embedded ? Math.min(preferences.recentChats, EMBEDDED_THREAD_LIMIT) : Infinity,
    ws.ui.activeTaskId,
  )
  // Recent mode: every chat in one list by activity, each naming its project, under the same identity view as projects.
  const recentMode = preferences.recentChatMode
  const latest = recentMode ? active.filter((t) => !t.pinnedAt).sort((a, b) => b.lastActiveAt - a.lastActiveAt) : []
  const bulk = useBulkThreadActions()
  const { reorder, folderOver, onDragOver, onDragLeave, onDrop } = useProjectsDragDrop()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }))
  const projectIds = ws.projects.map((project) => project.id)
  const dropProject = (event: DragEndEvent) => {
    const from = projectIds.indexOf(String(event.active.id)),
      to = event.over ? projectIds.indexOf(String(event.over.id)) : -1
    if (from >= 0 && to >= 0 && from !== to) void reorder(arrayMove(projectIds, from, to))
  }

  return (
    <BulkThreadActionsContext.Provider value={bulk}>
      <div
        className={`panel [&_>_.hint]:m-[8px_0_12px] [&_>_.hint]:p-[4px_8px] [&_>_.hint]:leading-[1.55] [&_>_.hint]:[overflow-wrap:anywhere] [&_.scm-empty]:m-[8px_0] [&_.scm-empty]:p-2 [&_.scm-empty]:leading-[1.5] [&_.scm-empty]:[overflow-wrap:anywhere] ${embedded ? 'p-0' : 'p-[2px_8px_16px]'} tasks-panel${folderOver ? ' folder-drop' : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <ThreadSelectionBar actions={bulk} />
        {/* Threads started here while this host was away; each starts there once it is back. */}
        <PendingThreadsSection hostId={host.id} />
        {pinned.length > 0 && (
          <>
            <SectionHead
              title={t('Pinned')}
              icon={Pin}
              open={showPinned}
              onToggle={() => tree.setExpanded('section:pinned', !showPinned)}
              controls="pinned-chats"
            />
            <Collapse open={showPinned} id="pinned-chats" className="task-list flex flex-col gap-0.5">
              {pinned.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  hidePin
                  projectName={threadProjectName(ws.projects, task.projectId)}
                />
              ))}
            </Collapse>
          </>
        )}
        {!embedded && (
          <SectionHead
            title={recentMode ? t('Recent threads') : t('Projects')}
            icon={recentMode ? MessageCircle : FolderClosed}
            open={showProjects}
            onToggle={() => tree.setExpanded('section:projects', !showProjects)}
            controls="projects-list"
          >
            {identityView.picker}
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
        )}
        <Collapse open={showProjects} id="projects-list">
          {recentMode && (
            <div className="flex flex-col gap-0.5">
              {identityView.arrange(
                latest,
                (task) => task.projectId,
                (task) => (
                  <TaskRow key={task.id} task={task} projectName={threadProjectName(ws.projects, task.projectId)} />
                ),
              )}
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
          {!recentMode && (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dropProject}>
              <SortableContext items={projectIds} strategy={verticalListSortingStrategy}>
                {identityView.arrange(
                  ws.projects,
                  (p) => p.id,
                  (p) => (
                    <ProjectGroup key={p.id} project={p} previewLimit={embedded ? EMBEDDED_THREAD_LIMIT : undefined} />
                  ),
                )}
              </SortableContext>
            </DndContext>
          )}
        </Collapse>
        {!recentMode && (!embedded || looseChats.length > 0) && (
          <>
            <SectionHead
              title={t('Threads')}
              icon={MessageCircle}
              open={showChats}
              onToggle={() => tree.setExpanded('section:chats', !showChats)}
              controls="loose-chats"
            >
              <Button
                variant="ghost"
                size="icon-xs"
                className={ICON_BUTTON_CLASS}
                aria-label={t('New thread without a project')}
                onClick={() => ws.newTask(NO_PROJECT)}
              >
                <Plus size={14} />
              </Button>
            </SectionHead>
            <Collapse open={showChats} id="loose-chats" className="flex flex-col gap-0.5">
              {looseChats.length > 0 && <ThreadPreviewList preview={loosePreview} />}
            </Collapse>
          </>
        )}
        {!embedded && done.length > 0 && (
          <>
            <SectionHead
              title={t('Done')}
              icon={CheckCheck}
              count={done.length}
              open={showDone}
              onToggle={() => tree.setExpanded('section:done', !showDone)}
              controls="done-chats"
            />
            <Collapse open={showDone} id="done-chats" className="task-list flex flex-col gap-0.5">
              {done.map((task) => (
                <TaskRow key={task.id} task={task} projectName={threadProjectName(ws.projects, task.projectId)} />
              ))}
            </Collapse>
          </>
        )}
      </div>
    </BulkThreadActionsContext.Provider>
  )
}
