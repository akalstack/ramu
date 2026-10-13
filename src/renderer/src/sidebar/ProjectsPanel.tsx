import { ExpandRow } from '@/components/expand-row'
import { t, useLanguage } from './../i18n'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, MessageCircle, FolderClosed, FolderOpen, FolderPlus, FolderSearch, GitBranch, Link2, Pencil, Pin, PinOff, Plus, Sparkles, SquarePen, Trash2, Unlink, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { NO_PROJECT, type Project, type Task } from '../../../shared/types'
import { copyText, invoke } from '../ipc'
import { Dialog, useContextMenu, timeAgo, type MenuEntry } from '../Menu'
import { errorText } from '../TaskPane'
import { notifyError } from '../Notifications'
import { projectCtx, useWorkspace } from '../workspace'
import { useAppSettings } from '../AppSettings'
import { useAddProject } from '../addProject'
import { FadeText } from '../FadeText'
import { slide } from '../slide'
import { useModelSets } from '../ModelSets'

export function ProjectsPanel() {
  useLanguage()
  const ws = useWorkspace()
  const addProject = useAddProject()
  const [showArchived, setShowArchived] = useState(false)
  const [clearingArchived, setClearingArchived] = useState(false)
  const [clearBusy, setClearBusy] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)
  const archivedChats = ws.tasks.filter((task) => task.status === 'archived').sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  // Pinned chats from every project gather in one section above the projects.
  const showPinned = ws.isExpanded('section:pinned'), showProjects = ws.isExpanded('section:projects'), showChats = ws.isExpanded('section:chats')
  const pinned = ws.tasks.filter((t) => t.pinnedAt && t.status !== 'archived').sort(pinnedFirst)
  const looseChats = ws.tasks.filter((t) => t.projectId === NO_PROJECT && t.status !== 'archived' && !t.pinnedAt).sort(pinnedFirst)
  const { preferences } = useAppSettings()
  // Relative labels keep aging even when no provider event re-renders the list.
  const [, setTimeTick] = useState(0)
  useEffect(() => {
    const timer = window.setInterval(() => setTimeTick((tick) => tick + 1), 30_000)
    return () => window.clearInterval(timer)
  }, [])
  // Recent mode: every chat in one list by activity, each led by its project's name.
  const recentMode = preferences.recentChatMode
  const latest = recentMode ? ws.tasks.filter((t) => t.status !== 'archived' && !t.pinnedAt).sort((a, b) => b.lastActiveAt - a.lastActiveAt) : []
  // Drag a project by its row to put it somewhere else in the list.
  const [dragging, setDragging] = useState<string | null>(null)
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null)
  const reorder = async (projectId: string, target: { id: string; after: boolean }) => {
    const ids = ws.projects.map((entry) => entry.id).filter((id) => id !== projectId)
    ids.splice(ids.indexOf(target.id) + (target.after ? 1 : 0), 0, projectId)
    try { await invoke('projects.reorder', ids); await ws.refresh() } catch (e) { notifyError(errorText(e), 'Projects') }
  }
  const dnd = { enabled: true, dragging, drop, setDragging, setDrop, reorder }
  // Dropping folders from Finder adds them as projects.
  const [folderOver, setFolderOver] = useState(false)
  const hasFiles = (event: React.DragEvent) => event.dataTransfer.types.includes('Files')

  return (
    <div className={`panel [&_>_.hint]:m-[8px_0_12px] [&_>_.hint]:p-[4px_8px] [&_>_.hint]:leading-[1.55] [&_>_.hint]:[overflow-wrap:anywhere] [&_:is(.scm-empty,_.empty-tasks)]:m-[8px_0] [&_:is(.scm-empty,_.empty-tasks)]:p-2 [&_:is(.scm-empty,_.empty-tasks)]:leading-[1.5] [&_:is(.scm-empty,_.empty-tasks)]:[overflow-wrap:anywhere] p-[2px_8px_16px] tasks-panel${folderOver ? ' folder-drop' : ''}`}
      onDragOver={(event) => {
        if (dragging && event.dataTransfer.types.includes(PROJECT_DRAG_TYPE) && !(event.target as HTMLElement).closest('.project-group')) {
          // Over the gaps, headings or empty space: snap to the nearest end of the list.
          const groups = [...event.currentTarget.querySelectorAll<HTMLElement>('.project-group')]
          const first = groups[0], last = groups.at(-1)
          if (first && last) {
            event.preventDefault()
            const before = event.clientY < first.getBoundingClientRect().top
            const target = { id: ws.projects[before ? 0 : ws.projects.length - 1]!.id, after: !before }
            if (drop?.id !== target.id || drop.after !== target.after) setDrop(target)
          }
          return
        }
        if (!hasFiles(event) || addProject.busy) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setFolderOver(true) }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFolderOver(false) }}
      onDrop={(event) => {
        if (dragging && drop && !event.defaultPrevented && event.dataTransfer.types.includes(PROJECT_DRAG_TYPE)) {
          event.preventDefault()
          const dragged = event.dataTransfer.getData(PROJECT_DRAG_TYPE), target = drop
          setDragging(null); setDrop(null)
          if (dragged && dragged !== target.id) void reorder(dragged, target)
          return
        }
        if (!hasFiles(event)) return; event.preventDefault(); setFolderOver(false); void addProject.addDropped([...event.dataTransfer.files]) }}>
      {pinned.length > 0 && <>
        <SectionHead title={t("Pinned")} open={showPinned} onToggle={() => ws.setExpanded('section:pinned', !showPinned)} controls="pinned-chats" />
        <Collapse open={showPinned} id="pinned-chats" className="task-list flex flex-col gap-0.5">
          {pinned.map((task) => <TaskRow key={task.id} task={task} hidePin projectName={ws.projects.find((project) => project.id === task.projectId)?.name} />)}
        </Collapse>
      </>}
      <SectionHead title={recentMode ? t("Recent chats") : t("Projects")} open={showProjects} onToggle={() => ws.setExpanded('section:projects', !showProjects)} controls="projects-list">
        <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={t("Add project")} title={t("Add project…")} disabled={addProject.busy} onClick={() => void addProject.add()}>
          <FolderPlus size={14} />
        </Button>
      </SectionHead>
      <Collapse open={showProjects} id="projects-list">
      {recentMode && <div className="flex flex-col gap-0.5">{latest.map((task) => <TaskRow key={task.id} task={task} projectName={ws.projects.find((project) => project.id === task.projectId)?.name} />)}</div>}
      {!recentMode && ws.projects.length === 0 && (
        <div className="add-project [&_.hint]:m-[6px_0_14px] [&_.hint]:leading-[1.55] p-[2px_8px_4px]">
          <p className="muted text-muted-foreground hint m-[4px_0_8px] text-control leading-[1.5]">{t("Choose a repository or a folder containing repositories.")}</p>
          <Button variant="secondary" className="bg-fill hover:bg-fill-hover add-project-btn [&:hover:not(:disabled)]:[background:var(--fill-hover)] w-full min-h-[30px] rounded-(--radius-s) bg-fill [border-color:transparent] text-foreground justify-start" disabled={addProject.busy} onClick={() => void addProject.add()}><FolderPlus size={14} /> {t(" Add project…")}</Button>
        </div>
      )}
      {!recentMode && ws.projects.map((p) => (
        <ProjectGroup key={p.id} project={p} dnd={dnd} />
      ))}
      </Collapse>
      {!recentMode && <>
      <SectionHead title={t("Chats")} open={showChats} onToggle={() => ws.setExpanded('section:chats', !showChats)} controls="loose-chats"><Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={t("New chat without a project")} onClick={() => ws.newTask(NO_PROJECT)}><Plus size={14} /></Button></SectionHead>
      <Collapse open={showChats} id="loose-chats" className="flex flex-col gap-0.5">{looseChats.map((t) => <TaskRow key={t.id} task={t} />)}</Collapse></>}
      {archivedChats.length > 0 && <>
      <SectionHead title={`${t('Archived')} · ${archivedChats.length}`} open={showArchived} onToggle={() => setShowArchived((shown) => !shown)} controls="archived-chats">
        <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact) opacity-0 [transition:opacity_0.12s] group-hover/head:opacity-100 group-focus-within/head:opacity-100" aria-label={t("Delete all archived chats")} title={t("Delete all archived chats")} onClick={() => { setClearError(null); setClearingArchived(true) }}><Trash2 size={14} /></Button>
      </SectionHead>
      {showArchived && <div id="archived-chats" className="task-list flex flex-col gap-0.5">
        {archivedChats.length === 0 && <p className="muted small empty-tasks">{t('No archived chats')}</p>}
        {archivedChats.map((task) => <TaskRow key={task.id} task={task} projectName={ws.projects.find((project) => project.id === task.projectId)?.name} />)}
      </div>}
      </>}
      {clearingArchived && <Dialog title={t("Delete {0} archived chats?", { "0": archivedChats.length })} confirmLabel={t("Delete all")} danger busy={clearBusy} error={clearError} onCancel={() => { setClearingArchived(false); setClearError(null) }} onConfirm={async () => {
        setClearBusy(true); setClearError(null)
        try {
          for (const task of archivedChats) { await invoke('tasks.delete', task.id, false); ws.forgetTask(task.id) }
          await ws.refresh()
          setClearingArchived(false)
        } catch (e) { setClearError(errorText(e)); await ws.refresh() } finally { setClearBusy(false) }
      }}>
        <p>{t("This removes every archived chat and its agent transcripts. This can't be undone.")}</p>
        <p className="muted text-muted-foreground">{t("Worktrees and branches are kept.")}</p>
      </Dialog>}
    </div>
  )
}

/** Mounts its children while open and while the slide-closed animation runs. */
function Collapse({ open, id, className, children }: { open: boolean; id?: string; className?: string; children: React.ReactNode }) {
  const [mounted, setMounted] = useState(open)
  const el = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(open)
  const opening = useRef(false)
  useLayoutEffect(() => {
    if (wasOpen.current === open) return
    wasOpen.current = open
    if (open) {
      if (el.current) slide(el.current, true)
      else { opening.current = true; setMounted(true) }
    } else if (el.current) slide(el.current, false, () => setMounted(false))
    else setMounted(false)
  }, [open])
  useLayoutEffect(() => {
    if (mounted && opening.current && el.current) { opening.current = false; slide(el.current, true) }
  }, [mounted])
  return open || mounted ? <div ref={el} id={id} className={className}>{children}</div> : null
}

/** A sidebar section title that folds its list; the chevron shows on hover only, with no hover background. */
function SectionHead({ title, open, onToggle, controls, children }: { title: string; open: boolean; onToggle: () => void; controls: string; children?: React.ReactNode }) {
  return <div className="section-head group/head flex items-center justify-between text-body text-muted-foreground p-[3px_8px]">
    <button type="button" className="inline-flex items-center gap-1 bg-transparent p-0 [border:0] text-inherit cursor-default hover:text-foreground focus-visible:text-foreground" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      <span>{title}</span>
      <ChevronDown size={13} className={`flex-none opacity-0 [transition:opacity_0.12s,transform_0.15s_var(--ease)] group-hover/head:opacity-100 group-focus-within/head:opacity-100 ${open ? '' : '[transform:rotate(-90deg)]'}`} />
    </button>
    {children}
  </div>
}

/** Pinned chats lead their list (most recently pinned first); the rest follow by recent activity. */
const pinnedFirst = (a: Task, b: Task) => (a.pinnedAt ? 1 : 0) !== (b.pinnedAt ? 1 : 0) ? (b.pinnedAt ? 1 : 0) - (a.pinnedAt ? 1 : 0) : a.pinnedAt && b.pinnedAt ? b.pinnedAt - a.pinnedAt : b.lastActiveAt - a.lastActiveAt

const PROJECT_DRAG_TYPE = 'application/x-ramu-project'

type ProjectDnd = { enabled: boolean; dragging: string | null; drop: { id: string; after: boolean } | null; setDragging: (id: string | null) => void; setDrop: (target: { id: string; after: boolean } | null) => void; reorder: (projectId: string, target: { id: string; after: boolean }) => Promise<void> }

/** Details for a project, shown to the right of the sidebar after a short hover; it stays open while the pointer is on it. */
function ProjectHoverCard({ project, folders, chats }: { project: Project; folders: { id: string; name: string; root: string }[]; chats: number }) {
  useLanguage()
  return <HoverCardContent side="right" align="start" sideOffset={6} alignOffset={-4} className="project-hover-card relative z-1200 w-[320px] max-w-[calc(100vw_-_24px)] p-1.5 [border:1px_solid_var(--edge)] rounded-(--radius-m) [background:color-mix(in_srgb,_var(--raised)_94%,_transparent)] [backdrop-filter:blur(14px)] [box-shadow:0_10px_32px_rgba(0,_0,_0,_0.45)] text-control [animation:fade-only_0.12s_ease-out]">
    <div className="phc-title [&_strong]:font-semibold [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap [&_svg]:flex-none [&_svg]:text-muted-foreground flex items-center gap-[9px] min-h-[26px] p-[0_8px]"><FolderClosed size={15} /><strong>{project.name}</strong></div>
    <div className="phc-line [&_svg]:flex-none [&_svg]:text-muted-foreground flex items-center gap-[9px] min-h-[26px] p-[0_8px] muted text-muted-foreground"><MessageCircle size={14} />{chats} {chats === 1 ? t("chat") : t("chats")}</div>
    <div className="phc-sep h-px m-[5px_2px] [background:var(--line)]" />
    {(folders.length ? folders.map((f) => ({ key: f.id, name: f.name, root: f.root })) : project.root ? [{ key: 'root', name: project.name, root: project.root }] : []).map((f) => <div key={f.key} className="phc-folder flex items-center gap-[9px] min-h-[26px] p-[0_8px] [&_svg]:flex-none [&_svg]:text-muted-foreground [&_span]:[overflow-wrap:anywhere] [&_span]:leading-[1.4] [&_span]:text-caption items-start pt-[5px] pb-[5px] text-soft" title={f.root}><FolderClosed size={14} /><span>{f.root}</span></div>)}
  </HoverCardContent>
}

function ProjectGroup({ project, dnd }: { project: Project; dnd: ProjectDnd }) {
  useLanguage()
  const ws = useWorkspace()
  const repos = ws.repos[project.id] ?? []
  const { preferences } = useAppSettings()
  const recent = preferences.recentChats
  const all = ws.tasks.filter((t) => t.projectId === project.id)
  const sorted = all.filter((t) => t.status !== 'archived' && !t.pinnedAt).sort(pinnedFirst)
  const others = sorted.filter((t) => !t.pinnedAt)
  const [showAll, setShowAll] = useState(false)
  // Like Codex: the latest few chats, with the rest behind "Show more"; the open chat always shows.
  const tasks = showAll ? sorted : sorted.filter((t) => t.pinnedAt || others.indexOf(t) < recent || t.id === ws.ui.activeTaskId)
  const archived = all.filter((t) => t.status === 'archived')
  const open = ws.isExpanded(`project:${project.id}`)
  const setOpen = (next: boolean | ((current: boolean) => boolean)) => ws.setExpanded(`project:${project.id}`, typeof next === 'function' ? next(open) : next)
  // The chat list stays mounted while it slides closed, and slides open once it is mounted.
  const [mounted, setMounted] = useState(open)
  const list = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(open)
  const opening = useRef(false)
  useLayoutEffect(() => {
    if (wasOpen.current === open) return
    wasOpen.current = open
    if (open) {
      if (list.current) slide(list.current, true)
      else { opening.current = true; setMounted(true) }
    } else if (list.current) slide(list.current, false, () => setMounted(false))
    else setMounted(false)
  }, [open])
  useLayoutEffect(() => {
    if (mounted && opening.current && list.current) { opening.current = false; slide(list.current, true) }
  }, [mounted])
  const [showArchived, setShowArchived] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState(false)
  const active = ws.ui.activeTaskId === projectCtx(project.id) && !ws.composing
  const connect = async () => {
    setError(null)
    try {
      const dir = await invoke('repos.pick', 'repository')
      if (!dir) return
      await invoke('repos.add', project.id, dir)
      await ws.refresh()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      await ws.refresh()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const items: MenuEntry[] = [
    { key: 'new', label: <><SquarePen size={14} /> {t(" New chat")}</>, onSelect: () => ws.newTask(project.id) },
    { key: 'rename', label: <><Pencil size={14} /> {t(" Rename")}</>, onSelect: () => setRenaming(true) },
    { key: 'sep1', separator: true },
    { key: 'connect', label: <><Link2 size={14} /> {t(" Connect a repository…")}</>, onSelect: () => void connect() },
    { key: 'reveal', label: <><FolderSearch size={14} /> {t(" Reveal in Finder")}</>, onSelect: () => void act(() => invoke('projects.reveal', project.id)) },
    ...(repos.length > 1
      ? [
          { key: 'repos', label: <><GitBranch size={14} /> {t(" Repositories")}</>, submenu: repos.map((r) => ({
            key: r.id,
            label: <><span className="menu-label [.chat-switch-menu_&]:flex-1 [.chat-switch-menu_&]:max-w-[none] [.chat-switch-menu_&]:leading-[18px] [.chat-switch-menu_&]:font-medium [.chat-switch-menu_&]:min-w-0 [.dropdown-menu_&]:min-w-0 [.dropdown-menu_&]:max-w-[none] [.dropdown-menu_&]:whitespace-nowrap [.project-switch-menu_&]:max-w-[none] [.project-switch-menu_&]:leading-[18px] [.project-switch-menu_&]:font-medium [.project-switch-menu_&]:min-w-0 [.project-switch-menu_&_.block]:max-w-[none] [.project-switch-menu_&_.block]:overflow-hidden [.project-switch-menu_&_.block]:text-ellipsis [.project-switch-menu_&_.block]:whitespace-nowrap [.project-switch-menu_&_.block]:m-[2px_0_0] [.project-switch-menu_&_.block]:text-caption [.project-switch-menu_&_.block]:leading-[16px] [.project-switch-menu_&_.block]:font-normal [.project-switch-menu_&_.block]:text-muted-foreground [.chat-switch-menu_&_.block]:overflow-hidden [.chat-switch-menu_&_.block]:text-ellipsis [.chat-switch-menu_&_.block]:whitespace-nowrap [.chat-switch-menu_&_.block]:m-[2px_0_0] [.chat-switch-menu_&_.block]:text-caption [.chat-switch-menu_&_.block]:leading-[16px] [.chat-switch-menu_&_.block]:font-normal [.chat-switch-menu_&_.block]:text-muted-foreground max-w-[220px] overflow-hidden text-ellipsis">{r.name}</span><span className="muted text-muted-foreground">{t("Disconnect")}</span></>,
            onSelect: () => void act(() => invoke('repos.remove', r.id)),
          })) } as MenuEntry,
        ]
      : []),
    { key: 'sep2', separator: true },
    {
      key: 'archive',
      label: <><Archive size={14} /> {t(" Archive chats")}</>,
      disabled: tasks.length === 0,
      onSelect: () => void act(async () => { for (const t of tasks) { await invoke('tasks.archive', t.id, true); ws.forgetTask(t.id) } }),
    },
    { key: 'sep3', separator: true },
    { key: 'remove', label: <><X size={14} /> {t(" Remove project")}</>, onSelect: () => void act(() => invoke('projects.remove', project.id)) },
  ]

  const contextMenu = useContextMenu(`${project.name} actions`, items)

  return (
    <section
      className={`project-group [&.dragging]:[opacity:0.45] [&.drop-before::before]:[content:''] [&.drop-before::before]:absolute [&.drop-before::before]:left-1.5 [&.drop-before::before]:right-1.5 [&.drop-before::before]:h-0.5 [&.drop-before::before]:[border-radius:1px] [&.drop-before::before]:[background:var(--accent)] [&.drop-before::before]:pointer-events-none [&.drop-before::before]:z-2 [&.drop-before::before]:top-[-2px] [&.drop-after::after]:[content:''] [&.drop-after::after]:absolute [&.drop-after::after]:left-1.5 [&.drop-after::after]:right-1.5 [&.drop-after::after]:h-0.5 [&.drop-after::after]:[border-radius:1px] [&.drop-after::after]:[background:var(--accent)] [&.drop-after::after]:pointer-events-none [&.drop-after::after]:z-2 [&.drop-after::after]:bottom-[-2px] mb-0 [&:has(.task-list)]:mb-2.5 relative${dnd.dragging === project.id ? ' dragging' : ''}${dnd.drop?.id === project.id && dnd.dragging !== project.id ? dnd.drop.after ? ' drop-after' : ' drop-before' : ''}`}
      onDragOver={(event) => {
        if (!dnd.enabled || !dnd.dragging || dnd.dragging === project.id || !event.dataTransfer.types.includes(PROJECT_DRAG_TYPE)) return
        event.preventDefault()
        // Half of the project's own row decides, so the whole row works and not just the chats below it.
        const box = (event.currentTarget.querySelector('[draggable="true"]') ?? event.currentTarget).getBoundingClientRect()
        const after = event.clientY > box.top + box.height / 2
        if (dnd.drop?.id !== project.id || dnd.drop.after !== after) dnd.setDrop({ id: project.id, after })
      }}
      onDrop={(event) => {
        const dragged = event.dataTransfer.getData(PROJECT_DRAG_TYPE)
        if (!dragged || !dnd.drop) return
        event.preventDefault()
        const target = dnd.drop
        dnd.setDragging(null); dnd.setDrop(null)
        if (dragged !== target.id) void dnd.reorder(dragged, target)
      }}
    >
      {contextMenu.menu}
      <HoverCard open={hover && !renaming && !dnd.dragging} onOpenChange={setHover}>
      <HoverCardTrigger delay={150} closeDelay={120} render={<div />}
        draggable={dnd.enabled && !renaming}
        onDragStart={(event) => { event.dataTransfer.setData(PROJECT_DRAG_TYPE, project.id); event.dataTransfer.effectAllowed = 'move'; dnd.setDragging(project.id) }}
        onDragEnd={() => { dnd.setDragging(null); dnd.setDrop(null) }}
        className={active ? 'project-row [&:hover]:bg-accent [&:hover]:text-foreground [&:hover_.row-actions]:opacity-100 [&.active]:bg-accent [&.active]:text-foreground [&_.row-actions]:gap-0.5 [&_.row-actions]:mr-0 [&_.caret]:[transition:transform_0.15s_var(--ease)] [transition:background-color_140ms_ease,_color_140ms_ease] flex items-center gap-2 rounded-(--radius-s) cursor-default text-soft text-body leading-5 min-h-[30px] p-[0_8px] active' : 'project-row [&:hover]:bg-accent [&:hover]:text-foreground [&:hover_.row-actions]:opacity-100 [&.active]:bg-accent [&.active]:text-foreground [&_.row-actions]:gap-0.5 [&_.row-actions]:mr-0 [&_.caret]:[transition:transform_0.15s_var(--ease)] [transition:background-color_140ms_ease,_color_140ms_ease] flex items-center gap-2 rounded-(--radius-s) cursor-default text-soft text-body leading-5 min-h-[30px] p-[0_8px]'}
        role="button"
        tabIndex={0}
        aria-label={t("Open {0}", { "0": project.name })}
        onContextMenu={contextMenu.onContextMenu}
        onClick={() => {
          setOpen(true)
          ws.openProject(project.id)
        }}
        onKeyDown={(e) => { contextMenu.onKeyDown(e); if (e.key === 'Enter') ws.openProject(project.id) }}
        onMouseDown={() => setHover(false)}
      >
        {open ? <FolderOpen size={15} className="muted text-muted-foreground" /> : <FolderClosed size={15} className="muted text-muted-foreground" />}
        {renaming ? (
          <InlineEdit
            value={project.name}
            onDone={(v) => {
              setRenaming(false)
              if (v && v !== project.name) void act(() => invoke('projects.rename', project.id, v))
            }}
          />
        ) : (
          <FadeText className="project-name font-normal overflow-hidden whitespace-nowrap flex-1 min-w-0" text={project.name} />
        )}
        <span className="row-actions [&:has([aria-expanded='true'])]:opacity-100 flex items-center gap-0.5 opacity-0 [transition:opacity_0.1s] flex-none">
          <Button variant="ghost" size="icon-xs"
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
            aria-label={t("Toggle {0}", { "0": project.name })}
            title={open ? t("Collapse") : t("Expand")}
            onClick={(e) => {
              e.stopPropagation()
              setOpen((o) => !o)
            }}
          >
            <ChevronRight size={14} className={open ? 'caret [&.open]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)] open' : 'caret [&.open]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]'} />
          </Button>
          <Button variant="ghost" size="icon-xs"
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
            aria-label={t("New chat in {0}", { "0": project.name })}
            title={t("New chat")}
            onClick={(e) => {
              e.stopPropagation()
              ws.newTask(project.id)
            }}
          >
            <Plus size={14} />
          </Button>
        </span>
      </HoverCardTrigger>
      <ProjectHoverCard project={project} folders={repos.map((r) => ({ id: r.id, name: r.name, root: r.root }))} chats={all.filter((t) => t.status !== 'archived').length} />
      </HoverCard>
      {error && <div className="error text-bad small text-caption row-error p-[1px_10px_2px_26px]">{error}</div>}
      {(open || mounted) && (
        <div ref={list} className="task-list flex flex-col gap-0.5 pl-[22px] pt-0.5">
          {tasks.length === 0 && <div className="muted text-muted-foreground small text-caption empty-tasks p-[2px_10px]">{t("No chats yet")}</div>}
          {tasks.map((t) => <TaskRow key={t.id} task={t} />)}
          {others.length > recent && (
            <ExpandRow expanded={showAll} onToggle={() => setShowAll((s) => !s)} className="h-[30px] min-h-[30px] px-2 text-body leading-5">
              {showAll ? t("Show less") : t("Show more")}
            </ExpandRow>
          )}
          {archived.length > 0 && (
            <>
              <Button variant="secondary" className="bg-fill hover:bg-fill-hover archived-toggle [&:hover:not(:disabled)]:bg-transparent [&:hover:not(:disabled)]:[border:none] [&:hover:not(:disabled)]:text-soft bg-transparent [border:none] text-muted-foreground text-caption p-[2px_10px] gap-1 justify-start" onClick={() => setShowArchived((s) => !s)}>
                <ChevronRight size={12} className={showArchived ? 'caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot=\'collapsible-trigger\']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot=\'collapsible-trigger\']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)] open' : 'caret [&.open]:[transform:rotate(90deg)] [:is(.tool-group,_.tool)_>_[data-slot=\'collapsible-trigger\']:is(:hover,_:focus-visible)_&]:opacity-100 [:is(.tool-group,_.tool)[data-open]_>_[data-slot=\'collapsible-trigger\']_>_&]:[transform:rotate(90deg)] text-muted-foreground flex-none [transition:transform_0.15s_var(--ease)]'} /> {t(" Archived (")}{archived.length})
              </Button>
              {showArchived && archived.map((t) => <TaskRow key={t.id} task={t} />)}
            </>
          )}
        </div>
      )}
    </section>
  )
}

function TaskRow({ task, projectName, hidePin }: { task: Task; projectName?: string; hidePin?: boolean }) {
  useLanguage()
  const ws = useWorkspace()
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const sharedWorktree = !!task.workspaceId && ws.tasks.some((t) => t.id !== task.id && t.workspaceId === task.workspaceId)
  const [removeWorktrees, setRemoveWorktrees] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const active = ws.ui.activeTaskId === task.id && !ws.composing
  const archived = task.status === 'archived'
  const { initialSettings } = useModelSets()
  const [naming, setNaming] = useState(false)

  const run = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      await ws.refresh()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const items: MenuEntry[] = [
    { key: 'copy-id', label: t("Copy chat ID"), onSelect: () => void copyText(task.id).catch((reason) => notifyError(errorText(reason), 'Copy chat ID')) },
    { key: 'rename', label: <><Pencil size={14} /> {t(" Rename")}</>, onSelect: () => setRenaming(true) },
    { key: 'pin', label: <>{task.pinnedAt ? <PinOff size={14} /> : <Pin size={14} />} {task.pinnedAt ? t("Unpin") : t("Pin")}</>, onSelect: () => void run(() => invoke('tasks.pin', task.id, !task.pinnedAt)) },
    { key: 'rename-ai', label: <><Sparkles size={14} /> {t(" Rename with AI")}</>, disabled: naming, onSelect: () => { setNaming(true); void run(() => invoke('tasks.generateTitle', task.id, initialSettings, true)).finally(() => setNaming(false)) } },
    archived
      ? { key: 'unarchive', label: <><ArchiveRestore size={14} /> {t(" Unarchive")}</>, onSelect: () => void run(() => invoke('tasks.archive', task.id, false)) }
      : {
          key: 'archive',
          label: <><Archive size={14} /> {t(" Archive")}</>,
          onSelect: () =>
            void run(async () => {
              await invoke('tasks.archive', task.id, true)
              ws.forgetTask(task.id)
            }),
        },
    { key: 'sep', separator: true },
    { key: 'delete', label: <><Trash2 size={14} /> {t(" Delete…")}</>, danger: true, onSelect: () => setDeleting(true) },
  ]

  const contextMenu = useContextMenu(`${task.title} actions`, items)

  return (
    <>
      <div
        onContextMenu={contextMenu.onContextMenu}
        className={`task-row [&:hover_.row-actions]:opacity-100 [&:hover_.row-actions]:flex [&:focus-within_.row-actions]:opacity-100 [&:focus-within_.row-actions]:flex [&:hover]:bg-accent [&:hover]:text-foreground [&.active]:text-foreground [&.active]:bg-accent [&.active]:[box-shadow:none] [&.archived]:[opacity:0.6] [&:hover_.task-time]:hidden [&:hover_.task-pin]:hidden [&:focus-within_.task-pin]:hidden [&:focus-within_.task-time]:hidden [&_.row-actions]:hidden [&_.row-actions]:mr-0 [&_.row-actions:has([aria-expanded='true'])]:flex [&_>_:not(.task-title)]:mt-0 [&_.task-actions]:hidden [&_.task-actions]:opacity-100 [&_.task-actions]:gap-0.5 [&:hover_.task-actions]:flex [&:focus-within_.task-actions]:flex [&:hover_.task-state]:hidden [&:focus-within_.task-state]:hidden [transition:background-color_140ms_ease,_color_140ms_ease] [&:has(.task-project)]:gap-1 flex items-center gap-2 text-soft cursor-default [transition:background_0.1s_var(--ease),_color_0.1s_var(--ease)] text-body leading-5 min-h-[30px] rounded-(--radius-s) p-[0_8px] ${active ? ' active' : ''}${archived ? ' archived' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => !renaming && ws.openTask(task.id)}
        onDoubleClick={() => setRenaming(true)}
        onKeyDown={(e) => { contextMenu.onKeyDown(e); if (e.key === 'Enter' && !renaming) ws.openTask(task.id) }}
      >
        {renaming ? (
          <InlineEdit
            value={task.title}
            onDone={(v) => {
              setRenaming(false)
              if (v && v !== task.title) void run(() => invoke('tasks.rename', task.id, v))
            }}
          />
        ) : (
          <>{projectName && <span className="task-project [&::after]:[content:'·'] [&::after]:ml-1 flex-none max-w-[40%] overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground font-medium">{projectName}</span>}<FadeText className="grow flex-1 min-w-0 text-left task-title overflow-hidden whitespace-nowrap" text={task.title} /></>
        )}
        {task.pinnedAt && !archived && !hidePin && <Pin size={12} className="task-pin muted text-muted-foreground mode-icon flex-none" aria-label={t("Pinned")} />}
        {naming && <Sparkles size={12} className="muted text-muted-foreground mode-icon flex-none" aria-label={t("Naming chat")} />}
        {task.mode === 'worktree' && <span title={ws.workspaces.find((w) => w.id === task.workspaceId)?.name ?? t("Isolated worktrees")}><GitBranch size={12} className="muted text-muted-foreground mode-icon flex-none" aria-label={t("Isolated worktrees")} /></span>}
        <span className="row-actions [&:has([aria-expanded='true'])]:opacity-100 flex items-center gap-0.5 opacity-0 [transition:opacity_0.1s] flex-none task-actions">
          {!archived && <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={task.pinnedAt ? t("Unpin chat") : t("Pin chat")} title={task.pinnedAt ? t("Unpin") : t("Pin")} onClick={(e) => { e.stopPropagation(); void run(() => invoke('tasks.pin', task.id, !task.pinnedAt)) }}>{task.pinnedAt ? <PinOff size={14} /> : <Pin size={14} />}</Button>}
          <Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" aria-label={archived ? t("Unarchive chat") : t("Archive chat")} title={archived ? t("Unarchive") : t("Archive")} onClick={(e) => { e.stopPropagation(); void run(async () => { await invoke('tasks.archive', task.id, !archived); if (!archived) ws.forgetTask(task.id) }) }}>{archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}</Button>
        </span>
        {task.status === 'running' ? <span className="task-state [&.spinner::before]:[content:''] [&.spinner::before]:w-3 [&.spinner::before]:h-3 [&.spinner::before]:[box-sizing:border-box] [&.spinner::before]:rounded-full [&.spinner::before]:[border:2px_solid_var(--line-strong)] [&.spinner::before]:[border-top-color:var(--soft)]! [&.spinner::before]:[animation:spin_0.9s_linear_infinite] [&.dot::before]:[content:''] [&.dot::before]:w-2 [&.dot::before]:h-2 [&.dot::before]:rounded-full [&.dot::before]:[background:var(--muted)] [&.unread::before]:[background:var(--accent)] [&.warn::before]:[background:var(--warn)] [&.bad::before]:[background:var(--bad)] w-3.5 h-3.5 flex-none inline-flex items-center justify-center mr-1 spinner" role="img" aria-label={t("Agent working")} title={t("Agent working")} />
          : task.status === 'needs-input' ? <span className="task-state [&.spinner::before]:[content:''] [&.spinner::before]:w-3 [&.spinner::before]:h-3 [&.spinner::before]:[box-sizing:border-box] [&.spinner::before]:rounded-full [&.spinner::before]:[border:2px_solid_var(--line-strong)] [&.spinner::before]:[border-top-color:var(--soft)]! [&.spinner::before]:[animation:spin_0.9s_linear_infinite] [&.dot::before]:[content:''] [&.dot::before]:w-2 [&.dot::before]:h-2 [&.dot::before]:rounded-full [&.dot::before]:[background:var(--muted)] [&.unread::before]:[background:var(--accent)] [&.warn::before]:[background:var(--warn)] [&.bad::before]:[background:var(--bad)] w-3.5 h-3.5 flex-none inline-flex items-center justify-center mr-1 dot warn text-warn" role="img" aria-label={t("Waiting for your input")} title={t("Waiting for your input")} />
          : task.status === 'failed' ? <span className="task-state [&.spinner::before]:[content:''] [&.spinner::before]:w-3 [&.spinner::before]:h-3 [&.spinner::before]:[box-sizing:border-box] [&.spinner::before]:rounded-full [&.spinner::before]:[border:2px_solid_var(--line-strong)] [&.spinner::before]:[border-top-color:var(--soft)]! [&.spinner::before]:[animation:spin_0.9s_linear_infinite] [&.dot::before]:[content:''] [&.dot::before]:w-2 [&.dot::before]:h-2 [&.dot::before]:rounded-full [&.dot::before]:[background:var(--muted)] [&.unread::before]:[background:var(--accent)] [&.warn::before]:[background:var(--warn)] [&.bad::before]:[background:var(--bad)] w-3.5 h-3.5 flex-none inline-flex items-center justify-center mr-1 dot bad" role="img" aria-label={t("Agent failed")} title={t("Agent failed")} />
          : ws.unread.has(task.id) ? <span className="task-state [&.spinner::before]:[content:''] [&.spinner::before]:w-3 [&.spinner::before]:h-3 [&.spinner::before]:[box-sizing:border-box] [&.spinner::before]:rounded-full [&.spinner::before]:[border:2px_solid_var(--line-strong)] [&.spinner::before]:[border-top-color:var(--soft)]! [&.spinner::before]:[animation:spin_0.9s_linear_infinite] [&.dot::before]:[content:''] [&.dot::before]:w-2 [&.dot::before]:h-2 [&.dot::before]:rounded-full [&.dot::before]:[background:var(--muted)] [&.unread::before]:[background:var(--accent)] [&.warn::before]:[background:var(--warn)] [&.bad::before]:[background:var(--bad)] w-3.5 h-3.5 flex-none inline-flex items-center justify-center mr-1 dot unread" role="img" aria-label={t("Finished, not viewed yet")} title={t("Finished, not viewed yet")} />
          : <span className="task-time text-caption text-muted-foreground flex-none tabular-nums min-w-6 text-right">{timeAgo(task.lastActiveAt)}</span>}

      </div>
      {contextMenu.menu}
      {error && !deleting && <div className="error text-bad small text-caption row-error p-[1px_10px_2px_26px]">{error}</div>}
      {deleting && (
        <Dialog
          title={t("Delete “{0}”?", { "0": task.title })}
          confirmLabel={t("Delete chat")}
          danger
          busy={busy}
          error={error}
          onCancel={() => {
            setDeleting(false)
            setError(null)
          }}
          onConfirm={async () => {
            setBusy(true)
            setError(null)
            try {
              await invoke('tasks.delete', task.id, task.mode === 'worktree' && !sharedWorktree && removeWorktrees)
              ws.forgetTask(task.id)
              await ws.refresh()
              setDeleting(false)
            } catch (e) {
              setError(errorText(e))
            } finally {
              setBusy(false)
            }
          }}
        >
          <p>{t("This removes the chat and its agent transcripts. Its running agents are stopped.")}</p>
          {task.mode === 'worktree' && !sharedWorktree ? (
            <label>
              <Checkbox checked={removeWorktrees} onCheckedChange={(checked) => setRemoveWorktrees(checked === true)} />
              <span>
                {t("Also remove its worktrees")}<span className="muted text-muted-foreground block block">{t("Only if they have no uncommitted changes. Branches are kept.")}</span>
              </span>
            </label>
          ) : (
            <p className="muted text-muted-foreground">{t("Shared files, terminals, worktrees, and other chats stay open.")}</p>
          )}
        </Dialog>
      )}
    </>
  )
}

function InlineEdit({ value, onDone }: { value: string; onDone: (v: string | null) => void }) {
  useLanguage()
  const [v, setV] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.select(), [])
  return (
    <Input
      ref={ref}
      className="inline-edit flex-1 min-w-0 p-[2px_6px] [font:inherit] bg-canvas [border-color:var(--line-strong)]"
      aria-label={t("Name")}
      maxLength={200}
      value={v}
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => onDone(v.trim() || null)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') onDone(v.trim() || null)
        if (e.key === 'Escape') onDone(null)
      }}
    />
  )
}

