import { ContentSkeleton } from '@/components/content-skeleton'
import { t, useLanguage, formatLocale } from './i18n'
import { FileIcon, fileStyle } from './FileIcon'
import { beginPaneResize } from './paneResize'
import { Button } from '@/components/desktop-button'
import { NO_PROJECT, type Attachment, type FileContext } from '../../shared/types'
import { notifyError } from './Notifications'
import { useModelSets } from './ModelSets'
import { CircleAlert, FileDiff, FileText, GitBranch, History, FileSearch, ChevronsRight, SquareTerminal, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type CSSProperties } from 'react'
import { ChangeReviewTab } from './Changes'
import { DEFAULT_AGENT_SETTINGS, type AgentSettings, type AgentSessionInfo, type ViewDescriptor } from '../../shared/types'
import { formatKeys, type TaskAction } from './commands'
import { AgentControls } from './AgentControls'
import { Composer } from './Composer'
import { Menu, useContextMenu } from './Menu'
import { invoke, ramu, copyText } from './ipc'
import { AgentView } from './views/AgentView'
import { GitDetailsView } from './views/GitDetailsView'
import { DiffView } from './views/DiffView'
import { FileView } from './views/FileView'
import { TerminalPanel } from './TerminalPanel'
import { NewTask } from './NewTask'
import { isPreviewable, isWorkspaceCtx, tabOrder, useWorkspace } from './workspace'


/**
 * Chat fills the workspace until a file or review opens beside it on the right.
 * The left conversation stays mounted throughout review and agent revisions.
 * Files, diffs and terminals remain shared within their checkout.
 */
export function TaskPane({ taskId, visible }: { taskId: string; visible: boolean }) {
  useLanguage()
  const ws = useWorkspace()
  const project = ws.projectOf(taskId)
  const composing = isWorkspaceCtx(taskId) && ws.composing === project?.id
  const workspaceId = ws.workspaceOf(taskId)
  useEffect(() => { void ws.refreshBindings(workspaceId) }, [workspaceId, ws.refreshBindings])
  const state = ws.taskUi[taskId] ?? { views: [], activeViewId: null }
  const bindings = ws.bindings[taskId] ?? []
  const tabs = tabOrder(state.views).filter((v) => v.kind !== 'terminal')
  const agentViews = tabs.filter((v) => v.kind === 'agent')
  const [sessions, setSessions] = useState<AgentSessionInfo[]>([])
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [sessionsLoadedFor, setSessionsLoadedFor] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const [bodyWidth, setBodyWidth] = useState(0)
  useLayoutEffect(() => {
    if (!body.current) return
    const observer = new ResizeObserver(([entry]) => setBodyWidth(entry?.contentRect.width ?? 0))
    observer.observe(body.current)
    return () => observer.disconnect()
  }, [])

  // Palette and shortcut actions that act on this task's own view state.
  useEffect(() => {
    const onAction = (e: Event) => {
      const { taskId: target, action } = (e as CustomEvent<{ taskId: string; action: TaskAction }>).detail
      if (target !== taskId) return
      if (action === 'new-chat') ws.newTask(ws.projectOf(taskId)?.id)
    }
    window.addEventListener('ramu:task-action', onAction)
    return () => window.removeEventListener('ramu:task-action', onAction)
  }, [taskId, ws])

  useEffect(() => {
    let cancelled = false
    setSessions([])
    setSessionsLoadedFor(null)
    setSessionsError(null)
    const load = () => invoke('agent.list', taskId).then((list) => {
      if (!cancelled) { setSessions(list); setSessionsLoadedFor(taskId); setSessionsError(null) }
    }, (error) => { if (!cancelled) { setSessionsError(errorText(error)); notifyError(error) } })
    void load()
    const off = ramu.on('agent:event', ({ event }) => {
      if (event.kind === 'state') void load()
    })
    return () => { cancelled = true; off() }
  }, [taskId])

  const active = tabs.find((v) => v.id === state.activeViewId) ?? tabs.find((v) => v.id === state.activeAgentViewId) ?? null
  const focusedChat = agentViews.find((v) => v.id === state.activeAgentViewId) ?? agentViews.at(-1) ?? null
  // The conversation always stays in the main chat pane beside the active workspace view.
  const editorView = active && active.kind !== 'agent' ? active : null
  const chatView = composing ? null : active?.kind === 'agent' ? active : editorView ? focusedChat : null
  const showLauncherMain = !editorView && !chatView
  const terminalOpen = (ws.taskUi[workspaceId]?.views.some((view) => view.kind === 'terminal') ?? false) && (ws.taskUi[workspaceId]?.terminalOpen ?? true)
  const terminalDock = state.terminalDock ?? (editorView ? 'bottom' : 'right')
  const rightTerminal = terminalOpen && terminalDock === 'right' && !composing
  const bottomTerminal = terminalOpen && terminalDock === 'bottom' && !composing
  const workspaceOpen = (!!editorView || rightTerminal) && !composing
  const maxChatShare = rightTerminal && editorView ? .5 : .7
  const defaultChatShare = rightTerminal && editorView ? .4 : .55
  const maxChatWidth = bodyWidth * maxChatShare
  const minChatWidth = Math.min(320, maxChatWidth)
  const chatWidth = Math.min(state.dockWidth ?? bodyWidth * defaultChatShare, maxChatWidth)

  // A saved chat may not have a saved view yet. Restore its conversation before
  // showing a composer for a session that does not exist.
  useLayoutEffect(() => {
    if (!visible || isWorkspaceCtx(taskId) || sessionsLoadedFor !== taskId || agentViews.length || !sessions.length) return
    const latest = sessions.reduce((a, b) => a.createdAt > b.createdAt ? a : b)
    ws.openView(taskId, { kind: 'agent', sessionId: latest.id })
    if (editorView) ws.activateView(taskId, editorView.id)
  }, [visible, taskId, sessionsLoadedFor, sessions, agentViews.length, editorView?.id, ws.openView, ws.activateView])

  // Switching conversations focuses their composer without moving focus during streaming.
  useLayoutEffect(() => {
    if (!visible || (!chatView && !showLauncherMain)) return
    const frame = requestAnimationFrame(() => {
      const input = Array.from(body.current?.querySelectorAll<HTMLElement>('.main-chat [data-composer-input]') ?? []).find((element) => element.getClientRects().length > 0)
      input?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [visible, taskId, chatView?.id, showLauncherMain, composing])

  const repoName = (repoId?: string) => (repoId ? (ws.binding(taskId, repoId)?.repoName ?? '?') : 'workspace')
  const openSession = (s: AgentSessionInfo) => {
    ws.openView(taskId, { kind: 'agent', sessionId: s.id })
    if (editorView) ws.activateView(taskId, editorView.id)
  }

  const retrySetup = async () => {
    setRetrying(true)
    try {
      await invoke('tasks.setup', taskId)
      await ws.refreshBindings(taskId)
    } finally {
      setRetrying(false)
    }
  }

  const resizeCleanup = useRef<(() => void) | null>(null)
  useEffect(() => () => resizeCleanup.current?.(), [])
  // Resize the main conversation without replacing its transcript or composer.
  const startResize = (event: ReactPointerEvent) => {
    resizeCleanup.current?.()
    const rect = body.current!.getBoundingClientRect()
    resizeCleanup.current = beginPaneResize(event, 'column', (next) => ws.setDockWidth(taskId, Math.min(Math.max(next.clientX - rect.left, Math.min(320, rect.width * maxChatShare)), rect.width * maxChatShare)))
  }

  const unfinished = bindings.filter((b) => b.setupState !== 'ready')

  return (
    <section className="task-pane flex-1 flex-col min-w-0 min-h-0" style={{ display: visible ? 'flex' : 'none' }}>
      {unfinished.length > 0 && (
        <div className="banner [&.warn]:[background:var(--warn-wash)] [&.warn]:text-warn [&_button]:text-control [&_button]:p-[2px_8px] p-[7px_12px] flex gap-2 items-center text-control warn text-warn">
          <CircleAlert size={14} />
          <span className="grow flex-1 min-w-0 text-left">
            {t("Worktree setup didn't finish for ")}{unfinished.map((b) => b.repoName).join(', ')}.
            {unfinished[0]?.setupError && <span className="muted text-muted-foreground"> {unfinished[0].setupError}</span>}
          </span>
          <Button variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={retrySetup} disabled={retrying}>
            {retrying ? t("Retrying…") : t("Retry setup")}
          </Button>
        </div>
      )}
      <div className={`task-body [&_>_.view-tabs]:[grid-column:1] [&_>_.view-tabs]:[grid-row:1] [&_>_.editor-area]:[grid-column:1] [&_>_.editor-area]:[grid-row:2] [&_>_.editor-area]:min-h-0 [&_>_.terminal-panel]:min-w-0 [&_>_.terminal-panel]:min-h-0 [&_>_.terminal-panel]:w-full [&_>_.terminal-panel]:self-stretch [&_>_.terminal-panel]:h-full! [&_>_.terminal-panel]:max-h-[none] [&_>_.terminal-panel]:overflow-hidden [&_>_.main-chat]:[grid-column:1] [&_>_.main-chat]:[grid-row:1] [&_>_.main-chat]:min-h-0 [&_>_.main-chat]:overflow-hidden [&.with-editor]:[grid-template-columns:minmax(0,_min(var(--chat-width,_55%),_70%))_0_minmax(0,_1fr)] [&.with-editor_>_.view-tabs]:[grid-column:3] [&.with-editor_>_.editor-area]:[grid-column:3] [&.with-editor_>_.splitter]:[justify-self:center] [&.with-editor_>_.splitter]:[grid-column:2] [&.with-editor_>_.splitter]:[grid-row:1] [&.with-editor_>_.main-chat]:[grid-column:1] [&.with-editor_>_.main-chat]:[grid-row:1] [&.with-editor_>_.main-chat]:min-h-0 [&.with-editor_>_.main-chat]:overflow-hidden [&_>_.workspace-panel]:[grid-column:3] [&_>_.workspace-panel]:[grid-row:1] [&_>_.workspace-panel]:flex [&_>_.workspace-panel]:flex-col [&_>_.workspace-panel]:min-w-0 [&_>_.workspace-panel]:min-h-0 [&_>_.workspace-panel]:overflow-hidden [&_>_.terminal-panel.dock-bottom]:[grid-column:1_/_-1] [&_>_.terminal-panel.dock-bottom]:[grid-row:2] [&_>_.terminal-panel.dock-right]:[grid-column:3] [&_>_.terminal-panel.dock-right]:[grid-row:1] [&_>_.terminal-panel.dock-right]:[border-top:0] [&_>_.terminal-panel.dock-right]:[border-left:var(--pane-border-width)_solid_var(--pane-border-color)] [&.terminal-with-editor_>_.terminal-panel.dock-right]:[grid-column:4] flex-1 grid min-h-0 min-w-0 relative [container-type:inline-size] [--chat-share:100%] [grid-template-columns:minmax(0,_var(--chat-share))_0_minmax(0,_1fr)] [grid-template-rows:minmax(0,_1fr)] [transition:--chat-share_var(--motion-layout)_var(--motion-curve)] ${workspaceOpen ? ' with-editor' : ''}${rightTerminal ? ' terminal-right' : ''}${rightTerminal && editorView ? ' terminal-with-editor' : ''}${bottomTerminal ? ' terminal-bottom' : ''}`} style={{ '--chat-width': state.dockWidth ? `${state.dockWidth}px` : `${defaultChatShare * 100}%`, '--terminal-height': `${state.terminalHeight ?? 260}px` } as CSSProperties} ref={body}>
      <div className="workspace-panel" inert={!editorView || composing} aria-hidden={!editorView || composing}>
      <div className="view-tabs [.workspace-panel_>_&]:flex-none flex items-center flex-none overflow-x-auto [scrollbar-width:none] p-[5px_8px] [border-bottom-color:var(--line)] [border-bottom:0] gap-1" role="tablist" aria-label={t("Workspace tabs")} style={{ display: editorView ? 'flex' : 'none' }}>
        {tabs.filter((v) => v.kind !== 'agent').map((view) => <FileTab key={view.id} taskId={taskId} view={view} tabs={tabs} active={state.activeViewId === view.id} repoName={repoName} />)}
        <Button variant="ghost" size="icon-sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center" aria-label={t("Open file")} title={`${t("Open file")} (${formatKeys('mod+p')})`} onClick={() => window.dispatchEvent(new Event('ramu:open-file'))}><FileSearch size={16} /></Button>
        <div className="grow flex-1 min-w-0 text-left" />
        {editorView && !composing && <Button variant="ghost" size="icon-sm" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center" aria-label={t("Hide workspace")} title={t("Hide workspace")} onClick={() => ws.hideWorkspace(taskId)}><ChevronsRight size={15} /></Button>}

      </div>
        <div className="editor-area [.workspace-panel_>_&]:flex-1 [.workspace-panel_>_&]:min-h-0 flex-1 min-w-0 flex flex-col" style={{ display: editorView ? 'flex' : 'none' }}>
          {tabs
            .filter((v) => v.kind !== 'agent')
            .map((v) => {
              const shown = editorView?.id === v.id && visible
              const binding = v.repoId ? ws.binding(workspaceId, v.repoId) : undefined
              const ready = v.kind === 'review' || binding?.setupState === 'ready'
              return (
                <div key={v.id} className="view flex-1 min-w-0 min-h-0 flex-col" style={{ display: shown ? 'flex' : 'none' }}>
                  {!ready ? (
                    <div className="empty flex flex-1 items-center justify-center text-muted-foreground p-6 text-center">{t("This repository isn't ready yet.")}</div>
                  ) : (
                    <VisitedView visible={shown}>
                      {v.kind === 'file' && binding && <FileView taskId={workspaceId} view={v} binding={binding} />}
                      {v.kind === 'diff' && binding && <DiffView taskId={workspaceId} view={v} binding={binding} />}
                      {v.kind === 'review' && <ChangeReviewTab view={v} visible={shown} />}
                      {v.kind === 'git' && binding && <GitDetailsView taskId={workspaceId} view={v} binding={binding} />}
                    </VisitedView>
                  )}
                </div>
              )
            })}
        </div>
      </div>
        {workspaceOpen && <div className="splitter [&::after]:[content:''] [&::after]:absolute [&::after]:[transition:background_0.15s] [&::after]:inset-[0_4px] [&::after]:w-[var(--pane-border-width)] [&::after]:[background:var(--pane-border-color)] [&:hover::after]:w-px [&:hover::after]:[background:var(--pane-border-active)] [&.is-resizing::after]:w-px [&.is-resizing::after]:[background:var(--pane-border-active)] [&:focus-visible::after]:[background:var(--pane-border-active)] flex-none cursor-col-resize relative z-2 w-[9px] m-[0_-4px]" role="separator" tabIndex={0} aria-label={t("Resize chat pane")} aria-orientation="vertical" aria-valuemin={Math.round(minChatWidth)} aria-valuemax={Math.round(maxChatWidth)} aria-valuenow={Math.round(chatWidth)} onPointerDown={startResize} onDoubleClick={() => ws.setDockWidth(taskId, bodyWidth * defaultChatShare)} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const max = maxChatWidth
          const min = Math.min(320, max)
          const value = event.key === 'Home' ? min : event.key === 'End' ? max : chatWidth + (event.key === 'ArrowRight' ? 20 : -20)
          ws.setDockWidth(taskId, Math.max(min, Math.min(max, value)))
        }} />}
        <div className="main-chat [&_>_.home-page]:flex-1 [&_>_.home-page]:min-h-0 flex-1 min-w-0 flex-col bg-canvas" style={{ display: 'flex' }}>
          {(showLauncherMain || (editorView && !chatView)) && isWorkspaceCtx(taskId) && (
            <NewTask projectId={project?.id ?? ''} onProjectChange={(id) => ws.newTask(id)} feed={!editorView} />
          )}
          {sessionsError && !chatView && <p role="alert" className="p-4 text-bad">{sessionsError}</p>}
          {!isWorkspaceCtx(taskId) && !chatView && !sessionsError && sessionsLoadedFor !== taskId && <ContentSkeleton variant="cards" rows={2} />}
          {(showLauncherMain || (editorView && !chatView)) && !isWorkspaceCtx(taskId) && sessionsLoadedFor === taskId && !sessions.length && (
            <NewChat
              taskId={taskId}
              onStarted={(s) => {
                setSessions((list) => [...list.filter((x) => x.id !== s.id), s])
                ws.openView(taskId, { kind: 'agent', sessionId: s.id })
                void ws.refresh()
              }}
            />
          )}
          {agentViews.map((v) =>
            v.kind === 'agent' ? (
              <div key={v.id} className="view flex-1 min-w-0 min-h-0 flex-col" style={{ display: chatView?.id === v.id ? 'flex' : 'none' }}>
                <AgentView view={v} visible={visible && chatView?.id === v.id} history={sessions.length > 1 ? <Menu label={t("Earlier conversations")} icon={<History size={14} />} className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" align="end" items={[...sessions].sort((a, b) => b.createdAt - a.createdAt).map(session => ({ key: session.id, selected: session.id === v.sessionId, label: <><span className="menu-label [.chat-switch-menu_&]:flex-1 [.chat-switch-menu_&]:max-w-[none] [.chat-switch-menu_&]:leading-[18px] [.chat-switch-menu_&]:font-medium [.chat-switch-menu_&]:min-w-0 [.dropdown-menu_&]:min-w-0 [.dropdown-menu_&]:max-w-[none] [.dropdown-menu_&]:whitespace-nowrap [.project-switch-menu_&]:max-w-[none] [.project-switch-menu_&]:leading-[18px] [.project-switch-menu_&]:font-medium [.project-switch-menu_&]:min-w-0 [.project-switch-menu_&_.block]:max-w-[none] [.project-switch-menu_&_.block]:overflow-hidden [.project-switch-menu_&_.block]:text-ellipsis [.project-switch-menu_&_.block]:whitespace-nowrap [.project-switch-menu_&_.block]:m-[2px_0_0] [.project-switch-menu_&_.block]:text-caption [.project-switch-menu_&_.block]:leading-[16px] [.project-switch-menu_&_.block]:font-normal [.project-switch-menu_&_.block]:text-muted-foreground [.chat-switch-menu_&_.block]:overflow-hidden [.chat-switch-menu_&_.block]:text-ellipsis [.chat-switch-menu_&_.block]:whitespace-nowrap [.chat-switch-menu_&_.block]:m-[2px_0_0] [.chat-switch-menu_&_.block]:text-caption [.chat-switch-menu_&_.block]:leading-[16px] [.chat-switch-menu_&_.block]:font-normal [.chat-switch-menu_&_.block]:text-muted-foreground max-w-[220px] overflow-hidden text-ellipsis grow flex-1 min-w-0 text-left">{session.title}</span><span className="muted text-muted-foreground small text-caption">{new Date(session.createdAt).toLocaleDateString(formatLocale())}</span></>, onSelect: () => openSession(session) }))} /> : undefined} />
              </div>
            ) : null,
          )}
        </div>
        <TerminalPanel taskId={workspaceId} visible={visible} hidden={composing} dock={terminalDock} />
      </div>
    </section>
  )
}

/** Restore tab state without constructing editors for tabs the user has not opened. */
function VisitedView({ visible, children }: { visible: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(visible)
  useEffect(() => { if (visible) setVisited(true) }, [visible])
  return visible || visited ? children : null
}

function NewChat({
  taskId,
  onStarted,
}: {
  taskId: string
  onStarted: (s: AgentSessionInfo) => void
}) {
  useLanguage()
  const ws = useWorkspace()
  const bindings = ws.bindings[taskId] ?? []
  const { initialSettings } = useModelSets()
  const [settings, setSettings] = useState<AgentSettings>(initialSettings)
  useEffect(() => setSettings(initialSettings), [initialSettings.provider, initialSettings.model, initialSettings.effort, initialSettings.access, initialSettings.autoFallback])
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ready = ws.task(taskId)?.projectId === NO_PROJECT || bindings.length > 0 && bindings.every((b) => b.setupState === 'ready')

  const start = async (context: FileContext[] = []) => {
    setBusy(true)
    setError(null)
    try {
      onStarted(await invoke('agent.start', taskId, prompt, settings, attachments.map((file) => file.id), context))
      setPrompt('')
      setAttachments([])
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="new-chat [&_.composer]:w-full flex-1 flex overflow-auto p-6">
      <div className="new-chat-inner m-[auto_auto_0] w-full max-w-[var(--chat-column-width)] flex flex-col gap-2.5">
        <Composer
          attachments={attachments}
          onAttachmentsChange={setAttachments}
          autoFocus
          controls={<AgentControls settings={settings} onChange={setSettings} disabled={busy} />}
          value={prompt}
          onChange={setPrompt}
          onSubmit={start}
          disabled={busy || !ready}
          placeholder={t("What should the agent do?")}
          submitLabel="Start session"
        />
        {error && <div className="error text-bad">{error}</div>}
      </div>
    </div>
  )
}

function FileTab({ taskId, view, tabs, active, repoName }: { taskId: string; view: ViewDescriptor; tabs: ViewDescriptor[]; active: boolean; repoName: (repoId?: string) => string }) {
  useLanguage()
  const ws = useWorkspace()
  const files = tabs.filter((tab) => tab.kind === 'file' || tab.kind === 'diff' || tab.kind === 'git' || tab.kind === 'review')
  const index = files.findIndex((tab) => tab.id === view.id)
  const others = files.filter((tab) => tab.id !== view.id)
  const toLeft = files.slice(0, index)
  const toRight = files.slice(index + 1)
  const saved = files.filter((tab) => !ws.dirty[tab.id])
  const close = (views: ViewDescriptor[]) => ws.closeViews(taskId, views.map((tab) => tab.id))
  const context = useContextMenu('Tab actions', [
    ...(isPreviewable(view) && view.preview ? [{ key: 'keep', label: t("Keep Open"), onSelect: () => ws.keepView(taskId, view.id) }] : []),
    { key: 'close', label: t("Close"), onSelect: () => ws.closeView(taskId, view.id) },
    { key: 'others', label: t("Close Others"), disabled: !others.length, onSelect: () => close(others) },
    { key: 'left', label: t("Close to the Left"), disabled: !toLeft.length, onSelect: () => close(toLeft) },
    { key: 'right', label: t("Close to the Right"), disabled: !toRight.length, onSelect: () => close(toRight) },
    { key: 'separator', separator: true },
    { key: 'saved', label: t("Close Saved Tabs"), disabled: !saved.length, onSelect: () => close(saved) },
    { key: 'all', label: t("Close All"), onSelect: () => close(files) },
    { key: 'reopen', label: t("Reopen Closed Editor"), onSelect: () => ws.reopenClosedView(taskId) },
    { key: 'reveal-separator', separator: true },
    ...(view.kind === 'file' || view.kind === 'diff' ? [{ key: 'copy-path', label: t("Copy Relative Path"), onSelect: () => { void copyText(view.path).catch((reason) => notifyError(errorText(reason), 'Copy path')) } }] : []),
    { key: 'reveal', label: t("Reveal in Explorer"), disabled: view.kind !== 'file' && view.kind !== 'diff', onSelect: () => {
      ws.activateView(taskId, view.id)
      ws.setSidebar('explorer')
      window.dispatchEvent(new Event('ramu:show-explorer'))
    } },
  ])
  return <div className="tab-slot flex items-center flex-none">
    <div role="tab" tabIndex={active ? 0 : -1} aria-selected={active} className={`view-tab bg-fill [&:hover_.tab-close]:opacity-100 [&_.tab-title]:max-w-[180px] [&:hover]:bg-fill-hover [&:hover]:text-soft [&.active]:text-foreground [&.active]:bg-accent [&.active]:[box-shadow:none] [&_.kind:not(.file-kind)]:text-muted-foreground [&_.kind]:flex-none [&.partner]:text-soft [&.partner]:[box-shadow:inset_0_-2px_0_var(--line-strong)] [&.pinned]:font-medium [&.active_.kind:not(.file-kind)]:text-foreground [&.preview_.tab-label]:[font-style:italic] [&.preview_.view-label]:[font-style:italic] [&.preview]:[font-style:italic] [border-color:transparent] [&:hover:not(:disabled)]:[border-color:transparent] [&:focus-visible]:[outline-color:var(--line-strong)] [&_.tab-close]:w-[18px] [&_.tab-close]:h-[18px] [&_.tab-close]:min-w-[18px] [&_.tab-close]:min-h-[18px] [&_.tab-close]:p-0 [&_.tab-close]:inline-grid [&_.tab-close]:place-items-center [&_.tab-close]:rounded-(--radius-xs) [&_.tab-close]:bg-transparent [&_.tab-close]:[border:0] [&_.tab-close]:[box-shadow:none] [&_.tab-close]:flex-none [&_.tab-close:hover:not(:disabled)]:bg-accent [&_.tab-close:hover:not(:disabled)]:text-foreground [&_.tab-close_svg]:w-3 [&_.tab-close_svg]:h-3 flex items-center gap-1.5 cursor-default whitespace-nowrap text-muted-foreground text-control [transition:background_0.12s_var(--ease),_color_0.12s_var(--ease)] h-[27px] rounded-(--radius-s) p-[0_5px_0_9px] ${active ? ' active' : ''}${isPreviewable(view) && view.preview ? ' preview' : ''}`} title={isPreviewable(view) && view.preview ? t("Preview: opening another file replaces this tab. Double-click or edit to keep it open.") : undefined} onDoubleClick={() => ws.keepView(taskId, view.id)} onContextMenu={context.onContextMenu} onKeyDown={(event) => { context.onKeyDown(event); if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); ws.activateView(taskId, view.id) } }} onClick={() => ws.activateView(taskId, view.id)} onAuxClick={(event) => event.button === 1 && ws.closeView(taskId, view.id)}>
      <ViewIcon kind={view.kind} path={view.kind === 'file' || view.kind === 'diff' ? view.path : undefined} />
      <ViewLabel view={view} all={tabs} repoName={repoName} />
      {ws.dirty[view.id] && <span className="dirty w-[7px] h-[7px] rounded-full [background:var(--soft)] flex-none" aria-label={t("Unsaved changes")} />}
      <Button variant="secondary" className="bg-fill hover:bg-fill-hover tab-close [&:hover:not(:disabled)]:bg-accent [&:hover:not(:disabled)]:[border:none] [&:hover:not(:disabled)]:text-foreground [.active_>_&]:opacity-100 bg-transparent [border:none] rounded-(--radius-s) p-0.5 text-muted-foreground opacity-0" aria-label={t("Close view")} onClick={(event) => { event.stopPropagation(); ws.closeView(taskId, view.id) }}><X size={12} /></Button>
    </div>
    {context.menu}
  </div>
}

function ViewIcon({ kind, path }: { kind: ViewDescriptor['kind']; path?: string }) {
  useLanguage()
  if (kind === 'git') return <GitBranch size={13} className="kind" />
  if (kind === 'review') return <FileDiff size={13} className="kind" />
  if (kind === 'diff') return <FileDiff size={13} className={path ? `kind file-kind ${fileStyle(path)[1]}` : 'kind'} />
  if (kind === 'terminal') return <SquareTerminal size={13} className="kind" />
  return path ? <FileIcon path={path} size={13} className="kind file-kind" /> : <FileText size={13} className="kind" />
}

function basename(p: string): string {
  return p.split('/').pop() || p
}

/** File name, plus the repository when another open file has the same name. */
function ViewLabel({ view: v, all, repoName }: { view: ViewDescriptor; all: ViewDescriptor[]; repoName: (repoId?: string) => string }) {
  useLanguage()
  const ws = useWorkspace()
  if (v.kind === 'agent') return <>{t("Chat")}</>
  if (v.kind === 'terminal') return <>{v.title ?? repoName(v.repoId)}</>
  if (v.kind === 'review') return <>{t("Changes")}<span className="tab-repo text-muted-foreground text-caption">{ws.task(v.taskId)?.title ?? t("Chat")}</span></>
  if (v.kind === 'git') return <>{v.oid ? v.oid.slice(0, 7) : t("Compare with upstream")}<span className="tab-repo text-muted-foreground text-caption">{repoName(v.repoId)}</span></>
  const name = basename(v.path)
  const clash = all.some(
    (o) => o.id !== v.id && (o.kind === 'file' || o.kind === 'diff') && basename(o.path) === name && o.repoId !== v.repoId,
  )
  return (
    <>
      {name}
      {clash && <span className="tab-repo text-muted-foreground text-caption">{repoName(v.repoId)}</span>}
      {v.kind === 'diff' && <span className="tab-repo text-muted-foreground text-caption">{v.oid ? v.oid.slice(0, 7) : v.staged ? 'staged' : t("changes")}</span>}
    </>
  )
}

export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  // Electron prefixes errors thrown in handlers.
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
