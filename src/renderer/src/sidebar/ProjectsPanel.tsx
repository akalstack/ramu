import { t, useLanguage } from './../i18n'
import { Checkbox } from '@/components/ui/checkbox'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Archive, ArchiveRestore, ChevronRight, MessageCircle, FolderClosed, FolderOpen, FolderPlus, FolderSearch, GitBranch, Link2, Pencil, Pin, PinOff, Plus, Sparkles, SquarePen, Trash2, Unlink, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { NO_PROJECT, type Project, type Task } from '../../../shared/types'
import { invoke } from '../ipc'
import { Dialog, useContextMenu, timeAgo, type MenuEntry } from '../Menu'
import { errorText } from '../TaskPane'
import { notifyError } from '../Notifications'
import { projectCtx, useWorkspace } from '../workspace'
import { useAppSettings } from '../AppSettings'
import { useAddProject } from '../addProject'
import { FadeText } from '../FadeText'
import { useModelSets } from '../ModelSets'

export function ProjectsPanel() {
  useLanguage()
  const ws = useWorkspace()
  const addProject = useAddProject()
  const looseChats = ws.tasks.filter((t) => t.projectId === NO_PROJECT && t.status !== 'archived').sort(pinnedFirst)
  const { preferences } = useAppSettings()
  // The latest chats across every project, each led by its project's name.
  const latest = preferences.showRecentChats ? ws.tasks.filter((t) => t.status !== 'archived').sort((a, b) => b.lastActiveAt - a.lastActiveAt).slice(0, 5) : []
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
    <div className={`panel tasks-panel${folderOver ? ' folder-drop' : ''}`}
      onDragOver={(event) => { if (!hasFiles(event) || addProject.busy) return; event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setFolderOver(true) }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFolderOver(false) }}
      onDrop={(event) => { if (!hasFiles(event)) return; event.preventDefault(); setFolderOver(false); void addProject.addDropped([...event.dataTransfer.files]) }}>
      {latest.length > 0 && <>
        <div className="section-head"><span>{t("Recent chats")}</span></div>
        {latest.map((task) => <TaskRow key={task.id} task={task} projectName={ws.projects.find((project) => project.id === task.projectId)?.name} />)}
      </>}
      <div className="section-head">
        <span>{t("Projects")}</span>
        <Button className="ghost icon small-icon" aria-label={t("Add project")} title={t("Add project…")} disabled={addProject.busy} onClick={() => void addProject.add()}>
          <FolderPlus size={14} />
        </Button>
      </div>
      {ws.projects.length === 0 && (
        <div className="add-project">
          <p className="muted hint">{t("Pick a repository, or a folder that holds several repositories. Ramu groups them into one workspace.")}</p>
          <Button className="add-project-btn" disabled={addProject.busy} onClick={() => void addProject.add()}><FolderPlus size={14} /> {t(" Add project…")}</Button>
        </div>
      )}
      {ws.projects.map((p) => (
        <ProjectGroup key={p.id} project={p} dnd={dnd} />
      ))}
      <div className="section-head"><span>{t("Chats")}</span><Button className="ghost icon small-icon" aria-label={t("New chat without a project")} onClick={() => ws.newTask(NO_PROJECT)}><Plus size={14} /></Button></div>
      {looseChats.map((t) => <TaskRow key={t.id} task={t} />)}
    </div>
  )
}

/** Pinned chats lead their list (most recently pinned first); the rest follow by recent activity. */
const pinnedFirst = (a: Task, b: Task) => (a.pinnedAt ? 1 : 0) !== (b.pinnedAt ? 1 : 0) ? (b.pinnedAt ? 1 : 0) - (a.pinnedAt ? 1 : 0) : a.pinnedAt && b.pinnedAt ? b.pinnedAt - a.pinnedAt : b.lastActiveAt - a.lastActiveAt

const PROJECT_DRAG_TYPE = 'application/x-ramu-project'

type ProjectDnd = { enabled: boolean; dragging: string | null; drop: { id: string; after: boolean } | null; setDragging: (id: string | null) => void; setDrop: (target: { id: string; after: boolean } | null) => void; reorder: (projectId: string, target: { id: string; after: boolean }) => Promise<void> }

/** Details for a project, shown to the right of the sidebar after a short hover; it stays open while the pointer is on it. */
function ProjectHoverCard({ project, folders, chats }: { project: Project; folders: { id: string; name: string; root: string }[]; chats: number }) {
  useLanguage()
  return <HoverCardContent side="right" align="start" sideOffset={6} alignOffset={-4} className="project-hover-card">
    <div className="phc-title"><FolderClosed size={15} /><strong>{project.name}</strong></div>
    <div className="phc-line muted"><MessageCircle size={14} />{chats} {chats === 1 ? t("chat") : t("chats")}</div>
    <div className="phc-sep" />
    {(folders.length ? folders.map((f) => ({ key: f.id, name: f.name, root: f.root })) : project.root ? [{ key: 'root', name: project.name, root: project.root }] : []).map((f) => <div key={f.key} className="phc-folder" title={f.root}><FolderClosed size={14} /><span>{f.root}</span></div>)}
  </HoverCardContent>
}

function ProjectGroup({ project, dnd }: { project: Project; dnd: ProjectDnd }) {
  useLanguage()
  const ws = useWorkspace()
  const repos = ws.repos[project.id] ?? []
  const { preferences } = useAppSettings()
  const recent = preferences.recentChats
  const all = ws.tasks.filter((t) => t.projectId === project.id)
  const sorted = all.filter((t) => t.status !== 'archived').sort(pinnedFirst)
  const others = sorted.filter((t) => !t.pinnedAt)
  const [showAll, setShowAll] = useState(false)
  // Like Codex: the latest few chats, with the rest behind "Show more"; the open chat always shows.
  const tasks = showAll ? sorted : sorted.filter((t) => t.pinnedAt || others.indexOf(t) < recent || t.id === ws.ui.activeTaskId)
  const archived = all.filter((t) => t.status === 'archived')
  const [open, setOpen] = useState(true)
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
            label: <><span className="menu-label">{r.name}</span><span className="muted">{t("Disconnect")}</span></>,
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
      className={`project-group${dnd.dragging === project.id ? ' dragging' : ''}${dnd.drop?.id === project.id && dnd.dragging !== project.id ? dnd.drop.after ? ' drop-after' : ' drop-before' : ''}`}
      onDragOver={(event) => {
        if (!dnd.enabled || !dnd.dragging || dnd.dragging === project.id || !event.dataTransfer.types.includes(PROJECT_DRAG_TYPE)) return
        event.preventDefault()
        const box = event.currentTarget.getBoundingClientRect()
        const after = event.clientY > box.top + Math.min(box.height / 2, 22)
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
        className={active ? 'project-row active' : 'project-row'}
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
        {open ? <FolderOpen size={15} className="muted" /> : <FolderClosed size={15} className="muted" />}
        {renaming ? (
          <InlineEdit
            value={project.name}
            onDone={(v) => {
              setRenaming(false)
              if (v && v !== project.name) void act(() => invoke('projects.rename', project.id, v))
            }}
          />
        ) : (
          <FadeText className="project-name" text={project.name} />
        )}
        <span className="row-actions">
          <Button
            className="ghost icon small-icon"
            aria-label={t("Toggle {0}", { "0": project.name })}
            title={open ? t("Collapse") : t("Expand")}
            onClick={(e) => {
              e.stopPropagation()
              setOpen((o) => !o)
            }}
          >
            <ChevronRight size={14} className={open ? 'caret open' : 'caret'} />
          </Button>
          <Button
            className="ghost icon small-icon"
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
      {error && <div className="error small row-error">{error}</div>}
      {open && (
        <div className="task-list">
          {tasks.length === 0 && <div className="muted small empty-tasks">{t("No chats yet")}</div>}
          {tasks.map((t) => <TaskRow key={t.id} task={t} />)}
          {others.length > recent && (
            <Button className="archived-toggle" onClick={() => setShowAll((s) => !s)}>
              {showAll ? t("Show less") : t("Show more")}
            </Button>
          )}
          {archived.length > 0 && (
            <>
              <Button className="archived-toggle" onClick={() => setShowArchived((s) => !s)}>
                <ChevronRight size={12} className={showArchived ? 'caret open' : 'caret'} /> {t(" Archived (")}{archived.length})
              </Button>
              {showArchived && archived.map((t) => <TaskRow key={t.id} task={t} />)}
            </>
          )}
        </div>
      )}
    </section>
  )
}

function TaskRow({ task, projectName }: { task: Task; projectName?: string }) {
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
        className={`task-row${active ? ' active' : ''}${archived ? ' archived' : ''}`}
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
          <>{projectName && <span className="task-project">{projectName}</span>}<FadeText className="grow task-title" text={task.title} /></>
        )}
        {task.pinnedAt && !archived && <Pin size={11} className="muted mode-icon" aria-label={t("Pinned")} />}
        {naming && <Sparkles size={12} className="muted mode-icon" aria-label={t("Naming chat")} />}
        {task.mode === 'worktree' && <span title={ws.workspaces.find((w) => w.id === task.workspaceId)?.name ?? t("Isolated worktrees")}><GitBranch size={12} className="muted mode-icon" aria-label={t("Isolated worktrees")} /></span>}
        <span className="row-actions task-actions">
          {!archived && <Button className="ghost icon small-icon" aria-label={task.pinnedAt ? t("Unpin chat") : t("Pin chat")} title={task.pinnedAt ? t("Unpin") : t("Pin")} onClick={(e) => { e.stopPropagation(); void run(() => invoke('tasks.pin', task.id, !task.pinnedAt)) }}>{task.pinnedAt ? <PinOff size={14} /> : <Pin size={14} />}</Button>}
          <Button className="ghost icon small-icon" aria-label={archived ? t("Unarchive chat") : t("Archive chat")} title={archived ? t("Unarchive") : t("Archive")} onClick={(e) => { e.stopPropagation(); void run(async () => { await invoke('tasks.archive', task.id, !archived); if (!archived) ws.forgetTask(task.id) }) }}>{archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}</Button>
        </span>
        {task.status === 'running' ? <span className="task-state spinner" role="img" aria-label={t("Agent working")} title={t("Agent working")} />
          : task.status === 'needs-input' ? <span className="task-state dot warn" role="img" aria-label={t("Waiting for your input")} title={t("Waiting for your input")} />
          : task.status === 'failed' ? <span className="task-state dot bad" role="img" aria-label={t("Agent failed")} title={t("Agent failed")} />
          : ws.unread.has(task.id) ? <span className="task-state dot unread" role="img" aria-label={t("Finished, not viewed yet")} title={t("Finished, not viewed yet")} />
          : <span className="task-time">{timeAgo(task.lastActiveAt)}</span>}

      </div>
      {contextMenu.menu}
      {error && !deleting && <div className="error small row-error">{error}</div>}
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
                {t("Also remove its worktrees")}<span className="muted block">{t("Only if they have no uncommitted changes. Branches are kept.")}</span>
              </span>
            </label>
          ) : (
            <p className="muted">{t("Shared files, terminals, worktrees, and other chats stay open.")}</p>
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
      className="inline-edit"
      aria-label={t("Name")}
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

