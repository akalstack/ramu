import { beginPaneResize } from './paneResize'
import { Button } from '@/components/ui/button'
import { NO_PROJECT, type Attachment, type FileContext } from '../../shared/types'
import { notifyError } from './Notifications'
import { useModelSets } from './ModelSets'
import { useAppSettings } from './AppSettings'
import { CircleAlert, FileDiff, FileText, GitBranch, History, MessageSquare, MessageSquarePlus, PanelRightClose, PanelRightOpen, Plus, SquareTerminal, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { ChangeReviewTab } from './Changes'
import { DEFAULT_AGENT_SETTINGS, type AgentSettings, type AgentSessionInfo, type RepositoryBinding, type ViewDescriptor } from '../../shared/types'
import type { TaskAction } from './commands'
import { AgentControls } from './AgentControls'
import { ChatSwitcher } from './ChatSwitcher'
import { Composer } from './Composer'
import { Menu, useContextMenu, type MenuEntry } from './Menu'
import { invoke, ramu, copyText } from './ipc'
import { AgentView } from './views/AgentView'
import { GitDetailsView } from './views/GitDetailsView'
import { DiffView } from './views/DiffView'
import { FileView } from './views/FileView'
import { TerminalPanel } from './TerminalPanel'
import { NewTask } from './NewTask'
import { isWorkspaceCtx, tabOrder, useWorkspace } from './workspace'

const DEFAULT_DOCK = 440

/**
 * One persistent Chat tab, then shared checkout files and diffs. Terminals live in a bottom panel.
 * A conversation tab fills the task. Any other tab shows on the left with the last
 * focused conversation docked on the right, so the agent stays visible during review.
 */
export function TaskPane({ taskId, visible }: { taskId: string; visible: boolean }) {
  const ws = useWorkspace()
  const { preferences } = useAppSettings()
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
  const dockHidden = state.dockHidden ?? !preferences.defaultChatDockOpen
  const [retrying, setRetrying] = useState(false)
  const body = useRef<HTMLDivElement>(null)

  // Palette and shortcut actions that act on this task's own view state.
  useEffect(() => {
    const onAction = (e: Event) => {
      const { taskId: target, action } = (e as CustomEvent<{ taskId: string; action: TaskAction }>).detail
      if (target !== taskId) return
      if (action === 'new-chat') ws.newTask(ws.projectOf(taskId)?.id)
      if (action === 'toggle-chat') ws.toggleChatDock(taskId)
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
  const docked = agentViews.find((v) => v.id === state.activeAgentViewId) ?? agentViews.at(-1) ?? null
  // What fills the main area, and which conversation (if any) sits in the dock.
  const editorView = active && active.kind !== 'agent' ? active : null
  const chatView = composing ? null : active?.kind === 'agent' ? active : editorView ? docked : null
  const showLauncherMain = !editorView && !chatView
  const dockOpen = !!editorView && !dockHidden && !composing

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
      const input = Array.from(body.current?.querySelectorAll<HTMLTextAreaElement>('.agent-dock .composer textarea') ?? []).find((element) => element.getClientRects().length > 0)
      input?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [visible, taskId, chatView?.id, showLauncherMain, composing])

  const repoName = (repoId?: string) => (repoId ? (ws.binding(taskId, repoId)?.repoName ?? '?') : 'workspace')
  const openSession = (s: AgentSessionInfo) => {
    ws.openView(taskId, { kind: 'agent', sessionId: s.id })
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
  // Drag the divider between the editor and the docked conversation.
  const startResize = (event: ReactPointerEvent) => {
    resizeCleanup.current?.()
    const rect = body.current!.getBoundingClientRect()
    resizeCleanup.current = beginPaneResize(event, 'column', (next) => ws.setDockWidth(taskId, Math.min(Math.max(rect.right - next.clientX, 320), Math.max(320, rect.width - 320))))
  }

  const unfinished = bindings.filter((b) => b.setupState !== 'ready')

  return (
    <section className="task-pane" style={{ display: visible ? 'flex' : 'none' }}>
      {unfinished.length > 0 && (
        <div className="banner warn">
          <CircleAlert size={14} />
          <span className="grow">
            Worktree setup didn't finish for {unfinished.map((b) => b.repoName).join(', ')}.
            {unfinished[0]?.setupError && <span className="muted"> {unfinished[0].setupError}</span>}
          </span>
          <Button onClick={retrySetup} disabled={retrying}>
            {retrying ? 'Retrying…' : 'Retry setup'}
          </Button>
        </div>
      )}
      <div className={`task-body${editorView ? ' with-editor' : ''}`} ref={body}>
      <div className="view-tabs" role="tablist" aria-label="Workspace tabs">
        <Button role="tab" aria-selected={!editorView} className={`view-tab chat-view-tab${!editorView ? ' active' : ''}`} title={composing ? 'New chat' : ws.task(taskId)?.title ?? 'Chat'} onClick={() => { ws.showChat(taskId); requestAnimationFrame(() => Array.from(body.current?.querySelectorAll<HTMLTextAreaElement>('.agent-dock .composer textarea') ?? []).find((input) => input.getClientRects().length > 0)?.focus({ preventScroll: true })) }}><MessageSquare size={13} className="kind" />Chat</Button>
        {tabs.filter((v) => v.kind !== 'agent').map((view) => <FileTab key={view.id} taskId={taskId} view={view} tabs={tabs} active={state.activeViewId === view.id} repoName={repoName} />)}
        <AddMenu
          taskId={taskId}
          bindings={bindings}
          earlier={sessions.filter((s) => !agentViews.some((v) => v.kind === 'agent' && v.sessionId === s.id))}
          repoName={repoName}
          onNewChat={() => ws.newTask(project?.id)}
          onOpenSession={openSession}
        />
        <div className="grow" />

        {editorView && !composing && (
          <Button
            className="ghost icon"
            aria-label={dockHidden ? 'Show conversation' : 'Hide conversation'}
            title={dockHidden ? 'Show conversation' : 'Hide conversation'}
            onClick={() => ws.toggleChatDock(taskId)}
          >
            {dockHidden ? <PanelRightOpen size={15} /> : <PanelRightClose size={15} />}
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
                    <div className="empty">This repository isn't ready yet.</div>
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
        {dockOpen && <div className="splitter" role="separator" tabIndex={0} aria-label="Resize chat pane" aria-orientation="vertical" aria-valuemin={320} aria-valuemax={Math.max(320, Math.round((body.current?.clientWidth ?? 960) - 320))} aria-valuenow={state.dockWidth ?? DEFAULT_DOCK} onPointerDown={startResize} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const max = Math.max(320, (body.current?.clientWidth ?? 960) - 320)
          const value = event.key === 'Home' ? 320 : event.key === 'End' ? max : (state.dockWidth ?? DEFAULT_DOCK) + (event.key === 'ArrowLeft' ? 20 : -20)
          ws.setDockWidth(taskId, Math.max(320, Math.min(max, value)))
        }} />}
        <div
          className={editorView ? 'agent-dock docked' : 'agent-dock'}
          style={{
            display: editorView ? (dockOpen ? 'flex' : 'none') : 'flex',
            width: editorView ? (state.dockWidth ?? DEFAULT_DOCK) : undefined,
          }}
        >
          {editorView && !composing && <header className="chat-dock-header"><span className="grow muted">Chat</span><ChatSwitcher contextId={taskId} docked /></header>}
          {(showLauncherMain || (editorView && !chatView)) && isWorkspaceCtx(taskId) && (
            <NewTask projectId={project?.id ?? ''} onProjectChange={(id) => ws.newTask(id)} />
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
                <AgentView view={v} />
              </div>
            ) : null,
          )}
        </div>
      <TerminalPanel taskId={workspaceId} visible={visible} />
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
          placeholder="What should the agent do?"
          submitLabel="Start session"
        />
        {error && <div className="error">{error}</div>}
      </div>
    </div>
  )
}

/** The strip's "+": start a chat, open a terminal in a repository, or reopen an earlier conversation. */
function AddMenu({
  taskId,
  bindings,
  earlier,
  repoName,
  onNewChat,
  onOpenSession,
}: {
  taskId: string
  bindings: RepositoryBinding[]
  earlier: AgentSessionInfo[]
  repoName: (repoId: string) => string
  onNewChat: () => void
  onOpenSession: (s: AgentSessionInfo) => void
}) {
  const ws = useWorkspace()
  const ready = bindings.filter((b) => b.setupState === 'ready')
  const items: MenuEntry[] = [
    { key: 'chat', label: <><MessageSquarePlus size={14} /> New chat</>, onSelect: onNewChat },
    { key: 'term:workspace', label: <><SquareTerminal size={14} /> Workspace terminal</>, onSelect: () => ws.openView(taskId, { kind: 'terminal' }) },
    ...ready.map((b) => ({
      key: `term:${b.repoId}`,
      label: <><SquareTerminal size={14} /> Terminal in {b.repoName}</>,
      onSelect: () => ws.openView(taskId, { kind: 'terminal', repoId: b.repoId }),
    })),
  ]
  if (earlier.length) {
    items.push({ key: 'earlier', heading: 'Earlier conversations' })
    for (const s of [...earlier].reverse()) {
      items.push({
        key: s.id,
        label: (
          <>
            <History size={14} /> <span className="menu-label">{s.title}</span>
            <span className="muted">{new Date(s.createdAt).toLocaleDateString()}</span>
          </>
        ),
        onSelect: () => onOpenSession(s),
      })
    }
  }
  return <Menu label="New tab" icon={<Plus size={15} />} items={items} />
}

function FileTab({ taskId, view, tabs, active, repoName }: { taskId: string; view: ViewDescriptor; tabs: ViewDescriptor[]; active: boolean; repoName: (repoId?: string) => string }) {
  const ws = useWorkspace()
  const files = tabs.filter((tab) => tab.kind === 'file' || tab.kind === 'diff' || tab.kind === 'git' || tab.kind === 'review')
  const index = files.findIndex((tab) => tab.id === view.id)
  const others = files.filter((tab) => tab.id !== view.id)
  const toLeft = files.slice(0, index)
  const toRight = files.slice(index + 1)
  const saved = files.filter((tab) => !ws.dirty[tab.id])
  const close = (views: ViewDescriptor[]) => ws.closeViews(taskId, views.map((tab) => tab.id))
  const context = useContextMenu('Tab actions', [
    ...(view.kind === 'file' && view.preview ? [{ key: 'keep', label: 'Keep Open', onSelect: () => ws.openView(taskId, { kind: 'file', repoId: view.repoId, path: view.path, preview: false }) }] : []),
    { key: 'close', label: 'Close', onSelect: () => ws.closeView(taskId, view.id) },
    { key: 'others', label: 'Close Others', disabled: !others.length, onSelect: () => close(others) },
    { key: 'left', label: 'Close to the Left', disabled: !toLeft.length, onSelect: () => close(toLeft) },
    { key: 'right', label: 'Close to the Right', disabled: !toRight.length, onSelect: () => close(toRight) },
    { key: 'separator', separator: true },
    { key: 'saved', label: 'Close Saved Tabs', disabled: !saved.length, onSelect: () => close(saved) },
    { key: 'all', label: 'Close All', onSelect: () => close(files) },
    { key: 'reopen', label: 'Reopen Closed Editor', onSelect: () => ws.reopenClosedView(taskId) },
    { key: 'reveal-separator', separator: true },
    ...(view.kind === 'file' || view.kind === 'diff' ? [{ key: 'copy-path', label: 'Copy Relative Path', onSelect: () => { void copyText(view.path).catch((reason) => notifyError(errorText(reason), 'Copy path')) } }] : []),
    { key: 'reveal', label: 'Reveal in Explorer', disabled: view.kind !== 'file' && view.kind !== 'diff', onSelect: () => {
      ws.activateView(taskId, view.id)
      ws.setSidebar('explorer')
      window.dispatchEvent(new Event('ramu:show-explorer'))
    } },
  ])
  return <div className="tab-slot">
    <div role="tab" tabIndex={active ? 0 : -1} aria-selected={active} className={`view-tab${active ? ' active' : ''}${view.kind === 'file' && view.preview ? ' preview' : ''}`} onDoubleClick={() => { if (view.kind === 'file') ws.openView(taskId, { kind: 'file', repoId: view.repoId, path: view.path, preview: false }) }} onContextMenu={context.onContextMenu} onKeyDown={(event) => { context.onKeyDown(event); if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); ws.activateView(taskId, view.id) } }} onClick={() => ws.activateView(taskId, view.id)} onAuxClick={(event) => event.button === 1 && ws.closeView(taskId, view.id)}>
      <ViewIcon kind={view.kind} />
      <ViewLabel view={view} all={tabs} repoName={repoName} />
      {ws.dirty[view.id] && <span className="dirty" aria-label="Unsaved changes" />}
      <Button className="tab-close" aria-label="Close view" onClick={(event) => { event.stopPropagation(); ws.closeView(taskId, view.id) }}><X size={12} /></Button>
    </div>
    {context.menu}
  </div>
}

function ViewIcon({ kind }: { kind: ViewDescriptor['kind'] }) {
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
  const ws = useWorkspace()
  if (v.kind === 'agent') return <>Chat</>
  if (v.kind === 'terminal') return <>{repoName(v.repoId)}</>
  if (v.kind === 'review') return <>Changes<span className="tab-repo">{ws.task(v.taskId)?.title ?? 'Chat'}</span></>
  if (v.kind === 'git') return <>{v.oid ? v.oid.slice(0, 7) : 'Compare with upstream'}<span className="tab-repo">{repoName(v.repoId)}</span></>
  const name = basename(v.path)
  const clash = all.some(
    (o) => o.id !== v.id && (o.kind === 'file' || o.kind === 'diff') && basename(o.path) === name && o.repoId !== v.repoId,
  )
  return (
    <>
      {name}
      {clash && <span className="tab-repo">{repoName(v.repoId)}</span>}
      {v.kind === 'diff' && <span className="tab-repo">{v.oid ? v.oid.slice(0, 7) : v.staged ? 'staged' : 'changes'}</span>}
    </>
  )
}

export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  // Electron prefixes errors thrown in handlers.
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
