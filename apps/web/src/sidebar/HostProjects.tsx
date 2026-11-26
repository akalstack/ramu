import { SidebarDisclosureButton } from '@/components/sidebar-disclosure-button'
import { useIdentityView } from './identityView'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useHeld, useSteadySpin } from '../lib/steadyActivity'
import {
  CheckCheck,
  CircleAlert,
  MessageCircle,
  Pin,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  FolderClosed,
  FolderPlus,
  Plus,
  type LucideIcon,
  LoaderCircle,
  Rocket,
  CircleCheck,
  SquarePen,
} from 'lucide-react'
import { NO_PROJECT, type Computer, type Project, type Task } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { useComputers, StatusDot, activityText, statusText } from '../workspace/computers'
import { useRestartingHosts } from '../workspace/restartingHosts'
import { rememberHostRows, useHostOverviews } from '../workspace/hostOverview'
import { HostScope, useWorkspaceOf, useWorkspacesOf } from '../workspace/workspace'
import { useHostSelection } from '../workspace/HostSelection'
import { useAppSettings } from '../settings/AppSettings'
import { useAddProject } from '../workspace/addProject'
import { t, useLanguage } from '../i18n'
import { FadeText } from '../FadeText'
import { ProjectsPanel } from './ProjectsPanel'
import { TaskRow } from './projects/TaskRow'
import { LiveAppDialog } from './projects/LiveAppDialog'
import { CiSetupDialog } from './projects/CiSetup'
import { useContextMenu, type MenuEntry } from '../Menu'
import { useHostWriteAccess } from '../composer/useHostWriteAccess'
import { SectionHead } from './projects/SectionHead'
import { Collapse } from './projects/Collapse'
import { ICON_BUTTON_CLASS, ROW_ACTIONS_CLASS, pinnedFirst, STICKY_PROJECT_CLASS } from './projects/constants'
import { mergedThreads, sidebarThreads, threadNeedsYou, threadProjectName } from './projects/threadLists'
import { useSharedSidebarSection, useSidebarExpansion } from './projects/sidebarExpansion'
import { EMBEDDED_THREAD_LIMIT, ThreadPreviewList, useThreadPreview } from './projects/ThreadPreviewList'
import { hostRows } from './hostRows'
import { hasOfflineCopy } from '../workspace/offlineCopy'
import { PendingThreadsSection } from '../composer/WaitingThreads'
import { canOpenOffline } from '../workspace/selectionRoute'

/** One host's rows: from its own store once loaded (live, no polling), else from its last known overview. */
function useHostGroupRows(id: string) {
  const store = useWorkspaceOf(id)
  const [overview] = useHostOverviews([id], () => !!store)
  useEffect(() => {
    if (store) rememberHostRows(id, { tasks: store.tasks, projects: store.projects })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [id, store?.tasks, store?.projects] by design; the values it reads beyond these are current as of that run
  }, [id, store?.tasks, store?.projects])
  return { store, ...hostRows({ store, overview }) }
}

/** One host filter and one consistent tree, with the host on screen retaining its project management controls. */
export function HostProjects() {
  useLanguage()
  const state = useComputers()
  const { preferences } = useAppSettings()
  const { activeHost } = useHostSelection()
  // Relative labels keep aging even when no provider event re-renders the list.
  const [, setTimeTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setTimeTick((tick) => tick + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  if (!state || state.computers.length < 2) return <ProjectsPanel />
  const scoped = state.scope ? state.computers.filter((computer) => computer.id === state.scope) : state.computers
  return (
    <div
      className={`flex flex-col gap-2 pb-4 pt-1 ${state.scope ? '' : 'px-2 [&>section+section]:border-t [&>section+section]:border-border [&>section+section]:pt-2'}`}
    >
      {!state.scope && <NeedsYou computers={state.computers} />}
      {!state.scope && preferences.recentChatMode ? (
        <MergedRecent computers={state.computers} />
      ) : (
        scoped.map((computer) => (
          <HostGroup
            key={computer.id}
            computer={computer}
            current={computer.id === activeHost}
            grouped={!state.scope}
          />
        ))
      )}
      {!state.scope && <MergedDone computers={state.computers} />}
    </div>
  )
}

function SteadyLoader() {
  const ref = useSteadySpin<SVGSVGElement>()
  return <LoaderCircle ref={ref} size={12} className="animate-spin" aria-hidden />
}

function HostGroup({ computer, current, grouped }: { computer: Computer; current: boolean; grouped: boolean }) {
  const tree = useSidebarExpansion(computer.id)
  const { select } = useHostSelection()
  const addProject = useAddProject(computer.id)
  const restarting = useRestartingHosts().has(computer.id)
  const open = !grouped || tree.isExpanded('host')
  const available = computer.status === 'connected'
  // Away, but kept here: its threads open from this device's copy, and new ones wait in the outbox.
  const openable = available || (canOpenOffline(computer.status) && hasOfflineCopy(computer.id))
  // The count drops to zero between a turn's steps; keep the last number through that gap.
  const lastWorking = useRef(0)
  if (computer.running > 0) lastWorking.current = computer.running
  const working = useHeld(computer.running > 0) ? lastWorking.current : 0
  return (
    <section
      aria-label={computer.name}
      className="min-w-0"
      style={grouped ? ({ '--sticky-host-height': '2rem' } as CSSProperties) : undefined}
    >
      {grouped && (
        <div className="group/host sticky top-0 z-[6] flex min-h-8 items-center gap-0.5 bg-(--sidebar) px-1">
          {/* The whole row highlights, under the actions too. */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-y-0 inset-x-1 rounded-(--radius-s) group-hover/host:bg-accent"
          />
          <SidebarDisclosureButton
            // Room for the actions that appear over the row's end, so the name truncates before them.
            className="relative min-w-0 flex-1 text-foreground hover:bg-transparent group-hover/host:pr-[52px] group-focus-within/host:pr-[52px]"
            title={computer.name}
            aria-expanded={open}
            onClick={() => tree.setExpanded('host', !open)}
          >
            <ChevronDown size={12} className={`flex-none transition-transform ${open ? '' : '-rotate-90'}`} />
            <span className="inline-flex flex-none items-center" title={activityText(computer, restarting)}>
              <StatusDot status={computer.status} />
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{computer.name}</span>
            {available && computer.needsInput > 0 && (
              <span
                className="inline-flex flex-none items-center gap-1 text-caption tabular-nums text-foreground group-hover/host:opacity-0"
                title={t('{0} waiting', { 0: computer.needsInput })}
              >
                <span className="size-1.5 rounded-full bg-warn" />
                {computer.needsInput}
              </span>
            )}
            {available && working > 0 && (
              <span
                className="inline-flex flex-none items-center gap-1 text-caption tabular-nums text-muted-foreground group-hover/host:opacity-0"
                title={t('{0} working', { 0: working })}
              >
                <SteadyLoader />
                {working}
              </span>
            )}
          </SidebarDisclosureButton>
          {/* Overlays the row's end, so counts sit flush right until the actions are wanted. */}
          <div className="absolute inset-y-0 right-1 flex items-center gap-0.5 bg-(--sidebar) opacity-0 group-hover/host:bg-transparent group-hover/host:opacity-100 focus-within:opacity-100">
            <Button
              variant="ghost"
              size="icon-xs"
              className={ICON_BUTTON_CLASS}
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
              className={ICON_BUTTON_CLASS}
              disabled={!openable}
              aria-label={`${t('New thread')} · ${computer.name}`}
              title={t('New thread')}
              onClick={() => select(computer.id, { kind: 'new' })}
            >
              <Plus size={14} />
            </Button>
          </div>
        </div>
      )}
      {open &&
        (current ? <ProjectsPanel embedded={grouped} /> : <OtherHostProjects computer={computer} embedded={grouped} />)}
    </section>
  )
}

/** A host that is not on screen: its rows act on that host's store and open there through the selection. */
function OtherHostProjects({ computer, embedded }: { computer: Computer; embedded: boolean }) {
  const tree = useSidebarExpansion(computer.id)
  const identityView = useIdentityView(computer.id)
  const { select } = useHostSelection()
  const { preferences } = useAppSettings()
  const rows = useHostGroupRows(computer.id)
  const available = computer.status === 'connected'
  // Away, but kept here: its threads open from this device's copy, and new ones wait in the outbox.
  const openable = available || (canOpenOffline(computer.status) && hasOfflineCopy(computer.id))
  const all = rows.tasks
  const projects = rows.projects
  const { active, done } = sidebarThreads(all)
  const pinned = active.filter((task) => task.pinnedAt).sort(pinnedFirst)
  const loose = active.filter((task) => task.projectId === NO_PROJECT && !task.pinnedAt).sort(pinnedFirst)
  const loosePreview = useThreadPreview(
    computer.id,
    all,
    NO_PROJECT,
    embedded ? Math.min(preferences.recentChats, EMBEDDED_THREAD_LIMIT) : Infinity,
  )
  const projectsDomId = `host:${computer.id}:projects`
  const projectsOpen = embedded || tree.isExpanded('section:projects')
  const doneSection = useSharedSidebarSection('section:done')
  const section = (
    name: string,
    id: string,
    tasks: Task[],
    { hidePin = false, action, body }: { hidePin?: boolean; action?: React.ReactNode; body?: React.ReactNode } = {},
  ) => {
    if (!tasks.length) return null
    const key = `host:${computer.id}:${id}`
    const shared = name === 'Done'
    const open = shared ? doneSection.open : tree.isExpanded(id)
    return (
      <>
        <SectionHead
          title={t(name)}
          icon={name === 'Done' ? CheckCheck : name === 'Pinned' ? Pin : MessageCircle}
          count={name === 'Done' ? tasks.length : undefined}
          open={open}
          onToggle={() => (shared ? doneSection.setOpen(!open) : tree.setExpanded(id, !open))}
          controls={key}
        >
          {action}
        </SectionHead>
        <Collapse id={key} open={open} className="flex flex-col gap-0.5">
          {body ??
            tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                hidePin={hidePin}
                projectName={name === 'Threads' ? undefined : threadProjectName(projects, task.projectId)}
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
        {/* Threads started here while this host was away; each starts there once it is back. */}
        <PendingThreadsSection hostId={computer.id} />
        {section('Pinned', 'section:pinned', pinned, { hidePin: true })}
        {!embedded && (
          <SectionHead
            title={preferences.recentChatMode ? t('Recent threads') : t('Projects')}
            icon={preferences.recentChatMode ? MessageCircle : FolderClosed}
            open={projectsOpen}
            onToggle={() => tree.setExpanded('section:projects', !projectsOpen)}
            controls={projectsDomId}
          >
            {identityView.picker}
          </SectionHead>
        )}
        <Collapse open={projectsOpen} id={projectsDomId}>
          {preferences.recentChatMode
            ? identityView.arrange(
                active.filter((task) => !task.pinnedAt).sort(pinnedFirst),
                (task) => task.projectId,
                (task) => (
                  <TaskRow key={task.id} task={task} projectName={threadProjectName(projects, task.projectId)} />
                ),
              )
            : identityView.arrange(
                projects,
                (project) => project.id,
                (project) => (
                  <OtherHostProject
                    key={project.id}
                    host={computer.id}
                    project={project}
                    tasks={all}
                    available={available}
                    openable={openable}
                    limit={
                      embedded ? Math.min(preferences.recentChats, EMBEDDED_THREAD_LIMIT) : preferences.recentChats
                    }
                  />
                ),
              )}
        </Collapse>
        {!preferences.recentChatMode &&
          section('Threads', 'section:chats', loose, {
            body: <ThreadPreviewList preview={loosePreview} />,
            action: (
              <Button
                variant="ghost"
                size="icon-xs"
                className={ICON_BUTTON_CLASS}
                disabled={!openable}
                aria-label={t('New thread without a project')}
                onClick={() => select(computer.id, { kind: 'new', projectId: NO_PROJECT })}
              >
                <Plus size={14} />
              </Button>
            ),
          })}
        {!embedded && section('Done', 'section:done', done)}
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
  openable,
  limit,
}: {
  host: string
  project: Project
  tasks: Task[]
  available: boolean
  openable: boolean
  limit: number
}) {
  const tree = useSidebarExpansion(host)
  const { select } = useHostSelection()
  const key = `project:${project.id}`
  const open = tree.isExpanded(key)
  const preview = useThreadPreview(host, all, project.id, limit)
  const openProject = () => select(host, { kind: 'project', projectId: project.id })
  // Shipping from this row needs no switch to that host: Live app and Set up CI run there, as on its own projects.
  const repos = useWorkspaceOf(host)?.repos[project.id] ?? []
  const { viewOnly, canWrite } = useHostWriteAccess()
  const [deploying, setDeploying] = useState(false)
  const [settingUpCi, setSettingUpCi] = useState(false)
  const items: MenuEntry[] = [
    {
      key: 'new',
      label: (
        <>
          <SquarePen size={14} /> {t(' New thread')}
        </>
      ),
      onSelect: () => select(host, { kind: 'new', projectId: project.id }),
    },
    ...(available && !viewOnly
      ? [
          {
            key: 'live-app',
            label: (
              <>
                <Rocket size={14} /> {t(' Live app…')}
              </>
            ),
            onSelect: () => {
              if (canWrite()) setDeploying(true)
            },
          },
          {
            key: 'ci',
            label: (
              <>
                <CircleCheck size={14} /> {t(' Set up CI…')}
              </>
            ),
            onSelect: () => {
              if (canWrite()) setSettingUpCi(true)
            },
          },
        ]
      : []),
  ]
  const contextMenu = useContextMenu(`${project.name} actions`, items)
  return (
    <section className="project-group mb-0 [&:has(.task-list)]:mb-2.5 relative">
      {contextMenu.menu}
      <div className={STICKY_PROJECT_CLASS}>
        <div
          role="button"
          tabIndex={openable ? 0 : -1}
          aria-disabled={!openable || undefined}
          aria-label={t('Open {0}', { '0': project.name })}
          title={project.root ?? project.name}
          className="project-row group/project flex min-h-[30px] items-center gap-2 rounded-(--radius-s) px-2 text-body leading-5 text-soft hover:bg-accent hover:text-foreground"
          onClick={() => {
            if (openable) {
              tree.setExpanded(key, true)
              openProject()
            }
          }}
          onContextMenu={contextMenu.onContextMenu}
          onKeyDown={(event) => {
            contextMenu.onKeyDown(event)
            if (event.key === 'Enter' && openable) openProject()
          }}
        >
          {open ? (
            <FolderOpen size={15} className="flex-none text-muted-foreground" />
          ) : (
            <FolderClosed size={15} className="flex-none text-muted-foreground" />
          )}
          <FadeText
            text={project.name}
            className="project-name font-medium min-w-0 flex-1 overflow-hidden whitespace-nowrap"
          />
          <span
            className={`${ROW_ACTIONS_CLASS} group-hover/project:opacity-100 group-focus-within/project:opacity-100`}
          >
            <Button
              variant="ghost"
              size="icon-xs"
              className={ICON_BUTTON_CLASS}
              aria-label={t('Toggle {0}', { '0': project.name })}
              title={open ? t('Collapse') : t('Expand')}
              onClick={(event) => {
                event.stopPropagation()
                tree.setExpanded(key, !open)
              }}
            >
              <ChevronRight size={14} className={open ? 'rotate-90' : ''} />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              className={ICON_BUTTON_CLASS}
              disabled={!openable}
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
      </div>
      {open && <ThreadPreviewList preview={preview} />}
      {deploying && <LiveAppDialog project={project} repos={repos} onClose={() => setDeploying(false)} />}
      {settingUpCi && <CiSetupDialog project={project} repos={repos} onClose={() => setSettingUpCi(false)} />}
    </section>
  )
}

/** Every host's threads on equal terms: the same stores and rows whichever host is on screen. */
function useHostThreads(computers: Computer[]) {
  const ids = computers.map((computer) => computer.id)
  const stores = useWorkspacesOf(ids)
  const overviews = useHostOverviews(ids, (id) => !!stores[ids.indexOf(id)])
  return computers.map((computer, index) => {
    const source = hostRows({ store: stores[index] ?? null, overview: overviews[index] })
    return {
      host: computer.id,
      store: stores[index] ?? null,
      projects: source.projects,
      ...sidebarThreads(source.tasks),
    }
  })
}

type HostThreads = ReturnType<typeof useHostThreads>[number]

function MergedRow({ task, source }: { task: Task; source: HostThreads }) {
  return (
    <HostScope host={source.host} store={source.store}>
      <TaskRow task={task} projectName={threadProjectName(source.projects, task.projectId)} merged />
    </HostScope>
  )
}

/** Activity mode with every host selected: one list by recency, each row naming its project and host. */
function MergedRecent({ computers }: { computers: Computer[] }) {
  const rows = mergedThreads(useHostThreads(computers), (source) => source.active).sort(
    (a, b) => Number(!!b.task.pinnedAt) - Number(!!a.task.pinnedAt) || b.task.lastActiveAt - a.task.lastActiveAt,
  )
  return (
    <section className="flex min-w-0 flex-col gap-0.5">
      {rows.map(({ task, source }) => (
        <MergedRow key={`${source.host}:${task.id}`} task={task} source={source} />
      ))}
    </section>
  )
}

/** One collapsible list drawn from every host. Absent while it would be empty. */
function MergedSection({
  computers,
  id,
  title,
  icon,
  threads,
  order,
}: {
  computers: Computer[]
  id: string
  title: string
  icon: LucideIcon
  threads: (source: HostThreads) => Task[]
  order: (a: Task, b: Task) => number
}) {
  const { open, setOpen } = useSharedSidebarSection(`section:${id}`)
  const rows = mergedThreads(useHostThreads(computers), threads).sort((a, b) => order(a.task, b.task))
  if (!rows.length) return null
  return (
    <section className="min-w-0">
      <SectionHead
        title={title}
        icon={icon}
        count={rows.length}
        open={open}
        onToggle={() => setOpen(!open)}
        controls={`all-hosts-${id}`}
      />
      <Collapse open={open} id={`all-hosts-${id}`} className="flex flex-col gap-0.5">
        {rows.map(({ task, source }) => (
          <MergedRow key={`${source.host}:${task.id}`} task={task} source={source} />
        ))}
      </Collapse>
    </section>
  )
}

/** What is blocked on the person leads the sidebar, so they need not scan every host for it. */
function NeedsYou({ computers }: { computers: Computer[] }) {
  return (
    <MergedSection
      computers={computers}
      id="needs-you"
      title={t('Needs you')}
      icon={CircleAlert}
      threads={(source) => source.active.filter(threadNeedsYou)}
      order={(a, b) => b.lastActiveAt - a.lastActiveAt}
    />
  )
}

/** Finished work is one list across hosts, so it does not interrupt each host's projects. */
function MergedDone({ computers }: { computers: Computer[] }) {
  return (
    <MergedSection
      computers={computers}
      id="done"
      title={t('Done')}
      icon={CheckCheck}
      threads={(source) => source.done}
      order={(a, b) => b.doneAt! - a.doneAt!}
    />
  )
}
