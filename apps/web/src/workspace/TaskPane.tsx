import { Spinner } from '@/components/ui/spinner'
import { cachedDataOn } from '../dataQueries'
import { errorText } from '../lib/errors'
import { visibleName } from '@ramu/shared/text'
import { t, useLanguage, formatLocale } from '../i18n'
import { FileIcon, fileStyle } from '../editor/FileIcon'
import { createPortal } from 'react-dom'
import { OverlayScrollArea } from '@/components/overlay-scroll-area'
import { useTabScroll } from '../lib/useTabScroll'
import { WorkspaceSplit } from './WorkspaceSplit'
import { Button } from '@/components/desktop-button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { NO_PROJECT, type Attachment, type FileContext } from '@ramu/shared/types'
import { notifyError } from '../chat/Notifications'
import { useModelSets } from '../models/ModelSets'
import {
  CircleAlert,
  FileDiff,
  FileText,
  GitBranch,
  Globe,
  History,
  FileSearch,
  Plus,
  Maximize2,
  Minimize2,
  SquareTerminal,
  X,
} from 'lucide-react'
import { memo, useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { ChangeReviewTab } from '../Changes'
import { type AgentSettings, type AgentSessionInfo, type ViewDescriptor } from '@ramu/shared/types'
import { formatKeys, type TaskAction } from '../commands'
import { AgentControls } from '../chat/AgentControls'
import { Composer } from '../composer/Composer'
import { Menu, useContextMenu } from '../Menu'
import { copyText } from '../ipc'
import { useHost } from './HostProvider'
import { ownHostId } from '../hosts'
import { NEW_TAB, openBrowser } from '../views/browserPane'
import { AgentView } from '../views/AgentView'
import { ErrorBoundary } from '../ErrorBoundary'
import { GitDetailsView } from '../views/GitDetailsView'
import { DiffView } from '../views/DiffView'
import { FileView } from '../views/FileView'
import { BrowserView } from '../views/BrowserView'
import { TerminalPanel } from './TerminalPanel'
import { NewTask } from '../NewTask'
import { FILE_DRAG_TYPE } from '../composer/ComposerSuggestions'
import { beginDrag, setActiveDrag, TAB_DRAG_TYPE, TERMINAL_DRAG_TYPE, useActiveDrag } from '../lib/dragState'
import { useAppSettings } from '../settings/AppSettings'
import { useChatHidden, useEditorSide } from './layoutPrefs'
import { isPreviewable, isWorkspaceCtx, tabOrder, useHostRuntime, useWorkspace } from './workspace'
import { WorkspaceRail, workspaceToolOf } from './WorkspaceTools'
import { HideWorkspaceButton } from './HideWorkspaceButton'
import { SlidePane } from './paneMotion'
import { terminalGroups } from '@ramu/shared/workspace/terminalGroups'

/**
 * Chat fills the workspace until a file or review opens beside it on the right.
 * The left conversation stays mounted throughout review and agent revisions.
 * Files, diffs and terminals remain shared within their checkout.
 */
export const TaskPane = memo(function TaskPane({ taskId, visible }: { taskId: string; visible: boolean }) {
  useLanguage()
  const ws = useWorkspace()
  const { id: host, invoke } = useHost()
  const { on } = useHostRuntime()
  const { preferences } = useAppSettings()
  const project = ws.projectOf(taskId)
  const composing = isWorkspaceCtx(taskId) && ws.composing === project?.id
  const workspaceId = ws.workspaceOf(taskId)
  useEffect(() => {
    void ws.refreshBindings(workspaceId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when the listed dependencies change; other values are read as of that change
  }, [workspaceId, ws.refreshBindings])
  const state = ws.taskUi[taskId] ?? { views: [], activeViewId: null }
  const bindings = ws.bindings[taskId] ?? []
  const terminalDock = state.terminalDock ?? preferences.defaultTerminalDock
  const terminalOpen = state.views.some((view) => view.kind === 'terminal') && (state.terminalOpen ?? true)
  const groups = terminalGroups(state)
  const tabs = tabOrder(state.views).filter(
    (v) =>
      v.kind !== 'terminal' ||
      (terminalDock === 'right' && terminalOpen && groups.some((group) => group.terminalIds[0] === v.id)),
  )
  const agentViews = tabs.filter((v) => v.kind === 'agent')
  const [sessions, setSessions] = useState<AgentSessionInfo[]>(() => cachedDataOn(host, 'agent.list', taskId) ?? [])
  const [sessionsError, setSessionsError] = useState<string | null>(null)
  const [sessionsLoadedFor, setSessionsLoadedFor] = useState<string | null>(() =>
    cachedDataOn(host, 'agent.list', taskId) ? taskId : null,
  )
  const [retrying, setRetrying] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  // One terminal instance serves both docks: its host element moves between slots so shells never remount.
  const [chatHost] = useState(() => createPaneHost('chat-slot'))
  const [editorHost] = useState(() => createPaneHost('editor-slot'))
  const [terminalHost] = useState(() => {
    const el = document.createElement('div')
    el.className = 'terminal-slot flex h-full w-full min-w-0 min-h-0'
    return el
  })
  const [rightSlot, setRightSlot] = useState<HTMLDivElement | null>(null)
  const [bottomSlot, setBottomSlot] = useState<HTMLDivElement | null>(null)
  const [chatHidden, setChatHidden] = useChatHidden(workspaceId)
  const [editorSide, setEditorSide] = useEditorSide(workspaceId)
  const chatHiddenRef = useRef(chatHidden)
  chatHiddenRef.current = chatHidden

  // Palette and shortcut actions that act on this task's own view state.
  useEffect(() => {
    const onAction = (e: Event) => {
      const { taskId: target, action } = (e as CustomEvent<{ taskId: string; action: TaskAction }>).detail
      if (target !== taskId) return
      if (action === 'new-chat') ws.newTask(ws.projectOf(taskId)?.id)
      if (action === 'toggle-chat') setChatHidden(!chatHiddenRef.current)
    }
    window.addEventListener('ramu:task-action', onAction)
    return () => window.removeEventListener('ramu:task-action', onAction)
  }, [taskId, ws, setChatHidden])

  useEffect(() => {
    let cancelled = false
    const cached = cachedDataOn(host, 'agent.list', taskId)
    setSessions(cached ?? [])
    setSessionsLoadedFor(cached ? taskId : null)
    setSessionsError(null)
    const load = () =>
      invoke('agent.list', taskId).then(
        (list) => {
          if (!cancelled) {
            setSessions(list)
            setSessionsLoadedFor(taskId)
            setSessionsError(null)
          }
        },
        (error) => {
          if (!cancelled) {
            setSessionsError(errorText(error))
            notifyError(error)
          }
        },
      )
    void load()
    const off = on('agent:event', ({ event }) => {
      if (event.kind === 'state') void load()
    })
    return () => {
      cancelled = true
      off()
    }
  }, [taskId, host, invoke, on])

  const activeTerminalGroup = groups.find((group) => group.terminalIds.includes(state.activeViewId ?? ''))
  const active =
    tabs.find((v) => v.id === state.activeViewId || v.id === activeTerminalGroup?.terminalIds[0]) ??
    tabs.find((v) => v.id === state.activeAgentViewId) ??
    null
  const focusedChat = agentViews.find((v) => v.id === state.activeAgentViewId) ?? agentViews.at(-1) ?? null
  // The conversation always stays in the main chat pane beside the active workspace view.
  // Explorer, Search and Source Control live in a rail of this pane, so opening one opens the pane too.
  // New chat keeps the rail too, so Explorer, Search and Source Control open beside the message box.
  const workspaceTool = visible ? workspaceToolOf(ws.ui.sidebar) : null
  // With a tool open the pane shows a file tab if there is one; otherwise an empty-state hint beside the rail.
  const editorView =
    active && active.kind !== 'agent'
      ? active
      : workspaceTool
        ? (tabs.findLast((v) => v.kind !== 'agent') ?? null)
        : null
  // New chat only replaces the conversation: open files, terminals and the rail stay as they were.
  const tabScroll = useTabScroll(editorView?.id, true, visible && !!editorView)
  const chatView = composing ? null : active?.kind === 'agent' ? active : editorView ? focusedChat : null
  const showLauncherMain = !editorView && !chatView
  const rightTerminal = terminalOpen && terminalDock === 'right' && editorView?.kind === 'terminal'
  const bottomTerminal = terminalOpen && terminalDock === 'bottom'
  const editorOpen = !!editorView
  useLayoutEffect(() => {
    const slot = rightTerminal ? rightSlot : bottomTerminal ? bottomSlot : null
    if (slot && terminalHost.parentElement !== slot) slot.appendChild(terminalHost)
  }, [rightTerminal, bottomTerminal, rightSlot, bottomSlot, terminalHost])

  // A saved chat may not have a saved view yet. Restore its conversation before
  // showing a composer for a session that does not exist.
  useLayoutEffect(() => {
    if (!visible || isWorkspaceCtx(taskId) || sessionsLoadedFor !== taskId || agentViews.length || !sessions.length)
      return
    const latest = sessions.reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
    ws.openView(taskId, { kind: 'agent', sessionId: latest.id })
    if (editorView) ws.activateView(taskId, editorView.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when the listed dependencies change; other values are read as of that change
  }, [visible, taskId, sessionsLoadedFor, sessions, agentViews.length, editorView?.id, ws.openView, ws.activateView])

  // Switching conversations focuses their composer without moving focus during streaming.
  useLayoutEffect(() => {
    if (!visible || (!chatView && !showLauncherMain)) return
    const frame = requestAnimationFrame(() => {
      const input = Array.from(
        body.current?.querySelectorAll<HTMLElement>('.main-chat [data-composer-input]') ?? [],
      ).find((element) => element.getClientRects().length > 0)
      input?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when the listed dependencies change; other values are read as of that change
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

  const unfinished = bindings.filter((b) => b.setupState !== 'ready')

  return (
    <section
      className="task-pane flex-1 flex-col min-w-0 min-h-0"
      data-panel-visible={visible || undefined}
      style={{ display: visible ? 'flex' : 'none' }}
    >
      {ws.task(taskId)?.branchNamingFallback && (
        <p role="status" className="m-0 px-3 py-1 text-caption text-muted-foreground">
          {t('Used default branch name')}
        </p>
      )}
      {unfinished.length > 0 && (
        <div className="banner [&.warn]:[background:var(--warn-wash)] [&.warn]:text-warn [&_button]:text-control [&_button]:p-[2px_8px] p-[7px_12px] flex gap-2 items-center text-control warn text-warn">
          <CircleAlert size={14} />
          <span className="grow flex-1 min-w-0 text-left">
            {t("Worktree setup didn't finish for ")}
            {unfinished.map((b) => b.repoName).join(', ')}.
            {unfinished[0]?.setupError && (
              <span className="muted text-muted-foreground"> {unfinished[0].setupError}</span>
            )}
          </span>
          <Button variant="secondary" className="bg-fill hover:bg-fill-hover" onClick={retrySetup} disabled={retrying}>
            {retrying ? t('Retrying…') : t('Retry setup')}
          </Button>
        </div>
      )}
      <div className="task-body flex-1 min-h-0 min-w-0 flex" ref={body}>
        <div className="task-main relative flex-1 min-h-0 min-w-0">
          <DockZones taskId={taskId} editorOpen={editorOpen} onEditorSide={setEditorSide} />
          <WorkspaceSplit
            id={`${workspaceId}.terminal-bottom`}
            orientation="vertical"
            resizePreview
            open={bottomTerminal}
            label={t('Resize terminal panel')}
            defaultShare={30}
            primaryMin={240}
            secondaryMin={120}
            primary={
              <WorkspaceSplit
                id={`${workspaceId}.editor`}
                resizePreview={rightTerminal}
                open={editorOpen}
                flip={editorSide === 'left'}
                primaryCollapsed={chatHidden}
                label={t(rightTerminal ? 'Resize terminal panel' : 'Resize thread pane')}
                defaultShare={55}
                primary={<PaneSlot host={chatHost} />}
                secondary={<PaneSlot host={editorHost} />}
              />
            }
            secondary={<div className="h-full w-full min-w-0 min-h-0" ref={setBottomSlot} />}
          />
        </div>
        <SlidePane open={!!workspaceTool}>{workspaceTool && <WorkspaceRail tool={workspaceTool} />}</SlidePane>
        {createPortal(
          <div
            className="main-chat h-full w-full [&_>_.home-page]:flex-1 [&_>_.home-page]:min-h-0 flex-1 min-w-0 flex-col bg-canvas"
            style={{ display: 'flex' }}
          >
            {(showLauncherMain || (editorView && !chatView)) && isWorkspaceCtx(taskId) && (
              <NewTask projectId={project?.id ?? ''} onProjectChange={(id) => ws.newTask(id)} feed={!editorView} />
            )}
            {sessionsError && !chatView && (
              <p role="alert" className="p-4 text-bad">
                {sessionsError}
              </p>
            )}
            {!isWorkspaceCtx(taskId) && !chatView && !sessionsError && sessionsLoadedFor !== taskId && (
              <div className="flex flex-1 items-center justify-center">
                <Spinner className="size-5 text-muted-foreground" aria-label={t('Loading conversation')} />
              </div>
            )}
            {(showLauncherMain || (editorView && !chatView)) &&
              !isWorkspaceCtx(taskId) &&
              sessionsLoadedFor === taskId &&
              !sessions.length && (
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
                <div
                  key={v.id}
                  className="view flex-1 min-w-0 min-h-0 flex-col"
                  style={{ display: chatView?.id === v.id ? 'flex' : 'none' }}
                >
                  <ErrorBoundary resetKey={v.id}>
                    <AgentView
                      view={v}
                      visible={visible && chatView?.id === v.id}
                      history={
                        sessions.length > 1 ? (
                          <Menu
                            label={t('Earlier conversations')}
                            icon={<History size={14} />}
                            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
                            align="end"
                            items={[...sessions]
                              .sort((a, b) => b.createdAt - a.createdAt)
                              .map((session) => ({
                                key: session.id,
                                selected: session.id === v.sessionId,
                                label: (
                                  <>
                                    <span className="menu-label [.chat-switch-menu_&]:flex-1 [.chat-switch-menu_&]:max-w-[none] [.chat-switch-menu_&]:leading-[18px] [.chat-switch-menu_&]:font-medium [.chat-switch-menu_&]:min-w-0 [.dropdown-menu_&]:min-w-0 [.dropdown-menu_&]:max-w-[none] [.dropdown-menu_&]:whitespace-nowrap [.project-switch-menu_&]:max-w-[none] [.project-switch-menu_&]:leading-[18px] [.project-switch-menu_&]:font-medium [.project-switch-menu_&]:min-w-0 [.project-switch-menu_&_.block]:max-w-[none] [.project-switch-menu_&_.block]:overflow-hidden [.project-switch-menu_&_.block]:text-ellipsis [.project-switch-menu_&_.block]:whitespace-nowrap [.project-switch-menu_&_.block]:m-[2px_0_0] [.project-switch-menu_&_.block]:text-caption [.project-switch-menu_&_.block]:leading-[16px] [.project-switch-menu_&_.block]:font-normal [.project-switch-menu_&_.block]:text-muted-foreground [.chat-switch-menu_&_.block]:overflow-hidden [.chat-switch-menu_&_.block]:text-ellipsis [.chat-switch-menu_&_.block]:whitespace-nowrap [.chat-switch-menu_&_.block]:m-[2px_0_0] [.chat-switch-menu_&_.block]:text-caption [.chat-switch-menu_&_.block]:leading-[16px] [.chat-switch-menu_&_.block]:font-normal [.chat-switch-menu_&_.block]:text-muted-foreground max-w-[220px] overflow-hidden text-ellipsis grow flex-1 min-w-0 text-left">
                                      {session.title}
                                    </span>
                                    <span className="muted text-muted-foreground small text-caption">
                                      {new Date(session.createdAt).toLocaleDateString(formatLocale())}
                                    </span>
                                  </>
                                ),
                                onSelect: () => openSession(session),
                              }))}
                          />
                        ) : undefined
                      }
                    />
                  </ErrorBoundary>
                </div>
              ) : null,
            )}
          </div>,
          chatHost,
        )}
        {createPortal(
          <div
            className="workspace-panel flex h-full min-w-0 min-h-0 overflow-hidden"
            inert={!editorOpen}
            aria-hidden={!editorOpen}
          >
            <div className="workspace-main flex flex-1 flex-col min-w-0 min-h-0 overflow-hidden">
              <div
                className="workspace-tab-toolbar flex items-center flex-none min-w-0 min-h-[40px] gap-1 px-2 py-1.5"
                style={{ display: editorOpen ? 'flex' : 'none' }}
              >
                <OverlayScrollArea
                  horizontal
                  className="flex-initial min-w-0 w-max max-w-full h-[27px] [&:focus-within_>_[data-slot='scroll-area-scrollbar']]:opacity-0 [&_>_[data-slot='scroll-area-scrollbar'][data-scrolling]]:opacity-0 [&:hover_>_[data-slot='scroll-area-scrollbar']]:opacity-100 [&_>_[data-slot='scroll-area-scrollbar'][data-dragging]]:opacity-100 [&_>_[data-slot='scroll-area-scrollbar']]:h-[9px] [&_>_[data-slot='scroll-area-scrollbar']]:p-0 [&_>_[data-slot='scroll-area-scrollbar']]:pt-[6px] [&_>_[data-slot='scroll-area-scrollbar']]:bottom-px [&_[data-slot='scroll-area-thumb']]:[background:color-mix(in_srgb,_var(--text)_22%,_transparent)] [&_[data-slot='scroll-area-thumb']:hover]:[background:color-mix(in_srgb,_var(--text)_38%,_transparent)]"
                  viewportRef={tabScroll}
                  viewportClassName="view-tabs"
                  contentClassName="flex items-center gap-1 w-max! min-w-full!"
                  viewportProps={{
                    role: 'tablist',
                    'aria-label': t('Workspace tabs'),
                    onKeyDown: (event) => {
                      if (
                        !(event.target instanceof HTMLElement) ||
                        event.target.getAttribute('role') !== 'tab' ||
                        event.ctrlKey ||
                        event.metaKey
                      )
                        return
                      const entries = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'))
                      const index = entries.indexOf(event.target)
                      if (event.altKey) {
                        // Alt+Arrow moves the focused tab one place, matching drag reorder.
                        const forward = event.key === 'ArrowRight'
                        if (!forward && event.key !== 'ArrowLeft') return
                        event.preventDefault()
                        const id = event.target.dataset.viewId,
                          other = entries[index + (forward ? 1 : -1)]?.dataset.viewId
                        if (!id || !other) return
                        ws.moveView(taskId, id, other, forward)
                        requestAnimationFrame(() =>
                          document
                            .querySelector<HTMLElement>(`[role="tab"][data-view-id="${CSS.escape(id)}"]`)
                            ?.focus({ preventScroll: false }),
                        )
                        return
                      }
                      const next =
                        event.key === 'ArrowRight'
                          ? (index + 1) % entries.length
                          : event.key === 'ArrowLeft'
                            ? (index - 1 + entries.length) % entries.length
                            : event.key === 'Home'
                              ? 0
                              : event.key === 'End'
                                ? entries.length - 1
                                : -1
                      if (next < 0) return
                      event.preventDefault()
                      entries[next]?.focus({ preventScroll: true })
                      entries[next]?.click()
                    },
                  }}
                >
                  {tabs
                    .filter((v) => v.kind !== 'agent')
                    .map((view) => (
                      <FileTab
                        key={view.id}
                        taskId={taskId}
                        view={view}
                        tabs={tabs}
                        active={editorView?.id === view.id}
                        repoName={repoName}
                      />
                    ))}
                </OverlayScrollArea>
                <Menu
                  standard
                  label={t('New tab')}
                  icon={<Plus />}
                  className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center"
                  items={[
                    {
                      key: 'file',
                      label: (
                        <>
                          <FileSearch data-icon="inline-start" />
                          {t('Open file')}
                          <span className="ml-auto text-muted-foreground">{formatKeys('mod+p')}</span>
                        </>
                      ),
                      onSelect: () => window.dispatchEvent(new Event('ramu:open-file')),
                    },
                    {
                      key: 'terminal',
                      label: (
                        <>
                          <SquareTerminal data-icon="inline-start" />
                          {t('New terminal')}
                        </>
                      ),
                      onSelect: () => {
                        ws.setTerminalPanel(taskId, { terminalDock: 'right' })
                        ws.openView(taskId, { kind: 'terminal' })
                      },
                    },
                    ...(typeof window.ramu?.invoke === 'function' && host === ownHostId()
                      ? [
                          {
                            key: 'browser',
                            label: (
                              <>
                                <Globe data-icon="inline-start" />
                                {t('Open browser')}
                                <span className="ml-auto text-muted-foreground">{formatKeys('mod+shift+l')}</span>
                              </>
                            ),
                            onSelect: () => openBrowser(ws, taskId, NEW_TAB),
                          },
                        ]
                      : []),
                  ]}
                />
                <div className="flex-1 min-w-0" />
                {editorOpen && (
                  <Button
                    variant="ghost"
                    size={chatHidden ? 'sm' : 'icon-sm'}
                    className="ghost relative transition-colors bg-transparent border-transparent text-muted-foreground hover:bg-transparent hover:text-foreground aria-pressed:bg-transparent aria-expanded:bg-transparent gap-1.5 px-2 min-h-(--action-size) flex-none justify-center"
                    aria-label={chatHidden ? t('Show thread') : t('Maximize workspace')}
                    aria-pressed={chatHidden}
                    title={`${chatHidden ? t('Show thread') : t('Maximize workspace')} (${formatKeys('mod+alt+c')})`}
                    onClick={() => setChatHidden(!chatHidden)}
                  >
                    {chatHidden ? <Minimize2 data-icon="inline-start" /> : <Maximize2 data-icon="inline-start" />}
                    {chatHidden && <span>{t('Show thread')}</span>}
                    {chatHidden && (ws.task(taskId)?.status === 'needs-input' || ws.unread.has(taskId)) && (
                      <span
                        role="status"
                        aria-label={
                          ws.task(taskId)?.status === 'needs-input'
                            ? t('Waiting for your input')
                            : t('New activity in thread')
                        }
                        className={`absolute top-1 right-1 size-1.5 rounded-full ${ws.task(taskId)?.status === 'needs-input' ? 'bg-warn' : 'bg-brand'}`}
                      />
                    )}
                  </Button>
                )}
                <HideWorkspaceButton onHide={() => ws.hideWorkspace(taskId)} />
              </div>
              <div
                className="editor-area flex-1 min-h-0 min-w-0 flex flex-col"
                style={{ display: editorView && editorView.kind !== 'terminal' ? 'flex' : 'none' }}
              >
                {tabs
                  .filter((v) => v.kind !== 'agent' && v.kind !== 'terminal')
                  .map((v) => {
                    const shown = editorView?.id === v.id && visible
                    const repoId = 'repoId' in v ? v.repoId : undefined
                    const binding = repoId ? ws.binding(workspaceId, repoId) : undefined
                    const ready = v.kind === 'review' || v.kind === 'browser' || binding?.setupState === 'ready'
                    return (
                      <div
                        key={v.id}
                        className="view flex-1 min-w-0 min-h-0 flex-col"
                        style={{ display: shown ? 'flex' : 'none' }}
                      >
                        {!ready ? (
                          <div className="empty flex flex-1 items-center justify-center text-muted-foreground p-6 text-center">
                            {t("This repository isn't ready yet.")}
                          </div>
                        ) : (
                          <VisitedView visible={shown}>
                            <ErrorBoundary resetKey={v.id}>
                              {v.kind === 'file' && binding && (
                                <FileView taskId={workspaceId} view={v} binding={binding} />
                              )}
                              {v.kind === 'diff' && binding && (
                                <DiffView taskId={workspaceId} view={v} binding={binding} />
                              )}
                              {v.kind === 'review' && <ChangeReviewTab view={v} visible={shown} />}
                              {v.kind === 'browser' && <BrowserView taskId={taskId} view={v} visible={shown} />}
                              {v.kind === 'git' && binding && (
                                <GitDetailsView taskId={workspaceId} view={v} binding={binding} />
                              )}
                            </ErrorBoundary>
                          </VisitedView>
                        )}
                      </div>
                    )
                  })}
              </div>
              <div
                className="flex-1 min-w-0 min-h-0"
                style={{ display: rightTerminal ? 'flex' : 'none' }}
                ref={setRightSlot}
              />
              {!editorView && (
                <Empty className="flex-1">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <FileText />
                    </EmptyMedia>
                    <EmptyTitle>{t('Select a file to open it here.')}</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              )}
            </div>
          </div>,
          editorHost,
        )}
        {createPortal(
          <TerminalPanel
            taskId={workspaceId}
            visible={visible}
            hidden={terminalDock === 'right' && !rightTerminal}
            dock={terminalDock}
          />,
          terminalHost,
        )}
      </div>
    </section>
  )
})

// Views keep a stable DOM host while the independent grid tracks open and close.
function createPaneHost(className: string) {
  const element = document.createElement('div')
  element.className = `${className} h-full w-full min-w-0 min-h-0 overflow-hidden`
  return element
}

function PaneSlot({ host }: { host: HTMLDivElement }) {
  const slot = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = slot.current
    element?.appendChild(host)
    return () => {
      if (host.parentElement === element) host.remove()
    }
  }, [host])
  return <div ref={slot} className="h-full w-full min-w-0 min-h-0" />
}

/** Restore tab state without constructing editors for tabs the user has not opened. */
function VisitedView({ visible, children }: { visible: boolean; children: ReactNode }) {
  const [visited, setVisited] = useState(visible)
  useEffect(() => {
    if (visible) setVisited(true)
  }, [visible])
  return visible || visited ? children : null
}

function NewChat({ taskId, onStarted }: { taskId: string; onStarted: (s: AgentSessionInfo) => void }) {
  useLanguage()
  const ws = useWorkspace()
  const { invoke } = useHost()
  const bindings = ws.bindings[taskId] ?? []
  const { initialSettings } = useModelSets()
  const [settings, setSettings] = useState<AgentSettings>(initialSettings)
  useEffect(
    () => setSettings(initialSettings),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when the listed dependencies change; other values are read as of that change
    [
      initialSettings.provider,
      initialSettings.model,
      initialSettings.effort,
      initialSettings.access,
      initialSettings.autoFallback,
    ],
  )
  const [prompt, setPrompt] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ready =
    ws.task(taskId)?.projectId === NO_PROJECT ||
    (bindings.length > 0 && bindings.every((b) => b.setupState === 'ready'))

  const start = async (context: FileContext[] = []) => {
    setBusy(true)
    setError(null)
    try {
      onStarted(
        await invoke(
          'agent.start',
          taskId,
          prompt,
          settings,
          attachments.map((file) => file.id),
          context,
        ),
      )
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
          placeholder={t('What should the agent do?')}
          submitLabel="Start session"
        />
        {error && <div className="error text-bad">{error}</div>}
      </div>
    </div>
  )
}

function FileTab({
  taskId,
  view,
  tabs,
  active,
  repoName,
}: {
  taskId: string
  view: ViewDescriptor
  tabs: ViewDescriptor[]
  active: boolean
  repoName: (repoId?: string) => string
}) {
  useLanguage()
  const ws = useWorkspace()
  const files = tabs.filter((tab) => tab.kind !== 'agent')
  const groups = terminalGroups(ws.taskUi[taskId] ?? { views: [], activeViewId: null })
  const terminalGroup = groups.find((group) => group.terminalIds.includes(view.id))
  const activate = () => {
    const focused = ws.taskUi[taskId]?.activeTerminalId
    ws.activateView(taskId, terminalGroup?.terminalIds.includes(focused ?? '') ? focused! : view.id)
  }
  const index = files.findIndex((tab) => tab.id === view.id)
  // Terminal groups have their own close actions in the terminal tab menu, so bulk closing only touches files.
  const closable = files.filter((tab) => tab.kind !== 'terminal')
  const others = closable.filter((tab) => tab.id !== view.id)
  const toLeft = files.slice(0, index).filter((tab) => tab.kind !== 'terminal')
  const toRight = files.slice(index + 1).filter((tab) => tab.kind !== 'terminal')
  const saved = closable.filter((tab) => !ws.dirty[tab.id])
  const close = (views: ViewDescriptor[]) =>
    ws.closeViews(
      taskId,
      views.flatMap((tab) =>
        tab.kind === 'terminal'
          ? (groups.find((group) => group.terminalIds.includes(tab.id))?.terminalIds ?? [tab.id])
          : [tab.id],
      ),
    )
  const context = useContextMenu('Tab actions', [
    ...(isPreviewable(view) && view.preview
      ? [{ key: 'keep', label: t('Keep Open'), onSelect: () => ws.keepView(taskId, view.id) }]
      : []),
    {
      key: 'close',
      label: (
        <span className="flex w-full items-center gap-2">
          {t('Close')}
          <span className="ml-auto text-muted-foreground">{formatKeys('mod+w')}</span>
        </span>
      ),
      onSelect: () => close([view]),
    },
    { key: 'others', label: t('Close Others'), disabled: !others.length, onSelect: () => close(others) },
    { key: 'left', label: t('Close to the Left'), disabled: !toLeft.length, onSelect: () => close(toLeft) },
    { key: 'right', label: t('Close to the Right'), disabled: !toRight.length, onSelect: () => close(toRight) },
    { key: 'separator', separator: true },
    { key: 'saved', label: t('Close Saved Tabs'), disabled: !saved.length, onSelect: () => close(saved) },
    { key: 'files', label: t('Close All Editors'), disabled: !closable.length, onSelect: () => close(closable) },
    { key: 'all', label: t('Close All Editors and Terminals'), onSelect: () => close(files) },
    {
      key: 'reopen',
      label: (
        <span className="flex w-full items-center gap-2">
          {t('Reopen Closed Editor')}
          <span className="ml-auto text-muted-foreground">{formatKeys('mod+shift+t')}</span>
        </span>
      ),
      onSelect: () => ws.reopenClosedView(taskId),
    },
    { key: 'reveal-separator', separator: true },
    ...(view.kind === 'file' || view.kind === 'diff'
      ? [
          {
            key: 'copy-path',
            label: t('Copy Relative Path'),
            onSelect: () => {
              void copyText(view.path).catch((reason) => notifyError(errorText(reason), 'Copy path'))
            },
          },
        ]
      : []),
    {
      key: 'reveal',
      label: t('Reveal in Explorer'),
      disabled: view.kind !== 'file' && view.kind !== 'diff',
      onSelect: () => {
        ws.activateView(taskId, view.id)
        ws.setSidebar('explorer')
        window.dispatchEvent(new Event('ramu:show-explorer'))
      },
    },
  ])
  const [drop, setDrop] = useState<'before' | 'after' | null>(null)
  const dragProps = {
    draggable: true,
    onDragStart: (event: DragEvent) => {
      event.dataTransfer.setData(TAB_DRAG_TYPE, view.id)
      // A file tab doubles as an Explorer file, so it can be dropped into a chat or a terminal.
      if (view.kind === 'file')
        event.dataTransfer.setData(
          FILE_DRAG_TYPE,
          JSON.stringify({ repoId: view.repoId, path: view.path, kind: 'file' }),
        )
      event.dataTransfer.effectAllowed = 'copyMove'
      beginDrag('tab')
    },
    onDragEnd: () => {
      setActiveDrag(null)
      setDrop(null)
    },
    onDragOver: (event: DragEvent<HTMLDivElement>) => {
      if (!event.dataTransfer.types.includes(TAB_DRAG_TYPE)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      const box = event.currentTarget.getBoundingClientRect()
      const next = event.clientX > box.left + box.width / 2 ? 'after' : 'before'
      setDrop((current) => (current === next ? current : next))
    },
    onDragLeave: (event: DragEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrop(null)
    },
    onDrop: (event: DragEvent) => {
      const dragged = event.dataTransfer.getData(TAB_DRAG_TYPE)
      setDrop(null)
      if (!dragged) return
      event.preventDefault()
      setActiveDrag(null)
      ws.moveView(taskId, dragged, view.id, drop === 'after')
    },
  }
  return (
    <div className="tab-slot relative flex items-center flex-none" {...dragProps}>
      {drop && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute inset-y-0 z-2 w-0.5 rounded-[1px] bg-(--accent) ${drop === 'before' ? '-left-0.5' : '-right-0.5'}`}
        />
      )}
      <div
        role="tab"
        data-view-id={view.id}
        tabIndex={active ? 0 : -1}
        aria-selected={active}
        className={`view-tab bg-transparent [&:not(.active):active]:bg-accent [&:hover_.tab-close]:opacity-100 [&_.tab-title]:max-w-[180px] [&:not(.active):hover]:bg-fill-hover [&:not(.active):hover]:text-soft [&.active]:text-foreground [&.active]:bg-accent [&.active]:[box-shadow:none] [&_.kind:not(.file-kind)]:text-muted-foreground [&_.kind]:flex-none [&.partner]:text-soft [&.partner]:[box-shadow:inset_0_-2px_0_var(--line-strong)] [&.pinned]:font-medium [&.active_.kind:not(.file-kind)]:text-foreground [&.preview_.tab-label]:[font-style:italic] [&.preview_.view-label]:[font-style:italic] [&.preview]:[font-style:italic] [border-color:transparent] [&:hover:not(:disabled)]:[border-color:transparent] [&:focus-visible]:[outline-color:var(--line-strong)] [&_.tab-close]:w-[18px] [&_.tab-close]:h-[18px] [&_.tab-close]:min-w-[18px] [&_.tab-close]:min-h-[18px] [&_.tab-close]:p-0 [&_.tab-close]:inline-grid [&_.tab-close]:place-items-center [&_.tab-close]:rounded-(--radius-xs) [&_.tab-close]:bg-transparent [&_.tab-close]:[border:0] [&_.tab-close]:[box-shadow:none] [&_.tab-close]:flex-none [&_.tab-close:hover:not(:disabled)]:bg-accent [&_.tab-close:hover:not(:disabled)]:text-foreground [&_.tab-close_svg]:w-3 [&_.tab-close_svg]:h-3 flex items-center gap-1.5 cursor-default whitespace-nowrap text-muted-foreground text-control [transition:background_0.12s_var(--ease),_color_0.12s_var(--ease)] h-[27px] rounded-(--radius-s) p-[0_5px_0_9px] ${active ? ' active' : ''}${isPreviewable(view) && view.preview ? ' preview' : ''}`}
        title={
          isPreviewable(view) && view.preview
            ? t('Preview: opening another file replaces this tab. Double-click or edit to keep it open.')
            : undefined
        }
        onDoubleClick={() => ws.keepView(taskId, view.id)}
        onContextMenu={context.onContextMenu}
        onKeyDown={(event) => {
          context.onKeyDown(event)
          if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            activate()
          }
        }}
        onClick={activate}
        onAuxClick={(event) => event.button === 1 && close([view])}
      >
        <ViewIcon kind={view.kind} path={view.kind === 'file' || view.kind === 'diff' ? view.path : undefined} />
        {view.kind === 'terminal' ? (
          <span className="tab-title truncate">
            {view.title ?? (view.repoId ? repoName(view.repoId) : t('Workspace'))}
            {groups.length > 1 ? ` ${groups.findIndex((group) => group.id === terminalGroup?.id) + 1}` : ''}
            {(terminalGroup?.terminalIds.length ?? 0) > 1 ? ` · ${terminalGroup!.terminalIds.length}` : ''}
          </span>
        ) : (
          <ViewLabel view={view} all={tabs} repoName={repoName} />
        )}
        {ws.dirty[view.id] && (
          <span
            className="dirty w-[7px] h-[7px] rounded-full [background:var(--soft)] flex-none"
            aria-label={t('Unsaved changes')}
          />
        )}
        <Button
          variant="secondary"
          className="bg-fill hover:bg-fill-hover tab-close [&:hover:not(:disabled)]:bg-accent [&:hover:not(:disabled)]:[border:none] [&:hover:not(:disabled)]:text-foreground [.active_>_&]:opacity-100 bg-transparent [border:none] rounded-(--radius-s) p-0.5 text-muted-foreground opacity-0"
          aria-label={t('Close view')}
          onClick={(event) => {
            event.stopPropagation()
            close([view])
          }}
        >
          <X size={12} />
        </Button>
      </div>
      {context.menu}
    </div>
  )
}

function ViewIcon({ kind, path }: { kind: ViewDescriptor['kind']; path?: string }) {
  useLanguage()
  if (kind === 'git') return <GitBranch size={13} className="kind" />
  if (kind === 'review') return <FileDiff size={13} className="kind" />
  if (kind === 'diff') return <FileDiff size={13} className={path ? `kind file-kind ${fileStyle(path)[1]}` : 'kind'} />
  if (kind === 'terminal') return <SquareTerminal size={13} className="kind" />
  if (kind === 'browser') return <Globe size={13} className="kind" />
  return path ? <FileIcon path={path} size={13} className="kind file-kind" /> : <FileText size={13} className="kind" />
}

function basename(p: string): string {
  return p.split('/').pop() || p
}

/** File name, plus the repository when another open file has the same name. */
function ViewLabel({
  view: v,
  all,
  repoName,
}: {
  view: ViewDescriptor
  all: ViewDescriptor[]
  repoName: (repoId?: string) => string
}) {
  useLanguage()
  const ws = useWorkspace()
  if (v.kind === 'agent') return <>{t('Thread')}</>
  if (v.kind === 'terminal') return <>{v.title ?? repoName(v.repoId)}</>
  if (v.kind === 'browser') return <>{t('Browser')}</>
  if (v.kind === 'review')
    return (
      <>
        {t('Changes')}
        <span className="tab-repo text-muted-foreground text-caption">{ws.task(v.taskId)?.title ?? t('Thread')}</span>
      </>
    )
  if (v.kind === 'git')
    return (
      <>
        {v.oid ? v.oid.slice(0, 7) : t('Compare with upstream')}
        <span className="tab-repo text-muted-foreground text-caption">{repoName(v.repoId)}</span>
      </>
    )
  const name = basename(v.path)
  const clash = all.some(
    (o) =>
      o.id !== v.id && (o.kind === 'file' || o.kind === 'diff') && basename(o.path) === name && o.repoId !== v.repoId,
  )
  return (
    <>
      {visibleName(name)}
      {clash && <span className="tab-repo text-muted-foreground text-caption">{repoName(v.repoId)}</span>}
      {v.kind === 'diff' && (
        <span className="tab-repo text-muted-foreground text-caption">
          {v.oid ? `${v.stash ? 'stash · ' : ''}${v.oid.slice(0, 7)}` : v.staged === true ? 'staged' : t('changes')}
        </span>
      )}
    </>
  )
}

export { errorText } from '../lib/errors'

/** Edge drop targets that appear while a tab is dragged: docks the editor left or right, or the terminal right or bottom. */
function DockZones({
  taskId,
  editorOpen,
  onEditorSide,
}: {
  taskId: string
  editorOpen: boolean
  onEditorSide: (side: 'left' | 'right') => void
}) {
  const ws = useWorkspace()
  const drag = useActiveDrag()
  const [over, setOver] = useState<string | null>(null)
  useEffect(() => {
    if (!drag) setOver(null)
  }, [drag])
  if (!drag || (drag === 'tab' && !editorOpen)) return null
  const type = drag === 'tab' ? TAB_DRAG_TYPE : TERMINAL_DRAG_TYPE
  const zone = (id: string, label: string, className: string, dock: () => void) => (
    <div
      key={id}
      role="presentation"
      className={`pointer-events-auto absolute grid place-items-center rounded-(--radius-l) border text-control transition-colors ${className} ${over === id ? 'border-(--accent) bg-brand-wash text-foreground' : 'border-transparent bg-transparent text-transparent'}`}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(type)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setOver(id)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOver((current) => (current === id ? null : current))
      }}
      onDrop={(event) => {
        event.preventDefault()
        setOver(null)
        setActiveDrag(null)
        dock()
      }}
    >
      <span
        className={`rounded-(--radius-l) bg-fill p-[6px_12px] [border:1px_solid_var(--edge)] [box-shadow:0_8px_30px_#0003] ${over === id ? '' : 'invisible'}`}
      >
        {label}
      </span>
    </div>
  )
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-80 p-1.5">
      {drag === 'tab'
        ? [
            zone('left', t('Dock editor on left'), 'top-12 bottom-1.5 left-1.5 w-[18%]', () => onEditorSide('left')),
            zone('right', t('Dock editor on right'), 'top-12 bottom-1.5 right-1.5 w-[18%]', () =>
              onEditorSide('right'),
            ),
          ]
        : [
            zone('right', t('Move terminal to workspace tabs'), 'top-1.5 bottom-[34%] right-1.5 w-[30%]', () =>
              ws.setTerminalPanel(taskId, { terminalDock: 'right' }),
            ),
            zone('bottom', t('Dock terminal at bottom'), 'inset-x-1.5 bottom-1.5 h-[30%]', () =>
              ws.setTerminalPanel(taskId, { terminalDock: 'bottom' }),
            ),
          ]}
    </div>
  )
}
