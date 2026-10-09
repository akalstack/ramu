import { Separator } from '@/components/ui/separator'
import { ProviderSetupTerminal } from './ProviderSetupTerminal'
import { beginPaneResize } from './paneResize'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CalendarClock, Home, Settings, Archive, Files, FolderClosed, FolderPlus, GitBranch, MessageSquare, Pencil, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, RefreshCcw, Search } from 'lucide-react'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { buildCommands, formatKeys, Palette, useKeybindings, type PaletteMode } from './commands'
import { invoke, ramu } from './ipc'
import { Dropdown, Menu, useContextMenu } from './Menu'
import { WorkspaceSyncDialog } from './WorkspaceSync'
import type { GitBranchInfo, GitStatus } from '../../shared/types'
import { BranchPicker, SyncButton, useAutoFetch } from './GitControls'
import { Notifications, notifyError } from './Notifications'
import { TitleTooltips } from './TitleTooltips'
import { AppSettingsProvider, useAppSettings } from './AppSettings'
import { ModelSetsProvider } from './ModelSets'
import type { SettingsSection } from './SettingsPage'
import { HomePage, ScheduleNavigation, SchedulesPage } from './Automation'
import { DEFAULT_SIDEBAR_WIDTH, NO_PROJECT, SIDEBAR_WIDTH_RANGE } from '../../shared/types'
import { SettingsPanel } from './SettingsPanel'
import { ChatSwitcher } from './ChatSwitcher'
import { ProjectSwitcher } from './ProjectSwitcher'
import { CreateEntryDialog } from './CreateEntryDialog'
import { NewTask } from './NewTask'
import { AnimatedMark, BootScreen, Wordmark } from './Brand'
import { useAddProject } from './addProject'
import { ExplorerPanel } from './sidebar/ExplorerPanel'
import { ProjectsPanel } from './sidebar/ProjectsPanel'
import { SearchPanel } from './sidebar/SearchPanel'
import { ScmPanel } from './sidebar/ScmPanel'
import { errorText, TaskPane } from './TaskPane'
import { isWorktreeCtx, isWorkspaceCtx, worktreeCtx, projectCtx, useWorkspace, WorkspaceProvider } from './workspace'

export function App({ onReady }: { onReady?: () => void }) {
  return <AppSettingsProvider><ModelSetsProvider><WorkspaceProvider>{(loaded) => (loaded ? <ReadyShell onReady={onReady} /> : <BootScreen />)}</WorkspaceProvider></ModelSetsProvider></AppSettingsProvider>
}

function ReadyShell({ onReady }: { onReady?: () => void }) {
  useEffect(() => { onReady?.() }, [onReady])
  return <Shell />
}

// Top to bottom: the work itself (chats, which opens on the home page, then files, search, git), then what the agents leave for you.
const RAIL = [
  { id: 'projects', label: 'Home', keys: undefined, Icon: Home, group: 'start' },
  { id: 'explorer', label: 'Explorer', keys: 'mod+shift+e', Icon: Files, group: 'work' },
  { id: 'search', label: 'Search', keys: 'mod+shift+f', Icon: Search, group: 'work' },
  { id: 'scm', label: 'Source Control', keys: 'ctrl+shift+g', Icon: GitBranch, group: 'work' },
  { id: 'schedules', label: 'Schedules', keys: undefined, Icon: CalendarClock, group: 'agents' },
] as const

function Shell() {
  const ws = useWorkspace()
  const { ui } = ws
  const [palette, setPalette] = useState<PaletteMode | null>(null)
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const { preferences, save } = useAppSettings()
  const side = preferences.sidebarSide
  const [dragWidth, setDragWidth] = useState<number | null>(null)
  const sidebarWidth = dragWidth ?? preferences.sidebarWidth
  const latest = useRef({ preferences, save })
  latest.current = { preferences, save }
  const saveLayout = (patch: Partial<typeof preferences>) => void latest.current.save({ ...latest.current.preferences, ...patch }).catch((reason) => notifyError(String(reason), 'Settings'))
  const resizeCleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => resizeCleanup.current?.(), [])
  const startResize = (event: React.PointerEvent) => {
    resizeCleanup.current?.()
    const startX = event.clientX, startWidth = sidebarWidth
    let width = startWidth
    const move = (e: { clientX: number }) => {
      const delta = side === 'left' ? e.clientX - startX : startX - e.clientX
      width = Math.round(Math.min(Math.max(startWidth + delta, SIDEBAR_WIDTH_RANGE[0]), Math.min(SIDEBAR_WIDTH_RANGE[1], window.innerWidth * 0.5)))
      setDragWidth(width)
    }
    resizeCleanup.current = beginPaneResize(event, 'column', move, () => {
      if (width !== latest.current.preferences.sidebarWidth) saveLayout({ sidebarWidth: width })
      setDragWidth(null)
    })
  }
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('appearance')
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEffect(() => {
    const open = (event: Event) => { setSettingsSection((event as CustomEvent<{ section?: SettingsSection }>).detail?.section ?? 'appearance'); setSettingsOpen(true) }
    window.addEventListener('ramu:settings', open)
    return () => window.removeEventListener('ramu:settings', open)
  }, [])

  const commands = useMemo(
    () => buildCommands(ws, { openPalette: setPalette, toggleSidebar: () => setSidebarHidden((h) => !h), moveSidebar: () => saveLayout({ sidebarSide: latest.current.preferences.sidebarSide === 'left' ? 'right' : 'left' }), showSidebar: (tab) => { setSidebarHidden(false); ws.setSidebar(tab) }, showSearch: () => { setSidebarHidden(false); ws.setSidebar('search'); window.dispatchEvent(new Event('ramu:focus-search')) } }),
    [ws],
  )
  useKeybindings(commands, palette === null && !settingsOpen)
  // The palette's own shortcuts still close it while it is open.
  useEffect(() => {
    if (palette === null) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setPalette(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [palette])

  useEffect(() => {
    const showExplorer = () => setSidebarHidden(false)
    window.addEventListener('ramu:show-explorer', showExplorer)
    return () => window.removeEventListener('ramu:show-explorer', showExplorer)
  }, [])

  // The start screen shows for New chat, and when nothing is open yet.
  const globalPage = ui.sidebar === 'schedules'
  // Chats with nothing open is the home page: recaps and the start box.
  const landing = ui.sidebar === 'projects' && !ui.activeTaskId && !ws.composing
  const startProject = globalPage || landing ? null : ws.composing ?? (!ui.activeTaskId ? NO_PROJECT : null)
  const panes = new Map<string, string>()
  for (const id of ui.openTaskIds) {
    const workspace = ws.workspaceOf(id)
    if (!panes.has(workspace) || id === ui.activeTaskId) panes.set(workspace, id)
  }
  const startContext = startProject ? ws.composingWorkspace ? worktreeCtx(ws.composingWorkspace) : projectCtx(startProject) : null
  if (startContext && panes.has(startContext)) panes.set(startContext, startContext)
  const showSidebar = (id: (typeof RAIL)[number]['id']) => {
    setSidebarHidden(false)
    ws.setSidebar(id)
  }

  const sidebarToggle = <Button className={`ghost icon sidebar-toggle${sidebarHidden ? '' : ' sidebar-toggle-docked'}`} aria-expanded={!sidebarHidden} aria-controls="workspace-sidebar" aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'} title={`${sidebarHidden ? 'Show' : 'Hide'} sidebar (${formatKeys('mod+b')})`} onClick={() => setSidebarHidden((hidden) => !hidden)}>
        {side === 'left' ? (sidebarHidden ? <PanelLeftOpen size={16} strokeWidth={1.6} /> : <PanelLeftClose size={16} strokeWidth={1.6} />) : (sidebarHidden ? <PanelRightOpen size={16} strokeWidth={1.6} /> : <PanelRightClose size={16} strokeWidth={1.6} />)}
      </Button>

  return (
    <div className={`shell${sidebarHidden ? ' no-sidebar' : ''}${side === 'right' ? ' side-right' : ''}`} style={{ '--sidebar-w': `${sidebarWidth}px` } as React.CSSProperties}>
      <nav className="rail" aria-label="Activity">
        {RAIL.map(({ id, label, keys, Icon, group }, index) => (
          <Fragment key={id}>
          {index > 0 && RAIL[index - 1]!.group !== group && <Separator className="rail-sep" />}
          <Button
            className={ui.sidebar === id && !sidebarHidden ? 'rail-btn active' : 'rail-btn'}
            title={keys ? `${label} (${formatKeys(keys)})` : label}
            aria-label={label}
            aria-pressed={ui.sidebar === id && !sidebarHidden}
            onClick={() => (id === 'projects' && ui.sidebar === 'projects' && !sidebarHidden && !landing ? ws.showHome() : showSidebar(id))}
          >
            <Icon size={18} strokeWidth={1.6} />
          </Button>
          </Fragment>
        ))}
        <span className="grow" />
        <Button className="rail-btn" aria-label="Settings" title="Settings" onClick={() => { setSettingsSection('appearance'); setSettingsOpen(true) }}><Settings size={18} strokeWidth={1.6} /></Button>
      </nav>
      {!sidebarHidden && <div className="sidebar-resizer" role="separator" tabIndex={0} aria-orientation="vertical" aria-label="Resize sidebar" aria-valuemin={SIDEBAR_WIDTH_RANGE[0]} aria-valuemax={SIDEBAR_WIDTH_RANGE[1]} aria-valuenow={sidebarWidth} title="Drag or use arrow keys to resize · double-click to reset" onPointerDown={startResize} onDoubleClick={() => saveLayout({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH })} onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const max = Math.min(SIDEBAR_WIDTH_RANGE[1], window.innerWidth * .5)
        const delta = (event.key === 'ArrowRight' ? 20 : -20) * (side === 'left' ? 1 : -1)
        saveLayout({ sidebarWidth: Math.round(Math.max(SIDEBAR_WIDTH_RANGE[0], Math.min(max, event.key === 'Home' ? SIDEBAR_WIDTH_RANGE[0] : event.key === 'End' ? max : sidebarWidth + delta))) })
      }} />}
      <aside id="workspace-sidebar" className="sidebar" aria-hidden={sidebarHidden}>
        <div className="sidebar-top"><Button type="button" className="wordmark-link" aria-label="Chats home" title="Home" onClick={() => ws.showHome()}><Wordmark className="app-wordmark" height={15} /></Button>{!sidebarHidden && sidebarToggle}</div>
        <ProjectSwitcher />
        <div className="sidebar-body">
          {ui.sidebar === 'projects' && <ProjectsPanel />}
          {ui.sidebar === 'schedules' && <ScheduleNavigation />}
          {ui.sidebar === 'explorer' && <ExplorerPanel />}
          {ui.sidebar === 'scm' && <ScmPanel />}
          {ui.sidebar === 'search' && <SearchPanel key={ui.activeTaskId ? ws.workspaceOf(ui.activeTaskId) : 'empty'} />}
        </div>
      </aside>
      <main className="main">
        {globalPage || landing ? <header className="task-header">{sidebarHidden && sidebarToggle}<span className="header-title">{ui.sidebar === 'schedules' ? 'Schedules' : 'Home'}</span></header> : <TaskHeader starting={!!startProject} sidebarToggle={sidebarHidden ? sidebarToggle : null} />}
        <div className="task-area">
          {landing && <HomePage />}
          {ui.sidebar === 'schedules' && <SchedulesPage />}
          {startProject && !panes.has(startContext!) && <NewTask projectId={startProject} onProjectChange={(id) => ws.newTask(id)} />}

          {[...panes].map(([workspace, taskId]) => (
            <TaskPane key={workspace} taskId={taskId} visible={!globalPage && !landing && (startProject ? workspace === startContext : ui.activeTaskId === taskId)} />
          ))}
        </div>
        <StatusBar />
      </main>
      {settingsOpen && <SettingsPanel initialSection={settingsSection} shortcuts={commands.filter((command) => command.keys).map((command) => ({ title: command.title, category: command.category, keys: command.keys! }))} onClose={() => setSettingsOpen(false)} />}
      {palette && <Palette ws={ws} commands={commands} mode={palette} onClose={() => setPalette(null)} />}
      <ProviderSetupTerminal />
      <Notifications />
      <TitleTooltips />
      <CreateEntryDialog />
    </div>
  )
}

function Welcome() {
  const addProject = useAddProject()
  return (
    <div className="welcome">
      <AnimatedMark className="welcome-mark" size={72} />
      <Wordmark className="wordmark" height={34} />
      <p>Your project. Every repo. One workspace.</p>
      <p className="muted">Add a repository, or a folder that holds several of them.</p>
      <Button className="primary" disabled={addProject.busy} onClick={() => void addProject.add()}>
        <FolderPlus size={14} /> Add project…
      </Button>
    </div>
  )
}

function TaskHeader({ starting, sidebarToggle }: { starting: boolean; sidebarToggle?: ReactNode }) {
  const ws = useWorkspace()
  const ctx = ws.ui.activeTaskId
  const isProject = !!ctx && isWorkspaceCtx(ctx)
  const task = !starting && ctx && !isProject ? ws.task(ctx) : undefined
  const project = ctx ? ws.projectOf(ctx) : undefined
  const [renaming, setRenaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => setRenaming(false), [ctx])
  useEffect(() => input.current?.select(), [renaming])

  const rename = async (title: string) => {
    setRenaming(false)
    if (!task || !title.trim() || title.trim() === task.title) return
    try {
      await invoke('tasks.rename', task.id, title)
      await ws.refresh()
    } catch (e) {
      setError(errorText(e))
    }
  }

  const contextMenu = useContextMenu('Chat actions', task ? [
    { key: 'rename', label: <><Pencil size={14} />Rename</>, onSelect: () => setRenaming(true) },
    { key: 'archive', label: <><Archive size={14} />Archive</>, onSelect: async () => {
      await invoke('tasks.archive', task.id, true)
      ws.forgetTask(task.id)
      await ws.refresh()
    } },
  ] : [])

  return (
    <header className="task-header" onContextMenu={task ? contextMenu.onContextMenu : undefined}>
      {sidebarToggle}
      <div className="header-center">
      {starting && <span className="header-title">New chat</span>}
      {!starting && isProject && project && (
        <>
          <FolderClosed size={14} className="muted" />
          <span className="header-title" title={project.root ?? undefined}>{ctx && isWorktreeCtx(ctx) ? ws.titleOf(ctx) : project.name}</span>
        </>
      )}
      {task && <MessageSquare size={14} className="muted" />}
      {task &&
        (renaming ? (
          <Input
            ref={input}
            className="inline-edit header-edit no-drag"
            aria-label="Chat title"
            defaultValue={task.title}
            onBlur={(e) => void rename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void rename(e.currentTarget.value)
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <ChatSwitcher contextId={task.id} />
        ))}
      {!task && project && ctx && <ChatSwitcher contextId={ctx} />}
      {task && project && <span className="header-meta">{project.name}</span>}
      {task?.mode === 'worktree' && <span className="chip header-worktree" title="Active isolated worktree">{ws.workspaces.find((workspace) => workspace.id === task.workspaceId)?.name ?? 'Isolated worktree'}</span>}
      {error && <span className="error small">{error}</span>}
      </div>
      {contextMenu.menu}
    </header>
  )
}

function StatusBar() {
  const ws = useWorkspace()
  const taskId = ws.ui.activeTaskId
  const state = taskId ? ws.taskUi[taskId] : undefined
  const view = state?.views.find((v) => v.id === state.activeViewId)
  const repos = taskId ? (ws.bindings[taskId] ?? []).filter((b) => b.setupState === 'ready' && !b.folderOnly) : []
  // Following the open tab by default; picking a repository here overrides it until the tab changes.
  const [picked, setPicked] = useState<string | null>(null)
  useEffect(() => { setPicked(null) }, [taskId, view?.id])
  const repoId = picked ?? view?.repoId ?? (taskId ? ws.bindings[taskId]?.[0]?.repoId : undefined)
  const candidate = taskId && repoId ? ws.binding(taskId, repoId) : undefined
  const binding = candidate?.folderOnly ? undefined : candidate
  const [status, setStatus] = useState<GitStatus | null>(null)
  const [branches, setBranches] = useState<GitBranchInfo[]>([])
  const [busy, setBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const { preferences } = useAppSettings()
  const [syncAll, setSyncAll] = useState(false)
  const autoFetch = useCallback(async () => {
    if (!taskId || !binding || binding.setupState !== 'ready') return
    await invoke('git.fetch', taskId, binding.repoId)
    window.dispatchEvent(new Event('ramu:git-updated'))
  }, [taskId, binding?.repoId, binding?.setupState])
  useAutoFetch(binding?.setupState === 'ready' ? autoFetch : null)

  useEffect(() => {
    setStatus(null); setBranches([])
    if (!taskId || !binding || binding.setupState !== 'ready') return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let request = 0
    const load = async () => {
      const current = ++request
      const results = await Promise.allSettled([invoke('git.status', taskId, binding.repoId), invoke('git.branches', taskId, binding.repoId)])
      if (disposed || current !== request) return
      if (results[0].status === 'fulfilled') setStatus(results[0].value)
      if (results[1].status === 'fulfilled') setBranches(results[1].value)
    }
    const refresh = () => { clearTimeout(timer); timer = setTimeout(() => void load(), 150) }
    void load()
    const off = ramu.on('fs:changed', ({ cwd }) => { if (cwd === binding.cwd) refresh() })
    window.addEventListener('ramu:git-updated', refresh)
    return () => { disposed = true; off(); clearTimeout(timer); window.removeEventListener('ramu:git-updated', refresh) }
  }, [taskId, binding?.repoId, binding?.cwd, binding?.setupState, revision])

  if (!binding || !taskId) return <footer className="status-bar" />
  const run = async (action: () => Promise<unknown>, needsSaved = false) => {
    setBusy(true)
    try {
      if (needsSaved && Object.values(ws.dirty).some(Boolean)) throw new Error('Save or close unsaved editor buffers before switching branches or pulling.')
      await action()
    } catch (e) { notifyError(errorText(e), `Git · ${binding.repoName}`) }
    finally { setBusy(false); setRevision((value) => value + 1); window.dispatchEvent(new Event('ramu:git-updated')) }
  }
  const ready = binding.setupState === 'ready'
  const project = ws.projectOf(taskId)
  return <footer className="status-bar">
    {repos.length > 1
      ? <Dropdown label="Repository" className="status-repo strong" value={binding.repoId} options={repos.map((b) => ({ value: b.repoId, label: b.repoName }))} onChange={setPicked} />
      : <span className="strong status-project" title={project?.name}>{project && project.name !== binding.repoName ? `${project.name} / ${binding.repoName}` : binding.repoName}</span>}
    <BranchPicker binding={binding} status={status} branches={branches} busy={busy || !ready} className="status-branch" onChange={(branch) => void run(() => invoke('git.checkout', taskId, binding.repoId, branch), true)} />
    <SyncButton status={status} busy={busy || !ready} pullMode={preferences.pullMode} className="status-sync" onSync={() => void run(() => invoke('git.sync', taskId, binding.repoId), true)} />
    {repos.length > 1 && <Button className="ghost sync-button status-sync-all" title="Sync every repository in this workspace" onClick={() => setSyncAll(true)}><RefreshCcw size={13} /><span>Sync all</span></Button>}
    {syncAll && taskId && <WorkspaceSyncDialog taskId={taskId} bindings={repos} onClose={() => setSyncAll(false)} />}
    <span className="status-checkout" title={binding.cwd}>{binding.mode === 'current' ? 'Current checkout' : 'Isolated worktree'}</span>
  </footer>
}
