import { useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, FolderOpen, FolderClosed, FolderPlus, Plus } from 'lucide-react'
import { NO_PROJECT, type Computer, type Project, type Task } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { useComputers, StatusDot, activityText, statusText } from '../workspace/computers'
import { rememberHostRows, useHostOverviews } from '../workspace/hostOverview'
import { HostScope, useWorkspace, useWorkspaceOf, useWorkspacesOf, type WorkspaceApi } from '../workspace/workspace'
import { useHostSelection } from '../workspace/HostSelection'
import { useAppSettings } from '../settings/AppSettings'
import { useAddProject } from '../workspace/addProject'
import { ownHostId } from '../hosts'
import { t, useLanguage } from '../i18n'
import { FadeText } from '../FadeText'
import { ProjectsPanel } from './ProjectsPanel'
import { TaskRow } from './projects/TaskRow'
import { SectionHead } from './projects/SectionHead'
import { Collapse } from './projects/Collapse'
import { ICON_BUTTON_CLASS, ROW_ACTIONS_CLASS, pinnedFirst } from './projects/constants'
import { sidebarThreads, projectThreadPreview } from './projects/threadLists'
import { hostRows } from './hostRows'

/**
 * Where the sidebar keeps which host groups and sections are open: the window's own store, so the tree does not jump
 * when another host's store comes on screen.
 */
function useSidebarChrome(): WorkspaceApi {
  const active = useWorkspace()
  return useWorkspaceOf(ownHostId()) ?? active
}

/** One host's rows: from its own store once loaded (live, no polling), else from its last known overview. */
function useHostGroupRows(id: string) {
  const store = useWorkspaceOf(id)
  const [overview] = useHostOverviews([id], () => !!store)
  useEffect(() => {
    if (store) rememberHostRows(id, { tasks: store.tasks, projects: store.projects })
  }, [id, store?.tasks, store?.projects])
  return { store, ...hostRows({ store, overview }) }
}

/** One host filter and one consistent tree, with the host on screen retaining its project management controls. */
export function HostProjects() {
  useLanguage()
  const state = useComputers()
  const { preferences } = useAppSettings()
  const { activeHost } = useHostSelection()
  if (!state || state.computers.length < 2) return <ProjectsPanel />
  if (!state.scope && preferences.recentChatMode)
    return <MergedRecent computers={state.computers} current={activeHost} />
  const scoped = state.scope ? state.computers.filter((computer) => computer.id === state.scope) : state.computers
  return (
    <div className={`flex flex-col gap-3 pb-4 pt-1 ${state.scope ? '' : 'px-2'}`}>
      {scoped.map((computer) => (
        <HostGroup key={computer.id} computer={computer} current={computer.id === activeHost} grouped={!state.scope} />
      ))}
    </div>
  )
}

function HostGroup({ computer, current, grouped }: { computer: Computer; current: boolean; grouped: boolean }) {
  const chrome = useSidebarChrome()
  const { select } = useHostSelection()
  const addProject = useAddProject(computer.id)
  const key = `host:${computer.id}`
  const open = !grouped || chrome.isExpanded(key)
  const available = computer.status === 'connected'
  return (
    <section aria-label={computer.name} className="min-w-0">
      {grouped && (
        <div className="group/host flex min-h-8 items-center gap-0.5 px-1">
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 border-0 bg-transparent px-1 py-1 text-left text-control text-muted-foreground hover:text-foreground"
            title={computer.name}
            aria-expanded={open}
            onClick={() => chrome.setExpanded(key, !open)}
          >
            <ChevronDown size={12} className={`flex-none transition-transform ${open ? '' : '-rotate-90'}`} />
            <span className="inline-flex flex-none items-center" title={activityText(computer)}>
              <StatusDot status={computer.status} />
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{computer.name}</span>
            {available && computer.needsInput > 0 && (
              <span
                className="inline-flex flex-none items-center gap-1 rounded-full bg-fill px-1.5 text-caption tabular-nums text-foreground"
                title={t('{0} waiting', { 0: computer.needsInput })}
              >
                <span className="size-1.5 rounded-full bg-warn" />
                {computer.needsInput}
              </span>
            )}
            {available && computer.running > 0 && (
              <span
                className="inline-flex flex-none items-center gap-1 rounded-full bg-fill px-1.5 text-caption tabular-nums text-muted-foreground"
                title={t('{0} working', { 0: computer.running })}
              >
                <span className="size-2 animate-spin rounded-full border border-current border-t-transparent" />
                {computer.running}
              </span>
            )}
          </button>
          <Button
            variant="ghost"
            size="icon-xs"
            className={`${ICON_BUTTON_CLASS} opacity-0 group-hover/host:opacity-100 group-focus-within/host:opacity-100`}
            aria-label={`${t('Add project')} · ${computer.name}`}
            title={t('Add project…')}
            disabled={!available || addProject.busy}
            onClick={() => void addProject.add()}
          >
            <FolderPlus size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className={`${ICON_BUTTON_CLASS} opacity-0 group-hover/host:opacity-100 group-focus-within/host:opacity-100`}
            disabled={!available}
            aria-label={`${t('New thread')} · ${computer.name}`}
            title={t('New thread')}
            onClick={() => select(computer.id, { kind: 'new' })}
          >
            <Plus size={14} />
          </Button>
        </div>
      )}
      {open &&
        (current ? <ProjectsPanel embedded={grouped} /> : <OtherHostProjects computer={computer} embedded={grouped} />)}
    </section>
  )
}

/** A host that is not on screen: its rows act on that host's store and open there through the selection. */
function OtherHostProjects({ computer, embedded }: { computer: Computer; embedded: boolean }) {
  const chrome = useSidebarChrome()
  const { select } = useHostSelection()
  const { preferences } = useAppSettings()
  const rows = useHostGroupRows(computer.id)
  const available = computer.status === 'connected'
  const all = rows.tasks
  const projects = rows.projects
  const { active, done } = sidebarThreads(all)
  const pinned = active.filter((task) => task.pinnedAt).sort(pinnedFirst)
  const loose = active.filter((task) => task.projectId === NO_PROJECT && !task.pinnedAt).sort(pinnedFirst)
  const projectsKey = `host:${computer.id}:projects`
  const projectsOpen = embedded || chrome.isExpanded(projectsKey)
  const section = (name: string, tasks: Task[], hidePin = false, action?: React.ReactNode) => {
    if (!tasks.length) return null
    const key = `host:${computer.id}:${name}`
    const open = chrome.isExpanded(key)
    return (
      <>
        <SectionHead title={t(name)} open={open} onToggle={() => chrome.setExpanded(key, !open)} controls={key}>
          {action}
        </SectionHead>
        <Collapse id={key} open={open} className="flex flex-col gap-0.5">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              hidePin={hidePin}
              projectName={name === 'Threads' ? undefined : projects.find((p) => p.id === task.projectId)?.name}
            />
          ))}
        </Collapse>
      </>
    )
  }
  return (
    <HostScope host={computer.id} store={rows.store}>
      <div className={embedded ? '' : 'px-2'}>
        {!available && (
          <p role="status" className="px-2 py-1 text-caption text-muted-foreground">
            {statusText(computer.status)}
            {rows.known ? ` · ${t('Last known activity')}` : ''}
          </p>
        )}
        {rows.loading && available && (
          <p role="status" className="px-2 py-1 text-caption text-muted-foreground">
            {t('Loading…')}
          </p>
        )}
        {rows.failed ? (
          <p role="status" className="px-2 py-1 text-caption text-muted-foreground">
            {t('Some host activity could not be loaded.')}
          </p>
        ) : null}
        {section('Pinned', pinned, true)}
        {!embedded && (
          <SectionHead
            title={preferences.recentChatMode ? t('Recent threads') : t('Projects')}
            open={projectsOpen}
            onToggle={() => chrome.setExpanded(projectsKey, !projectsOpen)}
            controls={projectsKey}
          />
        )}
        <Collapse open={projectsOpen} id={projectsKey}>
          {preferences.recentChatMode
            ? active
                .filter((task) => !task.pinnedAt)
                .sort(pinnedFirst)
                .map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    projectName={projects.find((p) => p.id === task.projectId)?.name}
                  />
                ))
            : projects.map((project) => (
                <OtherHostProject
                  key={project.id}
                  host={computer.id}
                  project={project}
                  tasks={all}
                  available={available}
                  limit={embedded ? Math.min(preferences.recentChats, 5) : preferences.recentChats}
                />
              ))}
        </Collapse>
        {!preferences.recentChatMode &&
          section(
            'Threads',
            loose,
            false,
            <Button
              variant="ghost"
              size="icon-xs"
              className={ICON_BUTTON_CLASS}
              disabled={!available}
              aria-label={t('New thread without a project')}
              onClick={() => select(computer.id, { kind: 'new', projectId: NO_PROJECT })}
            >
              <Plus size={14} />
            </Button>,
          )}
        {section('Done', done)}
        {rows.known && !projects.length && !all.length && (
          <p className="px-2 py-1 text-caption text-muted-foreground">{t('No threads yet')}</p>
        )}
      </div>
    </HostScope>
  )
}

function OtherHostProject({
  host,
  project,
  tasks: all,
  available,
  limit,
}: {
  host: string
  project: Project
  tasks: Task[]
  available: boolean
  limit: number
}) {
  const chrome = useSidebarChrome()
  const { select } = useHostSelection()
  const key = `host:${host}:project:${project.id}`
  const open = chrome.isExpanded(key)
  const [showAll, setShowAll] = useState(false)
  const { tasks, hasMore } = projectThreadPreview(all, project.id, limit, showAll)
  const openProject = () => select(host, { kind: 'project', projectId: project.id })
  return (
    <section className="project-group mb-0 [&:has(.task-list)]:mb-2.5 relative">
      <div
        role="button"
        tabIndex={available ? 0 : -1}
        aria-disabled={!available || undefined}
        aria-label={t('Open {0}', { '0': project.name })}
        title={project.root ?? project.name}
        className="project-row group/project flex min-h-[30px] items-center gap-2 rounded-(--radius-s) px-2 text-body leading-5 text-soft hover:bg-accent hover:text-foreground"
        onClick={() => {
          if (available) {
            chrome.setExpanded(key, true)
            openProject()
          }
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && available) openProject()
        }}
      >
        {open ? (
          <FolderOpen size={15} className="flex-none text-muted-foreground" />
        ) : (
          <FolderClosed size={15} className="flex-none text-muted-foreground" />
        )}
        <FadeText text={project.name} className="project-name min-w-0 flex-1 overflow-hidden whitespace-nowrap" />
        <span className={`${ROW_ACTIONS_CLASS} group-hover/project:opacity-100 group-focus-within/project:opacity-100`}>
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON_CLASS}
            aria-label={t('Toggle {0}', { '0': project.name })}
            title={open ? t('Collapse') : t('Expand')}
            onClick={(event) => {
              event.stopPropagation()
              chrome.setExpanded(key, !open)
            }}
          >
            <ChevronRight size={14} className={open ? 'rotate-90' : ''} />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            className={ICON_BUTTON_CLASS}
            disabled={!available}
            aria-label={t('New thread in {0}', { '0': project.name })}
            title={t('New thread')}
            onClick={(event) => {
              event.stopPropagation()
              select(host, { kind: 'new', projectId: project.id })
            }}
          >
            <Plus size={14} />
          </Button>
        </span>
      </div>
      {open && (
        <div className="task-list flex flex-col gap-0.5 pt-0.5">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} nested />
          ))}
          {!tasks.length && (
            <div className="muted text-muted-foreground small text-caption empty-tasks p-[2px_10px]">
              {t('No threads yet')}
            </div>
          )}
          {hasMore && (
            <Button
              variant="tree"
              className="h-[30px] min-h-[30px] gap-2 pl-[31px] pr-2 text-body leading-5 hover:bg-accent"
              aria-expanded={showAll}
              onClick={() => setShowAll(!showAll)}
            >
              {showAll ? t('Show less') : t('Show more')}
              <ChevronDown size={14} className={showAll ? 'rotate-180' : ''} />
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

/** Activity mode with every host selected: one list by recency, each row naming its project and host. */
function MergedRecent({ computers, current }: { computers: Computer[]; current: string }) {
  const ws = useWorkspace()
  const remotes = computers.filter((computer) => computer.id !== current)
  const ids = remotes.map((computer) => computer.id)
  const stores = useWorkspacesOf(ids)
  const overviews = useHostOverviews(ids, (id) => !!stores[ids.indexOf(id)])
  const rows = [
    ...sidebarThreads(ws.tasks).active.map((task) => ({
      task,
      projectName: ws.projects.find((p) => p.id === task.projectId)?.name,
      host: null as string | null,
      store: null as WorkspaceApi | null,
    })),
    ...remotes.flatMap((computer, index) => {
      const store = stores[index] ?? null
      const source = hostRows({ store, overview: overviews[index] })
      return sidebarThreads(source.tasks).active.map((task) => ({
        task,
        projectName: source.projects.find((p) => p.id === task.projectId)?.name,
        host: computer.id as string | null,
        store,
      }))
    }),
  ].sort((a, b) => Number(!!b.task.pinnedAt) - Number(!!a.task.pinnedAt) || b.task.lastActiveAt - a.task.lastActiveAt)
  return (
    <div className="flex flex-col gap-0.5 px-2 pb-4 pt-1">
      {rows.map(({ task, projectName, host, store }) =>
        host ? (
          <HostScope key={`${host}:${task.id}`} host={host} store={store}>
            <TaskRow task={task} projectName={projectName} merged />
          </HostScope>
        ) : (
          <TaskRow key={`${current}:${task.id}`} task={task} projectName={projectName} merged />
        ),
      )}
    </div>
  )
}
