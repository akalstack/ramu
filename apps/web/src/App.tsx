import { BackgroundActivity } from './BackgroundActivity'
import { AppUpdateNotice } from './AppUpdates'
import { animatePanelChange, cancelPanelMotion } from './panelMotion'
import { errorText } from './errors'
import { t, useLanguage } from './i18n'
import { Kbd } from '@/components/ui/kbd'
import { ProviderSetupTerminal } from './ProviderSetupTerminal'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { SeparatorOverlay, usePanelRef, type Layout, type PanelSize } from 'react-resizable-panels'
import { Button } from '@/components/desktop-button'
import { Separator } from '@/components/ui/separator'
import { Input } from '@/components/ui/input'
import { CalendarClock, Settings, SquarePen, Archive, Files, History, Folders, FolderPlus, GitBranch, MessageCircle, Pencil, PanelLeftClose, PanelLeftOpen, PanelRight, SquareTerminal, X, RefreshCcw, Search } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { buildCommands, formatKeys, Palette, useKeybindings, type PaletteMode } from './commands'
import { copyText, invoke, ramu } from './ipc'
import { Dropdown, Menu, useContextMenu } from './Menu'
import { WorkspaceSyncDialog } from './WorkspaceSync'
import type { GitBranchInfo, GitStatus } from '@ramu/shared/types'
import { BranchPicker, SyncButton, useAutoFetch } from './GitControls'
import { isGitBusy, useGitBusy, withGitBackground, withGitBusy } from './gitBusy'
import { CommitBranchDialog } from './CommitBranchDialog'
import { Notifications, notifyError } from './Notifications'
import { TitleTooltips } from './TitleTooltips'
import { AppSettingsProvider, useAppSettings } from './AppSettings'
import { ModelSetsProvider } from './ModelSets'
import type { SettingsSection } from './SettingsPage'
import { ScheduleNavigation, SchedulesPage } from './Automation'
import { DEFAULT_SIDEBAR_WIDTH, NO_PROJECT, SIDEBAR_WIDTH_RANGE } from '@ramu/shared/types'
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
import { ProjectsPanel } from './sidebar/ProjectsPanel'
import { TaskPane } from './TaskPane'
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
  const addProject = useAddProject()
  const [createScheduleRequested, setCreateScheduleRequested] = useState(false)
  const [palette, setPalette] = useState<PaletteMode | null>(null)
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const toggleSidebar = () => animatePanelChange(() => setSidebarHidden(hidden => !hidden), 'sidebar', () => !!document.querySelector('.shell.no-sidebar'))
  const { preferences, save } = useAppSettings()
  const latest = useRef({ preferences, save })
  latest.current = { preferences, save }
  const saveLayout = (patch: Partial<typeof preferences>) => void latest.current.save({ ...latest.current.preferences, ...patch }).catch((reason) => notifyError(errorText(reason), 'Settings'))
  // The sidebar, main area and tools column are panels of one group. Their default sizes always mirror the
  // current ones, so the group keeps them when another panel joins or leaves.
  const sidebarPanel = usePanelRef()
  const [navWidth, setNavWidth] = useState(preferences.sidebarWidth)
  const [expandedWidth, setExpandedWidth] = useState(preferences.sidebarWidth)
  const onSidebarResize = (size: PanelSize) => {
    const width = Math.round(size.inPixels)
    setNavWidth(width)
    const collapsed = sidebarPanel.current?.isCollapsed() ?? width === 0
    if (width > 0 && !collapsed) setExpandedWidth(width)
    setSidebarHidden((hidden) => hidden === collapsed ? hidden : collapsed)
  }
  // Dragging remembers sizes; the sidebar width is a preference, the tools column a layout size.
  const onShellLayout = (_layout: Layout, meta: { isUserInteraction: boolean }) => {
    if (!meta.isUserInteraction) return
    const sidebar = Math.round(sidebarPanel.current?.getSize().inPixels ?? 0)
    if (sidebar > 0 && sidebar !== latest.current.preferences.sidebarWidth) saveLayout({ sidebarWidth: sidebar })
  }
  useLayoutEffect(() => {
    const panel = sidebarPanel.current
    if (!panel) return
    if (sidebarHidden && !panel.isCollapsed()) panel.collapse()
    if (!sidebarHidden && panel.isCollapsed()) panel.expand()
  }, [sidebarHidden])
  // Settings → reset layout sizes (and any other change of the saved width) applies to the live panel.
  useEffect(() => {
    const panel = sidebarPanel.current
    if (panel && !panel.isCollapsed() && Math.abs(panel.getSize().inPixels - preferences.sidebarWidth) > 1) panel.resize(preferences.sidebarWidth)
  }, [preferences.sidebarWidth])
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('appearance')
  const [settingsTarget, setSettingsTarget] = useState<string | undefined>()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [searchingChats, setSearchingChats] = useState(false)
  useEffect(() => {
    const open = (event: Event) => { const detail = (event as CustomEvent<{ section?: SettingsSection; target?: string }>).detail; setSettingsSection(detail?.section ?? 'appearance'); setSettingsTarget(detail?.target); setSettingsOpen(true) }
    const off = ramu.on('menu:action', ({ action }) => {
      window.dispatchEvent(new CustomEvent('ramu:settings', { detail: action === 'check-updates' ? { section: 'system', target: 'Check app updates' } : { section: 'appearance' } }))
      if (action === 'check-updates') void invoke('updates.check').catch((reason) => notifyError(errorText(reason), 'Updates'))
    })
    window.addEventListener('ramu:settings', open)
    return () => { off(); window.removeEventListener('ramu:settings', open) }
  }, [])

  // Saved project actions join the command list, so they show in the palette and their shortcuts work everywhere.
  const actionContext = ui.activeTaskId
  const projectActions = useProjectActions(actionContext ? ws.projectOf(actionContext)?.id : undefined)
  const commands = useMemo(
    () => [
      ...buildCommands(ws, { openPalette: setPalette, toggleSidebar, addProject: () => void addProject.add(), createSchedule: () => { setSidebarHidden(false); setCreateScheduleRequested(true); ws.setSidebar('schedules') }, showSidebar: (tab) => { if (tab === 'projects' || tab === 'schedules') setSidebarHidden(false); ws.setSidebar(tab) }, showSearch: () => { ws.setSidebar('search'); window.dispatchEvent(new Event('ramu:focus-search')) } }),
      // ⌘K is left to the editor's own chords while a file has focus.
      { id: 'chat.search', title: t("Search chats"), category: t("Chat"), keys: 'mod+k', run: () => setSearchingChats(true), when: () => !document.activeElement?.closest('.monaco-editor') },
      ...(actionContext ? projectActions.map((action) => ({ id: `action.${action.id}`, title: t("Run action: {0}", { "0": action.name }), category: t("Actions"), keys: action.keys, run: () => runProjectAction(ws, actionContext, action) })) : []),
    ],
    [ws, language, actionContext, projectActions, addProject.busy],
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
  const activePanelState = ws.taskUi[activeWorkspace ?? '']
  const terminalShown = !globalPage && !landing && !startProject && !!activePanelState?.views.some(view => view.kind === 'terminal') && (activePanelState.terminalOpen ?? true)
  const unsavedFiles = new Set([...(ws.taskUi[ui.activeTaskId ?? '']?.views ?? []), ...(ws.taskUi[activeWorkspace ?? '']?.views ?? [])].filter(view => view.kind === 'file' && ws.dirty[view.id]).map(view => view.id)).size
  // Output from a terminal nobody is looking at: a dot on the Terminal button until the panel is opened.
  const [terminalQuiet, setTerminalQuiet] = useState(true)
  const terminalOpenRef = useRef(false)
  terminalOpenRef.current = terminalShown
  useEffect(() => ramu.on('term:data', () => { if (!terminalOpenRef.current) setTerminalQuiet(false) }), [])
  useEffect(() => { if (terminalShown) setTerminalQuiet(true) }, [terminalShown])
  const attentionChats = ws.tasks.filter(task => task.status !== 'archived' && (ws.unread.has(task.id) || task.status === 'needs-input')).length
  const badge = (count: number, compact = false) => count > 0 && <span className={`activity-badge absolute grid place-items-center rounded-(--radius-row) [background:var(--primary)] [color:var(--primary-ink)] font-semibold leading-[1] tabular-nums pointer-events-none ${compact ? 'right-[-4px] bottom-[-3px] min-w-3 h-3 px-0.5 [box-shadow:0_0_0_1px_var(--window)] text-[length:8px]' : 'right-[-3px] bottom-[-2px] min-w-4 h-4 p-[0_4px] [box-shadow:0_0_0_2px_var(--window)] text-[length:10px]'}`} aria-hidden="true">{count > 99 ? '99+' : count}</span>

  const rightShown = terminalShown || !!workspaceTool || !!ui.activeTaskId && ws.workspaceVisible(ui.activeTaskId)
  const toolButtons = <nav className="workspace-tool-buttons [&_button[aria-pressed=true]]:text-brand [&_button[aria-pressed=true]]:bg-brand-wash [&_.icon]:[transition:background-color_140ms_ease,_color_140ms_ease] [&_>_button]:relative [&_>_button]:overflow-visible flex flex-none items-center ml-auto [-webkit-app-region:no-drag] gap-1" aria-label={t("Workspace controls")}>
    <ProjectSwitcher />
    {([
      { id: 'explorer', label: 'Explorer', keys: 'mod+shift+e', Icon: Files },
      { id: 'search', label: 'Search', keys: 'mod+shift+f', Icon: Search },
      { id: 'scm', label: 'Source Control', keys: 'ctrl+shift+g', Icon: GitBranch },
    ] as const).map(({ id, label, keys, Icon }) => <Button variant="secondary" key={id} className={`ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center${workspaceTool === id ? ' active' : ''}`} aria-label={t(label)} aria-description={id === 'scm' && gitChanges ? `${gitChanges} ${t('Changes')}` : id === 'explorer' && unsavedFiles ? `${unsavedFiles} ${t('Unsaved changes')}` : undefined} aria-pressed={workspaceTool === id} title={`${t(label)} (${formatKeys(keys)})${id === 'scm' && gitChanges ? ` · ${gitChanges} ${t('Changes')}` : id === 'explorer' && unsavedFiles ? ` · ${unsavedFiles} ${t('Unsaved changes')}` : ''}`} onClick={() => ws.setSidebar(workspaceTool === id ? 'projects' : id)}><Icon size={16} />{badge(id === 'scm' ? gitChanges : id === 'explorer' ? unsavedFiles : 0, true)}</Button>)}
    <Separator orientation="vertical" className="mx-1 self-center! h-4" />
    <Button variant="ghost" size="icon-sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center" aria-label={t("Terminal")} aria-pressed={terminalShown} title={terminalShown ? t("Hide terminal") : t("Show terminal")} disabled={!ui.activeTaskId} onClick={() => {
      const id = ui.activeTaskId
      if (!id) return
      const state = activePanelState
      if (terminalShown) ws.setTerminalPanel(id, { terminalOpen: false })
      else {
        const terminal = state?.views.findLast((view) => view.kind === 'terminal')
        if (terminal) ws.activateView(id, terminal.id)
        else ws.openView(id, { kind: 'terminal' })
      }
    }}><SquareTerminal data-icon="inline-start" />{!terminalQuiet && !terminalShown && <span role="status" aria-label={t("New terminal output")} className="absolute right-[3px] bottom-[3px] size-1.5 rounded-full bg-primary pointer-events-none" />}</Button>
    <Button variant="ghost" size="icon-sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center" aria-expanded={rightShown} aria-pressed={rightShown} aria-label={rightShown ? t("Hide workspace") : t("Show workspace")} title={`${rightShown ? t("Hide workspace") : t("Show workspace")} (${formatKeys('mod+alt+b')})`} disabled={!ui.activeTaskId} onClick={() => { if (ui.activeTaskId) ws.toggleRightPanel(ui.activeTaskId) }}><PanelRight data-icon="inline-start" /></Button>
  </nav>
  // With the sidebar hidden, chats that want attention show on its toggle instead.
  const sidebarToggle = <Button variant="ghost" size="icon-sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground icon p-0 size-(--action-size) flex-none justify-center sidebar-toggle aria-expanded:bg-transparent aria-expanded:hover:bg-hover aria-expanded:text-muted-foreground aria-expanded:hover:text-foreground [&:hover:not(:disabled)]:text-foreground [-webkit-app-region:no-drag] relative overflow-visible [&_*]:[-webkit-app-region:no-drag] flex-none z-30 [-webkit-app-region:no-drag] text-muted-foreground" aria-expanded={!sidebarHidden} aria-controls="workspace-sidebar" aria-label={sidebarHidden ? t("Show sidebar") : t("Hide sidebar")} aria-description={sidebarHidden && attentionChats ? `${attentionChats} ${t('Chats')}` : undefined} title={t("{0} sidebar ({1})", { "0": sidebarHidden ? t('Show') : t('Hide'), "1": formatKeys('mod+b') })} onClick={toggleSidebar}>
        {sidebarHidden ? <PanelLeftOpen size={16} strokeWidth={1.6} /> : <PanelLeftClose size={16} strokeWidth={1.6} />}{sidebarHidden && badge(attentionChats)}
      </Button>

  return (
    <div onPointerDownCapture={event => { if ((event.target as HTMLElement).closest('[role="separator"]')) cancelPanelMotion() }} className={`shell [&.no-sidebar_.sidebar]:opacity-0 [&.no-sidebar_.sidebar]:invisible [&_.sidebar_>_*]:min-w-[calc(var(--sidebar-w,_268px)_-_14px)] [&.no-sidebar_.main]:ml-[var(--island-gap)] relative h-full bg-window [--titlebar-h:44px] [--nav-width:var(--sidebar-w,_268px)] ${sidebarHidden ? ' no-sidebar' : ''}`} style={{ '--sidebar-w': `${expandedWidth}px`, '--nav-width': `${navWidth}px` } as React.CSSProperties}>
      <div className="app-titlebar [&_>_.task-header]:flex-1 [&_>_.task-header]:min-w-0 [&_>_.task-header]:h-[44px] [&_>_.task-header]:p-[0_10px_0_12px] [&_>_.task-header]:bg-transparent [&_>_.task-header]:[border:0] absolute inset-[0_0_auto] z-20 h-[var(--titlebar-h)] flex items-center [-webkit-app-region:drag] pr-[var(--island-gap)]">
        <div className="sidebar-titlebar @container flex flex-none items-center gap-2 min-w-0 h-full pr-2 pl-[max(16px,_calc(var(--window-controls-inset,_0px)_+_8px))]" style={{ width: sidebarHidden ? 'calc(var(--window-controls-inset, 0px) + 44px)' : 'var(--nav-width)' }}>
          {!sidebarHidden && <>
            <Button variant="secondary" type="button" className="bg-fill hover:bg-fill-hover wordmark-link min-w-0 shrink [&:hover:not(:disabled)]:bg-transparent [&:hover:not(:disabled)]:[border:0] [&:hover_.app-wordmark]:opacity-100 bg-transparent [border:0] p-0 min-h-0 rounded-(--radius-s) cursor-pointer [-webkit-app-region:no-drag]" aria-label={t("Home")} title={t("Home")} onClick={() => ws.showHome()}><Wordmark className="app-wordmark block max-w-full [opacity:0.94]" height={15} /></Button>
            <span className="release-badge hidden @min-[163px]:inline-flex p-[0_6px] h-[18px] items-center [border:0] rounded-full bg-fill text-muted-foreground text-[length:9.5px] font-semibold leading-[1] tracking-[0.08em] [text-transform:uppercase] whitespace-nowrap select-none pointer-events-none">Alpha</span>
          </>}
          <div className="ml-auto flex items-center">{sidebarToggle}</div>
        </div>
        {globalPage ? <header className="task-header [&_button]:[-webkit-app-region:no-drag] [&_input]:[-webkit-app-region:no-drag] [&_.chat-switch-btn:hover_.header-secondary]:text-soft [&_.header-center]:flex [&_.header-center]:items-center [&_.header-center]:gap-2 [&_.header-center]:flex-1 [&_.header-center]:min-w-0 [&_.header-center]:overflow-hidden [&::after]:[content:''] [&::after]:flex-1 [&_.header-title]:relative [&_.header-title]:top-[-1px] [&_.header-title]:leading-[20px] [&_.header-secondary]:relative [&_.header-secondary]:top-[-1px] [&_.header-secondary]:leading-[20px] [&_.header-meta]:relative [&_.header-meta]:top-[-1px] [&_.header-meta]:leading-[20px] [&_.header-meta]:shrink-0 [&_.header-meta]:max-w-[25%] [&_.header-meta]:overflow-hidden [&_.header-meta]:text-ellipsis [&_.chat-switch-btn]:justify-start [&_.chat-switch-btn]:w-[fit-content] [&_.chat-switch-btn]:max-w-[none] [&_.chat-switch-btn]:flex-initial [&_.chat-switch-btn_.header-title]:flex-initial [&_.chat-switch-btn_.header-title]:min-w-0 [&_.chat-switch-btn_.header-title]:max-w-[none] [&_.chat-switch-btn_.header-title]:text-left [&_.chat-switch-btn_.header-secondary]:flex-initial [&_.chat-switch-btn_.header-secondary]:min-w-0 [&_.chat-switch-btn_.header-secondary]:max-w-[none] [&_.chat-switch-btn_.header-secondary]:text-left [&:has(.workspace-tool-buttons)::after]:hidden [&_.workspace-tool-buttons]:ml-auto [&_.header-center_>_svg]:flex-none [&_.header-center_.chat-switch-btn]:max-w-full [&_.header-center_.chat-switch-btn]:min-w-0 flex-none flex items-center gap-2.5 p-[0_12px_0_16px] [-webkit-app-region:drag] min-w-0 h-[46px] [border-bottom-color:var(--line)] [border-bottom:0]"><span className="header-title [.chat-switch-btn_&]:min-w-0 [.chat-switch-btn_&]:max-w-[none] font-medium text-body text-soft overflow-hidden text-ellipsis whitespace-nowrap max-w-full cursor-default">{t("Schedules")}</span></header> : <TaskHeader starting={!!startProject || landing} tools={toolButtons} />}
      </div>
      <ResizablePanelGroup orientation="horizontal" id="shell" onLayoutChanged={onShellLayout} resizePreviewMode={terminalShown ? 'separator' : undefined}>
      <SeparatorOverlay className="bg-[var(--pane-border-active)] -translate-x-[1.5px]" style={{ width: 4 }} />
      <ResizablePanel id="sidebar" panelRef={sidebarPanel} collapsible collapsedSize={0} minSize={SIDEBAR_WIDTH_RANGE[0]} maxSize={SIDEBAR_WIDTH_RANGE[1]} defaultSize={preferences.sidebarWidth} onResize={onSidebarResize}>
      <aside id="workspace-sidebar" className="sidebar flex flex-col min-w-0 min-h-0 overflow-hidden mt-[var(--titlebar-h)] h-[calc(100%_-_var(--titlebar-h))] bg-transparent opacity-100 visible" aria-hidden={sidebarHidden} inert={sidebarHidden}>
        <nav className="sidebar-nav flex flex-col gap-px p-[2px_8px_6px] flex-none" aria-label={t("Activity")}>
          <div className="sidebar-actions @container flex items-center gap-1">
            <Button variant="secondary" className="bg-fill hover:bg-fill-hover nav-btn [&:hover:not(:disabled)]:bg-accent [&:hover:not(:disabled)]:[border:none] [&:hover:not(:disabled)]:text-foreground [&.active]:bg-accent [&.active]:text-foreground relative overflow-visible [&_.activity-badge]:[position:static] [&_.activity-badge]:ml-auto [&_.activity-badge]:[box-shadow:none] flex-1 min-w-0 bg-transparent [border:none] rounded-(--radius-row) text-body leading-5 text-soft gap-[9px] min-h-8 p-[5px_8px] justify-start" onClick={() => ws.newTask()}>
              <SquarePen data-icon="inline-start" /> <span className="grow flex-1 min-w-0 truncate text-left">{t("New chat")}</span> <Kbd className="hidden @min-[230px]:inline-flex">{formatKeys('mod+n')}</Kbd>
            </Button>
            <Button variant="secondary" className={`ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center sidebar-mode${preferences.recentChatMode ? ' active' : ''}`} aria-pressed={preferences.recentChatMode} aria-label={preferences.recentChatMode ? t("Group chats by project") : t("Show chats by recent activity")} title={preferences.recentChatMode ? t("Group chats by project") : t("Show chats by recent activity")} onClick={() => void save({ ...preferences, recentChatMode: !preferences.recentChatMode })}>{preferences.recentChatMode ? <Folders size={16} /> : <History size={16} />}</Button>
            <Button variant="ghost" size="icon-sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center sidebar-search" aria-label={t("Search chats")} title={`${t("Search chats")} (${formatKeys('mod+k')})`} onClick={() => setSearchingChats(true)}><Search size={16} /></Button>
          </div>
          <Button variant="secondary" className={`nav-btn [&:hover:not(:disabled)]:bg-accent [&:hover:not(:disabled)]:[border:none] [&:hover:not(:disabled)]:text-foreground [&.active]:bg-accent [&.active]:text-foreground relative overflow-visible [&_.activity-badge]:[position:static] [&_.activity-badge]:ml-auto [&_.activity-badge]:[box-shadow:none] w-full bg-transparent [border:none] rounded-(--radius-row) text-body leading-5 text-soft gap-[9px] min-h-8 p-[5px_8px] justify-start${globalPage ? ' active' : ''}`} aria-pressed={globalPage} onClick={() => ws.setSidebar(globalPage ? 'projects' : 'schedules')}>
            <CalendarClock size={15} /> <span className="grow flex-1 min-w-0 text-left">{t("Schedules")}</span>
          </Button>
        </nav>
        <div className="sidebar-body [&:has(.scm-panel)]:flex [&:has(.scm-panel)]:overflow-hidden [&:has(.explorer-panel)]:flex [&:has(.explorer-panel)]:overflow-hidden flex-1 overflow-auto min-h-0">
          {ui.sidebar !== 'schedules' && <ProjectsPanel />}
          {ui.sidebar === 'schedules' && <ScheduleNavigation />}
        </div>
        <div className="sidebar-footer flex flex-col gap-1.5 p-[6px_8px_8px] flex-none">
          {!sidebarHidden && <UsageFooter />}
          <Button variant="secondary" className="bg-fill hover:bg-fill-hover nav-btn [&:hover:not(:disabled)]:bg-accent [&:hover:not(:disabled)]:[border:none] [&:hover:not(:disabled)]:text-foreground [&.active]:bg-accent [&.active]:text-foreground relative overflow-visible [&_.activity-badge]:[position:static] [&_.activity-badge]:ml-auto [&_.activity-badge]:[box-shadow:none] w-full bg-transparent [border:none] rounded-(--radius-row) text-body leading-5 text-soft gap-[9px] min-h-8 p-[5px_8px] justify-start" aria-label={t("Settings")} title={`${t("Settings")} (${formatKeys('mod+,')})`} onClick={() => { setSettingsSection('appearance'); setSettingsOpen(true) }}><Settings className="size-[calc(var(--font-control)+2px)]" /> <span className="grow flex-1 min-w-0 text-left">{t("Settings")}</span> <Kbd>{formatKeys('mod+,')}</Kbd></Button>
        </div>
      </aside>
      </ResizablePanel>
      {!sidebarHidden && <ResizableHandle aria-label={t("Resize sidebar")} className="bg-transparent" onDoubleClick={() => { sidebarPanel.current?.resize(DEFAULT_SIDEBAR_WIDTH); saveLayout({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH }) }} />}
      <ResizablePanel id="main" minSize={360}>
      <main className="main flex flex-col min-w-0 min-h-0 overflow-hidden mt-[var(--titlebar-h)] mr-[var(--island-gap)] h-[calc(100%_-_var(--titlebar-h)_-_var(--island-gap))] bg-canvas rounded-(--radius-m) [box-shadow:inset_0_1px_0_rgba(255,_255,_255,_0.025),_0_8px_28px_rgba(0,_0,_0,_0.28)]">
        <div className="task-area flex-1 min-h-0 flex">
          {landing && <HomePage />}
          {ui.sidebar === 'schedules' && <SchedulesPage createRequested={createScheduleRequested} onCreateHandled={() => setCreateScheduleRequested(false)} />}
          {startProject && !panes.has(startContext!) && <NewTask projectId={startProject} onProjectChange={(id) => ws.newTask(id)} />}

          {[...panes].map(([workspace, taskId]) => (
            <TaskPane key={workspace} taskId={taskId} visible={!globalPage && !landing && (startProject ? workspace === startContext : ui.activeTaskId === taskId)} />
          ))}
        </div>
        <StatusBar usage={sidebarHidden ? <UsageRings /> : null} />
      </main>
      </ResizablePanel>
      </ResizablePanelGroup>
      {settingsOpen && <SettingsPanel initialSection={settingsSection} initialTarget={settingsTarget} shortcuts={commands.filter((command) => command.keys).map((command) => ({ title: command.title, category: command.category, keys: command.keys! }))} onClose={() => setSettingsOpen(false)} />}
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
    <div className="welcome [&_p]:m-0.5 flex-1 flex flex-col items-center justify-center text-soft gap-1.5">
      <AnimatedMark className="welcome-mark mb-2" size={72} />
      <Wordmark className="wordmark text-[length:48px] font-bold tracking-[-0.05em] text-brand mb-2.5" height={34} />
      <p>{t("Your project. Every repo. One workspace.")}</p>
      <p className="muted text-muted-foreground">{t("Add a repository, or a folder that holds several of them.")}</p>
      <Button variant="default" className="primary bg-primary text-primary-foreground border-transparent font-semibold justify-center hover:bg-primary-hover disabled:bg-raised disabled:text-muted-foreground disabled:opacity-100" disabled={addProject.busy} onClick={() => void addProject.add()}>
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
    { key: 'copy-id', label: t("Copy chat ID"), onSelect: () => void copyText(task.id).catch((reason) => setError(errorText(reason))) },
    { key: 'rename', label: <><Pencil size={14} />{t("Rename")}</>, onSelect: () => setRenaming(true) },
    { key: 'archive', label: <><Archive size={14} />{t("Archive")}</>, onSelect: async () => {
      await invoke('tasks.archive', task.id, true)
      ws.forgetTask(task.id)
      await ws.refresh()
    } },
  ] : [])

  return (
    <header className="task-header [&_button]:[-webkit-app-region:no-drag] [&_input]:[-webkit-app-region:no-drag] [&_.chat-switch-btn:hover_.header-secondary]:text-soft [&_.header-center]:flex [&_.header-center]:items-center [&_.header-center]:gap-2 [&_.header-center]:flex-1 [&_.header-center]:min-w-0 [&_.header-center]:overflow-hidden [&::after]:[content:''] [&::after]:flex-1 [&_.header-title]:relative [&_.header-title]:top-[-1px] [&_.header-title]:leading-[20px] [&_.header-secondary]:relative [&_.header-secondary]:top-[-1px] [&_.header-secondary]:leading-[20px] [&_.header-meta]:relative [&_.header-meta]:top-[-1px] [&_.header-meta]:leading-[20px] [&_.header-meta]:shrink-0 [&_.header-meta]:max-w-[25%] [&_.header-meta]:overflow-hidden [&_.header-meta]:text-ellipsis [&_.chat-switch-btn]:justify-start [&_.chat-switch-btn]:w-[fit-content] [&_.chat-switch-btn]:max-w-[none] [&_.chat-switch-btn]:flex-initial [&_.chat-switch-btn_.header-title]:flex-initial [&_.chat-switch-btn_.header-title]:min-w-0 [&_.chat-switch-btn_.header-title]:max-w-[none] [&_.chat-switch-btn_.header-title]:text-left [&_.chat-switch-btn_.header-secondary]:flex-initial [&_.chat-switch-btn_.header-secondary]:min-w-0 [&_.chat-switch-btn_.header-secondary]:max-w-[none] [&_.chat-switch-btn_.header-secondary]:text-left [&:has(.workspace-tool-buttons)::after]:hidden [&_.workspace-tool-buttons]:ml-auto [&_.header-center_>_svg]:flex-none [&_.header-center_.chat-switch-btn]:max-w-full [&_.header-center_.chat-switch-btn]:min-w-0 flex-none flex items-center gap-2.5 p-[0_12px_0_16px] [-webkit-app-region:drag] min-w-0 h-[46px] [border-bottom-color:var(--line)] [border-bottom:0]" onContextMenu={task ? contextMenu.onContextMenu : undefined}>
      <div className="header-center">
      {(starting || task) && <MessageCircle size={16} className="relative -top-px text-muted-foreground" aria-hidden="true" />}
      {starting && <span className="header-title [.chat-switch-btn_&]:min-w-0 [.chat-switch-btn_&]:max-w-[none] font-medium text-body text-soft overflow-hidden text-ellipsis whitespace-nowrap max-w-full cursor-default">{t("New chat")}</span>}
      {!starting && isProject && project && ctx && <span className="header-title [.chat-switch-btn_&]:min-w-0 [.chat-switch-btn_&]:max-w-[none] font-medium text-body text-soft overflow-hidden text-ellipsis whitespace-nowrap max-w-full cursor-default" title={project.root ?? undefined}>{ws.titleOf(ctx)}</span>}
      {task &&
        (renaming ? (
          <Input
            ref={input}
            className="inline-edit flex-1 min-w-0 p-[2px_6px] text-body font-medium text-soft bg-canvas [border-color:var(--line-strong)] header-edit max-w-[420px] no-drag [-webkit-app-region:no-drag]"
            aria-label={t("Chat title")}
            maxLength={200}
            defaultValue={task.title}
            onBlur={(e) => void rename(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void rename(e.currentTarget.value)
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <span className="header-title [.chat-switch-btn_&]:min-w-0 [.chat-switch-btn_&]:max-w-[none] font-medium text-body text-soft overflow-hidden text-ellipsis whitespace-nowrap max-w-full cursor-default no-drag [-webkit-app-region:no-drag]" title={`${task.title} (${t("Double-click to rename")})`} onDoubleClick={() => setRenaming(true)}>{task.title}</span>
        ))}
      {task?.mode === 'worktree' && <span className="chip tabular-nums text-caption bg-hover rounded-full p-[1px_8px] text-soft whitespace-nowrap header-worktree max-w-[180px] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap" title={t("Active isolated worktree")}>{ws.workspaces.find((workspace) => workspace.id === task.workspaceId)?.name ?? t("Isolated worktree")}</span>}
      {error && <span className="error text-bad small text-caption">{error}</span>}
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
  const busy = useGitBusy(taskId, binding?.repoId)
  const [revision, setRevision] = useState(0)
  const { preferences } = useAppSettings()
  const [syncAll, setSyncAll] = useState(false)
  const autoPullContext = useRef({ taskId, repoId, allowed: false })
  autoPullContext.current = { taskId, repoId, allowed: preferences.autoPull && !busy && !Object.values(ws.dirty).some(Boolean) }
  const autoFetch = useCallback(async () => {
    if (!taskId || !binding || binding.setupState !== 'ready') return
    // Queued with user actions on this repo: skipped while one runs, and a user action that arrives waits for it.
    await withGitBackground(taskId, binding.repoId, async () => {
      await invoke('git.fetch', taskId, binding.repoId)
      try {
        const current = autoPullContext.current
        if (current.allowed && !isGitBusy(taskId, binding.repoId) && current.taskId === taskId && current.repoId === binding.repoId) await invoke('git.autoPull', taskId, binding.repoId)
      } finally {
        window.dispatchEvent(new Event('ramu:git-updated'))
      }
    })
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
    // Like VS Code, skip file-change refreshes while a git operation runs; 'ramu:git-updated' refreshes once it finishes.
    const off = ramu.on('fs:changed', ({ cwd }) => { if (cwd === binding.cwd && !isGitBusy(taskId, binding.repoId)) refresh() })
    window.addEventListener('ramu:git-updated', refresh)
    return () => { disposed = true; off(); clearTimeout(timer); window.removeEventListener('ramu:git-updated', refresh) }
  }, [taskId, binding?.repoId, binding?.cwd, binding?.setupState, revision])

  if (!binding || !taskId) return <footer className="status-bar [&_.strong]:text-soft [&_>_.strong]:flex-none [&_.status-branch]:max-w-[220px] [&_.status-branch]:[border:0] [&_.status-branch]:rounded-(--radius-s) [&_.status-branch]:bg-transparent [&_.status-branch]:text-caption [&_.status-branch]:leading-[18px] [&_.status-branch]:text-soft [&_.status-branch]:w-auto [&_.status-branch]:flex-initial [&_.status-branch]:gap-[5px] [&_.status-branch]:h-[22px] [&_.status-branch]:min-h-[22px] [&_.status-branch]:p-[0_6px] [&_.path]:min-w-0 [&_.path]:overflow-hidden [&_.path]:text-ellipsis [&_.path]:whitespace-nowrap [&_>_.status-project]:max-w-[220px] [&_>_.status-project]:min-w-0 [&_>_.status-project]:overflow-hidden [&_>_.status-project]:text-ellipsis [&_>_.status-project]:whitespace-nowrap [&_>_.status-project]:flex-none [&_>_.status-project]:inline-flex [&_>_.status-project]:items-center [&_>_.status-project]:h-[22px] [&_>_.status-project]:p-[0_6px] [&_>_.status-project]:leading-[18px] [&_[data-slot='select-trigger'].status-branch]:w-auto [&_[data-slot='select-trigger'].status-branch]:flex-initial [&_[data-slot='select-trigger'].status-branch]:gap-[5px] [&_[data-slot='select-trigger'].status-branch]:h-[22px] [&_[data-slot='select-trigger'].status-branch]:min-h-[22px] [&_[data-slot='select-trigger'].status-branch]:p-[0_6px] [&_.status-branch_[data-slot=select-value]]:flex-initial [&_.status-branch_>_svg:last-child]:ml-0 [&_.sync-button]:h-[22px] [&_.sync-button]:min-h-[22px] [&_.sync-button]:p-[0_6px] [&_.sync-button]:gap-[5px] [&_.sync-button]:rounded-(--radius-s) [&_.sync-button]:text-caption [&_.sync-button]:text-soft [&_.sync-button]:tabular-nums [&_.sync-button]:flex-none [&_.sync-button:hover:not(:disabled)]:text-foreground [&_.status-repo]:w-auto [&_.status-repo]:flex-initial [&_.status-repo]:h-[22px] [&_.status-repo]:min-h-[22px] [&_.status-repo]:p-[0_6px] [&_.status-repo]:gap-[5px] [&_.status-repo]:max-w-[240px] [&_.status-repo]:[border:0] [&_.status-repo]:rounded-(--radius-s) [&_.status-repo]:bg-transparent [&_.status-repo]:text-caption [&_.status-repo]:font-semibold [&_[data-slot='select-trigger'].status-repo]:w-auto [&_[data-slot='select-trigger'].status-repo]:flex-initial [&_[data-slot='select-trigger'].status-repo]:h-[22px] [&_[data-slot='select-trigger'].status-repo]:min-h-[22px] [&_[data-slot='select-trigger'].status-repo]:p-[0_6px] [&_[data-slot='select-trigger'].status-repo]:gap-[5px] [&_[data-slot='select-trigger'].status-repo]:max-w-[240px] [&_[data-slot='select-trigger'].status-repo]:[border:0] [&_[data-slot='select-trigger'].status-repo]:rounded-(--radius-s) [&_[data-slot='select-trigger'].status-repo]:bg-transparent [&_[data-slot='select-trigger'].status-repo]:text-caption [&_[data-slot='select-trigger'].status-repo]:font-semibold [&_.status-repo:hover]:bg-hover [&_.status-checkout]:inline-flex [&_.status-checkout]:items-center [&_.status-checkout]:h-[22px] [&_.status-checkout]:p-[0_6px] [&_.status-checkout]:leading-[18px] tabular-nums flex items-center text-caption flex-none text-muted-foreground min-w-0 h-7 bg-transparent gap-0.5 p-[0_6px] [border-top:1px_solid_var(--line)]"><span className="grow flex-1 min-w-0 text-left" />{usage}<BackgroundActivity /></footer>
  const run = async (action: () => Promise<unknown>, needsSaved = false) => {
    try {
      if (needsSaved && Object.values(ws.dirty).some(Boolean)) throw new Error('Save or close unsaved editor buffers before switching branches or pulling.')
      await withGitBusy(taskId, binding.repoId, action)
    } catch (e) { notifyError(errorText(e), `Git · ${binding.repoName}`) }
    finally { setRevision((value) => value + 1); window.dispatchEvent(new Event('ramu:git-updated')) }
  }
  const ready = binding.setupState === 'ready'
  const project = ws.projectOf(taskId)
  return <footer className="status-bar [&_.strong]:text-soft [&_>_.strong]:flex-none [&_.status-branch]:max-w-[220px] [&_.status-branch]:[border:0] [&_.status-branch]:rounded-(--radius-s) [&_.status-branch]:bg-transparent [&_.status-branch]:text-caption [&_.status-branch]:leading-[18px] [&_.status-branch]:text-soft [&_.status-branch]:w-auto [&_.status-branch]:flex-initial [&_.status-branch]:gap-[5px] [&_.status-branch]:h-[22px] [&_.status-branch]:min-h-[22px] [&_.status-branch]:p-[0_6px] [&_.path]:min-w-0 [&_.path]:overflow-hidden [&_.path]:text-ellipsis [&_.path]:whitespace-nowrap [&_>_.status-project]:max-w-[220px] [&_>_.status-project]:min-w-0 [&_>_.status-project]:overflow-hidden [&_>_.status-project]:text-ellipsis [&_>_.status-project]:whitespace-nowrap [&_>_.status-project]:flex-none [&_>_.status-project]:inline-flex [&_>_.status-project]:items-center [&_>_.status-project]:h-[22px] [&_>_.status-project]:p-[0_6px] [&_>_.status-project]:leading-[18px] [&_[data-slot='select-trigger'].status-branch]:w-auto [&_[data-slot='select-trigger'].status-branch]:flex-initial [&_[data-slot='select-trigger'].status-branch]:gap-[5px] [&_[data-slot='select-trigger'].status-branch]:h-[22px] [&_[data-slot='select-trigger'].status-branch]:min-h-[22px] [&_[data-slot='select-trigger'].status-branch]:p-[0_6px] [&_.status-branch_[data-slot=select-value]]:flex-initial [&_.status-branch_>_svg:last-child]:ml-0 [&_.sync-button]:h-[22px] [&_.sync-button]:min-h-[22px] [&_.sync-button]:p-[0_6px] [&_.sync-button]:gap-[5px] [&_.sync-button]:rounded-(--radius-s) [&_.sync-button]:text-caption [&_.sync-button]:text-soft [&_.sync-button]:tabular-nums [&_.sync-button]:flex-none [&_.sync-button:hover:not(:disabled)]:text-foreground [&_.status-repo]:w-auto [&_.status-repo]:flex-initial [&_.status-repo]:h-[22px] [&_.status-repo]:min-h-[22px] [&_.status-repo]:p-[0_6px] [&_.status-repo]:gap-[5px] [&_.status-repo]:max-w-[240px] [&_.status-repo]:[border:0] [&_.status-repo]:rounded-(--radius-s) [&_.status-repo]:bg-transparent [&_.status-repo]:text-caption [&_.status-repo]:font-semibold [&_[data-slot='select-trigger'].status-repo]:w-auto [&_[data-slot='select-trigger'].status-repo]:flex-initial [&_[data-slot='select-trigger'].status-repo]:h-[22px] [&_[data-slot='select-trigger'].status-repo]:min-h-[22px] [&_[data-slot='select-trigger'].status-repo]:p-[0_6px] [&_[data-slot='select-trigger'].status-repo]:gap-[5px] [&_[data-slot='select-trigger'].status-repo]:max-w-[240px] [&_[data-slot='select-trigger'].status-repo]:[border:0] [&_[data-slot='select-trigger'].status-repo]:rounded-(--radius-s) [&_[data-slot='select-trigger'].status-repo]:bg-transparent [&_[data-slot='select-trigger'].status-repo]:text-caption [&_[data-slot='select-trigger'].status-repo]:font-semibold [&_.status-repo:hover]:bg-hover [&_.status-checkout]:inline-flex [&_.status-checkout]:items-center [&_.status-checkout]:h-[22px] [&_.status-checkout]:p-[0_6px] [&_.status-checkout]:leading-[18px] tabular-nums flex items-center text-caption flex-none text-muted-foreground min-w-0 h-7 bg-transparent gap-0.5 p-[0_6px] [border-top:1px_solid_var(--line)]">
    {repos.length > 1
      ? <Dropdown label={t("Repository")} className="status-repo strong font-semibold" value={binding.repoId} options={repos.map((b) => ({ value: b.repoId, label: b.repoName }))} onChange={setPicked} />
      : <span className="strong font-semibold status-project" title={project?.name}>{project && project.name !== binding.repoName ? `${project.name} / ${binding.repoName}` : binding.repoName}</span>}
    <BranchPicker binding={binding} status={status} branches={branches} busy={busy || !ready} className="status-branch" onChange={(branch) => void run(() => invoke('git.checkout', taskId, binding.repoId, branch), true)} />
    <SyncButton status={status} busy={busy || !ready} pullMode={preferences.pullMode} className="status-sync" onSync={() => void run(() => invoke('git.sync', taskId, binding.repoId), true)} />
    {repos.length > 1 && <Button variant="ghost" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover sync-button status-sync-all" title={t("Sync every repository in this workspace")} onClick={() => setSyncAll(true)}><RefreshCcw size={13} /><span>{t("Sync all")}</span></Button>}
    {syncAll && taskId && <WorkspaceSyncDialog taskId={taskId} bindings={repos} onClose={() => setSyncAll(false)} />}
    <span className="status-checkout flex-none text-muted-foreground p-[0_6px_2px]" title={binding.cwd}>{binding.mode === 'current' ? t("Current checkout") : t("Isolated worktree")}</span>
    <span className="grow flex-1 min-w-0 text-left" />
    {usage}
    <BackgroundActivity />
  </footer>
}
