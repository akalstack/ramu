import { t, useLanguage, formatLocale } from './i18n'
import { beginPaneResize } from './paneResize'
import { Button } from '@/components/ui/button'
import { NO_PROJECT, type Attachment, type FileContext } from '../../shared/types'
import { notifyError } from './Notifications'
import { useModelSets } from './ModelSets'
import { CircleAlert, FileDiff, FileText, GitBranch, History, FileSearch, PanelRightClose, SquareTerminal, X } from 'lucide-react'
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
    const load = () => invoke('agent.list', taskId).then((list) => {
      if (!cancelled) { setSessions(list); setSessionsLoadedFor(taskId) }
    }, (error) => { if (!cancelled) notifyError(error) })
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
      const input = Array.from(body.current?.querySelectorAll<HTMLTextAreaElement>('.main-chat .composer textarea') ?? []).find((element) => element.getClientRects().length > 0)
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
    <section className="task-pane" style={{ display: visible ? 'flex' : 'none' }}>
      {unfinished.length > 0 && (
        <div className="banner warn">
          <CircleAlert size={14} />
          <span className="grow">
            {t("Worktree setup didn't finish for ")}{unfinished.map((b) => b.repoName).join(', ')}.
            {unfinished[0]?.setupError && <span className="muted"> {unfinished[0].setupError}</span>}
          </span>
          <Button onClick={retrySetup} disabled={retrying}>
            {retrying ? t("Retrying…") : t("Retry setup")}
          </Button>
        </div>
      )}
      <div className={`task-body${workspaceOpen ? ' with-editor' : ''}${rightTerminal ? ' terminal-right' : ''}${rightTerminal && editorView ? ' terminal-with-editor' : ''}${bottomTerminal ? ' terminal-bottom' : ''}`} style={{ '--chat-width': state.dockWidth ? `${state.dockWidth}px` : `${defaultChatShare * 100}%`, '--terminal-height': `${state.terminalHeight ?? 260}px` } as CSSProperties} ref={body}>
      <div className="workspace-panel" inert={!editorView || composing} aria-hidden={!editorView || composing}>
      <div className="view-tabs" role="tablist" aria-label={t("Workspace tabs")} style={{ display: editorView ? 'flex' : 'none' }}>
        {tabs.filter((v) => v.kind !== 'agent').map((view) => <FileTab key={view.id} taskId={taskId} view={view} tabs={tabs} active={state.activeViewId === view.id} repoName={repoName} />)}
        <Button className="ghost icon" aria-label={t("Open file")} title={`${t("Open file")} (${formatKeys('mod+p')})`} onClick={() => window.dispatchEvent(new Event('ramu:open-file'))}><FileSearch size={16} /></Button>
        <div className="grow" />

        {editorView && !composing && (
          <Button
            className="ghost icon"
            aria-label={t("Hide workspace")}
            title={t("Hide workspace")}
            onClick={() => { ws.showChat(taskId); ws.setTerminalPanel(taskId, { terminalOpen: false }); ws.setSidebar('projects') }}
          >
            <PanelRightClose size={15} />
          </Button>
        )}
      </div>
        <div className="editor-area" style={{ display: editorView ? 'flex' : 'none' }}>
          {tabs
            .filter((v) => v.kind !== 'agent')
            .map((v) => {
              const shown = editorView?.id === v.id && visible
              const binding = v.repoId ? ws.binding(workspaceId, v.repoId) : undefined
              const ready = v.kind === 'review' || binding?.setupState === 'ready'
              return (
                <div key={v.id} className="view" style={{ display: shown ? 'flex' : 'none' }}>
                  {!ready ? (
                    <div className="empty">{t("This repository isn't ready yet.")}</div>
                  ) : (
                    <>
                      {v.kind === 'file' && binding && <FileView taskId={workspaceId} view={v} binding={binding} />}
                      {v.kind === 'diff' && binding && <DiffView taskId={workspaceId} view={v} binding={binding} />}
                      {v.kind === 'review' && <ChangeReviewTab view={v} visible={shown} />}
                      {v.kind === 'git' && binding && <GitDetailsView taskId={workspaceId} view={v} binding={binding} />}
                    </>
                  )}
                </div>
              )
            })}
        </div>
      </div>
        {workspaceOpen && <div className="splitter" role="separator" tabIndex={0} aria-label={t("Resize chat pane")} aria-orientation="vertical" aria-valuemin={Math.round(minChatWidth)} aria-valuemax={Math.round(maxChatWidth)} aria-valuenow={Math.round(chatWidth)} onPointerDown={startResize} onDoubleClick={() => ws.setDockWidth(taskId, bodyWidth * defaultChatShare)} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const max = maxChatWidth
          const min = Math.min(320, max)
          const value = event.key === 'Home' ? min : event.key === 'End' ? max : chatWidth + (event.key === 'ArrowRight' ? 20 : -20)
          ws.setDockWidth(taskId, Math.max(min, Math.min(max, value)))
        }} />}
        <div className="main-chat" style={{ display: 'flex' }}>
          {(showLauncherMain || (editorView && !chatView)) && isWorkspaceCtx(taskId) && (
            <NewTask projectId={project?.id ?? ''} onProjectChange={(id) => ws.newTask(id)} feed={!editorView} />
          )}
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
              <div key={v.id} className="view" style={{ display: chatView?.id === v.id ? 'flex' : 'none' }}>
                <AgentView view={v} history={sessions.length > 1 ? <Menu label={t("Earlier conversations")} icon={<History size={14} />} className="ghost icon small-icon" align="end" items={[...sessions].sort((a, b) => b.createdAt - a.createdAt).map(session => ({ key: session.id, selected: session.id === v.sessionId, label: <><span className="menu-label grow">{session.title}</span><span className="muted small">{new Date(session.createdAt).toLocaleDateString(formatLocale())}</span></>, onSelect: () => openSession(session) }))} /> : undefined} />
              </div>
            ) : null,
          )}
        </div>
        <TerminalPanel taskId={workspaceId} visible={visible} hidden={composing} dock={terminalDock} />
      </div>
    </section>
  )
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
    <div className="new-chat">
      <div className="new-chat-inner">
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
        {error && <div className="error">{error}</div>}
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
  return <div className="tab-slot">
    <div role="tab" tabIndex={active ? 0 : -1} aria-selected={active} className={`view-tab${active ? ' active' : ''}${isPreviewable(view) && view.preview ? ' preview' : ''}`} title={isPreviewable(view) && view.preview ? t("Preview: opening another file replaces this tab. Double-click or edit to keep it open.") : undefined} onDoubleClick={() => ws.keepView(taskId, view.id)} onContextMenu={context.onContextMenu} onKeyDown={(event) => { context.onKeyDown(event); if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); ws.activateView(taskId, view.id) } }} onClick={() => ws.activateView(taskId, view.id)} onAuxClick={(event) => event.button === 1 && ws.closeView(taskId, view.id)}>
      <ViewIcon kind={view.kind} />
      <ViewLabel view={view} all={tabs} repoName={repoName} />
      {ws.dirty[view.id] && <span className="dirty" aria-label={t("Unsaved changes")} />}
      <Button className="tab-close" aria-label={t("Close view")} onClick={(event) => { event.stopPropagation(); ws.closeView(taskId, view.id) }}><X size={12} /></Button>
    </div>
    {context.menu}
  </div>
}

function ViewIcon({ kind }: { kind: ViewDescriptor['kind'] }) {
  useLanguage()
  if (kind === 'git') return <GitBranch size={13} className="kind" />
  if (kind === 'review') return <FileDiff size={13} className="kind" />
  if (kind === 'diff') return <FileDiff size={13} className="kind" />
  if (kind === 'terminal') return <SquareTerminal size={13} className="kind" />
  return <FileText size={13} className="kind" />
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
  if (v.kind === 'review') return <>{t("Changes")}<span className="tab-repo">{ws.task(v.taskId)?.title ?? t("Chat")}</span></>
  if (v.kind === 'git') return <>{v.oid ? v.oid.slice(0, 7) : t("Compare with upstream")}<span className="tab-repo">{repoName(v.repoId)}</span></>
  const name = basename(v.path)
  const clash = all.some(
    (o) => o.id !== v.id && (o.kind === 'file' || o.kind === 'diff') && basename(o.path) === name && o.repoId !== v.repoId,
  )
  return (
    <>
      {name}
      {clash && <span className="tab-repo">{repoName(v.repoId)}</span>}
      {v.kind === 'diff' && <span className="tab-repo">{v.oid ? v.oid.slice(0, 7) : v.staged ? 'staged' : t("changes")}</span>}
    </>
  )
}

export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  // Electron prefixes errors thrown in handlers.
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
