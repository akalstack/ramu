import { AppUpdateNotice } from './AppUpdates'
import { t, useLanguage } from './i18n'
import { Kbd } from '@/components/ui/kbd'
import { ProviderSetupTerminal } from './ProviderSetupTerminal'
import { beginPaneResize } from './paneResize'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CalendarClock, Settings, SquarePen, Archive, Files, History, Folders, FolderPlus, GitBranch, Pencil, PanelLeftClose, PanelLeftOpen, PanelRightClose, SquareTerminal, RefreshCcw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { buildCommands, formatKeys, Palette, useKeybindings, type PaletteMode } from './commands'
import { invoke, ramu } from './ipc'
import { Dropdown, Menu, useContextMenu } from './Menu'
import { WorkspaceSyncDialog } from './WorkspaceSync'
import type { GitBranchInfo, GitStatus } from '../../shared/types'
import { BranchPicker, SyncButton, useAutoFetch } from './GitControls'
import { CommitBranchDialog } from './CommitBranchDialog'
import { Notifications, notifyError } from './Notifications'
import { TitleTooltips } from './TitleTooltips'
import { AppSettingsProvider, useAppSettings } from './AppSettings'
import { ModelSetsProvider } from './ModelSets'
import type { SettingsSection } from './SettingsPage'
import { ScheduleNavigation, SchedulesPage } from './Automation'
import { DEFAULT_SIDEBAR_WIDTH, NO_PROJECT, SIDEBAR_WIDTH_RANGE } from '../../shared/types'
import { SettingsPanel } from './SettingsPanel'
import { UsageFooter, UsageRings } from './Usage'
import { ProjectSwitcher } from './ProjectSwitcher'
import { runProjectAction, useProjectActions, WindowActions } from './WindowActions'
import { SearchChats } from './SearchChats'
import { useGitChangeCount } from './useGitChangeCount'
import { CreateEntryDialog } from './CreateEntryDialog'
import { HomePage, NewTask } from './NewTask'
import { AnimatedMark, BootScreen, Wordmark } from './Brand'
import { useAddProject } from './addProject'
import { ExplorerPanel } from './sidebar/ExplorerPanel'
import { ProjectsPanel } from './sidebar/ProjectsPanel'
import { SearchPanel } from './sidebar/SearchPanel'
import { ScmPanel } from './sidebar/ScmPanel'
import { errorText, TaskPane } from './TaskPane'
import { isWorktreeCtx, isWorkspaceCtx, worktreeCtx, projectCtx, useWorkspace, WorkspaceProvider } from './workspace'

export function App({ onReady }: { onReady?: () => void }) {
  const language = useLanguage()

  return <AppSettingsProvider><ModelSetsProvider><WorkspaceProvider>{(loaded) => (loaded ? <ReadyShell onReady={onReady} /> : <BootScreen />)}</WorkspaceProvider></ModelSetsProvider></AppSettingsProvider>
}

function ReadyShell({ onReady }: { onReady?: () => void }) {
  const language = useLanguage()

  useEffect(() => { onReady?.() }, [onReady])
  return <Shell />
}

function Shell() {
  const language = useLanguage()

  const ws = useWorkspace()
  const { ui } = ws
  const [palette, setPalette] = useState<PaletteMode | null>(null)
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [toolsWidth, setToolsWidth] = useState(340)
  const toolsResizeCleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => toolsResizeCleanup.current?.(), [])
  const { preferences, save } = useAppSettings()
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
      const delta = e.clientX - startX
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
  const [searchingChats, setSearchingChats] = useState(false)
  useEffect(() => {
    const open = (event: Event) => { setSettingsSection((event as CustomEvent<{ section?: SettingsSection }>).detail?.section ?? 'appearance'); setSettingsOpen(true) }
    window.addEventListener('ramu:settings', open)
    return () => window.removeEventListener('ramu:settings', open)
  }, [])

  // Saved project actions join the command list, so they show in the palette and their shortcuts work everywhere.
  const actionContext = ui.activeTaskId
  const projectActions = useProjectActions(actionContext ? ws.projectOf(actionContext)?.id : undefined)
  const commands = useMemo(
    () => [
      ...buildCommands(ws, { openPalette: setPalette, toggleSidebar: () => setSidebarHidden((h) => !h), showSidebar: (tab) => { if (tab === 'projects') setSidebarHidden(false); ws.setSidebar(tab) }, showSearch: () => { ws.setSidebar('search'); window.dispatchEvent(new Event('ramu:focus-search')) } }),
      // ⌘K is left to the editor's own chords while a file has focus.
      { id: 'chat.search', title: t("Search chats"), category: t("Chat"), keys: 'mod+k', run: () => setSearchingChats(true), when: () => !document.activeElement?.closest('.monaco-editor') },
      ...(actionContext ? projectActions.map((action) => ({ id: `action.${action.id}`, title: t("Run action: {0}", { "0": action.name }), category: t("Actions"), keys: action.keys, run: () => runProjectAction(ws, actionContext, action) })) : []),
    ],
    [ws, language, actionContext, projectActions],
  )
  useKeybindings(commands, palette === null && !settingsOpen && !searchingChats)
  useEffect(() => {
    const openFile = () => setPalette('files')
    window.addEventListener('ramu:open-file', openFile)
    return () => window.removeEventListener('ramu:open-file', openFile)
  }, [])
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

  // The start screen shows for New chat, and when nothing is open yet.
  const globalPage = ui.sidebar === 'schedules'
  const workspaceTool = ui.sidebar === 'explorer' || ui.sidebar === 'search' || ui.sidebar === 'scm' ? ui.sidebar : null
  // Chats with nothing open is the home page: the start box, background chats and recaps. New chat without a project lands here too.
  const landing = ui.sidebar === 'projects' && !ui.activeTaskId
  const startProject = globalPage || landing ? null : ws.composing ?? (!ui.activeTaskId ? NO_PROJECT : null)
  const panes = new Map<string, string>()
  for (const id of ui.openTaskIds) {
    const workspace = ws.workspaceOf(id)
    if (!panes.has(workspace) || id === ui.activeTaskId) panes.set(workspace, id)
  }
  const startContext = startProject ? ws.composingWorkspace ? worktreeCtx(ws.composingWorkspace) : projectCtx(startProject) : null
  if (startContext && panes.has(startContext)) panes.set(startContext, startContext)

  const gitChanges = useGitChangeCount(ui.activeTaskId, ws.bindings[ui.activeTaskId ?? ''] ?? [])
  const activeWorkspace = ui.activeTaskId ? ws.workspaceOf(ui.activeTaskId) : null
  const unsavedFiles = new Set([...(ws.taskUi[ui.activeTaskId ?? '']?.views ?? []), ...(ws.taskUi[activeWorkspace ?? '']?.views ?? [])].filter(view => view.kind === 'file' && ws.dirty[view.id]).map(view => view.id)).size
  const attentionChats = ws.tasks.filter(task => task.status !== 'archived' && (ws.unread.has(task.id) || task.status === 'needs-input')).length
  const badge = (count: number) => count > 0 && <span className="activity-badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>

  const toolButtons = <nav className="workspace-tool-buttons" aria-label={t("Workspace tabs")}>
    {([
      { id: 'explorer', label: 'Explorer', keys: 'mod+shift+e', Icon: Files },
      { id: 'search', label: 'Search', keys: 'mod+shift+f', Icon: Search },
      { id: 'scm', label: 'Source Control', keys: 'ctrl+shift+g', Icon: GitBranch },
    ] as const).map(({ id, label, keys, Icon }) => <Button key={id} className={`ghost icon${workspaceTool === id ? ' active' : ''}`} aria-label={t(label)} aria-description={id === 'scm' && gitChanges ? `${gitChanges} ${t('Changes')}` : id === 'explorer' && unsavedFiles ? `${unsavedFiles} ${t('Unsaved changes')}` : undefined} aria-pressed={workspaceTool === id} title={`${t(label)} (${formatKeys(keys)})${id === 'scm' && gitChanges ? ` · ${gitChanges} ${t('Changes')}` : id === 'explorer' && unsavedFiles ? ` · ${unsavedFiles} ${t('Unsaved changes')}` : ''}`} onClick={() => ws.setSidebar(workspaceTool === id ? 'projects' : id)}><Icon size={16} />{badge(id === 'scm' ? gitChanges : id === 'explorer' ? unsavedFiles : 0)}</Button>)}
    <Button className="ghost icon" aria-label={t("Terminal")} title={t("Terminal")} disabled={!ui.activeTaskId} onClick={() => {
      const id = ui.activeTaskId
      if (!id) return
      const state = ws.taskUi[id]
      if (state?.terminalOpen) ws.setTerminalPanel(id, { terminalOpen: false })
      else {
        const terminal = state?.views.findLast((view) => view.kind === 'terminal')
        if (terminal) ws.activateView(id, terminal.id)
        else ws.openView(id, { kind: 'terminal' })
      }
    }}><SquareTerminal size={16} /></Button>
  </nav>
  // With the sidebar hidden, chats that want attention show on its toggle instead.
  const sidebarToggle = <Button className="ghost icon sidebar-toggle" aria-expanded={!sidebarHidden} aria-controls="workspace-sidebar" aria-label={sidebarHidden ? t("Show sidebar") : t("Hide sidebar")} aria-description={sidebarHidden && attentionChats ? `${attentionChats} ${t('Chats')}` : undefined} title={t("{0} sidebar ({1})", { "0": sidebarHidden ? t('Show') : t('Hide'), "1": formatKeys('mod+b') })} onClick={() => setSidebarHidden((hidden) => !hidden)}>
        {sidebarHidden ? <PanelLeftOpen size={16} strokeWidth={1.6} /> : <PanelLeftClose size={16} strokeWidth={1.6} />}{sidebarHidden && badge(attentionChats)}
      </Button>

  return (
    <div className={`shell${sidebarHidden ? ' no-sidebar' : ''}${workspaceTool ? ' with-workspace-tools' : ''}`} style={{ '--sidebar-w': `${sidebarWidth}px`, '--workspace-tools-w': `${toolsWidth}px` } as React.CSSProperties}>
      <div className="app-titlebar">
        {sidebarToggle}
        {globalPage ? <header className="task-header"><span className="header-title">{t("Schedules")}</span></header> : <TaskHeader starting={!!startProject || landing} tools={toolButtons} />}
      </div>
      {!sidebarHidden && <div className="sidebar-resizer" role="separator" tabIndex={0} aria-orientation="vertical" aria-label={t("Resize sidebar")} aria-valuemin={SIDEBAR_WIDTH_RANGE[0]} aria-valuemax={SIDEBAR_WIDTH_RANGE[1]} aria-valuenow={sidebarWidth} title={t("Drag or use arrow keys to resize · double-click to reset")} onPointerDown={startResize} onDoubleClick={() => saveLayout({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH })} onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const max = Math.min(SIDEBAR_WIDTH_RANGE[1], window.innerWidth * .5)
        const delta = event.key === 'ArrowRight' ? 20 : -20
        saveLayout({ sidebarWidth: Math.round(Math.max(SIDEBAR_WIDTH_RANGE[0], Math.min(max, event.key === 'Home' ? SIDEBAR_WIDTH_RANGE[0] : event.key === 'End' ? max : sidebarWidth + delta))) })
      }} />}
      <aside id="workspace-sidebar" className="sidebar" aria-hidden={sidebarHidden} inert={sidebarHidden}>
        <div className="sidebar-top">
          <Button type="button" className="wordmark-link" aria-label={t("Home")} title={t("Home")} onClick={() => ws.showHome()}><Wordmark className="app-wordmark" height={15} /></Button>
          <span className="release-badge">Alpha</span>
          <Button className={`ghost icon sidebar-mode${preferences.recentChatMode ? ' active' : ''}`} aria-pressed={preferences.recentChatMode} aria-label={preferences.recentChatMode ? t("Group chats by project") : t("Show chats by recent activity")} title={preferences.recentChatMode ? t("Group chats by project") : t("Show chats by recent activity")} onClick={() => void save({ ...preferences, recentChatMode: !preferences.recentChatMode })}>{preferences.recentChatMode ? <Folders size={16} /> : <History size={16} />}</Button>
          <Button className="ghost icon sidebar-search" aria-label={t("Search chats")} title={`${t("Search chats")} (${formatKeys('mod+k')})`} onClick={() => setSearchingChats(true)}><Search size={16} /></Button>
        </div>
        <nav className="sidebar-nav" aria-label={t("Activity")}>
          <Button className="nav-btn" onClick={() => ws.newTask()}>
            <SquarePen size={15} /> <span className="grow">{t("New chat")}</span> <Kbd>{formatKeys('mod+n')}</Kbd>
          </Button>
          <Button className={`nav-btn${globalPage ? ' active' : ''}`} aria-pressed={globalPage} onClick={() => ws.setSidebar(globalPage ? 'projects' : 'schedules')}>
            <CalendarClock size={15} /> <span className="grow">{t("Schedules")}</span>
          </Button>
        </nav>
        <div className="sidebar-body">
          {ui.sidebar !== 'schedules' && <ProjectsPanel />}
          {ui.sidebar === 'schedules' && <ScheduleNavigation />}
        </div>
        <div className="sidebar-footer">
          {!sidebarHidden && <UsageFooter />}
          <Button className="nav-btn" aria-label={t("Settings")} title={`${t("Settings")} (${formatKeys('mod+,')})`} onClick={() => { setSettingsSection('appearance'); setSettingsOpen(true) }}><Settings size={15} /> <span className="grow">{t("Settings")}</span> <Kbd>{formatKeys('mod+,')}</Kbd></Button>
        </div>
      </aside>
      <main className="main">
        <div className="task-area">
          {landing && <HomePage />}
          {ui.sidebar === 'schedules' && <SchedulesPage />}
          {startProject && !panes.has(startContext!) && <NewTask projectId={startProject} onProjectChange={(id) => ws.newTask(id)} />}

          {[...panes].map(([workspace, taskId]) => (
            <TaskPane key={workspace} taskId={taskId} visible={!globalPage && !landing && (startProject ? workspace === startContext : ui.activeTaskId === taskId)} />
          ))}
        </div>
        <StatusBar usage={sidebarHidden ? <UsageRings /> : null} />
      </main>
      {workspaceTool && <aside className="workspace-tools" aria-label={t(workspaceTool === 'explorer' ? 'Explorer' : workspaceTool === 'scm' ? 'Source Control' : 'Search')}>
        <div className="workspace-tools-resizer" role="separator" tabIndex={0} aria-label={t("Resize sidebar")} aria-orientation="vertical" aria-valuemin={220} aria-valuemax={480} aria-valuenow={toolsWidth} onDoubleClick={() => setToolsWidth(340)} onPointerDown={(event) => {
          toolsResizeCleanup.current?.()
          const startX = event.clientX, startWidth = toolsWidth
          toolsResizeCleanup.current = beginPaneResize(event, 'column', (next) => setToolsWidth(Math.round(Math.max(220, Math.min(480, window.innerWidth * .35, startWidth + startX - next.clientX)))))
        }} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          setToolsWidth((width) => Math.max(220, Math.min(480, window.innerWidth * .35, event.key === 'Home' ? 220 : event.key === 'End' ? 480 : width + (event.key === 'ArrowLeft' ? 20 : -20))))
        }} />
        <header className="workspace-tools-header">
          <span className="grow">{t(workspaceTool === 'explorer' ? 'Explorer' : workspaceTool === 'scm' ? 'Source Control' : 'Search')}</span>
          <Button className="ghost icon" aria-label={t("Close")} title={t("Close")} onClick={() => ws.setSidebar('projects')}><PanelRightClose size={15} /></Button>
        </header>
        <div className="sidebar-body">
          {workspaceTool === 'explorer' && <ExplorerPanel />}
          {workspaceTool === 'scm' && <ScmPanel />}
          {workspaceTool === 'search' && <SearchPanel key={ui.activeTaskId ? ws.workspaceOf(ui.activeTaskId) : 'empty'} />}
        </div>
      </aside>}
      {settingsOpen && <SettingsPanel initialSection={settingsSection} shortcuts={commands.filter((command) => command.keys).map((command) => ({ title: command.title, category: command.category, keys: command.keys! }))} onClose={() => setSettingsOpen(false)} />}
      {palette && <Palette ws={ws} commands={commands} mode={palette} onClose={() => setPalette(null)} />}
      {searchingChats && <SearchChats onClose={() => setSearchingChats(false)} />}
      <AppUpdateNotice />
      <ProviderSetupTerminal />
      <Notifications />
      <CommitBranchDialog />
      <TitleTooltips />
      <CreateEntryDialog />
    </div>
  )
}

function Welcome() {
  const language = useLanguage()

  const addProject = useAddProject()
  return (
    <div className="welcome">
      <AnimatedMark className="welcome-mark" size={72} />
      <Wordmark className="wordmark" height={34} />
      <p>{t("Your project. Every repo. One workspace.")}</p>
      <p className="muted">{t("Add a repository, or a folder that holds several of them.")}</p>
      <Button className="primary" disabled={addProject.busy} onClick={() => void addProject.add()}>
        <FolderPlus size={14} /> {t(" Add project…")}</Button>
    </div>
  )
}

function TaskHeader({ starting, tools }: { starting: boolean; tools?: ReactNode }) {
  const language = useLanguage()

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
    { key: 'rename', label: <><Pencil size={14} />{t("Rename")}</>, onSelect: () => setRenaming(true) },
    { key: 'archive', label: <><Archive size={14} />{t("Archive")}</>, onSelect: async () => {
      await invoke('tasks.archive', task.id, true)
      ws.forgetTask(task.id)
      await ws.refresh()
    } },
  ] : [])

  return (
    <header className="task-header" onContextMenu={task ? contextMenu.onContextMenu : undefined}>
      <div className="header-center">
      <ProjectSwitcher />
      {starting && <span className="header-title">{t("New chat")}</span>}
      {!starting && isProject && project && ctx && isWorktreeCtx(ctx) && <span className="header-title" title={project.root ?? undefined}>{ws.titleOf(ctx)}</span>}
      {task &&
        (renaming ? (
          <Input
            ref={input}
            className="inline-edit header-edit no-drag"
            aria-label={t("Chat title")}
            defaultValue={task.title}
            onBlur={(e) => void rename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void rename(e.currentTarget.value)
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <span className="header-title no-drag" title={`${task.title} (${t("Double-click to rename")})`} onDoubleClick={() => setRenaming(true)}>{task.title}</span>
        ))}
      {task?.mode === 'worktree' && <span className="chip header-worktree" title={t("Active isolated worktree")}>{ws.workspaces.find((workspace) => workspace.id === task.workspaceId)?.name ?? t("Isolated worktree")}</span>}
      {error && <span className="error small">{error}</span>}
      </div>
      {ctx && project && !starting && <WindowActions ctx={ctx} projectId={project.id} />}
      {tools}
      {contextMenu.menu}
    </header>
  )
}

function StatusBar({ usage }: { usage?: ReactNode }) {
  const language = useLanguage()

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

  if (!binding || !taskId) return <footer className="status-bar"><span className="grow" />{usage}</footer>
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
      ? <Dropdown label={t("Repository")} className="status-repo strong" value={binding.repoId} options={repos.map((b) => ({ value: b.repoId, label: b.repoName }))} onChange={setPicked} />
      : <span className="strong status-project" title={project?.name}>{project && project.name !== binding.repoName ? `${project.name} / ${binding.repoName}` : binding.repoName}</span>}
    <BranchPicker binding={binding} status={status} branches={branches} busy={busy || !ready} className="status-branch" onChange={(branch) => void run(() => invoke('git.checkout', taskId, binding.repoId, branch), true)} />
    <SyncButton status={status} busy={busy || !ready} pullMode={preferences.pullMode} className="status-sync" onSync={() => void run(() => invoke('git.sync', taskId, binding.repoId), true)} />
    {repos.length > 1 && <Button className="ghost sync-button status-sync-all" title={t("Sync every repository in this workspace")} onClick={() => setSyncAll(true)}><RefreshCcw size={13} /><span>{t("Sync all")}</span></Button>}
    {syncAll && taskId && <WorkspaceSyncDialog taskId={taskId} bindings={repos} onClose={() => setSyncAll(false)} />}
    <span className="status-checkout" title={binding.cwd}>{binding.mode === 'current' ? t("Current checkout") : t("Isolated worktree")}</span>
    {usage && <><span className="grow" />{usage}</>}
  </footer>
}
